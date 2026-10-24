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
import { colors } from '../theme';

const CONDITIONS = ['new', 'used', 'refurbished'];
const MAX_PHOTOS = 12;

function toPhotos(urls = []) {
  return urls.map((url) => ({ id: Crypto.randomUUID(), uri: url, url, uploading: false, error: null }));
}

// Shared by the Sell (create) and Edit listing screens.
export default function ListingForm({ initial = {}, submitLabel, onSubmit, footer }) {
  const [title, setTitle] = useState(initial.title || '');
  const [description, setDescription] = useState(initial.description || '');
  const [price, setPrice] = useState(initial.price != null ? String(initial.price) : '');
  const [condition, setCondition] = useState(initial.condition || 'used');
  const [category, setCategory] = useState(initial.category || '');
  const [ebayCategory, setEbayCategory] = useState(
    initial.ebayCategoryId ? { id: initial.ebayCategoryId, name: initial.ebayCategoryName } : null
  );
  const [suggestions, setSuggestions] = useState(null);
  const [findingCategory, setFindingCategory] = useState(false);
  const [photos, setPhotos] = useState(() => toPhotos(initial.photos));
  const [pastedUrl, setPastedUrl] = useState('');
  const [saving, setSaving] = useState(false);

  const uploadingCount = photos.filter((p) => p.uploading).length;
  const priceNumber = Number(price);
  const canSave =
    title.trim() && price.trim() && Number.isFinite(priceNumber) && priceNumber > 0 && uploadingCount === 0;

  function updatePhoto(id, patch) {
    setPhotos((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }

  async function uploadAsset(asset) {
    const id = Crypto.randomUUID();
    setPhotos((prev) => [...prev, { id, uri: asset.uri, mimeType: asset.mimeType, url: null, uploading: true, error: null }]);
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
      selectionLimit: Math.max(1, Math.min(6, MAX_PHOTOS - photos.length)),
      quality: 0.7,
    });
    if (result.canceled) return;
    result.assets.slice(0, MAX_PHOTOS - photos.length).forEach(uploadAsset);
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
    if (photos.length >= MAX_PHOTOS) {
      Alert.alert('Photo limit', `You can add up to ${MAX_PHOTOS} photos.`);
      return;
    }
    Alert.alert('Add photo', undefined, [
      { text: 'Take Photo', onPress: takePhoto },
      { text: 'Choose from Library', onPress: pickFromLibrary },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  function addPastedUrl() {
    const url = pastedUrl.trim();
    if (!url) return;
    if (!/^https:\/\//i.test(url)) {
      Alert.alert('Use an https link', 'Marketplaces only accept photos hosted on https URLs.');
      return;
    }
    setPhotos((prev) => [...prev, ...toPhotos([url])]);
    setPastedUrl('');
  }

  function removePhoto(id) {
    setPhotos((prev) => prev.filter((p) => p.id !== id));
  }

  function retryUpload(photo) {
    removePhoto(photo.id);
    uploadAsset({ uri: photo.uri, mimeType: photo.mimeType });
  }

  async function findEbayCategory() {
    const q = [category, title].map((s) => s.trim()).filter(Boolean).join(' ');
    if (!q) {
      Alert.alert('Add a title or category first');
      return;
    }
    setFindingCategory(true);
    try {
      const { suggestions: list } = await api.ebayCategories(q);
      setSuggestions(list);
      if (!list.length) Alert.alert('No matches', 'Try a more specific category or title.');
    } catch (err) {
      Alert.alert('Could not load eBay categories', err.message);
    } finally {
      setFindingCategory(false);
    }
  }

  async function handleSave() {
    if (photos.some((p) => p.error)) {
      Alert.alert('Some photos failed to upload', 'Retry or remove them before saving.');
      return;
    }
    setSaving(true);
    try {
      await onSubmit({
        title: title.trim(),
        description: description.trim(),
        price: priceNumber,
        condition,
        category: category.trim(),
        ebayCategoryId: ebayCategory?.id || null,
        ebayCategoryName: ebayCategory?.name || null,
        photos: photos.filter((p) => p.url).map((p) => p.url),
      });
    } catch (err) {
      Alert.alert('Could not save listing', err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <Text style={styles.label}>Title</Text>
      <TextInput
        style={styles.input}
        value={title}
        onChangeText={setTitle}
        placeholder="e.g. iPhone 12, 128GB"
        maxLength={80}
      />

      <Text style={styles.label}>Description</Text>
      <TextInput
        style={[styles.input, styles.multiline]}
        value={description}
        onChangeText={setDescription}
        placeholder="Condition details, included accessories, etc."
        multiline
        maxLength={4000}
      />

      <Text style={styles.label}>Price (USD)</Text>
      <TextInput style={styles.input} value={price} onChangeText={setPrice} placeholder="0.00" keyboardType="decimal-pad" />

      <Text style={styles.label}>Condition</Text>
      <View style={styles.row}>
        {CONDITIONS.map((c) => (
          <Pressable key={c} style={[styles.pill, condition === c && styles.pillActive]} onPress={() => setCondition(c)}>
            <Text style={[styles.pillText, condition === c && styles.pillTextActive]}>{c}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>Category</Text>
      <TextInput
        style={styles.input}
        value={category}
        onChangeText={(v) => {
          setCategory(v);
          setSuggestions(null);
        }}
        placeholder="e.g. video game consoles"
      />
      <View style={styles.categoryBox}>
        <Text style={styles.categoryText}>
          {ebayCategory
            ? `eBay category: ${ebayCategory.name || ebayCategory.id}`
            : 'eBay category: matched automatically when you publish, or pick one now.'}
        </Text>
        <View style={[styles.row, { marginTop: 8 }]}>
          <Pressable style={styles.smallButton} onPress={findEbayCategory} disabled={findingCategory}>
            {findingCategory ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Text style={styles.smallButtonText}>{ebayCategory ? 'Change' : 'Find eBay category'}</Text>
            )}
          </Pressable>
          {ebayCategory && (
            <Pressable style={styles.smallButton} onPress={() => setEbayCategory(null)}>
              <Text style={styles.smallButtonText}>Clear</Text>
            </Pressable>
          )}
        </View>
        {suggestions?.map((s) => (
          <Pressable
            key={s.categoryId}
            style={styles.suggestion}
            onPress={() => {
              setEbayCategory({ id: s.categoryId, name: s.path });
              setSuggestions(null);
            }}
          >
            <Text style={styles.suggestionText}>{s.path}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>Photos ({photos.length}/{MAX_PHOTOS})</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.photoRow} contentContainerStyle={{ paddingTop: 8 }}>
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
            <Pressable
              style={styles.removeBadge}
              onPress={() => removePhoto(p.id)}
              accessibilityLabel="Remove photo"
              hitSlop={8}
            >
              <Text style={styles.removeBadgeText}>×</Text>
            </Pressable>
          </View>
        ))}
        <Pressable style={styles.addPhotoTile} onPress={handleAddPhoto} accessibilityLabel="Add photo">
          <Text style={styles.addPhotoPlus}>+</Text>
          <Text style={styles.addPhotoLabel}>Add</Text>
        </Pressable>
      </ScrollView>

      <View style={styles.pasteRow}>
        <TextInput
          style={[styles.input, { flex: 1 }]}
          value={pastedUrl}
          onChangeText={setPastedUrl}
          placeholder="…or paste an https photo link"
          autoCapitalize="none"
          keyboardType="url"
        />
        <Pressable style={styles.pasteButton} onPress={addPastedUrl}>
          <Text style={styles.pasteButtonText}>Add</Text>
        </Pressable>
      </View>
      <Text style={styles.hint}>
        Photos you add are stored in your Resale Hub account and shared with the marketplaces you
        publish to. eBay needs at least one photo.
      </Text>

      <Pressable
        style={[styles.saveButton, !canSave && styles.saveButtonDisabled]}
        disabled={!canSave || saving}
        onPress={handleSave}
      >
        <Text style={styles.saveButtonText}>
          {saving ? 'Saving…' : uploadingCount > 0 ? 'Uploading photos…' : submitLabel}
        </Text>
      </Pressable>
      {footer}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: '#fff' },
  label: { fontWeight: '600', marginTop: 16, marginBottom: 6, color: colors.text },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  pill: { borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  pillActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  pillText: { color: colors.text },
  pillTextActive: { color: '#fff', fontWeight: '600' },
  categoryBox: { marginTop: 8, padding: 10, borderRadius: 10, backgroundColor: colors.surface },
  categoryText: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  smallButton: {
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minWidth: 60,
    alignItems: 'center',
  },
  smallButtonText: { color: colors.primary, fontWeight: '600', fontSize: 12 },
  suggestion: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
  suggestionText: { color: colors.text, fontSize: 13 },
  photoRow: { marginTop: 0 },
  thumbWrap: { marginRight: 12, position: 'relative' },
  thumb: { width: 84, height: 84, borderRadius: 10, backgroundColor: colors.surface },
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
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeBadgeText: { color: '#fff', fontWeight: '700', lineHeight: 16 },
  addPhotoTile: {
    width: 84,
    height: 84,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addPhotoPlus: { fontSize: 22, color: colors.primary, fontWeight: '700' },
  addPhotoLabel: { fontSize: 11, color: colors.muted, marginTop: 2 },
  pasteRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  pasteButton: { backgroundColor: colors.surfaceStrong, borderRadius: 10, paddingHorizontal: 16, justifyContent: 'center' },
  pasteButtonText: { color: colors.text, fontWeight: '600' },
  hint: { color: colors.subtle, fontSize: 12, marginTop: 8, lineHeight: 17 },
  saveButton: { marginTop: 28, backgroundColor: colors.success, borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  saveButtonDisabled: { backgroundColor: colors.subtle },
  saveButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
