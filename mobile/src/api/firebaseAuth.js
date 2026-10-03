// Firebase Authentication (email/password) over its REST API. Using REST instead of
// the native/JS SDK keeps the app working in Expo Go and avoids extra native modules.
// The long-lived refresh token is kept in the device keychain (expo-secure-store);
// short-lived ID tokens are cached in memory and refreshed automatically.
// Docs: https://firebase.google.com/docs/reference/rest/auth
import * as SecureStore from 'expo-secure-store';
import { FIREBASE_API_KEY, FIREBASE_AUTH_EMULATOR_HOST } from './config';

const SESSION_KEY = 'resale_hub_session';

const prefix = FIREBASE_AUTH_EMULATOR_HOST ? `http://${FIREBASE_AUTH_EMULATOR_HOST}/` : 'https://';
const IDENTITY = `${prefix}identitytoolkit.googleapis.com/v1`;
const SECURE_TOKEN = `${prefix}securetoken.googleapis.com/v1`;

const MESSAGES = {
  EMAIL_EXISTS: 'An account with that email already exists.',
  EMAIL_NOT_FOUND: 'Incorrect email or password.',
  INVALID_PASSWORD: 'Incorrect email or password.',
  INVALID_LOGIN_CREDENTIALS: 'Incorrect email or password.',
  INVALID_EMAIL: 'Enter a valid email address.',
  MISSING_PASSWORD: 'Enter your password.',
  USER_DISABLED: 'This account has been disabled.',
  TOO_MANY_ATTEMPTS_TRY_LATER: 'Too many attempts. Please try again later.',
  OPERATION_NOT_ALLOWED: 'Email sign-in is not enabled for this app yet.',
  TOKEN_EXPIRED: 'Your session expired. Please sign in again.',
  USER_NOT_FOUND: 'Your session expired. Please sign in again.',
  INVALID_REFRESH_TOKEN: 'Your session expired. Please sign in again.',
};

function friendly(code = '') {
  const key = code.split(' : ')[0].split(':')[0].trim();
  if (key.startsWith('WEAK_PASSWORD')) return 'Password must be at least 8 characters.';
  return MESSAGES[key] || 'Something went wrong. Please try again.';
}

async function post(url, body, form = false) {
  if (!FIREBASE_API_KEY) throw new Error('This build is missing EXPO_PUBLIC_FIREBASE_API_KEY.');
  let res;
  try {
    res = await fetch(`${url}?key=${encodeURIComponent(FIREBASE_API_KEY)}`, {
      method: 'POST',
      headers: { 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json' },
      body: form ? new URLSearchParams(body).toString() : JSON.stringify(body),
    });
  } catch {
    throw new Error('No connection. Check your internet and try again.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(friendly(data?.error?.message));
    err.code = data?.error?.message;
    throw err;
  }
  return data;
}

let session = null; // { uid, email, idToken, refreshToken, expiresAt }

async function persist(next) {
  session = next;
  if (next) {
    await SecureStore.setItemAsync(
      SESSION_KEY,
      JSON.stringify({ uid: next.uid, email: next.email, refreshToken: next.refreshToken })
    );
  } else {
    await SecureStore.deleteItemAsync(SESSION_KEY);
  }
  return next;
}

function fromSignIn(data) {
  return {
    uid: data.localId,
    email: data.email,
    idToken: data.idToken,
    refreshToken: data.refreshToken,
    expiresAt: Date.now() + Number(data.expiresIn || 3600) * 1000,
  };
}

export async function restoreSession() {
  const raw = await SecureStore.getItemAsync(SESSION_KEY);
  if (!raw) return null;
  try {
    session = { ...JSON.parse(raw), idToken: null, expiresAt: 0 };
    await getIdToken(true);
    return session;
  } catch (err) {
    if (err.code) await persist(null); // auth rejected the refresh token
    return session && !err.code ? session : null;
  }
}

export async function signUp(email, password) {
  const data = await post(`${IDENTITY}/accounts:signUp`, { email, password, returnSecureToken: true });
  return persist(fromSignIn(data));
}

export async function signIn(email, password) {
  const data = await post(`${IDENTITY}/accounts:signInWithPassword`, {
    email,
    password,
    returnSecureToken: true,
  });
  return persist(fromSignIn(data));
}

// Confirms the password without replacing the current session (used before deletion).
export async function reauthenticate(password) {
  if (!session?.email) throw new Error('Not signed in');
  const data = await post(`${IDENTITY}/accounts:signInWithPassword`, {
    email: session.email,
    password,
    returnSecureToken: true,
  });
  return persist(fromSignIn(data));
}

export async function sendPasswordReset(email) {
  await post(`${IDENTITY}/accounts:sendOobCode`, { requestType: 'PASSWORD_RESET', email });
}

export async function signOut() {
  await persist(null);
}

export function currentSession() {
  return session;
}

let refreshing = null;
export async function getIdToken(forceRefresh = false) {
  if (!session) return null;
  if (!forceRefresh && session.idToken && session.expiresAt > Date.now() + 60_000) {
    return session.idToken;
  }
  if (!refreshing) {
    refreshing = post(
      `${SECURE_TOKEN}/token`,
      { grant_type: 'refresh_token', refresh_token: session.refreshToken },
      true
    )
      .then((data) =>
        persist({
          ...session,
          uid: data.user_id,
          idToken: data.id_token,
          refreshToken: data.refresh_token,
          expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000,
        })
      )
      .finally(() => {
        refreshing = null;
      });
  }
  const next = await refreshing;
  return next.idToken;
}
