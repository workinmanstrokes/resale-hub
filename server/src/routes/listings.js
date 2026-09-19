const express = require('express');
const db = require('../db');
const adapters = require('../adapters');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

function withTargets(listing) {
  return {
    ...listing,
    targets: db.filter('listingTargets', (t) => t.listingId === listing.id),
  };
}

router.get('/', (req, res) => {
  const listings = db.filter('listings', (l) => l.userId === req.userId);
  res.json(listings.map(withTargets));
});

router.get('/:id', (req, res) => {
  const listing = db.find('listings', (l) => l.id === req.params.id && l.userId === req.userId);
  if (!listing) return res.status(404).json({ error: 'Listing not found' });
  res.json(withTargets(listing));
});

router.post('/', async (req, res) => {
  const { title, description, price, condition, category, photos } = req.body || {};
  if (!title || price == null) {
    return res.status(400).json({ error: 'title and price are required' });
  }

  const listing = await db.insert('listings', {
    id: db.id(),
    userId: req.userId,
    title,
    description: description || '',
    price: Number(price),
    condition: condition || 'used',
    category: category || 'general',
    photos: Array.isArray(photos) ? photos : [],
    status: 'draft',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  res.status(201).json(withTargets(listing));
});

router.patch('/:id', async (req, res) => {
  const listing = db.find('listings', (l) => l.id === req.params.id && l.userId === req.userId);
  if (!listing) return res.status(404).json({ error: 'Listing not found' });

  const allowed = ['title', 'description', 'price', 'condition', 'category', 'photos'];
  const patch = {};
  for (const key of allowed) {
    if (key in (req.body || {})) patch[key] = req.body[key];
  }

  const updated = await db.update('listings', listing.id, patch);
  res.json(withTargets(updated));
});

router.delete('/:id', async (req, res) => {
  const listing = db.find('listings', (l) => l.id === req.params.id && l.userId === req.userId);
  if (!listing) return res.status(404).json({ error: 'Listing not found' });

  await db.remove('listings', listing.id);
  const targets = db.filter('listingTargets', (t) => t.listingId === listing.id);
  await Promise.all(targets.map((t) => db.remove('listingTargets', t.id)));

  res.status(204).end();
});

router.post('/:id/publish', async (req, res) => {
  const listing = db.find('listings', (l) => l.id === req.params.id && l.userId === req.userId);
  if (!listing) return res.status(404).json({ error: 'Listing not found' });

  const requested = Array.isArray(req.body?.marketplaces) ? req.body.marketplaces : [];
  if (!requested.length) return res.status(400).json({ error: 'marketplaces[] is required' });

  const user = db.find('users', (u) => u.id === req.userId);

  const results = await Promise.all(
    requested.map(async (key) => {
      const adapter = adapters.get(key);
      const existingTarget = db.find(
        'listingTargets',
        (t) => t.listingId === listing.id && t.marketplace === key
      );

      const baseTarget = existingTarget || {
        id: db.id(),
        listingId: listing.id,
        marketplace: key,
      };

      if (!adapter) {
        return upsertTarget(baseTarget, { status: 'unsupported', error: 'Unknown marketplace' });
      }
      if (!adapter.capabilities.includes('publish')) {
        return upsertTarget(baseTarget, {
          status: 'unsupported',
          error: adapter.note || `${adapter.label} does not support publishing via API`,
        });
      }

      const userAuth = key === 'ebay' ? { refreshToken: user?.ebayRefreshToken } : {};
      if (adapter.key === 'ebay' && !userAuth.refreshToken) {
        return upsertTarget(baseTarget, {
          status: 'not_connected',
          error: 'Connect your eBay account first',
        });
      }

      try {
        const published = await adapter.publish(listing, userAuth);
        return upsertTarget(baseTarget, {
          status: 'published',
          externalId: published.externalId,
          url: published.url,
          error: null,
        });
      } catch (err) {
        return upsertTarget(baseTarget, { status: 'failed', error: err.message });
      }
    })
  );

  res.json({ listing: withTargets(listing), results });
});

async function upsertTarget(baseTarget, patch) {
  const existing = db.find('listingTargets', (t) => t.id === baseTarget.id);
  if (existing) {
    return db.update('listingTargets', baseTarget.id, patch);
  }
  return db.insert('listingTargets', {
    ...baseTarget,
    ...patch,
    updatedAt: new Date().toISOString(),
  });
}

module.exports = router;
