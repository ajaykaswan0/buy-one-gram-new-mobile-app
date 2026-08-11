import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  SafeAreaView,
  ScrollView,
  Modal,
} from 'react-native';
import { scale, verticalScale, responsiveFontSize, maxContainerWidth } from '../utils/responsive';

const LEAVE_TYPES = [
  { value: 'casual', label: 'Casual Leave' },
  { value: 'sick', label: 'Sick Leave' },
  { value: 'unpaid', label: 'Unpaid Leave' },
  { value: 'emergency', label: 'Emergency Leave' },
];

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const DAYS_OF_WEEK = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

export default function LeaveScreen({ token, apiUrl, onBack }) {
  const [leaves, setLeaves] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Form states
  const [leaveType, setLeaveType] = useState('casual');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [totalDays, setTotalDays] = useState('1');
  const [reason, setReason] = useState('');
  const [typeModalVisible, setTypeModalVisible] = useState(false);

  // Calendar Modal states
  const [calendarVisible, setCalendarVisible] = useState(false);
  const [activeDatePicker, setActiveDatePicker] = useState('from'); // 'from' | 'to'
  const [calYear, setCalYear] = useState(new Date().getFullYear());
  const [calMonth, setCalMonth] = useState(new Date().getMonth());

  // Auto-calculate total days when fromDate and toDate changes
  useEffect(() => {
    if (fromDate && toDate) {
      const d1 = new Date(fromDate);
      const d2 = new Date(toDate);
      if (!isNaN(d1) && !isNaN(d2) && d2 >= d1) {
        const diffTime = Math.abs(d2 - d1);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
        setTotalDays(String(diffDays));
      }
    }
  }, [fromDate, toDate]);

  const loadLeaves = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`${apiUrl}/leave/my`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await response.json();
      if (response.ok) {
        setLeaves(data.data || []);
      } else {
        throw new Error(data.message || 'Failed to fetch leaves');
      }
    } catch (err) {
      setError(err.message || 'Connection error.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLeaves();
  }, [apiUrl, token]);

  const handleApplyLeave = async () => {
    if (!fromDate || !toDate || !reason.trim()) {
      setError('Please fill in all fields.');
      return;
    }

    const d1 = new Date(fromDate);
    const d2 = new Date(toDate);
    if (d1 > d2) {
      setError('From Date cannot be after To Date.');
      return;
    }

    setError('');
    setSuccess('');
    setSubmitting(true);

    try {
      const response = await fetch(`${apiUrl}/leave`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          fromDate: d1.toISOString(),
          toDate: d2.toISOString(),
          totalDays: parseInt(totalDays) || 1,
          leaveType,
          reason: reason.trim(),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Failed to submit leave request');
      }

      setSuccess('Leave request submitted successfully!');
      setFromDate('');
      setToDate('');
      setReason('');
      setTotalDays('1');
      
      loadLeaves();
    } catch (err) {
      setError(err.message || 'Network error.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleWithdraw = async (leaveId) => {
    setError('');
    setSuccess('');
    try {
      const response = await fetch(`${apiUrl}/leave/${leaveId}/withdraw`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await response.json();
      if (response.ok) {
        setSuccess('Leave request withdrawn.');
        loadLeaves();
      } else {
        throw new Error(data.message || 'Failed to withdraw leave');
      }
    } catch (err) {
      setError(err.message || 'Connection error.');
    }
  };

  const formatDateLabel = (dateStr) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const getLeaveTypeLabel = (val) => {
    const type = LEAVE_TYPES.find((t) => t.value === val);
    return type ? type.label : val;
  };

  // Calendar Helper methods
  const openDatePicker = (type) => {
    setActiveDatePicker(type);
    const initialDate = type === 'from' ? fromDate : toDate;
    const d = initialDate ? new Date(initialDate) : new Date();
    setCalYear(d.getFullYear());
    setCalMonth(d.getMonth());
    setCalendarVisible(true);
  };

  const handleSelectDay = (day) => {
    const monthStr = String(calMonth + 1).padStart(2, '0');
    const dayStr = String(day).padStart(2, '0');
    const selectedDateStr = `${calYear}-${monthStr}-${dayStr}`;
    
    if (activeDatePicker === 'from') {
      setFromDate(selectedDateStr);
    } else {
      setToDate(selectedDateStr);
    }
    setCalendarVisible(false);
  };

  const changeMonth = (direction) => {
    if (direction === 'prev') {
      if (calMonth === 0) {
        setCalMonth(11);
        setCalYear(calYear - 1);
      } else {
        setCalMonth(calMonth - 1);
      }
    } else {
      if (calMonth === 11) {
        setCalMonth(0);
        setCalYear(calYear + 1);
      } else {
        setCalMonth(calMonth + 1);
      }
    }
  };

  const generateDays = () => {
    const firstDayIndex = new Date(calYear, calMonth, 1).getDay();
    const totalDaysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const days = [];
    // Previous month offset slots
    for (let i = 0; i < firstDayIndex; i++) {
      days.push({ key: `empty-${i}`, day: '', active: false, isOffset: true });
    }
    // Current month days
    for (let i = 1; i <= totalDaysInMonth; i++) {
      const cellDate = new Date(calYear, calMonth, i);
      const isPast = cellDate < today;
      days.push({ key: `day-${i}`, day: i, active: !isPast, isOffset: false });
    }
    return days;
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={onBack}>
          <Text style={styles.backBtnText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Leave Portal</Text>
      </View>

      <ScrollView contentContainerStyle={styles.container}>
        {/* Leave application form */}
        <View style={styles.formCard}>
          <Text style={styles.cardTitle}>Request Leave</Text>

          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          {success ? <Text style={styles.successText}>{success}</Text> : null}

          {/* Leave Type picker */}
          <Text style={styles.fieldLabel}>Leave Type</Text>
          <TouchableOpacity
            style={styles.pickerSelector}
            onPress={() => setTypeModalVisible(true)}
          >
            <Text style={styles.pickerSelectorText}>{getLeaveTypeLabel(leaveType)}</Text>
            <Text style={styles.pickerArrow}>▼</Text>
          </TouchableOpacity>

          <View style={styles.rowInputs}>
            <View style={styles.halfInput}>
              <Text style={styles.fieldLabel}>From Date</Text>
              <TouchableOpacity
                style={styles.datePickerBtn}
                onPress={() => openDatePicker('from')}
              >
                <Text style={[styles.datePickerBtnText, !fromDate && styles.placeholderText]}>
                  {fromDate || 'Select Date'}
                </Text>
                <Text style={styles.datePickerIcon}>📅</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.halfInput}>
              <Text style={styles.fieldLabel}>To Date</Text>
              <TouchableOpacity
                style={styles.datePickerBtn}
                onPress={() => openDatePicker('to')}
              >
                <Text style={[styles.datePickerBtnText, !toDate && styles.placeholderText]}>
                  {toDate || 'Select Date'}
                </Text>
                <Text style={styles.datePickerIcon}>📅</Text>
              </TouchableOpacity>
            </View>
          </View>

          <Text style={styles.fieldLabel}>Total Days</Text>
          <View style={[styles.input, styles.disabledInput]}>
            <Text style={styles.disabledInputText}>{totalDays}</Text>
          </View>

          <Text style={styles.fieldLabel}>Reason for Leave</Text>
          <TextInput
            style={[styles.input, styles.reasonInput]}
            placeholder="Describe the reason..."
            placeholderTextColor="#A0AEC0"
            multiline
            numberOfLines={3}
            value={reason}
            onChangeText={setReason}
          />

          <TouchableOpacity
            style={[styles.submitBtn, submitting && styles.disabledBtn]}
            onPress={handleApplyLeave}
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.submitBtnText}>Submit Request</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Leave Requests Logs History */}
        <Text style={styles.sectionTitle}>My Leave Requests</Text>
        {loading ? (
          <ActivityIndicator color="#00796B" style={{ marginVertical: 20 }} />
        ) : (
          <View style={styles.logsList}>
            {leaves.length === 0 ? (
              <Text style={styles.emptyText}>No leave requests recorded yet.</Text>
            ) : (
              leaves.map((item) => (
                <View style={styles.logCard} key={item._id}>
                  <View style={styles.cardHeader}>
                    <View>
                      <Text style={styles.logTitle}>{getLeaveTypeLabel(item.leaveType)}</Text>
                      <Text style={styles.logSubtitle}>
                        {formatDateLabel(item.fromDate)} - {formatDateLabel(item.toDate)} • ({item.totalDays} Days)
                      </Text>
                    </View>
                    
                    {/* Status Badge */}
                    <View style={[
                      styles.statusPill,
                      item.status === 'approved' && styles.approvedPill,
                      item.status === 'rejected' && styles.rejectedPill,
                      item.status === 'withdrawn' && styles.withdrawnPill,
                      item.status === 'pending' && styles.pendingPill,
                    ]}>
                      <Text style={[
                        styles.statusPillText,
                        item.status === 'approved' && styles.approvedPillText,
                        item.status === 'rejected' && styles.rejectedPillText,
                        item.status === 'withdrawn' && styles.withdrawnPillText,
                        item.status === 'pending' && styles.pendingPillText,
                      ]}>
                        {item.status}
                      </Text>
                    </View>
                  </View>

                  <Text style={styles.logReason}>
                    <Text style={styles.reasonHeading}>Reason: </Text>
                    {item.reason}
                  </Text>

                  {item.remarks ? (
                    <Text style={styles.logRemarks}>
                      <Text style={styles.remarksHeading}>Remarks: </Text>
                      {item.remarks}
                    </Text>
                  ) : null}

                  {/* Withdraw Request Option */}
                  {item.status === 'pending' && (
                    <TouchableOpacity
                      style={styles.withdrawBtn}
                      onPress={() => handleWithdraw(item._id)}
                    >
                      <Text style={styles.withdrawBtnText}>Withdraw Request</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ))
            )}
          </View>
        )}
      </ScrollView>

      {/* Leave Type Modal Selector */}
      <Modal
        visible={typeModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setTypeModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setTypeModalVisible(false)}
        >
          <View style={styles.modalContent}>
            <Text style={styles.modalHeader}>Select Leave Type</Text>
            {LEAVE_TYPES.map((type) => (
              <TouchableOpacity
                key={type.value}
                style={[
                  styles.modalItem,
                  leaveType === type.value && styles.activeModalItem,
                ]}
                onPress={() => {
                  setLeaveType(type.value);
                  setTypeModalVisible(false);
                }}
              >
                <Text style={[
                  styles.modalItemText,
                  leaveType === type.value && styles.activeModalItemText,
                ]}>
                  {type.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Custom BYG Themed Graphical Calendar Picker Modal */}
      <Modal
        visible={calendarVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setCalendarVisible(false)}
      >
        <View style={styles.calendarModalOverlay}>
          <View style={styles.calendarCard}>
            {/* Calendar Header */}
            <View style={styles.calendarHeaderRow}>
              <TouchableOpacity style={styles.monthNavBtn} onPress={() => changeMonth('prev')}>
                <Text style={styles.monthNavText}>◀</Text>
              </TouchableOpacity>
              <Text style={styles.calendarTitle}>
                {MONTHS[calMonth]} {calYear}
              </Text>
              <TouchableOpacity style={styles.monthNavBtn} onPress={() => changeMonth('next')}>
                <Text style={styles.monthNavText}>▶</Text>
              </TouchableOpacity>
            </View>

            {/* Days of Week */}
            <View style={styles.weekLabelsRow}>
              {DAYS_OF_WEEK.map((day) => (
                <Text key={day} style={styles.weekLabel}>{day}</Text>
              ))}
            </View>

            {/* Days Grid */}
            <View style={styles.daysGrid}>
              {generateDays().map((item, index) => (
                <TouchableOpacity
                  key={item.key}
                  style={[
                    styles.dayCell,
                    item.isOffset && styles.disabledDayCell,
                    (!item.active && !item.isOffset) && styles.pastDayCell,
                    (activeDatePicker === 'from' && fromDate === `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(item.day).padStart(2, '0')}`) && styles.selectedDayCell,
                    (activeDatePicker === 'to' && toDate === `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(item.day).padStart(2, '0')}`) && styles.selectedDayCell,
                  ]}
                  disabled={!item.active}
                  onPress={() => handleSelectDay(item.day)}
                >
                  <Text style={[
                    styles.dayCellText,
                    item.isOffset && styles.disabledDayCellText,
                    (!item.active && !item.isOffset) && styles.pastDayCellText,
                    ((activeDatePicker === 'from' && fromDate === `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(item.day).padStart(2, '0')}`) ||
                     (activeDatePicker === 'to' && toDate === `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(item.day).padStart(2, '0')}`)) && styles.selectedDayCellText,
                  ]}>
                    {item.day}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Close Button */}
            <TouchableOpacity
              style={styles.closeCalBtn}
              onPress={() => setCalendarVisible(false)}
            >
              <Text style={styles.closeCalBtnText}>Close Calendar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
    paddingHorizontal: scale(16),
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
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
  container: {
    padding: scale(20),
    paddingBottom: verticalScale(40),
  },
  formCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: scale(20),
    shadowColor: '#1A202C',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.02,
    shadowRadius: 10,
    elevation: 2,
    marginBottom: verticalScale(28),
  },
  cardTitle: {
    fontSize: responsiveFontSize(16),
    fontWeight: '700',
    color: '#2D3748',
    marginBottom: verticalScale(16),
    borderBottomWidth: 1,
    borderBottomColor: '#EDF2F7',
    paddingBottom: verticalScale(8),
  },
  errorText: {
    color: '#E53E3E',
    backgroundColor: '#FFF5F5',
    borderWidth: 1,
    borderColor: '#FED7D7',
    padding: scale(10),
    borderRadius: 8,
    fontSize: responsiveFontSize(12.5),
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: verticalScale(16),
  },
  successText: {
    color: '#00796B',
    backgroundColor: '#E0F2F1',
    borderWidth: 1,
    borderColor: '#B2DFDB',
    padding: scale(10),
    borderRadius: 8,
    fontSize: responsiveFontSize(12.5),
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: verticalScale(16),
  },
  fieldLabel: {
    fontSize: responsiveFontSize(11),
    fontWeight: '800',
    color: '#718096',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: verticalScale(6),
  },
  pickerSelector: {
    height: verticalScale(44),
    backgroundColor: '#F7F9FC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: scale(12),
    marginBottom: verticalScale(16),
  },
  pickerSelectorText: {
    color: '#2D3748',
    fontSize: responsiveFontSize(14.5),
    fontWeight: '600',
  },
  pickerArrow: {
    color: '#A0AEC0',
    fontSize: responsiveFontSize(11),
  },
  rowInputs: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: verticalScale(12),
  },
  halfInput: {
    flex: 1,
  },
  datePickerBtn: {
    height: verticalScale(44),
    backgroundColor: '#F7F9FC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: scale(12),
    marginBottom: verticalScale(16),
  },
  datePickerBtnText: {
    color: '#2D3748',
    fontSize: responsiveFontSize(14),
    fontWeight: '600',
  },
  placeholderText: {
    color: '#A0AEC0',
  },
  datePickerIcon: {
    fontSize: responsiveFontSize(14),
  },
  input: {
    height: verticalScale(44),
    backgroundColor: '#F7F9FC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    color: '#2D3748',
    paddingHorizontal: scale(12),
    fontSize: responsiveFontSize(14.5),
    marginBottom: verticalScale(16),
  },
  reasonInput: {
    height: verticalScale(80),
    textAlignVertical: 'top',
    paddingVertical: verticalScale(10),
  },
  submitBtn: {
    height: verticalScale(46),
    backgroundColor: '#00796B',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: verticalScale(8),
  },
  disabledBtn: {
    opacity: 0.6,
  },
  submitBtnText: {
    color: '#FFFFFF',
    fontSize: responsiveFontSize(15),
    fontWeight: '700',
  },
  sectionTitle: {
    fontSize: responsiveFontSize(18),
    fontWeight: '700',
    color: '#1A202C',
    marginBottom: verticalScale(14),
    paddingLeft: scale(4),
  },
  logsList: {
    gap: verticalScale(12),
  },
  emptyText: {
    textAlign: 'center',
    color: '#718096',
    marginVertical: verticalScale(20),
    fontSize: responsiveFontSize(13),
  },
  logCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: scale(16),
    shadowColor: '#1A202C',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.01,
    shadowRadius: 10,
    elevation: 1,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    borderBottomWidth: 1,
    borderBottomColor: '#EDF2F7',
    paddingBottom: verticalScale(10),
    marginBottom: verticalScale(10),
  },
  logTitle: {
    fontSize: responsiveFontSize(15),
    fontWeight: '700',
    color: '#2D3748',
  },
  logSubtitle: {
    fontSize: responsiveFontSize(12),
    color: '#718096',
    marginTop: verticalScale(4),
    fontWeight: '600',
  },
  statusPill: {
    paddingVertical: verticalScale(4),
    paddingHorizontal: scale(10),
    borderRadius: 12,
  },
  approvedPill: {
    backgroundColor: '#E0F2F1',
  },
  approvedPillText: {
    color: '#00796B',
  },
  rejectedPill: {
    backgroundColor: '#FED7D7',
  },
  rejectedPillText: {
    color: '#E53E3E',
  },
  withdrawnPill: {
    backgroundColor: '#EDF2F7',
  },
  withdrawnPillText: {
    color: '#718096',
  },
  pendingPill: {
    backgroundColor: '#FEFCBF',
  },
  pendingPillText: {
    color: '#D69E2E',
  },
  statusPillText: {
    fontSize: responsiveFontSize(11),
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  logReason: {
    fontSize: responsiveFontSize(13),
    color: '#4A5568',
    lineHeight: 18,
    marginBottom: verticalScale(8),
  },
  reasonHeading: {
    fontWeight: '700',
    color: '#2D3748',
  },
  logRemarks: {
    fontSize: responsiveFontSize(13),
    color: '#D69E2E',
    backgroundColor: '#FEFCBF',
    padding: scale(8),
    borderRadius: 6,
    lineHeight: 18,
    marginBottom: verticalScale(8),
  },
  remarksHeading: {
    fontWeight: '700',
  },
  withdrawBtn: {
    alignSelf: 'flex-end',
    paddingVertical: verticalScale(6),
    paddingHorizontal: scale(12),
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginTop: verticalScale(6),
  },
  withdrawBtnText: {
    color: '#E53E3E',
    fontSize: responsiveFontSize(12),
    fontWeight: '700',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: scale(20),
    paddingBottom: verticalScale(40),
  },
  modalHeader: {
    fontSize: responsiveFontSize(16),
    fontWeight: '700',
    color: '#2D3748',
    marginBottom: verticalScale(16),
    textAlign: 'center',
  },
  modalItem: {
    paddingVertical: verticalScale(14),
    borderBottomWidth: 1,
    borderBottomColor: '#EDF2F7',
  },
  activeModalItem: {
    backgroundColor: '#E0F2F1',
    borderRadius: 8,
  },
  modalItemText: {
    fontSize: responsiveFontSize(15),
    color: '#4A5568',
    textAlign: 'center',
  },
  activeModalItemText: {
    color: '#00796B',
    fontWeight: '700',
  },
  // Calendar styles
  calendarModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: scale(24),
  },
  calendarCard: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: scale(20),
    shadowColor: '#000',
    shadowOffset: { width: 0, height: verticalScale(10) },
    shadowOpacity: 0.1,
    shadowRadius: 20,
    elevation: 8,
  },
  calendarHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: verticalScale(16),
  },
  monthNavBtn: {
    padding: scale(8),
  },
  monthNavText: {
    fontSize: responsiveFontSize(14),
    color: '#00796B',
  },
  calendarTitle: {
    fontSize: responsiveFontSize(16),
    fontWeight: '700',
    color: '#2D3748',
  },
  weekLabelsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: verticalScale(10),
    borderBottomWidth: 1,
    borderBottomColor: '#EDF2F7',
    paddingBottom: verticalScale(6),
  },
  weekLabel: {
    width: '14%',
    textAlign: 'center',
    fontSize: responsiveFontSize(12),
    fontWeight: '700',
    color: '#718096',
  },
  daysGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: verticalScale(8),
  },
  dayCell: {
    width: '14%',
    height: verticalScale(40),
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
  },
  disabledDayCell: {
    backgroundColor: 'transparent',
  },
  selectedDayCell: {
    backgroundColor: '#00796B',
  },
  dayCellText: {
    fontSize: responsiveFontSize(14),
    fontWeight: '600',
    color: '#2D3748',
  },
  disabledDayCellText: {
    color: 'transparent',
  },
  selectedDayCellText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  closeCalBtn: {
    marginTop: verticalScale(20),
    height: verticalScale(40),
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeCalBtnText: {
    color: '#718096',
    fontSize: responsiveFontSize(13.5),
    fontWeight: '700',
  },
  disabledInput: {
    backgroundColor: '#EDF2F7',
    justifyContent: 'center',
  },
  disabledInputText: {
    color: '#718096',
    fontWeight: '700',
    fontSize: responsiveFontSize(14.5),
  },
  pastDayCell: {
    backgroundColor: '#F7F9FC',
  },
  pastDayCellText: {
    color: '#CBD5E0',
    textDecorationLine: 'line-through',
  },
});
