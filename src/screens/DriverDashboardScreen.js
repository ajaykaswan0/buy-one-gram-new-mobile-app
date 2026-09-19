import React, { useState, useEffect, useCallback} from 'react';
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
  RefreshControl,
} from 'react-native';
import { scale, verticalScale, responsiveFontSize, maxContainerWidth } from '../utils/responsive';
import { launchCamera } from 'react-native-image-picker';
import { useLanguage } from '../i18n';
import { uploadFile } from '../services/firebaseUploadService';

export default function DriverDashboardScreen({
  token,
  apiUrl,
  activeLogId,
  onNavigateToAttendance,
  onNavigateToLeave,
  onNavigateToProducts,
  // Which of this screen's own tabs to open on. The footer's Delivery History
  // button reuses this same screen rather than building a second one — it just
  // opens straight onto the 'history' tab instead of 'route'.
  initialTab = 'route',
}) {
  /**
   * `t` is for our own words; `term` is for the words the API sends back.
   *
   * A status like `ready_for_delivery` is a stored value with a real Hindi
   * equivalent, so it translates. A party or product name does not — "Apex
   * Supermart 10" is what the shop is called, and rendering it in Devanagari
   * would stop it matching the paperwork, the invoice and the shopfront.
   */
  const { t, term } = useLanguage();
  const [activeRoute, setActiveRoute] = useState(null);
  const [deliveries, setDeliveries] = useState([]);
  // Where the van is, so the next drop can be the closest one.
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState(initialTab); // 'route' | 'assigned' | 'out' | 'history'

  // Modal states for COD Collection
  const [collectionModalVisible, setCollectionModalVisible] = useState(false);
  // What the party can still take on credit, asked when the modal opens.
  const [creditRoom, setCreditRoom] = useState(null);
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
  const [failureProof, setFailureProof] = useState(null);
  const [submittingFailure, setSubmittingFailure] = useState(false);
  const [historyOrderModalVisible, setHistoryOrderModalVisible] = useState(false);
  const [historyOrderDetail, setHistoryOrderDetail] = useState(null);
  const [historyOrderLoading, setHistoryOrderLoading] = useState(false);
  const getLocalDateKey = (value) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const unitWeight = (item) => {
    if (Number(item?.baseQuantity) > 0) return Number(item.baseQuantity);
    const label = `${item?.packSize || ''} ${item?.unit || ''} ${item?.variantName || ''}`.toLowerCase();
    const value = Number(label.match(/[\d.]+/)?.[0] || 0);
    return label.includes('gm') || label.includes('ml') ? value / 1000 : value;
  };
  const orderWeight = (order) => (order?.items || []).reduce(
    (sum, item) => sum + unitWeight(item) * Number(item.quantity || 0), 0
  );

  // Pull down to reload, so the screen can be refreshed in place rather than
  // by navigating away and back.
  const [refreshing, setRefreshing] = useState(false);
  const onPullRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadDriverData();
    } catch (e) {
      console.log('[Refresh] failed:', e.message);
    } finally {
      setRefreshing(false);
    }
  }, [loadDriverData]);

  const loadDriverData = async () => {
    setLoading(true);
    try {
      // 1. Fetch routes assigned to this driver
      try {
        const routesResponse = await fetch(`${apiUrl}/transportation/routes?driverId=self`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const text = await routesResponse.text();
        const routesData = text ? JSON.parse(text) : null;
        if (routesResponse.ok && routesData?.success) {
          const allRoutes = routesData.data || [];
          const todayKey = getLocalDateKey(new Date());
          const todayRoutes = allRoutes.filter((route) => getLocalDateKey(route.routeDate) === todayKey);
          const active = todayRoutes.find((route) => route.status !== 'cancelled' && route.status !== 'completed')
            || allRoutes.find((route) => route.status !== 'cancelled' && route.status !== 'completed')
            || allRoutes[0];

          if (active) {
            // path=0: the drawn road geometry costs a routing call and there is
            // no map on this screen to put it on.
            const detailResponse = await fetch(`${apiUrl}/transportation/routes/${active._id}?path=0`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            const detailText = await detailResponse.text();
            const detailData = detailText ? JSON.parse(detailText) : null;
            if (detailResponse.ok && detailData?.success) {
              // The totals come from the server, so the load the office planned
              // and the load the driver is told about are the same figures.
              setActiveRoute({ ...detailData.data, summary: detailData.summary || null });
            } else {
              setActiveRoute(active);
            }
          } else {
            setActiveRoute(null);
          }
        }
      } catch (err) {
        console.log('Routes fetch info:', err.message);
      }

      // 2. Fetch driver deliveries to get Delivery IDs and statuses
      try {
        const delivResponse = await fetch(`${apiUrl}/delivery/my`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const text = await delivResponse.text();
        const delivData = text ? JSON.parse(text) : null;
        if (delivResponse.ok && delivData?.success) {
          setDeliveries(delivData.data || []);
        }
      } catch (err) {
        console.log('Delivery my fetch info:', err.message);
      }

      // 3. Fetch direct driver order assignments
      try {
        const ordersResponse = await fetch(`${apiUrl}/order/my`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const text = await ordersResponse.text();
        const ordersData = text ? JSON.parse(text) : null;
        if (ordersResponse.ok && ordersData?.success && Array.isArray(ordersData.data)) {
          const directOrders = ordersData.data.map(o => ({
            _id: o._id,
            orderId: o,
            status: o.status,
            partyId: o.partyId,
            deliveryNumber: o.orderNumber,
            isVirtual: true,
          }));
          setDeliveries(prev => {
            const map = new Map();
            (prev || []).forEach(d => map.set(String(d.orderId?._id || d.orderId || d._id), d));
            directOrders.forEach(d => {
              const key = String(d.orderId?._id || d.orderId || d._id);
              if (!map.has(key)) map.set(key, d);
            });
            return Array.from(map.values());
          });
        }
      } catch (err) {
        console.log('Order my fetch info:', err.message);
      }
    } catch (e) {
      console.warn('Driver data fetch error:', e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (token && apiUrl) {
      loadDriverData();
    }
  }, [token, apiUrl]);


  // Find corresponding Delivery document for an order ID or stop item
  const getDeliveryForOrder = (orderId, stop = null) => {
    if (stop?.deliveryRecord) return stop.deliveryRecord;
    if (stop?.deliveryNumber) return stop;
    if (!orderId && !stop) return null;

    const targetId = String(orderId?._id || orderId || stop?.order?._id || stop?.order || stop?._id || '');
    if (!targetId) return null;

    const found = deliveries.find(d => {
      const dOrderId = String(d.orderId?._id || d.orderId || '');
      const dId = String(d._id || '');
      return dOrderId === targetId || dId === targetId;
    });

    if (found) return found;

    if (stop || orderId) {
      return {
        _id: targetId,
        orderId: stop?.order || orderId,
        status: stop?.status || 'dispatched',
        isVirtual: true,
      };
    }

    return null;
  };
  // Exact user tab rules:
  const assignedStatuses = ['dispatched', 'assigned', 'ready_for_delivery', 'planned', 'confirmed', 'packed', 'warehouse', 'draft'];
  const outForDeliveryStatuses = ['out_for_delivery', 'in_transit', 'outfordelivery'];
  const completedStatuses = ['delivered', 'cancelled', 'failed', 'returned'];

  const getEffectiveStatus = (stopOrDelivery) => {
    const order = stopOrDelivery?.order || stopOrDelivery?.orderId;
    const delivery = stopOrDelivery?.deliveryRecord || getDeliveryForOrder(order?._id || order) || (stopOrDelivery?.deliveryNumber ? stopOrDelivery : null);
    const rawStatus = order?.status || delivery?.status || stopOrDelivery?.status || 'dispatched';
    return String(rawStatus).toLowerCase().trim();
  };

  const completedOrders = (deliveries || []).filter((d) => {
    const status = getEffectiveStatus(d);
    return completedStatuses.includes(status);
  }).sort((a, b) => {
    const timeA = new Date(a.deliveredAt || a.updatedAt || a.createdAt || 0).getTime();
    const timeB = new Date(b.deliveredAt || b.updatedAt || b.createdAt || 0).getTime();
    return timeB - timeA;
  });

  // The two working tabs split on one question: is this order on my route?
  //
  // Previously both were derived from order status, which meant an order assigned
  // to a driver but never put on a route could quietly appear in neither list.
  const routeStops = activeRoute?.stops || [];
  const routeOrderIds = new Set(
    routeStops.map((stop) => String(stop.order?._id || stop.order || stop._id)),
  );

  // "Ready for Delivery": everything on my route that is not finished yet.
  const outForDeliveryStops = routeStops.filter(
    (stop) => !completedStatuses.includes(getEffectiveStatus(stop)),
  );

  // "Assigned to me": assigned to me but on no route - the gap that used to be
  // invisible. These are the orders the office has given me that nobody has
  // planned into a trip.
  const assignedRouteStops = deliveries
    .filter((d) => {
      const key = String(d.orderId?._id || d.orderId || d._id);
      if (routeOrderIds.has(key)) return false;
      return !completedStatuses.includes(getEffectiveStatus(d));
    })
    .map((d) => ({
      _id: d._id,
      order: d.orderId,
      deliveryRecord: d.isVirtual ? null : d,
      party: d.partyId || d.orderId?.partyId,
      latitude: d.partyId?.location?.latitude || d.orderId?.partyId?.location?.latitude,
      longitude: d.partyId?.location?.longitude || d.orderId?.partyId?.location?.longitude,
      status: d.status,
      notInRoute: true,
    }));

  // Launch optimized Google Maps sequencing for all stops
  const handleOpenGoogleMapsRoute = () => {
    if (!activeRoute || !activeRoute.stops || activeRoute.stops.length === 0) return;

    // Origin starts at the warehouse if coordinates are configured
    const startLoc = activeRoute.warehouse?.location;
    const origin = startLoc && startLoc.latitude
      ? `${startLoc.latitude},${startLoc.longitude}`
      : 'current+location';

    /**
     * The stops still worth driving to, in the planned order.
     *
     * This used to demand a delivery status of exactly `out_for_delivery` —
     * a status nothing in this app ever sets, so the list was always empty
     * and the button always claimed the stops had no GPS coordinates, whatever
     * the real reason. What actually matters is: not already dealt with, and
     * somewhere to point the map at. An errand stop has no order and so no
     * delivery record, but the driver still has to physically go there.
     */
    const stopsList = [...activeRoute.stops]
      .sort((a, b) => (a.sequence || 0) - (b.sequence || 0))
      .filter((stop) => {
        if (!stop.latitude || !stop.longitude) return false;
        if (!stop.order) return true;
        const delivery = getDeliveryForOrder(stop.order?._id || stop.order);
        const status = String(delivery?.status || stop.status || '').toLowerCase();
        return !completedStatuses.includes(status);
      });
    if (stopsList.length === 0) {
      Alert.alert(t('No Locations'), t('Every stop on this route is either delivered or has no saved location.'));
      return;
    }

    const lastStop = stopsList[stopsList.length - 1];
    const destination = `${lastStop.latitude},${lastStop.longitude}`;

    // Waypoints represent stops 1 to (N-1)
    const waypoints = stopsList.slice(0, -1).map(s => `${s.latitude},${s.longitude}`).join('|');

    const mapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}&waypoints=${waypoints}&travelmode=driving`;
    Linking.openURL(mapsUrl).catch(() => {
      Alert.alert(t('Error'), t('Google Maps could not be opened.'));
    });
  };

  // Open single stop directions
  const handleNavigateToStop = (stop) => {
    if (!stop.latitude || !stop.longitude) {
      Alert.alert(t('Missing Location'), t('Customer location not configured.'));
      return;
    }
    const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${stop.latitude},${stop.longitude}&travelmode=driving`;
    Linking.openURL(mapsUrl).catch(() => {
      Alert.alert(t('Error'), t('Google Maps could not be opened.'));
    });
  };

  // Trigger Delivery check / collection form
  const handleMarkDelivered = (stop) => {
    const orderObj = stop?.order || stop?.orderId || stop;
    const delivery = getDeliveryForOrder(orderObj?._id || orderObj, stop);
    if (!delivery) {
      Alert.alert(t('Error'), t('No active delivery record found for this stop.'));
      return;
    }

    const order = typeof orderObj === 'object' ? orderObj : (stop?.order || stop);
    setSelectedStop({ ...stop, order });
    setCollectAmount(order?.paymentType === 'cod' ? String(order.netPayableAmount || order.grandTotal || 0) : '');
    setPaymentMode('cash');
    setTransactionRef('');
    setReceiptPhoto(null);
    setPendingDeliveryPayment(null);
    setBillPhoto(null);
    setCreditRoom(null);
    setCollectionModalVisible(true);

    /**
     * Whether the goods may be left unpaid, asked now rather than found out
     * later.
     *
     * Skip Payment used to be offered on every order: the driver photographed
     * the bill, tapped skip, waited for the upload, and was then refused because
     * the party had no credit left. Asked here the button simply is not
     * available, with the reason on it.
     *
     * Asked fresh every time, because a party's outstanding moves through the
     * day and the figure the route was loaded with is already old.
     */
    const orderId = order?._id || orderObj?._id;
    if (orderId) {
      fetch(`${apiUrl}/order/${orderId}/credit-room`, { headers: { Authorization: `Bearer ${token}` } })
        .then((r) => r.json())
        .then((data) => { if (data?.success) setCreditRoom(data.data); })
        // A failed check must not block the delivery. The server enforces the
        // rule when the delivery is submitted either way.
        .catch(() => {});
    }
  };

  // Submit delivery status update (API call)
  const submitDeliveryStatus = async (deliveryId, status, payloadExtra = {}) => {
    try {
      let response = await fetch(`${apiUrl}/delivery/${deliveryId}/status`, {
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

      if (response.status === 404 && payloadExtra?.orderId) {
        const targetOrderId = String(payloadExtra.orderId._id || payloadExtra.orderId);
        response = await fetch(`${apiUrl}/order/${targetOrderId}/status`, {
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
      }

      const data = await response.json();
      if (response.ok && data.success) {
        Alert.alert(t('Success'), `Delivery status marked as ${status}!`);
        loadDriverData();
        return true;
      } else {
        Alert.alert(t('Failed'), data.message || 'Could not update delivery.');
        return false;
      }
    } catch (e) {
      console.warn('Delivery update error:', e.message);
      Alert.alert(t('Error'), t('Network connection issue.'));
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
          Alert.alert(t('Camera Error'), response.errorMessage || 'Failed to start camera.');
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

  /**
   * Straight to the camera once payment is settled.
   *
   * A driver standing at a doorway with the bill in one hand should not have to
   * read a second screen and press "upload" before the camera opens. Both
   * confirming payment and skipping it now open the camera immediately; the
   * shot is the last thing between here and the delivery being done.
   *
   * If the camera is dismissed, the old screen is shown rather than leaving the
   * delivery half-finished with nowhere to go.
   */
  const continueToBillUpload = (payment) => {
    setPendingDeliveryPayment(payment);
    setCollectionModalVisible(false);

    launchCamera(
      { mediaType: 'photo', quality: 0.8, maxWidth: 1600, maxHeight: 1600, includeBase64: false },
      (response) => {
        if (response.didCancel) { setBillModalVisible(true); return; }
        if (response.errorCode) {
          Alert.alert(t('Camera Error'), response.errorMessage || 'Failed to start camera.');
          setBillModalVisible(true);
          return;
        }
        const asset = response.assets?.[0];
        if (!asset) { setBillModalVisible(true); return; }
        const photo = { uri: asset.uri, fileName: asset.fileName, type: asset.type, fileSize: asset.fileSize };
        setBillPhoto(photo);
        // Passed along explicitly: the state set just above has not landed yet
        // by the time this runs.
        submitDeliveredBill(payment, photo);
      }
    );
  };

  const captureBillPhoto = () => launchCamera(
    { mediaType: 'photo', quality: 0.8, maxWidth: 1600, maxHeight: 1600, includeBase64: false },
    (response) => {
      if (response.didCancel) return;
      if (response.errorCode) return Alert.alert(t('Camera Error'), response.errorMessage || 'Failed to start camera.');
      const asset = response.assets?.[0];
      if (asset) setBillPhoto({ uri: asset.uri, fileName: asset.fileName, type: asset.type, fileSize: asset.fileSize });
    }
  );

  // Record payment decision first; delivery completes only after bill photo.
  const handleConfirmCODCollection = () => {
    if (!collectAmount.trim()) {
      Alert.alert(t('Required'), t('Please enter collected amount.'));
      return;
    }

    const order = selectedStop.order;
    const expected = Number(order.netPayableAmount || order.grandTotal || 0);
    if (Number(collectAmount) <= 0 || Number(collectAmount) > expected) {
      Alert.alert(t('Mismatched Amount'), `Collected amount must match the order total: ₹${expected}`);
      return;
    }

    if (paymentMode !== 'cash' && !transactionRef.trim()) {
      Alert.alert(t('Required'), paymentMode === 'cheque' ? 'Enter cheque number.' : 'Enter transaction reference.');
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

  const submitDeliveredBill = async (paymentOverride = null, photoOverride = null) => {
    const order = selectedStop?.order || selectedStop;
    const delivery = getDeliveryForOrder(order?._id || order, selectedStop);
    // Taken as arguments when called straight from the camera, because React
    // has not applied the state by that point.
    const payment = paymentOverride || pendingDeliveryPayment;
    const photo = photoOverride || billPhoto;
    if (!delivery || !photo) return Alert.alert(t('Bill required'), t('Take a photo of the delivered bill.'));
    setSubmittingCollection(true);
    try {
      const billUpload = await uploadFile({ file: photo, module: 'delivery', relatedModel: 'Delivery', relatedId: delivery._id, token, apiUrl, onProgress: setUploadProgress });
      let receiptPath;
      if (receiptPhoto && !payment?.paymentSkipped) {
        const receiptUpload = await uploadFile({ file: receiptPhoto, module: 'delivery', relatedModel: 'Collection', token, apiUrl, onProgress: setUploadProgress });
        receiptPath = receiptUpload.storagePath;
      }
      const saved = await submitDeliveryStatus(delivery._id, 'delivered', { ...payment, deliveryPhoto: billUpload.storagePath, receiptPhoto: receiptPath, orderId: order?._id || order });
      if (!saved) return;
      setBillModalVisible(false);
      setBillPhoto(null);
      setReceiptPhoto(null);
      setPendingDeliveryPayment(null);
    } catch (error) {
      Alert.alert(t('Delivery failed'), error.message);
    } finally {
      setSubmittingCollection(false);
      setUploadProgress('');
    }
  };

  // Trigger Delivery failure modal
  const handleMarkFailed = (stop) => {
    setSelectedStop(stop);
    setFailureReason('');
    setFailureProof(null);
    setFailureModalVisible(true);
  };

  const openHistoryOrderDetail = async (orderId) => {
    if (!orderId) return;
    setHistoryOrderLoading(true);
    setHistoryOrderDetail(null);
    setHistoryOrderModalVisible(true);
    try {
      const response = await fetch(`${apiUrl}/order/${orderId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (response.ok && data.success) {
        setHistoryOrderDetail(data.data);
      } else {
        Alert.alert(t('Failed'), data.message || 'Could not load order details.');
      }
    } catch (error) {
      Alert.alert(t('Error'), t('Could not load order details.'));
    } finally {
      setHistoryOrderLoading(false);
    }
  };

  // Submit delivery failure details
  const handleConfirmFailure = async () => {
    if (!failureReason.trim()) {
      Alert.alert(t('Required'), t('Please enter reason for failure.'));
      return;
    }

    const order = selectedStop.order;
    const delivery = getDeliveryForOrder(order._id || order);
    if (!delivery) return;

    setSubmittingFailure(true);
    try {
      let proofPath;
      if (failureProof) {
        const proofUpload = await uploadFile({
          file: failureProof,
          module: 'delivery',
          relatedModel: 'Delivery',
          token,
          apiUrl,
          onProgress: (stage) => setUploadProgress(stage),
        });
        proofPath = proofUpload.storagePath;
      }
      await submitDeliveryStatus(delivery._id, 'failed', {
        failureReason: failureReason.trim(),
        deliveryPhoto: proofPath,
      });
      setFailureModalVisible(false);
    } finally {
      setSubmittingFailure(false);
    }
  };

  const captureFailureProof = () => launchCamera(
    { mediaType: 'photo', quality: 0.8, maxWidth: 1600, maxHeight: 1600, includeBase64: false },
    (response) => {
      if (response.didCancel) return;
      if (response.errorCode) return Alert.alert(t('Camera Error'), response.errorMessage || 'Failed to start camera.');
      const asset = response.assets?.[0];
      if (asset) setFailureProof({ uri: asset.uri, fileName: asset.fileName, type: asset.type, fileSize: asset.fileSize });
    }
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Header Banner */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>🚚 Driver Console</Text>
        <Text style={styles.headerSubtitle}>{t('Route Assignments & Deliveries')}</Text>
      </View>

      {/* Quick Action Navigation Grid */}
      <View style={styles.actionGrid}>
        <TouchableOpacity style={styles.actionBtn} onPress={onNavigateToAttendance}>
          <Text style={styles.actionIcon}>📅</Text>
          <Text style={styles.actionText}>{t('Attendance')}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionBtn} onPress={onNavigateToProducts}>
          <Text style={styles.actionIcon}>📋</Text>
          <Text style={styles.actionText}>{t('Price List')}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionBtn} onPress={onNavigateToLeave}>
          <Text style={styles.actionIcon}>✉️</Text>
          <Text style={styles.actionText}>{t('Leave Apply')}</Text>
        </TouchableOpacity>
      </View>

      {/* Tabs Selector */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tabItem, activeTab === 'route' && styles.activeTab]}
          onPress={() => setActiveTab('route')}
        >
          <Text style={[styles.tabText, activeTab === 'route' && styles.activeTabText]}>{t('Routes')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tabItem, activeTab === 'assigned' && styles.activeTab]} onPress={() => setActiveTab('assigned')}>
          <Text style={[styles.tabText, activeTab === 'assigned' && styles.activeTabText]}>{t('Assigned')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tabItem, activeTab === 'out' && styles.activeTab]} onPress={() => setActiveTab('out')}>
          <Text style={[styles.tabText, activeTab === 'out' && styles.activeTabText]}>{t('Ready for Delivery')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabItem, activeTab === 'history' && styles.activeTab]}
          onPress={() => setActiveTab('history')}
        >
          <Text style={[styles.tabText, activeTab === 'history' && styles.activeTabText]}>{t('Delivered History')}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.container}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onPullRefresh} colors={['#00796B']} tintColor="#00796B" />
        }
      >
        {loading ? (
          <ActivityIndicator color="#00796B" size="large" style={{ marginVertical: 40 }} />
        ) : ['route', 'assigned', 'out'].includes(activeTab) ? (
          (activeRoute || activeTab === 'assigned' || activeTab === 'out') ? (
            <View style={{ gap: 16 }}>
              {/* Route Summary Info */}
              {activeTab === 'route' && <View style={styles.routeSummaryCard}>
                <View style={styles.summaryRow}>
                  <Text style={styles.routeNumberText}>Route: {activeRoute.routeNumber}</Text>
                  <Text style={[styles.statusBadge, styles.activeBadge]}>
                    {term(activeRoute.status)}
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
                <Text style={styles.sectionTitle}>{t('Route configuration')}</Text>
                <Text style={styles.routeDetailsText}>Service area: {activeRoute.name}</Text>
                <Text style={styles.routeDetailsText}>Planned stops: {activeRoute.summary?.stops || activeRoute.stops?.length || 0}</Text>
                <Text style={styles.routeDetailsText}>Orders: {activeRoute.summary?.orders ?? activeRoute.totalOrders ?? 0}{activeRoute.summary?.replacements ? `  (${activeRoute.summary.replacements} replacement)` : ''}</Text>
                <Text style={styles.routeDetailsText}>Total load: {activeRoute.summary?.weightKg ?? 0} kg</Text>
                <Text style={styles.routeDetailsText}>Estimated distance: {Number(activeRoute.estimatedDistanceKm || 0).toFixed(1)} km</Text>
                <Text style={styles.routeDetailsText}>Estimated duration: {Math.round(Number(activeRoute.estimatedDurationMinutes || 0))} minutes</Text>
              </View>}
              {activeTab === 'route' && <View>
                <Text style={styles.sectionTitle}>Stops, in the planned order</Text>
                {/*
                  The office's sequence, exactly as planned.

                  This used to re-sort by whichever shop was nearest, so the
                  numbers the planner saw on the map and the numbers the driver
                  saw on his phone were different — and the optimised order,
                  which is the whole point of planning a route, was thrown away
                  every time the screen opened.
                */}
                {[...(activeRoute.stops || [])].sort((a, b) => (a.sequence || 0) - (b.sequence || 0)).map((stop, index) => {
                  const order = stop.order;
                  const party = order?.partyId;
                  const delivery = getDeliveryForOrder(order?._id || order);
                  const currentStatus = delivery?.status || stop.status || 'planned';

                  // An errand the office put on the route — collecting sacks, a
                  // bank run. It has no bill, so the delivery card would show it
                  // as "Customer, Order #-, ₹0" with a Deliver button that means
                  // nothing. It gets its own line instead.
                  if (!order) {
                    return <View key={stop._id || index} style={styles.stopCard}>
                      <View style={styles.stopHeader}>
                        <View style={styles.stopNumCircle}><Text style={styles.stopNumText}>{stop.sequence || index + 1}</Text></View>
                        <View style={{ flex: 1, marginLeft: 12 }}>
                          <Text style={styles.partyNameText}>{stop.label || 'Stop'}</Text>
                          <Text style={styles.orderNumText}>No delivery — a stop on the way</Text>
                        </View>
                      </View>
                      {stop.address ? <View style={styles.stopBody}>
                        <Text style={styles.addressText}>📍 {stop.address}</Text>
                      </View> : null}
                      <View style={styles.stopActionsRow}>
                        <TouchableOpacity style={styles.navigateActionBtn} onPress={() => handleNavigateToStop(stop)}>
                          <Text style={styles.navigateActionBtnText}>📍 Maps</Text>
                        </TouchableOpacity>
                      </View>
                    </View>;
                  }

                  return <View key={stop._id || index} style={styles.stopCard}>
                    <View style={styles.stopHeader}>
                      <View style={styles.stopNumCircle}><Text style={styles.stopNumText}>{stop.sequence || index + 1}</Text></View>
                      <View style={{ flex: 1, marginLeft: 12 }}>
                        <Text style={styles.partyNameText}>{party?.partyName || 'Customer'}</Text>
                        <Text style={styles.orderNumText}>Order #{order?.orderNumber || '-'}</Text>
                        {/* Goods going back out over a complaint. The driver has
                            to know before he knocks, not after. */}
                        {stop.isReplacement || order?.orderType === 'replacement'
                          ? <Text style={styles.replacementTag}>REPLACEMENT</Text>
                          : null}
                      </View>
                      <Text style={[
                        styles.stopStatusBadge,
                        currentStatus === 'delivered' ? styles.deliveredBadge :
                        currentStatus === 'failed' ? styles.failedBadge : styles.pendingBadge
                      ]}>{term(currentStatus)}</Text>
                    </View>
                    <View style={styles.stopBody}>
                      <Text style={styles.addressText}>📍 {party?.address || 'No Address configured'}</Text>
                      {party?.mobile ? <Text style={styles.mobileText}>📞 Mobile: {party.mobile}</Text> : null}
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
                    {!['delivered', 'cancelled', 'failed', 'returned'].includes(String(currentStatus).toLowerCase()) && (
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
                          <Text style={styles.failActionBtnText}>{t('Cancel')}</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={styles.deliverActionBtn}
                          onPress={() => handleMarkDelivered(stop)}
                        >
                          <Text style={styles.deliverActionBtnText}>✅ Deliver</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                    {String(currentStatus).toLowerCase() === 'cancelled' && (
                      <View style={styles.stopActionsRow}>
                        <Text style={styles.mobileText}>{t('Cancelled order')}</Text>
                      </View>
                    )}
                  </View>;
                })}
              </View>}
              {activeTab !== 'route' && <Text style={styles.sectionTitle}>{activeTab === 'assigned' ? 'Assigned to me, not yet in a route' : 'Ready for delivery - orders on my route'}</Text>}
              {activeTab !== 'route' && (activeTab === 'assigned'
                ? assignedRouteStops
                : outForDeliveryStops
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
                        {term(currentStatus)}
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

                    {/* Assigned list is read-only. Delivery actions are only available in Route and Out for Delivery tabs. */}
                    {activeTab === 'assigned' && (
                      <View style={styles.stopActionsRow}>
                        {belongsToActiveRoute
                          ? <Text style={styles.mobileText}>{t('Open this order from Routes / Out for Delivery to act on it')}</Text>
                          : <Text style={styles.mobileText}>{t('Waiting to be added to an active route')}</Text>}
                      </View>
                    )}
                    {(currentStatus === 'out_for_delivery' || currentStatus === 'dispatched' || activeTab === 'out') && (
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
                          <Text style={styles.failActionBtnText}>{t('Cancel')}</Text>
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
              <Text style={styles.emptyTitle}>{t('No Active Route')}</Text>
              <Text style={styles.emptyDesc}>{t('You do not have an active route assigned for today.')}</Text>
            </View>
          )
        ) : completedOrders.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyIcon}>📂</Text>
            <Text style={styles.emptyTitle}>{t('No Delivered History')}</Text>
            <Text style={styles.emptyDesc}>{t('No completed or delivered orders found.')}</Text>
          </View>
        ) : (
          <View style={{ gap: 12 }}>
            {completedOrders.map((delivery, index) => {
              const order = delivery.orderId || delivery.order || delivery;
              const party = order?.partyId || delivery.partyId || {};
              const currentStatus = getEffectiveStatus(delivery);
              return (
              <View key={delivery._id || index} style={styles.historyCard}>
                <View style={styles.summaryRow}>
                  <Text style={styles.historyRouteNumber}>Order: {order?.orderNumber || delivery.deliveryNumber || 'Order'}</Text>
                  <Text style={[styles.statusBadge, styles.completedBadge]}>
                    {term(currentStatus)}
                  </Text>
                </View>
                <Text style={styles.historyMetaText}>
                  Party: {party.partyName || party.name || 'Customer'}
                </Text>
                <Text style={styles.historyMetaText}>
                  Date: {new Date(delivery.updatedAt || delivery.createdAt || Date.now()).toLocaleDateString()}
                </Text>
                <Text style={styles.historyMetaText}>
                  Amount: ₹{Number(order?.netPayableAmount || order?.grandTotal || delivery.amount || 0).toLocaleString('en-IN')}
                </Text>
                <Text style={styles.historyMetaText}>
                  Route: {delivery.routeId?.routeNumber || delivery.route?.routeNumber || 'Direct'}
                </Text>
                <Text style={styles.historyMetaText}>
                  Warehouse: {delivery.warehouseId?.name || delivery.routeId?.warehouse?.name || 'Main Warehouse'}
                </Text>
                <TouchableOpacity style={[styles.historyViewBtn, { marginTop: 10 }]} onPress={() => openHistoryOrderDetail(order?._id || order)}>
                  <Text style={styles.historyViewBtnText}>{t('View Order Details')}</Text>
                </TouchableOpacity>
              </View>
              );
            })}
          </View>
        )}
      </ScrollView>
      <Modal visible={historyOrderModalVisible} transparent animationType="fade" onRequestClose={() => setHistoryOrderModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{t('Order Details')}</Text>
            {historyOrderLoading ? (
              <ActivityIndicator color="#00796B" size="large" style={{ marginVertical: 24 }} />
            ) : historyOrderDetail ? (
              <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ gap: 8 }}>
                <Text style={styles.historyMetaText}>Order No: {historyOrderDetail.orderNumber}</Text>
                <Text style={styles.historyMetaText}>Party: {historyOrderDetail.partyId?.partyName || '—'}</Text>
                <Text style={styles.historyMetaText}>Mobile: {historyOrderDetail.partyId?.mobile || '—'}</Text>
                <Text style={styles.historyMetaText}>Address: {historyOrderDetail.partyId?.address || '—'}</Text>
                <Text style={styles.historyMetaText}>{t('Status')}: {term(historyOrderDetail.status || '')}</Text>
                <Text style={styles.historyMetaText}>Payment: {String(historyOrderDetail.paymentType || '—').toUpperCase()}</Text>
                <Text style={styles.historyMetaText}>Total: ₹{Number(historyOrderDetail.netPayableAmount || historyOrderDetail.grandTotal || 0).toLocaleString('en-IN')}</Text>
                <Text style={styles.historyMetaText}>Weight: {orderWeight(historyOrderDetail).toFixed(2)} kg</Text>
                <View style={styles.divider} />
                {(historyOrderDetail.items || []).map((item, index) => (
                  <View key={item._id || index} style={styles.historyItemCard}>
                    <Text style={styles.historyMetaText}>{index + 1}. {item.productName}</Text>
                    <Text style={styles.historyMetaText}>Variant: {item.variantName || '-'}</Text>
                    <Text style={styles.historyMetaText}>Qty: {item.quantity}</Text>
                    <Text style={styles.historyMetaText}>Weight: {(unitWeight(item) * Number(item.quantity || 0)).toFixed(2)} kg</Text>
                  </View>
                ))}
              </ScrollView>
            ) : (
              <Text style={styles.historyMetaText}>{t('No order details found.')}</Text>
            )}
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setHistoryOrderModalVisible(false)}>
                <Text style={styles.modalCancelBtnText}>{t('Close')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

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
              {/*
                * A way out of the popup.
                *
                * It could only be closed by finishing or by the hardware back
                * button, which on a delivery screen is easy to miss and leaves
                * a driver stuck mid-doorstep.
                */}
              <TouchableOpacity
                style={styles.modalCloseX}
                onPress={() => setCollectionModalVisible(false)}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Text style={styles.modalCloseXText}>✕</Text>
              </TouchableOpacity>
              <Text style={styles.modalTitle}>{t('Payment at Delivery')}</Text>
              <Text style={styles.modalSubtitle}>
                Please confirm payment from {selectedStop.order?.partyId?.partyName} before delivering.
              </Text>

              <View style={styles.divider} />

              <View style={{ gap: 12 }}>
                <Text style={styles.fieldLabel}>{t('Amount Collected (INR)')}</Text>
                <TextInput
                  style={styles.inputField}
                  value={collectAmount}
                  onChangeText={setCollectAmount}
                  keyboardType="decimal-pad"
                />

                <Text style={styles.fieldLabel}>{t('Payment Mode *')}</Text>
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
                    <Text style={styles.fieldLabel}>{t('Reference / Transaction No. *')}</Text>
                    <TextInput
                      style={styles.inputField}
                      placeholder="Enter UTR/Txn ID..."
                      placeholderTextColor="#A0AEC0"
                      value={transactionRef}
                      onChangeText={setTransactionRef}
                    />
                  </>
                )}

                <Text style={styles.fieldLabel}>{t('Proof / Receipt Photo (Optional)')}</Text>
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

              {creditRoom && !creditRoom.canSkip && (
                <Text style={styles.creditBlocked}>
                  {`Payment cannot be skipped \u2014 ${creditRoom.partyName} has \u20b9${Number(creditRoom.availableCredit).toLocaleString('en-IN')} of credit left and this order is \u20b9${Number(creditRoom.orderAmount).toLocaleString('en-IN')}. Collect the money to complete this delivery.`}
                </Text>
              )}
              {creditRoom && creditRoom.canSkip && (
                <Text style={styles.creditAllowed}>
                  {`If they will not pay now, this becomes a credit sale due in ${creditRoom.creditDays} days${creditRoom.usesOwnTerms ? '' : ' (no terms set on this party)'}.`}
                </Text>
              )}

              <View style={styles.divider} />

              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={[styles.modalCancelBtn, creditRoom && !creditRoom.canSkip && { opacity: 0.45 }]}
                  disabled={Boolean(creditRoom && !creditRoom.canSkip)}
                  onPress={() => continueToBillUpload({ paymentSkipped: true })}
                >
                  <Text style={styles.modalCancelBtnText}>{t('Skip Payment')}</Text>
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
                    <Text style={styles.modalConfirmBtnText}>{t('Continue to Bill')}</Text>
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
              <TouchableOpacity
                style={styles.modalCloseX}
                onPress={() => { setBillModalVisible(false); setBillPhoto(null); }}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Text style={styles.modalCloseXText}>✕</Text>
              </TouchableOpacity>
              <Text style={styles.modalTitle}>{t('Upload Delivered Bill')}</Text>
              <Text style={styles.modalSubtitle}>Take a clear photo of the bill handed to the party. This photo is mandatory for every delivered order.</Text>
              <TouchableOpacity style={styles.navigateActionBtn} onPress={captureBillPhoto}>
                <Text style={styles.navigateActionBtnText}>{billPhoto ? 'Retake Bill Photo' : 'Take Bill Photo *'}</Text>
              </TouchableOpacity>
              {billPhoto && <Text style={[styles.fieldLabel, { color: '#276749', marginTop: 8 }]}>{t('Bill photo attached')}</Text>}
              <View style={styles.modalActions}>
                <TouchableOpacity style={styles.modalCancelBtn} onPress={() => { setBillModalVisible(false); setCollectionModalVisible(true); }}>
                  <Text style={styles.modalCancelBtnText}>{t('Back')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.modalConfirmBtn} disabled={submittingCollection || !billPhoto} onPress={submitDeliveredBill}>
                  {submittingCollection ? <ActivityIndicator color="#fff" /> : <Text style={styles.modalConfirmBtnText}>{t('Upload & Deliver')}</Text>}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}


      {/* Delivery Cancel Reason Modal */}
      {/*
        * Something on screen while the bill is going up.
        *
        * The camera closes the moment the shot is taken and the upload happens
        * with no modal open, so the driver was dropped back to the stop with
        * its Maps / Cancel / Deliver buttons and reasonably concluded it had
        * failed — and pressed Deliver again. This blocks the screen until the
        * delivery is actually saved.
        */}
      <Modal visible={submittingCollection} transparent animationType="fade" onRequestClose={() => {}}>
        <View style={styles.uploadingOverlay}>
          <View style={styles.uploadingCard}>
            <ActivityIndicator size="large" color="#00796B" />
            <Text style={styles.uploadingTitle}>{t('Saving delivery…')}</Text>
            <Text style={styles.uploadingText}>
              {uploadProgress || t('Sending the bill photo. Please wait.')}
            </Text>
          </View>
        </View>
      </Modal>

      {selectedStop && (
        <Modal
          visible={failureModalVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setFailureModalVisible(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>{t('Cancel Delivery')}</Text>
              <Text style={styles.modalSubtitle}>
                Add a remark and proof photo for order #{selectedStop.order?.orderNumber}.
              </Text>

              <View style={styles.divider} />

              <View style={{ gap: 12 }}>
                <Text style={styles.fieldLabel}>{t('Cancellation Remark *')}</Text>
                <TextInput
                  style={[styles.inputField, { height: 80, textAlignVertical: 'top' }]}
                  placeholder="e.g. Customer refused, item missing, address issue..."
                  placeholderTextColor="#A0AEC0"
                  multiline
                  value={failureReason}
                  onChangeText={setFailureReason}
                />

                <View style={{ gap: 8 }}>
                  <Text style={styles.fieldLabel}>{t('Proof Photo')}</Text>
                  <TouchableOpacity style={styles.navigateActionBtn} onPress={captureFailureProof} activeOpacity={0.8}>
                    <Text style={styles.navigateActionBtnText}>
                      {failureProof ? 'Change Proof Photo' : 'Attach Proof Photo'}
                    </Text>
                  </TouchableOpacity>
                  {failureProof ? (
                    <Text style={styles.helperText}>
                      Attached: {failureProof.fileName || failureProof.uri?.split('/').pop() || 'Photo'}
                    </Text>
                  ) : (
                    <Text style={styles.helperText}>{t('Optional, but helpful for admin and warehouse review.')}</Text>
                  )}
                </View>
              </View>

              <View style={styles.divider} />

              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={styles.modalCancelBtn}
                  onPress={() => setFailureModalVisible(false)}
                >
                  <Text style={styles.modalCancelBtnText}>{t('Cancel')}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.modalConfirmBtn, { backgroundColor: '#E53E3E' }, submittingFailure && { opacity: 0.7 }]}
                  onPress={handleConfirmFailure}
                  disabled={submittingFailure}
                >
                  {submittingFailure ? (
                    <ActivityIndicator color="#FFFFFF" size="small" />
                  ) : (
                    <Text style={styles.modalConfirmBtnText}>{t('Save Cancel')}</Text>
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
    paddingHorizontal: scale(20),
    paddingTop: verticalScale(16),
    paddingBottom: verticalScale(20),
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
    fontSize: responsiveFontSize(22),
    fontWeight: '800',
    color: '#FFFFFF',
  },
  headerSubtitle: {
    fontSize: responsiveFontSize(13),
    color: '#E0F2F1',
    marginTop: verticalScale(4),
    fontWeight: '500',
  },
  actionGrid: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: verticalScale(14),
    backgroundColor: '#FFFFFF',
    marginHorizontal: scale(16),
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
    width: scale(90),
  },
  actionIcon: {
    fontSize: responsiveFontSize(24),
    marginBottom: verticalScale(4),
  },
  actionText: {
    fontSize: responsiveFontSize(11),
    fontWeight: '700',
    color: '#4A5568',
  },
  tabBar: {
    flexDirection: 'row',
    marginHorizontal: scale(16),
    marginTop: verticalScale(16),
    backgroundColor: '#E2E8F0',
    borderRadius: 10,
    padding: scale(3),
  },
  tabItem: {
    flex: 1,
    paddingVertical: verticalScale(8),
    alignItems: 'center',
    borderRadius: 8,
  },
  activeTab: {
    backgroundColor: '#FFFFFF',
  },
  tabText: {
    fontSize: responsiveFontSize(13.5),
    fontWeight: '600',
    color: '#718096',
  },
  activeTabText: {
    color: '#00796B',
    fontWeight: '800',
  },
  container: {
    padding: scale(16),
    paddingBottom: verticalScale(40),
  },
  routeSummaryCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: scale(16),
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
    marginBottom: verticalScale(8),
  },
  routeNumberText: {
    fontSize: responsiveFontSize(16),
    fontWeight: '800',
    color: '#2D3748',
  },
  statusBadge: {
    paddingVertical: verticalScale(3),
    paddingHorizontal: scale(8),
    borderRadius: 6,
    fontSize: responsiveFontSize(11),
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
    fontSize: responsiveFontSize(12.5),
    color: '#718096',
    marginTop: verticalScale(2),
    fontWeight: '550',
  },
  optimizeRouteBtn: {
    backgroundColor: '#00796B',
    borderRadius: 10,
    height: verticalScale(40),
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: verticalScale(14),
  },
  optimizeRouteBtnText: {
    color: '#FFFFFF',
    fontSize: responsiveFontSize(12.5),
    fontWeight: '800',
  },
  sectionTitle: {
    fontSize: responsiveFontSize(15),
    fontWeight: '800',
    color: '#2D3748',
    marginBottom: verticalScale(10),
  },
  stopCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: scale(16),
    marginBottom: verticalScale(12),
  },
  stopHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stopNumCircle: {
    width: scale(28),
    height: verticalScale(28),
    borderRadius: 14,
    backgroundColor: '#00796B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopNumText: {
    color: '#FFFFFF',
    fontSize: responsiveFontSize(13),
    fontWeight: '800',
  },
  partyNameText: {
    fontSize: responsiveFontSize(14.5),
    fontWeight: '800',
    color: '#2D3748',
  },
  replacementTag: {
    marginTop: 3,
    alignSelf: 'flex-start',
    color: '#db2777',
    borderColor: '#db2777',
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
    fontSize: 10,
    fontWeight: '700',
  },
  orderNumText: {
    fontSize: responsiveFontSize(12),
    color: '#718096',
    marginTop: 1,
  },
  stopStatusBadge: {
    fontSize: responsiveFontSize(10),
    fontWeight: '800',
    paddingVertical: verticalScale(3),
    paddingHorizontal: scale(8),
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
    marginTop: verticalScale(12),
    paddingVertical: verticalScale(10),
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#EDF2F7',
    gap: verticalScale(4),
  },
  addressText: {
    fontSize: responsiveFontSize(13),
    color: '#4A5568',
    lineHeight: 18,
  },
  mobileText: {
    fontSize: responsiveFontSize(12.5),
    color: '#718096',
  },
  amountPaymentRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: verticalScale(6),
  },
  amountLabelText: {
    fontSize: responsiveFontSize(12.5),
    color: '#718096',
  },
  amountValueText: {
    fontSize: responsiveFontSize(14),
    fontWeight: '800',
    color: '#2D3748',
  },
  payTypeBadge: {
    paddingVertical: verticalScale(2),
    paddingHorizontal: scale(8),
    borderRadius: 6,
  },
  codPayBadge: {
    backgroundColor: '#FEF3C7',
  },
  creditPayBadge: {
    backgroundColor: '#EBF8FF',
  },
  payTypeText: {
    fontSize: responsiveFontSize(11),
    fontWeight: '750',
    color: '#2D3748',
  },
  stopActionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: verticalScale(8),
    marginTop: verticalScale(12),
  },
  navigateActionBtn: {
    height: verticalScale(36),
    paddingHorizontal: scale(12),
    borderWidth: 1,
    borderColor: '#00796B',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navigateActionBtnText: {
    color: '#00796B',
    fontSize: responsiveFontSize(12.5),
    fontWeight: '700',
  },
  failActionBtn: {
    height: verticalScale(36),
    paddingHorizontal: scale(12),
    borderWidth: 1,
    borderColor: '#E53E3E',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  failActionBtnText: {
    color: '#E53E3E',
    fontSize: responsiveFontSize(12.5),
    fontWeight: '700',
  },
  deliverActionBtn: {
    height: verticalScale(36),
    paddingHorizontal: scale(14),
    backgroundColor: '#00796B',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deliverActionBtnText: {
    color: '#FFFFFF',
    fontSize: responsiveFontSize(12.5),
    fontWeight: '800',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: verticalScale(80),
  },
  emptyIcon: {
    fontSize: responsiveFontSize(48),
    marginBottom: verticalScale(12),
  },
  emptyTitle: {
    fontSize: responsiveFontSize(16),
    fontWeight: '800',
    color: '#2D3748',
  },
  emptyDesc: {
    fontSize: responsiveFontSize(13),
    color: '#718096',
    textAlign: 'center',
    marginTop: verticalScale(4),
    paddingHorizontal: scale(20),
  },
  historyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: scale(14),
  },
  historyRouteNumber: {
    fontSize: responsiveFontSize(15),
    fontWeight: '750',
    color: '#2D3748',
  },
  historyMetaText: {
    fontSize: responsiveFontSize(12.5),
    color: '#718096',
    marginTop: verticalScale(2),
  },
  historyOrderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: verticalScale(10),
    paddingVertical: verticalScale(6),
  },
  historyViewBtn: {
    paddingHorizontal: scale(12),
    paddingVertical: verticalScale(8),
    borderRadius: 10,
    backgroundColor: '#EBF8FF',
    borderWidth: 1,
    borderColor: '#90CDF4',
  },
  historyViewBtnText: {
    fontSize: responsiveFontSize(12),
    fontWeight: '800',
    color: '#1D4ED8',
  },
  historyItemCard: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    padding: scale(12),
    backgroundColor: '#F8FAFC',
  },
  // Modal layout
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: scale(24),
  },
  modalCard: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: scale(20),
  },
  uploadingOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  uploadingCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    paddingVertical: 28,
    paddingHorizontal: 32,
    alignItems: 'center',
    gap: 12,
    minWidth: 240,
  },
  uploadingTitle: { fontSize: 16, fontWeight: '800', color: '#0F172A' },
  uploadingText: { fontSize: 13, color: '#64748B', textAlign: 'center', lineHeight: 19 },
  modalCloseX: {
    position: 'absolute',
    top: 10,
    right: 12,
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    backgroundColor: 'rgba(148,163,184,0.18)',
    zIndex: 5,
  },
  modalCloseXText: { fontSize: 16, fontWeight: '900', color: '#64748B', lineHeight: 18 },
  modalTitle: {
    fontSize: responsiveFontSize(17),
    fontWeight: '800',
    color: '#1A202C',
  },
  modalSubtitle: {
    fontSize: responsiveFontSize(12.5),
    color: '#718096',
    marginTop: verticalScale(4),
    lineHeight: 18,
  },
  creditBlocked: {
    color: '#B91C1C',
    backgroundColor: '#FEE2E2',
    borderRadius: 8,
    padding: 10,
    marginTop: 10,
    fontSize: 12,
    fontWeight: '700',
  },
  creditAllowed: {
    color: '#B45309',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 10,
  },
  divider: {
    height: 1,
    backgroundColor: '#E2E8F0',
    marginVertical: verticalScale(14),
  },
  fieldLabel: {
    fontSize: responsiveFontSize(11),
    fontWeight: '800',
    color: '#718096',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  inputField: {
    height: verticalScale(42),
    backgroundColor: '#F7F9FC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    paddingHorizontal: scale(12),
    fontSize: responsiveFontSize(13.5),
    color: '#2D3748',
    fontWeight: '700',
  },
  modeRow: {
    flexDirection: 'row',
    gap: verticalScale(8),
  },
  modeBtn: {
    flex: 1,
    height: verticalScale(38),
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
    fontSize: responsiveFontSize(11.5),
    fontWeight: '700',
    color: '#718096',
  },
  activeModeBtnText: {
    color: '#00796B',
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: verticalScale(10),
  },
  modalCancelBtn: {
    height: verticalScale(40),
    paddingHorizontal: scale(16),
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCancelBtnText: {
    color: '#718096',
    fontSize: responsiveFontSize(13),
    fontWeight: '700',
  },
  modalConfirmBtn: {
    height: verticalScale(40),
    paddingHorizontal: scale(18),
    backgroundColor: '#00796B',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalConfirmBtnText: {
    color: '#FFFFFF',
    fontSize: responsiveFontSize(13),
    fontWeight: '800',
  },
});


