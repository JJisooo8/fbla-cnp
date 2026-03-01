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
- **Interactive FAQ Assistant**: Built-in chatbot widget for answering common user questions
- **Personalized Recommendations**: Algorithm-driven "Local Gems" suggestions based on user favorites

---

## Tech Stack

### Frontend

| Technology | Purpose |
|------------|---------|
| **React 19** | Component-based UI library using hooks for state management |
| **Vite** | Fast build tool with hot module replacement for development |
| **CSS Modules** | Scoped styling to prevent class name conflicts |
| **ES Modules** | Modern JavaScript module system for better code organization |

**Why React?** React's Virtual DOM and reconciliation algorithm enable efficient UI updates by diffing component trees and applying minimal DOM mutations. The hooks-based API (useState, useEffect) provides a functional approach to state management and side-effect handling without external state libraries. React's component lifecycle and unidirectional data flow make the application predictable and debuggable. The ecosystem offers production-grade tooling for linting, testing, and performance profiling.

### Backend

| Technology | Purpose |
|------------|---------|
| **Node.js** | JavaScript runtime enabling full-stack development in one language |
| **Express 5** | Minimal web framework for RESTful API endpoints |
| **node-cache** | In-memory caching to reduce API calls and improve performance |
| **bcryptjs** | Secure password hashing for user authentication |
| **jsonwebtoken** | Stateless authentication via JWT tokens |

**Why Express?** Express's middleware pipeline architecture allows composable request processing — each middleware function handles a specific concern (CORS, JSON parsing, authentication, route handling) in an ordered chain. Route chaining with HTTP method-specific handlers maps cleanly to RESTful API design. Express 5's native async/await support eliminates callback nesting and simplifies error propagation throughout the request lifecycle.

### Data Sources

| Service | Purpose |
|---------|---------|
| **OpenStreetMap** | Free, community-maintained business data (no API key required) |
| **Yelp API** (optional) | Enrichment data including photos, hours, and websites |
| **Vercel Blob** | Serverless storage for user data and reviews in production |

**Why OpenStreetMap?** Unlike Google Places, OpenStreetMap is completely free with no usage limits, making it sustainable for any deployment scale. Its Overpass API supports complex geospatial queries, and the community-maintained dataset ensures accurate local business coverage.

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

### Code Architecture

LocalLink follows a **single-page application (SPA)** architecture with a clear separation between the React frontend and Express API backend.

**Frontend approach**: The application uses a single root component (`App.jsx`) that manages all views via state-based rendering rather than client-side routing. This decision was intentional — the app has a focused feature set (browse, detail, favorites, auth) that benefits from shared state across views without the overhead of a routing library. Internal organization uses clearly delimited sections with descriptive comments separating concerns: state management, data fetching, event handlers, utility functions, and render logic.

**Backend approach**: The Express server (`index.js`) centralizes all API routes in a single entry point with middleware-based request processing. Routes are organized by domain (authentication, businesses, reviews, recommendations, verification) with consistent error handling and input validation patterns. This monolithic server structure is common in Express applications and is appropriate for the API's scope.

**Why this architecture?** For a competition application with a defined feature set, collocating related code reduces indirection and makes the codebase immediately navigable. Every feature can be traced from its UI trigger through the API call to the data layer without jumping between dozens of files. The tradeoff — larger individual files — is mitigated by consistent section organization and thorough commenting.

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

- Business data: [OpenStreetMap](https://www.openstreetmap.org/) contributors — Open Database License (ODbL)
- Optional enrichment: [Yelp Fusion API](https://docs.developer.yelp.com/) — Yelp Terms of Service
- Stock images: [Unsplash](https://unsplash.com/) — Unsplash License (free to use)

---

## Open Source Dependencies & Licenses

### Frontend (client/)

| Package | Version | License | Purpose |
|---------|---------|---------|---------|
| [React](https://react.dev/) | 19.2.0 | MIT | Component-based UI rendering library |
| [React DOM](https://react.dev/) | 19.2.0 | MIT | React renderer for web browsers |
| [Vite](https://vite.dev/) | 7.2.4 | MIT | Frontend build tool with hot module replacement |
| [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react) | 5.1.1 | MIT | React integration for Vite (JSX transform, Fast Refresh) |
| [ESLint](https://eslint.org/) | 9.39.1 | MIT | JavaScript linting and code quality |
| [eslint-plugin-react-hooks](https://www.npmjs.com/package/eslint-plugin-react-hooks) | 7.0.1 | MIT | Enforces React Hooks rules |
| [eslint-plugin-react-refresh](https://www.npmjs.com/package/eslint-plugin-react-refresh) | 0.4.24 | MIT | Validates React Fast Refresh compatibility |

### Backend (server/)

| Package | Version | License | Purpose |
|---------|---------|---------|---------|
| [Express](https://expressjs.com/) | 5.2.1 | MIT | Web framework for RESTful API endpoints |
| [bcryptjs](https://www.npmjs.com/package/bcryptjs) | 3.0.3 | MIT | Password hashing with bcrypt algorithm |
| [jsonwebtoken](https://www.npmjs.com/package/jsonwebtoken) | 9.0.3 | MIT | JWT creation and verification for stateless auth |
| [@vercel/blob](https://vercel.com/docs/storage/vercel-blob) | 2.0.0 | Apache-2.0 | Serverless object storage for user data |
| [axios](https://axios-http.com/) | 1.13.2 | MIT | HTTP client for external API calls (Yelp, OpenStreetMap) |
| [cors](https://www.npmjs.com/package/cors) | 2.8.5 | MIT | Cross-origin resource sharing middleware |
| [dotenv](https://www.npmjs.com/package/dotenv) | 17.2.3 | BSD-2-Clause | Environment variable management |
| [node-cache](https://www.npmjs.com/package/node-cache) | 5.1.2 | MIT | In-memory caching with TTL support |
| [nodemon](https://nodemon.io/) | 3.1.11 | MIT | Development auto-restart on file changes |

### External Services

| Service | Usage | Terms |
|---------|-------|-------|
| [Google reCAPTCHA v2](https://developers.google.com/recaptcha) | Bot prevention on signup | Google Terms of Service |
| [Vercel](https://vercel.com/) | Application hosting and serverless functions | Vercel Terms of Service |

### Icons & Assets

All SVG icons used in the application are custom inline SVGs created specifically for this project. No external icon library is used. All business images are sourced from public APIs (Yelp, Google) or placeholder gradients generated in CSS.

---

## License

Created for educational purposes as part of FBLA Coding & Programming competition.
