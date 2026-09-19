import React, { useRef } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, SafeAreaView } from 'react-native';
import { WebView } from 'react-native-webview';
import { scale, verticalScale, responsiveFontSize } from '../utils/responsive';

/**
 * A map to drop a pin on, for when "where I'm standing" is the wrong answer —
 * a warehouse address written down from somewhere else, a vendor location set
 * up before ever visiting.
 *
 * Free OpenStreetMap tiles in a WebView rather than a native maps SDK: this
 * app has no Google Maps API key to give one, and the admin panel already
 * draws every one of its own maps the same way — Leaflet, no key required.
 */
export default function LocationPickerScreen({ initialLatitude, initialLongitude, onPick, onCancel }) {
  const webRef = useRef(null);
  const start = {
    lat: Number.isFinite(Number(initialLatitude)) ? Number(initialLatitude) : 26.9124,
    lng: Number.isFinite(Number(initialLongitude)) ? Number(initialLongitude) : 75.7873,
    zoom: Number.isFinite(Number(initialLatitude)) ? 15 : 12,
  };

  const html = `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css" />
<style>
  html, body, #map { height: 100%; margin: 0; padding: 0; }
  .pin-label { background: #00796B; color: #fff; padding: 4px 8px; border-radius: 6px; font: 600 12px system-ui; white-space: nowrap; }
</style>
</head><body>
<div id="map"></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"></script>
<script>
  const map = L.map('map').setView([${start.lat}, ${start.lng}], ${start.zoom});
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap' }).addTo(map);
  const marker = L.marker([${start.lat}, ${start.lng}], { draggable: true }).addTo(map)
    .bindTooltip('Drag me, or tap the map', { permanent: false });
  map.on('click', (e) => marker.setLatLng(e.latlng));
  window.getPin = () => { const p = marker.getLatLng(); return { latitude: p.lat, longitude: p.lng }; };
</script>
</body></html>`;

  const confirm = () => {
    webRef.current?.injectJavaScript('window.ReactNativeWebView.postMessage(JSON.stringify(window.getPin())); true;');
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.topHeader}>
        <TouchableOpacity onPress={onCancel} style={styles.backBtn}>
          <Text style={styles.backBtnText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.topHeaderTitle}>Pick a location</Text>
        <View style={{ width: 36 }} />
      </View>

      <WebView
        ref={webRef}
        originWhitelist={['*']}
        source={{ html }}
        style={{ flex: 1 }}
        onMessage={(event) => {
          try {
            const point = JSON.parse(event.nativeEvent.data);
            if (Number.isFinite(point.latitude) && Number.isFinite(point.longitude)) onPick(point);
          } catch { /* ignore a stray message */ }
        }}
      />

      <View style={styles.footer}>
        <Text style={styles.hint}>Drag the pin, or tap the map, to the right spot.</Text>
        <TouchableOpacity style={styles.confirmBtn} onPress={confirm}>
          <Text style={styles.confirmBtnText}>Use this location</Text>
        </TouchableOpacity>
      </View>
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
  footer: { backgroundColor: '#FFFFFF', borderTopWidth: 1, borderTopColor: '#E2E8F0', padding: scale(16) },
  hint: { fontSize: responsiveFontSize(11.5), color: '#718096', textAlign: 'center', marginBottom: verticalScale(10) },
  confirmBtn: { backgroundColor: '#00796B', borderRadius: 10, height: verticalScale(46), alignItems: 'center', justifyContent: 'center' },
  confirmBtnText: { color: '#FFFFFF', fontWeight: '800', fontSize: responsiveFontSize(14) },
});
