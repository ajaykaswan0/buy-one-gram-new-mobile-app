import React, { useState, useEffect, useRef } from 'react';
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
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import LoginScreen from './src/screens/LoginScreen';
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
import MyTeamScreen from './src/screens/MyTeamScreen';
import RecoveryScreen from './src/screens/RecoveryScreen';
import SalesPartnerDashboardScreen from './src/screens/SalesPartnerDashboardScreen';

const LOCATION_TRACKING_TASK = 'LOCATION_TRACKING_TASK';

// Define the global background location updates task
TaskManager.defineTask(LOCATION_TRACKING_TASK, async ({ data, error }) => {
  if (error) {
    console.log('[Background Tracker] Task error:', error);
    return;
  }
  if (data) {
    const { locations } = data;
    if (locations && locations.length > 0) {
      const location = locations[0];
      const { latitude, longitude, accuracy } = location.coords;
      
      try {
        const token = await AsyncStorage.getItem('token');
        const logId = await AsyncStorage.getItem('active_log_id');
        const apiUrl = await AsyncStorage.getItem('api_url') || 'http://localhost:5000/api';
        
        if (token && logId) {
          const response = await fetch(`${apiUrl}/daily-log/location`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              logId,
              latitude,
              longitude,
              accuracy,
            }),
          });
          const resData = await response.json();
          if (response.ok) {
            console.log(`[Background Tracker] Location reported: Lat=${latitude.toFixed(5)}, Lng=${longitude.toFixed(5)}`);
          }
        }
      } catch (e) {
        console.log('[Background Tracker] Storage read/reporting error:', e.message);
      }
    }
  }
});

export default function App() {
  const [appReady, setAppReady] = useState(false);
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [apiUrl, setApiUrl] = useState('http://localhost:5000/api');
  
  // Navigation states
  const [activeTab, setActiveTab] = useState('home');
  const [subScreen, setSubScreen] = useState(null);
  const [orderParty, setOrderParty] = useState(null);
  const [profilePartyId, setProfilePartyId] = useState(null);
  const [collectionParty, setCollectionParty] = useState(null);
  const [previousSubScreen, setPreviousSubScreen] = useState(null);

  // Tracking states
  const [activeLogId, setActiveLogId] = useState(null);
  const checkStatusIntervalRef = useRef(null);

  // Notification count
  const [unreadCount, setUnreadCount] = useState(0);

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
      if (subScreen) {
        if (subScreen === 'order' && previousSubScreen) {
          setSubScreen(previousSubScreen);
          setPreviousSubScreen(null);
          setOrderParty(null);
        } else {
          setSubScreen(null);
        }
        return true; // prevent default behavior (exiting the app)
      }
      // If we are not on the home tab, hardware back button goes back to home tab
      if (activeTab !== 'home') {
        setActiveTab('home');
        return true;
      }
      return false; // let standard exit behavior happen
    };

    const backHandler = BackHandler.addEventListener(
      'hardwareBackPress',
      backAction
    );

    return () => backHandler.remove();
  }, [subScreen, previousSubScreen, activeTab]);

  // 1. Initialize auth state on mount
  useEffect(() => {
    const initializeApp = async () => {
      try {
        const storedToken = await AsyncStorage.getItem('token');
        const storedUser = await AsyncStorage.getItem('user');
        const storedApiUrl = await AsyncStorage.getItem('api_url');

        if (storedApiUrl) {
          setApiUrl(storedApiUrl);
        }

        if (storedToken && storedUser) {
          setToken(storedToken);
          setUser(JSON.parse(storedUser));
          setActiveTab('home');
        }
      } catch (e) {
        console.error('Failed to restore auth states', e);
      } finally {
        setAppReady(true);
      }
    };

    initializeApp();
  }, []);

  // 2. Manage background location reporting based on daily log status
  useEffect(() => {
    if (!token) {
      stopBackgroundLocationReporting();
      stopStatusChecking();
      return;
    }

    const checkDailyLogStatus = async () => {
      try {
        const res = await fetch(`${apiUrl}/daily-log/my/today`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        
        if (res.ok && data.success && data.data) {
          const log = data.data;
          if (!log.endTime) {
            if (activeLogId !== log._id) {
              setActiveLogId(log._id);
              startBackgroundLocationReporting(log._id);
            }
          } else {
            // Log ended (salesman checked out)
            stopBackgroundLocationReporting();
            setActiveLogId(null);
          }
        } else {
          // No log active today (offline)
          stopBackgroundLocationReporting();
          setActiveLogId(null);
        }
        // Fetch notification count too
        fetchUnreadCount();
      } catch (e) {
        console.log('[Status Check] Error querying daily log status:', e.message);
      }
    };

    checkDailyLogStatus();

    // Check status every 30 seconds
    checkStatusIntervalRef.current = setInterval(checkDailyLogStatus, 30000);

    return () => {
      stopStatusChecking();
    };
  }, [token, apiUrl, activeLogId, subScreen]);

  const startBackgroundLocationReporting = async (logId) => {
    try {
      await AsyncStorage.setItem('active_log_id', logId);

      // Request location permissions
      const { status: foregroundStatus } = await Location.requestForegroundPermissionsAsync();
      if (foregroundStatus !== 'granted') {
        console.log('[Background Tracker] Foreground GPS permission denied');
        return;
      }

      const { status: backgroundStatus } = await Location.requestBackgroundPermissionsAsync();
      if (backgroundStatus !== 'granted') {
        console.log('[Background Tracker] Background GPS permission denied');
        return;
      }

      const hasStarted = await Location.hasStartedLocationUpdatesAsync(LOCATION_TRACKING_TASK);
      if (!hasStarted) {
        await Location.startLocationUpdatesAsync(LOCATION_TRACKING_TASK, {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: 20000, // 20s
          distanceInterval: 5,  // 5 meters
          deferredUpdatesInterval: 20000,
          // Foreground Service notification properties
          foregroundService: {
            notificationTitle: "BYG Tracking Active",
            notificationBody: "Reporting your location in the background.",
            notificationColor: "#00796B",
          },
        });
        console.log('[Background Tracker] Native Android Background Service successfully started.');
      }
    } catch (e) {
      console.log('[Background Tracker] Error starting location updates:', e.message);
    }
  };

  const stopBackgroundLocationReporting = async () => {
    try {
      await AsyncStorage.removeItem('active_log_id');
      const hasStarted = await Location.hasStartedLocationUpdatesAsync(LOCATION_TRACKING_TASK);
      if (hasStarted) {
        await Location.stopLocationUpdatesAsync(LOCATION_TRACKING_TASK);
        console.log('[Background Tracker] Native Android Background Service stopped.');
      }
    } catch (e) {
      console.log('[Background Tracker] Error stopping location updates:', e.message);
    }
  };

  const stopStatusChecking = () => {
    if (checkStatusIntervalRef.current) {
      clearInterval(checkStatusIntervalRef.current);
      checkStatusIntervalRef.current = null;
    }
  };

  const handleLoginSuccess = (newToken, newUser, currentUrl) => {
    setToken(newToken);
    setUser(newUser);
    setApiUrl(currentUrl);
    setActiveTab('home');
    setSubScreen(null);
  };

  const handleLogout = async () => {
    try {
      await AsyncStorage.removeItem('token');
      await AsyncStorage.removeItem('user');
      await stopBackgroundLocationReporting();
      stopStatusChecking();
      setToken(null);
      setUser(null);
      setActiveTab('home');
      setSubScreen(null);
    } catch (e) {
      console.error('Failed to logout', e);
    }
  };

  if (!appReady) {
    return (
      <View style={styles.splash}>
        <ActivityIndicator color="#00796B" size="large" />
      </View>
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
  const isDriver = normalizedRole === 'driver';
  const isCrm = normalizedRole === 'crm' || normalizedRole === 'customerrelationshipmanager';
  const isCso = normalizedRole === 'cso';
  const isSalesPartner = normalizedRole === 'salespartner';

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />

      {/* Global Top Header Bar */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <TouchableOpacity onPress={() => { setActiveTab('home'); setSubScreen(null); }}>
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
            onPress={() => setSubScreen('notifications')}
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
            onPress={() => { setActiveTab('profile'); setSubScreen(null); }}
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
            onBack={() => setSubScreen(null)}
          />
        ) : subScreen === 'crmParties' ? (
          <CrmDashboardScreen
            token={token}
            apiUrl={apiUrl}
            user={user}
            onNavigateToPartyProfile={(partyId) => {
              setPreviousSubScreen('crmParties');
              setProfilePartyId(partyId);
              setSubScreen('partyProfile');
            }}
            onNavigateToCollection={(party) => {
              setPreviousSubScreen('crmParties');
              setCollectionParty(party);
              setSubScreen('collection');
            }}
            onNavigateToOrder={(party) => {
              setPreviousSubScreen('crmParties');
              setOrderParty(party);
              setSubScreen('order');
            }}
          />
        ) : subScreen === 'team' ? (
          <MyTeamScreen
            token={token}
            apiUrl={apiUrl}
            user={user}
            onBack={() => setSubScreen(null)}
            onNavigateToOrder={(party) => {
              setPreviousSubScreen('team');
              setOrderParty(party);
              setSubScreen('order');
            }}
          />
        ) : subScreen === 'issues' ? (
          <AssignedIssuesScreen token={token} apiUrl={apiUrl} onBack={() => setSubScreen(null)} />
        ) : subScreen === 'recovery' ? (
          <RecoveryScreen token={token} apiUrl={apiUrl} onBack={() => setSubScreen(null)} />
        ) : subScreen === 'routePlanner' ? (
          <PartyRoutePlannerScreen token={token} apiUrl={apiUrl} onBack={() => setSubScreen(null)} />
        ) : subScreen === 'leave' ? (
          <LeaveScreen
            token={token}
            apiUrl={apiUrl}
            onBack={() => setSubScreen(null)}
          />
        ) : subScreen === 'party' ? (
          <VisitScreen
            token={token}
            user={user}
            apiUrl={apiUrl}
            onBack={() => setSubScreen(null)}
            onNavigateToOrder={(party) => {
              setPreviousSubScreen('party');
              setOrderParty(party);
              setSubScreen('order');
            }}
            onNavigateToCollection={(party) => {
              setPreviousSubScreen('party');
              setCollectionParty(party);
              setSubScreen('collection');
            }}
          />
        ) : subScreen === 'collection' ? (
          <CreateCollectionScreen
            token={token}
            apiUrl={apiUrl}
            party={collectionParty}
            onBack={() => {
              setSubScreen(previousSubScreen || null);
              setPreviousSubScreen(null);
              setCollectionParty(null);
            }}
          />
        ) : subScreen === 'partyProfile' ? (
          <PartyProfileScreen
            token={token}
            apiUrl={apiUrl}
            partyId={profilePartyId}
            onBack={() => {
              setSubScreen(previousSubScreen || null);
              setPreviousSubScreen(null);
              setProfilePartyId(null);
            }}
            onNavigateToOrder={(party) => {
              setPreviousSubScreen('partyProfile');
              setOrderParty(party);
              setSubScreen('order');
            }}
            onNavigateToCollection={(party) => {
              setPreviousSubScreen('partyProfile');
              setCollectionParty(party);
              setSubScreen('collection');
            }}
          />
        ) : subScreen === 'order' ? (
          <OrderScreen
            token={token}
            apiUrl={apiUrl}
            user={user}
            preSelectedParty={orderParty}
            onBack={() => {
              setSubScreen(previousSubScreen || null);
              setPreviousSubScreen(null);
              setOrderParty(null);
            }}
          />
        ) : subScreen === 'products' ? (
          <ProductScreen
            token={token}
            apiUrl={apiUrl}
            user={user}
            onBack={() => setSubScreen(null)}
          />
        ) : subScreen === 'orderList' ? (
          <OrderListScreen
            token={token}
            apiUrl={apiUrl}
            onBack={() => setSubScreen(null)}
          />
        ) : subScreen === 'notifications' ? (
          <NotificationScreen
            token={token}
            apiUrl={apiUrl}
            onBack={() => setSubScreen(null)}
            onClearBadge={() => setUnreadCount(0)}
          />
        ) : subScreen === 'outstandingList' ? (
          <OutstandingListScreen
            token={token}
            apiUrl={apiUrl}
            onBack={() => setSubScreen(null)}
            onNavigateToOrder={(party) => {
              setPreviousSubScreen('outstandingList');
              setOrderParty(party);
              setSubScreen('order');
            }}
          />
        ) : activeTab === 'home' ? (
          isDriver ? (
            <DriverDashboardScreen
              token={token}
              apiUrl={apiUrl}
              activeLogId={activeLogId}
              onNavigateToAttendance={() => setSubScreen('attendance')}
              onNavigateToLeave={() => setSubScreen('leave')}
              onNavigateToProducts={() => setSubScreen('products')}
            />
          ) : isCrm ? (
            <CrmHomeScreen
              token={token}
              apiUrl={apiUrl}
              user={user}
              activeLogId={activeLogId}
              onNavigateToAttendance={() => setSubScreen('attendance')}
              onNavigateToLeave={() => setSubScreen('leave')}
              onNavigateToProducts={() => setSubScreen('products')}
              onNavigateToOrder={() => {
                setPreviousSubScreen(null);
                setOrderParty(null);
                setSubScreen('order');
              }}
              onNavigateToIssues={() => setSubScreen('issues')}
              onNavigateToRecovery={() => setSubScreen('recovery')}
              onNavigateToRoutePlanner={() => setSubScreen('routePlanner')}
              onNavigateToParties={() => setSubScreen('crmParties')}
            />
          ) : isSalesPartner ? (
            <SalesPartnerDashboardScreen
              token={token}
              apiUrl={apiUrl}
              user={user}
              onLogout={handleLogout}
              onNavigateToParty={() => setSubScreen('party')}
              onNavigateToOrder={() => {
                setPreviousSubScreen(null);
                setOrderParty(null);
                setSubScreen('order');
              }}
              onNavigateToOrderList={() => setSubScreen('orderList')}
              onNavigateToProducts={() => setSubScreen('products')}
              onNavigateToRoutePlanner={() => setSubScreen('routePlanner')}
            />
          ) : (
            <DashboardScreen
              token={token}
              apiUrl={apiUrl}
              activeLogId={activeLogId}
              onNavigateToAttendance={() => setSubScreen('attendance')}
              onNavigateToLeave={() => setSubScreen('leave')}
              onNavigateToParty={() => setSubScreen('party')}
              onNavigateToOrder={() => {
                setPreviousSubScreen(null);
                setOrderParty(null);
                setSubScreen('order');
              }}
              onNavigateToProducts={() => setSubScreen('products')}
              onNavigateToOrderList={() => setSubScreen('orderList')}
              onNavigateToOutstandingList={() => setSubScreen('outstandingList')}
              onNavigateToRoutePlanner={() => setSubScreen('routePlanner')}
              onNavigateToBeatPlan={() => { setActiveTab('beatPlan'); setSubScreen(null); }}
              user={user}
              isCso={isCso}
              onNavigateToTeam={() => setSubScreen('team')}
            />
          )
        ) : activeTab === 'profile' ? (
          <ProfileScreen
            user={user}
            token={token}
            apiUrl={apiUrl}
            onLogout={handleLogout}
          />
        ) : activeTab === 'history' ? (
          isSalesPartner ? (
            <OrderListScreen
              token={token}
              apiUrl={apiUrl}
              onBack={() => { setActiveTab('home'); setSubScreen(null); }}
            />
          ) : (
          <VisitHistoryScreen
            token={token}
            apiUrl={apiUrl}
            user={user}
          />
          )
        ) : activeTab === 'report' ? (
          isSalesPartner ? (
            <PartyRoutePlannerScreen
              token={token}
              apiUrl={apiUrl}
              onBack={() => { setActiveTab('home'); setSubScreen(null); }}
            />
          ) : (
          <ReportScreen
            token={token}
            apiUrl={apiUrl}
          />
          )
        ) : activeTab === 'beatPlan' ? (
          <BeatPlanScreen
            token={token}
            apiUrl={apiUrl}
            activeLogId={activeLogId}
            user={user}
            onNavigateToPartyProfile={(partyId) => {
              setPreviousSubScreen('beatPlan');
              setProfilePartyId(partyId);
              setSubScreen('partyProfile');
            }}
          />
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
        <TouchableOpacity
          style={styles.tabItem}
          onPress={() => { setActiveTab('report'); setSubScreen(null); }}
        >
            <Text style={[styles.tabIcon, activeTab === 'report' && styles.activeTabColor]}>{isSalesPartner ? '🗺️' : '📊'}</Text>
          <Text style={[styles.tabLabel, activeTab === 'report' && styles.activeTabColor]}>{isSalesPartner ? 'Route' : 'Report'}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.tabItem}
          onPress={() => { setActiveTab('history'); setSubScreen(null); }}
        >
          <Text style={[styles.tabIcon, activeTab === 'history' && styles.activeTabColor]}>{isSalesPartner ? '📋' : '🕒'}</Text>
          <Text style={[styles.tabLabel, activeTab === 'history' && styles.activeTabColor]}>{isSalesPartner ? 'Orders' : 'History'}</Text>
        </TouchableOpacity>

        {/* Middle Floating Home Button */}
        <View style={styles.homeBtnContainer}>
          <TouchableOpacity
            style={styles.floatingHomeBtn}
            onPress={() => { setActiveTab('home'); setSubScreen(null); }}
          >
            <Text style={styles.homeBtnText}>🏠</Text>
          </TouchableOpacity>
        </View>

        {/* Right Side Tab Buttons */}
        <TouchableOpacity
          style={styles.tabItem}
          onPress={() => { setActiveTab('beatPlan'); setSubScreen(null); }}
        >
          <Text style={[styles.tabIcon, activeTab === 'beatPlan' && styles.activeTabColor]}>🗺️</Text>
          <Text style={[styles.tabLabel, activeTab === 'beatPlan' && styles.activeTabColor]}>Beat Plan</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.tabItem}
          onPress={() => { setActiveTab('profile'); setSubScreen(null); }}
        >
          <Text style={[styles.tabIcon, activeTab === 'profile' && styles.activeTabColor]}>👤</Text>
          <Text style={[styles.tabLabel, activeTab === 'profile' && styles.activeTabColor]}>Profile</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
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
  header: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  menuBtn: {
    paddingVertical: 6,
    paddingRight: 6,
  },
  menuIcon: {
    fontSize: 20,
    color: '#4A5568',
  },
  logoImage: {
    width: 100,
    height: 38,
    marginLeft: -12,
  },
  profileIndicator: {
    padding: 2,
  },
  headerRightContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  notificationIndicator: {
    position: 'relative',
    padding: 4,
  },
  bellIcon: {
    fontSize: 20,
  },
  badgeContainer: {
    position: 'absolute',
    top: -2,
    right: -4,
    backgroundColor: '#FF3B30',
    borderRadius: 9,
    minWidth: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
  },
  avatarCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#E0F2F1',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#00796B',
  },
  avatarCircleText: {
    fontSize: 12,
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
    padding: 20,
  },
  placeholderText: {
    color: '#718096',
    fontSize: 14,
    fontWeight: '600',
  },
  tabBar: {
    height: Platform.OS === 'ios' ? 76 : 78,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    position: 'relative',
    paddingBottom: Platform.OS === 'ios' ? 20 : 22,
  },
  tabItem: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 60,
  },
  tabIcon: {
    fontSize: 18,
    color: '#A0AEC0',
  },
  tabLabel: {
    fontSize: 10,
    color: '#A0AEC0',
    marginTop: 2,
    fontWeight: '600',
  },
  activeTabColor: {
    color: '#00796B',
  },
  homeBtnContainer: {
    width: 74,
    height: 74,
    borderRadius: 37,
    backgroundColor: '#F7F9FC',
    alignItems: 'center',
    justifyContent: 'center',
    top: Platform.OS === 'ios' ? -22 : -25,
  },
  floatingHomeBtn: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#00BFA5',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#00BFA5',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 4,
  },
  homeBtnText: {
    fontSize: 24,
    color: '#FFFFFF',
  },
});
