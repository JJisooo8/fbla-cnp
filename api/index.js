// Vercel serverless function for Express app
// Import the Express app from the server directory
import app from '../server/index.js';

// Export the Express app directly - Vercel will handle routing
// Vercel automatically routes /api/* requests to functions in /api directory
export default app;
