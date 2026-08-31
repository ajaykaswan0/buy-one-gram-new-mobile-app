import React, { useCallback, useEffect, useState } from 'react';
import {
  SafeAreaView, View, Text, Image, TouchableOpacity, ActivityIndicator,
  StyleSheet, ScrollView, RefreshControl, Dimensions,
} from 'react-native';
import { useLanguage } from '../i18n';
import { scale, verticalScale, responsiveFontSize } from '../utils/responsive';

/**
 * The delivery route, as the picture the office drew.
 *
 * Whoever plans the round already draws it once — on a whiteboard, in a
 * spreadsheet, on a printed map. This shows that drawing full-screen rather
 * than rebuilding it as data, which would mean keeping a second copy in step
 * with the first and getting it wrong the first week somebody forgot.
 *
 * Pinch to zoom is deliberately not wired up: the image is served at whatever
 * size it was uploaded, and a route photographed legibly reads fine scaled to
 * the screen. Scrolling handles a tall one.
 */
export default function DeliveryRouteScreen({ apiUrl, onBack }) {
  const { t } = useLanguage();
  const [image, setImage] = useState('');
  const [updatedAt, setUpdatedAt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const response = await fetch(`${apiUrl}/app-settings/branding`);
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.message || 'Could not load the route');
      setImage(data.data?.deliveryRouteImage || '');
      setUpdatedAt(data.data?.deliveryRouteUpdatedAt || null);
    } catch (e) {
      setError(e.message || 'Could not load the route');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [apiUrl]);

  useEffect(() => { load(); }, [load]);

  const screen = Dimensions.get('window');

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack}>
          <Text style={styles.back}>‹ {t('Back')}</Text>
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{t('Delivery Route')}</Text>
          {updatedAt ? (
            <Text style={styles.subtitle}>
              {t('Updated')} {new Date(updatedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
            </Text>
          ) : null}
        </View>
      </View>

      {loading ? (
        <View style={styles.centre}><ActivityIndicator size="large" color="#00796B" /></View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.body}
          maximumZoomScale={4}
          minimumZoomScale={1}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
        >
          {error ? <Text style={styles.error}>{error}</Text> : null}

          {image ? (
            <Image
              source={{ uri: image }}
              style={[styles.route, { width: screen.width, height: screen.height - verticalScale(120) }]}
              resizeMode="contain"
            />
          ) : (
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>🗺️</Text>
              <Text style={styles.emptyTitle}>{t('No route uploaded yet')}</Text>
              <Text style={styles.emptyText}>
                {t('The office has not put up a delivery route. Ask an admin to upload one in Settings.')}
              </Text>
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0F172A' },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: scale(14),
    padding: scale(16), backgroundColor: '#00796B',
  },
  back: { color: '#fff', fontWeight: '800', fontSize: responsiveFontSize(13) },
  title: { color: '#fff', fontSize: responsiveFontSize(17), fontWeight: '900' },
  subtitle: { color: '#B2DFDB', fontSize: responsiveFontSize(10), marginTop: 1 },

  centre: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
  route: { backgroundColor: '#0F172A' },

  error: { color: '#FCA5A5', margin: scale(16), textAlign: 'center' },
  empty: { alignItems: 'center', padding: scale(40) },
  emptyIcon: { fontSize: responsiveFontSize(40), marginBottom: verticalScale(10) },
  emptyTitle: { color: '#fff', fontSize: responsiveFontSize(16), fontWeight: '800' },
  emptyText: {
    color: '#94A3B8', fontSize: responsiveFontSize(12), textAlign: 'center',
    marginTop: verticalScale(8), lineHeight: responsiveFontSize(18),
  },
});
