import React from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, Linking, Image } from 'react-native';

export default function ItemDetailScreen({ route }) {
  const { results, selectedIndex } = route.params;
  const selected = results[selectedIndex];
  const ranked = [...results].sort((a, b) => a.totalPrice - b.totalPrice);

  return (
    <View style={styles.container}>
      {selected.imageUrl && (
        <Image source={{ uri: selected.imageUrl }} style={styles.image} resizeMode="contain" />
      )}
      <Text style={styles.title}>{selected.title}</Text>
      <Text style={styles.subtitle}>
        {selected.marketplace === 'ebay' ? 'eBay' : 'Etsy'}
        {selected.condition !== 'unknown' ? ` · ${selected.condition}` : ''}
        {selected.shippingPrice > 0 ? ` · incl. $${selected.shippingPrice.toFixed(2)} shipping` : ''}
      </Text>
      <Text style={styles.price}>${selected.totalPrice.toFixed(2)}</Text>
      <Pressable style={styles.linkButton} onPress={() => Linking.openURL(selected.url)}>
        <Text style={styles.linkButtonText}>Open listing</Text>
      </Pressable>

      <Text style={styles.sectionTitle}>
        Prices across sources for this search, ranked low to high
      </Text>
      <Text style={styles.sectionSubtitle}>
        These are other results for the same search query, not guaranteed to be the exact
        same item — use titles/photos to confirm before buying.
      </Text>
      <FlatList
        data={ranked}
        keyExtractor={(item, i) => `${item.marketplace}-${item.sourceId}-${i}`}
        renderItem={({ item }) => (
          <Pressable style={styles.row} onPress={() => Linking.openURL(item.url)}>
            <Text style={styles.rowTitle} numberOfLines={1}>
              {item.bestDeal ? '🏆 ' : ''}
              {item.marketplace === 'ebay' ? 'eBay' : 'Etsy'} — {item.title}
            </Text>
            <Text style={styles.rowPrice}>${item.totalPrice.toFixed(2)}</Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: '#fff' },
  image: { width: '100%', height: 200, marginBottom: 12, borderRadius: 12 },
  title: { fontSize: 18, fontWeight: '700' },
  subtitle: { color: '#64748b', marginTop: 4 },
  price: { fontSize: 24, fontWeight: '800', marginTop: 8 },
  linkButton: {
    marginTop: 12,
    backgroundColor: '#0F766E',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  linkButtonText: { color: '#fff', fontWeight: '600' },
  sectionTitle: { marginTop: 24, fontWeight: '700', fontSize: 14 },
  sectionSubtitle: { color: '#94a3b8', fontSize: 12, marginTop: 4, marginBottom: 8 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  rowTitle: { flex: 1, marginRight: 8, color: '#334155' },
  rowPrice: { fontWeight: '700' },
});
