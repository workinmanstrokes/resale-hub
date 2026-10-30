import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  Alert,
  ActivityIndicator,
  ScrollView,
  Linking,
} from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';
import Constants from 'expo-constants';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import { PRIVACY_URL, SUPPORT_URL, SUPPORT_EMAIL, WEB_BASE_URL } from '../api/config';
import { colors } from '../theme';

const POLICY_FIELDS = [
  { field: 'fulfillmentPolicyId', option: 'fulfillmentPolicies', label: 'Shipping policy' },
  { field: 'paymentPolicyId', option: 'paymentPolicies', label: 'Payment policy' },
  { field: 'returnPolicyId', option: 'returnPolicies', label: 'Return policy' },
  { field: 'merchantLocationKey', option: 'locations', label: 'Item location' },
];

function parseQuery(url) {
  const query = url.split('?')[1] || '';
  return Object.fromEntries(
    query
      .split('&')
      .filter(Boolean)
      .map((pair) => pair.split('=').map((v) => decodeURIComponent(v.replace(/\+/g, ' '))))
  );
}

function openPage(url) {
  if (!WEB_BASE_URL) {
    Linking.openURL(`mailto:${SUPPORT_EMAIL}`);
    return;
  }
  WebBrowser.openBrowserAsync(url);
}

function AboutLinks() {
  return (
    <View style={styles.about}>
      <View style={styles.linkRow}>
        <Text style={styles.link} onPress={() => openPage(PRIVACY_URL)}>Privacy Policy</Text>
        <Text style={styles.link} onPress={() => openPage(SUPPORT_URL)}>Support</Text>
        <Text style={styles.link} onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}`)}>Contact</Text>
      </View>
      <Text style={styles.legal}>
        Resale Hub by Diddlerrr · v{Constants.expoConfig?.version || '1.0.0'}. For ages 18+.
        {'\n'}Not affiliated with, endorsed by, or sponsored by eBay Inc. The term "Etsy" is a
        trademark of Etsy, Inc. This application uses the Etsy API but is not endorsed or certified
        by Etsy, Inc.
      </Text>
    </View>
  );
}

function SignInForm() {
  const { login, register, sendPasswordReset } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState('login');
  const [busy, setBusy] = useState(false);

  async function handleSubmit() {
    setBusy(true);
    try {
      if (mode === 'login') await login(email.trim(), password);
      else await register(email.trim(), password);
    } catch (err) {
      Alert.alert(mode === 'login' ? 'Sign in failed' : 'Sign up failed', err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleReset() {
    if (!email.trim()) {
      Alert.alert('Enter your email', 'Type your account email above, then tap "Forgot password?" again.');
      return;
    }
    try {
      await sendPasswordReset(email.trim());
      Alert.alert('Check your email', 'If an account exists for that address, we sent a password reset link.');
    } catch (err) {
      Alert.alert('Could not send reset email', err.message);
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <Text style={styles.heading}>{mode === 'login' ? 'Sign in' : 'Create an account'}</Text>
      <Text style={styles.body}>
        An account lets you create listings and publish them to eBay. Searching doesn't need one.
      </Text>
      <TextInput
        style={styles.input}
        placeholder="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
      />
      <TextInput
        style={styles.input}
        placeholder="Password (8+ characters)"
        value={password}
        onChangeText={setPassword}
        autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
        secureTextEntry
      />
      <Pressable style={styles.button} onPress={handleSubmit} disabled={busy}>
        {busy ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>{mode === 'login' ? 'Sign in' : 'Create account'}</Text>
        )}
      </Pressable>
      <Pressable style={styles.linkTap} onPress={() => setMode(mode === 'login' ? 'register' : 'login')}>
        <Text style={styles.switchText}>
          {mode === 'login' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
        </Text>
      </Pressable>
      {mode === 'login' && (
        <Pressable style={styles.linkTap} onPress={handleReset}>
          <Text style={styles.switchText}>Forgot password?</Text>
        </Pressable>
      )}
      {mode === 'register' && (
        <Text style={styles.legalSmall}>
          By creating an account you confirm you are 13 or older and agree to our{' '}
          <Text style={styles.inlineLink} onPress={() => openPage(PRIVACY_URL)}>Privacy Policy</Text>.
        </Text>
      )}
      <AboutLinks />
    </ScrollView>
  );
}

function EbayCard() {
  const { user, setUser, refreshUser } = useAuth();
  const [busy, setBusy] = useState(false);
  const [postalCode, setPostalCode] = useState('');
  const ebay = user?.ebay || {};
  const connected = Boolean(user?.ebayConnected);

  async function run(fn) {
    setBusy(true);
    try {
      const data = await fn();
      if (data?.user) setUser(data.user);
    } catch (err) {
      Alert.alert('eBay', err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleConnect() {
    await run(async () => {
      const returnUrl = AuthSession.makeRedirectUri({ scheme: 'resalehub', path: 'ebay-connected' });
      const { url } = await api.ebayStart(returnUrl);
      const result = await WebBrowser.openAuthSessionAsync(url, returnUrl);
      if (result.type === 'success' && result.url) {
        const params = parseQuery(result.url);
        if (params.message) {
          Alert.alert(params.status === 'ok' ? 'eBay connected' : 'eBay', params.message);
        }
      }
      await refreshUser();
    });
  }

  function handleDisconnect() {
    Alert.alert('Disconnect eBay?', 'Resale Hub will forget your eBay authorization and settings. Your live eBay listings are not affected.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Disconnect', style: 'destructive', onPress: () => run(api.ebayDisconnect) },
    ]);
  }

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>eBay</Text>
      <Text style={styles.cardBody}>
        {connected
          ? 'Connected. Listings publish to your own eBay seller account with your own policies.'
          : ebay.disconnectedReason ||
            'Not connected. Connect your eBay seller account (eBay sign-in) to publish listings.'}
      </Text>

      {connected && (
        <View style={{ marginTop: 10 }}>
          {POLICY_FIELDS.map(({ field, option, label }) => {
            const options = ebay.options?.[option] || [];
            const current = ebay.settings?.[field];
            return (
              <View key={field} style={{ marginBottom: 8 }}>
                <Text style={styles.settingLabel}>{label}</Text>
                {options.length === 0 ? (
                  <Text style={styles.warn}>None found on your eBay account</Text>
                ) : (
                  <View style={styles.chipRow}>
                    {options.map((o) => (
                      <Pressable
                        key={o.id}
                        style={[styles.chip, current === o.id && styles.chipActive]}
                        onPress={() => current !== o.id && run(() => api.ebayUpdateSettings({ [field]: o.id }))}
                      >
                        <Text style={[styles.chipText, current === o.id && styles.chipTextActive]} numberOfLines={1}>
                          {o.name}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                )}
              </View>
            );
          })}
          {!(ebay.options?.locations || []).length && (
            <View style={styles.locationRow}>
              <TextInput
                style={[styles.input, { flex: 1, marginBottom: 0 }]}
                placeholder="ZIP code items ship from"
                value={postalCode}
                onChangeText={setPostalCode}
                keyboardType="number-pad"
                maxLength={10}
              />
              <Pressable
                style={styles.smallButton}
                disabled={busy}
                onPress={() => run(() => api.ebayCreateLocation(postalCode.trim(), 'US'))}
              >
                <Text style={styles.smallButtonText}>Add location</Text>
              </Pressable>
            </View>
          )}
          {(ebay.missing || []).length > 0 && (
            <Text style={styles.warn}>
              Before you can publish, set up business policies (shipping, payment, returns) in eBay
              Seller Hub, then tap Refresh.
            </Text>
          )}
          {ebay.settingsError ? <Text style={styles.warn}>{ebay.settingsError}</Text> : null}
        </View>
      )}

      <View style={styles.cardButtons}>
        <Pressable style={styles.secondaryButton} onPress={handleConnect} disabled={busy}>
          <Text style={styles.secondaryButtonText}>{connected ? 'Reconnect' : 'Connect eBay'}</Text>
        </Pressable>
        {connected && (
          <Pressable style={styles.secondaryButton} onPress={() => run(api.ebayRefreshSettings)} disabled={busy}>
            <Text style={styles.secondaryButtonText}>Refresh</Text>
          </Pressable>
        )}
        {connected && (
          <Pressable style={styles.secondaryButton} onPress={handleDisconnect} disabled={busy}>
            <Text style={styles.secondaryButtonText}>Disconnect</Text>
          </Pressable>
        )}
      </View>
      {busy && <ActivityIndicator style={{ marginTop: 8 }} />}
    </View>
  );
}

function DeleteAccount() {
  const { deleteAccount } = useAuth();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  function confirm() {
    Alert.alert(
      'Delete your account?',
      'This permanently deletes your account, all your listings and photo previews, and your eBay connection. Items already live on eBay stay on eBay. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete account',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              await deleteAccount(password);
              Alert.alert('Account deleted', 'Your account and data have been deleted.');
            } catch (err) {
              Alert.alert('Could not delete account', err.message);
            } finally {
              setBusy(false);
            }
          },
        },
      ]
    );
  }

  if (!open) {
    return (
      <Pressable style={styles.dangerOutline} onPress={() => setOpen(true)}>
        <Text style={styles.dangerText}>Delete account</Text>
      </Pressable>
    );
  }
  return (
    <View style={styles.dangerBox}>
      <Text style={styles.cardTitle}>Delete account</Text>
      <Text style={styles.cardBody}>Enter your password to confirm. Everything you stored in Resale Hub will be deleted.</Text>
      <TextInput
        style={[styles.input, { marginTop: 10 }]}
        placeholder="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />
      <Pressable style={[styles.dangerButton, !password && { opacity: 0.5 }]} disabled={!password || busy} onPress={confirm}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Permanently delete</Text>}
      </Pressable>
      <Pressable onPress={() => setOpen(false)}>
        <Text style={styles.switchText}>Cancel</Text>
      </Pressable>
    </View>
  );
}

export default function AccountScreen() {
  const { isLoggedIn, email, logout } = useAuth();
  if (!isLoggedIn) return <SignInForm />;

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <Text style={styles.heading}>{email}</Text>
      <EbayCard />
      <Pressable style={styles.button} onPress={logout}>
        <Text style={styles.buttonText}>Sign out</Text>
      </Pressable>
      <DeleteAccount />
      <AboutLinks />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: colors.surface },
  heading: { fontSize: 18, fontWeight: '700', marginBottom: 12, color: colors.text },
  body: { color: colors.muted, marginBottom: 16, lineHeight: 19 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    minHeight: 48,
    fontSize: 16,
    backgroundColor: '#fff',
    marginBottom: 12,
  },
  button: { backgroundColor: colors.primary, borderRadius: 12, minHeight: 52, justifyContent: 'center', alignItems: 'center', marginTop: 8 },
  buttonText: { color: '#fff', fontWeight: '700' },
  switchText: { color: colors.primary, textAlign: 'center', marginTop: 14 },
  card: { backgroundColor: colors.surface, borderRadius: 12, padding: 14, marginBottom: 16 },
  cardTitle: { fontWeight: '700', marginBottom: 4, color: colors.text },
  cardBody: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  settingLabel: { fontSize: 12, fontWeight: '600', color: colors.text, marginBottom: 4 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, maxWidth: '100%' },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 12, color: colors.text },
  chipTextActive: { color: '#fff', fontWeight: '600' },
  warn: { color: '#B45309', fontSize: 12, marginTop: 4, lineHeight: 17 },
  locationRow: { flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 4 },
  smallButton: { backgroundColor: colors.primary, borderRadius: 10, paddingHorizontal: 14, minHeight: 48, justifyContent: 'center' },
  smallButtonText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  cardButtons: { flexDirection: 'row', gap: 8, marginTop: 12, flexWrap: 'wrap' },
  secondaryButton: {
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 12,
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: 14,
    alignItems: 'center',
  },
  secondaryButtonText: { color: colors.primary, fontWeight: '700' },
  dangerOutline: { marginTop: 12, borderWidth: 1, borderColor: colors.danger, borderRadius: 12, minHeight: 48, justifyContent: 'center', alignItems: 'center' },
  dangerText: { color: colors.danger, fontWeight: '700' },
  dangerBox: { marginTop: 16, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: colors.danger },
  dangerButton: { backgroundColor: colors.danger, borderRadius: 12, minHeight: 48, justifyContent: 'center', alignItems: 'center' },
  about: { marginTop: 24 },
  linkRow: { flexDirection: 'row', gap: 18, justifyContent: 'center', marginBottom: 10 },
  link: { color: colors.primary, fontWeight: '600' },
  linkTap: { minHeight: 48, justifyContent: 'center' },
  inlineLink: { color: colors.primary, fontWeight: '600' },
  legal: { color: colors.subtle, fontSize: 11, textAlign: 'center', lineHeight: 16 },
  legalSmall: { color: colors.muted, fontSize: 12, textAlign: 'center', marginTop: 14, lineHeight: 17 },
});
