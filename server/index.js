import express from "express";
import cors from "cors";
import crypto from "crypto";
import dotenv from "dotenv";
import { Client } from "@googlemaps/google-maps-services-js";
import NodeCache from "node-cache";

// Load environment variables
dotenv.config();

// Initialize Google Maps client
const googleMapsClient = new Client({});
const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY;

// Cache for Google Places API responses (TTL: 1 hour)
const cache = new NodeCache({ stdTTL: 3600 });

// Store local reviews for businesses (keyed by Google place_id)
const localReviews = new Map();

// Store verification challenges in memory (in production, use Redis or database)
const verificationChallenges = new Map();

const app = express();
app.use(cors());
app.use(express.json());

// ====================
// HELPER FUNCTIONS
// ====================

// Map Google Place types to our categories
function mapGoogleTypeToCategory(types) {
  const foodTypes = ['restaurant', 'cafe', 'bakery', 'bar', 'food', 'meal_delivery', 'meal_takeaway'];
  const retailTypes = ['store', 'shopping_mall', 'supermarket', 'clothing_store', 'book_store', 'electronics_store', 'furniture_store', 'hardware_store', 'home_goods_store', 'jewelry_store', 'pet_store', 'shoe_store'];
  const serviceTypes = ['beauty_salon', 'hair_care', 'spa', 'gym', 'laundry', 'car_repair', 'electrician', 'plumber', 'locksmith', 'veterinary_care', 'dentist', 'doctor', 'hospital', 'pharmacy'];

  if (types.some(t => foodTypes.includes(t))) return 'Food';
  if (types.some(t => retailTypes.includes(t))) return 'Retail';
  if (types.some(t => serviceTypes.includes(t))) return 'Services';
  return 'Other';
}

// Format business hours from Google format
function formatOpeningHours(openingHours) {
  if (!openingHours || !openingHours.weekday_text) {
    return 'Hours not available';
  }
  return openingHours.weekday_text.join(', ');
}

// Get photo URL from Google Places
function getPhotoUrl(photoReference, maxWidth = 400) {
  if (!photoReference || !GOOGLE_API_KEY) return null;
  return `https://maps.googleapis.com/maps/api/place/photo?maxwidth=${maxWidth}&photo_reference=${photoReference}&key=${GOOGLE_API_KEY}`;
}

// Transform Google Place to our business format
function transformGooglePlace(place, includeReviews = false) {
  const category = mapGoogleTypeToCategory(place.types || []);
  const photoUrl = place.photos && place.photos[0]
    ? getPhotoUrl(place.photos[0].photo_reference)
    : 'https://images.unsplash.com/photo-1556761175-b413da4baf72?w=400';

  const business = {
    id: place.place_id,
    name: place.name,
    category,
    rating: place.rating || 0,
    reviewCount: place.user_ratings_total || 0,
    description: place.editorial_summary?.overview || place.types?.join(', ') || 'Local business',
    address: place.formatted_address || place.vicinity || 'Address not available',
    phone: place.formatted_phone_number || place.international_phone_number || 'Phone not available',
    hours: formatOpeningHours(place.opening_hours),
    image: photoUrl,
    deal: null, // We don't get deals from Google
    tags: place.types ? place.types.slice(0, 5).map(t => t.replace(/_/g, ' ')) : [],
    priceRange: place.price_level ? '$'.repeat(place.price_level) : '$$',
    website: place.website || null,
    isOpenNow: place.opening_hours?.open_now,
    googleMapsUrl: place.url || `https://www.google.com/maps/place/?q=place_id:${place.place_id}`,
    reviews: []
  };

  // Add Google reviews if requested and available
  if (includeReviews && place.reviews) {
    business.reviews = place.reviews.map(review => ({
      id: crypto.randomUUID(),
      author: review.author_name,
      rating: review.rating,
      comment: review.text,
      date: new Date(review.time * 1000).toISOString(),
      helpful: 0,
      source: 'google'
    }));
  }

  // Add local reviews if any
  const localReviewsList = localReviews.get(place.place_id) || [];
  business.reviews = [...business.reviews, ...localReviewsList];

  return business;
}

// Search businesses using Google Places API
async function searchGooglePlaces(query, location, radius = 5000) {
  if (!GOOGLE_API_KEY) {
    throw new Error('Google Places API key not configured');
  }

  const cacheKey = `search:${query}:${location}:${radius}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log('📦 Returning cached results for:', query);
    return cached;
  }

  try {
    const [lat, lng] = location.split(',').map(parseFloat);

    const response = await googleMapsClient.placesNearby({
      params: {
        location: { lat, lng },
        radius,
        keyword: query || 'restaurant cafe store',
        key: GOOGLE_API_KEY,
      },
    });

    const businesses = response.data.results.map(place => transformGooglePlace(place));
    cache.set(cacheKey, businesses);

    console.log(`✅ Found ${businesses.length} businesses from Google Places`);
    return businesses;
  } catch (error) {
    console.error('❌ Google Places API error:', error.message);
    throw new Error('Failed to fetch businesses from Google Places');
  }
}

// Get detailed business information
async function getBusinessDetails(placeId) {
  if (!GOOGLE_API_KEY) {
    throw new Error('Google Places API key not configured');
  }

  const cacheKey = `details:${placeId}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    const response = await googleMapsClient.placeDetails({
      params: {
        place_id: placeId,
        fields: ['name', 'rating', 'formatted_phone_number', 'formatted_address', 'opening_hours', 'website', 'price_level', 'photos', 'reviews', 'types', 'user_ratings_total', 'editorial_summary', 'url', 'vicinity'],
        key: GOOGLE_API_KEY,
      },
    });

    const business = transformGooglePlace(response.data.result, true);
    cache.set(cacheKey, business);

    return business;
  } catch (error) {
    console.error('❌ Google Places Details API error:', error.message);
    throw new Error('Failed to fetch business details');
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
    googlePlacesConfigured: !!GOOGLE_API_KEY
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
      sort,
      location = process.env.DEFAULT_LOCATION || '37.7749,-122.4194',
      radius = process.env.SEARCH_RADIUS || 5000
    } = req.query;

    // Fetch businesses from Google Places
    const businesses = await searchGooglePlaces(search || '', location, parseInt(radius));
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

    // Filter by deals (Note: Google doesn't provide deals, so this will filter out most)
    if (hasDeals === "true") {
      result = result.filter(b => b.deal !== null);
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

// Get single business by ID (Google Place ID)
app.get("/api/businesses/:id", async (req, res) => {
  try {
    const placeId = req.params.id;
    const business = await getBusinessDetails(placeId);

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

// Submit a local review with verification (stored separately from Google reviews)
app.post("/api/businesses/:id/reviews", (req, res) => {
  try {
    const placeId = req.params.id;
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
    const reviews = localReviews.get(placeId) || [];
    reviews.push(review);
    localReviews.set(placeId, reviews);

    // Clear cache for this business so it gets fresh data next time
    cache.del(`details:${placeId}`);

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
      preferredCategories = [],
      location = process.env.DEFAULT_LOCATION || '37.7749,-122.4194',
      radius = process.env.SEARCH_RADIUS || 5000
    } = req.body;

    // Fetch all businesses from Google Places
    const businesses = await searchGooglePlaces('', location, parseInt(radius));

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
    const {
      location = process.env.DEFAULT_LOCATION || '37.7749,-122.4194',
      radius = process.env.SEARCH_RADIUS || 5000
    } = req.query;

    // Fetch all businesses from Google Places
    const businesses = await searchGooglePlaces('', location, parseInt(radius));

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
    const {
      location = process.env.DEFAULT_LOCATION || '37.7749,-122.4194',
      radius = process.env.SEARCH_RADIUS || 5000
    } = req.query;

    // Fetch all businesses from Google Places
    const businesses = await searchGooglePlaces('', location, parseInt(radius));

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
  console.log(`🗺️  Google Places API: ${GOOGLE_API_KEY ? '✅ Configured' : '❌ Not configured'}`);
  if (!GOOGLE_API_KEY) {
    console.log(`⚠️  Please add your GOOGLE_PLACES_API_KEY to server/.env file`);
    console.log(`   Get your API key from: https://console.cloud.google.com/google/maps-apis`);
  }
  console.log(`📍 Default location: ${process.env.DEFAULT_LOCATION || '37.7749,-122.4194 (San Francisco)'}`);
  console.log(`📏 Search radius: ${process.env.SEARCH_RADIUS || 5000}m`);
});