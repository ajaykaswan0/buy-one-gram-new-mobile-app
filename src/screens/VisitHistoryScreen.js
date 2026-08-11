import React, { useState, useEffect, useRef } from 'react';
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
import { scale, verticalScale, responsiveFontSize, maxContainerWidth } from '../utils/responsive';

export default function VisitHistoryScreen({ token, apiUrl, user }) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [visits, setVisits] = useState([]);
  const [summary, setSummary] = useState(null);

  // Default to today's date in local timezone YYYY-MM-DD
  const getLocalDateString = (date) => {
    const offset = date.getTimezoneOffset();
    const localDate = new Date(date.getTime() - offset * 60 * 1000);
    return localDate.toISOString().split('T')[0];
  };

  const todayStr = getLocalDateString(new Date());
  const [selectedDate, setSelectedDate] = useState(todayStr);

  const flatListRef = useRef(null);

  // Generate last 15 days for horizontal selector
  const generateDateSelectorItems = () => {
    const items = [];
    const baseDate = new Date();
    for (let i = 14; i >= 0; i--) {
      const d = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate() - i);
      const dateStr = getLocalDateString(d);
      const isToday = dateStr === todayStr;
      
      const dayLabel = d.toLocaleDateString('en-IN', { weekday: 'short' }); // Mon, Tue...
      const dateNum = d.getDate(); // 15, 16...
      const monthLabel = d.toLocaleDateString('en-IN', { month: 'short' }); // Jul, Aug...

      items.push({
        dateStr,
        dayLabel,
        dateNum,
        monthLabel,
        isToday,
      });
    }
    return items;
  };

  const dateItems = generateDateSelectorItems();

  const fetchVisits = async (dateParam = selectedDate) => {
    if (!token || !user) return;
    setLoading(true);

    try {
      const response = await fetch(`${apiUrl}/visit/salesman/${user._id || user.id}?date=${dateParam}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();

      if (response.ok && data.success) {
        setVisits(data.data || []);
        setSummary(data.summary || null);
      } else {
        setVisits([]);
        setSummary(null);
      }
    } catch (e) {
      console.warn('Fetch visits history error:', e.message);
      setVisits([]);
      setSummary(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchVisits(selectedDate);
  }, [selectedDate, apiUrl, token]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchVisits(selectedDate);
  };

  const handleSelectDate = (dateStr) => {
    setSelectedDate(dateStr);
  };

  // Scroll to end of date list on mount so today is visible
  useEffect(() => {
    setTimeout(() => {
      flatListRef.current?.scrollToEnd({ animated: true });
    }, 200);
  }, []);

  const formatTime = (timeStr) => {
    if (!timeStr) return '—';
    const d = new Date(timeStr);
    return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'visited': return '#38A169';
      case 'short_visit': return '#D69E2E';
      case 'ongoing': return '#3182CE';
      case 'not_visited': return '#E53E3E';
      default: return '#718096';
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Top Header */}
      <View style={styles.topHeader}>
        <Text style={styles.topHeaderTitle}>Visit History</Text>
      </View>

      {/* Horizontal Date Bar Selector */}
      <View style={styles.dateSelectorContainer}>
        <FlatList
          ref={flatListRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          data={dateItems}
          keyExtractor={(item) => item.dateStr}
          contentContainerStyle={styles.dateSelectorScroll}
          renderItem={({ item }) => {
            const isSelected = item.dateStr === selectedDate;
            return (
              <TouchableOpacity
                style={[
                  styles.dateCard,
                  isSelected && styles.selectedDateCard,
                  item.isToday && !isSelected && styles.todayDateCard,
                ]}
                activeOpacity={0.7}
                onPress={() => handleSelectDate(item.dateStr)}
              >
                <Text style={[styles.dayText, isSelected && styles.selectedDateCardText]}>
                  {item.dayLabel}
                </Text>
                <Text style={[styles.dateNumberText, isSelected && styles.selectedDateCardText]}>
                  {item.dateNum}
                </Text>
                <Text style={[styles.monthText, isSelected && styles.selectedDateCardText]}>
                  {item.monthLabel}
                </Text>
              </TouchableOpacity>
            );
          }}
        />
      </View>

      {/* Main Content Area */}
      {loading && !refreshing ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#00796B" />
          <Text style={styles.loadingText}>Fetching visits history...</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#00796B']} />
          }
        >
          {/* Summary Stats Row */}
          {summary && visits.length > 0 && (
            <View style={styles.summaryCard}>
              <Text style={styles.summaryTitle}>DAILY SUMMARY</Text>
              <View style={styles.statsRow}>
                <View style={styles.statCell}>
                  <Text style={styles.statVal}>{summary.total || 0}</Text>
                  <Text style={styles.statLbl}>Total</Text>
                </View>
                <View style={styles.statCellDivider} />
                <View style={styles.statCell}>
                  <Text style={[styles.statVal, { color: '#38A169' }]}>{summary.visited || 0}</Text>
                  <Text style={styles.statLbl}>Visited</Text>
                </View>
                <View style={styles.statCellDivider} />
                <View style={styles.statCell}>
                  <Text style={[styles.statVal, { color: '#D69E2E' }]}>
                    {summary.short_visit || 0}
                  </Text>
                  <Text style={styles.statLbl}>Short</Text>
                </View>
                <View style={styles.statCellDivider} />
                <View style={styles.statCell}>
                  <Text style={[styles.statVal, { color: '#3182CE' }]}>{summary.ongoing || 0}</Text>
                  <Text style={styles.statLbl}>Ongoing</Text>
                </View>
              </View>
            </View>
          )}

          {/* Visits Timeline / List */}
          {visits.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyIcon}>📍</Text>
              <Text style={styles.emptyTitle}>No Visits Recorded</Text>
              <Text style={styles.emptyDesc}>
                {selectedDate === todayStr
                  ? "You haven't checked into any parties today."
                  : `No visit logs found for ${new Date(selectedDate).toLocaleDateString('en-IN', {
                      day: '2-digit',
                      month: 'long',
                      year: 'numeric',
                    })}.`}
              </Text>
            </View>
          ) : (
            <View style={styles.timelineList}>
              {visits.map((visit, index) => {
                const shopName = visit.partyId?.name || visit.partyId?.partyName || 'Unknown Shop';
                const shopAddress = visit.partyId?.address || 'No address specified';

                return (
                  <View key={visit._id} style={styles.visitTimelineWrapper}>
                    {/* Left Timeline Indicator */}
                    <View style={styles.timelineIndicatorsColumn}>
                      <View style={[styles.timelineNode, { backgroundColor: getStatusColor(visit.status) }]} />
                      {index < visits.length - 1 && <View style={styles.timelineLine} />}
                    </View>

                    {/* Right Timeline Details Card */}
                    <View style={styles.visitCard}>
                      <View style={styles.cardHeader}>
                        <Text style={styles.shopNameText}>{shopName}</Text>
                        <View style={[styles.statusBadge, { backgroundColor: getStatusColor(visit.status) + '15' }]}>
                          <Text style={[styles.statusText, { color: getStatusColor(visit.status) }]}>
                            {visit.status?.toUpperCase() || 'UNKNOWN'}
                          </Text>
                        </View>
                      </View>
                      
                      <Text style={styles.addressText}>📍 {shopAddress}</Text>

                      <View style={styles.divider} />

                      {/* Timings */}
                      <View style={styles.timeInfoRow}>
                        <View style={styles.timeBlock}>
                          <Text style={styles.timeLbl}>Arrived</Text>
                          <Text style={styles.timeVal}>{formatTime(visit.arrivedAt)}</Text>
                        </View>
                        <View style={styles.timeBlock}>
                          <Text style={styles.timeLbl}>Departed</Text>
                          <Text style={styles.timeVal}>
                            {visit.status === 'ongoing' ? 'Ongoing' : formatTime(visit.leftAt)}
                          </Text>
                        </View>
                        <View style={styles.timeBlock}>
                          <Text style={styles.timeLbl}>Duration</Text>
                          <Text style={styles.timeVal}>
                            {visit.status === 'ongoing' ? '—' : `${visit.durationMinutes || 0} min`}
                          </Text>
                        </View>
                      </View>

                      {/* Visit Action Indicator tags */}
                      {(visit.orderCreated || visit.collectionCreated) && (
                        <View style={styles.tagsContainer}>
                          {visit.orderCreated && (
                            <View style={[styles.indicatorTag, { backgroundColor: '#C6F6D5' }]}>
                              <Text style={[styles.indicatorTagText, { color: '#22543D' }]}>
                                📦 Order Created
                              </Text>
                            </View>
                          )}
                          {visit.collectionCreated && (
                            <View style={[styles.indicatorTag, { backgroundColor: '#BEE3F8' }]}>
                              <Text style={[styles.indicatorTagText, { color: '#2A4365' }]}>
                                💰 Collection Created
                              </Text>
                            </View>
                          )}
                        </View>
                      )}
                    </View>
                  </View>
                );
              })}
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
    fontSize: responsiveFontSize(17),
    fontWeight: '800',
    color: '#1A202C',
  },

  // Horizontal Date Selector styles
  dateSelectorContainer: {
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    paddingVertical: verticalScale(12),
  },
  dateSelectorScroll: {
    paddingHorizontal: scale(16),
    gap: verticalScale(10),
  },
  dateCard: {
    width: scale(60),
    height: verticalScale(80),
    backgroundColor: '#F7F9FC',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  selectedDateCard: {
    backgroundColor: '#00796B',
    borderColor: '#00796B',
  },
  todayDateCard: {
    borderColor: '#00BFA5',
    borderWidth: 1.5,
  },
  dayText: {
    fontSize: responsiveFontSize(10),
    fontWeight: '700',
    color: '#718096',
    textTransform: 'uppercase',
    marginBottom: verticalScale(4),
  },
  dateNumberText: {
    fontSize: responsiveFontSize(18),
    fontWeight: '800',
    color: '#2D3748',
    marginBottom: verticalScale(4),
  },
  monthText: {
    fontSize: responsiveFontSize(9),
    fontWeight: '700',
    color: '#A0AEC0',
    textTransform: 'uppercase',
  },
  selectedDateCardText: {
    color: '#FFFFFF',
  },

  // Content styles
  scrollContent: {
    padding: scale(16),
    paddingBottom: verticalScale(40),
    gap: verticalScale(16),
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: verticalScale(10),
  },
  loadingText: {
    fontSize: responsiveFontSize(13),
    color: '#718096',
    fontWeight: '600',
  },

  // Summary card
  summaryCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: scale(16),
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.02,
    shadowRadius: 6,
    elevation: 1,
  },
  summaryTitle: {
    fontSize: responsiveFontSize(11),
    fontWeight: '800',
    color: '#718096',
    marginBottom: verticalScale(12),
    letterSpacing: 0.5,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  statCell: {
    flex: 1,
    alignItems: 'center',
  },
  statVal: {
    fontSize: responsiveFontSize(18),
    fontWeight: '800',
    color: '#2D3748',
    marginBottom: verticalScale(2),
  },
  statLbl: {
    fontSize: responsiveFontSize(10),
    color: '#A0AEC0',
    fontWeight: '700',
  },
  statCellDivider: {
    width: 1,
    height: verticalScale(24),
    backgroundColor: '#E2E8F0',
  },

  // Empty container
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: verticalScale(80),
    paddingHorizontal: scale(20),
  },
  emptyIcon: {
    fontSize: responsiveFontSize(48),
    marginBottom: verticalScale(16),
    opacity: 0.7,
  },
  emptyTitle: {
    fontSize: responsiveFontSize(17),
    fontWeight: '700',
    color: '#2D3748',
    marginBottom: verticalScale(6),
  },
  emptyDesc: {
    fontSize: responsiveFontSize(12.5),
    color: '#718096',
    textAlign: 'center',
    lineHeight: 18,
  },

  // Timeline list
  timelineList: {
    paddingLeft: scale(4),
  },
  visitTimelineWrapper: {
    flexDirection: 'row',
    minHeight: 140,
  },
  timelineIndicatorsColumn: {
    width: scale(16),
    alignItems: 'center',
    marginRight: scale(12),
  },
  timelineNode: {
    width: scale(12),
    height: verticalScale(12),
    borderRadius: 6,
    marginTop: verticalScale(20),
    zIndex: 2,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  timelineLine: {
    flex: 1,
    width: 2,
    backgroundColor: '#CBD5E0',
    marginVertical: verticalScale(4),
  },

  // Visit card
  visitCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: scale(16),
    marginBottom: verticalScale(12),
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.02,
    shadowRadius: 6,
    elevation: 1,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: verticalScale(12),
  },
  shopNameText: {
    fontSize: responsiveFontSize(14.5),
    fontWeight: '800',
    color: '#2D3748',
    flex: 1,
  },
  statusBadge: {
    paddingHorizontal: scale(8),
    paddingVertical: verticalScale(3),
    borderRadius: 8,
  },
  statusText: {
    fontSize: responsiveFontSize(10),
    fontWeight: '800',
  },
  addressText: {
    fontSize: responsiveFontSize(11.5),
    color: '#718096',
    marginTop: verticalScale(4),
    lineHeight: 16,
  },
  divider: {
    height: 1,
    backgroundColor: '#EDF2F7',
    marginVertical: verticalScale(12),
  },
  timeInfoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  timeBlock: {
    alignItems: 'center',
  },
  timeLbl: {
    fontSize: responsiveFontSize(9.5),
    color: '#A0AEC0',
    fontWeight: '700',
    textTransform: 'uppercase',
    marginBottom: verticalScale(3),
  },
  timeVal: {
    fontSize: responsiveFontSize(12.5),
    fontWeight: '800',
    color: '#2D3748',
  },
  tagsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: verticalScale(8),
    marginTop: verticalScale(12),
  },
  indicatorTag: {
    paddingHorizontal: scale(8),
    paddingVertical: verticalScale(4),
    borderRadius: 6,
  },
  indicatorTagText: {
    fontSize: responsiveFontSize(10),
    fontWeight: '800',
  },
});
