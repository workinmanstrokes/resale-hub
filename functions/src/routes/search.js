const express = require('express');
const adapters = require('../adapters');
const { optionalAuth } = require('../middleware/auth');
const { limits } = require('../middleware/rateLimit');
const { wrap } = require('../lib/errors');

const router = express.Router();

// Public (no account needed), rate limited per user when signed in, else per IP.
router.get(
  '/',
  optionalAuth,
  limits.search,
  wrap(async (req, res) => {
    const q = String(req.query.q || '').trim().slice(0, 200);
    if (!q) return res.status(400).json({ error: 'q (search query) is required' });

    const maxPrice = Number(req.query.maxPrice);
    const options = {
      maxPrice: Number.isFinite(maxPrice) && maxPrice > 0 ? maxPrice : undefined,
      condition: ['new', 'used', 'refurbished'].includes(req.query.condition) ? req.query.condition : undefined,
    };

    const sources = adapters.searchable();
    const skipped = adapters
      .list()
      .filter((a) => !a.configured)
      .map((a) => ({ marketplace: a.key, label: a.label, reason: a.note || 'API key not configured' }));

    const settled = await Promise.allSettled(sources.map((a) => a.search(q, options)));
    const results = [];
    const errors = [];
    settled.forEach((outcome, i) => {
      if (outcome.status === 'fulfilled') results.push(...outcome.value);
      else {
        console.warn(`search ${sources[i].key} failed`, outcome.reason?.message);
        errors.push({ marketplace: sources[i].key, error: 'Temporarily unavailable' });
      }
    });

    results.sort((a, b) => a.totalPrice - b.totalPrice);
    results.forEach((r, i) => {
      r.bestDeal = i === 0;
    });

    res.json({ query: q, results, skipped, errors });
  })
);

module.exports = router;
