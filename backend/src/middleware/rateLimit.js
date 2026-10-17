// Per-user (or per-IP for anonymous calls) fixed-window rate limiting.
//
// Two stores, chosen per limit to stay inside the Firestore Spark free quota
// (20K writes/day):
//  - 'firestore': one counter doc per (limit, caller), overwritten every window, so docs
//    never pile up (no TTL policy needed; TTL deletes require billing). Holds across all
//    serverless instances. Used for the expensive/abusable routes.
//  - 'memory': per-instance best effort, zero Firestore cost. Used for cheap reads.
const crypto = require('crypto');
const { db } = require('../lib/firebase');

const memory = new Map();

function tooMany(res, limit, count, windowStart, windowSec) {
  res.set('X-RateLimit-Limit', String(limit));
  res.set('X-RateLimit-Remaining', String(Math.max(0, limit - count)));
  if (count <= limit) return false;
  const retryAfter = windowStart + windowSec - Math.floor(Date.now() / 1000);
  res.set('Retry-After', String(Math.max(1, retryAfter)));
  res.status(429).json({ error: 'Too many requests. Please wait a moment and try again.' });
  return true;
}

function rateLimit({ name, limit, windowSec, store = 'firestore' }) {
  return async (req, res, next) => {
    if (process.env.RATE_LIMIT_DISABLED === '1') return next();
    const who = req.uid ? `u:${req.uid}` : `ip:${req.ip}`;
    const windowStart = Math.floor(Date.now() / 1000 / windowSec) * windowSec;
    const id = crypto.createHash('sha256').update(`${name}|${who}`).digest('hex').slice(0, 40);

    if (store === 'memory') {
      const cur = memory.get(id);
      const count = cur && cur.windowStart === windowStart ? cur.count + 1 : 1;
      memory.set(id, { windowStart, count });
      if (memory.size > 10_000) memory.clear(); // crude bound for long-lived instances
      if (!tooMany(res, limit, count, windowStart, windowSec)) next();
      return;
    }

    const ref = db.collection('rateLimits').doc(id);
    try {
      const count = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const data = snap.exists ? snap.data() : null;
        const n = data && data.windowStart === windowStart ? data.count + 1 : 1;
        // `who` is kept only for signed-in users (so account deletion can remove it);
        // anonymous counters are keyed by a hash and never store the IP.
        tx.set(ref, { name, windowStart, count: n, ...(req.uid ? { who } : {}) });
        return n;
      });
      if (!tooMany(res, limit, count, windowStart, windowSec)) next();
    } catch (err) {
      // Fail open: a Firestore hiccup (or a used-up daily quota) shouldn't take the API down.
      console.error('rateLimit error', err.message);
      next();
    }
  };
}

const limits = {
  general: rateLimit({ name: 'general', limit: 120, windowSec: 60, store: 'memory' }),
  categories: rateLimit({ name: 'categories', limit: 60, windowSec: 60, store: 'memory' }),
  search: rateLimit({ name: 'search', limit: 30, windowSec: 60 }),
  upload: rateLimit({ name: 'upload', limit: 60, windowSec: 3600 }),
  publish: rateLimit({ name: 'publish', limit: 30, windowSec: 3600 }),
  sensitive: rateLimit({ name: 'sensitive', limit: 10, windowSec: 3600 }),
};

module.exports = { rateLimit, limits };
