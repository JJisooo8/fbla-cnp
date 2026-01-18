// Explicit Vercel serverless function for /api/verification/challenge
// Math challenge fallback when reCAPTCHA is not configured

import crypto from 'crypto';

// Store challenges in memory (note: in serverless, this resets between invocations)
// For production, consider using a database or Redis
const verificationChallenges = new Map();

function generateChallenge() {
  const a = Math.floor(Math.random() * 10) + 1;
  const b = Math.floor(Math.random() * 10) + 1;
  const id = crypto.randomUUID();
  const answer = a + b;

  verificationChallenges.set(id, { answer, expires: Date.now() + 300000 }); // 5 min expiry

  // Clean up expired challenges
  for (const [key, value] of verificationChallenges.entries()) {
    if (Date.now() > value.expires) {
      verificationChallenges.delete(key);
    }
  }

  return { id, question: `What is ${a} + ${b}?` };
}

export default function handler(req, res) {
  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  console.log('[API] /api/verification/challenge called');

  try {
    const challenge = generateChallenge();
    res.status(200).json(challenge);
  } catch (error) {
    console.error('Error generating challenge:', error);
    res.status(500).json({ error: 'Failed to generate challenge' });
  }
}
