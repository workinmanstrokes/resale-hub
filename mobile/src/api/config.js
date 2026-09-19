import Constants from 'expo-constants';

// Expo Go reports the dev machine's LAN address as `hostUri` (e.g. "192.168.1.23:8081").
// Reusing that host means the app talks to the API server on the same machine that's
// running `expo start`, without hardcoding an IP. Falls back to localhost for the web
// preview / simulators running on the same machine as the server.
function guessServerHost() {
  const hostUri =
    Constants.expoConfig?.hostUri || Constants.expoGoConfig?.debuggerHost || '';
  const host = hostUri.split(':')[0];
  return host || 'localhost';
}

export const API_BASE_URL = `http://${guessServerHost()}:4000/api`;
