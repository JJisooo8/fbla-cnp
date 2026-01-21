// Explicit Vercel serverless function for /api/auth/me
// Returns current user info from JWT token

import jwt from 'jsonwebtoken';
import { list } from '@vercel/blob';

const USERS_BLOB_NAME = "users.json";
const JWT_SECRET = process.env.JWT_SECRET || 'locallink-dev-secret-change-in-production';

// Load users from Vercel Blob
async function loadUsers() {
  try {
    const { blobs } = await list({ prefix: USERS_BLOB_NAME });
    let usersBlob = blobs.find(b => b.pathname === USERS_BLOB_NAME);
    if (!usersBlob && blobs.length > 0) {
      usersBlob = blobs.find(b => b.pathname.includes(USERS_BLOB_NAME));
    }

    if (usersBlob) {
      // Add cache-busting to avoid stale data
      const cacheBustUrl = `${usersBlob.url}${usersBlob.url.includes('?') ? '&' : '?'}_t=${Date.now()}`;
      const response = await fetch(cacheBustUrl, {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache'
        }
      });
      if (response.ok) {
        const text = await response.text();
        if (text.trim()) {
          return JSON.parse(text);
        }
      }
    }
    return [];
  } catch (error) {
    console.error('[AUTH] Error loading users:', error.message);
    return [];
  }
}

export default async function handler(req, res) {
  // Handle CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only allow GET
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  try {
    // Get token from Authorization header
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      return res.status(401).json({ error: 'Not authenticated.' });
    }

    // Verify token
    const decoded = jwt.verify(token, JWT_SECRET);

    // Look up user to get createdAt
    const users = await loadUsers();
    const user = users.find(u => u.id === decoded.id);

    res.status(200).json({
      user: {
        id: decoded.id,
        username: decoded.username,
        createdAt: user?.createdAt || null
      }
    });
  } catch (error) {
    console.error('[AUTH] Token verification error:', error.message);
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
}
