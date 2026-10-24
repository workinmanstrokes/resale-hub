// All deployment-specific values come from EXPO_PUBLIC_* environment variables,
// inlined at build time. Set them in mobile/.env for local dev (see .env.example)
// and as EAS environment variables for store builds (see docs/SETUP.md).

function trimSlash(url) {
  return (url || '').trim().replace(/\/+$/, '');
}

// The API on its free serverless host, e.g. https://resale-hub-api.vercel.app/api
export const API_BASE_URL = trimSlash(process.env.EXPO_PUBLIC_API_URL);

// Public Firebase web app config for project resale-hub-6a648 (web app "Resale Hub").
// These identifiers are not secrets: access is enforced by Firebase Auth and
// firestore.rules. EXPO_PUBLIC_* env vars override them (e.g. for another project).
export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyDegPUHseJPcMbeaxOfIQuTUDnosjsGkvY',
  authDomain: 'resale-hub-6a648.firebaseapp.com',
  projectId: 'resale-hub-6a648',
  storageBucket: 'resale-hub-6a648.firebasestorage.app', // unused: no Storage on the free plan
  messagingSenderId: '613695085581',
  appId: '1:613695085581:web:82a994dd5d2ca61af40944',
};

// Used for Firebase Auth sign-in (Identity Toolkit REST API).
export const FIREBASE_API_KEY =
  (process.env.EXPO_PUBLIC_FIREBASE_API_KEY || '').trim() || FIREBASE_CONFIG.apiKey;

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
