// Explicit Vercel serverless function for /api/auth/signup
// Handles user registration

import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { put, list } from '@vercel/blob';

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
    console.log('[AUTH] No users found, starting fresh');
    return [];
  } catch (error) {
    console.error('[AUTH] Error loading users:', error.message);
    return [];
  }
}

// Save users to Vercel Blob
async function saveUsers(usersData) {
  const jsonData = JSON.stringify(usersData);
  console.log(`[AUTH] Saving ${usersData.length} users (${jsonData.length} chars)`);

  try {
    const blob = await put(USERS_BLOB_NAME, jsonData, {
      access: 'public',
      contentType: 'application/json',
      addRandomSuffix: false
    });
    console.log(`[AUTH] Saved users to ${blob.url}`);
    return true;
  } catch (error) {
    console.error('[AUTH] Error saving users:', error.message);
    return false;
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

  console.log('[AUTH] Signup request received');
  console.log('[AUTH] Request body:', JSON.stringify(req.body || {}));

  try {
    const { username, password, confirmPassword } = req.body || {};

    // Input validation
    if (!username || typeof username !== 'string') {
      console.log('[AUTH] Validation failed: Username is required');
      return res.status(400).json({ error: 'Username is required.' });
    }

    const trimmedUsername = username.trim();

    // Username validation
    if (trimmedUsername.length < 3) {
      return res.status(400).json({ error: 'Username must be at least 3 characters long.' });
    }
    if (trimmedUsername.length > 20) {
      return res.status(400).json({ error: 'Username must be 20 characters or less.' });
    }
    if (!/^[a-zA-Z0-9_]+$/.test(trimmedUsername)) {
      return res.status(400).json({ error: 'Username can only contain letters, numbers, and underscores.' });
    }

    // Password validation
    if (!password || typeof password !== 'string') {
      return res.status(400).json({ error: 'Password is required.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
    }
    if (password.length > 100) {
      return res.status(400).json({ error: 'Password must be 100 characters or less.' });
    }

    // Confirm password validation
    if (password !== confirmPassword) {
      return res.status(400).json({ error: 'Passwords do not match.' });
    }

    console.log('[AUTH] Validations passed, loading users...');

    // Load existing users
    const usersData = await loadUsers();

    // Check if username already exists
    const existingUser = usersData.find(u =>
      u.username.toLowerCase() === trimmedUsername.toLowerCase()
    );
    if (existingUser) {
      return res.status(409).json({ error: 'Username already exists. Please choose a different username.' });
    }

    console.log('[AUTH] Username available, hashing password...');

    // Hash password
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Create new user
    const newUser = {
      id: crypto.randomUUID(),
      username: trimmedUsername,
      passwordHash,
      createdAt: new Date().toISOString()
    };

    usersData.push(newUser);

    // Save to storage
    console.log('[AUTH] Saving users...');
    const saved = await saveUsers(usersData);
    if (!saved) {
      return res.status(500).json({ error: 'Unable to create account. Please try again.' });
    }

    // Generate token
    const token = generateToken(newUser);

    console.log(`[AUTH] New user registered: ${trimmedUsername}`);

    res.status(201).json({
      message: 'Account created successfully',
      user: {
        id: newUser.id,
        username: newUser.username
      },
      token
    });
  } catch (error) {
    console.error('[AUTH] Signup error:', error.message, error.stack);
    res.status(500).json({ error: 'Unable to create account. Server error: ' + error.message });
  }
}
