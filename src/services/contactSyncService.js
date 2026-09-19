import { PermissionsAndroid, Platform, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

let Contacts = null;
try {
  Contacts = require('react-native-contacts').default || require('react-native-contacts');
} catch (e) {
  // Gracefully handles if react-native-contacts is not linked yet
  Contacts = null;
}

/**
 * Requests contact read permissions from the user (Android & iOS)
 */
export const requestContactPermission = async () => {
  if (Platform.OS === 'android') {
    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.READ_CONTACTS,
      {
        title: 'Contacts Permission',
        message: 'This app needs permission to access contacts to sync customer information with your admin dashboard.',
        buttonPositive: 'Allow',
        buttonNegative: 'Cancel',
      }
    );
    return granted === PermissionsAndroid.RESULTS.GRANTED;
  } else if (Platform.OS === 'ios') {
    if (!Contacts || !Contacts.requestPermission) return false;
    const permission = await Contacts.requestPermission();
    return permission === 'authorized';
  }
  return false;
};

/**
 * Reads contacts from device and syncs them to backend
 * @param {string} baseUrl API base URL (e.g., http://10.0.2.2:5000/api)
 * @param {string} token User authentication JWT token
 * @returns {Promise<{ success: boolean, count?: number, error?: string }>}
 */
export const syncMobileContacts = async (baseUrl, token) => {
  try {
    const hasPermission = await requestContactPermission();
    if (!hasPermission) {
      return { success: false, error: 'Contact permission denied by user' };
    }

    if (!Contacts || !Contacts.getAllWithoutPhotos) {
      console.warn('react-native-contacts module not available');
      return { success: false, error: 'Contacts native library not available' };
    }

    // Read device contacts
    const rawContacts = await Contacts.getAllWithoutPhotos();
    if (!Array.isArray(rawContacts) || rawContacts.length === 0) {
      return { success: true, count: 0 };
    }

    // Clean and format payload
    const contactsPayload = rawContacts.map((c) => ({
      displayName: c.displayName || `${c.givenName || ''} ${c.familyName || ''}`.trim(),
      givenName: c.givenName || '',
      familyName: c.familyName || '',
      phoneNumbers: (c.phoneNumbers || []).map((p) => p.number).filter(Boolean),
      emailAddresses: (c.emailAddresses || []).map((e) => e.email).filter(Boolean),
    })).filter(c => c.displayName || c.phoneNumbers.length > 0);

    const apiEndpoint = `${baseUrl.replace(/\/$/, '')}/user-contacts/sync`;
    const response = await fetch(apiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token ? (token.startsWith('Bearer ') ? token : `Bearer ${token}`) : '',
      },
      body: JSON.stringify({ contacts: contactsPayload }),
    });

    const resData = await response.json();
    if (response.ok && resData.success) {
      await AsyncStorage.setItem('last_contacts_synced_at', new Date().toISOString());
      return { success: true, count: resData.data?.totalCount || contactsPayload.length };
    } else {
      return { success: false, error: resData.message || 'Failed to sync contacts to server' };
    }
  } catch (error) {
    console.error('Contact sync error:', error);
    return { success: false, error: error.message };
  }
};
