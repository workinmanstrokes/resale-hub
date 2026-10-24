// End-to-end API test against the Firebase emulators (Auth, Firestore, Storage).
// Run: npm test   (wraps `firebase emulators:exec`; needs Java for the emulators)
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const PROJECT = process.env.GCLOUD_PROJECT || 'demo-resale-hub';
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: PROJECT, storageBucket: `${PROJECT}.appspot.com` });
process.env.EBAY_CLIENT_ID = 'test-client';
process.env.EBAY_CLIENT_SECRET = 'test-secret';
process.env.EBAY_RUNAME = 'Test-RuName';
process.env.EBAY_ENV = 'sandbox';
process.env.EBAY_VERIFICATION_TOKEN = 'v'.repeat(40);
process.env.EBAY_DELETION_ENDPOINT = 'https://example.web.app/api/ebay/account-deletion';

const { createApp } = require('../src/app');
const { rateLimit } = require('../src/middleware/rateLimit');
const etsy = require('../src/adapters/etsy');
const ebay = require('../src/adapters/ebay');
const express = require('express');

const AUTH = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`;
const FS = `http://${process.env.FIRESTORE_EMULATOR_HOST}`;
let base;
let server;

// 1x1 PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

async function signUp(email) {
  const res = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'hunter2hunter2', returnSecureToken: true }),
  });
  const data = await res.json();
  assert.ok(data.idToken, JSON.stringify(data));
  return data;
}

function call(path, { token, method = 'GET', body, headers = {} } = {}) {
  return fetch(`${base}${path}`, {
    method,
    redirect: 'manual',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
}

test.before(async () => {
  server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}/api`;
});
test.after(() => server.close());

test('unit: eBay/Etsy helpers', () => {
  assert.equal(
    etsy.usShipping({
      shipping_profile_destinations: [
        { destination_country_iso: 'US', primary_cost: { amount: 599, divisor: 100 } },
        { destination_country_iso: 'CA', primary_cost: { amount: 100, divisor: 100 } },
      ],
    }),
    5.99
  );
  assert.equal(etsy.usShipping({ shipping_profile_destinations: [] }), null);
  const opts = {
    fulfillmentPolicies: [{ id: 'f1' }, { id: 'f2' }],
    paymentPolicies: [{ id: 'p1' }],
    returnPolicies: [],
    locations: [{ id: 'loc' }],
  };
  const s = ebay.chooseDefaults(opts, { fulfillmentPolicyId: 'f2' });
  assert.deepEqual(s, { fulfillmentPolicyId: 'f2', paymentPolicyId: 'p1', returnPolicyId: null, merchantLocationKey: 'loc' });
  assert.deepEqual(ebay.missingSettings(s), ['return policy']);
  const url = new URL(ebay.getAuthorizationUrl('st'));
  assert.equal(url.searchParams.get('redirect_uri'), 'Test-RuName');
  assert.match(url.searchParams.get('scope'), /sell\.account\.readonly/);
});

test('rate limiter returns 429 after the limit', async () => {
  const app = express();
  app.get('/x', (req, res, next) => ((req.uid = 'rl-user'), next()), rateLimit({ name: 't', limit: 2, windowSec: 60 }), (req, res) => res.json({ ok: 1 }));
  const s = http.createServer(app);
  await new Promise((r) => s.listen(0, r));
  const u = `http://127.0.0.1:${s.address().port}/x`;
  const codes = [];
  for (let i = 0; i < 3; i++) codes.push((await fetch(u)).status);
  s.close();
  assert.deepEqual(codes, [200, 200, 429]);
});

test('full flow: account, uploads, listings, publish, rules, eBay OAuth state, deletion', async () => {
  assert.equal((await call('/health')).status, 200);
  assert.equal((await call('/listings')).status, 401);

  const a = await signUp('alice@example.com');
  const b = await signUp('bob@example.com');

  const me = await (await call('/account/me', { token: a.idToken })).json();
  assert.equal(me.user.email, 'alice@example.com');
  assert.equal(me.user.ebayConnected, false);

  // Photo upload -> Storage download URL
  const form = new FormData();
  form.append('photo', new Blob([PNG], { type: 'image/png' }), 'p.png');
  const up = await call('/uploads', { token: a.idToken, method: 'POST', body: form });
  assert.equal(up.status, 201, await up.clone().text());
  const { url: photoUrl } = await up.json();
  assert.match(photoUrl, /\/v0\/b\/.+\/o\/users%2F.+%2Fphotos%2F.+\.png\?alt=media&token=/);
  assert.equal((await fetch(photoUrl)).status, 200);

  const bad = new FormData();
  bad.append('photo', new Blob(['hi'], { type: 'text/plain' }), 'x.txt');
  assert.equal((await call('/uploads', { token: a.idToken, method: 'POST', body: bad })).status, 400);

  // Listings CRUD
  assert.equal((await call('/listings', { token: a.idToken, method: 'POST', body: { price: 5 } })).status, 400);
  const created = await call('/listings', {
    token: a.idToken,
    method: 'POST',
    body: { title: 'Nintendo Switch OLED', price: '199.5', condition: 'used', category: 'consoles', photos: [photoUrl] },
  });
  assert.equal(created.status, 201);
  const listing = await created.json();
  assert.equal(listing.price, 199.5);
  assert.deepEqual(listing.targets, []);

  assert.equal((await call(`/listings/${listing.id}`, { token: b.idToken })).status, 404, 'other users cannot read');
  assert.equal((await (await call('/listings', { token: b.idToken })).json()).length, 0);

  const edited = await (
    await call(`/listings/${listing.id}`, {
      token: a.idToken,
      method: 'PATCH',
      body: { title: 'Switch OLED (white)', photos: [], ebayCategoryId: '139971', ebayCategoryName: 'Video Game Consoles' },
    })
  ).json();
  assert.equal(edited.title, 'Switch OLED (white)');
  assert.equal(edited.ebayCategoryId, '139971');
  assert.ok([403, 404].includes((await fetch(photoUrl)).status), 'removed photo is deleted from Storage');

  // Publish: unsupported marketplaces are refused; eBay needs a connected account.
  const pub = await (
    await call(`/listings/${listing.id}/publish`, { token: a.idToken, method: 'POST', body: { marketplaces: ['poshmark', 'ebay'] } })
  ).json();
  const byKey = Object.fromEntries(pub.results.map((r) => [r.marketplace, r]));
  assert.equal(byKey.poshmark.status, 'unsupported');
  assert.equal(byKey.ebay.status, 'not_connected');
  assert.equal(pub.listing.targets.length, 1);

  // Firestore rules: own user doc readable, eBay token doc and others' data not.
  const doc = (p, t) => fetch(`${FS}/v1/projects/${PROJECT}/databases/(default)/documents/${p}`, { headers: { Authorization: `Bearer ${t}` } });
  assert.equal((await doc(`users/${a.localId}`, a.idToken)).status, 200);
  assert.equal((await doc(`users/${a.localId}`, b.idToken)).status, 403);
  assert.equal((await doc(`users/${a.localId}/private/ebay`, a.idToken)).status, 403);
  assert.equal((await doc(`listings/${listing.id}`, a.idToken)).status, 200);
  assert.equal((await doc(`listings/${listing.id}`, b.idToken)).status, 403);

  // eBay OAuth: start issues a URL with state; callback honours the one-time state.
  assert.equal((await call('/ebay/oauth/start', { token: a.idToken, method: 'POST', body: { returnUrl: 'https://evil.example' } })).status, 400);
  const start = await (
    await call('/ebay/oauth/start', { token: a.idToken, method: 'POST', body: { returnUrl: 'resalehub://ebay-connected' } })
  ).json();
  const state = new URL(start.url).searchParams.get('state');
  assert.ok(state);
  const declined = await call(`/ebay/oauth/callback?state=${state}&error=access_denied`);
  assert.equal(declined.status, 302);
  assert.match(declined.headers.get('location'), /^resalehub:\/\/ebay-connected\?status=error/);
  assert.equal((await call(`/ebay/oauth/callback?state=${state}&code=x`)).status, 400, 'state is single-use');

  // eBay Marketplace Account Deletion: challenge + notification
  const ch = await (await call('/ebay/account-deletion?challenge_code=abc')).json();
  const expected = require('crypto').createHash('sha256').update('abc' + 'v'.repeat(40) + process.env.EBAY_DELETION_ENDPOINT).digest('hex');
  assert.equal(ch.challengeResponse, expected);
  const { getFirestore } = require('firebase-admin/firestore');
  await getFirestore().doc(`users/${b.localId}`).set({ ebay: { connected: true, userId: 'ebay-user-1', settings: { paymentPolicyId: 'p' } } }, { merge: true });
  await getFirestore().doc(`users/${b.localId}/private/ebay`).set({ refreshToken: 'r' });
  const note = await call('/ebay/account-deletion', {
    method: 'POST',
    body: { metadata: { topic: 'MARKETPLACE_ACCOUNT_DELETION' }, notification: { data: { userId: 'ebay-user-1', username: 'x' } } },
  });
  assert.equal(note.status, 204);
  const bDoc = (await getFirestore().doc(`users/${b.localId}`).get()).data();
  assert.equal(bDoc.ebay.connected, false);
  assert.equal(bDoc.ebay.userId, undefined);
  assert.equal((await getFirestore().doc(`users/${b.localId}/private/ebay`).get()).exists, false);

  // Visible delete for a second listing
  const second = await (await call('/listings', { token: a.idToken, method: 'POST', body: { title: 'Lamp', price: 10 } })).json();
  assert.equal((await call(`/listings/${second.id}`, { token: a.idToken, method: 'DELETE' })).status, 200);

  // Account deletion removes data, photos and the auth record.
  const form2 = new FormData();
  form2.append('photo', new Blob([PNG], { type: 'image/png' }), 'p.png');
  const { url: photo2 } = await (await call('/uploads', { token: a.idToken, method: 'POST', body: form2 })).json();
  const del = await call('/account', { token: a.idToken, method: 'DELETE' });
  assert.equal(del.status, 200);
  assert.ok([403, 404].includes((await fetch(photo2)).status), 'photos deleted with the account');
  const signIn = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'alice@example.com', password: 'hunter2hunter2', returnSecureToken: true }),
  });
  assert.equal(signIn.status, 400);
  const left = await getFirestore().collection('listings').where('userId', '==', a.localId).get();
  assert.equal(left.size, 0);
  assert.equal((await getFirestore().doc(`users/${a.localId}`).get()).exists, false);
});
