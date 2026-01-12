# LocalLink - Byte-Sized Business Boost

**A web-based application that helps users discover and support small, local businesses in Cumming, Georgia.**

Built for FBLA's Competitive Event: Byte-Sized Business Boost

🗺️ **Powered by OpenStreetMap + Yelp!** LocalLink displays real businesses from OpenStreetMap with optional Yelp enrichment for websites, hours, and photos.

---

## 🌟 Features

### Core Functionality
- **Browse Real Businesses**: Powered by OpenStreetMap - real restaurants, stores, and services in Cumming, GA
- **10-Mile Coverage**: Discover businesses within a 10-mile radius of Cumming, Georgia
- **Live Business Data**: Real addresses, phone numbers, hours, and websites (OSM with optional Yelp enrichment)
- **Smart Search**: Search by name, description, tags, or category
- **Advanced Filters**: Filter by category, minimum rating, and sort by rating/reviews/name
- **Business Details**: View comprehensive information including address, hours, contact, and website
- **Favorites System**: Save and bookmark favorite businesses (persisted in browser)
- **Reviews & Ratings**: Submit reviews with spam protection (only user-submitted reviews are stored)
- **Business Photos**: Uses Yelp images when available; optional Bing image search fills gaps

### Intelligent Features
- **Personalized Recommendations**: AI-powered suggestions based on favorite businesses and categories
- **Trending Businesses**: Smart algorithm combining local ratings and reviews to surface popular businesses
- **Analytics Dashboard**: Real-time stats showing total businesses and local review counts
- **Smart Filtering**: Efficient filtering and search across all business attributes

### Security & Validation
- **Spam Prevention**: Math-based CAPTCHA challenge before submitting reviews
- **Input Validation**: Server-side validation for all user submissions
- **Error Handling**: Comprehensive error handling on both frontend and backend

---

## 🏗️ Technical Architecture

### Backend (Node.js + Express)
- **OpenStreetMap + Yelp Integration**: Fetches real business data via Overpass API with optional Yelp enrichment
- **Smart Caching**: 1-hour cache to minimize API load and improve performance
- **RESTful API** with modular endpoint structure
- **Location-Based Search**: Searches within 10-mile radius of Cumming, GA
- **Smart Algorithms**: Recommendation engine, trending calculator, search scoring
- **Anti-Spam System**: UUID-based verification challenges with expiration
- **Data Transformation**: Converts OSM data to user-friendly format
- **Data Validation**: Robust input validation and error responses

**Key Technologies:**
- Express 5.2.1
- Axios (for Overpass API calls)
- Node-Cache (response caching)
- Crypto (UUID generation)

### Frontend (React + Vite)
- **Modern React**: Hooks-based architecture with functional components
- **Single-Page Application**: Client-side routing between home, details, and favorites
- **Responsive Design**: Clean, accessible UI optimized for presentations
- **Local Storage**: Persistent favorites across sessions
- **Real-time Updates**: Dynamic filtering and instant search results
- **Business Photos**: Uses Yelp images, with optional Bing image search for missing photos

---

## 📋 API Endpoints

### Business Endpoints
```
GET  /api/health                      - Health check
GET  /api/businesses                  - Get all businesses (with optional filters)
GET  /api/businesses/:id              - Get single business by ID
POST /api/businesses/:id/reviews      - Submit review (with verification)
```

### Intelligent Features
```
POST /api/recommendations             - Get personalized recommendations
GET  /api/trending                    - Get trending businesses
GET  /api/analytics                   - Get platform analytics
```

### Verification
```
GET  /api/verification/challenge      - Get anti-spam challenge
```

### Query Parameters
- `category` - Filter by category (Food, Retail, Services)
- `search` - Search term (searches name, description, tags, category)
- `minRating` - Minimum rating threshold (e.g., 4, 4.5)
- `hasDeals` - Filter businesses with deals (true/false)
- `sort` - Sort order (rating, reviews, name)

---

## 🚀 Setup Instructions

### Prerequisites
- Node.js (v16 or higher)
- npm or yarn
- **Optional API keys:** Yelp for enrichment and Bing Image Search for photos

### Installation

1. **Clone the repository**
   ```bash
   cd fbla-cnp
   ```

2. **Install Backend Dependencies**
   ```bash
   cd server
   npm install
   ```

3. **Install Frontend Dependencies**
   ```bash
   cd ../client
   npm install
   ```

### Running the Application

1. **Start the Backend Server** (Terminal 1)
   ```bash
   cd server
   npm run dev
   ```
   Server runs on `http://localhost:3001`

   ✅ Look for:
   ```
   🗺️  Data Source: OpenStreetMap (FREE!)
   📍 Location: Cumming, Georgia
   📏 Search radius: 10 miles (16093 meters)
   🧭 Yelp enrichment: enabled/disabled
   🖼️  Bing image search: enabled/disabled
   ```

2. **Start the Frontend** (Terminal 2)
   ```bash
   cd client
   npm run dev
   ```
   Frontend runs on `http://localhost:5173`

3. **Access the Application**
   Open your browser to `http://localhost:5173`

---

## 🎨 User Guide

### Browsing Businesses
1. View trending businesses and analytics on the homepage
2. Use the search bar to find specific businesses
3. Apply filters: category, minimum rating
4. Sort results by rating, review count, or name
5. Click any business card to view full details

### Viewing Business Details
1. Click "View Details" or the business name/image
2. See comprehensive info: address, phone, hours, website
3. View current rating and review count
4. Read customer reviews
5. Submit your own review

### Managing Favorites
1. Click the heart icon on any business card
2. View all favorites in the Favorites tab
3. Favorites are saved automatically in your browser

### Submitting Reviews
1. Open a business detail page
2. Click "Write a Review"
3. Fill out the form: name, rating (1-5 stars), comment
4. Solve the simple math challenge (spam prevention)
5. Submit your review

---

## 📊 Data Source: OpenStreetMap

### Why OpenStreetMap?
- ✅ **Completely FREE** - No API keys, no billing, no quotas
- ✅ **Real Data** - Actual businesses from community-contributed map data
- ✅ **No Usage Limits** - Use as much as you need
- ✅ **Privacy-Friendly** - No tracking or personal data collection
- ✅ **Open Source** - Community-driven, collaborative data

### How It Works
1. **Overpass API**: We query OpenStreetMap data via the Overpass API
2. **10-Mile Radius**: Searches businesses around Cumming, GA (34.2073, -84.1402)
3. **Business Types**: Restaurants, cafes, shops, services, and more
4. **Data Transformation**: Converts OSM tags to user-friendly business profiles
5. **Caching**: Results cached for 1 hour for better performance

### OSM Data Categories
- **Food**: restaurants, cafes, fast_food, bars, pubs, bakeries
- **Retail**: shops, supermarkets, convenience stores, boutiques, bookstores
- **Services**: pharmacies, salons, gyms, banks, auto repair, veterinarians

### Optional Yelp + Bing Setup
LocalLink can optionally enrich data with Yelp (websites/hours/photos) and fill missing photos with Bing Image Search.

Add these environment variables before starting the server:

```
export YELP_API_KEY="your-yelp-api-key"
export BING_IMAGE_SEARCH_KEY="your-bing-search-key"
export BING_IMAGE_SEARCH_ENDPOINT="https://api.bing.microsoft.com/v7.0/images/search"
```

Notes:
- `BING_IMAGE_SEARCH_ENDPOINT` is optional; the default shown above is used if omitted.
- If you do not set these variables, LocalLink still works using OpenStreetMap data only.

---

## 🖼️ Images & Photos

Since OpenStreetMap doesn't include photos, LocalLink uses:
- **Yelp Photos (optional)**: Uses Yelp images when an API key is provided
- **Bing Image Search (optional)**: Fills in missing photos with Bing Image Search
- **Curated Fallbacks**: Category-appropriate images when no external photo is available

---

## 💡 Intelligent Features Explained

### Personalized Recommendations
- Analyzes your favorited businesses
- Identifies category preferences
- Scores all businesses based on:
  - Category match (highest weight)
  - High ratings (4.5+ stars)
  - Popularity (review count)
- Returns top 4 personalized suggestions

### Trending Algorithm
```javascript
trendScore = rating × log₁₀(reviewCount + 1) × 10
```
- Balances rating quality with popularity
- Surfaces businesses with both high ratings AND many reviews
- Top 3 trending businesses displayed

### Analytics Dashboard
Real-time statistics:
- Total businesses in Cumming area
- Average rating across all businesses
- Total review count
- Breakdown by category (Food, Retail, Services)

---

## 🛡️ Security Features

### Review Spam Prevention
- Math-based CAPTCHA (e.g., "What is 7 + 3?")
- UUID-based challenge system
- 5-minute challenge expiration
- One-time use (challenge deleted after verification)

### Input Validation
- Author name: minimum 2 characters
- Rating: must be 1-5 stars
- Comment: minimum 10 characters
- All inputs sanitized and trimmed

### Error Handling
- Graceful error messages for users
- Detailed server-side logging
- Network error recovery
- Cache fallback mechanisms

---

## 📂 Project Structure

```
fbla-cnp/
├── client/                    # React frontend
│   ├── src/
│   │   ├── App.jsx           # Main application component
│   │   ├── main.jsx          # React entry point
│   │   └── index.css         # Global styles
│   ├── package.json
│   └── vite.config.js
├── server/                    # Node.js backend
│   ├── index.js              # Express server + Overpass API integration
│   └── package.json
└── README.md
```

---

## 🎯 FBLA Competition Alignment

### "Byte-Sized Business Boost" Requirements
✅ **Local Business Focus**: Exclusively serves Cumming, GA businesses
✅ **Discovery Platform**: Browse, search, and filter local establishments
✅ **Community Engagement**: Reviews, ratings, and favorites
✅ **Intelligent Features**: Recommendations and trending algorithms
✅ **User-Friendly**: Clean, accessible interface
✅ **Real Data**: Actual businesses from OpenStreetMap
✅ **Scalable Architecture**: Modular, well-documented code

### Demonstration Tips
1. **Show Real Data**: Highlight that these are actual Cumming, GA businesses
2. **Demo Recommendations**: Add favorites to show personalized suggestions
3. **Test Search**: Search for specific business types (e.g., "pizza", "pharmacy")
4. **Submit a Review**: Demonstrate the verification system
5. **Show Analytics**: Display the dashboard with real statistics
6. **Highlight FREE Aspect**: No API costs = sustainable solution

---

## 🔧 Customization

### Change Location
Edit `server/index.js`:
```javascript
const CUMMING_GA_LAT = 34.2073;  // Your latitude
const CUMMING_GA_LON = -84.1402;  // Your longitude
const SEARCH_RADIUS_METERS = 24140; // 15 miles
```

### Change Search Radius
Adjust the radius (in meters):
```javascript
const SEARCH_RADIUS_METERS = 16093; // 10 miles
const SEARCH_RADIUS_METERS = 32186; // 20 miles
```

### Customize Images
Edit the `getCategoryImage()` function in `server/index.js` to use your own image URLs.

---

## 🐛 Troubleshooting

### "Failed to fetch businesses" Error

**Cause**: Overpass API timeout or network issue

**Solution**:
1. Wait a few seconds and refresh the page
2. Check your internet connection
3. The Overpass API may be temporarily busy - try again in a moment

### No businesses showing up

**Possible causes**:
1. **Limited OSM data in area** - Some areas have sparse OpenStreetMap data
2. **Filters too restrictive** - Try removing filters
3. **Cache issue** - Restart the backend server

### Slow initial load

**Cause**: First query to Overpass API can be slow

**Solution**:
- Wait 10-15 seconds for initial load
- Subsequent loads will be fast (cached for 1 hour)
- Results are cached automatically

---

## 🌟 Key Advantages

### vs. Google Places API
- ✅ **FREE** (no billing, no API key)
- ✅ **No usage limits**
- ✅ **Privacy-friendly**
- ❌ Photos not included (we use Unsplash)
- ❌ Reviews not included (we provide local review system)

### vs. Sample Data
- ✅ **Real businesses** from OpenStreetMap
- ✅ **Up-to-date information**
- ✅ **Actual addresses and contacts**
- ✅ **Community-verified data**

---

## 📝 License

This project is created for educational purposes as part of FBLA's "Byte-Sized Business Boost" competitive event.

---

## 🙏 Data Attribution

Business data © OpenStreetMap contributors
- Data available under the Open Database License
- Learn more: https://www.openstreetmap.org/copyright
- Images from Unsplash (free to use)

---

## 📧 Support

For technical issues or questions:
1. Check the Troubleshooting section above
2. Verify both frontend and backend servers are running
3. Check browser console for detailed error messages
4. Ensure internet connection is stable

---

**Built with ❤️ for FBLA by showcasing real Cumming, Georgia businesses!**
