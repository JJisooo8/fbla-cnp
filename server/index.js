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
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Cache for OpenStreetMap API responses (TTL: 1 hour)
const cache = new NodeCache({ stdTTL: 3600 });

// Path to persistent review storage
// In Vercel, use /tmp for writable storage, otherwise use __dirname
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

// Store local reviews for businesses (keyed by business id)
const localReviews = loadReviews();

// Store verification challenges in memory (in production, use Redis or database)
const verificationChallenges = new Map();

// Cumming, Georgia coordinates and search radius
const CUMMING_GA_LAT = 34.2073;
const CUMMING_GA_LON = -84.1402;
const SEARCH_RADIUS_METERS = 16093; // 10 miles in meters

const YELP_API_BASE_URL = "https://api.yelp.com/v3";
const YELP_API_KEY = process.env.YELP_API_KEY;
const GOOGLE_SEARCH_API_KEY = process.env.GOOGLE_SEARCH_API_KEY;
const GOOGLE_SEARCH_ENGINE_ID = process.env.GOOGLE_SEARCH_ENGINE_ID;

// reCAPTCHA configuration
const RECAPTCHA_SECRET_KEY = process.env.RECAPTCHA_SECRET_KEY;
const RECAPTCHA_ENABLED = !!RECAPTCHA_SECRET_KEY;

const imageCache = new NodeCache({ stdTTL: 86400 });

// Verify reCAPTCHA token with Google
async function verifyRecaptcha(token) {
  if (!RECAPTCHA_ENABLED) {
    return { success: true, fallback: true }; // Fallback to math challenge if not configured
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

// ====================
// HELPER FUNCTIONS
// ====================

// Map OSM amenity/shop tags to our categories
function mapOSMTypeToCategory(tags) {
  const { amenity, shop, leisure, tourism, craft } = tags;

  // Food category
  const foodAmenities = ['restaurant', 'cafe', 'fast_food', 'bar', 'pub', 'food_court', 'ice_cream', 'biergarten'];
  const foodShops = ['bakery', 'butcher', 'cheese', 'chocolate', 'coffee', 'confectionery', 'deli', 'farm', 'seafood', 'spices', 'tea', 'wine', 'alcohol', 'beverages'];

  if (foodAmenities.includes(amenity) || foodShops.includes(shop)) {
    return 'Food';
  }

  // Retail category
  const retailShops = ['supermarket', 'convenience', 'department_store', 'general', 'mall', 'clothes', 'shoes', 'jewelry', 'books', 'gift', 'furniture', 'electronics', 'mobile_phone', 'computer', 'toys', 'sports', 'bicycle', 'car', 'florist', 'garden_centre', 'pet', 'hardware', 'art', 'variety_store', 'cosmetics', 'doityourself', 'stationery'];

  if (retailShops.includes(shop)) {
    return 'Retail';
  }

  // Services category
  const serviceAmenities = ['pharmacy', 'clinic', 'dentist', 'doctors', 'hospital', 'veterinary', 'bank', 'post_office', 'fuel', 'charging_station', 'car_wash', 'car_rental', 'bicycle_rental'];
  const serviceCraft = ['carpenter', 'electrician', 'gardener', 'hvac', 'painter', 'plumber', 'shoemaker', 'tailor'];
  const serviceShops = ['hairdresser', 'beauty', 'laundry', 'dry_cleaning', 'travel_agency', 'estate_agent'];

  if (serviceAmenities.includes(amenity) || serviceCraft.includes(craft) || serviceShops.includes(shop)) {
    return 'Services';
  }

  // Leisure/Tourism can be categorized
  if (leisure || tourism) {
    return 'Services';
  }

  return 'Other';
}

// Get category-appropriate image
function getCategoryImage(category, tags) {
  const { amenity, shop, cuisine, leisure } = tags;

  // Food images based on type
  if (category === 'Food') {
    if (amenity === 'cafe' || shop === 'coffee') return 'https://images.unsplash.com/photo-1554118811-1e0d58224f24?w=400';
    if (amenity === 'restaurant') {
      if (cuisine === 'pizza') return 'https://images.unsplash.com/photo-1513104890138-7c749659a591?w=400';
      if (cuisine === 'italian') return 'https://images.unsplash.com/photo-1498579150354-977475b7ea0b?w=400';
      if (cuisine === 'asian' || cuisine === 'chinese' || cuisine === 'japanese') return 'https://images.unsplash.com/photo-1580822184713-fc5400e7fe10?w=400';
      if (cuisine === 'mexican') return 'https://images.unsplash.com/photo-1565299585323-38d6b0865b47?w=400';
      return 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=400';
    }
    if (amenity === 'fast_food') return 'https://images.unsplash.com/photo-1561758033-d89a9ad46330?w=400';
    if (amenity === 'bar' || amenity === 'pub') return 'https://images.unsplash.com/photo-1514933651103-005eec06c04b?w=400';
    if (shop === 'bakery') return 'https://images.unsplash.com/photo-1486427944299-d1955d23e34d?w=400';
    return 'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=400';
  }

  // Retail images
  if (category === 'Retail') {
    if (shop === 'books') return 'https://images.unsplash.com/photo-1507842217343-583bb7270b66?w=400';
    if (shop === 'clothes' || shop === 'shoes') return 'https://images.unsplash.com/photo-1441984904996-e0b6ba687e04?w=400';
    if (shop === 'supermarket' || shop === 'convenience') return 'https://images.unsplash.com/photo-1578916171728-46686eac8d58?w=400';
    if (shop === 'florist' || shop === 'garden_centre') return 'https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=400';
    if (shop === 'electronics' || shop === 'mobile_phone' || shop === 'computer') return 'https://images.unsplash.com/photo-1491933382434-500287f9b54b?w=400';
    if (shop === 'pet') return 'https://images.unsplash.com/photo-1548681528-6a5c45b66b42?w=400';
    if (shop === 'furniture') return 'https://images.unsplash.com/photo-1538688525198-9b88f6f53126?w=400';
    return 'https://images.unsplash.com/photo-1472851294608-062f824d29cc?w=400';
  }

  // Services images
  if (category === 'Services') {
    if (amenity === 'pharmacy') return 'https://images.unsplash.com/photo-1587854692152-cbe660dbde88?w=400';
    if (amenity === 'dentist' || amenity === 'doctors' || amenity === 'clinic') return 'https://images.unsplash.com/photo-1519494026892-80bbd2d6fd0d?w=400';
    if (shop === 'hairdresser' || shop === 'beauty') return 'https://images.unsplash.com/photo-1560066984-138dadb4c035?w=400';
    if (amenity === 'fuel' || amenity === 'car_wash') return 'https://images.unsplash.com/photo-1545158535-c3f7168c28b6?w=400';
    if (leisure === 'fitness_centre') return 'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=400';
    return 'https://images.unsplash.com/photo-1581092918056-0c4c3acd3789?w=400';
  }

  return 'https://images.unsplash.com/photo-1556761175-b413da4baf72?w=400';
}

// Format opening hours from OSM format
function formatOpeningHours(openingHours) {
  if (!openingHours) return 'Hours not available';

  // OSM opening_hours can be complex, we'll simplify it
  // Examples: "Mo-Fr 09:00-17:00", "24/7", "Mo-Su 08:00-20:00"
  if (openingHours === '24/7') return 'Open 24 hours';

  // For complex formats, just return as-is
  return openingHours;
}

// Check if business is currently open
function isOpenNow(openingHours) {
  if (!openingHours) return undefined;
  if (openingHours === '24/7') return true;

  // Simplified check - in production, use a proper opening hours library
  // For now, we'll return undefined (unknown)
  return undefined;
}

// Generate deterministic mock deals for demo purposes
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

  const seed = crypto
    .createHash("md5")
    .update(`${category}-${name}`)
    .digest("hex");
  const roll = parseInt(seed.slice(0, 2), 16);

  if (roll % 5 !== 0) {
    return null;
  }

  const options = dealsByCategory[category] || dealsByCategory.Services;
  return options[roll % options.length];
}

const CATEGORY_ALIASES = {
  Food: [
    "restaurants",
    "food",
    "cafes",
    "coffee",
    "bakeries",
    "desserts",
    "bars",
    "icecream",
    "pizza",
    "cuban",
    "mexican",
    "italian",
    "chinese",
    "japanese",
    "thai",
    "vietnamese",
    "korean",
    "indian",
    "mediterranean",
    "greek",
    "american",
    "southern",
    "bbq",
    "seafood",
    "sushi",
    "burgers",
    "sandwiches",
    "delis",
    "breakfast_brunch",
    "brunch",
    "diners",
    "steakhouses",
    "tacos",
    "tex-mex",
    "latin",
    "caribbean",
    "asianfusion",
    "newamerican",
    "tradamerican",
    "fastfood",
    "hotdogs",
    "chicken_wings",
    "chickenshop",
    "beer_and_wine",
    "wine_bars",
    "sportsbars",
    "pubs",
    "cocktailbars",
    "beerbar",
    "breweries",
    "distilleries",
    "wineries",
    "juicebars",
    "bubbletea",
    "tea",
    "donuts",
    "bagels",
    "acaibowls",
    "creperies",
    "gelato",
    "froyo",
    "candy",
    "chocolate",
    "ethnic_food",
    "foodtrucks",
    "streetvendors",
    "cheesesteaks",
    "cajun",
    "soulfood",
    "waffles",
    "pancakes"
  ],
  Retail: [
    "shopping",
    "fashion",
    "departmentstores",
    "grocery",
    "bookstores",
    "giftshops",
    "electronics",
    "furniture"
  ],
  Services: [
    "homedocservices",
    "auto",
    "health",
    "beautysvc",
    "fitness",
    "education",
    "professional"
  ]
};

// Categories to exclude (parks, public services, etc.)
const EXCLUDED_YELP_CATEGORIES = [
  "parks",
  "playgrounds",
  "dog_parks",
  "publicservicesgovt",
  "landmarks",
  "hiking",
  "beaches",
  "lakes",
  "campgrounds",
  "publicgardens",
  "communitycenters",
  "libraries",
  "museums",
  "religiousorgs",
  "churches"
];

function normalizeName(value) {
  return (value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function haversineDistanceMeters(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function mapYelpCategoriesToCategory(categories = []) {
  const aliases = categories.map(cat => cat.alias);

  // Check if any category is in the excluded list
  if (aliases.some(alias => EXCLUDED_YELP_CATEGORIES.includes(alias))) {
    return "Excluded";
  }

  if (aliases.some(alias => CATEGORY_ALIASES.Food.includes(alias))) return "Food";
  if (aliases.some(alias => CATEGORY_ALIASES.Retail.includes(alias))) return "Retail";
  if (aliases.some(alias => CATEGORY_ALIASES.Services.includes(alias))) return "Services";

  // Default to Food for anything restaurant-like or food-related
  // Check category titles for food-related keywords
  const titles = categories.map(cat => (cat.title || '').toLowerCase());
  const foodKeywords = ['restaurant', 'food', 'cafe', 'diner', 'grill', 'kitchen', 'eatery', 'bistro', 'tavern', 'bar', 'pub', 'pizza', 'burger', 'taco', 'sushi', 'bbq', 'bakery', 'coffee', 'tea', 'juice', 'smoothie', 'ice cream', 'dessert', 'breakfast', 'brunch', 'lunch', 'dinner', 'cuisine', 'cuban', 'mexican', 'italian', 'chinese', 'japanese', 'thai', 'indian', 'korean', 'vietnamese', 'mediterranean', 'greek', 'american', 'southern', 'cajun', 'seafood', 'steakhouse', 'wings', 'chicken', 'sandwich', 'deli', 'brewery', 'winery', 'distillery'];

  if (titles.some(title => foodKeywords.some(keyword => title.includes(keyword)))) {
    return "Food";
  }

  return "Services";
}

function isExcludedYelpBusiness(categories = []) {
  const aliases = categories.map(cat => cat.alias);
  return aliases.some(alias => EXCLUDED_YELP_CATEGORIES.includes(alias));
}

function buildYelpTags(categories = []) {
  return categories.map(cat => cat.title).filter(Boolean);
}

function humanizeBusinessType(value) {
  if (!value) return "business";

  const replacements = {
    alcohol: "liquor store",
    fast_food: "fast food restaurant",
    food_court: "food court",
    cafe: "cafe",
    pub: "pub",
    bar: "bar",
    ice_cream: "ice cream shop",
    pharmacy: "pharmacy",
    hairdresser: "salon",
    beauty: "beauty studio",
    fuel: "gas station",
    car_wash: "car wash",
    convenience: "convenience store",
    supermarket: "supermarket",
    bakery: "bakery",
    butcher: "butcher shop",
    deli: "deli",
    florist: "florist",
    coffee: "coffee shop",
    clothes: "clothing store",
    shoes: "shoe store",
    jewelry: "jewelry store",
    gift: "gift shop"
  };

  const normalized = value.replace(/_/g, " ").toLowerCase();
  return replacements[value] || normalized;
}

function buildGenericDescription({
  type,
  cuisine,
  category
}) {
  const typeLabel = humanizeBusinessType(type);
  const cuisineLabel = cuisine ? cuisine.replace(/_/g, " ").toLowerCase() : null;
  const categoryLabel = category ? category.toLowerCase() : "local";

  if (cuisineLabel) {
    return `Local ${cuisineLabel} ${typeLabel} in Cumming, Georgia.`;
  }

  if (typeLabel !== "business") {
    return `Local ${typeLabel} in Cumming, Georgia.`;
  }

  return `Local ${categoryLabel} business in Cumming, Georgia.`;
}

function getLocalReviewSummary(id) {
  const localReviewsList = localReviews.get(id) || [];
  const reviewCount = localReviewsList.length;
  const rating = reviewCount > 0
    ? localReviewsList.reduce((sum, review) => sum + review.rating, 0) / reviewCount
    : 0;

  return { reviewCount, rating, reviews: [...localReviewsList] };
}

// Detect if a business is a major chain/franchise
function isChainBusiness(name, tags) {
  if (!name) return false;

  const nameLower = name.toLowerCase();

  // Major national/international chains to filter
  const chainKeywords = [
    'walmart', 'target', 'costco', 'publix', 'kroger', 'whole foods',
    'cvs', 'walgreens', 'rite aid', 'dollar general', 'dollar tree',
    'mcdonald', 'burger king', 'wendy', 'taco bell', 'kfc', 'subway',
    'starbucks', 'dunkin', 'chick-fil-a', 'chipotle', 'panera',
    'home depot', 'lowe', 'best buy', 'petsmart', 'petco',
    'tj maxx', 'marshalls', 'ross', 'old navy', 'gap',
    'shell', 'chevron', 'exxon', 'bp', 'mobil', 'marathon', 'circle k',
    'bank of america', 'wells fargo', 'chase', 'citibank',
    'at&t', 'verizon', 't-mobile', 'sprint',
    '7-eleven', 'circle k', 'speedway', 'wawa'
  ];

  // Check if name contains any chain keywords
  for (const keyword of chainKeywords) {
    if (nameLower.includes(keyword)) {
      return true;
    }
  }

  // Check for chain indicators in tags
  if (tags.brand && chainKeywords.some(k => tags.brand.toLowerCase().includes(k))) {
    return true;
  }

  return false;
}

// Calculate relevancy score for a business
// Higher scores = more relevant (local, family-owned, startups)
function calculateRelevancyScore(name, tags, reviewCount) {
  let score = 50; // Base score

  // MAJOR PENALTY: Chain businesses
  if (isChainBusiness(name, tags)) {
    score -= 50; // Penalty for chains (but not complete exclusion)
  }

  // BONUS: Craft businesses (likely family-owned)
  if (tags.craft) {
    score += 40; // Carpenters, electricians, plumbers are usually local
  }

  // BONUS: Independent indicators
  if (tags['brand:wikidata'] === undefined && tags.brand === undefined) {
    score += 20; // No brand tag suggests independent
  }

  // BONUS: Smaller operations (likely local)
  if (reviewCount < 50) {
    score += 15; // Newer or smaller businesses
  } else if (reviewCount < 100) {
    score += 10;
  } else if (reviewCount > 200) {
    score -= 5; // Very popular might indicate chain
  }

  // BONUS: Family/local keywords in name
  const nameLower = (name || '').toLowerCase();
  const localKeywords = ['family', 'local', 'hometown', 'mom', 'pop', '& son', '& daughter', 'brothers', 'sisters'];
  if (localKeywords.some(k => nameLower.includes(k))) {
    score += 30;
  }

  // BONUS: Personal names in business (Joe's, Maria's, Smith's)
  if (nameLower.match(/\w+'s\s/) || nameLower.match(/^[A-Z][a-z]+'s/)) {
    score += 25;
  }

  // BONUS: Specific local business types
  const shopType = tags.shop || '';
  const amenityType = tags.amenity || '';

  // Local favorites
  if (['deli', 'butcher', 'bakery', 'farm', 'cheese', 'chocolate', 'confectionery', 'coffee', 'tea'].includes(shopType)) {
    score += 15;
  }

  if (['cafe', 'restaurant'].includes(amenityType) && !isChainBusiness(name, tags)) {
    score += 15;
  }

  // BONUS: Has website (shows professionalism for small business)
  if (tags.website || tags['contact:website']) {
    score += 10;
  }

  // PENALTY: Parking lots, ATMs, vending machines (not real businesses)
  if (amenityType === 'parking' || amenityType === 'atm' || amenityType === 'vending_machine') {
    score -= 200; // Essentially exclude these
  }

  // PENALTY: Utilities and infrastructure
  if (amenityType === 'fuel' && !tags.shop) {
    score -= 10; // Gas stations are less interesting unless they have a shop
  }

  return score;
}

// Transform OSM data to our business format
function transformOSMToBusiness(osmElement) {
  const tags = osmElement.tags || {};
  const category = mapOSMTypeToCategory(tags);

  // Generate a consistent ID from OSM id
  const id = `osm-${osmElement.id}`;

  // Get name or use type as fallback
  const name = tags.name || tags['name:en'] || tags.amenity || tags.shop || 'Local Business';

  // Build description
  let description = tags.description || '';
  if (!description) {
    const type = tags.amenity || tags.shop || tags.craft || tags.tourism || 'business';
    description = buildGenericDescription({
      type,
      cuisine: tags.cuisine,
      category
    });
  }

  // Address
  const address = tags['addr:full'] ||
    [tags['addr:housenumber'], tags['addr:street'], tags['addr:city'], tags['addr:state'], tags['addr:postcode']]
      .filter(Boolean).join(', ') ||
    'Cumming, GA';

  // Build tags array
  const businessTags = [];
  if (tags.cuisine) businessTags.push(tags.cuisine);
  if (tags.amenity) businessTags.push(tags.amenity.replace(/_/g, ' '));
  if (tags.shop) businessTags.push(tags.shop.replace(/_/g, ' '));
  if (tags.outdoor_seating === 'yes') businessTags.push('Outdoor Seating');
  if (tags.wifi === 'yes' || tags.wifi === 'free') businessTags.push('WiFi');
  if (tags.wheelchair === 'yes') businessTags.push('Wheelchair Accessible');
  if (tags.takeaway === 'yes') businessTags.push('Takeout');
  if (tags.delivery === 'yes') businessTags.push('Delivery');

  const localReviewSummary = getLocalReviewSummary(id);
  const reviewCount = localReviewSummary.reviewCount;

  // Generate Google Maps URL for directions
  const lat = osmElement.lat || osmElement.center?.lat;
  const lon = osmElement.lon || osmElement.center?.lon;
  const googleMapsUrl = lat && lon
    ? `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name + ' ' + address)}`;

  const business = {
    id,
    name,
    category,
    rating: localReviewSummary.rating,
    reviewCount: localReviewSummary.reviewCount,
    description,
    address,
    phone: tags.phone || tags['contact:phone'] || 'Phone not available',
    hours: formatOpeningHours(tags.opening_hours),
    image: getCategoryImage(category, tags),
    deal: getMockDeal(category, name),
    tags: businessTags.slice(0, 5),
    priceRange: '$$', // OSM doesn't have price info
    website: tags.website || tags['contact:website'] || null,
    isOpenNow: isOpenNow(tags.opening_hours),
    googleMapsUrl,
    osmId: osmElement.id,
    lat,
    lon,
    reviews: [],
    relevancyScore: calculateRelevancyScore(name, tags, reviewCount),
    isChain: isChainBusiness(name, tags)
  };

  // Add local reviews if any
  business.reviews = localReviewSummary.reviews;

  return business;
}

function transformYelpToBusiness(yelpBusiness) {
  // Check if this business should be excluded (parks, public services, etc.)
  if (isExcludedYelpBusiness(yelpBusiness.categories)) {
    return null; // Will be filtered out
  }

  const category = mapYelpCategoriesToCategory(yelpBusiness.categories);

  // Double-check: if category is Excluded, return null
  if (category === "Excluded") {
    return null;
  }

  const tags = buildYelpTags(yelpBusiness.categories);
  const name = yelpBusiness.name;
  const address = yelpBusiness.location?.display_address?.join(", ") || "Cumming, GA";

  const localReviewSummary = getLocalReviewSummary(`yelp-${yelpBusiness.id}`);

  const relevancyScore = calculateRelevancyScore(
    name,
    {
      amenity: category === "Food" ? "restaurant" : undefined,
      shop: category === "Retail" ? "shop" : undefined,
      craft: category === "Services" ? "service" : undefined,
      website: yelpBusiness.url
    },
    0
  );

  const categoryLabel = yelpBusiness.categories
    ?.map(categoryItem => categoryItem.title)
    .filter(Boolean)
    .slice(0, 2)
    .join(" & ");

  const description = categoryLabel
    ? `Local ${categoryLabel.toLowerCase()} in Cumming, Georgia.`
    : buildGenericDescription({ category });

  // Generate Google Maps URL for directions
  const lat = yelpBusiness.coordinates?.latitude;
  const lon = yelpBusiness.coordinates?.longitude;
  const googleMapsUrl = lat && lon
    ? `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name + ' ' + address)}`;

  return {
    id: `yelp-${yelpBusiness.id}`,
    yelpId: yelpBusiness.id,
    name,
    category,
    rating: localReviewSummary.rating,
    reviewCount: localReviewSummary.reviewCount,
    description: categoryLabel
      ? `Local ${categoryLabel.toLowerCase()} in Cumming, Georgia.`
      : buildGenericDescription({ category }),
    address,
    phone: yelpBusiness.display_phone || "Phone not available",
    hours: "Hours available on business page",
    image: yelpBusiness.image_url || getCategoryImage(category, {}),
    deal: getMockDeal(category, name),
    tags: tags.slice(0, 5),
    priceRange: yelpBusiness.price || "$$",
    website: yelpBusiness.url,
    isOpenNow: yelpBusiness.is_closed === false ? true : undefined,
    googleMapsUrl,
    osmId: null,
    lat,
    lon,
    reviews: localReviewSummary.reviews,
    relevancyScore,
    isChain: isChainBusiness(name, { brand: yelpBusiness.brand })
  };
}

async function fetchYelpBusinesses() {
  if (!YELP_API_KEY) {
    console.warn("⚠️  Yelp API key not set. Skipping Yelp enrichment.");
    return [];
  }

  const results = [];
  const limit = 50;
  const totalWanted = 300;

  try {
    for (let offset = 0; offset < totalWanted; offset += limit) {
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

      if (businesses.length < limit) {
        break;
      }
    }
  } catch (error) {
    console.error("Error fetching Yelp businesses:", error.message);
  }

  return results;
}

async function fetchBusinesses() {
  try {
    return await fetchOSMBusinesses();
  } catch (error) {
    console.error("⚠️  Falling back to Yelp-only data:", error.message);
  }

  const yelpBusinesses = await fetchYelpBusinesses();
  return yelpBusinesses
    .map(transformYelpToBusiness)
    .filter(biz => biz !== null) // Filter out excluded businesses (parks, public services, etc.)
    .sort((a, b) => b.relevancyScore - a.relevancyScore)
    .slice(0, 300);
}

function mergeBusinesses(osmBusinesses, yelpBusinesses) {
  const usedYelpIds = new Set();
  const normalizedYelp = yelpBusinesses.map(biz => ({
    raw: biz,
    normalizedName: normalizeName(biz.name),
    lat: biz.coordinates?.latitude,
    lon: biz.coordinates?.longitude
  }));

  const merged = osmBusinesses.map(osm => {
    const osmName = normalizeName(osm.name);
    let bestMatch = null;
    let bestDistance = Infinity;

    for (const candidate of normalizedYelp) {
      if (!candidate.lat || !candidate.lon) continue;
      if (usedYelpIds.has(candidate.raw.id)) continue;

      const distance = haversineDistanceMeters(
        osm.lat,
        osm.lon,
        candidate.lat,
        candidate.lon
      );

      if (distance > 500) continue; // ~0.3 miles

      const matchesName =
        candidate.normalizedName.includes(osmName) ||
        osmName.includes(candidate.normalizedName);

      if (matchesName && distance < bestDistance) {
        bestMatch = candidate.raw;
        bestDistance = distance;
      }
    }

    if (!bestMatch) {
      return osm;
    }

    usedYelpIds.add(bestMatch.id);
    const yelpTransformed = transformYelpToBusiness(bestMatch);

    // If Yelp business was excluded (parks, etc.), just return the OSM data
    if (!yelpTransformed) {
      return osm;
    }

    return {
      ...osm,
      name: yelpTransformed.name || osm.name,
      category: yelpTransformed.category || osm.category,
      rating: yelpTransformed.rating || osm.rating,
      reviewCount: yelpTransformed.reviewCount || osm.reviewCount,
      phone: yelpTransformed.phone || osm.phone,
      address: yelpTransformed.address || osm.address,
      image: yelpTransformed.image || osm.image,
      priceRange: yelpTransformed.priceRange || osm.priceRange,
      website: osm.website || yelpTransformed.website,
      googleMapsUrl: osm.googleMapsUrl || yelpTransformed.googleMapsUrl,
      tags: Array.from(new Set([...(osm.tags || []), ...(yelpTransformed.tags || [])])).slice(0, 5),
      deal: osm.deal || yelpTransformed.deal,
      lat: yelpTransformed.lat || osm.lat,
      lon: yelpTransformed.lon || osm.lon,
      yelpId: bestMatch.id
    };
  });

  const yelpOnly = yelpBusinesses
    .filter(biz => !usedYelpIds.has(biz.id))
    .map(transformYelpToBusiness)
    .filter(biz => biz !== null); // Filter out excluded businesses

  return [...merged, ...yelpOnly];
}

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

async function fetchYelpReviews(yelpId) {
  if (!YELP_API_KEY || !yelpId) return [];

  try {
    const response = await axios.get(`${YELP_API_BASE_URL}/businesses/${yelpId}/reviews`, {
      headers: { Authorization: `Bearer ${YELP_API_KEY}` },
      timeout: 15000
    });

    return (response.data.reviews || []).map(review => ({
      id: review.id,
      author: review.user?.name || "Yelp Reviewer",
      rating: review.rating,
      comment: review.text,
      date: review.time_created,
      helpful: 0,
      source: "yelp"
    }));
  } catch (error) {
    console.error("Error fetching Yelp reviews:", error.message);
    return [];
  }
}

function formatYelpHours(hours = []) {
  if (!hours.length) return "Hours not available";

  const dayMap = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const ranges = hours[0].open || [];
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

async function fetchGoogleImage(query) {
  if (!GOOGLE_SEARCH_API_KEY || !GOOGLE_SEARCH_ENGINE_ID || !query) {
    return null;
  }

  const cached = imageCache.get(query);
  if (cached) {
    return cached;
  }

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
      timeout: 15000
    });

    const result = response.data?.items?.[0]?.link || null;
    if (result) {
      imageCache.set(query, result);
    }
    return result;
  } catch (error) {
    console.error("Error fetching Google image:", error.message);
    return null;
  }
}

async function enrichBusinessImages(businesses) {
  const enriched = [];

  for (const business of businesses) {
    if (business.image) {
      enriched.push(business);
      continue;
    }

    const imageQuery = `${business.name} ${business.address || "Cumming GA"}`;
    const image = await fetchGoogleImage(imageQuery);
    enriched.push({
      ...business,
      image: image || getCategoryImage(business.category, {})
    });
  }

  return enriched;
}

// Fetch businesses from OpenStreetMap using Overpass API
async function fetchOSMBusinesses(lat = CUMMING_GA_LAT, lon = CUMMING_GA_LON, radius = SEARCH_RADIUS_METERS) {
  const cacheKey = `osm:${lat}:${lon}:${radius}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log('📦 Returning cached OSM results');
    return cached;
  }

  try {
    // Overpass QL query to get businesses
    // Exclude parking lots, ATMs, and other non-businesses
    const query = `
      [out:json][timeout:25];
      (
        node["amenity"]["amenity"!="parking"]["amenity"!="atm"]["amenity"!="vending_machine"]["amenity"!="bench"]["amenity"!="waste_basket"](around:${radius},${lat},${lon});
        way["amenity"]["amenity"!="parking"]["amenity"!="atm"]["amenity"!="vending_machine"]["amenity"!="bench"]["amenity"!="waste_basket"](around:${radius},${lat},${lon});
        node["shop"](around:${radius},${lat},${lon});
        way["shop"](around:${radius},${lat},${lon});
        node["craft"](around:${radius},${lat},${lon});
        way["craft"](around:${radius},${lat},${lon});
        node["tourism"~"hotel|motel|guest_house|hostel|museum|attraction"](around:${radius},${lat},${lon});
        way["tourism"~"hotel|motel|guest_house|hostel|museum|attraction"](around:${radius},${lat},${lon});
      );
      out center tags;
    `;

    const response = await axios.post(
      'https://overpass-api.de/api/interpreter',
      query,
      {
        headers: { 'Content-Type': 'text/plain' },
        timeout: 30000
      }
    );

    const elements = response.data.elements || [];
    console.log(`✅ Fetched ${elements.length} businesses from OpenStreetMap`);

    // Transform and filter businesses
    const businesses = elements
      .filter(el => el.tags && (el.tags.name || el.tags.amenity || el.tags.shop))
      .map(el => transformOSMToBusiness(el))
      .filter(b => b.category !== 'Other') // Filter out uncategorized
      .filter(b => b.relevancyScore > -150); // Filter out only non-businesses (parking, ATMs, etc.)

    // Sort by relevancy score (highest first) to prioritize local/family-owned
    businesses.sort((a, b) => b.relevancyScore - a.relevancyScore);

    // Increase limit to 300 to include some chains for searchability
    const limitedBusinesses = businesses.slice(0, 300);

    const chainCount = limitedBusinesses.filter(b => b.isChain).length;
    const localCount = limitedBusinesses.filter(b => !b.isChain).length;

    console.log(`📊 Filtered to ${limitedBusinesses.length} relevant businesses`);
    console.log(`🎯 Top business: ${limitedBusinesses[0]?.name} (score: ${limitedBusinesses[0]?.relevancyScore})`);
    console.log(`🏪 ${localCount} local businesses, ${chainCount} chains`);

    const yelpBusinesses = await fetchYelpBusinesses();
    const mergedBusinesses = mergeBusinesses(
      limitedBusinesses,
      yelpBusinesses
    );

    const mergedLimited = mergedBusinesses
      .sort((a, b) => b.relevancyScore - a.relevancyScore)
      .slice(0, 300);

    cache.set(cacheKey, mergedLimited);
    return mergedLimited;
  } catch (error) {
    console.error('❌ OpenStreetMap API error:', error.message);
    throw new Error('Failed to fetch businesses');
  }
}

// Utility: Generate simple math challenge for spam prevention
function generateChallenge() {
  const a = Math.floor(Math.random() * 10) + 1;
  const b = Math.floor(Math.random() * 10) + 1;
  const id = crypto.randomUUID();
  const answer = a + b;

  verificationChallenges.set(id, { answer, expires: Date.now() + 300000 }); // 5 min expiry

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

// Health check
app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    message: "Server is healthy",
    dataSource: "OpenStreetMap + Yelp (if configured)",
    location: "Cumming, Georgia",
    radius: "10 miles"
  });
});

// Get all businesses with optional filters and search
app.get("/api/businesses", async (req, res) => {
  try {
    const {
      category,
      tag,
      search,
      minRating,
      hasDeals,
      sort,
      limit
    } = req.query;

    // Fetch businesses from OpenStreetMap (Cumming, GA only)
    const businesses = await fetchBusinesses();
    let result = [...businesses];

    // Filter by category
    if (category && category !== "All") {
      result = result.filter(b => b.category === category);
    }

    // Filter by specific tag (from dropdown)
    if (tag && tag !== "All") {
      const tagLower = tag.toLowerCase();
      result = result.filter(b =>
        b.tags.some(t => t.toLowerCase() === tagLower)
      );
    }

    // Filter by minimum rating
    if (minRating) {
      const min = parseFloat(minRating);
      if (!isNaN(min)) {
        result = result.filter(b => b.rating >= min);
      }
    }

    // Filter by deals (will filter out most since OSM doesn't have deals)
    if (hasDeals === "true") {
      result = result.filter(b => b.deal !== null);
    }

    // Search functionality
    if (search && search.trim()) {
      const searchLower = search.toLowerCase().trim();
      result = result.filter(b =>
        b.name.toLowerCase().includes(searchLower) ||
        b.description.toLowerCase().includes(searchLower) ||
        b.tags.some(tag => tag.toLowerCase().includes(searchLower)) ||
        b.category.toLowerCase().includes(searchLower)
      );
    }

    // Sorting
    if (sort === "rating") {
      result.sort((a, b) => b.rating - a.rating);
    } else if (sort === "reviews") {
      result.sort((a, b) => b.reviewCount - a.reviewCount);
    } else if (sort === "name") {
      result.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sort === "local") {
      result.sort((a, b) => b.relevancyScore - a.relevancyScore);
    }

    const limitValue = limit ? parseInt(limit, 10) : null;
    if (limitValue && Number.isFinite(limitValue)) {
      result = result.slice(0, Math.max(1, limitValue));
    }

    if (GOOGLE_SEARCH_API_KEY && GOOGLE_SEARCH_ENGINE_ID) {
      result = await enrichBusinessImages(result);
    }

    res.json(result);
  } catch (error) {
    console.error('Error in /api/businesses:', error);
    res.status(500).json({ error: error.message || "Failed to fetch businesses" });
  }
});

// Get single business by ID
app.get("/api/businesses/:id", async (req, res) => {
  try {
    const businessId = req.params.id;

    // Fetch all businesses and find the one
    const businesses = await fetchBusinesses();
    const business = businesses.find(b => b.id === businessId);

    if (!business) {
      return res.status(404).json({ error: "Business not found" });
    }

    if (business.yelpId) {
      const details = await fetchYelpBusinessDetails(business.yelpId);

      if (details) {
        business.hours = formatYelpHours(details.hours);
        business.image = details.photos?.[0] || business.image;
        business.website = business.website || details.url;
      }
    }

    if (!business.image) {
      const imageQuery = `${business.name} ${business.address || "Cumming GA"}`;
      business.image = await fetchGoogleImage(imageQuery);
    }

    if (!business.image) {
      business.image = getCategoryImage(business.category, {});
    }

    // Always get fresh reviews for the detail view
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

// Get verification configuration (whether reCAPTCHA is enabled)
app.get("/api/verification/config", (req, res) => {
  res.json({
    recaptchaEnabled: RECAPTCHA_ENABLED,
    recaptchaSiteKey: process.env.RECAPTCHA_SITE_KEY || null
  });
});

// Get verification challenge (fallback when reCAPTCHA is not configured)
app.get("/api/verification/challenge", (req, res) => {
  try {
    const challenge = generateChallenge();
    res.json(challenge);
  } catch (error) {
    res.status(500).json({ error: "Failed to generate challenge" });
  }
});

// Submit a local review with verification (supports reCAPTCHA or math challenge)
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

    // Verify anti-spam: Try reCAPTCHA first, fall back to math challenge
    if (RECAPTCHA_ENABLED && recaptchaToken) {
      // Verify reCAPTCHA token
      const recaptchaResult = await verifyRecaptcha(recaptchaToken);
      if (!recaptchaResult.success) {
        return res.status(400).json({ error: "reCAPTCHA verification failed. Please try again." });
      }
    } else {
      // Fall back to math challenge verification
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

      // Remove used challenge
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

    // Store local review
    const reviews = localReviews.get(businessId) || [];
    reviews.push(review);
    localReviews.set(businessId, reviews);

    // Save reviews to persistent storage
    saveReviews();

    // Clear cache so next fetch gets fresh data
    cache.flushAll();

    res.status(201).json({
      message: "Review submitted successfully",
      review
    });
  } catch (error) {
    console.error('Error submitting review:', error);
    res.status(500).json({ error: "Failed to submit review" });
  }
});

// Get recommendations based on user's favorite categories
app.post("/api/recommendations", async (req, res) => {
  try {
    const {
      favoriteIds = [],
      preferredCategories = []
    } = req.body;

    // Fetch all businesses from OSM
    const businesses = await fetchBusinesses();

    // If user has favorites, analyze their preferences
    let categoryScores = {};

    if (favoriteIds.length > 0) {
      favoriteIds.forEach(id => {
        const business = businesses.find(b => b.id === id);
        if (business) {
          categoryScores[business.category] = (categoryScores[business.category] || 0) + 1;
        }
      });
    }

    // Add explicitly preferred categories
    preferredCategories.forEach(cat => {
      categoryScores[cat] = (categoryScores[cat] || 0) + 2;
    });

    // Score all businesses
    const scored = businesses
      .filter(b => !favoriteIds.includes(b.id)) // Exclude already favorited
      .map(b => {
        let score = 0;

        // Category preference
        score += (categoryScores[b.category] || 0) * 10;

        // High rating bonus
        if (b.rating >= 4.7) score += 15;
        else if (b.rating >= 4.5) score += 10;

        // Has deals bonus
        if (b.deal) score += 5;

        // Popular (many reviews) bonus
        if (b.reviewCount > 200) score += 8;
        else if (b.reviewCount > 100) score += 5;

        return { ...b, recommendationScore: score };
      })
      .sort((a, b) => b.recommendationScore - a.recommendationScore)
      .slice(0, 4); // Top 4 recommendations

    res.json(scored);
  } catch (error) {
    console.error('Error generating recommendations:', error);
    res.status(500).json({ error: error.message || "Failed to generate recommendations" });
  }
});

// Manually curated trending businesses
const TRENDING_BUSINESS_NAMES = [
  "Raising Cane's",
  "Kung Fu Tea",
  "Marlow's Tavern"
];

// Get trending/top businesses (manually curated)
app.get("/api/trending", async (req, res) => {
  try {
    const businesses = await fetchBusinesses();

    // Find the manually selected trending businesses
    const trending = [];
    for (const trendingName of TRENDING_BUSINESS_NAMES) {
      const match = businesses.find(b =>
        b.name.toLowerCase().includes(trendingName.toLowerCase()) ||
        trendingName.toLowerCase().includes(b.name.toLowerCase())
      );
      if (match) {
        trending.push(match);
      }
    }

    // If we couldn't find all 3, fill with top-rated non-chain businesses
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
    res.status(500).json({ error: error.message || "Failed to fetch trending businesses" });
  }
});

// Get unique tags for category filter dropdown
app.get("/api/tags", async (req, res) => {
  try {
    const businesses = await fetchBusinesses();

    // Collect all unique tags with their counts
    const tagCounts = {};
    businesses.forEach(b => {
      (b.tags || []).forEach(tag => {
        const normalizedTag = tag.toLowerCase().trim();
        if (normalizedTag && normalizedTag.length > 1) {
          tagCounts[normalizedTag] = (tagCounts[normalizedTag] || 0) + 1;
        }
      });
    });

    // Sort by count and filter to only include tags with at least 2 businesses
    const tags = Object.entries(tagCounts)
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .map(([tag, count]) => ({
        tag: tag.charAt(0).toUpperCase() + tag.slice(1), // Capitalize first letter
        count
      }));

    res.json(tags);
  } catch (error) {
    console.error('Error fetching tags:', error);
    res.status(500).json({ error: error.message || "Failed to fetch tags" });
  }
});

// Get analytics/stats
app.get("/api/analytics", async (req, res) => {
  try {
    // Fetch all businesses from OSM
    const businesses = await fetchBusinesses();

    const totalBusinesses = businesses.length;
    const avgRating = totalBusinesses > 0
      ? businesses.reduce((sum, b) => sum + b.rating, 0) / totalBusinesses
      : 0;

    const byCategory = businesses.reduce((acc, b) => {
      acc[b.category] = (acc[b.category] || 0) + 1;
      return acc;
    }, {});

    const totalByCategory = byCategory;

    const topRated = [...businesses]
      .sort((a, b) => b.rating - a.rating)
      .slice(0, 3)
      .map(b => ({ id: b.id, name: b.name, rating: b.rating }));

    const dealsAvailable = businesses.filter(b => b.deal).length;

    // Count total user reviews
    let totalUserReviews = 0;
    for (const reviews of localReviews.values()) {
      totalUserReviews += reviews.length;
    }

    // Count businesses with 4+ star ratings
    const topRatedCount = businesses.filter(b => b.rating >= 4).length;

    res.json({
      totalBusinesses,
      avgRating: Math.round(avgRating * 10) / 10,
      totalByCategory,
      byCategory,
      topRated,
      dealsAvailable,
      totalUserReviews,
      topRatedCount
    });
  } catch (error) {
    console.error('Error fetching analytics:', error);
    res.status(500).json({ error: error.message || "Failed to fetch analytics" });
  }
});

// Export app for Vercel serverless functions
export default app;

// Only start listening if running directly (not imported as a module)
// Check if this file is being run directly vs imported
const isMainModule = import.meta.url.endsWith(process.argv[1]) || 
                     process.argv[1]?.includes('server/index.js');

if (isMainModule && !process.env.VERCEL) {
  const PORT = 3001;
  app.listen(PORT, () => {
    console.log(`🚀 LocalLink API running on http://localhost:${PORT}`);
    console.log(`🗺️  Data Source: OpenStreetMap (FREE!)`);
    console.log(`📍 Location: Cumming, Georgia`);
    console.log(`📏 Search radius: 10 miles (${SEARCH_RADIUS_METERS} meters)`);
    console.log(`🧭 Yelp enrichment: ${YELP_API_KEY ? "enabled" : "disabled"}`);
    console.log(`🖼️  Google image search: ${GOOGLE_SEARCH_API_KEY && GOOGLE_SEARCH_ENGINE_ID ? "enabled" : "disabled"}`);
    console.log(`🔐 reCAPTCHA: ${RECAPTCHA_ENABLED ? "enabled" : "disabled (using math challenge)"}`);
  });
}
