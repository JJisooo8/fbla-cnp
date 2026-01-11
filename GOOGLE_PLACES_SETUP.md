# Google Places API Setup Guide

LocalLink now integrates with **Google Places API** to display real businesses from Google Maps! Follow this guide to get your API key and start using real business data.

---

## Why Google Places API?

✅ **Real business data** - Actual restaurants, stores, and services from Google Maps
✅ **Live photos** - High-quality images from Google
✅ **Authentic reviews** - Real Google reviews from customers
✅ **Up-to-date information** - Current business hours, phone numbers, addresses
✅ **Open/Closed status** - Real-time "Open Now" indicators
✅ **Websites & Directions** - Links to business websites and Google Maps

---

## Step 1: Get Your Google Places API Key

### 1.1 Create a Google Cloud Project

1. Go to the [Google Cloud Console](https://console.cloud.google.com/)
2. Sign in with your Google account
3. Click **"Select a project"** at the top, then **"New Project"**
4. Enter a project name (e.g., "LocalLink FBLA")
5. Click **"Create"**

### 1.2 Enable the Places API

1. In your new project, go to **APIs & Services > Library**
2. Search for **"Places API"**
3. Click on **"Places API"** in the results
4. Click **"Enable"**

### 1.3 Create API Credentials

1. Go to **APIs & Services > Credentials**
2. Click **"Create Credentials"** > **"API Key"**
3. Your API key will be generated - **copy it immediately**
4. (Optional but recommended) Click **"Restrict Key"** to add restrictions:
   - Under "API restrictions", select "Restrict key"
   - Choose **"Places API"** from the dropdown
   - Click **"Save"**

### 1.4 Enable Billing (Free Tier Available)

⚠️ **Important:** Google Places API requires billing to be enabled, but offers a generous free tier:

- **$200 free credit per month**
- Places API costs:
  - Nearby Search: $32 per 1,000 requests
  - Place Details: $17 per 1,000 requests
  - Place Photos: Free (with attribution)

With our caching system, you'll stay well within the free tier for development and demonstration purposes!

1. Go to **Billing** in the Google Cloud Console
2. Click **"Link a billing account"** or **"Create billing account"**
3. Enter your payment information (you won't be charged unless you exceed the free tier)
4. Link the billing account to your project

---

## Step 2: Configure LocalLink

### 2.1 Add Your API Key to the Backend

1. Navigate to the `server/` directory:
   ```bash
   cd server
   ```

2. Open the `.env` file in a text editor:
   ```bash
   nano .env
   # or use any text editor
   ```

3. Add your API key:
   ```env
   GOOGLE_PLACES_API_KEY=YOUR_API_KEY_HERE
   ```

   Replace `YOUR_API_KEY_HERE` with the actual API key you copied.

4. (Optional) Customize the default location:
   ```env
   # Default location: latitude,longitude
   DEFAULT_LOCATION=37.7749,-122.4194

   # Search radius in meters (default: 5000 = 5km)
   SEARCH_RADIUS=5000
   ```

5. Save and close the file

### 2.2 Example `.env` File

```env
# Google Places API Key
GOOGLE_PLACES_API_KEY=AIzaSyC1234567890abcdefghijklmnopqrstuv

# Default search location (San Francisco)
DEFAULT_LOCATION=37.7749,-122.4194

# Search radius in meters
SEARCH_RADIUS=5000
```

---

## Step 3: Start the Application

### 3.1 Install Dependencies (if not already done)

```bash
# In the server/ directory
npm install
```

### 3.2 Start the Backend

```bash
# In the server/ directory
npm run dev
```

You should see:
```
🚀 LocalLink API running on http://localhost:3001
🗺️  Google Places API: ✅ Configured
📍 Default location: 37.7749,-122.4194 (San Francisco)
📏 Search radius: 5000m
```

### 3.3 Start the Frontend

Open a new terminal:

```bash
# In the client/ directory
cd ../client
npm run dev
```

### 3.4 Open the Application

Open your browser and go to:
```
http://localhost:5173
```

---

## Step 4: Using the Location Feature

LocalLink now includes a **location picker** that lets you search for businesses in different cities:

1. On the home page, find the **"📍 Location"** dropdown
2. Select from 10 major US cities:
   - San Francisco, CA
   - Los Angeles, CA
   - New York, NY
   - Chicago, IL
   - Houston, TX
   - Phoenix, AZ
   - Denver, CO
   - Seattle, WA
   - Boston, MA
   - Miami, FL

3. The app will automatically fetch real businesses from that location!

---

## Features Powered by Google Places

### 🏪 Real Business Data
- Actual businesses from Google Maps
- Categories: Food, Retail, Services
- Real ratings and review counts

### 📸 High-Quality Photos
- Professional images from Google
- Fallback images if no photo available

### ⭐ Authentic Reviews
- Google reviews displayed on detail pages
- Users can also submit local reviews through LocalLink

### 🕐 Business Hours & Status
- Full weekly hours
- Real-time "Open Now" / "Closed" indicator

### 🔗 External Links
- **Website** - Direct links to business websites
- **Google Maps** - One-click directions

---

## Caching & Performance

LocalLink implements smart caching to minimize API costs:

- **1-hour cache** for search results
- **1-hour cache** for business details
- Results are cached by location and search query
- Cache automatically expires and refreshes

This means repeated searches in the same location won't cost additional API calls!

---

## Troubleshooting

### "Failed to fetch businesses" Error

**Cause:** API key not configured or invalid

**Solution:**
1. Check that your `.env` file has the correct API key
2. Restart the backend server
3. Verify the API key is correct in Google Cloud Console

### "Google Places API: ❌ Not configured"

**Cause:** `.env` file is empty or API key is missing

**Solution:**
1. Open `server/.env`
2. Add your API key: `GOOGLE_PLACES_API_KEY=your_key_here`
3. Restart the backend

### No businesses showing up

**Possible causes:**
1. **No businesses in that location** - Try a different city
2. **API quota exceeded** - Check Google Cloud Console > APIs & Services > Dashboard
3. **Billing not enabled** - Enable billing in Google Cloud Console

### "Request failed" or API errors

**Solution:**
1. Check the backend console for error messages
2. Verify Places API is enabled in Google Cloud Console
3. Check that billing is enabled
4. Verify API key restrictions allow "Places API"

---

## Cost Management

### Staying Within Free Tier

With LocalLink's caching system and typical usage:
- **Development:** ~10-50 API calls per session
- **Demo/Presentation:** ~20-100 API calls
- **Monthly free tier:** ~$200 credit = ~6,000+ searches

**Tips to minimize costs:**
1. Use the same location for testing (benefits from cache)
2. The cache refreshes every hour automatically
3. Avoid changing locations too frequently during demos
4. Consider using a smaller search radius (reduces results returned)

### Monitoring Usage

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Select your project
3. Go to **APIs & Services > Dashboard**
4. Click on **"Places API"** to see usage metrics

---

## Data Mapping

### Google Places → LocalLink Format

| Google Field | LocalLink Field | Notes |
|--------------|----------------|-------|
| `place_id` | `id` | String ID instead of number |
| `name` | `name` | Business name |
| `types[]` | `category` | Mapped to Food/Retail/Services |
| `rating` | `rating` | 1-5 stars |
| `user_ratings_total` | `reviewCount` | Total review count |
| `photos[0]` | `image` | Photo URL via Places API |
| `formatted_address` | `address` | Full address |
| `formatted_phone_number` | `phone` | Phone number |
| `opening_hours` | `hours` | Weekly hours text |
| `website` | `website` | Business website |
| `opening_hours.open_now` | `isOpenNow` | Boolean status |
| `price_level` | `priceRange` | $ to $$$ |
| `reviews[]` | `reviews` | Google reviews |

---

## Support

For Google Places API issues:
- [Google Places API Documentation](https://developers.google.com/maps/documentation/places/web-service)
- [Google Cloud Support](https://cloud.google.com/support)

For LocalLink technical issues:
- Check the backend console for detailed error messages
- Verify all dependencies are installed
- Ensure both frontend and backend servers are running

---

## Next Steps

✅ You're all set! LocalLink now displays real businesses from Google Maps.

**For your FBLA presentation:**
- Choose a location relevant to your judges (e.g., their city)
- Demonstrate the location picker feature
- Show how "Open Now" status works in real-time
- Click through to Google Maps for directions
- Show both Google reviews and local review submission

**Enjoy showcasing real-world data in your LocalLink app!** 🎉
