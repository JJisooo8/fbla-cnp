import express from "express";
import cors from "cors";
import crypto from "crypto";
import axios from "axios";
import NodeCache from "node-cache";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

// Cache for OpenStreetMap API responses (TTL: 1 hour)
const cache = new NodeCache({ stdTTL: 3600 });

// Store local reviews for businesses (keyed by OSM id)
const localReviews = new Map();

// Store verification challenges in memory (in production, use Redis or database)
const verificationChallenges = new Map();

// Cumming, Georgia coordinates and search radius
const CUMMING_GA_LAT = 34.2073;
const CUMMING_GA_LON = -84.1402;
const SEARCH_RADIUS_METERS = 16093; // 10 miles in meters

// Yelp Fusion API configuration
const YELP_API_KEY = process.env.YELP_API_KEY;
const YELP_API_BASE = 'https://api.yelp.com/v3';

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
  const retailShops = ['supermarket', 'convenience', 'department_store', 'general', 'mall', 'clothes', 'shoes', 'jewelry', 'books', 'gift', 'furniture', 'electronics', 'mobile_phone', 'computer', 'toys', 'sports', 'bicycle', 'car', 'florist', 'garden_centre', 'pet', 'hardware', 'art'];

  if (retailShops.includes(shop) || shop) {
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

// Generate random rating and review count for businesses without ratings
function generateMockRating() {
  return (Math.random() * 1.5 + 3.5).toFixed(1); // Random between 3.5 and 5.0
}

function generateMockReviewCount() {
  return Math.floor(Math.random() * 200) + 10; // Random between 10 and 210
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

// ====================
// YELP FUSION API FUNCTIONS
// ====================

// Search for a business on Yelp by name and location
async function searchYelpBusiness(name, lat, lon) {
  if (!YELP_API_KEY || YELP_API_KEY === 'your_yelp_api_key_here') {
    return null; // Yelp not configured
  }

  try {
    const response = await axios.get(`${YELP_API_BASE}/businesses/search`, {
      headers: {
        'Authorization': `Bearer ${YELP_API_KEY}`
      },
      params: {
        term: name,
        latitude: lat,
        longitude: lon,
        limit: 1,
        radius: 100 // Search within 100 meters
      },
      timeout: 5000
    });

    if (response.data.businesses && response.data.businesses.length > 0) {
      return response.data.businesses[0];
    }
    return null;
  } catch (error) {
    console.error(`Yelp search error for "${name}":`, error.message);
    return null;
  }
}

// Get detailed business information including reviews from Yelp
async function getYelpBusinessDetails(yelpId) {
  if (!YELP_API_KEY || YELP_API_KEY === 'your_yelp_api_key_here') {
    return null;
  }

  try {
    const [detailsResponse, reviewsResponse] = await Promise.all([
      axios.get(`${YELP_API_BASE}/businesses/${yelpId}`, {
        headers: { 'Authorization': `Bearer ${YELP_API_KEY}` },
        timeout: 5000
      }),
      axios.get(`${YELP_API_BASE}/businesses/${yelpId}/reviews`, {
        headers: { 'Authorization': `Bearer ${YELP_API_KEY}` },
        timeout: 5000
      })
    ]);

    return {
      details: detailsResponse.data,
      reviews: reviewsResponse.data.reviews || []
    };
  } catch (error) {
    console.error(`Yelp details error for ID "${yelpId}":`, error.message);
    return null;
  }
}

// Merge OSM and Yelp data
function mergeOSMAndYelpData(osmBusiness, yelpBusiness, yelpDetails) {
  if (!yelpBusiness) {
    return osmBusiness; // No Yelp data, return OSM only
  }

  // Use Yelp data to enhance OSM data
  const merged = {
    ...osmBusiness,
    // Prefer Yelp's actual data
    rating: yelpBusiness.rating || osmBusiness.rating,
    reviewCount: yelpBusiness.review_count || osmBusiness.reviewCount,
    phone: yelpBusiness.phone || osmBusiness.phone,
    website: yelpBusiness.url || osmBusiness.website,
    image: yelpBusiness.image_url || osmBusiness.image,

    // Yelp-specific data
    yelpId: yelpBusiness.id,
    yelpUrl: yelpBusiness.url,
    yelpRating: yelpBusiness.rating,
    yelpReviewCount: yelpBusiness.review_count,
  };

  // Add address if more complete in Yelp
  if (yelpBusiness.location) {
    const yelpAddress = yelpBusiness.location.display_address?.join(', ');
    if (yelpAddress && yelpAddress.length > osmBusiness.address.length) {
      merged.address = yelpAddress;
    }
  }

  // Add hours if available from Yelp details
  if (yelpDetails?.details?.hours && yelpDetails.details.hours.length > 0) {
    const hours = yelpDetails.details.hours[0];
    if (hours.is_open_now !== undefined) {
      merged.isOpenNow = hours.is_open_now;
    }
  }

  // Add real reviews from Yelp
  if (yelpDetails?.reviews && yelpDetails.reviews.length > 0) {
    merged.reviews = yelpDetails.reviews.map(review => ({
      id: review.id,
      author: review.user.name,
      rating: review.rating,
      comment: review.text,
      date: review.time_created,
      helpful: 0,
      source: 'yelp',
      yelpUrl: review.url
    }));
  }

  // Add price range from Yelp if available
  if (yelpBusiness.price) {
    merged.priceRange = yelpBusiness.price;
  }

  return merged;
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
    description = `A local ${type.replace(/_/g, ' ')} in Cumming, Georgia`;
    if (tags.cuisine) {
      description += ` serving ${tags.cuisine} cuisine`;
    }
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

  const reviewCount = generateMockReviewCount();
  const rating = parseFloat(generateMockRating());

  const business = {
    id,
    name,
    category,
    rating,
    reviewCount,
    description,
    address,
    phone: tags.phone || tags['contact:phone'] || 'Phone not available',
    hours: formatOpeningHours(tags.opening_hours),
    image: getCategoryImage(category, tags),
    deal: null, // OSM doesn't have deals info
    tags: businessTags.slice(0, 5),
    priceRange: '$$', // OSM doesn't have price info
    website: tags.website || tags['contact:website'] || null,
    isOpenNow: isOpenNow(tags.opening_hours),
    osmId: osmElement.id,
    lat: osmElement.lat || osmElement.center?.lat,
    lon: osmElement.lon || osmElement.center?.lon,
    reviews: [],
    relevancyScore: calculateRelevancyScore(name, tags, reviewCount),
    isChain: isChainBusiness(name, tags)
  };

  // Add local reviews if any
  const localReviewsList = localReviews.get(id) || [];
  business.reviews = [...localReviewsList];

  return business;
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

    // Limit to 300 most relevant businesses for storage
    const limitedBusinesses = businesses.slice(0, 300);

    const chainCount = limitedBusinesses.filter(b => b.isChain).length;
    const localCount = limitedBusinesses.filter(b => !b.isChain).length;

    console.log(`📊 Filtered to ${limitedBusinesses.length} relevant businesses`);
    console.log(`🎯 Top business: ${limitedBusinesses[0]?.name} (score: ${limitedBusinesses[0]?.relevancyScore})`);
    console.log(`🏪 ${localCount} local businesses, ${chainCount} chains`);

    // Enrich top 50 businesses with Yelp data (to stay within 500 API calls/day limit)
    // Each business requires 2 API calls (search + details), so 50 businesses = 100 calls
    if (YELP_API_KEY && YELP_API_KEY !== 'your_yelp_api_key_here') {
      console.log('🔍 Enriching top 50 businesses with Yelp data...');

      const top50 = limitedBusinesses.slice(0, 50);
      let yelpEnrichedCount = 0;
      let yelpReviewCount = 0;

      for (let i = 0; i < top50.length; i++) {
        const business = top50[i];

        // Search for business on Yelp
        const yelpBusiness = await searchYelpBusiness(
          business.name,
          business.lat,
          business.lon
        );

        if (yelpBusiness) {
          // Get detailed info and reviews
          const yelpDetails = await getYelpBusinessDetails(yelpBusiness.id);

          // Merge OSM and Yelp data
          limitedBusinesses[i] = mergeOSMAndYelpData(business, yelpBusiness, yelpDetails);
          yelpEnrichedCount++;

          if (yelpDetails?.reviews) {
            yelpReviewCount += yelpDetails.reviews.length;
          }
        }

        // Add small delay to avoid rate limiting
        if (i < top50.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      console.log(`✅ Enriched ${yelpEnrichedCount}/50 businesses with Yelp data`);
      console.log(`📝 Imported ${yelpReviewCount} real reviews from Yelp`);
    } else {
      console.log('⚠️  Yelp API not configured. Set YELP_API_KEY in .env file');
    }

    cache.set(cacheKey, limitedBusinesses);
    return limitedBusinesses;
  } catch (error) {
    console.error('❌ OpenStreetMap API error:', error.message);
    throw new Error('Failed to fetch businesses from OpenStreetMap');
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
    dataSource: "OpenStreetMap + Yelp Fusion API",
    location: "Cumming, Georgia",
    radius: "10 miles",
    yelpConfigured: !!(YELP_API_KEY && YELP_API_KEY !== 'your_yelp_api_key_here')
  });
});

// Get all businesses with optional filters and search
app.get("/api/businesses", async (req, res) => {
  try {
    const {
      category,
      search,
      minRating,
      hasDeals,
      sort
    } = req.query;

    // Fetch businesses from OpenStreetMap (Cumming, GA only)
    const businesses = await fetchOSMBusinesses();
    let result = [...businesses];

    // Filter by category
    if (category && category !== "All") {
      result = result.filter(b => b.category === category);
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
    const businesses = await fetchOSMBusinesses();
    const business = businesses.find(b => b.id === businessId);

    if (!business) {
      return res.status(404).json({ error: "Business not found" });
    }

    res.json(business);
  } catch (error) {
    console.error('Error in /api/businesses/:id:', error);
    res.status(500).json({ error: error.message || "Failed to fetch business" });
  }
});

// Get verification challenge
app.get("/api/verification/challenge", (req, res) => {
  try {
    const challenge = generateChallenge();
    res.json(challenge);
  } catch (error) {
    res.status(500).json({ error: "Failed to generate challenge" });
  }
});

// Submit a local review with verification
app.post("/api/businesses/:id/reviews", (req, res) => {
  try {
    const businessId = req.params.id;
    const { author, rating, comment, verificationId, verificationAnswer } = req.body;

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

    // Verify anti-spam challenge
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
    const businesses = await fetchOSMBusinesses();

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

// Get trending/top businesses
app.get("/api/trending", async (req, res) => {
  try {
    // Fetch all businesses from OSM
    const businesses = await fetchOSMBusinesses();

    // Calculate trending score: rating * log(reviewCount) + deal bonus
    const trending = businesses
      .map(b => {
        const trendScore =
          b.rating * Math.log10(b.reviewCount + 1) * 10 +
          (b.deal ? 5 : 0);
        return { ...b, trendScore };
      })
      .sort((a, b) => b.trendScore - a.trendScore)
      .slice(0, 3);

    res.json(trending);
  } catch (error) {
    console.error('Error fetching trending businesses:', error);
    res.status(500).json({ error: error.message || "Failed to fetch trending businesses" });
  }
});

// Get analytics/stats
app.get("/api/analytics", async (req, res) => {
  try {
    // Fetch all businesses from OSM
    const businesses = await fetchOSMBusinesses();

    const totalBusinesses = businesses.length;
    const avgRating = totalBusinesses > 0
      ? businesses.reduce((sum, b) => sum + b.rating, 0) / totalBusinesses
      : 0;
    const totalReviews = businesses.reduce((sum, b) => sum + b.reviewCount, 0);

    const byCategory = businesses.reduce((acc, b) => {
      acc[b.category] = (acc[b.category] || 0) + 1;
      return acc;
    }, {});

    const topRated = [...businesses]
      .sort((a, b) => b.rating - a.rating)
      .slice(0, 3)
      .map(b => ({ id: b.id, name: b.name, rating: b.rating }));

    const dealsAvailable = businesses.filter(b => b.deal).length;

    res.json({
      totalBusinesses,
      avgRating: Math.round(avgRating * 10) / 10,
      totalReviews,
      byCategory,
      topRated,
      dealsAvailable
    });
  } catch (error) {
    console.error('Error fetching analytics:', error);
    res.status(500).json({ error: error.message || "Failed to fetch analytics" });
  }
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`🚀 LocalLink API running on http://localhost:${PORT}`);
  console.log(`🗺️  Data Source: OpenStreetMap + Yelp Fusion API`);
  console.log(`📍 Location: Cumming, Georgia`);
  console.log(`📏 Search radius: 10 miles (${SEARCH_RADIUS_METERS} meters)`);
  console.log(`💾 Storing: 300 most relevant local businesses`);
});
