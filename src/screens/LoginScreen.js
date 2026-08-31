import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  SafeAreaView,
  Image,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { API_URL, fileUrl } from '../config/api';

export default function LoginScreen({ onLoginSuccess }) {
  const [mobile, setMobile] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  /**
   * What the company calls itself, read from the server.
   *
   * The name and logo live in admin Settings, so they can be changed without
   * building and shipping a new app. Only the label under the launcher icon is
   * fixed at build time — Android compiles that one in, and nothing can change
   * it from the server.
   *
   * The built-in name below is the fallback: it is what shows before the call
   * returns, and on a phone with no signal.
   */
  const [branding, setBranding] = useState(null);

  useEffect(() => {
    let alive = true;
    fetch(`${API_URL}/app-settings/branding`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => { if (alive && data?.data) setBranding(data.data); })
      .catch(() => { /* offline, or an older server: the built-in name stands */ });
    return () => { alive = false; };
  }, []);

  const handleLogin = async () => {
    if (!mobile.trim() || !password.trim()) {
      setError('Please fill in all fields.');
      return;
    }

    setError('');
    setLoading(true);

    try {
      const response = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          mobile: mobile.trim(),
          password: password.trim(),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Login failed. Please check credentials.');
      }

      await AsyncStorage.setItem('token', data.token);
      await AsyncStorage.setItem('user', JSON.stringify(data.user));

      onLoginSuccess(data.token, data.user, API_URL);
    } catch (err) {
      setError(err.message || 'Network error. Check connection or local Wi-Fi URL.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.headerContainer}>
        {branding?.logo ? (
          <Image source={{ uri: fileUrl(branding.logo) }} style={styles.logoImage} resizeMode="contain" />
        ) : (
          <Text style={styles.logoText}>Buy1Gram</Text>
        )}
        <Text style={styles.appName}>{branding?.appName || 'Buy 1 Gram'}</Text>
        <Text style={styles.subtitle}>
          {branding?.loginHeadline || 'Enter credentials to access your terminal'}
        </Text>
      </View>

      <View style={styles.formContainer}>
        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <Text style={styles.label}>Mobile Number</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g., 1234567890"
          placeholderTextColor="#A0AEC0"
          keyboardType="numeric"
          value={mobile}
          onChangeText={setMobile}
          autoCapitalize="none"
        />

        <Text style={styles.label}>Password</Text>
        <TextInput
          style={styles.input}
          placeholder="••••••••"
          placeholderTextColor="#A0AEC0"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
          autoCapitalize="none"
        />

        <TouchableOpacity
          style={[styles.loginBtn, loading && styles.disabledBtn]}
          onPress={handleLogin}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.loginBtnText}>Log In</Text>
          )}
        </TouchableOpacity>
      </View>


    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F7F9FC',
    justifyContent: 'center',
    padding: 24,
  },
  headerContainer: {
    alignItems: 'center',
    marginBottom: 36,
  },
  logoImage: { width: 190, height: 62, marginBottom: 4 },
  logoText: {
    // 48pt fitted "BYG"; a full word needs to come down or it runs off the
    // edge on a narrow phone.
    fontSize: 34,
    fontWeight: '800',
    color: '#00796B',
    letterSpacing: 1,
  },
  appName: {
    fontSize: 18,
    fontWeight: '700',
    color: '#2D3748',
    marginTop: 8,
  },
  subtitle: {
    fontSize: 13,
    color: '#718096',
    textAlign: 'center',
    marginTop: 6,
  },
  formContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#1A202C',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
  },
  errorText: {
    color: '#e05252',
    backgroundColor: '#FFF5F5',
    borderWidth: 1,
    borderColor: '#FED7D7',
    padding: 10,
    borderRadius: 8,
    fontSize: 12.5,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 16,
  },
  label: {
    color: '#4A5568',
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  input: {
    height: 44,
    backgroundColor: '#F7F9FC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    color: '#2D3748',
    paddingHorizontal: 12,
    marginBottom: 16,
    fontSize: 15,
  },
  loginBtn: {
    height: 46,
    backgroundColor: '#00796B',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  disabledBtn: {
    opacity: 0.6,
  },
  loginBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  settingsIcon: {
    alignSelf: 'center',
    marginTop: 32,
    padding: 8,
  },
  settingsIconText: {
    color: '#718096',
    fontSize: 13,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modalBox: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.1,
    shadowRadius: 20,
    elevation: 8,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#2D3748',
    marginBottom: 8,
  },
  modalDesc: {
    fontSize: 12,
    color: '#718096',
    lineHeight: 18,
    marginBottom: 16,
  },
  modalInput: {
    height: 44,
    backgroundColor: '#F7F9FC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    color: '#2D3748',
    paddingHorizontal: 12,
    fontSize: 14,
    marginBottom: 20,
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  cancelBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  cancelBtnText: {
    color: '#718096',
    fontSize: 13.5,
    fontWeight: '600',
  },
  saveBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: '#00796B',
  },
  saveBtnText: {
    color: '#fff',
    fontSize: 13.5,
    fontWeight: '700',
  },
});
