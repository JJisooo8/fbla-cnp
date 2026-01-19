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
      // Delete old blob if exists (Blob doesn't overwrite by default)
      if (reviewsBlobUrl) {
        try {
          await del(reviewsBlobUrl);
          console.log('[BLOB] Deleted old blob at', reviewsBlobUrl);
        } catch (e) {
          console.log('[BLOB] No old blob to delete or delete failed:', e.message);
        }
      }

      // Upload new blob - use addRandomSuffix: false to keep consistent filename
      console.log('[BLOB] Uploading new blob...');
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
  if (!USE_VERCEL_BLOB) return;

  try {
    const { blobs } = await list({ prefix: REVIEWS_BLOB_NAME });
    const reviewsBlob = blobs.find(b => b.pathname === REVIEWS_BLOB_NAME) ||
                        blobs.find(b => b.pathname.includes(REVIEWS_BLOB_NAME));

    if (reviewsBlob) {
      const response = await fetch(reviewsBlob.url);
      if (response.ok) {
        const text = await response.text();
        if (text.trim()) {
          const data = JSON.parse(text);
          if (Array.isArray(data)) {
            localReviews = new Map(data);
            reviewsBlobUrl = reviewsBlob.url;
            console.log(`[BLOB] Refreshed ${localReviews.size} business review sets`);
          }
        }
      }
    }
  } catch (error) {
    console.error('[BLOB] Error refreshing reviews:', error.message);
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
    return { success: false, error: 'Verification failed' };
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

    // Sort by relevancy (local businesses first)
    transformed.sort((a, b) => b.relevancyScore - a.relevancyScore);

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

    // Sorting
    if (sort === "rating") {
      businesses.sort((a, b) => b.rating - a.rating);
    } else if (sort === "reviews") {
      businesses.sort((a, b) => b.reviewCount - a.reviewCount);
    } else if (sort === "name") {
      businesses.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sort === "local") {
      businesses.sort((a, b) => b.relevancyScore - a.relevancyScore);
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

    // Get reviews (already loaded by middleware on cold start)
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

// Submit review
app.post("/api/businesses/:id/reviews", async (req, res) => {
  try {
    const businessId = req.params.id;
    const {
      author,
      rating,
      comment,
      verificationId,
      verificationAnswer,
      recaptchaToken,
      // New category ratings
      foodQuality,
      service,
      cleanliness,
      atmosphere,
      isAnonymous
    } = req.body;

    // Validation - for anonymous reviews, we still need some identifier internally
    const authorName = isAnonymous ? "Anonymous" : (author || "").trim();
    if (!isAnonymous && (!author || typeof author !== "string" || author.trim().length < 2)) {
      return res.status(400).json({ error: "Valid author name is required (min 2 characters)" });
    }

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
    console.log(`[REVIEW] Submitting review for business ${businessId}`);
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
      if (!verificationId || !verificationAnswer) {
        return res.status(400).json({ error: "Verification is required" });
      }

      const challenge = verificationChallenges.get(verificationId);
      if (!challenge) {
        return res.status(400).json({ error: "Verification expired or invalid" });
      }

      if (challenge.answer !== parseInt(verificationAnswer)) {
        return res.status(400).json({ error: "Verification failed. Please try again." });
      }

      verificationChallenges.delete(verificationId);
    }

    // Create review with new fields
    const review = {
      id: crypto.randomUUID(),
      author: authorName,
      isAnonymous: !!isAnonymous,
      rating,
      comment: reviewComment,
      date: new Date().toISOString(),
      helpful: 0,
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

    res.status(201).json({ message: "Review submitted successfully", review });
  } catch (error) {
    console.error('Error submitting review:', error);
    res.status(500).json({ error: "Failed to submit review" });
  }
});

// Upvote review
app.post("/api/businesses/:businessId/reviews/:reviewId/upvote", async (req, res) => {
  try {
    const { businessId, reviewId } = req.params;
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

    review.helpful = (review.helpful || 0) + 1;
    await saveReviewsAsync();

    res.json({ message: "Upvote recorded", helpful: review.helpful });
  } catch (error) {
    console.error('Error upvoting review:', error);
    res.status(500).json({ error: "Failed to upvote review" });
  }
});

// Remove upvote from review
app.post("/api/businesses/:businessId/reviews/:reviewId/remove-upvote", async (req, res) => {
  try {
    const { businessId, reviewId } = req.params;
    const reviews = localReviews.get(businessId);

    if (!reviews) return res.status(404).json({ error: "Business not found" });

    const review = reviews.find(r => r.id === reviewId);
    if (!review) return res.status(404).json({ error: "Review not found" });

    review.helpful = Math.max(0, (review.helpful || 0) - 1);
    await saveReviewsAsync();

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
        .sort((a, b) => b.relevancyScore - a.relevancyScore)
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
