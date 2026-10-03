import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, Alert, RefreshControl, Image } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../api/client';
import StatusChip from '../components/StatusChip';
import { confirmDeleteListing } from '../components/confirmDeleteListing';
import { colors } from '../theme';

const LABELS = { ebay: 'eBay', etsy: 'Etsy' };

export default function MyListingsScreen({ navigation }) {
  const [listings, setListings] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setListings(await api.listListings());
    } catch (err) {
      Alert.alert('Failed to load listings', err.message);
    } finally {
      setLoaded(true);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function handleRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  if (loaded && listings.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>No listings yet. Create one from the Sell tab.</Text>
      </View>
    );
  }

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={{ paddingBottom: 24 }}
      data={listings}
      keyExtractor={(item) => item.id}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
      renderItem={({ item }) => (
        <Pressable
          style={styles.card}
          onPress={() => navigation.navigate('Publish', { listingId: item.id })}
          onLongPress={() => confirmDeleteListing(item, load)}
        >
          <View style={styles.cardTop}>
            {item.photos?.[0] ? <Image source={{ uri: item.photos[0] }} style={styles.thumb} /> : null}
            <View style={{ flex: 1 }}>
              <Text style={styles.title} numberOfLines={2}>{item.title}</Text>
              <Text style={styles.meta}>
                ${Number(item.price).toFixed(2)} · {item.condition}
              </Text>
            </View>
          </View>
          <View style={styles.chips}>
            {(item.targets || []).length === 0 ? (
              <Text style={styles.notPublished}>Not published anywhere yet</Text>
            ) : (
              item.targets.map((t) => (
                <StatusChip key={t.id} label={LABELS[t.marketplace] || t.marketplace} status={t.status} />
              ))
            )}
          </View>
          <View style={styles.actions}>
            <Pressable style={styles.action} onPress={() => navigation.navigate('Publish', { listingId: item.id })}>
              <Text style={styles.actionText}>Publish</Text>
            </Pressable>
            <Pressable style={styles.action} onPress={() => navigation.navigate('EditListing', { listingId: item.id })}>
              <Text style={styles.actionText}>Edit</Text>
            </Pressable>
            <Pressable
              style={styles.action}
              onPress={() => confirmDeleteListing(item, load)}
              accessibilityLabel={`Delete ${item.title}`}
            >
              <Text style={[styles.actionText, { color: colors.danger }]}>Delete</Text>
            </Pressable>
          </View>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', padding: 16 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#fff' },
  emptyText: { color: colors.muted, textAlign: 'center' },
  card: { padding: 14, borderRadius: 12, backgroundColor: colors.surface, marginBottom: 12 },
  cardTop: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  thumb: { width: 52, height: 52, borderRadius: 8, backgroundColor: colors.surfaceStrong },
  title: { fontWeight: '700', fontSize: 15, color: colors.text },
  meta: { color: colors.muted, marginTop: 2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 10 },
  notPublished: { color: colors.subtle, fontSize: 12 },
  actions: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: colors.surfaceStrong,
    marginTop: 8,
    paddingTop: 8,
  },
  action: { flex: 1, alignItems: 'center', paddingVertical: 4 },
  actionText: { color: colors.primary, fontWeight: '700' },
});
