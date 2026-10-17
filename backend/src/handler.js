// The one Express app, shared by every host adapter:
//   backend/api/index.js     -> Vercel serverless function (free Hobby plan)
//   backend/worker/index.js  -> Cloudflare Workers (free plan, nodejs_compat)
//   backend/server.js        -> any Node host / local dev (`npm start`)
const { createApp } = require('./app');

let app;
module.exports = function handler(req, res) {
  app = app || createApp();
  return app(req, res);
};
