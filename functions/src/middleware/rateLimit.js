// Per-user (or per-IP for anonymous calls) fixed-window rate limiting backed by
// Firestore, so limits hold across all function instances. Counter docs carry an
// `expiresAt` field; a Firestore TTL policy (firestore.indexes.json) cleans them up.
const crypto = require('crypto');
const { db, Timestamp } = require('../lib/firebase');

function rateLimit({ name, limit, windowSec }) {
  return async (req, res, next) => {
    if (process.env.RATE_LIMIT_DISABLED === '1') return next();
    const who = req.uid ? `u:${req.uid}` : `ip:${req.ip}`;
    const windowStart = Math.floor(Date.now() / 1000 / windowSec) * windowSec;
    const id = crypto.createHash('sha256').update(`${name}|${who}`).digest('hex').slice(0, 40);
    const ref = db.collection('rateLimits').doc(id);

    try {
      const count = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const data = snap.exists ? snap.data() : null;
        const next = data && data.windowStart === windowStart ? data.count + 1 : 1;
        tx.set(ref, {
          name,
          windowStart,
          count: next,
          expiresAt: Timestamp.fromMillis((windowStart + windowSec * 2) * 1000),
        });
        return next;
      });

      res.set('X-RateLimit-Limit', String(limit));
      res.set('X-RateLimit-Remaining', String(Math.max(0, limit - count)));
      if (count > limit) {
        const retryAfter = windowStart + windowSec - Math.floor(Date.now() / 1000);
        res.set('Retry-After', String(Math.max(1, retryAfter)));
        return res
          .status(429)
          .json({ error: 'Too many requests. Please wait a moment and try again.' });
      }
      next();
    } catch (err) {
      // Fail open: a Firestore hiccup shouldn't take the whole API down.
      console.error('rateLimit error', err);
      next();
    }
  };
}

// Limits are per user per window.
const limits = {
  general: rateLimit({ name: 'general', limit: 120, windowSec: 60 }),
  search: rateLimit({ name: 'search', limit: 30, windowSec: 60 }),
  upload: rateLimit({ name: 'upload', limit: 60, windowSec: 3600 }),
  publish: rateLimit({ name: 'publish', limit: 30, windowSec: 3600 }),
  categories: rateLimit({ name: 'categories', limit: 60, windowSec: 60 }),
  sensitive: rateLimit({ name: 'sensitive', limit: 10, windowSec: 3600 }),
};

module.exports = { rateLimit, limits };
