import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ActivityIndicator,
  SafeAreaView,
  ScrollView,
  Animated,
  Image,
} from 'react-native';
import { scale, verticalScale, responsiveFontSize, maxContainerWidth } from '../utils/responsive';
import Geolocation from '@react-native-community/geolocation';
import { launchCamera } from 'react-native-image-picker';

export default function AttendanceScreen({ token, apiUrl, onBack }) {
  const [todayRecord, setTodayRecord] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [marking, setMarking] = useState(false);
  const [error, setError] = useState('');
  const [currentTime, setCurrentTime] = useState(new Date());

  const flashAnim = useState(new Animated.Value(0))[0];

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 10000);
    return () => clearInterval(timer);
  }, []);

  const loadAttendanceData = async () => {
    setLoading(true);
    setError('');
    try {
      const [todayRes, historyRes] = await Promise.all([
        fetch(`${apiUrl}/attendance/my/today`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`${apiUrl}/attendance/my`, {
          headers: { Authorization: `Bearer ${token}` },
        })
      ]);

      const todayData = await todayRes.json();
      const historyData = await historyRes.json();

      if (todayRes.ok && historyRes.ok) {
        setTodayRecord(todayData.data || null);
        setHistory(historyData.data || []);
      } else {
        throw new Error('Failed to load data from server');
      }
    } catch (err) {
      setError(err.message || 'Connection error.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAttendanceData();
  }, [apiUrl, token]);

  const triggerCameraFlash = () => {
    flashAnim.setValue(1);
    Animated.timing(flashAnim, {
      toValue: 0,
      duration: 300,
      useNativeDriver: true,
    }).start();
  };

  const handleAttendance = async () => {
    const isCheckedIn = !!(todayRecord && todayRecord.checkInTime);
    const isCheckedOut = !!(todayRecord && todayRecord.checkOutTime);

    if (isCheckedIn && !isCheckedOut) {
      // Check 20h limit rule
      const checkInTimeDate = new Date(todayRecord.checkInTime);
      const elapsedHours = (currentTime - checkInTimeDate) / (1000 * 60 * 60);
      if (elapsedHours > 20) {
        setError('Checkout locked: Time exceeded 20 hours. Contact Admin.');
        return;
      }
      handleCheckOut();
    } else {
      handleCheckIn();
    }
  };

  const handleCheckIn = () => {
    setError('');
    
    // 1. Launch native Android camera to take photo
    launchCamera(
      {
        mediaType: 'photo',
        cameraType: 'front',
        quality: 0.4,
        includeBase64: true,
      },
      async (response) => {
        if (response.didCancel) {
          setError('Check-in cancelled: Photo is mandatory.');
          return;
        }
        if (response.errorCode) {
          setError(`Camera error: ${response.errorMessage || 'Unknown error'}`);
          return;
        }

        const base64Photo = response.assets?.[0]?.base64;
        if (!base64Photo) {
          setError('Failed to capture photo data.');
          return;
        }

        setMarking(true);
        triggerCameraFlash();

        // 2. Fetch live native GPS location coordinates
        Geolocation.getCurrentPosition(
          async (position) => {
            const { latitude, longitude, accuracy } = position.coords;

            try {
              const checkinRes = await fetch(`${apiUrl}/attendance/checkin`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                  latitude,
                  longitude,
                  address: `GPS Coordinate: ${latitude.toFixed(4)}, ${longitude.toFixed(4)} (Accuracy: ${accuracy.toFixed(1)}m)`,
                  photo: `data:image/jpeg;base64,${base64Photo}`,
                }),
              });

              const checkinData = await checkinRes.json();
              if (!checkinRes.ok) {
                throw new Error(checkinData.message || 'Check-in failed');
              }

              setTodayRecord(checkinData.data);
              
              // Reload history logs
              const historyRes = await fetch(`${apiUrl}/attendance/my`, {
                headers: { Authorization: `Bearer ${token}` },
              });
              const historyData = await historyRes.json();
              if (historyRes.ok) {
                setHistory(historyData.data || []);
              }
            } catch (err) {
              setError(err.message || 'Network error.');
            } finally {
              setMarking(false);
            }
          },
          (geoError) => {
            setMarking(false);
            setError(`GPS Error: ${geoError.message}. Make sure Location is enabled.`);
          },
          { enableHighAccuracy: false, timeout: 20000, maximumAge: 10000 }
        );
      }
    );
  };

  const handleCheckOut = () => {
    setError('');
    
    // 1. Launch native Android camera to take check-out photo
    launchCamera(
      {
        mediaType: 'photo',
        cameraType: 'front',
        quality: 0.4,
        includeBase64: true,
      },
      async (response) => {
        if (response.didCancel) {
          setError('Check-out cancelled: Photo is mandatory.');
          return;
        }
        if (response.errorCode) {
          setError(`Camera error: ${response.errorMessage || 'Unknown error'}`);
          return;
        }

        const base64Photo = response.assets?.[0]?.base64;
        if (!base64Photo) {
          setError('Failed to capture photo data.');
          return;
        }

        setMarking(true);
        triggerCameraFlash();

        // 2. Fetch live native GPS location coordinates
        Geolocation.getCurrentPosition(
          async (position) => {
            const { latitude, longitude, accuracy } = position.coords;

            try {
              const checkoutRes = await fetch(`${apiUrl}/attendance/checkout`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                  latitude,
                  longitude,
                  address: `GPS Coordinate: ${latitude.toFixed(4)}, ${longitude.toFixed(4)} (Accuracy: ${accuracy.toFixed(1)}m)`,
                  photo: `data:image/jpeg;base64,${base64Photo}`,
                }),
              });

              const checkoutData = await checkoutRes.json();
              if (!checkoutRes.ok) {
                throw new Error(checkoutData.message || 'Check-out failed');
              }

              setTodayRecord(checkoutData.data);
              
              // Reload history logs
              const historyRes = await fetch(`${apiUrl}/attendance/my`, {
                headers: { Authorization: `Bearer ${token}` },
              });
              const historyData = await historyRes.json();
              if (historyRes.ok) {
                setHistory(historyData.data || []);
              }
            } catch (err) {
              setError(err.message || 'Network error.');
            } finally {
              setMarking(false);
            }
          },
          (geoError) => {
            setMarking(false);
            setError(`GPS Error: ${geoError.message}. Make sure Location is enabled.`);
          },
          { enableHighAccuracy: false, timeout: 20000, maximumAge: 10000 }
        );
      }
    );
  };

  const isCheckedIn = !!(todayRecord && todayRecord.checkInTime);
  const isCheckedOut = !!(todayRecord && todayRecord.checkOutTime);

  const formatTime = (timeStr) => {
    if (!timeStr) return '';
    const date = new Date(timeStr);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const formatDateLabel = (dateStr) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) return 'Today';
    if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  const checkInTimeDate = todayRecord?.checkInTime ? new Date(todayRecord.checkInTime) : null;
  const elapsedHours = checkInTimeDate ? (currentTime - checkInTimeDate) / (1000 * 60 * 60) : 0;
  const exceeds20Hours = isCheckedIn && !isCheckedOut && elapsedHours > 20;

  const historyList = React.useMemo(() => {
    const mapByDate = new Map();

    (history || []).forEach((log) => {
      const rawDate = log.date || log.checkInTime || log.checkOutTime || log.createdAt;
      if (!rawDate) return;
      const dateObj = new Date(rawDate);
      if (isNaN(dateObj.getTime())) return;
      const dateKey = dateObj.toDateString();

      if (!mapByDate.has(dateKey)) {
        mapByDate.set(dateKey, {
          dateObj,
          checkInTime: log.checkInTime || null,
          checkOutTime: log.checkOutTime || null,
          id: log._id || dateKey,
        });
      } else {
        const existing = mapByDate.get(dateKey);
        if (!existing.checkInTime && log.checkInTime) {
          existing.checkInTime = log.checkInTime;
        } else if (existing.checkInTime && log.checkInTime && new Date(log.checkInTime) < new Date(existing.checkInTime)) {
          existing.checkInTime = log.checkInTime;
        }

        if (!existing.checkOutTime && log.checkOutTime) {
          existing.checkOutTime = log.checkOutTime;
        } else if (existing.checkOutTime && log.checkOutTime && new Date(log.checkOutTime) > new Date(existing.checkOutTime)) {
          existing.checkOutTime = log.checkOutTime;
        }
      }
    });

    const groupedArray = Array.from(mapByDate.values()).sort((a, b) => b.dateObj - a.dateObj);

    return groupedArray.slice(0, 5).map((log) => {
      const inTimeStr = log.checkInTime ? formatTime(log.checkInTime) : '--';
      const outTimeStr = log.checkOutTime ? formatTime(log.checkOutTime) : '--';
      
      const inDate = log.checkInTime ? new Date(log.checkInTime) : null;
      const onTime = inDate ? (inDate.getHours() < 9 || (inDate.getHours() === 9 && inDate.getMinutes() === 0)) : false;

      const subtitle = `Check-in: ${inTimeStr}  Check-out: ${outTimeStr}`;

      return {
        key: log.id,
        dateLabel: formatDateLabel(log.dateObj),
        subtitle,
        tagLabel: onTime ? 'On Time' : (inDate ? 'Late' : 'Absent'),
        tagType: onTime ? 'success' : (inDate ? 'danger' : 'info'),
        timestamp: log.dateObj,
      };
    });
  }, [history]);

  const totalPresentDays = history.filter(h => h.attendanceStatus === 'present' || h.checkInTime).length;

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={onBack}>
          <Text style={styles.backBtnText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Attendance</Text>
      </View>

      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.cameraBox}>
          <View style={[styles.corner, styles.topLeft]} />
          <View style={[styles.corner, styles.topRight]} />
          <View style={[styles.corner, styles.bottomLeft]} />
          <View style={[styles.corner, styles.bottomRight]} />

          <Text style={styles.cameraTitle}>Align your face within the frame</Text>

          <Image
            source={{ uri: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80' }}
            style={styles.faceGuideImage}
            resizeMode="cover"
          />

          <TouchableOpacity
            style={styles.triggerBorder}
            onPress={handleAttendance}
            disabled={marking || exceeds20Hours}
          >
            <View style={styles.triggerInner} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.checkBtn,
              isCheckedIn && !isCheckedOut && styles.checkoutColor,
              (marking || exceeds20Hours) && styles.disabledBtn
            ]}
            onPress={handleAttendance}
            disabled={marking || exceeds20Hours}
          >
            {marking ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.checkBtnText}>
                {isCheckedIn && !isCheckedOut ? 'Check Out' : 'Check In'}
              </Text>
            )}
          </TouchableOpacity>

          <Animated.View style={[styles.flashOverlay, { opacity: flashAnim }]} pointerEvents="none" />
        </View>

        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        {exceeds20Hours ? (
          <Text style={styles.lockoutText}>
            ⚠️ CHECK-OUT EXCEEDED 20 HOURS LIMIT. Please contact Admin.
          </Text>
        ) : null}

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Recent History</Text>
          <TouchableOpacity>
            <Text style={styles.viewAllText}>View All</Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <ActivityIndicator color="#00796B" style={{ marginVertical: 20 }} />
        ) : (
          <View style={styles.logsList}>
            {historyList.length === 0 ? (
              <Text style={styles.emptyText}>No check-ins recorded yet.</Text>
            ) : (
              historyList.map((item) => (
                <View style={styles.logCard} key={item.key}>
                  <View style={styles.cardLeft}>
                    <View style={[styles.iconBox, styles.inIconBg]}>
                      <Text style={styles.iconText}>📅</Text>
                    </View>
                    <View>
                      <Text style={styles.logTitle}>{item.dateLabel}</Text>
                      <Text style={styles.logSubtitle}>{item.subtitle}</Text>
                    </View>
                  </View>
                  <View style={[
                    styles.pillTag,
                    item.tagType === 'success' && styles.successPill,
                    item.tagType === 'danger' && styles.dangerPill,
                    item.tagType === 'info' && styles.infoPill,
                  ]}>
                    <Text style={[
                      styles.pillText,
                      item.tagType === 'success' && styles.successPillText,
                      item.tagType === 'danger' && styles.dangerPillText,
                      item.tagType === 'info' && styles.infoPillText,
                    ]}>
                      {item.tagLabel}
                    </Text>
                  </View>
                </View>
              ))
            )}
          </View>
        )}

        <View style={styles.bottomStats}>
          <View style={[styles.statCard, styles.greenStatBg]}>
            <Text style={styles.statLabel}>PRESENT</Text>
            <Text style={[styles.statNum, styles.greenStatText]}>{totalPresentDays} Days</Text>
          </View>
          <View style={[styles.statCard, styles.slateStatBg]}>
            <Text style={styles.statLabel}>AVG TIME</Text>
            <Text style={[styles.statNum, styles.slateStatText]}>08:35 Hours</Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F7F9FC',
  },
  header: {
    height: verticalScale(56),
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: scale(16),
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
  },
  backBtn: {
    paddingVertical: verticalScale(8),
    paddingRight: scale(16),
  },
  backBtnText: {
    color: '#00796B',
    fontWeight: '700',
    fontSize: responsiveFontSize(14.5),
  },
  headerTitle: {
    fontSize: responsiveFontSize(16),
    fontWeight: '700',
    color: '#2D3748',
  },
  container: {
    paddingBottom: verticalScale(40),
  },
  cameraBox: {
    backgroundColor: '#2D3748',
    height: verticalScale(380),
    alignItems: 'center',
    justifyContent: 'center',
    padding: scale(24),
    position: 'relative',
  },
  corner: {
    position: 'absolute',
    width: scale(28),
    height: verticalScale(28),
    borderColor: '#00BFA5',
  },
  topLeft: {
    top: 50,
    left: 45,
    borderTopWidth: 4,
    borderLeftWidth: 4,
    borderTopLeftRadius: 6,
  },
  topRight: {
    top: 50,
    right: 45,
    borderTopWidth: 4,
    borderRightWidth: 4,
    borderTopRightRadius: 6,
  },
  bottomLeft: {
    bottom: 120,
    left: 45,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
    borderBottomLeftRadius: 6,
  },
  bottomRight: {
    bottom: 120,
    right: 45,
    borderBottomWidth: 4,
    borderRightWidth: 4,
    borderBottomRightRadius: 6,
  },
  cameraTitle: {
    color: '#FFFFFF',
    fontSize: responsiveFontSize(14),
    fontWeight: '700',
    marginBottom: verticalScale(12),
    marginTop: verticalScale(10),
  },
  faceGuideImage: {
    width: scale(60),
    height: verticalScale(60),
    borderRadius: 30,
    borderWidth: 2,
    borderColor: '#00BFA5',
    marginBottom: verticalScale(20),
  },
  triggerBorder: {
    width: scale(70),
    height: verticalScale(70),
    borderRadius: 35,
    borderWidth: 5,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: verticalScale(40),
  },
  triggerInner: {
    width: scale(52),
    height: verticalScale(52),
    borderRadius: 26,
    backgroundColor: '#00897B',
  },
  checkBtn: {
    backgroundColor: '#00897B',
    paddingVertical: verticalScale(12),
    paddingHorizontal: scale(40),
    borderRadius: 20,
    width: '60%',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 3,
  },
  checkoutColor: {
    backgroundColor: '#00796B',
  },
  disabledBtn: {
    opacity: 0.5,
  },
  checkBtnText: {
    color: '#FFFFFF',
    fontSize: responsiveFontSize(14.5),
    fontWeight: '700',
  },
  flashOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#FFFFFF',
  },
  errorText: {
    color: '#E53E3E',
    backgroundColor: '#FFF5F5',
    padding: scale(10),
    borderRadius: 8,
    fontSize: responsiveFontSize(12.5),
    fontWeight: '600',
    textAlign: 'center',
    margin: scale(16),
  },
  lockoutText: {
    color: '#D69E2E',
    backgroundColor: '#FEFCBF',
    borderWidth: 1,
    borderColor: '#FEEBC8',
    padding: scale(12),
    borderRadius: 8,
    fontSize: responsiveFontSize(12.5),
    fontWeight: '600',
    textAlign: 'center',
    marginHorizontal: scale(16),
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: scale(20),
    marginTop: verticalScale(24),
    marginBottom: verticalScale(14),
  },
  sectionTitle: {
    fontSize: responsiveFontSize(18),
    fontWeight: '700',
    color: '#1A202C',
  },
  viewAllText: {
    color: '#00796B',
    fontSize: responsiveFontSize(13),
    fontWeight: '700',
  },
  logsList: {
    paddingHorizontal: scale(20),
    gap: verticalScale(12),
  },
  emptyText: {
    textAlign: 'center',
    color: '#718096',
    marginVertical: verticalScale(12),
    fontSize: responsiveFontSize(13),
  },
  logCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: scale(14),
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: verticalScale(12),
  },
  iconBox: {
    width: scale(38),
    height: verticalScale(38),
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inIconBg: {
    backgroundColor: '#E0F2F1',
  },
  outIconBg: {
    backgroundColor: '#E8EAF6',
  },
  iconText: {
    fontSize: responsiveFontSize(18),
    fontWeight: '700',
    color: '#00796B',
  },
  logTitle: {
    fontSize: responsiveFontSize(14),
    fontWeight: '700',
    color: '#2D3748',
  },
  logSubtitle: {
    fontSize: responsiveFontSize(12),
    color: '#718096',
    marginTop: verticalScale(2),
    fontWeight: '500',
  },
  pillTag: {
    paddingVertical: verticalScale(4),
    paddingHorizontal: scale(10),
    borderRadius: 12,
  },
  successPill: {
    backgroundColor: '#E0F2F1',
  },
  successPillText: {
    color: '#00796B',
  },
  dangerPill: {
    backgroundColor: '#FED7D7',
  },
  dangerPillText: {
    color: '#E53E3E',
  },
  infoPill: {
    backgroundColor: '#E8EAF6',
  },
  infoPillText: {
    color: '#3F51B5',
  },
  pillText: {
    fontSize: responsiveFontSize(11),
    fontWeight: '700',
  },
  bottomStats: {
    flexDirection: 'row',
    paddingHorizontal: scale(20),
    gap: verticalScale(12),
    marginTop: verticalScale(24),
  },
  statCard: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    padding: scale(16),
    gap: verticalScale(4),
  },
  greenStatBg: {
    backgroundColor: '#E0F2F1',
    borderColor: '#B2DFDB',
  },
  slateStatBg: {
    backgroundColor: '#E8EAF6',
    borderColor: '#C5CAE9',
  },
  statLabel: {
    fontSize: responsiveFontSize(10),
    fontWeight: '800',
    color: '#718096',
    letterSpacing: 0.5,
  },
  statNum: {
    fontSize: responsiveFontSize(18),
    fontWeight: '800',
  },
  greenStatText: {
    color: '#00796B',
  },
  slateStatText: {
    color: '#3F51B5',
  },
});
