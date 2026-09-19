import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { api } from '../api/client';
import StatusChip from '../components/StatusChip';

export default function PublishScreen({ route, navigation }) {
  const { listingId } = route.params;
  const [listing, setListing] = useState(null);
  const [marketplaces, setMarketplaces] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [listingData, marketplaceData] = await Promise.all([
        api.getListing(listingId),
        api.marketplaces(),
      ]);
      setListing(listingData);
      setMarketplaces(marketplaceData);
    } catch (err) {
      Alert.alert('Failed to load', err.message);
    } finally {
      setLoading(false);
    }
  }, [listingId]);

  useEffect(() => {
    load();
  }, [load]);

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
      const summary = data.results
        .map((r) => `${r.marketplace}: ${r.status}${r.error ? ` — ${r.error}` : ''}`)
        .join('\n');
      Alert.alert('Publish results', summary);
    } catch (err) {
      Alert.alert('Publish failed', err.message);
    } finally {
      setPublishing(false);
    }
  }

  if (loading || !listing) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  const targetByMarketplace = Object.fromEntries(
    (listing.targets || []).map((t) => [t.marketplace, t])
  );

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
      <Text style={styles.heading}>{listing.title}</Text>
      <Text style={styles.subheading}>${Number(listing.price).toFixed(2)} · {listing.condition}</Text>

      <Text style={styles.sectionTitle}>Choose where to publish</Text>
      {marketplaces.map((m) => {
        const existingTarget = targetByMarketplace[m.key];
        const canPublish = m.capabilities.includes('publish');
        return (
          <Pressable
            key={m.key}
            style={[styles.marketplaceRow, selected.has(m.key) && styles.marketplaceRowSelected]}
            onPress={() => toggle(m.key)}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.marketplaceLabel}>{m.label}</Text>
              {!canPublish && (
                <Text style={styles.marketplaceNote}>
                  {m.note || (m.configured ? 'Search only — no listing API available' : 'Not configured on the server')}
                </Text>
              )}
              {existingTarget && (
                <View style={{ flexDirection: 'row', marginTop: 4 }}>
                  <StatusChip status={existingTarget.status} />
                </View>
              )}
            </View>
            <View style={[styles.checkbox, selected.has(m.key) && styles.checkboxChecked]} />
          </Pressable>
        );
      })}

      <Pressable
        style={[styles.publishButton, selected.size === 0 && styles.publishButtonDisabled]}
        disabled={selected.size === 0 || publishing}
        onPress={handlePublish}
      >
        <Text style={styles.publishButtonText}>
          {publishing ? 'Publishing…' : `Publish to ${selected.size || ''} marketplace${selected.size === 1 ? '' : 's'}`}
        </Text>
      </Pressable>

      <Pressable
        style={styles.doneButton}
        onPress={() => navigation.getParent()?.navigate('MyListingsTab')}
      >
        <Text style={styles.doneButtonText}>Go to My Listings</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  heading: { fontSize: 18, fontWeight: '700' },
  subheading: { color: '#64748b', marginTop: 4, marginBottom: 16 },
  sectionTitle: { fontWeight: '700', marginBottom: 8 },
  marketplaceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginBottom: 8,
  },
  marketplaceRowSelected: { borderColor: '#2563eb', backgroundColor: '#eff6ff' },
  marketplaceLabel: { fontWeight: '600' },
  marketplaceNote: { color: '#94a3b8', fontSize: 12, marginTop: 2 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#cbd5e1',
    marginLeft: 8,
  },
  checkboxChecked: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
  publishButton: {
    marginTop: 20,
    backgroundColor: '#2563eb',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  publishButtonDisabled: { backgroundColor: '#94a3b8' },
  publishButtonText: { color: '#fff', fontWeight: '700' },
  doneButton: { marginTop: 12, alignItems: 'center', paddingVertical: 10 },
  doneButtonText: { color: '#2563eb', fontWeight: '600' },
});
