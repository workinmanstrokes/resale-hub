import React, { useState } from 'react';
import ListingForm from '../components/ListingForm';
import { api } from '../api/client';

export default function SellScreen({ navigation }) {
  const [formKey, setFormKey] = useState(0);

  async function handleCreate(payload) {
    const listing = await api.createListing(payload);
    setFormKey((k) => k + 1); // reset the form for the next item
    navigation.navigate('Publish', { listingId: listing.id });
  }

  return <ListingForm key={formKey} submitLabel="Save & choose marketplaces" onSubmit={handleCreate} />;
}
