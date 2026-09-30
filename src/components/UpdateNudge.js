import React, { useEffect, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, Linking } from 'react-native';
import { API_URL } from '../config/api';
import { CURRENT_APP_VERSION } from '../config/appVersion';

const PLAY_STORE_ID = 'com.buyonegram.buy1gramemployee';

/**
 * Is `latest` a real step ahead of `installed`?
 *
 * Compared part by part rather than as strings or plain numbers — "1.9" is
 * not less than "1.10" to a human, but it is to `<`, and "2.0" turned into
 * the number 2 would tie with a genuine "2" instead of losing to it.
 */
const isOutdated = (installed, latest) => {
  const a = String(installed).split('.').map((n) => parseInt(n, 10) || 0);
  const b = String(latest).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x < y) return true;
    if (x > y) return false;
  }
  return false;
};

/**
 * A one-time nudge when a newer build is out.
 *
 * Reads the same startup call the login screen already makes for branding
 * — no session needed, no extra round trip — so this works whether or not
 * anyone is signed in yet. Dismissible, not a lock-out: a typo in the
 * admin-set version should never be able to strand everyone outside the app.
 */
export default function UpdateNudge() {
  const [latestVersion, setLatestVersion] = useState('');
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let active = true;
    fetch(`${API_URL}/app-settings/branding`)
      .then((res) => res.json())
      .then((json) => {
        if (active && json?.data?.latestAppVersion) setLatestVersion(json.data.latestAppVersion);
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  const visible = !dismissed && latestVersion && isOutdated(CURRENT_APP_VERSION, latestVersion);

  const openStore = () => {
    const marketUrl = `market://details?id=${PLAY_STORE_ID}`;
    const webUrl = `https://play.google.com/store/apps/details?id=${PLAY_STORE_ID}`;
    Linking.openURL(marketUrl).catch(() => Linking.openURL(webUrl).catch(() => {}));
  };

  return (
    <Modal visible={!!visible} transparent animationType="fade" onRequestClose={() => setDismissed(true)}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>Update available</Text>
          <Text style={styles.body}>
            A newer version ({latestVersion}) is out. Update for the latest fixes and features.
          </Text>
          <TouchableOpacity style={styles.updateBtn} onPress={openStore}>
            <Text style={styles.updateBtnText}>Update Now</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.laterBtn} onPress={() => setDismissed(true)}>
            <Text style={styles.laterBtnText}>Later</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 340, backgroundColor: '#FFFFFF', borderRadius: 14, padding: 20 },
  title: { fontSize: 18, fontWeight: '800', color: '#1A202C', marginBottom: 8 },
  body: { fontSize: 14, color: '#4A5568', marginBottom: 18, lineHeight: 20 },
  updateBtn: { backgroundColor: '#00796B', borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginBottom: 8 },
  updateBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 },
  laterBtn: { paddingVertical: 8, alignItems: 'center' },
  laterBtnText: { color: '#718096', fontWeight: '600', fontSize: 13 },
});
