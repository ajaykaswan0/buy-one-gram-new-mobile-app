import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, Image, KeyboardAvoidingView, Modal, Platform,
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { scale, verticalScale, responsiveFontSize } from '../utils/responsive';
import { billLeft, ceilingFor, draftTotal, drafted, place, round2, slipLeft, walletLeft } from '../utils/allocationMath';

const money = (v) => `₹${Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const day = (v) => (v ? new Date(v).toLocaleDateString('en-IN') : '—');
const DEAD = ['bounced', 'returned', 'rejected', 'cancelled'];

/**
 * A slip or a bill is only worth showing if something can be done with it.
 *
 * 316 of the carried-over receipts are short of their allocations by a few paise
 * - 0.40 here, 0.50 there, from rounding in the old system. Listing them as money
 * waiting to be placed buried the slips that really are waiting, and they cannot
 * be allocated anyway: the server will not take a sub-rupee allocation. A rupee
 * is the floor, for a slip's free money and for a bill's room alike.
 */
const WORTH_PLACING = 1;

/**
 * The wallet: money collected that no bill has taken, and the way to place it.
 *
 * Four cheques of 10,000 read as a wallet of 40,000. Opening it shows those four
 * slips and the bills still waiting, and money moves slip by slip: pick a slip,
 * pick a bill, say how much. A 15,000 bill can be closed with 10,000 from one
 * slip and 5,000 from the next, and the bill carries both as its reference.
 *
 * What has already been submitted is shown here but never editable. Putting a
 * slip against a bill is a promise the salesman has made; it stands until an
 * authorised person collects the money off him, and he can see what he promised
 * the whole time. Undoing it is an admin's job, on the Party Repair bench, where
 * the release is recorded against a name and a reason.
 *
 * Two things follow, and both live in `allocationMath`:
 *
 *   - a slip offers only its FREE money - what has neither settled nor been
 *     promised. The promised part is listed underneath, read-only.
 *   - a bill offers its balance less what other slips have already promised it,
 *     and a bill with nothing left is not listed at all. Otherwise two slips are
 *     each shown the same full balance and the bill gets paid twice.
 */
export default function WalletAllocationSheet({ visible, token, apiUrl, partyId, onClose, onDone }) {
  const [slips, setSlips] = useState([]);
  const [bills, setBills] = useState([]);
  const [draft, setDraft] = useState({});          // { slipId: { billId: amountAsText } }
  const [openSlip, setOpenSlip] = useState(null);
  const [proof, setProof] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!visible || !partyId) return undefined;
    let alive = true;
    setLoading(true);
    setError('');
    setOpenSlip(null);
    setDraft({});

    fetch(`${apiUrl}/finance/party/${partyId}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((data) => {
        if (!alive) return;
        const payments = (data?.data?.payments || []).filter((p) => !DEAD.includes(p.status));

        // One walk answers both questions: what a slip has left, and what a bill
        // has already been promised by somebody.
        const promisedOnBill = new Map();
        const loaded = payments.map((p) => {
          const live = (p.allocations || []).filter((a) => a.status !== 'cancelled');
          const idOf = (a) => String(a.invoiceId?._id || a.invoiceId || '');
          const nameOf = (a) => a.invoiceId?.invoiceNumber || 'a bill';

          const settledOn = live.filter((a) => a.status === 'applied');
          const promisedOn = live.filter((a) => a.status === 'pending' && idOf(a));
          for (const a of promisedOn) {
            promisedOnBill.set(idOf(a), round2((promisedOnBill.get(idOf(a)) || 0) + Number(a.amount || 0)));
          }

          const settled = round2(settledOn.reduce((sum, a) => sum + Number(a.amount || 0), 0));
          const promised = round2(promisedOn.reduce((sum, a) => sum + Number(a.amount || 0), 0));
          return {
            _id: String(p._id),
            number: p.collectionNumber,
            amount: round2(p.amount),
            mode: p.paymentMode,
            date: p.collectionDate,
            proof: p.receiptPhoto,
            promised,
            // Neither settled nor promised: the only part this screen may spend.
            free: round2(Number(p.amount || 0) - settled - promised),
            settledOn: settledOn.map((a) => ({ bill: nameOf(a), amount: round2(a.amount) })),
            promisedOn: promisedOn.map((a) => ({ invoiceId: idOf(a), bill: nameOf(a), amount: round2(a.amount) })),
          };
        });

        // A slip stays on the screen while it has money to place, and also while
        // it is waiting on a promise, so the salesman can see what he committed.
        setSlips(loaded
          .filter((p) => p.free >= WORTH_PLACING || p.promised > 0)
          .sort((a, b) => new Date(a.date) - new Date(b.date)));

        setBills((data?.data?.invoices || [])
          .filter((b) => b.status !== 'cancelled')
          .map((b) => ({
            _id: String(b._id),
            number: b.invoiceNumber,
            due: b.dueDate,
            total: round2(b.originalAmount),
            balance: round2(b.balanceDue),
            promised: promisedOnBill.get(String(b._id)) || 0,
          }))
          // Nothing left to promise means nothing to show: a fully covered bill
          // listed at zero is a row that cannot be used.
          .filter((b) => round2(b.balance - b.promised) >= WORTH_PLACING)
          .sort((a, b) => new Date(a.due) - new Date(b.due)));
      })
      .catch(() => { if (alive) setError('Could not load this party’s money'); })
      .finally(() => { if (alive) setLoading(false); });

    return () => { alive = false; };
  }, [visible, partyId, apiUrl, token]);

  const totals = useMemo(() => ({
    wallet: walletLeft(draft, slips),
    placing: draftTotal(draft, slips),
  }), [draft, slips]);

  const set = (slip, bill, raw) => setDraft((prev) => place(prev, slips, slip, bill, raw));

  const clear = (slip, bill) => setDraft((prev) => {
    const forSlip = { ...prev[slip._id] };
    delete forSlip[bill._id];
    return { ...prev, [slip._id]: forSlip };
  });

  const submit = async () => {
    const calls = slips
      .map((slip) => ({
        slip,
        adding: Object.values(draft[slip._id] || {}).reduce((sum, v) => sum + (parseFloat(v) || 0), 0),
        // The slip's whole promise: what it already owed a bill, plus what is
        // being added now. The endpoint replaces the pending set, so leaving the
        // standing ones out would quietly cancel them.
        allocations: [
          ...slip.promisedOn.map((a) => ({ invoiceId: a.invoiceId, amount: a.amount })),
          ...Object.entries(draft[slip._id] || {})
            .map(([invoiceId, v]) => ({ invoiceId, amount: parseFloat(v) || 0 }))
            .filter((a) => a.amount > 0),
        ],
      }))
      .filter((c) => c.adding > 0);

    if (!calls.length) {
      Alert.alert('Nothing to place', 'Choose a slip, choose a bill, and say how much.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      for (const { slip, allocations } of calls) {
        const response = await fetch(`${apiUrl}/finance/payment/${slip._id}/allocate`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ allocations }),
        });
        const data = await response.json();
        if (!response.ok || !data.success) throw new Error(`${slip.number}: ${data.message || 'could not allocate'}`);
      }
      onDone(totals.placing, totals.wallet);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={s.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={s.sheet}>
          <View style={s.headRow}>
            <Text style={s.title}>Wallet</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <Text style={s.close}>✕</Text>
            </TouchableOpacity>
          </View>

          <View style={s.totals}>
            <View style={s.total}>
              <Text style={s.totalLabel}>In wallet</Text>
              <Text style={s.totalValue}>{money(totals.wallet)}</Text>
            </View>
            <View style={s.total}>
              <Text style={s.totalLabel}>Placing now</Text>
              <Text style={[s.totalValue, totals.placing > 0.01 && s.totalGood]}>{money(totals.placing)}</Text>
            </View>
            <View style={s.total}>
              <Text style={s.totalLabel}>Slips</Text>
              <Text style={s.totalValue}>{slips.length}</Text>
            </View>
          </View>

          {error ? <Text style={s.error}>{error}</Text> : null}

          {loading ? <ActivityIndicator color="#0F766E" style={{ marginVertical: verticalScale(40) }} /> : (
            <ScrollView
              style={s.body}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              showsVerticalScrollIndicator
            >
              <Text style={s.section}>Collections in hand</Text>
              {slips.length === 0 && <Text style={s.empty}>Nothing collected is waiting to be placed.</Text>}

              {slips.map((row) => {
                const left = slipLeft(draft, row);
                const chosen = row._id === openSlip;
                const canPlace = row.free >= WORTH_PLACING;
                return (
                  <View key={row._id} style={[s.slip, chosen && s.slipOpen]}>
                    <TouchableOpacity
                      style={s.slipHead}
                      onPress={() => canPlace && setOpenSlip(chosen ? null : row._id)}
                      disabled={!canPlace}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={s.slipNumber}>{row.number}</Text>
                        <Text style={s.slipMeta}>{day(row.date)} {'·'} {row.mode} {'·'} of {money(row.amount)}</Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={[s.slipLeft, left <= 0.01 && s.slipDone]}>{money(left)}</Text>
                        <Text style={s.slipLeftLabel}>{left <= 0.01 ? 'placed' : 'to place'}</Text>
                      </View>
                    </TouchableOpacity>

                    {/* What this slip has already been put against. Shown so the
                        salesman can see what he promised; an admin releases it if
                        it was wrong. */}
                    {row.promisedOn.map((a) => (
                      <View key={`p${a.invoiceId}`} style={s.against}>
                        <Text style={s.againstBill}>{a.bill}</Text>
                        <Text style={s.againstAmount}>{money(a.amount)}</Text>
                        <Text style={s.awaiting}>awaiting collection</Text>
                      </View>
                    ))}
                    {row.settledOn.map((a, i) => (
                      <View key={`s${i}`} style={s.against}>
                        <Text style={s.againstBill}>{a.bill}</Text>
                        <Text style={s.againstAmount}>{money(a.amount)}</Text>
                        <Text style={s.collected}>collected</Text>
                      </View>
                    ))}

                    <View style={s.slipActions}>
                      {row.proof ? (
                        <TouchableOpacity onPress={() => setProof(row.proof)}>
                          <Text style={s.proofLink}>View proof</Text>
                        </TouchableOpacity>
                      ) : <Text style={s.noProof}>No proof photo</Text>}
                      <Text style={s.tapHint}>
                        {!canPlace ? 'fully placed' : chosen ? 'Choose a bill below' : 'Tap to place this slip'}
                      </Text>
                    </View>

                    {chosen && (
                      <View style={s.bills}>
                        {bills.length === 0 && <Text style={s.empty}>No bill is waiting for money.</Text>}
                        {bills.map((bill) => {
                          const here = drafted(draft, row._id, bill._id);
                          const canTake = billLeft(draft, slips, bill);
                          return (
                            <View key={bill._id} style={[s.bill, here > 0 && s.billActive]}>
                              <View style={s.billHead}>
                                <View style={{ flex: 1 }}>
                                  <Text style={s.billNumber}>{bill.number}</Text>
                                  <Text style={s.billMeta}>
                                    Due {day(bill.due)} {'·'} of {money(bill.total)}
                                    {bill.promised > 0 ? ` · ${money(bill.promised)} already on it` : ''}
                                  </Text>
                                </View>
                                <View style={{ alignItems: 'flex-end' }}>
                                  <Text style={[s.billLeft, canTake <= 0.01 && s.billClear]}>{money(canTake)}</Text>
                                  <Text style={s.billLeftLabel}>{canTake <= 0.01 ? 'covered' : 'still owed'}</Text>
                                </View>
                              </View>
                              <View style={s.billRow}>
                                <TextInput
                                  style={s.input}
                                  keyboardType="numeric"
                                  placeholder="0"
                                  placeholderTextColor="#94A3B8"
                                  value={draft[row._id]?.[bill._id] || ''}
                                  onChangeText={(v) => set(row, bill, v)}
                                />
                                <TouchableOpacity
                                  style={s.fillBtn}
                                  onPress={() => set(row, bill, String(ceilingFor(draft, slips, row, bill)))}
                                >
                                  <Text style={s.fillText}>Max</Text>
                                </TouchableOpacity>
                                {here > 0 && (
                                  <TouchableOpacity style={s.clearBtn} onPress={() => clear(row, bill)}>
                                    <Text style={s.clearText}>Clear</Text>
                                  </TouchableOpacity>
                                )}
                              </View>
                            </View>
                          );
                        })}
                      </View>
                    )}
                  </View>
                );
              })}
            </ScrollView>
          )}

          <View style={s.actions}>
            <TouchableOpacity style={s.secondary} disabled={saving} onPress={onClose}>
              <Text style={s.secondaryText}>Close</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.primary, saving && s.primaryOff]} disabled={saving || loading} onPress={submit}>
              <Text style={s.primaryText}>{saving ? 'Saving…' : `Place ${money(totals.placing)}`}</Text>
            </TouchableOpacity>
          </View>
        </View>

        <Modal visible={Boolean(proof)} transparent animationType="fade" onRequestClose={() => setProof(null)}>
          <TouchableOpacity style={s.proofBack} activeOpacity={1} onPress={() => setProof(null)}>
            <Image source={{ uri: proof }} style={s.proofImage} resizeMode="contain" />
            <Text style={s.proofClose}>Tap anywhere to close</Text>
          </TouchableOpacity>
        </Modal>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.55)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#F7F9FC', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: scale(16), maxHeight: '94%' },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: responsiveFontSize(18), fontWeight: '900', color: '#0F172A' },
  close: { fontSize: responsiveFontSize(18), color: '#64748B', fontWeight: '900' },
  totals: { flexDirection: 'row', gap: scale(8), marginTop: verticalScale(12) },
  total: { flex: 1, backgroundColor: '#fff', borderRadius: 10, padding: scale(10), borderWidth: 1, borderColor: '#E2E8F0' },
  totalLabel: { fontSize: responsiveFontSize(9), color: '#64748B', fontWeight: '800' },
  totalValue: { fontSize: responsiveFontSize(13), color: '#0F172A', fontWeight: '900', marginTop: verticalScale(2) },
  totalGood: { color: '#047857' },
  error: { marginTop: verticalScale(10), padding: scale(10), borderRadius: 8, backgroundColor: '#FEE2E2', color: '#B91C1C', fontWeight: '700' },
  body: { marginTop: verticalScale(12), maxHeight: verticalScale(400) },
  section: { fontSize: responsiveFontSize(11), fontWeight: '900', color: '#0F766E', marginBottom: verticalScale(8) },
  empty: { textAlign: 'center', color: '#64748B', padding: scale(20), fontWeight: '600' },
  slip: { backgroundColor: '#fff', borderRadius: 12, padding: scale(12), marginBottom: verticalScale(10), borderWidth: 1, borderColor: '#E2E8F0' },
  slipOpen: { borderColor: '#0F766E', borderWidth: 2 },
  slipHead: { flexDirection: 'row', alignItems: 'flex-start' },
  slipNumber: { fontSize: responsiveFontSize(13), fontWeight: '900', color: '#0F172A' },
  slipMeta: { fontSize: responsiveFontSize(10), color: '#64748B', marginTop: verticalScale(2) },
  slipLeft: { fontSize: responsiveFontSize(14), fontWeight: '900', color: '#B45309' },
  slipDone: { color: '#047857' },
  slipLeftLabel: { fontSize: responsiveFontSize(9), color: '#94A3B8', fontWeight: '700' },
  against: { flexDirection: 'row', alignItems: 'center', gap: scale(8), marginTop: verticalScale(6), paddingLeft: scale(8), borderLeftWidth: 3, borderLeftColor: '#CBD5E1' },
  againstBill: { flex: 1, fontSize: responsiveFontSize(10), fontWeight: '800', color: '#334155' },
  againstAmount: { fontSize: responsiveFontSize(10), fontWeight: '900', color: '#334155' },
  awaiting: { fontSize: responsiveFontSize(8), color: '#B45309', fontWeight: '800', width: scale(78), textAlign: 'right' },
  collected: { fontSize: responsiveFontSize(8), color: '#047857', fontWeight: '800', width: scale(78), textAlign: 'right' },
  slipActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: verticalScale(8) },
  proofLink: { fontSize: responsiveFontSize(10), color: '#0F766E', fontWeight: '900' },
  noProof: { fontSize: responsiveFontSize(10), color: '#94A3B8', fontWeight: '700' },
  tapHint: { fontSize: responsiveFontSize(9), color: '#94A3B8', fontWeight: '700' },
  bills: { marginTop: verticalScale(10), borderTopWidth: 1, borderTopColor: '#E2E8F0', paddingTop: verticalScale(10) },
  bill: { backgroundColor: '#F8FAFC', borderRadius: 10, padding: scale(10), marginBottom: verticalScale(8), borderWidth: 1, borderColor: '#E2E8F0' },
  billActive: { borderColor: '#0F766E', backgroundColor: '#F0FDFA' },
  billHead: { flexDirection: 'row', alignItems: 'flex-start' },
  billNumber: { fontSize: responsiveFontSize(12), fontWeight: '900', color: '#0F172A' },
  billMeta: { fontSize: responsiveFontSize(9), color: '#64748B', marginTop: verticalScale(1) },
  billLeft: { fontSize: responsiveFontSize(12), fontWeight: '900', color: '#B91C1C' },
  billClear: { color: '#047857' },
  billLeftLabel: { fontSize: responsiveFontSize(8), color: '#94A3B8', fontWeight: '700' },
  billRow: { flexDirection: 'row', alignItems: 'center', gap: scale(6), marginTop: verticalScale(8) },
  input: { width: scale(88), borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 8, padding: scale(8), color: '#0F172A', fontWeight: '800', backgroundColor: '#fff' },
  fillBtn: { paddingHorizontal: scale(10), paddingVertical: verticalScale(8), borderRadius: 8, backgroundColor: '#CCFBF1' },
  fillText: { color: '#0F766E', fontWeight: '900', fontSize: responsiveFontSize(10) },
  clearBtn: { paddingHorizontal: scale(10), paddingVertical: verticalScale(8), borderRadius: 8, backgroundColor: '#FEE2E2' },
  clearText: { color: '#B91C1C', fontWeight: '900', fontSize: responsiveFontSize(10) },
  actions: { flexDirection: 'row', gap: scale(10), marginTop: verticalScale(14) },
  secondary: { flex: 1, padding: scale(14), borderRadius: 12, backgroundColor: '#E2E8F0', alignItems: 'center' },
  secondaryText: { fontWeight: '900', color: '#475569' },
  primary: { flex: 2, padding: scale(14), borderRadius: 12, backgroundColor: '#0F766E', alignItems: 'center' },
  primaryOff: { opacity: 0.6 },
  primaryText: { fontWeight: '900', color: '#fff' },
  proofBack: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', alignItems: 'center', justifyContent: 'center' },
  proofImage: { width: '92%', height: '78%' },
  proofClose: { color: '#fff', marginTop: verticalScale(14), fontWeight: '700' },
});
