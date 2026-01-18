import express from "express";
import cors from "cors";
import crypto from "crypto";
import axios from "axios";
import NodeCache from "node-cache";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

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
console.log('========================================');

// Cache for API responses (TTL: 1 hour)
const cache = new NodeCache({ stdTTL: 3600 });
const imageCache = new NodeCache({ stdTTL: 86400 });

// Path to persistent review storage
const REVIEWS_FILE = process.env.VERCEL
  ? path.join("/tmp", "reviews.json")
  : path.join(__dirname, "reviews.json");

// Load reviews from file
function loadReviews() {
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

// Save reviews to file
function saveReviews() {
  try {
    const data = JSON.stringify(Array.from(localReviews.entries()));
    fs.writeFileSync(REVIEWS_FILE, data, "utf8");
  } catch (error) {
    console.error("Error saving reviews:", error);
  }
}

// Store local reviews for businesses
const localReviews = loadReviews();

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
  return { reviewCount, rating, reviews: [...visibleReviews] };
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

  const categoryLabel = yelpBusiness.categories
    ?.map(c => c.title)
    .filter(Boolean)
    .slice(0, 2)
    .join(" & ");

  const lat = yelpBusiness.coordinates?.latitude;
  const lon = yelpBusiness.coordinates?.longitude;
  const googleMapsUrl = lat && lon
    ? `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name + ' ' + address)}`;

  return {
    id,
    yelpId: yelpBusiness.id,
    name,
    category,
    rating: localReviewSummary.rating,
    reviewCount: localReviewSummary.reviewCount,
    yelpRating: yelpBusiness.rating,
    yelpReviewCount: yelpBusiness.review_count,
    description: categoryLabel
      ? `Local ${categoryLabel.toLowerCase()} in Cumming, Georgia.`
      : `Local ${category.toLowerCase()} business in Cumming, Georgia.`,
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

// Main function to fetch businesses (offline-first, then Yelp)
async function fetchBusinesses() {
  // In offline mode or if we have offline data and no API key, use local data
  if (OFFLINE_MODE || (offlineBusinesses.length > 0 && !YELP_API_KEY)) {
    console.log('[FETCH] Using offline data');
    // Apply local reviews to offline data
    return offlineBusinesses.map(biz => {
      const localReviewSummary = getLocalReviewSummary(biz.id);
      return {
        ...biz,
        rating: localReviewSummary.rating,
        reviewCount: localReviewSummary.reviewCount,
        reviews: localReviewSummary.reviews
      };
    });
  }

  // Otherwise fetch from Yelp
  return await fetchYelpBusinesses();
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

    // Get fresh reviews
    const localReviewSummary = getLocalReviewSummary(businessId);
    business.reviews = localReviewSummary.reviews;
    business.rating = localReviewSummary.rating;
    business.reviewCount = localReviewSummary.reviewCount;

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
    const { author, rating, comment, verificationId, verificationAnswer, recaptchaToken } = req.body;

    // Validation
    if (!author || typeof author !== "string" || author.trim().length < 2) {
      return res.status(400).json({ error: "Valid author name is required (min 2 characters)" });
    }

    if (!rating || typeof rating !== "number" || rating < 1 || rating > 5) {
      return res.status(400).json({ error: "Rating must be between 1 and 5" });
    }

    if (!comment || typeof comment !== "string" || comment.trim().length < 10) {
      return res.status(400).json({ error: "Comment must be at least 10 characters" });
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

    // Create review
    const review = {
      id: crypto.randomUUID(),
      author: author.trim(),
      rating,
      comment: comment.trim(),
      date: new Date().toISOString(),
      helpful: 0,
      source: 'local'
    };

    const reviews = localReviews.get(businessId) || [];
    reviews.push(review);
    localReviews.set(businessId, reviews);
    saveReviews();
    cache.flushAll();

    res.status(201).json({ message: "Review submitted successfully", review });
  } catch (error) {
    console.error('Error submitting review:', error);
    res.status(500).json({ error: "Failed to submit review" });
  }
});

// Upvote review
app.post("/api/businesses/:businessId/reviews/:reviewId/upvote", (req, res) => {
  try {
    const { businessId, reviewId } = req.params;
    const reviews = localReviews.get(businessId);

    if (!reviews) return res.status(404).json({ error: "Business not found" });

    const review = reviews.find(r => r.id === reviewId);
    if (!review) return res.status(404).json({ error: "Review not found" });

    review.helpful = (review.helpful || 0) + 1;
    saveReviews();

    res.json({ message: "Upvote recorded", helpful: review.helpful });
  } catch (error) {
    console.error('Error upvoting review:', error);
    res.status(500).json({ error: "Failed to upvote review" });
  }
});

// Report review
app.post("/api/businesses/:businessId/reviews/:reviewId/report", (req, res) => {
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

    saveReviews();
    res.json({ message: "Report submitted. Thank you for helping keep our community safe.", reportCount: review.reports.length });
  } catch (error) {
    console.error('Error reporting review:', error);
    res.status(500).json({ error: "Failed to report review" });
  }
});

// Recommendations
app.post("/api/recommendations", async (req, res) => {
  try {
    const { favoriteIds = [], preferredCategories = [] } = req.body;
    const businesses = await fetchBusinesses();

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

    const scored = businesses
      .filter(b => !favoriteIds.includes(b.id))
      .map(b => {
        let score = 0;
        score += (categoryScores[b.category] || 0) * 10;
        if (b.yelpRating >= 4.5) score += 15;
        else if (b.yelpRating >= 4.0) score += 10;
        if (b.deal) score += 5;
        return { ...b, recommendationScore: score };
      })
      .sort((a, b) => b.recommendationScore - a.recommendationScore)
      .slice(0, 4);

    res.json(scored);
  } catch (error) {
    console.error('Error generating recommendations:', error);
    res.status(500).json({ error: "Failed to generate recommendations" });
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
