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

// Load environment variables
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
        const response = await fetch(usersBlob.url);
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
        // Fetch the blob content
        const response = await fetch(reviewsBlob.url);
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
      const response = await fetch(reviewsBlob.url);
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

// Store verification challenges in memory
const verificationChallenges = new Map();

// Cumming, Georgia coordinates and search radius
const CUMMING_GA_LAT = 34.2073;
const CUMMING_GA_LON = -84.1402;
const SEARCH_RADIUS_METERS = 16093; // 10 miles in meters

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
    "sportinggoods", "toys", "pets", "flowers", "cosmetics"
  ],
  Services: [
    "localservices", "homeservices", "auto", "health", "beautysvc", "fitness",
    "education", "professional", "financialservices", "realestate", "eventservices",
    "petservices", "automotive", "hairsalons", "spas", "gyms", "yoga", "dentists",
    "doctors", "veterinarians"
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
    const reviewsWithCategories = visibleReviews.filter(r =>
      r.foodQuality || r.service || r.cleanliness || r.atmosphere
    );

    if (reviewsWithCategories.length >= 5) {
      const totals = { foodQuality: 0, service: 0, cleanliness: 0, atmosphere: 0 };
      const counts = { foodQuality: 0, service: 0, cleanliness: 0, atmosphere: 0 };

      reviewsWithCategories.forEach(r => {
        if (r.foodQuality) { totals.foodQuality += r.foodQuality; counts.foodQuality++; }
        if (r.service) { totals.service += r.service; counts.service++; }
        if (r.cleanliness) { totals.cleanliness += r.cleanliness; counts.cleanliness++; }
        if (r.atmosphere) { totals.atmosphere += r.atmosphere; counts.atmosphere++; }
      });

      categoryRatings = {
        foodQuality: counts.foodQuality > 0 ? Math.round((totals.foodQuality / counts.foodQuality) * 10) / 10 : null,
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

// Build a meaningful description from available Yelp data
function buildBusinessDescription(yelpBusiness, category) {
  const categoryLabels = (yelpBusiness.categories || [])
    .map(c => c.title)
    .filter(Boolean)
    .slice(0, 3);

  if (categoryLabels.length === 0) {
    return null; // No description available
  }

  const categoryText = categoryLabels.join(", ");
  const priceText = yelpBusiness.price ? ` (${yelpBusiness.price})` : "";
  const ratingText = yelpBusiness.rating ? ` Rated ${yelpBusiness.rating} stars on Yelp.` : "";
  const locationText = yelpBusiness.location?.city || "Cumming";

  // Build transactions info (delivery, pickup, etc.)
  const transactions = yelpBusiness.transactions || [];
  let transactionText = "";
  if (transactions.length > 0) {
    const transactionLabels = transactions.map(t => {
      if (t === "delivery") return "delivery";
      if (t === "pickup") return "pickup";
      if (t === "restaurant_reservation") return "reservations";
      return t;
    });
    transactionText = ` Offers ${transactionLabels.join(", ")}.`;
  }

  return `${categoryText}${priceText} serving the ${locationText} area.${ratingText}${transactionText}`;
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

// Fetch businesses from Yelp
async function fetchYelpBusinesses() {
  if (!YELP_API_KEY) {
    console.log("[YELP] API key not set. Cannot fetch businesses.");
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

    console.log(`[YELP] Successfully fetched ${results.length} total businesses`);

    // Transform and filter
    const transformed = results
      .map(transformYelpToBusiness)
      .filter(biz => biz !== null);

    // Sort by relevancy (local businesses first), with stable secondary sort by ID
    transformed.sort((a, b) => {
      const diff = b.relevancyScore - a.relevancyScore;
      return diff !== 0 ? diff : a.id.localeCompare(b.id);
    });

    cache.set(cacheKey, transformed);
    return transformed;

  } catch (error) {
    console.error("[YELP] Error fetching businesses:", error.message);
    if (error.response) {
      console.error("[YELP] Response status:", error.response.status);
      console.error("[YELP] Response data:", JSON.stringify(error.response.data));
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

// Get all businesses
app.get("/api/businesses", async (req, res) => {
  try {
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
    const business = businesses.find(b => b.id === businessId);

    if (!business) {
      return res.status(404).json({ error: "Business not found" });
    }

    // Fetch detailed info from Yelp
    if (business.yelpId) {
      const details = await fetchYelpBusinessDetails(business.yelpId);
      if (details) {
        business.hours = formatYelpHours(details.hours);
        business.image = details.photos?.[0] || business.image;
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
      // Category ratings
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
      // Category ratings
      foodQuality,
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
      foodQuality,
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

    if (foodQuality !== undefined) {
      if (validateCategoryRating(foodQuality)) {
        return res.status(400).json({ error: "Food quality rating must be between 1 and 5" });
      }
      review.foodQuality = foodQuality;
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
  app.listen(PORT, () => {
    console.log(`🚀 LocalLink API running on http://localhost:${PORT}`);
    if (OFFLINE_MODE) {
      console.log(`📴 Mode: OFFLINE (Demo Mode)`);
      console.log(`📦 Data: ${offlineBusinesses.length} businesses loaded`);
      if (offlineMetadata) {
        console.log(`📅 Synced: ${offlineMetadata.seedDateFormatted}`);
      }
    } else {
      console.log(`📍 Data Source: Yelp API`);
    }
    console.log(`📍 Location: Cumming, Georgia`);
    console.log(`📏 Search radius: 10 miles`);
    console.log(`🔐 reCAPTCHA: ${RECAPTCHA_ENABLED ? "enabled" : "disabled"}`);
  });
}
