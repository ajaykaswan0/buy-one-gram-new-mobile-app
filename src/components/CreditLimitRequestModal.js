import React, { useState } from 'react';
import { useLanguage } from '../i18n';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  TextInput,
  Modal,
  Image,
  ActivityIndicator,
  ScrollView,
  Alert,
} from 'react-native';
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';
import { uploadFile } from '../services/firebaseUploadService';
import { uploadPhoto } from '../services/photoUpload';
import { readJson } from '../services/apiResponse';

const money = (value) => `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/**
 * Asks an admin to raise a party's credit limit.
 *
 * Opened from wherever the salesman is stopped by the ceiling, so it shows what
 * the limit is and what is already owed — he is arguing for a number and needs
 * to see what he is arguing against.
 *
 * A photo is asked for rather than demanded: a request with a reason and no
 * picture is still worth sending, and refusing to send it would just mean the
 * salesman phones someone instead.
 */
export default function CreditLimitRequestModal({
  visible,
  onClose,
  party,
  creditLimit,
  currentOutstanding,
  suggested,
  apiUrl,
  token,
  onSubmitted,
}) {
  const { t } = useLanguage();
  const [amount, setAmount] = useState(suggested ? String(Math.ceil(suggested)) : '');
  const [reason, setReason] = useState('');
  const [photo, setPhoto] = useState(null);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setAmount(suggested ? String(Math.ceil(suggested)) : '');
    setReason('');
    setPhoto(null);
  };

  const pickPhoto = (fromCamera) => {
    const handler = fromCamera ? launchCamera : launchImageLibrary;
    handler({ mediaType: 'photo', quality: 0.5, maxWidth: 1600, maxHeight: 1600, includeBase64: true }, (response) => {
      if (response.didCancel) return;
      if (response.errorCode) {
        Alert.alert('Photo', response.errorMessage || 'Could not open the camera.');
        return;
      }
      const asset = response.assets?.[0];
      if (asset) setPhoto(asset);
    });
  };

  const submit = async () => {
    const asked = Number(amount);
    if (!Number.isFinite(asked) || asked <= 0) {
      Alert.alert('How much?', 'Enter the credit limit you need for this party.');
      return;
    }
    if (asked <= Number(creditLimit || 0)) {
      Alert.alert('Ask for more', `${party?.partyName} already has ${money(creditLimit)}. Ask for a higher figure.`);
      return;
    }
    if (!reason.trim()) {
      Alert.alert('Why?', 'Say why the increase is needed — an admin cannot judge it otherwise.');
      return;
    }

    setBusy(true);
    try {
      // Uploaded the same way as every other proof, falling back to the base64
      // route when the signed upload is unavailable.
      let proofPhoto = '';
      if (photo) {
        try {
          const uploaded = await uploadFile({
            file: photo, module: 'party', relatedModel: 'Party', relatedId: party?._id, token, apiUrl,
          });
          proofPhoto = uploaded.storagePath || uploaded.url || '';
        } catch (uploadError) {
          console.log('[CreditRequest] signed upload failed, falling back:', uploadError.message);
        }
        if (!proofPhoto && photo.base64) {
          proofPhoto = await uploadPhoto({ base64: photo.base64, apiUrl, token, module: 'parties' });
        }
      }

      const response = await fetch(`${apiUrl}/credit-limit-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          partyId: party?._id,
          requestedLimit: asked,
          reason: reason.trim(),
          proofPhoto,
        }),
      });
      const data = await readJson(response, 'The server');

      Alert.alert('Sent', data.message || 'An admin will review it.');
      reset();
      onSubmitted?.(data.data);
      onClose();
    } catch (error) {
      Alert.alert('Could not send', error.message);
    } finally {
      setBusy(false);
    }
  };

  const asked = Number(amount);
  const increase = Number.isFinite(asked) ? asked - Number(creditLimit || 0) : 0;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.scrim}>
        <View style={styles.card}>
          <View style={styles.head}>
            <Text style={styles.title}>{t('Ask for more credit')}</Text>
            <TouchableOpacity onPress={onClose}><Text style={styles.close}>✕</Text></TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={{ paddingBottom: 8 }} keyboardShouldPersistTaps="handled">
            <Text style={styles.party}>{party?.partyName}</Text>
            <View style={styles.figures}>
              <View style={styles.figure}>
                <Text style={styles.figureLabel}>{t('Limit now')}</Text>
                <Text style={styles.figureValue}>{money(creditLimit)}</Text>
              </View>
              <View style={styles.figure}>
                <Text style={styles.figureLabel}>{t('Already owed')}</Text>
                <Text style={[styles.figureValue, { color: '#C53030' }]}>{money(currentOutstanding)}</Text>
              </View>
            </View>

            <Text style={styles.label}>{t('New limit needed *')}</Text>
            <TextInput
              style={styles.input}
              keyboardType="numeric"
              placeholder="e.g. 200000"
              placeholderTextColor="#A0AEC0"
              value={amount}
              onChangeText={setAmount}
            />
            {increase > 0 && (
              <Text style={styles.increaseNote}>An increase of {money(increase)}.</Text>
            )}

            <Text style={styles.label}>{t('Why is it needed? *')}</Text>
            <TextInput
              style={[styles.input, styles.textarea]}
              multiline
              numberOfLines={4}
              placeholder="e.g. Festival stocking. Party has cleared every bill on time for two years."
              placeholderTextColor="#A0AEC0"
              value={reason}
              onChangeText={setReason}
            />

            <Text style={styles.label}>{t('Photo proof')}</Text>
            {photo ? (
              <View style={styles.photoRow}>
                <Image source={{ uri: photo.uri }} style={styles.photoThumb} />
                <TouchableOpacity onPress={() => setPhoto(null)}>
                  <Text style={styles.removePhoto}>{t('Remove')}</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.photoBtns}>
                <TouchableOpacity style={styles.photoBtn} onPress={() => pickPhoto(true)}>
                  <Text style={styles.photoBtnText}>📷 Take photo</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.photoBtn} onPress={() => pickPhoto(false)}>
                  <Text style={styles.photoBtnText}>🖼 Choose</Text>
                </TouchableOpacity>
              </View>
            )}
            <Text style={styles.photoHint}>Optional, but a request with proof is decided faster.</Text>
          </ScrollView>

          <TouchableOpacity style={[styles.submit, busy && styles.submitBusy]} disabled={busy} onPress={submit}>
            {busy
              ? <View style={styles.row}><ActivityIndicator color="#FFF" size="small" /><Text style={styles.submitText}>  {t('Sending…')}</Text></View>
              : <Text style={styles.submitText}>{t('Send request to admin')}</Text>}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  card: {
    backgroundColor: '#FFFFFF', borderTopLeftRadius: 18, borderTopRightRadius: 18,
    padding: 20, maxHeight: '92%',
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  title: { fontSize: 17, fontWeight: '800', color: '#1A202C' },
  close: { fontSize: 18, color: '#718096', paddingHorizontal: 6 },
  party: { fontSize: 14, fontWeight: '700', color: '#00695C', marginBottom: 10 },

  figures: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  figure: {
    flex: 1, padding: 12, borderRadius: 10, backgroundColor: '#F7FAFC',
  },
  figureLabel: { fontSize: 11, color: '#718096' },
  figureValue: { fontSize: 15, fontWeight: '800', color: '#1A202C', marginTop: 2 },

  label: { fontSize: 12, fontWeight: '700', color: '#4A5568', marginTop: 12, marginBottom: 6 },
  input: {
    borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: '#1A202C',
  },
  textarea: { minHeight: 92, textAlignVertical: 'top' },
  increaseNote: { fontSize: 11.5, color: '#2F855A', marginTop: 6, fontWeight: '600' },

  photoBtns: { flexDirection: 'row', gap: 10 },
  photoBtn: {
    flex: 1, paddingVertical: 12, borderRadius: 10,
    borderWidth: 1, borderColor: '#CBD5E0', alignItems: 'center',
  },
  photoBtnText: { fontSize: 13, fontWeight: '700', color: '#4A5568' },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  photoThumb: { width: 84, height: 84, borderRadius: 10, backgroundColor: '#EDF2F7' },
  removePhoto: { color: '#C53030', fontWeight: '700', fontSize: 13 },
  photoHint: { fontSize: 11, color: '#A0AEC0', marginTop: 6 },

  submit: {
    marginTop: 16, backgroundColor: '#00796B',
    paddingVertical: 15, borderRadius: 10, alignItems: 'center',
  },
  submitBusy: { opacity: 0.7 },
  submitText: { color: '#FFFFFF', fontWeight: '800', fontSize: 14 },
  row: { flexDirection: 'row', alignItems: 'center' },
});
