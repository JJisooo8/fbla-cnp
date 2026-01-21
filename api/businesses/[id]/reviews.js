// Explicit Vercel serverless function for /api/businesses/:id/reviews
// Handles POST requests for submitting reviews and GET requests for fetching reviews
// Note: No CAPTCHA required - users are verified at signup

import jwt from 'jsonwebtoken';
import { put, list } from '@vercel/blob';
import crypto from 'crypto';

const REVIEWS_BLOB_NAME = "reviews.json";
const JWT_SECRET = process.env.JWT_SECRET || 'locallink-dev-secret-change-in-production';

// Load reviews from Vercel Blob with cache-busting
async function loadReviews() {
  try {
    const { blobs } = await list({ prefix: REVIEWS_BLOB_NAME });
    let reviewsBlob = blobs.find(b => b.pathname === REVIEWS_BLOB_NAME);
    if (!reviewsBlob && blobs.length > 0) {
      reviewsBlob = blobs.find(b => b.pathname.includes(REVIEWS_BLOB_NAME));
    }

    if (reviewsBlob) {
      // Add cache-busting query param and headers to avoid stale data
      const cacheBustUrl = `${reviewsBlob.url}${reviewsBlob.url.includes('?') ? '&' : '?'}_t=${Date.now()}`;
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
          return new Map(JSON.parse(text));
        }
      }
    }
    return new Map();
  } catch (error) {
    console.error('[REVIEW] Error loading reviews:', error.message);
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
    console.error('[REVIEW] Error saving reviews:', error.message);
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
    console.log('[REVIEW] Invalid token:', error.message);
    return null;
  }
}

export default async function handler(req, res) {
  // Handle CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { id: businessId } = req.query;

  // Handle GET request - fetch reviews for a business
  if (req.method === 'GET') {
    try {
      const localReviews = await loadReviews();
      const reviews = localReviews.get(businessId) || [];

      // Don't expose upvotedBy list to unauthorized users
      const user = verifyToken(req.headers['authorization']);
      const publicReviews = reviews.map(review => ({
        ...review,
        upvotedBy: user ? review.upvotedBy : undefined
      }));

      return res.status(200).json({ reviews: publicReviews });
    } catch (error) {
      console.error('[REVIEW] Error fetching reviews:', error);
      return res.status(500).json({ error: 'Failed to fetch reviews' });
    }
  }

  // Handle POST request - submit a new review
  if (req.method === 'POST') {
    // Verify authentication
    const user = verifyToken(req.headers['authorization']);
    if (!user) {
      return res.status(401).json({ error: 'Must be logged in to review' });
    }

    try {
      const {
        rating,
        comment,
        quality,
        foodQuality, // Legacy support
        service,
        cleanliness,
        atmosphere,
        isAnonymous
      } = req.body;

      // Get user info from token
      const userId = user.id;
      const authorName = isAnonymous ? "Anonymous" : user.username;

      // Validate rating
      if (!rating || typeof rating !== "number" || rating < 1 || rating > 5) {
        return res.status(400).json({ error: "Rating must be between 1 and 5" });
      }

      // Comment is optional - validate only if provided
      const reviewComment = (comment && typeof comment === "string") ? comment.trim() : "";

      // Support both 'quality' and legacy 'foodQuality'
      const qualityRating = quality !== undefined ? quality : foodQuality;

      // Validate category ratings (required, must be 1-5)
      const validateCategoryRating = (val, name) => {
        if (val === undefined || val === null) {
          return `${name} rating is required`;
        }
        if (typeof val !== "number" || val < 1 || val > 5) {
          return `${name} rating must be between 1 and 5`;
        }
        return null;
      };

      const categoryErrors = [
        validateCategoryRating(qualityRating, "Quality"),
        validateCategoryRating(service, "Service"),
        validateCategoryRating(cleanliness, "Cleanliness"),
        validateCategoryRating(atmosphere, "Atmosphere")
      ].filter(Boolean);

      if (categoryErrors.length > 0) {
        return res.status(400).json({ error: categoryErrors[0] });
      }

      // No CAPTCHA needed - users are verified at signup
      console.log(`[REVIEW] Submitting review for business ${businessId} by user ${user.username}`);

      // Load current reviews
      const localReviews = await loadReviews();

      // Create review with user association
      const review = {
        id: crypto.randomUUID(),
        userId,
        author: authorName,
        isAnonymous: !!isAnonymous,
        rating,
        comment: reviewComment,
        date: new Date().toISOString(),
        helpful: 0,
        upvotedBy: [],
        source: 'local',
        quality: qualityRating,
        service,
        cleanliness,
        atmosphere
      };

      const reviews = localReviews.get(businessId) || [];
      reviews.push(review);
      localReviews.set(businessId, reviews);

      // Save and wait for completion
      const saved = await saveReviews(localReviews);
      if (!saved) {
        console.error('[REVIEW] Warning: Review may not have persisted to storage');
      }

      // Return review without internal fields
      const publicReview = {
        ...review,
        upvotedBy: undefined
      };

      console.log(`[REVIEW] Successfully submitted review ${review.id} for business ${businessId}`);
      return res.status(201).json({ message: "Review submitted successfully", review: publicReview });
    } catch (error) {
      console.error('[REVIEW] Error submitting review:', error);
      return res.status(500).json({ error: "Failed to submit review" });
    }
  }

  // Method not allowed
  return res.status(405).json({ error: 'Method not allowed' });
}
