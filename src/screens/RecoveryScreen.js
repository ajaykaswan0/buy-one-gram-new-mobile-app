import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, RefreshControl, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { scale, verticalScale, responsiveFontSize, maxContainerWidth } from '../utils/responsive';
import { FirebaseImage } from '../services/firebaseUploadService';

const money = value => `₹${Number(value || 0).toLocaleString('en-IN')}`;
const date = value => value ? new Date(value).toLocaleDateString('en-IN') : '—';

export default function RecoveryScreen({ token, apiUrl, onBack }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [proof, setProof] = useState(null);
  const [invoice, setInvoice] = useState(null);
  const [invoiceLoading, setInvoiceLoading] = useState(false);
  const [tab, setTab] = useState('today');
  const [actionRow, setActionRow] = useState(null);
  const [remark, setRemark] = useState('');
  const [nextVisitDate, setNextVisitDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(new Date());

  const load = useCallback(async () => {
    try {
      setError('');
      const response = await fetch(`${apiUrl}/finance/recoveries/overdue`, { headers: { Authorization: `Bearer ${token}` } });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || 'Failed to load recovery bills');
      setRows(Array.isArray(result.data) ? result.data : []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); setRefreshing(false); }
  }, [apiUrl, token]);
  useEffect(() => { load(); }, [load]);

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

  const openAction = row => {
    setActionRow(row);
    setRemark(row.followUp?.remark || '');
    setNextVisitDate(row.followUp?.scheduledDate ? String(row.followUp.scheduledDate).slice(0, 10) : '');
    setCalendarMonth(new Date(row.followUp?.scheduledDate || Date.now()));
  };
  const saveFollowUp = async () => {
    if (!remark.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(nextVisitDate)) {
      setError('Enter recovery remark and next visit date in YYYY-MM-DD format');
      return;
    }
    try {
      setSaving(true); setError('');
      const response = await fetch(`${apiUrl}/finance/recoveries/${actionRow._id}/follow-up`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ remark: remark.trim(), scheduledDate: nextVisitDate }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || 'Failed to schedule recovery');
      setActionRow(null); setRemark(''); setNextVisitDate('');
      await load();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  const visible = rows.filter(row => tab === 'all' || row.isTodayRecovery).filter(row => {
    const term = search.trim().toLowerCase();
    return !term || [row.partyId?.partyName, row.invoiceNumber, row.orderId?.orderNumber, row.assignedSalesman?.name].some(value => String(value || '').toLowerCase().includes(term));
  });
  const parties = Object.values(visible.reduce((result, bill) => {
    const key = bill.partyId?._id || 'unknown';
    if (!result[key]) result[key] = { key, party: bill.partyId, salesman: bill.assignedSalesman, bills: [], balance: 0 };
    result[key].bills.push(bill);
    result[key].balance += Number(bill.balanceDue || 0);
    return result;
  }, {}));

  return <SafeAreaView style={s.safe}>
    <View style={s.header}><TouchableOpacity onPress={onBack}><Text style={s.back}>‹ Back</Text></TouchableOpacity><View><Text style={s.title}>Recovery</Text><Text style={s.subtitle}>Overdue party bills</Text></View><View style={s.count}><Text style={s.countText}>{rows.length}</Text></View></View>
    <TextInput style={s.search} value={search} onChangeText={setSearch} placeholder="Search party, invoice or salesman" placeholderTextColor="#94A3B8"/>
    <View style={s.tabs}><TouchableOpacity style={[s.tab,tab==='today'&&s.tabActive]} onPress={() => setTab('today')}><Text style={[s.tabText,tab==='today'&&s.tabTextActive]}>Today Recovery ({rows.filter(row => row.isTodayRecovery).length})</Text></TouchableOpacity><TouchableOpacity style={[s.tab,tab==='all'&&s.tabActive]} onPress={() => setTab('all')}><Text style={[s.tabText,tab==='all'&&s.tabTextActive]}>All Overdue ({rows.length})</Text></TouchableOpacity></View>
    {error ? <Text style={s.error}>{error}</Text> : null}
    {loading ? <ActivityIndicator color="#0F766E" style={{ marginTop: 40 }}/> : <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }}/>} contentContainerStyle={s.list}>
      {parties.map(group => <View key={group.key} style={s.card}>
        <View style={s.partyHeader}><View><Text style={s.party}>{group.party?.partyName}</Text><Text style={s.detail}>{group.party?.mobile || '—'}</Text><Text style={s.salesman}>Assigned Salesman: {group.salesman?.name || 'Not assigned'}</Text></View><View style={s.partyBalance}><Text style={s.label}>{group.bills.length} bill{group.bills.length === 1 ? '' : 's'}</Text><Text style={s.amount}>{money(group.balance)}</Text></View></View>
        {group.bills.map(row => <View key={row._id} style={s.billCard}>
          <View style={s.cardTop}><View><Text style={s.invoiceNo}>{row.invoiceNumber}</Text><Text style={s.detail}>Order: {row.orderId?.orderNumber || '—'} · Due: {date(row.dueDate)}</Text></View><View style={s.overdue}><Text style={s.overdueText}>{row.overdueDays} days</Text></View></View>
          <View style={s.billAmounts}><Text style={s.value}>Due {money(row.balanceDue)}</Text><Text style={s.detail}>Bill {money(row.originalAmount)}</Text></View>
          {row.followUp && <View style={s.followUp}><Text style={s.followUpDate}>Next visit: {date(row.followUp.scheduledDate)}</Text><Text style={s.followUpRemark}>{row.followUp.remark}</Text></View>}
          <View style={s.actions}><TouchableOpacity style={s.actionButton} onPress={() => openAction(row)}><Text style={s.actionText}>Action</Text></TouchableOpacity>{row.delivery?.deliveryPhoto && <TouchableOpacity style={s.secondary} onPress={() => setProof(row.delivery.deliveryPhoto)}><Text style={s.secondaryText}>Driver Bill</Text></TouchableOpacity>}{row.gstInvoiceAvailable && <TouchableOpacity style={s.primary} disabled={invoiceLoading} onPress={() => openInvoice(row)}><Text style={s.primaryText}>{invoiceLoading ? 'Loading…' : 'GST Invoice'}</Text></TouchableOpacity>}</View>
        </View>)}
      </View>)}
      {!parties.length && <View style={s.empty}><Text style={s.emptyTitle}>No overdue recovery bills</Text><Text style={s.emptyText}>Expired unpaid bills assigned to you will appear here.</Text></View>}
    </ScrollView>}
    <Modal visible={Boolean(proof)} transparent animationType="fade" onRequestClose={() => setProof(null)}><View style={s.modal}><View style={s.proofBox}><Text style={s.modalTitle}>Driver Uploaded Bill / POD</Text><FirebaseImage source={{ uri: proof }} token={token} apiUrl={apiUrl} resizeMode="contain" style={s.proofImage}/><TouchableOpacity style={s.primary} onPress={() => setProof(null)}><Text style={s.primaryText}>Close</Text></TouchableOpacity></View></View></Modal>
    <Modal visible={Boolean(invoice)} transparent animationType="slide" onRequestClose={() => setInvoice(null)}><KeyboardAvoidingView style={s.modal} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}><View style={s.invoiceBox}><ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"><Text style={s.invoiceTitle}>GST Invoice</Text><Text style={s.invoiceNumber}>{invoice?.invoiceNumber}</Text><Text style={s.invoiceParty}>{invoice?.billTo?.partyName}</Text><Text style={s.detail}>Order: {invoice?.orderNumber}</Text><Text style={s.detail}>Date: {date(invoice?.invoiceDate)}</Text>{(invoice?.items || []).map((item, index) => <View key={`${item.variantId || index}`} style={s.invoiceItem}><View><Text style={s.itemName}>{item.productName}</Text><Text style={s.detail}>{item.variantName} · HSN {item.hsnCode || '—'}</Text></View><Text style={s.itemAmount}>{money(item.totalAmount)}</Text></View>)}<View style={s.invoiceTotal}><Text style={s.label}>Total Amount</Text><Text style={s.amount}>{money(invoice?.summary?.netPayableAmount)}</Text></View></ScrollView><TouchableOpacity style={s.primary} onPress={() => setInvoice(null)}><Text style={s.primaryText}>Close Invoice</Text></TouchableOpacity></View></KeyboardAvoidingView></Modal>
    <Modal visible={Boolean(actionRow)} transparent animationType="slide" onRequestClose={() => setActionRow(null)}><KeyboardAvoidingView style={s.modal} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}><View style={s.actionBox}><ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={s.actionScroll}><Text style={s.modalTitle}>Recovery Action</Text><Text style={s.actionParty}>{actionRow?.partyId?.partyName}</Text><Text style={s.actionInvoice}>{actionRow?.invoiceNumber} · {money(actionRow?.balanceDue)}</Text><Text style={s.fieldLabel}>Recovery remark *</Text><TextInput style={[s.field,s.remarkField]} multiline value={remark} onChangeText={setRemark} placeholder="Party response, payment commitment or reason" placeholderTextColor="#94A3B8"/><Text style={s.fieldLabel}>Next visit date *</Text><CalendarPicker month={calendarMonth} setMonth={setCalendarMonth} value={nextVisitDate} onChange={setNextVisitDate}/><View style={s.modalActions}><TouchableOpacity style={s.secondary} disabled={saving} onPress={() => setActionRow(null)}><Text style={s.secondaryText}>Cancel</Text></TouchableOpacity><TouchableOpacity style={s.primary} disabled={saving} onPress={saveFollowUp}><Text style={s.primaryText}>{saving?'Saving…':'Save Follow-up'}</Text></TouchableOpacity></View></ScrollView></View></KeyboardAvoidingView></Modal>
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
  safe:{flex:1,backgroundColor:'#F7F9FC'},header:{backgroundColor:'#0F766E',padding: scale(16),flexDirection:'row',alignItems:'center',gap: verticalScale(14)},back:{color:'#fff',fontWeight:'800'},title:{color:'#fff',fontSize: responsiveFontSize(20),fontWeight:'900'},subtitle:{color:'#CCFBF1',fontSize: responsiveFontSize(11)},count:{marginLeft:'auto',backgroundColor:'#DC2626',borderRadius:18,minWidth:34,padding: scale(8),alignItems:'center'},countText:{color:'#fff',fontWeight:'900'},search:{margin: scale(14),marginBottom: verticalScale(5),borderWidth:1,borderColor:'#CBD5E1',borderRadius:12,padding: scale(12),backgroundColor:'#fff',color:'#0F172A'},tabs:{flexDirection:'row',gap: verticalScale(8),paddingHorizontal: scale(14),paddingTop: verticalScale(8)},tab:{flex:1,padding: scale(10),borderRadius:10,backgroundColor:'#E2E8F0',alignItems:'center'},tabActive:{backgroundColor:'#0F766E'},tabText:{fontSize: responsiveFontSize(11),fontWeight:'800',color:'#475569'},tabTextActive:{color:'#fff'},error:{margin: scale(14),padding: scale(10),borderRadius:8,backgroundColor:'#FEE2E2',color:'#B91C1C'},list:{padding: scale(14),paddingBottom: verticalScale(40)},card:{backgroundColor:'#fff',borderRadius:15,padding: scale(15),marginBottom: verticalScale(12),borderWidth:1,borderColor:'#E2E8F0'},partyHeader:{flexDirection:'row',justifyContent:'space-between',gap: verticalScale(12),paddingBottom: verticalScale(12)},partyBalance:{alignItems:'flex-end'},billCard:{borderTopWidth:1,borderColor:'#E2E8F0',paddingTop: verticalScale(12),marginTop: verticalScale(5),marginBottom: verticalScale(8)},billAmounts:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginTop: verticalScale(7)},cardTop:{flexDirection:'row',justifyContent:'space-between',gap: verticalScale(10)},party:{fontSize: responsiveFontSize(16),fontWeight:'900',color:'#0F172A'},invoiceNo:{fontSize: responsiveFontSize(12),fontWeight:'800',color:'#2563EB',marginTop: verticalScale(3)},overdue:{backgroundColor:'#FEE2E2',borderRadius:16,paddingHorizontal: scale(9),paddingVertical: verticalScale(6)},overdueText:{fontSize: responsiveFontSize(10),color:'#B91C1C',fontWeight:'900'},amountRow:{flexDirection:'row',justifyContent:'space-between',marginVertical: verticalScale(14),paddingVertical: verticalScale(12),borderTopWidth:1,borderBottomWidth:1,borderColor:'#E2E8F0'},label:{fontSize: responsiveFontSize(10),color:'#64748B',fontWeight:'700'},amount:{fontSize: responsiveFontSize(20),fontWeight:'900',color:'#DC2626',marginTop: verticalScale(3)},value:{fontSize: responsiveFontSize(14),fontWeight:'800',color:'#0F172A',marginTop: verticalScale(3)},details:{gap: verticalScale(5)},detail:{fontSize: responsiveFontSize(11),color:'#64748B'},salesman:{fontSize: responsiveFontSize(12),color:'#0F172A',fontWeight:'800'},followUp:{marginTop: verticalScale(11),padding: scale(10),borderRadius:9,backgroundColor:'#FEF3C7'},followUpDate:{fontSize: responsiveFontSize(11),fontWeight:'900',color:'#92400E'},followUpRemark:{fontSize: responsiveFontSize(11),color:'#A16207',marginTop: verticalScale(3)},actions:{flexDirection:'row',flexWrap:'wrap',gap: verticalScale(9),marginTop: verticalScale(14)},actionButton:{minWidth:80,backgroundColor:'#0F766E',borderRadius:10,padding: scale(11),alignItems:'center'},actionText:{color:'#fff',fontWeight:'900'},primary:{flex:1,backgroundColor:'#2563EB',borderRadius:10,padding: scale(11),alignItems:'center'},primaryText:{color:'#fff',fontWeight:'900'},secondary:{flex:1,borderWidth:1,borderColor:'#2563EB',borderRadius:10,padding: scale(11),alignItems:'center'},secondaryText:{color:'#2563EB',fontWeight:'900'},empty:{alignItems:'center',padding: scale(45)},emptyTitle:{fontSize: responsiveFontSize(17),fontWeight:'900',color:'#0F172A'},emptyText:{fontSize: responsiveFontSize(12),color:'#64748B',textAlign:'center',marginTop: verticalScale(7)},modal:{flex:1,backgroundColor:'rgba(0,0,0,.72)',justifyContent:'center',padding: scale(18)},proofBox:{backgroundColor:'#fff',borderRadius:16,padding: scale(16)},modalTitle:{fontSize: responsiveFontSize(17),fontWeight:'900',color:'#0F172A',marginBottom: verticalScale(12)},proofImage:{width:'100%',height: verticalScale(430),backgroundColor:'#F1F5F9'},invoiceBox:{backgroundColor:'#fff',borderRadius:16,padding: scale(16),maxHeight:'90%'},invoiceTitle:{fontSize: responsiveFontSize(12),fontWeight:'800',color:'#64748B',textAlign:'center'},invoiceNumber:{fontSize: responsiveFontSize(20),fontWeight:'900',color:'#0F172A',textAlign:'center'},invoiceParty:{fontSize: responsiveFontSize(15),fontWeight:'800',color:'#0F172A',marginTop: verticalScale(18)},invoiceItem:{flexDirection:'row',justifyContent:'space-between',paddingVertical: verticalScale(11),borderBottomWidth:1,borderColor:'#E2E8F0'},itemName:{fontWeight:'800',color:'#0F172A'},itemAmount:{fontWeight:'900',color:'#0F172A'},invoiceTotal:{alignItems:'flex-end',paddingVertical: verticalScale(18)},actionBox:{backgroundColor:'#fff',borderRadius:16,padding: scale(17),maxHeight:'90%'},actionScroll:{paddingBottom: verticalScale(6)},actionParty:{fontSize: responsiveFontSize(15),fontWeight:'900',color:'#0F172A'},actionInvoice:{fontSize: responsiveFontSize(12),color:'#64748B',marginTop: verticalScale(3),marginBottom: verticalScale(15)},fieldLabel:{fontSize: responsiveFontSize(11),fontWeight:'800',color:'#475569',marginTop: verticalScale(10),marginBottom: verticalScale(5)},field:{borderWidth:1,borderColor:'#CBD5E1',borderRadius:10,padding: scale(11),color:'#0F172A',backgroundColor:'#fff'},remarkField:{minHeight:90,textAlignVertical:'top'},modalActions:{flexDirection:'row',gap: verticalScale(10),marginTop: verticalScale(18)},calendar:{borderWidth:1,borderColor:'#CBD5E1',borderRadius:12,padding: scale(10),backgroundColor:'#fff'},calendarHead:{flexDirection:'row',justifyContent:'space-between',alignItems:'center'},calendarNav:{fontSize: responsiveFontSize(27),fontWeight:'900',color:'#0F766E',paddingHorizontal: scale(12)},calendarTitle:{fontSize: responsiveFontSize(14),fontWeight:'900',color:'#0F172A'},weekRow:{flexDirection:'row',marginTop: verticalScale(5)},weekDay:{width:'14.285%',textAlign:'center',fontSize: responsiveFontSize(10),fontWeight:'900',color:'#64748B'},dayGrid:{flexDirection:'row',flexWrap:'wrap',marginTop: verticalScale(3)},dayCell:{width:'14.285%',height: verticalScale(34),alignItems:'center',justifyContent:'center',borderRadius:17},daySelected:{backgroundColor:'#0F766E'},dayText:{fontSize: responsiveFontSize(12),fontWeight:'700',color:'#0F172A'},dayDisabled:{color:'#CBD5E1'},dayTextSelected:{color:'#fff'},selectedDate:{textAlign:'center',marginTop: verticalScale(7),fontSize: responsiveFontSize(11),fontWeight:'800',color:'#0F766E'},
});
