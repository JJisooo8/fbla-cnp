# Judge Q&A Preparation — LocalLink

*FBLA Coding & Programming: Byte-Sized Business Boost*

This document prepares for the 5-minute Q&A portion of the state presentation. Each question includes a suggested answer that is honest, specific, and demonstrates technical understanding.

---

## 1. Why did you choose React and JavaScript for this project?

We chose JavaScript for full-stack consistency — the same language runs on both the frontend and backend, which reduces context-switching and lets us share validation logic. On the frontend, we use React because its component-based architecture and Virtual DOM make it efficient for building interactive UIs. React's hooks API — specifically useState and useEffect — gave us a clean, functional approach to managing state without needing a separate state management library like Redux. The ecosystem is mature, with strong tooling for linting, debugging, and performance profiling.

## 2. Walk me through your authentication flow.

When a user signs up, they complete a CAPTCHA verification (Google reCAPTCHA v2 or a math challenge fallback). Their password is hashed using bcrypt with 10 salt rounds — we never store plaintext passwords. On successful signup, the server generates a JSON Web Token (JWT) containing the user's ID. This token is stored in the browser's localStorage and sent in the Authorization header with every authenticated request. The server verifies the JWT signature using a secret key before processing protected requests. Sessions are stateless — there's no server-side session store, which simplifies scaling.

## 3. How does your data persist across sessions?

We have a multi-layer data architecture. In production on Vercel, user accounts and reviews are stored in Vercel Blob, which is serverless object storage. When the server starts, it loads this data into memory for fast access and uses node-cache with a one-hour TTL for business data. On the client side, the auth token and dark mode preference are saved in localStorage. In development, we fall back to a local JSON file (data/users.json) so the app works fully offline without any cloud services.

## 4. How does the Yelp API integration work?

The Yelp integration is optional enrichment. Our primary data source is OpenStreetMap, which provides free, community-maintained business listings. When a Yelp API key is configured, the server uses it to enrich businesses with photos, website URLs, business hours, and phone numbers by matching on business name and coordinates. If the API key isn't provided, the app works fully with OpenStreetMap data alone. We chose this approach so the application isn't dependent on any paid API.

## 5. What was the hardest bug you encountered?

One significant challenge was review data consistency. When multiple users submit reviews simultaneously, we needed to ensure we weren't overwriting each other's data in Vercel Blob storage. We solved this by always refreshing from Blob before writing, using a read-modify-write pattern. Another challenge was CAPTCHA rendering — reCAPTCHA widgets need specific DOM timing, so we had to coordinate React's rendering lifecycle with the Google reCAPTCHA script loading using setTimeout and DOM element checks to ensure the container exists before rendering.

## 6. How did you handle bot prevention?

We implemented dual CAPTCHA verification on the signup form. The primary method is Google reCAPTCHA v2, which presents a visual challenge to distinguish humans from bots. As a fallback — for environments where the reCAPTCHA script can't load — we generate server-side math challenges. Each challenge has a unique ID stored in a Map with a 10-minute expiration. The server validates the answer before allowing account creation. CAPTCHA is only required at signup, not on every review, because once a user is verified, their JWT authenticates subsequent actions.

## 7. Explain your data export feature.

The Developer Tools section on the home page lets users export business data in either JSON or CSV format. The export adapts to the user's current filters — if they're viewing only "Food" businesses with a minimum 4-star rating, the export reflects exactly that filtered set. The exported data includes business name, category, rating, review count, address, phone number, website, tags, and any active deals. For CSV, we handle proper escaping of commas and quotes in business names and addresses. This makes the tool useful for data analysis and reporting.

## 8. What accessibility features did you implement?

Accessibility was a priority throughout development. We implemented: semantic HTML with proper heading hierarchy, 50+ ARIA labels on interactive elements, keyboard navigation (Tab, Enter, Escape), visible focus indicators, skip-to-content links, aria-live regions for dynamic content updates, and a prefers-reduced-motion media query that disables animations. Our color contrast ratios meet WCAG AA standards in both light and dark mode. Form inputs have associated labels, and error messages use role="alert" for screen reader announcements. The responsive design works at four breakpoints — 480px, 640px, 768px, and 1024px.

## 9. How do you handle users who aren't logged in?

Unauthenticated users can browse all businesses, view details, read reviews, search, filter, and export data. They see full functionality for discovery. When they try to perform an action that requires authentication — like saving a favorite or writing a review — they're redirected to the login page with their previous location saved. After logging in, they're automatically returned to where they were. This approach maximizes the "browsing" experience while making account creation feel natural when needed.

## 10. How does your recommendation system work?

The "Local Gems For You" section uses a scoring algorithm based on the user's favorites. When a user saves favorites, the server analyzes which business categories they prefer and assigns category scores. Each non-favorited business is then scored based on: category match (primary factor), Yelp rating (businesses rated 4.5+ get a 15-point bonus), active deals (5-point bonus), and whether it's an independent local business versus a chain (3-point bonus). The top 4 scored businesses are displayed as recommendations. The more favorites a user saves, the more accurate the recommendations become.

## 11. Did you use any AI tools in development?

Yes, we used AI tools as coding assistants for tasks like generating boilerplate code, debugging, and suggesting implementation approaches. However, every line of code was reviewed, understood, and tested by the team. The AI helped accelerate development but didn't make architectural decisions — those came from our understanding of the requirements, the technologies, and the user experience we wanted to create. We believe using AI tools responsibly is a valuable modern development skill.

## 12. What would you add with more time?

With more development time, we would add: a real-time notification system when businesses you follow post new deals, a social sharing feature for reviews, multi-language support for our diverse community in Cumming, Georgia, a mobile app using React Native to share code with our web app, and an enhanced recommendation engine using collaborative filtering (recommending businesses that similar users enjoyed). We'd also add an admin dashboard for business owners to manage their listings and respond to reviews.

## 13. How is your code organized?

Our project follows a client-server architecture. The frontend is a React single-page application built with Vite, using CSS Modules for scoped styling. The backend is an Express API with RESTful routes organized by domain — authentication, businesses, reviews, recommendations, and verification. In production, we also have Vercel serverless functions that mirror the Express routes for edge deployment. The codebase uses consistent naming conventions (camelCase for variables and functions, PascalCase for components), thorough section comments, and JSDoc headers on major files.

## 14. How do you handle input validation?

We validate inputs on both the client and server side. For signup: usernames must be 3-20 characters with only letters, numbers, and underscores — validated with a regex pattern. Passwords require 8+ characters with the UI showing a real-time strength indicator checking for uppercase, lowercase, numbers, and special characters. Confirm password is checked for match. On the server, we re-validate everything — we never trust client-side validation alone. For reviews, ratings must be integers between 1-5, and comments are limited to 2,000 characters. The server validates data types, ranges, and lengths before any database write.

## 15. What design decisions made the biggest impact on user experience?

Three design decisions stand out. First, the dual-theme system (light/dark mode) with proper contrast ratios makes the app comfortable for extended use. Second, the "smart" review sorting algorithm that weighs recency, upvotes, and comment length surfaces the most helpful reviews first, rather than just showing the newest. Third, the interactive FAQ chatbot in the bottom corner provides immediate help without leaving the page — users can ask about features like filtering, favorites, or data export and get instant answers.

## 16. How do you prevent abuse of the review system?

Multiple layers: first, account creation requires CAPTCHA verification, which prevents bot registrations. Second, only authenticated users can post reviews. Third, other users can report reviews they find inappropriate — once a review receives multiple reports, it's automatically hidden from the public view. Fourth, we have upvoting so quality reviews surface above low-effort ones. Users can also edit or delete their own reviews, which encourages thoughtful contributions since their username is attached.

## 17. How does the search and filtering system work?

The search system operates on multiple dimensions. Text search matches against business names, categories, and tags. Label filtering uses chip-based UI where users can select multiple tags (like "Pizza," "Coffee," "Outdoor Seating") to narrow results using AND logic. The rating filter sets a minimum threshold. The deals toggle shows only businesses with active promotions. All these filters compose together — a user can search "coffee" + filter by 4+ stars + deals only, and the results update instantly. The filtered view also determines what gets exported in Developer Tools.

## 18. Explain your approach to dark mode.

Dark mode is controlled by a state variable that persists in localStorage. When toggled, we set a data-theme attribute on the document root element, which activates a comprehensive set of CSS custom property overrides — background colors, text colors, border colors, shadows, and component-specific styles all adapt. We use CSS custom properties (design tokens) as a single source of truth, so changing the theme cascades through the entire application consistently. The toggle remembers the user's preference across sessions.

## 19. What testing did you do?

We tested the application through manual testing across multiple browsers (Chrome, Firefox, Safari, Edge) and devices (desktop, tablet, mobile viewports). We verified all CRUD operations for reviews, tested edge cases in validation (empty inputs, maximum lengths, special characters), confirmed CAPTCHA flows work with and without reCAPTCHA, verified data persistence across server restarts, tested accessibility with keyboard-only navigation, and checked dark mode styling across all views. We also tested the export feature with various filter combinations to ensure data accuracy.

## 20. How do deals and promotions work in the application?

Businesses can have associated deals that display as badges on their cards. In the current implementation, deals are stored as part of the business data — each business object can have a "deal" field with promotional text. Users can toggle "Deals Only" in the filter section to exclusively see businesses with active offers. The deal information appears on both the business card in the listing view and in the detail view. This feature directly addresses the rubric requirement to "display special deals or coupons" and encourages users to discover value at local businesses.
