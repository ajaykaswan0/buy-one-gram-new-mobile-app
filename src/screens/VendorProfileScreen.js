import React, { useEffect, useState } from 'react';
import {
  StyleSheet, Text, View, TouchableOpacity, ScrollView, SafeAreaView,
  ActivityIndicator, TextInput, Alert, Image, Linking,
} from 'react-native';
import { launchCamera } from 'react-native-image-picker';
import { scale, verticalScale, responsiveFontSize } from '../utils/responsive';
import { uploadFile, FirebaseImage } from '../services/firebaseUploadService';
import { getCurrentLocation } from '../services/currentLocation';

const money = (value) => `₹${Number(value || 0).toLocaleString('en-IN')}`;

const STATUS_COLOURS = {
  draft: '#A0AEC0', pending_approval: '#DD6B20', approved: '#3182CE',
  partially_received: '#D69E2E', received: '#2F855A', completed: '#2F855A', cancelled: '#E53E3E',
};

/**
 * One vendor: who they are, their warehouses, what they currently charge for
 * each raw material, their purchase orders, and the Visit that keeps all of
 * it honest.
 *
 * A visit picks one of the vendor's own products, not any product in the
 * catalogue — that list is fixed on the vendor (extendable here, from the
 * "+ Add material" action), because a vendor selling thirty things is not
 * selling us all thirty.
 */
export default function VendorProfileScreen({ token, apiUrl, vendorId, onBack, onOpenPurchaseOrder }) {
  const [vendor, setVendor] = useState(null);
  const [rates, setRates] = useState({});
  const [orders, setOrders] = useState([]);
  const [lastVisit, setLastVisit] = useState(null);
  const [checkingIn, setCheckingIn] = useState(false);
  const [loading, setLoading] = useState(true);

  const [visiting, setVisiting] = useState(false);
  const [visitProductId, setVisitProductId] = useState(null);
  const [visitPrice, setVisitPrice] = useState('');
  const [visitMoisture, setVisitMoisture] = useState('');
  const [visitQuality, setVisitQuality] = useState('');
  const [visitPhoto, setVisitPhoto] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [uploadStage, setUploadStage] = useState('');

  const [historyProduct, setHistoryProduct] = useState(null);
  const [historyRows, setHistoryRows] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [addingMaterial, setAddingMaterial] = useState(false);
  const [catalogue, setCatalogue] = useState([]);
  const [pickedNew, setPickedNew] = useState([]);
  const [savingMaterials, setSavingMaterials] = useState(false);

  const load = async () => {
    try {
      const [vendorRes, rateRes, poRes, visitRes] = await Promise.all([
        fetch(`${apiUrl}/procurement/vendors/${vendorId}`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${apiUrl}/procurement/vendors/${vendorId}/rates?isCurrent=true`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${apiUrl}/procurement/purchase-orders?vendor=${vendorId}&limit=20`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${apiUrl}/procurement/vendors/${vendorId}/visits?limit=1`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      const vendorData = await vendorRes.json();
      const rateData = await rateRes.json();
      const poData = await poRes.json();
      const visitData = await visitRes.json();
      if (vendorRes.ok && vendorData.success) setVendor(vendorData.data);
      if (rateRes.ok && rateData.success) {
        const byProduct = {};
        (rateData.data || []).forEach((row) => { byProduct[String(row.product?._id || row.product)] = row; });
        setRates(byProduct);
      }
      if (poRes.ok && poData.success) setOrders(poData.data || []);
      if (visitRes.ok && visitData.success) setLastVisit(visitData.data?.[0] || null);
    } catch (e) {
      console.warn('Failed to load vendor:', e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [vendorId, token, apiUrl]);

  const capturePhoto = (onPicked) => launchCamera(
    { mediaType: 'photo', quality: 0.8, maxWidth: 1600, maxHeight: 1600, includeBase64: false },
    (response) => {
      if (response.didCancel) return;
      if (response.errorCode) return Alert.alert('Camera Error', response.errorMessage || 'Failed to start camera.');
      const asset = response.assets?.[0];
      if (asset) onPicked({ uri: asset.uri, fileName: asset.fileName, type: asset.type, fileSize: asset.fileSize });
    }
  );

  /**
   * "I am actually here" — separate from pricing anything.
   *
   * A photo is required, the same as pricing a raw material — a coordinate
   * alone can be typed in from a desk, a photo taken right now cannot. The
   * GPS fix stays best-effort: the server checks it against the vendor's
   * saved location when it's there, but a dead zone still records a real
   * visit, just without a distance to show for it.
   */
  const checkIn = () => {
    capturePhoto(async (photo) => {
      setCheckingIn(true);
      try {
        let point = null;
        try { point = await getCurrentLocation({ timeout: 15000 }); } catch { /* recorded without a fix rather than blocked entirely */ }
        const upload = await uploadFile({ file: photo, module: 'vendors', relatedModel: 'VendorVisit', token, apiUrl });
        const res = await fetch(`${apiUrl}/procurement/vendors/${vendorId}/visits`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ latitude: point?.latitude, longitude: point?.longitude, photo: upload.storagePath }),
        });
        const data = await res.json();
        if (res.ok && data.success) {
          setLastVisit(data.data);
          Alert.alert('Visit recorded', 'This visit has been logged.');
        } else {
          Alert.alert('Failed', data.message || 'Could not record the visit.');
        }
      } catch (e) {
        Alert.alert('Error', e.message || 'Connection error.');
      } finally {
        setCheckingIn(false);
      }
    });
  };

  const startVisit = (productId) => {
    setVisitProductId(productId);
    setVisitPrice('');
    setVisitMoisture('');
    setVisitQuality('');
    setVisitPhoto(null);
    setVisiting(true);
  };

  const submitVisit = async () => {
    if (!visitProductId) return Alert.alert('Required', 'Choose which product this price is for.');
    const price = Number(visitPrice);
    if (!(price > 0)) return Alert.alert('Required', 'Enter the price per kilo.');
    if (!visitPhoto) return Alert.alert('Required', 'Take a photo of the material.');

    setSubmitting(true);
    try {
      const upload = await uploadFile({ file: visitPhoto, module: 'vendors', relatedModel: 'VendorRateList', token, apiUrl, onProgress: setUploadStage });
      const res = await fetch(`${apiUrl}/procurement/vendors/${vendorId}/rates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          product: visitProductId,
          rate: price,
          photo: upload.storagePath,
          moisture: visitMoisture ? Number(visitMoisture) : undefined,
          quality: visitQuality.trim(),
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setVisiting(false);
        await load();
      } else {
        Alert.alert('Failed', data.message || 'Could not save the price.');
      }
    } catch (e) {
      Alert.alert('Error', e.message || 'Connection error.');
    } finally {
      setSubmitting(false);
      setUploadStage('');
    }
  };

  /** Up to five previous visits for this product — most recent, including today's. */
  const openHistory = async (productId) => {
    setHistoryProduct(productId);
    setHistoryLoading(true);
    try {
      const res = await fetch(`${apiUrl}/procurement/vendors/${vendorId}/rates?product=${productId}&limit=5`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok && data.success) setHistoryRows(data.data || []);
    } catch (e) {
      console.warn('Failed to load rate history:', e.message);
    } finally {
      setHistoryLoading(false);
    }
  };

  const openAddMaterial = async () => {
    setPickedNew([]);
    setAddingMaterial(true);
    try {
      const res = await fetch(`${apiUrl}/product?productType=raw_material&limit=200`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (res.ok && data.success) setCatalogue(data.data || []);
    } catch (e) {
      console.warn('Failed to load the raw material catalogue:', e.message);
    }
  };

  const togglePickedNew = (id) => setPickedNew((current) => (
    current.includes(id) ? current.filter((x) => x !== id) : [...current, id]
  ));

  const saveNewMaterials = async () => {
    if (!pickedNew.length) return setAddingMaterial(false);
    setSavingMaterials(true);
    try {
      const res = await fetch(`${apiUrl}/procurement/vendors/${vendorId}/raw-materials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ products: pickedNew }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setAddingMaterial(false);
        await load();
      } else {
        Alert.alert('Failed', data.message || 'Could not add the material.');
      }
    } catch (e) {
      Alert.alert('Error', e.message || 'Connection error.');
    } finally {
      setSavingMaterials(false);
    }
  };

  const navigateToWarehouse = (wh) => {
    if (!Number.isFinite(wh.latitude) || !Number.isFinite(wh.longitude)) {
      return Alert.alert('No location', 'This warehouse has no saved location yet.');
    }
    Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${wh.latitude},${wh.longitude}&travelmode=driving`)
      .catch(() => Alert.alert('Error', 'Google Maps could not be opened.'));
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centered}><ActivityIndicator size="large" color="#00796B" /></View>
      </SafeAreaView>
    );
  }

  if (!vendor) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.topHeader}>
          <TouchableOpacity onPress={onBack} style={styles.backBtn}><Text style={styles.backBtnText}>←</Text></TouchableOpacity>
          <Text style={styles.topHeaderTitle}>Vendor</Text>
          <View style={{ width: 36 }} />
        </View>
        <View style={styles.centered}><Text style={styles.emptyDesc}>Vendor not found.</Text></View>
      </SafeAreaView>
    );
  }

  const visitProduct = (vendor.rawMaterialProducts || []).find((p) => String(p._id) === String(visitProductId));
  const unpicked = catalogue.filter((p) => !(vendor.rawMaterialProducts || []).some((rm) => String(rm._id) === String(p._id)));
  const visitedToday = !!lastVisit && new Date(lastVisit.visitedAt).toDateString() === new Date().toDateString();

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.topHeader}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}><Text style={styles.backBtnText}>←</Text></TouchableOpacity>
        <Text style={styles.topHeaderTitle} numberOfLines={1}>{vendor.name}</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={[styles.card, visitedToday && styles.cardVisited]}>
          <View style={styles.headRow}>
            {vendor.image ? (
              <FirebaseImage source={{ uri: vendor.image }} style={styles.vendorPhoto} token={token} apiUrl={apiUrl} fallback={<View style={[styles.vendorPhoto, styles.vendorPhotoPlaceholder]} />} />
            ) : (
              <View style={[styles.vendorPhoto, styles.vendorPhotoPlaceholder]}>
                <Text style={styles.vendorPhotoInitial}>{(vendor.name || '?').charAt(0).toUpperCase()}</Text>
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.vendorCode}>{vendor.vendorCode}</Text>
              <Text style={styles.vendorName}>{vendor.name}</Text>
              <Text style={styles.lastVisitText}>
                {lastVisit ? `Last visited ${new Date(lastVisit.visitedAt).toLocaleDateString()}` : 'Never visited'}
              </Text>
            </View>
            {visitedToday ? (
              <View style={[styles.checkInBtn, styles.checkInBtnDone]}>
                <Text style={styles.checkInBtnText}>✓ Visited</Text>
              </View>
            ) : (
              <TouchableOpacity style={styles.checkInBtn} onPress={checkIn} disabled={checkingIn}>
                {checkingIn
                  ? <ActivityIndicator color="#FFFFFF" size="small" />
                  : <Text style={styles.checkInBtnText}>📍 Visit</Text>}
              </TouchableOpacity>
            )}
          </View>
          <View style={styles.infoGrid}>
            <View style={styles.infoBlock}><Text style={styles.infoLabel}>Mobile</Text><Text style={styles.infoVal}>{vendor.mobile || vendor.phone || '—'}</Text></View>
            <View style={styles.infoBlock}><Text style={styles.infoLabel}>WhatsApp</Text><Text style={styles.infoVal}>{vendor.whatsapp || '—'}</Text></View>
            <View style={styles.infoBlock}><Text style={styles.infoLabel}>Email</Text><Text style={styles.infoVal}>{vendor.email || '—'}</Text></View>
            <View style={styles.infoBlock}><Text style={styles.infoLabel}>GST</Text><Text style={styles.infoVal}>{vendor.gstNumber || '—'}</Text></View>
          </View>
          {!!vendor.address && (
            <View style={{ marginTop: verticalScale(10) }}>
              <Text style={styles.infoLabel}>Address</Text>
              <Text style={styles.infoVal}>{typeof vendor.address === 'string' ? vendor.address : JSON.stringify(vendor.address)}</Text>
            </View>
          )}
        </View>

        <Text style={styles.sectionTitle}>Warehouses</Text>
        {(vendor.warehouses || []).length === 0 ? (
          <Text style={styles.emptyNote}>No warehouse addresses saved.</Text>
        ) : (vendor.warehouses || []).map((wh, index) => (
          <View key={index} style={styles.warehouseCard}>
            <View style={{ flex: 1 }}>
              {!!wh.label && <Text style={styles.warehouseLabel}>{wh.label}</Text>}
              <Text style={styles.warehouseAddress}>{wh.address}</Text>
            </View>
            <TouchableOpacity style={styles.navBtn} onPress={() => navigateToWarehouse(wh)}>
              <Text style={styles.navBtnText}>📍</Text>
            </TouchableOpacity>
          </View>
        ))}

        <View style={styles.sectionHeadRow}>
          <Text style={styles.sectionTitle}>Raw materials & current price</Text>
          <TouchableOpacity onPress={openAddMaterial}><Text style={styles.addLinkText}>+ Add material</Text></TouchableOpacity>
        </View>
        {(vendor.rawMaterialProducts || []).length === 0 ? (
          // Visit lives on a material row below, so with none picked yet
          // there is nowhere for that button to be — this is step one, made
          // impossible to miss rather than a small note easy to scroll past.
          <TouchableOpacity style={styles.setupCard} onPress={openAddMaterial}>
            <Text style={styles.setupIcon}>🌾</Text>
            <Text style={styles.setupTitle}>What does this vendor sell?</Text>
            <Text style={styles.setupDesc}>Pick from our raw materials to start recording visits and prices.</Text>
            <View style={styles.setupBtn}><Text style={styles.setupBtnText}>+ Add raw material</Text></View>
          </TouchableOpacity>
        ) : (vendor.rawMaterialProducts || []).map((product) => {
          const rate = rates[String(product._id)];
          return (
            <View key={product._id} style={styles.productCard}>
              {rate?.photo ? (
                <FirebaseImage source={{ uri: rate.photo }} style={styles.productPhoto} token={token} apiUrl={apiUrl} fallback={<View style={[styles.productPhoto, styles.productPhotoPlaceholder]} />} />
              ) : (
                <View style={[styles.productPhoto, styles.productPhotoPlaceholder]}>
                  <Text style={styles.productPhotoPlaceholderText}>No photo</Text>
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.productName}>{product.productName}</Text>
                <Text style={styles.productRate}>{rate ? `${money(rate.rate)} / kg` : 'No price recorded yet'}</Text>
                {!!rate && (rate.moisture != null || rate.quality) && (
                  <Text style={styles.productMeta}>
                    {rate.moisture != null ? `${rate.moisture}% moisture` : ''}{rate.moisture != null && rate.quality ? ' · ' : ''}{rate.quality ? `Grade ${rate.quality}` : ''}
                  </Text>
                )}
                {!!rate?.effectiveFrom && <Text style={styles.productRateDate}>as of {new Date(rate.effectiveFrom).toLocaleDateString()}</Text>}
                <TouchableOpacity onPress={() => openHistory(product._id)}><Text style={styles.historyLink}>Previous photos</Text></TouchableOpacity>
              </View>
              {/* "Visit" now means the vendor-level check-in, above — this is
                  just recording a price for one product. */}
              <TouchableOpacity style={styles.visitBtn} onPress={() => startVisit(product._id)}>
                <Text style={styles.visitBtnText}>{rate ? 'Update' : 'Add'}</Text>
              </TouchableOpacity>
            </View>
          );
        })}

        <Text style={styles.sectionTitle}>Purchase orders</Text>
        {orders.length === 0 ? (
          <Text style={styles.emptyNote}>No purchase orders raised against this vendor yet.</Text>
        ) : orders.map((po) => (
          <TouchableOpacity key={po._id} style={styles.poCard} onPress={() => onOpenPurchaseOrder?.(po._id)}>
            <View style={{ flex: 1 }}>
              <Text style={styles.poNumber}>{po.poNumber}</Text>
              <Text style={styles.poDate}>{po.orderDate ? new Date(po.orderDate).toLocaleDateString() : ''}</Text>
            </View>
            <Text style={styles.poAmount}>{money(po.totalAmount)}</Text>
            <Text style={[styles.statusPill, { backgroundColor: `${STATUS_COLOURS[po.status] || '#A0AEC0'}22`, color: STATUS_COLOURS[po.status] || '#718096' }]}>
              {String(po.status || '').replace(/_/g, ' ')}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {visiting && (
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={styles.sheetTitle}>Record today's price</Text>
              <Text style={styles.visitProductName}>{visitProduct?.productName}</Text>

              <TouchableOpacity style={styles.photoBtn} onPress={() => capturePhoto(setVisitPhoto)}>
                {visitPhoto ? <Image source={{ uri: visitPhoto.uri }} style={styles.photoPreview} /> : <Text style={styles.photoBtnText}>📷 Take photo</Text>}
              </TouchableOpacity>

              <Text style={styles.fieldLabel}>Price per kilo</Text>
              <TextInput style={styles.priceInput} value={visitPrice} onChangeText={setVisitPrice} keyboardType="numeric" placeholder="₹ per kg" placeholderTextColor="#A0AEC0" />

              <View style={styles.rowFields}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>Moisture %</Text>
                  <TextInput style={styles.smallInput} value={visitMoisture} onChangeText={setVisitMoisture} keyboardType="numeric" placeholder="e.g. 12" placeholderTextColor="#A0AEC0" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>Quality</Text>
                  <TextInput style={styles.smallInput} value={visitQuality} onChangeText={setVisitQuality} placeholder="e.g. A" placeholderTextColor="#A0AEC0" />
                </View>
              </View>

              <View style={styles.visitActions}>
                <TouchableOpacity style={styles.cancelBtn} onPress={() => setVisiting(false)} disabled={submitting}>
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.saveBtn, submitting && styles.disabledBtn]} onPress={submitVisit} disabled={submitting}>
                  {submitting ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.saveBtnText}>Save</Text>}
                </TouchableOpacity>
              </View>
              {!!uploadStage && <Text style={styles.uploadStage}>{uploadStage}…</Text>}
            </ScrollView>
          </View>
        </View>
      )}

      {!!historyProduct && (
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeadRow}>
              <Text style={styles.sheetTitle}>Previous prices</Text>
              <TouchableOpacity onPress={() => setHistoryProduct(null)}><Text style={styles.closeX}>✕</Text></TouchableOpacity>
            </View>
            {historyLoading ? (
              <ActivityIndicator color="#00796B" style={{ marginVertical: 20 }} />
            ) : historyRows.length === 0 ? (
              <Text style={styles.emptyDesc}>No history for this product yet.</Text>
            ) : (
              <ScrollView>
                {historyRows.map((row) => (
                  <View key={row._id} style={styles.historyRow}>
                    {row.photo ? (
                      <FirebaseImage source={{ uri: row.photo }} style={styles.historyPhoto} token={token} apiUrl={apiUrl} fallback={<View style={[styles.historyPhoto, styles.productPhotoPlaceholder]} />} />
                    ) : (
                      <View style={[styles.historyPhoto, styles.productPhotoPlaceholder]} />
                    )}
                    <View style={{ flex: 1 }}>
                      <Text style={styles.productRate}>{money(row.rate)} / kg{row.isCurrent ? ' · current' : ''}</Text>
                      {(row.moisture != null || row.quality) && (
                        <Text style={styles.productMeta}>
                          {row.moisture != null ? `${row.moisture}% moisture` : ''}{row.moisture != null && row.quality ? ' · ' : ''}{row.quality ? `Grade ${row.quality}` : ''}
                        </Text>
                      )}
                      <Text style={styles.productRateDate}>{row.effectiveFrom ? new Date(row.effectiveFrom).toLocaleDateString() : ''}</Text>
                    </View>
                  </View>
                ))}
              </ScrollView>
            )}
          </View>
        </View>
      )}

      {addingMaterial && (
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeadRow}>
              <Text style={styles.sheetTitle}>Add raw materials</Text>
              <TouchableOpacity onPress={() => setAddingMaterial(false)}><Text style={styles.closeX}>✕</Text></TouchableOpacity>
            </View>
            {/*
              * The button lives inside this same ScrollView, after the chips
              * — not as a sibling below it. A fixed-height chip area plus a
              * sibling button both stacked inside the sheet's own
              * maxHeight('85%') could still overflow on a short screen or a
              * large font-scale setting, clipping the button off entirely
              * with no way to scroll to it. Scrolling chips and button
              * together means the button is always reachable, whatever the
              * chip count or screen size.
              */}
            <ScrollView keyboardShouldPersistTaps="handled">
              {catalogue.length === 0 ? (
                <ActivityIndicator color="#00796B" style={{ marginVertical: 20 }} />
              ) : unpicked.length === 0 ? (
                <Text style={styles.emptyDesc}>This vendor already sells everything in our catalogue.</Text>
              ) : (
                <View style={styles.chipWrap}>
                  {unpicked.map((product) => {
                    const on = pickedNew.includes(product._id);
                    return (
                      <TouchableOpacity key={product._id} style={[styles.chip, on && styles.chipOn]} onPress={() => togglePickedNew(product._id)}>
                        <Text style={[styles.chipText, on && styles.chipTextOn]}>{product.productName}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
              <TouchableOpacity style={[styles.saveBtn, savingMaterials && styles.disabledBtn]} onPress={saveNewMaterials} disabled={savingMaterials}>
                {savingMaterials ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.saveBtnText}>{pickedNew.length ? `Add ${pickedNew.length}` : 'Close'}</Text>}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F7F9FC' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
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
  cardVisited: { borderColor: '#38A169', borderWidth: 1.5, backgroundColor: '#F0FFF4' },
  lastVisitText: { fontSize: responsiveFontSize(10.5), color: '#A0AEC0', marginTop: 3 },
  checkInBtn: { backgroundColor: '#00796B', borderRadius: 10, paddingHorizontal: scale(12), paddingVertical: verticalScale(10), minWidth: scale(78), alignItems: 'center' },
  checkInBtnDone: { backgroundColor: '#38A169' },
  checkInBtnText: { color: '#FFFFFF', fontWeight: '800', fontSize: responsiveFontSize(11.5) },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: scale(12), marginBottom: verticalScale(12) },
  vendorPhoto: { width: scale(56), height: scale(56), borderRadius: 12 },
  vendorPhotoPlaceholder: { backgroundColor: '#F7F9FC', alignItems: 'center', justifyContent: 'center' },
  vendorPhotoInitial: { fontSize: responsiveFontSize(22), fontWeight: '800', color: '#A0AEC0' },
  vendorCode: { fontSize: responsiveFontSize(11), color: '#A0AEC0', fontWeight: '700' },
  vendorName: { fontSize: responsiveFontSize(16), fontWeight: '800', color: '#2D3748', marginTop: 2 },
  infoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: verticalScale(12) },
  infoBlock: { width: '46%' },
  infoLabel: { fontSize: responsiveFontSize(9.5), color: '#A0AEC0', fontWeight: '700', textTransform: 'uppercase', marginBottom: 3 },
  infoVal: { fontSize: responsiveFontSize(13), fontWeight: '650', color: '#4A5568' },

  sectionTitle: { fontSize: responsiveFontSize(13), fontWeight: '800', color: '#2D3748', marginTop: verticalScale(20), marginBottom: verticalScale(10) },
  sectionHeadRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: verticalScale(20) },
  emptyNote: { color: '#A0AEC0', fontSize: responsiveFontSize(12.5), fontStyle: 'italic' },
  setupCard: {
    backgroundColor: '#F0FAF8', borderWidth: 1.5, borderColor: '#00796B', borderStyle: 'dashed',
    borderRadius: 14, padding: scale(20), alignItems: 'center',
  },
  setupIcon: { fontSize: responsiveFontSize(28), marginBottom: verticalScale(6) },
  setupTitle: { fontSize: responsiveFontSize(14), fontWeight: '800', color: '#2D3748', marginBottom: verticalScale(4) },
  setupDesc: { fontSize: responsiveFontSize(12), color: '#718096', textAlign: 'center', marginBottom: verticalScale(14) },
  setupBtn: { backgroundColor: '#00796B', borderRadius: 8, paddingHorizontal: scale(18), paddingVertical: verticalScale(10) },
  setupBtnText: { color: '#FFFFFF', fontWeight: '800', fontSize: responsiveFontSize(13) },
  emptyDesc: { fontSize: responsiveFontSize(13), color: '#718096', textAlign: 'center', paddingVertical: verticalScale(12) },
  addLinkText: { color: '#00796B', fontWeight: '700', fontSize: responsiveFontSize(12.5) },

  warehouseCard: { flexDirection: 'row', alignItems: 'center', gap: scale(8), backgroundColor: '#FFFFFF', borderRadius: 10, borderWidth: 1, borderColor: '#E2E8F0', padding: scale(12), marginBottom: verticalScale(8) },
  warehouseLabel: { fontSize: responsiveFontSize(12.5), fontWeight: '750', color: '#2D3748', marginBottom: 3 },
  warehouseAddress: { fontSize: responsiveFontSize(12.5), color: '#718096' },
  navBtn: { width: scale(36), height: verticalScale(36), borderRadius: 18, backgroundColor: '#F0FAF8', alignItems: 'center', justifyContent: 'center' },
  navBtnText: { fontSize: responsiveFontSize(16) },

  productCard: {
    flexDirection: 'row', alignItems: 'center', gap: scale(10),
    backgroundColor: '#FFFFFF', borderRadius: 12, borderWidth: 1, borderColor: '#E2E8F0', padding: scale(10), marginBottom: verticalScale(8),
  },
  productPhoto: { width: scale(48), height: scale(48), borderRadius: 8 },
  productPhotoPlaceholder: { backgroundColor: '#F7F9FC', alignItems: 'center', justifyContent: 'center' },
  productPhotoPlaceholderText: { fontSize: responsiveFontSize(8), color: '#A0AEC0', textAlign: 'center' },
  productName: { fontSize: responsiveFontSize(13.5), fontWeight: '750', color: '#2D3748' },
  productRate: { fontSize: responsiveFontSize(13), color: '#00796B', fontWeight: '700', marginTop: 2 },
  productMeta: { fontSize: responsiveFontSize(10.5), color: '#718096', marginTop: 1 },
  productRateDate: { fontSize: responsiveFontSize(10), color: '#A0AEC0', marginTop: 1 },
  historyLink: { fontSize: responsiveFontSize(10.5), color: '#00796B', fontWeight: '700', marginTop: 3 },
  visitBtn: { backgroundColor: '#00796B', borderRadius: 8, paddingHorizontal: scale(14), paddingVertical: verticalScale(8) },
  visitBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: responsiveFontSize(12) },

  poCard: { flexDirection: 'row', alignItems: 'center', gap: scale(10), backgroundColor: '#FFFFFF', borderRadius: 12, borderWidth: 1, borderColor: '#E2E8F0', padding: scale(12), marginBottom: verticalScale(8) },
  poNumber: { fontSize: responsiveFontSize(12.5), fontWeight: '750', color: '#2D3748' },
  poDate: { fontSize: responsiveFontSize(10.5), color: '#A0AEC0', marginTop: 2 },
  poAmount: { fontSize: responsiveFontSize(12.5), fontWeight: '750', color: '#4A5568' },
  statusPill: { fontSize: responsiveFontSize(9.5), fontWeight: '750', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, textTransform: 'capitalize' },

  overlay: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: scale(20), maxHeight: '85%' },
  sheetHeadRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: verticalScale(14) },
  closeX: { fontSize: responsiveFontSize(16), color: '#A0AEC0', fontWeight: '700' },
  sheetTitle: { fontSize: responsiveFontSize(15), fontWeight: '800', color: '#2D3748' },
  visitProductName: { fontSize: responsiveFontSize(13), color: '#00796B', fontWeight: '700', marginTop: 4, marginBottom: verticalScale(16) },

  photoBtn: {
    height: verticalScale(120), borderRadius: 12, borderWidth: 1.5, borderColor: '#E2E8F0', borderStyle: 'dashed',
    alignItems: 'center', justifyContent: 'center', marginBottom: verticalScale(16), overflow: 'hidden', backgroundColor: '#F7F9FC',
  },
  photoBtnText: { color: '#718096', fontWeight: '700', fontSize: responsiveFontSize(13) },
  photoPreview: { width: '100%', height: '100%' },
  fieldLabel: { fontSize: responsiveFontSize(11), fontWeight: '800', color: '#718096', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: verticalScale(6) },
  priceInput: {
    height: verticalScale(48), backgroundColor: '#F7F9FC', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 8,
    paddingHorizontal: scale(14), color: '#2D3748', fontSize: responsiveFontSize(16), fontWeight: '700', marginBottom: verticalScale(16),
  },
  rowFields: { flexDirection: 'row', gap: scale(10) },
  smallInput: {
    height: verticalScale(44), backgroundColor: '#F7F9FC', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 8,
    paddingHorizontal: scale(12), color: '#2D3748', fontSize: responsiveFontSize(14), marginBottom: verticalScale(16),
  },
  visitActions: { flexDirection: 'row', gap: scale(10) },
  cancelBtn: { flex: 1, height: verticalScale(46), borderRadius: 10, borderWidth: 1, borderColor: '#E2E8F0', alignItems: 'center', justifyContent: 'center' },
  cancelBtnText: { color: '#718096', fontWeight: '700' },
  saveBtn: { flex: 1, height: verticalScale(46), borderRadius: 10, backgroundColor: '#00796B', alignItems: 'center', justifyContent: 'center', marginTop: verticalScale(4) },
  disabledBtn: { opacity: 0.6 },
  saveBtnText: { color: '#FFFFFF', fontWeight: '800' },
  uploadStage: { textAlign: 'center', color: '#A0AEC0', fontSize: responsiveFontSize(11), marginTop: verticalScale(10) },

  historyRow: { flexDirection: 'row', alignItems: 'center', gap: scale(10), paddingVertical: verticalScale(10), borderBottomWidth: 1, borderBottomColor: '#EDF2F7' },
  historyPhoto: { width: scale(52), height: scale(52), borderRadius: 8 },

  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: scale(8), marginBottom: verticalScale(10) },
  chip: { paddingHorizontal: scale(14), paddingVertical: verticalScale(9), borderRadius: 20, borderWidth: 1, borderColor: '#E2E8F0', backgroundColor: '#FFFFFF' },
  chipOn: { backgroundColor: '#00796B', borderColor: '#00796B' },
  chipText: { color: '#4A5568', fontSize: responsiveFontSize(12.5), fontWeight: '650' },
  chipTextOn: { color: '#FFFFFF' },
});
