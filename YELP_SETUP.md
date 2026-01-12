# Yelp Fusion API Setup Instructions

LocalLink now integrates with Yelp Fusion API to provide:
- ✅ Real business photos
- ✅ Actual verified websites
- ✅ Real customer reviews
- ✅ Accurate hours, phone numbers, and addresses

## Getting Your FREE Yelp API Key

### Step 1: Create a Yelp Developer Account

1. Go to https://www.yelp.com/developers
2. Click "Get Started" or "Create an Account"
3. Sign up with your email or use existing Yelp account

### Step 2: Create an App

1. Go to https://www.yelp.com/developers/v3/manage_app
2. Click "Create New App"
3. Fill out the form:
   - **App Name**: LocalLink (or any name you prefer)
   - **Industry**: Technology
   - **Company**: Your company/school name
   - **Contact Email**: Your email
   - **Description**: "Local business discovery platform for Cumming, GA"
4. Accept the Terms of Service
5. Click "Create New App"

### Step 3: Get Your API Key

1. After creating your app, you'll see your **API Key** on the app details page
2. Copy the API key (it looks like: `abc123def456...`)

### Step 4: Configure LocalLink

1. Navigate to the server folder: `cd server`
2. Open the `.env` file
3. Replace `your_yelp_api_key_here` with your actual API key:
   ```
   YELP_API_KEY=your_actual_api_key_here
   ```
4. Save the file
5. Restart the server: `npm start`

## API Limits (FREE Tier)

- **500 API calls per day** (resets daily)
- LocalLink uses **100 calls per cache refresh** (50 businesses × 2 calls each)
- Cache lasts **1 hour**, so you can refresh ~5 times per day
- Perfect for development and demonstration!

## What Gets Enhanced

### Top 50 Businesses Get:
- ✅ Real business photos from Yelp
- ✅ Verified websites and phone numbers
- ✅ Real customer reviews (up to 3 per business)
- ✅ Accurate ratings and review counts
- ✅ Current hours of operation
- ✅ Price range information

### Remaining 250 Businesses Get:
- Standard OpenStreetMap data
- Generic category images
- Basic information

## Verifying It Works

After setting up your API key and restarting the server, you should see:

```
🚀 LocalLink API running on http://localhost:3001
🗺️  Data Source: OpenStreetMap + Yelp Fusion API
📍 Location: Cumming, Georgia
📏 Search radius: 10 miles (16093 meters)
💾 Storing: 300 most relevant local businesses
✅ Fetched 5000+ businesses from OpenStreetMap
📊 Filtered to 300 relevant businesses
🎯 Top business: [Business Name] (score: XXX)
🏪 300 local businesses, 0 chains
🔍 Enriching top 50 businesses with Yelp data...
✅ Enriched XX/50 businesses with Yelp data
📝 Imported XX real reviews from Yelp
```

## Troubleshooting

### "Yelp API not configured" message
- Check that `.env` file exists in the `server/` folder
- Verify API key is correctly copied (no extra spaces)
- Restart the server after adding the key

### "Enriched 0/50 businesses"
- Verify your API key is valid
- Check internet connection
- Ensure you haven't exceeded the 500 calls/day limit

### Reviews showing "0" but backend says "Imported XX reviews"
- Reviews are cached for 1 hour
- Clear browser cache or wait for cache to expire
- Check browser console for errors

## Without Yelp API Key

LocalLink still works without Yelp API! You'll get:
- OpenStreetMap business data
- Generic category images (Unsplash)
- Simulated ratings and review counts
- All features except real reviews

---

**Need Help?** Check the Yelp Fusion API docs: https://www.yelp.com/developers/documentation/v3
