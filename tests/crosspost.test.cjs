// Tests for the Resale Hub post-everywhere hub
// (backend/src/routes/crosspost.js).
//
// Mounts the REAL router in Express against an in-memory fake Firestore.
// No network, no real marketplace calls, no secrets, no real listings
// posted anywhere.
//
// Run:  node tests/crosspost.test.cjs   (needs `express` installed here:
//        cd tests && npm install express --no-save)
//
// Exit code 0 = all checks passed.

process.env.RATE_LIMIT_DISABLED = '1';
process.env.STORE_SELLER_UID = 'seller-1';
process.env.STORE_URL = 'https://shop.example.test';

// ---------- Fake Firestore (path-keyed, dotted updates expanded) ----------
const store = { docs: new Map() };

function setDotted(obj, path, value) {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (cur[parts[i]] === undefined || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

function docRef(path) {
  return {
    id: path.split('/').pop(),
    path,
    get: async () => {
      const data = store.docs.get(path);
      return { id: path.split('/').pop(), exists: data !== undefined, data: () => data, ref: docRef(path) };
    },
    set: async (data) => { store.docs.set(path, { ...data }); },
    update: async (patch) => {
      const cur = store.docs.get(path);
      if (cur === undefined) throw new Error('document not found: ' + path);
      const next = { ...cur };
      for (const [k, v] of Object.entries(patch)) {
        if (k.includes('.')) setDotted(next, k, v);
        else next[k] = v;
      }
      store.docs.set(path, next);
    },
  };
}
function collectionRef(path) {
  return {
    doc: (id) => docRef(path + '/' + id),
    where: (field, op, value) => ({
      get: async () => {
        const docs = [...store.docs.entries()]
          .filter(([p, d]) => p.startsWith(path + '/') && d[field] === value)
          .map(([p, d]) => ({ id: p.split('/').pop(), exists: true, data: () => d, ref: docRef(p) }));
        return { docs, empty: docs.length === 0 };
      },
    }),
    get: async () => {
      const docs = [...store.docs.entries()]
        .filter(([p]) => p.startsWith(path + '/'))
        .map(([p, d]) => ({ id: p.split('/').pop(), exists: true, data: () => d, ref: docRef(p) }));
      return { docs, empty: docs.length === 0 };
    },
  };
}
const fakeDb = {
  collection: (name) => collectionRef(name),
  runTransaction: async (fn) => fn({
    get: (ref) => ref.get(),
    update: (ref, data) => ref.update(data),
    set: (ref, data) => ref.set(data),
  }),
};
const fakeFirebase = {
  db: fakeDb,
  FieldValue: { serverTimestamp: () => new Date().toISOString() },
  Timestamp: null,
  admin: null,
  auth: null,
};

// ---------- Module interception (before requiring the router) ----------
const Module = require('module');
const origLoad = Module._load;
const realErrors = {
  HttpError: class HttpError extends Error {
    constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
  },
  wrap: (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next),
};
Module._load = function (request, parent, isMain) {
  if (request === 'express') return origLoad.call(this, request, module, isMain);
  if (request.endsWith('/lib/firebase') || request === '../lib/firebase') return fakeFirebase;
  if (request.endsWith('/lib/errors') || request === '../lib/errors' || request === './errors') return realErrors;
  if (request.endsWith('/lib/stripe') || request === '../lib/stripe') {
    return {
      getStoreConfig: () => ({
        sellerUid: process.env.STORE_SELLER_UID || '',
        storeUrl: 'https://shop.example.test',
        shippingFlatCents: 0,
        shipCountries: ['US'],
      }),
    };
  }
  if (request.endsWith('/middleware/auth') || request === '../middleware/auth') {
    return {
      requireAuth: async (req, res, next) => {
        const h = req.headers.authorization || '';
        const token = h.startsWith('Bearer ') ? h.slice(7) : null;
        if (token === 'seller-token') { req.uid = 'seller-1'; return next(); }
        if (token === 'buyer-token') { req.uid = 'buyer-1'; return next(); }
        return res.status(401).json({ error: 'Sign in required' });
      },
    };
  }
  if (request.endsWith('/middleware/rateLimit') || request === '../middleware/rateLimit') {
    return { limits: { general: (req, res, next) => next() } };
  }
  return origLoad.apply(this, arguments);
};

// ---------- App (mirrors the mount CROSSPOST_INTEGRATION.md asks for) ----------
const express = require('express');
const router = require('../backend/src/routes/crosspost');
const app = express();
app.use(express.json({ limit: '1mb' }));
const api = express.Router();
api.use('/crosspost', router);
app.use('/api', api);
app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => {
  if (err instanceof realErrors.HttpError) {
    return res.status(err.status).json({ error: err.message, ...(err.extra || {}) });
  }
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

// ---------- Seed data ----------
function seed() {
  const longTitle = 'Charizard 1999 Base Set Holographic Pokemon Trading Card Near Mint Sleeved Kept In Binder Since New Rare Vintage';
  store.docs.set('listings/L1', {
    userId: 'seller-1',
    title: 'Charizard 1999 Base Set',
    description: 'Near mint 1999 base set Charizard, kept sleeved.',
    price: 49.99,
    condition: 'used',
    category: 'Pokemon',
    tags: ['pokemon', 'charizard', 'trading card', 'vintage'],
    photos: ['https://img.example.test/photo1.jpg'],
    stock: 2,
    storefront: true,
    createdAt: '2026-11-06T00:00:00.000Z',
    updatedAt: '2026-11-06T00:00:00.000Z',
  });
  store.docs.set('listings/L2', {
    userId: 'seller-1',
    title: longTitle,
    description: 'A very long-titled card.',
    price: 10,
    condition: 'used',
    category: 'Pokemon',
    tags: [],
    photos: [],
    stock: 1,
    createdAt: '2026-11-06T00:00:00.000Z',
    updatedAt: '2026-11-06T00:00:00.000Z',
  });
  store.docs.set('listings/L3', {
    userId: 'seller-2',
    title: 'Not mine',
    description: 'Belongs to another seller.',
    price: 5,
    condition: 'used',
    category: '',
    tags: [],
    photos: [],
    stock: 1,
    createdAt: '2026-11-06T00:00:00.000Z',
    updatedAt: '2026-11-06T00:00:00.000Z',
  });
  store.docs.set('listings/L4', {
    userId: 'seller-1',
    title: '',
    description: 'Has a description but no title.',
    price: 5,
    condition: 'used',
    category: '',
    tags: [],
    photos: [],
    stock: 1,
    createdAt: '2026-11-06T00:00:00.000Z',
    updatedAt: '2026-11-06T00:00:00.000Z',
  });
}

// ---------- Checks ----------
let passed = 0;
let failed = 0;
function check(name, cond, extra) {
  if (cond) { passed += 1; console.log('  PASS  ' + name); }
  else { failed += 1; console.log('  FAIL  ' + name + (extra ? ' — ' + extra : '')); }
}

const http = require('http');
let serverPort = 0;
function callApi(path, opts = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: serverPort, path: '/api' + path, method: opts.method || 'GET', headers: opts.headers || {} },
      (res) => {
        let raw = '';
        res.on('data', (c) => { raw += c; });
        res.on('end', () => {
          let body = {};
          try { body = JSON.parse(raw); } catch (err) { /* leave {} */ }
          resolve({ status: res.statusCode, body });
        });
      },
    );
    req.on('error', reject);
    if (opts.body) req.write(typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body));
    req.end();
  });
}
const sellerHeaders = { Authorization: 'Bearer seller-token', 'Content-Type': 'application/json' };
const buyerHeaders = { Authorization: 'Bearer buyer-token', 'Content-Type': 'application/json' };

async function main() {
  seed();
  const server = app.listen(0);
  await new Promise((r) => server.on('listening', r));
  serverPort = server.address().port;

  console.log('Site catalogue:');
  let r = await callApi('/crosspost/sites', { headers: sellerHeaders });
  check('sites returns 6 sites', r.status === 200 && Array.isArray(r.body) && r.body.length === 6, JSON.stringify(r.body));
  const ids = (r.body || []).map((s) => s.id).sort();
  check('sites are facebook, whatnot, poshmark, mercari, offerup, ebay',
    JSON.stringify(ids) === JSON.stringify(['ebay', 'facebook', 'mercari', 'offerup', 'poshmark', 'whatnot']),
    JSON.stringify(ids));
  check('no Etsy in the site list', !(r.body || []).some((s) => /etsy/i.test(s.id + s.name)));
  check('every site is free to list', (r.body || []).every((s) => s.freeToList === true));
  check('only eBay is api, the other five are prefill',
    (r.body || []).filter((s) => s.method === 'api').map((s) => s.id).join() === 'ebay'
    && (r.body || []).filter((s) => s.method === 'prefill').length === 5);
  check('facebook deep link is the Marketplace create page',
    (r.body || []).find((s) => s.id === 'facebook').deepLink === 'https://www.facebook.com/marketplace/create/item');
  check('whatnot note says Quality Listings, not Temporary ones',
    /Quality Listing/.test((r.body || []).find((s) => s.id === 'whatnot').note)
    && /Temporary/.test((r.body || []).find((s) => s.id === 'whatnot').note));
  check('ebay note says the mobile app, not this API',
    /mobile app/.test((r.body || []).find((s) => s.id === 'ebay').note));
  r = await callApi('/crosspost/sites');
  check('sites without sign-in is public (200, 6 sites)', r.status === 200 && Array.isArray(r.body) && r.body.length === 6, JSON.stringify(r.body));
  r = await callApi('/crosspost/sites', { headers: buyerHeaders });
  check('sites for a non-seller is also public (200)', r.status === 200);

  console.log('Seller listings:');
  r = await callApi('/crosspost/listings', { headers: sellerHeaders });
  check('listings returns only the seller\'s own listings', r.status === 200 && r.body.length === 3
    && r.body.every((l) => l.id !== 'L3'), JSON.stringify(r.body && r.body.map((l) => l.id)));
  r = await callApi('/crosspost/listings');
  check('listings without sign-in is 401', r.status === 401);

  console.log('Prepare:');
  r = await callApi('/crosspost/L1/prepare', { method: 'POST', headers: sellerHeaders, body: { sites: ['facebook', 'whatnot', 'poshmark'] } });
  check('prepare returns the listing with 3 prepared sites', r.status === 200 && r.body.listingId === 'L1' && r.body.sites.length === 3, JSON.stringify(r.body));
  check('no prepared site claims posted', (r.body.sites || []).every((s) => s.status === 'ready_to_publish' && s.status !== 'posted'));
  check('every prepared site has copy text with title + price',
    (r.body.sites || []).every((s) => s.copyText.includes('Charizard 1999 Base Set') && s.copyText.includes('$49.99')));
  check('every prepared site has a deep link', (r.body.sites || []).every((s) => /^https:\/\//.test(s.deepLink)));
  check('every prepared site carries its photos', (r.body.sites || []).every((s) => s.photos.length === 1));
  check('hashtags come from the listing tags, max 5',
    (r.body.sites || []).every((s) => s.tags.length <= 5 && s.tags.every((t) => t.startsWith('#'))));
  r = await callApi('/crosspost/L1/prepare', { method: 'POST', headers: sellerHeaders, body: { sites: ['facebook', 'facebook', 'ebay'] } });
  check('duplicate sites are deduped', r.status === 200 && r.body.sites.length === 2, JSON.stringify(r.body));
  r = await callApi('/crosspost/L1/prepare', { method: 'POST', headers: sellerHeaders, body: { sites: ['etsy'] } });
  check('etsy is rejected as an unknown site', r.status === 400 && /Unknown site/.test(r.body.error || ''), JSON.stringify(r.body));
  r = await callApi('/crosspost/L1/prepare', { method: 'POST', headers: sellerHeaders, body: { sites: [] } });
  check('empty site list is 400', r.status === 400);
  r = await callApi('/crosspost/L1/prepare', { method: 'POST', headers: sellerHeaders, body: {} });
  check('missing site list is 400', r.status === 400);
  r = await callApi('/crosspost/L2/prepare', { method: 'POST', headers: sellerHeaders, body: { sites: ['ebay', 'poshmark'] } });
  const ebayReady = r.body.sites && r.body.sites.find((s) => s.site === 'ebay');
  const poshReady = r.body.sites && r.body.sites.find((s) => s.site === 'poshmark');
  check('long title is truncated for eBay (80 chars)', r.status === 200 && ebayReady && ebayReady.title.length <= 80 && ebayReady.titleTruncated === true, JSON.stringify(ebayReady));
  check('truncated title carries a note', Boolean(ebayReady && ebayReady.titleNote));
  check('same long title is also truncated for Poshmark (80 chars)', Boolean(poshReady && poshReady.titleTruncated === true));
  r = await callApi('/crosspost/L2/prepare', { method: 'POST', headers: sellerHeaders, body: { sites: ['facebook'] } });
  check('long title fits Facebook uncapped at 140', r.status === 200 && r.body.sites[0].title.length <= 140 && r.body.sites[0].titleTruncated === false, JSON.stringify(r.body.sites && r.body.sites[0]));
  r = await callApi('/crosspost/L4/prepare', { method: 'POST', headers: sellerHeaders, body: { sites: ['facebook'] } });
  check('listing without a title is 400, not prepared', r.status === 400 && /title/.test(r.body.error || ''), JSON.stringify(r.body));
  r = await callApi('/crosspost/L3/prepare', { method: 'POST', headers: sellerHeaders, body: { sites: ['facebook'] } });
  check("another seller's listing is 404 (ownership is not disclosed, same as storefront)", r.status === 404);
  r = await callApi('/crosspost/L1/prepare', { method: 'POST', headers: buyerHeaders, body: { sites: ['facebook'] } });
  check('non-seller cannot prepare (403)', r.status === 403);
  r = await callApi('/crosspost/L1/prepare', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: { sites: ['facebook'] } });
  check('prepare without sign-in is 401', r.status === 401);
  r = await callApi('/crosspost/NOPE/prepare', { method: 'POST', headers: sellerHeaders, body: { sites: ['facebook'] } });
  check('missing listing is 404', r.status === 404);

  console.log('Mark posted:');
  r = await callApi('/crosspost/L1/mark-posted', { method: 'POST', headers: sellerHeaders, body: { site: 'facebook', url: 'https://www.facebook.com/marketplace/item/123' } });
  check('mark-posted records posted_by_seller', r.status === 200 && r.body.crosspost.status === 'posted_by_seller' && r.body.already === false, JSON.stringify(r.body));
  const afterMark = store.docs.get('listings/L1');
  check('listing doc stores the crosspost record', Boolean(afterMark.crossposts && afterMark.crossposts.facebook && afterMark.crossposts.facebook.status === 'posted_by_seller'), JSON.stringify(afterMark.crossposts));
  r = await callApi('/crosspost/L1/mark-posted', { method: 'POST', headers: sellerHeaders, body: { site: 'facebook' } });
  check('marking the same site again is idempotent (already:true)', r.status === 200 && r.body.already === true, JSON.stringify(r.body));
  r = await callApi('/crosspost/L1/mark-posted', { method: 'POST', headers: sellerHeaders, body: { site: 'whatnot' } });
  check('mark-posted works without a URL', r.status === 200 && r.body.crosspost.status === 'posted_by_seller' && r.body.crosspost.url === null, JSON.stringify(r.body));
  r = await callApi('/crosspost/L1/mark-posted', { method: 'POST', headers: sellerHeaders, body: { site: 'etsy' } });
  check('mark-posted rejects Etsy', r.status === 400, JSON.stringify(r.body));
  r = await callApi('/crosspost/L1/mark-posted', { method: 'POST', headers: sellerHeaders, body: { site: 'mercari', url: 'not-a-url' } });
  check('mark-posted rejects a non-URL', r.status === 400, JSON.stringify(r.body));
  r = await callApi('/crosspost/L3/mark-posted', { method: 'POST', headers: sellerHeaders, body: { site: 'facebook' } });
  check("mark-posted on another seller's listing is 404 (ownership is not disclosed)", r.status === 404);
  r = await callApi('/crosspost/L1/mark-posted', { method: 'POST', headers: buyerHeaders, body: { site: 'facebook' } });
  check('non-seller cannot mark posted (403)', r.status === 403);
  r = await callApi('/crosspost/L1/mark-posted', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: { site: 'facebook' } });
  check('mark-posted without sign-in is 401', r.status === 401);

  server.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
