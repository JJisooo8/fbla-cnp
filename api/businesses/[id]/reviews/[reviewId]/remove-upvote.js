// Explicit Vercel serverless function for /api/businesses/:id/reviews/:reviewId/remove-upvote
// Handles removing an upvote from a review

import jwt from 'jsonwebtoken';
import { put, list } from '@vercel/blob';

const REVIEWS_BLOB_NAME = "reviews.json";
const JWT_SECRET = process.env.JWT_SECRET || 'locallink-dev-secret-change-in-production';

// Load reviews from Vercel Blob
async function loadReviews() {
  try {
    const { blobs } = await list({ prefix: REVIEWS_BLOB_NAME });
    let reviewsBlob = blobs.find(b => b.pathname === REVIEWS_BLOB_NAME);
    if (!reviewsBlob && blobs.length > 0) {
      reviewsBlob = blobs.find(b => b.pathname.includes(REVIEWS_BLOB_NAME));
    }

    if (reviewsBlob) {
      const response = await fetch(reviewsBlob.url);
      if (response.ok) {
        const text = await response.text();
        if (text.trim()) {
          return new Map(JSON.parse(text));
        }
      }
    }
    return new Map();
  } catch (error) {
    console.error('[UPVOTE] Error loading reviews:', error.message);
    return new Map();
  }
}

// Save reviews to Vercel Blob
async function saveReviews(reviewsMap) {
  const jsonData = JSON.stringify(Array.from(reviewsMap.entries()));
  try {
    await put(REVIEWS_BLOB_NAME, jsonData, {
      access: 'public',
      contentType: 'application/json',
      addRandomSuffix: false
    });
    return true;
  } catch (error) {
    console.error('[UPVOTE] Error saving reviews:', error.message);
    return false;
  }
}

// Verify JWT token
function verifyToken(authHeader) {
  if (!authHeader) return null;
  const token = authHeader.split(' ')[1]; // Bearer TOKEN
  if (!token) return null;

  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    console.log('[UPVOTE] Invalid token:', error.message);
    return null;
  }
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

  // Verify authentication
  const user = verifyToken(req.headers['authorization']);
  if (!user) {
    return res.status(401).json({ error: 'Authentication required. Please log in.' });
  }

  const { id: businessId, reviewId } = req.query;
  console.log(`[UPVOTE] User ${user.username} removing upvote from review ${reviewId} for business ${businessId}`);

  try {
    // Load reviews
    const localReviews = await loadReviews();
    const reviews = localReviews.get(businessId);

    if (!reviews) {
      return res.status(404).json({ error: 'Business not found.' });
    }

    const review = reviews.find(r => r.id === reviewId);
    if (!review) {
      return res.status(404).json({ error: 'Review not found.' });
    }

    // Initialize upvotedBy array if it doesn't exist
    if (!review.upvotedBy) {
      review.upvotedBy = [];
    }

    // Check if user has actually upvoted
    if (!review.upvotedBy.includes(user.id)) {
      return res.status(400).json({ error: 'You have not upvoted this review.', helpful: review.helpful });
    }

    // Remove user from upvotedBy and decrement helpful count
    review.upvotedBy = review.upvotedBy.filter(id => id !== user.id);
    review.helpful = Math.max(0, (review.helpful || 1) - 1);

    // Save
    const saved = await saveReviews(localReviews);
    if (!saved) {
      // Revert changes
      review.upvotedBy.push(user.id);
      review.helpful = (review.helpful || 0) + 1;
      return res.status(500).json({ error: 'Failed to remove upvote.' });
    }

    console.log(`[UPVOTE] User ${user.username} removed upvote from review ${reviewId}`);
    res.status(200).json({ message: 'Upvote removed.', helpful: review.helpful });
  } catch (error) {
    console.error('[UPVOTE] Error:', error.message, error.stack);
    res.status(500).json({ error: 'Failed to remove upvote.' });
  }
}
