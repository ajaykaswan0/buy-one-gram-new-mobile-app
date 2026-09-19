import React, { useEffect, useState } from 'react';
import {
  StyleSheet, Text, View, TouchableOpacity, ActivityIndicator,
  SafeAreaView, ScrollView, TextInput, RefreshControl, Alert,
} from 'react-native';
import { launchCamera } from 'react-native-image-picker';
import { scale, verticalScale, responsiveFontSize } from '../utils/responsive';
import { getCurrentLocation } from '../services/currentLocation';
import { uploadFile } from '../services/firebaseUploadService';

const visitedToday = (vendor) => !!vendor.lastVisitAt
  && new Date(vendor.lastVisitAt).toDateString() === new Date().toDateString();

/** Every vendor bought from, with a way to add one and to mark today's visit. */
export default function VendorListScreen({ token, apiUrl, onBack, onSelectVendor, onAddVendor }) {
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [visitingId, setVisitingId] = useState(null);

  const load = async () => {
    try {
      const res = await fetch(`${apiUrl}/procurement/vendors?limit=200`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok && data.success) setVendors(data.data || []);
    } catch (e) {
      console.warn('Failed to load vendors:', e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { load(); }, [token, apiUrl]);

  const onRefresh = () => { setRefreshing(true); load(); };

  /**
   * Marks the card green without waiting on a full reload.
   *
   * A photo is required, same as the profile screen's own check-in — a
   * coordinate can be typed from a desk, a photo taken right now cannot. The
   * GPS fix stays best-effort: a visit from a dead zone still counts, it
   * just carries no distance for the office to check against.
   */
  const markVisited = (vendor) => {
    launchCamera({ mediaType: 'photo', quality: 0.8, maxWidth: 1600, maxHeight: 1600, includeBase64: false }, async (response) => {
      if (response.didCancel) return;
      if (response.errorCode) return Alert.alert('Camera Error', response.errorMessage || 'Failed to start camera.');
      const asset = response.assets?.[0];
      if (!asset) return;

      setVisitingId(vendor._id);
      try {
        let point = null;
        try { point = await getCurrentLocation({ timeout: 15000 }); } catch { /* recorded without a fix */ }
        const upload = await uploadFile({
          file: { uri: asset.uri, fileName: asset.fileName, type: asset.type, fileSize: asset.fileSize },
          module: 'vendors', relatedModel: 'VendorVisit', token, apiUrl,
        });
        const res = await fetch(`${apiUrl}/procurement/vendors/${vendor._id}/visits`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ latitude: point?.latitude, longitude: point?.longitude, photo: upload.storagePath }),
        });
        const data = await res.json();
        if (res.ok && data.success) {
          setVendors((current) => current.map((v) => (v._id === vendor._id ? { ...v, lastVisitAt: data.data.visitedAt } : v)));
        } else {
          Alert.alert('Failed', data.message || 'Could not record the visit.');
        }
      } catch (e) {
        Alert.alert('Error', e.message || 'Connection error.');
      } finally {
        setVisitingId(null);
      }
    });
  };

  const q = search.toLowerCase().trim();
  const filtered = vendors.filter((v) => !q
    || (v.name || '').toLowerCase().includes(q)
    || (v.vendorCode || '').toLowerCase().includes(q)
    || (v.mobile || v.phone || '').includes(q));

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.topHeader}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Text style={styles.backBtnText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.topHeaderTitle}>Vendors</Text>
        <TouchableOpacity onPress={onAddVendor} style={styles.addBtn}>
          <Text style={styles.addBtnText}>+</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.searchRow}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search by name, code or mobile..."
          placeholderTextColor="#A0AEC0"
          value={search}
          onChangeText={setSearch}
        />
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#00796B" />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#00796B']} />}
        >
          {filtered.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyIcon}>🏬</Text>
              <Text style={styles.emptyTitle}>No vendors yet</Text>
              <Text style={styles.emptyDesc}>Tap + to add the first one.</Text>
            </View>
          ) : (
            <View style={styles.listContainer}>
              {filtered.map((vendor) => {
                const done = visitedToday(vendor);
                return (
                  <TouchableOpacity
                    key={vendor._id}
                    style={[styles.card, done && styles.cardVisited]}
                    activeOpacity={0.8}
                    onPress={() => onSelectVendor(vendor._id)}
                  >
                    <View style={styles.cardHeader}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.vendorName}>{vendor.name}</Text>
                        <Text style={styles.vendorCode}>{vendor.vendorCode}</Text>
                        <Text style={styles.lastVisitText}>
                          {vendor.lastVisitAt ? `Last visited ${new Date(vendor.lastVisitAt).toLocaleDateString()}` : 'Never visited'}
                        </Text>
                      </View>
                      {!vendor.isActive && <Text style={styles.inactivePill}>Inactive</Text>}
                      {done ? (
                        <View style={[styles.visitBtn, styles.visitBtnDone]}>
                          <Text style={styles.visitBtnText}>✓ Visited</Text>
                        </View>
                      ) : (
                        <TouchableOpacity
                          style={styles.visitBtn}
                          onPress={() => markVisited(vendor)}
                          disabled={visitingId === vendor._id}
                        >
                          {visitingId === vendor._id
                            ? <ActivityIndicator color="#FFFFFF" size="small" />
                            : <Text style={styles.visitBtnText}>📍 Visit</Text>}
                        </TouchableOpacity>
                      )}
                    </View>
                    <View style={styles.divider} />
                    <View style={styles.detailsRow}>
                      <View style={styles.detailBlock}>
                        <Text style={styles.detailLabel}>Mobile</Text>
                        <Text style={styles.detailVal}>{vendor.mobile || vendor.phone || '—'}</Text>
                      </View>
                      <View style={styles.detailBlock}>
                        <Text style={styles.detailLabel}>GST</Text>
                        <Text style={styles.detailVal}>{vendor.gstNumber || '—'}</Text>
                      </View>
                      <View style={styles.detailBlock}>
                        <Text style={styles.detailLabel}>Warehouses</Text>
                        <Text style={styles.detailVal}>{(vendor.warehouses || []).length}</Text>
                      </View>
                    </View>
                  </TouchableOpacity>
                );
              })}
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
  addBtn: { width: scale(36), height: verticalScale(36), borderRadius: 18, backgroundColor: '#00796B', alignItems: 'center', justifyContent: 'center' },
  addBtnText: { fontSize: responsiveFontSize(20), color: '#FFFFFF', fontWeight: '700' },

  searchRow: { paddingHorizontal: scale(16), paddingVertical: verticalScale(12), backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: '#E2E8F0' },
  searchInput: { height: verticalScale(40), backgroundColor: '#F7F9FC', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 8, paddingHorizontal: scale(12), color: '#2D3748', fontSize: responsiveFontSize(13.5) },

  scrollContent: { padding: scale(16), paddingBottom: verticalScale(40) },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  emptyContainer: { alignItems: 'center', justifyContent: 'center', paddingVertical: verticalScale(80), paddingHorizontal: scale(20) },
  emptyIcon: { fontSize: responsiveFontSize(48), marginBottom: verticalScale(16), opacity: 0.7 },
  emptyTitle: { fontSize: responsiveFontSize(18), fontWeight: '700', color: '#2D3748', marginBottom: verticalScale(6) },
  emptyDesc: { fontSize: responsiveFontSize(13), color: '#718096', textAlign: 'center' },

  listContainer: { gap: verticalScale(12) },
  card: {
    backgroundColor: '#FFFFFF', borderRadius: 14, borderWidth: 1, borderColor: '#E2E8F0', padding: scale(16),
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.02, shadowRadius: 6, elevation: 1,
  },
  cardVisited: { borderColor: '#38A169', borderWidth: 1.5, backgroundColor: '#F0FFF4' },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: scale(10) },
  vendorName: { fontSize: responsiveFontSize(14.5), fontWeight: '800', color: '#2D3748' },
  vendorCode: { fontSize: responsiveFontSize(11), color: '#A0AEC0', fontWeight: '600', marginTop: verticalScale(2) },
  lastVisitText: { fontSize: responsiveFontSize(10.5), color: '#A0AEC0', marginTop: 3 },
  inactivePill: { fontSize: responsiveFontSize(10), color: '#E53E3E', fontWeight: '700', backgroundColor: '#FFF5F5', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  visitBtn: { backgroundColor: '#00796B', borderRadius: 8, paddingHorizontal: scale(12), paddingVertical: verticalScale(8), minWidth: scale(74), alignItems: 'center' },
  visitBtnDone: { backgroundColor: '#38A169' },
  visitBtnText: { color: '#FFFFFF', fontWeight: '800', fontSize: responsiveFontSize(11) },
  divider: { height: 1, backgroundColor: '#EDF2F7', marginVertical: verticalScale(12) },
  detailsRow: { flexDirection: 'row', justifyContent: 'space-between', gap: verticalScale(10) },
  detailBlock: { flex: 1 },
  detailLabel: { fontSize: responsiveFontSize(9.5), color: '#A0AEC0', fontWeight: '700', textTransform: 'uppercase', marginBottom: verticalScale(3) },
  detailVal: { fontSize: responsiveFontSize(12.5), fontWeight: '750', color: '#4A5568' },
});
