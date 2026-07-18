import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ActivityIndicator,
  SafeAreaView,
  ScrollView,
  TextInput,
  Alert,
  RefreshControl,
  Share,
  Modal,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';

export default function ProductScreen({ token, apiUrl, onBack }) {
  const [products, setProducts] = useState([]);
  const [priceList, setPriceList] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Filtering & GST states
  const [withGst, setWithGst] = useState(false);
  const [selectedPackSize, setSelectedPackSize] = useState('All');

  // Parties sharing states
  const [parties, setParties] = useState([]);
  const [loadingParties, setLoadingParties] = useState(false);
  const [shareModalVisible, setShareModalVisible] = useState(false);
  const [selectedPartyId, setSelectedPartyId] = useState('other'); // partyId or 'other'
  const [customPhone, setCustomPhone] = useState('');
  const [partySearchQuery, setPartySearchQuery] = useState('');
  const [sendingShare, setSendingShare] = useState(false);

  useEffect(() => {
    fetchData();
    fetchParties();
  }, []);

  const fetchData = async () => {
    try {
      // 1. Fetch products
      const prodResponse = await fetch(`${apiUrl}/product?limit=100`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const prodData = await prodResponse.json();

      // 2. Fetch price lists
      const plResponse = await fetch(`${apiUrl}/price-list`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const plData = await plResponse.json();

      if (prodResponse.ok && plResponse.ok) {
        setProducts(prodData.data || []);
        // Find general price list (Standard Price List or the one without partyId)
        const allLists = plData.data || [];
        const activePL = allLists.find(p => p.name === 'Standard Price List') || allLists.find(p => p.partyId === null);
        setPriceList(activePL || null);
      } else {
        Alert.alert('Error', 'Failed to retrieve rate list records.');
      }
    } catch (e) {
      console.warn('Rate list fetch error:', e.message);
      Alert.alert('Error', 'Connection error.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const fetchParties = async () => {
    setLoadingParties(true);
    try {
      const response = await fetch(`${apiUrl}/parties/my`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (response.ok) {
        setParties(data.data || []);
      }
    } catch (e) {
      console.warn('Failed to load sharing parties:', e.message);
    } finally {
      setLoadingParties(false);
    }
  };

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchData();
    fetchParties();
  }, []);

  // Compute items with rate, mrp, difference, and margin
  const getRateListItems = useCallback(() => {
    const items = [];
    products.forEach((prod) => {
      (prod.variants || []).forEach((variant) => {
        if (variant.isDeleted || !variant.isActive) return;

        // Resolve rate from Standard Price List or fallback to product salesPrice
        let price = variant.salesPrice || 0;
        let priceHistory = [];
        if (priceList && priceList.items) {
          const pli = priceList.items.find(
            (i) => i.productId?._id?.toString() === prod._id?.toString() || 
                   i.productId?.toString() === prod._id?.toString()
          );
          if (pli && pli.variantId?.toString() === variant._id?.toString()) {
            price = pli.price;
            priceHistory = pli.priceHistory || [];
          }
        }

        // GST Calculation
        const gstPercentage = variant.gstPercentage || 0;
        const rate = withGst ? price * (1 + gstPercentage / 100) : price;
        const mrp = variant.mrp || 0;

        // +/- difference from last price list update
        const previousPrice = priceHistory.length > 0
          ? priceHistory[priceHistory.length - 1].price
          : price;
        const diff = price - previousPrice;
        const diffRate = withGst ? diff * (1 + gstPercentage / 100) : diff;

        // Margin percentage: (MRP - Rate) / Rate * 100
        const margin = rate > 0 ? Math.max(0, Math.round(((mrp - rate) / rate) * 100)) : 0;

        items.push({
          id: variant._id,
          name: prod.productName,
          variantName: variant.variantName,
          packSize: variant.packSize,
          unit: variant.unit,
          rate,
          mrp,
          diff: diffRate,
          margin,
        });
      });
    });
    return items;
  }, [products, priceList, withGst]);

  const items = getRateListItems();

  // Extract dynamic pack size filter list
  const packSizes = ['All', ...new Set(items.map((it) => it.packSize))];

  // Filter displayed items
  const displayedItems = items.filter((item) => {
    const matchesSearch =
      item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.variantName.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesPack = selectedPackSize === 'All' || item.packSize === selectedPackSize;
    return matchesSearch && matchesPack;
  });

  const handleOpenShareModal = () => {
    setShareModalVisible(true);
    setSelectedPartyId('other');
    setCustomPhone('');
    setPartySearchQuery('');
  };

  const handleSendWhatsapp = async () => {
    let targetPhone = customPhone.trim();
    let selectedParty = null;

    if (selectedPartyId !== 'other') {
      selectedParty = parties.find(p => p._id === selectedPartyId);
      if (selectedParty) {
        // Fallback to party whatsapp or mobile if target input was left empty
        targetPhone = targetPhone || selectedParty.whatsapp || selectedParty.mobile || '';
      }
    }

    if (!targetPhone) {
      Alert.alert('Required', 'Please enter a valid phone number.');
      return;
    }

    setSendingShare(true);
    try {
      const modeText = withGst ? 'WITH GST' : 'WITHOUT GST';
      const text = displayedItems
        .map(
          (item, idx) =>
            `${idx + 1}. ${item.name} (${item.packSize}) - Rate: ₹${item.rate.toFixed(
              1
            )} | MRP: ₹${item.mrp.toFixed(0)} | Diff: ${
              item.diff > 0 ? '+' : ''
            }${item.diff.toFixed(1)} | Margin: ${item.margin}%`
        )
        .join('\n');

      const response = await fetch(`${apiUrl}/notification/whatsapp/price-list`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          partyId: selectedPartyId !== 'other' ? selectedPartyId : null,
          phone: targetPhone,
          templateName: 'price_list',
          messageBody: `Rate List (${modeText}):\n\n${text}`,
        }),
      });

      const data = await response.json();
      if (response.ok && data.success) {
        Alert.alert('Success', 'WhatsApp price list shared successfully!');
        setShareModalVisible(false);
        fetchParties(); // reload updated whatsapp numbers
      } else {
        Alert.alert('Failed', data.message || 'Could not send WhatsApp message.');
      }
    } catch (e) {
      console.warn('Send WhatsApp error:', e.message);
      Alert.alert('Error', 'Connection error.');
    } finally {
      setSendingShare(false);
    }
  };

  // Filter parties inside share modal based on search query
  const filteredSharingParties = parties.filter(p => 
    p.partyName?.toLowerCase().includes(partySearchQuery.toLowerCase()) ||
    p.partyCode?.toLowerCase().includes(partySearchQuery.toLowerCase())
  );

  const activePartyObj = selectedPartyId !== 'other' ? parties.find(p => p._id === selectedPartyId) : null;
  const showPhoneLabel = activePartyObj 
    ? (activePartyObj.whatsapp ? `Prefilled No: ${activePartyObj.whatsapp}` : 'No Number Saved (Enter Below) *')
    : 'Enter Phone Number *';

  if (loading) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator size="large" color="#00796B" />
        <Text style={styles.loadingText}>Loading Rate List...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Top Header Block */}
      <View style={styles.headerBlock}>
        <View style={styles.topRow}>
          <TouchableOpacity onPress={onBack} style={styles.backBtn}>
            <Text style={styles.backBtnText}>←</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Rate List</Text>
          <View style={{ width: 36 }} />
        </View>

        {/* GST Toggle and Share Button Row */}
        <View style={styles.controlsRow}>
          <View style={styles.gstToggleBox}>
            <TouchableOpacity
              style={[styles.gstToggleBtn, !withGst && styles.activeGstBtn]}
              onPress={() => setWithGst(false)}
            >
              <Text style={[styles.gstToggleBtnText, !withGst && styles.activeGstBtnText]}>
                WITHOUT GST
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.gstToggleBtn, withGst && styles.activeGstBtn]}
              onPress={() => setWithGst(true)}
            >
              <Text style={[styles.gstToggleBtnText, withGst && styles.activeGstBtnText]}>
                WITH GST
              </Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={styles.shareBtn} onPress={handleOpenShareModal}>
            <Text style={styles.shareBtnText}>Share &gt;</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Horizontal Pack Sizes Filter Row */}
      <View style={styles.filterTabsWrapper}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabsScrollContent}>
          {packSizes.map((size) => (
            <TouchableOpacity
              key={size}
              style={[
                styles.filterTab,
                selectedPackSize === size ? styles.activeFilterTab : styles.inactiveFilterTab,
              ]}
              onPress={() => setSelectedPackSize(size)}
            >
              <Text
                style={[
                  styles.filterTabText,
                  selectedPackSize === size ? styles.activeFilterTabText : styles.inactiveFilterTabText,
                ]}
              >
                {size}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Search Field */}
      <View style={styles.searchContainer}>
        <View style={styles.searchBox}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Search products..."
            placeholderTextColor="#A0AEC0"
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Text style={styles.clearSearch}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Table Header */}
      <View style={styles.tableHeaderRow}>
        <Text style={[styles.thText, { flex: 0.8, textAlign: 'center' }]}>S.No</Text>
        <Text style={[styles.thText, { flex: 2.8 }]}>Product Name</Text>
        <Text style={[styles.thText, { flex: 1.6, color: '#3182CE', textAlign: 'right' }]}>Rate</Text>
        <Text style={[styles.thText, { flex: 1.4, textAlign: 'right' }]}>MRP</Text>
        <Text style={[styles.thText, { flex: 1.2, textAlign: 'center' }]}>+/-</Text>
        <Text style={[styles.thText, { flex: 1.4, color: '#D69E2E', textAlign: 'right' }]}>Margin</Text>
      </View>

      {/* Product List */}
      <ScrollView
        contentContainerStyle={styles.listContainer}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={['#00796B']}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {displayedItems.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyIcon}>📋</Text>
            <Text style={styles.emptyTitle}>No Rates Found</Text>
            <Text style={styles.emptyDesc}>Try adjusting filters or search term</Text>
          </View>
        ) : (
          displayedItems.map((item, idx) => {
            const isNegative = item.diff < 0;
            const isPositive = item.diff > 0;
            const diffColor = isPositive ? '#38A169' : isNegative ? '#E53E3E' : '#718096';
            const diffText = item.diff === 0 ? '0' : `${isPositive ? '+' : ''}${item.diff.toFixed(0)}`;

            return (
              <View key={item.id} style={styles.tableRowCard}>
                {/* S.No */}
                <Text style={[styles.tdText, styles.sNoText, { flex: 0.8 }]}>{idx + 1}</Text>

                {/* Product Name */}
                <View style={{ flex: 2.8 }}>
                  <Text style={styles.productNameText} numberOfLines={1}>{item.name}</Text>
                  <Text style={styles.productPackSizeText}>{item.packSize} {item.unit}</Text>
                </View>

                {/* Rate */}
                <Text style={[styles.tdText, styles.rateText, { flex: 1.6 }]}>
                  ₹{item.rate.toLocaleString('en-IN', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                </Text>

                {/* MRP */}
                <Text style={[styles.tdText, styles.mrpText, { flex: 1.4 }]}>
                  ₹{item.mrp.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                </Text>

                {/* +/- difference */}
                <Text style={[styles.tdText, { flex: 1.2, color: diffColor, fontWeight: '750', textAlign: 'center' }]}>
                  {diffText}
                </Text>

                {/* Margin */}
                <Text style={[styles.tdText, styles.marginText, { flex: 1.4 }]}>
                  {item.margin}%
                </Text>
              </View>
            );
          })
        )}
      </ScrollView>

      {/* Share Modal Dialog */}
      {shareModalVisible && (
        <Modal
          visible={shareModalVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setShareModalVisible(false)}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={styles.shareModalOverlay}
          >
            <View style={styles.shareModalContainer}>
              <Text style={styles.shareModalTitle}>Share Rate List via WhatsApp</Text>

              {/* Party selection dropdown / list wrapper */}
              <Text style={styles.phoneInputLabel}>1. Select Recipient Party</Text>
              
              {/* Search bar inside sharing modal */}
              <View style={styles.modalSearchBox}>
                <TextInput
                  style={styles.modalSearchInput}
                  placeholder="Search customer party..."
                  placeholderTextColor="#A0AEC0"
                  value={partySearchQuery}
                  onChangeText={setPartySearchQuery}
                />
              </View>

              <ScrollView style={styles.partiesScrollWrapper}>
                {/* Other / Custom Option */}
                <TouchableOpacity
                  style={[
                    styles.partyOptionItem,
                    selectedPartyId === 'other' && styles.activePartyOptionItem,
                  ]}
                  onPress={() => {
                    setSelectedPartyId('other');
                    setCustomPhone('');
                  }}
                >
                  <Text style={styles.partyOptionName}>❓ Other (Custom Number)</Text>
                  <Text style={styles.partyOptionMeta}>Manually type a phone number</Text>
                </TouchableOpacity>

                {filteredSharingParties.map((party) => (
                  <TouchableOpacity
                    key={party._id}
                    style={[
                      styles.partyOptionItem,
                      selectedPartyId === party._id && styles.activePartyOptionItem,
                    ]}
                    onPress={() => {
                      setSelectedPartyId(party._id);
                      setCustomPhone(party.whatsapp || party.mobile || '');
                    }}
                  >
                    <Text style={styles.partyOptionName}>{party.partyName}</Text>
                    <Text style={styles.partyOptionMeta}>
                      Code: {party.partyCode} • WA: {party.whatsapp || 'None'} • Mob: {party.mobile}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {/* Phone number input */}
              <Text style={styles.phoneInputLabel}>2. WhatsApp Phone Number ({showPhoneLabel})</Text>
              <TextInput
                style={styles.phoneInput}
                placeholder="e.g. 9876543210"
                placeholderTextColor="#A0AEC0"
                keyboardType="phone-pad"
                value={customPhone}
                onChangeText={setCustomPhone}
              />

              {/* Actions Row */}
              <View style={styles.shareModalFooter}>
                <TouchableOpacity
                  style={styles.closeBtn}
                  onPress={() => setShareModalVisible(false)}
                  disabled={sendingShare}
                >
                  <Text style={styles.closeBtnText}>Cancel</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.sendBtn, sendingShare && { opacity: 0.7 }]}
                  onPress={handleSendWhatsapp}
                  disabled={sendingShare}
                >
                  {sendingShare ? (
                    <ActivityIndicator color="#FFFFFF" size="small" />
                  ) : (
                    <Text style={styles.sendBtnText}>Send WhatsApp</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>
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
    backgroundColor: '#F7F9FC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: '#718096',
    fontWeight: '600',
  },

  // Premium Header Block
  headerBlock: {
    backgroundColor: '#27AE60',
    paddingBottom: 16,
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
    height: 48,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backBtnText: {
    fontSize: 18,
    color: '#FFFFFF',
    fontWeight: '800',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFFFFF',
  },

  // Controls Row
  controlsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginTop: 16,
  },
  gstToggleBox: {
    flexDirection: 'row',
    backgroundColor: 'rgba(0, 0, 0, 0.15)',
    borderRadius: 10,
    padding: 3,
  },
  gstToggleBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  activeGstBtn: {
    backgroundColor: '#FFFFFF',
  },
  gstToggleBtnText: {
    fontSize: 11,
    fontWeight: '800',
    color: 'rgba(255, 255, 255, 0.85)',
  },
  activeGstBtnText: {
    color: '#27AE60',
  },
  shareBtn: {
    backgroundColor: '#000000',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
  },
  shareBtnText: {
    fontSize: 12,
    color: '#FFFFFF',
    fontWeight: '800',
  },

  // Dynamic filter tabs row
  filterTabsWrapper: {
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  tabsScrollContent: {
    paddingHorizontal: 16,
    gap: 10,
  },
  filterTab: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 70,
  },
  activeFilterTab: {
    backgroundColor: '#27AE60',
  },
  inactiveFilterTab: {
    backgroundColor: '#E2E8F0',
  },
  filterTabText: {
    fontSize: 12,
    fontWeight: '800',
  },
  activeFilterTabText: {
    color: '#FFFFFF',
  },
  inactiveFilterTabText: {
    color: '#718096',
  },

  // Search Field
  searchContainer: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F7F9FC',
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 38,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  searchIcon: {
    fontSize: 14,
    marginRight: 6,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    color: '#2D3748',
    padding: 0,
  },
  clearSearch: {
    fontSize: 14,
    color: '#A0AEC0',
    paddingLeft: 6,
  },

  // Table header
  tableHeaderRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#EDF2F7',
    borderBottomWidth: 1,
    borderBottomColor: '#CBD5E0',
  },
  thText: {
    fontSize: 10.5,
    fontWeight: '850',
    color: '#4A5568',
    textTransform: 'uppercase',
  },

  // Table Row Cards
  listContainer: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  tableRowCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  tdText: {
    fontSize: 13.5,
    fontWeight: '650',
    color: '#2D3748',
  },
  sNoText: {
    textAlign: 'center',
    color: '#718096',
    fontWeight: '600',
  },
  productNameText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#1A202C',
  },
  productPackSizeText: {
    fontSize: 10.5,
    color: '#718096',
    fontWeight: '600',
    marginTop: 2,
  },
  rateText: {
    textAlign: 'right',
    color: '#3182CE',
    fontWeight: '800',
  },
  mrpText: {
    textAlign: 'right',
    color: '#718096',
    fontWeight: '600',
  },
  marginText: {
    textAlign: 'right',
    color: '#D69E2E',
    fontWeight: '800',
  },

  // Empty view
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 80,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 16,
    opacity: 0.5,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#2D3748',
    marginBottom: 4,
  },
  emptyDesc: {
    fontSize: 12,
    color: '#718096',
  },

  // Sharing Modal Styles
  shareModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: 20,
  },
  shareModalContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    maxHeight: '80%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 5,
  },
  shareModalTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#2D3748',
    marginBottom: 14,
    textAlign: 'center',
  },
  modalSearchBox: {
    height: 38,
    backgroundColor: '#F7F9FC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    paddingHorizontal: 12,
    justifyContent: 'center',
    marginBottom: 10,
  },
  modalSearchInput: {
    fontSize: 13,
    color: '#2D3748',
    padding: 0,
  },
  partiesScrollWrapper: {
    maxHeight: 180,
    marginBottom: 12,
  },
  partyOptionItem: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    marginBottom: 6,
    backgroundColor: '#F7F9FC',
  },
  activePartyOptionItem: {
    borderColor: '#27AE60',
    backgroundColor: '#EBFBEF',
  },
  partyOptionName: {
    fontSize: 12.5,
    fontWeight: '800',
    color: '#2D3748',
  },
  partyOptionMeta: {
    fontSize: 10.5,
    color: '#718096',
    marginTop: 2,
    fontWeight: '600',
  },
  phoneInputLabel: {
    fontSize: 11,
    fontWeight: '850',
    color: '#718096',
    textTransform: 'uppercase',
    marginTop: 10,
    marginBottom: 6,
  },
  phoneInput: {
    height: 42,
    backgroundColor: '#F7F9FC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 14,
    color: '#2D3748',
    fontWeight: '700',
    marginBottom: 16,
  },
  shareModalFooter: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
  },
  closeBtn: {
    flex: 1,
    height: 42,
    backgroundColor: '#EDF2F7',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    fontSize: 13.5,
    fontWeight: '700',
    color: '#4A5568',
  },
  sendBtn: {
    flex: 1.5,
    height: 42,
    backgroundColor: '#27AE60',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnText: {
    fontSize: 13.5,
    fontWeight: '800',
    color: '#FFFFFF',
  },
});
