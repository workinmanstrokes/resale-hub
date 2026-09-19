const express = require('express');
const adapters = require('../adapters');

const router = express.Router();

router.get('/', async (req, res) => {
  const { q, maxPrice, condition } = req.query;
  if (!q || !String(q).trim()) {
    return res.status(400).json({ error: 'q (search query) is required' });
  }

  const options = {
    maxPrice: maxPrice ? Number(maxPrice) : undefined,
    condition: condition || undefined,
  };

  const sources = adapters.searchable();
  const skipped = adapters
    .list()
    .filter((a) => !a.configured)
    .map((a) => ({ marketplace: a.key, label: a.label, reason: a.note || 'API key not configured' }));

  const settled = await Promise.allSettled(
    sources.map((adapter) => adapter.search(String(q), options))
  );

  const results = [];
  const errors = [];
  settled.forEach((outcome, i) => {
    const adapter = sources[i];
    if (outcome.status === 'fulfilled') {
      results.push(...outcome.value);
    } else {
      errors.push({ marketplace: adapter.key, error: outcome.reason?.message || String(outcome.reason) });
    }
  });

  results.sort((a, b) => a.totalPrice - b.totalPrice);
  results.forEach((r, i) => {
    r.bestDeal = i === 0;
  });

  res.json({ query: q, results, skipped, errors });
});

module.exports = router;
