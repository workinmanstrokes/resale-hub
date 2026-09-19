import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, Alert, RefreshControl } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../api/client';
import StatusChip from '../components/StatusChip';

export default function MyListingsScreen({ navigation }) {
  const [listings, setListings] = useState([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.listListings();
      setListings(data);
    } catch (err) {
      Alert.alert('Failed to load listings', err.message);
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

  function confirmDelete(listing) {
    Alert.alert('Delete listing', `Delete "${listing.title}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.deleteListing(listing.id);
            load();
          } catch (err) {
            Alert.alert('Delete failed', err.message);
          }
        },
      },
    ]);
  }

  if (listings.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>No listings yet. Create one from the Sell tab.</Text>
      </View>
    );
  }

  return (
    <FlatList
      style={styles.container}
      data={listings}
      keyExtractor={(item) => item.id}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
      renderItem={({ item }) => (
        <Pressable
          style={styles.card}
          onPress={() => navigation.navigate('Publish', { listingId: item.id })}
          onLongPress={() => confirmDelete(item)}
        >
          <Text style={styles.title}>{item.title}</Text>
          <Text style={styles.meta}>${Number(item.price).toFixed(2)} · {item.condition}</Text>
          <View style={styles.chips}>
            {(item.targets || []).length === 0 ? (
              <Text style={styles.notPublished}>Not published anywhere yet</Text>
            ) : (
              item.targets.map((t) => <StatusChip key={t.id} label={t.marketplace} status={t.status} />)
            )}
          </View>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', padding: 16 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyText: { color: '#64748b', textAlign: 'center' },
  card: {
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#f8fafc',
    marginBottom: 12,
  },
  title: { fontWeight: '700', fontSize: 15 },
  meta: { color: '#64748b', marginTop: 2, marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap' },
  notPublished: { color: '#94a3b8', fontSize: 12 },
});
