#!/usr/bin/env node
/**
 * Data Seeding Script for Offline Mode
 *
 * This script downloads all business data from the Yelp API and saves it locally
 * for offline demonstration purposes. Run this before presentations to ensure
 * the app works without internet connectivity.
 *
 * Usage: npm run seed
 */

import axios from "axios";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import https from "https";
import http from "http";
import crypto from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
const envPaths = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), 'server', '.env'),
  path.resolve(__dirname, '.env')
];

for (const envPath of envPaths) {
  const result = dotenv.config({ path: envPath });
  if (!result.error) {
    console.log(`[ENV] Loaded .env from: ${envPath}`);
    break;
  }
}

// Configuration
const YELP_API_KEY = process.env.YELP_API_KEY;
const YELP_API_BASE_URL = "https://api.yelp.com/v3";
const CUMMING_GA_LAT = 34.2073;
const CUMMING_GA_LON = -84.1402;
const SEARCH_RADIUS_METERS = 16093; // 10 miles

// Output directories
const DATA_DIR = path.join(__dirname, "data");
const IMAGES_DIR = path.join(DATA_DIR, "images");
const BUSINESSES_FILE = path.join(DATA_DIR, "businesses.json");
const METADATA_FILE = path.join(DATA_DIR, "metadata.json");

// Category mapping (same as in index.js)
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

const EXCLUDED_YELP_CATEGORIES = [
  "parks", "playgrounds", "dog_parks", "publicservicesgovt", "landmarks",
  "hiking", "beaches", "lakes", "campgrounds", "publicgardens",
  "communitycenters", "libraries", "museums", "religiousorgs", "churches"
];

// Helper functions
function mapYelpCategoriesToCategory(categories = []) {
  const aliases = categories.map(cat => cat.alias);

  if (aliases.some(alias => EXCLUDED_YELP_CATEGORIES.includes(alias))) {
    return "Excluded";
  }

  if (aliases.some(alias => CATEGORY_ALIASES.Food.includes(alias))) return "Food";
  if (aliases.some(alias => CATEGORY_ALIASES.Retail.includes(alias))) return "Retail";
  if (aliases.some(alias => CATEGORY_ALIASES.Services.includes(alias))) return "Services";

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

function calculateRelevancyScore(name, yelpReviewCount) {
  let score = 50;
  if (isChainBusiness(name)) score -= 40;
  if (yelpReviewCount < 50) score += 15;
  else if (yelpReviewCount < 100) score += 10;
  else if (yelpReviewCount > 500) score -= 10;
  const nameLower = (name || '').toLowerCase();
  const localKeywords = ['family', 'local', 'hometown', 'mom', 'pop', '& son', 'brothers'];
  if (localKeywords.some(k => nameLower.includes(k))) score += 25;
  if (nameLower.match(/\w+'s\s/) || nameLower.match(/^[a-z]+'s/i)) score += 20;
  return score;
}

function getMockDealSync(category, name) {
  const dealsByCategory = {
    Food: [
      "10% off lunch orders before 2 PM",
      "Buy 1 entree, get a dessert free",
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

// Download image to local file
async function downloadImage(url, filename) {
  return new Promise((resolve, reject) => {
    if (!url) {
      resolve(null);
      return;
    }

    const filepath = path.join(IMAGES_DIR, filename);

    // Skip if already exists
    if (fs.existsSync(filepath)) {
      resolve(filename);
      return;
    }

    const protocol = url.startsWith('https') ? https : http;

    const request = protocol.get(url, { timeout: 15000 }, (response) => {
      // Handle redirects
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        downloadImage(response.headers.location, filename).then(resolve).catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        resolve(null);
        return;
      }

      const file = fs.createWriteStream(filepath);
      response.pipe(file);

      file.on('finish', () => {
        file.close();
        resolve(filename);
      });

      file.on('error', (err) => {
        fs.unlink(filepath, () => {}); // Delete partial file
        resolve(null);
      });
    });

    request.on('error', () => resolve(null));
    request.on('timeout', () => {
      request.destroy();
      resolve(null);
    });
  });
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

// Fetch business details from Yelp
async function fetchYelpBusinessDetails(yelpId) {
  try {
    const response = await axios.get(`${YELP_API_BASE_URL}/businesses/${yelpId}`, {
      headers: { Authorization: `Bearer ${YELP_API_KEY}` },
      timeout: 15000
    });
    return response.data;
  } catch (error) {
    console.error(`  [ERROR] Failed to fetch details for ${yelpId}: ${error.message}`);
    return null;
  }
}

// Main seeding function
async function seedData() {
  console.log("========================================");
  console.log("  LocalLink Data Seeding Tool");
  console.log("========================================");
  console.log("");

  // Check for API key
  if (!YELP_API_KEY) {
    console.error("[ERROR] YELP_API_KEY is not set!");
    console.error("Please set it in your .env file or environment variables.");
    process.exit(1);
  }

  console.log("[INFO] Creating data directories...");

  // Create directories
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(IMAGES_DIR)) {
    fs.mkdirSync(IMAGES_DIR, { recursive: true });
  }

  console.log("[INFO] Fetching businesses from Yelp API...");
  console.log(`[INFO] Location: Cumming, GA (${CUMMING_GA_LAT}, ${CUMMING_GA_LON})`);
  console.log(`[INFO] Radius: 10 miles`);
  console.log("");

  // Fetch all businesses from Yelp
  const results = [];
  const limit = 50;
  const maxOffset = 200;

  try {
    for (let offset = 0; offset < maxOffset; offset += limit) {
      process.stdout.write(`[YELP] Fetching offset ${offset}...`);

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
      console.log(` Got ${businesses.length} businesses`);

      if (businesses.length < limit) break;

      // Rate limiting - wait between requests
      await new Promise(r => setTimeout(r, 500));
    }

    console.log("");
    console.log(`[INFO] Total raw businesses fetched: ${results.length}`);

  } catch (error) {
    console.error(`[ERROR] Failed to fetch from Yelp: ${error.message}`);
    if (error.response) {
      console.error(`[ERROR] Status: ${error.response.status}`);
      console.error(`[ERROR] Data: ${JSON.stringify(error.response.data)}`);
    }
    process.exit(1);
  }

  // Transform and filter businesses
  console.log("[INFO] Processing and transforming businesses...");

  const transformedBusinesses = [];
  let imageCount = 0;
  let detailsCount = 0;

  for (let i = 0; i < results.length; i++) {
    const yelpBusiness = results[i];

    // Skip excluded categories
    if (isExcludedYelpBusiness(yelpBusiness.categories)) continue;

    const category = mapYelpCategoriesToCategory(yelpBusiness.categories);
    if (category === "Excluded") continue;

    const id = `yelp-${yelpBusiness.id}`;
    const name = yelpBusiness.name;
    const address = yelpBusiness.location?.display_address?.join(", ") || "Cumming, GA";
    const tags = (yelpBusiness.categories || []).map(cat => cat.title).filter(Boolean).slice(0, 5);
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

    // Fetch detailed business info (for hours)
    process.stdout.write(`\r[PROCESS] ${i + 1}/${results.length}: ${name.substring(0, 40).padEnd(40)}...`);

    let hours = "Hours available on business page";
    let detailedImage = yelpBusiness.image_url;

    // Fetch details for better hours and images
    const details = await fetchYelpBusinessDetails(yelpBusiness.id);
    if (details) {
      hours = formatYelpHours(details.hours);
      if (details.photos && details.photos.length > 0) {
        detailedImage = details.photos[0];
      }
      detailsCount++;
    }

    // Download image locally
    let localImagePath = null;
    if (detailedImage) {
      const imageFilename = `${yelpBusiness.id}.jpg`;
      localImagePath = await downloadImage(detailedImage, imageFilename);
      if (localImagePath) imageCount++;
    }

    const business = {
      id,
      yelpId: yelpBusiness.id,
      name,
      category,
      rating: 0, // Local reviews start at 0
      reviewCount: 0,
      yelpRating: yelpBusiness.rating,
      yelpReviewCount: yelpBusiness.review_count,
      description: categoryLabel
        ? `Local ${categoryLabel.toLowerCase()} in Cumming, Georgia.`
        : `Local ${category.toLowerCase()} business in Cumming, Georgia.`,
      address,
      phone: yelpBusiness.display_phone || "Phone not available",
      hours,
      image: detailedImage || null, // Original URL for fallback
      localImage: localImagePath, // Local filename
      deal: getMockDealSync(category, name),
      tags,
      priceRange: yelpBusiness.price || "$$",
      website: yelpBusiness.url,
      isOpenNow: yelpBusiness.is_closed === false ? true : undefined,
      googleMapsUrl,
      lat,
      lon,
      reviews: [],
      relevancyScore,
      isChain: isChainBusiness(name)
    };

    transformedBusinesses.push(business);

    // Rate limiting between detail fetches
    await new Promise(r => setTimeout(r, 200));
  }

  console.log(""); // New line after progress
  console.log("");

  // Sort by relevancy
  transformedBusinesses.sort((a, b) => b.relevancyScore - a.relevancyScore);

  // Save businesses data
  console.log("[INFO] Saving business data...");
  fs.writeFileSync(BUSINESSES_FILE, JSON.stringify(transformedBusinesses, null, 2));

  // Save metadata
  const metadata = {
    seedDate: new Date().toISOString(),
    seedDateFormatted: new Date().toLocaleString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short'
    }),
    totalBusinesses: transformedBusinesses.length,
    businessesWithImages: imageCount,
    businessesWithDetails: detailsCount,
    byCategory: {
      Food: transformedBusinesses.filter(b => b.category === "Food").length,
      Retail: transformedBusinesses.filter(b => b.category === "Retail").length,
      Services: transformedBusinesses.filter(b => b.category === "Services").length
    },
    location: {
      city: "Cumming",
      state: "Georgia",
      lat: CUMMING_GA_LAT,
      lon: CUMMING_GA_LON,
      radius: "10 miles"
    }
  };

  fs.writeFileSync(METADATA_FILE, JSON.stringify(metadata, null, 2));

  // Summary
  console.log("");
  console.log("========================================");
  console.log("  Seeding Complete!");
  console.log("========================================");
  console.log("");
  console.log(`  Total Businesses: ${transformedBusinesses.length}`);
  console.log(`  - Food:     ${metadata.byCategory.Food}`);
  console.log(`  - Retail:   ${metadata.byCategory.Retail}`);
  console.log(`  - Services: ${metadata.byCategory.Services}`);
  console.log("");
  console.log(`  Images Downloaded: ${imageCount}`);
  console.log(`  Details Fetched:   ${detailsCount}`);
  console.log("");
  console.log(`  Data saved to: ${DATA_DIR}`);
  console.log(`  Seed timestamp: ${metadata.seedDateFormatted}`);
  console.log("");
  console.log("  To run in offline mode:");
  console.log("    npm run start:offline");
  console.log("");
  console.log("========================================");
}

// Run the seeding
seedData().catch(error => {
  console.error("[FATAL] Seeding failed:", error);
  process.exit(1);
});
