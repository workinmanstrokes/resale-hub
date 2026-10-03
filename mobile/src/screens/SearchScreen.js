import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  Image,
} from 'react-native';
import { api } from '../api/client';
import { colors } from '../theme';

export default function SearchScreen({ navigation }) {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [results, setResults] = useState([]);
    const [searched, setSearched] = useState(false);

  const runSearch = useCallback(async () => {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.search(query.trim());
      setResults(data.results);
      setSearched(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [query]);

  return (
    <View style={styles.container}>
      <View style={styles.searchRow}>
        <TextInput
          style={styles.input}
          placeholder="Search for a product…"
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={runSearch}
          returnKeyType="search"
        />
        <Pressable style={styles.button} onPress={runSearch}>
          <Text style={styles.buttonText}>Search</Text>
        </Pressable>
      </View>

      {loading && <ActivityIndicator style={{ marginTop: 20 }} />}
      {error && <Text style={styles.error}>{error}</Text>}

      {!loading && searched && results.length === 0 && !error && (
        <Text style={styles.empty}>No results. Try a broader search.</Text>
      )}

      <FlatList
        data={results}
        keyExtractor={(item, i) => `${item.marketplace}-${item.sourceId}-${i}`}
        contentContainerStyle={{ paddingBottom: 24 }}
        renderItem={({ item, index }) => (
          <Pressable
            style={styles.card}
            onPress={() => navigation.navigate('ItemDetail', { results, selectedIndex: index })}
          >
            {item.imageUrl ? <Image source={{ uri: item.imageUrl }} style={styles.thumb} /> : null}
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle} numberOfLines={2}>
                {item.title}
              </Text>
              <Text style={styles.cardSource}>
                {item.marketplace === 'ebay' ? 'eBay' : 'Etsy'}
                {item.condition !== 'unknown' ? ` · ${item.condition}` : ''}
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              {item.bestDeal && <Text style={styles.bestDeal}>BEST DEAL</Text>}
              <Text style={styles.price}>${item.totalPrice.toFixed(2)}</Text>
              {item.shippingPrice > 0 && (
                <Text style={styles.shipping}>incl. ${item.shippingPrice.toFixed(2)} shipping</Text>
              )}
              {item.shippingPrice === 0 && item.shippingKnown && <Text style={styles.shipping}>Free shipping</Text>}
            </View>
          </Pressable>
        )}
      />

      {searched && (
        <Text style={styles.sourcesNote}>
          Searched: {results.length ? [...new Set(results.map((r) => (r.marketplace === 'ebay' ? 'eBay' : 'Etsy')))].join(', ') : 'eBay, Etsy'}
        </Text>
      )}
      <Text style={styles.attribution}>
        The term "Etsy" is a trademark of Etsy, Inc. This application uses the Etsy API but is not
        endorsed or certified by Etsy, Inc.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: '#fff' },
  searchRow: { flexDirection: 'row', gap: 8 },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  buttonText: { color: '#fff', fontWeight: '600' },
  error: { color: '#b91c1c', marginTop: 12 },
  empty: { color: '#64748b', marginTop: 20, lineHeight: 20 },
  card: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#f8fafc',
    marginTop: 12,
  },
  cardTitle: { fontWeight: '600', fontSize: 15 },
  cardSource: { color: '#64748b', marginTop: 4, fontSize: 12 },
  bestDeal: { color: colors.success, fontWeight: '700', fontSize: 11, marginBottom: 2 },
  price: { fontWeight: '700', fontSize: 16 },
  shipping: { color: '#64748b', fontSize: 11 },
  sourcesNote: { color: '#94a3b8', fontSize: 11, marginTop: 8 },
  attribution: { color: '#94a3b8', fontSize: 10, marginTop: 6, lineHeight: 14 },
  thumb: { width: 56, height: 56, borderRadius: 8, marginRight: 10, backgroundColor: '#f1f5f9' },
});
