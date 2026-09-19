import React, { useEffect, useState } from 'react';
import {
  StyleSheet, Text, View, TouchableOpacity, ActivityIndicator,
  SafeAreaView, ScrollView, RefreshControl,
} from 'react-native';
import { scale, verticalScale, responsiveFontSize } from '../utils/responsive';

const money = (value) => `₹${Number(value || 0).toLocaleString('en-IN')}`;

const STATUS_TABS = [
  { key: '', label: 'All' },
  { key: 'draft', label: 'Draft' },
  { key: 'approved', label: 'Approved' },
  { key: 'partially_received', label: 'Partial' },
  { key: 'received', label: 'Delivered' },
  { key: 'cancelled', label: 'Cancelled' },
];

const STATUS_COLOURS = {
  draft: '#A0AEC0',
  pending_approval: '#DD6B20',
  approved: '#3182CE',
  partially_received: '#D69E2E',
  received: '#2F855A',
  completed: '#2F855A',
  cancelled: '#E53E3E',
};

/** Purchase orders, filtered by how far each has gone. */
export default function PurchaseOrderListScreen({ token, apiUrl, onBack }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [status, setStatus] = useState('');

  const load = async (statusValue) => {
    try {
      const qs = statusValue ? `?status=${statusValue}&limit=100` : '?limit=100';
      const res = await fetch(`${apiUrl}/procurement/purchase-orders${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok && data.success) setOrders(data.data || []);
    } catch (e) {
      console.warn('Failed to load purchase orders:', e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { setLoading(true); load(status); }, [status, token, apiUrl]);

  const onRefresh = () => { setRefreshing(true); load(status); };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.topHeader}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Text style={styles.backBtnText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.topHeaderTitle}>Purchase Orders</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabsRow} contentContainerStyle={{ paddingHorizontal: scale(12) }}>
        {STATUS_TABS.map((tab) => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tabChip, status === tab.key && styles.tabChipOn]}
            onPress={() => setStatus(tab.key)}
          >
            <Text style={[styles.tabChipText, status === tab.key && styles.tabChipTextOn]}>{tab.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {loading ? (
        <View style={styles.centered}><ActivityIndicator size="large" color="#00796B" /></View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#00796B']} />}
        >
          {orders.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyIcon}>🧾</Text>
              <Text style={styles.emptyTitle}>Nothing here</Text>
              <Text style={styles.emptyDesc}>No purchase orders in this status.</Text>
            </View>
          ) : (
            <View style={styles.listContainer}>
              {orders.map((po) => (
                <View key={po._id} style={styles.card}>
                  <View style={styles.cardHeader}>
                    <Text style={styles.poNumber}>{po.poNumber}</Text>
                    <Text style={[styles.statusPill, { backgroundColor: `${STATUS_COLOURS[po.status] || '#A0AEC0'}22`, color: STATUS_COLOURS[po.status] || '#718096' }]}>
                      {String(po.status || '').replace(/_/g, ' ')}
                    </Text>
                  </View>
                  <Text style={styles.vendorName}>{po.vendor?.name || '—'}</Text>
                  <View style={styles.divider} />
                  <View style={styles.detailsRow}>
                    <View style={styles.detailBlock}>
                      <Text style={styles.detailLabel}>Date</Text>
                      <Text style={styles.detailVal}>{po.orderDate ? new Date(po.orderDate).toLocaleDateString() : '—'}</Text>
                    </View>
                    <View style={styles.detailBlock}>
                      <Text style={styles.detailLabel}>Total</Text>
                      <Text style={styles.detailVal}>{money(po.totalAmount)}</Text>
                    </View>
                    <View style={styles.detailBlock}>
                      <Text style={styles.detailLabel}>Items</Text>
                      <Text style={styles.detailVal}>{(po.items || po.lineItems || []).length}</Text>
                    </View>
                  </View>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F7F9FC' },
  topHeader: {
    height: verticalScale(56), backgroundColor: '#FFFFFF', alignItems: 'center',
    justifyContent: 'space-between', paddingHorizontal: scale(16), flexDirection: 'row',
    borderBottomWidth: 1, borderBottomColor: '#E2E8F0',
  },
  backBtn: { width: scale(36), height: verticalScale(36), borderRadius: 18, backgroundColor: '#F7F9FC', alignItems: 'center', justifyContent: 'center' },
  backBtnText: { fontSize: responsiveFontSize(20), color: '#2D3748', fontWeight: '600' },
  topHeaderTitle: { fontSize: responsiveFontSize(16.5), fontWeight: '800', color: '#1A202C' },

  tabsRow: { backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: '#E2E8F0', paddingVertical: verticalScale(10) },
  tabChip: { paddingHorizontal: scale(14), paddingVertical: verticalScale(7), borderRadius: 20, borderWidth: 1, borderColor: '#E2E8F0', marginRight: scale(8) },
  tabChipOn: { backgroundColor: '#00796B', borderColor: '#00796B' },
  tabChipText: { color: '#4A5568', fontWeight: '650', fontSize: responsiveFontSize(12) },
  tabChipTextOn: { color: '#FFFFFF' },

  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scrollContent: { padding: scale(16), paddingBottom: verticalScale(40) },
  emptyContainer: { alignItems: 'center', justifyContent: 'center', paddingVertical: verticalScale(80) },
  emptyIcon: { fontSize: responsiveFontSize(48), marginBottom: verticalScale(16), opacity: 0.7 },
  emptyTitle: { fontSize: responsiveFontSize(18), fontWeight: '700', color: '#2D3748', marginBottom: verticalScale(6) },
  emptyDesc: { fontSize: responsiveFontSize(13), color: '#718096' },

  listContainer: { gap: verticalScale(12) },
  card: { backgroundColor: '#FFFFFF', borderRadius: 14, borderWidth: 1, borderColor: '#E2E8F0', padding: scale(16) },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  poNumber: { fontSize: responsiveFontSize(13.5), fontWeight: '800', color: '#2D3748' },
  statusPill: { fontSize: responsiveFontSize(10), fontWeight: '750', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, textTransform: 'capitalize' },
  vendorName: { fontSize: responsiveFontSize(12.5), color: '#718096', marginTop: 4 },
  divider: { height: 1, backgroundColor: '#EDF2F7', marginVertical: verticalScale(12) },
  detailsRow: { flexDirection: 'row', justifyContent: 'space-between' },
  detailBlock: { flex: 1 },
  detailLabel: { fontSize: responsiveFontSize(9.5), color: '#A0AEC0', fontWeight: '700', textTransform: 'uppercase', marginBottom: 3 },
  detailVal: { fontSize: responsiveFontSize(12.5), fontWeight: '750', color: '#4A5568' },
});
