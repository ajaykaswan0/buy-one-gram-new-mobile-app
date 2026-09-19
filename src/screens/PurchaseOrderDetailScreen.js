import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, ActivityIndicator, SafeAreaView, ScrollView } from 'react-native';
import { scale, verticalScale, responsiveFontSize } from '../utils/responsive';

const money = (value) => `₹${Number(value || 0).toLocaleString('en-IN')}`;

const STATUS_COLOURS = {
  draft: '#A0AEC0', pending_approval: '#DD6B20', approved: '#3182CE',
  partially_received: '#D69E2E', received: '#2F855A', completed: '#2F855A', cancelled: '#E53E3E',
};

/** One purchase order, in full — every line, its rate, and what has come in against it. */
export default function PurchaseOrderDetailScreen({ token, apiUrl, poId, onBack }) {
  const [po, setPo] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${apiUrl}/procurement/purchase-orders/${poId}`, { headers: { Authorization: `Bearer ${token}` } });
        const data = await res.json();
        if (res.ok && data.success) setPo(data.data);
      } catch (e) {
        console.warn('Failed to load purchase order:', e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [poId, token, apiUrl]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.topHeader}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}><Text style={styles.backBtnText}>←</Text></TouchableOpacity>
        <Text style={styles.topHeaderTitle} numberOfLines={1}>{po?.poNumber || 'Purchase Order'}</Text>
        <View style={{ width: 36 }} />
      </View>

      {loading ? (
        <View style={styles.centered}><ActivityIndicator size="large" color="#00796B" /></View>
      ) : !po ? (
        <View style={styles.centered}><Text style={styles.emptyDesc}>Purchase order not found.</Text></View>
      ) : (
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.poNumber}>{po.poNumber}</Text>
              <Text style={[styles.statusPill, { backgroundColor: `${STATUS_COLOURS[po.status] || '#A0AEC0'}22`, color: STATUS_COLOURS[po.status] || '#718096' }]}>
                {String(po.status || '').replace(/_/g, ' ')}
              </Text>
            </View>
            <Text style={styles.vendorName}>{po.vendor?.name || '—'}</Text>
            <View style={styles.infoGrid}>
              <View style={styles.infoBlock}><Text style={styles.infoLabel}>Order Date</Text><Text style={styles.infoVal}>{po.orderDate ? new Date(po.orderDate).toLocaleDateString() : '—'}</Text></View>
              <View style={styles.infoBlock}><Text style={styles.infoLabel}>Expected</Text><Text style={styles.infoVal}>{po.expectedDeliveryDate ? new Date(po.expectedDeliveryDate).toLocaleDateString() : '—'}</Text></View>
              <View style={styles.infoBlock}><Text style={styles.infoLabel}>Warehouse</Text><Text style={styles.infoVal}>{po.warehouse?.name || po.warehouse?.warehouseName || '—'}</Text></View>
              <View style={styles.infoBlock}><Text style={styles.infoLabel}>Total</Text><Text style={styles.infoVal}>{money(po.totalAmount)}</Text></View>
            </View>
          </View>

          <Text style={styles.sectionTitle}>Items</Text>
          {(po.items || po.lineItems || []).map((item, index) => (
            <View key={item._id || index} style={styles.itemCard}>
              <View style={{ flex: 1 }}>
                <Text style={styles.itemName}>{item.productName || item.product?.productName || 'Item'}</Text>
                <Text style={styles.itemMeta}>{item.orderedQuantity} {item.unit} · {money(item.rate)}/{item.unit}</Text>
                {item.receivedQuantity > 0 && (
                  <Text style={styles.itemReceived}>Received: {item.receivedQuantity} of {item.orderedQuantity}</Text>
                )}
              </View>
              <Text style={styles.itemTotal}>{money(item.totalAmount || item.amount)}</Text>
            </View>
          ))}

          {(po.receipts || []).length > 0 && (
            <>
              <Text style={styles.sectionTitle}>Deliveries received</Text>
              {po.receipts.map((grn) => (
                <View key={grn._id} style={styles.itemCard}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemName}>{grn.grnNumber}</Text>
                    <Text style={styles.itemMeta}>{grn.receiptDate ? new Date(grn.receiptDate).toLocaleDateString() : ''}</Text>
                  </View>
                  <Text style={styles.itemTotal}>{money(grn.totalAmount)}</Text>
                </View>
              ))}
            </>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F7F9FC' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyDesc: { fontSize: responsiveFontSize(13), color: '#718096' },
  topHeader: {
    height: verticalScale(56), backgroundColor: '#FFFFFF', alignItems: 'center',
    justifyContent: 'space-between', paddingHorizontal: scale(16), flexDirection: 'row',
    borderBottomWidth: 1, borderBottomColor: '#E2E8F0',
  },
  backBtn: { width: scale(36), height: verticalScale(36), borderRadius: 18, backgroundColor: '#F7F9FC', alignItems: 'center', justifyContent: 'center' },
  backBtnText: { fontSize: responsiveFontSize(20), color: '#2D3748', fontWeight: '600' },
  topHeaderTitle: { fontSize: responsiveFontSize(16.5), fontWeight: '800', color: '#1A202C', flex: 1, textAlign: 'center', marginHorizontal: 8 },

  scrollContent: { padding: scale(16), paddingBottom: verticalScale(40) },
  card: { backgroundColor: '#FFFFFF', borderRadius: 14, borderWidth: 1, borderColor: '#E2E8F0', padding: scale(16) },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  poNumber: { fontSize: responsiveFontSize(14), fontWeight: '800', color: '#2D3748' },
  statusPill: { fontSize: responsiveFontSize(10), fontWeight: '750', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, textTransform: 'capitalize' },
  vendorName: { fontSize: responsiveFontSize(12.5), color: '#718096', marginTop: 4, marginBottom: verticalScale(12) },
  infoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: verticalScale(12) },
  infoBlock: { width: '46%' },
  infoLabel: { fontSize: responsiveFontSize(9.5), color: '#A0AEC0', fontWeight: '700', textTransform: 'uppercase', marginBottom: 3 },
  infoVal: { fontSize: responsiveFontSize(13), fontWeight: '650', color: '#4A5568' },

  sectionTitle: { fontSize: responsiveFontSize(13), fontWeight: '800', color: '#2D3748', marginTop: verticalScale(20), marginBottom: verticalScale(10) },
  itemCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 10, borderWidth: 1, borderColor: '#E2E8F0', padding: scale(12), marginBottom: verticalScale(8) },
  itemName: { fontSize: responsiveFontSize(13), fontWeight: '750', color: '#2D3748' },
  itemMeta: { fontSize: responsiveFontSize(11), color: '#718096', marginTop: 2 },
  itemReceived: { fontSize: responsiveFontSize(10.5), color: '#2F855A', marginTop: 2 },
  itemTotal: { fontSize: responsiveFontSize(13), fontWeight: '750', color: '#4A5568' },
});
