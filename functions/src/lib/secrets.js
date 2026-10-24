// Secrets are set with `firebase functions:secrets:set NAME` (see docs/FIREBASE_SETUP.md)
// and exposed to the function as environment variables at runtime. Everything reads
// process.env lazily so the code also runs under the emulator / tests with plain env vars.
const { defineSecret } = require('firebase-functions/params');

const NAMES = [
  'EBAY_CLIENT_ID',
  'EBAY_CLIENT_SECRET',
  'EBAY_RUNAME',
  'EBAY_VERIFICATION_TOKEN',
  'ETSY_API_KEY',
  'ETSY_SHARED_SECRET',
];

const SECRETS = NAMES.map((name) => defineSecret(name));

// A secret set to "disabled" (or left empty) turns that integration off.
function env(name) {
  const value = (process.env[name] || '').trim();
  return value && value.toLowerCase() !== 'disabled' ? value : '';
}

module.exports = { SECRETS, NAMES, env };
