import React, { useState, useEffect, useCallback } from 'react';
import { useLanguage } from '../i18n';
import { readJson } from '../services/apiResponse';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ActivityIndicator,
  SafeAreaView,
  ScrollView,
  FlatList,
  TextInput,
  Alert,
  RefreshControl,
  Share,
  Modal,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { scale, verticalScale, responsiveFontSize, maxContainerWidth } from '../utils/responsive';
import { packLabel, perKgLabel } from '../utils/packLabel';

export default function ProductScreen({ token, apiUrl, user, onBack }) {
  const { t } = useLanguage();
  const [products, setProducts] = useState([]);
  const [priceList, setPriceList] = useState(null);
  const [inventoryRows, setInventoryRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Filtering & GST states
  // On by default: the price a shopkeeper is quoted is the one he pays, so
  // showing the pre-tax rate first invites an argument at the counter.
  const [withGst, setWithGst] = useState(true);
  /**
   * Opens on one pack size rather than every one at once.
   *
   * Every product has four or five variants, so "All" is a hundred and
   * seventy-five rows — which is what made this screen slow to open. 1kg is
   * the one most orders are placed in, and "All" is still one tap away.
   */
  const [selectedPackSize, setSelectedPackSize] = useState('1kg');

  // Parties sharing states
  const [parties, setParties] = useState([]);
  const [loadingParties, setLoadingParties] = useState(false);
  const [shareModalVisible, setShareModalVisible] = useState(false);
  const [selectedPartyId, setSelectedPartyId] = useState('other'); // partyId or 'other'
  const [customPhone, setCustomPhone] = useState('');
  // Only used for a number that is not a party: the approved template has a
  // name blank in it, and Meta rejects a send where a blank comes out empty.
  const [customName, setCustomName] = useState('');
  const [partySearchQuery, setPartySearchQuery] = useState('');
  const [sendingShare, setSendingShare] = useState(false);

  useEffect(() => {
    fetchData();
    fetchParties();
  }, []);

  const fetchData = async () => {
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const [prodResponse, plResponse, stockResponse] = await Promise.all([
        fetch(`${apiUrl}/product?limit=100&productType=finished_goods`, { headers }),
        fetch(`${apiUrl}/price-list/manufacturing?page=1&limit=100`, { headers }),
        fetch(`${apiUrl}/inventory/stock?stockType=finished_goods&limit=100`, { headers }),
      ]);
      const [prodData, plData, stockData] = await Promise.all([
        prodResponse.json(),
        plResponse.json(),
        stockResponse.json(),
      ]);

      if (prodResponse.ok && plResponse.ok && stockResponse.ok) {
        setProducts(prodData.data || []);
        setPriceList({ items: plData.data || [] });
        setInventoryRows(stockData.data || []);
      } else {
        Alert.alert('Error', 'Failed to retrieve products, prices or finished-goods stock.');
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
      const partyEndpoint = user?.role === 'cso' ? '/parties?limit=100' : '/parties/my';
      const response = await fetch(`${apiUrl}${partyEndpoint}`, {
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

        // Price and MRP are owned by PriceList, never by embedded product fields.
        let price = 0;
        let mrp = 0;
        let priceHistory = [];
        if (priceList && priceList.items) {
          const pli = priceList.items.find(
            (i) => String(i.productId?._id || i.productId) === String(prod._id) &&
                   String(i.variantId?._id || i.variantId) === String(variant._id)
          );
          if (pli) {
            price = Number(pli.finalSellingPrice ?? pli.price ?? 0);
            mrp = Number(pli.mrp || 0);
            priceHistory = pli.priceHistory || [];
          }
        }

        /**
         * The stored price is the one with GST in it, not the one without.
         *
         * This multiplied it up for the "with GST" view, which charged the tax
         * twice — Arhar 1kg reads 114.50 on the printed rate list and the app
         * showed 120.23. The pricing formula builds the tax in (base x 1.05,
         * and the 1.05 is the five per cent), and the printed list says
         * "Prices inclusive of GST", so the stored figure is the inclusive one.
         *
         * With GST is therefore what is stored, and without GST is that figure
         * divided back out. A 30kg sack is GST-exempt and divides by one, so
         * both views show it the same, which is right.
         */
        const gstPercentage = variant.gstPercentage || 0;
        const rate = withGst ? price : price / (1 + gstPercentage / 100);
        // +/- difference from last price list update
        const previousPrice = priceHistory.length > 0
          ? priceHistory[priceHistory.length - 1].price
          : price;
        const diff = price - previousPrice;
        // The change is between two inclusive prices, so it is shown the same
        // way round as the price above it.
        const diffRate = withGst ? diff : diff / (1 + gstPercentage / 100);

        // Margin percentage: (MRP - Rate) / Rate * 100
        const margin = rate > 0 ? Math.max(0, Math.round(((mrp - rate) / rate) * 100)) : 0;
        const stockRows = inventoryRows.filter(
          (row) => String(row.product?._id || row.product || row.productId?._id || row.productId) === String(prod._id) &&
                   String(row.variantId?._id || row.variantId) === String(variant._id)
        );
        const totalStock = stockRows.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
        const reservedStock = stockRows.reduce((sum, row) => sum + Number(row.reservedQuantity || 0), 0);
        const availableStock = stockRows.reduce(
          (sum, row) => sum + Number(row.availableQuantity ?? (Number(row.quantity || 0) - Number(row.reservedQuantity || 0))),
          0
        );

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
          totalStock,
          reservedStock,
          availableStock,
        });
      });
    });
    return items;
  }, [products, priceList, inventoryRows, withGst]);

  const items = getRateListItems();

  // Extract dynamic pack size filter list
  /**
   * The tabs carry their unit.
   *
   * They were built from `packSize` alone, so the row of filters read
   * "All 500 1 5 10 30 800" — numbers with nothing to say whether they meant
   * grams or kilos.
   */
  const packSizes = ['All', ...new Set(items.map((it) => packLabel(it.packSize, it.unit, it.variantName)))];

  // Filter displayed items
  const displayedItems = items.filter((item) => {
    const matchesSearch =
      item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.variantName.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesPack = selectedPackSize === 'All' || packLabel(item.packSize, item.unit, item.variantName) === selectedPackSize;
    return matchesSearch && matchesPack;
  });

  const handleOpenShareModal = () => {
    setShareModalVisible(true);
    setSelectedPartyId('other');
    setCustomPhone('');
    setCustomName('');
    setPartySearchQuery('');
  };

  const handleSendWhatsapp = async () => {
    const toOther = !selectedPartyId || selectedPartyId === 'other';
    const selectedParty = toOther ? null : parties.find(p => p._id === selectedPartyId);

    // A party keeps its own saved number unless one was typed over it.
    const targetPhone = (customPhone.trim()
      || selectedParty?.whatsapp || selectedParty?.mobile || '').trim();

    if (toOther && !targetPhone) {
      Alert.alert('Number needed', 'Type the WhatsApp number to send the rate list to.');
      return;
    }
    if (!targetPhone) {
      Alert.alert('No number', `${selectedParty?.partyName || 'This party'} has no WhatsApp or mobile number saved. Type one below.`);
      return;
    }

    setSendingShare(true);
    try {
      /**
       * Sends whatever Settings says the rate list is.
       *
       * The file and the approved template both come from Settings, which is
       * why nothing about the message is decided here — only who it goes to.
       *
       * A shop that is not a party yet gets it on the typed number. Refusing
       * until somebody creates the party just means the rate list never gets
       * sent, which is the opposite of the point.
       */
      const url = toOther
        ? `${apiUrl}/parties/share-to-number/rate_list`
        : `${apiUrl}/parties/${selectedPartyId}/share/rate_list`;

      const body = toOther
        ? JSON.stringify({ phone: targetPhone, name: customName.trim() })
        : JSON.stringify({ phone: targetPhone });

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body,
      });

      // readJson throws on a refusal, carrying the server's own wording, so
      // reaching here means it went out.
      const data = await readJson(response, 'The server');
      Alert.alert('Sent', data.message || 'Rate list sent.');
      setShareModalVisible(false);
      fetchParties();
    } catch (e) {
      console.warn('Send WhatsApp error:', e.message);
      // The server says why in terms a salesman can act on — no template
      // chosen, number not on WhatsApp, no price set yet. Replacing all of
      // that with "Connection error", as this used to, hides every one.
      Alert.alert('Not sent', e.message || 'Could not reach the server.');
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
        <Text style={[styles.thText, { flex: 3.2 }]}>Product / Available Stock</Text>
        <Text style={[styles.thText, { flex: 1.6, color: '#3182CE', textAlign: 'right' }]}>Rate</Text>
        <Text style={[styles.thText, { flex: 1.4, textAlign: 'right' }]}>MRP</Text>
        <Text style={[styles.thText, { flex: 1.2, textAlign: 'center' }]}>+/-</Text>
        <Text style={[styles.thText, { flex: 1.4, color: '#D69E2E', textAlign: 'right' }]}>Margin</Text>
      </View>

      {/* Product List */}
      {/*
        * A FlatList, not a ScrollView.
        *
        * A ScrollView builds every row before it shows anything, so choosing
        * "All" meant laying out a hundred and seventy-five rows before the
        * screen appeared — which is the wait. A FlatList builds the ones on
        * screen and the rest as they are scrolled to, so it opens at once
        * however many there are.
        */}
      <FlatList
        data={displayedItems}
        keyExtractor={(item, idx) => String(item.id || idx)}
        contentContainerStyle={styles.listContainer}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={['#00796B']}
          />
        }
        showsVerticalScrollIndicator={false}
        initialNumToRender={12}
        maxToRenderPerBatch={12}
        windowSize={7}
        removeClippedSubviews
        ListEmptyComponent={(
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyIcon}>📋</Text>
            <Text style={styles.emptyTitle}>No Rates Found</Text>
            <Text style={styles.emptyDesc}>Try adjusting filters or search term</Text>
          </View>
        )}
        renderItem={({ item, index: idx }) => {
            const isNegative = item.diff < 0;
            const isPositive = item.diff > 0;
            const diffColor = isPositive ? '#38A169' : isNegative ? '#E53E3E' : '#718096';
            const diffText = item.diff === 0 ? '0' : `${isPositive ? '+' : ''}${item.diff.toFixed(0)}`;

            return (
              <View key={item.id} style={styles.tableRowCard}>
                {/* S.No */}
                <Text style={[styles.tdText, styles.sNoText, { flex: 0.8 }]}>{idx + 1}</Text>

                {/* Product Name */}
                <View style={{ flex: 3.2 }}>
                  <Text style={styles.productNameText} numberOfLines={1}>{item.name}</Text>
                  <Text style={styles.productPackSizeText}>
                    {packLabel(item.packSize, item.unit, item.variantName)}
                    {/* A 30kg rate of 3,150 cannot be compared with a 1kg rate of 114
                        by eye. Only the big packs carry it; on a 1kg pack it would be
                        the same number twice. */}
                    {perKgLabel(item.rate, item.packSize, item.unit, item.variantName)
                      ? '  ' + perKgLabel(item.rate, item.packSize, item.unit, item.variantName)
                      : ''}
                  </Text>
                  <Text style={{
                    color: item.availableStock > 0 ? '#38A169' : '#E53E3E',
                    fontSize: 10,
                    fontWeight: '700',
                    marginTop: 2,
                  }}>
                    {item.availableStock > 0 ? t('Available') : t('Out of stock')}
                  </Text>
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
        }}
      />

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
                      setCustomName('');
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

              {selectedPartyId === 'other' && (
                <>
                  <Text style={styles.phoneInputLabel}>3. Shop Name (optional)</Text>
                  <TextInput
                    style={styles.phoneInput}
                    placeholder="Who is it for? e.g. Sharma Kirana"
                    placeholderTextColor="#A0AEC0"
                    value={customName}
                    onChangeText={setCustomName}
                  />
                  <Text style={styles.customHint}>
                    Goes to this number on the company WhatsApp. The shop does not have to be a party.
                  </Text>
                </>
              )}

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
    marginTop: verticalScale(12),
    fontSize: responsiveFontSize(14),
    color: '#718096',
    fontWeight: '600',
  },

  // Premium Header Block
  headerBlock: {
    backgroundColor: '#27AE60',
    paddingBottom: verticalScale(16),
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: scale(16),
    paddingTop: verticalScale(12),
    height: verticalScale(48),
  },
  backBtn: {
    width: scale(36),
    height: verticalScale(36),
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backBtnText: {
    fontSize: responsiveFontSize(18),
    color: '#FFFFFF',
    fontWeight: '800',
  },
  headerTitle: {
    fontSize: responsiveFontSize(18),
    fontWeight: '800',
    color: '#FFFFFF',
  },

  // Controls Row
  controlsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: scale(16),
    marginTop: verticalScale(16),
  },
  gstToggleBox: {
    flexDirection: 'row',
    backgroundColor: 'rgba(0, 0, 0, 0.15)',
    borderRadius: 10,
    padding: scale(3),
  },
  gstToggleBtn: {
    paddingHorizontal: scale(12),
    paddingVertical: verticalScale(8),
    borderRadius: 8,
  },
  activeGstBtn: {
    backgroundColor: '#FFFFFF',
  },
  gstToggleBtnText: {
    fontSize: responsiveFontSize(11),
    fontWeight: '800',
    color: 'rgba(255, 255, 255, 0.85)',
  },
  activeGstBtnText: {
    color: '#27AE60',
  },
  shareBtn: {
    backgroundColor: '#000000',
    paddingHorizontal: scale(16),
    paddingVertical: verticalScale(10),
    borderRadius: 10,
  },
  shareBtnText: {
    fontSize: responsiveFontSize(12),
    color: '#FFFFFF',
    fontWeight: '800',
  },

  // Dynamic filter tabs row
  filterTabsWrapper: {
    paddingVertical: verticalScale(12),
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  tabsScrollContent: {
    paddingHorizontal: scale(16),
    gap: verticalScale(10),
  },
  filterTab: {
    paddingHorizontal: scale(16),
    paddingVertical: verticalScale(8),
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
    fontSize: responsiveFontSize(12),
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
    paddingHorizontal: scale(16),
    paddingVertical: verticalScale(10),
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F7F9FC',
    borderRadius: 10,
    paddingHorizontal: scale(12),
    height: verticalScale(38),
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  searchIcon: {
    fontSize: responsiveFontSize(14),
    marginRight: scale(6),
  },
  searchInput: {
    flex: 1,
    fontSize: responsiveFontSize(13),
    color: '#2D3748',
    padding: 0,
  },
  clearSearch: {
    fontSize: responsiveFontSize(14),
    color: '#A0AEC0',
    paddingLeft: scale(6),
  },

  // Table header
  tableHeaderRow: {
    flexDirection: 'row',
    paddingHorizontal: scale(16),
    paddingVertical: verticalScale(10),
    backgroundColor: '#EDF2F7',
    borderBottomWidth: 1,
    borderBottomColor: '#CBD5E0',
  },
  thText: {
    fontSize: responsiveFontSize(10.5),
    fontWeight: '850',
    color: '#4A5568',
    textTransform: 'uppercase',
  },

  // Table Row Cards
  listContainer: {
    paddingHorizontal: scale(16),
    paddingVertical: verticalScale(10),
  },
  tableRowCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: scale(12),
    marginBottom: verticalScale(8),
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  tdText: {
    fontSize: responsiveFontSize(13.5),
    fontWeight: '650',
    color: '#2D3748',
  },
  sNoText: {
    textAlign: 'center',
    color: '#718096',
    fontWeight: '600',
  },
  productNameText: {
    fontSize: responsiveFontSize(13),
    fontWeight: '800',
    color: '#1A202C',
  },
  productPackSizeText: {
    fontSize: responsiveFontSize(10.5),
    color: '#718096',
    fontWeight: '600',
    marginTop: verticalScale(2),
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
    paddingVertical: verticalScale(80),
  },
  emptyIcon: {
    fontSize: responsiveFontSize(48),
    marginBottom: verticalScale(16),
    opacity: 0.5,
  },
  emptyTitle: {
    fontSize: responsiveFontSize(16),
    fontWeight: '800',
    color: '#2D3748',
    marginBottom: verticalScale(4),
  },
  emptyDesc: {
    fontSize: responsiveFontSize(12),
    color: '#718096',
  },

  // Sharing Modal Styles
  shareModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: scale(20),
  },
  shareModalContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: scale(20),
    maxHeight: '80%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 5,
  },
  shareModalTitle: {
    fontSize: responsiveFontSize(15),
    fontWeight: '800',
    color: '#2D3748',
    marginBottom: verticalScale(14),
    textAlign: 'center',
  },
  modalSearchBox: {
    height: verticalScale(38),
    backgroundColor: '#F7F9FC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    paddingHorizontal: scale(12),
    justifyContent: 'center',
    marginBottom: verticalScale(10),
  },
  modalSearchInput: {
    fontSize: responsiveFontSize(13),
    color: '#2D3748',
    padding: 0,
  },
  partiesScrollWrapper: {
    maxHeight: 180,
    marginBottom: verticalScale(12),
  },
  partyOptionItem: {
    paddingVertical: verticalScale(10),
    paddingHorizontal: scale(12),
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    marginBottom: verticalScale(6),
    backgroundColor: '#F7F9FC',
  },
  activePartyOptionItem: {
    borderColor: '#27AE60',
    backgroundColor: '#EBFBEF',
  },
  partyOptionName: {
    fontSize: responsiveFontSize(12.5),
    fontWeight: '800',
    color: '#2D3748',
  },
  partyOptionMeta: {
    fontSize: responsiveFontSize(10.5),
    color: '#718096',
    marginTop: verticalScale(2),
    fontWeight: '600',
  },
  phoneInputLabel: {
    fontSize: responsiveFontSize(11),
    fontWeight: '850',
    color: '#718096',
    textTransform: 'uppercase',
    marginTop: verticalScale(10),
    marginBottom: verticalScale(6),
  },
  customHint: {
    fontSize: 11,
    color: '#718096',
    marginTop: 6,
    lineHeight: 15,
  },
  phoneInput: {
    height: verticalScale(42),
    backgroundColor: '#F7F9FC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    paddingHorizontal: scale(12),
    fontSize: responsiveFontSize(14),
    color: '#2D3748',
    fontWeight: '700',
    marginBottom: verticalScale(16),
  },
  shareModalFooter: {
    flexDirection: 'row',
    gap: verticalScale(10),
    marginTop: verticalScale(10),
  },
  closeBtn: {
    flex: 1,
    height: verticalScale(42),
    backgroundColor: '#EDF2F7',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    fontSize: responsiveFontSize(13.5),
    fontWeight: '700',
    color: '#4A5568',
  },
  sendBtn: {
    flex: 1.5,
    height: verticalScale(42),
    backgroundColor: '#27AE60',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnText: {
    fontSize: responsiveFontSize(13.5),
    fontWeight: '800',
    color: '#FFFFFF',
  },
});
