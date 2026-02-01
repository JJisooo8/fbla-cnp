/**
 * LocalLink - Express API Server
 * FBLA Coding & Programming: Byte-Sized Business Boost
 *
 * This server provides the backend API for the LocalLink application,
 * handling business data, user authentication, and review management.
 *
 * Key Features:
 * - RESTful API endpoints for businesses, reviews, and authentication
 * - Integration with Yelp API for business data (with offline fallback)
 * - Persistent storage via Vercel Blob (production) or file system (development)
 * - CAPTCHA verification for bot prevention on user signup
 * - JWT-based authentication with secure password hashing
 *
 * Data Flow:
 * 1. Business data fetched from Yelp API and cached for performance
 * 2. User reviews stored in Vercel Blob with local file fallback
 * 3. Recommendations generated based on user favorites and ratings
 *
 * ============================================================================
 * VERCEL BLOB WRITE OPERATIONS - SAFEGUARD NOTICE
 * ============================================================================
 * To conserve Vercel Blob usage limits, ONLY the following blob writes are ACTIVE:
 *
 * ACTIVE (User-initiated actions only):
 * - saveUsersAsync(): Called during user signup
 * - saveReviewsAsync(): Called for review CRUD operations (create, edit, delete, upvote)
 *
 * DISABLED (Seeding/automated operations):
 * - ensureSeeded(): Disabled - returns immediately
 * - seedReviewsIfEmpty(): Disabled - returns immediately
 * - seedReviewsForNewBusinesses(): Disabled - returns immediately
 * - /api/import-businesses: Disabled - returns 403
 * - /api/admin/regenerate-reviews: Disabled - returns 403
 * - saveBusinessesToBlob() in fetchYelpBusinesses(): Commented out
 * - saveBusinessesToBlob() in recover-favorites: Commented out
 * - saveBusinessesToBlob() in single business recovery: Commented out
 *
 * DO NOT re-enable seeding functions without understanding blob usage implications.
 * ============================================================================
 */

import express from "express";
import cors from "cors";
import crypto from "crypto";
import axios from "axios";
import NodeCache from "node-cache";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { put, list, del } from "@vercel/blob";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

// Load environment variables from .env file
const envPaths = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), 'server', '.env'),
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '.env')
];

let envLoaded = false;
for (const envPath of envPaths) {
  const result = dotenv.config({ path: envPath });
  if (!result.error) {
    console.log(`[ENV] Loaded .env from: ${envPath}`);
    envLoaded = true;
    break;
  }
}
if (!envLoaded && !process.env.VERCEL) {
  console.log('[ENV] No .env file found, using system environment variables');
}

// ============================================
// OFFLINE MODE CONFIGURATION
// ============================================
const OFFLINE_MODE = process.env.OFFLINE_MODE === 'true';
const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data');
const OFFLINE_BUSINESSES_FILE = path.join(DATA_DIR, 'businesses.json');
const OFFLINE_METADATA_FILE = path.join(DATA_DIR, 'metadata.json');
const OFFLINE_IMAGES_DIR = path.join(DATA_DIR, 'images');

// Load offline data if available
let offlineBusinesses = [];
let offlineMetadata = null;

function loadOfflineData() {
  try {
    if (fs.existsSync(OFFLINE_BUSINESSES_FILE)) {
      const data = fs.readFileSync(OFFLINE_BUSINESSES_FILE, 'utf8');
      offlineBusinesses = JSON.parse(data);
      console.log(`[OFFLINE] Loaded ${offlineBusinesses.length} businesses from local data`);
    }
    if (fs.existsSync(OFFLINE_METADATA_FILE)) {
      const data = fs.readFileSync(OFFLINE_METADATA_FILE, 'utf8');
      offlineMetadata = JSON.parse(data);
      console.log(`[OFFLINE] Data synced: ${offlineMetadata.seedDateFormatted}`);
    }
  } catch (error) {
    console.error('[OFFLINE] Error loading offline data:', error.message);
  }
}

// Load offline data on startup
if (OFFLINE_MODE || fs.existsSync(OFFLINE_BUSINESSES_FILE)) {
  loadOfflineData();
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================
// STARTUP LOGGING
// ============================================
console.log('========================================');
console.log('[STARTUP] LocalLink API Initializing...');
console.log(`[STARTUP] Environment: ${process.env.VERCEL ? 'Vercel' : 'Local'}`);
console.log(`[STARTUP] Node Version: ${process.version}`);
console.log(`[STARTUP] Offline Mode: ${OFFLINE_MODE ? 'ENABLED' : 'disabled'}`);
if (offlineBusinesses.length > 0) {
  console.log(`[STARTUP] Offline Data: ${offlineBusinesses.length} businesses available`);
  if (offlineMetadata) {
    console.log(`[STARTUP] Data Synced: ${offlineMetadata.seedDateFormatted}`);
  }
}
console.log('----------------------------------------');
console.log('[CONFIG] Environment Variables Status:');
console.log(`  - YELP_API_KEY: ${process.env.YELP_API_KEY ? 'SET (' + process.env.YELP_API_KEY.substring(0, 10) + '...)' : 'NOT SET'}`);
console.log(`  - GOOGLE_SEARCH_API_KEY: ${process.env.GOOGLE_SEARCH_API_KEY ? 'SET' : 'NOT SET'}`);
console.log(`  - GOOGLE_SEARCH_ENGINE_ID: ${process.env.GOOGLE_SEARCH_ENGINE_ID ? 'SET' : 'NOT SET'}`);
console.log(`  - RECAPTCHA_SECRET_KEY: ${process.env.RECAPTCHA_SECRET_KEY ? 'SET' : 'NOT SET'}`);
console.log(`  - RECAPTCHA_SITE_KEY: ${process.env.RECAPTCHA_SITE_KEY ? 'SET' : 'NOT SET'}`);
console.log(`  - OFFLINE_MODE: ${OFFLINE_MODE ? 'true' : 'false'}`);
console.log(`  - BLOB_READ_WRITE_TOKEN: ${process.env.BLOB_READ_WRITE_TOKEN ? 'SET (Vercel Blob enabled)' : 'NOT SET (using file storage)'}`);
console.log('========================================');

// Determine if we should use Vercel Blob
const USE_VERCEL_BLOB = !!process.env.BLOB_READ_WRITE_TOKEN;

// JWT Configuration
const JWT_SECRET = process.env.JWT_SECRET || 'locallink-dev-secret-change-in-production-' + crypto.randomBytes(16).toString('hex');
const JWT_EXPIRES_IN = '7d'; // Token expires in 7 days

// ============================================
// USER AUTHENTICATION STORAGE
// ============================================
const USERS_BLOB_NAME = "users.json";
let usersData = []; // Array of user objects: { id, username, passwordHash, createdAt }
let usersBlobUrl = null;

// Load users from Vercel Blob or file
async function loadUsersAsync() {
  if (USE_VERCEL_BLOB) {
    try {
      console.log('[BLOB] Loading users from Vercel Blob...');
      const { blobs } = await list({ prefix: USERS_BLOB_NAME });

      let usersBlob = blobs.find(b => b.pathname === USERS_BLOB_NAME);
      if (!usersBlob && blobs.length > 0) {
        usersBlob = blobs.find(b => b.pathname.includes(USERS_BLOB_NAME));
      }

      if (usersBlob) {
        usersBlobUrl = usersBlob.url;
        console.log(`[BLOB] Found users blob at ${usersBlob.url}`);
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
            usersData = JSON.parse(text);
            console.log(`[BLOB] Loaded ${usersData.length} users from Vercel Blob`);
            return;
          }
        }
      }
      console.log('[BLOB] No users found in Vercel Blob, starting fresh');
    } catch (error) {
      console.error('[BLOB] Error loading users from Vercel Blob:', error.message);
    }
  }

  // Fallback to file-based storage for local development
  const usersFile = process.env.VERCEL
    ? path.join("/tmp", "users.json")
    : path.join(__dirname, "users.json");
  try {
    if (fs.existsSync(usersFile)) {
      const data = fs.readFileSync(usersFile, "utf8");
      usersData = JSON.parse(data);
      console.log(`[FILE] Loaded ${usersData.length} users from file`);
    }
  } catch (error) {
    console.error("[FILE] Error loading users:", error);
  }
}

// Save users to Vercel Blob or file
async function saveUsersAsync() {
  const jsonData = JSON.stringify(usersData);
  console.log(`[SAVE] Saving ${usersData.length} users (${jsonData.length} chars)`);
  console.log(`[SAVE] USE_VERCEL_BLOB: ${USE_VERCEL_BLOB}, BLOB_READ_WRITE_TOKEN set: ${!!process.env.BLOB_READ_WRITE_TOKEN}`);

  if (USE_VERCEL_BLOB) {
    try {
      // Upload new blob - addRandomSuffix: false ensures consistent filename
      // No need to delete first - put with addRandomSuffix: false will overwrite
      console.log('[BLOB] Uploading users blob...');
      console.log('[BLOB] Blob name:', USERS_BLOB_NAME);
      console.log('[BLOB] Data length:', jsonData.length, 'bytes');

      const blob = await put(USERS_BLOB_NAME, jsonData, {
        access: 'public',
        contentType: 'application/json',
        addRandomSuffix: false
      });
      usersBlobUrl = blob.url;
      console.log(`[BLOB] Saved ${usersData.length} users to Vercel Blob at ${blob.url}`);
      return true;
    } catch (error) {
      console.error('[BLOB] Error saving users to Vercel Blob:', error.message);
      console.error('[BLOB] Error details:', error.stack);
      console.error('[BLOB] Error name:', error.name);
      if (error.response) {
        console.error('[BLOB] Response status:', error.response.status);
        console.error('[BLOB] Response data:', JSON.stringify(error.response.data));
      }
      // Don't return here - fall through to file-based storage
      console.log('[BLOB] Falling through to file-based storage...');
    }
  }

  // Fallback to file-based storage
  const usersFile = process.env.VERCEL
    ? path.join("/tmp", "users.json")
    : path.join(__dirname, "users.json");
  console.log(`[FILE] Attempting to save users to: ${usersFile}`);

  try {
    fs.writeFileSync(usersFile, jsonData, "utf8");
    console.log(`[FILE] Saved ${usersData.length} users to file: ${usersFile}`);
    return true;
  } catch (error) {
    console.error("[FILE] Error saving users:", error.message);
    console.error("[FILE] Error details:", error.stack);
    return false;
  }
}

// Refresh users from Blob
async function refreshUsersFromBlob() {
  if (!USE_VERCEL_BLOB) return;

  try {
    const { blobs } = await list({ prefix: USERS_BLOB_NAME });
    const usersBlob = blobs.find(b => b.pathname === USERS_BLOB_NAME) ||
                      blobs.find(b => b.pathname.includes(USERS_BLOB_NAME));

    if (usersBlob) {
      const response = await fetch(usersBlob.url);
      if (response.ok) {
        const text = await response.text();
        if (text.trim()) {
          usersData = JSON.parse(text);
          usersBlobUrl = usersBlob.url;
          console.log(`[BLOB] Refreshed ${usersData.length} users`);
        }
      }
    }
  } catch (error) {
    console.error('[BLOB] Error refreshing users:', error.message);
  }
}

// Initialize users loading
let usersLoadPromise = null;
let usersLoaded = false;

// Always initialize users loading (whether using Blob or file storage)
usersLoadPromise = loadUsersAsync()
  .then(() => {
    usersLoaded = true;
    console.log('[AUTH] Users loaded and ready');
  })
  .catch(err => {
    console.error('[AUTH] Users async load failed:', err);
    usersLoaded = true; // Mark as loaded even on error to prevent blocking
  });

// Middleware to ensure users are loaded
async function ensureUsersLoaded(req, res, next) {
  if (!usersLoaded && usersLoadPromise) {
    await usersLoadPromise;
  }
  next();
}

// JWT Token Generation
function generateToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

// JWT Token Verification Middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    req.user = null;
    return next(); // Allow unauthenticated access, but req.user will be null
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    console.log('[AUTH] Invalid token:', error.message);
    req.user = null;
    next();
  }
}

// Require authentication middleware (for protected routes)
function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required. Please log in.' });
  }
  next();
}

// Cache for API responses (TTL: 1 hour)
const cache = new NodeCache({ stdTTL: 3600 });
const imageCache = new NodeCache({ stdTTL: 86400 });

// Path to persistent review storage (fallback for local development)
const REVIEWS_FILE = process.env.VERCEL
  ? path.join("/tmp", "reviews.json")
  : path.join(__dirname, "reviews.json");

// In-memory cache for reviews (synced with Blob or file)
let localReviews = new Map();

// ============================================
// VERCEL BLOB REVIEW STORAGE
// ============================================
const REVIEWS_BLOB_NAME = "reviews.json";
let reviewsBlobUrl = null; // Cache the blob URL for deletion

// Load reviews from Vercel Blob or file
async function loadReviewsAsync() {
  if (USE_VERCEL_BLOB) {
    try {
      console.log('[BLOB] Loading reviews from Vercel Blob...');
      // List blobs to find our reviews file
      const { blobs } = await list({ prefix: REVIEWS_BLOB_NAME });
      console.log(`[BLOB] Found ${blobs.length} blobs with prefix "${REVIEWS_BLOB_NAME}":`, blobs.map(b => ({ pathname: b.pathname, url: b.url })));

      // Find blob - try exact match first, then includes
      let reviewsBlob = blobs.find(b => b.pathname === REVIEWS_BLOB_NAME);
      if (!reviewsBlob && blobs.length > 0) {
        reviewsBlob = blobs.find(b => b.pathname.includes(REVIEWS_BLOB_NAME));
      }

      if (reviewsBlob) {
        reviewsBlobUrl = reviewsBlob.url;
        console.log(`[BLOB] Found reviews blob at ${reviewsBlob.url}`);
        // Fetch the blob content with cache-busting to avoid stale data
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
          console.log(`[BLOB] Fetched content (${text.length} chars)`);
          if (text.trim()) {
            const data = JSON.parse(text);
            if (Array.isArray(data)) {
              localReviews = new Map(data);
              console.log(`[BLOB] Loaded ${localReviews.size} business review sets from Vercel Blob`);
              return;
            }
          }
        } else {
          console.error(`[BLOB] Failed to fetch blob: ${response.status} ${response.statusText}`);
        }
      }
      console.log('[BLOB] No reviews found in Vercel Blob, starting fresh');
    } catch (error) {
      console.error('[BLOB] Error loading reviews from Vercel Blob:', error.message, error.stack);
    }
  }

  // Fallback to file-based storage
  try {
    if (fs.existsSync(REVIEWS_FILE)) {
      const data = fs.readFileSync(REVIEWS_FILE, "utf8");
      localReviews = new Map(JSON.parse(data));
      console.log(`[FILE] Loaded ${localReviews.size} business review sets from file`);
    }
  } catch (error) {
    console.error("[FILE] Error loading reviews:", error);
  }
}

// Save reviews to Vercel Blob or file
async function saveReviewsAsync() {
  const data = Array.from(localReviews.entries());
  const jsonData = JSON.stringify(data);
  console.log(`[SAVE] Preparing to save ${localReviews.size} business review sets (${jsonData.length} chars)`);

  if (USE_VERCEL_BLOB) {
    try {
      // Upload new blob - addRandomSuffix: false will overwrite existing file
      // DO NOT delete before put - this causes race conditions in serverless environment
      console.log('[BLOB] Uploading new blob (will overwrite existing)...');
      const blob = await put(REVIEWS_BLOB_NAME, jsonData, {
        access: 'public',
        contentType: 'application/json',
        addRandomSuffix: false
      });
      reviewsBlobUrl = blob.url;
      console.log(`[BLOB] Saved ${localReviews.size} business review sets to Vercel Blob at ${blob.url}`);
      console.log(`[BLOB] Data saved: ${jsonData.substring(0, 200)}${jsonData.length > 200 ? '...' : ''}`);
      return true;
    } catch (error) {
      console.error('[BLOB] Error saving reviews to Vercel Blob:', error.message, error.stack);
      // Fall through to file backup
    }
  }

  // Fallback to file-based storage
  try {
    fs.writeFileSync(REVIEWS_FILE, jsonData, "utf8");
    console.log(`[FILE] Saved ${localReviews.size} business review sets to file`);
    return true;
  } catch (error) {
    console.error("[FILE] Error saving reviews:", error);
    return false;
  }
}

// Lightweight refresh from Blob - used to get latest reviews on single business requests
async function refreshReviewsFromBlob() {
  if (!USE_VERCEL_BLOB) {
    console.log('[BLOB] Skipping refresh - USE_VERCEL_BLOB is false');
    return;
  }

  try {
    const { blobs } = await list({ prefix: REVIEWS_BLOB_NAME });
    console.log(`[BLOB] Found ${blobs.length} blobs with prefix "${REVIEWS_BLOB_NAME}"`);

    const reviewsBlob = blobs.find(b => b.pathname === REVIEWS_BLOB_NAME) ||
                        blobs.find(b => b.pathname.includes(REVIEWS_BLOB_NAME));

    if (reviewsBlob) {
      console.log(`[BLOB] Fetching from ${reviewsBlob.url}`);
      // Add cache-busting to avoid stale data
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
          const data = JSON.parse(text);
          if (Array.isArray(data)) {
            localReviews = new Map(data);
            reviewsBlobUrl = reviewsBlob.url;
            console.log(`[BLOB] Refreshed ${localReviews.size} business review sets`);
            // Log a sample of the data for debugging
            if (localReviews.size > 0) {
              const firstEntry = localReviews.entries().next().value;
              if (firstEntry) {
                const [bizId, reviews] = firstEntry;
                console.log(`[BLOB] Sample: business ${bizId} has ${reviews.length} reviews`);
                if (reviews.length > 0 && reviews[0].userId) {
                  console.log(`[BLOB] First review userId: ${reviews[0].userId}`);
                }
              }
            }
          } else {
            console.log('[BLOB] Data is not an array:', typeof data);
          }
        } else {
          console.log('[BLOB] Blob content is empty');
        }
      } else {
        console.log(`[BLOB] Failed to fetch blob: ${response.status}`);
      }
    } else {
      console.log('[BLOB] No reviews blob found');
    }
  } catch (error) {
    console.error('[BLOB] Error refreshing reviews:', error.message, error.stack);
  }
}

// Synchronous fallback for initial load (file only)
function loadReviewsSync() {
  try {
    if (fs.existsSync(REVIEWS_FILE)) {
      const data = fs.readFileSync(REVIEWS_FILE, "utf8");
      return new Map(JSON.parse(data));
    }
  } catch (error) {
    console.error("Error loading reviews:", error);
  }
  return new Map();
}

// Initialize reviews - sync for startup, async load follows
localReviews = loadReviewsSync();

// Track blob loading state
let blobLoadPromise = null;
let blobLoaded = false;

// Load from Blob asynchronously after startup
if (USE_VERCEL_BLOB) {
  blobLoadPromise = loadReviewsAsync()
    .then(() => {
      blobLoaded = true;
      console.log('[BLOB] Reviews loaded and ready');
    })
    .catch(err => {
      console.error('[BLOB] Async load failed:', err);
      blobLoaded = true; // Mark as loaded even on failure to not block forever
    });
}

// Middleware to ensure reviews are loaded before serving requests
async function ensureReviewsLoaded(req, res, next) {
  if (USE_VERCEL_BLOB && !blobLoaded && blobLoadPromise) {
    console.log('[BLOB] Waiting for reviews to load...');
    await blobLoadPromise;
  }
  next();
}

// ============================================
// REVIEW SEEDING SYSTEM
// ============================================

// Pool of fake usernames for seeded reviews
const FAKE_USERNAMES = [
  "mike_j", "sarah2024", "localfoodie", "happycustomer", "johns_review",
  "emily_k", "davidm_88", "jess.thomas", "chris_local", "amanda_reviews",
  "kevin.smith", "lisa_marie", "jason_t", "megan_w", "ryan.p",
  "nicole_g", "brian_h", "ashley_c", "matt_d", "jennifer_l",
  "alex_m", "samantha_r", "tyler_b", "stephanie_f", "andrew_n",
  "rachel_s", "daniel_j", "lauren_a", "josh_k", "heather_m",
  "cumminglocal", "forsythfan", "ga_reviewer", "atl_foodie", "northga_local",
  "weekend_explorer", "family_diner", "quality_seeker", "deal_hunter", "new_resident"
];

// Pool of positive comments
const POSITIVE_COMMENTS = [
  "Service was great!",
  "Will definitely come back!",
  "Exceeded my expectations.",
  "Staff was super friendly and helpful.",
  "Great value for the price.",
  "Highly recommend this place!",
  "Clean and welcoming atmosphere.",
  "Quick and efficient service.",
  "Best in the area!",
  "Never disappoints.",
  "Amazing experience overall.",
  "Top notch quality!",
  "Very impressed with everything.",
  "Fantastic place, highly recommend.",
  "Outstanding service from start to finish.",
  "Love this place!",
  "Always a pleasure coming here.",
  "Exceeded all expectations.",
  "Five stars all the way!",
  "Would recommend to friends and family."
];

// Pool of negative comments
const NEGATIVE_COMMENTS = [
  "Could be better.",
  "Long wait times.",
  "Not worth the price.",
  "Staff seemed disinterested.",
  "Place could use some cleaning.",
  "Wouldn't recommend.",
  "Very disappointing experience.",
  "Expected more based on reviews.",
  "Not my favorite place.",
  "Had better experiences elsewhere."
];

// Determine the quality tier for a business (determines overall rating distribution)
// This creates a more realistic distribution:
// - 18% standouts (4.5+ avg rating)
// - 67% average (3.5-4.5 avg rating)
// - 15% underperformers (below 3.5 avg rating)
function determineBusinessQualityTier(businessId) {
  // Use business ID hash for consistent tier assignment
  const hash = businessId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const tierRoll = (hash % 100) / 100;

  if (tierRoll < 0.15) {
    return 'underperformer'; // 15% - avg rating will be 2.5-3.4
  } else if (tierRoll < 0.82) {
    return 'average'; // 67% - avg rating will be 3.5-4.4
  } else {
    return 'standout'; // 18% - avg rating will be 4.5-5.0
  }
}

// Generate a rating for a review based on business quality tier
function generateRatingForTier(tier) {
  const rand = Math.random();

  if (tier === 'standout') {
    // Standout businesses: mostly 4-5 stars
    if (rand < 0.05) return 3; // 5% get 3 stars
    if (rand < 0.30) return 4; // 25% get 4 stars
    return 5; // 70% get 5 stars
  } else if (tier === 'underperformer') {
    // Underperforming businesses: mostly 1-3 stars
    if (rand < 0.25) return 1; // 25% get 1 star
    if (rand < 0.50) return 2; // 25% get 2 stars
    if (rand < 0.80) return 3; // 30% get 3 stars
    if (rand < 0.95) return 4; // 15% get 4 stars
    return 5; // 5% get 5 stars
  } else {
    // Average businesses: bell curve around 3.5-4
    if (rand < 0.08) return 2; // 8% get 2 stars
    if (rand < 0.25) return 3; // 17% get 3 stars
    if (rand < 0.70) return 4; // 45% get 4 stars
    return 5; // 30% get 5 stars
  }
}

// Generate category ratings with more natural variance
// Different categories can have different strengths/weaknesses
function generateCategoryRatings(overallRating, businessId) {
  // Use business ID to create consistent category "personality"
  const hash = businessId.split('').reduce((acc, char, idx) => acc + char.charCodeAt(0) * (idx + 1), 0);

  // Determine which categories this business excels at or struggles with
  const categoryOffsets = {
    quality: ((hash % 7) - 3) * 0.3, // -0.9 to +0.9 offset
    service: (((hash * 3) % 7) - 3) * 0.3,
    cleanliness: (((hash * 7) % 7) - 3) * 0.3,
    atmosphere: (((hash * 11) % 7) - 3) * 0.3
  };

  // Generate each category with variance and business personality
  const generateCategory = (offset) => {
    const base = overallRating + offset;
    const variance = (Math.random() - 0.5) * 1.5; // +/- 0.75 random variance
    const rating = Math.round(base + variance);
    return Math.max(1, Math.min(5, rating));
  };

  return {
    quality: generateCategory(categoryOffsets.quality),
    service: generateCategory(categoryOffsets.service),
    cleanliness: generateCategory(categoryOffsets.cleanliness),
    atmosphere: generateCategory(categoryOffsets.atmosphere)
  };
}

// Generate a random date within the last 2 years
function generateRandomDate() {
  const now = new Date();
  const twoYearsAgo = new Date(now.getFullYear() - 2, now.getMonth(), now.getDate());
  const randomTime = twoYearsAgo.getTime() + Math.random() * (now.getTime() - twoYearsAgo.getTime());
  return new Date(randomTime).toISOString();
}

// Select a comment based on rating (40% none, 45% positive, 15% negative for low ratings)
function selectComment(rating) {
  const rand = Math.random();

  // 40% chance of no comment
  if (rand < 0.40) {
    return "";
  }

  // For low ratings (1-2), mostly negative comments
  if (rating <= 2) {
    if (rand < 0.85) {
      return NEGATIVE_COMMENTS[Math.floor(Math.random() * NEGATIVE_COMMENTS.length)];
    } else {
      return POSITIVE_COMMENTS[Math.floor(Math.random() * POSITIVE_COMMENTS.length)];
    }
  }

  // For medium-high ratings (3-5), mostly positive comments
  if (rand < 0.95) {
    return POSITIVE_COMMENTS[Math.floor(Math.random() * POSITIVE_COMMENTS.length)];
  } else {
    return NEGATIVE_COMMENTS[Math.floor(Math.random() * NEGATIVE_COMMENTS.length)];
  }
}

// Generate reviews for a single business with tier-based rating distribution
function generateReviewsForBusiness(businessId, count) {
  const reviews = [];
  const tier = determineBusinessQualityTier(businessId);

  for (let i = 0; i < count; i++) {
    const rating = generateRatingForTier(tier);
    const isAnonymous = Math.random() < 0.15; // 15% anonymous
    const author = isAnonymous ? "Anonymous" : FAKE_USERNAMES[Math.floor(Math.random() * FAKE_USERNAMES.length)];
    const categoryRatings = generateCategoryRatings(rating, businessId);

    reviews.push({
      id: crypto.randomUUID(),
      userId: `seed-user-${Math.floor(Math.random() * 1000)}`,
      author,
      isAnonymous,
      rating,
      comment: selectComment(rating),
      date: generateRandomDate(),
      helpful: Math.floor(Math.random() * 20), // 0-19 helpful votes
      upvotedBy: [],
      source: 'seed',
      // Category ratings with natural variance per business
      quality: categoryRatings.quality,
      service: categoryRatings.service,
      cleanliness: categoryRatings.cleanliness,
      atmosphere: categoryRatings.atmosphere
    });
  }

  // Sort by date (newest first)
  reviews.sort((a, b) => new Date(b.date) - new Date(a.date));

  return reviews;
}

// SEEDING DISABLED - Review seeding function preserved but disabled
// This function is kept for reference but will not execute to preserve blob usage limits
async function seedReviewsIfEmpty() {
  // SEEDING PERMANENTLY DISABLED
  // Existing review data is already in Vercel Blob storage
  // To prevent accidental writes, this function now returns immediately
  console.log('[SEED] seedReviewsIfEmpty called but SEEDING IS DISABLED - no action taken');
  return false;
}

// Track seeding state
let seedingPromise = null;
let seedingComplete = false;

// Store verification challenges in memory
const verificationChallenges = new Map();

// ============================================
// VERCEL BLOB BUSINESS STORAGE (for favorites persistence)
// ============================================
const BUSINESSES_BLOB_NAME = "businesses.json";
let businessesBlobUrl = null;

// In-memory storage for all seen businesses (ensures favorites never disappear)
let persistentBusinesses = new Map();

// Load businesses from Vercel Blob or file
async function loadBusinessesFromBlob() {
  if (USE_VERCEL_BLOB) {
    try {
      console.log('[BLOB] Loading businesses from Vercel Blob...');
      const { blobs } = await list({ prefix: BUSINESSES_BLOB_NAME });

      let businessesBlob = blobs.find(b => b.pathname === BUSINESSES_BLOB_NAME);
      if (!businessesBlob && blobs.length > 0) {
        businessesBlob = blobs.find(b => b.pathname.includes(BUSINESSES_BLOB_NAME));
      }

      if (businessesBlob) {
        businessesBlobUrl = businessesBlob.url;
        console.log(`[BLOB] Found businesses blob at ${businessesBlob.url}`);
        const response = await fetch(businessesBlob.url);
        if (response.ok) {
          const text = await response.text();
          if (text.trim()) {
            const data = JSON.parse(text);
            if (Array.isArray(data)) {
              persistentBusinesses = new Map(data);
              console.log(`[BLOB] Loaded ${persistentBusinesses.size} businesses from Vercel Blob`);
              return;
            }
          }
        }
      }
      console.log('[BLOB] No businesses found in Vercel Blob, starting fresh');
    } catch (error) {
      console.error('[BLOB] Error loading businesses from Vercel Blob:', error.message);
    }
  }

  // Fallback to file-based storage
  const BUSINESSES_FILE = process.env.VERCEL
    ? path.join("/tmp", "businesses.json")
    : path.join(__dirname, "businesses.json");

  try {
    if (fs.existsSync(BUSINESSES_FILE)) {
      const data = fs.readFileSync(BUSINESSES_FILE, "utf8");
      persistentBusinesses = new Map(JSON.parse(data));
      console.log(`[FILE] Loaded ${persistentBusinesses.size} businesses from file`);
    }
  } catch (error) {
    console.error("[FILE] Error loading businesses:", error);
  }
}

// Save businesses to Vercel Blob or file
async function saveBusinessesToBlob() {
  const data = Array.from(persistentBusinesses.entries());
  const jsonData = JSON.stringify(data);
  console.log(`[SAVE] Saving ${persistentBusinesses.size} businesses (${jsonData.length} chars)`);

  if (USE_VERCEL_BLOB) {
    try {
      const blob = await put(BUSINESSES_BLOB_NAME, jsonData, {
        access: 'public',
        contentType: 'application/json',
        addRandomSuffix: false
      });
      businessesBlobUrl = blob.url;
      console.log(`[BLOB] Saved ${persistentBusinesses.size} businesses to Vercel Blob`);
      return true;
    } catch (error) {
      console.error('[BLOB] Error saving businesses to Vercel Blob:', error.message);
    }
  }

  // Fallback to file-based storage
  const BUSINESSES_FILE = process.env.VERCEL
    ? path.join("/tmp", "businesses.json")
    : path.join(__dirname, "businesses.json");

  try {
    fs.writeFileSync(BUSINESSES_FILE, jsonData, "utf8");
    console.log(`[FILE] Saved ${persistentBusinesses.size} businesses to file`);
    return true;
  } catch (error) {
    console.error("[FILE] Error saving businesses:", error);
    return false;
  }
}

// Track business blob loading state
let businessBlobLoadPromise = null;
let businessBlobLoaded = false;

// Load businesses from Blob asynchronously after startup
if (USE_VERCEL_BLOB || !process.env.VERCEL) {
  businessBlobLoadPromise = loadBusinessesFromBlob()
    .then(() => {
      businessBlobLoaded = true;
      console.log('[BLOB] Businesses loaded and ready');
    })
    .catch(err => {
      console.error('[BLOB] Async business load failed:', err);
      businessBlobLoaded = true;
    });
}

// Cumming, Georgia coordinates and search radius
const CUMMING_GA_LAT = 34.2073;
const CUMMING_GA_LON = -84.1402;
const SEARCH_RADIUS_METERS = 24140; // 15 miles in meters

// API Configuration
const YELP_API_BASE_URL = "https://api.yelp.com/v3";
const YELP_API_KEY = process.env.YELP_API_KEY;
const GOOGLE_SEARCH_API_KEY = process.env.GOOGLE_SEARCH_API_KEY;
const GOOGLE_SEARCH_ENGINE_ID = process.env.GOOGLE_SEARCH_ENGINE_ID;

// reCAPTCHA configuration
const RECAPTCHA_SECRET_KEY = process.env.RECAPTCHA_SECRET_KEY;
const RECAPTCHA_ENABLED = !!RECAPTCHA_SECRET_KEY;

// Verify reCAPTCHA token with Google
async function verifyRecaptcha(token) {
  if (!RECAPTCHA_ENABLED) {
    return { success: true, fallback: true };
  }

  try {
    const response = await axios.post(
      'https://www.google.com/recaptcha/api/siteverify',
      null,
      {
        params: {
          secret: RECAPTCHA_SECRET_KEY,
          response: token
        }
      }
    );
    return response.data;
  } catch (error) {
    console.error('reCAPTCHA verification error:', error.message);
    return { success: false, error: 'Verification failed.' };
  }
}

const app = express();
app.use(cors());
app.use(express.json());

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  console.log(`[REQ] ${req.method} ${req.path}`);
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[RES] ${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`);
  });
  next();
});

// Ensure reviews are loaded from Blob before handling business/review requests
app.use('/api/businesses', ensureReviewsLoaded);
app.use('/api/reviews', ensureReviewsLoaded);
app.use('/api/recommendations', ensureReviewsLoaded);
app.use('/api/analytics', ensureReviewsLoaded);
app.use('/api/auth', ensureUsersLoaded);

// Apply authentication middleware globally (but don't require it)
app.use(authenticateToken);

// ====================
// HELPER FUNCTIONS
// ====================

// Category mapping for Yelp categories
const CATEGORY_ALIASES = {
  Food: [
    "restaurants", "food", "cafes", "coffee", "bakeries", "desserts", "bars",
    "icecream", "pizza", "mexican", "italian", "chinese", "japanese", "thai",
    "vietnamese", "korean", "indian", "mediterranean", "greek", "american",
    "southern", "bbq", "seafood", "sushi", "burgers", "sandwiches", "delis",
    "breakfast_brunch", "brunch", "diners", "steakhouses", "tacos", "tex-mex",
    "fastfood", "hotdogs", "chicken_wings", "chickenshop", "sportsbars", "pubs",
    "cocktailbars", "breweries", "juicebars", "bubbletea", "tea", "donuts",
    "bagels", "gelato", "froyo", "candy", "chocolate", "foodtrucks", "cajun",
    "soulfood", "waffles", "pancakes", "cuban", "latin", "caribbean", "asianfusion"
  ],
  Retail: [
    "shopping", "fashion", "departmentstores", "grocery", "bookstores",
    "giftshops", "electronics", "furniture", "homeandgarden", "jewelry",
    "sportinggoods", "toys", "pets", "flowers", "cosmetics",
    "clothingstore", "shoes", "hardware", "appliances", "electronicsrepair",
    "thrift_stores", "antiques", "hobbyshops", "sportgoods"
  ],
  Services: [
    "localservices", "homeservices", "auto", "health", "beautysvc", "fitness",
    "education", "professional", "financialservices", "realestate", "eventservices",
    "petservices", "automotive", "hairsalons", "spas", "gyms", "yoga", "dentists",
    "doctors", "veterinarians",
    "barbershops", "autorepair", "autoglass", "oilchange", "carwash",
    "drycleaninglaundry", "fitnesstrainers", "massage", "nailsalons", "skincare",
    "pet_sitting", "petgroomers", "tutoring", "testprep", "musiclessons",
    "homecleaning", "handyman", "plumbing", "electricians", "hvac", "locksmiths",
    "movers", "notaries", "accountants", "lawyers", "taxservices", "print",
    "shipping_centers", "itservices", "computerrepair"
  ]
};

// Categories to exclude
const EXCLUDED_YELP_CATEGORIES = [
  "parks", "playgrounds", "dog_parks", "publicservicesgovt", "landmarks",
  "hiking", "beaches", "lakes", "campgrounds", "publicgardens",
  "communitycenters", "libraries", "museums", "religiousorgs", "churches"
];

function mapYelpCategoriesToCategory(categories = []) {
  const aliases = categories.map(cat => cat.alias);

  if (aliases.some(alias => EXCLUDED_YELP_CATEGORIES.includes(alias))) {
    return "Excluded";
  }

  if (aliases.some(alias => CATEGORY_ALIASES.Food.includes(alias))) return "Food";
  if (aliases.some(alias => CATEGORY_ALIASES.Retail.includes(alias))) return "Retail";
  if (aliases.some(alias => CATEGORY_ALIASES.Services.includes(alias))) return "Services";

  // Check titles for food-related keywords
  const titles = categories.map(cat => (cat.title || '').toLowerCase());
  const foodKeywords = ['restaurant', 'food', 'cafe', 'diner', 'grill', 'kitchen',
    'eatery', 'bistro', 'bar', 'pub', 'pizza', 'burger', 'taco', 'sushi', 'bbq',
    'bakery', 'coffee', 'tea', 'ice cream', 'dessert', 'breakfast', 'brunch'];

  if (titles.some(title => foodKeywords.some(keyword => title.includes(keyword)))) {
    return "Food";
  }

  return "Services";
}

function isExcludedYelpBusiness(categories = []) {
  const aliases = categories.map(cat => cat.alias);
  return aliases.some(alias => EXCLUDED_YELP_CATEGORIES.includes(alias));
}

// Generate mock deals for demo
function getMockDeal(category, name) {
  const dealsByCategory = {
    Food: [
      "10% off lunch orders before 2 PM",
      "Buy 1 entrée, get a dessert free",
      "Free drink with any combo meal",
      "Happy hour: 20% off appetizers",
      "Family meal deal: $5 off"
    ],
    Retail: [
      "15% off your first purchase",
      "BOGO 50% off select items",
      "Free gift wrapping today",
      "Spend $50, get $10 off",
      "Student discount: 10% off"
    ],
    Services: [
      "First-time customer: 15% off",
      "Free consultation this week",
      "Refer a friend, both get $10 off",
      "Bundle service: save 20%",
      "Seasonal special: $25 off"
    ]
  };

  const seed = crypto.createHash("md5").update(`${category}-${name}`).digest("hex");
  const roll = parseInt(seed.slice(0, 2), 16);

  if (roll % 5 !== 0) return null;

  const options = dealsByCategory[category] || dealsByCategory.Services;
  return options[roll % options.length];
}

// Detect chain businesses
function isChainBusiness(name) {
  if (!name) return false;
  const nameLower = name.toLowerCase();
  const chainKeywords = [
    'walmart', 'target', 'costco', 'publix', 'kroger', 'whole foods',
    'cvs', 'walgreens', 'rite aid', 'dollar general', 'dollar tree',
    'mcdonald', 'burger king', 'wendy', 'taco bell', 'kfc', 'subway',
    'starbucks', 'dunkin', 'chick-fil-a', 'chipotle', 'panera',
    'home depot', 'lowe', 'best buy', 'petsmart', 'petco',
    'shell', 'chevron', 'exxon', 'bp', 'mobil', '7-eleven', 'wawa'
  ];
  return chainKeywords.some(keyword => nameLower.includes(keyword));
}

// Calculate relevancy score
function calculateRelevancyScore(name, yelpReviewCount) {
  let score = 50;

  if (isChainBusiness(name)) score -= 40;

  // Smaller businesses get bonus
  if (yelpReviewCount < 50) score += 15;
  else if (yelpReviewCount < 100) score += 10;
  else if (yelpReviewCount > 500) score -= 10;

  // Local-sounding names get bonus
  const nameLower = (name || '').toLowerCase();
  const localKeywords = ['family', 'local', 'hometown', 'mom', 'pop', '& son', 'brothers'];
  if (localKeywords.some(k => nameLower.includes(k))) score += 25;

  // Personal names get bonus (Joe's, Maria's, etc.)
  if (nameLower.match(/\w+'s\s/) || nameLower.match(/^[a-z]+'s/i)) score += 20;

  return score;
}

function getLocalReviewSummary(id) {
  const localReviewsList = localReviews.get(id) || [];
  const visibleReviews = localReviewsList.filter(r => !r.hidden);
  const reviewCount = visibleReviews.length;
  const rating = reviewCount > 0
    ? visibleReviews.reduce((sum, review) => sum + review.rating, 0) / reviewCount
    : 0;

  // Calculate aggregate category ratings (only if 10+ reviews)
  let categoryRatings = null;
  if (reviewCount >= 10) {
    // Support both old 'foodQuality' and new 'quality' field names
    const reviewsWithCategories = visibleReviews.filter(r =>
      r.quality || r.foodQuality || r.service || r.cleanliness || r.atmosphere
    );

    if (reviewsWithCategories.length >= 5) {
      const totals = { quality: 0, service: 0, cleanliness: 0, atmosphere: 0 };
      const counts = { quality: 0, service: 0, cleanliness: 0, atmosphere: 0 };

      reviewsWithCategories.forEach(r => {
        // Support both old 'foodQuality' and new 'quality' field
        const qualityRating = r.quality || r.foodQuality;
        if (qualityRating) { totals.quality += qualityRating; counts.quality++; }
        if (r.service) { totals.service += r.service; counts.service++; }
        if (r.cleanliness) { totals.cleanliness += r.cleanliness; counts.cleanliness++; }
        if (r.atmosphere) { totals.atmosphere += r.atmosphere; counts.atmosphere++; }
      });

      categoryRatings = {
        quality: counts.quality > 0 ? Math.round((totals.quality / counts.quality) * 10) / 10 : null,
        service: counts.service > 0 ? Math.round((totals.service / counts.service) * 10) / 10 : null,
        cleanliness: counts.cleanliness > 0 ? Math.round((totals.cleanliness / counts.cleanliness) * 10) / 10 : null,
        atmosphere: counts.atmosphere > 0 ? Math.round((totals.atmosphere / counts.atmosphere) * 10) / 10 : null,
        reviewsWithRatings: reviewsWithCategories.length
      };
    }
  }

  return { reviewCount, rating, reviews: [...visibleReviews], categoryRatings };
}

// Get fallback image by category
function getCategoryImage(category) {
  const images = {
    Food: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=400',
    Retail: 'https://images.unsplash.com/photo-1472851294608-062f824d29cc?w=400',
    Services: 'https://images.unsplash.com/photo-1581092918056-0c4c3acd3789?w=400'
  };
  return images[category] || images.Services;
}

// Fetch Google Image as fallback
async function fetchGoogleImage(query) {
  if (!GOOGLE_SEARCH_API_KEY || !GOOGLE_SEARCH_ENGINE_ID || !query) return null;

  const cached = imageCache.get(query);
  if (cached) return cached;

  try {
    const response = await axios.get("https://www.googleapis.com/customsearch/v1", {
      params: {
        key: GOOGLE_SEARCH_API_KEY,
        cx: GOOGLE_SEARCH_ENGINE_ID,
        q: query,
        searchType: "image",
        num: 1,
        safe: "active"
      },
      timeout: 10000
    });

    const result = response.data?.items?.[0]?.link || null;
    if (result) imageCache.set(query, result);
    return result;
  } catch (error) {
    console.error("Error fetching Google image:", error.message);
    return null;
  }
}

// Build a meaningful, natural-sounding description from available Yelp data
function buildBusinessDescription(yelpBusiness, category) {
  const categoryLabels = (yelpBusiness.categories || [])
    .map(c => c.title)
    .filter(Boolean)
    .slice(0, 3);

  if (categoryLabels.length === 0) {
    return null; // No description available
  }

  const name = yelpBusiness.name || "This business";
  const locationText = yelpBusiness.location?.city || "Cumming";
  const transactions = yelpBusiness.transactions || [];
  const rating = yelpBusiness.rating;
  const price = yelpBusiness.price;

  // Determine business type descriptor
  const primaryCategory = categoryLabels[0].toLowerCase();
  let businessType = "establishment";
  if (primaryCategory.includes("restaurant") || primaryCategory.includes("food") ||
      primaryCategory.includes("cuisine") || primaryCategory.includes("grill") ||
      primaryCategory.includes("café") || primaryCategory.includes("cafe")) {
    businessType = "restaurant";
  } else if (primaryCategory.includes("bar") || primaryCategory.includes("pub") ||
             primaryCategory.includes("brewery") || primaryCategory.includes("lounge")) {
    businessType = "bar";
  } else if (primaryCategory.includes("coffee") || primaryCategory.includes("tea") ||
             primaryCategory.includes("bakery") || primaryCategory.includes("dessert")) {
    businessType = "café";
  } else if (primaryCategory.includes("salon") || primaryCategory.includes("spa") ||
             primaryCategory.includes("beauty") || primaryCategory.includes("nail")) {
    businessType = "salon";
  } else if (primaryCategory.includes("auto") || primaryCategory.includes("car") ||
             primaryCategory.includes("mechanic") || primaryCategory.includes("tire")) {
    businessType = "auto service center";
  } else if (primaryCategory.includes("gym") || primaryCategory.includes("fitness") ||
             primaryCategory.includes("yoga") || primaryCategory.includes("crossfit")) {
    businessType = "fitness center";
  } else if (primaryCategory.includes("clean") || primaryCategory.includes("laundry") ||
             primaryCategory.includes("dry")) {
    businessType = "cleaning service";
  }

  // Build specialty text from categories
  const specialties = categoryLabels.slice(0, 2).join(" and ");

  // Price level description
  let priceDesc = "";
  if (price === "$") priceDesc = "budget-friendly";
  else if (price === "$$") priceDesc = "moderately priced";
  else if (price === "$$$") priceDesc = "upscale";
  else if (price === "$$$$") priceDesc = "fine dining";

  // Service options
  let serviceOptions = [];
  if (transactions.includes("delivery")) serviceOptions.push("delivery");
  if (transactions.includes("pickup")) serviceOptions.push("pickup");
  if (transactions.includes("restaurant_reservation")) serviceOptions.push("reservations");

  // Rating-based quality phrases
  let qualityPhrase = "";
  if (rating >= 4.5) qualityPhrase = "highly acclaimed";
  else if (rating >= 4.0) qualityPhrase = "well-regarded";
  else if (rating >= 3.5) qualityPhrase = "popular";
  else qualityPhrase = "local";

  // Build the natural description
  let description = "";

  // Opening sentence - introduce the business
  if (businessType === "restaurant" || businessType === "café" || businessType === "bar") {
    description = `A ${qualityPhrase} ${specialties} ${businessType} serving the ${locationText} community`;
  } else {
    description = `A ${qualityPhrase} ${businessType} specializing in ${specialties} in the ${locationText} area`;
  }

  // Add price context if available
  if (priceDesc) {
    description += `, offering ${priceDesc} options`;
  }
  description += ". ";

  // Second sentence - services and reputation
  if (serviceOptions.length > 0) {
    description += `Convenient ${serviceOptions.join(" and ")} ${serviceOptions.length > 1 ? "are" : "is"} available. `;
  }

  // Closing touch based on rating
  if (rating >= 4.5) {
    description += "Known for exceptional quality and customer satisfaction.";
  } else if (rating >= 4.0) {
    description += "Customers appreciate the consistent quality and friendly service.";
  } else if (rating >= 3.5) {
    description += "A trusted choice for locals in the community.";
  } else {
    description += "Serving the local community with dedication.";
  }

  return description;
}

// Transform Yelp business to our format
function transformYelpToBusiness(yelpBusiness) {
  if (isExcludedYelpBusiness(yelpBusiness.categories)) return null;

  const category = mapYelpCategoriesToCategory(yelpBusiness.categories);
  if (category === "Excluded") return null;

  const id = `yelp-${yelpBusiness.id}`;
  const name = yelpBusiness.name;
  const address = yelpBusiness.location?.display_address?.join(", ") || "Cumming, GA";
  const tags = (yelpBusiness.categories || []).map(cat => cat.title).filter(Boolean).slice(0, 5);

  const localReviewSummary = getLocalReviewSummary(id);
  const relevancyScore = calculateRelevancyScore(name, yelpBusiness.review_count || 0);

  const lat = yelpBusiness.coordinates?.latitude;
  const lon = yelpBusiness.coordinates?.longitude;
  const googleMapsUrl = lat && lon
    ? `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name + ' ' + address)}`;

  // Build a more informative description
  const description = buildBusinessDescription(yelpBusiness, category);

  return {
    id,
    yelpId: yelpBusiness.id,
    name,
    category,
    rating: localReviewSummary.rating,
    reviewCount: localReviewSummary.reviewCount,
    yelpRating: yelpBusiness.rating,
    yelpReviewCount: yelpBusiness.review_count,
    description,
    address,
    phone: yelpBusiness.display_phone || "Phone not available",
    hours: "Hours available on business page",
    image: yelpBusiness.image_url || null, // Will be filled with Google Image if null
    deal: getMockDeal(category, name),
    tags,
    priceRange: yelpBusiness.price || "$$",
    website: yelpBusiness.url,
    isOpenNow: yelpBusiness.is_closed === false ? true : undefined,
    googleMapsUrl,
    lat,
    lon,
    reviews: localReviewSummary.reviews,
    relevancyScore,
    isChain: isChainBusiness(name)
  };
}

// Fetch businesses from Yelp with persistent storage (ensures favorites never disappear)
async function fetchYelpBusinesses() {
  // Wait for persistent businesses to load first
  if (businessBlobLoadPromise && !businessBlobLoaded) {
    console.log('[YELP] Waiting for persistent businesses to load...');
    await businessBlobLoadPromise;
  }

  if (!YELP_API_KEY) {
    console.log("[YELP] API key not set. Cannot fetch businesses.");
    // Return persistent businesses if available
    if (persistentBusinesses.size > 0) {
      console.log(`[YELP] Returning ${persistentBusinesses.size} persistent businesses`);
      return Array.from(persistentBusinesses.values());
    }
    return [];
  }

  const cacheKey = `yelp:${CUMMING_GA_LAT}:${CUMMING_GA_LON}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log('[YELP] Returning cached results');
    return cached;
  }

  console.log("[YELP] Fetching businesses from Yelp API...");
  const results = [];
  const limit = 50;
  const maxOffset = 200; // Stay well under Yelp's 240 limit

  try {
    for (let offset = 0; offset < maxOffset; offset += limit) {
      console.log(`[YELP] Fetching offset ${offset}...`);
      const response = await axios.get(`${YELP_API_BASE_URL}/businesses/search`, {
        headers: { Authorization: `Bearer ${YELP_API_KEY}` },
        params: {
          latitude: CUMMING_GA_LAT,
          longitude: CUMMING_GA_LON,
          radius: SEARCH_RADIUS_METERS,
          limit,
          offset,
          sort_by: "best_match"
        },
        timeout: 15000
      });

      const businesses = response.data.businesses || [];
      results.push(...businesses);
      console.log(`[YELP] Got ${businesses.length} businesses at offset ${offset}`);

      if (businesses.length < limit) break;
    }

    console.log(`[YELP] Successfully fetched ${results.length} total businesses from API`);

    // Transform and filter new results
    const transformed = results
      .map(transformYelpToBusiness)
      .filter(biz => biz !== null);

    // Merge with persistent storage - add new businesses, update existing, NEVER remove
    const previousSize = persistentBusinesses.size;
    let newCount = 0;
    let updatedCount = 0;

    for (const biz of transformed) {
      if (!persistentBusinesses.has(biz.id)) {
        newCount++;
      } else {
        updatedCount++;
      }
      // Always update to get latest data (ratings, etc.)
      persistentBusinesses.set(biz.id, biz);
    }

    console.log(`[YELP] Merged: ${newCount} new, ${updatedCount} updated, ${persistentBusinesses.size} total (was ${previousSize})`);

    // Save new businesses to blob storage
    if (newCount > 0 || previousSize === 0) {
      saveBusinessesToBlob().catch(err => {
        console.error('[YELP] Failed to save businesses:', err.message);
      });
    }

    // Return ALL persistent businesses (ensures favorites always included)
    const allBusinesses = Array.from(persistentBusinesses.values());

    // Sort by relevancy (local businesses first), with stable secondary sort by ID
    allBusinesses.sort((a, b) => {
      const diff = b.relevancyScore - a.relevancyScore;
      return diff !== 0 ? diff : a.id.localeCompare(b.id);
    });

    cache.set(cacheKey, allBusinesses);
    return allBusinesses;

  } catch (error) {
    console.error("[YELP] Error fetching businesses:", error.message);
    if (error.response) {
      console.error("[YELP] Response status:", error.response.status);
      console.error("[YELP] Response data:", JSON.stringify(error.response.data));
    }
    // Return persistent businesses on error (ensures favorites still work)
    if (persistentBusinesses.size > 0) {
      console.log(`[YELP] Returning ${persistentBusinesses.size} persistent businesses after error`);
      return Array.from(persistentBusinesses.values());
    }
    return [];
  }
}

// Fetch detailed info for a single business
async function fetchYelpBusinessDetails(yelpId) {
  if (!YELP_API_KEY || !yelpId) return null;

  try {
    const response = await axios.get(`${YELP_API_BASE_URL}/businesses/${yelpId}`, {
      headers: { Authorization: `Bearer ${YELP_API_KEY}` },
      timeout: 15000
    });
    return response.data;
  } catch (error) {
    console.error("Error fetching Yelp business details:", error.message);
    return null;
  }
}

// Categories to import for better diversity (services and retail)
const IMPORT_CATEGORIES = [
  // Hair and Beauty - Services
  'hairsalons', 'barbershops', 'nailsalons', 'skincare', 'spas', 'massage',
  // Auto Services
  'autorepair', 'autoglass', 'oilchange', 'carwash',
  // Home Services
  'homecleaning', 'handyman', 'plumbing', 'electricians', 'hvac', 'locksmiths', 'movers',
  // Professional Services
  'accountants', 'lawyers', 'taxservices', 'notaries', 'print', 'shipping_centers',
  'itservices', 'computerrepair',
  // Health and Fitness
  'gyms', 'fitnesstrainers', 'yoga',
  // Pet Services
  'pet_sitting', 'petgroomers', 'veterinarians',
  // Education
  'tutoring', 'testprep', 'musiclessons',
  // Laundry
  'drycleaninglaundry',
  // Retail
  'bookstores', 'clothingstore', 'shoes', 'jewelry', 'giftshops', 'hardware',
  'homeandgarden', 'furniture', 'appliances', 'electronicsrepair'
];

// Multiple search locations to cast a wider net
const SEARCH_LOCATIONS = [
  { name: "Cumming, GA", latitude: 34.2073, longitude: -84.1402 },
  { name: "Alpharetta, GA", latitude: 34.0754, longitude: -84.2941 },
  { name: "Johns Creek, GA", latitude: 34.0289, longitude: -84.1986 },
  { name: "Forsyth County, GA", latitude: 34.2290, longitude: -84.1158 }
];

// Import businesses from specific Yelp categories with pagination and multi-location
async function importBusinessesByCategory(categories = IMPORT_CATEGORIES) {
  if (!YELP_API_KEY) {
    console.log("[IMPORT] API key not set. Cannot import businesses.");
    return { imported: 0, total: persistentBusinesses.size };
  }

  // Wait for persistent businesses to load first
  if (businessBlobLoadPromise && !businessBlobLoaded) {
    await businessBlobLoadPromise;
  }

  // Track existing Yelp IDs for dedup
  const existingYelpIds = new Set();
  for (const [, biz] of persistentBusinesses) {
    if (biz.yelpId) existingYelpIds.add(biz.yelpId);
  }

  console.log(`[IMPORT] Starting import for ${categories.length} categories across ${SEARCH_LOCATIONS.length} locations...`);
  console.log(`[IMPORT] ${existingYelpIds.size} existing businesses (by Yelp ID) for dedup`);
  const previousSize = persistentBusinesses.size;
  let totalFetched = 0;
  let newCount = 0;
  let duplicateCount = 0;
  const newBusinessIds = [];
  const categoryBreakdown = { Food: 0, Retail: 0, Services: 0 };

  for (const location of SEARCH_LOCATIONS) {
    console.log(`\n[IMPORT] === Location: ${location.name} ===`);

    for (const category of categories) {
      try {
        // Paginate through all results for this category+location
        const limit = 50;
        let offset = 0;
        let totalForCategory = 0;

        while (true) {
          const response = await axios.get(`${YELP_API_BASE_URL}/businesses/search`, {
            headers: { Authorization: `Bearer ${YELP_API_KEY}` },
            params: {
              latitude: location.latitude,
              longitude: location.longitude,
              radius: SEARCH_RADIUS_METERS,
              categories: category,
              limit,
              offset,
              sort_by: "best_match"
            },
            timeout: 15000
          });

          const businesses = response.data.businesses || [];
          totalFetched += businesses.length;
          totalForCategory += businesses.length;

          // Transform and add to persistent storage, checking for duplicates by Yelp ID
          for (const biz of businesses) {
            // Skip if we already have this Yelp business
            if (existingYelpIds.has(biz.id)) {
              duplicateCount++;
              continue;
            }

            const transformed = transformYelpToBusiness(biz);
            if (transformed && !persistentBusinesses.has(transformed.id)) {
              persistentBusinesses.set(transformed.id, transformed);
              existingYelpIds.add(biz.id);
              newCount++;
              newBusinessIds.push(transformed.id);
              if (categoryBreakdown[transformed.category] !== undefined) {
                categoryBreakdown[transformed.category]++;
              }
            }
          }

          // Stop if we got fewer than limit (no more results) or hit Yelp's 1000 offset cap
          if (businesses.length < limit || offset + limit >= 1000) break;
          offset += limit;

          // Rate limiting between paginated requests
          await new Promise(resolve => setTimeout(resolve, 250));
        }

        if (totalForCategory > 0) {
          console.log(`[IMPORT] ${category} @ ${location.name}: ${totalForCategory} fetched`);
        }

        // Rate limiting between categories
        await new Promise(resolve => setTimeout(resolve, 200));

      } catch (error) {
        if (error.response?.status === 429) {
          console.log(`[IMPORT] Rate limited on ${category}, waiting 2s...`);
          await new Promise(resolve => setTimeout(resolve, 2000));
        } else {
          console.error(`[IMPORT] Error fetching ${category} @ ${location.name}:`, error.message);
        }
      }
    }
  }

  console.log(`\n[IMPORT] Completed: ${totalFetched} fetched, ${newCount} new, ${duplicateCount} duplicates skipped`);
  console.log(`[IMPORT] New by category: Food=${categoryBreakdown.Food}, Retail=${categoryBreakdown.Retail}, Services=${categoryBreakdown.Services}`);
  console.log(`[IMPORT] Total businesses: ${persistentBusinesses.size} (was ${previousSize})`);

  // Save to persistent storage
  if (newCount > 0) {
    await saveBusinessesToBlob();
    console.log(`[IMPORT] Saved ${persistentBusinesses.size} businesses to storage`);
  }

  return {
    imported: newCount,
    total: persistentBusinesses.size,
    categories: categories.length,
    locations: SEARCH_LOCATIONS.length,
    duplicatesSkipped: duplicateCount,
    newBusinessIds,
    categoryBreakdown
  };
}

// Seed reviews for specific new businesses only (does not touch existing reviews)
async function seedReviewsForNewBusinesses(businessIds = []) {
  if (!businessIds.length) {
    console.log('[SEED] No new business IDs provided, skipping review seeding');
    return { seeded: 0, reviews: 0, total: localReviews.size };
  }

  console.log(`[SEED] Seeding reviews for ${businessIds.length} new businesses...`);
  let seededCount = 0;
  let totalReviews = 0;

  for (const bizId of businessIds) {
    // Skip if this business already has reviews
    const existingReviews = localReviews.get(bizId);
    if (existingReviews && existingReviews.length > 0) {
      continue;
    }

    // Generate 20-50 reviews per business
    const reviewCount = 20 + Math.floor(Math.random() * 31);
    const reviews = generateReviewsForBusiness(bizId, reviewCount);
    localReviews.set(bizId, reviews);
    seededCount++;
    totalReviews += reviewCount;
  }

  console.log(`[SEED] Seeded ${seededCount} businesses with ${totalReviews} total reviews`);

  // Save reviews to blob
  if (seededCount > 0) {
    await saveReviewsToBlob();
    console.log(`[SEED] Saved reviews to storage`);
  }

  return { seeded: seededCount, reviews: totalReviews, total: localReviews.size };
}

// Format Yelp hours
function formatYelpHours(hours = []) {
  if (!hours.length) return "Hours not available";

  const dayMap = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const ranges = hours[0]?.open || [];
  if (!ranges.length) return "Hours not available";

  return ranges
    .map(range => {
      const day = dayMap[range.day] || "";
      const start = `${range.start.slice(0, 2)}:${range.start.slice(2)}`;
      const end = `${range.end.slice(0, 2)}:${range.end.slice(2)}`;
      return `${day} ${start}-${end}`;
    })
    .join(", ");
}

// Main function to fetch businesses (Yelp API first, offline as fallback only)
async function fetchBusinesses() {
  // ONLY use offline data if explicitly in OFFLINE_MODE
  // In production, always use Yelp API
  if (OFFLINE_MODE) {
    console.log('[FETCH] Using offline data (OFFLINE_MODE=true)');
    // Apply local reviews to offline data and convert local images to URLs
    return offlineBusinesses.map(biz => {
      const localReviewSummary = getLocalReviewSummary(biz.id);
      return {
        ...biz,
        // Use local image URL if available
        image: biz.localImage
          ? `/api/images/${biz.localImage}`
          : (biz.image || getCategoryImage(biz.category)),
        rating: localReviewSummary.rating,
        reviewCount: localReviewSummary.reviewCount,
        reviews: localReviewSummary.reviews
      };
    });
  }

  // Fetch from Yelp API
  const yelpData = await fetchYelpBusinesses();

  // Only fall back to offline data if Yelp fails and we have offline data
  if (yelpData.length === 0 && offlineBusinesses.length > 0 && !YELP_API_KEY) {
    console.log('[FETCH] Yelp returned no data, falling back to offline data');
    return offlineBusinesses.map(biz => {
      const localReviewSummary = getLocalReviewSummary(biz.id);
      return {
        ...biz,
        image: biz.localImage
          ? `/api/images/${biz.localImage}`
          : (biz.image || getCategoryImage(biz.category)),
        rating: localReviewSummary.rating,
        reviewCount: localReviewSummary.reviewCount,
        reviews: localReviewSummary.reviews
      };
    });
  }

  return yelpData;
}

// Function to get offline businesses by ID (for detail view)
function getOfflineBusinessById(id) {
  const business = offlineBusinesses.find(b => b.id === id);
  if (!business) return null;

  const localReviewSummary = getLocalReviewSummary(id);
  return {
    ...business,
    // Include photos array for gallery display (use image as fallback)
    photos: business.photos || (business.image ? [business.image] : []),
    rating: localReviewSummary.rating,
    reviewCount: localReviewSummary.reviewCount,
    reviews: localReviewSummary.reviews
  };
}

// Enrich businesses without images using Google
async function enrichBusinessImages(businesses) {
  const enriched = [];
  for (const business of businesses) {
    if (business.image) {
      enriched.push(business);
      continue;
    }

    // Try Google Images as fallback
    const imageQuery = `${business.name} ${business.address || "Cumming GA"}`;
    const image = await fetchGoogleImage(imageQuery);
    enriched.push({
      ...business,
      image: image || getCategoryImage(business.category)
    });
  }
  return enriched;
}

// Generate math challenge for spam prevention
function generateChallenge() {
  const a = Math.floor(Math.random() * 10) + 1;
  const b = Math.floor(Math.random() * 10) + 1;
  const id = crypto.randomUUID();
  const answer = a + b;

  verificationChallenges.set(id, { answer, expires: Date.now() + 300000 });

  // Clean up expired challenges
  for (const [key, value] of verificationChallenges.entries()) {
    if (Date.now() > value.expires) {
      verificationChallenges.delete(key);
    }
  }

  return { id, question: `What is ${a} + ${b}?` };
}

// ====================
// API ENDPOINTS
// ====================

// Serve offline images
app.use('/api/images', express.static(OFFLINE_IMAGES_DIR));

// Health check
app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    message: "Server is healthy",
    dataSource: OFFLINE_MODE ? "Local (Offline)" : "Yelp API",
    offlineMode: OFFLINE_MODE,
    offlineDataAvailable: offlineBusinesses.length > 0,
    location: "Cumming, Georgia",
    radius: "10 miles"
  });
});

// ====================
// AUTHENTICATION ENDPOINTS
// ====================

// User signup - includes CAPTCHA verification to prevent bot registrations
app.post("/api/auth/signup", async (req, res) => {
  console.log('[AUTH] Signup request received');
  console.log('[AUTH] Request body keys:', Object.keys(req.body || {}));

  try {
    const { username, password, confirmPassword, recaptchaToken, verificationId, verificationAnswer } = req.body;
    console.log('[AUTH] Parsed fields - username:', username ? `"${username}"` : 'undefined',
                ', password:', password ? `[${password.length} chars]` : 'undefined',
                ', confirmPassword:', confirmPassword ? `[${confirmPassword.length} chars]` : 'undefined');

    // Input validation
    if (!username || typeof username !== 'string') {
      console.log('[AUTH] Validation failed: Username is required');
      return res.status(400).json({ error: 'Username is required.' });
    }

    const trimmedUsername = username.trim();
    console.log('[AUTH] Trimmed username:', `"${trimmedUsername}"`);

    // Username validation
    if (trimmedUsername.length < 3) {
      console.log('[AUTH] Validation failed: Username too short');
      return res.status(400).json({ error: 'Username must be at least 3 characters long.' });
    }
    if (trimmedUsername.length > 20) {
      console.log('[AUTH] Validation failed: Username too long');
      return res.status(400).json({ error: 'Username must be 20 characters or less.' });
    }
    if (!/^[a-zA-Z0-9_]+$/.test(trimmedUsername)) {
      console.log('[AUTH] Validation failed: Username contains invalid characters');
      return res.status(400).json({ error: 'Username can only contain letters, numbers, and underscores.' });
    }

    // Password validation
    if (!password || typeof password !== 'string') {
      console.log('[AUTH] Validation failed: Password is required');
      return res.status(400).json({ error: 'Password is required.' });
    }
    if (password.length < 6) {
      console.log('[AUTH] Validation failed: Password too short');
      return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
    }
    if (password.length > 100) {
      console.log('[AUTH] Validation failed: Password too long');
      return res.status(400).json({ error: 'Password must be 100 characters or less.' });
    }

    // Confirm password validation
    if (password !== confirmPassword) {
      console.log('[AUTH] Validation failed: Passwords do not match');
      return res.status(400).json({ error: 'Passwords do not match.' });
    }

    // CAPTCHA verification - required for signup to prevent bot registrations
    console.log(`[AUTH] reCAPTCHA enabled: ${RECAPTCHA_ENABLED}, token provided: ${!!recaptchaToken}`);

    if (RECAPTCHA_ENABLED && recaptchaToken) {
      console.log('[AUTH] Verifying reCAPTCHA token...');
      const recaptchaResult = await verifyRecaptcha(recaptchaToken);
      console.log('[AUTH] reCAPTCHA result:', JSON.stringify(recaptchaResult));
      if (!recaptchaResult.success) {
        console.log('[AUTH] reCAPTCHA verification failed:', recaptchaResult['error-codes'] || recaptchaResult.error);
        return res.status(400).json({ error: 'CAPTCHA verification failed. Please try again.' });
      }
      console.log('[AUTH] reCAPTCHA verification successful');
    } else if (verificationId && verificationAnswer) {
      // Fallback to math challenge
      console.log('[AUTH] Verifying math challenge...');
      const challenge = verificationChallenges.get(verificationId);
      if (!challenge) {
        console.log('[AUTH] Challenge expired or invalid');
        return res.status(400).json({ error: 'Verification expired. Please refresh and try again.' });
      }

      if (challenge.answer !== parseInt(verificationAnswer)) {
        console.log('[AUTH] Challenge answer incorrect');
        return res.status(400).json({ error: 'Verification failed. Please try again.' });
      }

      verificationChallenges.delete(verificationId);
      console.log('[AUTH] Math challenge verification successful');
    } else {
      // No verification provided - check if CAPTCHA is required
      if (RECAPTCHA_ENABLED) {
        console.log('[AUTH] No CAPTCHA token provided but reCAPTCHA is enabled');
        return res.status(400).json({ error: 'CAPTCHA verification is required.' });
      }
      // If reCAPTCHA is not enabled and no math challenge, we still require some verification
      console.log('[AUTH] No verification provided');
      return res.status(400).json({ error: 'Verification is required.' });
    }

    console.log('[AUTH] All validations passed, refreshing users from blob...');

    // Refresh users from blob to get latest data
    try {
      await refreshUsersFromBlob();
      console.log('[AUTH] Users refreshed, current count:', usersData.length);
    } catch (refreshError) {
      console.error('[AUTH] Error refreshing users from blob:', refreshError.message);
      // Continue anyway - use in-memory data
    }

    // Check if username already exists (case-insensitive)
    const existingUser = usersData.find(u =>
      u.username.toLowerCase() === trimmedUsername.toLowerCase()
    );
    if (existingUser) {
      console.log('[AUTH] Username already exists:', trimmedUsername);
      return res.status(409).json({ error: 'Username already exists. Please choose a different username.' });
    }

    console.log('[AUTH] Username available, hashing password...');

    // Hash password
    const saltRounds = 10;
    let passwordHash;
    try {
      passwordHash = await bcrypt.hash(password, saltRounds);
      console.log('[AUTH] Password hashed successfully');
    } catch (hashError) {
      console.error('[AUTH] Password hashing failed:', hashError.message, hashError.stack);
      return res.status(500).json({ error: 'Unable to create account. Password processing failed.' });
    }

    // Create new user
    const newUser = {
      id: crypto.randomUUID(),
      username: trimmedUsername,
      passwordHash,
      createdAt: new Date().toISOString()
    };
    console.log('[AUTH] Created new user object with id:', newUser.id);

    usersData.push(newUser);
    console.log('[AUTH] User added to memory, total users:', usersData.length);

    // Save to storage
    console.log('[AUTH] Saving users to storage...');
    let saved;
    try {
      saved = await saveUsersAsync();
      console.log('[AUTH] Save result:', saved);
    } catch (saveError) {
      console.error('[AUTH] Save threw an exception:', saveError.message, saveError.stack);
      // Remove user from memory if save failed
      usersData = usersData.filter(u => u.id !== newUser.id);
      return res.status(500).json({ error: 'Unable to create account. Storage error: ' + saveError.message });
    }

    if (!saved) {
      console.log('[AUTH] Save returned false, removing user from memory');
      // Remove user from memory if save failed
      usersData = usersData.filter(u => u.id !== newUser.id);
      return res.status(500).json({ error: 'Unable to create account. Please try again.' });
    }

    // Generate token
    console.log('[AUTH] Generating JWT token...');
    const token = generateToken(newUser);

    console.log(`[AUTH] New user registered successfully: ${trimmedUsername}`);

    res.status(201).json({
      message: 'Account created successfully',
      user: {
        id: newUser.id,
        username: newUser.username
      },
      token
    });
  } catch (error) {
    console.error('[AUTH] Signup error (unexpected):', error.message);
    console.error('[AUTH] Signup error stack:', error.stack);
    res.status(500).json({ error: 'Unable to create account. Server error: ' + error.message });
  }
});

// User login
app.post("/api/auth/login", async (req, res) => {
  console.log('[AUTH] Login request received');

  try {
    const { username, password } = req.body;

    // Input validation
    if (!username || typeof username !== 'string' || !username.trim()) {
      console.log('[AUTH] Login validation failed: Username is required');
      return res.status(400).json({ error: 'Username is required.' });
    }
    if (!password || typeof password !== 'string') {
      console.log('[AUTH] Login validation failed: Password is required');
      return res.status(400).json({ error: 'Password is required.' });
    }

    const trimmedUsername = username.trim();
    console.log('[AUTH] Login attempt for username:', `"${trimmedUsername}"`);

    // Refresh users from blob to get latest data
    try {
      await refreshUsersFromBlob();
      console.log('[AUTH] Users refreshed for login, current count:', usersData.length);
    } catch (refreshError) {
      console.error('[AUTH] Error refreshing users during login:', refreshError.message);
      // Continue anyway - use in-memory data
    }

    // Find user (case-insensitive username)
    const user = usersData.find(u =>
      u.username.toLowerCase() === trimmedUsername.toLowerCase()
    );

    if (!user) {
      console.log('[AUTH] Login failed: Username not found:', trimmedUsername);
      return res.status(401).json({ error: 'Username does not exist.' });
    }

    console.log('[AUTH] User found, verifying password...');

    // Verify password
    let passwordValid;
    try {
      passwordValid = await bcrypt.compare(password, user.passwordHash);
    } catch (compareError) {
      console.error('[AUTH] Password comparison error:', compareError.message);
      return res.status(500).json({ error: 'Login failed. Please try again.' });
    }

    if (!passwordValid) {
      console.log('[AUTH] Login failed: Incorrect password for user:', user.username);
      return res.status(401).json({ error: 'Password does not match username.' });
    }

    // Generate token
    console.log('[AUTH] Password verified, generating token...');
    const token = generateToken(user);

    console.log(`[AUTH] User logged in successfully: ${user.username}`);

    res.json({
      message: 'Login successful',
      user: {
        id: user.id,
        username: user.username
      },
      token
    });
  } catch (error) {
    console.error('[AUTH] Login error (unexpected):', error.message);
    console.error('[AUTH] Login error stack:', error.stack);
    res.status(500).json({ error: 'Login failed. Server error: ' + error.message });
  }
});

// Get current user (verify token and return user info)
app.get("/api/auth/me", (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Not authenticated.' });
  }

  res.json({
    user: {
      id: req.user.id,
      username: req.user.username
    }
  });
});

// Debug endpoint - View auth system status (developer use only)
app.get("/api/auth/debug", async (req, res) => {
  try {
    // Refresh to get latest data
    await refreshUsersFromBlob();

    res.json({
      storageType: USE_VERCEL_BLOB ? 'Vercel Blob' : 'File System',
      blobTokenSet: !!process.env.BLOB_READ_WRITE_TOKEN,
      usersBlobUrl: usersBlobUrl,
      usersLoaded: usersLoaded,
      totalUsersInMemory: usersData.length,
      usernames: usersData.map(u => u.username),
      jwtSecretSet: !!JWT_SECRET,
      environment: process.env.VERCEL ? 'Vercel' : 'Local'
    });
  } catch (error) {
    console.error('[AUTH] Debug endpoint error:', error);
    res.status(500).json({ error: error.message, stack: error.stack });
  }
});

// Demo mode / offline status endpoint
app.get("/api/demo-status", (req, res) => {
  res.json({
    offlineMode: OFFLINE_MODE,
    offlineDataAvailable: offlineBusinesses.length > 0,
    metadata: offlineMetadata,
    productionUrl: process.env.PRODUCTION_URL || null,
    businessCount: OFFLINE_MODE ? offlineBusinesses.length : null
  });
});

// Get verification configuration
app.get("/api/verification/config", (req, res) => {
  const config = {
    recaptchaEnabled: RECAPTCHA_ENABLED,
    recaptchaSiteKey: process.env.RECAPTCHA_SITE_KEY || null
  };
  console.log('[API] /api/verification/config called');
  res.json(config);
});

// Get verification challenge
app.get("/api/verification/challenge", (req, res) => {
  console.log('[API] /api/verification/challenge called');
  try {
    const challenge = generateChallenge();
    res.json(challenge);
  } catch (error) {
    res.status(500).json({ error: "Failed to generate challenge" });
  }
});

// Get diagnostic info about current business distribution
// GET /api/admin/business-stats - shows category breakdown
app.get("/api/admin/business-stats", async (req, res) => {
  try {
    // Wait for businesses to load
    if (businessBlobLoadPromise && !businessBlobLoaded) {
      await businessBlobLoadPromise;
    }

    const businesses = Array.from(persistentBusinesses.values());
    const categoryCount = { Food: 0, Retail: 0, Services: 0, Other: 0 };
    const tagCount = {};

    for (const biz of businesses) {
      categoryCount[biz.category] = (categoryCount[biz.category] || 0) + 1;
      for (const tag of (biz.tags || [])) {
        tagCount[tag] = (tagCount[tag] || 0) + 1;
      }
    }

    // Sort tags by count
    const topTags = Object.entries(tagCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30)
      .map(([tag, count]) => ({ tag, count }));

    res.json({
      total: businesses.length,
      categories: categoryCount,
      percentages: {
        Food: ((categoryCount.Food / businesses.length) * 100).toFixed(1) + '%',
        Retail: ((categoryCount.Retail / businesses.length) * 100).toFixed(1) + '%',
        Services: ((categoryCount.Services / businesses.length) * 100).toFixed(1) + '%'
      },
      topTags,
      note: "Business storage is additive-only. Businesses are NEVER deleted, only added or updated."
    });
  } catch (error) {
    console.error('[ADMIN] Error getting business stats:', error);
    res.status(500).json({ error: error.message });
  }
});

// Import additional businesses by category (for diversifying the database)
// POST /api/import-businesses - imports service and retail businesses with pagination
app.post("/api/import-businesses", async (req, res) => {
  try {
    console.log('[IMPORT] Import endpoint called');
    const categories = req.body?.categories || IMPORT_CATEGORIES;
    const importResult = await importBusinessesByCategory(categories);

    // Seed reviews for newly imported businesses
    let reviewResult = { seeded: 0, reviews: 0 };
    if (importResult.newBusinessIds && importResult.newBusinessIds.length > 0) {
      reviewResult = await seedReviewsForNewBusinesses(importResult.newBusinessIds);
    }

    // Clear cache so new businesses show up immediately
    cache.flushAll();

    // Calculate full category breakdown
    const allBusinesses = Array.from(persistentBusinesses.values());
    const fullBreakdown = {
      Food: allBusinesses.filter(b => b.category === "Food").length,
      Retail: allBusinesses.filter(b => b.category === "Retail").length,
      Services: allBusinesses.filter(b => b.category === "Services").length
    };

    res.json({
      success: true,
      imported: importResult.imported,
      total: importResult.total,
      duplicatesSkipped: importResult.duplicatesSkipped,
      newCategoryBreakdown: importResult.categoryBreakdown,
      fullCategoryBreakdown: fullBreakdown,
      reviewsSeeded: reviewResult.seeded,
      totalNewReviews: reviewResult.reviews
    });
  } catch (error) {
    console.error('[IMPORT] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get all businesses
app.get("/api/businesses", async (req, res) => {
  try {
    // Trigger review seeding on first request if needed (for Vercel)
    await ensureSeeded();

    const { category, tag, search, minRating, hasDeals, sort, limit } = req.query;

    let businesses = await fetchBusinesses();

    // Filter by category
    if (category && category !== "All") {
      businesses = businesses.filter(b => b.category === category);
    }

    // Filter by tag
    if (tag && tag !== "All") {
      const tagLower = tag.toLowerCase();
      businesses = businesses.filter(b =>
        b.tags.some(t => t.toLowerCase() === tagLower)
      );
    }

    // Filter by minimum rating
    if (minRating) {
      const min = parseFloat(minRating);
      if (!isNaN(min)) {
        businesses = businesses.filter(b => b.rating >= min);
      }
    }

    // Filter by deals
    if (hasDeals === "true") {
      businesses = businesses.filter(b => b.deal !== null);
    }

    // Search
    if (search && search.trim()) {
      const searchLower = search.toLowerCase().trim();
      businesses = businesses.filter(b =>
        b.name.toLowerCase().includes(searchLower) ||
        b.description.toLowerCase().includes(searchLower) ||
        b.tags.some(tag => tag.toLowerCase().includes(searchLower)) ||
        b.category.toLowerCase().includes(searchLower)
      );
    }

    // Sorting - use stable secondary sort by ID to prevent random reordering
    // This ensures businesses don't jump around between page loads
    if (sort === "rating") {
      businesses.sort((a, b) => {
        const diff = b.rating - a.rating;
        return diff !== 0 ? diff : a.id.localeCompare(b.id);
      });
    } else if (sort === "reviews") {
      businesses.sort((a, b) => {
        const diff = b.reviewCount - a.reviewCount;
        return diff !== 0 ? diff : a.id.localeCompare(b.id);
      });
    } else if (sort === "name") {
      businesses.sort((a, b) => {
        const diff = a.name.localeCompare(b.name);
        return diff !== 0 ? diff : a.id.localeCompare(b.id);
      });
    } else if (sort === "local") {
      businesses.sort((a, b) => {
        const diff = b.relevancyScore - a.relevancyScore;
        return diff !== 0 ? diff : a.id.localeCompare(b.id);
      });
    }

    // Limit results
    const limitValue = limit ? parseInt(limit, 10) : null;
    if (limitValue && Number.isFinite(limitValue)) {
      businesses = businesses.slice(0, Math.max(1, limitValue));
    }

    // Enrich images if needed
    if (GOOGLE_SEARCH_API_KEY && GOOGLE_SEARCH_ENGINE_ID) {
      businesses = await enrichBusinessImages(businesses);
    }

    res.json(businesses);
  } catch (error) {
    console.error('Error in /api/businesses:', error);
    res.status(500).json({ error: error.message || "Failed to fetch businesses" });
  }
});

// Recover missing favorited businesses by fetching them directly from Yelp
app.post("/api/businesses/recover-favorites", async (req, res) => {
  try {
    const { favoriteIds } = req.body;

    if (!Array.isArray(favoriteIds) || favoriteIds.length === 0) {
      return res.json({ recovered: [], missing: [] });
    }

    // Get current businesses
    const businesses = await fetchBusinesses();
    const existingIds = new Set(businesses.map(b => b.id));

    // Find which favorites are missing
    const missingIds = favoriteIds.filter(id => !existingIds.has(id) && id.startsWith('yelp-'));

    if (missingIds.length === 0) {
      return res.json({ recovered: [], missing: [] });
    }

    console.log(`[RECOVER] Attempting to recover ${missingIds.length} missing favorites`);

    const recovered = [];
    const stillMissing = [];

    // Fetch each missing business from Yelp (limit to 10 to avoid rate limits)
    for (const businessId of missingIds.slice(0, 10)) {
      const yelpId = businessId.replace('yelp-', '');

      try {
        const yelpData = await fetchYelpBusinessDetails(yelpId);
        if (yelpData) {
          const business = transformYelpToBusiness(yelpData);
          if (business) {
            persistentBusinesses.set(business.id, business);
            recovered.push(business);
            console.log(`[RECOVER] Recovered: ${business.name}`);
          } else {
            stillMissing.push(businessId);
          }
        } else {
          stillMissing.push(businessId);
        }
      } catch (err) {
        console.error(`[RECOVER] Failed to fetch ${businessId}:`, err.message);
        stillMissing.push(businessId);
      }
    }

    // BLOB WRITES DISABLED - Business saves disabled to conserve Vercel Blob usage limits
    // if (recovered.length > 0) {
    //   await saveBusinessesToBlob();
    //   console.log(`[RECOVER] Saved ${recovered.length} recovered businesses`);
    // }

    res.json({
      recovered,
      missing: stillMissing
    });
  } catch (error) {
    console.error('Error recovering favorites:', error);
    res.status(500).json({ error: error.message || "Failed to recover favorites" });
  }
});

// Get single business by ID
app.get("/api/businesses/:id", async (req, res) => {
  try {
    const businessId = req.params.id;

    // In offline mode, use local data directly
    if (OFFLINE_MODE) {
      const business = getOfflineBusinessById(businessId);
      if (!business) {
        return res.status(404).json({ error: "Business not found" });
      }

      // Use local image if available
      if (business.localImage) {
        business.image = `/api/images/${business.localImage}`;
      }

      // Fallback to category image if no image
      if (!business.image) {
        business.image = getCategoryImage(business.category);
      }

      return res.json(business);
    }

    // Online mode - fetch from Yelp
    const businesses = await fetchBusinesses();
    let business = businesses.find(b => b.id === businessId);

    // If business not found but ID looks like a Yelp business, try to fetch directly
    if (!business && businessId.startsWith('yelp-')) {
      const yelpId = businessId.replace('yelp-', '');
      console.log(`[YELP] Business ${businessId} not in list, fetching directly from Yelp...`);

      const yelpData = await fetchYelpBusinessDetails(yelpId);
      if (yelpData) {
        // Transform the Yelp data to our format
        business = transformYelpToBusiness(yelpData);
        if (business) {
          // Add to in-memory storage for this request (blob writes disabled)
          persistentBusinesses.set(business.id, business);
          // BLOB WRITES DISABLED - Business saves disabled to conserve Vercel Blob usage limits
          // saveBusinessesToBlob().catch(err => {
          //   console.error('[YELP] Failed to save recovered business:', err.message);
          // });
          console.log(`[YELP] Recovered business (in memory only): ${business.name}`);
        }
      }
    }

    if (!business) {
      return res.status(404).json({ error: "Business not found" });
    }

    // Fetch detailed info from Yelp
    if (business.yelpId) {
      const details = await fetchYelpBusinessDetails(business.yelpId);
      if (details) {
        business.hours = formatYelpHours(details.hours);
        business.image = details.photos?.[0] || business.image;
        // Include all photos for gallery display
        business.photos = details.photos || (business.image ? [business.image] : []);
        business.website = business.website || details.url;
      }
    }

    // If still no image, try Google Images
    if (!business.image) {
      const imageQuery = `${business.name} ${business.address || "Cumming GA"}`;
      business.image = await fetchGoogleImage(imageQuery);
    }

    // Fallback to category image
    if (!business.image) {
      business.image = getCategoryImage(business.category);
    }

    // Always load fresh reviews from Blob for single business requests
    // This ensures users always see the latest reviews
    await refreshReviewsFromBlob();

    // Get reviews
    const localReviewSummary = getLocalReviewSummary(businessId);
    business.reviews = localReviewSummary.reviews;
    business.rating = localReviewSummary.rating;
    business.reviewCount = localReviewSummary.reviewCount;
    business.categoryRatings = localReviewSummary.categoryRatings;

    res.json(business);
  } catch (error) {
    console.error('Error in /api/businesses/:id:', error);
    res.status(500).json({ error: error.message || "Failed to fetch business" });
  }
});

// Submit review - REQUIRES AUTHENTICATION (no CAPTCHA - users verified at signup)
app.post("/api/businesses/:id/reviews", requireAuth, async (req, res) => {
  try {
    const businessId = req.params.id;
    const {
      rating,
      comment,
      // Category ratings (support both 'quality' and legacy 'foodQuality')
      quality,
      foodQuality,
      service,
      cleanliness,
      atmosphere,
      isAnonymous
    } = req.body;

    // Get user info from auth token
    const userId = req.user.id;
    const authorName = isAnonymous ? "Anonymous" : req.user.username;

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
    console.log(`[REVIEW] Submitting review for business ${businessId} by user ${req.user.username}`);

    // Refresh reviews from blob before adding new review
    await refreshReviewsFromBlob();

    // Create review with user association
    const review = {
      id: crypto.randomUUID(),
      userId,  // Associate review with user
      author: authorName,
      isAnonymous: !!isAnonymous,
      rating,
      comment: reviewComment,
      date: new Date().toISOString(),
      helpful: 0,
      upvotedBy: [], // Track which users have upvoted
      source: 'local',
      // Category ratings (use 'quality' as standard field name)
      quality: qualityRating,
      service,
      cleanliness,
      atmosphere
    };

    const reviews = localReviews.get(businessId) || [];
    reviews.push(review);
    localReviews.set(businessId, reviews);

    // Save and wait for completion
    const saved = await saveReviewsAsync();
    if (!saved) {
      console.error('[REVIEW] Warning: Review may not have persisted to storage');
    }

    cache.flushAll();

    // Return review without internal fields
    const publicReview = {
      ...review,
      upvotedBy: undefined // Don't expose upvotedBy list
    };

    res.status(201).json({ message: "Review submitted successfully", review: publicReview });
  } catch (error) {
    console.error('Error submitting review:', error);
    res.status(500).json({ error: "Failed to submit review" });
  }
});

// Upvote review - REQUIRES AUTHENTICATION
app.post("/api/businesses/:businessId/reviews/:reviewId/upvote", requireAuth, async (req, res) => {
  try {
    const { businessId, reviewId } = req.params;
    const userId = req.user.id;

    // Refresh reviews from blob to get latest data
    await refreshReviewsFromBlob();

    const reviews = localReviews.get(businessId);

    if (!reviews) {
      console.log(`[UPVOTE] Business not found: ${businessId}, localReviews has ${localReviews.size} entries`);
      return res.status(404).json({ error: "Business not found" });
    }

    const review = reviews.find(r => r.id === reviewId);
    if (!review) {
      console.log(`[UPVOTE] Review not found: ${reviewId} in business ${businessId}`);
      return res.status(404).json({ error: "Review not found" });
    }

    // Initialize upvotedBy array if it doesn't exist (for legacy reviews)
    if (!review.upvotedBy) {
      review.upvotedBy = [];
    }

    // Check if user already upvoted
    if (review.upvotedBy.includes(userId)) {
      return res.status(400).json({ error: "You have already upvoted this review", helpful: review.helpful });
    }

    // Add user to upvotedBy and increment helpful count
    review.upvotedBy.push(userId);
    review.helpful = review.upvotedBy.length;

    const saved = await saveReviewsAsync();
    if (!saved) {
      // Revert changes if save failed
      review.upvotedBy = review.upvotedBy.filter(id => id !== userId);
      review.helpful = review.upvotedBy.length;
      return res.status(500).json({ error: "Failed to save upvote" });
    }

    console.log(`[UPVOTE] User ${req.user.username} upvoted review ${reviewId}`);
    res.json({ message: "Upvote recorded", helpful: review.helpful });
  } catch (error) {
    console.error('Error upvoting review:', error);
    res.status(500).json({ error: "Failed to upvote review" });
  }
});

// Remove upvote from review - REQUIRES AUTHENTICATION
app.post("/api/businesses/:businessId/reviews/:reviewId/remove-upvote", requireAuth, async (req, res) => {
  try {
    const { businessId, reviewId } = req.params;
    const userId = req.user.id;

    // Refresh reviews from blob to get latest data
    await refreshReviewsFromBlob();

    const reviews = localReviews.get(businessId);

    if (!reviews) return res.status(404).json({ error: "Business not found" });

    const review = reviews.find(r => r.id === reviewId);
    if (!review) return res.status(404).json({ error: "Review not found" });

    // Initialize upvotedBy array if it doesn't exist
    if (!review.upvotedBy) {
      review.upvotedBy = [];
    }

    // Check if user has actually upvoted
    if (!review.upvotedBy.includes(userId)) {
      return res.status(400).json({ error: "You have not upvoted this review", helpful: review.helpful });
    }

    // Remove user from upvotedBy and update helpful count
    review.upvotedBy = review.upvotedBy.filter(id => id !== userId);
    review.helpful = review.upvotedBy.length;

    const saved = await saveReviewsAsync();
    if (!saved) {
      // Revert changes if save failed
      review.upvotedBy.push(userId);
      review.helpful = review.upvotedBy.length;
      return res.status(500).json({ error: "Failed to remove upvote" });
    }

    console.log(`[UPVOTE] User ${req.user.username} removed upvote from review ${reviewId}`);
    res.json({ message: "Upvote removed", helpful: review.helpful });
  } catch (error) {
    console.error('Error removing upvote:', error);
    res.status(500).json({ error: "Failed to remove upvote" });
  }
});

// Report review
app.post("/api/businesses/:businessId/reviews/:reviewId/report", async (req, res) => {
  try {
    const { businessId, reviewId } = req.params;
    const { reason } = req.body;

    // Refresh reviews from blob to get latest data
    await refreshReviewsFromBlob();

    const reviews = localReviews.get(businessId);

    if (!reviews) return res.status(404).json({ error: "Business not found" });

    const review = reviews.find(r => r.id === reviewId);
    if (!review) return res.status(404).json({ error: "Review not found" });

    if (!review.reports) review.reports = [];
    review.reports.push({ reason: reason || "Inappropriate content", date: new Date().toISOString() });

    if (review.reports.length >= 3) review.hidden = true;

    await saveReviewsAsync();
    res.json({ message: "Report submitted. Thank you for helping keep our community safe.", reportCount: review.reports.length });
  } catch (error) {
    console.error('Error reporting review:', error);
    res.status(500).json({ error: "Failed to report review" });
  }
});

// Edit review - REQUIRES AUTHENTICATION and OWNERSHIP
app.put("/api/businesses/:businessId/reviews/:reviewId", requireAuth, async (req, res) => {
  try {
    const { businessId, reviewId } = req.params;
    const userId = req.user.id;
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

    // Refresh reviews from blob to get latest data
    await refreshReviewsFromBlob();

    const reviews = localReviews.get(businessId);

    if (!reviews) {
      return res.status(404).json({ error: "Business not found" });
    }

    const reviewIndex = reviews.findIndex(r => r.id === reviewId);
    if (reviewIndex === -1) {
      return res.status(404).json({ error: "Review not found" });
    }

    const review = reviews[reviewIndex];

    // Check ownership - user must be the author of the review
    if (review.userId !== userId) {
      return res.status(403).json({ error: "You can only edit your own reviews" });
    }

    // Validate rating if provided
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

    // Validate and update category ratings if provided
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
      review.author = review.isAnonymous ? "Anonymous" : req.user.username;
    }

    // Mark as edited
    review.editedAt = new Date().toISOString();

    // Save changes
    const saved = await saveReviewsAsync();
    if (!saved) {
      return res.status(500).json({ error: "Failed to save changes" });
    }

    console.log(`[REVIEW] User ${req.user.username} edited review ${reviewId}`);

    // Return updated review without internal fields
    const publicReview = {
      ...review,
      upvotedBy: undefined
    };

    res.json({ message: "Review updated successfully", review: publicReview });
  } catch (error) {
    console.error('Error editing review:', error);
    res.status(500).json({ error: "Failed to edit review" });
  }
});

// Delete review - REQUIRES AUTHENTICATION and OWNERSHIP
app.delete("/api/businesses/:businessId/reviews/:reviewId", requireAuth, async (req, res) => {
  try {
    const { businessId, reviewId } = req.params;
    const userId = req.user.id;

    // Refresh reviews from blob to get latest data
    await refreshReviewsFromBlob();

    const reviews = localReviews.get(businessId);

    if (!reviews) {
      return res.status(404).json({ error: "Business not found" });
    }

    const reviewIndex = reviews.findIndex(r => r.id === reviewId);
    if (reviewIndex === -1) {
      return res.status(404).json({ error: "Review not found" });
    }

    const review = reviews[reviewIndex];

    // Check ownership - user must be the author of the review
    if (review.userId !== userId) {
      return res.status(403).json({ error: "You can only delete your own reviews" });
    }

    // Remove the review
    reviews.splice(reviewIndex, 1);
    localReviews.set(businessId, reviews);

    // Save changes
    const saved = await saveReviewsAsync();
    if (!saved) {
      // Restore the review if save failed
      reviews.splice(reviewIndex, 0, review);
      localReviews.set(businessId, reviews);
      return res.status(500).json({ error: "Failed to delete review" });
    }

    // Clear cache
    cache.flushAll();

    console.log(`[REVIEW] User ${req.user.username} deleted review ${reviewId}`);

    res.json({ message: "Review deleted successfully" });
  } catch (error) {
    console.error('Error deleting review:', error);
    res.status(500).json({ error: "Failed to delete review" });
  }
});

// Debug endpoint - View reviews storage status (developer use only)
app.get("/api/reviews/debug", async (req, res) => {
  try {
    const reviewData = Array.from(localReviews.entries());
    const totalReviews = reviewData.reduce((sum, [, reviews]) => sum + reviews.length, 0);

    res.json({
      storageType: USE_VERCEL_BLOB ? 'Vercel Blob' : 'File System',
      blobTokenSet: !!process.env.BLOB_READ_WRITE_TOKEN,
      currentBlobUrl: reviewsBlobUrl,
      businessesWithReviews: reviewData.length,
      totalReviewsInMemory: totalReviews,
      sampleData: reviewData.slice(0, 3).map(([id, reviews]) => ({
        businessId: id,
        reviewCount: reviews.length,
        latestReview: reviews.length > 0 ? reviews[reviews.length - 1] : null
      }))
    });
  } catch (error) {
    console.error('Error in reviews debug:', error);
    res.status(500).json({ error: error.message });
  }
});

// Recommendations - Scoring Algorithm:
// - Category match: +10 points per favorite in that category
// - High Yelp rating (4.5+): +15 points
// - Good Yelp rating (4.0+): +10 points
// - Has deal: +5 points
// - Local business bonus: +3 points (breaks ties)
// - Higher review count: +0.01 per review (secondary tiebreaker)
app.post("/api/recommendations", async (req, res) => {
  try {
    const { favoriteIds = [], preferredCategories = [], debug = false } = req.body;
    const businesses = await fetchBusinesses();

    // Build category scores from user's favorites
    let categoryScores = {};
    favoriteIds.forEach(id => {
      const business = businesses.find(b => b.id === id);
      if (business) {
        categoryScores[business.category] = (categoryScores[business.category] || 0) + 1;
      }
    });

    preferredCategories.forEach(cat => {
      categoryScores[cat] = (categoryScores[cat] || 0) + 2;
    });

    // Score all businesses
    const scored = businesses
      .filter(b => !favoriteIds.includes(b.id))
      .map(b => {
        let score = 0;
        let scoreBreakdown = {};

        // Category matching (primary factor)
        const categoryBonus = (categoryScores[b.category] || 0) * 10;
        score += categoryBonus;
        if (categoryBonus > 0) scoreBreakdown.category = categoryBonus;

        // Yelp rating bonus
        if (b.yelpRating >= 4.5) {
          score += 15;
          scoreBreakdown.rating = 15;
        } else if (b.yelpRating >= 4.0) {
          score += 10;
          scoreBreakdown.rating = 10;
        }

        // Deal bonus
        if (b.deal) {
          score += 5;
          scoreBreakdown.deal = 5;
        }

        // Local business bonus (tiebreaker)
        if (!b.isChain) {
          score += 3;
          scoreBreakdown.local = 3;
        }

        // Review count micro-bonus (secondary tiebreaker)
        const reviewBonus = Math.min((b.yelpReviewCount || 0) * 0.01, 2);
        score += reviewBonus;
        if (reviewBonus > 0) scoreBreakdown.reviews = Math.round(reviewBonus * 100) / 100;

        return {
          ...b,
          recommendationScore: Math.round(score * 100) / 100,
          ...(debug && { scoreBreakdown })
        };
      })
      .sort((a, b) => b.recommendationScore - a.recommendationScore)
      .slice(0, debug ? 20 : 4); // Return more results in debug mode

    // In debug mode, include the category scores used
    if (debug) {
      res.json({
        categoryScores,
        favoriteCount: favoriteIds.length,
        recommendations: scored
      });
    } else {
      res.json(scored);
    }
  } catch (error) {
    console.error('Error generating recommendations:', error);
    res.status(500).json({ error: "Failed to generate recommendations" });
  }
});

// Debug endpoint - View all recommendation scores (developer use only)
app.get("/api/recommendations/debug", async (req, res) => {
  try {
    const businesses = await fetchBusinesses();

    // Score all businesses with no favorites (shows base scores)
    const scored = businesses.map(b => {
      let score = 0;
      let breakdown = {};

      if (b.yelpRating >= 4.5) {
        score += 15;
        breakdown.rating = 15;
      } else if (b.yelpRating >= 4.0) {
        score += 10;
        breakdown.rating = 10;
      }

      if (b.deal) {
        score += 5;
        breakdown.deal = 5;
      }

      if (!b.isChain) {
        score += 3;
        breakdown.local = 3;
      }

      const reviewBonus = Math.min((b.yelpReviewCount || 0) * 0.01, 2);
      score += reviewBonus;
      if (reviewBonus > 0) breakdown.reviews = Math.round(reviewBonus * 100) / 100;

      return {
        name: b.name,
        category: b.category,
        yelpRating: b.yelpRating,
        yelpReviewCount: b.yelpReviewCount,
        isChain: b.isChain,
        hasDeal: !!b.deal,
        baseScore: Math.round(score * 100) / 100,
        breakdown
      };
    }).sort((a, b) => b.baseScore - a.baseScore);

    // Group by score to show ties
    const scoreGroups = {};
    scored.forEach(b => {
      const key = b.baseScore.toString();
      if (!scoreGroups[key]) scoreGroups[key] = [];
      scoreGroups[key].push(b.name);
    });

    const tiedScores = Object.entries(scoreGroups)
      .filter(([_, names]) => names.length > 1)
      .map(([score, names]) => ({ score: parseFloat(score), count: names.length, businesses: names }))
      .sort((a, b) => b.score - a.score);

    res.json({
      totalBusinesses: scored.length,
      tiedScores,
      topBusinesses: scored.slice(0, 30),
      scoringAlgorithm: {
        categoryMatch: "+10 per favorite in category",
        rating45Plus: "+15",
        rating40Plus: "+10",
        hasDeal: "+5",
        isLocal: "+3",
        reviewCount: "+0.01 per review (max +2)"
      }
    });
  } catch (error) {
    console.error('Error in recommendations debug:', error);
    res.status(500).json({ error: "Failed to generate debug data" });
  }
});

// Trending businesses
const TRENDING_BUSINESS_NAMES = ["Raising Cane's", "Kung Fu Tea", "Marlow's Tavern"];

app.get("/api/trending", async (req, res) => {
  try {
    const businesses = await fetchBusinesses();
    const trending = [];

    for (const trendingName of TRENDING_BUSINESS_NAMES) {
      const match = businesses.find(b =>
        b.name.toLowerCase().includes(trendingName.toLowerCase()) ||
        trendingName.toLowerCase().includes(b.name.toLowerCase())
      );
      if (match) trending.push(match);
    }

    // Fill with top-rated local businesses
    if (trending.length < 3) {
      const fallback = businesses
        .filter(b => !b.isChain && !trending.some(t => t.id === b.id))
        .sort((a, b) => {
          const diff = b.relevancyScore - a.relevancyScore;
          return diff !== 0 ? diff : a.id.localeCompare(b.id);
        })
        .slice(0, 3 - trending.length);
      trending.push(...fallback);
    }

    res.json(trending);
  } catch (error) {
    console.error('Error fetching trending businesses:', error);
    res.status(500).json({ error: "Failed to fetch trending businesses" });
  }
});

// DISABLED - Admin: Regenerate all reviews with the new algorithm
// BLOB WRITES DISABLED to conserve Vercel Blob usage limits
app.post("/api/admin/regenerate-reviews", async (req, res) => {
  console.log('[ADMIN] Regenerate reviews endpoint called but BLOB WRITES ARE DISABLED');
  res.status(403).json({
    error: "Review regeneration is currently disabled to conserve Vercel Blob usage limits",
    disabled: true
  });
});

// Tags
app.get("/api/tags", async (req, res) => {
  try {
    const businesses = await fetchBusinesses();
    const tagCounts = {};

    businesses.forEach(b => {
      (b.tags || []).forEach(tag => {
        const normalizedTag = tag.toLowerCase().trim();
        if (normalizedTag && normalizedTag.length > 1) {
          tagCounts[normalizedTag] = (tagCounts[normalizedTag] || 0) + 1;
        }
      });
    });

    const tags = Object.entries(tagCounts)
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .map(([tag, count]) => ({
        tag: tag.charAt(0).toUpperCase() + tag.slice(1),
        count
      }));

    res.json(tags);
  } catch (error) {
    console.error('Error fetching tags:', error);
    res.status(500).json({ error: "Failed to fetch tags" });
  }
});

// Analytics
app.get("/api/analytics", async (req, res) => {
  try {
    // Load fresh reviews from Blob for accurate counts
    await refreshReviewsFromBlob();

    const businesses = await fetchBusinesses();
    const totalBusinesses = businesses.length;
    const avgRating = totalBusinesses > 0
      ? businesses.reduce((sum, b) => sum + (b.yelpRating || 0), 0) / totalBusinesses
      : 0;

    const byCategory = businesses.reduce((acc, b) => {
      acc[b.category] = (acc[b.category] || 0) + 1;
      return acc;
    }, {});

    const topRated = [...businesses]
      .sort((a, b) => (b.yelpRating || 0) - (a.yelpRating || 0))
      .slice(0, 3)
      .map(b => ({ id: b.id, name: b.name, rating: b.yelpRating }));

    const dealsAvailable = businesses.filter(b => b.deal).length;

    let totalUserReviews = 0;
    for (const reviews of localReviews.values()) {
      totalUserReviews += reviews.length;
    }

    res.json({
      totalBusinesses,
      avgRating: Math.round(avgRating * 10) / 10,
      totalByCategory: byCategory,
      byCategory,
      topRated,
      dealsAvailable,
      totalUserReviews,
      topRatedCount: businesses.filter(b => (b.yelpRating || 0) >= 4).length
    });
  } catch (error) {
    console.error('Error fetching analytics:', error);
    res.status(500).json({ error: "Failed to fetch analytics" });
  }
});

// Export for Vercel
export default app;

// Local server
const isMainModule = import.meta.url.endsWith(process.argv[1]) ||
                     process.argv[1]?.includes('server/index.js');

if (isMainModule && !process.env.VERCEL) {
  const PORT = 3001;
  app.listen(PORT, async () => {
    console.log(`LocalLink API running on http://localhost:${PORT}`);
    if (OFFLINE_MODE) {
      console.log(`Mode: OFFLINE (Demo Mode)`);
      console.log(`Data: ${offlineBusinesses.length} businesses loaded`);
      if (offlineMetadata) {
        console.log(`Synced: ${offlineMetadata.seedDateFormatted}`);
      }
    } else {
      console.log(`Data Source: Yelp API`);
    }
    console.log(`Location: Cumming, Georgia`);
    console.log(`Search radius: 10 miles`);
    console.log(`reCAPTCHA: ${RECAPTCHA_ENABLED ? "enabled" : "disabled"}`);

    // SEEDING DISABLED - preserving existing blob data to stay within usage limits
    // Reviews are already seeded and stored in Vercel Blob
    seedingComplete = true;
    console.log('[SEED] Seeding disabled - using existing review data');
  });
}

// For Vercel: seeding disabled to preserve blob usage limits
async function ensureSeeded() {
  // SEEDING DISABLED - data already exists in blob storage
  // This function is now a no-op to prevent any automatic writes
  seedingComplete = true;
  return;
}
