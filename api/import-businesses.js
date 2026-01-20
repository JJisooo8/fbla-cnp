// Vercel serverless function for /api/import-businesses
// Imports additional service and retail businesses from Yelp

import axios from 'axios';
import { put, list } from '@vercel/blob';

const YELP_API_BASE_URL = "https://api.yelp.com/v3";
const YELP_API_KEY = process.env.YELP_API_KEY;
const BUSINESSES_BLOB_NAME = "businesses.json";
const REVIEWS_BLOB_NAME = "reviews.json";

// Cumming, Georgia coordinates
const CUMMING_GA_LAT = 34.2073;
const CUMMING_GA_LON = -84.1402;
const SEARCH_RADIUS_METERS = 16093; // 10 miles

// Categories to import for better diversity
const IMPORT_CATEGORIES = [
  // Hair and Beauty
  'hair', 'barbers', 'hairsalons', 'beautysvc', 'nail_salons', 'skincare', 'spas', 'massage',
  // Auto Services
  'auto', 'autorepair', 'carwash', 'tires', 'oilchange', 'autoglass', 'bodyshops',
  // Home Services
  'homeservices', 'plumbing', 'electricians', 'hvac', 'handyman', 'painters', 'roofing',
  'landscaping', 'locksmiths', 'homecleaning', 'carpetcleaning', 'windowwashing',
  // Professional Services
  'professional', 'accountants', 'lawyers', 'financialservices', 'insurance', 'realestateagents',
  // Health and Fitness
  'gyms', 'fitness', 'yoga', 'martialarts', 'personaltrainers', 'physicaltherapy',
  // Pet Services
  'pets', 'petgroomers', 'veterinarians', 'petboarding', 'pettraining',
  // Education
  'education', 'tutoring', 'preschools', 'musiclessons', 'artschools', 'dancestudios',
  // Other Services
  'drycleaninglaundry', 'sewingalterations', 'photography', 'eventplanning', 'printing',
  'shipping_centers', 'notaries', 'movers',
  // Retail
  'shopping', 'bookstores', 'clothing', 'jewelry', 'florists', 'giftshops', 'hardware',
  'hobbyshops', 'sportgoods', 'electronics', 'furniture', 'antiques', 'thrift_stores'
];

// Fake usernames and comments for seeding
const FAKE_USERNAMES = [
  "mike_j", "sarah2024", "localfoodie", "happycustomer", "johns_review",
  "emily_k", "davidm_88", "jess.thomas", "chris_local", "amanda_reviews",
  "kevin.smith", "lisa_marie", "jason_t", "megan_w", "ryan.p",
  "nicole_g", "brian_h", "ashley_c", "matt_d", "jennifer_l",
  "cumminglocal", "forsythfan", "ga_reviewer", "northga_local", "weekend_explorer"
];

const POSITIVE_COMMENTS = [
  "Service was great!", "Will definitely come back!", "Exceeded my expectations.",
  "Staff was super friendly and helpful.", "Great value for the price.",
  "Highly recommend this place!", "Clean and welcoming atmosphere.",
  "Quick and efficient service.", "Best in the area!", "Never disappoints.",
  "Amazing experience overall.", "Top notch quality!", "Very impressed with everything.",
  "Fantastic place, highly recommend.", "Love this place!"
];

const NEGATIVE_COMMENTS = [
  "Could be better.", "Long wait times.", "Not worth the price.",
  "Staff seemed disinterested.", "Place could use some cleaning.",
  "Wouldn't recommend.", "Very disappointing experience.", "Expected more based on reviews."
];

// Load data from blob
async function loadFromBlob(blobName) {
  try {
    const { blobs } = await list({ prefix: blobName });
    let blob = blobs.find(b => b.pathname === blobName);
    if (!blob && blobs.length > 0) {
      blob = blobs.find(b => b.pathname.includes(blobName));
    }
    if (blob) {
      const response = await fetch(blob.url);
      if (response.ok) {
        const text = await response.text();
        if (text.trim()) {
          return new Map(JSON.parse(text));
        }
      }
    }
    return new Map();
  } catch (error) {
    console.error(`[IMPORT] Error loading ${blobName}:`, error.message);
    return new Map();
  }
}

// Save data to blob
async function saveToBlob(blobName, dataMap) {
  const jsonData = JSON.stringify(Array.from(dataMap.entries()));
  try {
    await put(blobName, jsonData, {
      access: 'public',
      contentType: 'application/json',
      addRandomSuffix: false
    });
    return true;
  } catch (error) {
    console.error(`[IMPORT] Error saving ${blobName}:`, error.message);
    return false;
  }
}

// Map Yelp category to our category
function mapCategory(yelpCategories) {
  if (!yelpCategories?.length) return 'Services';
  const aliases = yelpCategories.map(c => c.alias.toLowerCase());

  const foodKeywords = ['restaurant', 'food', 'pizza', 'burger', 'coffee', 'cafe', 'bakery', 'bar', 'grill', 'diner', 'breakfast', 'lunch', 'dinner', 'sushi', 'mexican', 'chinese', 'italian', 'thai', 'indian', 'korean', 'japanese', 'bbq', 'seafood', 'steakhouse', 'icecream', 'dessert', 'juice', 'smoothie', 'tea', 'donut'];
  const retailKeywords = ['shopping', 'retail', 'store', 'shop', 'boutique', 'market', 'mall', 'outlet', 'bookstore', 'clothing', 'jewelry', 'furniture', 'electronics', 'hardware', 'florist', 'gift', 'antique', 'thrift'];

  for (const alias of aliases) {
    if (foodKeywords.some(k => alias.includes(k))) return 'Food';
    if (retailKeywords.some(k => alias.includes(k))) return 'Retail';
  }
  return 'Services';
}

// Transform Yelp business to our format
function transformYelpToBusiness(yelpBusiness) {
  if (!yelpBusiness) return null;
  const name = yelpBusiness.name || 'Unknown Business';
  const category = mapCategory(yelpBusiness.categories);

  return {
    id: `yelp-${yelpBusiness.id}`,
    yelpId: yelpBusiness.id,
    name,
    category,
    tags: (yelpBusiness.categories || []).map(c => c.title),
    address: yelpBusiness.location?.display_address?.join(', ') || '',
    phone: yelpBusiness.display_phone || '',
    image: yelpBusiness.image_url || null,
    website: yelpBusiness.url || '',
    rating: 0,
    reviewCount: 0,
    yelpRating: yelpBusiness.rating || 0,
    yelpReviewCount: yelpBusiness.review_count || 0,
    coordinates: yelpBusiness.coordinates || null,
    price: yelpBusiness.price || '',
    hours: 'Hours not available',
    deals: [],
    source: 'yelp',
    relevancyScore: yelpBusiness.rating || 3
  };
}

// Generate reviews for a business
function generateReviewsForBusiness(businessId, count) {
  const reviews = [];
  const crypto = require('crypto');

  for (let i = 0; i < count; i++) {
    const rand = Math.random();
    let rating;
    if (rand < 0.12) rating = Math.random() < 0.4 ? 1 : 2;
    else if (rand < 0.27) rating = 3;
    else if (rand < 0.67) rating = 4;
    else rating = 5;

    const isAnonymous = Math.random() < 0.15;
    const author = isAnonymous ? "Anonymous" : FAKE_USERNAMES[Math.floor(Math.random() * FAKE_USERNAMES.length)];

    let comment = "";
    const commentRand = Math.random();
    if (commentRand >= 0.40) {
      if (rating <= 2 && commentRand < 0.85) {
        comment = NEGATIVE_COMMENTS[Math.floor(Math.random() * NEGATIVE_COMMENTS.length)];
      } else if (commentRand < 0.95) {
        comment = POSITIVE_COMMENTS[Math.floor(Math.random() * POSITIVE_COMMENTS.length)];
      } else {
        comment = NEGATIVE_COMMENTS[Math.floor(Math.random() * NEGATIVE_COMMENTS.length)];
      }
    }

    const variance = () => Math.max(1, Math.min(5, rating + Math.floor(Math.random() * 3) - 1));
    const now = new Date();
    const twoYearsAgo = new Date(now.getFullYear() - 2, now.getMonth(), now.getDate());
    const randomTime = twoYearsAgo.getTime() + Math.random() * (now.getTime() - twoYearsAgo.getTime());

    reviews.push({
      id: crypto.randomUUID(),
      userId: `seed-user-${Math.floor(Math.random() * 1000)}`,
      author,
      isAnonymous,
      rating,
      comment,
      date: new Date(randomTime).toISOString(),
      helpful: Math.floor(Math.random() * 20),
      upvotedBy: [],
      source: 'seed',
      quality: variance(),
      service: variance(),
      cleanliness: variance(),
      atmosphere: variance()
    });
  }

  reviews.sort((a, b) => new Date(b.date) - new Date(a.date));
  return reviews;
}

export default async function handler(req, res) {
  // Handle CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!YELP_API_KEY) {
    return res.status(500).json({ error: 'Yelp API key not configured' });
  }

  try {
    console.log('[IMPORT] Starting business import...');

    // Load existing data
    const persistentBusinesses = await loadFromBlob(BUSINESSES_BLOB_NAME);
    const localReviews = await loadFromBlob(REVIEWS_BLOB_NAME);

    const previousSize = persistentBusinesses.size;
    let totalFetched = 0;
    let newCount = 0;

    // Import from each category
    for (const category of IMPORT_CATEGORIES) {
      try {
        console.log(`[IMPORT] Fetching category: ${category}...`);

        const response = await axios.get(`${YELP_API_BASE_URL}/businesses/search`, {
          headers: { Authorization: `Bearer ${YELP_API_KEY}` },
          params: {
            latitude: CUMMING_GA_LAT,
            longitude: CUMMING_GA_LON,
            radius: SEARCH_RADIUS_METERS,
            categories: category,
            limit: 50,
            sort_by: "rating"
          },
          timeout: 15000
        });

        const businesses = response.data.businesses || [];
        totalFetched += businesses.length;
        console.log(`[IMPORT] Got ${businesses.length} businesses for ${category}`);

        for (const biz of businesses) {
          const transformed = transformYelpToBusiness(biz);
          if (transformed && !persistentBusinesses.has(transformed.id)) {
            persistentBusinesses.set(transformed.id, transformed);
            newCount++;
          }
        }

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 200));

      } catch (error) {
        console.error(`[IMPORT] Error fetching category ${category}:`, error.message);
      }
    }

    console.log(`[IMPORT] Imported ${newCount} new businesses (total: ${persistentBusinesses.size})`);

    // Save businesses
    if (newCount > 0) {
      await saveToBlob(BUSINESSES_BLOB_NAME, persistentBusinesses);
    }

    // Seed reviews for new businesses
    const businessIds = Array.from(persistentBusinesses.keys());
    const businessesWithoutReviews = businessIds.filter(id => !localReviews.has(id));
    let seededCount = 0;
    let totalReviews = 0;

    if (businessesWithoutReviews.length > 0) {
      console.log(`[SEED] Seeding reviews for ${businessesWithoutReviews.length} businesses...`);

      for (const businessId of businessesWithoutReviews) {
        const reviewCount = 20 + Math.floor(Math.random() * 31);
        const reviews = generateReviewsForBusiness(businessId, reviewCount);
        localReviews.set(businessId, reviews);
        totalReviews += reviewCount;
        seededCount++;
      }

      await saveToBlob(REVIEWS_BLOB_NAME, localReviews);
      console.log(`[SEED] Generated ${totalReviews} reviews for ${seededCount} businesses`);
    }

    res.json({
      success: true,
      message: `Imported ${newCount} new businesses and seeded ${seededCount} with reviews`,
      import: {
        imported: newCount,
        total: persistentBusinesses.size,
        categories: IMPORT_CATEGORIES.length
      },
      seed: {
        seeded: seededCount,
        reviews: totalReviews,
        total: businessIds.length
      }
    });

  } catch (error) {
    console.error('[IMPORT] Error:', error);
    res.status(500).json({ error: 'Failed to import businesses' });
  }
}
