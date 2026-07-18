import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ActivityIndicator,
  SafeAreaView,
  ScrollView,
  Image,
  Modal,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';

export default function PartyProfileScreen({ token, apiUrl, partyId, onBack, onNavigateToOrder }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [profile, setProfile] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');

  // Expanded orders in profile
  const [expandedOrders, setExpandedOrders] = useState({});

  // Allocation modal states
  const [allocationModalVisible, setAllocationModalVisible] = useState(false);
  const [loadingFinance, setLoadingFinance] = useState(false);
  const [financeData, setFinanceData] = useState(null);
  const [selectedPaymentId, setSelectedPaymentId] = useState(null);
  const [allocationInputs, setAllocationInputs] = useState({}); // { [invoiceId]: amount }
  const [submittingAllocation, setSubmittingAllocation] = useState(false);

  // Replacement modal states
  const [replacementModalVisible, setReplacementModalVisible] = useState(false);
  const [selectedOrderForReplace, setSelectedOrderForReplace] = useState(null);
  const [replaceQuantities, setReplaceQuantities] = useState({}); // { [variantId]: quantity }
  const [replaceRemarks, setReplaceRemarks] = useState('');
  const [submittingReplacement, setSubmittingReplacement] = useState(false);

  const toggleExpandOrder = (id) => {
    setExpandedOrders(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const handleOpenReplacementModal = (order) => {
    setSelectedOrderForReplace(order);
    const initialQtys = {};
    (order.items || []).forEach(it => {
      initialQtys[it.variantId] = 0;
    });
    setReplaceQuantities(initialQtys);
    setReplaceRemarks('');
    setReplacementModalVisible(true);
  };

  const updateReplaceQty = (variantId, maxQty, increment) => {
    setReplaceQuantities(prev => {
      const current = prev[variantId] || 0;
      let next = current + (increment ? 1 : -1);
      if (next < 0) next = 0;
      if (next > maxQty) next = maxQty;
      return { ...prev, [variantId]: next };
    });
  };

  const handleSubmitReplacement = async () => {
    if (!selectedOrderForReplace) return;
    if (!replaceRemarks.trim()) {
      Alert.alert('Required', 'Please enter a reason or remarks for this replacement.');
      return;
    }

    const itemsToReplace = [];
    (selectedOrderForReplace.items || []).forEach(it => {
      const qty = replaceQuantities[it.variantId] || 0;
      if (qty > 0) {
        itemsToReplace.push({
          productId: it.productId,
          variantId: it.variantId,
          quantity: qty,
        });
      }
    });

    if (itemsToReplace.length === 0) {
      Alert.alert('Required', 'Please select at least one item to replace by clicking +.');
      return;
    }

    setSubmittingReplacement(true);
    try {
      const response = await fetch(`${apiUrl}/order/replacement`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          originalOrderId: selectedOrderForReplace._id,
          items: itemsToReplace,
          remarks: replaceRemarks,
        }),
      });

      const data = await response.json();
      if (response.ok && data.success) {
        Alert.alert('Success', 'Replacement order created successfully!');
        setReplacementModalVisible(false);
        loadProfile(); // refresh profile data
      } else {
        Alert.alert('Failed', data.message || 'Could not create replacement.');
      }
    } catch (e) {
      console.warn('Replacement submit error:', e.message);
      Alert.alert('Error', 'Network error during submission.');
    } finally {
      setSubmittingReplacement(false);
    }
  };

  const handleOpenAllocationModal = async () => {
    setAllocationModalVisible(true);
    setLoadingFinance(true);
    setSelectedPaymentId(null);
    setAllocationInputs({});
    setFinanceData(null);
    try {
      const response = await fetch(`${apiUrl}/finance/party/${partyId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (response.ok && data.success) {
        setFinanceData(data.data);
        const unallocatedPayments = (data.data.payments || []).filter(
          (p) => (p.unallocatedAmount || 0) > 0 && !['bounced', 'completed'].includes(p.status)
        );
        if (unallocatedPayments.length > 0) {
          setSelectedPaymentId(unallocatedPayments[0]._id);
        }
      } else {
        Alert.alert('Error', 'Could not load finance records.');
      }
    } catch (e) {
      console.warn('Finance fetch error:', e.message);
      Alert.alert('Error', 'Failed to retrieve billing records.');
    } finally {
      setLoadingFinance(false);
    }
  };

  const handleSubmitAllocation = async () => {
    if (!selectedPaymentId) {
      Alert.alert('Required', 'Please select a payment receipt to allocate.');
      return;
    }

    const payment = (financeData.payments || []).find((p) => p._id === selectedPaymentId);
    if (!payment) return;

    const allocationsList = [];
    let totalAllocated = 0;

    Object.keys(allocationInputs).forEach((invId) => {
      const amt = parseFloat(allocationInputs[invId]);
      if (amt > 0) {
        allocationsList.push({
          invoiceId: invId,
          amount: amt,
        });
        totalAllocated += amt;
      }
    });

    if (allocationsList.length === 0) {
      Alert.alert('Required', 'Please allocate a positive amount to at least one bill.');
      return;
    }

    if (totalAllocated > payment.unallocatedAmount + 0.01) {
      Alert.alert(
        'Validation Error',
        `Total allocations (₹${totalAllocated}) cannot exceed the payment's unallocated amount (₹${payment.unallocatedAmount}).`
      );
      return;
    }

    setSubmittingAllocation(true);
    try {
      const response = await fetch(`${apiUrl}/finance/payment/${selectedPaymentId}/allocate`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          allocations: allocationsList,
        }),
      });

      const data = await response.json();
      if (response.ok && data.success) {
        Alert.alert(
          'Success',
          'Payment allocation request submitted! Settlements will show once authorized by accounting.'
        );
        setAllocationModalVisible(false);
        loadProfile();
      } else {
        Alert.alert('Failed', data.message || 'Could not complete allocation.');
      }
    } catch (e) {
      console.warn('Allocation error:', e.message);
      Alert.alert('Error', 'Connection error.');
    } finally {
      setSubmittingAllocation(false);
    }
  };

  useEffect(() => {
    loadProfile();
  }, [partyId]);

  const loadProfile = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`${apiUrl}/parties/${partyId}/profile`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (response.ok) {
        setProfile(data.data);
      } else {
        throw new Error(data.message || 'Failed to load party profile.');
      }
    } catch (err) {
      setError(err.message || 'Connection error.');
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  const formatDateTime = (dateStr) => {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  };

  const formatCurrency = (amount) => {
    if (amount == null) return '₹0';
    return '₹' + Number(amount).toLocaleString('en-IN');
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'visited': return '#38A169';
      case 'short_visit': return '#D69E2E';
      case 'ongoing': return '#3182CE';
      case 'not_visited': return '#E53E3E';
      case 'approved': return '#38A169';
      case 'pending': return '#D69E2E';
      case 'dispatched': return '#3182CE';
      case 'delivered': return '#276749';
      case 'cancelled': return '#E53E3E';
      default: return '#718096';
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={onBack}>
            <Text style={styles.backBtnText}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Party Profile</Text>
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator color="#00796B" size="large" />
          <Text style={styles.loadingText}>Loading profile...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error || !profile) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={onBack}>
            <Text style={styles.backBtnText}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Party Profile</Text>
        </View>
        <View style={styles.loadingContainer}>
          <Text style={styles.errorText}>{error || 'Profile not available.'}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={loadProfile}>
            <Text style={styles.retryBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const { party, recentOrders, recentVisits, recentCollections, stats } = profile;

  let pendingUnallocated = 0;
  let pendingAllocated = 0;

  (recentCollections || []).forEach((c) => {
    if (['pending', 'unallocated', 'allocated_pending', 'pending_verification', 'pending_handover', 'received'].includes(c.status)) {
      const allocations = c.allocations || [];
      const pendingAllocationsAmt = allocations
        .filter((a) => a.status === 'pending')
        .reduce((sum, a) => sum + Number(a.amount || 0), 0);

      const totalUnallocated = Number(c.unallocatedAmount ?? c.amount ?? 0);

      pendingAllocated += pendingAllocationsAmt;
      pendingUnallocated += Math.max(0, totalUnallocated - pendingAllocationsAmt);
    }
  });

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Header */}
      <View style={styles.header}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <TouchableOpacity style={styles.backBtn} onPress={onBack}>
            <Text style={styles.backBtnText}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Party Profile</Text>
        </View>
        <TouchableOpacity 
          style={styles.headerOrderBtn}
          onPress={() => onNavigateToOrder && onNavigateToOrder(party)}
        >
          <Text style={styles.headerOrderBtnText}>📦 Order</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Party Info Card */}
        <View style={styles.profileCard}>
          {party.shopPhoto ? (
            <Image
              source={{ uri: party.shopPhoto }}
              style={styles.shopPhoto}
              resizeMode="cover"
            />
          ) : (
            <View style={styles.shopPhotoPlaceholder}>
              <Text style={styles.shopPhotoPlaceholderText}>📷 No Photo</Text>
            </View>
          )}

          <Text style={styles.profileName}>{party.partyName}</Text>
          <Text style={styles.profileCode}>{party.partyCode}</Text>

          {party.ownerName ? (
            <Text style={styles.profileDetail}>👤 {party.ownerName}</Text>
          ) : null}
          <Text style={styles.profileDetail}>📞 {party.mobile}</Text>
          <Text style={styles.profileDetail}>📍 {party.address}</Text>
          {party.area ? <Text style={styles.profileDetail}>🏘️ {party.area}, {party.city}, {party.state} - {party.pincode}</Text> : null}
          {party.email ? <Text style={styles.profileDetail}>✉️ {party.email}</Text> : null}
          {party.gstNo ? <Text style={styles.profileDetail}>🏛️ GST: {party.gstNo}</Text> : null}
          {party.assignedSalesman ? (
            <Text style={styles.profileDetail}>👨‍💼 Salesman: {party.assignedSalesman.name} ({party.assignedSalesman.mobile})</Text>
          ) : null}
        </View>

        {/* Stats Cards */}
        <View style={styles.statsRow}>
          <View style={[styles.statCard, { backgroundColor: '#FFF5F5', padding: 12 }]}>
            <Text style={[styles.statValue, { color: '#E53E3E', fontSize: 15 }]}>{formatCurrency(party.currentOutstanding)}</Text>
            <Text style={[styles.statLabel, { fontSize: 9.5 }]}>Outstanding</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: '#EBF8FF', padding: 12 }]}>
            <Text style={[styles.statValue, { color: '#3182CE', fontSize: 15 }]}>{formatCurrency(party.advanceBalance || 0)}</Text>
            <Text style={[styles.statLabel, { fontSize: 9.5 }]}>Wallet Balance</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: '#F0FFF4', padding: 12 }]}>
            <Text style={[styles.statValue, { color: '#38A169', fontSize: 15 }]}>{formatCurrency(party.creditLimit)}</Text>
            <Text style={[styles.statLabel, { fontSize: 9.5 }]}>Credit Limit</Text>
          </View>
        </View>

        {/* Bill Allocation Callout */}
        <View style={styles.allocationCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.allocationCardTitle}>Settle Bills / Allocate Wallet</Text>
            <Text style={styles.allocationCardDesc}>
              Map unallocated collections of {formatCurrency(party.advanceBalance || 0)} to unpaid bills.
            </Text>
          </View>
          <TouchableOpacity
            style={styles.allocationActionBtn}
            onPress={handleOpenAllocationModal}
          >
            <Text style={styles.allocationActionBtnText}>Settle Bills</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.statsRow}>
          <View style={[styles.statCard, { backgroundColor: '#EBF8FF' }]}>
            <Text style={[styles.statValue, { color: '#3182CE' }]}>{stats.totalOrders}</Text>
            <Text style={styles.statLabel}>Total Orders</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: '#FEFCBF' }]}>
            <Text style={[styles.statValue, { color: '#D69E2E' }]}>{stats.totalVisits}</Text>
            <Text style={styles.statLabel}>Total Visits</Text>
          </View>
        </View>

        {/* Wallet Balance Details Card */}
        <View style={styles.walletDetailsCard}>
          <Text style={styles.walletDetailsTitle}>💳 Party Wallet Details</Text>
          <View style={styles.walletDetailsRow}>
            <Text style={styles.walletDetailsLabel}>Confirmed Wallet (Advance)</Text>
            <Text style={[styles.walletDetailsVal, { color: '#38A169' }]}>
              {formatCurrency(party.advanceBalance || 0)}
            </Text>
          </View>
          <View style={styles.walletDetailsDivider} />
          <View style={styles.walletDetailsRow}>
            <Text style={styles.walletDetailsLabel}>Pending Collection (Unallocated)</Text>
            <Text style={[styles.walletDetailsVal, { color: '#D69E2E' }]}>
              {formatCurrency(pendingUnallocated)}
            </Text>
          </View>
          <View style={styles.walletDetailsDivider} />
          <View style={styles.walletDetailsRow}>
            <Text style={styles.walletDetailsLabel}>Pending Collection (Allocated)</Text>
            <Text style={[styles.walletDetailsVal, { color: '#3182CE' }]}>
              {formatCurrency(pendingAllocated)}
            </Text>
          </View>
        </View>

        {/* Tabs */}
        <View style={styles.tabRow}>
          {['orders', 'visits', 'collections'].map((tab) => (
            <TouchableOpacity
              key={tab}
              style={[styles.tab, activeTab === tab && styles.tabActive]}
              onPress={() => setActiveTab(tab)}
            >
              <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
                {tab === 'orders' ? `Orders (${recentOrders.length})` :
                  tab === 'visits' ? `Visits (${recentVisits.length})` :
                    `Collections (${recentCollections.length})`}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Tab Content: Orders */}
        {activeTab === 'orders' && (
          <View style={styles.listSection}>
            {recentOrders.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyText}>No orders yet for this party.</Text>
              </View>
            ) : (
              recentOrders.map((order) => {
                const isExpanded = !!expandedOrders[order._id];
                return (
                  <View key={order._id} style={styles.listCardWrapper}>
                    <TouchableOpacity
                      style={styles.listCard}
                      activeOpacity={0.8}
                      onPress={() => toggleExpandOrder(order._id)}
                    >
                      <View style={styles.listCardRow}>
                        <Text style={styles.listCardTitle}>#{order.orderNumber}</Text>
                        <View style={[styles.statusBadge, { backgroundColor: getStatusColor(order.status) + '20' }]}>
                          <Text style={[styles.statusText, { color: getStatusColor(order.status) }]}>
                            {(order.status || 'pending').toUpperCase()}
                          </Text>
                        </View>
                      </View>
                      <Text style={styles.listCardSub}>
                        {formatDate(order.createdAt)} • {order.items?.length || 0} items
                      </Text>
                      <View style={styles.listCardFooter}>
                        <Text style={styles.listCardAmount}>{formatCurrency(order.totalAmount || order.grandTotal)}</Text>
                        <Text style={styles.expandLabelText}>
                          {isExpanded ? 'Hide Details ▲' : 'Show Details ▼'}
                        </Text>
                      </View>
                    </TouchableOpacity>

                    {/* Order Details & Replacement */}
                    {isExpanded && (
                      <View style={styles.orderDetailsBlock}>
                        <View style={styles.detailsDivider} />
                        <Text style={styles.sectionSubHeading}>Items in this Order:</Text>
                        {(order.items || []).map((subItem, index) => (
                          <View key={index} style={styles.subItemRow}>
                            <View style={{ flex: 1.5 }}>
                              <Text style={styles.subItemName}>{subItem.productName}</Text>
                              <Text style={styles.subItemVariant}>{subItem.variantName} • {subItem.packSize}</Text>
                            </View>
                            <Text style={styles.subItemQty}>Qty: {subItem.quantity}</Text>
                            <Text style={styles.subItemPrice}>₹{subItem.rate?.toFixed(2)}</Text>
                          </View>
                        ))}

                        {order.status !== 'cancelled' && (
                          <TouchableOpacity
                            style={styles.replacementActionBtn}
                            onPress={() => handleOpenReplacementModal(order)}
                          >
                            <Text style={styles.replacementActionBtnText}>🔁 Create Item Replacement</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    )}
                  </View>
                );
              })
            )}
          </View>
        )}

        {/* Tab Content: Visits */}
        {activeTab === 'visits' && (
          <View style={styles.listSection}>
            {recentVisits.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyText}>No visit history for this party.</Text>
              </View>
            ) : (
              recentVisits.map((visit) => (
                <View style={styles.listCard} key={visit._id}>
                  <View style={styles.listCardRow}>
                    <Text style={styles.listCardTitle}>
                      {formatDateTime(visit.arrivedAt)}
                    </Text>
                    <View style={[styles.statusBadge, { backgroundColor: getStatusColor(visit.status) + '20' }]}>
                      <Text style={[styles.statusText, { color: getStatusColor(visit.status) }]}>
                        {(visit.status || 'unknown').toUpperCase()}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.listCardSub}>
                    {visit.salesmanId?.name || '—'} • {visit.durationMinutes || 0} min • Valid: {Math.round((visit.validSeconds || 0) / 60)} min
                  </Text>
                  <View style={styles.visitIndicators}>
                    {visit.orderCreated && (
                      <View style={[styles.miniTag, { backgroundColor: '#C6F6D5' }]}>
                        <Text style={[styles.miniTagText, { color: '#276749' }]}>📦 Order</Text>
                      </View>
                    )}
                    {visit.collectionCreated && (
                      <View style={[styles.miniTag, { backgroundColor: '#BEE3F8' }]}>
                        <Text style={[styles.miniTagText, { color: '#2A4365' }]}>💰 Collection</Text>
                      </View>
                    )}
                  </View>
                </View>
              ))
            )}
          </View>
        )}

        {/* Tab Content: Collections */}
        {activeTab === 'collections' && (
          <View style={styles.listSection}>
            {recentCollections.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyText}>No collections recorded for this party.</Text>
              </View>
            ) : (
              recentCollections.map((col) => (
                <View style={styles.listCard} key={col._id}>
                  <View style={styles.listCardRow}>
                    <Text style={styles.listCardTitle}>#{col.collectionNumber}</Text>
                    <View style={[styles.statusBadge, { backgroundColor: getStatusColor(col.status) + '20' }]}>
                      <Text style={[styles.statusText, { color: getStatusColor(col.status) }]}>
                        {(col.status || 'pending').toUpperCase()}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.listCardSub}>
                    {formatDate(col.createdAt)} • {col.paymentMode || 'N/A'}
                  </Text>
                  <Text style={styles.listCardAmount}>{formatCurrency(col.amount)}</Text>
                </View>
              ))
            )}
          </View>
        )}

        {/* Notes */}
        {party.notes ? (
          <View style={styles.notesCard}>
            <Text style={styles.notesTitle}>📝 Notes</Text>
            <Text style={styles.notesText}>{party.notes}</Text>
          </View>
        ) : null}
      </ScrollView>
      {selectedOrderForReplace && (
        <Modal
          visible={replacementModalVisible}
          transparent
          animationType="slide"
          onRequestClose={() => setReplacementModalVisible(false)}
        >
          <SafeAreaView style={styles.modalOverlay}>
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
              style={styles.replacementModalWrapper}
            >
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitleText}>
                  Replacement for #{selectedOrderForReplace.orderNumber}
                </Text>
                <TouchableOpacity
                  style={styles.closeXBtn}
                  onPress={() => setReplacementModalVisible(false)}
                >
                  <Text style={styles.closeXText}>✕</Text>
                </TouchableOpacity>
              </View>

              <ScrollView contentContainerStyle={styles.replacementFormContent}>
                <Text style={styles.modalDescText}>
                  Select the items and quantities you want to replace. Quantities cannot exceed original quantities.
                </Text>

                {/* Reason Input */}
                <Text style={styles.fieldLabel}>Replacement Reason / Remarks *</Text>
                <TextInput
                  style={styles.remarksInput}
                  placeholder="e.g. Expired product or manufacturing defect..."
                  placeholderTextColor="#A0AEC0"
                  value={replaceRemarks}
                  onChangeText={setReplaceRemarks}
                />

                <Text style={styles.sectionHeading}>Select Items to Replace</Text>
                {(selectedOrderForReplace.items || []).map((it) => {
                  const selectQty = replaceQuantities[it.variantId] || 0;
                  return (
                    <View key={it.variantId} style={styles.modalItemRow}>
                      <View style={{ flex: 1.5 }}>
                        <Text style={styles.modalItemName}>{it.productName}</Text>
                        <Text style={styles.modalItemVariant}>{it.variantName} • {it.packSize}</Text>
                        <Text style={styles.modalItemOriginal}>Original Qty: {it.quantity}</Text>
                      </View>

                      {/* Quantity Selector */}
                      <View style={styles.modalQtyRow}>
                        <TouchableOpacity
                          style={[styles.qtyBtn, selectQty === 0 && styles.disabledQtyBtn]}
                          disabled={selectQty === 0}
                          onPress={() => updateReplaceQty(it.variantId, it.quantity, false)}
                        >
                          <Text style={styles.qtyBtnText}>−</Text>
                        </TouchableOpacity>
                        <Text style={styles.qtyText}>{selectQty}</Text>
                        <TouchableOpacity
                          style={[styles.qtyBtn, selectQty >= it.quantity && styles.disabledQtyBtn]}
                          disabled={selectQty >= it.quantity}
                          onPress={() => updateReplaceQty(it.variantId, it.quantity, true)}
                        >
                          <Text style={styles.qtyBtnText}>+</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })}
              </ScrollView>

              {/* Bottom Footer Actions */}
              <View style={styles.modalActionsFooter}>
                <TouchableOpacity
                  style={styles.cancelBtn}
                  onPress={() => setReplacementModalVisible(false)}
                >
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.submitReplacementBtn, submittingReplacement && styles.disabledSubmitBtn]}
                  onPress={handleSubmitReplacement}
                  disabled={submittingReplacement}
                >
                  {submittingReplacement ? (
                    <ActivityIndicator color="#FFFFFF" size="small" />
                  ) : (
                    <Text style={styles.submitReplacementBtnText}>Submit Replacement</Text>
                  )}
                </TouchableOpacity>
              </View>
            </KeyboardAvoidingView>
          </SafeAreaView>
        </Modal>
      )}

      {/* Bill Allocation Modal */}
      {allocationModalVisible && (
        <Modal
          visible={allocationModalVisible}
          transparent
          animationType="slide"
          onRequestClose={() => setAllocationModalVisible(false)}
        >
          <SafeAreaView style={styles.modalOverlay}>
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
              style={styles.allocModalWrapper}
            >
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitleText}>Settle Invoices</Text>
                <TouchableOpacity
                  style={styles.closeXBtn}
                  onPress={() => setAllocationModalVisible(false)}
                >
                  <Text style={styles.closeXText}>✕</Text>
                </TouchableOpacity>
              </View>

              {loadingFinance ? (
                <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                  <ActivityIndicator size="large" color="#00796B" />
                  <Text style={{ marginTop: 10, color: '#718096', fontSize: 13 }}>Loading billing records...</Text>
                </View>
              ) : (
                <ScrollView contentContainerStyle={styles.allocFormContent}>
                  <Text style={styles.modalDescText}>
                    Select a payment collection with unallocated balance, then enter the amount to apply to each pending invoice.
                  </Text>

                  {/* Payment selection list */}
                  <Text style={styles.fieldLabel}>1. Select Payment Receipt</Text>
                  <View style={styles.allocPaymentSelectBox}>
                    {financeData && financeData.payments && financeData.payments.filter(
                      p => (p.unallocatedAmount || 0) > 0 && !['bounced', 'completed'].includes(p.status)
                    ).length > 0 ? (
                      financeData.payments
                        .filter(p => (p.unallocatedAmount || 0) > 0 && !['bounced', 'completed'].includes(p.status))
                        .map((payment) => (
                          <TouchableOpacity
                            key={payment._id}
                            style={[
                              styles.paymentOptionCard,
                              selectedPaymentId === payment._id && styles.activePaymentOptionCard,
                            ]}
                            onPress={() => {
                              setSelectedPaymentId(payment._id);
                              setAllocationInputs({});
                            }}
                          >
                            <View style={{ flex: 1 }}>
                              <Text style={styles.paymentOptionText}>
                                Receipt #{payment.collectionNumber} ({payment.paymentMode.toUpperCase()})
                              </Text>
                              <Text style={{ fontSize: 10, color: '#A0AEC0', marginTop: 2 }}>
                                Date: {formatDate(payment.createdAt)}
                              </Text>
                            </View>
                            <View style={{ alignItems: 'flex-end' }}>
                              <Text style={styles.paymentOptionAmt}>
                                Unallocated: {formatCurrency(payment.unallocatedAmount)}
                              </Text>
                              <Text style={{ fontSize: 10, color: '#718096' }}>
                                Total: {formatCurrency(payment.amount)}
                              </Text>
                            </View>
                          </TouchableOpacity>
                        ))
                    ) : (
                      <Text style={{ fontSize: 13, color: '#E53E3E', textAlign: 'center', marginVertical: 10 }}>
                        No unallocated payments found for this customer.
                      </Text>
                    )}
                  </View>

                  {selectedPaymentId && financeData && (
                    <View style={{ marginTop: 10 }}>
                      <Text style={styles.fieldLabel}>2. Allocate to Pending Invoices</Text>
                      {financeData.invoices && financeData.invoices.filter(i => (i.balanceDue || 0) > 0 && i.status !== 'cancelled').length > 0 ? (
                        financeData.invoices
                          .filter(i => (i.balanceDue || 0) > 0 && i.status !== 'cancelled')
                          .map((invoice) => (
                            <View key={invoice._id} style={styles.allocInvoiceItem}>
                              <View style={styles.allocInvoiceHeader}>
                                <View style={{ flex: 1 }}>
                                  <Text style={styles.allocInvoiceTitle}>Invoice #{invoice.invoiceNumber}</Text>
                                  <Text style={styles.allocInvoiceDate}>Date: {formatDate(invoice.invoiceDate)}</Text>
                                </View>
                                <View style={{ alignItems: 'flex-end' }}>
                                  <Text style={styles.allocInvoiceDue}>
                                    Due: {formatCurrency(invoice.balanceDue)}
                                  </Text>
                                  <Text style={{ fontSize: 10, color: '#A0AEC0' }}>
                                    Total: {formatCurrency(invoice.originalAmount)}
                                  </Text>
                                </View>
                              </View>
                              <TextInput
                                style={styles.allocAmountInput}
                                placeholder="Enter allocation amount (INR)..."
                                placeholderTextColor="#A0AEC0"
                                keyboardType="numeric"
                                value={allocationInputs[invoice._id] || ''}
                                onChangeText={(val) => setAllocationInputs(prev => ({ ...prev, [invoice._id]: val }))}
                              />
                            </View>
                          ))
                      ) : (
                        <Text style={{ fontSize: 13, color: '#38A169', textAlign: 'center', marginVertical: 10 }}>
                          No unpaid invoices found for this customer.
                        </Text>
                      )}
                    </View>
                  )}
                </ScrollView>
              )}

              {/* Footer Actions */}
              <View style={styles.modalActionsFooter}>
                <TouchableOpacity
                  style={styles.cancelBtn}
                  onPress={() => setAllocationModalVisible(false)}
                >
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.submitReplacementBtn,
                    (!selectedPaymentId || submittingAllocation) && styles.disabledSubmitBtn,
                  ]}
                  disabled={!selectedPaymentId || submittingAllocation}
                  onPress={handleSubmitAllocation}
                >
                  {submittingAllocation ? (
                    <ActivityIndicator color="#FFFFFF" size="small" />
                  ) : (
                    <Text style={styles.submitReplacementBtnText}>Submit Allocation</Text>
                  )}
                </TouchableOpacity>
              </View>
            </KeyboardAvoidingView>
          </SafeAreaView>
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
  header: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
  },
  headerOrderBtn: {
    backgroundColor: '#00796B',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  headerOrderBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 12.5,
  },
  backBtn: {
    paddingVertical: 8,
    paddingRight: 16,
  },
  backBtnText: {
    color: '#00796B',
    fontWeight: '700',
    fontSize: 14.5,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#2D3748',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    color: '#718096',
    fontSize: 13,
  },
  errorText: {
    color: '#E53E3E',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    paddingHorizontal: 30,
  },
  retryBtn: {
    marginTop: 12,
    paddingHorizontal: 24,
    paddingVertical: 10,
    backgroundColor: '#00796B',
    borderRadius: 8,
  },
  retryBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 13,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  // Profile card
  profileCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 16,
    alignItems: 'center',
  },
  shopPhoto: {
    width: '100%',
    height: 180,
    borderRadius: 12,
    marginBottom: 14,
    backgroundColor: '#EDF2F7',
  },
  shopPhotoPlaceholder: {
    width: '100%',
    height: 120,
    borderRadius: 12,
    backgroundColor: '#EDF2F7',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
  },
  shopPhotoPlaceholderText: {
    color: '#A0AEC0',
    fontSize: 14,
    fontWeight: '600',
  },
  profileName: {
    fontSize: 20,
    fontWeight: '800',
    color: '#1A202C',
    textAlign: 'center',
  },
  profileCode: {
    fontSize: 13,
    color: '#718096',
    fontWeight: '600',
    marginBottom: 10,
  },
  profileDetail: {
    fontSize: 13,
    color: '#4A5568',
    marginTop: 4,
    textAlign: 'center',
  },
  // Stats
  statsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  statCard: {
    flex: 1,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  statValue: {
    fontSize: 18,
    fontWeight: '800',
  },
  statLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#718096',
    textTransform: 'uppercase',
    marginTop: 4,
    letterSpacing: 0.5,
  },
  // Tabs
  tabRow: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 12,
    overflow: 'hidden',
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
  },
  tabActive: {
    backgroundColor: '#00796B',
  },
  tabText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#718096',
  },
  tabTextActive: {
    color: '#FFFFFF',
  },
  // List section
  listSection: {
    gap: 10,
  },
  listCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  listCardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  listCardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#2D3748',
    flex: 1,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  statusText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  listCardSub: {
    fontSize: 12,
    color: '#718096',
    marginBottom: 4,
  },
  listCardAmount: {
    fontSize: 15,
    fontWeight: '800',
    color: '#1A202C',
  },
  visitIndicators: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 6,
  },
  miniTag: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  miniTagText: {
    fontSize: 11,
    fontWeight: '700',
  },
  emptyCard: {
    padding: 30,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
  },
  emptyText: {
    color: '#718096',
    fontSize: 13,
    textAlign: 'center',
  },
  // Notes
  notesCard: {
    backgroundColor: '#FFFFF0',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#FEFCBF',
    marginTop: 16,
  },
  notesTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#744210',
    marginBottom: 6,
  },
  notesText: {
    fontSize: 13,
    color: '#744210',
    lineHeight: 20,
  },
  // Replacement Styles
  listCardWrapper: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 10,
    overflow: 'hidden',
  },
  listCardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  expandLabelText: {
    fontSize: 11,
    color: '#00796B',
    fontWeight: '700',
  },
  orderDetailsBlock: {
    paddingHorizontal: 12,
    paddingBottom: 12,
    backgroundColor: '#FAFBFD',
  },
  detailsDivider: {
    height: 1,
    backgroundColor: '#EDF2F7',
    marginBottom: 8,
  },
  sectionSubHeading: {
    fontSize: 11.5,
    fontWeight: '800',
    color: '#718096',
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  subItemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: '#EDF2F7',
  },
  subItemName: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#2D3748',
  },
  subItemVariant: {
    fontSize: 10.5,
    color: '#A0AEC0',
    marginTop: 1,
  },
  subItemQty: {
    fontSize: 12,
    fontWeight: '700',
    color: '#4A5568',
    marginHorizontal: 8,
  },
  subItemPrice: {
    fontSize: 12,
    fontWeight: '700',
    color: '#2D3748',
  },
  replacementActionBtn: {
    marginTop: 10,
    height: 36,
    backgroundColor: '#00BFA5',
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  replacementActionBtnText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 12,
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  replacementModalWrapper: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    height: '80%',
  },
  replacementFormContent: {
    padding: 16,
    paddingBottom: 30,
  },
  modalDescText: {
    fontSize: 12.5,
    color: '#718096',
    lineHeight: 18,
    marginBottom: 16,
  },
  remarksInput: {
    height: 40,
    backgroundColor: '#F7F9FC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    paddingHorizontal: 12,
    color: '#2D3748',
    fontSize: 13,
    marginTop: 6,
    marginBottom: 16,
  },
  modalItemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#EDF2F7',
  },
  modalItemName: {
    fontSize: 13.5,
    fontWeight: '700',
    color: '#2D3748',
  },
  modalItemVariant: {
    fontSize: 11,
    color: '#A0AEC0',
    marginTop: 1,
  },
  modalItemOriginal: {
    fontSize: 11,
    fontWeight: '600',
    color: '#718096',
    marginTop: 2,
  },
  modalQtyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#00796B',
    borderRadius: 6,
    overflow: 'hidden',
    height: 28,
  },
  qtyBtn: {
    width: 24,
    height: '100%',
    backgroundColor: '#E6FFFA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabledQtyBtn: {
    backgroundColor: '#EDF2F7',
  },
  qtyBtnText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#00796B',
  },
  qtyText: {
    width: 24,
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '700',
    color: '#1A202C',
  },
  modalActionsFooter: {
    flexDirection: 'row',
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
    gap: 12,
  },
  cancelBtn: {
    flex: 1,
    height: 44,
    backgroundColor: '#EDF2F7',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#4A5568',
  },
  submitReplacementBtn: {
    flex: 1.5,
    height: 44,
    backgroundColor: '#00796B',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabledSubmitBtn: {
    backgroundColor: '#CBD5E0',
  },
  submitReplacementBtnText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  closeXBtn: {
    padding: 4,
  },
  closeXText: {
    fontSize: 18,
    color: '#A0AEC0',
    fontWeight: '600',
  },
  modalTitleText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#2D3748',
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#718096',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionHeading: {
    fontSize: 12.5,
    fontWeight: '800',
    color: '#00796B',
    textTransform: 'uppercase',
    marginTop: 8,
    marginBottom: 6,
  },

  // Allocation Styles
  allocationCard: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
    marginBottom: 16,
  },
  allocationCardTitle: {
    fontSize: 13.5,
    fontWeight: '800',
    color: '#2D3748',
  },
  allocationCardDesc: {
    fontSize: 11,
    color: '#718096',
    marginTop: 4,
    paddingRight: 10,
  },
  allocationActionBtn: {
    backgroundColor: '#00796B',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  allocationActionBtnText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 12,
  },
  allocModalWrapper: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    height: '85%',
  },
  allocFormContent: {
    padding: 16,
    paddingBottom: 30,
  },
  allocPaymentSelectBox: {
    backgroundColor: '#F7F9FC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
  },
  allocPaymentSelectTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: '#718096',
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  paymentOptionCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  activePaymentOptionCard: {
    borderColor: '#00796B',
    backgroundColor: '#E6FFFA',
  },
  paymentOptionText: {
    fontSize: 12,
    fontWeight: '750',
    color: '#4A5568',
  },
  paymentOptionAmt: {
    fontSize: 12.5,
    fontWeight: '800',
    color: '#2D3748',
  },
  allocInvoiceItem: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
  },
  allocInvoiceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  allocInvoiceTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#2D3748',
  },
  allocInvoiceDate: {
    fontSize: 10.5,
    color: '#A0AEC0',
    fontWeight: '600',
  },
  allocInvoiceDue: {
    fontSize: 12,
    color: '#E53E3E',
    fontWeight: '700',
  },
  allocAmountInput: {
    height: 38,
    backgroundColor: '#F7F9FC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 6,
    paddingHorizontal: 10,
    fontSize: 12.5,
    color: '#2D3748',
  },

  // Wallet details card styles
  walletDetailsCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 16,
    marginBottom: 16,
  },
  walletDetailsTitle: {
    fontSize: 12,
    fontWeight: '805',
    color: '#2D3748',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  walletDetailsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  walletDetailsLabel: {
    fontSize: 12,
    color: '#718096',
    fontWeight: '650',
  },
  walletDetailsVal: {
    fontSize: 13.5,
    fontWeight: '800',
  },
  walletDetailsDivider: {
    height: 1,
    backgroundColor: '#F7F9FC',
    marginVertical: 8,
  },
});
