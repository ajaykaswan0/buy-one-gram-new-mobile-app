import React, { useState, useEffect, useRef } from 'react';
import { setTheme } from './src/services/appSkin';
import { loadFontScale } from './src/services/fontScale';
import {
  StyleSheet,
  View,
  Text,
  ActivityIndicator,
  StatusBar,
  TouchableOpacity,
  SafeAreaView,
  Platform,
  Image,
  BackHandler,
  KeyboardAvoidingView,
  PermissionsAndroid,
  Linking,
  AppState,
  Alert,
} from 'react-native';
import { scale, verticalScale, responsiveFontSize } from './src/utils/responsive';
import { bottomBarPadding } from './src/utils/systemBars';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getMessaging } from '@react-native-firebase/messaging';
import { startTracking, stopTracking } from './src/services/locationTracker';
import { hasNativeTracking, startNativeTracking, stopNativeTracking, wakeNativeTracking } from './src/services/nativeTracker';
import LoginScreen from './src/screens/LoginScreen';
import { LanguageProvider } from './src/i18n';
import DashboardScreen from './src/screens/DashboardScreen';
import AttendanceScreen from './src/screens/AttendanceScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import LeaveScreen from './src/screens/LeaveScreen';
import VisitScreen from './src/screens/VisitScreen';
import OrderScreen from './src/screens/OrderScreen';
import ProductScreen from './src/screens/ProductScreen';
import OrderListScreen from './src/screens/OrderListScreen';
import NotificationScreen from './src/screens/NotificationScreen';
import ReportScreen from './src/screens/ReportScreen';
import VisitHistoryScreen from './src/screens/VisitHistoryScreen';
import OutstandingListScreen from './src/screens/OutstandingListScreen';
import BeatPlanScreen from './src/screens/BeatPlanScreen';
import PartyProfileScreen from './src/screens/PartyProfileScreen';
import CreateCollectionScreen from './src/screens/CreateCollectionScreen';
import DriverDashboardScreen from './src/screens/DriverDashboardScreen';
import CrmDashboardScreen from './src/screens/CrmDashboardScreen';
import CrmHomeScreen from './src/screens/CrmHomeScreen';
import AssignedIssuesScreen from './src/screens/AssignedIssuesScreen';
import PartyRoutePlannerScreen from './src/screens/PartyRoutePlannerScreen';
import DeliveryRouteScreen from './src/screens/DeliveryRouteScreen';
import MyTeamScreen from './src/screens/MyTeamScreen';
import RecoveryScreen from './src/screens/RecoveryScreen';
import SalesPartnerDashboardScreen from './src/screens/SalesPartnerDashboardScreen';
import StoreManagerDashboardScreen from './src/screens/StoreManagerDashboardScreen';
import PackerDashboardScreen from './src/screens/PackerDashboardScreen';
import PurchaseManagerDashboardScreen from './src/screens/PurchaseManagerDashboardScreen';
import TelecallingDashboardScreen from './src/screens/TelecallingDashboardScreen';
import VendorListScreen from './src/screens/VendorListScreen';
import VendorProfileScreen from './src/screens/VendorProfileScreen';
import CreateVendorScreen from './src/screens/CreateVendorScreen';
import PurchaseOrderListScreen from './src/screens/PurchaseOrderListScreen';
import PurchaseOrderDetailScreen from './src/screens/PurchaseOrderDetailScreen';
import PurchaseStockScreen from './src/screens/PurchaseStockScreen';
import { API_URL } from './src/config/api';

const REQUIRED_PERMISSION_KEYS = ['camera', 'location', 'backgroundLocation', 'notifications'];
const TRACKING_PROFILE_KEY = 'tracking_profile';
const DEVICE_ID_KEY = 'tracking_device_id';
const PUSH_TOKEN_KEY = 'push_token';
const AUTH_STATUS_AUTHORIZED = 1;
const AUTH_STATUS_PROVISIONAL = 2;

const readJsonSafe = async (response) => {
  try {
    return await response.json();
  } catch (error) {
    return null;
  }
};

const normalizePermissionStatus = (state) => {
  if (!state?.map?.location) return 'denied';
  if (!state?.map?.backgroundLocation) return 'blocked';
  return 'granted';
};

const getPermissionState = async () => {
  if (Platform.OS !== 'android') {
    return {
      allGranted: true,
      missing: [],
      map: {},
    };
  }

  const [camera, foregroundLocation, backgroundLocation, notifications] = await Promise.all([
    PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.CAMERA),
    PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION),
    Platform.Version >= 29 ? PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACCESS_BACKGROUND_LOCATION) : Promise.resolve(true),
    Platform.Version >= 33 ? PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS) : Promise.resolve(true),
  ]);

  const map = {
    camera,
    location: Boolean(foregroundLocation),
    backgroundLocation: Boolean(backgroundLocation),
    notifications: Boolean(notifications),
  };

  const missing = REQUIRED_PERMISSION_KEYS.filter((key) => !map[key]);
  return {
    allGranted: missing.length === 0,
    missing,
    map,
  };
};

const requestAllRequiredPermissions = async () => {
  if (Platform.OS !== 'android') {
    return { allGranted: true, missing: [], map: {} };
  }

  // 1. Request foreground permissions first (Camera, Location, Notifications)
  const foregroundPermissions = [
    PermissionsAndroid.PERMISSIONS.CAMERA,
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
  ];

  if (Platform.Version >= 33) {
    foregroundPermissions.push(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
  }

  await PermissionsAndroid.requestMultiple(foregroundPermissions);

  // 2. Separately request Background Location ONLY if Fine Location is granted (Android 10+ requirement)
  const isFineLocationGranted = await PermissionsAndroid.check(
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
  );

  if (isFineLocationGranted && Platform.Version >= 29) {
    try {
      await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_BACKGROUND_LOCATION,
        {
          title: 'Location Tracking Permission',
          message: 'SFA app collects location data to track salesman routes, attendance, and delivery updates even when the app is closed.',
          buttonPositive: 'Allow all the time',
          buttonNegative: 'Cancel',
        }
      );
    } catch (e) {
      console.log('Background location request error:', e.message);
    }
  }

  return getPermissionState();
};

const getOrCreateDeviceId = async () => {
  let deviceId = await AsyncStorage.getItem(DEVICE_ID_KEY);
  if (!deviceId) {
    deviceId = `device-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    await AsyncStorage.setItem(DEVICE_ID_KEY, deviceId);
  }
  return deviceId;
};

/**
 * The Firebase messaging instance.
 *
 * @react-native-firebase v26 dropped the default export, so the old
 * `messaging()` call resolved to undefined. Every caller here guarded against
 * that and quietly returned null — which is why no device ever registered a
 * push token and no notification could be delivered. The modular getMessaging()
 * returns the same object, with the same instance methods.
 */
const getMessagingInstance = () => {
  try {
    return getMessaging();
  } catch (e) {
    console.log('[FCM] Messaging instance not available:', e.message);
    return null;
  }
};

const requestNotificationPermission = async () => {
  if (Platform.OS === 'android' && Platform.Version >= 33) {
    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS
    );
    return granted === PermissionsAndroid.RESULTS.GRANTED;
  }

  const messagingInstance = getMessagingInstance();
  if (!messagingInstance || typeof messagingInstance.requestPermission !== 'function') {
    return Platform.OS === 'android';
  }

  const status = await messagingInstance.requestPermission();
  return (
    status === AUTH_STATUS_AUTHORIZED ||
    status === AUTH_STATUS_PROVISIONAL
  );
};

const registerFcmTokenWithBackend = async ({ authToken, apiUrl }) => {
  if (!authToken || !apiUrl) return;
  try {
    const permissionGranted = await requestNotificationPermission();
    if (!permissionGranted) return;

    const messagingInstance = getMessagingInstance();
    if (!messagingInstance || typeof messagingInstance.getToken !== 'function') {
      console.log('[FCM] Messaging module is not ready on this build');
      return;
    }

    if (typeof messagingInstance.registerDeviceForRemoteMessages === 'function' && Platform.OS !== 'android') {
      await messagingInstance.registerDeviceForRemoteMessages();
    }

    const fcmToken = await messagingInstance.getToken();
    const cleanToken = String(fcmToken || '').trim();
    if (!cleanToken) return;

    /**
     * Remembered against the server it was registered with.
     *
     * This used to compare the token alone, so once it had been registered
     * anywhere it was never sent again — point the app at a different server
     * and that server never learns the token, and no push ever arrives. The
     * symptom is silence, which looks like push being broken rather than a
     * token that was never handed over.
     */
    const registeredWith = `${apiUrl}|${cleanToken}`;
    const savedToken = await AsyncStorage.getItem(PUSH_TOKEN_KEY);
    if (savedToken === registeredWith) return;

    const response = await fetch(`${apiUrl}/auth/push-token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ pushToken: cleanToken }),
    });

    if (!response.ok) {
      const error = await readJsonSafe(response);
      throw new Error(error?.message || 'Failed to register push token');
    }

    await AsyncStorage.setItem(PUSH_TOKEN_KEY, registeredWith);
  } catch (error) {
    console.log('[FCM] Token registration failed:', error.message);
  }
};

// Background location used to be registered here through Expo's TaskManager.
// This project has no Expo packages installed, so `TaskManager` was always an
// undefined identifier: the reference threw ReferenceError, the empty catch
// swallowed it, and the task was never registered. Removed rather than left
// looking functional. Location reporting runs through
// startBackgroundLocationReporting below, using @react-native-community/geolocation.

/**
 * The app proper. Wrapped below rather than here because it has several early
 * returns — a splash, a permission gate — and every one of them needs the
 * language provider above it.
 */
function AppShell() {
  const [appReady, setAppReady] = useState(false);
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [apiUrl, setApiUrl] = useState(API_URL);
  // Which notification a push tap was about, so the screen opens that one
  // rather than the list it happens to be in.
  const [openNotificationId, setOpenNotificationId] = useState(null);
  
  // Navigation states
  const [activeTab, setActiveTab] = useState('home');
  const [subScreen, setSubScreen] = useState(null);

  /**
   * Where he has been, so back goes back.
   *
   * There used to be one `previousSubScreen` slot, honoured only when leaving
   * the order screen — from anywhere else the back button dropped him on the
   * home tab, however deep he was. Party list → party profile → back landed on
   * home instead of the list he was reading a second ago.
   *
   * A stack costs almost nothing and unwinds any depth correctly.
   */
  /**
   * Bumped whenever something changes whether the day is open.
   *
   * The duty check otherwise runs on a one-minute timer, so marking attendance
   * left the app showing OFFLINE — and hiding the beat plan — until the timer
   * came round or the app was killed and reopened. Marking attendance is
   * exactly the moment to ask again rather than wait.
   */
  const [dutyNonce, setDutyNonce] = useState(0);

  const [screenStack, setScreenStack] = useState([]);

  // Changing tab abandons wherever he was, so the history goes with it —
  // otherwise back from a fresh tab would walk into the last tab's screens.
  useEffect(() => { setScreenStack([]); }, [activeTab]);

  /** Opens a screen, remembering the one being left. */
  const navigateTo = (next) => {
    setScreenStack((stack) => [...stack, subScreen]);
    setSubScreen(next);
  };

  /**
   * Returns to the previous screen, or the tab underneath if there is none.
   *
   * The two setters are called side by side rather than one inside the other's
   * updater — React does not support setting state from within another
   * update, and doing so can drop one of the two silently.
   */
  const goBack = () => {
    const previous = screenStack.length ? screenStack[screenStack.length - 1] : null;
    setSubScreen(previous ?? null);
    setScreenStack((stack) => stack.slice(0, -1));
  };
  const [orderParty, setOrderParty] = useState(null);
  const [profilePartyId, setProfilePartyId] = useState(null);
  const [selectedVendorId, setSelectedVendorId] = useState(null);
  const [selectedPurchaseOrderId, setSelectedPurchaseOrderId] = useState(null);
  const [collectionParty, setCollectionParty] = useState(null);

  // Tracking states
  const [activeLogId, setActiveLogId] = useState(null);
  const checkStatusIntervalRef = useRef(null);

  // Notification count
  const [unreadCount, setUnreadCount] = useState(0);
  const [permissionState, setPermissionState] = useState({
    loading: true,
    missing: REQUIRED_PERMISSION_KEYS,
    map: {},
  });
  const [trackingProfile, setTrackingProfile] = useState(null);

  const syncTrackingPermissionStatus = async (profile = trackingProfile, statusOverride = null, baseUrl = apiUrl) => {
    try {
      if (!profile?.userId || !profile?.deviceId) return;
      const currentStatus = statusOverride || await getPermissionState();
      const permissionStatus = normalizePermissionStatus(currentStatus);
      await fetch(`${baseUrl}/device-tracking/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: profile.userId,
          deviceId: profile.deviceId,
          permissionStatus,
        }),
      });
      const nextProfile = { ...profile, locationPermissionStatus: permissionStatus };
      setTrackingProfile(nextProfile);
      await AsyncStorage.setItem(TRACKING_PROFILE_KEY, JSON.stringify(nextProfile));
    } catch (error) {
      console.log('[Tracking Permission] Sync failed:', error.message);
    }
  };

  const refreshPermissionState = async () => {
    const status = await getPermissionState();
    setPermissionState({
      loading: false,
      missing: status.missing,
      map: status.map,
    });
    syncTrackingPermissionStatus(trackingProfile, status);
    return status;
  };

  const fetchUnreadCount = async () => {
    if (!token) return;
    try {
      const response = await fetch(`${apiUrl}/notification/my?limit=1`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (response.ok && data.success) {
        setUnreadCount(data.unreadCount || 0);
      }
    } catch (e) {
      console.log('[Notification Check] Error fetching unread notifications:', e.message);
    }
  };

  useEffect(() => {
    if (token) {
      fetchUnreadCount();
    }
  }, [token, apiUrl]);

  // Hardware Back Button Handler
  useEffect(() => {
    const backAction = () => {
      // Deepest first: a screen goes back to whatever opened it.
      if (subScreen) {
        goBack();
        return true;
      }
      // Then the tabs: anything but home returns to home.
      if (activeTab !== 'home') {
        setActiveTab('home');
        return true;
      }
      return false; // home, with nothing behind it — let Android close the app
    };

    const backHandler = BackHandler.addEventListener('hardwareBackPress', backAction);
    return () => backHandler.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subScreen, screenStack, activeTab]);

  // 1. Initialize auth state on mount
  useEffect(() => {
    const initializeApp = async () => {
      try {
        const storedToken = await AsyncStorage.getItem('token');
        const storedUser = await AsyncStorage.getItem('user');
        // The saved text size, read before the first screen draws so the app
        // does not open small and jump a moment later.
        await loadFontScale();

        const startUrl = API_URL;

        /**
         * How the app is dressed today, before the first screen draws.
         *
         * Fetched here rather than on the dashboard because it repaints every
         * screen, not one — and the server has already decided whether it is
         * showing, so a phone with a wrong clock cannot start Diwali early.
         * No token — the branding route is open, and a failure just leaves
         * the app in its own colours.
         */
        fetch(`${startUrl}/app-settings/branding`)
          .then((response) => (response.ok ? response.json() : null))
          .then((body) => setTheme(body?.data?.dashboardTheme || null))
          .catch(() => {});

        const storedTrackingProfile = await AsyncStorage.getItem(TRACKING_PROFILE_KEY);
        if (storedTrackingProfile) {
          setTrackingProfile(JSON.parse(storedTrackingProfile));
        }

        if (storedToken && storedUser) {
          // Tokens last 7 days and there is no refresh, so a stored one is often
          // dead. Restoring it blindly left the app looking signed in while every
          // screen quietly failed to load. Check it once, here, and send the user
          // back to login if it has expired.
          let tokenIsValid = true;
          try {
            const check = await fetch(`${startUrl}/auth/me`, {
              headers: { Authorization: `Bearer ${storedToken}` },
            });
            if (check.status === 401 || check.status === 403) tokenIsValid = false;
          } catch (networkError) {
            // Offline is not the same as signed out - keep the session and let the
            // screens retry, or a salesman with no signal would be locked out.
            console.warn('Session check skipped, network unavailable:', networkError.message);
          }

          if (tokenIsValid) {
            setToken(storedToken);
            setUser(JSON.parse(storedUser));
            setActiveTab('home');
            // The address this session is on, not the compiled-in one, for the
            // same reason the tracker follows it: a server override has to move
            // everything or it moves nothing usefully.
            registerFcmTokenWithBackend({
              authToken: storedToken,
              // The address just resolved, not the state — setApiUrl has not
              // taken effect within this same run of the effect.
              apiUrl: startUrl,
            }).catch(() => {});
            syncMobileContacts(startUrl, storedToken).catch(() => {});
          } else {
            await AsyncStorage.multiRemove(['token', 'user']);
          }
        }
        const permissionStatus = await requestAllRequiredPermissions();
        setPermissionState({
          loading: false,
          missing: permissionStatus.missing,
          map: permissionStatus.map,
        });
        syncTrackingPermissionStatus(trackingProfile, permissionStatus);
      } catch (e) {
        console.error('Failed to restore auth states', e);
      } finally {
        setAppReady(true);
      }
    };

    initializeApp();
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        refreshPermissionState();
        if (trackingProfile?.userId) {
          startBackgroundLocationReporting(activeLogId || null);
        }
      }
    });
    return () => subscription.remove();
  }, [trackingProfile, activeLogId]);

  // 2. Keep daily-log summary synced from live tracking stream
  useEffect(() => {
    if (!token) {
      stopBackgroundLocationReporting();
      stopStatusChecking();
      return;
    }

    if (trackingProfile?.userId) {
      startBackgroundLocationReporting(activeLogId || null);
    }

    // A duplicate of the app-init routine used to sit here: the function was
    // renamed to checkDailyLogStatus but the call was left as initializeApp(),
    // which is not in scope. That threw ReferenceError on every run of this
    // effect and meant the copied body never ran either. The real initialisation
    // runs in its own effect above, and the working daily-log poller is below, so
    // this effect now does only what its comment says: start and stop tracking.
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        refreshPermissionState();
        if (trackingProfile?.userId) {
          startBackgroundLocationReporting(activeLogId || null);
        }
        if (token && apiUrl) {
          syncMobileContacts(apiUrl, token).catch(() => {});
        }
      }
    });
    return () => subscription.remove();
  }, [trackingProfile, activeLogId, token, apiUrl]);

  // 2. Keep daily-log summary synced from live tracking stream
  useEffect(() => {
    if (!token) {
      stopBackgroundLocationReporting();
      stopStatusChecking();
      return;
    }

    if (trackingProfile?.userId) {
      startBackgroundLocationReporting(activeLogId || null);
    }

    const checkDailyLogStatus = async () => {
      try {
        const res = await fetch(`${apiUrl}/daily-log/my/today`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        
        /**
         * On duty means attendance was marked, not merely that a log exists.
         *
         * The endpoint returns an empty log shape for any day, so its presence
         * proved nothing — the app showed ONLINE to someone who had not checked
         * in at all, and let him start visiting.
         */
        const log = res.ok && data.success ? data.data : null;
        if (log?._id && log.onDuty) {
          if (activeLogId !== log._id) {
            setActiveLogId(log._id);
            await AsyncStorage.setItem('active_log_id', log._id);
          }
        } else {
          await AsyncStorage.removeItem('active_log_id');
          setActiveLogId(null);
        }
      } catch (e) {
        console.log('[Status Check] Error querying daily log status:', e.message);
      }
    };

    checkDailyLogStatus();
    checkStatusIntervalRef.current = setInterval(checkDailyLogStatus, 60000);

    return () => {
      stopStatusChecking();
    };
  }, [token, apiUrl, activeLogId, trackingProfile, dutyNonce]);

  /**
   * Starts the continuous location watch for this shift.
   *
   * What used to be here fired a single getCurrentPosition and stopped, so a
   * day produced a handful of scattered dots instead of a trail. The watch now
   * lives in src/services/locationTracker.js, buffers points locally and
   * uploads them in batches, so a lost signal delays the trail rather than
   * putting a hole in it.
   */
  const startBackgroundLocationReporting = async (logId = null) => {
    try {
      if (logId) await AsyncStorage.setItem('active_log_id', logId);

      const permissionCheck = await getPermissionState();
      if (!permissionCheck.map?.location) {
        setPermissionState((current) => ({
          ...current, loading: false,
          missing: permissionCheck.missing, map: permissionCheck.map,
        }));
        return;
      }

      /**
       * Android records in a foreground service, everything else in JS.
       *
       * Attendance no longer gates any of this: somebody who is logged in is
       * tracked, so the trail no longer has a hole in it wherever the person
       * forgot to punch in.
       */
      const [rawProfile] = await Promise.all([
        AsyncStorage.getItem(TRACKING_PROFILE_KEY),
      ]);
      const profile = rawProfile ? JSON.parse(rawProfile) : null;
      if (hasNativeTracking) {
        // The address the session actually logged in to, not the compiled-in
        // one — otherwise the server setting on the login screen moves every
        // screen and leaves the tracker still talking to production.
        const started = await startNativeTracking(profile, apiUrl);
        if (started) return;
      }

      // Read fresh for every point, so clocking in or out is picked up without
      // tearing the watch down and starting it again.
      await startTracking(async () => {
        const [storedToken, profileRaw, openLogId] = await Promise.all([
          AsyncStorage.getItem('token'),
          AsyncStorage.getItem(TRACKING_PROFILE_KEY),
          AsyncStorage.getItem('active_log_id'),
        ]);
        const state = await getPermissionState();
        return {
          token: storedToken,
          apiUrl,
          profile: profileRaw ? JSON.parse(profileRaw) : null,
          // Tracking follows the login, not attendance, so every point counts.
          onDuty: true,
          permissionStatus: normalizePermissionStatus(state),
        };
      });
    } catch (e) {
      console.log('[Location Tracker] Error starting location updates:', e.message);
    }
  };

  const stopBackgroundLocationReporting = async () => {
    try {
      // Stops the watch and pushes whatever is still buffered, so the end of a
      // shift is not silently truncated.
      await stopNativeTracking();
      await stopTracking();
      await AsyncStorage.removeItem('active_log_id');
    } catch (e) {
      console.log('[Location Tracker] Error stopping location updates:', e.message);
    }
  };

  const stopStatusChecking = () => {
    if (checkStatusIntervalRef.current) {
      clearInterval(checkStatusIntervalRef.current);
      checkStatusIntervalRef.current = null;
    }
  };

  /**
   * Sign out.
   *
   * There was no way to. ProfileScreen has drawn a Log Out button all along
   * behind `{onLogout ? ...}` and App.js never passed one, so it has never
   * appeared — a phone signed in as the wrong person had to be reinstalled.
   *
   * The session goes, and the tracking profile with it: leaving that behind
   * would have the next person's movements reported under the last person's
   * name. The device id stays, because it identifies the handset and not the
   * person.
   */
  const handleLogout = async () => {
    try {
      stopNativeTracking?.();
    } catch (error) {
      console.log('[Logout] Could not stop tracking:', error?.message);
    }
    try {
      await AsyncStorage.multiRemove(['token', 'user', 'active_log_id', TRACKING_PROFILE_KEY]);
    } catch (error) {
      console.log('[Logout] Could not clear the session:', error?.message);
    }
    setToken(null);
    setUser(null);
    setTrackingProfile(null);
    setActiveLogId(null);
    setActiveTab('home');
    goBack();
  };

  const confirmLogout = () => {
    Alert.alert('Log out', 'Sign out of this phone?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log out', style: 'destructive', onPress: handleLogout },
    ]);
  };

  const handleLoginSuccess = (newToken, newUser, currentUrl) => {
    setToken(newToken);
    setUser(newUser);
    setApiUrl(currentUrl);
    setActiveTab('home');
    goBack();
    registerFcmTokenWithBackend({
      authToken: newToken,
      apiUrl: currentUrl,
    }).catch(() => {});
    syncMobileContacts(currentUrl, newToken).catch(() => {});
    getOrCreateDeviceId().then(async (deviceId) => {
      const nextTrackingProfile = {
        userId: newUser?.id || newUser?._id,
        userName: newUser?.name || '',
        userMobile: newUser?.mobile || '',
        deviceId,
        deviceLabel: Platform.OS === 'android' ? 'android-device' : 'mobile-device',
        trackingMode: newUser?.trackingMode || 'attendance_only',
        allowTrackingAfterLogout: Boolean(newUser?.allowTrackingAfterLogout),
        locationPermissionStatus: newUser?.locationPermissionStatus || 'unknown',
      };
      setTrackingProfile(nextTrackingProfile);
      await AsyncStorage.setItem(TRACKING_PROFILE_KEY, JSON.stringify(nextTrackingProfile));
      await syncTrackingPermissionStatus(nextTrackingProfile, null, currentUrl);
      startBackgroundLocationReporting(activeLogId || null);
    }).catch((error) => {
      console.log('[Tracking Profile] Failed to initialize:', error.message);
    });
  };

  useEffect(() => {
    if (!token || !apiUrl) return undefined;

    const messagingInstance = getMessagingInstance();
    if (!messagingInstance) return undefined;

    const unsubscribeTokenRefresh =
      typeof messagingInstance.onTokenRefresh === 'function'
        ? messagingInstance.onTokenRefresh((nextToken) => {
      fetch(`${apiUrl}/auth/push-token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ pushToken: String(nextToken || '').trim() }),
      })
        .then((response) => {
          if (!response.ok) {
            return readJsonSafe(response).then((data) => {
              throw new Error(data?.message || 'Failed to refresh push token');
            });
          }
          // Stored the same way as above — server and token together — or the
          // next registration would think it had already been done here.
          return AsyncStorage.setItem(PUSH_TOKEN_KEY, `${apiUrl}|${String(nextToken || '').trim()}`);
        })
        .catch((error) => {
          console.log('[FCM] Token refresh sync failed:', error.message);
        });
    })
        : () => {};

    const unsubscribeForeground =
      typeof messagingInstance.onMessage === 'function'
        ? messagingInstance.onMessage(async (remoteMessage) => {
            // With the app open the background handler never runs, so the wake
            // has to be answered here too — otherwise live tracking is instant
            // when the phone is in a pocket and slow when it is in a hand.
            if (remoteMessage?.data?.type === 'tracking-wake') {
              wakeNativeTracking().catch(() => {});
              return;
            }
            fetchUnreadCount();
          })
        : () => {};

    /**
     * Tapping a notification opens the notifications screen.
     *
     * `navigateTo`, the same call the bell makes — the screen renders on
     * subScreen, and these used to do `setActiveTab('notifications')` followed
     * by `goBack()`, which set a tab that does not exist and then cleared the
     * subScreen that would have rendered it. The result was a blank screen
     * stuck on "loading", which is what a tap has always done.
     */
    const unsubscribeOpened =
      typeof messagingInstance.onNotificationOpenedApp === 'function'
        ? messagingInstance.onNotificationOpenedApp((opened) => {
            setOpenNotificationId(opened?.data?.notificationId || null);
            navigateTo('notifications');
            fetchUnreadCount();
          })
        : () => {};

    // The same tap, but from a cold start: the app was not running at all, so
    // there was no listener to fire and the message is collected here instead.
    if (typeof messagingInstance.getInitialNotification === 'function') {
      messagingInstance.getInitialNotification()
        .then((opened) => {
          if (!opened) return;
          setOpenNotificationId(opened?.data?.notificationId || null);
          navigateTo('notifications');
          fetchUnreadCount();
        })
        .catch(() => {});
    }

    return () => {
      unsubscribeTokenRefresh();
      unsubscribeForeground();
      unsubscribeOpened();
    };
  }, [token, apiUrl]);

  if (!appReady) {
    return (
      <View style={styles.splash}>
        <ActivityIndicator color="#00796B" size="large" />
      </View>
    );
  }

  const missingPermissionLabels = {
    camera: 'Camera / Photo',
    location: 'Location',
    backgroundLocation: 'Background Location',
  };

  const handleGrantPermissions = async () => {
    const status = await requestAllRequiredPermissions();
    setPermissionState({
      loading: false,
      missing: status.missing,
      map: status.map,
    });
    if (!status.allGranted) {
      Alert.alert('Permissions required', 'Please allow all required permissions to continue using the app.');
    }
  };

  const handleOpenSettings = async () => {
    try {
      await Linking.openSettings();
    } catch (error) {
      Alert.alert('Unable to open settings', 'Please open phone settings manually and allow the required permissions.');
    }
  };

  if (permissionState.loading) {
    return (
      <View style={styles.splash}>
        <ActivityIndicator color="#00796B" size="large" />
        <Text style={styles.permissionLoadingText}>Checking device permissions…</Text>
      </View>
    );
  }

  if (permissionState.missing.length > 0) {
    return (
      <SafeAreaView style={styles.permissionGateScreen}>
        <View style={styles.permissionGateCard}>
          <Text style={styles.permissionGateTitle}>Required permissions are off</Text>
          <Text style={styles.permissionGateDesc}>
            This app needs location, camera/photo, and background location access. Until all are allowed, the app will stay locked.
          </Text>
          <View style={styles.permissionList}>
            {permissionState.missing.map((key) => (
              <View key={key} style={styles.permissionRow}>
                <Text style={styles.permissionBullet}>•</Text>
                <Text style={styles.permissionRowText}>{missingPermissionLabels[key] || key}</Text>
              </View>
            ))}
          </View>
          <TouchableOpacity style={styles.permissionPrimaryBtn} onPress={handleGrantPermissions}>
            <Text style={styles.permissionPrimaryBtnText}>Grant Permissions</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.permissionSecondaryBtn} onPress={handleOpenSettings}>
            <Text style={styles.permissionSecondaryBtnText}>Open Settings</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (!token) {
    return (
      <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <StatusBar barStyle="dark-content" backgroundColor="#F7F9FC" />
        <LoginScreen onLoginSuccess={handleLoginSuccess} />
      </KeyboardAvoidingView>
    );
  }

  const initials = user?.name
    ? user.name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .substring(0, 2)
        .toUpperCase()
    : 'EE';
  const normalizedRole = String(
    user?.roleName ||
    user?.role?.name ||
    (typeof user?.role === 'string' ? user.role : '')
  ).toLowerCase().replace(/[\s_-]/g, '');
  const isDriver = normalizedRole === 'driver' || normalizedRole === 'deliverymanager';
  const isCrm = normalizedRole === 'crm' || normalizedRole === 'customerrelationshipmanager';
  const isCso = normalizedRole === 'cso';
  const isSalesPartner = normalizedRole === 'salespartner';
  const isStoreManager = ['storemanager', 'store_manager', 'warehousemanager', 'warehouse_manager', 'storekeeper'].includes(normalizedRole);
  const isPacker = normalizedRole === 'packer';
  const isPurchaseManager = normalizedRole === 'purchasemanager';
  const isTelecaller = ['telecaller', 'callingexecutive', 'calling_executive', 'telecalling'].includes(normalizedRole);

  // A packer gets one screen and nothing else: no tabs, no header, no profile.
  if (isPacker) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />
        <PackerDashboardScreen
          token={token}
          apiUrl={apiUrl}
          user={user}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />

      {/* Global Top Header Bar */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <TouchableOpacity onPress={() => { setActiveTab('home'); goBack(); }}>
            <Image 
              source={require('./assets/logo.png')} 
              style={styles.logoImage} 
              resizeMode="contain"
            />
          </TouchableOpacity>
        </View>

        <View style={styles.headerRightContainer}>
          <TouchableOpacity 
            style={styles.notificationIndicator} 
            onPress={() => navigateTo('notifications')}
          >
            <Text style={styles.bellIcon}>🔔</Text>
            {unreadCount > 0 && (
              <View style={styles.badgeContainer}>
                <Text style={styles.badgeText}>{unreadCount}</Text>
              </View>
            )}
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.profileIndicator} 
            onPress={() => { setActiveTab('profile'); goBack(); }}
          >
            <View style={styles.avatarCircle}>
              <Text style={styles.avatarCircleText}>{initials}</Text>
            </View>
          </TouchableOpacity>

        </View>
      </View>

      {/* Render Main Content Screen */}
      <KeyboardAvoidingView style={styles.contentBody} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 4}>
        {subScreen === 'attendance' ? (
          <AttendanceScreen
            token={token}
            apiUrl={apiUrl}
            onAttendanceMarked={() => setDutyNonce((count) => count + 1)}
            onBack={() => goBack()}
          />
        ) : subScreen === 'crmParties' ? (
          <CrmDashboardScreen
            token={token}
            apiUrl={apiUrl}
            user={user}
            onNavigateToPartyProfile={(partyId) => {
              setProfilePartyId(partyId);
              navigateTo('partyProfile');
            }}
            onNavigateToCollection={(party) => {
              setCollectionParty(party);
              navigateTo('collection');
            }}
            onNavigateToOrder={(party) => {
              setOrderParty(party);
              navigateTo('order');
            }}
          />
        ) : subScreen === 'team' ? (
          <MyTeamScreen
            token={token}
            apiUrl={apiUrl}
            user={user}
            onBack={() => goBack()}
            onNavigateToOrder={(party) => {
              setOrderParty(party);
              navigateTo('order');
            }}
          />
        ) : subScreen === 'issues' ? (
          <AssignedIssuesScreen token={token} apiUrl={apiUrl} onBack={() => goBack()} />
        ) : subScreen === 'recovery' ? (
          <RecoveryScreen token={token} apiUrl={apiUrl} onBack={() => goBack()} />
        ) : subScreen === 'deliveryRoute' ? (
          <DeliveryRouteScreen apiUrl={apiUrl} onBack={() => goBack()} />
        ) : subScreen === 'routePlanner' ? (
          <PartyRoutePlannerScreen token={token} apiUrl={apiUrl} onBack={() => goBack()} />
        ) : subScreen === 'leave' ? (
          <LeaveScreen
            token={token}
            apiUrl={apiUrl}
            onBack={() => goBack()}
          />
        ) : subScreen === 'party' ? (
          <VisitScreen
            token={token}
            user={user}
            apiUrl={apiUrl}
            onBack={() => goBack()}
            onNavigateToOrder={(party) => {
              setOrderParty(party);
              navigateTo('order');
            }}
            onNavigateToCollection={(party) => {
              setCollectionParty(party);
              navigateTo('collection');
            }}
          />
        ) : subScreen === 'collection' ? (
          <CreateCollectionScreen
            token={token}
            apiUrl={apiUrl}
            party={collectionParty}
            onBack={() => {
              goBack();
              setCollectionParty(null);
            }}
          />
        ) : subScreen === 'partyProfile' ? (
          <PartyProfileScreen
            token={token}
            apiUrl={apiUrl}
            partyId={profilePartyId}
            onBack={() => {
              goBack();
              setProfilePartyId(null);
            }}
            onNavigateToOrder={(party) => {
              setOrderParty(party);
              navigateTo('order');
            }}
            onNavigateToCollection={(party) => {
              setCollectionParty(party);
              navigateTo('collection');
            }}
          />
        ) : subScreen === 'order' ? (
          <OrderScreen
            token={token}
            apiUrl={apiUrl}
            user={user}
            preSelectedParty={orderParty}
            onBack={() => {
              goBack();
              setOrderParty(null);
            }}
          />
        ) : subScreen === 'products' ? (
          <ProductScreen
            token={token}
            apiUrl={apiUrl}
            user={user}
            onBack={() => goBack()}
          />
        ) : subScreen === 'orderList' ? (
          <OrderListScreen
            token={token}
            apiUrl={apiUrl}
            user={user}
            onBack={() => goBack()}
          />
        ) : subScreen === 'notifications' ? (
          <NotificationScreen
            token={token}
            apiUrl={apiUrl}
            openNotificationId={openNotificationId}
            onBack={() => { setOpenNotificationId(null); goBack(); }}
            onClearBadge={() => setUnreadCount(0)}
          />
        ) : subScreen === 'outstandingList' ? (
          <OutstandingListScreen
            token={token}
            apiUrl={apiUrl}
            onBack={() => goBack()}
            onNavigateToOrder={(party) => {
              setOrderParty(party);
              navigateTo('order');
            }}
            onNavigateToCollection={(party) => {
              setCollectionParty(party);
              navigateTo('collection');
            }}
          />
        ) : subScreen === 'purchaseVendors' ? (
          <VendorListScreen
            token={token}
            apiUrl={apiUrl}
            onBack={() => goBack()}
            onSelectVendor={(id) => { setSelectedVendorId(id); navigateTo('vendorProfile'); }}
            onAddVendor={() => navigateTo('createVendor')}
          />
        ) : subScreen === 'vendorProfile' ? (
          <VendorProfileScreen
            token={token}
            apiUrl={apiUrl}
            vendorId={selectedVendorId}
            onBack={() => goBack()}
            onOpenPurchaseOrder={(id) => { setSelectedPurchaseOrderId(id); navigateTo('purchaseOrderDetail'); }}
          />
        ) : subScreen === 'purchaseOrderDetail' ? (
          <PurchaseOrderDetailScreen
            token={token}
            apiUrl={apiUrl}
            poId={selectedPurchaseOrderId}
            onBack={() => goBack()}
          />
        ) : subScreen === 'createVendor' ? (
          <CreateVendorScreen
            token={token}
            apiUrl={apiUrl}
            onBack={() => goBack()}
            onCreated={(vendor) => {
              setSelectedVendorId(vendor._id);
              // Straight to the profile just made, not back to the list —
              // the next thing a purchase manager does after adding a vendor
              // is record a price for them, not look at the list again.
              setSubScreen('vendorProfile');
              setScreenStack((stack) => [...stack, 'purchaseVendors']);
            }}
          />
        ) : subScreen === 'purchaseOrders' ? (
          <PurchaseOrderListScreen token={token} apiUrl={apiUrl} onBack={() => goBack()} />
        ) : subScreen === 'purchaseStock' ? (
          <PurchaseStockScreen token={token} apiUrl={apiUrl} onBack={() => goBack()} />
        ) : activeTab === 'home' ? (
          isDriver ? (
            // Keyed: this and the History-tab instance below are the same
            // component type at the same spot in the tree, so without distinct
            // keys React treats a switch between them as a prop update rather
            // than a new mount — the Delivery History tab kept showing
            // whatever internal tab Home was last left on, because its
            // `useState(initialTab)` never got to run again.
            <DriverDashboardScreen
              key="driver-home"
              token={token}
              apiUrl={apiUrl}
              activeLogId={activeLogId}
              onNavigateToAttendance={() => navigateTo('attendance')}
              onNavigateToLeave={() => navigateTo('leave')}
              onNavigateToProducts={() => navigateTo('products')}
            />
          ) : isStoreManager ? (
            <StoreManagerDashboardScreen
              token={token}
              apiUrl={apiUrl}
              user={user}
              onNavigateToAttendance={() => navigateTo('attendance')}
              onNavigateToLeave={() => navigateTo('leave')}
              onNavigateToProfile={() => { setActiveTab('profile'); goBack(); }}
              onNavigateToProducts={() => navigateTo('products')}
              onNavigateToOrders={() => navigateTo('orderList')}
            />
          ) : isCrm ? (
            <CrmHomeScreen
              token={token}
              apiUrl={apiUrl}
              user={user}
              activeLogId={activeLogId}
              onNavigateToAttendance={() => navigateTo('attendance')}
              onNavigateToLeave={() => navigateTo('leave')}
              onNavigateToProducts={() => navigateTo('products')}
              onNavigateToOrder={() => {
                setOrderParty(null);
                navigateTo('order');
              }}
              onNavigateToIssues={() => navigateTo('issues')}
              onNavigateToRecovery={() => navigateTo('recovery')}
              onNavigateToRoutePlanner={() => navigateTo('routePlanner')}
              onNavigateToParties={() => navigateTo('crmParties')}
            />
          ) : isSalesPartner ? (
            <SalesPartnerDashboardScreen
              token={token}
              apiUrl={apiUrl}
              user={user}
              onNavigateToParty={() => navigateTo('party')}
              onNavigateToOrder={() => {
                setOrderParty(null);
                navigateTo('order');
              }}
              onNavigateToOrderList={() => navigateTo('orderList')}
              onNavigateToProducts={() => navigateTo('products')}
              onNavigateToRoutePlanner={() => navigateTo('routePlanner')}
            />
          ) : isPurchaseManager ? (
            <PurchaseManagerDashboardScreen
              onNavigateToAttendance={() => navigateTo('attendance')}
              onNavigateToLeave={() => navigateTo('leave')}
              onNavigateToVendors={() => navigateTo('purchaseVendors')}
              onNavigateToCreateVendor={() => navigateTo('createVendor')}
              onNavigateToStock={() => navigateTo('purchaseStock')}
              onNavigateToPurchaseOrders={() => navigateTo('purchaseOrders')}
            />
          ) : isTelecaller ? (
            <TelecallingDashboardScreen
              token={token}
              apiUrl={apiUrl}
              user={user}
              onNavigateToOrder={(party) => {
                setOrderParty(party);
                navigateTo('order');
              }}
              onNavigateToOrders={() => navigateTo('orderList')}
              onNavigateToAttendance={() => navigateTo('attendance')}
              onNavigateToLeave={() => navigateTo('leave')}
              onNavigateToProducts={() => navigateTo('products')}
            />
          ) : (
            <DashboardScreen
              token={token}
              apiUrl={apiUrl}
              activeLogId={activeLogId}
              onNavigateToAttendance={() => navigateTo('attendance')}
              onNavigateToLeave={() => navigateTo('leave')}
              onNavigateToParty={() => navigateTo('party')}
              onNavigateToOrder={() => {
                setOrderParty(null);
                navigateTo('order');
              }}
              onNavigateToProducts={() => navigateTo('products')}
              onNavigateToOrderList={() => navigateTo('orderList')}
              onNavigateToOutstandingList={() => navigateTo('outstandingList')}
              onNavigateToDeliveryRoute={() => navigateTo('deliveryRoute')}
              onNavigateToBeatPlan={() => { setActiveTab('beatPlan'); goBack(); }}
              user={user}
              isCso={isCso}
              onNavigateToTeam={() => navigateTo('team')}
            />
          )
        ) : activeTab === 'profile' ? (
          <ProfileScreen
            user={user}
            token={token}
            apiUrl={apiUrl}
            onLogout={confirmLogout}
          />
        ) : activeTab === 'history' ? (
          isStoreManager || isSalesPartner || isTelecaller ? (
            <OrderListScreen
              token={token}
              apiUrl={apiUrl}
              onBack={() => { setActiveTab('home'); goBack(); }}
            />
          ) : isPurchaseManager ? (
            // The footer's middle slot, repurposed: a purchase manager's most
            // frequent stop is the vendor list, not a visit history nobody
            // asked for.
            <VendorListScreen
              token={token}
              apiUrl={apiUrl}
              onBack={() => { setActiveTab('home'); goBack(); }}
              onSelectVendor={(id) => { setSelectedVendorId(id); navigateTo('vendorProfile'); }}
              onAddVendor={() => navigateTo('createVendor')}
            />
          ) : isDriver ? (
            // Same screen as Home, opened straight on its own Delivered
            // History tab — a driver has no "visits" to show here. A distinct
            // key from the Home instance above, or React reuses that instance
            // instead of mounting fresh and initialTab never takes effect.
            <DriverDashboardScreen
              key="driver-history"
              token={token}
              apiUrl={apiUrl}
              activeLogId={activeLogId}
              initialTab="history"
              onNavigateToAttendance={() => navigateTo('attendance')}
              onNavigateToLeave={() => navigateTo('leave')}
              onNavigateToProducts={() => navigateTo('products')}
            />
          ) : (
          <VisitHistoryScreen
            token={token}
            apiUrl={apiUrl}
            user={user}
          />
          )
        ) : activeTab === 'report' ? (
          isStoreManager ? (
            <ProductScreen
              token={token}
              apiUrl={apiUrl}
              user={user}
              onBack={() => { setActiveTab('home'); goBack(); }}
            />
          ) : isSalesPartner ? (
            <PartyRoutePlannerScreen
              token={token}
              apiUrl={apiUrl}
              onBack={() => { setActiveTab('home'); goBack(); }}
            />
          ) : (
          <ReportScreen
            token={token}
            apiUrl={apiUrl}
          />
          )
        ) : activeTab === 'beatPlan' ? (
          isStoreManager ? (
            <AttendanceScreen
              token={token}
              apiUrl={apiUrl}
              onBack={() => { setActiveTab('home'); goBack(); }}
            />
          ) : (
            <BeatPlanScreen
              token={token}
              apiUrl={apiUrl}
              activeLogId={activeLogId}
              user={user}
              onNavigateToPartyProfile={(partyId) => {
                setProfilePartyId(partyId);
                navigateTo('partyProfile');
              }}
              onNavigateToOrder={(party) => {
                setOrderParty(party);
                navigateTo('order');
              }}
            />
          )
        ) : (
          <View style={styles.placeholderScreen}>
            <Text style={styles.placeholderText}>
              {activeTab.toUpperCase()} tab content is loading...
            </Text>
          </View>
        )}
      </KeyboardAvoidingView>

      {/* Global Bottom Tab Bar (Image 1/2 style) */}
      <View style={styles.tabBar}>
        {/* Left Side Tab Buttons */}
        {!isDriver && !isPurchaseManager && !isTelecaller && (
          <TouchableOpacity
            style={styles.tabItem}
            onPress={() => { setActiveTab('report'); goBack(); }}
          >
              <Text style={[styles.tabIcon, activeTab === 'report' && styles.activeTabColor]}>{isSalesPartner ? '🗺️' : '📊'}</Text>
            <Text style={[styles.tabLabel, activeTab === 'report' && styles.activeTabColor]}>{isSalesPartner ? 'Route' : 'Report'}</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={styles.tabItem}
          onPress={() => { setActiveTab('history'); goBack(); }}
        >
          <Text style={[styles.tabIcon, activeTab === 'history' && styles.activeTabColor]}>{isSalesPartner || isTelecaller ? '📋' : isPurchaseManager ? '🏬' : '🕒'}</Text>
          <Text style={[styles.tabLabel, activeTab === 'history' && styles.activeTabColor]}>{isSalesPartner || isTelecaller ? 'Orders' : isPurchaseManager ? 'Vendors' : isDriver ? 'Delivery History' : 'History'}</Text>
        </TouchableOpacity>

        {/* Middle Floating Home Button */}
        <View style={styles.homeBtnContainer}>
          <TouchableOpacity
            style={styles.floatingHomeBtn}
            onPress={() => { setActiveTab('home'); goBack(); }}
          >
            <Text style={styles.homeBtnText}>🏠</Text>
          </TouchableOpacity>
        </View>

        {/* Right Side Tab Buttons */}
        {!isDriver && !isPurchaseManager && !isTelecaller && (
          <TouchableOpacity
            style={styles.tabItem}
            onPress={() => { setActiveTab('beatPlan'); goBack(); }}
          >
            <Text style={[styles.tabIcon, activeTab === 'beatPlan' && styles.activeTabColor]}>🗺️</Text>
            <Text style={[styles.tabLabel, activeTab === 'beatPlan' && styles.activeTabColor]}>Beat Plan</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={styles.tabItem}
          onPress={() => { setActiveTab('profile'); goBack(); }}
        >
          <Text style={[styles.tabIcon, activeTab === 'profile' && styles.activeTabColor]}>👤</Text>
          <Text style={[styles.tabLabel, activeTab === 'profile' && styles.activeTabColor]}>Profile</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <LanguageProvider>
      <AppShell />
    </LanguageProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F7F9FC',
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0,
  },
  splash: {
    flex: 1,
    backgroundColor: '#F7F9FC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  permissionLoadingText: {
    marginTop: verticalScale(14),
    color: '#4A5568',
    fontWeight: '700',
  },
  permissionGateScreen: {
    flex: 1,
    backgroundColor: '#0F172A',
    alignItems: 'center',
    justifyContent: 'center',
    padding: scale(20),
  },
  permissionGateCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#111827',
    borderRadius: 18,
    padding: scale(22),
    borderWidth: 1,
    borderColor: '#1F2937',
  },
  permissionGateTitle: {
    color: '#FFFFFF',
    fontSize: responsiveFontSize(24),
    fontWeight: '900',
  },
  permissionGateDesc: {
    color: '#CBD5E1',
    fontSize: responsiveFontSize(14),
    lineHeight: 22,
    marginTop: verticalScale(10),
  },
  permissionList: {
    marginTop: verticalScale(18),
    marginBottom: verticalScale(18),
    gap: verticalScale(8),
  },
  permissionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: verticalScale(10),
  },
  permissionBullet: {
    color: '#F87171',
    fontSize: responsiveFontSize(18),
    fontWeight: '900',
  },
  permissionRowText: {
    color: '#F8FAFC',
    fontSize: responsiveFontSize(14),
    fontWeight: '700',
  },
  permissionPrimaryBtn: {
    backgroundColor: '#00796B',
    borderRadius: 12,
    paddingVertical: verticalScale(14),
    alignItems: 'center',
    marginBottom: verticalScale(10),
  },
  permissionPrimaryBtnText: {
    color: '#FFFFFF',
    fontWeight: '900',
    fontSize: responsiveFontSize(15),
  },
  permissionSecondaryBtn: {
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 12,
    paddingVertical: verticalScale(14),
    alignItems: 'center',
  },
  permissionSecondaryBtnText: {
    color: '#E2E8F0',
    fontWeight: '800',
    fontSize: responsiveFontSize(15),
  },
  header: {
    height: verticalScale(56),
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: scale(16),
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: verticalScale(14),
  },
  menuBtn: {
    paddingVertical: verticalScale(6),
    paddingRight: scale(6),
  },
  menuIcon: {
    fontSize: responsiveFontSize(20),
    color: '#4A5568',
  },
  logoImage: {
    width: scale(100),
    height: verticalScale(38),
    marginLeft: -12,
  },
  profileIndicator: {
    padding: scale(2),
  },
  // TEMPORARY, with the login screen's server box. Remove together.
  headerRightContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: verticalScale(16),
  },
  notificationIndicator: {
    position: 'relative',
    padding: scale(4),
  },
  bellIcon: {
    fontSize: responsiveFontSize(20),
  },
  badgeContainer: {
    position: 'absolute',
    top: -2,
    right: -4,
    backgroundColor: '#FF3B30',
    borderRadius: 9,
    minWidth: 18,
    height: verticalScale(18),
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: scale(3),
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: responsiveFontSize(10),
    fontWeight: '800',
  },
  avatarCircle: {
    width: scale(34),
    height: verticalScale(34),
    borderRadius: 17,
    backgroundColor: '#E0F2F1',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#00796B',
  },
  avatarCircleText: {
    fontSize: responsiveFontSize(12),
    fontWeight: '700',
    color: '#00796B',
  },
  contentBody: {
    flex: 1,
  },
  placeholderScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: scale(20),
  },
  placeholderText: {
    color: '#718096',
    fontSize: responsiveFontSize(14),
    fontWeight: '600',
  },
  tabBar: {
    // Height and padding both follow the real system bar rather than a fixed
    // guess, so the three-button navigation bar no longer sits on top of the
    // Report and Profile tabs.
    height: (Platform.OS === 'ios' ? 56 : 58) + bottomBarPadding(),
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    position: 'relative',
    paddingBottom: bottomBarPadding(),
  },
  tabItem: {
    alignItems: 'center',
    justifyContent: 'center',
    width: scale(60),
  },
  tabIcon: {
    fontSize: responsiveFontSize(18),
    color: '#A0AEC0',
  },
  tabLabel: {
    fontSize: responsiveFontSize(10),
    color: '#A0AEC0',
    marginTop: verticalScale(2),
    fontWeight: '600',
  },
  activeTabColor: {
    color: '#00796B',
  },
  homeBtnContainer: {
    width: scale(74),
    height: verticalScale(74),
    borderRadius: 37,
    backgroundColor: '#F7F9FC',
    alignItems: 'center',
    justifyContent: 'center',
    top: Platform.OS === 'ios' ? -22 : -25,
  },
  floatingHomeBtn: {
    width: scale(58),
    height: verticalScale(58),
    borderRadius: 29,
    backgroundColor: '#00BFA5',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#00BFA5',
    shadowOffset: { width: 0, height: verticalScale(4) },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 4,
  },
  homeBtnText: {
    fontSize: responsiveFontSize(24),
    color: '#FFFFFF',
  },
});
