import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  FlatList,
  TextInput,
  ActivityIndicator,
  Modal,
  Linking,
  AppState,
  Alert,
  ScrollView,
  SafeAreaView,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export default function TelecallingDashboardScreen({
  token,
  apiUrl,
  user,
  onNavigateToOrder,
  onNavigateToOrders,
  onNavigateToAttendance,
  onNavigateToLeave,
  onNavigateToProducts,
}) {
  const [parties, setParties] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // 'all' | 'pending' | 'completed_today' | 'follow_up'

  const [summaryCounts, setSummaryCounts] = useState({
    total: 0,
    pending: 0,
    completedToday: 0,
    followUp: 0,
    orderPlaced: 0,
  });

  // Call tracking states
  const [activeParty, setActiveParty] = useState(null);
  const [callStartTime, setCallStartTime] = useState(null);
  const [showRemarkModal, setShowRemarkModal] = useState(false);
  const [submittingLog, setSubmittingLog] = useState(false);

  // Form states for remark modal
  const [callStatus, setCallStatus] = useState('connected'); // 'connected' | 'not_picked' | 'busy' | 'switched_off' | 'wrong_number' | 'follow_up_scheduled'
  const [callRemarks, setCallRemarks] = useState('');
  const [callDuration, setCallDuration] = useState(0);
  const [followUpDate, setFollowUpDate] = useState('');
  const [formError, setFormError] = useState('');

  const appStateRef = useRef(AppState.currentState);

  // Fetch assigned parties
  const fetchAssignedParties = useCallback(async () => {
    try {
      const queryParams = new URLSearchParams();
      if (searchQuery.trim()) queryParams.append('search', searchQuery.trim());
      if (statusFilter !== 'all') queryParams.append('statusFilter', statusFilter);

      const response = await fetch(`${apiUrl}/calling/my-parties?${queryParams.toString()}`, {
        headers: {
          Authorization: token ? `Bearer ${token}` : '',
        },
      });

      const data = await response.json();
      if (response.ok && data.success) {
        setParties(data.data?.parties || []);
        if (data.data?.summary) {
          setSummaryCounts(data.data.summary);
        }
      } else {
        console.warn('[Telecalling] Failed to fetch parties:', data.message);
      }
    } catch (err) {
      console.error('[Telecalling] Network error fetching parties:', err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [apiUrl, token, searchQuery, statusFilter]);

  useEffect(() => {
    fetchAssignedParties();
  }, [fetchAssignedParties]);

  // AppState Listener to detect when executive returns to app after phone call
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (
        appStateRef.current.match(/inactive|background/) &&
        nextAppState === 'active'
      ) {
        // Returned to app
        if (callStartTime && activeParty) {
          const durationSec = Math.max(0, Math.round((Date.now() - callStartTime) / 1000));
          setCallDuration(durationSec);

          // Automated pre-selection rule:
          // If duration > 3 seconds, pre-select Connected
          // If duration <= 3 seconds, pre-select Not Picked / Missed
          if (durationSec > 3) {
            setCallStatus('connected');
          } else {
            setCallStatus('not_picked');
          }

          setShowRemarkModal(true);
        }
      }
      appStateRef.current = nextAppState;
    });

    return () => {
      subscription.remove();
    };
  }, [callStartTime, activeParty]);

  // Initiate Phone Call
  const handleInitiateCall = (party) => {
    if (!party?.mobile) {
      Alert.alert('No Phone Number', 'This party does not have a registered mobile number.');
      return;
    }

    setActiveParty(party);
    const now = Date.now();
    setCallStartTime(now);
    setCallRemarks('');
    setFormError('');

    const phoneUrl = `tel:${party.mobile.replace(/\s+/g, '')}`;
    Linking.openURL(phoneUrl).catch((err) => {
      console.warn('Could not open dialer:', err.message);
      // Fallback if dialer fails to open
      setCallDuration(0);
      setCallStatus('not_picked');
      setShowRemarkModal(true);
    });
  };

  // Submit Call Log
  const handleSubmitCallLog = async (shouldCreateOrder = false) => {
    if (!callRemarks.trim()) {
      setFormError('Please enter call remarks/notes before submitting.');
      return;
    }

    setSubmittingLog(true);
    setFormError('');

    try {
      const payload = {
        partyId: activeParty._id || activeParty.id,
        callStatus,
        remarks: callRemarks.trim(),
        durationSeconds: callDuration,
        followUpDate: callStatus === 'follow_up_scheduled' && followUpDate ? followUpDate : null,
      };

      const response = await fetch(`${apiUrl}/calling/log-call`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token ? `Bearer ${token}` : '',
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.message || 'Failed to submit call log');
      }

      // Reset modal state
      setShowRemarkModal(false);
      const targetParty = activeParty;
      setActiveParty(null);
      setCallStartTime(null);

      // Refresh list
      fetchAssignedParties();

      if (shouldCreateOrder && onNavigateToOrder) {
        onNavigateToOrder(targetParty);
      }
    } catch (err) {
      setFormError(err.message || 'Error submitting call log. Please try again.');
    } finally {
      setSubmittingLog(false);
    }
  };

  // Pre-fill quick remarks
  const handleSelectQuickRemark = (text) => {
    setCallRemarks((prev) => (prev ? `${prev} ${text}` : text));
  };

  // Metrics summary (uses constant summaryCounts across tabs)
  const totalCount = summaryCounts.total || parties.length;
  const completedTodayCount = summaryCounts.completedToday || 0;
  const followUpCount = summaryCounts.followUp || 0;
  const pendingCount = summaryCounts.pending || 0;

  // Dynamic card styling & color coding based on call status / action
  const getPartyCardStyle = (item) => {
    const badge = item.callBadge;
    const lastStatus = item.lastCall?.callStatus;

    if (badge === 'Order Placed' || item.isOrderPlacedToday) {
      return {
        cardBg: '#E8F5E9',
        borderColor: '#81C784',
        stripeColor: '#2E7D32',
        badgeBg: '#C8E6C9',
        badgeTextColor: '#1B5E20',
        badgeText: '🛒 Order Placed',
      };
    }
    if (badge === 'Done Today' || lastStatus === 'connected') {
      return {
        cardBg: '#E0F2F1',
        borderColor: '#4DB6AC',
        stripeColor: '#00796B',
        badgeBg: '#B2DFDB',
        badgeTextColor: '#004D40',
        badgeText: '📞 Call Connected',
      };
    }
    if (badge === 'Follow-Up Scheduled' || lastStatus === 'follow_up_scheduled') {
      return {
        cardBg: '#FFF8E1',
        borderColor: '#FFD54F',
        stripeColor: '#F57C00',
        badgeBg: '#FFE082',
        badgeTextColor: '#E65100',
        badgeText: item.lastCall?.followUpDate ? `⏰ Follow-Up (${item.lastCall.followUpDate})` : '⏰ Follow-Up Scheduled',
      };
    }
    if (badge === 'Attempted Today' || ['not_picked', 'busy', 'switched_off', 'wrong_number'].includes(lastStatus)) {
      const statusName = lastStatus ? lastStatus.replace(/_/g, ' ').toUpperCase() : 'NOT PICKED';
      return {
        cardBg: '#FFEBEE',
        borderColor: '#E57373',
        stripeColor: '#D32F2F',
        badgeBg: '#FFCDD2',
        badgeTextColor: '#B71C1C',
        badgeText: `📵 ${statusName}`,
      };
    }
    // Default Pending
    return {
      cardBg: '#FFFFFF',
      borderColor: '#E0E0E0',
      stripeColor: '#9E9E9E',
      badgeBg: '#F5F5F5',
      badgeTextColor: '#616161',
      badgeText: '⏳ Pending',
    };
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header Banner */}
      <View style={styles.headerCard}>
        <View style={{ flex: 1 }}>
          <Text style={styles.welcomeSubtitle}>TELECALLER DESK</Text>
          <Text style={styles.welcomeTitle}>Hello, {user?.name || 'Executive'}</Text>
        </View>
        <View style={styles.topActions}>
          {onNavigateToAttendance && (
            <TouchableOpacity style={styles.chipBtn} onPress={onNavigateToAttendance}>
              <Text style={styles.chipBtnText}>⏰ Attendance</Text>
            </TouchableOpacity>
          )}
          {onNavigateToLeave && (
            <TouchableOpacity style={styles.chipBtn} onPress={onNavigateToLeave}>
              <Text style={styles.chipBtnText}>🌴 Leave</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Quick Action Tiles (Attendance, Leave, My Orders) */}
      <View style={styles.quickActionRow}>
        {onNavigateToAttendance && (
          <TouchableOpacity style={[styles.actionTile, { backgroundColor: '#E0F2F1', borderColor: '#80CBC4' }]} onPress={onNavigateToAttendance}>
            <Text style={styles.actionTileIcon}>⏰</Text>
            <View style={{ flex: 1 }}>
              <Text style={[styles.actionTileTitle, { color: '#004D40' }]}>Attendance</Text>
              <Text style={styles.actionTileSub}>Punch In / Out</Text>
            </View>
          </TouchableOpacity>
        )}

        {onNavigateToLeave && (
          <TouchableOpacity style={[styles.actionTile, { backgroundColor: '#FFF3E0', borderColor: '#FFCC80' }]} onPress={onNavigateToLeave}>
            <Text style={styles.actionTileIcon}>🌴</Text>
            <View style={{ flex: 1 }}>
              <Text style={[styles.actionTileTitle, { color: '#E65100' }]}>Leave</Text>
              <Text style={styles.actionTileSub}>Apply / Status</Text>
            </View>
          </TouchableOpacity>
        )}

        {onNavigateToOrders && (
          <TouchableOpacity style={[styles.actionTile, { backgroundColor: '#E8EAF6', borderColor: '#C5CAE9' }]} onPress={onNavigateToOrders}>
            <Text style={styles.actionTileIcon}>📦</Text>
            <View style={{ flex: 1 }}>
              <Text style={[styles.actionTileTitle, { color: '#1A237E' }]}>My Orders</Text>
              <Text style={styles.actionTileSub}>View Orders</Text>
            </View>
          </TouchableOpacity>
        )}
      </View>

      {/* Quick Metrics Grid */}
      <View style={styles.metricsGrid}>
        <View className="metric-box" style={[styles.metricCard, { borderLeftColor: '#00796B' }]}>
          <Text style={styles.metricVal}>{totalCount}</Text>
          <Text style={styles.metricLabel}>Assigned</Text>
        </View>
        <View style={[styles.metricCard, { borderLeftColor: '#2E7D32' }]}>
          <Text style={[styles.metricVal, { color: '#2E7D32' }]}>{completedTodayCount}</Text>
          <Text style={styles.metricLabel}>Done Today</Text>
        </View>
        <View style={[styles.metricCard, { borderLeftColor: '#F57C00' }]}>
          <Text style={[styles.metricVal, { color: '#F57C00' }]}>{followUpCount}</Text>
          <Text style={styles.metricLabel}>Follow-Up</Text>
        </View>
        <View style={[styles.metricCard, { borderLeftColor: '#D32F2F' }]}>
          <Text style={[styles.metricVal, { color: '#D32F2F' }]}>{pendingCount}</Text>
          <Text style={styles.metricLabel}>Pending</Text>
        </View>
      </View>

      {/* Filter Tabs */}
      <View style={styles.tabsRow}>
        <TouchableOpacity
          style={[styles.tabChip, statusFilter === 'all' && styles.tabChipActive]}
          onPress={() => setStatusFilter('all')}
        >
          <Text style={[styles.tabChipText, statusFilter === 'all' && styles.tabChipTextActive]}>All ({totalCount})</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabChip, statusFilter === 'pending' && styles.tabChipActive]}
          onPress={() => setStatusFilter('pending')}
        >
          <Text style={[styles.tabChipText, statusFilter === 'pending' && styles.tabChipTextActive]}>Pending ({pendingCount})</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabChip, statusFilter === 'completed_today' && styles.tabChipActive]}
          onPress={() => setStatusFilter('completed_today')}
        >
          <Text style={[styles.tabChipText, statusFilter === 'completed_today' && styles.tabChipTextActive]}>Done Today ({completedTodayCount})</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabChip, statusFilter === 'follow_up' && styles.tabChipActive]}
          onPress={() => setStatusFilter('follow_up')}
        >
          <Text style={[styles.tabChipText, statusFilter === 'follow_up' && styles.tabChipTextActive]}>Follow-Up ({followUpCount})</Text>
        </TouchableOpacity>
      </View>

      {/* Search Input */}
      <View style={styles.searchBar}>
        <Text style={styles.searchIcon}>🔍</Text>
        <TextInput
          style={styles.searchInput}
          placeholder="Search party by name, code, phone or city..."
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholderTextColor="#9E9E9E"
        />
        {searchQuery ? (
          <TouchableOpacity onPress={() => setSearchQuery('')}>
            <Text style={styles.clearSearch}>✕</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Party List */}
      {loading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#00796B" />
          <Text style={styles.loadingText}>Loading assigned parties...</Text>
        </View>
      ) : parties.length === 0 ? (
        <View style={styles.centerContainer}>
          <Text style={styles.emptyTitle}>No Parties Found</Text>
          <Text style={styles.emptyDesc}>
            {searchQuery ? 'No party matches your search query.' : 'No parties assigned to your calling queue yet.'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={parties}
          keyExtractor={(item) => item._id || item.id}
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            fetchAssignedParties();
          }}
          contentContainerStyle={{ paddingBottom: 24 }}
          renderItem={({ item }) => {
            const outAmount = Number(item.currentOutstanding || 0);
            const cardStyle = getPartyCardStyle(item);

            return (
              <View
                style={[
                  styles.partyCard,
                  {
                    backgroundColor: cardStyle.cardBg,
                    borderColor: cardStyle.borderColor,
                    borderLeftColor: cardStyle.stripeColor,
                    borderLeftWidth: 5,
                  },
                ]}
              >
                <View style={styles.partyHeaderRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.partyName}>{item.partyName}</Text>
                    <Text style={styles.partySubText}>Code: {item.partyCode} {item.city ? `• ${item.city}` : ''}</Text>
                  </View>
                  <View
                    style={[
                      styles.badgePill,
                      { backgroundColor: cardStyle.badgeBg },
                    ]}
                  >
                    <Text style={[styles.badgeText, { color: cardStyle.badgeTextColor }]}>
                      {cardStyle.badgeText}
                    </Text>
                  </View>
                </View>

                {/* Financial Summary */}
                <View style={styles.financeRow}>
                  <View style={styles.financeBox}>
                    <Text style={styles.financeLabel}>Outstanding</Text>
                    <Text style={[styles.financeVal, outAmount > 0 && { color: '#D32F2F' }]}>
                      ₹{outAmount.toLocaleString('en-IN')}
                    </Text>
                  </View>

                  <View style={styles.financeBox}>
                    <Text style={styles.financeLabel}>Credit Limit</Text>
                    <Text style={styles.financeVal}>
                      ₹{Number(item.creditLimit || 0).toLocaleString('en-IN')}
                    </Text>
                  </View>

                  <View style={styles.financeBox}>
                    <Text style={styles.financeLabel}>Last Order</Text>
                    <Text style={styles.financeVal}>
                      {item.lastOrder?.amount ? `₹${Number(item.lastOrder.amount).toLocaleString('en-IN')}` : 'No Orders'}
                    </Text>
                  </View>
                </View>

                {/* Last Remark Summary */}
                {item.lastCall && (
                  <View style={styles.lastCallBox}>
                    <Text style={styles.lastCallText}>
                      💬 Last Remark ({item.lastCall.callStatus}): "{item.lastCall.remarks}"
                    </Text>
                  </View>
                )}

                {/* Action Buttons */}
                <View style={styles.cardActionsRow}>
                  <TouchableOpacity
                    style={styles.callPrimaryBtn}
                    onPress={() => handleInitiateCall(item)}
                  >
                    <Text style={styles.callPrimaryBtnText}>📞 Call {item.mobile}</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.orderSecondaryBtn}
                    onPress={() => onNavigateToOrder && onNavigateToOrder(item)}
                  >
                    <Text style={styles.orderSecondaryBtnText}>🛒 Order</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          }}
        />
      )}

      {/* ========================================================= */}
      {/* AUTOMATED ENFORCED CALL REMARK MODAL */}
      {/* ========================================================= */}
      <Modal
        visible={showRemarkModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => {
          // ENFORCED: Prevent hardware back button from closing modal without remark!
          Alert.alert('Remark Required', 'Please enter call status and remarks before closing this screen.');
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContentCard}>
            <ScrollView contentContainerStyle={{ padding: 20 }}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>📞 Call Completed</Text>
                <Text style={styles.modalSubtitle}>
                  Party: <Text style={{ fontWeight: 'bold' }}>{activeParty?.partyName}</Text> ({activeParty?.mobile})
                </Text>
              </View>

              {formError ? <Text style={styles.modalErrorText}>{formError}</Text> : null}

              {/* Automated Call Timing Badge */}
              <View style={styles.autoTimingCard}>
                <Text style={styles.autoTimingTitle}>⚡ Call Duration Detected</Text>
                <Text style={styles.autoTimingVal}>{callDuration} seconds</Text>
                <Text style={styles.autoTimingDesc}>
                  {callDuration > 3
                    ? 'Status auto-selected as CONNECTED based on duration.'
                    : 'Short call duration detected (< 3s). Auto-selected as NOT PICKED.'}
                </Text>
              </View>

              {/* Call Status Selection */}
              <Text style={styles.fieldLabel}>Call Status</Text>
              <View style={styles.statusChipGrid}>
                <TouchableOpacity
                  style={[styles.statusOptionChip, callStatus === 'connected' && styles.statusOptionChipActive]}
                  onPress={() => setCallStatus('connected')}
                >
                  <Text style={[styles.statusOptionText, callStatus === 'connected' && styles.statusOptionTextActive]}>
                    ✅ Connected
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.statusOptionChip, callStatus === 'not_picked' && styles.statusOptionChipActive]}
                  onPress={() => setCallStatus('not_picked')}
                >
                  <Text style={[styles.statusOptionText, callStatus === 'not_picked' && styles.statusOptionTextActive]}>
                    ❌ Not Picked
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.statusOptionChip, callStatus === 'busy' && styles.statusOptionChipActive]}
                  onPress={() => setCallStatus('busy')}
                >
                  <Text style={[styles.statusOptionText, callStatus === 'busy' && styles.statusOptionTextActive]}>
                    ⏳ Busy / Line Occupied
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.statusOptionChip, callStatus === 'switched_off' && styles.statusOptionChipActive]}
                  onPress={() => setCallStatus('switched_off')}
                >
                  <Text style={[styles.statusOptionText, callStatus === 'switched_off' && styles.statusOptionTextActive]}>
                    🚫 Switched Off / No Signal
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.statusOptionChip, callStatus === 'follow_up_scheduled' && styles.statusOptionChipActive]}
                  onPress={() => setCallStatus('follow_up_scheduled')}
                >
                  <Text style={[styles.statusOptionText, callStatus === 'follow_up_scheduled' && styles.statusOptionTextActive]}>
                    📅 Follow-Up Scheduled
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.statusOptionChip, callStatus === 'wrong_number' && styles.statusOptionChipActive]}
                  onPress={() => setCallStatus('wrong_number')}
                >
                  <Text style={[styles.statusOptionText, callStatus === 'wrong_number' && styles.statusOptionTextActive]}>
                    ⚠️ Invalid / Wrong Number
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Follow-up date input if scheduled */}
              {callStatus === 'follow_up_scheduled' && (
                <View style={{ marginTop: 10 }}>
                  <Text style={styles.fieldLabel}>Follow-up Date (YYYY-MM-DD)</Text>
                  <TextInput
                    style={styles.modalTextInput}
                    placeholder="e.g. 2026-09-25"
                    value={followUpDate}
                    onChangeText={setFollowUpDate}
                  />
                </View>
              )}

              {/* Quick Remark Chips */}
              <Text style={styles.fieldLabel}>Quick Remarks (Tap to insert)</Text>
              <View style={styles.quickChipsRow}>
                <TouchableOpacity
                  style={styles.quickChip}
                  onPress={() => handleSelectQuickRemark('Interested in placing new order.')}
                >
                  <Text style={styles.quickChipText}>+ Interested in order</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.quickChip}
                  onPress={() => handleSelectQuickRemark('Promised payment by tomorrow.')}
                >
                  <Text style={styles.quickChipText}>+ Payment promised</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.quickChip}
                  onPress={() => handleSelectQuickRemark('Owner out of station, call back later.')}
                >
                  <Text style={styles.quickChipText}>+ Call back later</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.quickChip}
                  onPress={() => handleSelectQuickRemark('Customer refused to take call.')}
                >
                  <Text style={styles.quickChipText}>+ Call refused</Text>
                </TouchableOpacity>
              </View>

              {/* Remarks Text Area */}
              <Text style={styles.fieldLabel}>Call Remarks / Executive Notes *</Text>
              <TextInput
                style={[styles.modalTextInput, { height: 80, textAlignVertical: 'top' }]}
                placeholder="Type details of call discussion..."
                multiline={true}
                value={callRemarks}
                onChangeText={setCallRemarks}
              />

              {/* Modal Submit Buttons */}
              <View style={styles.modalActionButtons}>
                <TouchableOpacity
                  style={[styles.modalSubmitBtn, { backgroundColor: '#0288D1' }]}
                  onPress={() => handleSubmitCallLog(true)}
                  disabled={submittingLog}
                >
                  <Text style={styles.modalSubmitBtnText}>🛒 Create Order for Party</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.modalSubmitBtn}
                  onPress={() => handleSubmitCallLog(false)}
                  disabled={submittingLog}
                >
                  {submittingLog ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text style={styles.modalSubmitBtnText}>✅ Submit & Log Call</Text>
                  )}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F4F6F8' },
  headerCard: {
    backgroundColor: '#00796B',
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  welcomeSubtitle: { color: 'rgba(255, 255, 255, 0.7)', fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  welcomeTitle: { color: '#FFFFFF', fontSize: 18, fontWeight: 'bold', marginTop: 2 },
  topActions: { flexDirection: 'row', gap: 8 },
  chipBtn: { backgroundColor: 'rgba(255, 255, 255, 0.2)', paddingVertical: 6, paddingHorizontal: 10, borderRadius: 20 },
  chipBtnText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
  quickActionRow: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    marginTop: 12,
    gap: 8,
  },
  actionTile: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    gap: 6,
  },
  actionTileIcon: {
    fontSize: 18,
  },
  actionTileTitle: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  actionTileSub: {
    fontSize: 10,
    color: '#616161',
    marginTop: 1,
  },
  metricsGrid: { flexDirection: 'row', padding: 12, gap: 8 },
  metricCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 10,
    borderLeftWidth: 4,
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 3,
  },
  metricVal: { fontSize: 18, fontWeight: 'bold', color: '#00796B' },
  metricLabel: { fontSize: 11, color: '#616161', marginTop: 2 },
  tabsRow: { flexDirection: 'row', paddingHorizontal: 12, marginBottom: 8, gap: 6 },
  tabChip: { backgroundColor: '#E0E0E0', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16 },
  tabChipActive: { backgroundColor: '#00796B' },
  tabChipText: { fontSize: 12, color: '#424242', fontWeight: '600' },
  tabChipTextActive: { color: '#FFFFFF' },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    marginHorizontal: 12,
    marginBottom: 12,
    borderRadius: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  searchIcon: { fontSize: 14, marginRight: 8 },
  searchInput: { flex: 1, height: 40, fontSize: 13, color: '#212121' },
  clearSearch: { fontSize: 14, color: '#9E9E9E', padding: 4 },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  loadingText: { marginTop: 10, color: '#616161', fontSize: 13 },
  emptyTitle: { fontSize: 16, fontWeight: 'bold', color: '#424242' },
  emptyDesc: { fontSize: 13, color: '#757575', textAlign: 'center', marginTop: 4 },
  partyCard: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 12,
    marginBottom: 10,
    borderRadius: 12,
    padding: 14,
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 4,
    borderWidth: 1,
    borderColor: '#EEEEEE',
  },
  partyHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  partyName: { fontSize: 15, fontWeight: 'bold', color: '#212121' },
  partySubText: { fontSize: 12, color: '#616161', marginTop: 2 },
  badgePill: { paddingVertical: 4, paddingHorizontal: 8, borderRadius: 12 },
  badgeGood: { backgroundColor: '#E8F5E9' },
  badgeWarn: { backgroundColor: '#FFF3E0' },
  badgePending: { backgroundColor: '#FFEBEE' },
  badgeText: { fontSize: 11, fontWeight: '700', color: '#2E7D32' },
  financeRow: { flexDirection: 'row', backgroundColor: '#FAFAFA', borderRadius: 8, padding: 8, marginTop: 10, gap: 8 },
  financeBox: { flex: 1 },
  financeLabel: { fontSize: 10, color: '#757575' },
  financeVal: { fontSize: 13, fontWeight: 'bold', color: '#212121', marginTop: 1 },
  lastCallBox: { backgroundColor: '#F5F5F5', padding: 8, borderRadius: 6, marginTop: 8 },
  lastCallText: { fontSize: 11, color: '#616161', fontStyle: 'italic' },
  cardActionsRow: { flexDirection: 'row', marginTop: 12, gap: 8 },
  callPrimaryBtn: { flex: 2, backgroundColor: '#00796B', paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  callPrimaryBtnText: { color: '#FFFFFF', fontWeight: 'bold', fontSize: 13 },
  orderSecondaryBtn: { flex: 1, backgroundColor: '#E0F2F1', paddingVertical: 10, borderRadius: 8, alignItems: 'center', borderWidth: 1, borderColor: '#80CBC4' },
  orderSecondaryBtnText: { color: '#00796B', fontWeight: 'bold', fontSize: 13 },

  // Modal styles
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  modalContentCard: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '90%' },
  modalHeader: { borderBottomWidth: 1, borderBottomColor: '#EEEEEE', paddingBottom: 12, marginBottom: 12 },
  modalTitle: { fontSize: 18, fontWeight: 'bold', color: '#00796B' },
  modalSubtitle: { fontSize: 13, color: '#616161', marginTop: 2 },
  modalErrorText: { color: '#D32F2F', backgroundColor: '#FFEBEE', padding: 8, borderRadius: 6, marginBottom: 10, fontSize: 12 },
  autoTimingCard: { backgroundColor: '#E0F2F1', padding: 12, borderRadius: 10, marginBottom: 14, borderWidth: 1, borderColor: '#80CBC4' },
  autoTimingTitle: { fontSize: 12, fontWeight: 'bold', color: '#004D40' },
  autoTimingVal: { fontSize: 20, fontWeight: 'bold', color: '#00796B', marginVertical: 2 },
  autoTimingDesc: { fontSize: 11, color: '#00695C' },
  fieldLabel: { fontSize: 13, fontWeight: 'bold', color: '#333333', marginTop: 10, marginBottom: 6 },
  statusChipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
  statusOptionChip: { backgroundColor: '#F5F5F5', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: '#E0E0E0' },
  statusOptionChipActive: { backgroundColor: '#00796B', borderColor: '#004D40' },
  statusOptionText: { fontSize: 12, color: '#424242', fontWeight: '600' },
  statusOptionTextActive: { color: '#FFFFFF' },
  modalTextInput: { backgroundColor: '#FAFAFA', borderWidth: 1, borderColor: '#E0E0E0', borderRadius: 8, padding: 10, fontSize: 13, color: '#212121' },
  quickChipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
  quickChip: { backgroundColor: '#FFF8E1', paddingVertical: 4, paddingHorizontal: 8, borderRadius: 6, borderWidth: 1, borderColor: '#FFE082' },
  quickChipText: { fontSize: 11, color: '#F57F17' },
  modalActionButtons: { marginTop: 16, gap: 10 },
  modalSubmitBtn: { backgroundColor: '#00796B', paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  modalSubmitBtnText: { color: '#FFFFFF', fontWeight: 'bold', fontSize: 14 },
});
