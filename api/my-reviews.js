// Vercel serverless function for /api/my-reviews
// Returns all reviews written by the authenticated user

import jwt from 'jsonwebtoken';
import { list } from '@vercel/blob';

const REVIEWS_BLOB_NAME = "reviews.json";
const JWT_SECRET = process.env.JWT_SECRET || 'locallink-dev-secret-change-in-production';

// Simplified Yelp fetch for business data (names and categories)
const YELP_API_KEY = process.env.YELP_API_KEY;
const YELP_LOCATION = "Cumming, GA";
const YELP_CATEGORIES = ["food", "retail", "services"];

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
    console.error('[MY-REVIEWS] Error loading reviews:', error.message);
    return new Map();
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
    console.log('[MY-REVIEWS] Invalid token:', error.message);
    return null;
  }
}

// Fetch basic business info from Yelp
async function fetchBusinessBasics() {
  if (!YELP_API_KEY) return new Map();

  try {
    const allBusinesses = [];

    for (const category of YELP_CATEGORIES) {
      const url = `https://api.yelp.com/v3/businesses/search?location=${encodeURIComponent(YELP_LOCATION)}&categories=${category}&limit=50`;
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${YELP_API_KEY}` }
      });

      if (response.ok) {
        const data = await response.json();
        if (data.businesses) {
          data.businesses.forEach(biz => {
            allBusinesses.push({
              id: biz.id,
              name: biz.name,
              category: category.charAt(0).toUpperCase() + category.slice(1),
              image: biz.image_url || null
            });
          });
        }
      }
    }

    return new Map(allBusinesses.map(b => [b.id, b]));
  } catch (error) {
    console.error('[MY-REVIEWS] Error fetching businesses:', error.message);
    return new Map();
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
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify authentication
  const user = verifyToken(req.headers['authorization']);
  if (!user) {
    return res.status(401).json({ error: 'Authentication required. Please log in.' });
  }

  try {
    const userId = user.id;

    // Load reviews and business data in parallel
    const [localReviews, businessMap] = await Promise.all([
      loadReviews(),
      fetchBusinessBasics()
    ]);

    // Collect all reviews by this user
    const userReviews = [];

    for (const [businessId, reviews] of localReviews.entries()) {
      for (const review of reviews) {
        if (review.userId === userId && !review.hidden) {
          const business = businessMap.get(businessId);
          userReviews.push({
            ...review,
            upvotedBy: undefined, // Don't expose upvotedBy list
            businessId,
            businessName: business?.name || 'Unknown Business',
            businessCategory: business?.category || 'Unknown',
            businessImage: business?.image || null
          });
        }
      }
    }

    // Sort by date (newest first)
    userReviews.sort((a, b) => new Date(b.date) - new Date(a.date));

    res.status(200).json({ reviews: userReviews, count: userReviews.length });
  } catch (error) {
    console.error('[MY-REVIEWS] Error:', error);
    res.status(500).json({ error: 'Failed to fetch your reviews' });
  }
}
