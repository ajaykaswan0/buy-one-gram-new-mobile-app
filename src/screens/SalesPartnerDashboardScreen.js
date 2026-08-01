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
  FlatList,
} from 'react-native';

export default function SalesPartnerDashboardScreen({
  token,
  apiUrl,
  user,
  onLogout,
  onNavigateToParty,
  onNavigateToOrder,
  onNavigateToOrderList,
  onNavigateToProducts,
  onNavigateToRoutePlanner,
}) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Sales Partner Analytics States
  const [monthlySalesVolume, setMonthlySalesVolume] = useState(0);
  const [totalOrdersCount, setTotalOrdersCount] = useState(0);
  const [assignedPartiesCount, setAssignedPartiesCount] = useState(0);

  // Recent Partner Orders List
  const [recentOrders, setRecentOrders] = useState([]);

  const fetchPartnerDashboardData = async () => {
    if (!token || !apiUrl) return;

    try {
      // 1. Fetch Partner's Assigned Parties to compute Total Outstanding & Count
      const partiesRes = await fetch(`${apiUrl}/parties/my?limit=300`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const partiesData = await partiesRes.json();
      if (partiesRes.ok && Array.isArray(partiesData.data)) {
        setAssignedPartiesCount(partiesData.data.length);
      }

      // Orders are already scoped by backend to this role's assigned parties.
      const ordersRes = await fetch(`${apiUrl}/order/my?limit=100`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const ordersData = await ordersRes.json();
      if (ordersRes.ok && Array.isArray(ordersData.data)) {
        const ordersList = ordersData.data;
        setTotalOrdersCount(ordersList.length);
        setRecentOrders(ordersList.slice(0, 5));

        const monthStart = new Date();
        monthStart.setDate(1);
        monthStart.setHours(0, 0, 0, 0);
        const salesSum = ordersList
          .filter((ord) => new Date(ord.createdAt) >= monthStart)
          .reduce(
          (sum, ord) => sum + (ord.grandTotal || ord.totalAmount || 0),
          0
          );
        setMonthlySalesVolume(salesSum);
      }
    } catch (err) {
      console.log('[SalesPartnerDashboard] Error fetching analytics:', err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchPartnerDashboardData();
  }, [token, apiUrl]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchPartnerDashboardData();
  }, [token, apiUrl]);

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Top Partner App Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>🤝 Sales Partner Console</Text>
          <Text style={styles.headerSubtitle}>
            Welcome, {user?.name || 'Partner Account'}
          </Text>
        </View>
        {onLogout ? (
          <TouchableOpacity style={styles.logoutBtn} onPress={onLogout}>
            <Text style={styles.logoutBtnText}>Logout</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#2B6CB0']} />
        }
      >
        {/* Total Sales Volume Hero Banner */}
        <View style={styles.salesHeroCard}>
          <Text style={styles.salesHeroTag}>📈 TOTAL PARTNER SALES VOLUME</Text>
          <Text style={styles.salesHeroValue}>
            ₹{monthlySalesVolume.toLocaleString('en-IN')}
          </Text>
          <Text style={styles.salesHeroSubText}>
            This month across {totalOrdersCount} orders from {assignedPartiesCount} assigned parties
          </Text>
        </View>

        {/* 3-Column Financial Summary Cards */}
        <View style={styles.statsRow}>
          <View style={[styles.statBox, { borderLeftColor: '#3182CE' }]}>
            <Text style={styles.statBoxLabel}>Parties</Text>
            <Text style={styles.statBoxValue}>{assignedPartiesCount}</Text>
          </View>

          <View style={[styles.statBox, { borderLeftColor: '#38A169' }]}>
            <Text style={styles.statBoxLabel}>This Month Sale</Text>
            <Text style={[styles.statBoxValue, { color: '#276749' }]}>
              ₹{monthlySalesVolume.toLocaleString('en-IN')}
            </Text>
          </View>

          <View style={[styles.statBox, { borderLeftColor: '#DD6B20' }]}>
            <Text style={styles.statBoxLabel}>Orders</Text>
            <Text style={[styles.statBoxValue, { color: '#C05621' }]}>
              {totalOrdersCount}
            </Text>
          </View>
        </View>

        {/* Partner Quick Action Grid */}
        <Text style={styles.sectionTitle}>⚡ Quick Partner Actions</Text>
        <View style={styles.actionGrid}>
          {/* Create Order */}
          <TouchableOpacity
            style={styles.actionCard}
            onPress={onNavigateToOrder}
            activeOpacity={0.8}
          >
            <View style={[styles.actionIconCircle, { backgroundColor: '#EBF8FF' }]}>
              <Text style={{ fontSize: 24 }}>📦</Text>
            </View>
            <Text style={styles.actionCardTitle}>Create Order</Text>
            <Text style={styles.actionCardSub}>Place order for assigned party</Text>
          </TouchableOpacity>

          {/* My Parties */}
          <TouchableOpacity
            style={styles.actionCard}
            onPress={onNavigateToParty}
            activeOpacity={0.8}
          >
            <View style={[styles.actionIconCircle, { backgroundColor: '#E6FFFA' }]}>
              <Text style={{ fontSize: 24 }}>🏬</Text>
            </View>
            <Text style={styles.actionCardTitle}>My Parties</Text>
            <Text style={styles.actionCardSub}>View parties & profiles</Text>
          </TouchableOpacity>

          {/* Orders History */}
          <TouchableOpacity
            style={styles.actionCard}
            onPress={onNavigateToOrderList}
            activeOpacity={0.8}
          >
            <View style={[styles.actionIconCircle, { backgroundColor: '#FEEBC8' }]}>
              <Text style={{ fontSize: 24 }}>📋</Text>
            </View>
            <Text style={styles.actionCardTitle}>Orders History</Text>
            <Text style={styles.actionCardSub}>Track orders & status</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionCard}
            onPress={onNavigateToRoutePlanner}
            activeOpacity={0.8}
          >
            <View style={[styles.actionIconCircle, { backgroundColor: '#FFF5F5' }]}>
              <Text style={{ fontSize: 24 }}>🗺️</Text>
            </View>
            <Text style={styles.actionCardTitle}>Route Plan</Text>
            <Text style={styles.actionCardSub}>Plan route for your parties</Text>
          </TouchableOpacity>

          {/* Product Price List */}
          <TouchableOpacity
            style={styles.actionCard}
            onPress={onNavigateToProducts}
            activeOpacity={0.8}
          >
            <View style={[styles.actionIconCircle, { backgroundColor: '#FAF5FF' }]}>
              <Text style={{ fontSize: 24 }}>🏷️</Text>
            </View>
            <Text style={styles.actionCardTitle}>Rate List</Text>
            <Text style={styles.actionCardSub}>View catalog & prices</Text>
          </TouchableOpacity>
        </View>

        {/* Recent Orders Section */}
        <View style={styles.recentHeaderRow}>
          <Text style={styles.sectionTitle}>📋 Recent Partner Orders</Text>
          <TouchableOpacity onPress={onNavigateToOrderList}>
            <Text style={styles.viewAllText}>View All →</Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <ActivityIndicator color="#2B6CB0" style={{ marginVertical: 30 }} />
        ) : recentOrders.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={{ fontSize: 32, marginBottom: 6 }}>📦</Text>
            <Text style={styles.emptyTitle}>No Orders Placed Yet</Text>
            <Text style={styles.emptySub}>
              Orders placed for your assigned parties will appear here.
            </Text>
          </View>
        ) : (
          recentOrders.map((ord) => (
            <View key={ord._id} style={styles.orderCard}>
              <View style={styles.orderCardHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.orderNo}>{ord.orderNumber}</Text>
                  <Text style={styles.orderPartyName}>
                    👤 {ord.partyId?.partyName || 'Customer Party'}
                  </Text>
                </View>
                <Text style={styles.orderValue}>
                  ₹{(ord.grandTotal || ord.totalAmount || 0).toLocaleString('en-IN')}
                </Text>
              </View>
              <View style={styles.orderCardFooter}>
                <Text style={styles.orderStatus}>
                  Status: <Text style={styles.boldStatus}>{(ord.status || 'pending').toUpperCase()}</Text>
                </Text>
                <Text style={styles.orderDate}>
                  {new Date(ord.createdAt).toLocaleDateString()}
                </Text>
              </View>
            </View>
          ))
        )}
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#2B6CB0', // Deep partner blue
  },
  headerTitle: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: '800',
  },
  headerSubtitle: {
    color: '#EBF8FF',
    fontSize: 12,
    marginTop: 2,
  },
  logoutBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  logoutBtnText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '700',
  },
  container: {
    padding: 16,
  },
  salesHeroCard: {
    backgroundColor: '#2B6CB0',
    borderRadius: 14,
    padding: 18,
    marginBottom: 16,
    shadowColor: '#2B6CB0',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  salesHeroTag: {
    color: '#BEE3F8',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  salesHeroValue: {
    color: '#FFF',
    fontSize: 28,
    fontWeight: '900',
    marginVertical: 4,
  },
  salesHeroSubText: {
    color: '#EBF8FF',
    fontSize: 12,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 18,
  },
  statBox: {
    flex: 1,
    backgroundColor: '#FFF',
    borderRadius: 10,
    padding: 12,
    borderLeftWidth: 4,
    elevation: 1,
  },
  statBoxLabel: {
    fontSize: 11,
    color: '#718096',
    fontWeight: '600',
  },
  statBoxValue: {
    fontSize: 15,
    fontWeight: '800',
    color: '#1A202C',
    marginTop: 4,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#2D3748',
    marginBottom: 12,
  },
  actionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 20,
  },
  actionCard: {
    width: '48%',
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: 14,
    elevation: 2,
  },
  actionIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  actionCardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1A202C',
  },
  actionCardSub: {
    fontSize: 11,
    color: '#718096',
    marginTop: 2,
  },
  recentHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  viewAllText: {
    color: '#2B6CB0',
    fontSize: 13,
    fontWeight: '700',
  },
  emptyCard: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
    marginVertical: 10,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#2D3748',
  },
  emptySub: {
    fontSize: 12,
    color: '#718096',
    textAlign: 'center',
    marginTop: 4,
  },
  orderCard: {
    backgroundColor: '#FFF',
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
    elevation: 1,
  },
  orderCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  orderNo: {
    fontSize: 14,
    fontWeight: '700',
    color: '#2B6CB0',
  },
  orderPartyName: {
    fontSize: 12,
    color: '#4A5568',
    marginTop: 2,
  },
  orderValue: {
    fontSize: 15,
    fontWeight: '800',
    color: '#2B6CB0',
  },
  orderCardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#EDF2F7',
  },
  orderStatus: {
    fontSize: 11,
    color: '#718096',
  },
  boldStatus: {
    fontWeight: '700',
    color: '#2D3748',
  },
  orderDate: {
    fontSize: 11,
    color: '#A0AEC0',
  },
});
