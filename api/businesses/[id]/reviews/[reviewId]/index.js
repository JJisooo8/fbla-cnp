// Vercel serverless function for /api/businesses/:id/reviews/:reviewId
// Handles PUT (edit) and DELETE operations on individual reviews

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
  res.setHeader('Access-Control-Allow-Methods', 'PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Verify authentication
  const user = verifyToken(req.headers['authorization']);
  if (!user) {
    return res.status(401).json({ error: 'Authentication required. Please log in.' });
  }

  const { id: businessId, reviewId } = req.query;

  // Handle PUT (edit review)
  if (req.method === 'PUT') {
    console.log(`[REVIEW] User ${user.username} editing review ${reviewId} for business ${businessId}`);

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

      // Load reviews
      const localReviews = await loadReviews();
      const reviews = localReviews.get(businessId);

      if (!reviews) {
        return res.status(404).json({ error: 'Business not found.' });
      }

      const reviewIndex = reviews.findIndex(r => r.id === reviewId);
      if (reviewIndex === -1) {
        return res.status(404).json({ error: 'Review not found.' });
      }

      const review = reviews[reviewIndex];

      // Check ownership
      if (review.userId !== user.id) {
        return res.status(403).json({ error: 'You can only edit your own reviews.' });
      }

      // Validate and update rating if provided
      if (rating !== undefined) {
        if (typeof rating !== "number" || rating < 1 || rating > 5) {
          return res.status(400).json({ error: "Rating must be between 1 and 5" });
        }
        review.rating = rating;
      }

      // Update comment if provided
      if (comment !== undefined) {
        review.comment = (typeof comment === "string") ? comment.trim() : "";
      }

      // Validate category ratings
      const validateCategoryRating = (val) => {
        return val !== undefined && (typeof val !== "number" || val < 1 || val > 5);
      };

      // Support both 'quality' and legacy 'foodQuality'
      const qualityRating = quality !== undefined ? quality : foodQuality;
      if (qualityRating !== undefined) {
        if (validateCategoryRating(qualityRating)) {
          return res.status(400).json({ error: "Quality rating must be between 1 and 5" });
        }
        review.quality = qualityRating;
      }

      if (service !== undefined) {
        if (validateCategoryRating(service)) {
          return res.status(400).json({ error: "Service rating must be between 1 and 5" });
        }
        review.service = service;
      }

      if (cleanliness !== undefined) {
        if (validateCategoryRating(cleanliness)) {
          return res.status(400).json({ error: "Cleanliness rating must be between 1 and 5" });
        }
        review.cleanliness = cleanliness;
      }

      if (atmosphere !== undefined) {
        if (validateCategoryRating(atmosphere)) {
          return res.status(400).json({ error: "Atmosphere rating must be between 1 and 5" });
        }
        review.atmosphere = atmosphere;
      }

      // Update anonymous status if provided
      if (isAnonymous !== undefined) {
        review.isAnonymous = !!isAnonymous;
        review.author = review.isAnonymous ? "Anonymous" : user.username;
      }

      // Mark as edited
      review.editedAt = new Date().toISOString();

      // Save
      const saved = await saveReviews(localReviews);
      if (!saved) {
        return res.status(500).json({ error: 'Failed to save review.' });
      }

      // Return updated review without internal fields
      const publicReview = {
        ...review,
        upvotedBy: undefined
      };

      console.log(`[REVIEW] Successfully updated review ${reviewId}`);
      return res.status(200).json({ message: 'Review updated successfully.', review: publicReview });
    } catch (error) {
      console.error('[REVIEW] Error editing review:', error.message, error.stack);
      return res.status(500).json({ error: 'Failed to edit review.' });
    }
  }

  // Handle DELETE
  if (req.method === 'DELETE') {
    console.log(`[REVIEW] User ${user.username} deleting review ${reviewId} for business ${businessId}`);

    try {
      // Load reviews
      const localReviews = await loadReviews();
      const reviews = localReviews.get(businessId);

      if (!reviews) {
        return res.status(404).json({ error: 'Business not found.' });
      }

      const reviewIndex = reviews.findIndex(r => r.id === reviewId);
      if (reviewIndex === -1) {
        return res.status(404).json({ error: 'Review not found.' });
      }

      const review = reviews[reviewIndex];

      // Check ownership
      if (review.userId !== user.id) {
        return res.status(403).json({ error: 'You can only delete your own reviews.' });
      }

      // Remove the review
      reviews.splice(reviewIndex, 1);
      localReviews.set(businessId, reviews);

      // Save
      const saved = await saveReviews(localReviews);
      if (!saved) {
        return res.status(500).json({ error: 'Failed to delete review.' });
      }

      console.log(`[REVIEW] Successfully deleted review ${reviewId}`);
      return res.status(200).json({ message: 'Review deleted successfully.' });
    } catch (error) {
      console.error('[REVIEW] Error deleting review:', error.message, error.stack);
      return res.status(500).json({ error: 'Failed to delete review.' });
    }
  }

  // Method not allowed
  return res.status(405).json({ error: 'Method not allowed.' });
}
