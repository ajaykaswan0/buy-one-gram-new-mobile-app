import React, { useState } from 'react';
import { useLanguage } from '../i18n';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  Modal,
  Image,
  ActivityIndicator,
  ScrollView,
} from 'react-native';

const money = (value) =>
  `₹${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const shortDate = (value) => {
  if (!value) return '';
  const d = new Date(value);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};

const SOURCE_LABEL = {
  post_delivery: 'Raised after delivery',
  sales_return: 'From a pickup return',
  manual: 'Raised by hand',
};

const PAYMENT_STATE = {
  paid: { label: 'PAID', color: '#2F855A' },
  partial: { label: 'PARTLY PAID', color: '#B7791F' },
  unpaid: { label: 'UNPAID', color: '#C53030' },
  cod: { label: 'COD', color: '#B7791F' },
  prepaid: { label: 'PREPAID', color: '#2F855A' },
  not_invoiced: { label: 'NOT BILLED', color: '#718096' },
};

/**
 * The money and proof half of an order card.
 *
 * The salesman standing in the shop gets asked "how much is still due on this
 * bill, and can you prove I paid?" — the card used to answer neither, showing
 * only a total. This is the same set the admin panel shows, in one component so
 * the party profile and the order list cannot drift apart.
 *
 * Everything is optional: an order with no invoice, no payment, no credit note
 * and no delivery renders only what it has.
 */
export default function OrderPaymentDetails({ order, apiUrl, token }) {
  const { t, term } = useLanguage();
  const [proof, setProof] = useState(null); // { title, path }
  const [proofUri, setProofUri] = useState('');
  const [proofLoading, setProofLoading] = useState(false);
  const [proofError, setProofError] = useState('');
  const [openNote, setOpenNote] = useState(null);

  const payments = order.payments || [];
  const creditNotes = order.creditNotes || [];
  const delivery = order.delivery;
  const state = PAYMENT_STATE[order.paymentState] || PAYMENT_STATE.not_invoiced;

  const total = Number(order.netPayableAmount ?? order.grandTotal ?? order.totalAmount ?? 0);
  const allocated = Number(order.allocatedAmount || 0);
  const credited = Number(order.creditNoteTotal ?? order.creditedAmount ?? 0);
  const due = Number(order.balanceDue || 0);

  /**
   * Whether the server actually sent any of this.
   *
   * An older API returns none of these fields, and defaulting them to zero
   * printed "NOT BILLED · allocated ₹0 · still due ₹0" on an order the card
   * itself was labelling PAID. Saying nothing is far better than saying
   * something false about someone's money.
   */
  const hasPaymentData = 'paymentState' in order || Array.isArray(order.payments);
  const pendingSettlement = payments
    .filter((payment) => payment.allocationStatus === 'pending')
    .reduce((sum, payment) => sum + Number(payment.allocatedAmount || 0), 0);

  /**
   * Opens a stored file.
   *
   * A stored path is not a URL — it needs signing before it can be shown, which
   * is why photos rendered as broken images before. A data URI is already the
   * image and is passed straight through.
   */
  const openProof = async (title, path) => {
    if (!path) return;
    setProof({ title, path });
    setProofError('');
    setProofUri('');

    if (path.startsWith('data:') || path.startsWith('http')) {
      setProofUri(path);
      return;
    }

    setProofLoading(true);
    try {
      const response = await fetch(`${apiUrl}/uploads/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ storagePath: path }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Could not open the file.');
      // The endpoint returns a short-lived signed link as `viewUrl`.
      const signed = data.data?.viewUrl || data.viewUrl || '';
      if (!signed) throw new Error('The file could not be located.');
      setProofUri(signed);
    } catch (e) {
      setProofError(e.message);
    } finally {
      setProofLoading(false);
    }
  };

  return (
    <View style={styles.wrap}>
      {/* Money */}
      <View style={styles.moneyHead}>
        <Text style={styles.sectionTitle}>Payment</Text>
        {hasPaymentData ? (
          <View style={[styles.stateChip, { backgroundColor: `${state.color}1A` }]}>
            <Text style={[styles.stateChipText, { color: state.color }]}>{state.label}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.moneyRow}>
        <Text style={styles.moneyLabel}>{t('Bill total')}</Text>
        <Text style={styles.moneyValue}>{money(total)}</Text>
      </View>
      {hasPaymentData && (
        <View style={styles.moneyRow}>
          <Text style={styles.moneyLabel}>{t('Allocated / paid')}</Text>
          <Text style={[styles.moneyValue, { color: '#2F855A' }]}>{money(allocated || order.paidAmount)}</Text>
        </View>
      )}
      {credited > 0 && (
        <View style={styles.moneyRow}>
          <Text style={styles.moneyLabel}>{t('Credit notes')}</Text>
          <Text style={[styles.moneyValue, { color: '#B7791F' }]}>− {money(credited)}</Text>
        </View>
      )}
      {hasPaymentData ? (
        <View style={[styles.moneyRow, styles.moneyRowFinal]}>
          <Text style={styles.moneyLabelFinal}>{t('Still due')}</Text>
          <Text style={[styles.moneyValueFinal, { color: due > 0 ? '#C53030' : '#2F855A' }]}>{money(due)}</Text>
        </View>
      ) : (
        <Text style={styles.staleServerNote}>
          Payment history, credit notes and the delivered-bill photo are not available from this server yet.
        </Text>
      )}

      {/* Payments taken, each with its receipt */}
      {payments.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Transaction history ({payments.length})</Text>
          {payments.map((payment) => (
            <View key={payment._id} style={styles.paymentRow}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.paymentTitle}>
                  {payment.collectionNumber || 'Payment'} · {term(payment.paymentMode)}
                </Text>
                <Text style={styles.paymentSub}>
                  {money(payment.allocatedAmount)}
                  {/* A split payment landed only partly here — say so, or the
                      number looks wrong against the receipt. */}
                  {Number(payment.totalAmount) !== Number(payment.allocatedAmount)
                    ? ` of ${money(payment.totalAmount)} paid`
                    : ''}
                  {payment.allocationStatus === 'pending' ? ` · ${t('not settled yet')}` : ''}
                  {payment.createdAt ? ` · ${shortDate(payment.createdAt)}` : ''}
                </Text>
              </View>
              {payment.receiptPhoto ? (
                <TouchableOpacity
                  style={styles.proofBtn}
                  onPress={() => openProof(`Receipt · ${payment.collectionNumber || ''}`, payment.receiptPhoto)}
                >
                  <Text style={styles.proofBtnText}>{t('View proof')}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ))}
          {pendingSettlement > 0 && (
            <Text style={styles.pendingNote}>
              {money(pendingSettlement)} is allocated to this bill but not settled yet — the balance drops once finance collects it.
            </Text>
          )}
        </>
      )}

      {/* Credit notes raised against this order */}
      {creditNotes.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Credit notes ({creditNotes.length})</Text>
          {creditNotes.map((note) => (
            <TouchableOpacity
              key={note._id || note.creditNoteNumber}
              style={styles.noteRow}
              activeOpacity={0.7}
              onPress={() => setOpenNote(note)}
            >
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.paymentTitle}>{note.creditNoteNumber}</Text>
                <Text style={styles.paymentSub} numberOfLines={2}>
                  {term(note.source)}
                  {note.reason ? ` · ${note.reason}` : ''}
                  {note.issuedAt ? ` · ${shortDate(note.issuedAt)}` : ''}
                </Text>
                <Text style={styles.noteOpenHint}>
                  {(note.items || []).length
                    ? `Tap to see the ${(note.items || []).length} item(s) credited ›`
                    : 'Tap for details ›'}
                </Text>
              </View>
              <Text style={styles.noteAmount}>− {money(note.orderShare ?? note.amount)}</Text>
            </TouchableOpacity>
          ))}
        </>
      )}

      {/* The driver's delivery record */}
      {delivery ? (
        <>
          <Text style={styles.sectionTitle}>{t('Delivery')}</Text>
          <View style={styles.paymentRow}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.paymentTitle}>
                {delivery.deliveryNumber || 'Delivered bill'}
                {delivery.status ? ` · ${term(delivery.status)}` : ''}
              </Text>
              <Text style={styles.paymentSub}>
                {delivery.driverName || 'Driver not named'}
                {delivery.vehicleNumber ? ` · ${delivery.vehicleNumber}` : ''}
                {delivery.deliveredAt ? ` · ${shortDate(delivery.deliveredAt)}` : ''}
              </Text>
            </View>
            <View style={{ gap: 6 }}>
              {delivery.deliveryPhoto ? (
                <TouchableOpacity style={styles.proofBtn} onPress={() => openProof('Delivery photo', delivery.deliveryPhoto)}>
                  <Text style={styles.proofBtnText}>{t('Driver bill')}</Text>
                </TouchableOpacity>
              ) : null}
              {delivery.signature ? (
                <TouchableOpacity style={styles.proofBtn} onPress={() => openProof('Signature', delivery.signature)}>
                  <Text style={styles.proofBtnText}>{t('Signature')}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        </>
      ) : null}

      {/* What a credit note is actually made of */}
      <Modal visible={!!openNote} transparent animationType="slide" onRequestClose={() => setOpenNote(null)}>
        <View style={styles.noteScrim}>
          <View style={styles.noteCard}>
            <View style={styles.noteHead}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.noteTitle}>{openNote?.creditNoteNumber}</Text>
                <Text style={styles.noteSubtitle}>
                  {SOURCE_LABEL[openNote?.source] || openNote?.source || 'Credit note'}
                  {openNote?.issuedAt ? ` · ${shortDate(openNote.issuedAt)}` : ''}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setOpenNote(null)}>
                <Text style={styles.proofClose}>✕</Text>
              </TouchableOpacity>
            </View>

            {!!openNote?.reason && (
              <View style={styles.noteReasonBox}>
                <Text style={styles.noteReasonLabel}>Reason</Text>
                <Text style={styles.noteReasonText}>{openNote.reason}</Text>
              </View>
            )}

            <ScrollView style={{ maxHeight: 320 }} contentContainerStyle={{ paddingBottom: 4 }}>
              {(openNote?.items || []).length === 0 ? (
                <Text style={styles.proofMuted}>
                  This credit note has no product lines — it was raised as a flat amount.
                </Text>
              ) : (
                (openNote.items || []).map((item, index) => (
                  <View key={`${item.productId || index}-${index}`} style={styles.noteItemRow}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.noteItemName}>{item.productName || 'Product'}</Text>
                      <Text style={styles.noteItemMeta}>
                        {[item.variantName, item.sku].filter(Boolean).join(' · ') || '—'}
                      </Text>
                      {!!item.reason && <Text style={styles.noteItemReason}>{item.reason}</Text>}
                      {/* Whether the goods came back into stock or were written
                          off is the difference between a return and a loss. */}
                      <Text style={[
                        styles.noteItemGoods,
                        item.disposition === 'restock' && styles.noteItemGoodsOk,
                        item.disposition === 'waste' && styles.noteItemGoodsBad,
                      ]}>
                        {item.disposition === 'restock' ? 'Returned to stock'
                          : item.disposition === 'waste' ? 'Written off'
                          : 'Not decided yet'}
                      </Text>
                    </View>
                    <View style={styles.noteItemNumbers}>
                      <Text style={styles.noteItemQty}>{item.quantity} × {money(item.rate)}</Text>
                      <Text style={styles.noteItemAmount}>{money(item.amount)}</Text>
                    </View>
                  </View>
                ))
              )}
            </ScrollView>

            <View style={styles.noteTotalRow}>
              <Text style={styles.noteTotalLabel}>
                Credited against this order
                {openNote && Number(openNote.orderShare ?? openNote.amount) !== Number(openNote.amount)
                  ? ` (of ${money(openNote.amount)} in total)`
                  : ''}
              </Text>
              <Text style={styles.noteTotalValue}>− {money(openNote?.orderShare ?? openNote?.amount)}</Text>
            </View>
          </View>
        </View>
      </Modal>

      {/* Proof viewer */}
      <Modal visible={!!proof} transparent animationType="fade" onRequestClose={() => setProof(null)}>
        <View style={styles.proofScrim}>
          <View style={styles.proofCard}>
            <View style={styles.proofHead}>
              <Text style={styles.proofTitle} numberOfLines={1}>{proof?.title || 'Proof'}</Text>
              <TouchableOpacity onPress={() => setProof(null)}>
                <Text style={styles.proofClose}>✕</Text>
              </TouchableOpacity>
            </View>

            {proofLoading ? (
              <View style={styles.proofCentre}>
                <ActivityIndicator color="#00796B" />
                <Text style={styles.proofMuted}>Opening…</Text>
              </View>
            ) : proofError ? (
              <Text style={styles.proofErrorText}>{proofError}</Text>
            ) : proofUri ? (
              <Image source={{ uri: proofUri }} style={styles.proofImage} resizeMode="contain" />
            ) : (
              <Text style={styles.proofMuted}>Nothing to show.</Text>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 10, gap: 2 },
  sectionTitle: {
    fontSize: 12, fontWeight: '800', color: '#2D3748',
    marginTop: 12, marginBottom: 6,
  },
  moneyHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stateChip: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999 },
  stateChipText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.4 },

  moneyRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  moneyLabel: { fontSize: 12, color: '#4A5568' },
  moneyValue: { fontSize: 12.5, fontWeight: '700', color: '#1A202C' },
  moneyRowFinal: {
    marginTop: 4, paddingTop: 8,
    borderTopWidth: 1, borderTopColor: '#E2E8F0',
  },
  moneyLabelFinal: { fontSize: 13, fontWeight: '800', color: '#1A202C' },
  moneyValueFinal: { fontSize: 14, fontWeight: '800' },

  paymentRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: '#F1F5F9',
  },
  noteRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: '#F1F5F9',
  },
  paymentTitle: { fontSize: 12.5, fontWeight: '700', color: '#1A202C' },
  paymentSub: { fontSize: 11, color: '#718096', marginTop: 2 },
  noteAmount: { fontSize: 13, fontWeight: '800', color: '#B7791F' },

  staleServerNote: {
    marginTop: 8, fontSize: 11, color: '#A0AEC0', lineHeight: 15, fontStyle: 'italic',
  },
  pendingNote: {
    marginTop: 8, fontSize: 11, color: '#B7791F', lineHeight: 15,
  },
  noteOpenHint: { fontSize: 10.5, color: '#00796B', fontWeight: '700', marginTop: 4 },

  noteScrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  noteCard: {
    backgroundColor: '#FFFFFF', borderTopLeftRadius: 18, borderTopRightRadius: 18,
    padding: 20, maxHeight: '88%',
  },
  noteHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 12 },
  noteTitle: { fontSize: 16, fontWeight: '800', color: '#1A202C' },
  noteSubtitle: { fontSize: 11.5, color: '#718096', marginTop: 2 },
  noteReasonBox: {
    padding: 12, borderRadius: 10, backgroundColor: '#FFFAF0', marginBottom: 12,
  },
  noteReasonLabel: { fontSize: 10, fontWeight: '800', color: '#B7791F', letterSpacing: 0.4 },
  noteReasonText: { fontSize: 12.5, color: '#4A5568', marginTop: 3, lineHeight: 17 },

  noteItemRow: {
    flexDirection: 'row', gap: 12, paddingVertical: 11,
    borderBottomWidth: 1, borderBottomColor: '#F1F5F9',
  },
  noteItemName: { fontSize: 13, fontWeight: '700', color: '#1A202C' },
  noteItemMeta: { fontSize: 11, color: '#718096', marginTop: 2 },
  noteItemReason: { fontSize: 11, color: '#C05621', marginTop: 3 },
  noteItemGoods: { fontSize: 10.5, fontWeight: '800', color: '#A0AEC0', marginTop: 4 },
  noteItemGoodsOk: { color: '#2F855A' },
  noteItemGoodsBad: { color: '#C53030' },
  noteItemNumbers: { alignItems: 'flex-end' },
  noteItemQty: { fontSize: 11, color: '#718096' },
  noteItemAmount: { fontSize: 13, fontWeight: '800', color: '#1A202C', marginTop: 3 },

  noteTotalRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: 12, marginTop: 14, paddingTop: 12,
    borderTopWidth: 1, borderTopColor: '#E2E8F0',
  },
  noteTotalLabel: { flex: 1, fontSize: 12, color: '#4A5568' },
  noteTotalValue: { fontSize: 16, fontWeight: '800', color: '#B7791F' },

  proofBtn: {
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 8, backgroundColor: '#E6F6EF',
  },
  proofBtnText: { fontSize: 11, fontWeight: '800', color: '#00695C' },

  proofScrim: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.82)',
    alignItems: 'center', justifyContent: 'center', padding: 18,
  },
  proofCard: { width: '100%', backgroundColor: '#FFFFFF', borderRadius: 14, padding: 14 },
  proofHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  proofTitle: { flex: 1, fontSize: 14, fontWeight: '800', color: '#1A202C' },
  proofClose: { fontSize: 18, color: '#718096', paddingHorizontal: 6 },
  proofImage: { width: '100%', height: 380, borderRadius: 8, backgroundColor: '#F7FAFC' },
  proofCentre: { alignItems: 'center', gap: 8, paddingVertical: 30 },
  proofMuted: { color: '#718096', fontSize: 12, textAlign: 'center', paddingVertical: 12 },
  proofErrorText: { color: '#C53030', fontSize: 12, paddingVertical: 12 },
});
