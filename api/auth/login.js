// Explicit Vercel serverless function for /api/auth/login
// Handles user authentication

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { list } from '@vercel/blob';

const USERS_BLOB_NAME = "users.json";
const JWT_SECRET = process.env.JWT_SECRET || 'locallink-dev-secret-change-in-production';
const JWT_EXPIRES_IN = '7d';

// Load users from Vercel Blob
async function loadUsers() {
  try {
    console.log('[AUTH] Loading users from Vercel Blob...');
    const { blobs } = await list({ prefix: USERS_BLOB_NAME });

    let usersBlob = blobs.find(b => b.pathname === USERS_BLOB_NAME);
    if (!usersBlob && blobs.length > 0) {
      usersBlob = blobs.find(b => b.pathname.includes(USERS_BLOB_NAME));
    }

    if (usersBlob) {
      console.log(`[AUTH] Found users blob at ${usersBlob.url}`);
      const response = await fetch(usersBlob.url);
      if (response.ok) {
        const text = await response.text();
        if (text.trim()) {
          const users = JSON.parse(text);
          console.log(`[AUTH] Loaded ${users.length} users`);
          return users;
        }
      }
    }
    console.log('[AUTH] No users found');
    return [];
  } catch (error) {
    console.error('[AUTH] Error loading users:', error.message);
    return [];
  }
}

// Generate JWT token
function generateToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

export default async function handler(req, res) {
  // Handle CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  console.log('[AUTH] Login request received');

  try {
    const { username, password } = req.body || {};

    // Input validation
    if (!username || typeof username !== 'string' || !username.trim()) {
      return res.status(400).json({ error: 'Username is required.' });
    }
    if (!password || typeof password !== 'string') {
      return res.status(400).json({ error: 'Password is required.' });
    }

    const trimmedUsername = username.trim();
    console.log('[AUTH] Login attempt for:', trimmedUsername);

    // Load users
    const usersData = await loadUsers();

    // Find user
    const user = usersData.find(u =>
      u.username.toLowerCase() === trimmedUsername.toLowerCase()
    );

    if (!user) {
      console.log('[AUTH] Username not found:', trimmedUsername);
      return res.status(401).json({ error: 'Username does not exist.' });
    }

    // Verify password
    const passwordValid = await bcrypt.compare(password, user.passwordHash);
    if (!passwordValid) {
      console.log('[AUTH] Incorrect password for:', user.username);
      return res.status(401).json({ error: 'Password does not match username.' });
    }

    // Generate token
    const token = generateToken(user);

    console.log(`[AUTH] User logged in: ${user.username}`);

    res.status(200).json({
      message: 'Login successful',
      user: {
        id: user.id,
        username: user.username
      },
      token
    });
  } catch (error) {
    console.error('[AUTH] Login error:', error.message, error.stack);
    res.status(500).json({ error: 'Login failed. Server error: ' + error.message });
  }
}
