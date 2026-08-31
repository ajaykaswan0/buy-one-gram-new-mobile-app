import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useLanguage } from '../i18n';

/**
 * Where an order has got to, in the four steps that matter to a salesman.
 *
 * The card used to print the raw status — "warehouse", "ready_for_delivery" —
 * which is warehouse vocabulary, not something to read out to a shopkeeper.
 * These four are the questions actually asked at the counter: has it been
 * taken, is it on the way, has it arrived, is it paid for.
 *
 * Paid is deliberately last and separate from delivery: an order can be
 * delivered for weeks before the money arrives, and that gap is the thing the
 * salesman is chasing.
 */
const STAGES = [
  { key: 'pending', label: 'Pending' },
  { key: 'transit', label: 'In transit' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'paid', label: 'Paid' },
];

const IN_TRANSIT = ['confirmed', 'warehouse', 'packed', 'ready_for_delivery', 'dispatched'];

/**
 * Which step an order is standing on.
 *
 * Paid only counts once the bill is actually settled — an order with no invoice
 * yet is not "paid", it simply has nothing to pay, so it rests on delivered.
 */
export const stageOf = (order) => {
  const status = String(order?.status || '').toLowerCase();

  if (status === 'cancelled') return 'cancelled';
  if (status === 'returned') return 'returned';

  const settled = order?.paymentState === 'paid'
    || order?.paymentState === 'prepaid'
    || (order?.financeInvoice && Number(order.balanceDue || 0) <= 0);

  if (status === 'delivered') return settled ? 'paid' : 'delivered';
  if (IN_TRANSIT.includes(status)) return 'transit';
  return 'pending';
};

export default function OrderStageTracker({ order, compact = false }) {
  const { t } = useLanguage();
  const current = stageOf(order);

  // A cancelled or returned order never reaches the end of the track, so
  // showing four hopeful steps would misrepresent it.
  if (current === 'cancelled' || current === 'returned') {
    return (
      <View style={[styles.wrap, compact && styles.wrapCompact]}>
        <View style={[styles.deadRow, current === 'returned' && styles.deadRowReturned]}>
          <Text style={[styles.deadText, current === 'returned' && styles.deadTextReturned]}>
            {current === 'cancelled' ? `✕  ${t('Cancelled')}` : `↩  ${t('Returned to warehouse')}`}
          </Text>
        </View>
      </View>
    );
  }

  const currentIndex = STAGES.findIndex((stage) => stage.key === current);

  return (
    <View style={[styles.wrap, compact && styles.wrapCompact]}>
      {STAGES.map((stage, index) => {
        const done = index < currentIndex;
        const here = index === currentIndex;
        return (
          <View key={stage.key} style={styles.row}>
            <View style={styles.railColumn}>
              <View style={[styles.dot, done && styles.dotDone, here && styles.dotHere]}>
                {done ? <Text style={styles.tick}>✓</Text> : null}
              </View>
              {/* No tail under the last step, or the track appears to carry on
                  past the end. */}
              {index < STAGES.length - 1 && (
                <View style={[styles.rail, done && styles.railDone]} />
              )}
            </View>

            <Text style={[styles.label, done && styles.labelDone, here && styles.labelHere]}>
              {t(stage.label)}
            </Text>

            {here && <Text style={styles.arrow}>←</Text>}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 10, paddingVertical: 4 },
  wrapCompact: { marginTop: 6 },

  row: { flexDirection: 'row', alignItems: 'flex-start' },
  railColumn: { alignItems: 'center', width: 22 },
  dot: {
    width: 13, height: 13, borderRadius: 7,
    borderWidth: 2, borderColor: '#CBD5E0', backgroundColor: '#FFFFFF',
    alignItems: 'center', justifyContent: 'center', marginTop: 2,
  },
  dotDone: { borderColor: '#00796B', backgroundColor: '#00796B' },
  dotHere: { borderColor: '#00796B', backgroundColor: '#FFFFFF', borderWidth: 3 },
  tick: { color: '#FFFFFF', fontSize: 8, fontWeight: '900', lineHeight: 10 },
  rail: { width: 2, height: 16, backgroundColor: '#E2E8F0', marginVertical: 1 },
  railDone: { backgroundColor: '#00796B' },

  label: { flex: 1, fontSize: 12.5, color: '#A0AEC0', marginLeft: 8, lineHeight: 17 },
  labelDone: { color: '#4A5568' },
  labelHere: { color: '#00695C', fontWeight: '800' },
  arrow: { color: '#00796B', fontWeight: '900', fontSize: 15, marginLeft: 6, lineHeight: 17 },

  deadRow: {
    paddingVertical: 8, paddingHorizontal: 12,
    borderRadius: 8, backgroundColor: '#FFF5F5', alignSelf: 'flex-start',
  },
  deadRowReturned: { backgroundColor: '#FFFAF0' },
  deadText: { color: '#C53030', fontWeight: '800', fontSize: 12 },
  deadTextReturned: { color: '#B7791F' },
});
