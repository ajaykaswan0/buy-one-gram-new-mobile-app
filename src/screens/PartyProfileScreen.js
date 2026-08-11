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
import { scale, verticalScale, responsiveFontSize, maxContainerWidth } from '../utils/responsive';

export default function PartyProfileScreen({ token, apiUrl, partyId, onBack, onNavigateToOrder, onNavigateToCollection }) {
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
  const [issueModalVisible, setIssueModalVisible] = useState(false);
  const [issueCategory, setIssueCategory] = useState('service');
  const [issuePriority, setIssuePriority] = useState('medium');
  const [issueSubject, setIssueSubject] = useState('');
  const [issueDescription, setIssueDescription] = useState('');
  const [submittingIssue, setSubmittingIssue] = useState(false);

  const handleSubmitIssue = async () => {
    if (!issueSubject.trim() || !issueDescription.trim()) {
      Alert.alert('Required', 'Please enter the issue subject and full details.');
      return;
    }
    setSubmittingIssue(true);
    try {
      const response = await fetch(`${apiUrl}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          type: 'issue',
          targetType: 'party',
          partyId,
          category: issueCategory,
          priority: issuePriority,
          subject: issueSubject.trim(),
          description: issueDescription.trim(),
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || 'Could not raise issue.');
      setIssueModalVisible(false);
      setIssueSubject('');
      setIssueDescription('');
      Alert.alert('Issue Raised', `${result.data?.issueNumber || 'Issue'} has been sent to Admin.`);
    } catch (err) {
      Alert.alert('Failed', err.message || 'Could not raise issue.');
    } finally {
      setSubmittingIssue(false);
    }
  };

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
      const response = await fetch(`${apiUrl}/sales-return`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          orderId: selectedOrderForReplace._id,
          items: itemsToReplace,
          reason: replaceRemarks,
        }),
      });

      const data = await response.json();
      if (response.ok && data.success) {
        Alert.alert('Success', 'Replacement request created successfully!');
        setReplacementModalVisible(false);
        loadProfile(); // refresh profile data
      } else {
        Alert.alert('Failed', data.message || 'Could not create replacement request.');
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
      const headers = { Authorization: `Bearer ${token}` };
      const [response, financeResponse] = await Promise.all([
        fetch(`${apiUrl}/parties/${partyId}/profile`, { headers }),
        fetch(`${apiUrl}/finance/party/${partyId}`, { headers }),
      ]);
      const [data, financeResult] = await Promise.all([
        response.json(),
        financeResponse.json(),
      ]);
      if (response.ok) {
        setProfile(data.data);
        setFinanceData(financeResponse.ok && financeResult.success ? financeResult.data : null);
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
  let pendingAllocated = Number(financeData?.summary?.pendingAllocated || 0);

  (financeData?.payments || recentCollections || []).forEach((c) => {
    if (['pending', 'unallocated', 'allocated_pending', 'pending_verification', 'pending_handover', 'received'].includes(c.status)) {
      const allocations = c.allocations || [];
      const pendingAllocationsAmt = allocations
        .filter((a) => a.status === 'pending')
        .reduce((sum, a) => sum + Number(a.amount || 0), 0);

      const totalUnallocated = Number(c.unallocatedAmount ?? c.amount ?? 0);

      if (!financeData) pendingAllocated += pendingAllocationsAmt;
      pendingUnallocated += Math.max(0, totalUnallocated - pendingAllocationsAmt);
    }
  });

  const invoiceByOrderId = new Map();
  (financeData?.invoices || []).forEach((invoice) => {
    const orderId = invoice.orderId?._id || invoice.orderId;
    if (orderId) invoiceByOrderId.set(String(orderId), invoice);
  });
  const pendingByInvoiceId = new Map();
  (financeData?.payments || []).forEach((payment) => {
    (payment.allocations || []).forEach((allocation) => {
      if (allocation.status !== 'pending') return;
      const invoiceId = allocation.invoiceId?._id || allocation.invoiceId;
      if (!invoiceId) return;
      pendingByInvoiceId.set(
        String(invoiceId),
        Number(pendingByInvoiceId.get(String(invoiceId)) || 0) + Number(allocation.amount || 0)
      );
    });
  });
  const netOutstanding = Number(financeData?.summary?.netOutstanding ?? party.currentOutstanding ?? 0);

  const getOrderPaymentState = (order) => {
    if (order.paymentType === 'prepaid') return { label: 'PAID', color: '#38A169' };
    const invoice = invoiceByOrderId.get(String(order._id));
    if (!invoice) {
      return order.paymentType === 'cod'
        ? { label: 'COD', color: '#D69E2E' }
        : { label: 'UNPAID', color: '#E53E3E' };
    }
    const total = Number(invoice.originalAmount || order.netPayableAmount || order.grandTotal || order.totalAmount || 0);
    const confirmed = Math.max(0, total - Number(invoice.balanceDue || 0));
    const pending = Number(pendingByInvoiceId.get(String(invoice._id)) || 0);
    const allocated = Math.min(total, confirmed + pending);
    if (invoice.status === 'paid' || (total > 0 && allocated >= total - 0.01)) {
      return { label: pending > 0 ? 'FULLY ALLOCATED' : 'PAID', color: '#38A169' };
    }
    if (allocated > 0) return { label: `PARTIAL ${formatCurrency(allocated)}`, color: '#D69E2E' };
    return { label: 'UNPAID', color: '#E53E3E' };
  };

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
          onPress={() => onNavigateToCollection && onNavigateToCollection(party)}
        >
          <Text style={styles.headerOrderBtnText}>₹ Collect</Text>
        </TouchableOpacity>
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

        <TouchableOpacity style={styles.raiseIssueBtn} onPress={() => setIssueModalVisible(true)}>
          <Text style={styles.raiseIssueBtnText}>⚠ Raise Issue for {party.partyName}</Text>
        </TouchableOpacity>

        {/* Stats Cards */}
        <View style={styles.statsRow}>
          <View style={[styles.statCard, { backgroundColor: '#FFF5F5', padding: 12 }]}>
            <Text style={[styles.statValue, { color: '#E53E3E', fontSize: 15 }]}>{formatCurrency(netOutstanding)}</Text>
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
                const paymentState = getOrderPaymentState(order);
                const orderTotal = order.netPayableAmount ?? order.grandTotal ?? order.totalAmount ?? 0;
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
                      <View style={[styles.paymentBadge, { backgroundColor: paymentState.color + '18' }]}>
                        <View style={[styles.paymentDot, { backgroundColor: paymentState.color }]} />
                        <Text style={[styles.paymentBadgeText, { color: paymentState.color }]}>
                          {paymentState.label}
                        </Text>
                      </View>
                      <View style={styles.listCardFooter}>
                        <Text style={styles.listCardAmount}>Total: {formatCurrency(orderTotal)}</Text>
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
      <Modal
        visible={issueModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setIssueModalVisible(false)}
      >
        <SafeAreaView style={styles.modalOverlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={styles.issueModalWrapper}
          >
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitleText}>Raise Party Issue</Text>
                <Text style={styles.issuePartyName}>{profile?.party?.partyName}</Text>
              </View>
              <TouchableOpacity style={styles.closeXBtn} onPress={() => setIssueModalVisible(false)}>
                <Text style={styles.closeXText}>✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={styles.replacementFormContent}>
              <Text style={styles.fieldLabel}>Category</Text>
              <View style={styles.issueChoiceRow}>
                {['payment', 'order', 'delivery', 'service', 'product', 'behaviour', 'other'].map((value) => (
                  <TouchableOpacity
                    key={value}
                    style={[styles.issueChoice, issueCategory === value && styles.issueChoiceActive]}
                    onPress={() => setIssueCategory(value)}
                  >
                    <Text style={[styles.issueChoiceText, issueCategory === value && styles.issueChoiceTextActive]}>
                      {value.replace('_', ' ').toUpperCase()}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={styles.fieldLabel}>Priority</Text>
              <View style={styles.issueChoiceRow}>
                {['low', 'medium', 'high', 'critical'].map((value) => (
                  <TouchableOpacity
                    key={value}
                    style={[styles.issueChoice, issuePriority === value && styles.issueChoiceActive]}
                    onPress={() => setIssuePriority(value)}
                  >
                    <Text style={[styles.issueChoiceText, issuePriority === value && styles.issueChoiceTextActive]}>
                      {value.toUpperCase()}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={styles.fieldLabel}>Subject *</Text>
              <TextInput
                style={styles.issueInput}
                value={issueSubject}
                onChangeText={setIssueSubject}
                placeholder="Short summary of the problem"
                placeholderTextColor="#A0AEC0"
              />
              <Text style={styles.fieldLabel}>Problem Details *</Text>
              <TextInput
                style={[styles.issueInput, styles.issueDescriptionInput]}
                value={issueDescription}
                onChangeText={setIssueDescription}
                multiline
                textAlignVertical="top"
                placeholder="Explain what happened and what help is required..."
                placeholderTextColor="#A0AEC0"
              />
            </ScrollView>
            <View style={styles.modalActionsFooter}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setIssueModalVisible(false)}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.submitReplacementBtn, submittingIssue && styles.disabledSubmitBtn]}
                onPress={handleSubmitIssue}
                disabled={submittingIssue}
              >
                {submittingIssue
                  ? <ActivityIndicator color="#FFFFFF" size="small" />
                  : <Text style={styles.submitReplacementBtnText}>Submit Issue</Text>}
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
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
    height: verticalScale(56),
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: scale(16),
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
  },
  headerOrderBtn: {
    backgroundColor: '#00796B',
    paddingHorizontal: scale(12),
    paddingVertical: verticalScale(6),
    borderRadius: 8,
  },
  headerOrderBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: responsiveFontSize(12.5),
  },
  backBtn: {
    paddingVertical: verticalScale(8),
    paddingRight: scale(16),
  },
  backBtnText: {
    color: '#00796B',
    fontWeight: '700',
    fontSize: responsiveFontSize(14.5),
  },
  headerTitle: {
    fontSize: responsiveFontSize(16),
    fontWeight: '700',
    color: '#2D3748',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: verticalScale(12),
  },
  loadingText: {
    color: '#718096',
    fontSize: responsiveFontSize(13),
  },
  errorText: {
    color: '#E53E3E',
    fontSize: responsiveFontSize(14),
    fontWeight: '600',
    textAlign: 'center',
    paddingHorizontal: scale(30),
  },
  retryBtn: {
    marginTop: verticalScale(12),
    paddingHorizontal: scale(24),
    paddingVertical: verticalScale(10),
    backgroundColor: '#00796B',
    borderRadius: 8,
  },
  retryBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: responsiveFontSize(13),
  },
  scrollContent: {
    padding: scale(16),
    paddingBottom: verticalScale(40),
  },
  // Profile card
  profileCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: scale(20),
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: verticalScale(16),
    alignItems: 'center',
  },
  shopPhoto: {
    width: '100%',
    height: verticalScale(180),
    borderRadius: 12,
    marginBottom: verticalScale(14),
    backgroundColor: '#EDF2F7',
  },
  shopPhotoPlaceholder: {
    width: '100%',
    height: verticalScale(120),
    borderRadius: 12,
    backgroundColor: '#EDF2F7',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: verticalScale(14),
  },
  shopPhotoPlaceholderText: {
    color: '#A0AEC0',
    fontSize: responsiveFontSize(14),
    fontWeight: '600',
  },
  profileName: {
    fontSize: responsiveFontSize(20),
    fontWeight: '800',
    color: '#1A202C',
    textAlign: 'center',
  },
  profileCode: {
    fontSize: responsiveFontSize(13),
    color: '#718096',
    fontWeight: '600',
    marginBottom: verticalScale(10),
  },
  profileDetail: {
    fontSize: responsiveFontSize(13),
    color: '#4A5568',
    marginTop: verticalScale(4),
    textAlign: 'center',
  },
  // Stats
  statsRow: {
    flexDirection: 'row',
    gap: verticalScale(12),
    marginBottom: verticalScale(12),
  },
  statCard: {
    flex: 1,
    borderRadius: 12,
    padding: scale(16),
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  statValue: {
    fontSize: responsiveFontSize(18),
    fontWeight: '800',
  },
  statLabel: {
    fontSize: responsiveFontSize(11),
    fontWeight: '700',
    color: '#718096',
    textTransform: 'uppercase',
    marginTop: verticalScale(4),
    letterSpacing: 0.5,
  },
  // Tabs
  tabRow: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: verticalScale(12),
    overflow: 'hidden',
  },
  tab: {
    flex: 1,
    paddingVertical: verticalScale(12),
    alignItems: 'center',
  },
  tabActive: {
    backgroundColor: '#00796B',
  },
  tabText: {
    fontSize: responsiveFontSize(12),
    fontWeight: '700',
    color: '#718096',
  },
  tabTextActive: {
    color: '#FFFFFF',
  },
  // List section
  listSection: {
    gap: verticalScale(10),
  },
  listCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: scale(14),
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  listCardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: verticalScale(4),
  },
  listCardTitle: {
    fontSize: responsiveFontSize(14),
    fontWeight: '700',
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
    letterSpacing: 0.5,
  },
  listCardSub: {
    fontSize: responsiveFontSize(12),
    color: '#718096',
    marginBottom: verticalScale(4),
  },
  listCardAmount: {
    fontSize: responsiveFontSize(15),
    fontWeight: '800',
    color: '#1A202C',
  },
  raiseIssueBtn: {
    backgroundColor: '#FFF5F5',
    borderWidth: 1,
    borderColor: '#FC8181',
    borderRadius: 12,
    paddingVertical: verticalScale(12),
    paddingHorizontal: scale(16),
    alignItems: 'center',
    marginBottom: verticalScale(16),
  },
  raiseIssueBtnText: {
    color: '#C53030',
    fontSize: responsiveFontSize(13),
    fontWeight: '800',
  },
  paymentBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: verticalScale(5),
    borderRadius: 8,
    paddingHorizontal: scale(8),
    paddingVertical: verticalScale(4),
    marginTop: verticalScale(4),
  },
  paymentDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  paymentBadgeText: {
    fontSize: responsiveFontSize(10),
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  visitIndicators: {
    flexDirection: 'row',
    gap: verticalScale(6),
    marginTop: verticalScale(6),
  },
  miniTag: {
    paddingHorizontal: scale(8),
    paddingVertical: verticalScale(3),
    borderRadius: 6,
  },
  miniTagText: {
    fontSize: responsiveFontSize(11),
    fontWeight: '700',
  },
  emptyCard: {
    padding: scale(30),
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
  },
  emptyText: {
    color: '#718096',
    fontSize: responsiveFontSize(13),
    textAlign: 'center',
  },
  // Notes
  notesCard: {
    backgroundColor: '#FFFFF0',
    borderRadius: 12,
    padding: scale(16),
    borderWidth: 1,
    borderColor: '#FEFCBF',
    marginTop: verticalScale(16),
  },
  notesTitle: {
    fontSize: responsiveFontSize(13),
    fontWeight: '700',
    color: '#744210',
    marginBottom: verticalScale(6),
  },
  notesText: {
    fontSize: responsiveFontSize(13),
    color: '#744210',
    lineHeight: 20,
  },
  // Replacement Styles
  listCardWrapper: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: verticalScale(10),
    overflow: 'hidden',
  },
  listCardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: verticalScale(4),
  },
  expandLabelText: {
    fontSize: responsiveFontSize(11),
    color: '#00796B',
    fontWeight: '700',
  },
  orderDetailsBlock: {
    paddingHorizontal: scale(12),
    paddingBottom: verticalScale(12),
    backgroundColor: '#FAFBFD',
  },
  detailsDivider: {
    height: 1,
    backgroundColor: '#EDF2F7',
    marginBottom: verticalScale(8),
  },
  sectionSubHeading: {
    fontSize: responsiveFontSize(11.5),
    fontWeight: '800',
    color: '#718096',
    textTransform: 'uppercase',
    marginBottom: verticalScale(6),
  },
  subItemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: verticalScale(5),
    borderBottomWidth: 1,
    borderBottomColor: '#EDF2F7',
  },
  subItemName: {
    fontSize: responsiveFontSize(12.5),
    fontWeight: '700',
    color: '#2D3748',
  },
  subItemVariant: {
    fontSize: responsiveFontSize(10.5),
    color: '#A0AEC0',
    marginTop: 1,
  },
  subItemQty: {
    fontSize: responsiveFontSize(12),
    fontWeight: '700',
    color: '#4A5568',
    marginHorizontal: scale(8),
  },
  subItemPrice: {
    fontSize: responsiveFontSize(12),
    fontWeight: '700',
    color: '#2D3748',
  },
  replacementActionBtn: {
    marginTop: verticalScale(10),
    height: verticalScale(36),
    backgroundColor: '#00BFA5',
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  replacementActionBtnText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: responsiveFontSize(12),
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
  issueModalWrapper: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    height: '82%',
  },
  issuePartyName: {
    color: '#718096',
    fontSize: responsiveFontSize(11),
    marginTop: verticalScale(2),
  },
  issueChoiceRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: verticalScale(7),
    marginTop: verticalScale(7),
    marginBottom: verticalScale(16),
  },
  issueChoice: {
    borderWidth: 1,
    borderColor: '#CBD5E0',
    borderRadius: 8,
    paddingHorizontal: scale(10),
    paddingVertical: verticalScale(7),
  },
  issueChoiceActive: {
    backgroundColor: '#00796B',
    borderColor: '#00796B',
  },
  issueChoiceText: {
    color: '#4A5568',
    fontSize: responsiveFontSize(10),
    fontWeight: '800',
  },
  issueChoiceTextActive: {
    color: '#FFFFFF',
  },
  issueInput: {
    minHeight: 44,
    backgroundColor: '#F7F9FC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    paddingHorizontal: scale(12),
    paddingVertical: verticalScale(10),
    color: '#2D3748',
    fontSize: responsiveFontSize(13),
    marginTop: verticalScale(6),
    marginBottom: verticalScale(16),
  },
  issueDescriptionInput: {
    minHeight: 130,
  },
  replacementFormContent: {
    padding: scale(16),
    paddingBottom: verticalScale(30),
  },
  modalDescText: {
    fontSize: responsiveFontSize(12.5),
    color: '#718096',
    lineHeight: 18,
    marginBottom: verticalScale(16),
  },
  remarksInput: {
    height: verticalScale(40),
    backgroundColor: '#F7F9FC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    paddingHorizontal: scale(12),
    color: '#2D3748',
    fontSize: responsiveFontSize(13),
    marginTop: verticalScale(6),
    marginBottom: verticalScale(16),
  },
  modalItemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: verticalScale(10),
    borderBottomWidth: 1,
    borderBottomColor: '#EDF2F7',
  },
  modalItemName: {
    fontSize: responsiveFontSize(13.5),
    fontWeight: '700',
    color: '#2D3748',
  },
  modalItemVariant: {
    fontSize: responsiveFontSize(11),
    color: '#A0AEC0',
    marginTop: 1,
  },
  modalItemOriginal: {
    fontSize: responsiveFontSize(11),
    fontWeight: '600',
    color: '#718096',
    marginTop: verticalScale(2),
  },
  modalQtyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#00796B',
    borderRadius: 6,
    overflow: 'hidden',
    height: verticalScale(28),
  },
  qtyBtn: {
    width: scale(24),
    height: '100%',
    backgroundColor: '#E6FFFA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabledQtyBtn: {
    backgroundColor: '#EDF2F7',
  },
  qtyBtnText: {
    fontSize: responsiveFontSize(14),
    fontWeight: '800',
    color: '#00796B',
  },
  qtyText: {
    width: scale(24),
    textAlign: 'center',
    fontSize: responsiveFontSize(13),
    fontWeight: '700',
    color: '#1A202C',
  },
  modalActionsFooter: {
    flexDirection: 'row',
    padding: scale(16),
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
    gap: verticalScale(12),
  },
  cancelBtn: {
    flex: 1,
    height: verticalScale(44),
    backgroundColor: '#EDF2F7',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtnText: {
    fontSize: responsiveFontSize(14),
    fontWeight: '700',
    color: '#4A5568',
  },
  submitReplacementBtn: {
    flex: 1.5,
    height: verticalScale(44),
    backgroundColor: '#00796B',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabledSubmitBtn: {
    backgroundColor: '#CBD5E0',
  },
  submitReplacementBtnText: {
    fontSize: responsiveFontSize(14),
    fontWeight: '800',
    color: '#FFFFFF',
  },
  closeXBtn: {
    padding: scale(4),
  },
  closeXText: {
    fontSize: responsiveFontSize(18),
    color: '#A0AEC0',
    fontWeight: '600',
  },
  modalTitleText: {
    fontSize: responsiveFontSize(15),
    fontWeight: '800',
    color: '#2D3748',
  },
  fieldLabel: {
    fontSize: responsiveFontSize(11),
    fontWeight: '800',
    color: '#718096',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionHeading: {
    fontSize: responsiveFontSize(12.5),
    fontWeight: '800',
    color: '#00796B',
    textTransform: 'uppercase',
    marginTop: verticalScale(8),
    marginBottom: verticalScale(6),
  },

  // Allocation Styles
  allocationCard: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 14,
    padding: scale(16),
    alignItems: 'center',
    marginBottom: verticalScale(16),
  },
  allocationCardTitle: {
    fontSize: responsiveFontSize(13.5),
    fontWeight: '800',
    color: '#2D3748',
  },
  allocationCardDesc: {
    fontSize: responsiveFontSize(11),
    color: '#718096',
    marginTop: verticalScale(4),
    paddingRight: scale(10),
  },
  allocationActionBtn: {
    backgroundColor: '#00796B',
    paddingHorizontal: scale(16),
    paddingVertical: verticalScale(8),
    borderRadius: 8,
  },
  allocationActionBtnText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: responsiveFontSize(12),
  },
  allocModalWrapper: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    height: '85%',
  },
  allocFormContent: {
    padding: scale(16),
    paddingBottom: verticalScale(30),
  },
  allocPaymentSelectBox: {
    backgroundColor: '#F7F9FC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    padding: scale(12),
    marginBottom: verticalScale(16),
  },
  allocPaymentSelectTitle: {
    fontSize: responsiveFontSize(11),
    fontWeight: '800',
    color: '#718096',
    textTransform: 'uppercase',
    marginBottom: verticalScale(6),
  },
  paymentOptionCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    padding: scale(10),
    marginBottom: verticalScale(8),
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  activePaymentOptionCard: {
    borderColor: '#00796B',
    backgroundColor: '#E6FFFA',
  },
  paymentOptionText: {
    fontSize: responsiveFontSize(12),
    fontWeight: '750',
    color: '#4A5568',
  },
  paymentOptionAmt: {
    fontSize: responsiveFontSize(12.5),
    fontWeight: '800',
    color: '#2D3748',
  },
  allocInvoiceItem: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    padding: scale(12),
    marginBottom: verticalScale(10),
  },
  allocInvoiceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: verticalScale(8),
  },
  allocInvoiceTitle: {
    fontSize: responsiveFontSize(13),
    fontWeight: '800',
    color: '#2D3748',
  },
  allocInvoiceDate: {
    fontSize: responsiveFontSize(10.5),
    color: '#A0AEC0',
    fontWeight: '600',
  },
  allocInvoiceDue: {
    fontSize: responsiveFontSize(12),
    color: '#E53E3E',
    fontWeight: '700',
  },
  allocAmountInput: {
    height: verticalScale(38),
    backgroundColor: '#F7F9FC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 6,
    paddingHorizontal: scale(10),
    fontSize: responsiveFontSize(12.5),
    color: '#2D3748',
  },

  // Wallet details card styles
  walletDetailsCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: scale(16),
    marginBottom: verticalScale(16),
  },
  walletDetailsTitle: {
    fontSize: responsiveFontSize(12),
    fontWeight: '805',
    color: '#2D3748',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: verticalScale(12),
  },
  walletDetailsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: verticalScale(4),
  },
  walletDetailsLabel: {
    fontSize: responsiveFontSize(12),
    color: '#718096',
    fontWeight: '650',
  },
  walletDetailsVal: {
    fontSize: responsiveFontSize(13.5),
    fontWeight: '800',
  },
  walletDetailsDivider: {
    height: 1,
    backgroundColor: '#F7F9FC',
    marginVertical: verticalScale(8),
  },
});
