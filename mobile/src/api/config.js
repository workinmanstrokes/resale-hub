// All deployment-specific values come from EXPO_PUBLIC_* environment variables,
// inlined at build time. Set them in mobile/.env for local dev (see .env.example)
// and as EAS environment variables for store builds (see docs/SETUP.md).

function trimSlash(url) {
  return (url || '').trim().replace(/\/+$/, '');
}

// The API on its free serverless host, e.g. https://resale-hub-api.vercel.app/api
export const API_BASE_URL = trimSlash(process.env.EXPO_PUBLIC_API_URL);

// Firebase Web API key (Project settings > General). Used for Firebase Auth sign-in.
export const FIREBASE_API_KEY = (process.env.EXPO_PUBLIC_FIREBASE_API_KEY || '').trim();

// Optional: "127.0.0.1:9099" to use the Auth emulator during local development.
export const FIREBASE_AUTH_EMULATOR_HOST = (process.env.EXPO_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST || '').trim();

// Public site with the privacy policy / support pages (Firebase Hosting, free on Spark).
// It lives on a different host from the API now, so set it explicitly.
export const WEB_BASE_URL =
  trimSlash(process.env.EXPO_PUBLIC_WEB_URL) || 'https://resale-hub-6a648.web.app';

export const PRIVACY_URL = `${WEB_BASE_URL}/privacy`;
export const SUPPORT_URL = `${WEB_BASE_URL}/support`;
export const SUPPORT_EMAIL = 'mscofield1588@gmail.com';

export const IS_CONFIGURED = Boolean(API_BASE_URL && FIREBASE_API_KEY);
