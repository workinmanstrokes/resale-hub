import * as SecureStore from 'expo-secure-store';
import { File, UploadType } from 'expo-file-system';
import { API_BASE_URL } from './config';

const TOKEN_KEY = 'resale_hub_token';

export async function getToken() {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function setToken(token) {
  return SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function clearToken() {
  return SecureStore.deleteItemAsync(TOKEN_KEY);
}

async function request(path, { method = 'GET', body, auth = false } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) {
    const token = await getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  let res;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new Error(
      `Could not reach the API server at ${API_BASE_URL}. Is it running, and is your phone on the same network? (${err.message})`
    );
  }

  const isJson = res.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await res.json() : await res.text();

  if (!res.ok) {
    const message = (isJson && data?.error) || `Request failed (${res.status})`;
    throw new Error(message);
  }
  return data;
}

async function uploadPhoto(asset) {
  const token = await getToken();
  const mimeType = asset.mimeType || 'image/jpeg';

  // Expo's global fetch/FormData (SDK 52+) rejects React Native's classic
  // {uri, name, type} file shorthand ("Unsupported FormDataPart implementation"),
  // and even a manually-built Blob doesn't satisfy its internal instanceof check.
  // expo-file-system's native multipart upload sidesteps the JS fetch layer entirely.
  let result;
  try {
    const file = new File(asset.uri);
    result = await file.upload(`${API_BASE_URL}/uploads`, {
      uploadType: UploadType.MULTIPART,
      fieldName: 'photo',
      mimeType,
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
  } catch (err) {
    throw new Error(`Could not reach the API server to upload the photo (${err.message})`);
  }

  const data = JSON.parse(result.body || '{}');
  if (result.status < 200 || result.status >= 300) {
    throw new Error(data?.error || `Upload failed (${result.status})`);
  }
  return data; // { url, filename }
}

export const api = {
  health: () => request('/health'),
  marketplaces: () => request('/marketplaces'),
  search: (q, { maxPrice, condition } = {}) => {
    const params = new URLSearchParams({ q });
    if (maxPrice) params.set('maxPrice', String(maxPrice));
    if (condition) params.set('condition', condition);
    return request(`/search?${params.toString()}`);
  },

  register: (email, password) =>
    request('/auth/register', { method: 'POST', body: { email, password } }),
  login: (email, password) =>
    request('/auth/login', { method: 'POST', body: { email, password } }),
  me: () => request('/auth/me', { auth: true }),

  listListings: () => request('/listings', { auth: true }),
  getListing: (id) => request(`/listings/${id}`, { auth: true }),
  createListing: (payload) =>
    request('/listings', { method: 'POST', body: payload, auth: true }),
  updateListing: (id, payload) =>
    request(`/listings/${id}`, { method: 'PATCH', body: payload, auth: true }),
  deleteListing: (id) => request(`/listings/${id}`, { method: 'DELETE', auth: true }),
  publishListing: (id, marketplaces) =>
    request(`/listings/${id}/publish`, {
      method: 'POST',
      body: { marketplaces },
      auth: true,
    }),

  uploadPhoto,
};

export { API_BASE_URL };
