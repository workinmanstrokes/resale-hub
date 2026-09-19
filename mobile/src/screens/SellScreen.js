import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ScrollView,
  Alert,
  Image,
  ActivityIndicator,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Crypto from 'expo-crypto';
import { api } from '../api/client';

const CONDITIONS = ['new', 'used', 'refurbished'];

export default function SellScreen({ navigation }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [condition, setCondition] = useState('used');
  const [category, setCategory] = useState('');
  const [photos, setPhotos] = useState([]); // { id, uri, url, uploading, error }
  const [pastedUrl, setPastedUrl] = useState('');
  const [saving, setSaving] = useState(false);

  const uploadingCount = photos.filter((p) => p.uploading).length;
  const canSave = title.trim() && price.trim() && !Number.isNaN(Number(price)) && uploadingCount === 0;

  function updatePhoto(id, patch) {
    setPhotos((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }

  async function uploadAsset(asset) {
    const id = Crypto.randomUUID();
    setPhotos((prev) => [...prev, { id, uri: asset.uri, url: null, uploading: true, error: null }]);
    try {
      const { url } = await api.uploadPhoto(asset);
      updatePhoto(id, { url, uploading: false });
    } catch (err) {
      updatePhoto(id, { uploading: false, error: err.message });
    }
  }

  async function pickFromLibrary() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Allow photo library access to add photos.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: 6,
      quality: 0.7,
    });
    if (result.canceled) return;
    result.assets.forEach(uploadAsset);
  }

  async function takePhoto() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Allow camera access to take a photo.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (result.canceled) return;
    result.assets.forEach(uploadAsset);
  }

  function handleAddPhoto() {
    Alert.alert('Add photo', undefined, [
      { text: 'Take Photo', onPress: takePhoto },
      { text: 'Choose from Library', onPress: pickFromLibrary },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  function addPastedUrl() {
    const url = pastedUrl.trim();
    if (!url) return;
    setPhotos((prev) => [...prev, { id: Crypto.randomUUID(), uri: url, url, uploading: false, error: null }]);
    setPastedUrl('');
  }

  function removePhoto(id) {
    setPhotos((prev) => prev.filter((p) => p.id !== id));
  }

  function retryUpload(photo) {
    removePhoto(photo.id);
    uploadAsset({ uri: photo.uri });
  }

  async function handleSave() {
    setSaving(true);
    try {
      const readyUrls = photos.filter((p) => p.url).map((p) => p.url);
      const failedCount = photos.filter((p) => p.error).length;
      if (failedCount > 0) {
        Alert.alert(
          'Some photos failed to upload',
          `${failedCount} photo(s) failed and will be left out of this listing. You can remove or retry them before saving.`
        );
        return;
      }

      const listing = await api.createListing({
        title: title.trim(),
        description: description.trim(),
        price: Number(price),
        condition,
        category: category.trim() || 'general',
        photos: readyUrls,
      });
      setTitle('');
      setDescription('');
      setPrice('');
      setCategory('');
      setPhotos([]);
      navigation.navigate('Publish', { listingId: listing.id });
    } catch (err) {
      Alert.alert('Could not save listing', err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
      <Text style={styles.label}>Title</Text>
      <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="e.g. iPhone 12, 128GB" />

      <Text style={styles.label}>Description</Text>
      <TextInput
        style={[styles.input, styles.multiline]}
        value={description}
        onChangeText={setDescription}
        placeholder="Condition details, included accessories, etc."
        multiline
      />

      <Text style={styles.label}>Price (USD)</Text>
      <TextInput
        style={styles.input}
        value={price}
        onChangeText={setPrice}
        placeholder="0.00"
        keyboardType="decimal-pad"
      />

      <Text style={styles.label}>Condition</Text>
      <View style={styles.row}>
        {CONDITIONS.map((c) => (
          <Pressable
            key={c}
            style={[styles.pill, condition === c && styles.pillActive]}
            onPress={() => setCondition(c)}
          >
            <Text style={[styles.pillText, condition === c && styles.pillTextActive]}>{c}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>Category</Text>
      <TextInput style={styles.input} value={category} onChangeText={setCategory} placeholder="e.g. electronics" />

      <Text style={styles.label}>Photos</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.photoRow}>
        {photos.map((p) => (
          <View key={p.id} style={styles.thumbWrap}>
            <Image source={{ uri: p.uri }} style={styles.thumb} />
            {p.uploading && (
              <View style={styles.thumbOverlay}>
                <ActivityIndicator color="#fff" />
              </View>
            )}
            {p.error && (
              <Pressable style={styles.thumbOverlay} onPress={() => retryUpload(p)}>
                <Text style={styles.retryText}>Retry</Text>
              </Pressable>
            )}
            <Pressable style={styles.removeBadge} onPress={() => removePhoto(p.id)}>
              <Text style={styles.removeBadgeText}>×</Text>
            </Pressable>
          </View>
        ))}
        <Pressable style={styles.addPhotoTile} onPress={handleAddPhoto}>
          <Text style={styles.addPhotoPlus}>+</Text>
          <Text style={styles.addPhotoLabel}>Add</Text>
        </Pressable>
      </ScrollView>

      <View style={styles.pasteRow}>
        <TextInput
          style={[styles.input, { flex: 1 }]}
          value={pastedUrl}
          onChangeText={setPastedUrl}
          placeholder="…or paste an already-hosted photo URL"
          autoCapitalize="none"
        />
        <Pressable style={styles.pasteButton} onPress={addPastedUrl}>
          <Text style={styles.pasteButtonText}>Add</Text>
        </Pressable>
      </View>
      <Text style={styles.hint}>
        Uploaded photos are hosted by your local API server, which is only reachable on your
        current Wi-Fi network. For a real eBay listing that stays live, use publicly hosted
        image URLs instead.
      </Text>

      <Pressable
        style={[styles.saveButton, !canSave && styles.saveButtonDisabled]}
        disabled={!canSave || saving}
        onPress={handleSave}
      >
        <Text style={styles.saveButtonText}>
          {saving ? 'Saving…' : uploadingCount > 0 ? 'Uploading photos…' : 'Save & choose marketplaces'}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: '#fff' },
  label: { fontWeight: '600', marginTop: 16, marginBottom: 6, color: '#334155' },
  input: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
  row: { flexDirection: 'row', gap: 8 },
  pill: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  pillActive: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
  pillText: { color: '#334155' },
  pillTextActive: { color: '#fff', fontWeight: '600' },
  photoRow: { marginTop: 4 },
  thumbWrap: { marginRight: 10, position: 'relative' },
  thumb: { width: 84, height: 84, borderRadius: 10, backgroundColor: '#f1f5f9' },
  thumbOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 10,
    backgroundColor: 'rgba(15,23,42,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  removeBadge: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#ef4444',
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeBadgeText: { color: '#fff', fontWeight: '700', lineHeight: 16 },
  addPhotoTile: {
    width: 84,
    height: 84,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addPhotoPlus: { fontSize: 22, color: '#2563eb', fontWeight: '700' },
  addPhotoLabel: { fontSize: 11, color: '#64748b', marginTop: 2 },
  pasteRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  pasteButton: {
    backgroundColor: '#e2e8f0',
    borderRadius: 10,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  pasteButtonText: { color: '#334155', fontWeight: '600' },
  hint: { color: '#94a3b8', fontSize: 12, marginTop: 8 },
  saveButton: {
    marginTop: 28,
    backgroundColor: '#16a34a',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  saveButtonDisabled: { backgroundColor: '#94a3b8' },
  saveButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
