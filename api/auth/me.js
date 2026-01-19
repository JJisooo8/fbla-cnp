// Explicit Vercel serverless function for /api/auth/me
// Returns current user info from JWT token

import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'locallink-dev-secret-change-in-production';

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

    res.status(200).json({
      user: {
        id: decoded.id,
        username: decoded.username
      }
    });
  } catch (error) {
    console.error('[AUTH] Token verification error:', error.message);
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
}
