import React, { useEffect, useState } from 'react';
import {
  StyleSheet, Text, View, TouchableOpacity, ActivityIndicator,
  SafeAreaView, ScrollView, RefreshControl,
} from 'react-native';
import { scale, verticalScale, responsiveFontSize } from '../utils/responsive';

const money = (value) => `₹${Number(value || 0).toLocaleString('en-IN')}`;

const TABS = [
  { key: 'raw', label: 'Raw Material' },
  { key: 'product', label: 'Product Stock' },
  { key: 'rates', label: 'Vendor Rates' },
];

/** What's on hand, and what it currently costs to buy. */
export default function PurchaseStockScreen({ token, apiUrl, onBack }) {
  const [tab, setTab] = useState('raw');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async (which) => {
    try {
      const headers = { Authorization: `Bearer ${token}` };
      let url = `${apiUrl}/stock?stockType=raw_material&limit=100`;
      if (which === 'product') url = `${apiUrl}/stock?limit=100`;
      if (which === 'rates') url = `${apiUrl}/procurement/vendor-rates?isCurrent=true&limit=100`;

      const res = await fetch(url, { headers });
      const data = await res.json();
      if (res.ok && data.success) setRows(data.data || []);
      else setRows([]);
    } catch (e) {
      console.warn('Failed to load stock/rates:', e.message);
      setRows([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { setLoading(true); load(tab); }, [tab, token, apiUrl]);

  const onRefresh = () => { setRefreshing(true); load(tab); };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.topHeader}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Text style={styles.backBtnText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.topHeaderTitle}>Stock & Rates</Text>
        <View style={{ width: 36 }} />
      </View>

      <View style={styles.tabsRow}>
        {TABS.map((t) => (
          <TouchableOpacity key={t.key} style={[styles.tabBtn, tab === t.key && styles.tabBtnOn]} onPress={() => setTab(t.key)}>
            <Text style={[styles.tabBtnText, tab === t.key && styles.tabBtnTextOn]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <View style={styles.centered}><ActivityIndicator size="large" color="#00796B" /></View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#00796B']} />}
        >
          {rows.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyIcon}>📦</Text>
              <Text style={styles.emptyDesc}>Nothing to show here yet.</Text>
            </View>
          ) : tab === 'rates' ? (
            <View style={styles.listContainer}>
              {rows.map((rate) => (
                <View key={rate._id} style={styles.card}>
                  <View style={styles.cardHeader}>
                    <Text style={styles.productName}>{rate.product?.productName || 'Product'}</Text>
                    <Text style={styles.rateVal}>{money(rate.rate)} / {rate.unit}</Text>
                  </View>
                  <Text style={styles.vendorName}>{rate.vendor?.name || '—'}</Text>
                  <Text style={styles.dateNote}>as of {rate.effectiveFrom ? new Date(rate.effectiveFrom).toLocaleDateString() : '—'}</Text>
                </View>
              ))}
            </View>
          ) : (
            <View style={styles.listContainer}>
              {rows.map((row) => (
                <View key={row._id} style={styles.card}>
                  <View style={styles.cardHeader}>
                    <Text style={styles.productName}>{row.productId?.productName || 'Product'}{row.variantName ? ` — ${row.variantName}` : ''}</Text>
                    <Text style={styles.qtyVal}>{row.availableQty ?? row.quantity ?? 0}</Text>
                  </View>
                  <Text style={styles.vendorName}>{row.warehouseId?.name || row.warehouseId?.warehouseCode || '—'}</Text>
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

  tabsRow: { flexDirection: 'row', backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: '#E2E8F0' },
  tabBtn: { flex: 1, paddingVertical: verticalScale(12), alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabBtnOn: { borderBottomColor: '#00796B' },
  tabBtnText: { color: '#A0AEC0', fontWeight: '700', fontSize: responsiveFontSize(12) },
  tabBtnTextOn: { color: '#00796B' },

  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scrollContent: { padding: scale(16), paddingBottom: verticalScale(40) },
  emptyContainer: { alignItems: 'center', justifyContent: 'center', paddingVertical: verticalScale(80) },
  emptyIcon: { fontSize: responsiveFontSize(40), marginBottom: verticalScale(12), opacity: 0.7 },
  emptyDesc: { fontSize: responsiveFontSize(13), color: '#718096' },

  listContainer: { gap: verticalScale(10) },
  card: { backgroundColor: '#FFFFFF', borderRadius: 12, borderWidth: 1, borderColor: '#E2E8F0', padding: scale(14) },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  productName: { fontSize: responsiveFontSize(13), fontWeight: '750', color: '#2D3748', flex: 1, marginRight: 8 },
  rateVal: { fontSize: responsiveFontSize(13), fontWeight: '800', color: '#00796B' },
  qtyVal: { fontSize: responsiveFontSize(14), fontWeight: '800', color: '#2D3748' },
  vendorName: { fontSize: responsiveFontSize(11.5), color: '#718096', marginTop: 4 },
  dateNote: { fontSize: responsiveFontSize(10), color: '#A0AEC0', marginTop: 2 },
});
