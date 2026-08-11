import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ActivityIndicator,
  SafeAreaView,
  ScrollView,
  Alert,
} from 'react-native';
import { scale, verticalScale, responsiveFontSize, maxContainerWidth } from '../utils/responsive';

export default function ReportScreen({ token, apiUrl }) {
  const [loading, setLoading] = useState(true);

  // Month & Year Selector states (Defaults to previous month)
  const today = new Date();
  const prevMonthDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const [selectedMonth, setSelectedMonth] = useState(prevMonthDate.getMonth() + 1); // 1-12
  const [selectedYear, setSelectedYear] = useState(prevMonthDate.getFullYear());

  // Dropdown visibility states
  const [showMonthDropdown, setShowMonthDropdown] = useState(false);
  const [showYearDropdown, setShowYearDropdown] = useState(false);

  // Target details state
  const [targetAmount, setTargetAmount] = useState(0);
  const [achievedAmount, setAchievedAmount] = useState(0);
  const [pipelineAmount, setPipelineAmount] = useState(0);
  const [targetQty, setTargetQty] = useState(0);
  const [achievedQty, setAchievedQty] = useState(0);
  const [targetPercentage, setTargetPercentage] = useState(0);

  // Attendance stats state
  const [presentDays, setPresentDays] = useState(0);
  const [workingDays, setWorkingDays] = useState(0);
  const [attendancePercentage, setAttendancePercentage] = useState(0);
  const [totalDaysInMonth, setTotalDaysInMonth] = useState(0);

  const months = [
    { label: 'January', value: 1 },
    { label: 'February', value: 2 },
    { label: 'March', value: 3 },
    { label: 'April', value: 4 },
    { label: 'May', value: 5 },
    { label: 'June', value: 6 },
    { label: 'July', value: 7 },
    { label: 'August', value: 8 },
    { label: 'September', value: 9 },
    { label: 'October', value: 10 },
    { label: 'November', value: 11 },
    { label: 'December', value: 12 },
  ];

  const years = [
    { label: `${today.getFullYear()}`, value: today.getFullYear() },
    { label: `${today.getFullYear() - 1}`, value: today.getFullYear() - 1 },
  ];

  const fetchReportData = async () => {
    setLoading(true);
    try {
      // 1. Fetch Monthly Target details
      const targetRes = await fetch(`${apiUrl}/target/my?month=${selectedMonth}&year=${selectedYear}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const targetData = await targetRes.json();

      if (targetRes.ok && targetData.success && targetData.data) {
        const tgt = targetData.data.target || {};
        setTargetAmount(tgt.targetAmount || 0);
        setAchievedAmount(tgt.achievedAmount || 0);
        setPipelineAmount(tgt.pipelineAmount || 0);
        setTargetQty(tgt.targetQty || 0);
        setAchievedQty(tgt.achievedQty || 0);
        setTargetPercentage(targetData.data.achievementPercentage || 0);
      } else {
        setTargetAmount(0);
        setAchievedAmount(0);
        setPipelineAmount(0);
        setTargetQty(0);
        setAchievedQty(0);
        setTargetPercentage(0);
      }

      // 2. Fetch Attendance history (limit=100 to cover previous month history)
      const attendanceRes = await fetch(`${apiUrl}/attendance/my?limit=100`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const attendanceData = await attendanceRes.json();

      if (attendanceRes.ok && attendanceData.success && Array.isArray(attendanceData.data)) {
        // Filter attendance records matching selected month & year
        const matchedRecords = attendanceData.data.filter((record) => {
          const recordDate = new Date(record.date);
          return (
            recordDate.getMonth() + 1 === selectedMonth &&
            recordDate.getFullYear() === selectedYear
          );
        });

        const totalDays = new Date(selectedYear, selectedMonth, 0).getDate();
        setTotalDaysInMonth(totalDays);

        // Calculate sundays (weekly offs) to find standard working days
        let sundays = 0;
        for (let day = 1; day <= totalDays; day++) {
          const date = new Date(selectedYear, selectedMonth - 1, day);
          if (date.getDay() === 0) sundays++; // 0 is Sunday
        }

        const workDays = totalDays - sundays;
        setWorkingDays(workDays);

        const present = matchedRecords.length;
        setPresentDays(present);

        const attendancePct = workDays > 0 ? Math.min(100, Math.round((present / workDays) * 100)) : 0;
        setAttendancePercentage(attendancePct);
      } else {
        setPresentDays(0);
        setWorkingDays(26);
        setAttendancePercentage(0);
      }
    } catch (e) {
      console.warn('Failed to load report stats:', e.message);
      Alert.alert('Error', 'Failed to fetch report summary.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReportData();
  }, [selectedMonth, selectedYear]);

  // Performance Rating Logic
  const getPerformanceRating = () => {
    if (targetPercentage >= 95 && attendancePercentage >= 90) {
      return { rating: '🏆 Outstanding', color: '#319795', desc: 'Exceeded target expectations with highly consistent attendance.' };
    } else if (targetPercentage >= 75 && attendancePercentage >= 80) {
      return { rating: '✨ Good Perform', color: '#00796B', desc: 'Strong target achievement and solid attendance logs.' };
    } else if (targetPercentage >= 50 && attendancePercentage >= 70) {
      return { rating: '📈 Average Performance', color: '#D69E2E', desc: 'Achieved partial sales targets, needs attendance optimization.' };
    } else {
      return { rating: '⚠️ Needs Support', color: '#E53E3E', desc: 'Under-targeted monthly sales. Recommended check-in coaching.' };
    }
  };

  const performance = getPerformanceRating();
  const selectedMonthObj = months.find((m) => m.value === selectedMonth);

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Top Header */}
      <View style={styles.topHeader}>
        <Text style={styles.topHeaderTitle}>Performance Report</Text>
      </View>

      {/* Selectors Bar */}
      <View style={styles.selectorsBar}>
        {/* Month Selector dropdown toggle */}
        <View style={styles.dropdownContainer}>
          <TouchableOpacity
            style={styles.selectorBtn}
            onPress={() => {
              setShowMonthDropdown(!showMonthDropdown);
              setShowYearDropdown(false);
            }}
          >
            <Text style={styles.selectorBtnText}>
              {selectedMonthObj ? selectedMonthObj.label : 'Select Month'} ▼
            </Text>
          </TouchableOpacity>

          {showMonthDropdown && (
            <View style={styles.dropdownOptionsList}>
              <ScrollView nestedScrollEnabled style={{ maxHeight: 200 }}>
                {months.map((m) => (
                  <TouchableOpacity
                    key={m.value}
                    style={styles.dropdownOptionItem}
                    onPress={() => {
                      setSelectedMonth(m.value);
                      setShowMonthDropdown(false);
                    }}
                  >
                    <Text style={[styles.optionText, selectedMonth === m.value && styles.activeOptionText]}>
                      {m.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}
        </View>

        {/* Year Selector dropdown toggle */}
        <View style={styles.dropdownContainer}>
          <TouchableOpacity
            style={styles.selectorBtn}
            onPress={() => {
              setShowYearDropdown(!showYearDropdown);
              setShowMonthDropdown(false);
            }}
          >
            <Text style={styles.selectorBtnText}>{selectedYear} ▼</Text>
          </TouchableOpacity>

          {showYearDropdown && (
            <View style={styles.dropdownOptionsList}>
              {years.map((y) => (
                <TouchableOpacity
                  key={y.value}
                  style={styles.dropdownOptionItem}
                  onPress={() => {
                    setSelectedYear(y.value);
                    setShowYearDropdown(false);
                  }}
                >
                  <Text style={[styles.optionText, selectedYear === y.value && styles.activeOptionText]}>
                    {y.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      </View>

      {loading ? (
        <View style={styles.loadingWrapper}>
          <ActivityIndicator size="large" color="#00796B" />
          <Text style={styles.loadingText}>Analyzing performance metrics...</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scrollContainer}>
          {/* Performance Grading Card */}
          <View style={[styles.reportCard, styles.gradeCard, { borderColor: performance.color }]}>
            <Text style={styles.cardHeaderTitle}>Performance Overview</Text>
            <View style={[styles.gradeBadge, { backgroundColor: performance.color + '15' }]}>
              <Text style={[styles.gradeText, { color: performance.color }]}>
                {performance.rating}
              </Text>
            </View>
            <Text style={styles.gradeDesc}>{performance.desc}</Text>
          </View>

          {/* Sales Target Card */}
          <View style={styles.reportCard}>
            <Text style={styles.cardHeaderTitle}>Sales Target Achievement</Text>
            
            <View style={styles.targetValuesRow}>
              <View>
                <Text style={styles.valueLabel}>Monthly Target</Text>
                <Text style={styles.valueNumber}>₹{targetAmount.toLocaleString('en-IN')}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.valueLabel}>Net Achieved</Text>
                <Text style={[styles.valueNumber, { color: '#38A169' }]}>
                  ₹{achievedAmount.toLocaleString('en-IN')}
                </Text>
              </View>
            </View>

            {/* Progress Bar */}
            <View style={styles.progressContainer}>
              <View style={styles.progressBarBg}>
                <View
                  style={[
                    styles.progressBarFill,
                    { width: `${Math.min(100, targetPercentage)}%`, backgroundColor: '#38A169' },
                  ]}
                />
              </View>
              <View style={styles.progressDetailsRow}>
                <Text style={styles.progressPctText}>{targetPercentage}% Completed</Text>
                {pipelineAmount > 0 && (
                  <Text style={styles.pipelineText}>
                    ₹{pipelineAmount.toLocaleString('en-IN')} Pipeline
                  </Text>
                )}
              </View>
            </View>

            {/* Sub Targets Qty */}
            <View style={styles.qtyStatsDivider} />
            <View style={styles.targetValuesRow}>
              <View>
                <Text style={styles.valueLabel}>Quantity Target</Text>
                <Text style={styles.subValueNumber}>{targetQty} Unit(s)</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.valueLabel}>Achieved Qty</Text>
                <Text style={styles.subValueNumber}>{achievedQty} Unit(s)</Text>
              </View>
            </View>
          </View>

          {/* Attendance Report Card */}
          <View style={styles.reportCard}>
            <Text style={styles.cardHeaderTitle}>Attendance Summary</Text>

            <View style={styles.targetValuesRow}>
              <View>
                <Text style={styles.valueLabel}>Working Days</Text>
                <Text style={styles.valueNumber}>{workingDays} Days</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.valueLabel}>Present Days</Text>
                <Text style={[styles.valueNumber, { color: '#319795' }]}>{presentDays} Days</Text>
              </View>
            </View>

            {/* Progress Bar */}
            <View style={styles.progressContainer}>
              <View style={styles.progressBarBg}>
                <View
                  style={[
                    styles.progressBarFill,
                    { width: `${Math.min(100, attendancePercentage)}%`, backgroundColor: '#319795' },
                  ]}
                />
              </View>
              <View style={styles.progressDetailsRow}>
                <Text style={styles.progressPctText}>{attendancePercentage}% Attendance</Text>
                <Text style={styles.pipelineText}>
                  {workingDays - presentDays} Absent / Leaves
                </Text>
              </View>
            </View>
            
            <Text style={styles.attendanceNoteText}>
              Note: Attendance percentages are computed out of monthly days excluding Sundays.
            </Text>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F7F9FC',
  },
  topHeader: {
    height: verticalScale(56),
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  topHeaderTitle: {
    fontSize: responsiveFontSize(17),
    fontWeight: '800',
    color: '#1A202C',
  },

  // Selector Bar Dropdowns
  selectorsBar: {
    flexDirection: 'row',
    padding: scale(12),
    gap: verticalScale(12),
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    zIndex: 10,
  },
  dropdownContainer: {
    flex: 1,
    position: 'relative',
  },
  selectorBtn: {
    height: verticalScale(38),
    borderWidth: 1,
    borderColor: '#CBD5E0',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F7F9FC',
  },
  selectorBtnText: {
    fontSize: responsiveFontSize(13),
    fontWeight: '700',
    color: '#4A5568',
  },
  dropdownOptionsList: {
    position: 'absolute',
    top: 42,
    left: 0,
    right: 0,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 4,
    zIndex: 100,
    overflow: 'hidden',
  },
  dropdownOptionItem: {
    paddingVertical: verticalScale(10),
    paddingHorizontal: scale(12),
    borderBottomWidth: 1,
    borderBottomColor: '#F7F9FC',
  },
  optionText: {
    fontSize: responsiveFontSize(13.5),
    color: '#4A5568',
    fontWeight: '600',
  },
  activeOptionText: {
    color: '#00796B',
    fontWeight: '800',
  },

  // Main Scrollable Area
  scrollContainer: {
    padding: scale(16),
    gap: verticalScale(16),
    paddingBottom: verticalScale(40),
  },

  // Report Cards
  reportCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: scale(18),
    shadowColor: '#1A202C',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.02,
    shadowRadius: 6,
    elevation: 1,
  },
  gradeCard: {
    borderLeftWidth: 6,
  },
  cardHeaderTitle: {
    fontSize: responsiveFontSize(13),
    fontWeight: '800',
    color: '#718096',
    textTransform: 'uppercase',
    marginBottom: verticalScale(12),
    letterSpacing: 0.5,
  },
  gradeBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: scale(12),
    paddingVertical: verticalScale(6),
    borderRadius: 12,
    marginBottom: verticalScale(8),
  },
  gradeText: {
    fontSize: responsiveFontSize(14),
    fontWeight: '800',
  },
  gradeDesc: {
    fontSize: responsiveFontSize(12.5),
    color: '#4A5568',
    lineHeight: 18,
    fontWeight: '600',
  },

  // Target Achievements values
  targetValuesRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: verticalScale(12),
  },
  valueLabel: {
    fontSize: responsiveFontSize(11),
    color: '#A0AEC0',
    fontWeight: '700',
    marginBottom: verticalScale(3),
  },
  valueNumber: {
    fontSize: responsiveFontSize(18),
    fontWeight: '800',
    color: '#2D3748',
  },
  subValueNumber: {
    fontSize: responsiveFontSize(14),
    fontWeight: '750',
    color: '#4A5568',
  },

  // Progress Bar
  progressContainer: {
    marginBottom: verticalScale(4),
  },
  progressBarBg: {
    height: verticalScale(10),
    backgroundColor: '#EDF2F7',
    borderRadius: 5,
    overflow: 'hidden',
    marginBottom: verticalScale(6),
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 5,
  },
  progressDetailsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  progressPctText: {
    fontSize: responsiveFontSize(12),
    fontWeight: '800',
    color: '#2D3748',
  },
  pipelineText: {
    fontSize: responsiveFontSize(11.5),
    fontWeight: '700',
    color: '#A0AEC0',
  },
  qtyStatsDivider: {
    height: 1,
    backgroundColor: '#EDF2F7',
    marginVertical: verticalScale(12),
  },
  attendanceNoteText: {
    fontSize: responsiveFontSize(11),
    color: '#A0AEC0',
    lineHeight: 15,
    fontWeight: '550',
    marginTop: verticalScale(10),
  },

  // Loading indicator states
  loadingWrapper: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: verticalScale(12),
  },
  loadingText: {
    fontSize: responsiveFontSize(13.5),
    color: '#718096',
    fontWeight: '650',
  },
});
