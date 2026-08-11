import React, { useState, useEffect } from 'react';
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
} from 'react-native';
import { scale, verticalScale, responsiveFontSize, maxContainerWidth } from '../utils/responsive';

export default function MyTeamScreen({
  token,
  apiUrl,
  user,
  onBack,
  onNavigateToOrder,
  onNavigateToParty,
}) {
  const [loading, setLoading] = useState(true);
  const [teamMembers, setTeamMembers] = useState([]);
  const [error, setError] = useState('');

  // Selected subordinate modal details
  const [selectedMember, setSelectedMember] = useState(null);
  const [activeTab, setActiveTab] = useState('summary'); // 'summary' | 'beat' | 'collections' | 'parties'
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [memberBeatPlan, setMemberBeatPlan] = useState(null);
  const [memberCollections, setMemberCollections] = useState([]);
  const [memberParties, setMemberParties] = useState([]);
  const [memberOrders, setMemberOrders] = useState([]);
  const [memberVisits, setMemberVisits] = useState([]);
  const [memberDailyLog, setMemberDailyLog] = useState(null);

  useEffect(() => {
    fetchMyTeam();
  }, [apiUrl, token, user]);

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
                `${apiUrl}/visit/salesman/${sub._id}?date=${startOfToday.toISOString().slice(0,10)}`,
                { headers: { Authorization: `Bearer ${token}` } }
              );
              const visitsData = await visitsRes.json();
              const visitsList = Array.isArray(visitsData.data) ? visitsData.data : [];
              const partiesRes = await fetch(`${apiUrl}/parties?assignedSalesman=${sub._id}&limit=500`, { headers: { Authorization: `Bearer ${token}` } });
              const partiesData = await partiesRes.json();
              const ownedParties = (Array.isArray(partiesData.data) ? partiesData.data : []).filter(party => String(party.assignedSalesman?._id || party.assignedSalesman) === String(sub._id));

              return {
                ...sub,
                stats: {
                  todayOrderCount,
                  todayOrderTotal,
                  todayVisitsCount: visitsList.length,
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

      const today = new Date();
      const date = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
      const [orderRes, visitRes, logRes] = await Promise.all([
        fetch(`${apiUrl}/order?salesmanId=${member._id}&limit=100`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${apiUrl}/visit/salesman/${member._id}`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${apiUrl}/daily-log/${member._id}/${date}`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      const [orderData,visitData,logData] = await Promise.all([orderRes.json(),visitRes.json(),logRes.json()]);
      setMemberOrders((Array.isArray(orderData.data)?orderData.data:[]).filter(order=>String(order.salesmanId?._id||order.salesmanId)===String(member._id)));
      setMemberVisits(Array.isArray(visitData.data)?visitData.data:[]);
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

      <ScrollView contentContainerStyle={styles.container}>
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
                        Total Scheduled Parties: {memberBeatPlan.totalParties || 0}
                      </Text>

                      <Text style={[styles.detailCardTitle, { marginTop: 16 }]}>
                        Targeted Parties Today:
                      </Text>
                      {Array.isArray(memberBeatPlan.parties) && memberBeatPlan.parties.length > 0 ? (
                        memberBeatPlan.parties.map((pItem, idx) => (
                          <View key={idx} style={styles.partyItemRow}>
                            <Text style={styles.partyItemName}>
                              {idx + 1}. {pItem.partyId?.partyName || 'Party'}
                            </Text>
                            <Text style={styles.partyItemSub}>
                              {pItem.partyId?.mobile} • {pItem.partyId?.address}
                            </Text>
                          </View>
                        ))
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
                        <Text style={styles.partyName}>{party.partyName}</Text>
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
                  <View style={styles.detailCard}><Text style={styles.detailCardTitle}>Live Location</Text>{memberDailyLog?.points?.length?<><Text style={styles.detailText}>Last update: {new Date(memberDailyLog.points.at(-1).timestamp).toLocaleString()}</Text><Text style={styles.detailText}>Distance today: {Number(memberDailyLog.totalDistanceKm||0).toFixed(2)} km</Text><TouchableOpacity style={styles.createOrderBtn} onPress={()=>{const p=memberDailyLog.points.at(-1);Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${p.latitude},${p.longitude}`)}}><Text style={styles.createOrderBtnText}>Open Live Location</Text></TouchableOpacity></>:<Text style={styles.emptySubText}>No live GPS point available today.</Text>}</View>
                  <Text style={styles.detailCardTitle}>Recent Visits ({memberVisits.length})</Text>
                  {memberVisits.map(visit=><View key={visit._id} style={styles.partyCard}><Text style={styles.partyName}>{visit.partyId?.partyName||'Party visit'}</Text><Text style={styles.partySub}>{visit.status||'visited'} · {new Date(visit.arrivedAt||visit.createdAt).toLocaleString()}</Text></View>)}
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
                          Mode: {col.paymentMode?.toUpperCase()} • Status: {col.status?.toUpperCase()}
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
  detailCard: {
    backgroundColor: '#F7F9FC',
    borderRadius: 8,
    padding: scale(14),
    marginBottom: verticalScale(16),
  },
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
