import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  SafeAreaView,
  FlatList,
  RefreshControl,
  Alert,
} from 'react-native';
import { scale, verticalScale, responsiveFontSize, maxContainerWidth } from '../utils/responsive';

const STATUS_OPTIONS = [
  { label: 'All Statuses', value: '' },
  { label: 'Draft', value: 'draft' },
  { label: 'Confirmed', value: 'confirmed' },
  { label: 'Packed', value: 'packed' },
  { label: 'Dispatched', value: 'dispatched' },
  { label: 'Delivered', value: 'delivered' },
  { label: 'Cancelled', value: 'cancelled' },
];

export default function OrderListScreen({ token, apiUrl, onBack }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  
  // Filtering & Pagination states
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('');
  const [dateTab, setDateTab] = useState('all'); // 'today' | 'yesterday' | 'all'
  
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalRecords, setTotalRecords] = useState(0);

  // Keep track of expanded order IDs
  const [expandedOrders, setExpandedOrders] = useState({});

  // Debouncing search
  const typingTimeoutRef = useRef(null);

  // Calculate Date Ranges
  const getDateRange = (tab) => {
    if (tab === 'today') {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const end = new Date();
      end.setHours(23, 59, 59, 999);
      return { startDate: start.toISOString(), endDate: end.toISOString() };
    } else if (tab === 'yesterday') {
      const start = new Date();
      start.setDate(start.getDate() - 1);
      start.setHours(0, 0, 0, 0);
      const end = new Date();
      end.setDate(end.getDate() - 1);
      end.setHours(23, 59, 59, 999);
      return { startDate: start.toISOString(), endDate: end.toISOString() };
    }
    return { startDate: '', endDate: '' };
  };

  // Fetch orders from API
  const fetchOrders = async (pageNum = 1, shouldAppend = false) => {
    if (pageNum === 1) {
      setLoading(true);
    } else {
      setLoadingMore(true);
    }

    try {
      const { startDate, endDate } = getDateRange(dateTab);
      let queryUrl = `${apiUrl}/order/my?page=${pageNum}&limit=10`;

      if (searchQuery.trim()) {
        queryUrl += `&search=${encodeURIComponent(searchQuery.trim())}`;
      }
      if (selectedStatus) {
        queryUrl += `&status=${selectedStatus}`;
      }
      if (startDate) {
        queryUrl += `&startDate=${startDate}`;
      }
      if (endDate) {
        queryUrl += `&endDate=${endDate}`;
      }

      const response = await fetch(queryUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();

      if (response.ok && data.success) {
        if (shouldAppend) {
          setOrders((prev) => [...prev, ...(data.data || [])]);
        } else {
          setOrders(data.data || []);
        }
        setPage(data.page || pageNum);
        setTotalPages(data.totalPages || 1);
        setTotalRecords(data.totalRecords || 0);
      } else {
        Alert.alert('Error', data.message || 'Failed to fetch orders');
      }
    } catch (e) {
      console.warn('Fetch orders error:', e.message);
      Alert.alert('Network Error', 'Could not load orders.');
    } finally {
      setLoading(false);
      setLoadingMore(false);
      setRefreshing(false);
    }
  };

  // Trigger initial load and updates when filters change
  useEffect(() => {
    fetchOrders(1, false);
  }, [selectedStatus, dateTab]);

  // Handle Search Input Change with Debounce
  const handleSearchChange = (text) => {
    setSearchQuery(text);
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    typingTimeoutRef.current = setTimeout(() => {
      fetchOrders(1, false);
    }, 500);
  };

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchOrders(1, false);
  }, [searchQuery, selectedStatus, dateTab]);

  const loadMoreOrders = () => {
    if (page < totalPages && !loadingMore) {
      fetchOrders(page + 1, true);
    }
  };

  const toggleExpandOrder = (orderId) => {
    setExpandedOrders((prev) => ({
      ...prev,
      [orderId]: !prev[orderId],
    }));
  };

  // Get status color tone
  const getStatusStyle = (status) => {
    switch (status) {
      case 'draft':
        return { bg: '#EDF2F7', text: '#4A5568' };
      case 'confirmed':
        return { bg: '#EBF8FF', text: '#2B6CB0' };
      case 'packed':
        return { bg: '#FEFCBF', text: '#975A16' };
      case 'dispatched':
        return { bg: '#EBF4FF', text: '#1A365D' };
      case 'delivered':
        return { bg: '#C6F6D5', text: '#22543D' };
      case 'cancelled':
        return { bg: '#FED7D7', text: '#9B2C2C' };
      default:
        return { bg: '#EDF2F7', text: '#4A5568' };
    }
  };

  const renderOrderItem = ({ item }) => {
    const isExpanded = !!expandedOrders[item._id];
    const statusTone = getStatusStyle(item.status);
    const dateStr = new Date(item.createdAt).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    return (
      <View style={styles.orderCard}>
        {/* Card Header clickable to expand */}
        <TouchableOpacity
          style={styles.cardHeader}
          activeOpacity={0.7}
          onPress={() => toggleExpandOrder(item._id)}
        >
          <View style={styles.headerLeft}>
            <Text style={styles.orderNumber}>{item.orderNumber}</Text>
            <Text style={styles.orderDate}>{dateStr}</Text>
          </View>
          <View style={styles.headerRight}>
            <View style={[styles.statusBadge, { backgroundColor: statusTone.bg }]}>
              <Text style={[styles.statusText, { color: statusTone.text }]}>
                {item.status?.toUpperCase()}
              </Text>
            </View>
            <Text style={styles.grandTotal}>₹{item.grandTotal?.toFixed(2)}</Text>
          </View>
        </TouchableOpacity>

        {/* Short info (Customer Name) */}
        <View style={styles.partyContainer}>
          <Text style={styles.partyName} numberOfLines={1}>
            👤 {item.partyId?.partyName || 'Unknown Customer'}
          </Text>
          <Text style={styles.expandHint}>
            {isExpanded ? 'Tap to collapse ▲' : 'Tap to expand details ▼'}
          </Text>
        </View>

        {/* Expanded Order Details */}
        {isExpanded && (
          <View style={styles.expandedContent}>
            <View style={styles.divider} />
            
            {/* Items list header */}
            <Text style={styles.detailsTitle}>Items Ordered</Text>
            {(item.items || []).map((subItem, index) => (
              <View key={index} style={styles.itemRow}>
                <View style={{ flex: 1.8 }}>
                  <Text style={styles.itemName}>{subItem.productName}</Text>
                  <Text style={styles.itemVariant}>
                    {subItem.variantName} • {subItem.packSize}
                  </Text>
                </View>
                <Text style={styles.itemQty}>Qty: {subItem.quantity}</Text>
                <Text style={styles.itemPrice}>₹{subItem.rate?.toFixed(2)}</Text>
              </View>
            ))}

            <View style={styles.divider} />

            {/* Calculations */}
            <View style={styles.calcRow}>
              <Text style={styles.calcLabel}>Sub Total</Text>
              <Text style={styles.calcValue}>₹{item.subtotal?.toFixed(2)}</Text>
            </View>
            <View style={styles.calcRow}>
              <Text style={styles.calcLabel}>GST Tax</Text>
              <Text style={styles.calcValue}>₹{item.gstAmount?.toFixed(2)}</Text>
            </View>
            <View style={[styles.calcRow, styles.finalCalcRow]}>
              <Text style={styles.finalCalcLabel}>Net Total</Text>
              <Text style={styles.finalCalcValue}>₹{item.grandTotal?.toFixed(2)}</Text>
            </View>

            {/* Notes and details */}
            {item.remarks ? (
              <View style={styles.remarksBlock}>
                <Text style={styles.remarksTitle}>Remarks / Notes</Text>
                <Text style={styles.remarksContent}>{item.remarks}</Text>
              </View>
            ) : null}
          </View>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Top Bar */}
      <View style={styles.topBar}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Text style={styles.backBtnText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.topBarTitle}>My Orders</Text>
        <View style={{ width: 36 }} />
      </View>

      {/* Search Input */}
      <View style={styles.searchContainer}>
        <View style={styles.searchBox}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Search by order ID or party name..."
            placeholderTextColor="#A0AEC0"
            value={searchQuery}
            onChangeText={handleSearchChange}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => handleSearchChange('')}>
              <Text style={styles.clearSearch}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Date Range Tabs */}
      <View style={styles.tabsContainer}>
        <TouchableOpacity
          style={[styles.tabBtn, dateTab === 'today' && styles.tabBtnActive]}
          onPress={() => setDateTab('today')}
        >
          <Text style={[styles.tabBtnText, dateTab === 'today' && styles.tabBtnTextActive]}>
            Today
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabBtn, dateTab === 'yesterday' && styles.tabBtnActive]}
          onPress={() => setDateTab('yesterday')}
        >
          <Text style={[styles.tabBtnText, dateTab === 'yesterday' && styles.tabBtnTextActive]}>
            Yesterday
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabBtn, dateTab === 'all' && styles.tabBtnActive]}
          onPress={() => setDateTab('all')}
        >
          <Text style={[styles.tabBtnText, dateTab === 'all' && styles.tabBtnTextActive]}>
            All
          </Text>
        </TouchableOpacity>
      </View>

      {/* Status Filter Badges (Horizontal scroll list) */}
      <View style={styles.statusFiltersWrapper}>
        <FlatList
          data={STATUS_OPTIONS}
          horizontal
          showsHorizontalScrollIndicator={false}
          keyExtractor={(item) => item.value}
          contentContainerStyle={styles.statusFiltersList}
          renderItem={({ item }) => {
            const isSelected = selectedStatus === item.value;
            return (
              <TouchableOpacity
                style={[
                  styles.statusFilterBadge,
                  isSelected && styles.statusFilterBadgeActive,
                ]}
                onPress={() => setSelectedStatus(item.value)}
              >
                <Text
                  style={[
                    styles.statusFilterText,
                    isSelected && styles.statusFilterTextActive,
                  ]}
                >
                  {item.label}
                </Text>
              </TouchableOpacity>
            );
          }}
        />
      </View>

      {/* Orders List */}
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#00796B" />
          <Text style={styles.loadingText}>Fetching your orders...</Text>
        </View>
      ) : (
        <FlatList
          data={orders}
          keyExtractor={(item) => item._id}
          renderItem={renderOrderItem}
          contentContainerStyle={styles.ordersList}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#00796B']} />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyIcon}>📋</Text>
              <Text style={styles.emptyTitle}>No Orders Found</Text>
              <Text style={styles.emptyDesc}>
                We couldn't find any orders matching the filters.
              </Text>
            </View>
          }
          ListFooterComponent={
            page < totalPages ? (
              <TouchableOpacity
                style={styles.loadMoreBtn}
                disabled={loadingMore}
                onPress={loadMoreOrders}
              >
                {loadingMore ? (
                  <ActivityIndicator color="#00796B" size="small" />
                ) : (
                  <Text style={styles.loadMoreText}>Load More Orders</Text>
                )}
              </TouchableOpacity>
            ) : orders.length > 0 ? (
              <Text style={styles.noMoreOrders}>Showing all {totalRecords} orders</Text>
            ) : null
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F7F9FC',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F7F9FC',
  },
  loadingText: {
    marginTop: verticalScale(12),
    fontSize: responsiveFontSize(14),
    color: '#718096',
    fontWeight: '600',
  },

  // Top Bar
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: scale(16),
    paddingVertical: verticalScale(12),
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  backBtn: {
    width: scale(36),
    height: verticalScale(36),
    borderRadius: 18,
    backgroundColor: '#F7F9FC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backBtnText: {
    fontSize: responsiveFontSize(20),
    color: '#2D3748',
    fontWeight: '600',
  },
  topBarTitle: {
    fontSize: responsiveFontSize(18),
    fontWeight: '700',
    color: '#1A202C',
  },

  // Search
  searchContainer: {
    paddingHorizontal: scale(16),
    paddingVertical: verticalScale(8),
    backgroundColor: '#FFFFFF',
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F7F9FC',
    borderRadius: 10,
    paddingHorizontal: scale(12),
    height: verticalScale(40),
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  searchIcon: {
    fontSize: responsiveFontSize(15),
    marginRight: scale(6),
  },
  searchInput: {
    flex: 1,
    fontSize: responsiveFontSize(13.5),
    color: '#2D3748',
    paddingVertical: 0,
  },
  clearSearch: {
    fontSize: responsiveFontSize(15),
    color: '#A0AEC0',
    paddingLeft: scale(6),
  },

  // Tabs
  tabsContainer: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: scale(16),
    paddingVertical: verticalScale(8),
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    gap: verticalScale(8),
  },
  tabBtn: {
    flex: 1,
    paddingVertical: verticalScale(8),
    borderRadius: 8,
    backgroundColor: '#F7F9FC',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  tabBtnActive: {
    backgroundColor: '#00796B',
    borderColor: '#00796B',
  },
  tabBtnText: {
    fontSize: responsiveFontSize(13),
    fontWeight: '700',
    color: '#718096',
  },
  tabBtnTextActive: {
    color: '#FFFFFF',
  },

  // Status Filter scroll list
  statusFiltersWrapper: {
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    paddingVertical: verticalScale(8),
  },
  statusFiltersList: {
    paddingHorizontal: scale(16),
    gap: verticalScale(8),
  },
  statusFilterBadge: {
    paddingHorizontal: scale(12),
    paddingVertical: verticalScale(6),
    borderRadius: 14,
    backgroundColor: '#F0F4F8',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  statusFilterBadgeActive: {
    backgroundColor: '#00BFA5',
    borderColor: '#00BFA5',
  },
  statusFilterText: {
    fontSize: responsiveFontSize(12),
    fontWeight: '700',
    color: '#718096',
  },
  statusFilterTextActive: {
    color: '#FFFFFF',
  },

  // Orders List
  ordersList: {
    padding: scale(16),
    gap: verticalScale(12),
  },

  // Order Card
  orderCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    overflow: 'hidden',
    shadowColor: '#1A202C',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.02,
    shadowRadius: 6,
    elevation: 1,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: scale(14),
    backgroundColor: '#FAFBFD',
  },
  headerLeft: {
    flex: 1.2,
  },
  orderNumber: {
    fontSize: responsiveFontSize(15),
    fontWeight: '800',
    color: '#2D3748',
  },
  orderDate: {
    fontSize: responsiveFontSize(11.5),
    color: '#A0AEC0',
    marginTop: verticalScale(4),
    fontWeight: '600',
  },
  headerRight: {
    flex: 1,
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  statusBadge: {
    paddingHorizontal: scale(8),
    paddingVertical: verticalScale(3),
    borderRadius: 6,
    marginBottom: verticalScale(4),
  },
  statusText: {
    fontSize: responsiveFontSize(10),
    fontWeight: '800',
  },
  grandTotal: {
    fontSize: responsiveFontSize(15),
    fontWeight: '800',
    color: '#00796B',
  },
  partyContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: scale(14),
    paddingBottom: verticalScale(12),
  },
  partyName: {
    fontSize: responsiveFontSize(13),
    fontWeight: '700',
    color: '#4A5568',
    flex: 1,
  },
  expandHint: {
    fontSize: responsiveFontSize(11),
    color: '#A0AEC0',
    fontWeight: '600',
  },

  // Expanded Content
  expandedContent: {
    paddingHorizontal: scale(14),
    paddingBottom: verticalScale(14),
    backgroundColor: '#FFFFFF',
  },
  divider: {
    height: 1,
    backgroundColor: '#EDF2F7',
    marginVertical: verticalScale(10),
  },
  detailsTitle: {
    fontSize: responsiveFontSize(12),
    fontWeight: '850',
    color: '#718096',
    textTransform: 'uppercase',
    marginBottom: verticalScale(8),
  },
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: verticalScale(6),
    borderBottomWidth: 1,
    borderBottomColor: '#F7FAFC',
  },
  itemName: {
    fontSize: responsiveFontSize(13),
    fontWeight: '700',
    color: '#2D3748',
  },
  itemVariant: {
    fontSize: responsiveFontSize(11),
    color: '#A0AEC0',
    marginTop: 1,
  },
  itemQty: {
    fontSize: responsiveFontSize(12),
    color: '#4A5568',
    fontWeight: '700',
    marginHorizontal: scale(10),
  },
  itemPrice: {
    fontSize: responsiveFontSize(12),
    fontWeight: '700',
    color: '#2D3748',
  },

  // Calculations
  calcRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: verticalScale(4),
  },
  calcLabel: {
    fontSize: responsiveFontSize(12.5),
    color: '#718096',
  },
  calcValue: {
    fontSize: responsiveFontSize(12.5),
    color: '#2D3748',
    fontWeight: '600',
  },
  finalCalcRow: {
    borderTopWidth: 1,
    borderTopColor: '#EDF2F7',
    paddingTop: verticalScale(6),
    marginTop: verticalScale(4),
  },
  finalCalcLabel: {
    fontSize: responsiveFontSize(13.5),
    fontWeight: '800',
    color: '#1A202C',
  },
  finalCalcValue: {
    fontSize: responsiveFontSize(14.5),
    fontWeight: '800',
    color: '#00796B',
  },

  // Remarks
  remarksBlock: {
    marginTop: verticalScale(12),
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    padding: scale(10),
    borderWidth: 1,
    borderColor: '#EDF2F7',
  },
  remarksTitle: {
    fontSize: responsiveFontSize(11.5),
    fontWeight: '800',
    color: '#718096',
    textTransform: 'uppercase',
  },
  remarksContent: {
    fontSize: responsiveFontSize(12),
    color: '#4A5568',
    marginTop: verticalScale(4),
    lineHeight: 16,
  },

  // Pagination Load More
  loadMoreBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: verticalScale(12),
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginTop: verticalScale(10),
    marginBottom: verticalScale(20),
  },
  loadMoreText: {
    fontSize: responsiveFontSize(13.5),
    fontWeight: '700',
    color: '#00796B',
  },
  noMoreOrders: {
    textAlign: 'center',
    color: '#A0AEC0',
    fontSize: responsiveFontSize(12),
    fontWeight: '600',
    marginTop: verticalScale(10),
    marginBottom: verticalScale(20),
  },

  // Empty State
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: verticalScale(60),
  },
  emptyIcon: {
    fontSize: responsiveFontSize(48),
    marginBottom: verticalScale(16),
    opacity: 0.5,
  },
  emptyTitle: {
    fontSize: responsiveFontSize(18),
    fontWeight: '700',
    color: '#2D3748',
    marginBottom: verticalScale(6),
  },
  emptyDesc: {
    fontSize: responsiveFontSize(13),
    color: '#718096',
    textAlign: 'center',
    paddingHorizontal: scale(30),
  },
});
