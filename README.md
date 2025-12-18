# LocalLink - Byte-Sized Business Boost

**A web-based application that helps users discover and support small, local businesses in their community.**

Built for FBLA's Competitive Event: Byte-Sized Business Boost

---

## 🌟 Features

### Core Functionality
- **Browse Businesses**: View 8 local businesses across Food, Retail, and Services categories
- **Smart Search**: Search by name, description, tags, or category with intelligent scoring
- **Advanced Filters**: Filter by category, minimum rating, deals, and sort by rating/reviews/name
- **Business Details**: View comprehensive information including address, hours, contact, and tags
- **Favorites System**: Save and bookmark favorite businesses (persisted in browser)
- **Reviews & Ratings**: Submit reviews with spam protection verification
- **Special Deals**: Highlight businesses offering special promotions

### Intelligent Features
- **Personalized Recommendations**: AI-powered suggestions based on favorite businesses and categories
- **Trending Businesses**: Smart algorithm combining ratings, reviews, and deals to surface popular businesses
- **Analytics Dashboard**: Real-time stats showing total businesses, average rating, deal availability, and review counts
- **Smart Search Scoring**: Weighted search algorithm prioritizing name matches, then tags, descriptions, and categories

### Security & Validation
- **Spam Prevention**: Math-based CAPTCHA challenge before submitting reviews
- **Input Validation**: Server-side validation for all user submissions
- **Error Handling**: Comprehensive error handling on both frontend and backend

---

## 🏗️ Technical Architecture

### Backend (Node.js + Express)
- **RESTful API** with modular endpoint structure
- **8 Business Models** with rich attributes (rating, reviews, deals, tags, hours, contact)
- **Smart Algorithms**: Recommendation engine, trending calculator, search scoring
- **Anti-Spam System**: UUID-based verification challenges with expiration
- **Data Validation**: Robust input validation and error responses

### Frontend (React + Vite)
- **Modern React**: Hooks-based architecture with functional components
- **Single-Page Application**: Client-side routing between home, details, and favorites
- **Responsive Design**: Clean, accessible UI optimized for presentations
- **Local Storage**: Persistent favorites across sessions
- **Real-time Updates**: Dynamic filtering and instant search results

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
3. Apply filters: category, minimum rating, deals only
4. Sort results by rating, review count, or name
5. Click any business card to view full details

### Viewing Business Details
1. Click "View Details" or the business name/image
2. See comprehensive info: address, phone, hours, tags
3. View current rating and review count
4. Check for special deals and promotions
5. Read customer reviews

### Saving Favorites
1. Click the heart icon (🤍) on any business card
2. Heart turns red (❤️) when favorited
3. Access all favorites from the "Favorites" tab in header
4. Favorites persist across browser sessions

### Writing Reviews
1. Open any business detail page
2. Click "Write a Review" button
3. Enter your name (min 2 characters)
4. Select rating (1-5 stars using slider)
5. Write comment (min 10 characters)
6. Complete verification challenge (simple math problem)
7. Submit review - rating updates instantly

### Getting Recommendations
- Add businesses to favorites
- View "Recommended For You" section on homepage
- Algorithm analyzes your favorites and suggests similar businesses
- Recommendations update as you add more favorites

---

## 📊 Business Data Model

Each business includes:
- **Basic Info**: name, category, description
- **Ratings**: rating (1-5), review count, individual reviews
- **Contact**: address, phone, hours
- **Visual**: image URL
- **Marketing**: deals/coupons, tags, price range
- **Reviews**: author, rating, comment, date

---

## 🔒 Security Features

### Review Spam Prevention
- Math-based verification challenge (e.g., "What is 7 + 3?")
- Challenges expire after 5 minutes
- One-time use: challenge deleted after successful verification
- Server-side validation prevents bypassing

### Input Validation
- Author name: minimum 2 characters
- Rating: must be 1-5
- Comment: minimum 10 characters
- All inputs sanitized and validated server-side

---

## 🎯 Judging Demonstration Tips

1. **Start with Homepage**: Showcase analytics, trending, and recommendations
2. **Use Search**: Demonstrate smart search (try "coffee", "repair", "pet")
3. **Apply Filters**: Show category filtering, rating filters, deals toggle
4. **View Details**: Click a business to show comprehensive information
5. **Add Favorites**: Heart several businesses to trigger recommendations
6. **Submit Review**: Walk through the review process with verification
7. **Check Favorites**: Show persistence by navigating to Favorites tab

### Key Features to Highlight
- ✅ Real-time search with smart scoring
- ✅ Personalized recommendations based on favorites
- ✅ Trending algorithm combining multiple factors
- ✅ Spam prevention with verification system
- ✅ Clean, professional UI suitable for all ages
- ✅ Persistent data (favorites saved locally)
- ✅ Comprehensive business information
- ✅ Analytics dashboard

---

## 🛠️ Technology Stack

**Frontend:**
- React 19.2.0
- Vite 7.2.4
- CSS (inline styles for component encapsulation)

**Backend:**
- Node.js
- Express 5.2.1
- CORS enabled
- Crypto (UUID generation)

**Development:**
- Nodemon (backend auto-reload)
- ESLint (code quality)

---

## 📁 Project Structure

```
fbla-cnp/
├── client/                 # React frontend
│   ├── src/
│   │   ├── App.jsx        # Main application component
│   │   ├── main.jsx       # React entry point
│   │   └── index.css      # Global styles
│   ├── index.html         # HTML template
│   └── package.json       # Frontend dependencies
├── server/                 # Node/Express backend
│   ├── index.js           # API server with all endpoints
│   └── package.json       # Backend dependencies
├── README.md              # This file
└── .gitignore            # Git ignore rules
```

---

## 🎓 FBLA Compliance

This project fulfills all requirements for the **Byte-Sized Business Boost** prompt:

✅ **Web-based application**: Runs in browser, no installation required  
✅ **Local business directory**: 8 businesses across 3 categories  
✅ **Search & filter**: Multiple filter options and smart search  
✅ **Business details**: Comprehensive information pages  
✅ **User reviews**: Review system with spam prevention  
✅ **Deals/coupons**: Special offers highlighted throughout  
✅ **Clean UI**: Professional, accessible design  
✅ **Intelligent features**: Recommendations, trending, analytics  
✅ **Secure**: Input validation and anti-spam measures  
✅ **Standalone**: Fully functional without external dependencies  

---

## 🚧 Future Enhancements

Potential features for expansion:
- User accounts and authentication
- Business owner portal to manage listings
- Photo uploads for reviews
- Map integration for locations
- Email notifications for new deals
- Social sharing capabilities
- Mobile app version
- Advanced analytics dashboard

---

## 📞 Support

For questions or issues:
1. Check this README thoroughly
2. Review code comments in App.jsx and server/index.js
3. Test all API endpoints using the browser or Postman

---

## 📄 License

Created for FBLA Competitive Events - Educational Use

---

**Made with ❤️ for supporting local businesses**