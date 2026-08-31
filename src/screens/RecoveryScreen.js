import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, RefreshControl, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { scale, verticalScale, responsiveFontSize } from '../utils/responsive';
import { FirebaseImage } from '../services/firebaseUploadService';
import { launchCamera } from 'react-native-image-picker';
import { uploadPhoto } from '../services/photoUpload';

const money = value => `₹${Number(value || 0).toLocaleString('en-IN')}`;
const date = value => value ? new Date(value).toLocaleDateString('en-IN') : '—';

const PAGE_SIZE = 25;

/**
 * The recovery round: which shops to visit, and what each one owes.
 *
 * This used to load every bill of every party in one response — 2,271 bills
 * across 844 shops, seventy-odd megabytes, a minute of spinner on a phone
 * before a list of names appeared. The list now carries only the names and
 * what each shop owes; a shop's bills are fetched when it is opened, which is
 * a few kilobytes and the only moment they are worth having.
 */
export default function RecoveryScreen({ token, apiUrl, onBack }) {
  const [parties, setParties] = useState([]);
  const [meta, setMeta] = useState({ counts: { today: 0, later: 0 }, amount: 0 });
  const [pageInfo, setPageInfo] = useState({ page: 1, totalPages: 1, totalRecords: 0 });
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [tab, setTab] = useState('today');

  // partyId -> bills, and which one is open. Kept so closing and reopening a
  // shop does not fetch it again.
  const [openParty, setOpenParty] = useState(null);
  const [billsByParty, setBillsByParty] = useState({});
  const [billsLoading, setBillsLoading] = useState(false);

  const [proof, setProof] = useState(null);
  const [invoice, setInvoice] = useState(null);
  const [invoiceLoading, setInvoiceLoading] = useState(false);
  const [actionRow, setActionRow] = useState(null);
  const [remark, setRemark] = useState('');
  const [nextVisitDate, setNextVisitDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(new Date());

  // Collecting against one bill: the bill itself, and what is being paid.
  const [collectRow, setCollectRow] = useState(null);
  const [collectAmount, setCollectAmount] = useState('');
  const [collectMode, setCollectMode] = useState('cash');
  const [chequeNumber, setChequeNumber] = useState('');
  const [chequeDate, setChequeDate] = useState('');
  const [bankName, setBankName] = useState('');
  const [transactionRef, setTransactionRef] = useState('');
  const [collectRemark, setCollectRemark] = useState('');
  const [collectPhoto, setCollectPhoto] = useState('');

  // The box types faster than the server answers, so it waits for a pause.
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 350);
    return () => clearTimeout(timer);
  }, [search]);

  const fetchPage = useCallback(async (page) => {
    const query = `tab=${tab}&page=${page}&limit=${PAGE_SIZE}${debounced ? `&search=${encodeURIComponent(debounced)}` : ''}`;
    const response = await fetch(`${apiUrl}/finance/recoveries/overdue?${query}`, { headers: { Authorization: `Bearer ${token}` } });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.message || 'Failed to load recovery list');
    return result;
  }, [apiUrl, token, tab, debounced]);

  const load = useCallback(async () => {
    try {
      setError('');
      const result = await fetchPage(1);
      setParties(Array.isArray(result.data) ? result.data : []);
      setMeta(result.meta || { counts: { today: 0, later: 0 }, amount: 0 });
      setPageInfo({ page: 1, totalPages: result.totalPages || 1, totalRecords: result.totalRecords || 0 });
      setOpenParty(null);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); setRefreshing(false); }
  }, [fetchPage]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  const loadMore = async () => {
    if (loadingMore || pageInfo.page >= pageInfo.totalPages) return;
    setLoadingMore(true);
    try {
      const result = await fetchPage(pageInfo.page + 1);
      setParties((current) => [...current, ...(result.data || [])]);
      setPageInfo((current) => ({ ...current, page: current.page + 1 }));
    } catch (e) { setError(e.message); }
    finally { setLoadingMore(false); }
  };

  /** Opens a shop and fetches its bills the first time. */
  const toggleParty = async (party) => {
    if (openParty === party.partyId) { setOpenParty(null); return; }
    setOpenParty(party.partyId);
    if (billsByParty[party.partyId]) return;

    setBillsLoading(true);
    try {
      const response = await fetch(`${apiUrl}/finance/recoveries/overdue?partyId=${party.partyId}&tab=${tab}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || 'Failed to load bills');
      setBillsByParty((current) => ({ ...current, [party.partyId]: result.data || [] }));
    } catch (e) { setError(e.message); }
    finally { setBillsLoading(false); }
  };

  const openInvoice = async row => {
    if (!row.orderId?._id) return;
    try {
      setInvoiceLoading(true);
      const response = await fetch(`${apiUrl}/order/${row.orderId._id}/invoice`, { headers: { Authorization: `Bearer ${token}` } });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || 'Invoice unavailable');
      setInvoice(result.data);
    } catch (e) { setError(e.message); }
    finally { setInvoiceLoading(false); }
  };

  /**
   * The visit is to a shop, not to a bill.
   *
   * Action used to sit on every bill, so a shop with eleven overdue invoices
   * asked for the same remark and the same promised date eleven times. It is
   * recorded once for the party and written to every bill it owes, which is
   * what actually happened: one conversation at one counter.
   */
  const openAction = party => {
    const bills = billsByParty[party.partyId] || [];
    const existing = bills.find(bill => bill.followUp)?.followUp || null;
    setActionRow({ party, bills });
    setRemark(existing?.remark || '');
    setNextVisitDate(existing?.scheduledDate ? String(existing.scheduledDate).slice(0, 10) : '');
    setCalendarMonth(new Date(existing?.scheduledDate || Date.now()));
  };

  /** Collect against one bill. The money lands on that bill, nothing to assign. */
  const openCollect = row => {
    setCollectRow(row);
    setCollectAmount(String(Math.round(Number(row.balanceDue) || 0)));
    setCollectMode('cash');
    setChequeNumber(''); setChequeDate(''); setBankName(''); setTransactionRef('');
    setCollectRemark('');
  };

  /**
   * Records the payment and points it at this bill in one go.
   *
   * A collector used to record the money and then go and find the bill to
   * allocate it to on another screen, which is where payments went missing.
   * The bill is known here, so the allocation is made with it.
   *
   * The bill's balance still moves only at settlement — that is deliberate and
   * unchanged: money is not "in" until it has actually been handed over.
   */
  const captureProof = () => launchCamera({ mediaType: 'photo', quality: 0.3, includeBase64: true }, response => {
    if (response.didCancel) return;
    if (response.errorCode) { setError(response.errorMessage || 'Could not start the camera'); return; }
    setError('');
    setCollectPhoto(response.assets[0].base64);
  });

  const submitCollect = async () => {
    const amount = Number(collectAmount);
    if (!Number.isFinite(amount) || amount <= 0) { setError('Enter the amount collected'); return; }
    if (amount > Number(collectRow.balanceDue) + 0.5) { setError('Amount is more than this bill owes'); return; }
    if (collectMode === 'cheque' && !chequeNumber.trim()) { setError('Cheque number is required'); return; }
    // The photo is the evidence that the money changed hands. The server
    // refuses without it; this only saves the round trip.
    if (!collectPhoto) { setError('Take a photo of the cash, cheque or transfer first'); return; }

    try {
      setSaving(true); setError('');
      const partyId = collectRow.partyId?._id || collectRow.partyId;
      const created = await fetch(`${apiUrl}/collection`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          partyId: String(partyId),
          orderId: collectRow.orderId?._id || null,
          amount,
          paymentMode: collectMode,
          chequeNumber: chequeNumber.trim() || undefined,
          chequeDate: chequeDate.trim() || undefined,
          bankName: bankName.trim() || undefined,
          transactionRef: transactionRef.trim() || undefined,
          receiptPhoto: await uploadPhoto({ base64: collectPhoto, apiUrl, token, module: 'collections' }),
          remarks: collectRemark.trim() || `Collected against ${collectRow.invoiceNumber}`,
        }),
      }).then(r => r.json());
      if (!created.success) throw new Error(created.message || 'Could not record the payment');

      const allocated = await fetch(`${apiUrl}/finance/payment/${created.data._id}/allocate`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ allocations: [{ invoiceId: String(collectRow._id), amount }] }),
      }).then(r => r.json());
      if (!allocated.success) throw new Error(allocated.message || 'Payment saved but could not be put against this bill');

      setCollectRow(null);
      setCollectPhoto('');
      setBillsByParty({});
      await load();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  const saveFollowUp = async () => {
    if (!remark.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(nextVisitDate)) {
      setError('Enter recovery remark and next visit date in YYYY-MM-DD format');
      return;
    }
    try {
      setSaving(true); setError('');
      // One visit, so the same promise goes on every bill that shop owes —
      // otherwise the shop stays on today's round for the ten bills nobody
      // typed the remark against.
      for (const bill of actionRow.bills) {
        const response = await fetch(`${apiUrl}/finance/recoveries/${bill._id}/follow-up`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ remark: remark.trim(), scheduledDate: nextVisitDate }),
        });
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.message || 'Failed to schedule recovery');
      }
      setActionRow(null); setRemark(''); setNextVisitDate('');
      // The bill has moved between tabs, so its shop is stale.
      setBillsByParty({});
      await load();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  const switchTab = (next) => {
    if (next === tab) return;
    setTab(next);
    setBillsByParty({});
    setLoading(true);
  };

  return <SafeAreaView style={s.safe}>
    <View style={s.header}>
      <TouchableOpacity onPress={onBack}><Text style={s.back}>‹ Back</Text></TouchableOpacity>
      <View style={{ flex: 1 }}>
        <Text style={s.title}>Recovery</Text>
        <Text style={s.subtitle}>{tab === 'today' ? 'Due now, nobody has promised a date' : 'Visited, waiting on a promised date'}</Text>
      </View>
      <View style={s.count}><Text style={s.countText}>{pageInfo.totalRecords}</Text></View>
    </View>

    <TextInput style={s.search} value={search} onChangeText={setSearch} placeholder="Search party name, code or phone" placeholderTextColor="#94A3B8"/>

    <View style={s.tabs}>
      <TouchableOpacity style={[s.tab, tab === 'today' && s.tabActive]} onPress={() => switchTab('today')}>
        <Text style={[s.tabText, tab === 'today' && s.tabTextActive]}>Today Recovery ({meta.counts?.today || 0})</Text>
      </TouchableOpacity>
      <TouchableOpacity style={[s.tab, tab === 'all' && s.tabActive]} onPress={() => switchTab('all')}>
        <Text style={[s.tabText, tab === 'all' && s.tabTextActive]}>All Overdue ({meta.counts?.later || 0})</Text>
      </TouchableOpacity>
    </View>

    {!loading && pageInfo.totalRecords > 0 && (
      <Text style={s.summary}>
        {pageInfo.totalRecords} {pageInfo.totalRecords === 1 ? 'party' : 'parties'} · {money(meta.amount)} to collect
      </Text>
    )}

    {error ? <Text style={s.error}>{error}</Text> : null}

    {loading ? <ActivityIndicator color="#0F766E" style={{ marginTop: 40 }}/> : <ScrollView
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); setBillsByParty({}); load(); }}/>}
      contentContainerStyle={s.list}
    >
      {parties.map(party => {
        const expanded = openParty === party.partyId;
        const bills = billsByParty[party.partyId];
        return <View key={party.partyId} style={s.card}>
          <TouchableOpacity style={s.partyHeader} activeOpacity={0.7} onPress={() => toggleParty(party)}>
            <View style={{ flex: 1 }}>
              <Text style={s.party}>{party.partyName || 'Unknown party'}</Text>
              <Text style={s.detail}>
                {party.partyCode ? `${party.partyCode} · ` : ''}{party.mobile || '—'}
                {party.area ? ` · ${party.area}` : ''}
              </Text>
              <Text style={s.salesman}>Salesman: {party.salesman?.name || 'Not assigned'}</Text>
              {party.nextVisit ? <Text style={s.nextVisit}>Next visit {date(party.nextVisit)}</Text> : null}
              {expanded && bills && bills.length > 0 && (
                <TouchableOpacity style={s.partyAction} onPress={() => openAction(party)}>
                  <Text style={s.actionText}>Action</Text>
                </TouchableOpacity>
              )}
            </View>
            <View style={s.partyBalance}>
              <Text style={s.amount}>{money(party.balance)}</Text>
              <Text style={s.label}>{party.bills} bill{party.bills === 1 ? '' : 's'}</Text>
              <View style={s.overdue}><Text style={s.overdueText}>{party.overdueDays}d</Text></View>
              <Text style={s.chev}>{expanded ? '▲' : '▼'}</Text>
            </View>
          </TouchableOpacity>

          {expanded && !bills && billsLoading && <ActivityIndicator color="#0F766E" style={{ marginVertical: verticalScale(14) }}/>}

          {expanded && bills && bills.map(row => <View key={row._id} style={s.billCard}>
            <View style={s.cardTop}>
              <View><Text style={s.invoiceNo}>{row.invoiceNumber}</Text><Text style={s.detail}>Order: {row.orderId?.orderNumber || '—'} · Due: {date(row.dueDate)}</Text></View>
              <View style={s.overdue}><Text style={s.overdueText}>{row.overdueDays} days</Text></View>
            </View>
            <View style={s.billAmounts}><Text style={s.value}>Due {money(row.balanceDue)}</Text><Text style={s.detail}>Bill {money(row.originalAmount)}</Text></View>
            {row.followUp && <View style={s.followUp}><Text style={s.followUpDate}>{row.promisedFor ? `Party promised to pay on ${date(row.promisedFor)}` : `Next visit: ${date(row.followUp.scheduledDate)}`}</Text><Text style={s.followUpRemark}>{row.followUp.remark}</Text></View>}
            {row.daysWaiting > 0 && !row.promisedFor && <Text style={s.waiting}>Owed for {row.daysWaiting} day{row.daysWaiting === 1 ? '' : 's'}</Text>}
            <View style={s.actions}>
              <TouchableOpacity
                style={[s.thirdBtn, s.outlineBtn, !row.delivery?.deliveryPhoto && s.btnOff]}
                disabled={!row.delivery?.deliveryPhoto}
                onPress={() => setProof(row.delivery.deliveryPhoto)}
              >
                <Text style={s.outlineText}>Driver Invoice</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.thirdBtn, s.outlineBtn, !row.gstInvoiceAvailable && s.btnOff]}
                disabled={!row.gstInvoiceAvailable || invoiceLoading}
                onPress={() => openInvoice(row)}
              >
                <Text style={s.outlineText}>{invoiceLoading ? 'Loading…' : 'GST Invoice'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.thirdBtn, s.collectBtn]} onPress={() => openCollect(row)}>
                <Text style={s.collectText}>Payment Collect</Text>
              </TouchableOpacity>
            </View>
          </View>)}

          {expanded && bills && bills.length === 0 && <Text style={s.detail}>No bills in this tab for this party.</Text>}
        </View>;
      })}

      {pageInfo.page < pageInfo.totalPages && <TouchableOpacity style={s.more} disabled={loadingMore} onPress={loadMore}>
        {loadingMore ? <ActivityIndicator color="#0F766E"/> : <Text style={s.moreText}>Load more ({pageInfo.totalRecords - parties.length} left)</Text>}
      </TouchableOpacity>}

      {!parties.length && <View style={s.empty}>
        <Text style={s.emptyTitle}>{debounced ? 'Nothing found' : 'No overdue recovery bills'}</Text>
        <Text style={s.emptyText}>{debounced ? `No party matches “${debounced}”.` : 'Expired unpaid bills assigned to you will appear here.'}</Text>
      </View>}
    </ScrollView>}

    <Modal visible={Boolean(proof)} transparent animationType="fade" onRequestClose={() => setProof(null)}><View style={s.modal}><View style={s.proofBox}><Text style={s.modalTitle}>Driver Uploaded Bill / POD</Text><FirebaseImage source={{ uri: proof }} token={token} apiUrl={apiUrl} resizeMode="contain" style={s.proofImage}/><TouchableOpacity style={s.primary} onPress={() => setProof(null)}><Text style={s.primaryText}>Close</Text></TouchableOpacity></View></View></Modal>

    <Modal visible={Boolean(invoice)} transparent animationType="slide" onRequestClose={() => setInvoice(null)}><KeyboardAvoidingView style={s.modal} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}><View style={s.invoiceBox}><ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"><Text style={s.invoiceTitle}>GST Invoice</Text><Text style={s.invoiceNumber}>{invoice?.invoiceNumber}</Text><Text style={s.invoiceParty}>{invoice?.billTo?.partyName}</Text><Text style={s.detail}>Order: {invoice?.orderNumber}</Text><Text style={s.detail}>Date: {date(invoice?.invoiceDate)}</Text>{(invoice?.items || []).map((item, index) => <View key={`${item.variantId || index}`} style={s.invoiceItem}><View><Text style={s.itemName}>{item.productName}</Text><Text style={s.detail}>{item.variantName} · HSN {item.hsnCode || '—'}</Text></View><Text style={s.itemAmount}>{money(item.totalAmount)}</Text></View>)}<View style={s.invoiceTotal}><Text style={s.label}>Total Amount</Text><Text style={s.amount}>{money(invoice?.summary?.netPayableAmount)}</Text></View></ScrollView><TouchableOpacity style={s.primary} onPress={() => setInvoice(null)}><Text style={s.primaryText}>Close Invoice</Text></TouchableOpacity></View></KeyboardAvoidingView></Modal>

    <Modal visible={Boolean(collectRow)} transparent animationType="slide" onRequestClose={() => setCollectRow(null)}>
      <KeyboardAvoidingView style={s.modal} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={s.actionBox}>
          <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={s.actionScroll}>
            <Text style={s.modalTitle}>Collect Payment</Text>
            <Text style={s.actionParty}>{collectRow?.partyId?.partyName}</Text>
            <Text style={s.actionInvoice}>{collectRow?.invoiceNumber} · owes {money(collectRow?.balanceDue)}</Text>

            <Text style={s.fieldLabel}>Amount collected *</Text>
            <TextInput style={s.field} keyboardType="numeric" value={collectAmount} onChangeText={setCollectAmount} placeholder="0" placeholderTextColor="#94A3B8"/>

            <Text style={s.fieldLabel}>Payment mode *</Text>
            <View style={s.modeRow}>
              {['cash', 'cheque', 'upi', 'online'].map(mode => (
                <TouchableOpacity key={mode} style={[s.mode, collectMode === mode && s.modeOn]} onPress={() => setCollectMode(mode)}>
                  <Text style={[s.modeText, collectMode === mode && s.modeTextOn]}>{mode.toUpperCase()}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {collectMode === 'cheque' && <>
              <Text style={s.fieldLabel}>Cheque number *</Text>
              <TextInput style={s.field} value={chequeNumber} onChangeText={setChequeNumber} placeholder="Cheque number" placeholderTextColor="#94A3B8"/>
              <Text style={s.fieldLabel}>Cheque date</Text>
              <TextInput style={s.field} value={chequeDate} onChangeText={setChequeDate} placeholder="YYYY-MM-DD" placeholderTextColor="#94A3B8"/>
              <Text style={s.fieldLabel}>Bank</Text>
              <TextInput style={s.field} value={bankName} onChangeText={setBankName} placeholder="Bank name" placeholderTextColor="#94A3B8"/>
            </>}

            {(collectMode === 'upi' || collectMode === 'online') && <>
              <Text style={s.fieldLabel}>Reference</Text>
              <TextInput style={s.field} value={transactionRef} onChangeText={setTransactionRef} placeholder="UTR or transaction id" placeholderTextColor="#94A3B8"/>
            </>}

            <Text style={s.fieldLabel}>Proof photo *</Text>
            <TouchableOpacity style={[s.proofBtn, collectPhoto && s.proofBtnDone]} onPress={captureProof}>
              <Text style={[s.proofBtnText, collectPhoto && s.proofBtnTextDone]}>
                {collectPhoto ? 'Photo attached — tap to retake' : 'Photo of the cash, cheque or transfer'}
              </Text>
            </TouchableOpacity>

            <Text style={s.fieldLabel}>Remark</Text>
            <TextInput style={[s.field, s.remarkField]} multiline value={collectRemark} onChangeText={setCollectRemark} placeholder="Anything worth recording" placeholderTextColor="#94A3B8"/>

            <Text style={s.note}>Goes straight against {collectRow?.invoiceNumber} — nothing to assign afterwards. The bill clears once the money is settled.</Text>

            <View style={s.modalActions}>
              <TouchableOpacity style={s.secondary} disabled={saving} onPress={() => { setCollectRow(null); setCollectPhoto(''); }}><Text style={s.secondaryText}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={[s.primary, (saving || !collectPhoto) && s.btnOff]} disabled={saving || !collectPhoto} onPress={submitCollect}>
                {saving ? <ActivityIndicator color="#fff"/> : <Text style={s.primaryText}>Save Payment</Text>}
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>

    <Modal visible={Boolean(actionRow)} transparent animationType="slide" onRequestClose={() => setActionRow(null)}><KeyboardAvoidingView style={s.modal} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}><View style={s.actionBox}><ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={s.actionScroll}><Text style={s.modalTitle}>Recovery Action</Text><Text style={s.actionParty}>{actionRow?.party?.partyName}</Text><Text style={s.actionInvoice}>{actionRow?.bills?.length || 0} bill{(actionRow?.bills?.length || 0) === 1 ? '' : 's'} · {money(actionRow?.party?.balance)}</Text><Text style={s.fieldLabel}>Recovery remark *</Text><TextInput style={[s.field,s.remarkField]} multiline value={remark} onChangeText={setRemark} placeholder="Party response, payment commitment or reason" placeholderTextColor="#94A3B8"/><Text style={s.fieldLabel}>Next visit date *</Text><CalendarPicker month={calendarMonth} setMonth={setCalendarMonth} value={nextVisitDate} onChange={setNextVisitDate}/><View style={s.modalActions}><TouchableOpacity style={s.secondary} disabled={saving} onPress={() => setActionRow(null)}><Text style={s.secondaryText}>Cancel</Text></TouchableOpacity><TouchableOpacity style={s.primary} disabled={saving} onPress={saveFollowUp}><Text style={s.primaryText}>{saving?'Saving…':'Save Follow-up'}</Text></TouchableOpacity></View></ScrollView></View></KeyboardAvoidingView></Modal>
  </SafeAreaView>;
}

function CalendarPicker({ month, setMonth, value, onChange }) {
  const year = month.getFullYear(), monthIndex = month.getMonth();
  const firstDay = new Date(year, monthIndex, 1).getDay();
  const days = new Date(year, monthIndex + 1, 0).getDate();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const cells = [...Array(firstDay).fill(null), ...Array.from({ length: days }, (_, index) => index + 1)];
  const format = day => `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return <View style={s.calendar}>
    <View style={s.calendarHead}><TouchableOpacity onPress={() => setMonth(new Date(year, monthIndex - 1, 1))}><Text style={s.calendarNav}>‹</Text></TouchableOpacity><Text style={s.calendarTitle}>{month.toLocaleDateString('en-IN', { month:'long', year:'numeric' })}</Text><TouchableOpacity onPress={() => setMonth(new Date(year, monthIndex + 1, 1))}><Text style={s.calendarNav}>›</Text></TouchableOpacity></View>
    <View style={s.weekRow}>{['S','M','T','W','T','F','S'].map((label, index) => <Text key={`${label}-${index}`} style={s.weekDay}>{label}</Text>)}</View>
    <View style={s.dayGrid}>{cells.map((day, index) => {
      if (!day) return <View key={`blank-${index}`} style={s.dayCell}/>;
      const candidate = new Date(year, monthIndex, day);
      const disabled = candidate < today;
      const selected = value === format(day);
      return <TouchableOpacity key={day} disabled={disabled} style={[s.dayCell,selected&&s.daySelected]} onPress={() => onChange(format(day))}><Text style={[s.dayText,disabled&&s.dayDisabled,selected&&s.dayTextSelected]}>{day}</Text></TouchableOpacity>;
    })}</View>
    <Text style={s.selectedDate}>{value ? `Selected: ${date(value)}` : 'Select next visit date'}</Text>
  </View>;
}

const s = StyleSheet.create({
  safe:{flex:1,backgroundColor:'#F7F9FC'},header:{backgroundColor:'#0F766E',padding: scale(16),flexDirection:'row',alignItems:'center',gap: verticalScale(14)},back:{color:'#fff',fontWeight:'800'},title:{color:'#fff',fontSize: responsiveFontSize(20),fontWeight:'900'},subtitle:{color:'#CCFBF1',fontSize: responsiveFontSize(11)},count:{backgroundColor:'#DC2626',borderRadius:18,minWidth:34,padding: scale(8),alignItems:'center'},countText:{color:'#fff',fontWeight:'900'},
  search:{margin: scale(14),marginBottom: verticalScale(5),borderWidth:1,borderColor:'#CBD5E1',borderRadius:12,padding: scale(12),backgroundColor:'#fff',color:'#0F172A'},
  tabs:{flexDirection:'row',gap: verticalScale(8),paddingHorizontal: scale(14),paddingTop: verticalScale(8)},tab:{flex:1,padding: scale(10),borderRadius:10,backgroundColor:'#E2E8F0',alignItems:'center'},tabActive:{backgroundColor:'#0F766E'},tabText:{fontSize: responsiveFontSize(11),fontWeight:'800',color:'#475569'},tabTextActive:{color:'#fff'},
  summary:{paddingHorizontal: scale(15),paddingTop: verticalScale(10),fontSize: responsiveFontSize(11),fontWeight:'800',color:'#0F766E'},
  error:{margin: scale(14),padding: scale(10),borderRadius:8,backgroundColor:'#FEE2E2',color:'#B91C1C'},
  list:{padding: scale(14),paddingBottom: verticalScale(40)},
  card:{backgroundColor:'#fff',borderRadius:15,padding: scale(15),marginBottom: verticalScale(12),borderWidth:1,borderColor:'#E2E8F0'},
  partyHeader:{flexDirection:'row',justifyContent:'space-between',gap: verticalScale(12)},partyBalance:{alignItems:'flex-end'},
  chev:{fontSize: responsiveFontSize(10),color:'#0F766E',marginTop: verticalScale(6),fontWeight:'900'},
  nextVisit:{fontSize: responsiveFontSize(11),color:'#92400E',fontWeight:'800',marginTop: verticalScale(3)},
  billCard:{borderTopWidth:1,borderColor:'#E2E8F0',paddingTop: verticalScale(12),marginTop: verticalScale(10)},
  billAmounts:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginTop: verticalScale(7)},
  cardTop:{flexDirection:'row',justifyContent:'space-between',gap: verticalScale(10)},
  party:{fontSize: responsiveFontSize(16),fontWeight:'900',color:'#0F172A'},
  invoiceNo:{fontSize: responsiveFontSize(12),fontWeight:'800',color:'#2563EB',marginTop: verticalScale(3)},
  overdue:{backgroundColor:'#FEE2E2',borderRadius:16,paddingHorizontal: scale(9),paddingVertical: verticalScale(4),marginTop: verticalScale(4)},overdueText:{fontSize: responsiveFontSize(10),color:'#B91C1C',fontWeight:'900'},
  label:{fontSize: responsiveFontSize(10),color:'#64748B',fontWeight:'700'},
  amount:{fontSize: responsiveFontSize(18),fontWeight:'900',color:'#DC2626'},
  value:{fontSize: responsiveFontSize(14),fontWeight:'800',color:'#0F172A',marginTop: verticalScale(3)},
  detail:{fontSize: responsiveFontSize(11),color:'#64748B',marginTop: verticalScale(2)},
  salesman:{fontSize: responsiveFontSize(12),color:'#0F172A',fontWeight:'800',marginTop: verticalScale(3)},
  waiting:{fontSize: responsiveFontSize(11),color:'#B45309',fontWeight:'800',marginTop: verticalScale(4)},
  followUp:{marginTop: verticalScale(11),padding: scale(10),borderRadius:9,backgroundColor:'#FEF3C7'},followUpDate:{fontSize: responsiveFontSize(11),fontWeight:'900',color:'#92400E'},followUpRemark:{fontSize: responsiveFontSize(11),color:'#A16207',marginTop: verticalScale(3)},
  actions:{flexDirection:'row',gap: scale(7),marginTop: verticalScale(14)},
  thirdBtn:{flex:1,borderRadius:10,paddingVertical: verticalScale(11),paddingHorizontal: scale(4),alignItems:'center',justifyContent:'center'},
  outlineBtn:{borderWidth:1,borderColor:'#2563EB',backgroundColor:'#fff'},
  outlineText:{color:'#2563EB',fontWeight:'900',fontSize: responsiveFontSize(11),textAlign:'center'},
  collectBtn:{backgroundColor:'#0F766E'},
  collectText:{color:'#fff',fontWeight:'900',fontSize: responsiveFontSize(11),textAlign:'center'},
  btnOff:{opacity:0.35},
  partyAction:{alignSelf:'flex-start',marginTop: verticalScale(8),backgroundColor:'#0F766E',borderRadius:9,paddingHorizontal: scale(20),paddingVertical: verticalScale(8)},
  modeRow:{flexDirection:'row',flexWrap:'wrap',gap: scale(7)},
  mode:{borderWidth:1,borderColor:'#CBD5E1',borderRadius:999,paddingHorizontal: scale(14),paddingVertical: verticalScale(7),backgroundColor:'#fff'},
  modeOn:{backgroundColor:'#0F766E',borderColor:'#0F766E'},
  modeText:{fontSize: responsiveFontSize(11),fontWeight:'900',color:'#475569'},
  modeTextOn:{color:'#fff'},
  note:{marginTop: verticalScale(12),padding: scale(10),borderRadius:9,backgroundColor:'#E0F2F1',color:'#0F766E',fontSize: responsiveFontSize(11),fontWeight:'700'},
  actionButton:{minWidth:80,backgroundColor:'#0F766E',borderRadius:10,padding: scale(11),alignItems:'center'},actionText:{color:'#fff',fontWeight:'900'},
  primary:{flex:1,backgroundColor:'#2563EB',borderRadius:10,padding: scale(11),alignItems:'center'},primaryText:{color:'#fff',fontWeight:'900'},secondary:{flex:1,borderWidth:1,borderColor:'#2563EB',borderRadius:10,padding: scale(11),alignItems:'center'},secondaryText:{color:'#2563EB',fontWeight:'900'},
  more:{padding: scale(14),borderRadius:12,backgroundColor:'#E0F2F1',alignItems:'center',marginTop: verticalScale(4)},moreText:{color:'#0F766E',fontWeight:'900'},
  empty:{alignItems:'center',padding: scale(45)},emptyTitle:{fontSize: responsiveFontSize(17),fontWeight:'900',color:'#0F172A'},emptyText:{fontSize: responsiveFontSize(12),color:'#64748B',textAlign:'center',marginTop: verticalScale(7)},
  proofBtn:{borderWidth:1,borderColor:'#CBD5E1',borderStyle:'dashed',borderRadius:10,padding:scale(12),alignItems:'center',backgroundColor:'#F8FAFC'},proofBtnDone:{borderColor:'#0F766E',borderStyle:'solid',backgroundColor:'#F0FDFA'},proofBtnText:{fontWeight:'800',color:'#64748B',fontSize:responsiveFontSize(11)},proofBtnTextDone:{color:'#0F766E'},
  modal:{flex:1,backgroundColor:'rgba(0,0,0,.72)',justifyContent:'center',padding: scale(18)},proofBox:{backgroundColor:'#fff',borderRadius:16,padding: scale(16)},modalTitle:{fontSize: responsiveFontSize(17),fontWeight:'900',color:'#0F172A',marginBottom: verticalScale(12)},proofImage:{width:'100%',height: verticalScale(430),backgroundColor:'#F1F5F9'},
  invoiceBox:{backgroundColor:'#fff',borderRadius:16,padding: scale(16),maxHeight:'90%'},invoiceTitle:{fontSize: responsiveFontSize(12),fontWeight:'800',color:'#64748B',textAlign:'center'},invoiceNumber:{fontSize: responsiveFontSize(20),fontWeight:'900',color:'#0F172A',textAlign:'center'},invoiceParty:{fontSize: responsiveFontSize(15),fontWeight:'800',color:'#0F172A',marginTop: verticalScale(18)},invoiceItem:{flexDirection:'row',justifyContent:'space-between',paddingVertical: verticalScale(11),borderBottomWidth:1,borderColor:'#E2E8F0'},itemName:{fontWeight:'800',color:'#0F172A'},itemAmount:{fontWeight:'900',color:'#0F172A'},invoiceTotal:{alignItems:'flex-end',paddingVertical: verticalScale(18)},
  actionBox:{backgroundColor:'#fff',borderRadius:16,padding: scale(17),maxHeight:'90%'},actionScroll:{paddingBottom: verticalScale(6)},actionParty:{fontSize: responsiveFontSize(15),fontWeight:'900',color:'#0F172A'},actionInvoice:{fontSize: responsiveFontSize(12),color:'#64748B',marginTop: verticalScale(3),marginBottom: verticalScale(15)},fieldLabel:{fontSize: responsiveFontSize(11),fontWeight:'800',color:'#475569',marginTop: verticalScale(10),marginBottom: verticalScale(5)},field:{borderWidth:1,borderColor:'#CBD5E1',borderRadius:10,padding: scale(11),color:'#0F172A',backgroundColor:'#fff'},remarkField:{minHeight:90,textAlignVertical:'top'},modalActions:{flexDirection:'row',gap: verticalScale(10),marginTop: verticalScale(18)},
  calendar:{borderWidth:1,borderColor:'#CBD5E1',borderRadius:12,padding: scale(10),backgroundColor:'#fff'},calendarHead:{flexDirection:'row',justifyContent:'space-between',alignItems:'center'},calendarNav:{fontSize: responsiveFontSize(27),fontWeight:'900',color:'#0F766E',paddingHorizontal: scale(12)},calendarTitle:{fontSize: responsiveFontSize(14),fontWeight:'900',color:'#0F172A'},weekRow:{flexDirection:'row',marginTop: verticalScale(5)},weekDay:{width:'14.285%',textAlign:'center',fontSize: responsiveFontSize(10),fontWeight:'900',color:'#64748B'},dayGrid:{flexDirection:'row',flexWrap:'wrap',marginTop: verticalScale(3)},dayCell:{width:'14.285%',height: verticalScale(34),alignItems:'center',justifyContent:'center',borderRadius:17},daySelected:{backgroundColor:'#0F766E'},dayText:{fontSize: responsiveFontSize(12),fontWeight:'700',color:'#0F172A'},dayDisabled:{color:'#CBD5E1'},dayTextSelected:{color:'#fff'},selectedDate:{textAlign:'center',marginTop: verticalScale(7),fontSize: responsiveFontSize(11),fontWeight:'800',color:'#0F766E'},
});
