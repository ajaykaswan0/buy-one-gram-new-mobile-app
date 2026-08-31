import React, { useState, useEffect, useCallback} from 'react';
import { useLanguage } from '../i18n';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ActivityIndicator,
  SafeAreaView,
  ScrollView,
  Modal,
  Alert,
  FlatList,
  Linking,
  RefreshControl,
} from 'react-native';
import { scale, verticalScale, responsiveFontSize, maxContainerWidth } from '../utils/responsive';

/** Today in the phone's own timezone — toISOString() would give the UTC day. */
const localDateKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export default function MyTeamScreen({
  token,
  apiUrl,
  user,
  onBack,
  onNavigateToOrder,
  onNavigateToParty,
}) {
  const { t, term, name } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [teamMembers, setTeamMembers] = useState([]);
  const [error, setError] = useState('');
  // The formal team behind this roster: its monthly number, what the team has
  // sold against it, and how close its parties are to the credit ceiling.
  const [myTeams, setMyTeams] = useState([]);

  // Selected subordinate modal details
  const [selectedMember, setSelectedMember] = useState(null);
  const [activeTab, setActiveTab] = useState('summary'); // 'summary' | 'beat' | 'collections' | 'parties'
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [memberBeatPlan, setMemberBeatPlan] = useState(null);
  const [memberCollections, setMemberCollections] = useState([]);
  const [memberParties, setMemberParties] = useState([]);
  const [memberOrders, setMemberOrders] = useState([]);
  const [memberVisits, setMemberVisits] = useState([]);
  // Which day's visits are on screen. Today by default; the arrows walk back.
  const [visitDate, setVisitDate] = useState(() => localDateKey());
  const [visitsLoading, setVisitsLoading] = useState(false);
  const [memberDailyLog, setMemberDailyLog] = useState(null);
  const [memberLive, setMemberLive] = useState(null);

  useEffect(() => {
    fetchMyTeam();
    fetchTeamNumbers();
  }, [apiUrl, token, user]);

  /**
   * Reads the team's own figures. Kept separate from the roster fetch so a
   * manager with no formal team still sees their reporting line exactly as
   * before, rather than an error where the numbers would be.
   */
  // Pull down to reload, so the screen can be refreshed in place rather than
  // by navigating away and back.
  const [refreshing, setRefreshing] = useState(false);
  const onPullRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([fetchMyTeam(), fetchTeamNumbers()]);
    } catch (e) {
      console.log('[Refresh] failed:', e.message);
    } finally {
      setRefreshing(false);
    }
  }, [Promise.all]);

  const fetchTeamNumbers = async () => {
    try {
      const res = await fetch(`${apiUrl}/team/my`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      setMyTeams(res.ok && Array.isArray(data?.data) ? data.data : []);
    } catch (e) {
      console.log('[MyTeamScreen] Could not load team numbers:', e.message);
      setMyTeams([]);
    }
  };

  const fetchMyTeam = async () => {
    setLoading(true);
    setError('');
    try {
      // Use existing GET /users endpoint
      const response = await fetch(`${apiUrl}/users?limit=200`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();

      if (response.ok && data.success && Array.isArray(data.data)) {
        const currentUserId = user?.id || user?._id;
        // Filter users who report to the logged-in user
        const subordinates = data.data.filter((u) => {
          const managerId = typeof u.reportsTo === 'object' ? u.reportsTo?._id : u.reportsTo;
          return String(managerId) === String(currentUserId);
        });

        // Enrich subordinates with today stats using existing APIs
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);
        const endOfToday = new Date();
        endOfToday.setHours(23, 59, 59, 999);

        const enriched = await Promise.all(
          subordinates.map(async (sub) => {
            try {
              // 1. Fetch today orders using existing /order/all or /order
              const ordersRes = await fetch(
                `${apiUrl}/order?salesmanId=${sub._id}&startDate=${startOfToday.toISOString()}&endDate=${endOfToday.toISOString()}`,
                { headers: { Authorization: `Bearer ${token}` } }
              );
              const ordersData = await ordersRes.json();
              const ordersList = Array.isArray(ordersData.data) ? ordersData.data : [];
              const todayOrderCount = ordersList.length;
              const todayOrderTotal = ordersList.reduce(
                (sum, o) => sum + (o.grandTotal || o.totalAmount || o.netPayableAmount || 0),
                0
              );

              // 2. Fetch today visits using existing /visit
              const visitsRes = await fetch(
                `${apiUrl}/visit/salesman/${sub._id}?date=${localDateKey()}`,
                { headers: { Authorization: `Bearer ${token}` } }
              );
              const visitsData = await visitsRes.json();
              const visitsList = Array.isArray(visitsData.data) ? visitsData.data : [];
              const partiesRes = await fetch(`${apiUrl}/parties?assignedSalesman=${sub._id}&limit=500`, { headers: { Authorization: `Bearer ${token}` } });
              const partiesData = await partiesRes.json();
              const ownedParties = (Array.isArray(partiesData.data) ? partiesData.data : []).filter(party => String(party.assignedSalesman?._id || party.assignedSalesman) === String(sub._id));

              // Where they are right now. Fetched with the rest so the roster
              // can mark who is inside a shop without opening each member.
              let live = null;
              try {
                const liveRes = await fetch(`${apiUrl}/daily-log/live/${sub._id}`, { headers: { Authorization: `Bearer ${token}` } });
                const liveData = await liveRes.json();
                if (liveRes.ok && liveData.success) live = liveData.data;
              } catch (liveErr) {
                console.log('[MyTeamScreen] live status unavailable:', liveErr.message);
              }

              return {
                ...sub,
                live,
                stats: {
                  todayOrderCount,
                  todayOrderTotal,
                  todayVisitsCount: live?.visitsToday ?? visitsList.length,
                  outstanding: ownedParties.reduce((sum,party)=>sum+Number(party.currentOutstanding||0),0),
                },
              };
            } catch (e) {
              return {
                ...sub,
                stats: {
                  todayOrderCount: 0,
                  todayOrderTotal: 0,
                  todayVisitsCount: 0,
                },
              };
            }
          })
        );

        setTeamMembers(enriched);
      } else {
        throw new Error(data.message || 'Failed to fetch team users');
      }
    } catch (err) {
      console.log('[MyTeamScreen] Error fetching team:', err.message);
      setError('Could not load team members.');
    } finally {
      setLoading(false);
    }
  };

  /**
   * Re-reads one day's visits without reloading the whole member.
   *
   * Only the visit list depends on the date; parties, orders and collections
   * do not, and refetching all of them to change a day would be slow and would
   * flicker the tabs the manager is not looking at.
   */
  const loadVisitsFor = async (dateKey) => {
    if (!selectedMember) return;
    setVisitsLoading(true);
    setVisitDate(dateKey);
    try {
      const response = await fetch(`${apiUrl}/visit/salesman/${selectedMember._id}?date=${dateKey}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await response.json();
      setMemberVisits(response.ok && Array.isArray(body.data) ? body.data : []);
    } catch (err) {
      console.log('[MyTeamScreen] Could not load visits:', err.message);
      setMemberVisits([]);
    } finally {
      setVisitsLoading(false);
    }
  };

  /** Steps the visit day by whole days, never past today. */
  const shiftVisitDate = (days) => {
    const moved = new Date(`${visitDate}T12:00:00`);
    moved.setDate(moved.getDate() + days);
    const key = localDateKey(moved);
    if (key > localDateKey()) return;      // tomorrow has not happened yet
    loadVisitsFor(key);
  };

  const handleOpenMemberDetails = async (member, initialTab = 'summary') => {
    setSelectedMember(member);
    setActiveTab(initialTab);
    setLoadingDetails(true);

    try {
      // 1. Fetch today's beat plan for this member using existing API
      const beatRes = await fetch(`${apiUrl}/beat-plan/today?salesmanId=${member._id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const beatData = await beatRes.json();
      if (beatRes.ok && beatData.success) {
        setMemberBeatPlan(beatData.data);
      } else {
        setMemberBeatPlan(null);
      }

      // 2. Fetch collections for this member using existing API
      const colRes = await fetch(`${apiUrl}/collection?salesmanId=${member._id}&limit=20`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const colData = await colRes.json();
      if (colRes.ok && Array.isArray(colData.data)) {
        setMemberCollections(colData.data);
      } else {
        setMemberCollections([]);
      }

      // 3. Fetch assigned parties for this member using existing API
      const partyRes = await fetch(`${apiUrl}/parties?assignedSalesman=${member._id}&limit=50`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const partyData = await partyRes.json();
      if (partyRes.ok && Array.isArray(partyData.data)) {
        setMemberParties(partyData.data.filter(party => String(party.assignedSalesman?._id || party.assignedSalesman) === String(member._id)));
      } else {
        setMemberParties([]);
      }

      const date = localDateKey();
      const [orderRes, visitRes, logRes, liveRes] = await Promise.all([
        fetch(`${apiUrl}/order?salesmanId=${member._id}&limit=100`, { headers: { Authorization: `Bearer ${token}` } }),
        // One day at a time. Without the date this returned every visit the
        // salesman had ever made, under a heading that said "Today".
        fetch(`${apiUrl}/visit/salesman/${member._id}?date=${date}`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${apiUrl}/daily-log/${member._id}/${date}`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${apiUrl}/daily-log/live/${member._id}`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      const [orderData,visitData,logData,liveData] = await Promise.all([orderRes.json(),visitRes.json(),logRes.json(),liveRes.json()]);
      setMemberOrders((Array.isArray(orderData.data)?orderData.data:[]).filter(order=>String(order.salesmanId?._id||order.salesmanId)===String(member._id)));
      const live = liveRes.ok && liveData.success ? liveData.data : null;
      setMemberLive(live);
      // The live call already returns today's visits with their party names, so
      // it is preferred; /visit/salesman is the fallback for an older server.
      // The live call carries today's visits with their party names already,
      // so it is preferred for today; any other day comes from the dated call.
      setMemberVisits(live?.recentVisits?.length ? live.recentVisits : (Array.isArray(visitData.data) ? visitData.data : []));
      setVisitDate(date);
      setMemberDailyLog(logRes.ok&&logData.success?logData.data:null);
    } catch (err) {
      console.log('[MyTeamScreen] Error loading details:', err.message);
    } finally {
      setLoadingDetails(false);
    }
  };

  const handleCreateOrderForMember = (member) => {
    if (memberParties.length > 0) {
      // Close modal & open order screen preselected with party
      setSelectedMember(null);
      onNavigateToOrder && onNavigateToOrder(memberParties[0]);
    } else {
      Alert.alert(
        'No Parties Assigned',
        `No active parties currently assigned to ${member.name}.`
      );
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={onBack}>
          <Text style={styles.backBtnText}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>👥 My Team & Subordinates</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={styles.container}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onPullRefresh} colors={['#00796B']} tintColor="#00796B" />
        }
      >
        {loading ? (
          <View style={styles.loaderContainer}>
            <ActivityIndicator size="large" color="#00796B" />
            <Text style={styles.loaderText}>Loading your team members...</Text>
          </View>
        ) : error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={fetchMyTeam}>
              <Text style={styles.retryBtnText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : teamMembers.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={{ fontSize: 44, marginBottom: 12 }}>👔</Text>
            <Text style={styles.emptyTitle}>No Subordinates Assigned</Text>
            <Text style={styles.emptySubtitle}>
              You currently do not have any team members assigned under your reporting hierarchy.
            </Text>
          </View>
        ) : (
          <>
            {myTeams.filter((team) => team.summary).map((team) => {
              const s = team.summary;
              const money = (v) => `₹${Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
              const done = s.targetAmount > 0 ? Math.round((s.achievedAmount / s.targetAmount) * 100) : 0;
              return (
                <View key={team._id} style={styles.teamNumbersCard}>
                  <Text style={styles.teamNumbersName}>{team.name}</Text>
                  <Text style={styles.teamNumbersSub}>
                    {team.teamCode} · {team.role === 'manager' ? 'you manage this team' : 'you are a member'}
                  </Text>

                  <View style={styles.teamNumbersRow}>
                    <View style={styles.teamNumbersCell}>
                      <Text style={styles.teamNumbersLabel}>Target</Text>
                      <Text style={styles.teamNumbersVal}>{money(s.targetAmount)}</Text>
                    </View>
                    <View style={styles.teamNumbersCell}>
                      <Text style={styles.teamNumbersLabel}>Achieved</Text>
                      <Text style={styles.teamNumbersVal}>{money(s.achievedAmount)}</Text>
                    </View>
                    <View style={styles.teamNumbersCell}>
                      <Text style={styles.teamNumbersLabel}>Done</Text>
                      <Text style={[styles.teamNumbersVal, done >= 100 && styles.teamNumbersGood]}>{done}%</Text>
                    </View>
                  </View>

                  <View style={styles.teamNumbersRow}>
                    <View style={styles.teamNumbersCell}>
                      <Text style={styles.teamNumbersLabel}>Parties</Text>
                      <Text style={styles.teamNumbersVal}>{s.parties}</Text>
                    </View>
                    <View style={styles.teamNumbersCell}>
                      <Text style={styles.teamNumbersLabel}>Outstanding</Text>
                      <Text style={[styles.teamNumbersVal, s.overLimit && styles.teamNumbersBad]}>{money(s.outstanding)}</Text>
                    </View>
                    <View style={styles.teamNumbersCell}>
                      <Text style={styles.teamNumbersLabel}>Limit</Text>
                      {/* Zero means no ceiling, so it must not read as ₹0. */}
                      <Text style={styles.teamNumbersVal}>{s.outstandingLimit > 0 ? money(s.outstandingLimit) : 'None'}</Text>
                    </View>
                  </View>

                  {s.overLimit && (
                    <Text style={styles.teamNumbersWarn}>
                      Past the team's outstanding limit by {money(s.outstanding - s.outstandingLimit)}. New credit
                      orders for this team's parties will be refused until it is collected.
                    </Text>
                  )}
                  {s.unallocatedAmount > 0 && team.role === 'manager' && (
                    <Text style={styles.teamNumbersNote}>
                      {money(s.unallocatedAmount)} of the team target is still unallocated.
                    </Text>
                  )}
                </View>
              );
            })}

            {/* Team Overview Card */}
            <View style={styles.overviewCard}>
              <Text style={styles.overviewTitle}>Team Overview Today</Text>
              <View style={styles.overviewGrid}>
                <View style={styles.overviewCell}>
                  <Text style={styles.overviewLabel}>Team Size</Text>
                  <Text style={styles.overviewVal}>{teamMembers.length}</Text>
                </View>
                <View style={styles.overviewCell}>
                  <Text style={styles.overviewLabel}>Today's Orders</Text>
                  <Text style={styles.overviewVal}>
                    {teamMembers.reduce((acc, m) => acc + (m.stats?.todayOrderCount || 0), 0)}
                  </Text>
                </View>
                <View style={styles.overviewCell}>
                  <Text style={styles.overviewLabel}>Total Revenue</Text>
                  <Text style={[styles.overviewVal, { color: '#00796B' }]}>
                    ₹
                    {teamMembers
                      .reduce((acc, m) => acc + (m.stats?.todayOrderTotal || 0), 0)
                      .toLocaleString('en-IN')}
                  </Text>
                </View>
              </View>
            </View>

            <Text style={styles.sectionHeader}>Subordinates ({teamMembers.length})</Text>

            {teamMembers.map((member) => (
              <View key={member._id} style={styles.memberCard}>
                <View style={styles.memberHeaderRow}>
                  <View style={styles.avatarCircle}>
                    <Text style={styles.avatarText}>
                      {member.name ? member.name.charAt(0).toUpperCase() : '👤'}
                    </Text>
                  </View>
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={styles.memberName}>{member.name}</Text>
                    <Text style={styles.memberRole}>
                      📱 {member.mobile} • {member.roleName || member.role || 'Salesman'}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.statusBadge,
                      member.isActive ? styles.activeBadge : styles.inactiveBadge,
                    ]}
                  >
                    <Text
                      style={[
                        styles.statusBadgeText,
                        member.isActive ? styles.activeBadgeText : styles.inactiveBadgeText,
                      ]}
                    >
                      {member.isActive ? 'ACTIVE' : 'OFFLINE'}
                    </Text>
                  </View>
                </View>

                {/* Member Today Quick Metrics */}
                <View style={styles.memberMetricsRow}>
                  <View style={styles.metricItem}>
                    <Text style={styles.metricLabel}>Today Orders</Text>
                    <Text style={styles.metricValue}>
                      {member.stats?.todayOrderCount || 0}
                    </Text>
                  </View>
                  <View style={styles.metricDivider} />
                  <View style={styles.metricItem}>
                    <Text style={styles.metricLabel}>Order Value</Text>
                    <Text style={[styles.metricValue, { color: '#00796B' }]}>
                      ₹{(member.stats?.todayOrderTotal || 0).toLocaleString('en-IN')}
                    </Text>
                  </View>
                  <View style={styles.metricDivider} />
                  <View style={styles.metricItem}>
                    <Text style={styles.metricLabel}>Visits</Text>
                    <Text style={styles.metricValue}>
                      {member.stats?.todayVisitsCount || 0}
                    </Text>
                  </View>
                </View>
                <Text style={{color:'#C05621',fontWeight:'800',marginTop:10}}>Assigned-party outstanding: ₹{Number(member.stats?.outstanding||0).toLocaleString('en-IN')}</Text>

                {/* What they are doing this minute, without opening the member */}
                {member.live?.ongoingVisit ? (
                  <Text style={styles.rosterLiveOn}>
                    🟢 Inside {member.live.ongoingVisit.partyName} · {member.live.ongoingVisit.minutesInside} min
                  </Text>
                ) : member.live?.lastSeenAt ? (
                  <Text style={styles.rosterLiveIdle}>
                    📍 Last seen {member.live.lastSeenMinutesAgo} min ago · {Number(member.live.totalDistanceKm || 0).toFixed(1)} km today
                  </Text>
                ) : (
                  <Text style={styles.rosterLiveOff}>📍 No location received today</Text>
                )}

                {/* Subordinate Actions */}
                <View style={styles.actionsRow}>
                  <TouchableOpacity
                    style={[styles.actionChip, styles.primaryChip]}
                    onPress={() => handleOpenMemberDetails(member, 'summary')}
                  >
                    <Text style={styles.primaryChipText}>👁️ View Details</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.actionChip}
                    onPress={() => handleOpenMemberDetails(member, 'beat')}
                  >
                    <Text style={styles.actionChipText}>🗺️ Beat Plan</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.actionChip}
                    onPress={() => handleOpenMemberDetails(member, 'collections')}
                  >
                    <Text style={styles.actionChipText}>💰 Collections</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </>
        )}
      </ScrollView>

      {/* Subordinate Detailed View Modal */}
      {selectedMember ? (
        <Modal
          visible={!!selectedMember}
          animationType="slide"
          onRequestClose={() => setSelectedMember(null)}
        >
          <SafeAreaView style={{ flex: 1, backgroundColor: '#FFF' }}>
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={() => setSelectedMember(null)}>
                <Text style={styles.modalCloseText}>✕ Close</Text>
              </TouchableOpacity>
              <Text style={styles.modalTitle}>{selectedMember.name}'s Dashboard</Text>
              <View style={{ width: 50 }} />
            </View>

            {/* Modal Tabs */}
            <View style={styles.tabHeaderRow}>
              <TouchableOpacity
                style={[styles.tabBtn, activeTab === 'summary' && styles.activeTabBtn]}
                onPress={() => setActiveTab('summary')}
              >
                <Text style={[styles.tabBtnText, activeTab === 'summary' && styles.activeTabBtnText]}>
                  Overview
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.tabBtn, activeTab === 'beat' && styles.activeTabBtn]}
                onPress={() => setActiveTab('beat')}
              >
                <Text style={[styles.tabBtnText, activeTab === 'beat' && styles.activeTabBtnText]}>
                  Beat Plan
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.tabBtn, activeTab === 'parties' && styles.activeTabBtn]}
                onPress={() => setActiveTab('parties')}
              >
                <Text style={[styles.tabBtnText, activeTab === 'parties' && styles.activeTabBtnText]}>
                  Parties ({memberParties.length})
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.tabBtn, activeTab === 'collections' && styles.activeTabBtn]}
                onPress={() => setActiveTab('collections')}
              >
                <Text style={[styles.tabBtnText, activeTab === 'collections' && styles.activeTabBtnText]}>
                  Collections
                </Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.tabBtn, activeTab === 'orders' && styles.activeTabBtn]} onPress={() => setActiveTab('orders')}>
                <Text style={[styles.tabBtnText, activeTab === 'orders' && styles.activeTabBtnText]}>Orders</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.tabBtn, activeTab === 'activity' && styles.activeTabBtn]} onPress={() => setActiveTab('activity')}>
                <Text style={[styles.tabBtnText, activeTab === 'activity' && styles.activeTabBtnText]}>Live / Visits</Text>
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={{ padding: 16 }}>
              {loadingDetails ? (
                <ActivityIndicator color="#00796B" size="large" style={{ marginTop: 40 }} />
              ) : activeTab === 'summary' ? (
                <View>
                  <View style={styles.detailCard}>
                    <Text style={styles.detailCardTitle}>Subordinate Info</Text>
                    <Text style={styles.detailText}>👤 Name: {selectedMember.name}</Text>
                    <Text style={styles.detailText}>📱 Mobile: {selectedMember.mobile}</Text>
                    <Text style={styles.detailText}>
                      🏷️ Role: {selectedMember.roleName || selectedMember.role}
                    </Text>
                    <Text style={styles.detailText}>
                      📌 Status: {selectedMember.isActive ? 'Active' : 'Inactive'}
                    </Text>
                  </View>

                  <TouchableOpacity
                    style={styles.createOrderBtn}
                    onPress={() => handleCreateOrderForMember(selectedMember)}
                  >
                    <Text style={styles.createOrderBtnText}>
                      📦 Create Order for {selectedMember.name}
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : activeTab === 'beat' ? (
                <View>
                  {memberBeatPlan ? (
                    <View style={styles.detailCard}>
                      <Text style={styles.detailCardTitle}>
                        🗺️ Beat Plan: {memberBeatPlan.beatPlanName}
                      </Text>
                      <Text style={styles.detailText}>Area: {memberBeatPlan.area || 'N/A'}</Text>
                      <Text style={styles.detailText}>
                        Day {memberBeatPlan.cycleDay || '?'} of the cycle
                        {memberBeatPlan.executionStatus ? ` · ${memberBeatPlan.executionStatus}` : ''}
                      </Text>

                      {/* Progress against the plan is the point of looking at
                          someone else's beat, so it leads rather than hiding
                          at the bottom of the list. */}
                      <View style={styles.beatProgressRow}>
                        <Text style={styles.beatProgressText}>
                          {memberBeatPlan.visitedCount || 0} of {memberBeatPlan.totalParties || 0} visited
                        </Text>
                        <Text style={styles.beatProgressPct}>
                          {memberBeatPlan.totalParties
                            ? Math.round(((memberBeatPlan.visitedCount || 0) / memberBeatPlan.totalParties) * 100)
                            : 0}%
                        </Text>
                      </View>
                      <View style={styles.beatBarBg}>
                        <View
                          style={[
                            styles.beatBarFill,
                            {
                              width: `${memberBeatPlan.totalParties
                                ? Math.min(100, ((memberBeatPlan.visitedCount || 0) / memberBeatPlan.totalParties) * 100)
                                : 0}%`,
                            },
                          ]}
                        />
                      </View>

                      <Text style={[styles.detailCardTitle, { marginTop: 16 }]}>
                        Targeted Parties Today:
                      </Text>
                      {Array.isArray(memberBeatPlan.parties) && memberBeatPlan.parties.length > 0 ? (
                        memberBeatPlan.parties.map((pItem, idx) => {
                          const done = pItem.visitedToday;
                          const running = !!pItem.activeVisitId;
                          return (
                            <View
                              key={idx}
                              style={[
                                styles.partyItemRow,
                                done && styles.partyItemDone,
                                running && styles.partyItemRunning,
                              ]}
                            >
                              <Text style={styles.partyItemName}>
                                {done ? '✅' : running ? '🟢' : '⬜'} {idx + 1}. {pItem.partyId?.partyName || 'Party'}
                              </Text>
                              <Text style={styles.partyItemSub}>
                                {pItem.partyId?.mobile} • {pItem.partyId?.address}
                              </Text>
                              {(done || running) && (
                                <Text style={styles.partyItemState}>
                                  {running
                                    ? 'Visit in progress'
                                    : `Visited${pItem.visitDurationMinutes ? ` · ${pItem.visitDurationMinutes} min` : ''}${pItem.visitProductive ? ' · order/collection taken' : ''}`}
                                </Text>
                              )}
                            </View>
                          );
                        })
                      ) : (
                        <Text style={styles.emptySubText}>No parties in today's beat schedule.</Text>
                      )}
                    </View>
                  ) : (
                    <Text style={styles.emptySubText}>No active beat plan configured for today.</Text>
                  )}
                </View>
              ) : activeTab === 'parties' ? (
                <View>
                  {memberParties.length === 0 ? (
                    <Text style={styles.emptySubText}>No parties assigned to this subordinate.</Text>
                  ) : (
                    memberParties.map((party) => (
                      <View key={party._id} style={styles.partyCard}>
                        <Text style={name(styles.partyName)}>{name(party.partyName)}</Text>
                        <Text style={styles.partySub}>
                          📱 {party.mobile} • {party.area}, {party.city}
                        </Text>
                        <Text style={styles.partyOut}>
                          Outstanding: ₹{(party.currentOutstanding || 0).toLocaleString('en-IN')}
                        </Text>
                        <TouchableOpacity
                          style={styles.createOrderBtn}
                          onPress={() => {
                            setSelectedMember(null);
                            onNavigateToOrder && onNavigateToOrder(party);
                          }}
                        >
                          <Text style={styles.createOrderBtnText}>Create Order</Text>
                        </TouchableOpacity>
                      </View>
                    ))
                  )}
                </View>
              ) : activeTab === 'orders' ? (
                <View>{memberOrders.map(order=><View key={order._id} style={styles.colCard}><View style={styles.colHeaderRow}><Text style={styles.colParty}>{order.orderNumber}</Text><Text style={styles.colAmount}>₹{Number(order.netPayableAmount||order.grandTotal||0).toLocaleString('en-IN')}</Text></View><Text style={styles.colSub}>{order.partyId?.partyName||'Party'} · {order.status}</Text></View>)}{!memberOrders.length&&<Text style={styles.emptySubText}>No orders found for this member.</Text>}</View>
              ) : activeTab === 'activity' ? (
                <View>
                  {/* Where they are right now */}
                  <View style={styles.detailCard}>
                    <View style={styles.liveHeaderRow}>
                      <Text style={styles.detailCardTitle}>Right Now</Text>
                      <View style={[styles.liveChip, memberLive?.onDuty ? styles.liveChipOn : styles.liveChipOff]}>
                        <Text style={[styles.liveChipText, memberLive?.onDuty ? styles.liveChipTextOn : styles.liveChipTextOff]}>
                          {memberLive?.onDuty ? 'ON DUTY' : 'OFF DUTY'}
                        </Text>
                      </View>
                    </View>

                    {memberLive?.ongoingVisit ? (
                      <View style={styles.ongoingBox}>
                        <Text style={styles.ongoingTitle}>
                          🟢 Inside {memberLive.ongoingVisit.partyName}
                        </Text>
                        {!!memberLive.ongoingVisit.area && (
                          <Text style={styles.ongoingSub}>{memberLive.ongoingVisit.area}</Text>
                        )}
                        <Text style={styles.ongoingSub}>
                          {memberLive.ongoingVisit.minutesInside} min so far · arrived{' '}
                          {new Date(memberLive.ongoingVisit.arrivedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </Text>
                      </View>
                    ) : (
                      <Text style={styles.detailText}>Not inside any party at the moment.</Text>
                    )}

                    <Text style={styles.detailText}>
                      🚶 Distance today: {Number(memberLive?.totalDistanceKm ?? memberDailyLog?.totalDistanceKm ?? 0).toFixed(2)} km
                    </Text>
                    <Text style={styles.detailText}>
                      ✅ Visits today: {memberLive?.completedVisitsToday ?? 0} done
                      {memberLive?.ongoingVisit ? ', 1 running' : ''}
                    </Text>
                    <Text style={styles.detailText}>
                      📍 Last GPS fix:{' '}
                      {memberLive?.lastSeenAt
                        ? `${new Date(memberLive.lastSeenAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} (${memberLive.lastSeenMinutesAgo} min ago)`
                        : 'none received today'}
                    </Text>
                    {/* A fix older than half an hour is stale enough that it should
                        not be read as "where he is", so say so plainly. */}
                    {memberLive?.lastSeenMinutesAgo > 30 && (
                      <Text style={styles.staleWarn}>
                        This position is {memberLive.lastSeenMinutesAgo} minutes old — the phone may be offline or
                        tracking may be switched off.
                      </Text>
                    )}

                    {memberLive?.lastPoint ? (
                      <TouchableOpacity
                        style={styles.createOrderBtn}
                        onPress={() =>
                          Linking.openURL(
                            `https://www.google.com/maps/search/?api=1&query=${memberLive.lastPoint.latitude},${memberLive.lastPoint.longitude}`
                          )
                        }
                      >
                        <Text style={styles.createOrderBtnText}>📍 Open Last Location on Map</Text>
                      </TouchableOpacity>
                    ) : (
                      <Text style={styles.emptySubText}>No GPS point received today.</Text>
                    )}
                  </View>

                  <View style={styles.visitDateRow}>
                    <TouchableOpacity style={styles.visitDateArrow} onPress={() => shiftVisitDate(-1)}>
                      <Text style={styles.visitDateArrowText}>‹</Text>
                    </TouchableOpacity>

                    <View style={styles.visitDateMiddle}>
                      <Text style={styles.detailCardTitle}>
                        {visitDate === localDateKey()
                          ? `Today's Visits (${memberVisits.length})`
                          : `Visits (${memberVisits.length})`}
                      </Text>
                      <Text style={styles.visitDateLabel}>
                        {new Date(`${visitDate}T12:00:00`).toDateString()}
                      </Text>
                    </View>

                    <TouchableOpacity
                      style={[styles.visitDateArrow, visitDate >= localDateKey() && styles.visitDateArrowOff]}
                      disabled={visitDate >= localDateKey()}
                      onPress={() => shiftVisitDate(1)}
                    >
                      <Text style={styles.visitDateArrowText}>›</Text>
                    </TouchableOpacity>
                  </View>

                  {visitDate !== localDateKey() && (
                    <TouchableOpacity style={styles.backToTodayBtn} onPress={() => loadVisitsFor(localDateKey())}>
                      <Text style={styles.backToTodayText}>Back to today</Text>
                    </TouchableOpacity>
                  )}

                  {visitsLoading ? (
                    <ActivityIndicator color="#00796B" style={{ marginVertical: 20 }} />
                  ) : memberVisits.length === 0 ? (
                    <Text style={styles.emptySubText}>
                      {visitDate === localDateKey()
                        ? 'No visits recorded today.'
                        : 'No visits recorded on this day.'}
                    </Text>
                  ) : (
                    memberVisits.map((visit) => (
                      <View key={visit._id} style={styles.partyCard}>
                        <Text style={name(styles.partyName)}>
                          {name(visit.partyName || visit.partyId?.partyName || 'Party visit')}
                        </Text>
                        <Text style={styles.partySub}>
                          {visit.status === 'ongoing' ? '🟢 ongoing' : (visit.status || 'visited')}
                          {visit.durationMinutes ? ` · ${visit.durationMinutes} min` : ''}
                          {' · '}
                          {new Date(visit.arrivedAt || visit.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </Text>
                        {visit.productive && <Text style={styles.productiveTag}>Order or collection taken</Text>}
                      </View>
                    ))
                  )}
                </View>
              ) : (
                <View>
                  {memberCollections.length === 0 ? (
                    <Text style={styles.emptySubText}>No recent collections found.</Text>
                  ) : (
                    memberCollections.map((col) => (
                      <View key={col._id} style={styles.colCard}>
                        <View style={styles.colHeaderRow}>
                          <Text style={styles.colParty}>
                            {col.partyId?.partyName || 'Party Collection'}
                          </Text>
                          <Text style={styles.colAmount}>
                            ₹{(col.amount || 0).toLocaleString('en-IN')}
                          </Text>
                        </View>
                        <Text style={styles.colSub}>
                          Mode: {term(col.paymentMode)} • Status: {term(col.status)}
                        </Text>
                        <Text style={styles.colDate}>
                          Date: {new Date(col.collectionDate || col.createdAt).toLocaleDateString()}
                        </Text>
                      </View>
                    ))
                  )}
                </View>
              )}
            </ScrollView>
          </SafeAreaView>
        </Modal>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F7F9FC',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: scale(16),
    paddingVertical: verticalScale(14),
    backgroundColor: '#00796B',
  },
  backBtn: {
    padding: scale(4),
  },
  backBtnText: {
    color: '#FFF',
    fontSize: responsiveFontSize(16),
    fontWeight: '700',
  },
  headerTitle: {
    color: '#FFF',
    fontSize: responsiveFontSize(18),
    fontWeight: '700',
  },
  container: {
    padding: scale(16),
  },
  loaderContainer: {
    alignItems: 'center',
    marginVertical: verticalScale(40),
  },
  loaderText: {
    marginTop: verticalScale(12),
    color: '#4A5568',
  },
  errorCard: {
    backgroundColor: '#FFF5F5',
    borderColor: '#FEB2B2',
    borderWidth: 1,
    borderRadius: 8,
    padding: scale(16),
    alignItems: 'center',
  },
  errorText: {
    color: '#E53E3E',
    marginBottom: verticalScale(8),
  },
  retryBtn: {
    backgroundColor: '#E53E3E',
    paddingHorizontal: scale(16),
    paddingVertical: verticalScale(8),
    borderRadius: 6,
  },
  retryBtnText: {
    color: '#FFF',
    fontWeight: '700',
  },
  emptyContainer: {
    alignItems: 'center',
    marginVertical: verticalScale(60),
    paddingHorizontal: scale(20),
  },
  emptyTitle: {
    fontSize: responsiveFontSize(20),
    fontWeight: '700',
    color: '#2D3748',
    marginBottom: verticalScale(8),
  },
  emptySubtitle: {
    fontSize: responsiveFontSize(14),
    color: '#718096',
    textAlign: 'center',
  },
  teamNumbersCard: {
    backgroundColor: '#fff', borderRadius: 14, padding: 16, marginBottom: 14,
    borderWidth: 1, borderColor: '#e2e8f0',
  },
  teamNumbersName: { fontSize: 16, fontWeight: '700', color: '#0f172a' },
  teamNumbersSub: { fontSize: 11, color: '#64748b', marginTop: 2, marginBottom: 12 },
  teamNumbersRow: { flexDirection: 'row', marginBottom: 10 },
  teamNumbersCell: { flex: 1 },
  teamNumbersLabel: { fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4 },
  teamNumbersVal: { fontSize: 15, fontWeight: '700', color: '#0f172a', marginTop: 2 },
  teamNumbersGood: { color: '#16a34a' },
  teamNumbersBad: { color: '#dc2626' },
  teamNumbersWarn: {
    fontSize: 11, color: '#dc2626', backgroundColor: '#fef2f2',
    padding: 8, borderRadius: 8, marginTop: 4,
  },
  teamNumbersNote: { fontSize: 11, color: '#64748b', marginTop: 4 },
  overviewCard: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: scale(16),
    marginBottom: verticalScale(20),
    elevation: 2,
  },
  overviewTitle: {
    fontSize: responsiveFontSize(16),
    fontWeight: '700',
    color: '#2D3748',
    marginBottom: verticalScale(12),
  },
  overviewGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  overviewCell: {
    alignItems: 'center',
    flex: 1,
  },
  overviewLabel: {
    fontSize: responsiveFontSize(12),
    color: '#718096',
    marginBottom: verticalScale(4),
  },
  overviewVal: {
    fontSize: responsiveFontSize(18),
    fontWeight: '700',
    color: '#1A202C',
  },
  sectionHeader: {
    fontSize: responsiveFontSize(16),
    fontWeight: '700',
    color: '#2D3748',
    marginBottom: verticalScale(12),
  },
  memberCard: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: scale(16),
    marginBottom: verticalScale(12),
    elevation: 2,
  },
  memberHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarCircle: {
    width: scale(44),
    height: verticalScale(44),
    borderRadius: 22,
    backgroundColor: '#E6FFFA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: responsiveFontSize(18),
    fontWeight: '700',
    color: '#00796B',
  },
  memberName: {
    fontSize: responsiveFontSize(16),
    fontWeight: '700',
    color: '#1A202C',
  },
  memberRole: {
    fontSize: responsiveFontSize(12),
    color: '#718096',
    marginTop: verticalScale(2),
  },
  statusBadge: {
    paddingHorizontal: scale(8),
    paddingVertical: verticalScale(4),
    borderRadius: 6,
  },
  activeBadge: {
    backgroundColor: '#C6F6D5',
  },
  inactiveBadge: {
    backgroundColor: '#EDF2F7',
  },
  statusBadgeText: {
    fontSize: responsiveFontSize(10),
    fontWeight: '700',
  },
  activeBadgeText: {
    color: '#22543D',
  },
  inactiveBadgeText: {
    color: '#4A5568',
  },
  memberMetricsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F7F9FC',
    borderRadius: 8,
    paddingVertical: verticalScale(10),
    paddingHorizontal: scale(12),
    marginVertical: verticalScale(12),
  },
  metricItem: {
    flex: 1,
    alignItems: 'center',
  },
  metricLabel: {
    fontSize: responsiveFontSize(11),
    color: '#718096',
    marginBottom: verticalScale(2),
  },
  metricValue: {
    fontSize: responsiveFontSize(14),
    fontWeight: '700',
    color: '#2D3748',
  },
  metricDivider: {
    width: 1,
    height: verticalScale(24),
    backgroundColor: '#E2E8F0',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: verticalScale(8),
  },
  actionChip: {
    flex: 1,
    backgroundColor: '#EDF2F7',
    paddingVertical: verticalScale(8),
    borderRadius: 6,
    alignItems: 'center',
  },
  actionChipText: {
    fontSize: responsiveFontSize(12),
    fontWeight: '600',
    color: '#4A5568',
  },
  primaryChip: {
    backgroundColor: '#00796B',
  },
  primaryChipText: {
    fontSize: responsiveFontSize(12),
    fontWeight: '700',
    color: '#FFF',
  },

  // Modal Styles
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: scale(16),
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  modalCloseText: {
    fontSize: responsiveFontSize(16),
    color: '#E53E3E',
    fontWeight: '700',
  },
  modalTitle: {
    fontSize: responsiveFontSize(16),
    fontWeight: '700',
    color: '#2D3748',
  },
  tabHeaderRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    backgroundColor: '#F7F9FC',
  },
  tabBtn: {
    flex: 1,
    paddingVertical: verticalScale(12),
    alignItems: 'center',
  },
  activeTabBtn: {
    borderBottomWidth: 3,
    borderBottomColor: '#00796B',
    backgroundColor: '#FFF',
  },
  tabBtnText: {
    fontSize: responsiveFontSize(13),
    color: '#718096',
    fontWeight: '600',
  },
  activeTabBtnText: {
    color: '#00796B',
    fontWeight: '700',
  },
  beatProgressRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
    marginBottom: 6,
  },
  beatProgressText: { fontSize: 13, fontWeight: '700', color: '#2D3748' },
  beatProgressPct: { fontSize: 13, fontWeight: '800', color: '#00796B' },
  beatBarBg: { height: 8, borderRadius: 999, backgroundColor: '#EDF2F7', overflow: 'hidden' },
  beatBarFill: { height: 8, borderRadius: 999, backgroundColor: '#00796B' },
  partyItemDone: { backgroundColor: '#E6F6EF' },
  partyItemRunning: { backgroundColor: '#FFF7E6' },
  partyItemState: { fontSize: 11, color: '#00695C', fontWeight: '700', marginTop: 3 },
  liveHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  liveChip: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999 },
  liveChipOn: { backgroundColor: '#E6F6EF' },
  liveChipOff: { backgroundColor: '#EDF2F7' },
  liveChipText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  liveChipTextOn: { color: '#00796B' },
  liveChipTextOff: { color: '#718096' },
  ongoingBox: {
    backgroundColor: '#E6F6EF',
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
  },
  ongoingTitle: { fontSize: 14, fontWeight: '800', color: '#00695C' },
  ongoingSub: { fontSize: 12, color: '#2F6F63', marginTop: 3 },
  staleWarn: { fontSize: 11, color: '#C05621', marginTop: 6, lineHeight: 15 },
  productiveTag: { fontSize: 11, color: '#00796B', fontWeight: '700', marginTop: 4 },
  rosterLiveOn: { fontSize: 12, color: '#00695C', fontWeight: '700', marginTop: 6 },
  rosterLiveIdle: { fontSize: 12, color: '#4A5568', marginTop: 6 },
  rosterLiveOff: { fontSize: 12, color: '#A0AEC0', marginTop: 6 },
  detailCard: {
    backgroundColor: '#F7F9FC',
    borderRadius: 8,
    padding: scale(14),
    marginBottom: verticalScale(16),
  },
  visitDateRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  visitDateMiddle: { flex: 1, alignItems: 'center' },
  visitDateLabel: { fontSize: responsiveFontSize(10), color: '#718096', marginTop: 1 },
  visitDateArrow: {
    width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#CBD5E0',
  },
  visitDateArrowOff: { opacity: 0.3 },
  visitDateArrowText: { fontSize: responsiveFontSize(18), color: '#2D3748', lineHeight: responsiveFontSize(20) },
  backToTodayBtn: { alignSelf: 'center', marginTop: 6, marginBottom: 2 },
  backToTodayText: { fontSize: responsiveFontSize(10), color: '#00796B', fontWeight: '700' },
  detailCardTitle: {
    fontSize: responsiveFontSize(15),
    fontWeight: '700',
    color: '#2D3748',
    marginBottom: verticalScale(8),
  },
  detailText: {
    fontSize: responsiveFontSize(14),
    color: '#4A5568',
    marginBottom: verticalScale(4),
  },
  createOrderBtn: {
    backgroundColor: '#00796B',
    paddingVertical: verticalScale(14),
    borderRadius: 8,
    alignItems: 'center',
  },
  createOrderBtnText: {
    color: '#FFF',
    fontSize: responsiveFontSize(16),
    fontWeight: '700',
  },
  emptySubText: {
    color: '#A0AEC0',
    fontStyle: 'italic',
    textAlign: 'center',
    marginVertical: verticalScale(20),
  },
  partyItemRow: {
    backgroundColor: '#FFF',
    borderRadius: 6,
    padding: scale(10),
    marginTop: verticalScale(6),
  },
  partyItemName: {
    fontSize: responsiveFontSize(14),
    fontWeight: '700',
    color: '#2D3748',
  },
  partyItemSub: {
    fontSize: responsiveFontSize(12),
    color: '#718096',
    marginTop: verticalScale(2),
  },
  partyCard: {
    backgroundColor: '#F7F9FC',
    borderRadius: 8,
    padding: scale(12),
    marginBottom: verticalScale(8),
  },
  partyName: {
    fontSize: responsiveFontSize(15),
    fontWeight: '700',
    color: '#2D3748',
  },
  partySub: {
    fontSize: responsiveFontSize(13),
    color: '#718096',
    marginTop: verticalScale(2),
  },
  partyOut: {
    fontSize: responsiveFontSize(13),
    fontWeight: '700',
    color: '#DD6B20',
    marginTop: verticalScale(4),
  },
  colCard: {
    backgroundColor: '#F7F9FC',
    borderRadius: 8,
    padding: scale(12),
    marginBottom: verticalScale(8),
  },
  colHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  colParty: {
    fontSize: responsiveFontSize(14),
    fontWeight: '700',
    color: '#2D3748',
  },
  colAmount: {
    fontSize: responsiveFontSize(14),
    fontWeight: '700',
    color: '#38A169',
  },
  colSub: {
    fontSize: responsiveFontSize(12),
    color: '#718096',
    marginTop: verticalScale(4),
  },
  colDate: {
    fontSize: responsiveFontSize(11),
    color: '#A0AEC0',
    marginTop: verticalScale(2),
  },
});
