import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  FlatList,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { api } from '../api/client';

export default function SearchScreen({ navigation }) {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [results, setResults] = useState([]);
  const [skipped, setSkipped] = useState([]);
  const [searched, setSearched] = useState(false);

  const runSearch = useCallback(async () => {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.search(query.trim());
      setResults(data.results);
      setSkipped(data.skipped || []);
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
        <Text style={styles.empty}>
          No results. This usually means no marketplace API keys are configured on the
          server yet — check the "Sources" note below.
        </Text>
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
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle} numberOfLines={2}>
                {item.title}
              </Text>
              <Text style={styles.cardSource}>{item.marketplace.toUpperCase()} · {item.condition}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              {item.bestDeal && <Text style={styles.bestDeal}>BEST DEAL</Text>}
              <Text style={styles.price}>${item.totalPrice.toFixed(2)}</Text>
              {item.shippingPrice > 0 && (
                <Text style={styles.shipping}>+${item.shippingPrice.toFixed(2)} ship incl.</Text>
              )}
            </View>
          </Pressable>
        )}
      />

      {searched && (
        <Text style={styles.sourcesNote}>
          Searched: {results.length ? [...new Set(results.map((r) => r.marketplace))].join(', ') : 'none configured'}
          {skipped.length > 0 && `  ·  Skipped: ${skipped.map((s) => s.label).join(', ')}`}
        </Text>
      )}
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
    backgroundColor: '#2563eb',
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
  bestDeal: { color: '#16a34a', fontWeight: '700', fontSize: 11, marginBottom: 2 },
  price: { fontWeight: '700', fontSize: 16 },
  shipping: { color: '#64748b', fontSize: 11 },
  sourcesNote: { color: '#94a3b8', fontSize: 11, marginTop: 8 },
});
