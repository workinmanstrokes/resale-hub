// Vercel serverless function. vercel.json rewrites /api/* here; the Express app routes
// on the original path. Set the env vars from backend/.env.example in the Vercel
// project (Settings > Environment Variables).
module.exports = require('../src/handler');
