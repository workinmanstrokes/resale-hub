import { File, UploadType } from 'expo-file-system';
import { API_BASE_URL } from './config';
import { getIdToken } from './firebaseAuth';

async function authHeader(required) {
  const token = await getIdToken().catch((err) => {
    if (required) throw err;
    return null;
  });
  if (!token && required) throw new Error('Please sign in first.');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request(path, { method = 'GET', body, auth = false, optionalAuth = false } = {}) {
  if (!API_BASE_URL) throw new Error('This build is missing EXPO_PUBLIC_API_URL.');
  const headers = {
    Accept: 'application/json',
    ...(body ? { 'Content-Type': 'application/json' } : {}),
    ...(auth || optionalAuth ? await authHeader(auth) : {}),
  };

  let res;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('Could not reach Resale Hub. Check your connection and try again.');
  }

  const isJson = res.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await res.json() : await res.text();
  if (!res.ok) {
    const err = new Error((isJson && data?.error) || `Request failed (${res.status})`);
    err.status = res.status;
    err.code = isJson ? data?.code : undefined;
    throw err;
  }
  return data;
}

async function uploadPhoto(asset) {
  if (!API_BASE_URL) throw new Error('This build is missing EXPO_PUBLIC_API_URL.');
  const headers = await authHeader(true);
  // expo-file-system's native multipart upload (Expo's fetch/FormData rejects RN's
  // {uri,name,type} file shorthand). The API stores the file in Firebase Storage
  // and returns a public https download URL that eBay can fetch.
  let result;
  try {
    const file = new File(asset.uri);
    result = await file.upload(`${API_BASE_URL}/uploads`, {
      uploadType: UploadType.MULTIPART,
      fieldName: 'photo',
      mimeType: asset.mimeType || 'image/jpeg',
      headers,
    });
  } catch (err) {
    throw new Error(`Photo upload failed. Check your connection and try again.`);
  }
  let data = {};
  try {
    data = JSON.parse(result.body || '{}');
  } catch {
    // non-JSON error body
  }
  if (result.status < 200 || result.status >= 300) {
    throw new Error(data?.error || `Upload failed (${result.status})`);
  }
  return data; // { url, path }
}

export const api = {
  health: () => request('/health'),
  marketplaces: () => request('/marketplaces'),
  search: (q, { maxPrice, condition } = {}) => {
    const params = new URLSearchParams({ q });
    if (maxPrice) params.set('maxPrice', String(maxPrice));
    if (condition) params.set('condition', condition);
    return request(`/search?${params.toString()}`, { optionalAuth: true });
  },

  me: () => request('/account/me', { auth: true }),
  deleteAccount: () => request('/account', { method: 'DELETE', auth: true }),

  listListings: () => request('/listings', { auth: true }),
  getListing: (id) => request(`/listings/${id}`, { auth: true }),
  createListing: (payload) => request('/listings', { method: 'POST', body: payload, auth: true }),
  updateListing: (id, payload) =>
    request(`/listings/${id}`, { method: 'PATCH', body: payload, auth: true }),
  deleteListing: (id, { endOnEbay = true } = {}) =>
    request(`/listings/${id}?endOnEbay=${endOnEbay ? 'true' : 'false'}`, {
      method: 'DELETE',
      auth: true,
    }),
  publishListing: (id, marketplaces) =>
    request(`/listings/${id}/publish`, { method: 'POST', body: { marketplaces }, auth: true }),

  ebayStart: (returnUrl) =>
    request('/ebay/oauth/start', { method: 'POST', body: { returnUrl }, auth: true }),
  ebayRefreshSettings: () => request('/ebay/settings/refresh', { method: 'POST', auth: true }),
  ebayUpdateSettings: (settings) =>
    request('/ebay/settings', { method: 'PUT', body: settings, auth: true }),
  ebayCreateLocation: (postalCode, country = 'US') =>
    request('/ebay/location', { method: 'POST', body: { postalCode, country }, auth: true }),
  ebayDisconnect: () => request('/ebay/connection', { method: 'DELETE', auth: true }),
  ebayCategories: (q) => request(`/ebay/categories?q=${encodeURIComponent(q)}`, { auth: true }),

  uploadPhoto,
};

export { API_BASE_URL };
