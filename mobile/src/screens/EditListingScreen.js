import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import ListingForm from '../components/ListingForm';
import { confirmDeleteListing } from '../components/confirmDeleteListing';
import { api } from '../api/client';
import { colors } from '../theme';

export default function EditListingScreen({ route, navigation }) {
  const { listingId } = route.params;
  const [listing, setListing] = useState(null);

  useEffect(() => {
    api
      .getListing(listingId)
      .then(setListing)
      .catch((err) => {
        Alert.alert('Failed to load listing', err.message);
        navigation.goBack();
      });
  }, [listingId, navigation]);

  if (!listing) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  const live = (listing.targets || []).some((t) => t.status === 'published');

  async function handleSave(payload) {
    await api.updateListing(listing.id, payload);
    if (live) {
      Alert.alert('Saved', 'This item is live on eBay. Publish it again to update the eBay listing.', [
        { text: 'Later', onPress: () => navigation.goBack() },
        { text: 'Publish now', onPress: () => navigation.replace('Publish', { listingId: listing.id }) },
      ]);
    } else {
      navigation.goBack();
    }
  }

  return (
    <ListingForm
      initial={listing}
      submitLabel="Save changes"
      onSubmit={handleSave}
      footer={
        <Pressable
          style={styles.deleteButton}
          onPress={() => confirmDeleteListing(listing, () => navigation.popToTop())}
        >
          <Text style={styles.deleteText}>Delete listing</Text>
        </Pressable>
      }
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  deleteButton: {
    marginTop: 14,
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  deleteText: { color: colors.danger, fontWeight: '700' },
});
