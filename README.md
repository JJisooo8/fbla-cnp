# LocalLink

**A web application that helps users discover and support small, local businesses in their community.**

Created for FBLA Coding & Programming: Byte-Sized Business Boost

---

## Project Overview

LocalLink addresses the FBLA "Byte-Sized Business Boost" challenge by providing a comprehensive platform for discovering local businesses in Cumming, Georgia. The application connects community members with nearby restaurants, retail stores, and service providers through an intuitive interface that encourages supporting local commerce.

### Key Capabilities

- **Business Discovery**: Browse real businesses from OpenStreetMap with optional Yelp data enrichment
- **Category Sorting**: Filter businesses by type (Food, Retail, Services) and custom labels
- **Reviews & Ratings**: Community-driven review system with star ratings and category breakdowns
- **Sort by Reviews/Ratings**: Order results by rating, review count, or relevance
- **Favorites System**: Save and bookmark businesses for quick access
- **Special Deals Display**: Highlighted promotions and offers from local businesses
- **Bot Prevention**: CAPTCHA verification (reCAPTCHA v2 or math challenge) on user signup

---

## Tech Stack

### Frontend

| Technology | Purpose |
|------------|---------|
| **React 19** | Component-based UI library using hooks for state management |
| **Vite** | Fast build tool with hot module replacement for development |
| **CSS Modules** | Scoped styling to prevent class name conflicts |
| **ES Modules** | Modern JavaScript module system for better code organization |

**Why React?** React's component architecture allows for modular, reusable UI elements. The hooks-based approach simplifies state management without external libraries.

### Backend

| Technology | Purpose |
|------------|---------|
| **Node.js** | JavaScript runtime enabling full-stack development in one language |
| **Express 5** | Minimal web framework for RESTful API endpoints |
| **node-cache** | In-memory caching to reduce API calls and improve performance |
| **bcryptjs** | Secure password hashing for user authentication |
| **jsonwebtoken** | Stateless authentication via JWT tokens |

**Why Express?** Express provides a lightweight foundation that doesn't impose unnecessary structure, making it ideal for a focused API server.

### Data Sources

| Service | Purpose |
|---------|---------|
| **OpenStreetMap** | Free, community-maintained business data (no API key required) |
| **Yelp API** (optional) | Enrichment data including photos, hours, and websites |
| **Vercel Blob** | Serverless storage for user data and reviews in production |

**Why OpenStreetMap?** Unlike Google Places, OpenStreetMap is completely free with no usage limits, making it sustainable for any deployment scale.

### Deployment

| Platform | Purpose |
|----------|---------|
| **Vercel** | Serverless hosting with automatic scaling and global CDN |
| **Vercel Blob** | Persistent storage for user accounts and reviews |

---

## Installation

### Prerequisites

- Node.js v16 or higher
- npm (included with Node.js)

### Local Development Setup

1. **Clone and navigate to the repository**
   ```bash
   cd fbla-cnp
   ```

2. **Install backend dependencies**
   ```bash
   cd server
   npm install
   ```

3. **Install frontend dependencies**
   ```bash
   cd ../client
   npm install
   ```

4. **Start the backend server** (Terminal 1)
   ```bash
   cd server
   npm run dev
   ```
   The API runs on `http://localhost:3001`

5. **Start the frontend** (Terminal 2)
   ```bash
   cd client
   npm run dev
   ```
   The application runs on `http://localhost:5173`

6. **Open the application**
   Navigate to `http://localhost:5173` in your browser

### Environment Variables (Optional)

Create a `.env` file in the `server` directory for enhanced features:

```env
# Yelp API for business enrichment (photos, hours, websites)
YELP_API_KEY=your_key_here

# Google Custom Search for additional business images
GOOGLE_SEARCH_API_KEY=your_key_here
GOOGLE_SEARCH_ENGINE_ID=your_id_here

# reCAPTCHA v2 for enhanced bot prevention
RECAPTCHA_SITE_KEY=your_site_key_here
RECAPTCHA_SECRET_KEY=your_secret_key_here
```

The application functions fully without these keys using OpenStreetMap data and a math-based verification challenge.

---

## User Guide

### Browsing Businesses

1. The home page displays community statistics, local favorites, and personalized recommendations
2. Use the search bar to find businesses by name
3. Click label chips to filter by category (e.g., "Pizza", "Coffee", "Salon")
4. Adjust the rating filter to show only highly-rated businesses
5. Toggle "Deals Only" to see businesses with active promotions
6. Click any business card to view full details

### Viewing Business Details

1. The detail view shows comprehensive information: address, phone, hours, and website
2. Click "Directions" to open the location in Google Maps
3. View the rating breakdown by category (Quality, Service, Cleanliness, Atmosphere)
4. Read community reviews sorted by relevance, newest, or oldest
5. Click tags to discover similar businesses

### Managing Favorites

1. Log in or create an account to save favorites
2. Click the heart icon on any business card to save it
3. Access all saved businesses from the "Favorites" tab in the navigation
4. Favorites persist across sessions and inform personalized recommendations

### Writing Reviews

1. Log in to your account (required to prevent spam)
2. Open a business detail page and click "Write a Review"
3. Rate the business overall (1-5 stars)
4. Optionally rate by category: Quality, Service, Cleanliness, Atmosphere
5. Add a written comment to share your experience
6. Submit the review (no additional CAPTCHA required after signup)

### Special Features

- **Upvote Reviews**: Mark helpful reviews to surface quality content
- **Report Reviews**: Flag inappropriate content for moderation
- **Edit/Delete**: Modify or remove your own reviews
- **Export Data**: Use Developer Tools to export business data as JSON or CSV

---

## Accessibility Features

- Semantic HTML structure with proper heading hierarchy
- ARIA labels on interactive elements
- Keyboard navigation support (Tab, Enter, Escape)
- Focus indicators on all interactive components
- Screen reader compatible form labels and error messages
- Sufficient color contrast ratios
- Responsive design for mobile and desktop viewports

---

## Project Structure

```
fbla-cnp/
├── client/                 # React frontend application
│   ├── src/
│   │   ├── App.jsx        # Main application component
│   │   ├── App.module.css # Component styles
│   │   ├── design-tokens.css # Design system variables
│   │   └── index.css      # Global styles
│   ├── package.json
│   └── vite.config.js
├── server/                 # Express backend API
│   ├── index.js           # Server and API routes
│   ├── seed-data.js       # Offline data seeding script
│   └── package.json
├── api/                    # Vercel serverless functions
│   ├── auth/              # Authentication endpoints
│   ├── businesses/        # Business and review endpoints
│   └── verification/      # CAPTCHA challenge endpoints
├── vercel.json            # Deployment configuration
└── README.md
```

---

## API Reference

### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/signup` | Create new user account |
| POST | `/api/auth/login` | Authenticate and receive JWT token |
| GET | `/api/auth/me` | Get current user information |

### Businesses
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/businesses` | List businesses with optional filters |
| GET | `/api/businesses/:id` | Get single business with reviews |
| POST | `/api/businesses/:id/reviews` | Submit a review (auth required) |

### Reviews
| Method | Endpoint | Description |
|--------|----------|-------------|
| PUT | `/api/businesses/:businessId/reviews/:reviewId` | Edit review |
| DELETE | `/api/businesses/:businessId/reviews/:reviewId` | Delete review |
| POST | `/api/businesses/:businessId/reviews/:reviewId/upvote` | Upvote review |
| POST | `/api/businesses/:businessId/reviews/:reviewId/report` | Report review |

### Query Parameters
| Parameter | Description | Example |
|-----------|-------------|---------|
| `category` | Filter by category | `Food`, `Retail`, `Services` |
| `search` | Search by name or tags | `pizza`, `coffee` |
| `minRating` | Minimum rating threshold | `4`, `4.5` |
| `hasDeals` | Show only businesses with deals | `true` |
| `sort` | Sort order | `rating`, `reviews`, `name` |

---

## FBLA Rubric Alignment

### Byte-Sized Business Boost Requirements

| Requirement | Implementation |
|-------------|----------------|
| Tool for local business discovery | Browse, search, and filter 100+ real businesses |
| Category sorting | Three main categories with dynamic label filtering |
| User reviews and ratings | Full review system with 5-star ratings |
| Sort by reviews/ratings | Multiple sort options available |
| Save/bookmark favorites | Persistent favorites with user accounts |
| Display special deals | Deal badges and dedicated filtering |
| Bot prevention | CAPTCHA verification on signup |

### Technical Criteria

| Criterion | Implementation |
|-----------|----------------|
| Modular code structure | Separated frontend/backend, logical component organization |
| Comments and naming | Descriptive names, technical documentation |
| Data structures | Arrays for collections, objects for entities, proper scoping |
| Language selection | JavaScript chosen for full-stack consistency |

---

## Data Attribution

- Business data: OpenStreetMap contributors (Open Database License)
- Optional enrichment: Yelp Fusion API
- Stock images: Unsplash (free to use)

---

## License

Created for educational purposes as part of FBLA Coding & Programming competition.
