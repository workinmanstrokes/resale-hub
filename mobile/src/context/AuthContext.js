import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { api } from '../api/client';
import * as fbAuth from '../api/firebaseAuth';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [initializing, setInitializing] = useState(true);

  const refreshUser = useCallback(async () => {
    try {
      const data = await api.me();
      setUser(data.user);
      return data.user;
    } catch (err) {
      if (err.status === 401) {
        await fbAuth.signOut();
        setSession(null);
        setUser(null);
      }
      return null;
    }
  }, []);

  useEffect(() => {
    (async () => {
      const restored = await fbAuth.restoreSession().catch(() => null);
      setSession(restored);
      if (restored) await refreshUser();
      setInitializing(false);
    })();
  }, [refreshUser]);

  const login = useCallback(
    async (email, password) => {
      setSession(await fbAuth.signIn(email, password));
      return refreshUser();
    },
    [refreshUser]
  );

  const register = useCallback(
    async (email, password) => {
      if (password.length < 8) throw new Error('Password must be at least 8 characters.');
      setSession(await fbAuth.signUp(email, password));
      return refreshUser();
    },
    [refreshUser]
  );

  const logout = useCallback(async () => {
    await fbAuth.signOut();
    setSession(null);
    setUser(null);
  }, []);

  // Re-checks the password, then deletes listings, photos, eBay link and the account.
  const deleteAccount = useCallback(async (password) => {
    await fbAuth.reauthenticate(password);
    await api.deleteAccount();
    await fbAuth.signOut();
    setSession(null);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({
      user,
      setUser,
      initializing,
      isLoggedIn: Boolean(session),
      email: session?.email || user?.email || null,
      login,
      register,
      logout,
      deleteAccount,
      refreshUser,
      sendPasswordReset: fbAuth.sendPasswordReset,
    }),
    [user, session, initializing, login, register, logout, deleteAccount, refreshUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
