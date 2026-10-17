// All configuration comes from environment variables on the API host (Vercel project
// env vars, Cloudflare Worker secrets, or backend/.env for `npm start`). None of these
// values are ever sent to the app. Read lazily so tests can set plain env vars.
const NAMES = [
  'EBAY_CLIENT_ID',
  'EBAY_CLIENT_SECRET',
  'EBAY_RUNAME',
  'EBAY_VERIFICATION_TOKEN',
  'ETSY_API_KEY',
  'ETSY_SHARED_SECRET',
  'FIREBASE_SERVICE_ACCOUNT',
];

// A secret set to "disabled" (or left empty) turns that integration off.
function env(name) {
  const value = (process.env[name] || '').trim();
  return value && value.toLowerCase() !== 'disabled' ? value : '';
}

module.exports = { NAMES, env };
