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
  Modal,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { scale, verticalScale, responsiveFontSize, maxContainerWidth } from '../utils/responsive';

export default function StoreManagerDashboardScreen({
  token,
  apiUrl,
  user,
  onNavigateToAttendance,
  onNavigateToLeave,
  onNavigateToProfile,
  onNavigateToProducts,
  onNavigateToOrders,
}) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState('to_pack'); // 'to_pack', 'reconcile', 'to_dispatch'

  // Orders data
  const [confirmedOrders, setConfirmedOrders] = useState([]);
  const [reconcileOrders, setReconcileOrders] = useState([]);
  const [packedOrders, setPackedOrders] = useState([]);
  const [dispatchedOrders, setDispatchedOrders] = useState([]);
  const [partialReturnOrders, setPartialReturnOrders] = useState([]);
  const [drivers, setDrivers] = useState([]);

  // Packing Modal state
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [packingModalVisible, setPackingModalVisible] = useState(false);
  const [itemPackDetails, setItemPackDetails] = useState({});
  const [packRemarks, setPackRemarks] = useState('');
  const [submittingPack, setSubmittingPack] = useState(false);

  // Reconciliation Modal state
  const [reconcileModalVisible, setReconcileModalVisible] = useState(false);
  const [reconcileNote, setReconcileNote] = useState('');
  const [submittingReconcile, setSubmittingReconcile] = useState(false);

  // Vehicle Load & Dispatch Modal state
  const [dispatchModalVisible, setDispatchModalVisible] = useState(false);
  const [dispatchOrder, setDispatchOrder] = useState(null);
  const [selectedDriverId, setSelectedDriverId] = useState('');
  const [submittingDispatch, setSubmittingDispatch] = useState(false);
  const [partialReturnModalVisible, setPartialReturnModalVisible] = useState(false);
  const [partialReturnOrder, setPartialReturnOrder] = useState(null);
  const [partialDeliveredQty, setPartialDeliveredQty] = useState({});

  const fetchDashboardData = useCallback(async () => {
    try {
      // 1. Fetch Orders
      const res = await fetch(`${apiUrl}/order?limit=300`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      const allOrders = Array.isArray(data.data) ? data.data : [];

      const confirmed = allOrders.filter((o) => o.status === 'warehouse');
      const reconcile = allOrders.filter((o) => o.status === 'confirmed' && o.packingStatus === 'reconciliation_requested');
      const packed = allOrders.filter((o) => o.status === 'ready_for_delivery');
      const dispatched = allOrders.filter((o) => o.status === 'dispatched');
      const partialReturns = allOrders.filter((o) => o.status === 'partial_delivery_return_pending');

      setConfirmedOrders(confirmed);
      setReconcileOrders(reconcile);
      setPackedOrders(packed);
      setDispatchedOrders(dispatched);
      setPartialReturnOrders(partialReturns);

      // 2. Fetch Drivers list
      const driverRes = await fetch(`${apiUrl}/users?role=driver&limit=100`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const driverData = await driverRes.json();
      if (driverRes.ok && Array.isArray(driverData.data)) {
        setDrivers(driverData.data);
      }
    } catch (e) {
      console.log('[StoreManagerDashboard] Error fetching data:', e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [apiUrl, token]);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchDashboardData();
  };

  const unitWeight = (item) => {
    if (Number(item?.baseQuantity) > 0) return Number(item.baseQuantity);
    const label = `${item?.packSize || ''} ${item?.unit || ''} ${item?.variantName || ''}`.toLowerCase();
    const value = Number(label.match(/[\d.]+/)?.[0] || 0);
    return label.includes('gm') || label.includes('ml') ? value / 1000 : value;
  };
  const totalWeight = (order) => (order?.items || []).reduce((sum, item) => sum + unitWeight(item) * Number(item.quantity || 0), 0);

  const openPartialReturn = (order) => {
    setPartialReturnOrder(order);
    setPartialDeliveredQty(Object.fromEntries((order.partialDeliveryItems || []).map((item) => [String(item.variantId?._id || item.variantId), String(item.deliveredQuantity || 0)])));
    setPartialReturnModalVisible(true);
  };

  const confirmPartialReturn = async (order) => {
    try {
      const response = await fetch(`${apiUrl}/order/${order._id}/partial-delivery/confirm-return`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ items: (order.partialDeliveryItems || []).map((item) => ({ variantId: item.variantId?._id || item.variantId, deliveredQuantity: Number(partialDeliveredQty[String(item.variantId?._id || item.variantId)] || 0) })) }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.message || 'Could not confirm returned stock');
      Alert.alert('Confirmed', 'Returned stock was added to inventory and the credit note was created.');
      setPartialReturnModalVisible(false);
      fetchDashboardData();
    } catch (error) {
      Alert.alert('Failed', error.message);
    }
  };

  // Open Packing Checklist Modal
  const handleOpenPackingModal = (order) => {
    setSelectedOrder(order);
    const initialDetails = {};
    (order.items || []).forEach((item) => {
      const key = String(item.variantId || item.productId || item._id);
      initialDetails[key] = {
        isPacked: false,
        packedQuantity: String(item.quantity || 1),
        packReason: '',
      };
    });
    setItemPackDetails(initialDetails);
    setPackRemarks('');
    setPackingModalVisible(true);
  };

  // Toggle item packed checkmark
  const toggleItemPacked = (itemKey) => {
    setItemPackDetails((prev) => ({
      ...prev,
      [itemKey]: {
        ...prev[itemKey],
        isPacked: !prev[itemKey]?.isPacked,
      },
    }));
  };

  // Update item packed quantity
  const updateItemPackedQty = (itemKey, qtyStr) => {
    setItemPackDetails((prev) => ({
      ...prev,
      [itemKey]: {
        ...prev[itemKey],
        packedQuantity: qtyStr,
      },
    }));
  };

  // Update item pack reason
  const updateItemPackReason = (itemKey, reason) => {
    setItemPackDetails((prev) => ({
      ...prev,
      [itemKey]: {
        ...prev[itemKey],
        packReason: reason,
      },
    }));
  };

  // Submit Complete Order Packing
  const handleSubmitPacking = async () => {
    if (!selectedOrder) return;
    const unchecked = (selectedOrder.items || []).find((item) => {
      const key = String(item.variantId || item.productId || item._id);
      return itemPackDetails[key]?.isPacked !== true;
    });
    if (unchecked) {
      Alert.alert('Packing incomplete', `Check ${unchecked.productName || 'every item'} before completing this order.`);
      return;
    }
    setSubmittingPack(true);

    try {
      const formattedItems = (selectedOrder.items || []).map((item) => {
        const key = String(item.variantId || item.productId || item._id);
        const detail = itemPackDetails[key] || {};
        return {
          variantId: item.variantId,
          productId: item.productId,
          isPacked: detail.isPacked === true,
          packedQuantity: parseFloat(detail.packedQuantity) || item.quantity,
          packReason: detail.packReason || '',
        };
      });

      const res = await fetch(`${apiUrl}/order/${selectedOrder._id}/pack`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          itemPackDetails: formattedItems,
          remarks: packRemarks,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        Alert.alert('Success', `Order #${selectedOrder.orderNumber} packed successfully!`);
        setPackingModalVisible(false);
        setSelectedOrder(null);
        fetchDashboardData();
      } else {
        Alert.alert('Failed', data.message || 'Could not pack order.');
      }
    } catch (e) {
      Alert.alert('Error', e.message || 'Connection error.');
    } finally {
      setSubmittingPack(false);
    }
  };

  // Submit Reconciliation Request to Office
  const handleSubmitReconciliation = async () => {
    if (!selectedOrder) return;
    if (!reconcileNote.trim()) {
      Alert.alert('Required', 'Please enter a note/reason for the office reconciliation.');
      return;
    }

    setSubmittingReconcile(true);
    try {
      const res = await fetch(`${apiUrl}/order/${selectedOrder._id}/reconcile`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ note: reconcileNote }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        Alert.alert(
          'Reconciliation Requested',
          `Order #${selectedOrder.orderNumber} sent back to office for review!`
        );
        setReconcileModalVisible(false);
        setPackingModalVisible(false);
        setSelectedOrder(null);
        setReconcileNote('');
        fetchDashboardData();
      } else {
        Alert.alert('Failed', data.message || 'Could not send reconciliation request.');
      }
    } catch (e) {
      Alert.alert('Error', e.message || 'Connection error.');
    } finally {
      setSubmittingReconcile(false);
    }
  };

  // Open Dispatch Modal
  const handleOpenDispatchModal = (order) => {
    setDispatchOrder(order);
    setSelectedDriverId(order.assignedDriverId?._id || order.assignedDriverId || '');
    setDispatchModalVisible(true);
  };

  // Submit Driver Loading & Dispatch
  const handleSubmitDispatch = async () => {
    if (!dispatchOrder) return;
    setSubmittingDispatch(true);

    try {
      // 1. Assign Driver if selected
      if (selectedDriverId) {
        await fetch(`${apiUrl}/order/${dispatchOrder._id}/assign-driver`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ driverId: selectedDriverId }),
        });
      }

      // 2. Change status to dispatched
      const statusRes = await fetch(`${apiUrl}/order/${dispatchOrder._id}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ status: 'dispatched', remarks: 'Loaded into vehicle and dispatched' }),
      });

      const statusData = await statusRes.json();
      if (statusRes.ok && statusData.success) {
        Alert.alert('Dispatched', `Order #${dispatchOrder.orderNumber} loaded into vehicle & dispatched!`);
        setDispatchModalVisible(false);
        setDispatchOrder(null);
        fetchDashboardData();
      } else {
        Alert.alert('Failed', statusData.message || 'Could not dispatch order.');
      }
    } catch (e) {
      Alert.alert('Error', e.message || 'Connection error.');
    } finally {
      setSubmittingDispatch(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.loadingCenter}>
          <ActivityIndicator size="large" color="#2B6CB0" />
          <Text style={styles.loadingText}>Loading Store Manager Console...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Top Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>🏪 Store Console</Text>
          <Text style={styles.headerSubTitle}>Warehouse Packing & Vehicle Dispatch</Text>
        </View>
        <TouchableOpacity style={styles.refreshBtn} onPress={onRefresh}>
          <Text style={styles.refreshBtnText}>🔄 Refresh</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Metric Cards Row */}
        <View style={styles.quickActionGrid}>
          <TouchableOpacity style={styles.quickActionCard} onPress={onNavigateToAttendance}>
            <Text style={styles.quickActionIcon}>🕒</Text>
            <Text style={styles.quickActionTitle}>Attendance</Text>
            <Text style={styles.quickActionSub}>Check in / check out</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.quickActionCard} onPress={onNavigateToLeave}>
            <Text style={styles.quickActionIcon}>🌴</Text>
            <Text style={styles.quickActionTitle}>Leave</Text>
            <Text style={styles.quickActionSub}>Apply & view leave</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.quickActionCard} onPress={onNavigateToProducts}>
            <Text style={styles.quickActionIcon}>📦</Text>
            <Text style={styles.quickActionTitle}>Stock</Text>
            <Text style={styles.quickActionSub}>Check product inventory</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.quickActionCard} onPress={onNavigateToOrders}>
            <Text style={styles.quickActionIcon}>📋</Text>
            <Text style={styles.quickActionTitle}>Orders</Text>
            <Text style={styles.quickActionSub}>See warehouse orders</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.metricsGrid}>
          <TouchableOpacity
            style={[styles.metricCard, activeTab === 'to_pack' && styles.metricCardActive]}
            onPress={() => setActiveTab('to_pack')}
          >
            <Text style={styles.metricVal}>{confirmedOrders.length}</Text>
            <Text style={styles.metricLabel}>📦 Orders To Pack</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.metricCard, activeTab === 'reconcile' && styles.metricCardActive]}
            onPress={() => setActiveTab('reconcile')}
          >
            <Text style={[styles.metricVal, { color: '#DD6B20' }]}>{reconcileOrders.length}</Text>
            <Text style={styles.metricLabel}>🔄 In Reconciliation</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.metricCard, activeTab === 'to_dispatch' && styles.metricCardActive]}
            onPress={() => setActiveTab('to_dispatch')}
          >
            <Text style={[styles.metricVal, { color: '#38A169' }]}>{packedOrders.length}</Text>
            <Text style={styles.metricLabel}>🚚 Ready to Dispatch</Text>
          </TouchableOpacity>

          <View style={styles.metricCard}>
            <Text style={[styles.metricVal, { color: '#3182CE' }]}>{dispatchedOrders.length}</Text>
            <Text style={styles.metricLabel}>✅ Dispatched Today</Text>
          </View>
          <TouchableOpacity style={[styles.metricCard, activeTab === 'partial_returns' && styles.metricCardActive]} onPress={() => setActiveTab('partial_returns')}>
            <Text style={[styles.metricVal, { color: '#D69E2E' }]}>{partialReturnOrders.length}</Text>
            <Text style={styles.metricLabel}>Partial Returns</Text>
          </TouchableOpacity>
        </View>

        {/* Tab Selection */}
        <View style={styles.tabContainer}>
          <TouchableOpacity
            style={[styles.tabBtn, activeTab === 'to_pack' && styles.tabBtnActive]}
            onPress={() => setActiveTab('to_pack')}
          >
            <Text style={[styles.tabText, activeTab === 'to_pack' && styles.tabTextActive]}>
              📦 To Pack ({confirmedOrders.length})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tabBtn, activeTab === 'reconcile' && styles.tabBtnActive]}
            onPress={() => setActiveTab('reconcile')}
          >
            <Text style={[styles.tabText, activeTab === 'reconcile' && styles.tabTextActive]}>
              🔄 Reconcile ({reconcileOrders.length})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tabBtn, activeTab === 'to_dispatch' && styles.tabBtnActive]}
            onPress={() => setActiveTab('to_dispatch')}
          >
            <Text style={[styles.tabText, activeTab === 'to_dispatch' && styles.tabTextActive]}>
              🚚 Load & Dispatch ({packedOrders.length})
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.tabBtn, activeTab === 'partial_returns' && styles.tabBtnActive]} onPress={() => setActiveTab('partial_returns')}>
            <Text style={[styles.tabText, activeTab === 'partial_returns' && styles.tabTextActive]}>Returns ({partialReturnOrders.length})</Text>
          </TouchableOpacity>
        </View>

        {activeTab === 'partial_returns' && <View>
          <Text style={styles.sectionHeader}>Partial deliveries awaiting warehouse confirmation</Text>
          {partialReturnOrders.length === 0 ? <View style={styles.emptyCard}><Text style={styles.emptyTitle}>No returned orders pending</Text></View> : partialReturnOrders.map((order) => <View key={order._id} style={styles.orderCard}>
            <Text style={styles.orderNum}>Order #{order.orderNumber}</Text>
            <Text style={styles.partyName}>{order.partyId?.partyName || 'Customer Party'}</Text>
            <Text style={styles.orderMeta}>Total load weight: {totalWeight(order).toFixed(2)} kg</Text>
            <View style={styles.itemsPreviewBox}>{(order.partialDeliveryItems || []).map((item, index) => <Text key={item._id || index} style={styles.itemPreviewRow}>{item.productName} {item.variantName}: sent {item.expectedQuantity}, delivered {item.deliveredQuantity}, returned {item.returnedQuantity} ({(Number(item.unitWeight || 0) * Number(item.returnedQuantity || 0)).toFixed(2)} kg)</Text>)}</View>
            <TouchableOpacity style={styles.startPackBtn} onPress={() => openPartialReturn(order)}><Text style={styles.startPackBtnText}>Inspect Return & Create Credit Note</Text></TouchableOpacity>
          </View>)}
        </View>}

        {/* QUEUE 1: TO PACK */}
        {activeTab === 'to_pack' && (
          <View>
            <Text style={styles.sectionHeader}>Confirmed Orders Ready for Packaging</Text>
            {confirmedOrders.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={{ fontSize: 32, marginBottom: 6 }}>🎉</Text>
                <Text style={styles.emptyTitle}>All Confirmed Orders Packed!</Text>
                <Text style={styles.emptySub}>No pending orders waiting for packaging right now.</Text>
              </View>
            ) : (
              confirmedOrders.map((order) => (
                <View key={order._id} style={styles.orderCard}>
                  <View style={styles.orderCardHeader}>
                    <View>
                      <Text style={styles.orderNum}>Order #{order.orderNumber}</Text>
                      <Text style={styles.partyName}>
                        🏬 {order.partyId?.partyName || 'Customer Party'}
                      </Text>
                    </View>
                    <View style={styles.statusBadgeConfirmed}>
                      <Text style={styles.statusTextConfirmed}>Confirmed</Text>
                    </View>
                  </View>

                  <Text style={styles.orderMeta}>
                    Items: {order.items?.length || 0} • Total Qty: {order.totalQty || 0} • Total weight: {totalWeight(order).toFixed(2)} kg
                  </Text>

                  {/* Items Preview */}
                  <View style={styles.itemsPreviewBox}>
                    <Text style={styles.itemsPreviewTitle}>Product Items to Pack:</Text>
                    {(order.items || []).slice(0, 3).map((item, idx) => (
                      <Text key={idx} style={styles.itemPreviewRow}>
                        • {item.productName} ({item.variantName}) —{' '}
                        <Text style={{ fontWeight: '800', color: '#2B6CB0' }}>
                          {item.quantity} {item.unit || 'pcs'}
                        </Text>
                      </Text>
                    ))}
                    {(order.items || []).length > 3 && (
                      <Text style={styles.moreItemsText}>
                        + {(order.items || []).length - 3} more items...
                      </Text>
                    )}
                  </View>

                  {/* Pack Button */}
                  <TouchableOpacity
                    style={styles.startPackBtn}
                    onPress={() => handleOpenPackingModal(order)}
                  >
                    <Text style={styles.startPackBtnText}>📦 Start Item Packing Checklist</Text>
                  </TouchableOpacity>
                </View>
              ))
            )}
          </View>
        )}

        {/* QUEUE 2: IN RECONCILIATION */}
        {activeTab === 'reconcile' && (
          <View>
            <Text style={styles.sectionHeader}>Orders Sent to Office for Review / Reconciliation</Text>
            {reconcileOrders.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={{ fontSize: 32, marginBottom: 6 }}>👍</Text>
                <Text style={styles.emptyTitle}>No Orders in Reconciliation</Text>
                <Text style={styles.emptySub}>All orders are packed and processed smoothly.</Text>
              </View>
            ) : (
              reconcileOrders.map((order) => (
                <View key={order._id} style={[styles.orderCard, { borderColor: '#F6AD55' }]}>
                  <View style={styles.orderCardHeader}>
                    <View>
                      <Text style={styles.orderNum}>Order #{order.orderNumber}</Text>
                      <Text style={styles.partyName}>
                        🏬 {order.partyId?.partyName || 'Customer Party'}
                      </Text>
                    </View>
                    <View style={styles.statusBadgeReconcile}>
                      <Text style={styles.statusTextReconcile}>In Office Review</Text>
                    </View>
                  </View>

                  <View style={styles.reconcileNoteBox}>
                    <Text style={styles.reconcileNoteTitle}>⚠️ Note Sent to Office:</Text>
                    <Text style={styles.reconcileNoteText}>
                      "{order.reconciliationNote || 'Item shortage / mismatch reported.'}"
                    </Text>
                  </View>

                  <Text style={styles.waitText}>
                    ⏳ Waiting for Office/Admin to edit or update this order before packaging can resume.
                  </Text>
                </View>
              ))
            )}
          </View>
        )}

        {/* QUEUE 3: LOAD & DISPATCH */}
        {activeTab === 'to_dispatch' && (
          <View>
            <Text style={styles.sectionHeader}>Packed Orders Ready for Vehicle Loading & Dispatch</Text>
            {packedOrders.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={{ fontSize: 32, marginBottom: 6 }}>🚚</Text>
                <Text style={styles.emptyTitle}>No Packed Orders Waiting for Dispatch</Text>
                <Text style={styles.emptySub}>Pack confirmed orders to proceed with driver dispatch.</Text>
              </View>
            ) : (
              packedOrders.map((order) => (
                <View key={order._id} style={styles.orderCard}>
                  <View style={styles.orderCardHeader}>
                    <View>
                      <Text style={styles.orderNum}>Order #{order.orderNumber}</Text>
                      <Text style={styles.partyName}>
                        🏬 {order.partyId?.partyName || 'Customer Party'}
                      </Text>
                    </View>
                    <View style={styles.statusBadgePacked}>
                      <Text style={styles.statusTextPacked}>Packed</Text>
                    </View>
                  </View>

                  <Text style={styles.orderMeta}>
                    Packed Date: {order.packedAt || order.updatedAt ? new Date(order.packedAt || order.updatedAt).toLocaleDateString() : 'N/A'} • Items:{' '}
                    {order.items?.length || 0} • Total weight: {totalWeight(order).toFixed(2)} kg
                  </Text>

                  {/* Assigned Driver info */}
                  <View style={styles.driverBox}>
                    <Text style={styles.driverBoxLabel}>Assigned Delivery Driver:</Text>
                    <Text style={styles.driverBoxVal}>
                      👤 {order.assignedDriverId?.name || 'Driver Not Assigned Yet'}
                    </Text>
                  </View>

                  <TouchableOpacity
                    style={styles.dispatchBtn}
                    onPress={() => handleOpenDispatchModal(order)}
                  >
                    <Text style={styles.dispatchBtnText}>🚚 Load Vehicle & Dispatch Order</Text>
                  </TouchableOpacity>
                </View>
              ))
            )}
          </View>
        )}
      </ScrollView>

      <Modal visible={partialReturnModalVisible} transparent animationType="fade" onRequestClose={() => setPartialReturnModalVisible(false)}>
        <View style={styles.modalOverlay}><View style={styles.modalContent}>
          <Text style={styles.modalTitle}>Warehouse return inspection</Text>
          <Text style={styles.modalSubTitle}>Use the driver bill photo and physical stock to enter actual delivered quantities.</Text>
          <ScrollView style={{ maxHeight: 360 }}>{(partialReturnOrder?.partialDeliveryItems || []).map((item) => {
            const key = String(item.variantId?._id || item.variantId);
            const delivered = Number(partialDeliveredQty[key] || 0);
            return <View key={key} style={{ marginTop: 12 }}><Text style={styles.inputLabel}>{item.productName} {item.variantName} — sent {item.expectedQuantity}</Text><TextInput style={styles.textInput} keyboardType="decimal-pad" value={partialDeliveredQty[key]} onChangeText={(value) => setPartialDeliveredQty((current) => ({ ...current, [key]: value }))} /><Text style={styles.orderMeta}>Returned: {Math.max(0, Number(item.expectedQuantity) - delivered)}</Text></View>;
          })}</ScrollView>
          <View style={styles.modalFooterActions}><TouchableOpacity style={styles.modalCancelBtn} onPress={() => setPartialReturnModalVisible(false)}><Text style={styles.modalCancelBtnText}>Close</Text></TouchableOpacity><TouchableOpacity style={styles.startPackBtn} onPress={() => confirmPartialReturn(partialReturnOrder)}><Text style={styles.startPackBtnText}>Confirm Stock & Credit Note</Text></TouchableOpacity></View>
        </View></View>
      </Modal>

      {/* ITEM PACKING CHECKLIST MODAL */}
      <Modal
        visible={packingModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setPackingModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>📦 Order Item Packing Checklist</Text>
                <Text style={styles.modalSubTitle}>
                  Order #{selectedOrder?.orderNumber} • {selectedOrder?.partyId?.partyName}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setPackingModalVisible(false)}>
                <Text style={styles.modalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 380 }}>
              {(selectedOrder?.items || []).map((item, idx) => {
                const key = String(item.variantId || item.productId || item._id);
                const detail = itemPackDetails[key] || { isPacked: true, packedQuantity: String(item.quantity), packReason: '' };

                return (
                  <View key={idx} style={styles.packItemCard}>
                    <View style={styles.packItemHeader}>
                      <TouchableOpacity
                        style={styles.checkboxRow}
                        onPress={() => toggleItemPacked(key)}
                      >
                        <View style={[styles.checkbox, detail.isPacked && styles.checkboxActive]}>
                          {detail.isPacked && <Text style={{ color: '#FFF', fontWeight: 'bold' }}>✓</Text>}
                        </View>
                        <View style={{ marginLeft: 10, flex: 1 }}>
                          <Text style={styles.packItemName}>{item.productName}</Text>
                          <Text style={styles.packItemVariant}>
                            Variant: {item.variantName} • Ordered Qty: {item.quantity} {item.unit || 'pcs'}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    </View>

                    {/* Quantity & Shortage Reason */}
                    <View style={styles.packItemInputsRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.inputMiniLabel}>Packed Qty</Text>
                        <TextInput
                          style={styles.miniTextInput}
                          keyboardType="numeric"
                          value={detail.packedQuantity}
                          onChangeText={(val) => updateItemPackedQty(key, val)}
                        />
                      </View>

                      <View style={{ flex: 2, marginLeft: 10 }}>
                        <Text style={styles.inputMiniLabel}>Reason if shortage / missing</Text>
                        <TextInput
                          style={styles.miniTextInput}
                          placeholder="e.g. Out of stock, 5 short"
                          placeholderTextColor="#A0AEC0"
                          value={detail.packReason}
                          onChangeText={(val) => updateItemPackReason(key, val)}
                        />
                      </View>
                    </View>
                  </View>
                );
              })}

              <Text style={styles.inputLabel}>Packing Remarks / Note</Text>
              <TextInput
                style={styles.textInput}
                placeholder="Any special packing instructions or box count..."
                placeholderTextColor="#A0AEC0"
                value={packRemarks}
                onChangeText={setPackRemarks}
              />
            </ScrollView>

            <View style={styles.modalFooterActions}>
              <TouchableOpacity
                style={styles.reconcileBtn}
                onPress={() => {
                  setReconcileModalVisible(true);
                }}
              >
                <Text style={styles.reconcileBtnText}>🔄 Send Back to Office</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.completePackBtn, submittingPack && styles.disabledBtn]}
                onPress={handleSubmitPacking}
                disabled={submittingPack}
              >
                {submittingPack ? (
                  <ActivityIndicator color="#FFF" size="small" />
                ) : (
                  <Text style={styles.completePackBtnText}>✅ Mark Order Packed</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* RECONCILIATION NOTE MODAL */}
      <Modal
        visible={reconcileModalVisible}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setReconcileModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <View style={[styles.modalContent, { maxHeight: '60%' }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>🔄 Office Reconciliation Note</Text>
              <TouchableOpacity onPress={() => setReconcileModalVisible(false)}>
                <Text style={styles.modalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.reconcilePrompt}>
              Explain why this order needs office review (e.g., items out of stock, price discrepancy, party request change):
            </Text>

            <TextInput
              style={[styles.textInput, { height: 90, textAlignVertical: 'top' }]}
              placeholder="e.g. Bura is out of stock. Please check with customer or cancel item."
              placeholderTextColor="#A0AEC0"
              multiline
              value={reconcileNote}
              onChangeText={setReconcileNote}
            />

            <View style={styles.modalFooterActions}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setReconcileModalVisible(false)}
              >
                <Text style={styles.modalCancelBtnText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.confirmReconcileBtn, submittingReconcile && styles.disabledBtn]}
                onPress={handleSubmitReconciliation}
                disabled={submittingReconcile}
              >
                {submittingReconcile ? (
                  <ActivityIndicator color="#FFF" size="small" />
                ) : (
                  <Text style={styles.confirmReconcileBtnText}>Send to Office</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* DISPATCH & DRIVER VEHICLE LOADING MODAL */}
      <Modal
        visible={dispatchModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setDispatchModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>🚚 Load Vehicle & Dispatch</Text>
              <TouchableOpacity onPress={() => setDispatchModalVisible(false)}>
                <Text style={styles.modalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.inputLabel}>Select Delivery Driver *</Text>
            {drivers.length === 0 ? (
              <Text style={{ color: '#E53E3E', fontSize: 13, marginBottom: 12 }}>
                No active driver accounts found in database.
              </Text>
            ) : (
              <View style={{ marginBottom: 16 }}>
                {drivers.map((d) => (
                  <TouchableOpacity
                    key={d._id}
                    style={[
                      styles.driverSelectItem,
                      selectedDriverId === d._id && styles.driverSelectItemActive,
                    ]}
                    onPress={() => setSelectedDriverId(d._id)}
                  >
                    <Text
                      style={[
                        styles.driverSelectItemText,
                        selectedDriverId === d._id && styles.driverSelectItemTextActive,
                      ]}
                    >
                      👤 {d.name} ({d.mobile || 'No Mobile'})
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            <View style={styles.modalFooterActions}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setDispatchModalVisible(false)}
              >
                <Text style={styles.modalCancelBtnText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.confirmDispatchBtn, submittingDispatch && styles.disabledBtn]}
                onPress={handleSubmitDispatch}
                disabled={submittingDispatch}
              >
                {submittingDispatch ? (
                  <ActivityIndicator color="#FFF" size="small" />
                ) : (
                  <Text style={styles.confirmDispatchBtnText}>🚚 Dispatch for Delivery</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F7F9FC',
  },
  loadingCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: verticalScale(10),
    fontSize: responsiveFontSize(14),
    color: '#4A5568',
    fontWeight: '600',
  },
  header: {
    height: verticalScale(60),
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: scale(16),
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  headerTitle: {
    fontSize: responsiveFontSize(18),
    fontWeight: '800',
    color: '#2B6CB0',
  },
  headerSubTitle: {
    fontSize: responsiveFontSize(11),
    color: '#718096',
    fontWeight: '600',
  },
  refreshBtn: {
    backgroundColor: '#EBF8FF',
    paddingHorizontal: scale(10),
    paddingVertical: verticalScale(6),
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#BEE3F8',
  },
  refreshBtnText: {
    color: '#2B6CB0',
    fontWeight: '700',
    fontSize: responsiveFontSize(12),
  },
  scrollContent: {
    padding: scale(16),
  },
  quickActionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: verticalScale(10),
    marginBottom: verticalScale(16),
  },
  quickActionCard: {
    width: '48%',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: scale(14),
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  quickActionIcon: {
    fontSize: responsiveFontSize(22),
    marginBottom: verticalScale(8),
  },
  quickActionTitle: {
    fontSize: responsiveFontSize(13),
    fontWeight: '800',
    color: '#1A202C',
  },
  quickActionSub: {
    fontSize: responsiveFontSize(11),
    color: '#718096',
    marginTop: verticalScale(4),
    fontWeight: '600',
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: verticalScale(10),
    marginBottom: verticalScale(16),
  },
  metricCard: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: scale(14),
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
  },
  metricCardActive: {
    borderColor: '#2B6CB0',
    backgroundColor: '#EBF8FF',
  },
  metricVal: {
    fontSize: responsiveFontSize(22),
    fontWeight: '800',
    color: '#2B6CB0',
    marginBottom: verticalScale(2),
  },
  metricLabel: {
    fontSize: responsiveFontSize(11.5),
    color: '#4A5568',
    fontWeight: '700',
  },
  tabContainer: {
    flexDirection: 'row',
    gap: verticalScale(6),
    marginBottom: verticalScale(16),
  },
  tabBtn: {
    flex: 1,
    paddingVertical: verticalScale(10),
    borderRadius: 8,
    backgroundColor: '#EDF2F7',
    alignItems: 'center',
  },
  tabBtnActive: {
    backgroundColor: '#2B6CB0',
  },
  tabText: {
    fontSize: responsiveFontSize(11.5),
    fontWeight: '700',
    color: '#4A5568',
  },
  tabTextActive: {
    color: '#FFFFFF',
  },
  sectionHeader: {
    fontSize: responsiveFontSize(13),
    fontWeight: '800',
    color: '#2D3748',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: verticalScale(10),
  },
  emptyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: scale(30),
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  emptyTitle: {
    fontSize: responsiveFontSize(15),
    fontWeight: '800',
    color: '#2D3748',
    marginBottom: verticalScale(4),
  },
  emptySub: {
    fontSize: responsiveFontSize(12),
    color: '#718096',
    textAlign: 'center',
  },
  orderCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: scale(16),
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: verticalScale(14),
  },
  orderCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: verticalScale(8),
  },
  orderNum: {
    fontSize: responsiveFontSize(15),
    fontWeight: '800',
    color: '#2B6CB0',
  },
  partyName: {
    fontSize: responsiveFontSize(13),
    fontWeight: '700',
    color: '#2D3748',
    marginTop: verticalScale(2),
  },
  statusBadgeConfirmed: {
    backgroundColor: '#EBF8FF',
    paddingHorizontal: scale(8),
    paddingVertical: verticalScale(3),
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#BEE3F8',
  },
  statusTextConfirmed: {
    fontSize: responsiveFontSize(11),
    color: '#2B6CB0',
    fontWeight: '800',
  },
  statusBadgeReconcile: {
    backgroundColor: '#FFFAF0',
    paddingHorizontal: scale(8),
    paddingVertical: verticalScale(3),
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#FEEBC8',
  },
  statusTextReconcile: {
    fontSize: responsiveFontSize(11),
    color: '#DD6B20',
    fontWeight: '800',
  },
  statusBadgePacked: {
    backgroundColor: '#F0FFF4',
    paddingHorizontal: scale(8),
    paddingVertical: verticalScale(3),
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#C6F6D5',
  },
  statusTextPacked: {
    fontSize: responsiveFontSize(11),
    color: '#38A169',
    fontWeight: '800',
  },
  orderMeta: {
    fontSize: responsiveFontSize(12),
    color: '#718096',
    marginBottom: verticalScale(10),
  },
  itemsPreviewBox: {
    backgroundColor: '#FAFBFD',
    borderRadius: 8,
    padding: scale(10),
    borderWidth: 1,
    borderColor: '#EDF2F7',
    marginBottom: verticalScale(12),
  },
  itemsPreviewTitle: {
    fontSize: responsiveFontSize(11),
    fontWeight: '700',
    color: '#4A5568',
    marginBottom: verticalScale(4),
  },
  itemPreviewRow: {
    fontSize: responsiveFontSize(12),
    color: '#2D3748',
    marginBottom: verticalScale(2),
  },
  moreItemsText: {
    fontSize: responsiveFontSize(11),
    color: '#718096',
    fontStyle: 'italic',
    marginTop: verticalScale(2),
  },
  startPackBtn: {
    backgroundColor: '#2B6CB0',
    paddingVertical: verticalScale(10),
    borderRadius: 8,
    alignItems: 'center',
  },
  startPackBtnText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: responsiveFontSize(13),
  },
  reconcileNoteBox: {
    backgroundColor: '#FFFAF0',
    padding: scale(10),
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FEEBC8',
    marginBottom: verticalScale(10),
  },
  reconcileNoteTitle: {
    fontSize: responsiveFontSize(12),
    fontWeight: '800',
    color: '#DD6B20',
    marginBottom: verticalScale(2),
  },
  reconcileNoteText: {
    fontSize: responsiveFontSize(12),
    color: '#744210',
    fontStyle: 'italic',
  },
  waitText: {
    fontSize: responsiveFontSize(11.5),
    color: '#718096',
    fontWeight: '600',
  },
  driverBox: {
    backgroundColor: '#F7FAFC',
    padding: scale(10),
    borderRadius: 8,
    marginBottom: verticalScale(12),
  },
  driverBoxLabel: {
    fontSize: responsiveFontSize(11),
    color: '#718096',
    fontWeight: '700',
  },
  driverBoxVal: {
    fontSize: responsiveFontSize(13),
    color: '#2D3748',
    fontWeight: '800',
    marginTop: verticalScale(2),
  },
  dispatchBtn: {
    backgroundColor: '#38A169',
    paddingVertical: verticalScale(10),
    borderRadius: 8,
    alignItems: 'center',
  },
  dispatchBtnText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: responsiveFontSize(13),
  },

  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: scale(20),
    maxHeight: '90%',
    flexShrink: 1,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: verticalScale(14),
    paddingBottom: verticalScale(10),
    borderBottomWidth: 1,
    borderBottomColor: '#EDF2F7',
  },
  modalTitle: {
    fontSize: responsiveFontSize(17),
    fontWeight: '800',
    color: '#1A202C',
  },
  modalSubTitle: {
    fontSize: responsiveFontSize(11.5),
    color: '#718096',
    marginTop: verticalScale(2),
  },
  modalCloseText: {
    fontSize: responsiveFontSize(20),
    fontWeight: '700',
    color: '#A0AEC0',
    padding: scale(4),
  },
  packItemCard: {
    backgroundColor: '#FAFBFD',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    padding: scale(12),
    marginBottom: verticalScale(10),
  },
  packItemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  checkbox: {
    width: scale(22),
    height: verticalScale(22),
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: '#CBD5E0',
    backgroundColor: '#FFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxActive: {
    backgroundColor: '#38A169',
    borderColor: '#38A169',
  },
  packItemName: {
    fontSize: responsiveFontSize(14),
    fontWeight: '800',
    color: '#2D3748',
  },
  packItemVariant: {
    fontSize: responsiveFontSize(11.5),
    color: '#718096',
  },
  packItemInputsRow: {
    flexDirection: 'row',
    marginTop: verticalScale(8),
    alignItems: 'center',
  },
  inputMiniLabel: {
    fontSize: responsiveFontSize(10),
    fontWeight: '700',
    color: '#718096',
    marginBottom: verticalScale(3),
    textTransform: 'uppercase',
  },
  miniTextInput: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E0',
    borderRadius: 6,
    paddingHorizontal: scale(8),
    paddingVertical: verticalScale(5),
    fontSize: responsiveFontSize(12),
    color: '#2D3748',
  },
  inputLabel: {
    fontSize: responsiveFontSize(12),
    fontWeight: '700',
    color: '#4A5568',
    marginTop: verticalScale(10),
    marginBottom: verticalScale(6),
    textTransform: 'uppercase',
  },
  textInput: {
    backgroundColor: '#F7F9FC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    paddingHorizontal: scale(12),
    paddingVertical: verticalScale(10),
    fontSize: responsiveFontSize(13.5),
    color: '#1A202C',
    marginBottom: verticalScale(12),
  },
  modalFooterActions: {
    flexDirection: 'row',
    gap: verticalScale(10),
    marginTop: verticalScale(14),
    paddingTop: verticalScale(12),
    borderTopWidth: 1,
    borderTopColor: '#EDF2F7',
  },
  reconcileBtn: {
    flex: 1,
    paddingVertical: verticalScale(10),
    borderRadius: 8,
    backgroundColor: '#FFFAF0',
    borderWidth: 1,
    borderColor: '#FEEBC8',
    alignItems: 'center',
  },
  reconcileBtnText: {
    color: '#DD6B20',
    fontWeight: '800',
    fontSize: responsiveFontSize(12),
  },
  completePackBtn: {
    flex: 1.2,
    paddingVertical: verticalScale(10),
    borderRadius: 8,
    backgroundColor: '#38A169',
    alignItems: 'center',
  },
  completePackBtnText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: responsiveFontSize(12.5),
  },
  reconcilePrompt: {
    fontSize: responsiveFontSize(12.5),
    color: '#4A5568',
    marginBottom: verticalScale(10),
  },
  modalCancelBtn: {
    flex: 1,
    paddingVertical: verticalScale(10),
    borderRadius: 8,
    backgroundColor: '#EDF2F7',
    alignItems: 'center',
  },
  modalCancelBtnText: {
    color: '#4A5568',
    fontWeight: '700',
    fontSize: responsiveFontSize(13),
  },
  confirmReconcileBtn: {
    flex: 1,
    paddingVertical: verticalScale(10),
    borderRadius: 8,
    backgroundColor: '#DD6B20',
    alignItems: 'center',
  },
  confirmReconcileBtnText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: responsiveFontSize(13),
  },
  driverSelectItem: {
    padding: scale(12),
    borderRadius: 8,
    backgroundColor: '#FAFBFD',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: verticalScale(8),
  },
  driverSelectItemActive: {
    backgroundColor: '#EBF8FF',
    borderColor: '#3182CE',
  },
  driverSelectItemText: {
    fontSize: responsiveFontSize(13.5),
    color: '#4A5568',
    fontWeight: '700',
  },
  driverSelectItemTextActive: {
    color: '#2B6CB0',
    fontWeight: '800',
  },
  confirmDispatchBtn: {
    flex: 1.5,
    paddingVertical: verticalScale(10),
    borderRadius: 8,
    backgroundColor: '#38A169',
    alignItems: 'center',
  },
  confirmDispatchBtnText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: responsiveFontSize(13),
  },
  disabledBtn: {
    opacity: 0.65,
  },
});
