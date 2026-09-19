import React, { useEffect, useState } from 'react';
import {
  StyleSheet, Text, View, TouchableOpacity, TextInput, ScrollView,
  SafeAreaView, ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Image, Modal,
} from 'react-native';
import { launchCamera } from 'react-native-image-picker';
import { scale, verticalScale, responsiveFontSize } from '../utils/responsive';
import { uploadFile } from '../services/firebaseUploadService';
import { getCurrentLocation } from '../services/currentLocation';
import LocationPickerScreen from './LocationPickerScreen';

/**
 * A vendor, in full: who they are, where their warehouses are, and which of
 * our raw materials they actually sell.
 *
 * The product list is deliberately narrow — it is drawn from our own raw
 * material catalogue, not theirs. A vendor selling thirty things is picking
 * from the five or so that we buy, not typing in the other twenty-five.
 */
export default function CreateVendorScreen({ token, apiUrl, onBack, onCreated }) {
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [email, setEmail] = useState('');
  const [gstNumber, setGstNumber] = useState('');
  const [address, setAddress] = useState('');
  const [photo, setPhoto] = useState(null);
  // The vendor's own point — separate from any one warehouse — is what a
  // visit is checked against later.
  const [vendorLocation, setVendorLocation] = useState(null);
  const [locatingVendor, setLocatingVendor] = useState(false);
  const [warehouses, setWarehouses] = useState([{ label: '', address: '', latitude: null, longitude: null }]);
  const [locatingIndex, setLocatingIndex] = useState(null);
  // null, 'vendor', or a warehouse row index — whichever the map picker is
  // currently choosing a point for.
  const [pickerTarget, setPickerTarget] = useState(null);
  const [rawMaterials, setRawMaterials] = useState([]);
  const [selectedProducts, setSelectedProducts] = useState([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadStage, setUploadStage] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${apiUrl}/product?productType=raw_material&limit=200`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (res.ok && data.success) setRawMaterials(data.data || []);
      } catch (e) {
        console.warn('Failed to load raw material products:', e.message);
      } finally {
        setLoadingProducts(false);
      }
    })();
  }, [token, apiUrl]);

  const toggleProduct = (id) => setSelectedProducts((current) => (
    current.includes(id) ? current.filter((x) => x !== id) : [...current, id]
  ));

  const updateWarehouse = (index, field, value) => setWarehouses((current) => current.map(
    (row, i) => (i === index ? { ...row, [field]: value } : row)
  ));
  const addWarehouse = () => setWarehouses((current) => [...current, { label: '', address: '', latitude: null, longitude: null }]);
  const removeWarehouse = (index) => setWarehouses((current) => current.filter((_, i) => i !== index));

  const capturePhoto = () => launchCamera(
    { mediaType: 'photo', quality: 0.8, maxWidth: 1600, maxHeight: 1600, includeBase64: false },
    (response) => {
      if (response.didCancel) return;
      if (response.errorCode) return Alert.alert('Camera Error', response.errorMessage || 'Failed to start camera.');
      const asset = response.assets?.[0];
      if (asset) setPhoto({ uri: asset.uri, fileName: asset.fileName, type: asset.type, fileSize: asset.fileSize });
    }
  );

  /**
   * The pin for one warehouse row, taken from wherever the phone is standing.
   *
   * A purchase manager filling this in is usually standing at the godown, so
   * "here" is the right answer more often than typing coordinates ever would
   * be. "Pick on map" below is for the other case — setting this up from the
   * office, before anyone has actually been there.
   */
  const useCurrentLocationFor = async (index) => {
    setLocatingIndex(index);
    try {
      const position = await getCurrentLocation({ timeout: 20000 });
      updateWarehouse(index, 'latitude', position.latitude);
      updateWarehouse(index, 'longitude', position.longitude);
    } catch (e) {
      Alert.alert('Location', e.message || 'Could not get the current location.');
    } finally {
      setLocatingIndex(null);
    }
  };

  const useCurrentLocationForVendor = async () => {
    setLocatingVendor(true);
    try {
      const position = await getCurrentLocation({ timeout: 20000 });
      setVendorLocation({ latitude: position.latitude, longitude: position.longitude });
    } catch (e) {
      Alert.alert('Location', e.message || 'Could not get the current location.');
    } finally {
      setLocatingVendor(false);
    }
  };

  const handlePicked = (point) => {
    if (pickerTarget === 'vendor') setVendorLocation(point);
    else if (typeof pickerTarget === 'number') {
      updateWarehouse(pickerTarget, 'latitude', point.latitude);
      updateWarehouse(pickerTarget, 'longitude', point.longitude);
    }
    setPickerTarget(null);
  };

  const pickerStart = pickerTarget === 'vendor'
    ? vendorLocation
    : typeof pickerTarget === 'number' ? warehouses[pickerTarget] : null;

  const submit = async () => {
    if (!name.trim()) return Alert.alert('Required', 'Enter the vendor name.');
    setSaving(true);
    try {
      let imagePath = '';
      if (photo) {
        const upload = await uploadFile({ file: photo, module: 'vendors', relatedModel: 'Vendor', token, apiUrl, onProgress: setUploadStage });
        imagePath = upload.storagePath;
      }

      const res = await fetch(`${apiUrl}/procurement/vendors`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name: name.trim(),
          mobile: mobile.trim(),
          whatsapp: whatsapp.trim(),
          email: email.trim(),
          gstNumber: gstNumber.trim(),
          address: address.trim(),
          image: imagePath,
          location: vendorLocation || undefined,
          warehouses: warehouses.filter((row) => row.address.trim()).map((row) => ({
            label: row.label.trim(),
            address: row.address.trim(),
            latitude: row.latitude,
            longitude: row.longitude,
          })),
          rawMaterialProducts: selectedProducts,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        Alert.alert('Saved', `${name} added.`);
        onCreated?.(data.data);
      } else {
        Alert.alert('Failed', data.message || 'Could not save the vendor.');
      }
    } catch (e) {
      Alert.alert('Error', e.message || 'Connection error.');
    } finally {
      setSaving(false);
      setUploadStage('');
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.topHeader}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Text style={styles.backBtnText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.topHeaderTitle}>Add Vendor</Text>
        <View style={{ width: 36 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <TouchableOpacity style={styles.photoBtn} onPress={capturePhoto}>
            {photo ? (
              <Image source={{ uri: photo.uri }} style={styles.photoPreview} />
            ) : (
              <Text style={styles.photoBtnText}>📷 Vendor / shop photo</Text>
            )}
          </TouchableOpacity>

          <Text style={styles.sectionTitle}>Vendor details</Text>
          <Text style={styles.fieldLabel}>Name *</Text>
          <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Vendor / supplier name" placeholderTextColor="#A0AEC0" />

          <Text style={styles.fieldLabel}>Mobile</Text>
          <TextInput style={styles.input} value={mobile} onChangeText={setMobile} keyboardType="phone-pad" placeholder="10-digit mobile" placeholderTextColor="#A0AEC0" />

          <Text style={styles.fieldLabel}>WhatsApp</Text>
          <TextInput style={styles.input} value={whatsapp} onChangeText={setWhatsapp} keyboardType="phone-pad" placeholder="If different from mobile" placeholderTextColor="#A0AEC0" />

          <Text style={styles.fieldLabel}>Email</Text>
          <TextInput style={styles.input} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" placeholder="vendor@example.com" placeholderTextColor="#A0AEC0" />

          <Text style={styles.fieldLabel}>GST Number</Text>
          <TextInput style={styles.input} value={gstNumber} onChangeText={setGstNumber} autoCapitalize="characters" placeholder="GSTIN" placeholderTextColor="#A0AEC0" />

          <Text style={styles.fieldLabel}>Address</Text>
          <TextInput style={[styles.input, styles.multiline]} value={address} onChangeText={setAddress} multiline placeholder="Street, city, state, pincode" placeholderTextColor="#A0AEC0" />

          <Text style={styles.fieldLabel}>Vendor Location</Text>
          <View style={styles.locationRow}>
            <TouchableOpacity style={[styles.locationBtn, { flex: 1 }]} onPress={useCurrentLocationForVendor} disabled={locatingVendor}>
              {locatingVendor ? <ActivityIndicator color="#00796B" size="small" /> : <Text style={styles.locationBtnText}>📍 Current location</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={[styles.locationBtn, { flex: 1 }]} onPress={() => setPickerTarget('vendor')}>
              <Text style={styles.locationBtnText}>🗺️ Pick on map</Text>
            </TouchableOpacity>
          </View>
          {vendorLocation && (
            <Text style={styles.pickedNote}>{vendorLocation.latitude.toFixed(5)}, {vendorLocation.longitude.toFixed(5)}</Text>
          )}

          <View style={styles.sectionHeadRow}>
            <Text style={styles.sectionTitle}>Warehouses</Text>
            <Text style={styles.sectionNote}>One vendor, several godowns — add each one, and pin its location.</Text>
          </View>
          {warehouses.map((row, index) => (
            <View key={index} style={styles.warehouseRow}>
              <View style={{ flex: 1 }}>
                <TextInput
                  style={styles.input}
                  value={row.label}
                  onChangeText={(v) => updateWarehouse(index, 'label', v)}
                  placeholder="Label (e.g. Jaipur Godown)"
                  placeholderTextColor="#A0AEC0"
                />
                <TextInput
                  style={[styles.input, styles.multiline, { marginTop: verticalScale(8) }]}
                  value={row.address}
                  onChangeText={(v) => updateWarehouse(index, 'address', v)}
                  multiline
                  placeholder="Warehouse address"
                  placeholderTextColor="#A0AEC0"
                />
                {Number.isFinite(row.latitude) && (
                  <Text style={styles.pickedNote}>{row.latitude.toFixed(5)}, {row.longitude.toFixed(5)}</Text>
                )}
                <View style={styles.locationRow}>
                  <TouchableOpacity
                    style={[styles.locationBtn, { flex: 1 }]}
                    onPress={() => useCurrentLocationFor(index)}
                    disabled={locatingIndex === index}
                  >
                    {locatingIndex === index
                      ? <ActivityIndicator color="#00796B" size="small" />
                      : <Text style={styles.locationBtnText}>📍 Current location</Text>}
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.locationBtn, { flex: 1 }]} onPress={() => setPickerTarget(index)}>
                    <Text style={styles.locationBtnText}>🗺️ Pick on map</Text>
                  </TouchableOpacity>
                </View>
              </View>
              {warehouses.length > 1 && (
                <TouchableOpacity onPress={() => removeWarehouse(index)} style={styles.removeBtn}>
                  <Text style={styles.removeBtnText}>×</Text>
                </TouchableOpacity>
              )}
            </View>
          ))}
          <TouchableOpacity style={styles.addLinkBtn} onPress={addWarehouse}>
            <Text style={styles.addLinkText}>+ Add another warehouse</Text>
          </TouchableOpacity>

          <View style={styles.sectionHeadRow}>
            <Text style={styles.sectionTitle}>What do they sell us?</Text>
            <Text style={styles.sectionNote}>Only our own raw materials are listed here.</Text>
          </View>
          {loadingProducts ? (
            <ActivityIndicator color="#00796B" style={{ marginVertical: 16 }} />
          ) : rawMaterials.length === 0 ? (
            <Text style={styles.emptyNote}>
              No products are marked as raw material yet. Ask admin to set the Type on a few products first.
            </Text>
          ) : (
            <View style={styles.chipWrap}>
              {rawMaterials.map((product) => {
                const on = selectedProducts.includes(product._id);
                return (
                  <TouchableOpacity
                    key={product._id}
                    style={[styles.chip, on && styles.chipOn]}
                    onPress={() => toggleProduct(product._id)}
                  >
                    <Text style={[styles.chipText, on && styles.chipTextOn]}>{product.productName}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          <TouchableOpacity style={[styles.saveBtn, saving && styles.disabledBtn]} onPress={submit} disabled={saving}>
            {saving ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.saveBtnText}>Save Vendor</Text>}
          </TouchableOpacity>
          {!!uploadStage && <Text style={styles.uploadStage}>{uploadStage}…</Text>}
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal visible={pickerTarget !== null} animationType="slide" onRequestClose={() => setPickerTarget(null)}>
        <LocationPickerScreen
          initialLatitude={pickerStart?.latitude}
          initialLongitude={pickerStart?.longitude}
          onPick={handlePicked}
          onCancel={() => setPickerTarget(null)}
        />
      </Modal>
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

  scrollContent: { padding: scale(16), paddingBottom: verticalScale(60) },
  photoBtn: {
    height: verticalScale(120), borderRadius: 12, borderWidth: 1.5, borderColor: '#E2E8F0', borderStyle: 'dashed',
    alignItems: 'center', justifyContent: 'center', marginBottom: verticalScale(16), overflow: 'hidden', backgroundColor: '#FFFFFF',
  },
  photoBtnText: { color: '#718096', fontWeight: '700', fontSize: responsiveFontSize(13) },
  photoPreview: { width: '100%', height: '100%' },

  sectionTitle: { fontSize: responsiveFontSize(14), fontWeight: '800', color: '#2D3748', marginTop: verticalScale(8), marginBottom: verticalScale(10) },
  sectionHeadRow: { marginTop: verticalScale(20) },
  sectionNote: { fontSize: responsiveFontSize(11), color: '#A0AEC0', marginTop: -4, marginBottom: verticalScale(10) },

  fieldLabel: { fontSize: responsiveFontSize(11), fontWeight: '800', color: '#718096', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: verticalScale(6) },
  input: {
    height: verticalScale(44), backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 8,
    paddingHorizontal: scale(12), color: '#2D3748', fontSize: responsiveFontSize(14), marginBottom: verticalScale(14),
  },
  multiline: { height: verticalScale(72), paddingTop: verticalScale(10), textAlignVertical: 'top' },

  warehouseRow: { flexDirection: 'row', alignItems: 'flex-start', gap: scale(8), marginBottom: verticalScale(10) },
  locationRow: { flexDirection: 'row', gap: scale(8), marginBottom: verticalScale(14) },
  locationBtn: {
    height: verticalScale(38), borderRadius: 8, borderWidth: 1, borderColor: '#00796B', backgroundColor: '#F0FAF8',
    alignItems: 'center', justifyContent: 'center',
  },
  locationBtnText: { color: '#00796B', fontWeight: '700', fontSize: responsiveFontSize(11.5) },
  pickedNote: { color: '#718096', fontSize: responsiveFontSize(11), marginBottom: verticalScale(6) },
  removeBtn: { width: scale(30), height: verticalScale(30), borderRadius: 15, backgroundColor: '#FFF5F5', alignItems: 'center', justifyContent: 'center', marginTop: verticalScale(6) },
  removeBtnText: { color: '#E53E3E', fontSize: responsiveFontSize(18), fontWeight: '700' },
  addLinkBtn: { paddingVertical: verticalScale(8) },
  addLinkText: { color: '#00796B', fontWeight: '700', fontSize: responsiveFontSize(13) },

  emptyNote: { color: '#A0AEC0', fontSize: responsiveFontSize(12.5), fontStyle: 'italic', marginBottom: verticalScale(10) },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: scale(8), marginBottom: verticalScale(10) },
  chip: { paddingHorizontal: scale(14), paddingVertical: verticalScale(9), borderRadius: 20, borderWidth: 1, borderColor: '#E2E8F0', backgroundColor: '#FFFFFF' },
  chipOn: { backgroundColor: '#00796B', borderColor: '#00796B' },
  chipText: { color: '#4A5568', fontSize: responsiveFontSize(12.5), fontWeight: '650' },
  chipTextOn: { color: '#FFFFFF' },

  saveBtn: { backgroundColor: '#00796B', borderRadius: 10, height: verticalScale(48), alignItems: 'center', justifyContent: 'center', marginTop: verticalScale(24) },
  disabledBtn: { opacity: 0.6 },
  saveBtnText: { color: '#FFFFFF', fontWeight: '800', fontSize: responsiveFontSize(15) },
  uploadStage: { textAlign: 'center', color: '#A0AEC0', fontSize: responsiveFontSize(11), marginTop: verticalScale(10) },
});
