// Pure unit tests (no emulators): node --test test/unit.test.js
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.EBAY_CLIENT_ID = 'test-client';
process.env.EBAY_CLIENT_SECRET = 'test-secret';
process.env.EBAY_RUNAME = 'Test-RuName';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-resale-hub';

const { resolveUploadExtension, uploadFilename } = require('../src/lib/uploadFilename');
const { parseServiceAccount } = require('../src/lib/firebase');
const etsy = require('../src/adapters/etsy');
const ebay = require('../src/adapters/ebay');

test('upload filename: mimetype wins, then original extension, then .jpg', () => {
  assert.equal(resolveUploadExtension('image/png', 'x.jpg'), '.png');
  assert.equal(resolveUploadExtension('application/octet-stream', 'IMG_1.HEIC'), '.heic');
  assert.equal(resolveUploadExtension(undefined, ''), '.jpg');
  assert.match(uploadFilename('image/webp', 'a'), /^resale-hub-\d+\.webp$/);
});

test('service account parsing accepts raw JSON or base64 and fixes escaped newlines', () => {
  const sa = { project_id: 'p', client_email: 'e', private_key: '-----BEGIN-----\\nabc\\n-----END-----' };
  const raw = JSON.stringify(sa);
  assert.equal(parseServiceAccount(raw).private_key, '-----BEGIN-----\nabc\n-----END-----');
  assert.equal(parseServiceAccount(Buffer.from(raw).toString('base64')).project_id, 'p');
  assert.equal(parseServiceAccount(''), null);
});

test('eBay host selection: production, sandbox, and test override', () => {
  delete process.env.EBAY_BASE_URL_OVERRIDE;
  process.env.EBAY_ENV = 'production';
  assert.equal(ebay.cfg().apim, 'https://apim.ebay.com');
  assert.equal(ebay.cfg().auth, 'https://auth.ebay.com');
  process.env.EBAY_ENV = 'sandbox';
  assert.equal(ebay.cfg().apim, 'https://apim.sandbox.ebay.com');
  assert.equal(ebay.cfg().web, 'https://www.sandbox.ebay.com');
  process.env.EBAY_BASE_URL_OVERRIDE = 'http://127.0.0.1:1/';
  assert.equal(ebay.cfg().api, 'http://127.0.0.1:1');
  delete process.env.EBAY_BASE_URL_OVERRIDE;
});

test('eBay/Etsy helpers', () => {
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
  assert.match(url.searchParams.get('scope'), /sell\.inventory/);
  assert.equal(new ebay.EbayError('x', 400).name, 'EbayError');
});
