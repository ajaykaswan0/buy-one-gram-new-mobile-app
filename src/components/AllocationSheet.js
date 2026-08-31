import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform,
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { scale, verticalScale, responsiveFontSize } from '../utils/responsive';

const money = (v) => `₹${Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const day = (v) => (v ? new Date(v).toLocaleDateString('en-IN') : '—');
const round2 = (v) => Number(Number(v || 0).toFixed(2));

/**
 * Putting a collection against the bills it pays.
 *
 * Opens the moment a payment is recorded, because a payment nobody allocates is
 * money the party has handed over that no bill knows about - which is how the
 * old app ended up with 85 lakh sitting unallocated. It also opens again later,
 * on a payment that still has money loose.
 *
 * Two things about the server shape decide how this works:
 *
 *   - the allocate endpoint REPLACES the whole allocation list, so coming back
 *     to add a second bill would wipe the first. Every box on screen is
 *     therefore prefilled from what this payment already carries, and the whole
 *     set is sent every time.
 *   - an allocation is only a promise until somebody settles it, so a bill's
 *     balance does not drop when it is allocated. A bill fully promised would
 *     otherwise still show its whole amount as owed, and the same money could be
 *     pointed at it twice. What other payments have promised is therefore taken
 *     off what this one may use.
 */
export default function AllocationSheet({ visible, token, apiUrl, partyId, payment, onDone, onSkip }) {
  const [bills, setBills] = useState([]);
  const [promisedByOthers, setPromisedByOthers] = useState({});
  const [amounts, setAmounts] = useState({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const receipt = Number(payment?.amount || 0);

  useEffect(() => {
    if (!visible || !partyId || !payment?._id) return undefined;
    let alive = true;
    setLoading(true);
    setError('');

    fetch(`${apiUrl}/finance/party/${partyId}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((data) => {
        if (!alive) return;
        const invoices = data?.data?.invoices || [];
        const payments = data?.data?.payments || [];

        /**
         * What every other payment has already promised each bill.
         *
         * This payment's own promises are excluded — they come back as the
         * prefilled boxes below, so counting them here would subtract them twice.
         */
        const others = {};
        const mine = {};
        for (const p of payments) {
          for (const a of p.allocations || []) {
            const billId = String(a.invoiceId?._id || a.invoiceId || '');
            if (!billId || a.status === 'cancelled') continue;
            if (String(p._id) === String(payment._id)) mine[billId] = round2((mine[billId] || 0) + Number(a.amount || 0));
            else others[billId] = round2((others[billId] || 0) + Number(a.amount || 0));
          }
        }

        const open = invoices
          .filter((b) => b.status !== 'cancelled')
          .map((b) => ({ ...b, free: round2(Number(b.balanceDue || 0) - (others[String(b._id)] || 0)) }))
          // A bill with nothing left to promise is gone, unless this payment is
          // already on it — otherwise the money would look as if it vanished.
          .filter((b) => b.free > 0.01 || mine[String(b._id)])
          .sort((a, b) => new Date(a.invoiceDate) - new Date(b.invoiceDate));

        setPromisedByOthers(others);
        setBills(open);
        setAmounts(Object.fromEntries(Object.entries(mine).map(([id, v]) => [id, String(v)])));
      })
      .catch(() => { if (alive) setError('Could not load the bills for this party'); })
      .finally(() => { if (alive) setLoading(false); });

    return () => { alive = false; };
  }, [visible, partyId, apiUrl, token, payment?._id]);

  /** Live, as the boxes change: what of this receipt is spoken for, and what is not. */
  const used = useMemo(
    () => round2(Object.values(amounts).reduce((sum, v) => sum + (parseFloat(v) || 0), 0)),
    [amounts],
  );
  const left = round2(receipt - used);

  const othersTotal = (exceptId) => round2(Object.entries(amounts)
    .filter(([id]) => id !== exceptId)
    .reduce((sum, [, v]) => sum + (parseFloat(v) || 0), 0));

  /** The most this bill can take: what it still owes, and what the receipt has left. */
  const ceilingFor = (bill) => round2(Math.min(bill.free, receipt - othersTotal(String(bill._id))));

  const setAmount = (bill, raw) => {
    const value = raw.replace(/[^0-9.]/g, '');
    const asked = parseFloat(value) || 0;
    const ceiling = ceilingFor(bill);
    setAmounts((prev) => ({
      ...prev,
      [String(bill._id)]: asked > ceiling ? String(ceiling) : value,
    }));
  };

  const fill = (bill) => {
    const ceiling = ceilingFor(bill);
    if (ceiling > 0) setAmounts((prev) => ({ ...prev, [String(bill._id)]: String(ceiling) }));
  };

  const clear = (bill) => setAmounts((prev) => {
    const next = { ...prev };
    delete next[String(bill._id)];
    return next;
  });

  const submit = async () => {
    // The whole set, every time: the endpoint replaces rather than adds, so
    // sending only the new ones would drop everything allocated before.
    const allocations = Object.entries(amounts)
      .map(([invoiceId, v]) => ({ invoiceId, amount: parseFloat(v) || 0 }))
      .filter((a) => a.amount > 0);

    if (!allocations.length) {
      Alert.alert('Nothing allocated', 'Put the amount against at least one bill, or choose Later.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const response = await fetch(`${apiUrl}/finance/payment/${payment._id}/allocate`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ allocations }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.message || 'Could not allocate');
      onDone(used, left);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onSkip}>
      <KeyboardAvoidingView style={s.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={s.sheet}>
          <Text style={s.title}>Put this payment against bills</Text>
          <Text style={s.receiptLine}>
            {payment?.collectionNumber} {'·'} {money(receipt)} {'·'} {payment?.paymentMode}
          </Text>

          {/* Moves as the boxes below are typed in, so "how much is still loose"
              never has to be worked out on paper. */}
          <View style={s.totals}>
            <View style={s.total}>
              <Text style={s.totalLabel}>Collected</Text>
              <Text style={s.totalValue}>{money(receipt)}</Text>
            </View>
            <View style={s.total}>
              <Text style={s.totalLabel}>Allocated</Text>
              <Text style={s.totalValue}>{money(used)}</Text>
            </View>
            <View style={s.total}>
              <Text style={s.totalLabel}>Unallocated</Text>
              <Text style={[s.totalValue, left > 0.01 && s.totalWarn]}>{money(left)}</Text>
            </View>
          </View>

          {error ? <Text style={s.error}>{error}</Text> : null}

          {loading ? <ActivityIndicator color="#0F766E" style={{ marginVertical: verticalScale(30) }} /> : (
            /**
             * Scrolls, and keeps scrolling with the keyboard up.
             *
             * A party with eight bills had the last of them behind the keyboard
             * with no way to reach them, so only the top few could ever be paid.
             */
            <ScrollView
              style={s.list}
              contentContainerStyle={s.listContent}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              showsVerticalScrollIndicator
            >
              {bills.length === 0 ? (
                <Text style={s.empty}>Nothing left to pay for this party. The money stays in their wallet.</Text>
              ) : bills.map((bill) => {
                const entered = parseFloat(amounts[String(bill._id)]) || 0;
                const remaining = round2(bill.free - entered);
                const promised = promisedByOthers[String(bill._id)] || 0;
                return (
                  <View key={bill._id} style={[s.bill, entered > 0 && s.billActive]}>
                    <View style={s.billHead}>
                      <View style={{ flex: 1 }}>
                        <Text style={s.billNumber}>{bill.invoiceNumber}</Text>
                        <Text style={s.billMeta}>Due {day(bill.dueDate)} {'·'} Bill {money(bill.originalAmount)}</Text>
                        {promised > 0.01 && (
                          <Text style={s.promised}>{money(promised)} promised by another payment</Text>
                        )}
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={s.billBalance}>{money(bill.free)}</Text>
                        <Text style={s.billBalanceLabel}>can take</Text>
                      </View>
                    </View>

                    <View style={s.billRow}>
                      <TextInput
                        style={s.input}
                        keyboardType="numeric"
                        placeholder="0"
                        placeholderTextColor="#94A3B8"
                        value={amounts[String(bill._id)] || ''}
                        onChangeText={(v) => setAmount(bill, v)}
                      />
                      <TouchableOpacity style={s.fillBtn} onPress={() => fill(bill)}>
                        <Text style={s.fillText}>Full</Text>
                      </TouchableOpacity>
                      {entered > 0 && (
                        <TouchableOpacity style={s.clearBtn} onPress={() => clear(bill)}>
                          <Text style={s.clearText}>Clear</Text>
                        </TouchableOpacity>
                      )}
                      <Text style={[s.remaining, remaining <= 0.01 && s.remainingClear]}>
                        {remaining <= 0.01 ? 'clears this bill' : `${money(remaining)} would still be owed`}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </ScrollView>
          )}

          <View style={s.actions}>
            <TouchableOpacity style={s.secondary} disabled={saving} onPress={onSkip}>
              <Text style={s.secondaryText}>Later</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.primary, saving && s.primaryOff]} disabled={saving || loading} onPress={submit}>
              <Text style={s.primaryText}>{saving ? 'Saving…' : `Allocate ${money(used)}`}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.55)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#F7F9FC', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: scale(16), maxHeight: '92%' },
  title: { fontSize: responsiveFontSize(17), fontWeight: '900', color: '#0F172A' },
  receiptLine: { fontSize: responsiveFontSize(11), color: '#475569', marginTop: verticalScale(2), fontWeight: '700' },
  totals: { flexDirection: 'row', gap: scale(8), marginTop: verticalScale(12) },
  total: { flex: 1, backgroundColor: '#fff', borderRadius: 10, padding: scale(10), borderWidth: 1, borderColor: '#E2E8F0' },
  totalLabel: { fontSize: responsiveFontSize(9), color: '#64748B', fontWeight: '800' },
  totalValue: { fontSize: responsiveFontSize(13), color: '#0F172A', fontWeight: '900', marginTop: verticalScale(2) },
  totalWarn: { color: '#B45309' },
  error: { marginTop: verticalScale(10), padding: scale(10), borderRadius: 8, backgroundColor: '#FEE2E2', color: '#B91C1C', fontWeight: '700' },
  list: { marginTop: verticalScale(12), maxHeight: verticalScale(320) },
  listContent: { paddingBottom: verticalScale(10) },
  empty: { textAlign: 'center', color: '#64748B', padding: scale(24), fontWeight: '600' },
  bill: { backgroundColor: '#fff', borderRadius: 12, padding: scale(12), marginBottom: verticalScale(10), borderWidth: 1, borderColor: '#E2E8F0' },
  billActive: { borderColor: '#0F766E', borderWidth: 2 },
  billHead: { flexDirection: 'row', alignItems: 'flex-start' },
  billNumber: { fontSize: responsiveFontSize(13), fontWeight: '900', color: '#0F172A' },
  billMeta: { fontSize: responsiveFontSize(10), color: '#64748B', marginTop: verticalScale(2) },
  promised: { fontSize: responsiveFontSize(9), color: '#B45309', fontWeight: '800', marginTop: verticalScale(2) },
  billBalance: { fontSize: responsiveFontSize(14), fontWeight: '900', color: '#B91C1C' },
  billBalanceLabel: { fontSize: responsiveFontSize(9), color: '#94A3B8', fontWeight: '700' },
  billRow: { flexDirection: 'row', alignItems: 'center', gap: scale(6), marginTop: verticalScale(10), flexWrap: 'wrap' },
  input: { width: scale(88), borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 8, padding: scale(9), color: '#0F172A', fontWeight: '800', backgroundColor: '#fff' },
  fillBtn: { paddingHorizontal: scale(10), paddingVertical: verticalScale(9), borderRadius: 8, backgroundColor: '#CCFBF1' },
  fillText: { color: '#0F766E', fontWeight: '900', fontSize: responsiveFontSize(11) },
  clearBtn: { paddingHorizontal: scale(10), paddingVertical: verticalScale(9), borderRadius: 8, backgroundColor: '#FEE2E2' },
  clearText: { color: '#B91C1C', fontWeight: '900', fontSize: responsiveFontSize(11) },
  remaining: { flex: 1, minWidth: scale(120), fontSize: responsiveFontSize(10), color: '#B45309', fontWeight: '700' },
  remainingClear: { color: '#047857' },
  actions: { flexDirection: 'row', gap: scale(10), marginTop: verticalScale(14) },
  secondary: { flex: 1, padding: scale(14), borderRadius: 12, backgroundColor: '#E2E8F0', alignItems: 'center' },
  secondaryText: { fontWeight: '900', color: '#475569' },
  primary: { flex: 2, padding: scale(14), borderRadius: 12, backgroundColor: '#0F766E', alignItems: 'center' },
  primaryOff: { opacity: 0.6 },
  primaryText: { fontWeight: '900', color: '#fff' },
});
