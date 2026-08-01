import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
  ActivityIndicator,
  Modal,
  TextInput,
  Alert,
  Linking,
  Platform,
} from 'react-native';
import { launchCamera } from 'react-native-image-picker';
import { uploadFile } from '../services/firebaseUploadService';

export default function DriverDashboardScreen({
  token,
  apiUrl,
  activeLogId,
  onNavigateToAttendance,
  onNavigateToLeave,
  onNavigateToProducts,
}) {
  const [activeRoute, setActiveRoute] = useState(null);
  const [routesHistory, setRoutesHistory] = useState([]);
  const [deliveries, setDeliveries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('route'); // 'route' | 'history'

  // Modal states for COD Collection
  const [collectionModalVisible, setCollectionModalVisible] = useState(false);
  const [selectedStop, setSelectedStop] = useState(null);
  const [collectAmount, setCollectAmount] = useState('');
  const [paymentMode, setPaymentMode] = useState('cash');
  const [transactionRef, setTransactionRef] = useState('');
  const [receiptPhoto, setReceiptPhoto] = useState(null);
  const [uploadProgress, setUploadProgress] = useState('');
  const [submittingCollection, setSubmittingCollection] = useState(false);
  const [pendingDeliveryPayment, setPendingDeliveryPayment] = useState(null);
  const [billPhoto, setBillPhoto] = useState(null);
  const [billModalVisible, setBillModalVisible] = useState(false);

  // Modal states for failure reason
  const [failureModalVisible, setFailureModalVisible] = useState(false);
  const [failureReason, setFailureReason] = useState('');
  const [submittingFailure, setSubmittingFailure] = useState(false);
  const [partialModalVisible, setPartialModalVisible] = useState(false);
  const [partialRemarks, setPartialRemarks] = useState('');
  const [partialProof, setPartialProof] = useState(null);
  const [submittingPartial, setSubmittingPartial] = useState(false);

  const unitWeight = (item) => {
    if (Number(item?.baseQuantity) > 0) return Number(item.baseQuantity);
    const label = `${item?.packSize || ''} ${item?.unit || ''} ${item?.variantName || ''}`.toLowerCase();
    const value = Number(label.match(/[\d.]+/)?.[0] || 0);
    return label.includes('gm') || label.includes('ml') ? value / 1000 : value;
  };
  const orderWeight = (order) => (order?.items || []).reduce(
    (sum, item) => sum + unitWeight(item) * Number(item.quantity || 0), 0
  );

  const loadDriverData = async () => {
    setLoading(true);
    try {
      // 1. Fetch routes assigned to this driver
      const routesResponse = await fetch(`${apiUrl}/transportation/routes?driverId=self`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const routesData = await routesResponse.json();

      // 2. Fetch driver deliveries to get Delivery IDs and statuses
      const delivResponse = await fetch(`${apiUrl}/delivery/my`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const delivData = await delivResponse.json();

      if (routesResponse.ok && routesData.success) {
        const allRoutes = routesData.data || [];
        // Active route is the latest one that is locked, dispatched or completed today
        const active = allRoutes.find(r => ['locked', 'dispatched'].includes(r.status));
        const history = allRoutes.filter(r => !['locked', 'dispatched'].includes(r.status));

        if (active) {
          // Fetch full populated active route detail
          const detailResponse = await fetch(`${apiUrl}/transportation/routes/${active._id}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          const detailData = await detailResponse.json();
          if (detailResponse.ok && detailData.success) {
            setActiveRoute(detailData.data);
          } else {
            setActiveRoute(active);
          }
        } else {
          setActiveRoute(null);
        }

        setRoutesHistory(history);
      }

      if (delivResponse.ok && delivData.success) {
        setDeliveries(delivData.data || []);
      }
    } catch (e) {
      console.warn('Driver data fetch error:', e.message);
      Alert.alert('Error', 'Failed to retrieve delivery routes.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (token && apiUrl) {
      loadDriverData();
    }
  }, [token, apiUrl]);

  // Find corresponding Delivery document for an order ID
  const getDeliveryForOrder = (orderId) => {
    return deliveries.find(d => String(d.orderId?._id || d.orderId) === String(orderId));
  };

  // Launch optimized Google Maps sequencing for all stops
  const handleOpenGoogleMapsRoute = () => {
    if (!activeRoute || !activeRoute.stops || activeRoute.stops.length === 0) return;

    // Origin starts at the warehouse if coordinates are configured
    const startLoc = activeRoute.warehouse?.location;
    const origin = startLoc && startLoc.latitude
      ? `${startLoc.latitude},${startLoc.longitude}`
      : 'current+location';

    // Sequence stops
    const stopsList = activeRoute.stops.filter((stop) => {
      const delivery = getDeliveryForOrder(stop.order?._id || stop.order);
      return delivery?.status === 'out_for_delivery' && stop.latitude && stop.longitude;
    });
    if (stopsList.length === 0) {
      Alert.alert('No Locations', 'Stops do not have GPS coordinates mapped.');
      return;
    }

    const lastStop = stopsList[stopsList.length - 1];
    const destination = `${lastStop.latitude},${lastStop.longitude}`;

    // Waypoints represent stops 1 to (N-1)
    const waypoints = stopsList.slice(0, -1).map(s => `${s.latitude},${s.longitude}`).join('|');

    const mapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}&waypoints=${waypoints}&travelmode=driving`;
    Linking.openURL(mapsUrl).catch(() => {
      Alert.alert('Error', 'Google Maps could not be opened.');
    });
  };

  // Open single stop directions
  const handleNavigateToStop = (stop) => {
    if (!stop.latitude || !stop.longitude) {
      Alert.alert('Missing Location', 'Customer location not configured.');
      return;
    }
    const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${stop.latitude},${stop.longitude}&travelmode=driving`;
    Linking.openURL(mapsUrl).catch(() => {
      Alert.alert('Error', 'Google Maps could not be opened.');
    });
  };

  // Trigger Delivery check / collection form
  const handleMarkDelivered = (stop) => {
    const delivery = getDeliveryForOrder(stop.order?._id || stop.order);
    if (!delivery) {
      Alert.alert('Error', 'No active delivery record found for this stop.');
      return;
    }

    const order = stop.order;
    setSelectedStop(stop);
    setCollectAmount(order?.paymentType === 'cod' ? String(order.netPayableAmount || order.grandTotal || 0) : '');
    setPaymentMode('cash');
    setTransactionRef('');
    setReceiptPhoto(null);
    setPendingDeliveryPayment(null);
    setBillPhoto(null);
    setCollectionModalVisible(true);
  };

  const openPartialDelivery = (stop) => {
    setSelectedStop(stop);
    setPartialRemarks('');
    setPartialProof(null);
    setPartialModalVisible(true);
  };

  const capturePartialProof = () => launchCamera(
    { mediaType: 'photo', quality: 0.8, maxWidth: 1600, maxHeight: 1600, includeBase64: false },
    (response) => {
      if (response.didCancel) return;
      if (response.errorCode) return Alert.alert('Camera Error', response.errorMessage || 'Failed to start camera.');
      const asset = response.assets?.[0];
      if (asset) setPartialProof({ uri: asset.uri, fileName: asset.fileName, type: asset.type, fileSize: asset.fileSize });
    }
  );

  const submitPartialDelivery = async () => {
    const order = selectedStop?.order;
    if (!order?._id) return;
    if (!partialProof) return Alert.alert('Photo required', 'Take a photo of the party return bill.');
    setSubmittingPartial(true);
    try {
      const uploaded = await uploadFile({
        file: partialProof,
        module: 'delivery',
        relatedModel: 'Order',
        token,
        apiUrl,
        onProgress: (stage) => setUploadProgress(stage),
      });
      const response = await fetch(`${apiUrl}/order/${order._id}/partial-delivery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ proof: uploaded.storagePath, remarks: partialRemarks }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.message || 'Could not record partial delivery');
      setPartialModalVisible(false);
      Alert.alert('Return recorded', 'Take the undelivered items back to the warehouse for confirmation.');
      loadDriverData();
    } catch (error) {
      Alert.alert('Failed', error.message);
    } finally {
      setSubmittingPartial(false);
    }
  };

  // Submit delivery status update (API call)
  const submitDeliveryStatus = async (deliveryId, status, payloadExtra = {}) => {
    try {
      const response = await fetch(`${apiUrl}/delivery/${deliveryId}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          status,
          ...payloadExtra,
        }),
      });
      const data = await response.json();
      if (response.ok && data.success) {
        Alert.alert('Success', `Delivery status marked as ${status}!`);
        loadDriverData();
        return true;
      } else {
        Alert.alert('Failed', data.message || 'Could not update delivery.');
        return false;
      }
    } catch (e) {
      console.warn('Delivery update error:', e.message);
      Alert.alert('Error', 'Network connection issue.');
      return false;
    }
  };

  const handleCapturePhoto = () => {
    launchCamera(
      {
        mediaType: 'photo',
        quality: 0.8,
        maxWidth: 1600,
        maxHeight: 1600,
        includeBase64: false,
      },
      (response) => {
        if (response.didCancel) return;
        if (response.errorCode) {
          Alert.alert('Camera Error', response.errorMessage || 'Failed to start camera.');
          return;
        }
        const asset = response.assets[0];
        setReceiptPhoto({
          uri: asset.uri,
          fileName: asset.fileName,
          type: asset.type,
          fileSize: asset.fileSize,
        });
      }
    );
  };

  const continueToBillUpload = (payment) => {
    setPendingDeliveryPayment(payment);
    setCollectionModalVisible(false);
    setBillModalVisible(true);
  };

  const captureBillPhoto = () => launchCamera(
    { mediaType: 'photo', quality: 0.8, maxWidth: 1600, maxHeight: 1600, includeBase64: false },
    (response) => {
      if (response.didCancel) return;
      if (response.errorCode) return Alert.alert('Camera Error', response.errorMessage || 'Failed to start camera.');
      const asset = response.assets?.[0];
      if (asset) setBillPhoto({ uri: asset.uri, fileName: asset.fileName, type: asset.type, fileSize: asset.fileSize });
    }
  );

  // Record payment decision first; delivery completes only after bill photo.
  const handleConfirmCODCollection = () => {
    if (!collectAmount.trim()) {
      Alert.alert('Required', 'Please enter collected amount.');
      return;
    }

    const order = selectedStop.order;
    const expected = Number(order.netPayableAmount || order.grandTotal || 0);
    if (Number(collectAmount) <= 0 || Number(collectAmount) > expected) {
      Alert.alert('Mismatched Amount', `Collected amount must match the order total: ₹${expected}`);
      return;
    }

    if (paymentMode !== 'cash' && !transactionRef.trim()) {
      Alert.alert('Required', paymentMode === 'cheque' ? 'Enter cheque number.' : 'Enter transaction reference.');
      return;
    }
    continueToBillUpload({
      paymentSkipped: false,
      amount: Number(collectAmount),
      paymentMode,
      transactionRef: paymentMode === 'cheque' ? undefined : transactionRef.trim(),
      chequeNumber: paymentMode === 'cheque' ? transactionRef.trim() : undefined,
    });
  };

  const submitDeliveredBill = async () => {
    const order = selectedStop?.order;
    const delivery = getDeliveryForOrder(order?._id);
    if (!delivery || !billPhoto) return Alert.alert('Bill required', 'Take a photo of the delivered bill.');
    setSubmittingCollection(true);
    try {
      const billUpload = await uploadFile({ file: billPhoto, module: 'delivery', relatedModel: 'Delivery', relatedId: delivery._id, token, apiUrl, onProgress: setUploadProgress });
      let receiptPath;
      if (receiptPhoto && !pendingDeliveryPayment?.paymentSkipped) {
        const receiptUpload = await uploadFile({ file: receiptPhoto, module: 'delivery', relatedModel: 'Collection', token, apiUrl, onProgress: setUploadProgress });
        receiptPath = receiptUpload.storagePath;
      }
      const saved = await submitDeliveryStatus(delivery._id, 'delivered', { ...pendingDeliveryPayment, deliveryPhoto: billUpload.storagePath, receiptPhoto: receiptPath });
      if (!saved) return;
      setBillModalVisible(false);
      setBillPhoto(null);
      setReceiptPhoto(null);
      setPendingDeliveryPayment(null);
    } catch (error) {
      Alert.alert('Delivery failed', error.message);
    } finally {
      setSubmittingCollection(false);
      setUploadProgress('');
    }
  };

  // Trigger Delivery failure modal
  const handleMarkFailed = (stop) => {
    setSelectedStop(stop);
    setFailureReason('');
    setFailureModalVisible(true);
  };

  // Submit delivery failure details
  const handleConfirmFailure = async () => {
    if (!failureReason.trim()) {
      Alert.alert('Required', 'Please enter reason for failure.');
      return;
    }

    const order = selectedStop.order;
    const delivery = getDeliveryForOrder(order._id || order);
    if (!delivery) return;

    setSubmittingFailure(true);
    try {
      await submitDeliveryStatus(delivery._id, 'failed', {
        failureReason: failureReason.trim(),
      });
      setFailureModalVisible(false);
    } finally {
      setSubmittingFailure(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Header Banner */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>🚚 Driver Console</Text>
        <Text style={styles.headerSubtitle}>Route Assignments & Deliveries</Text>
      </View>

      {/* Quick Action Navigation Grid */}
      <View style={styles.actionGrid}>
        <TouchableOpacity style={styles.actionBtn} onPress={onNavigateToAttendance}>
          <Text style={styles.actionIcon}>📅</Text>
          <Text style={styles.actionText}>Attendance</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionBtn} onPress={onNavigateToProducts}>
          <Text style={styles.actionIcon}>📋</Text>
          <Text style={styles.actionText}>Price List</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionBtn} onPress={onNavigateToLeave}>
          <Text style={styles.actionIcon}>✉️</Text>
          <Text style={styles.actionText}>Leave Apply</Text>
        </TouchableOpacity>
      </View>

      {/* Tabs Selector */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tabItem, activeTab === 'route' && styles.activeTab]}
          onPress={() => setActiveTab('route')}
        >
          <Text style={[styles.tabText, activeTab === 'route' && styles.activeTabText]}>
            Routes
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tabItem, activeTab === 'assigned' && styles.activeTab]} onPress={() => setActiveTab('assigned')}>
          <Text style={[styles.tabText, activeTab === 'assigned' && styles.activeTabText]}>Assigned</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tabItem, activeTab === 'out' && styles.activeTab]} onPress={() => setActiveTab('out')}>
          <Text style={[styles.tabText, activeTab === 'out' && styles.activeTabText]}>Out for Delivery</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabItem, activeTab === 'history' && styles.activeTab]}
          onPress={() => setActiveTab('history')}
        >
          <Text style={[styles.tabText, activeTab === 'history' && styles.activeTabText]}>
            Route History
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.container}>
        {loading ? (
          <ActivityIndicator color="#00796B" size="large" style={{ marginVertical: 40 }} />
        ) : ['route', 'assigned', 'out'].includes(activeTab) ? (
          (activeRoute || activeTab === 'assigned') ? (
            <View style={{ gap: 16 }}>
              {/* Route Summary Info */}
              {activeTab === 'route' && <View style={styles.routeSummaryCard}>
                <View style={styles.summaryRow}>
                  <Text style={styles.routeNumberText}>Route: {activeRoute.routeNumber}</Text>
                  <Text style={[styles.statusBadge, styles.activeBadge]}>
                    {activeRoute.status.toUpperCase()}
                  </Text>
                </View>
                <Text style={styles.routeDetailsText}>
                  Warehouse: {activeRoute.warehouse?.name || 'Main Warehouse'}
                </Text>
                <Text style={styles.routeDetailsText}>
                  Route Date: {new Date(activeRoute.routeDate).toLocaleDateString()} • Stops: {activeRoute.stops?.length || 0}
                </Text>

                {/* Global Optimized Route Link */}
                <TouchableOpacity
                  style={styles.optimizeRouteBtn}
                  onPress={handleOpenGoogleMapsRoute}
                >
                  <Text style={styles.optimizeRouteBtnText}>🗺️ Start Optimized Fuel-Saver Navigation</Text>
                </TouchableOpacity>
              </View>}

              {activeTab === 'route' && <View style={styles.routeSummaryCard}>
                <Text style={styles.sectionTitle}>Route configuration</Text>
                <Text style={styles.routeDetailsText}>Service area: {activeRoute.name}</Text>
                <Text style={styles.routeDetailsText}>Planned stops: {activeRoute.totalOrders || activeRoute.stops?.length || 0}</Text>
                <Text style={styles.routeDetailsText}>Estimated distance: {Number(activeRoute.estimatedDistanceKm || 0).toFixed(1)} km</Text>
                <Text style={styles.routeDetailsText}>Estimated duration: {Math.round(Number(activeRoute.estimatedDurationMinutes || 0))} minutes</Text>
              </View>}
              {activeTab === 'route' && <View>
                <Text style={styles.sectionTitle}>Orders included in this route</Text>
                {(activeRoute.stops || []).map((stop, index) => {
                  const order = stop.order;
                  const party = order?.partyId;
                  const delivery = getDeliveryForOrder(order?._id || order);
                  return <View key={stop._id || index} style={styles.stopCard}>
                    <View style={styles.stopHeader}>
                      <View style={styles.stopNumCircle}><Text style={styles.stopNumText}>{stop.sequence || index + 1}</Text></View>
                      <View style={{ flex: 1, marginLeft: 12 }}><Text style={styles.partyNameText}>{party?.partyName || 'Customer'}</Text><Text style={styles.orderNumText}>Order #{order?.orderNumber || '-'}</Text></View>
                      <Text style={[styles.stopStatusBadge, styles.pendingBadge]}>{String(delivery?.status || stop.status || 'planned').replaceAll('_', ' ').toUpperCase()}</Text>
                    </View>
                  </View>;
                })}
              </View>}
              {activeTab !== 'route' && <Text style={styles.sectionTitle}>{activeTab === 'assigned' ? 'All orders assigned to you' : 'Active-route orders currently being delivered'}</Text>}
              {activeTab !== 'route' && (activeTab === 'assigned'
                ? deliveries.filter((delivery) => ['assigned', 'dispatched'].includes(delivery.status)).map((delivery) => ({ _id: delivery._id, order: delivery.orderId, deliveryRecord: delivery }))
                : (activeRoute.stops || []).filter((stop) => getDeliveryForOrder(stop.order?._id || stop.order)?.status === 'out_for_delivery')
              ).map((stop, idx) => {
                const order = stop.order;
                const party = order?.partyId;
                const delivery = stop.deliveryRecord || getDeliveryForOrder(order?._id);
                const currentStatus = delivery?.status || stop.status || 'planned';
                const belongsToActiveRoute = (activeRoute?.stops || []).some((routeStop) => String(routeStop.order?._id || routeStop.order) === String(order?._id));

                return (
                  <View key={stop._id} style={styles.stopCard}>
                    {/* Header Stop Details */}
                    <View style={styles.stopHeader}>
                      <View style={styles.stopNumCircle}>
                        <Text style={styles.stopNumText}>{idx + 1}</Text>
                      </View>
                      <View style={{ flex: 1, marginLeft: 12 }}>
                        <Text style={styles.partyNameText}>
                          {party?.partyName || 'Unknown Customer'}
                        </Text>
                        <Text style={styles.orderNumText}>Order #{order?.orderNumber}</Text>
                      </View>
                      <Text style={[
                        styles.stopStatusBadge,
                        currentStatus === 'delivered' ? styles.deliveredBadge :
                        currentStatus === 'failed' ? styles.failedBadge : styles.pendingBadge
                      ]}>
                        {currentStatus.replace('_', ' ').toUpperCase()}
                      </Text>
                    </View>

                    {/* Address & Info */}
                    <View style={styles.stopBody}>
                      <Text style={styles.addressText}>📍 {party?.address || 'No Address configured'}</Text>
                      {party?.mobile ? (
                        <Text style={styles.mobileText}>📞 Mobile: {party.mobile}</Text>
                      ) : null}
                      
                      <View style={styles.amountPaymentRow}>
                        <Text style={styles.amountLabelText}>
                          Total Due: <Text style={styles.amountValueText}>₹{(order?.netPayableAmount || order?.grandTotal || 0).toLocaleString('en-IN')}</Text>
                        </Text>
                        <View style={[
                          styles.payTypeBadge,
                          order?.paymentType === 'cod' ? styles.codPayBadge : styles.creditPayBadge
                        ]}>
                          <Text style={styles.payTypeText}>
                            {order?.paymentType === 'cod' ? '💵 COD' : '💳 Credit/Prepaid'}
                          </Text>
                        </View>
                      </View>
                      <Text style={styles.mobileText}>Total load weight: {orderWeight(order).toFixed(2)} kg</Text>
                    </View>

                    {/* Quick navigation and deliver buttons */}
                    {['assigned', 'dispatched'].includes(currentStatus) && (
                      <View style={styles.stopActionsRow}>
                        {belongsToActiveRoute ? <TouchableOpacity
                          style={styles.deliverActionBtn}
                          onPress={() => Alert.alert('Start this delivery?', 'After starting, delivery result actions will become available.', [{ text: 'Not now', style: 'cancel' }, { text: 'Start Delivery', onPress: () => submitDeliveryStatus(delivery._id, 'out_for_delivery') }])}
                        >
                          <Text style={styles.deliverActionBtnText}>Start Delivery</Text>
                        </TouchableOpacity> : <Text style={styles.mobileText}>Waiting to be added to an active route</Text>}
                      </View>
                    )}
                    {currentStatus === 'out_for_delivery' && (
                      <View style={styles.stopActionsRow}>
                        <TouchableOpacity
                          style={styles.navigateActionBtn}
                          onPress={() => handleNavigateToStop(party?.location || stop)}
                        >
                          <Text style={styles.navigateActionBtnText}>📍 Maps</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={styles.failActionBtn}
                          onPress={() => handleMarkFailed(stop)}
                        >
                          <Text style={styles.failActionBtnText}>❌ Failed</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={styles.navigateActionBtn}
                          onPress={() => openPartialDelivery(stop)}
                        >
                          <Text style={styles.navigateActionBtnText}>Partial</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={styles.deliverActionBtn}
                          onPress={() => handleMarkDelivered(stop)}
                        >
                          <Text style={styles.deliverActionBtnText}>✅ Deliver</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          ) : (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyIcon}>🚚</Text>
              <Text style={styles.emptyTitle}>No Active Route</Text>
              <Text style={styles.emptyDesc}>You do not have an active route assigned for today.</Text>
            </View>
          )
        ) : routesHistory.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyIcon}>📂</Text>
            <Text style={styles.emptyTitle}>No Route History</Text>
            <Text style={styles.emptyDesc}>No previous delivery route assignments found.</Text>
          </View>
        ) : (
          <View style={{ gap: 12 }}>
            {routesHistory.map((route) => (
              <View key={route._id} style={styles.historyCard}>
                <View style={styles.summaryRow}>
                  <Text style={styles.historyRouteNumber}>Route: {route.routeNumber}</Text>
                  <Text style={[styles.statusBadge, styles.completedBadge]}>
                    {route.status.toUpperCase()}
                  </Text>
                </View>
                <Text style={styles.historyMetaText}>
                  Date: {new Date(route.routeDate).toLocaleDateString()}
                </Text>
                <Text style={styles.historyMetaText}>
                  Orders: {route.totalOrders || route.stops?.length || 0} • Distance: {Number(route.estimatedDistanceKm || 0).toFixed(1)} km
                </Text>
                <View style={{ marginTop: 10, gap: 6 }}>
                  {(route.stops || []).map((stop, index) => (
                    <View key={stop._id || index} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text style={styles.historyMetaText}>{index + 1}. #{stop.order?.orderNumber || 'Order'}</Text>
                      <Text style={styles.historyMetaText}>{String(stop.status || stop.order?.status || 'completed').replaceAll('_', ' ').toUpperCase()}</Text>
                    </View>
                  ))}
                </View>
                <Text style={styles.historyMetaText}>
                  Warehouse: {route.warehouse?.name || 'Main Warehouse'}
                </Text>
                <Text style={styles.historyMetaText}>
                  Total Stops: {route.stops?.length || 0} • Amount: ₹{route.totalAmount?.toLocaleString('en-IN') || 0}
                </Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {/* COD Payment Collection Modal */}
      {selectedStop && (
        <Modal
          visible={collectionModalVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setCollectionModalVisible(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Payment at Delivery</Text>
              <Text style={styles.modalSubtitle}>
                Please confirm payment from {selectedStop.order?.partyId?.partyName} before delivering.
              </Text>

              <View style={styles.divider} />

              <View style={{ gap: 12 }}>
                <Text style={styles.fieldLabel}>Amount Collected (INR)</Text>
                <TextInput
                  style={styles.inputField}
                  value={collectAmount}
                  onChangeText={setCollectAmount}
                  keyboardType="decimal-pad"
                />

                <Text style={styles.fieldLabel}>Payment Mode *</Text>
                <View style={styles.modeRow}>
                  {['cash', 'upi', 'cheque'].map((mode) => (
                    <TouchableOpacity
                      key={mode}
                      style={[styles.modeBtn, paymentMode === mode && styles.activeModeBtn]}
                      onPress={() => setPaymentMode(mode)}
                    >
                      <Text style={[styles.modeBtnText, paymentMode === mode && styles.activeModeBtnText]}>
                        {mode.toUpperCase()}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {paymentMode !== 'cash' && (
                  <>
                    <Text style={styles.fieldLabel}>Reference / Transaction No. *</Text>
                    <TextInput
                      style={styles.inputField}
                      placeholder="Enter UTR/Txn ID..."
                      placeholderTextColor="#A0AEC0"
                      value={transactionRef}
                      onChangeText={setTransactionRef}
                    />
                  </>
                )}

                <Text style={styles.fieldLabel}>Proof / Receipt Photo (Optional)</Text>
                <TouchableOpacity
                  style={{
                    height: 40,
                    backgroundColor: '#EDF2F7',
                    borderRadius: 8,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderWidth: 1,
                    borderColor: '#E2E8F0',
                    marginTop: 4,
                  }}
                  onPress={handleCapturePhoto}
                >
                  <Text style={{ fontSize: 13, color: '#4A5568', fontWeight: '700' }}>
                    📸 Capture Cash/Cheque Photo
                  </Text>
                </TouchableOpacity>
                {receiptPhoto ? (
                  <Text style={{ color: '#276749', fontSize: 12, fontWeight: '750', textAlign: 'center', marginTop: 4 }}>
                    ✓ Receipt photo attached successfully
                  </Text>
                ) : null}
              </View>

              <View style={styles.divider} />

              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={styles.modalCancelBtn}
                  onPress={() => continueToBillUpload({ paymentSkipped: true })}
                >
                  <Text style={styles.modalCancelBtnText}>Skip Payment</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.modalConfirmBtn, submittingCollection && { opacity: 0.7 }]}
                  onPress={handleConfirmCODCollection}
                  disabled={submittingCollection}
                >
                  {submittingCollection ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <ActivityIndicator color="#FFFFFF" size="small" />
                      <Text style={{ color: '#FFFFFF', fontWeight: 'bold', fontSize: 13 }}>
                        {uploadProgress || 'Loading...'}
                      </Text>
                    </View>
                  ) : (
                    <Text style={styles.modalConfirmBtnText}>Continue to Bill</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}

      {selectedStop && (
        <Modal visible={billModalVisible} transparent animationType="fade" onRequestClose={() => setBillModalVisible(false)}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Upload Delivered Bill</Text>
              <Text style={styles.modalSubtitle}>Take a clear photo of the bill handed to the party. This photo is mandatory for every delivered order.</Text>
              <TouchableOpacity style={styles.navigateActionBtn} onPress={captureBillPhoto}>
                <Text style={styles.navigateActionBtnText}>{billPhoto ? 'Retake Bill Photo' : 'Take Bill Photo *'}</Text>
              </TouchableOpacity>
              {billPhoto && <Text style={[styles.fieldLabel, { color: '#276749', marginTop: 8 }]}>Bill photo attached</Text>}
              <View style={styles.modalActions}>
                <TouchableOpacity style={styles.modalCancelBtn} onPress={() => { setBillModalVisible(false); setCollectionModalVisible(true); }}>
                  <Text style={styles.modalCancelBtnText}>Back</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.modalConfirmBtn} disabled={submittingCollection || !billPhoto} onPress={submitDeliveredBill}>
                  {submittingCollection ? <ActivityIndicator color="#fff" /> : <Text style={styles.modalConfirmBtnText}>Upload & Deliver</Text>}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}

      {selectedStop && (
        <Modal visible={partialModalVisible} transparent animationType="fade" onRequestClose={() => setPartialModalVisible(false)}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Partial delivery</Text>
              <Text style={styles.modalSubtitle}>Take a photo of the party return bill. Warehouse will verify item quantities and create the credit note.</Text>
              <ScrollView style={{ maxHeight: 330 }}>
                <TouchableOpacity style={styles.navigateActionBtn} onPress={capturePartialProof}><Text style={styles.navigateActionBtnText}>{partialProof ? 'Retake Return Bill Photo' : 'Take Return Bill Photo *'}</Text></TouchableOpacity>
                {partialProof && <Text style={[styles.fieldLabel, { color: '#276749', marginTop: 8 }]}>Photo attached</Text>}
                <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Driver remarks</Text>
                <TextInput style={[styles.inputField, { height: 70, textAlignVertical: 'top' }]} multiline value={partialRemarks} onChangeText={setPartialRemarks} />
              </ScrollView>
              <View style={styles.modalActions}>
                <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setPartialModalVisible(false)}><Text style={styles.modalCancelBtnText}>Cancel</Text></TouchableOpacity>
                <TouchableOpacity style={styles.modalConfirmBtn} disabled={submittingPartial} onPress={submitPartialDelivery}>{submittingPartial ? <ActivityIndicator color="#fff" /> : <Text style={styles.modalConfirmBtnText}>Record & return</Text>}</TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}

      {/* Delivery Failure Reason Modal */}
      {selectedStop && (
        <Modal
          visible={failureModalVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setFailureModalVisible(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>❌ Mark Delivery Failed</Text>
              <Text style={styles.modalSubtitle}>
                State the reason why order #{selectedStop.order?.orderNumber} could not be delivered.
              </Text>

              <View style={styles.divider} />

              <View style={{ gap: 12 }}>
                <Text style={styles.fieldLabel}>Reason for Failure *</Text>
                <TextInput
                  style={[styles.inputField, { height: 80, textAlignVertical: 'top' }]}
                  placeholder="e.g. Shop closed, Customer refused, Address incorrect..."
                  placeholderTextColor="#A0AEC0"
                  multiline
                  value={failureReason}
                  onChangeText={setFailureReason}
                />
              </View>

              <View style={styles.divider} />

              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={styles.modalCancelBtn}
                  onPress={() => setFailureModalVisible(false)}
                >
                  <Text style={styles.modalCancelBtnText}>Cancel</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.modalConfirmBtn, { backgroundColor: '#E53E3E' }, submittingFailure && { opacity: 0.7 }]}
                  onPress={handleConfirmFailure}
                  disabled={submittingFailure}
                >
                  {submittingFailure ? (
                    <ActivityIndicator color="#FFFFFF" size="small" />
                  ) : (
                    <Text style={styles.modalConfirmBtnText}>Save Failure</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
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
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 20,
    backgroundColor: '#00796B',
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  headerSubtitle: {
    fontSize: 13,
    color: '#E0F2F1',
    marginTop: 4,
    fontWeight: '500',
  },
  actionGrid: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 14,
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16,
    borderRadius: 16,
    marginTop: -16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#1A202C',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 4,
  },
  actionBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 90,
  },
  actionIcon: {
    fontSize: 24,
    marginBottom: 4,
  },
  actionText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#4A5568',
  },
  tabBar: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 16,
    backgroundColor: '#E2E8F0',
    borderRadius: 10,
    padding: 3,
  },
  tabItem: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 8,
  },
  activeTab: {
    backgroundColor: '#FFFFFF',
  },
  tabText: {
    fontSize: 13.5,
    fontWeight: '600',
    color: '#718096',
  },
  activeTabText: {
    color: '#00796B',
    fontWeight: '800',
  },
  container: {
    padding: 16,
    paddingBottom: 40,
  },
  routeSummaryCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.02,
    shadowRadius: 5,
    elevation: 2,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  routeNumberText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#2D3748',
  },
  statusBadge: {
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 6,
    fontSize: 11,
    fontWeight: '800',
  },
  activeBadge: {
    backgroundColor: '#E0F2F1',
    color: '#00796B',
  },
  completedBadge: {
    backgroundColor: '#E2E8F0',
    color: '#4A5568',
  },
  routeDetailsText: {
    fontSize: 12.5,
    color: '#718096',
    marginTop: 2,
    fontWeight: '550',
  },
  optimizeRouteBtn: {
    backgroundColor: '#00796B',
    borderRadius: 10,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
  },
  optimizeRouteBtnText: {
    color: '#FFFFFF',
    fontSize: 12.5,
    fontWeight: '800',
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#2D3748',
    marginBottom: 10,
  },
  stopCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 16,
    marginBottom: 12,
  },
  stopHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stopNumCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#00796B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopNumText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  partyNameText: {
    fontSize: 14.5,
    fontWeight: '800',
    color: '#2D3748',
  },
  orderNumText: {
    fontSize: 12,
    color: '#718096',
    marginTop: 1,
  },
  stopStatusBadge: {
    fontSize: 10,
    fontWeight: '800',
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 6,
    textTransform: 'uppercase',
  },
  deliveredBadge: {
    backgroundColor: '#DEF7EC',
    color: '#03543F',
  },
  failedBadge: {
    backgroundColor: '#FDE8E8',
    color: '#9B1C1C',
  },
  pendingBadge: {
    backgroundColor: '#FEF3C7',
    color: '#92400E',
  },
  stopBody: {
    marginTop: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#EDF2F7',
    gap: 4,
  },
  addressText: {
    fontSize: 13,
    color: '#4A5568',
    lineHeight: 18,
  },
  mobileText: {
    fontSize: 12.5,
    color: '#718096',
  },
  amountPaymentRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 6,
  },
  amountLabelText: {
    fontSize: 12.5,
    color: '#718096',
  },
  amountValueText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#2D3748',
  },
  payTypeBadge: {
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 6,
  },
  codPayBadge: {
    backgroundColor: '#FEF3C7',
  },
  creditPayBadge: {
    backgroundColor: '#EBF8FF',
  },
  payTypeText: {
    fontSize: 11,
    fontWeight: '750',
    color: '#2D3748',
  },
  stopActionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 12,
  },
  navigateActionBtn: {
    height: 36,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#00796B',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navigateActionBtnText: {
    color: '#00796B',
    fontSize: 12.5,
    fontWeight: '700',
  },
  failActionBtn: {
    height: 36,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#E53E3E',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  failActionBtnText: {
    color: '#E53E3E',
    fontSize: 12.5,
    fontWeight: '700',
  },
  deliverActionBtn: {
    height: 36,
    paddingHorizontal: 14,
    backgroundColor: '#00796B',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deliverActionBtnText: {
    color: '#FFFFFF',
    fontSize: 12.5,
    fontWeight: '800',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 80,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#2D3748',
  },
  emptyDesc: {
    fontSize: 13,
    color: '#718096',
    textAlign: 'center',
    marginTop: 4,
    paddingHorizontal: 20,
  },
  historyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 14,
  },
  historyRouteNumber: {
    fontSize: 15,
    fontWeight: '750',
    color: '#2D3748',
  },
  historyMetaText: {
    fontSize: 12.5,
    color: '#718096',
    marginTop: 2,
  },
  // Modal layout
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 20,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#1A202C',
  },
  modalSubtitle: {
    fontSize: 12.5,
    color: '#718096',
    marginTop: 4,
    lineHeight: 18,
  },
  divider: {
    height: 1,
    backgroundColor: '#E2E8F0',
    marginVertical: 14,
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#718096',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  inputField: {
    height: 42,
    backgroundColor: '#F7F9FC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 13.5,
    color: '#2D3748',
    fontWeight: '700',
  },
  modeRow: {
    flexDirection: 'row',
    gap: 8,
  },
  modeBtn: {
    flex: 1,
    height: 38,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  activeModeBtn: {
    borderColor: '#00796B',
    backgroundColor: '#E0F2F1',
  },
  modeBtnText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#718096',
  },
  activeModeBtnText: {
    color: '#00796B',
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  modalCancelBtn: {
    height: 40,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCancelBtnText: {
    color: '#718096',
    fontSize: 13,
    fontWeight: '700',
  },
  modalConfirmBtn: {
    height: 40,
    paddingHorizontal: 18,
    backgroundColor: '#00796B',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalConfirmBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
});
