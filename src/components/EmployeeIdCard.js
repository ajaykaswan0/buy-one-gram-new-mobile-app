import React, { useEffect, useState } from 'react';
import { Modal, View, Text, Image, TouchableOpacity, StyleSheet, Pressable } from 'react-native';
import { useLanguage } from '../i18n';
import { FirebaseImage } from '../services/firebaseUploadService';
import { scale, verticalScale, responsiveFontSize } from '../utils/responsive';
import { bottomBarPadding } from '../utils/systemBars';
import { fileUrl } from '../config/api';

/**
 * The card a salesman shows at a shop door.
 *
 * A shopkeeper being asked to hand over cash reasonably wants to know who he is
 * handing it to, and "he had the app" is not an answer. This puts the company's
 * name and logo, his photo, his name and his number on one screen he can hold
 * up — the same thing a printed card would do.
 *
 * Nothing here is a security control: it proves nothing a determined person
 * could not fake. It is for the ordinary case, where a shopkeeper simply wants
 * to see who is at the counter.
 */
export default function EmployeeIdCard({ visible, user, token, apiUrl, onClose }) {
  const { t } = useLanguage();
  const [branding, setBranding] = useState(null);

  useEffect(() => {
    if (!visible) return;
    fetch(`${apiUrl}/app-settings/branding`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => setBranding(data?.data || null))
      .catch(() => { /* the card still works without the company's own name */ });
  }, [visible, apiUrl]);

  if (!visible) return null;

  const role = String(user?.roleName || user?.role?.name || user?.role || '')
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

  // The tail of the account id: short enough to read out, unique enough to
  // find the person by. Not a secret — it appears on every record he touches.
  const staffNumber = String(user?._id || user?.id || '').slice(-6).toUpperCase();
  const initials = String(user?.name || '?').trim().split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.wrap} pointerEvents="box-none">
        <View style={styles.card}>
          <View style={styles.cardTop}>
            {branding?.logo
              ? <Image source={{ uri: fileUrl(branding.logo) }} style={styles.logo} resizeMode="contain" />
              : <Text style={styles.company}>{branding?.appName || 'Buy 1 Gram'}</Text>}
            {branding?.logo && <Text style={styles.companySmall}>{branding.appName || ''}</Text>}
          </View>

          <View style={styles.photoWrap}>
            {user?.profileImage ? (
              <FirebaseImage
                source={{ uri: user.profileImage }}
                style={styles.photo}
                token={token}
                apiUrl={apiUrl}
                fallback={<View style={styles.photoFallback}><Text style={styles.initials}>{initials}</Text></View>}
              />
            ) : (
              <View style={styles.photoFallback}><Text style={styles.initials}>{initials}</Text></View>
            )}
          </View>

          <Text style={styles.name} numberOfLines={2}>{user?.name || '—'}</Text>
          <Text style={styles.role}>{role || 'Field Staff'}</Text>

          <View style={styles.divider} />

          <View style={styles.row}>
            <Text style={styles.label}>{t('Staff No.')}</Text>
            <Text style={styles.value}>{staffNumber || '—'}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>{t('Mobile')}</Text>
            <Text style={styles.value}>{user?.mobile || '—'}</Text>
          </View>
          {user?.email ? (
            <View style={styles.row}>
              <Text style={styles.label}>{t('Email')}</Text>
              <Text style={styles.value} numberOfLines={1}>{user.email}</Text>
            </View>
          ) : null}
          {user?.vehicleNumber ? (
            <View style={styles.row}>
              <Text style={styles.label}>{t('Vehicle')}</Text>
              <Text style={styles.value}>{user.vehicleNumber}</Text>
            </View>
          ) : null}

          <Text style={styles.foot}>
            {branding?.appTagline || t('If this card is misused, call the number on your invoice.')}
          </Text>
        </View>

        <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
          <Text style={styles.closeText}>{t('Close')}</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.72)' },
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: bottomBarPadding() },

  card: {
    width: scale(280),
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    paddingHorizontal: scale(20),
    paddingTop: verticalScale(18),
    paddingBottom: verticalScale(18),
    alignItems: 'center',
    elevation: 12,
  },
  cardTop: { alignItems: 'center', marginBottom: verticalScale(12) },
  logo: { width: scale(120), height: verticalScale(34) },
  company: { fontSize: responsiveFontSize(16), fontWeight: '900', color: '#00796B', letterSpacing: 0.5 },
  companySmall: { fontSize: responsiveFontSize(9), color: '#718096', marginTop: 2, letterSpacing: 0.6 },

  photoWrap: {
    width: scale(96), height: scale(96), borderRadius: scale(48),
    overflow: 'hidden', borderWidth: 3, borderColor: '#00796B',
    marginBottom: verticalScale(10), backgroundColor: '#E6FFFA',
  },
  photo: { width: '100%', height: '100%' },
  photoFallback: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', backgroundColor: '#B2DFDB' },
  initials: { fontSize: responsiveFontSize(28), fontWeight: '800', color: '#00695C' },

  name: { fontSize: responsiveFontSize(17), fontWeight: '800', color: '#1A202C', textAlign: 'center' },
  role: {
    fontSize: responsiveFontSize(10), fontWeight: '700', color: '#00796B',
    textTransform: 'uppercase', letterSpacing: 1, marginTop: 2,
  },

  divider: { height: 1, backgroundColor: '#E2E8F0', alignSelf: 'stretch', marginVertical: verticalScale(12) },

  row: { flexDirection: 'row', justifyContent: 'space-between', alignSelf: 'stretch', marginBottom: verticalScale(6) },
  label: { fontSize: responsiveFontSize(10), color: '#718096', fontWeight: '600' },
  value: { fontSize: responsiveFontSize(11), color: '#2D3748', fontWeight: '700', maxWidth: '62%', textAlign: 'right' },

  foot: {
    fontSize: responsiveFontSize(8), color: '#A0AEC0', textAlign: 'center',
    marginTop: verticalScale(12), lineHeight: responsiveFontSize(12),
  },

  closeBtn: { marginTop: verticalScale(18), paddingHorizontal: scale(26), paddingVertical: verticalScale(10), borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,255,255,0.5)' },
  closeText: { color: '#FFFFFF', fontWeight: '700', fontSize: responsiveFontSize(12) },
});
