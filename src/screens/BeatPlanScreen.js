import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ActivityIndicator,
  SafeAreaView,
  ScrollView,
  RefreshControl,
  Alert,
} from 'react-native';
import { scale, verticalScale, responsiveFontSize, maxContainerWidth } from '../utils/responsive';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { launchCamera } from 'react-native-image-picker';

export default function BeatPlanScreen({
  token,
  apiUrl,
  activeLogId,
  user,
  onNavigateToPartyProfile,
}) {
  const [activeTab, setActiveTab] = useState('serving'); // 'serving' or 'skip'
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Today's beat plan state
  const [todayBeat, setTodayBeat] = useState(null);
  const [todayStatus, setTodayStatus] = useState(''); // 'weekly_off', 'holiday', 'no_plan' etc.
  const [todayReason, setTodayReason] = useState('');

  // Skipped beats list
  const [skippedBeats, setSkippedBeats] = useState([]);
  const [visitStartingId, setVisitStartingId] = useState(null);

  const getLocalDateString = (date) => {
    const offset = date.getTimezoneOffset();
    const localDate = new Date(date.getTime() - offset * 60 * 1000);
    return localDate.toISOString().split('T')[0];
  };

  const todayStr = getLocalDateString(new Date());

  // 1. Fetch Today's Beat Plan
  const fetchTodayBeat = async () => {
    if (!token || !activeLogId) {
      setLoading(false);
      setRefreshing(false);
      return;
    }
    setLoading(true);
    try {
      const response = await fetch(`${apiUrl}/beat-plan/my/today`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (response.ok && data.success) {
        if (data.data.cyclePaused) {
          setTodayStatus(data.data.status);
          setTodayReason(data.data.reason || '');
          setTodayBeat(null);
        } else {
          setTodayBeat(data.data);
          setTodayStatus('');
          setTodayReason('');
        }
      } else {
        setTodayBeat(null);
        setTodayStatus('no_plan');
      }
    } catch (e) {
      console.warn('Today beat fetch error:', e.message);
      setTodayBeat(null);
      setTodayStatus('error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // 2. Fetch Skipped Beat Days for this Month
  const fetchSkippedBeats = async () => {
    if (!token) return;
    setLoading(true);
    try {
      // Parallel fetch my full plan & my attendance history
      const [planRes, attendanceRes] = await Promise.all([
        fetch(`${apiUrl}/beat-plan/my/plan`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`${apiUrl}/attendance/my?limit=100`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);

      const planData = await planRes.json();
      const attendanceData = await attendanceRes.json();

      if (planRes.ok && planData.success && attendanceRes.ok && attendanceData.success) {
        const beatPlan = planData.data;
        const attendanceLogs = attendanceData.data || [];

        // Simulate ledger calculations locally
        const start = new Date(beatPlan.startDate);
        start.setHours(0, 0, 0, 0);

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const weeklyOffs = new Set(['Sunday']);
        const attendanceDates = new Set(attendanceLogs.map((log) => log.date));
        const holidayDates = new Set(
          (beatPlan.holidays || []).map((h) => getLocalDateString(new Date(h.date)))
        );

        const skipped = [];
        let consumedDays = 0;

        // Iterate from start date to yesterday
        const yesterday = new Date(today);
        yesterday.setDate(today.getDate() - 1);

        for (let cursor = new Date(start); cursor <= yesterday; cursor.setDate(cursor.getDate() + 1)) {
          const dateKey = getLocalDateString(cursor);
          const weekday = cursor.toLocaleDateString('en-US', { weekday: 'long' });

          const isCurrentMonth =
            cursor.getMonth() === today.getMonth() && cursor.getFullYear() === today.getFullYear();

          if (weeklyOffs.has(weekday) || holidayDates.has(dateKey)) {
            continue;
          }

          const cycleDay = (consumedDays % beatPlan.cycleLength) + 1;
          consumedDays += 1;

          if (isCurrentMonth) {
            const attended = attendanceDates.has(dateKey);
            if (!attended) {
              const dayConf = beatPlan.days.find((d) => d.dayNumber === cycleDay);
              if (dayConf) {
                skipped.push({
                  date: dateKey,
                  cycleDay,
                  area: dayConf.area,
                  parties: (dayConf.partyIds || []).map((p) => p.partyId).filter(Boolean),
                });
              }
            }
          }
        }

        setSkippedBeats(skipped.reverse());
      }
    } catch (e) {
      console.warn('Skipped beats calculation error:', e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'serving') {
      fetchTodayBeat();
    } else {
      fetchSkippedBeats();
    }
  }, [activeTab, activeLogId, token, apiUrl]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    if (activeTab === 'serving') {
      fetchTodayBeat();
    } else {
      fetchSkippedBeats();
    }
  }, [activeTab, activeLogId, token, apiUrl]);

  // Start Visit handler
  const handleStartVisit = async (party) => {
    launchCamera(
      {
        mediaType: 'photo',
        quality: 0.3,
        includeBase64: true,
      },
      async (response) => {
        if (response.didCancel) {
          Alert.alert('Visit Cancelled', 'Shop front photo is mandatory to start a visit.');
          return;
        }

        if (response.errorCode) {
          Alert.alert('Camera Error', response.errorMessage || 'Failed to start camera.');
          return;
        }

        const base64Photo = response.assets[0].base64;
        setVisitStartingId(party._id);

        try {
          const logId = await AsyncStorage.getItem('active_log_id');
          if (!logId) {
            Alert.alert('Error', 'Please check in first to start daily visits.');
            setVisitStartingId(null);
            return;
          }

          const startRes = await fetch(`${apiUrl}/visit/start`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              partyId: party._id,
              shopPhoto: `data:image/jpeg;base64,${base64Photo}`,
              logId,
            }),
          });

          const startData = await startRes.json();
          if (startRes.ok) {
            Alert.alert('Visit Started', `Your visit at "${party.partyName || party.name}" has started!`);
            fetchTodayBeat(); // reload list
          } else {
            throw new Error(startData.message || 'Failed to register visit arrival.');
          }
        } catch (err) {
          Alert.alert('Visit Failed', err.message || 'Network error.');
        } finally {
          setVisitStartingId(null);
        }
      }
    );
  };

  const isOnline = activeLogId !== null;

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Header */}
      <View style={styles.topHeader}>
        <Text style={styles.topHeaderTitle}>Beat Routes & Plans</Text>
      </View>

      {/* Tabs */}
      <View style={styles.tabRow}>
        <TouchableOpacity
          style={[styles.tabBtn, activeTab === 'serving' && styles.activeTabBtn]}
          onPress={() => setActiveTab('serving')}
        >
          <Text style={[styles.tabBtnText, activeTab === 'serving' && styles.activeTabBtnText]}>
            Serving Beat Plan
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabBtn, activeTab === 'skip' && styles.activeTabBtn]}
          onPress={() => setActiveTab('skip')}
        >
          <Text style={[styles.tabBtnText, activeTab === 'skip' && styles.activeTabBtnText]}>
            Skip Beat Plan
          </Text>
        </TouchableOpacity>
      </View>

      {/* Main Content scrollable */}
      {!isOnline && activeTab === 'serving' ? (
        <View style={styles.offlineBox}>
          <Text style={styles.lockIcon}>🔒</Text>
          <Text style={styles.offlineTitle}>Check-In Required</Text>
          <Text style={styles.offlineDesc}>
            Please mark your attendance check-in first to unlock and start today's beat plan.
          </Text>
        </View>
      ) : loading && !refreshing ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#00796B" />
          <Text style={styles.loadingText}>Syncing beat plan details...</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#00796B']} />
          }
        >
          {activeTab === 'serving' ? (
            todayBeat ? (
              <View>
                {/* Beat Meta Banner */}
                <View style={styles.beatBanner}>
                  <Text style={styles.beatBannerTitle}>
                    📅 Day {todayBeat.cycleDay} • Route Plan
                  </Text>
                  <Text style={styles.beatBannerArea}>Area: {todayBeat.area || 'General'}</Text>
                  <Text style={styles.beatBannerCount}>
                    {todayBeat.totalParties} customer(s) scheduled
                  </Text>
                </View>

                {/* Scheduled Party Cards */}
                <View style={styles.partyList}>
                  {todayBeat.parties.map((entry) => {
                    const party = entry.partyId;
                    if (!party) return null;

                    return (
                      <View key={party._id} style={styles.partyCard}>
                        <View style={styles.partyHeader}>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.partyName}>{party.partyName || party.name}</Text>
                            <Text style={styles.partyCode}>Code: {party.partyCode}</Text>
                          </View>
                          {party.visitedToday && (
                            <View style={styles.visitedBadge}>
                              <Text style={styles.visitedBadgeText}>✓ Visited</Text>
                            </View>
                          )}
                        </View>

                        <Text style={styles.partyDetail}>👤 Owner: {party.ownerName || '—'}</Text>
                        <Text style={styles.partyDetail}>📞 Contact: {party.mobile}</Text>
                        <Text style={styles.partyDetail}>📍 Address: {party.address}</Text>

                        <View style={styles.divider} />

                        {/* Action buttons */}
                        <View style={styles.btnRow}>
                          <TouchableOpacity
                            style={styles.viewBtn}
                            onPress={() => onNavigateToPartyProfile && onNavigateToPartyProfile(party._id)}
                          >
                            <Text style={styles.viewBtnText}>👤 View Party</Text>
                          </TouchableOpacity>

                          {party.visitedToday ? (
                            <View style={styles.visitedLabel}>
                              <Text style={styles.visitedLabelText}>✓ Visited Today</Text>
                            </View>
                          ) : (
                            <TouchableOpacity
                              style={[styles.visitBtn, visitStartingId === party._id && styles.disabledBtn]}
                              onPress={() => handleStartVisit(party)}
                              disabled={visitStartingId === party._id}
                            >
                              {visitStartingId === party._id ? (
                                <ActivityIndicator color="#fff" size="small" />
                              ) : (
                                <Text style={styles.visitBtnText}>📍 Start Visit</Text>
                              )}
                            </TouchableOpacity>
                          )}
                        </View>
                      </View>
                    );
                  })}
                </View>
              </View>
            ) : (
              <View style={styles.emptyBox}>
                <Text style={styles.emptyIcon}>🏖️</Text>
                <Text style={styles.emptyTitle}>
                  {todayStatus === 'weekly_off'
                    ? 'Weekly Off Today'
                    : todayStatus === 'holiday'
                    ? 'Company Holiday'
                    : 'No Beat Planned'}
                </Text>
                <Text style={styles.emptyDesc}>
                  {todayStatus === 'weekly_off'
                    ? `Enjoy your weekly off! Reason: ${todayReason || 'Scheduled off'}`
                    : todayStatus === 'holiday'
                    ? `Reason: ${todayReason || 'Festive/National holiday'}`
                    : 'No routes or beat plans have been scheduled for today.'}
                </Text>
              </View>
            )
          ) : (
            /* Skipped Beat Days List */
            <View>
              {skippedBeats.length === 0 ? (
                <View style={styles.emptyBox}>
                  <Text style={styles.emptyIcon}>🎉</Text>
                  <Text style={styles.emptyTitle}>No Skipped Beats</Text>
                  <Text style={styles.emptyDesc}>
                    Excellent performance! You have attended all scheduled beat routes this month.
                  </Text>
                </View>
              ) : (
                <View style={styles.skippedList}>
                  <Text style={styles.sectionTitle}>Skipped Beats (This Month)</Text>
                  {skippedBeats.map((skippedItem, idx) => (
                    <View key={idx} style={styles.skippedCard}>
                      <View style={styles.skippedHeader}>
                        <View>
                          <Text style={styles.skippedDate}>
                            {new Date(skippedItem.date).toLocaleDateString('en-IN', {
                              day: '2-digit',
                              month: 'short',
                              year: 'numeric',
                            })}
                          </Text>
                          <Text style={styles.skippedDayLbl}>Beat Day {skippedItem.cycleDay}</Text>
                        </View>
                        <View style={styles.skippedBadge}>
                          <Text style={styles.skippedBadgeText}>SKIPPED</Text>
                        </View>
                      </View>
                      <Text style={styles.skippedArea}>Route Area: {skippedItem.area || 'General'}</Text>

                      <View style={styles.divider} />
                      <Text style={styles.partiesScheduledTitle}>Scheduled Parties:</Text>
                      {(skippedItem.parties || []).map((party, pIdx) => (
                        <View key={pIdx} style={styles.skippedPartyRow}>
                          <Text style={styles.skippedPartyName}>{party.partyName || party.name}</Text>
                          <TouchableOpacity
                            style={styles.skippedPartyViewBtn}
                            onPress={() => onNavigateToPartyProfile && onNavigateToPartyProfile(party._id)}
                          >
                            <Text style={styles.skippedPartyViewText}>View 👁️</Text>
                          </TouchableOpacity>
                        </View>
                      ))}
                    </View>
                  ))}
                </View>
              )}
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F7F9FC',
  },
  topHeader: {
    height: verticalScale(56),
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  topHeaderTitle: {
    fontSize: responsiveFontSize(16.5),
    fontWeight: '800',
    color: '#1A202C',
  },

  // Tabs Row
  tabRow: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  tabBtn: {
    flex: 1,
    paddingVertical: verticalScale(14),
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  activeTabBtn: {
    borderBottomColor: '#00796B',
  },
  tabBtnText: {
    fontSize: responsiveFontSize(13.5),
    fontWeight: '700',
    color: '#718096',
  },
  activeTabBtnText: {
    color: '#00796B',
  },

  // Content
  scrollContent: {
    padding: scale(16),
    paddingBottom: verticalScale(40),
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: verticalScale(120),
    gap: verticalScale(12),
  },
  loadingText: {
    fontSize: responsiveFontSize(13),
    color: '#718096',
    fontWeight: '600',
  },

  // Offline lockbox
  offlineBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: scale(40),
    paddingVertical: verticalScale(100),
  },
  lockIcon: {
    fontSize: responsiveFontSize(48),
    marginBottom: verticalScale(16),
  },
  offlineTitle: {
    fontSize: responsiveFontSize(18),
    fontWeight: '750',
    color: '#2D3748',
    marginBottom: verticalScale(8),
  },
  offlineDesc: {
    fontSize: responsiveFontSize(13),
    color: '#718096',
    textAlign: 'center',
    lineHeight: 19,
  },

  // Empty box
  emptyBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: verticalScale(80),
    paddingHorizontal: scale(20),
  },
  emptyIcon: {
    fontSize: responsiveFontSize(48),
    marginBottom: verticalScale(16),
  },
  emptyTitle: {
    fontSize: responsiveFontSize(17),
    fontWeight: '700',
    color: '#2D3748',
    marginBottom: verticalScale(8),
  },
  emptyDesc: {
    fontSize: responsiveFontSize(13),
    color: '#718096',
    textAlign: 'center',
    lineHeight: 18,
  },

  // Beat Banner
  beatBanner: {
    backgroundColor: '#00796B',
    borderRadius: 14,
    padding: scale(18),
    marginBottom: verticalScale(16),
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 2,
  },
  beatBannerTitle: {
    fontSize: responsiveFontSize(15.5),
    fontWeight: '800',
    color: '#FFFFFF',
    marginBottom: verticalScale(4),
  },
  beatBannerArea: {
    fontSize: responsiveFontSize(12.5),
    color: 'rgba(255, 255, 255, 0.85)',
    fontWeight: '600',
    marginBottom: verticalScale(8),
  },
  beatBannerCount: {
    fontSize: responsiveFontSize(11),
    color: '#E6FFFA',
    fontWeight: '700',
  },

  // Scheduled parties
  partyList: {
    gap: verticalScale(12),
  },
  partyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: scale(16),
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.02,
    shadowRadius: 6,
    elevation: 1,
  },
  partyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: verticalScale(10),
  },
  partyName: {
    fontSize: responsiveFontSize(14.5),
    fontWeight: '800',
    color: '#2D3748',
  },
  partyCode: {
    fontSize: responsiveFontSize(10.5),
    color: '#A0AEC0',
    fontWeight: '600',
    marginTop: verticalScale(2),
  },
  visitedBadge: {
    backgroundColor: '#E6FFFA',
    paddingHorizontal: scale(8),
    paddingVertical: verticalScale(3),
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#9AE6B4',
  },
  visitedBadgeText: {
    color: '#234E52',
    fontSize: responsiveFontSize(10),
    fontWeight: '800',
  },
  partyDetail: {
    fontSize: responsiveFontSize(12.5),
    color: '#4A5568',
    marginBottom: verticalScale(4),
    lineHeight: 17,
  },
  divider: {
    height: 1,
    backgroundColor: '#EDF2F7',
    marginVertical: verticalScale(12),
  },
  btnRow: {
    flexDirection: 'row',
    gap: verticalScale(10),
  },
  viewBtn: {
    flex: 1,
    height: verticalScale(38),
    backgroundColor: '#EDF2F7',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewBtnText: {
    fontSize: responsiveFontSize(12.5),
    color: '#4A5568',
    fontWeight: '700',
  },
  visitBtn: {
    flex: 1.2,
    height: verticalScale(38),
    backgroundColor: '#00796B',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabledBtn: {
    opacity: 0.6,
  },
  visitBtnText: {
    fontSize: responsiveFontSize(12.5),
    color: '#FFFFFF',
    fontWeight: '800',
  },
  visitedLabel: {
    flex: 1.2,
    height: verticalScale(38),
    backgroundColor: '#F0FFF4',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#C6F6D5',
  },
  visitedLabelText: {
    fontSize: responsiveFontSize(12.5),
    color: '#276749',
    fontWeight: '800',
  },

  // Skipped list
  skippedList: {
    gap: verticalScale(14),
  },
  sectionTitle: {
    fontSize: responsiveFontSize(13),
    fontWeight: '800',
    color: '#718096',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: verticalScale(6),
  },
  skippedCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: scale(16),
    borderLeftWidth: 5,
    borderLeftColor: '#E53E3E',
  },
  skippedHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: verticalScale(6),
  },
  skippedDate: {
    fontSize: responsiveFontSize(14.5),
    fontWeight: '800',
    color: '#2D3748',
  },
  skippedDayLbl: {
    fontSize: responsiveFontSize(10.5),
    color: '#A0AEC0',
    fontWeight: '700',
    marginTop: verticalScale(2),
  },
  skippedBadge: {
    backgroundColor: '#FFF5F5',
    paddingHorizontal: scale(8),
    paddingVertical: verticalScale(3),
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FED7D7',
  },
  skippedBadgeText: {
    color: '#9B2C2C',
    fontSize: responsiveFontSize(9),
    fontWeight: '800',
  },
  skippedArea: {
    fontSize: responsiveFontSize(12.5),
    color: '#4A5568',
    fontWeight: '650',
    marginTop: verticalScale(4),
  },
  partiesScheduledTitle: {
    fontSize: responsiveFontSize(11),
    fontWeight: '800',
    color: '#718096',
    textTransform: 'uppercase',
    marginBottom: verticalScale(8),
  },
  skippedPartyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: verticalScale(6),
    borderBottomWidth: 1,
    borderBottomColor: '#F7F9FC',
  },
  skippedPartyName: {
    fontSize: responsiveFontSize(12.5),
    fontWeight: '600',
    color: '#4A5568',
    flex: 1,
  },
  skippedPartyViewBtn: {
    paddingHorizontal: scale(8),
    paddingVertical: verticalScale(3),
    backgroundColor: '#EDF2F7',
    borderRadius: 6,
  },
  skippedPartyViewText: {
    fontSize: responsiveFontSize(11),
    fontWeight: '700',
    color: '#4A5568',
  },
});
