import React, { useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import {
  DEFAULT_SCALE, MAX_SCALE, MIN_SCALE, getFontScale, resetFontScale, setFontScale,
} from '../services/fontScale';

/**
 * How big the app's text is, as a bar you drag.
 *
 * A bar rather than a list of sizes because the right size is the one that
 * looks right, and that is found by moving it and looking — not by reading
 * "Medium" and guessing. Every piece of text on screen grows as it moves, this
 * card included, so what you are choosing is what you get.
 *
 * Built from a plain View: React Native ships no slider, and a whole gesture
 * library for one bar is not worth the megabyte. The track handles a tap and a
 * drag through the same handler, so both work without a mode.
 */
export default function FontSizeSetting() {
  const [scale, setScale] = useState(getFontScale());
  const width = useRef(0);

  const apply = (next) => {
    setScale(next);
    setFontScale(next);
  };

  /** Where along the track a touch landed, as a size. */
  const fromTouch = (event) => {
    const track = width.current;
    if (!track) return;
    const at = Math.min(track, Math.max(0, event.nativeEvent.locationX));
    apply(MIN_SCALE + (at / track) * (MAX_SCALE - MIN_SCALE));
  };

  const percent = ((scale - MIN_SCALE) / (MAX_SCALE - MIN_SCALE)) * 100;
  const isDefault = Math.abs(scale - DEFAULT_SCALE) < 0.01;

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Text size</Text>
          <Text style={styles.help}>Drag the bar. Everything in the app follows it.</Text>
        </View>
        <Text style={styles.value}>{Math.round(scale * 100)}%</Text>
      </View>

      {/* The preview is ordinary Text, so it is scaled by the same wrapper as
          the rest of the app — what is shown here is exactly what happens. */}
      <View style={styles.preview}>
        <Text style={styles.previewTitle}>Khandelwal Kirana Store</Text>
        <Text style={styles.previewBody}>Order B1G2627/1852 · Rs 4,250 · today</Text>
      </View>

      <View style={styles.row}>
        <Text style={styles.smallA}>A</Text>
        <View
          style={styles.track}
          onLayout={(event) => { width.current = event.nativeEvent.layout.width; }}
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
          onResponderGrant={fromTouch}
          onResponderMove={fromTouch}
        >
          <View style={[styles.fill, { width: `${percent}%` }]} />
          <View style={[styles.thumb, { left: `${percent}%` }]} />
        </View>
        <Text style={styles.bigA}>A</Text>
      </View>

      <TouchableOpacity
        style={[styles.reset, isDefault && styles.resetOff]}
        disabled={isDefault}
        onPress={() => { resetFontScale(); setScale(DEFAULT_SCALE); }}
      >
        <Text style={[styles.resetText, isDefault && styles.resetTextOff]}>
          {isDefault ? 'Default size' : 'Back to default'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 16, marginHorizontal: 16, marginTop: 14, elevation: 1 },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  title: { fontSize: 15, fontWeight: '700', color: '#1F2937' },
  help: { fontSize: 12, color: '#6B7280', marginTop: 2 },
  value: { fontSize: 15, fontWeight: '700', color: '#00796B' },

  preview: { marginTop: 12, padding: 12, borderRadius: 10, backgroundColor: '#F1F5F9' },
  previewTitle: { fontSize: 15, fontWeight: '700', color: '#0F172A' },
  previewBody: { fontSize: 12, color: '#475569', marginTop: 3 },

  row: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 16 },
  smallA: { fontSize: 12, color: '#94A3B8', fontWeight: '700' },
  bigA: { fontSize: 20, color: '#94A3B8', fontWeight: '700' },
  // Tall enough to be caught by a thumb, with the visible line drawn inside it.
  track: { flex: 1, height: 34, justifyContent: 'center' },
  fill: { position: 'absolute', left: 0, height: 5, borderRadius: 3, backgroundColor: '#00796B' },
  thumb: { position: 'absolute', width: 22, height: 22, marginLeft: -11, borderRadius: 11, backgroundColor: '#00796B', borderWidth: 3, borderColor: '#fff', elevation: 3 },

  reset: { marginTop: 16, paddingVertical: 11, borderRadius: 10, borderWidth: 1, borderColor: '#00796B', alignItems: 'center' },
  resetOff: { borderColor: '#E2E8F0' },
  resetText: { fontSize: 13, fontWeight: '700', color: '#00796B' },
  resetTextOff: { color: '#94A3B8' },
});
