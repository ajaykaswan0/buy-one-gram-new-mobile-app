import React from 'react';
import { StyleSheet, Text, View, TouchableOpacity, SafeAreaView, ScrollView } from 'react-native';
import { useLanguage } from '../i18n';

/**
 * Home, for whoever buys the raw material.
 *
 * Six things and nothing else — attendance, leave, the vendor list, adding a
 * new one, what's in stock and what it costs, and the purchase orders already
 * raised. A sales report or a beat plan is somebody else's screen; showing
 * them here would just be two more things to scroll past every morning.
 */
export default function PurchaseManagerDashboardScreen({
  onNavigateToAttendance,
  onNavigateToLeave,
  onNavigateToVendors,
  onNavigateToCreateVendor,
  onNavigateToStock,
  onNavigateToPurchaseOrders,
}) {
  const { t } = useLanguage();

  const tiles = [
    { key: 'attendance', icon: '☝', label: t('Attendance'), onPress: onNavigateToAttendance, solid: true },
    { key: 'leave', icon: '📄', label: t('Apply Leave'), onPress: onNavigateToLeave },
    { key: 'vendors', icon: '🏬', label: 'Vendors', onPress: onNavigateToVendors },
    { key: 'createVendor', icon: '➕', label: 'Add Vendor', onPress: onNavigateToCreateVendor },
    { key: 'stock', icon: '📦', label: 'Stock & Rates', onPress: onNavigateToStock },
    { key: 'purchaseOrders', icon: '🧾', label: 'Purchase Orders', onPress: onNavigateToPurchaseOrders },
  ];

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.headerCard}>
          <Text style={styles.headerEyebrow}>Purchase Desk</Text>
          <Text style={styles.headerTitle}>What do you need?</Text>
        </View>

        <View style={styles.actionsCard}>
          <View style={styles.actionsRow}>
            {tiles.map((tile) => (
              <View key={tile.key} style={styles.actionItem}>
                <TouchableOpacity
                  style={[styles.circleBtn, tile.solid ? styles.solidBtn : styles.outlineBtn]}
                  onPress={tile.onPress}
                >
                  <Text style={tile.solid ? styles.solidIconText : styles.outlineIconText}>{tile.icon}</Text>
                </TouchableOpacity>
                <Text style={styles.actionLabel}>{tile.label}</Text>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F7F9FC' },
  container: { padding: 16, gap: 16 },
  headerCard: {
    backgroundColor: '#00796B',
    borderRadius: 16,
    padding: 18,
  },
  headerEyebrow: { color: 'rgba(255,255,255,0.8)', fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  headerTitle: { color: '#FFFFFF', fontSize: 20, fontWeight: '800', marginTop: 4 },

  actionsCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 16,
    shadowColor: '#1A202C',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.02,
    shadowRadius: 10,
    elevation: 1.5,
  },
  actionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  actionItem: { alignItems: 'center', width: '30%', marginBottom: 20 },
  circleBtn: { width: 54, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  solidBtn: {
    backgroundColor: '#00BFA5',
    shadowColor: '#00BFA5',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 2,
  },
  solidIconText: { fontSize: 24, color: '#FFFFFF', fontWeight: '600' },
  outlineBtn: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: '#E2E8F0' },
  outlineIconText: { fontSize: 20, color: '#4A5568' },
  actionLabel: { fontSize: 11, color: '#718096', fontWeight: '700', textAlign: 'center' },
});
