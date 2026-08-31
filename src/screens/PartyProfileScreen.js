import React, { useState, useEffect, useCallback} from 'react';
import { useLanguage } from '../i18n';
import Pdf from 'react-native-pdf';
import CreditLimitRequestModal from '../components/CreditLimitRequestModal';
import { readJson } from '../services/apiResponse';
import { FirebaseImage } from '../services/firebaseUploadService';
import OrderPaymentDetails from '../components/OrderPaymentDetails';
import OrderStageTracker from '../components/OrderStageTracker';
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
  Linking,
  RefreshControl,
} from 'react-native';
import WalletAllocationSheet from '../components/WalletAllocationSheet';
import PartyIssuesSheet, { OPEN_STATUSES } from '../components/PartyIssuesSheet';
import { scale, verticalScale, responsiveFontSize, maxContainerWidth } from '../utils/responsive';
import { bottomBarPadding } from '../utils/systemBars';

/**
 * Whether a stored file is something we can simply draw.
 *
 * Read from the extension on the stored name first, since a signed URL buries
 * it behind query parameters.
 */
// Held in memory as base64, which costs about a third more than the file
// itself. A statement is a page or two; something enormous is refused rather
// than risking the app being killed mid-read.
const MAX_LEDGER_BYTES = 25 * 1024 * 1024;

const kindOfFile = (storagePath, url = '') => {
  const name = String(storagePath || url || '').split('?')[0].toLowerCase();
  if (/\.(jpe?g|png|webp|gif|heic|bmp)$/.test(name)) return 'image';
  if (/\.pdf$/.test(name)) return 'pdf';
  // Nothing conclusive: an image is the safer guess, because it degrades to a
  // blank frame rather than a native download error.
  return 'image';
};

/**
 * Formatting helpers, at module scope on purpose.
 *
 * They used to be declared inside the component, below the allocation list that
 * calls them. Hermes does not enforce the temporal dead zone in a release
 * build, so the `const` read as `undefined` instead of throwing a clear
 * "used before initialization" — and calling it crashed the whole screen with
 * "Trying to call a non-function". It only showed up for a party that actually
 * had an open bill, because that is the only time the callback runs.
 *
 * None of them touch component state, so there is no reason for them to live
 * inside the component at all.
 */
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

export default function PartyProfileScreen({ token, apiUrl, partyId, onBack, onNavigateToOrder, onNavigateToCollection }) {
  const { t, term, name } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [profile, setProfile] = useState(null);
  // Nothing is open until a card is tapped. The screen used to land on the
  // order list every time, which buried the numbers the salesman came for.
  const [activeTab, setActiveTab] = useState(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  // Expanded orders in profile
  const [expandedOrders, setExpandedOrders] = useState({});

  // Allocation modal states
  const [allocationModalVisible, setAllocationModalVisible] = useState(false);
  const [financeData, setFinanceData] = useState(null);

  // Replacement modal states
  const [replacementModalVisible, setReplacementModalVisible] = useState(false);
  const [selectedOrderForReplace, setSelectedOrderForReplace] = useState(null);
  const [replaceQuantities, setReplaceQuantities] = useState({}); // { [variantId]: quantity }
  const [replaceRemarks, setReplaceRemarks] = useState('');
  const [submittingReplacement, setSubmittingReplacement] = useState(false);
  const [issueModalVisible, setIssueModalVisible] = useState(false);
  const [issueListVisible, setIssueListVisible] = useState(false);
  // Only the count is loaded with the profile; the issues themselves are
  // fetched when the card is opened.
  const [issueCounts, setIssueCounts] = useState({ total: 0, open: 0 });
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
      loadIssueCounts();
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

  /**
   * How many issues this shop has raised, and how many are still open.
   *
   * Its own small fetch rather than part of the profile, because the profile
   * endpoint is shared with screens that have no use for it and it already
   * carries more than it needs.
   */
  const loadIssueCounts = useCallback(() => {
    fetch(`${apiUrl}/feedback/party/${partyId}?limit=100`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((data) => {
        if (!data?.success) return;
        const rows = Array.isArray(data.data) ? data.data : [];
        setIssueCounts({ total: rows.length, open: rows.filter((row) => OPEN_STATUSES.includes(row.status)).length });
      })
      .catch(() => {});
  }, [apiUrl, partyId, token]);

  useEffect(() => {
    loadProfile();
    loadIssueCounts();
  }, [partyId]);

  // Pull down to reload, so the screen can be refreshed in place rather than
  // by navigating away and back.
  const [refreshing, setRefreshing] = useState(false);
  const onPullRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadProfile();
    } catch (e) {
      console.log('[Refresh] failed:', e.message);
    } finally {
      setRefreshing(false);
    }
  }, [loadProfile]);

  const loadProfile = async () => {
    setLoading(true);
    setError('');
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const [response, financeResponse] = await Promise.all([
        fetch(`${apiUrl}/parties/${partyId}/profile`, { headers }),
        fetch(`${apiUrl}/finance/party/${partyId}`, { headers }),
      ]);
      fetch(`${apiUrl}/credit-limit-requests?partyId=${partyId}`, { headers })
        .then((res) => res.json())
        .then((body) => setCreditRequests(Array.isArray(body?.data) ? body.data : []))
        .catch(() => setCreditRequests([]));

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

  // ── Ledger statement ──
  const [ledgerBusy, setLedgerBusy] = useState(false);
  // The statement is shown inside the app rather than handed to a browser, so
  // a company document never leaves for a download folder or another app.
  const [ledgerDoc, setLedgerDoc] = useState(null); // { url, kind, data }
  const [sharingLedger, setSharingLedger] = useState(false);
  const [creditRequests, setCreditRequests] = useState([]);
  const [creditRequestOpen, setCreditRequestOpen] = useState(false);

  /**
   * The running account — the same statement the admin panel's Ledger tab
   * shows, not the uploaded PDF. Fetched only when opened, because most visits
   * never need it.
   */

  const openLedger = async (storagePath) => {
    if (!storagePath) return;
    setLedgerBusy(true);
    try {
      const response = await fetch(`${apiUrl}/uploads/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ module: 'parties', storagePath }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.message || 'Could not open the ledger');
      // Worked out from the stored file name, which the app already holds.
      //
      // The server also reports a `kind`, but only a newer build does — and
      // defaulting to PDF when it is missing sent every uploaded screenshot
      // to the PDF renderer, which failed on a PNG. Deciding here works
      // against any server version; the server's answer is used when given.
      const kind = data.data.kind || kindOfFile(storagePath, data.data.viewUrl);

      /**
       * A PDF is fetched here, not by the viewer.
       *
       * Left to download the link itself, the PDF component goes through
       * react-native-blob-util, which on Android calls a transfer incomplete
       * whenever its byte count disagrees with the Content-Length header and
       * reports only "Download interrupted." Storage serves these files with a
       * correct length and no compression, so the miscount is on the device.
       * Plain fetch does not have the problem.
       *
       * The statement still never leaves the app: it is held in memory, written
       * only to the app's own cache by the viewer, and handed to nothing else.
       */
      let inlineData = '';
      if (kind !== 'image') {
        const file = await fetch(data.data.viewUrl);
        if (!file.ok) throw new Error(`The statement could not be fetched (${file.status}).`);
        const blob = await file.blob();
        if (!blob.size) throw new Error('The statement came back empty.');
        if (blob.size > MAX_LEDGER_BYTES) throw new Error('This statement is too large to open on a phone.');

        const dataUri = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ''));
          reader.onerror = () => reject(new Error('The statement could not be read.'));
          reader.readAsDataURL(blob);
        });
        // The viewer matches this one prefix exactly; storage may label the
        // file octet-stream, which would not match.
        inlineData = dataUri.replace(/^data:[^;]*;base64,/i, 'data:application/pdf;base64,');
      }

      setLedgerDoc({ url: data.data.viewUrl, kind, data: inlineData });
    } catch (err) {
      Alert.alert('Ledger', err.message || 'Could not open the ledger');
    } finally {
      setLedgerBusy(false);
    }
  };

  /**
   * Sends the statement to the party from the company's own WhatsApp.
   *
   * The server does the sending, so it goes out on the business number and is
   * recorded — rather than the salesman forwarding a company document from his
   * personal account.
   */
  const shareLedger = async () => {
    setSharingLedger(true);
    try {
      const response = await fetch(`${apiUrl}/parties/${partyId}/share-ledger`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      });
      const data = await readJson(response, 'The server');
      Alert.alert('Sent', data.message);
      loadProfile();
    } catch (err) {
      // Hitting the limit is a rule working, not something going wrong.
      const isCooldown = /share again|already sent/i.test(err.message || '');
      Alert.alert(isCooldown ? 'Already shared' : 'Could not send', err.message);
      if (isCooldown) loadProfile();
    } finally {
      setSharingLedger(false);
    }
  };

  const requestLedger = async () => {
    setLedgerBusy(true);
    try {
      const response = await fetch(`${apiUrl}/parties/${partyId}/request-ledger`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.message || 'Could not request the ledger');
      Alert.alert('Ledger requested', 'Accounts will upload the statement shortly.');
      loadProfile();
    } catch (err) {
      Alert.alert('Ledger', err.message || 'Could not request the ledger');
    } finally {
      setLedgerBusy(false);
    }
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
          <Text style={styles.headerTitle}>{t('Party Profile')}</Text>
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
          <Text style={styles.headerTitle}>{t('Party Profile')}</Text>
        </View>
        <View style={styles.loadingContainer}>
          <Text style={styles.errorText}>{error || 'Profile not available.'}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={loadProfile}>
            <Text style={styles.retryBtnText}>{t('Retry')}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const { party, recentOrders, recentVisits, recentCollections, stats } = profile;

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

  /**
   * Money that can still be pointed at a bill.
   *
   * Two pots, deliberately not added twice: an unsettled collection's
   * unallocated slice is cash the salesman is holding, while a settled one's
   * leftover has already been added to the party's advance balance — summing
   * both would show that money in the wallet twice over.
   */
  // One open request at a time — the server refuses a second, so the card
  // says it is waiting rather than offering a button that would error.
  const pendingCreditRequests = creditRequests.filter((row) => row.status === 'pending');
  const creditRequestPending = pendingCreditRequests.length > 0;

  /**
   * The wallet is money in hand that no bill has taken.
   *
   * Four cheques of 10,000 collected and not yet allocated read as a wallet of
   * 40,000, which is what the salesman is actually holding. Any advance on
   * account is added in, because it is the same thing by another route.
   *
   * These were two cards side by side for a while, Wallet and Unallocated,
   * which read as two pots when there is only one.
   */
  const unallocatedOnReceipts = Number((financeData?.payments || recentCollections || [])
    .filter((payment) => !['bounced', 'returned', 'rejected', 'cancelled'].includes(payment.status))
    .reduce((sum, payment) => sum + Number(payment.unallocatedAmount ?? 0), 0)
    .toFixed(2));

  const walletBalance = Number((Number(party.advanceBalance || 0) + unallocatedOnReceipts).toFixed(2));

  // Three days must pass after a statement is uploaded before another can be
  // asked for. The server enforces the same rule; this only keeps the button
  // honest so the salesman is not refused after tapping.
  const ledgerAvailableAt = stats.ledgerRequestAvailableAt
    ? new Date(stats.ledgerRequestAvailableAt)
    : null;
  const canRequestLedger = !ledgerAvailableAt || Date.now() >= ledgerAvailableAt.getTime();
  /**
   * A ledger may go out once every three days, per party.
   *
   * Within those three days the button is simply dead — greyed out and doing
   * nothing. It deliberately says nothing about when it will work again: a
   * countdown on a button reads as an error the salesman has to solve, when in
   * fact the statement has already been sent and there is nothing to do.
   *
   * The server refuses either way; this only spares a wasted tap.
   */
  const shareAvailableAt = stats.ledgerShareAvailableAt ? new Date(stats.ledgerShareAvailableAt) : null;
  const canShareLedger = !shareAvailableAt || Date.now() >= shareAvailableAt.getTime();

  const ledgerCooldownText = (() => {
    if (!ledgerAvailableAt) return '';
    const days = Math.ceil((ledgerAvailableAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
    return days > 1 ? `in ${days} days` : 'tomorrow';
  })();

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
          <Text style={styles.headerTitle}>{t('Party Profile')}</Text>
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

      <ScrollView contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onPullRefresh} colors={['#00796B']} tintColor="#00796B" />
        }
      >
        {/* Party Info Card — the identity stays, the rest folds away so the
            numbers below sit on the first screen rather than under a scroll. */}
        <View style={styles.profileCard}>
          <View style={styles.profileHeadRow}>
            {party.shopPhoto ? (
              <FirebaseImage
                source={{ uri: party.shopPhoto }}
                style={styles.shopPhotoSmall}
                resizeMode="cover"
                token={token}
                apiUrl={apiUrl}
                fallback={
                  <View style={styles.shopPhotoSmallPlaceholder}>
                    <Text style={styles.shopPhotoPlaceholderText}>📷</Text>
                  </View>
                }
              />
            ) : (
              <View style={styles.shopPhotoSmallPlaceholder}>
                <Text style={styles.shopPhotoPlaceholderText}>📷</Text>
              </View>
            )}
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.profileName} numberOfLines={2}>{name(party.partyName)}</Text>
              <Text style={styles.profileCode}>{party.partyCode}</Text>
              <Text style={styles.profileDetail} numberOfLines={1}>📞 {party.mobile}</Text>
            </View>
          </View>

          <TouchableOpacity style={styles.viewMoreBtn} onPress={() => setDetailsOpen((v) => !v)}>
            <Text style={styles.viewMoreBtnText}>{detailsOpen ? 'View less ▲' : 'View more ▼'}</Text>
          </TouchableOpacity>

          {detailsOpen && (
            <View style={styles.profileDetailsBlock}>
              {party.shopPhoto ? (
                <FirebaseImage
                  source={{ uri: party.shopPhoto }}
                  style={styles.shopPhoto}
                  resizeMode="cover"
                  token={token}
                  apiUrl={apiUrl}
                />
              ) : null}
              {party.ownerName ? <Text style={styles.profileDetail}>👤 {name(party.ownerName)}</Text> : null}
              <Text style={styles.profileDetail}>📍 {party.address}</Text>
              {party.area ? <Text style={styles.profileDetail}>🏘️ {party.area}, {party.city}, {party.state} - {party.pincode}</Text> : null}
              {party.email ? <Text style={styles.profileDetail}>✉️ {party.email}</Text> : null}
              {party.gstNo ? <Text style={styles.profileDetail}>🏛️ GST: {party.gstNo}</Text> : null}
              {party.paymentTerms ? <Text style={styles.profileDetail}>🧾 Terms: {party.paymentTerms}</Text> : null}
              {party.assignedSalesman ? (
                <Text style={styles.profileDetail}>👨‍💼 Salesman: {party.assignedSalesman.name} ({party.assignedSalesman.mobile})</Text>
              ) : null}
            </View>
          )}
        </View>

        <TouchableOpacity style={styles.raiseIssueBtn} onPress={() => setIssueModalVisible(true)}>
          <Text style={styles.raiseIssueBtnText}>⚠ Raise Issue for {name(party.partyName)}</Text>
        </TouchableOpacity>

        {/* The six numbers. Three of them are buttons: tapping opens the
            matching list underneath, tapping again closes it. */}
        <View style={styles.statGrid}>
          <TouchableOpacity
            style={[styles.gridCard, { backgroundColor: '#F0FFF4' }, activeTab === 'orders' && styles.gridCardActive]}
            onPress={() => setActiveTab((t) => (t === 'orders' ? null : 'orders'))}
          >
            <Text style={[styles.gridValue, { color: '#2F855A' }]}>{formatCurrency(stats.totalSale || 0)}</Text>
            <Text style={styles.gridLabel}>{t('Total Sale')}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.gridCard, { backgroundColor: '#FEFCBF' }, activeTab === 'visits' && styles.gridCardActive]}
            onPress={() => setActiveTab((t) => (t === 'visits' ? null : 'visits'))}
          >
            <Text style={[styles.gridValue, { color: '#B7791F' }]}>{stats.totalVisits ?? 0}</Text>
            <Text style={styles.gridLabel}>Total Visits ›</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.gridCard, { backgroundColor: '#EBF8FF' }, activeTab === 'orders' && styles.gridCardActive]}
            onPress={() => setActiveTab((t) => (t === 'orders' ? null : 'orders'))}
          >
            <Text style={[styles.gridValue, { color: '#2B6CB0' }]}>{stats.totalBills ?? stats.totalOrders ?? 0}</Text>
            <Text style={styles.gridLabel}>Total Bills ›</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.gridCard, { backgroundColor: '#FFF5F5' }, activeTab === 'collections' && styles.gridCardActive]}
            onPress={() => setActiveTab((t) => (t === 'collections' ? null : 'collections'))}
          >
            <Text style={[styles.gridValue, { color: '#C53030' }]}>{formatCurrency(netOutstanding)}</Text>
            <Text style={styles.gridLabel}>Outstanding ›</Text>
          </TouchableOpacity>

          {/* Collected and not yet on a bill. Tapping it is the way in to
              allocate - losing that entry point would strand 64 lakh. */}
          <TouchableOpacity
            style={[styles.gridCard, { backgroundColor: '#EBF4FF' }, walletBalance <= 0 && styles.gridCardMuted]}
            onPress={() => setAllocationModalVisible(true)}
            disabled={walletBalance <= 0}
          >
            <Text style={[styles.gridValue, { color: '#3182CE' }]}>{formatCurrency(walletBalance)}</Text>
            <Text style={styles.gridLabel}>{walletBalance > 0 ? 'Wallet · allocate ›' : 'Wallet Balance'}</Text>
          </TouchableOpacity>

          {/* What this shop has raised. An open issue is the first thing the
              salesman should see, not something he finds out about from the
              shopkeeper. */}
          <TouchableOpacity
            style={[
              styles.gridCard,
              { backgroundColor: issueCounts.open > 0 ? '#FFF5F5' : '#F7FAFC' },
              issueCounts.total === 0 && styles.gridCardMuted,
            ]}
            onPress={() => setIssueListVisible(true)}
            disabled={issueCounts.total === 0}
          >
            <Text style={[styles.gridValue, { color: issueCounts.open > 0 ? '#C53030' : '#4A5568' }]}>
              {issueCounts.open > 0 ? issueCounts.open : issueCounts.total}
            </Text>
            <Text style={styles.gridLabel}>
              {issueCounts.open > 0
                ? `Open ${issueCounts.open === 1 ? 'issue' : 'issues'} \u203a`
                : issueCounts.total > 0 ? 'Issues \u00b7 all dealt with \u203a' : 'No issues'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.gridCard, { backgroundColor: '#F7FAFC' }]}
            onPress={() => setCreditRequestOpen(true)}
            disabled={creditRequestPending}
          >
            <Text style={[styles.gridValue, { color: '#4A5568' }]}>{formatCurrency(party.creditLimit)}</Text>
            <Text style={styles.gridLabel}>
              {creditRequestPending ? 'Limit · awaiting admin' : 'Credit Limit · ask ›'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Only what is still waiting on an admin. A decided request has
            already had its effect, so it is not left here to scroll past. */}
        {creditRequestPending && (
        <View style={styles.creditReqCard}>
          <View style={styles.creditReqHead}>
            <View style={{ flex: 1 }}>
              <Text style={styles.creditReqTitle}>{t('Credit limit requests')}</Text>
              <Text style={styles.creditReqSub}>
                {formatCurrency(party.creditLimit)} allowed · {formatCurrency(netOutstanding)} owed
              </Text>
            </View>
          </View>

          {creditRequestPending && (
            <View style={styles.creditReqList}>
              {pendingCreditRequests.map((row) => (
                <View key={row._id} style={styles.creditReqRow}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.creditReqAmount}>
                      {formatCurrency(row.currentLimit)} → {formatCurrency(row.requestedLimit)}
                      {row.status === 'approved' && Number(row.approvedLimit) !== Number(row.requestedLimit)
                        ? ` · granted ${formatCurrency(row.approvedLimit)}`
                        : ''}
                    </Text>
                    <Text style={styles.creditReqReason} numberOfLines={2}>{row.reason}</Text>
                    <Text style={styles.creditReqMeta}>
                      {row.requestedBy?.name || 'Someone'} · {formatDate(row.createdAt)}
                      {row.reviewRemarks ? ` · ${row.reviewRemarks}` : ''}
                    </Text>
                  </View>
                  <View style={styles.creditReqChip}>
                    <Text style={styles.creditReqChipText}>WAITING</Text>
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>
        )}

        <CreditLimitRequestModal
          visible={creditRequestOpen}
          onClose={() => setCreditRequestOpen(false)}
          party={party}
          creditLimit={party.creditLimit}
          currentOutstanding={netOutstanding}
          apiUrl={apiUrl}
          token={token}
          onSubmitted={loadProfile}
        />

        {/* Ledger statement — status tells the salesman a new one has arrived */}
        <View style={styles.ledgerCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.ledgerTitle}>{t('Ledger Statement')}</Text>
            <Text style={[
              styles.ledgerStatus,
              party.ledgerRequestStatus === 'fulfilled' && { color: '#2F855A' },
              party.ledgerRequestStatus === 'requested' && { color: '#B7791F' },
            ]}>
              {party.ledgerRequestStatus === 'fulfilled'
                ? `✓ Ledger uploaded${party.ledgerUploadedAt ? ` · ${formatDate(party.ledgerUploadedAt)}` : ''}`
                : party.ledgerRequestStatus === 'requested'
                  ? `Requested${party.ledgerRequestedAt ? ` · ${formatDate(party.ledgerRequestedAt)}` : ''} — awaiting accounts`
                  : 'No statement requested yet'}
            </Text>
          </View>
          <View style={{ gap: 6 }}>
            {party.ledgerDocument ? (
              <>
                <TouchableOpacity style={styles.ledgerViewBtn} disabled={ledgerBusy} onPress={() => openLedger(party.ledgerDocument)}>
                  <Text style={styles.ledgerViewBtnText}>{ledgerBusy ? 'Opening…' : 'View Ledger'}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.ledgerShareBtn, !canShareLedger && styles.ledgerShareBtnDisabled]}
                  disabled={sharingLedger || !canShareLedger}
                  onPress={shareLedger}
                >
                  <Text style={styles.ledgerShareBtnText}>
                    {sharingLedger ? 'Sending…' : 'Share on WhatsApp'}
                  </Text>
                </TouchableOpacity>
              </>
            ) : null}
            {party.ledgerRequestStatus !== 'requested' ? (
              <TouchableOpacity
                style={[styles.ledgerRequestBtn, !canRequestLedger && styles.ledgerRequestBtnDisabled]}
                disabled={ledgerBusy || !canRequestLedger}
                onPress={requestLedger}
              >
                <Text style={styles.ledgerRequestBtnText}>{party.ledgerDocument ? 'Request New' : 'Request Ledger'}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>

        {/* Accounts prepares each statement by hand, so the same one cannot be
            asked for again straight away. */}
        {!canRequestLedger && party.ledgerRequestStatus !== 'requested' ? (
          <Text style={styles.ledgerCooldownNote}>
            A new statement can be requested {ledgerCooldownText}.
          </Text>
        ) : null}

        {/* Statement viewer — inside the app, never handed to a browser */}
        <Modal
          visible={!!ledgerDoc}
          animationType="slide"
          onRequestClose={() => setLedgerDoc(null)}
        >
          <SafeAreaView style={styles.ledgerViewerRoot}>
            <View style={styles.ledgerViewerBar}>
              <Text style={styles.ledgerViewerTitle} numberOfLines={1}>
                {name(party.partyName)} · Statement
              </Text>
              <TouchableOpacity onPress={() => setLedgerDoc(null)}>
                <Text style={styles.ledgerViewerClose}>✕ Close</Text>
              </TouchableOpacity>
            </View>

            {ledgerDoc?.kind === 'image' ? (
              <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={styles.ledgerImageWrap}
                maximumZoomScale={4}
                minimumZoomScale={1}
              >
                <Image source={{ uri: ledgerDoc.url }} style={styles.ledgerImage} resizeMode="contain" />
              </ScrollView>
            ) : ledgerDoc ? (
              /**
               * Drawn on the device itself.
               *
               * Android's web view cannot render a PDF, and the usual
               * workaround — Google's document viewer — would hand a customer's
               * financial statement to a third party. This renders it locally,
               * so the file is never passed to another app and never leaves.
               */
              <Pdf
                // No file cache: caching to disk is a common source of
                // IllegalStateException here, and a signed URL is short-lived
                // enough that a cached copy is worth little anyway.
                // Already in hand, so nothing is fetched again here.
                source={{ uri: ledgerDoc.data }}
                style={styles.ledgerPdf}
                trustAllCerts={false}
                onError={(error) => {
                  const detail = String(error?.message || error || 'unknown');
                  // The host and file type matter for working out why, and are
                  // safe to show — the signed token itself is not included.
                  const host = (ledgerDoc.url.match(/^https?:\/\/([^/]+)/) || [])[1] || 'unknown host';
                  console.log('[Ledger] PDF failed', { host, url: ledgerDoc.url.slice(0, 160), detail });
                  setLedgerDoc(null);
                  Alert.alert(
                    'Statement could not be opened',
                    `Tried to draw a PDF from ${host}.

${detail}

If this keeps happening, share it on WhatsApp instead.`
                  );
                }}
                renderActivityIndicator={() => (
                  <View style={styles.ledgerViewerLoading}>
                    <ActivityIndicator color="#00796B" size="large" />
                    <Text style={styles.ledgerViewerLoadingText}>Opening the statement…</Text>
                  </View>
                )}
              />
            ) : null}

            <TouchableOpacity
              style={[styles.ledgerViewerShare, !canShareLedger && styles.ledgerShareBtnDisabled]}
              disabled={sharingLedger || !canShareLedger}
              onPress={shareLedger}
            >
              <Text style={styles.ledgerViewerShareText}>
                {sharingLedger ? 'Sending…' : `Share with ${name(party.partyName)} on WhatsApp`}
              </Text>
            </TouchableOpacity>
          </SafeAreaView>
        </Modal>

        {/* Whatever a card opened, with a way back to nothing. Nothing shows
            until a card is tapped. */}
        {activeTab ? (
          <View style={styles.openListHead}>
            <Text style={styles.openListTitle}>
              {activeTab === 'orders' ? `Bills & orders (${recentOrders.length})`
                : activeTab === 'visits' ? `Visits (${recentVisits.length})`
                  : `Collections (${recentCollections.length})`}
            </Text>
            <TouchableOpacity onPress={() => setActiveTab(null)}>
              <Text style={styles.openListClose}>Close ✕</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <Text style={styles.tapHint}>Tap Total Sale, Visits, Bills or Outstanding above to see the detail.</Text>
        )}

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
                      </View>
                      <OrderStageTracker order={order} />
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
                              <Text style={styles.subItemName}>{name(subItem.productName)}</Text>
                              <Text style={styles.subItemVariant}>{name(subItem.variantName)} • {subItem.packSize}</Text>
                            </View>
                            <Text style={styles.subItemQty}>Qty: {subItem.quantity}</Text>
                            <Text style={styles.subItemPrice}>₹{subItem.rate?.toFixed(2)}</Text>
                          </View>
                        ))}

                        <OrderPaymentDetails order={order} apiUrl={apiUrl} token={token} />

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
                <Text style={styles.cancelBtnText}>{t('Cancel')}</Text>
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
                        <Text style={styles.modalItemName}>{name(it.productName)}</Text>
                        <Text style={styles.modalItemVariant}>{name(it.variantName)} • {it.packSize}</Text>
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
                  <Text style={styles.cancelBtnText}>{t('Cancel')}</Text>
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

      {/* The wallet, and the way to place it. One slip, one bill, one amount
          at a time - a 15,000 bill closes off two 10,000 cheques and carries
          both as its reference. */}
      <PartyIssuesSheet
        visible={issueListVisible}
        token={token}
        apiUrl={apiUrl}
        partyId={partyId}
        partyName={party.partyName}
        onClose={() => { setIssueListVisible(false); loadIssueCounts(); }}
      />

      <WalletAllocationSheet
        visible={allocationModalVisible}
        token={token}
        apiUrl={apiUrl}
        partyId={partyId}
        onClose={() => setAllocationModalVisible(false)}
        onDone={(placed) => {
          setAllocationModalVisible(false);
          Alert.alert(
            'Allocated',
            `${formatCurrency(placed)} placed against bills. The money leaves the wallet now; each bill clears once an authorised person settles it.`,
          );
          loadProfile();
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  profileHeadRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  shopPhotoSmall: { width: 68, height: 68, borderRadius: 10, backgroundColor: '#EDF2F7' },
  shopPhotoSmallPlaceholder: {
    width: 68, height: 68, borderRadius: 10, backgroundColor: '#EDF2F7',
    alignItems: 'center', justifyContent: 'center',
  },
  viewMoreBtn: { marginTop: 10, alignSelf: 'flex-start' },
  viewMoreBtnText: { color: '#00796B', fontWeight: '700', fontSize: 12.5 },
  profileDetailsBlock: {
    marginTop: 10, paddingTop: 10,
    borderTopWidth: 1, borderTopColor: '#EDF2F7', gap: 3,
  },

  // Two columns of three, so all six numbers are on screen together.
  statGrid: {
    flexDirection: 'row', flexWrap: 'wrap',
    gap: 8, marginHorizontal: 16, marginTop: 12,
  },
  gridCard: {
    flexGrow: 1, flexBasis: '31%', minWidth: 100,
    paddingVertical: 14, paddingHorizontal: 10,
    borderRadius: 12, alignItems: 'center',
    borderWidth: 1, borderColor: 'transparent',
  },
  gridCardActive: { borderColor: '#00796B' },
  // Nothing to allocate: still readable, but plainly not a button.
  gridCardMuted: { opacity: 0.6 },
  gridValue: { fontSize: 15, fontWeight: '800' },
  gridLabel: { fontSize: 10, color: '#4A5568', marginTop: 4, fontWeight: '600', textAlign: 'center' },

  ledgerRequestBtnDisabled: { opacity: 0.45 },
  ledgerCooldownNote: {
    marginHorizontal: 16, marginTop: 6,
    fontSize: 11, color: '#B7791F',
  },
  creditReqCard: {
    marginHorizontal: 16, marginTop: 12, padding: 14,
    backgroundColor: '#FFFFFF', borderRadius: 12,
    borderWidth: 1, borderColor: '#E2E8F0',
  },
  creditReqHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  creditReqTitle: { fontSize: 14, fontWeight: '800', color: '#1A202C' },
  creditReqSub: { fontSize: 11.5, color: '#718096', marginTop: 2 },
  creditReqList: { marginTop: 12, borderTopWidth: 1, borderTopColor: '#EDF2F7' },
  creditReqRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F1F5F9',
  },
  creditReqAmount: { fontSize: 12.5, fontWeight: '700', color: '#1A202C' },
  creditReqReason: { fontSize: 11.5, color: '#4A5568', marginTop: 2 },
  creditReqMeta: { fontSize: 10.5, color: '#A0AEC0', marginTop: 3 },
  creditReqChip: { paddingVertical: 4, paddingHorizontal: 9, borderRadius: 999, backgroundColor: '#EDF2F7' },
  creditReqChipText: { fontSize: 9.5, fontWeight: '800', color: '#718096' },

  ledgerShareBtnDisabled: { opacity: 0.5 },
  ledgerShareBtn: {
    paddingVertical: 8, paddingHorizontal: 12,
    borderRadius: 8, backgroundColor: '#25D366', alignItems: 'center',
  },
  ledgerShareBtnText: { color: '#FFFFFF', fontWeight: '800', fontSize: 11.5 },

  ledgerViewerRoot: { flex: 1, backgroundColor: '#1A202C' },
  ledgerViewerBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#2D3748',
  },
  ledgerViewerTitle: { flex: 1, color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
  ledgerViewerClose: { color: '#CBD5E0', fontWeight: '700', fontSize: 13, paddingLeft: 12 },
  ledgerImageWrap: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 8 },
  ledgerImage: { width: '100%', height: 560 },
  ledgerPdf: { flex: 1, backgroundColor: '#1A202C' },
  ledgerViewerLoading: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: '#FFFFFF',
  },
  ledgerViewerLoadingText: { color: '#4A5568', fontSize: 13 },
  ledgerViewerShare: {
    margin: 14, paddingVertical: 15, borderRadius: 10,
    backgroundColor: '#25D366', alignItems: 'center',
  },
  ledgerViewerShareText: { color: '#FFFFFF', fontWeight: '800', fontSize: 14 },

  ledgerToggle: {
    marginHorizontal: 16, marginTop: 10,
    paddingVertical: 12, borderRadius: 10,
    backgroundColor: '#EDF6F5', alignItems: 'center',
  },
  ledgerToggleText: { color: '#00695C', fontWeight: '800', fontSize: 13 },
  ledgerPanel: {
    marginHorizontal: 16, marginTop: 8, padding: 12,
    backgroundColor: '#FFFFFF', borderRadius: 12,
    borderWidth: 1, borderColor: '#E2E8F0',
  },
  ledgerPanelCentre: { alignItems: 'center', gap: 8, paddingVertical: 12 },
  ledgerPanelMuted: { color: '#718096', fontSize: 12, textAlign: 'center', paddingVertical: 8 },
  ledgerPanelError: { color: '#C53030', fontSize: 12, paddingVertical: 8 },
  ledgerHeadRow: {
    flexDirection: 'row', paddingBottom: 8,
    borderBottomWidth: 1, borderBottomColor: '#E2E8F0',
  },
  ledgerRow: {
    flexDirection: 'row', paddingVertical: 9,
    borderBottomWidth: 1, borderBottomColor: '#F1F5F9',
  },
  ledgerCell: { flex: 1, fontSize: 10.5, color: '#2D3748' },
  ledgerHeadCell: { fontWeight: '800', color: '#4A5568', fontSize: 10 },
  ledgerNum: { textAlign: 'right' },
  ledgerBalance: { fontWeight: '800', color: '#1A202C' },

  openListHead: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginHorizontal: 16, marginTop: 18, marginBottom: 4,
  },
  openListTitle: { fontSize: 14, fontWeight: '800', color: '#1A202C' },
  openListClose: { fontSize: 12, color: '#718096', fontWeight: '700' },
  tapHint: {
    marginHorizontal: 16, marginTop: 18,
    fontSize: 11.5, color: '#A0AEC0', textAlign: 'center',
  },

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
  // Tabs
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
    // Pinned to the bottom of a full-screen modal, so it clears the system
    // navigation bar rather than sitting under it.
    paddingBottom: scale(16) + bottomBarPadding(),
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
  ledgerCard: {
    flexDirection: 'row', alignItems: 'center', gap: scale(12),
    backgroundColor: '#fff', borderRadius: scale(12), padding: scale(14),
    marginHorizontal: scale(16), marginBottom: verticalScale(12),
    borderWidth: 1, borderColor: '#E2E8F0',
  },
  ledgerTitle: { fontSize: responsiveFontSize(13.5), fontWeight: '700', color: '#1A202C' },
  ledgerStatus: { fontSize: responsiveFontSize(11.5), color: '#718096', marginTop: 3 },
  ledgerViewBtn: { backgroundColor: '#3182CE', borderRadius: scale(8), paddingVertical: verticalScale(7), paddingHorizontal: scale(12) },
  ledgerViewBtnText: { color: '#fff', fontSize: responsiveFontSize(11.5), fontWeight: '700', textAlign: 'center' },
  ledgerRequestBtn: { borderWidth: 1, borderColor: '#CBD5E0', borderRadius: scale(8), paddingVertical: verticalScale(7), paddingHorizontal: scale(12) },
  ledgerRequestBtnText: { color: '#2D3748', fontSize: responsiveFontSize(11.5), fontWeight: '700', textAlign: 'center' },
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
  allocNotBilled: {
    fontSize: 10.5, color: '#B7791F', marginTop: 6, lineHeight: 14,
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
});
