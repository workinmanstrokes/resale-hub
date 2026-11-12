// Tests for POST /storefront/listings (seller listing creation, used by
// Card PreGrade's "List on Resale Hub"). Same harness shape as smoke.test.cjs:
// the REAL router in Express against an in-memory fake Firestore. No network,
// no secrets, no real money.
//
// Run:  node tests/storefront-listing.test.cjs
// Exit code 0 = all checks passed.

process.env.RATE_LIMIT_DISABLED = '1';
process.env.STORE_SELLER_UID = 'seller-1';
process.env.STORE_URL = 'https://shop.example.test';

// ---------- Fake Firestore ----------
const store = { listings: new Map(), orders: new Map() };
let autoId = 1;

function docRef(colName, id) {
  return {
    id,
    get: async () => {
      const data = store[colName].get(id);
      return { id, exists: data !== undefined, data: () => data, ref: docRef(colName, id) };
    },
    set: async (data) => { store[colName].set(id, { ...data }); },
    update: async (patch) => {
      const cur = store[colName].get(id);
      if (cur === undefined) throw new Error('document not found: ' + id);
      store[colName].set(id, { ...cur, ...patch });
    },
  };
}

function query(colName, filters, limitN) {
  const run = async () => {
    let docs = [...store[colName].entries()].map(([id, data]) => ({
      id, exists: true, data: () => data, ref: docRef(colName, id),
    }));
    for (const f of filters) {
      if (f.op === '==') docs = docs.filter((d) => d.data()[f.field] === f.value);
    }
    if (limitN != null) docs = docs.slice(0, limitN);
    return { docs, empty: docs.length === 0 };
  };
  return {
    where: (field, op, value) => query(colName, [...filters, { field, op, value }], limitN),
    limit: (n) => query(colName, filters, n),
    get: run,
  };
}

const fakeDb = {
  collection: (name) => ({
    doc: (id) => docRef(name, id || ('auto-' + (autoId++))),
    add: async (data) => { const id = 'auto-' + (autoId++); store[name].set(id, { ...data }); return docRef(name, id); },
    where: (field, op, value) => query(name, [{ field, op, value }], null),
    get: async () => query(name, [], null).get(),
  }),
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
  if (request === 'stripe') return () => ({});
  if (request === 'express') return origLoad.call(this, request, module, isMain);
  if (request.endsWith('/lib/firebase') || request === '../lib/firebase') return fakeFirebase;
  if (request.endsWith('/lib/errors') || request === '../lib/errors') return realErrors;
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

// ---------- App ----------
const express = require('express');
const router = require('../backend/src/routes/storefront');
const app = express();
app.use(express.json({ limit: '1mb' }));
const api = express.Router();
api.use('/storefront', router);
app.use('/api', api);
app.use('/', api);
app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => {
  if (err instanceof realErrors.HttpError) {
    return res.status(err.status).json({ error: err.message, ...(err.extra || {}) });
  }
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

// ---------- Checks ----------
let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed += 1; console.log('  PASS  ' + name); }
  else { failed += 1; console.log('  FAIL  ' + name + (extra ? ' — ' + extra : '')); }
}

async function main() {
  const server = app.listen(0);
  await new Promise((r) => server.on('listening', r));
  const base = 'http://127.0.0.1:' + server.address().port + '/api';
  const j = async (path, opts) => {
    const res = await fetch(base + path, opts);
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
  };
  const seller = { headers: { 'Content-Type': 'application/json', Authorization: 'Bearer seller-token' } };
  const buyer = { headers: { 'Content-Type': 'application/json', Authorization: 'Bearer buyer-token' } };

  console.log('POST /storefront/listings (seller create):');
  let r = await j('/storefront/listings', { ...seller, method: 'POST',
    body: JSON.stringify({ title: '2022 Panini Prizm Nico Collins #117 Red White Blue Prizm', price: 2.16, condition: 'used', thumbnail: 'data:image/jpeg;base64,AAA' }) });
  check('seller create returns 201 with the public listing', r.status === 201 && r.body.id && r.body.title === '2022 Panini Prizm Nico Collins #117 Red White Blue Prizm' && r.body.price === 2.16, JSON.stringify(r.body));
  check('created listing is storefront-visible with stock 1', r.body.storefront !== false && r.body.stock === 1);
  check('created listing hides userId', !('userId' in r.body) && !('ownerId' in r.body));
  const id = r.body.id;
  const stored = store.listings.get(id);
  check('stored doc has userId = seller uid', stored && stored.userId === 'seller-1');
  check('stored doc has storefront true and stock 1', stored && stored.storefront === true && stored.stock === 1);
  check('stored doc keeps the thumbnail', stored && stored.thumbnail === 'data:image/jpeg;base64,AAA');

  r = await j('/storefront/listings');
  check('created listing appears in the catalog', r.status === 200 && Array.isArray(r.body) && r.body.some(x => x.id === id));
  r = await j('/storefront/listings/' + id);
  check('created listing detail returns it', r.status === 200 && r.body.title === '2022 Panini Prizm Nico Collins #117 Red White Blue Prizm');

  r = await j('/storefront/listings', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'No auth', price: 1 }) });
  check('unauthenticated create is 401', r.status === 401, 'got ' + r.status);
  r = await j('/storefront/listings', { ...buyer, method: 'POST', body: JSON.stringify({ title: 'Not the seller', price: 1 }) });
  check('non-seller create is 403', r.status === 403, 'got ' + r.status);
  r = await j('/storefront/listings', { ...seller, method: 'POST', body: JSON.stringify({ price: 1 }) });
  check('missing title is 400', r.status === 400, 'got ' + r.status);
  r = await j('/storefront/listings', { ...seller, method: 'POST', body: JSON.stringify({ title: 'x'.repeat(81), price: 1 }) });
  check('title over 80 chars is 400', r.status === 400, 'got ' + r.status);
  r = await j('/storefront/listings', { ...seller, method: 'POST', body: JSON.stringify({ title: 'Bad price', price: -1 }) });
  check('negative price is 400', r.status === 400, 'got ' + r.status);
  r = await j('/storefront/listings', { ...seller, method: 'POST', body: JSON.stringify({ title: 'Bad condition', price: 1, condition: 'minty' }) });
  check('bad condition is 400', r.status === 400, 'got ' + r.status);
  r = await j('/storefront/listings', { ...seller, method: 'POST', body: JSON.stringify({ title: 'Big thumb', price: 1, thumbnail: 'data:image/jpeg;base64,' + 'A'.repeat(70000) }) });
  check('thumbnail over the cap is 400', r.status === 400, 'got ' + r.status);
  r = await j('/storefront/listings', { ...seller, method: 'POST',
    body: JSON.stringify({ title: 'Photo filtering', price: 1, photos: ['https://i.ebayimg.com/ok.jpg', 'not-a-url', 42] }) });
  check('non-URL photos are dropped, listing still created', r.status === 201 && r.body.photos.length === 1 && r.body.photos[0] === 'https://i.ebayimg.com/ok.jpg', JSON.stringify(r.body));
  r = await j('/storefront/listings', { ...seller, method: 'POST', body: JSON.stringify({ title: 'Free card', price: 0 }) });
  check('price $0 is allowed', r.status === 201, 'got ' + r.status);

  server.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main();
