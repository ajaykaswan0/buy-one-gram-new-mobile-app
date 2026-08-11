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
  TextInput,
  Alert,
  FlatList,
} from 'react-native';
import { scale, verticalScale, responsiveFontSize, maxContainerWidth } from '../utils/responsive';
import { FirebaseImage } from '../services/firebaseUploadService';

export default function CrmDashboardScreen({
  token,
  apiUrl,
  user,
  onLogout,
  onNavigateToCollection,
  onNavigateToAttendance,
  onNavigateToLeave,
  onNavigateToProducts,
  onNavigateToIssues,
  onNavigateToRoutePlanner,
  onNavigateToPartyProfile,
  onNavigateToOrder,
}) {
  const [loading, setLoading] = useState(true);
  const [salesmen, setSalesmen] = useState([]);
  const [selectedSalesman, setSelectedSalesman] = useState(null); // null = All Salesmen

  const [parties, setParties] = useState([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loadingParties, setLoadingParties] = useState(false);
  const [loadingMoreParties, setLoadingMoreParties] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [error, setError] = useState('');

  // Selected party for profile view
  const [selectedParty, setSelectedParty] = useState(null);
  const [profileTab, setProfileTab] = useState('orders'); // 'orders' | 'collections' | 'ratelist'
  const [partyOrders, setPartyOrders] = useState([]);
  const [partyCollections, setPartyCollections] = useState([]);
  const [partyRateList, setPartyRateList] = useState([]);
  const [loadingProfileData, setLoadingProfileData] = useState(false);

  // Initial load
  useEffect(() => {
    fetchParties(1, '');
  }, [apiUrl, token]);

  // Debounced server-side search
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchParties(1, searchQuery);
    }, 350);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const fetchSalesmen = async () => {
    try {
      const res = await fetch(`${apiUrl}/users?limit=200`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok && data.success && Array.isArray(data.data)) {
        // Filter users who are salesmen or sales employees
        const list = data.data.filter(
          (u) =>
            u.roleName === 'salesman' ||
            u.role?.name === 'salesman' ||
            u.role === 'salesman' ||
            (u.roleName && u.roleName.toLowerCase().includes('sales'))
        );
        setSalesmen(list);
      }
    } catch (err) {
      console.log('[CrmDashboardScreen] Error fetching salesmen:', err.message);
    }
  };

  const fetchParties = async (pageNum = 1, query = '') => {
    const isSearchActive = query.trim().length > 0;
    if (pageNum === 1) {
      if (isSearchActive) setSearchLoading(true);
      else setLoadingParties(true);
    } else {
      setLoadingMoreParties(true);
    }
    setError('');

    try {
      const endpoint = isSearchActive
        ? `${apiUrl}/parties?search=${encodeURIComponent(query.trim())}&page=${pageNum}&limit=20`
        : `${apiUrl}/parties/my?page=${pageNum}&limit=20`;

      const res = await fetch(endpoint, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();

      if (res.ok && data.success && Array.isArray(data.data)) {
        const newItems = data.data;
        const meta = data.meta || {};
        setParties(prev => pageNum === 1 ? newItems : [...prev, ...newItems]);
        setPage(pageNum);
        setHasMore(meta.totalPages ? pageNum < meta.totalPages : newItems.length >= 20);
      } else {
        throw new Error(data.message || 'Failed to fetch parties');
      }
    } catch (err) {
      console.log('[CrmDashboardScreen] Error fetching parties:', err.message);
    } finally {
      setLoadingParties(false);
      setLoadingMoreParties(false);
      setSearchLoading(false);
      setLoading(false);
    }
  };

  const handleLoadMoreParties = () => {
    if (!loadingParties && !loadingMoreParties && hasMore) {
      fetchParties(page + 1, searchQuery);
    }
  };

  const handleOpenPartyProfile = async (party) => {
    setSelectedParty(party);
    setProfileTab('orders');
    setLoadingProfileData(true);

    try {
      // 1. Fetch Orders for this party
      const ordersRes = await fetch(`${apiUrl}/order?partyId=${party._id}&limit=50`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const ordersData = await ordersRes.json();
      if (ordersRes.ok && Array.isArray(ordersData.data)) {
        setPartyOrders(ordersData.data);
      } else {
        setPartyOrders([]);
      }

      // 2. Fetch Collections for this party
      const colRes = await fetch(`${apiUrl}/collection/all?partyId=${party._id}&limit=50`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const colData = await colRes.json();
      if (colRes.ok && Array.isArray(colData.data)) {
        setPartyCollections(colData.data);
      } else {
        setPartyCollections([]);
      }

      // 3. Fetch Products / Rate List for this party
      const prodRes = await fetch(`${apiUrl}/product?limit=100`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const prodData = await prodRes.json();
      if (prodRes.ok && Array.isArray(prodData.data)) {
        setPartyRateList(prodData.data);
      } else {
        setPartyRateList([]);
      }
    } catch (err) {
      console.log('[CrmDashboardScreen] Error loading profile data:', err.message);
    } finally {
      setLoadingProfileData(false);
    }
  };

  const calculateTotalOutstanding = () => {
    return parties.reduce((sum, p) => sum + (p.currentOutstanding || 0), 0);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Top App Bar */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>🎧 CRM Console</Text>
          <Text style={styles.headerSubtitle}>
            Welcome, {user?.name || 'CRM Manager'}
          </Text>
        </View>
        {onLogout ? (
          <TouchableOpacity style={styles.logoutBtn} onPress={onLogout}>
            <Text style={styles.logoutBtnText}>Logout</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <ScrollView contentContainerStyle={styles.container}>
        {/* Salesman Filter Section */}
        {false && <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>👔 Filter Parties By Salesman</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.salesmenChipRow}
          >
            <TouchableOpacity
              style={[
                styles.salesmanChip,
                selectedSalesman === null && styles.activeSalesmanChip,
              ]}
              onPress={() => setSelectedSalesman(null)}
            >
              <Text
                style={[
                  styles.salesmanChipText,
                  selectedSalesman === null && styles.activeSalesmanChipText,
                ]}
              >
                All Salesmen ({salesmen.length})
              </Text>
            </TouchableOpacity>

            {salesmen.map((sm) => (
              <TouchableOpacity
                key={sm._id}
                style={[
                  styles.salesmanChip,
                  selectedSalesman?._id === sm._id && styles.activeSalesmanChip,
                ]}
                onPress={() => setSelectedSalesman(sm)}
              >
                <Text
                  style={[
                    styles.salesmanChipText,
                    selectedSalesman?._id === sm._id && styles.activeSalesmanChipText,
                  ]}
                >
                  👤 {sm.name}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>}

        {/* Summary Card */}
        <View style={styles.summaryCard}>
          <View style={styles.summaryRow}>
            <View style={styles.summaryCell}>
              <Text style={styles.summaryLabel}>Filter Context</Text>
              <Text style={styles.summaryValue} numberOfLines={1}>
                {selectedSalesman ? selectedSalesman.name : 'All Salesmen'}
              </Text>
            </View>
            <View style={styles.summaryDivider} />
            <View style={styles.summaryCell}>
              <Text style={styles.summaryLabel}>Total Parties</Text>
              <Text style={styles.summaryValue}>{parties.length}</Text>
            </View>
            <View style={styles.summaryDivider} />
            <View style={styles.summaryCell}>
              <Text style={styles.summaryLabel}>Total Outstanding</Text>
              <Text style={[styles.summaryValue, { color: '#DD6B20' }]}>
                ₹{calculateTotalOutstanding().toLocaleString('en-IN')}
              </Text>
            </View>
          </View>
        </View>

        {/* Search Input */}
        <View style={styles.searchContainer}>
          <TextInput
            style={styles.searchInput}
            placeholder="Search party by name, owner, mobile, area..."
            placeholderTextColor="#A0AEC0"
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchLoading ? (
            <ActivityIndicator size="small" color="#00796B" style={{ marginRight: 6 }} />
          ) : searchQuery ? (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Text style={styles.clearSearchText}>✕</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {/* Parties List */}
        {loadingParties ? (
          <View style={styles.loaderContainer}>
            <ActivityIndicator size="large" color="#00796B" />
            <Text style={styles.loaderText}>Loading assigned parties...</Text>
          </View>
        ) : error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={() => fetchParties(1, searchQuery)}>
              <Text style={styles.retryBtnText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : parties.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={{ fontSize: 40, marginBottom: 8 }}>🏬</Text>
            <Text style={styles.emptyTitle}>No Parties Found</Text>
            <Text style={styles.emptySubtitle}>
              {selectedSalesman
                ? `No parties assigned to ${selectedSalesman.name}.`
                : 'No parties available matching search criteria.'}
            </Text>
          </View>
        ) : (
          <View>
            <Text style={styles.listHeader}>
              Parties List ({parties.length})
            </Text>

            {parties.map((party) => (
              <TouchableOpacity
                activeOpacity={0.85}
                key={party._id}
                style={styles.partyCard}
                onPress={() => onNavigateToPartyProfile ? onNavigateToPartyProfile(party._id) : handleOpenPartyProfile(party)}
              >
                <View style={styles.partyCardHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.partyName}>{party.partyName}</Text>
                    <Text style={styles.partyCode}>
                      {party.partyCode} • Owner: {party.ownerName || 'N/A'}
                    </Text>
                    <Text style={styles.partyAddress}>
                      📍 {party.address}, {party.area}, {party.city}
                    </Text>
                  </View>
                  <View style={styles.outstandingBadge}>
                    <Text style={styles.outstandingBadgeLabel}>Outstanding</Text>
                    <Text style={styles.outstandingBadgeValue}>
                      ₹{(party.currentOutstanding || 0).toLocaleString('en-IN')}
                    </Text>
                  </View>
                </View>

                <View style={styles.partyDivider} />

                {/* Party Actions Row */}
                <View style={styles.partyActionsRow}>
                  <TouchableOpacity
                    style={[styles.partyActionBtn, styles.collectBtn, { flex: 1 }]}
                    onPress={() => onNavigateToCollection && onNavigateToCollection(party)}
                  >
                    <Text style={styles.collectBtnText}>💵 Collect Money</Text>
                  </TouchableOpacity>
                </View>
              </TouchableOpacity>
            ))}

            {loadingMoreParties ? (
              <ActivityIndicator size="small" color="#00796B" style={{ marginVertical: 16 }} />
            ) : null}
          </View>
        )}
      </ScrollView>

      {/* Party Profile Modal */}
      {selectedParty ? (
        <Modal
          visible={!!selectedParty}
          animationType="slide"
          onRequestClose={() => setSelectedParty(null)}
        >
          <SafeAreaView style={{ flex: 1, backgroundColor: '#FFF' }}>
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={() => setSelectedParty(null)}>
                <Text style={styles.modalCloseText}>✕ Close</Text>
              </TouchableOpacity>
              <Text style={styles.modalTitle}>Party Profile</Text>
              <View style={{ width: 50 }} />
            </View>

            {/* Profile Overview Banner */}
            <View style={styles.profileBanner}>
              {selectedParty.shopPhoto ? (
                <FirebaseImage
                  source={{ uri: selectedParty.shopPhoto }}
                  style={styles.shopPhoto}
                  resizeMode="cover"
                  token={token}
                  apiUrl={apiUrl}
                />
              ) : (
                <View style={styles.photoPlaceholder}>
                  <Text style={{ fontSize: 24 }}>📷</Text>
                </View>
              )}

              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.profilePartyName}>{selectedParty.partyName}</Text>
                <Text style={styles.profileCodeText}>{selectedParty.partyCode}</Text>
                <Text style={styles.profileSubText}>📱 {selectedParty.mobile}</Text>
                <Text style={styles.profileOutText}>
                  Outstanding: ₹{(selectedParty.currentOutstanding || 0).toLocaleString('en-IN')}
                </Text>
              </View>
            </View>

            {/* Profile Tabs Header */}
            <View style={styles.profileTabsHeader}>
              <TouchableOpacity
                style={[styles.pTab, profileTab === 'orders' && styles.activePTab]}
                onPress={() => setProfileTab('orders')}
              >
                <Text style={[styles.pTabText, profileTab === 'orders' && styles.activePTabText]}>
                  📋 Orders ({partyOrders.length})
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.pTab, profileTab === 'collections' && styles.activePTab]}
                onPress={() => setProfileTab('collections')}
              >
                <Text style={[styles.pTabText, profileTab === 'collections' && styles.activePTabText]}>
                  💰 Collections ({partyCollections.length})
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.pTab, profileTab === 'ratelist' && styles.activePTab]}
                onPress={() => setProfileTab('ratelist')}
              >
                <Text style={[styles.pTabText, profileTab === 'ratelist' && styles.activePTabText]}>
                  🏷️ Rate List
                </Text>
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={{ padding: 16 }}>
              {loadingProfileData ? (
                <ActivityIndicator color="#00796B" size="large" style={{ marginTop: 30 }} />
              ) : profileTab === 'orders' ? (
                <View>
                  {partyOrders.length === 0 ? (
                    <Text style={styles.emptySubText}>No order history found for this party.</Text>
                  ) : (
                    partyOrders.map((ord) => (
                      <View key={ord._id} style={styles.orderCard}>
                        <View style={styles.orderCardHeader}>
                          <Text style={styles.orderNo}>{ord.orderNumber}</Text>
                          <Text style={styles.orderAmount}>
                            ₹{(ord.grandTotal || ord.totalAmount || 0).toLocaleString('en-IN')}
                          </Text>
                        </View>
                        <Text style={styles.orderSub}>
                          Status: {(ord.status || 'pending').toUpperCase()} • Type: {(ord.orderType || 'regular').toUpperCase()}
                        </Text>
                        <Text style={styles.orderDate}>
                          Date: {new Date(ord.createdAt).toLocaleDateString()}
                        </Text>
                      </View>
                    ))
                  )}
                </View>
              ) : profileTab === 'collections' ? (
                <View>
                  {partyCollections.length === 0 ? (
                    <Text style={styles.emptySubText}>No collection history found for this party.</Text>
                  ) : (
                    partyCollections.map((col) => (
                      <View key={col._id} style={styles.colCard}>
                        <View style={styles.colCardHeader}>
                          <Text style={styles.colMode}>
                            💳 Payment ({col.paymentMode?.toUpperCase()})
                          </Text>
                          <Text style={styles.colAmount}>
                            ₹{(col.amount || 0).toLocaleString('en-IN')}
                          </Text>
                        </View>
                        <Text style={styles.colSub}>
                          Receipt #: {col.receiptNo || 'N/A'} • Status: {(col.status || 'completed').toUpperCase()}
                        </Text>
                        <Text style={styles.colDate}>
                          Date: {new Date(col.collectionDate || col.createdAt).toLocaleDateString()}
                        </Text>
                      </View>
                    ))
                  )}
                </View>
              ) : (
                <View>
                  <Text style={styles.rateListTitle}>Catalog Product Selling Prices</Text>
                  {partyRateList.length === 0 ? (
                    <Text style={styles.emptySubText}>No product rate list loaded.</Text>
                  ) : (
                    partyRateList.map((prod) => (
                      <View key={prod._id} style={styles.rateCard}>
                        <Text style={styles.prodName}>{prod.productName}</Text>
                        <Text style={styles.prodPrice}>
                          Base Price: ₹{(prod.basePrice || prod.mrp || 0).toLocaleString('en-IN')} / {prod.baseUnit || 'Unit'}
                        </Text>
                      </View>
                    ))
                  )}
                </View>
              )}
            </ScrollView>

            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={styles.footerCollectBtn}
                onPress={() => {
                  const targetParty = selectedParty;
                  setSelectedParty(null);
                  onNavigateToOrder && onNavigateToOrder(targetParty);
                }}
              >
                <Text style={styles.footerCollectBtnText}>Create Order</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.footerCollectBtn}
                onPress={() => {
                  const targetParty = selectedParty;
                  setSelectedParty(null);
                  onNavigateToCollection && onNavigateToCollection(targetParty);
                }}
              >
                <Text style={styles.footerCollectBtnText}>
                  💵 Collect Money From {selectedParty.partyName}
                </Text>
              </TouchableOpacity>
            </View>
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
  headerTitle: {
    color: '#FFF',
    fontSize: responsiveFontSize(18),
    fontWeight: '700',
  },
  headerSubtitle: {
    color: '#E6FFFA',
    fontSize: responsiveFontSize(12),
    marginTop: verticalScale(2),
  },
  logoutBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingHorizontal: scale(12),
    paddingVertical: verticalScale(6),
    borderRadius: 6,
  },
  logoutBtnText: {
    color: '#FFF',
    fontSize: responsiveFontSize(12),
    fontWeight: '700',
  },
  container: {
    padding: scale(16),
  },
  sectionCard: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: scale(14),
    marginBottom: verticalScale(14),
    elevation: 1,
  },
  sectionTitle: {
    fontSize: responsiveFontSize(15),
    fontWeight: '700',
    color: '#2D3748',
    marginBottom: verticalScale(10),
  },
  salesmenChipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: verticalScale(8),
  },
  salesmanChip: {
    backgroundColor: '#EDF2F7',
    paddingHorizontal: scale(12),
    paddingVertical: verticalScale(8),
    borderRadius: 20,
  },
  activeSalesmanChip: {
    backgroundColor: '#00796B',
  },
  salesmanChipText: {
    fontSize: responsiveFontSize(13),
    fontWeight: '600',
    color: '#4A5568',
  },
  activeSalesmanChipText: {
    color: '#FFF',
    fontWeight: '700',
  },
  summaryCard: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: scale(14),
    marginBottom: verticalScale(14),
    elevation: 1,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  summaryCell: {
    flex: 1,
    alignItems: 'center',
  },
  summaryLabel: {
    fontSize: responsiveFontSize(11),
    color: '#718096',
    marginBottom: verticalScale(2),
  },
  summaryValue: {
    fontSize: responsiveFontSize(15),
    fontWeight: '700',
    color: '#1A202C',
  },
  summaryDivider: {
    width: 1,
    height: verticalScale(24),
    backgroundColor: '#E2E8F0',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF',
    borderRadius: 8,
    paddingHorizontal: scale(12),
    marginBottom: verticalScale(14),
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  searchInput: {
    flex: 1,
    height: verticalScale(44),
    fontSize: responsiveFontSize(14),
    color: '#2D3748',
  },
  clearSearchText: {
    fontSize: responsiveFontSize(16),
    color: '#A0AEC0',
    padding: scale(4),
  },
  loaderContainer: {
    alignItems: 'center',
    marginVertical: verticalScale(40),
  },
  loaderText: {
    marginTop: verticalScale(10),
    color: '#718096',
  },
  errorCard: {
    backgroundColor: '#FFF5F5',
    borderColor: '#FEB2B2',
    borderWidth: 1,
    borderRadius: 8,
    padding: scale(14),
    alignItems: 'center',
  },
  errorText: {
    color: '#E53E3E',
    marginBottom: verticalScale(8),
  },
  retryBtn: {
    backgroundColor: '#E53E3E',
    paddingHorizontal: scale(14),
    paddingVertical: verticalScale(6),
    borderRadius: 6,
  },
  retryBtnText: {
    color: '#FFF',
    fontWeight: '700',
  },
  emptyContainer: {
    alignItems: 'center',
    marginVertical: verticalScale(40),
  },
  emptyTitle: {
    fontSize: responsiveFontSize(18),
    fontWeight: '700',
    color: '#2D3748',
  },
  emptySubtitle: {
    fontSize: responsiveFontSize(13),
    color: '#718096',
    textAlign: 'center',
    marginTop: verticalScale(4),
  },
  listHeader: {
    fontSize: responsiveFontSize(15),
    fontWeight: '700',
    color: '#2D3748',
    marginBottom: verticalScale(10),
  },
  partyCard: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: scale(14),
    marginBottom: verticalScale(12),
    elevation: 2,
  },
  partyCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  partyName: {
    fontSize: responsiveFontSize(16),
    fontWeight: '700',
    color: '#1A202C',
  },
  partyCode: {
    fontSize: responsiveFontSize(12),
    color: '#718096',
    marginTop: verticalScale(2),
  },
  partyAddress: {
    fontSize: responsiveFontSize(12),
    color: '#4A5568',
    marginTop: verticalScale(4),
  },
  outstandingBadge: {
    backgroundColor: '#FFFAF0',
    borderColor: '#FBD38D',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: scale(10),
    paddingVertical: verticalScale(6),
    alignItems: 'flex-end',
    alignSelf: 'flex-start',
  },
  outstandingBadgeLabel: {
    fontSize: responsiveFontSize(10),
    color: '#C05621',
    fontWeight: '600',
  },
  outstandingBadgeValue: {
    fontSize: responsiveFontSize(14),
    fontWeight: '700',
    color: '#DD6B20',
  },
  partyDivider: {
    height: 1,
    backgroundColor: '#EDF2F7',
    marginVertical: verticalScale(12),
  },
  partyActionsRow: {
    flexDirection: 'row',
    gap: verticalScale(8),
  },
  partyActionBtn: {
    flex: 1,
    paddingVertical: verticalScale(9),
    borderRadius: 6,
    alignItems: 'center',
  },
  profileBtn: {
    backgroundColor: '#EDF2F7',
  },
  profileBtnText: {
    color: '#2D3748',
    fontSize: responsiveFontSize(13),
    fontWeight: '700',
  },
  collectBtn: {
    backgroundColor: '#00796B',
  },
  collectBtnText: {
    color: '#FFF',
    fontSize: responsiveFontSize(13),
    fontWeight: '700',
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
  profileBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: scale(16),
    backgroundColor: '#E6FFFA',
    borderBottomWidth: 1,
    borderBottomColor: '#B2F5EA',
  },
  shopPhoto: {
    width: scale(60),
    height: verticalScale(60),
    borderRadius: 8,
  },
  photoPlaceholder: {
    width: scale(60),
    height: verticalScale(60),
    borderRadius: 8,
    backgroundColor: '#CBD5E0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  profilePartyName: {
    fontSize: responsiveFontSize(17),
    fontWeight: '700',
    color: '#004D40',
  },
  profileCodeText: {
    fontSize: responsiveFontSize(12),
    color: '#00796B',
  },
  profileSubText: {
    fontSize: responsiveFontSize(13),
    color: '#2D3748',
    marginTop: verticalScale(2),
  },
  profileOutText: {
    fontSize: responsiveFontSize(14),
    fontWeight: '700',
    color: '#C05621',
    marginTop: verticalScale(2),
  },
  profileTabsHeader: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    backgroundColor: '#F7F9FC',
  },
  pTab: {
    flex: 1,
    paddingVertical: verticalScale(12),
    alignItems: 'center',
  },
  activePTab: {
    borderBottomWidth: 3,
    borderBottomColor: '#00796B',
    backgroundColor: '#FFF',
  },
  pTabText: {
    fontSize: responsiveFontSize(12),
    color: '#718096',
    fontWeight: '600',
  },
  activePTabText: {
    color: '#00796B',
    fontWeight: '700',
  },
  emptySubText: {
    color: '#A0AEC0',
    fontStyle: 'italic',
    textAlign: 'center',
    marginVertical: verticalScale(30),
  },
  orderCard: {
    backgroundColor: '#F7F9FC',
    borderRadius: 8,
    padding: scale(12),
    marginBottom: verticalScale(8),
  },
  orderCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  orderNo: {
    fontSize: responsiveFontSize(14),
    fontWeight: '700',
    color: '#2D3748',
  },
  orderAmount: {
    fontSize: responsiveFontSize(14),
    fontWeight: '700',
    color: '#00796B',
  },
  orderSub: {
    fontSize: responsiveFontSize(12),
    color: '#718096',
    marginTop: verticalScale(4),
  },
  orderDate: {
    fontSize: responsiveFontSize(11),
    color: '#A0AEC0',
    marginTop: verticalScale(2),
  },
  colCard: {
    backgroundColor: '#F7F9FC',
    borderRadius: 8,
    padding: scale(12),
    marginBottom: verticalScale(8),
  },
  colCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  colMode: {
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
  rateListTitle: {
    fontSize: responsiveFontSize(14),
    fontWeight: '700',
    color: '#2D3748',
    marginBottom: verticalScale(10),
  },
  rateCard: {
    backgroundColor: '#F7F9FC',
    borderRadius: 8,
    padding: scale(12),
    marginBottom: verticalScale(8),
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  prodName: {
    fontSize: responsiveFontSize(14),
    fontWeight: '600',
    color: '#2D3748',
  },
  prodPrice: {
    fontSize: responsiveFontSize(14),
    fontWeight: '700',
    color: '#00796B',
  },
  modalFooter: {
    padding: scale(16),
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    backgroundColor: '#FFF',
  },
  footerCollectBtn: {
    backgroundColor: '#00796B',
    paddingVertical: verticalScale(14),
    borderRadius: 8,
    alignItems: 'center',
  },
  footerCollectBtnText: {
    color: '#FFF',
    fontSize: responsiveFontSize(16),
    fontWeight: '700',
  },
});
