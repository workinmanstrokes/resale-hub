// Public storefront configuration. Nothing in this file is secret.
// The Firebase apiKey below is a public client key (the same one the mobile
// app already ships with); it only identifies the Firebase project. The
// Stripe keys and the service account NEVER go in this file — they live in
// Vercel environment variables on the API side.
//
// Fill in FIREBASE_API_KEY from Firebase console > Project settings > General
// (or copy it from mobile/src/api/config.js). API_URL is the deployed API.
window.STORE_CONFIG = {
  storeName: 'Resale Hub',
  sellerName: 'Diddlerrr',
  tagline: 'Shop direct — secure checkout, shipped by the seller.',
  apiUrl: 'https://resale-hub-api.vercel.app/api',
  firebase: {
    apiKey: 'YOUR_FIREBASE_WEB_API_KEY',
    authDomain: 'resale-hub-6a648.firebaseapp.com',
    projectId: 'resale-hub-6a648',
    appId: '1:613695085581:web:82a994dd5d2ca61af40944',
  },
};
