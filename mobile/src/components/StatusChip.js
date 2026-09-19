import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

const COLORS = {
  published: { bg: '#dcfce7', fg: '#166534' },
  pending: { bg: '#fef9c3', fg: '#854d0e' },
  failed: { bg: '#fee2e2', fg: '#991b1b' },
  not_connected: { bg: '#e0e7ff', fg: '#3730a3' },
  unsupported: { bg: '#f1f5f9', fg: '#475569' },
  default: { bg: '#f1f5f9', fg: '#334155' },
};

const LABELS = {
  published: 'Published',
  pending: 'Pending',
  failed: 'Failed',
  not_connected: 'Not connected',
  unsupported: 'Not available',
};

export default function StatusChip({ status, label }) {
  const palette = COLORS[status] || COLORS.default;
  return (
    <View style={[styles.chip, { backgroundColor: palette.bg }]}>
      <Text style={[styles.text, { color: palette.fg }]}>
        {label ? `${label}: ` : ''}
        {LABELS[status] || status}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    marginRight: 6,
    marginBottom: 6,
  },
  text: { fontSize: 12, fontWeight: '600' },
});
