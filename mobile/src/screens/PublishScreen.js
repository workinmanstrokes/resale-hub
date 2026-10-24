import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  Linking,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import StatusChip from '../components/StatusChip';
import { confirmDeleteListing } from '../components/confirmDeleteListing';
import { colors } from '../theme';

export default function PublishScreen({ route, navigation }) {
  const { listingId } = route.params;
  const { user, refreshUser } = useAuth();
  const [listing, setListing] = useState(null);
  const [marketplaces, setMarketplaces] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [publishing, setPublishing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [listingData, marketplaceData] = await Promise.all([
        api.getListing(listingId),
        api.marketplaces(),
        refreshUser(),
      ]);
      setListing(listingData);
      setMarketplaces(marketplaceData);
    } catch (err) {
      Alert.alert('Failed to load', err.message);
    }
  }, [listingId, refreshUser]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  function toggle(key) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function handlePublish() {
    if (selected.size === 0) return;
    setPublishing(true);
    try {
      const data = await api.publishListing(listingId, [...selected]);
      setListing(data.listing);
      const label = (key) => marketplaces.find((m) => m.key === key)?.label || key;
      const summary = data.results
        .map((r) => `${label(r.marketplace)}: ${r.status === 'published' ? 'Published' : r.error || r.status}`)
        .join('\n\n');
      Alert.alert('Publish results', summary);
    } catch (err) {
      Alert.alert('Publish failed', err.message);
    } finally {
      setPublishing(false);
    }
  }

  if (!listing) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  const targetByMarketplace = Object.fromEntries((listing.targets || []).map((t) => [t.marketplace, t]));
  // Only marketplaces that can really publish are selectable; the rest are listed below.
  const publishable = marketplaces.filter((m) => m.capabilities.includes('publish'));
  const unavailable = marketplaces.filter((m) => !m.capabilities.includes('publish'));
  const ebayMissing = user?.ebay?.missing || [];

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
      <Text style={styles.heading}>{listing.title}</Text>
      <Text style={styles.subheading}>
        ${Number(listing.price).toFixed(2)} · {listing.condition}
        {listing.ebayCategoryName ? ` · ${listing.ebayCategoryName.split(' > ').pop()}` : ''}
      </Text>
      <View style={styles.actionsRow}>
        <Pressable style={styles.outlineButton} onPress={() => navigation.navigate('EditListing', { listingId })}>
          <Text style={styles.outlineButtonText}>Edit</Text>
        </Pressable>
        <Pressable
          style={[styles.outlineButton, { borderColor: colors.danger }]}
          onPress={() => confirmDeleteListing(listing, () => navigation.popToTop())}
        >
          <Text style={[styles.outlineButtonText, { color: colors.danger }]}>Delete</Text>
        </Pressable>
      </View>

      <Text style={styles.sectionTitle}>Choose where to publish</Text>
      {publishable.length === 0 && (
        <Text style={styles.note}>Publishing isn't available right now. Please try again later.</Text>
      )}
      {publishable.map((m) => {
        const target = targetByMarketplace[m.key];
        const isEbay = m.key === 'ebay';
        return (
          <Pressable
            key={m.key}
            style={[styles.marketplaceRow, selected.has(m.key) && styles.marketplaceRowSelected]}
            onPress={() => toggle(m.key)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: selected.has(m.key) }}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.marketplaceLabel}>{m.label}</Text>
              {isEbay && !user?.ebayConnected && (
                <Text style={styles.marketplaceNote}>Connect your eBay account on the Account tab first.</Text>
              )}
              {isEbay && user?.ebayConnected && ebayMissing.length > 0 && (
                <Text style={styles.marketplaceNote}>Needs a {ebayMissing.join(', ')} (see Account tab).</Text>
              )}
              {target && (
                <View style={{ flexDirection: 'row', marginTop: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                  <StatusChip status={target.status} />
                  {target.outOfDate && <Text style={styles.marketplaceNote}>Edited since publishing</Text>}
                </View>
              )}
              {target?.error && target.status !== 'published' && (
                <Text style={styles.errorText}>{target.error}</Text>
              )}
              {target?.url && (
                <Text style={styles.link} onPress={() => Linking.openURL(target.url)}>
                  View on {m.label}
                </Text>
              )}
            </View>
            <View style={[styles.checkbox, selected.has(m.key) && styles.checkboxChecked]} />
          </Pressable>
        );
      })}

      <Pressable
        style={[styles.publishButton, (selected.size === 0 || publishing) && styles.publishButtonDisabled]}
        disabled={selected.size === 0 || publishing}
        onPress={handlePublish}
      >
        <Text style={styles.publishButtonText}>
          {publishing
            ? 'Publishing…'
            : `Publish to ${selected.size || ''} marketplace${selected.size === 1 ? '' : 's'}`}
        </Text>
      </Pressable>

      {unavailable.length > 0 && (
        <View style={styles.unavailableBox}>
          <Text style={styles.unavailableTitle}>Not available for publishing</Text>
          {unavailable.map((m) => (
            <Text key={m.key} style={styles.unavailableItem}>
              • {m.label}: {m.key === 'etsy' ? 'search only' : 'no public listing API'}
            </Text>
          ))}
        </View>
      )}

      <Pressable style={styles.doneButton} onPress={() => navigation.getParent()?.navigate('MyListingsTab')}>
        <Text style={styles.doneButtonText}>Go to My Listings</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  heading: { fontSize: 18, fontWeight: '700', color: colors.text },
  subheading: { color: colors.muted, marginTop: 4 },
  actionsRow: { flexDirection: 'row', gap: 8, marginTop: 12, marginBottom: 20 },
  outlineButton: {
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  outlineButtonText: { color: colors.primary, fontWeight: '700' },
  sectionTitle: { fontWeight: '700', marginBottom: 8, color: colors.text },
  note: { color: colors.muted, marginBottom: 8 },
  marketplaceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.surfaceStrong,
    marginBottom: 8,
  },
  marketplaceRowSelected: { borderColor: colors.primary, backgroundColor: colors.primaryTint },
  marketplaceLabel: { fontWeight: '600', color: colors.text },
  marketplaceNote: { color: colors.subtle, fontSize: 12, marginTop: 2 },
  errorText: { color: colors.danger, fontSize: 12, marginTop: 4 },
  link: { color: colors.primary, fontWeight: '600', marginTop: 6 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.border,
    marginLeft: 8,
  },
  checkboxChecked: { backgroundColor: colors.primary, borderColor: colors.primary },
  publishButton: {
    marginTop: 12,
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  publishButtonDisabled: { backgroundColor: colors.subtle },
  publishButtonText: { color: '#fff', fontWeight: '700' },
  unavailableBox: { marginTop: 20, padding: 12, borderRadius: 10, backgroundColor: colors.surface },
  unavailableTitle: { fontWeight: '600', color: colors.muted, marginBottom: 4, fontSize: 13 },
  unavailableItem: { color: colors.subtle, fontSize: 12, lineHeight: 18 },
  doneButton: { marginTop: 12, alignItems: 'center', paddingVertical: 10 },
  doneButtonText: { color: colors.primary, fontWeight: '600' },
});
