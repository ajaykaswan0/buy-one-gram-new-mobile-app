import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ActivityIndicator,
  FlatList,
  RefreshControl,
  Alert,
  SafeAreaView,
} from 'react-native';
import { scale, verticalScale, responsiveFontSize, maxContainerWidth } from '../utils/responsive';

export default function NotificationScreen({ token, apiUrl, onBack, onClearBadge }) {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalRecords, setTotalRecords] = useState(0);

  // Expanded notification state
  const [expandedNotifications, setExpandedNotifications] = useState({});

  const toggleExpand = (id) => {
    setExpandedNotifications((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  // Fetch notifications
  const fetchNotifications = async (pageNum = 1, shouldAppend = false) => {
    if (pageNum === 1) {
      setLoading(true);
    } else {
      setLoadingMore(true);
    }

    try {
      const response = await fetch(`${apiUrl}/notification/my?page=${pageNum}&limit=15`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();

      if (response.ok && data.success) {
        if (shouldAppend) {
          setNotifications((prev) => [...prev, ...(data.data || [])]);
        } else {
          setNotifications(data.data || []);
        }
        setPage(data.page || pageNum);
        setTotalPages(data.totalPages || 1);
        setTotalRecords(data.totalRecords || 0);
      } else {
        Alert.alert('Error', data.message || 'Failed to load notifications');
      }
    } catch (e) {
      console.warn('Fetch notifications error:', e.message);
      Alert.alert('Error', 'Network error loading notifications');
    } finally {
      setLoading(false);
      setLoadingMore(false);
      setRefreshing(false);
    }
  };

  // Mark all as read on mount
  const markNotificationsAsRead = async () => {
    try {
      const response = await fetch(`${apiUrl}/notification/read-all`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        onClearBadge && onClearBadge();
      }
    } catch (e) {
      console.warn('Failed to mark all as read:', e.message);
    }
  };

  useEffect(() => {
    fetchNotifications(1, false);
    markNotificationsAsRead();
  }, []);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchNotifications(1, false);
    markNotificationsAsRead();
  }, []);

  const loadMore = () => {
    if (page < totalPages && !loadingMore) {
      fetchNotifications(page + 1, true);
    }
  };

  const renderNotificationItem = ({ item }) => {
    const isExpanded = !!expandedNotifications[item._id];
    const dateStr = new Date(item.createdAt).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    return (
      <TouchableOpacity
        style={[styles.notificationCard, !item.isRead && styles.unreadCard]}
        activeOpacity={0.8}
        onPress={() => toggleExpand(item._id)}
      >
        <View style={styles.cardHeader}>
          <Text style={styles.notificationTitle}>{item.title}</Text>
          {!item.isRead && <View style={styles.unreadDot} />}
        </View>
        <Text
          style={styles.notificationMessage}
          numberOfLines={isExpanded ? undefined : 2}
        >
          {item.message}
        </Text>
        <View style={styles.cardFooter}>
          <Text style={styles.notificationDate}>{dateStr}</Text>
          <Text style={styles.expandHintText}>
            {isExpanded ? 'Tap to collapse ▲' : 'Tap to expand ▼'}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Top Bar */}
      <View style={styles.topBar}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Text style={styles.backBtnText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.topBarTitle}>Notifications</Text>
        <View style={{ width: 36 }} />
      </View>

      {/* Notifications List */}
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#00796B" />
          <Text style={styles.loadingText}>Loading Notifications...</Text>
        </View>
      ) : (
        <FlatList
          data={notifications}
          keyExtractor={(item) => item._id}
          renderItem={renderNotificationItem}
          contentContainerStyle={styles.listContainer}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#00796B']} />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyIcon}>🔔</Text>
              <Text style={styles.emptyTitle}>No Notifications</Text>
              <Text style={styles.emptyDesc}>You are all caught up!</Text>
            </View>
          }
          ListFooterComponent={
            page < totalPages ? (
              <TouchableOpacity
                style={styles.loadMoreBtn}
                disabled={loadingMore}
                onPress={loadMore}
              >
                {loadingMore ? (
                  <ActivityIndicator color="#00796B" size="small" />
                ) : (
                  <Text style={styles.loadMoreText}>Load More</Text>
                )}
              </TouchableOpacity>
            ) : notifications.length > 0 ? (
              <Text style={styles.noMoreText}>Showing all notifications</Text>
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

  // List Container
  listContainer: {
    padding: scale(16),
    gap: verticalScale(12),
  },

  // Notification Card
  notificationCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: scale(16),
    shadowColor: '#1A202C',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.02,
    shadowRadius: 6,
    elevation: 1,
  },
  unreadCard: {
    borderColor: '#00BFA5',
    borderWidth: 1.5,
    backgroundColor: '#E6FFFA',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: verticalScale(6),
  },
  notificationTitle: {
    fontSize: responsiveFontSize(15),
    fontWeight: '750',
    color: '#2D3748',
    flex: 1,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#00BFA5',
    marginLeft: scale(10),
  },
  notificationMessage: {
    fontSize: responsiveFontSize(13.5),
    color: '#4A5568',
    lineHeight: 18,
    marginBottom: verticalScale(8),
  },
  notificationDate: {
    fontSize: responsiveFontSize(11),
    color: '#A0AEC0',
    fontWeight: '650',
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
  noMoreText: {
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
    paddingVertical: verticalScale(80),
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
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: verticalScale(4),
  },
  expandHintText: {
    fontSize: responsiveFontSize(11),
    color: '#A0AEC0',
    fontWeight: '700',
  },
});
