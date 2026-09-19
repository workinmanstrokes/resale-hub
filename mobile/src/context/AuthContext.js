import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { api, getToken, setToken, clearToken } from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [initializing, setInitializing] = useState(true);
  const [authToken, setAuthToken] = useState(null);

  const refreshUser = useCallback(async () => {
    try {
      const data = await api.me();
      setUser(data.user);
      return data.user;
    } catch {
      // Token might be expired/invalid — treat as logged out.
      await clearToken();
      setAuthToken(null);
      setUser(null);
      return null;
    }
  }, []);

  useEffect(() => {
    (async () => {
      const token = await getToken();
      setAuthToken(token);
      if (token) await refreshUser();
      setInitializing(false);
    })();
  }, [refreshUser]);

  const login = useCallback(async (email, password) => {
    const data = await api.login(email, password);
    await setToken(data.token);
    setAuthToken(data.token);
    setUser(data.user);
    return data.user;
  }, []);

  const register = useCallback(async (email, password) => {
    const data = await api.register(email, password);
    await setToken(data.token);
    setAuthToken(data.token);
    setUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    await clearToken();
    setAuthToken(null);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({
      user,
      setUser,
      authToken,
      initializing,
      isLoggedIn: Boolean(authToken),
      login,
      register,
      logout,
      refreshUser,
    }),
    [user, authToken, initializing, login, register, logout, refreshUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
