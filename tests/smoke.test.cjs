// Smoke test for the Resale Hub storefront API (backend/src/routes/storefront.js).
//
// Mounts the REAL router in Express (with the raw-body webhook mount from
// INTEGRATION.md) against an in-memory fake Firestore and a fake Stripe
// client. No network, no secrets, no real money.
//
// Run:  node tests/smoke.test.cjs        (needs `express` installed here:
//        cd tests && npm install express --no-save)
//
// Exit code 0 = all checks passed.

process.env.RATE_LIMIT_DISABLED = '1';
process.env.STORE_SELLER_UID = 'seller-1';
process.env.STORE_URL = 'https://shop.example.test';
// STRIPE_SECRET_KEY is left unset at first (to test the 503 path), then set
// to a fake value once the fake Stripe client is in play.

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
      id,
      exists: true,
      data: () => data,
      ref: docRef(colName, id),
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

// ---------- Fake Stripe ----------
let sessionCounter = 0;
function FakeStripe() {
  return {
    checkout: {
      sessions: {
        create: async () => {
          sessionCounter += 1;
          return {
            id: 'cs_test_' + sessionCounter,
            url: 'https://checkout.stripe.test/pay/cs_test_' + sessionCounter,
            payment_status: 'unpaid',
          };
        },
        retrieve: async (id) => ({
          id,
          payment_status: 'paid',
          payment_intent: 'pi_test_123',
          customer_details: { email: 'buyer@example.com', name: 'Buyer Name' },
          shipping_details: {
            name: 'Buyer Name',
            address: {
              line1: '1 Main St', city: 'Flint', state: 'MI', postal_code: '48503', country: 'US',
            },
          },
        }),
      },
    },
    webhooks: {
      constructEvent: (raw) => JSON.parse(raw.toString('utf8')),
    },
  };
}

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
  if (request === 'stripe') return FakeStripe;
  // `express` is installed under tests/; resolve it from this file so the
  // router (which lives in backend/) can find it too.
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

// ---------- App (mirrors INTEGRATION.md mounting) ----------
const express = require('express');
const router = require('../backend/src/routes/storefront');
const app = express();
app.use('/api/storefront/webhook', express.raw({ type: 'application/json' }));
app.use('/storefront/webhook', express.raw({ type: 'application/json' }));
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

// ---------- Seed data: only ONE listing should ever be visible ----------
function seed() {
  const base = {
    ownerId: 'seller-1', title: 'Charizard 1999 Base Set', price: 49.99,
    condition: 'used', category: 'Pokemon',
    photos: ['https://i.ebayimg.com/test1.jpg'], thumbnail: null,
    createdAt: '2026-11-06T00:00:00.000Z', updatedAt: '2026-11-06T00:00:00.000Z',
  };
  store.listings.set('L1', { ...base, storefront: true, stock: 2 });
  store.listings.set('L2', { ...base, title: 'Hidden — not flagged', storefront: false, stock: 5 });
  store.listings.set('L3', { ...base, title: 'Hidden — wrong owner', ownerId: 'seller-2', storefront: true, stock: 5 });
  store.listings.set('L4', { ...base, title: 'Hidden — out of stock', storefront: true, stock: 0 });
}

// ---------- Checks ----------
let passed = 0;
let failed = 0;
function check(name, cond, extra) {
  if (cond) { passed += 1; console.log('  PASS  ' + name); }
  else { failed += 1; console.log('  FAIL  ' + name + (extra ? ' — ' + extra : '')); }
}

async function main() {
  seed();
  const server = app.listen(0);
  await new Promise((r) => server.on('listening', r));
  const base = 'http://127.0.0.1:' + server.address().port + '/api';
  const j = async (path, opts) => {
    const res = await fetch(base + path, opts);
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
  };

  console.log('Catalog (no fake listings, only flagged + in-stock + own):');
  let r = await j('/storefront/listings');
  check('catalog returns exactly the 1 visible listing', r.status === 200 && Array.isArray(r.body) && r.body.length === 1, JSON.stringify(r.body));
  check('catalog price is the real Firestore price (49.99)', r.body[0] && r.body[0].price === 49.99);
  check('catalog hides ownerId/targets', r.body[0] && !('ownerId' in r.body[0]) && !('userId' in r.body[0]) && !('targets' in r.body[0]));
  r = await j('/storefront/listings/L1');
  check('detail returns the listing', r.status === 200 && r.body.title === 'Charizard 1999 Base Set');
  r = await j('/storefront/listings/L2');
  check('unflagged listing is 404', r.status === 404);
  r = await j('/storefront/listings/L3');
  check('other seller listing is 404', r.status === 404);
  r = await j('/storefront/listings/L4');
  check('out-of-stock listing is 404', r.status === 404);
  r = await j('/storefront/listings?q=charizard');
  check('search finds it', r.status === 200 && r.body.length === 1);
  r = await j('/storefront/listings?q=zzzz');
  check('search with no match is empty, not fake', r.status === 200 && r.body.length === 0);

  console.log('Checkout without Stripe configured:');
  r = await j('/storefront/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: [{ id: 'L1', qty: 1 }] }) });
  check('checkout answers 503, not a fake checkout', r.status === 503 && /not set up/i.test(r.body.error || ''), JSON.stringify(r.body));
  check('no order was created by the failed checkout', store.orders.size === 0);

  process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_fake';
  console.log('Checkout validation (fake Stripe on):');
  r = await j('/storefront/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: [{ id: 'NOPE', qty: 1 }] }) });
  check('unknown item is rejected', r.status === 400 && Array.isArray(r.body.unavailable) && r.body.unavailable.includes('NOPE'), JSON.stringify(r.body));
  r = await j('/storefront/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: [{ id: 'L1', qty: 3 }] }) });
  check('qty above stock is rejected', r.status === 400 && (r.body.unavailable || []).includes('L1'));
  r = await j('/storefront/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: [{ id: 'L1', qty: 1 }], email: 'buyer@example.com' }) });
  check('valid checkout returns a Stripe URL + order id', r.status === 200 && typeof r.body.url === 'string' && r.body.url.includes('checkout.stripe.test') && typeof r.body.orderId === 'string', JSON.stringify(r.body));
  const orderId1 = r.body.orderId;
  const order1 = store.orders.get(orderId1);
  check('order is pending with server-side total 4999 cents', order1 && order1.status === 'pending' && order1.totalCents === 4999 && order1.subtotalCents === 4999);
  check('order total comes from the server price, not the browser', order1 && order1.items[0].priceCents === 4999);

  console.log('Webhook (raw body + signature path):');
  const session1 = { id: 'cs_test_1', payment_intent: 'pi_test_123', metadata: { orderId: orderId1 }, customer_details: { email: 'buyer@example.com' }, shipping_details: { name: 'Buyer Name', address: { line1: '1 Main St', city: 'Flint', state: 'MI', postal_code: '48503', country: 'US' } } };
  r = await fetch(base + '/storefront/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': 't=1,v1=fake' }, body: JSON.stringify({ type: 'checkout.session.completed', data: { object: session1 } }) }).then(async (res) => ({ status: res.status, body: await res.json().catch(() => ({})) }));
  check('webhook accepted', r.status === 200 && r.body.received === true, JSON.stringify(r.body));
  check('order is paid after webhook', store.orders.get(orderId1).status === 'paid');
  check('stock decremented 2 -> 1', store.listings.get('L1').stock === 1);
  r = await fetch(base + '/storefront/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': 't=1,v1=fake' }, body: JSON.stringify({ type: 'checkout.session.completed', data: { object: session1 } }) }).then(async (res) => ({ status: res.status, body: await res.json().catch(() => ({})) }));
  check('duplicate webhook is idempotent (stock stays 1)', r.status === 200 && store.listings.get('L1').stock === 1);
  r = await fetch(base + '/storefront/webhook', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'not json' }).then(async (res) => ({ status: res.status, body: await res.json().catch(() => ({})) }));
  check('webhook without a raw JSON body fails loudly, not silently', r.status === 400 && /raw request body/i.test(r.body.error || ''), JSON.stringify(r.body));

  console.log('Buyer order lookup + success-page finalize fallback:');
  r = await j('/storefront/order/cs_test_1');
  check('buyer can look up the paid order by session id', r.status === 200 && r.body.status === 'paid' && r.body.totalCents === 4999);
  r = await j('/storefront/order/cs_nope');
  check('unknown session id is 404', r.status === 404);
  // Second order, no webhook this time — the lookup itself must finalize it.
  r = await j('/storefront/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: [{ id: 'L1', qty: 1 }] }) });
  const orderId2 = r.body.orderId;
  check('second checkout created while 1 in stock', r.status === 200 && store.orders.get(orderId2).status === 'pending');
  r = await j('/storefront/order/cs_test_2');
  check('order lookup finalizes a paid session without the webhook', r.status === 200 && r.body.status === 'paid', JSON.stringify(r.body));
  check('stock decremented 1 -> 0 by the fallback', store.listings.get('L1').stock === 0);
  r = await j('/storefront/listings');
  check('sold-out listing leaves the catalog', r.status === 200 && r.body.length === 0);

  console.log('Seller orders:');
  r = await j('/storefront/orders');
  check('orders without sign-in is 401', r.status === 401);
  r = await j('/storefront/orders', { headers: { Authorization: 'Bearer buyer-token' } });
  check('orders as a non-seller is 403', r.status === 403);
  r = await j('/storefront/orders', { headers: { Authorization: 'Bearer seller-token' } });
  check('seller sees both orders', r.status === 200 && Array.isArray(r.body) && r.body.length === 2, JSON.stringify(r.body));
  r = await j('/storefront/orders/' + orderId1 + '/fulfill', { method: 'POST', headers: { Authorization: 'Bearer buyer-token', 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
  check('fulfill as non-seller is 403', r.status === 403);
  r = await j('/storefront/orders/' + orderId1 + '/fulfill', { method: 'POST', headers: { Authorization: 'Bearer seller-token', 'Content-Type': 'application/json' }, body: JSON.stringify({ trackingNote: 'UPS 1Z999' }) });
  check('seller can mark a paid order fulfilled', r.status === 200 && r.body.status === 'fulfilled' && r.body.trackingNote === 'UPS 1Z999', JSON.stringify(r.body));
  r = await j('/storefront/orders/' + orderId1 + '/fulfill', { method: 'POST', headers: { Authorization: 'Bearer seller-token', 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
  check('fulfilling twice is rejected', r.status === 400);

  server.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(2); });
