// Vercel serverless function - catch-all route for all API endpoints
// This file handles all requests to /api/* using the Express app

import app from '../server/index.js';

// Export the Express app as the default handler
// Vercel will automatically wrap it for serverless execution
export default app;
