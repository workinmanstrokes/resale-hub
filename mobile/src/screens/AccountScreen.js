import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { useAuth } from '../context/AuthContext';
import { API_BASE_URL } from '../api/client';

export default function AccountScreen() {
  const { user, isLoggedIn, login, register, logout, refreshUser, authToken } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [busy, setBusy] = useState(false);

  async function handleSubmit() {
    setBusy(true);
    try {
      if (mode === 'login') await login(email.trim(), password);
      else await register(email.trim(), password);
    } catch (err) {
      Alert.alert(mode === 'login' ? 'Login failed' : 'Registration failed', err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleConnectEbay() {
    const url = `${API_BASE_URL}/ebay/oauth/start?token=${encodeURIComponent(authToken)}`;
    await WebBrowser.openBrowserAsync(url);
    // The server-side callback finishes the OAuth exchange and stores the refresh
    // token; once the user closes the browser tab we just re-fetch their profile.
    await refreshUser();
  }

  if (!isLoggedIn) {
    return (
      <View style={styles.container}>
        <Text style={styles.heading}>{mode === 'login' ? 'Log in' : 'Create an account'}</Text>
        <TextInput
          style={styles.input}
          placeholder="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />
        <TextInput
          style={styles.input}
          placeholder="Password (8+ characters)"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />
        <Pressable style={styles.button} onPress={handleSubmit} disabled={busy}>
          {busy ? <ActivityIndicator color="#fff" /> : (
            <Text style={styles.buttonText}>{mode === 'login' ? 'Log in' : 'Register'}</Text>
          )}
        </Pressable>
        <Pressable onPress={() => setMode(mode === 'login' ? 'register' : 'login')}>
          <Text style={styles.switchText}>
            {mode === 'login' ? "Don't have an account? Register" : 'Already have an account? Log in'}
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>{user?.email}</Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>eBay</Text>
        <Text style={styles.cardBody}>
          {user?.ebayConnected
            ? 'Connected — you can publish listings to your eBay account.'
            : 'Not connected. Connect your seller account to publish listings via the eBay Sell API.'}
        </Text>
        <Pressable style={styles.secondaryButton} onPress={handleConnectEbay}>
          <Text style={styles.secondaryButtonText}>
            {user?.ebayConnected ? 'Reconnect eBay' : 'Connect eBay'}
          </Text>
        </Pressable>
      </View>

      <Pressable style={styles.button} onPress={logout}>
        <Text style={styles.buttonText}>Log out</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: '#fff' },
  heading: { fontSize: 18, fontWeight: '700', marginBottom: 16 },
  input: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  button: {
    backgroundColor: '#2563eb',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonText: { color: '#fff', fontWeight: '700' },
  switchText: { color: '#2563eb', textAlign: 'center', marginTop: 14 },
  card: {
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  cardTitle: { fontWeight: '700', marginBottom: 4 },
  cardBody: { color: '#64748b', fontSize: 13, lineHeight: 18 },
  secondaryButton: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#2563eb',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  secondaryButtonText: { color: '#2563eb', fontWeight: '700' },
});
