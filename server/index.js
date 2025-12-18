import express from "express";
import cors from "cors";
import crypto from "crypto";

// Enhanced business data with more attributes
const businesses = [
  {
    id: 1,
    name: "Sunrise Café",
    category: "Food",
    rating: 4.6,
    reviewCount: 128,
    description: "A cozy café offering breakfast, lunch, and locally roasted coffee. Family-owned since 2015.",
    address: "123 Main Street, Downtown",
    phone: "(555) 123-4567",
    hours: "Mon-Fri: 7am-6pm, Sat-Sun: 8am-4pm",
    image: "https://images.unsplash.com/photo-1554118811-1e0d58224f24?w=400",
    deal: "10% off your first visit - mention LocalLink!",
    tags: ["Coffee", "Breakfast", "Lunch", "WiFi", "Pet-Friendly"],
    priceRange: "$$",
    reviews: []
  },
  {
    id: 2,
    name: "PageTurner Books",
    category: "Retail",
    rating: 4.9,
    reviewCount: 89,
    description: "Independent bookstore featuring local authors and weekly reading events. A community hub for book lovers.",
    address: "456 Oak Avenue, Arts District",
    phone: "(555) 234-5678",
    hours: "Tue-Sat: 10am-8pm, Sun: 12pm-6pm",
    image: "https://images.unsplash.com/photo-1507842217343-583bb7270b66?w=400",
    deal: "Buy 2 books, get 1 free on weekends!",
    tags: ["Books", "Local Authors", "Events", "Gifts"],
    priceRange: "$$",
    reviews: []
  },
  {
    id: 3,
    name: "SparkTech Repairs",
    category: "Services",
    rating: 4.4,
    reviewCount: 156,
    description: "Affordable phone and laptop repair by certified technicians. Same-day service available.",
    address: "789 Tech Plaza, Suite 12",
    phone: "(555) 345-6789",
    hours: "Mon-Sat: 9am-7pm",
    image: "https://images.unsplash.com/photo-1581092918056-0c4c3acd3789?w=400",
    deal: null,
    tags: ["Phone Repair", "Laptop Repair", "Screen Replacement", "Data Recovery"],
    priceRange: "$",
    reviews: []
  },
  {
    id: 4,
    name: "Green Thumb Garden Center",
    category: "Retail",
    rating: 4.7,
    reviewCount: 203,
    description: "Everything for your garden: plants, tools, and expert advice. Locally grown organic produce available.",
    address: "321 Garden Way",
    phone: "(555) 456-7890",
    hours: "Daily: 8am-6pm",
    image: "https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=400",
    deal: "Free potting soil with plant purchase over $25",
    tags: ["Plants", "Gardening", "Organic", "Landscaping"],
    priceRange: "$$",
    reviews: []
  },
  {
    id: 5,
    name: "Bella's Pizzeria",
    category: "Food",
    rating: 4.8,
    reviewCount: 312,
    description: "Authentic wood-fired pizza made with family recipes passed down three generations.",
    address: "555 Italian Lane",
    phone: "(555) 567-8901",
    hours: "Sun-Thu: 11am-10pm, Fri-Sat: 11am-11pm",
    image: "https://images.unsplash.com/photo-1513104890138-7c749659a591?w=400",
    deal: "Free garlic bread with any large pizza",
    tags: ["Pizza", "Italian", "Dine-In", "Takeout", "Delivery"],
    priceRange: "$$",
    reviews: []
  },
  {
    id: 6,
    name: "Pawsitive Pet Grooming",
    category: "Services",
    rating: 4.9,
    reviewCount: 167,
    description: "Professional pet grooming with a gentle touch. We treat your pets like family.",
    address: "888 Pet Street",
    phone: "(555) 678-9012",
    hours: "Tue-Sat: 9am-5pm",
    image: "https://images.unsplash.com/photo-1556229174-5e42a09e0b6f?w=400",
    deal: "First-time customers get 15% off!",
    tags: ["Pet Grooming", "Dogs", "Cats", "Nail Trimming"],
    priceRange: "$$",
    reviews: []
  },
  {
    id: 7,
    name: "FitLife Gym",
    category: "Services",
    rating: 4.5,
    reviewCount: 94,
    description: "State-of-the-art fitness center with personal trainers and group classes.",
    address: "777 Fitness Boulevard",
    phone: "(555) 789-0123",
    hours: "Mon-Fri: 5am-11pm, Sat-Sun: 7am-9pm",
    image: "https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=400",
    deal: null,
    tags: ["Gym", "Personal Training", "Yoga", "Fitness Classes"],
    priceRange: "$$$",
    reviews: []
  },
  {
    id: 8,
    name: "Sweet Dreams Bakery",
    category: "Food",
    rating: 4.7,
    reviewCount: 221,
    description: "Fresh-baked pastries, custom cakes, and artisan breads made daily from scratch.",
    address: "234 Bakery Lane",
    phone: "(555) 890-1234",
    hours: "Tue-Sat: 6am-6pm, Sun: 7am-2pm",
    image: "https://images.unsplash.com/photo-1486427944299-d1955d23e34d?w=400",
    deal: "Buy 6 cupcakes, get 2 free!",
    tags: ["Bakery", "Cakes", "Pastries", "Custom Orders"],
    priceRange: "$$",
    reviews: []
  }
];

// Store verification challenges in memory (in production, use Redis or database)
const verificationChallenges = new Map();

const app = express();
app.use(cors());
app.use(express.json());

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

// Health check
app.get("/api/health", (req, res) => {
  res.json({ ok: true, message: "Server is healthy" });
});

// Get all businesses with optional filters and search
app.get("/api/businesses", (req, res) => {
  try {
    let result = [...businesses];
    const { category, search, minRating, hasDeals, sort } = req.query;

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

    // Filter by deals
    if (hasDeals === "true") {
      result = result.filter(b => b.deal !== null);
    }

    // Search functionality with smart scoring
    if (search && search.trim()) {
      const searchLower = search.toLowerCase().trim();
      result = result.map(b => {
        let score = 0;
        
        // Name match (highest weight)
        if (b.name.toLowerCase().includes(searchLower)) score += 10;
        
        // Description match
        if (b.description.toLowerCase().includes(searchLower)) score += 5;
        
        // Tag match
        if (b.tags.some(tag => tag.toLowerCase().includes(searchLower))) score += 7;
        
        // Category match
        if (b.category.toLowerCase().includes(searchLower)) score += 3;
        
        return { ...b, searchScore: score };
      })
      .filter(b => b.searchScore > 0)
      .sort((a, b) => b.searchScore - a.searchScore);
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
    res.status(500).json({ error: "Failed to fetch businesses" });
  }
});

// Get single business by ID
app.get("/api/businesses/:id", (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const business = businesses.find(b => b.id === id);
    
    if (!business) {
      return res.status(404).json({ error: "Business not found" });
    }
    
    res.json(business);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch business" });
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

// Submit a review with verification
app.post("/api/businesses/:id/reviews", (req, res) => {
  try {
    const id = parseInt(req.params.id);
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

    // Find business
    const business = businesses.find(b => b.id === id);
    if (!business) {
      return res.status(404).json({ error: "Business not found" });
    }

    // Create review
    const review = {
      id: crypto.randomUUID(),
      author: author.trim(),
      rating,
      comment: comment.trim(),
      date: new Date().toISOString(),
      helpful: 0
    };

    business.reviews.push(review);

    // Update business rating (weighted average)
    const totalReviews = business.reviewCount + 1;
    const newRating = ((business.rating * business.reviewCount) + rating) / totalReviews;
    business.rating = Math.round(newRating * 10) / 10;
    business.reviewCount = totalReviews;

    res.status(201).json({ 
      message: "Review submitted successfully", 
      review,
      newRating: business.rating 
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to submit review" });
  }
});

// Get recommendations based on user's favorite categories
app.post("/api/recommendations", (req, res) => {
  try {
    const { favoriteIds = [], preferredCategories = [] } = req.body;

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
    res.status(500).json({ error: "Failed to generate recommendations" });
  }
});

// Get trending/top businesses
app.get("/api/trending", (req, res) => {
  try {
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
    res.status(500).json({ error: "Failed to fetch trending businesses" });
  }
});

// Get analytics/stats
app.get("/api/analytics", (req, res) => {
  try {
    const totalBusinesses = businesses.length;
    const avgRating = businesses.reduce((sum, b) => sum + b.rating, 0) / totalBusinesses;
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
    res.status(500).json({ error: "Failed to fetch analytics" });
  }
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`🚀 LocalLink API running on http://localhost:${PORT}`);
  console.log(`📊 ${businesses.length} businesses loaded`);
});