// Vercel serverless function wrapper for Express app
// Vercel automatically routes /api/* requests to this function

import app from '../server/index.js';

// Vercel expects a handler function that receives (req, res)
export default (req, res) => {
  // Let Express handle the request
  return app(req, res);
};
