import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
  ActivityIndicator,
  RefreshControl,
  Dimensions,
} from 'react-native';

const { width: screenWidth } = Dimensions.get('window');
const bannerWidth = screenWidth - 32;

export default function DashboardScreen({
  token,
  apiUrl,
  activeLogId,
  onNavigateToAttendance,
  onNavigateToLeave,
  onNavigateToParty,
  onNavigateToOrder,
  onNavigateToProducts,
  onNavigateToOrderList,
  onNavigateToOutstandingList,
  onNavigateToRoutePlanner,
  onNavigateToBeatPlan,
  user,
  isCso = false,
  onNavigateToTeam,
}) {
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Active banner slide index
  const [activeBannerIndex, setActiveBannerIndex] = useState(0);

  const [banners, setBanners] = useState([
    {
      tag: 'MEGA OFFER',
      title: 'Monsoon Bulk Bonus!',
      desc: 'Get extra 5% margin on all wholesale bookings this week.',
      emoji: '🌧️',
      bgColor: '#00796B', // teal
    },
    {
      tag: 'INCENTIVE',
      title: 'Top Performer Trip',
      desc: 'Cross 120% target this month & win a trip to Goa!',
      emoji: '🏆',
      bgColor: '#5B21B6', // purple
    },
    {
      tag: 'LAUNCH',
      title: 'New Energy Drinks!',
      desc: 'Earn double points on introducing new energy drink lines.',
      emoji: '⚡',
      bgColor: '#C2410C', // orange-red
    },
  ]);

  const handleBannerScroll = (event) => {
    const slideSize = event.nativeEvent.layoutMeasurement.width;
    const offset = event.nativeEvent.contentOffset.x;
    if (slideSize > 0) {
      const index = Math.round(offset / slideSize);
      if (index !== activeBannerIndex) {
        setActiveBannerIndex(index);
      }
    }
  };

  // Target states
  const [targetAmount, setTargetAmount] = useState(0);
  const [achievedAmount, setAchievedAmount] = useState(0);
  const [pipelineAmount, setPipelineAmount] = useState(0);
  const [achievementPercentage, setAchievementPercentage] = useState(0);

  // Today's statistics
  const [todayOrderCount, setTodayOrderCount] = useState(0);
  const [todayOrderValue, setTodayOrderValue] = useState(0);
  const [todayVisitCount, setTodayVisitCount] = useState(0);

  // Outstanding state
  const [totalOutstanding, setTotalOutstanding] = useState(0);
  const [outstandingLimit, setOutstandingLimit] = useState(0);
  const [teamSummary, setTeamSummary] = useState({ members: 0, orders: 0, sales: 0, outstanding: 0 });

  const fetchDashboardStats = async () => {
    if (!token) return;

    try {
      // 1. Fetch Target & Achievements
      const targetPromise = fetch(`${apiUrl}/target/my`, {
        headers: { Authorization: `Bearer ${token}` },
      }).then(async (res) => {
        const data = await res.json();
        if (res.ok && data.success && data.data) {
          const tgt = data.data.target || {};
          setTargetAmount(tgt.targetAmount || 0);
          setAchievedAmount(tgt.achievedAmount || 0);
          setPipelineAmount(tgt.pipelineAmount || 0);
          setAchievementPercentage(data.data.achievementPercentage || 0);
        } else {
          setTargetAmount(0);
          setAchievedAmount(0);
          setPipelineAmount(0);
          setAchievementPercentage(0);
        }
      }).catch((err) => {
        console.log('[Dashboard Stats] Target fetch failed:', err.message);
        setTargetAmount(0);
        setAchievedAmount(0);
        setPipelineAmount(0);
        setAchievementPercentage(0);
      });

      // 2. Fetch Today's Orders
      const today = new Date();
      const start = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0, 0).toISOString();
      const end = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999).toISOString();

      const ordersPromise = fetch(`${apiUrl}/order/my?startDate=${start}&endDate=${end}&limit=100`, {
        headers: { Authorization: `Bearer ${token}` },
      }).then(async (res) => {
        const data = await res.json();
        if (res.ok && data.success && Array.isArray(data.data)) {
          setTodayOrderCount(data.data.length);
          const totalVal = data.data.reduce((sum, ord) => sum + (ord.totalAmount || ord.grandTotal || 0), 0);
          setTodayOrderValue(totalVal);
        } else {
          setTodayOrderCount(0);
          setTodayOrderValue(0);
        }
      }).catch((err) => {
        console.log('[Dashboard Stats] Orders fetch failed:', err.message);
        setTodayOrderCount(0);
        setTodayOrderValue(0);
      });

      // 3. Fetch Today's Visits
      const visitsPromise = fetch(`${apiUrl}/visit/my/today`, {
        headers: { Authorization: `Bearer ${token}` },
      }).then(async (res) => {
        const data = await res.json();
        if (res.ok && data.success && Array.isArray(data.data)) {
          setTodayVisitCount(data.data.length);
        } else {
          setTodayVisitCount(0);
        }
      }).catch((err) => {
        console.log('[Dashboard Stats] Visits fetch failed:', err.message);
        setTodayVisitCount(0);
      });

          // 4. Fetch Banners from API
      const bannersPromise = fetch(`${apiUrl}/banner`, {
        headers: { Authorization: `Bearer ${token}` },
      }).then(async (res) => {
        const data = await res.json();
        if (res.ok && data.success && Array.isArray(data.data) && data.data.length > 0) {
          setBanners(data.data);
        }
      }).catch((err) => {
        console.log('[Dashboard Stats] Banners fetch failed (using local fallbacks):', err.message);
      });

      // 5. Fetch Assigned Parties to compute Total Outstanding
      const mePromise = fetch(`${apiUrl}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      }).then(async (res) => {
        const data = await res.json();
        if (res.ok && data.success && data.data) {
          setOutstandingLimit(Number(data.data.outstandingLimit || 0));
        } else {
          setOutstandingLimit(Number(user?.outstandingLimit || 0));
        }
      }).catch(() => {
        setOutstandingLimit(Number(user?.outstandingLimit || 0));
      });

      const partiesPromise = fetch(`${apiUrl}/parties/my`, {
        headers: { Authorization: `Bearer ${token}` },
      }).then(async (res) => {
        const data = await res.json();
        if (res.ok && data.success && Array.isArray(data.data)) {
          const totalOut = data.data.reduce((sum, p) => sum + (p.currentOutstanding || 0), 0);
          setTotalOutstanding(totalOut);
        } else {
          setTotalOutstanding(0);
        }
      }).catch((err) => {
        console.log('[Dashboard Stats] Parties outstanding fetch failed:', err.message);
        setTotalOutstanding(0);
      });

      await Promise.all([targetPromise, ordersPromise, visitsPromise, bannersPromise, partiesPromise, mePromise]);
      if (isCso) {
        const usersResponse = await fetch(`${apiUrl}/users?limit=200`, { headers: { Authorization: `Bearer ${token}` } });
        const usersResult = await usersResponse.json();
        const myId = user?._id || user?.id;
        const members = (Array.isArray(usersResult.data) ? usersResult.data : []).filter(member => String(member.reportsTo?._id || member.reportsTo) === String(myId));
        const memberData = await Promise.all(members.map(async member => {
          const [orderResponse, partyResponse] = await Promise.all([
            fetch(`${apiUrl}/order?salesmanId=${member._id}&startDate=${start}&endDate=${end}&limit=200`, { headers: { Authorization: `Bearer ${token}` } }),
            fetch(`${apiUrl}/parties?assignedSalesman=${member._id}&limit=500`, { headers: { Authorization: `Bearer ${token}` } }),
          ]);
          const [orderResult, partyResult] = await Promise.all([orderResponse.json(), partyResponse.json()]);
          const orders = Array.isArray(orderResult.data) ? orderResult.data.filter(order => String(order.salesmanId?._id || order.salesmanId) === String(member._id)) : [];
          const parties = Array.isArray(partyResult.data) ? partyResult.data.filter(party => String(party.assignedSalesman?._id || party.assignedSalesman) === String(member._id)) : [];
          return { orders: orders.length, sales: orders.reduce((sum,order)=>sum+Number(order.netPayableAmount||order.grandTotal||0),0), outstanding: parties.reduce((sum,party)=>sum+Number(party.currentOutstanding||0),0) };
        }));
        setTeamSummary({ members: members.length, orders: memberData.reduce((s,x)=>s+x.orders,0), sales: memberData.reduce((s,x)=>s+x.sales,0), outstanding: memberData.reduce((s,x)=>s+x.outstanding,0) });
      }
    } catch (e) {
      console.warn('Dashboard stats loader error:', e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchDashboardStats();
  }, [token, apiUrl]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchDashboardStats();
  }, [token, apiUrl]);

  const isOnline = activeLogId !== null;

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#00796B']} />
        }
      >
        {/* Sliding Banners Carousel Section */}
        <View style={styles.bannerContainer}>
          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onScroll={handleBannerScroll}
            scrollEventThrottle={16}
            style={styles.bannerScrollView}
          >
            {banners.map((banner, index) => (
              <View 
                key={index} 
                style={[styles.bannerCard, { backgroundColor: banner.bgColor }]}
              >
                <View style={styles.bannerTextContainer}>
                  <View style={styles.badgeWrapper}>
                    <Text style={styles.bannerBadge}>{banner.tag}</Text>
                  </View>
                  <Text style={styles.bannerTitle}>{banner.title}</Text>
                  <Text style={styles.bannerDesc}>{banner.desc}</Text>
                </View>
                <Text style={styles.bannerEmoji}>{banner.emoji}</Text>
              </View>
            ))}
          </ScrollView>

          {/* Page Indicators */}
          <View style={styles.dotsContainer}>
            {banners.map((_, index) => (
              <View
                key={index}
                style={[
                  styles.dot,
                  activeBannerIndex === index ? styles.activeDot : styles.inactiveDot,
                ]}
              />
            ))}
          </View>
        </View>

        {/* Spotlight Card */}
        <View style={styles.spotlightCard}>
          {/* Online/Offline Status Indicator */}
          <View style={styles.statusRow}>
            <Text style={styles.spotlightTitle}>Feature Spotlight</Text>
            <View style={[styles.statusBadge, isOnline ? styles.onlineBadge : styles.offlineBadge]}>
              <View style={[styles.statusDot, isOnline ? styles.onlineDot : styles.offlineDot]} />
              <Text style={[styles.statusBadgeText, isOnline ? styles.onlineBadgeText : styles.offlineBadgeText]}>
                {isOnline ? 'ONLINE' : 'OFFLINE'}
              </Text>
            </View>
          </View>

          {loading && !refreshing ? (
            <View style={styles.spotlightLoader}>
              <ActivityIndicator color="#00796B" size="small" />
              <Text style={styles.loaderText}>Syncing dashboard stats...</Text>
            </View>
          ) : (
            <View style={styles.spotlightContent}>
              {/* Target & Achievement Progress Bar */}
              <View style={styles.targetSection}>
                <View style={styles.targetHeadingRow}>
                  <Text style={styles.targetSectionTitle}>Monthly Sales Target</Text>
                  <Text style={styles.targetPercentText}>{achievementPercentage}%</Text>
                </View>

                {/* Progress Bar Container */}
                <View style={styles.progressBarBg}>
                  <View
                    style={[
                      styles.progressBarFill,
                      { width: `${Math.min(100, achievementPercentage)}%` },
                    ]}
                  />
                </View>

                <Text style={styles.targetProgressDetails}>
                  ₹{achievedAmount.toLocaleString('en-IN')} achieved (₹{pipelineAmount.toLocaleString('en-IN')} pipeline) of ₹{targetAmount.toLocaleString('en-IN')}
                </Text>

                {outstandingLimit > 0 ? (
                  <View style={styles.outstandingLimitWrap}>
                    <View style={styles.targetHeadingRow}>
                      <Text style={styles.targetSectionTitle}>Outstanding Limit</Text>
                      <Text style={styles.targetPercentText}>
                        {Math.min(100, Math.round((totalOutstanding / outstandingLimit) * 100 || 0))}%
                      </Text>
                    </View>
                    <View style={styles.outstandingLimitBg}>
                      <View
                        style={[
                          styles.outstandingLimitFill,
                          {
                            width: `${Math.min(100, (totalOutstanding / outstandingLimit) * 100 || 0)}%`,
                            backgroundColor: totalOutstanding > outstandingLimit ? '#E53E3E' : '#DD6B20',
                          },
                        ]}
                      />
                    </View>
                    <Text style={styles.targetProgressDetails}>
                      ₹{totalOutstanding.toLocaleString('en-IN')} used of ₹{outstandingLimit.toLocaleString('en-IN')}
                    </Text>
                  </View>
                ) : null}
              </View>

              <View style={styles.cardDivider} />

              {/* Total Outstanding Section */}
              <View style={styles.outstandingSection}>
                <View style={styles.outstandingHeaderRow}>
                  <Text style={styles.outstandingTitle}>Total Outstanding (Assigned Parties)</Text>
                  <TouchableOpacity
                    style={styles.eyeBtn}
                    onPress={onNavigateToOutstandingList}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.eyeIconText}>👁️</Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.outstandingValueText}>
                  ₹{totalOutstanding.toLocaleString('en-IN')}
                </Text>
              </View>

              <View style={styles.cardDivider} />

              {/* Today's Daily Stats Grid */}
              <View style={styles.statsGrid}>
                <View style={styles.gridCell}>
                  <Text style={styles.cellLabel}>Today's Orders</Text>
                  <Text style={styles.cellValue}>{todayOrderCount}</Text>
                </View>
                
                <View style={styles.gridCellDivider} />

                <View style={styles.gridCell}>
                  <Text style={styles.cellLabel}>Today's Value</Text>
                  <Text style={[styles.cellValue, { color: '#00796B' }]}>
                    ₹{todayOrderValue.toLocaleString('en-IN')}
                  </Text>
                </View>

                <View style={styles.gridCellDivider} />

                <View style={styles.gridCell}>
                  <Text style={styles.cellLabel}>Today's Visits</Text>
                  <Text style={styles.cellValue}>{todayVisitCount}</Text>
                </View>
              </View>
            </View>
          )}
        </View>

        {isCso && <View style={styles.actionsCard}>
          <Text style={styles.actionsCardTitle}>Team Performance Today</Text>
          <View style={styles.statsGrid}>
            <View style={styles.gridCell}><Text style={styles.cellLabel}>Members</Text><Text style={styles.cellValue}>{teamSummary.members}</Text></View>
            <View style={styles.gridCell}><Text style={styles.cellLabel}>Team Orders</Text><Text style={styles.cellValue}>{teamSummary.orders}</Text></View>
            <View style={styles.gridCell}><Text style={styles.cellLabel}>Team Sales</Text><Text style={styles.cellValue}>₹{teamSummary.sales.toLocaleString('en-IN')}</Text></View>
          </View>
          <Text style={{color:'#C05621',fontWeight:'700',marginTop:12}}>Team Outstanding: ₹{teamSummary.outstanding.toLocaleString('en-IN')}</Text>
          <TouchableOpacity style={{backgroundColor:'#00796B',padding:12,borderRadius:8,alignItems:'center',marginTop:12}} onPress={onNavigateToTeam}><Text style={{color:'#fff',fontWeight:'800'}}>Open My Team</Text></TouchableOpacity>
        </View>}

        {/* Quick Actions Container Card */}
        <View style={styles.actionsCard}>
          <Text style={styles.actionsCardTitle}>Quick Actions</Text>
          <View style={styles.actionsRow}>
            {/* Attendance Action Item */}
            <View style={styles.actionItem}>
              <TouchableOpacity
                style={[styles.circleBtn, styles.solidBtn]}
                onPress={onNavigateToAttendance}
              >
                <Text style={styles.solidIconText}>☝</Text>
              </TouchableOpacity>
              <Text style={styles.actionLabel}>Attendance</Text>
            </View>

            {/* Apply Leave Action Item */}
            <View style={styles.actionItem}>
              <TouchableOpacity
                style={[styles.circleBtn, styles.outlineBtn]}
                onPress={onNavigateToLeave}
              >
                <Text style={styles.outlineIconText}>📄</Text>
              </TouchableOpacity>
              <Text style={styles.actionLabel}>Apply Leave</Text>
            </View>

            {/* Party Action Item */}
            <View style={styles.actionItem}>
              <TouchableOpacity
                style={[styles.circleBtn, styles.outlineBtn]}
                onPress={onNavigateToParty}
              >
                <Text style={styles.outlineIconText}>👥</Text>
              </TouchableOpacity>
              <Text style={styles.actionLabel}>Party</Text>
            </View>

            {/* Price List Action Item */}
            <View style={styles.actionItem}>
              <TouchableOpacity
                style={[styles.circleBtn, styles.outlineBtn]}
                onPress={onNavigateToProducts}
              >
                <Text style={styles.outlineIconText}>📋</Text>
              </TouchableOpacity>
              <Text style={styles.actionLabel}>Price List</Text>
            </View>

            {isCso ? <View style={styles.actionItem}>
              <TouchableOpacity style={[styles.circleBtn, styles.outlineBtn]} onPress={onNavigateToBeatPlan}>
                <Text style={styles.outlineIconText}>↝</Text>
              </TouchableOpacity>
              <Text style={styles.actionLabel}>My Beat Plan</Text>
            </View> : <View style={styles.actionItem}>
              <TouchableOpacity style={[styles.circleBtn, styles.outlineBtn]} onPress={onNavigateToRoutePlanner}>
                <Text style={styles.outlineIconText}>⌖</Text>
              </TouchableOpacity>
              <Text style={styles.actionLabel}>Plan Route</Text>
            </View>}

            {/* Order Action Item */}
            <View style={styles.actionItem}>
              <TouchableOpacity
                style={[styles.circleBtn, styles.outlineBtn]}
                onPress={onNavigateToOrder}
              >
                <Text style={styles.outlineIconText}>📦</Text>
              </TouchableOpacity>
              <Text style={styles.actionLabel}>Create Order</Text>
            </View>

            {/* My Orders Action Item */}
            <View style={styles.actionItem}>
              <TouchableOpacity
                style={[styles.circleBtn, styles.outlineBtn]}
                onPress={onNavigateToOrderList}
              >
                <Text style={styles.outlineIconText}>📋</Text>
              </TouchableOpacity>
              <Text style={styles.actionLabel}>My Orders</Text>
            </View>
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
  container: {
    padding: 16,
    gap: 16,
  },

  // Spotlight card
  spotlightCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 18,
    shadowColor: '#1A202C',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.02,
    shadowRadius: 10,
    elevation: 1.5,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  spotlightTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#2D3748',
  },
  
  // Status Badge
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  onlineBadge: {
    backgroundColor: '#E6FFFA',
  },
  offlineBadge: {
    backgroundColor: '#EDF2F7',
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 6,
  },
  onlineDot: {
    backgroundColor: '#319795',
  },
  offlineDot: {
    backgroundColor: '#718096',
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: '800',
  },
  onlineBadgeText: {
    color: '#319795',
  },
  offlineBadgeText: {
    color: '#718096',
  },

  // Spotlight Content Loading state
  spotlightLoader: {
    paddingVertical: 20,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  loaderText: {
    fontSize: 12,
    color: '#718096',
    fontWeight: '600',
  },

  // Spotlight details content
  spotlightContent: {
    width: '100%',
  },

  // Target details
  targetSection: {
    marginBottom: 16,
  },
  targetHeadingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  targetSectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#718096',
  },
  targetPercentText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#00796B',
  },
  progressBarBg: {
    height: 8,
    backgroundColor: '#EDF2F7',
    borderRadius: 4,
    width: '100%',
    overflow: 'hidden',
    marginBottom: 6,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#00BFA5',
    borderRadius: 4,
  },
  targetProgressDetails: {
    fontSize: 11,
    color: '#4A5568',
    fontWeight: '600',
  },
  outstandingLimitWrap: {
    marginTop: 14,
  },
  outstandingLimitBg: {
    height: 8,
    backgroundColor: '#FEEBC8',
    borderRadius: 4,
    width: '100%',
    overflow: 'hidden',
    marginBottom: 6,
  },
  outstandingLimitFill: {
    height: '100%',
    borderRadius: 4,
  },

  cardDivider: {
    height: 1,
    backgroundColor: '#EDF2F7',
    marginBottom: 16,
  },

  // Today stats grid
  statsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  gridCell: {
    flex: 1,
    alignItems: 'center',
  },
  gridCellDivider: {
    width: 1,
    height: 24,
    backgroundColor: '#E2E8F0',
  },
  cellLabel: {
    fontSize: 10,
    color: '#A0AEC0',
    fontWeight: '700',
    marginBottom: 4,
  },
  cellValue: {
    fontSize: 13.5,
    fontWeight: '800',
    color: '#2D3748',
  },

  // Actions card
  actionsCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 16,
    shadowColor: '#1A202C',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.02,
    shadowRadius: 10,
    elevation: 1.5,
  },
  actionsCardTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#2D3748',
    marginBottom: 16,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  actionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  actionItem: {
    alignItems: 'center',
    width: '30%',
    marginBottom: 16,
  },
  circleBtn: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  solidBtn: {
    backgroundColor: '#00BFA5',
    shadowColor: '#00BFA5',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 2,
  },
  solidIconText: {
    fontSize: 24,
    color: '#FFFFFF',
    fontWeight: '600',
  },
  outlineBtn: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
  },
  outlineIconText: {
    fontSize: 20,
    color: '#4A5568',
  },
  actionLabel: {
    fontSize: 11,
    color: '#718096',
    fontWeight: '700',
  },

  // Banner carousel styles
  bannerContainer: {
    width: '100%',
    alignItems: 'center',
    marginTop: 6,
  },
  bannerScrollView: {
    width: bannerWidth,
    borderRadius: 16,
    overflow: 'hidden',
  },
  bannerCard: {
    width: bannerWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 20,
    borderRadius: 16,
    height: 112,
  },
  bannerTextContainer: {
    flex: 1,
    paddingRight: 10,
  },
  badgeWrapper: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    marginBottom: 6,
  },
  bannerBadge: {
    fontSize: 9,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  bannerTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  bannerDesc: {
    fontSize: 11.5,
    color: 'rgba(255, 255, 255, 0.85)',
    lineHeight: 15,
    fontWeight: '600',
  },
  bannerEmoji: {
    fontSize: 34,
  },
  dotsContainer: {
    flexDirection: 'row',
    marginTop: 10,
    gap: 6,
  },
  dot: {
    height: 6,
    borderRadius: 3,
  },
  activeDot: {
    width: 14,
    backgroundColor: '#00796B',
  },
  inactiveDot: {
    width: 6,
    backgroundColor: '#CBD5E0',
  },

  outstandingSection: {
    marginBottom: 2,
  },
  outstandingHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  eyeBtn: {
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  eyeIconText: {
    fontSize: 16,
    color: '#00796B',
  },
  outstandingTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#718096',
  },
  outstandingValueText: {
    fontSize: 20,
    fontWeight: '850',
    color: '#E53E3E',
    marginTop: 4,
  },
});
