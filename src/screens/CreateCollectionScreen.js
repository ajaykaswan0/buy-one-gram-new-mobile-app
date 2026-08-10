import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  SafeAreaView,
  ScrollView,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import Geolocation from '@react-native-community/geolocation';
import { launchCamera } from 'react-native-image-picker';

export default function CreateCollectionScreen({ token, apiUrl, party, onBack }) {
  const [amount, setAmount] = useState('');
  const [paymentMode, setPaymentMode] = useState('cash'); // 'cash', 'cheque', 'upi', 'bank_transfer', 'other'
  
  // Cheque details
  const [chequeNumber, setChequeNumber] = useState('');
  const [chequeDate, setChequeDate] = useState('');
  const [bankName, setBankName] = useState('');

  // Online details
  const [transactionRef, setTransactionRef] = useState('');

  // Photo receipt
  const [receiptPhoto, setReceiptPhoto] = useState('');

  const [remarks, setRemarks] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // GPS Coordinates
  const [fetchingLocation, setFetchingLocation] = useState(false);
  const [latitude, setLatitude] = useState(null);
  const [longitude, setLongitude] = useState(null);

  // Load GPS coords on mount
  useEffect(() => {
    const fetchLocation = async () => {
      setFetchingLocation(true);
      try {
        if (Platform.OS === 'android') {
          await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
        }
        Geolocation.getCurrentPosition(
          (position) => {
            setLatitude(position.coords.latitude);
            setLongitude(position.coords.longitude);
            setFetchingLocation(false);
          },
          (error) => {
            console.warn('GPS location fetch for collection failed:', error.message);
            setFetchingLocation(false);
          },
          { enableHighAccuracy: false, timeout: 15000, maximumAge: 10000 }
        );
      } catch (e) {
        console.warn('GPS location fetch for collection failed:', e.message);
        setFetchingLocation(false);
      }
    };
    fetchLocation();
  }, []);

  const handleCapturePhoto = () => {
    launchCamera(
      {
        mediaType: 'photo',
        quality: 0.3,
        includeBase64: true,
      },
      (response) => {
        if (response.didCancel) return;
        if (response.errorCode) {
          Alert.alert('Camera Error', response.errorMessage || 'Failed to start camera.');
          return;
        }
        setReceiptPhoto(response.assets[0].base64);
      }
    );
  };

  const handleRecordCollection = async () => {
    if (!amount.trim() || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
      Alert.alert('Required', 'Please enter a valid collection amount.');
      return;
    }

    if (paymentMode === 'cheque') {
      if (!chequeNumber.trim()) {
        Alert.alert('Required', 'Please enter the cheque number.');
        return;
      }
      if (!bankName.trim()) {
        Alert.alert('Required', 'Please enter the bank name.');
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(`${apiUrl}/collection`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          partyId: party._id,
          amount: parseFloat(amount),
          paymentMode,
          chequeNumber: paymentMode === 'cheque' ? chequeNumber.trim() : undefined,
          chequeDate: paymentMode === 'cheque' ? chequeDate.trim() || undefined : undefined,
          bankName: paymentMode === 'cheque' ? bankName.trim() : undefined,
          transactionRef: ['upi', 'bank_transfer'].includes(paymentMode) ? transactionRef.trim() : undefined,
          receiptPhoto: receiptPhoto ? `data:image/jpeg;base64,${receiptPhoto}` : undefined,
          latitude,
          longitude,
          remarks: remarks.trim() || undefined,
        }),
      });

      const data = await response.json();
      if (response.ok && data.success) {
        Alert.alert('Success', 'Collection logged successfully!');
        onBack();
      } else {
        Alert.alert('Failed', data.message || 'Could not record collection.');
      }
    } catch (e) {
      console.warn('Collection create error:', e.message);
      Alert.alert('Error', 'Connection error.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={onBack}>
            <Text style={styles.backBtnText}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>New Collection</Text>
          <View style={{ width: 36 }} />
        </View>

        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        {/* Party Info card */}
        <View style={styles.partyCard}>
          <Text style={styles.partyName}>{party.partyName || party.name}</Text>
          <Text style={styles.partyCode}>Code: {party.partyCode} • Mobile: {party.mobile}</Text>
          <Text style={styles.partyOutstanding}>
            Outstanding: ₹{party.currentOutstanding?.toLocaleString('en-IN') || 0}
          </Text>
        </View>

        {/* Amount Input */}
        <Text style={styles.fieldLabel}>Collection Amount (INR) *</Text>
        <TextInput
          style={styles.amountInput}
          placeholder="Enter collected amount..."
          placeholderTextColor="#A0AEC0"
          keyboardType="numeric"
          value={amount}
          onChangeText={setAmount}
        />

        {/* Payment Mode Selector */}
        <Text style={styles.fieldLabel}>Payment Mode *</Text>
        <View style={styles.modeGrid}>
          {[
            { label: '💵 Cash', value: 'cash' },
            { label: '🏦 Cheque', value: 'cheque' },
            { label: '📱 UPI', value: 'upi' },
            { label: '💳 Transfer', value: 'bank_transfer' },
            { label: '❓ Other', value: 'other' },
          ].map((mode) => (
            <TouchableOpacity
              key={mode.value}
              style={[
                styles.modeCard,
                paymentMode === mode.value && styles.activeModeCard,
              ]}
              onPress={() => setPaymentMode(mode.value)}
            >
              <Text
                style={[
                  styles.modeText,
                  paymentMode === mode.value && styles.activeModeText,
                ]}
              >
                {mode.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Cheque Fields */}
        {paymentMode === 'cheque' && (
          <View style={styles.conditionalBlock}>
            <Text style={styles.fieldLabel}>Cheque Number *</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. 123456"
              placeholderTextColor="#A0AEC0"
              value={chequeNumber}
              onChangeText={setChequeNumber}
            />

            <Text style={styles.fieldLabel}>Cheque Date (Optional)</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. YYYY-MM-DD"
              placeholderTextColor="#A0AEC0"
              value={chequeDate}
              onChangeText={setChequeDate}
            />

            <Text style={styles.fieldLabel}>Bank Name *</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. HDFC Bank, SBI"
              placeholderTextColor="#A0AEC0"
              value={bankName}
              onChangeText={setBankName}
            />
          </View>
        )}

        {/* UPI & Bank Transfer Fields */}
        {['upi', 'bank_transfer'].includes(paymentMode) && (
          <View style={styles.conditionalBlock}>
            <Text style={styles.fieldLabel}>Transaction Reference / UTR *</Text>
            <TextInput
              style={styles.input}
              placeholder="Reference number or transaction ID"
              placeholderTextColor="#A0AEC0"
              value={transactionRef}
              onChangeText={setTransactionRef}
            />
          </View>
        )}

        {/* Receipt photo */}
        <Text style={styles.fieldLabel}>Proof / Receipt Photo (Optional)</Text>
        <TouchableOpacity style={styles.photoBtn} onPress={handleCapturePhoto}>
          <Text style={styles.photoBtnText}>📸 Capture Cash/Cheque Photo</Text>
        </TouchableOpacity>
        {receiptPhoto ? (
          <Text style={styles.photoSuccessText}>✓ Receipt photo attached successfully</Text>
        ) : null}

        {/* Remarks */}
        <Text style={styles.fieldLabel}>Remarks / Special Notes</Text>
        <TextInput
          style={[styles.input, styles.textarea]}
          placeholder="Any payment references or guidelines..."
          placeholderTextColor="#A0AEC0"
          multiline
          numberOfLines={3}
          value={remarks}
          onChangeText={setRemarks}
        />

        {/* GPS location display */}
        <View style={styles.locationContainer}>
          {fetchingLocation ? (
            <ActivityIndicator size="small" color="#00796B" />
          ) : latitude && longitude ? (
            <Text style={styles.locationText}>
              📍 GPS Location auto-saved: {latitude.toFixed(5)}, {longitude.toFixed(5)}
            </Text>
          ) : (
            <Text style={styles.locationErrorText}>⚠️ Could not load GPS coordinates</Text>
          )}
        </View>

        {/* Submit */}
        <TouchableOpacity
          style={[styles.submitBtn, isSubmitting && styles.disabledBtn]}
          onPress={handleRecordCollection}
          disabled={isSubmitting}
        >
          {isSubmitting ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : (
            <Text style={styles.submitBtnText}>Record Payment Collection</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F7F9FC',
  },
  header: {
    height: 56,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  backBtn: {
    paddingVertical: 8,
    paddingRight: 16,
  },
  backBtnText: {
    color: '#00796B',
    fontWeight: '700',
    fontSize: 14.5,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#2D3748',
  },

  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  partyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 16,
    marginBottom: 20,
  },
  partyName: {
    fontSize: 15,
    fontWeight: '800',
    color: '#2D3748',
  },
  partyCode: {
    fontSize: 11.5,
    color: '#718096',
    fontWeight: '600',
    marginTop: 3,
  },
  partyOutstanding: {
    fontSize: 13,
    fontWeight: '800',
    color: '#E53E3E',
    marginTop: 8,
  },

  fieldLabel: {
    fontSize: 10.5,
    fontWeight: '800',
    color: '#718096',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  amountInput: {
    height: 48,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#00796B',
    borderRadius: 10,
    paddingHorizontal: 16,
    fontSize: 16,
    fontWeight: '800',
    color: '#2D3748',
    marginBottom: 20,
  },

  // Payment mode grid
  modeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 20,
  },
  modeCard: {
    flexGrow: 1,
    flexBasis: '30%',
    height: 40,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeModeCard: {
    backgroundColor: '#E6FFFA',
    borderColor: '#00796B',
  },
  modeText: {
    fontSize: 12.5,
    fontWeight: '650',
    color: '#4A5568',
  },
  activeModeText: {
    color: '#00796B',
    fontWeight: '800',
  },

  conditionalBlock: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    padding: 14,
    marginBottom: 20,
    gap: 12,
  },
  input: {
    height: 40,
    backgroundColor: '#F7F9FC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    paddingHorizontal: 12,
    color: '#2D3748',
    fontSize: 13.5,
  },
  textarea: {
    height: 70,
    textAlignVertical: 'top',
    paddingVertical: 10,
    marginBottom: 20,
  },

  photoBtn: {
    height: 40,
    backgroundColor: '#EDF2F7',
    borderWidth: 1,
    borderColor: '#CBD5E0',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  photoBtnText: {
    fontSize: 13,
    color: '#4A5568',
    fontWeight: '700',
  },
  photoSuccessText: {
    fontSize: 12,
    color: '#38A169',
    fontWeight: '700',
    marginBottom: 20,
  },

  locationContainer: {
    marginBottom: 20,
    padding: 8,
  },
  locationText: {
    fontSize: 11,
    color: '#718096',
    fontWeight: '650',
  },
  locationErrorText: {
    fontSize: 11,
    color: '#E53E3E',
    fontWeight: '600',
  },

  submitBtn: {
    height: 48,
    backgroundColor: '#00796B',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabledBtn: {
    opacity: 0.65,
  },
  submitBtnText: {
    color: '#FFFFFF',
    fontSize: 14.5,
    fontWeight: '800',
  },
});
