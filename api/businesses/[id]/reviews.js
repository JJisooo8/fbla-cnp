// Explicit Vercel serverless function for /api/businesses/:id/reviews
// Handles POST requests for submitting reviews and GET requests for fetching reviews

import jwt from 'jsonwebtoken';
import { put, list } from '@vercel/blob';
import crypto from 'crypto';

const REVIEWS_BLOB_NAME = "reviews.json";
const JWT_SECRET = process.env.JWT_SECRET || 'locallink-dev-secret-change-in-production';
const RECAPTCHA_SECRET = process.env.RECAPTCHA_SECRET_KEY;
const RECAPTCHA_ENABLED = process.env.RECAPTCHA_ENABLED === 'true';

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

// Verify reCAPTCHA token
async function verifyRecaptcha(token) {
  if (!RECAPTCHA_SECRET) {
    return { success: false, error: 'reCAPTCHA not configured' };
  }

  try {
    const response = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `secret=${RECAPTCHA_SECRET}&response=${token}`
    });
    return await response.json();
  } catch (error) {
    console.error('[REVIEW] reCAPTCHA verification error:', error);
    return { success: false, error: error.message };
  }
}

// In-memory verification challenges (for fallback when reCAPTCHA is disabled)
const verificationChallenges = new Map();

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
        verificationId,
        verificationAnswer,
        recaptchaToken,
        foodQuality,
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
        validateCategoryRating(foodQuality, "Food quality"),
        validateCategoryRating(service, "Service"),
        validateCategoryRating(cleanliness, "Cleanliness"),
        validateCategoryRating(atmosphere, "Atmosphere")
      ].filter(Boolean);

      if (categoryErrors.length > 0) {
        return res.status(400).json({ error: categoryErrors[0] });
      }

      // Verify anti-spam
      console.log(`[REVIEW] Submitting review for business ${businessId} by user ${user.username}`);
      console.log(`[REVIEW] reCAPTCHA enabled: ${RECAPTCHA_ENABLED}, token provided: ${!!recaptchaToken}`);

      if (RECAPTCHA_ENABLED && recaptchaToken) {
        console.log('[REVIEW] Verifying reCAPTCHA token...');
        const recaptchaResult = await verifyRecaptcha(recaptchaToken);
        console.log('[REVIEW] reCAPTCHA result:', JSON.stringify(recaptchaResult));
        if (!recaptchaResult.success) {
          console.log('[REVIEW] reCAPTCHA verification failed:', recaptchaResult['error-codes'] || recaptchaResult.error);
          return res.status(400).json({ error: "reCAPTCHA verification failed. Please try again." });
        }
        console.log('[REVIEW] reCAPTCHA verification successful');
      } else {
        // Fallback verification (math challenge) - check if provided
        if (verificationId && verificationAnswer) {
          const challenge = verificationChallenges.get(verificationId);
          if (!challenge) {
            return res.status(400).json({ error: "Verification expired or invalid" });
          }
          if (challenge.answer !== parseInt(verificationAnswer)) {
            return res.status(400).json({ error: "Verification failed. Please try again." });
          }
          verificationChallenges.delete(verificationId);
        }
        // If no verification provided and reCAPTCHA not enabled, allow submission
        // (authenticated users are trusted)
      }

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
        foodQuality,
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
