const express = require('express');
const cors = require('cors');

const adapters = require('./adapters');
const { HttpError } = require('./lib/errors');
const { limits } = require('./middleware/rateLimit');
const accountRoutes = require('./routes/account');
const listingsRoutes = require('./routes/listings');
const searchRoutes = require('./routes/search');
const ebayRoutes = require('./routes/ebay');
const uploadsRoutes = require('./routes/uploads');

function createApp() {
  const app = express();
  app.set('trust proxy', true); // Vercel / Cloudflare front ends set X-Forwarded-For
  app.disable('x-powered-by');
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  const api = express.Router();
  api.get('/health', (req, res) => res.json({ ok: true }));
  api.get('/marketplaces', (req, res) => res.json(adapters.list()));
  api.use('/account', accountRoutes);
  api.use('/listings', listingsRoutes);
  api.use('/search', searchRoutes);
  api.use('/ebay', ebayRoutes);
  api.use('/uploads', uploadsRoutes);

  // Served under /api on every host (https://<host>/api/...); also mounted at / so a
  // host that strips the prefix still works.
  app.use('/api', api);
  app.use('/', api);

  app.use((req, res) => res.status(404).json({ error: 'Not found' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: err.message, ...(err.extra || {}) });
    }
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request too large' });
    if (err.name === 'EbayError') {
      return res.status(err.status >= 400 && err.status < 500 ? 400 : 502).json({ error: err.message });
    }
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

module.exports = { createApp, limits };
