import { Alert } from 'react-native';
import { api } from '../api/client';

// Asks for confirmation, deletes the listing (and its photos), and, if it is live on
// eBay, lets the user choose whether to end the eBay listing too.
export function confirmDeleteListing(listing, onDeleted) {
  const liveOnEbay = (listing.targets || []).some(
    (t) => t.marketplace === 'ebay' && t.status === 'published'
  );

  async function run(endOnEbay) {
    try {
      const result = await api.deleteListing(listing.id, { endOnEbay });
      if (endOnEbay && liveOnEbay && result.ebayError) {
        Alert.alert(
          'Deleted from Resale Hub',
          `We couldn't end the eBay listing automatically (${result.ebayError}). End it in eBay Seller Hub.`
        );
      }
      onDeleted?.();
    } catch (err) {
      Alert.alert('Delete failed', err.message);
    }
  }

  const buttons = liveOnEbay
    ? [
        { text: 'Delete and end on eBay', style: 'destructive', onPress: () => run(true) },
        { text: 'Delete here only', onPress: () => run(false) },
        { text: 'Cancel', style: 'cancel' },
      ]
    : [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => run(true) },
      ];

  Alert.alert(
    'Delete listing?',
    `"${listing.title}" and its photos will be permanently deleted.${
      liveOnEbay ? ' It is also live on eBay.' : ''
    }`,
    buttons
  );
}
