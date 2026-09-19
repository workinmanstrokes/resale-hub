require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const adapters = require('./adapters');
const authRoutes = require('./routes/auth');
const listingsRoutes = require('./routes/listings');
const searchRoutes = require('./routes/search');
const ebayOAuthRoutes = require('./routes/ebayOAuth');
const uploadsRoutes = require('./routes/uploads');

if (!process.env.JWT_SECRET) {
  console.warn(
    'WARNING: JWT_SECRET is not set. Copy .env.example to .env and set a real secret before using auth.'
  );
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' })); // generous limit for base64 photo payloads

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.get('/api/marketplaces', (req, res) => res.json(adapters.list()));

app.use('/api/auth', authRoutes);
app.use('/api/listings', listingsRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/ebay/oauth', ebayOAuthRoutes);
app.use('/api/uploads', uploadsRoutes);
app.use('/uploads', express.static(path.join(__dirname, '..', 'data', 'uploads')));

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Resale Hub API listening on http://localhost:${PORT}`);
  const configured = adapters.list().filter((a) => a.configured).map((a) => a.label);
  console.log(
    configured.length
      ? `Configured marketplaces: ${configured.join(', ')}`
      : 'No marketplace API keys configured yet — search will return empty results until you add some to .env'
  );
});
