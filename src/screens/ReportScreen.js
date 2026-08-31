import React, { useState, useEffect, useCallback} from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ActivityIndicator,
  SafeAreaView,
  ScrollView,
  Alert,
  RefreshControl,
  Modal,
  Pressable,
  Platform,
} from 'react-native';
import ReactNativeBlobUtil from 'react-native-blob-util';
import { scale, verticalScale, responsiveFontSize, maxContainerWidth } from '../utils/responsive';

export default function ReportScreen({ token, apiUrl }) {
  const [loading, setLoading] = useState(true);

  // Month & Year Selector states (Defaults to previous month)
  const today = new Date();
  const prevMonthDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const [selectedMonth, setSelectedMonth] = useState(prevMonthDate.getMonth() + 1); // 1-12
  const [selectedYear, setSelectedYear] = useState(prevMonthDate.getFullYear());

  // Dropdown visibility states
  // '' | 'month' | 'year' — only one list is ever open.
  const [picker, setPicker] = useState('');

  // Incentive and per-category performance for the chosen month.
  const [categoryData, setCategoryData] = useState(null);
  const [categoryError, setCategoryError] = useState('');
  const [loadingCategories, setLoadingCategories] = useState(true);
  const [openCategory, setOpenCategory] = useState('');
  const [downloading, setDownloading] = useState(false);

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

  // Pull down to reload, so the screen can be refreshed in place rather than
  // by navigating away and back.
  const [refreshing, setRefreshing] = useState(false);
  const onPullRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await fetchReportData();
    } catch (e) {
      console.log('[Refresh] failed:', e.message);
    } finally {
      setRefreshing(false);
    }
  }, [fetchReportData]);

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

  /**
   * Incentive and category figures, fetched separately.
   *
   * Kept out of the main load so a month with no incentive plan still shows
   * targets and attendance rather than failing the whole screen.
   */
  const loadCategories = useCallback(async () => {
    setLoadingCategories(true);
    setCategoryError('');
    setOpenCategory('');
    const month = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}`;
    try {
      const response = await fetch(`${apiUrl}/incentive/my/categories?month=${month}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      // Read as text first: a server that does not have this endpoint answers
      // with an HTML error page, and calling .json() on that throws a parser
      // error that says nothing about what actually went wrong.
      const raw = await response.text();
      let body = null;
      try { body = raw ? JSON.parse(raw) : null; } catch { body = null; }

      if (!body) {
        throw new Error(response.status === 404
          ? 'This report is not on the server yet.'
          : `The server replied ${response.status} without any detail.`);
      }
      if (!response.ok || !body.success) {
        throw new Error(body.message || `The server refused the request (${response.status}).`);
      }

      setCategoryData(body.data);
    } catch (e) {
      // console.log, not warn: warn does not reach logcat in a release build,
      // which is how this failure stayed invisible the first time.
      console.log('[Report] category performance failed', month, String(e?.message || e));
      setCategoryData(null);
      setCategoryError(String(e?.message || e));
    } finally {
      setLoadingCategories(false);
    }
  }, [selectedMonth, selectedYear, apiUrl, token]);

  useEffect(() => { loadCategories(); }, [loadCategories]);

  const money = (value) => `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

  /**
   * Saves the Monday-to-Saturday sheet into the phone's Downloads folder.
   *
   * The file is fetched with plain fetch and written from base64 rather than
   * handed to react-native-blob-util's downloader, which miscounts bytes
   * against Content-Length on Android and reports "Download interrupted." for
   * a file that arrived perfectly well.
   */
  const downloadWeeklyReport = async (weekOf) => {
    if (downloading) return;
    setDownloading(true);
    try {
      const day = weekOf.toISOString().slice(0, 10);
      const response = await fetch(`${apiUrl}/incentive/my/weekly-report?weekOf=${day}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        // An error comes back as JSON even though a PDF was asked for.
        const detail = await response.text().catch(() => '');
        let message = `The server replied ${response.status}.`;
        try { message = JSON.parse(detail).message || message; } catch { /* not JSON; keep the status */ }
        throw new Error(message);
      }

      const blob = await response.blob();
      if (!blob.size) throw new Error('The report came back empty.');

      const dataUri = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('The report could not be read.'));
        reader.readAsDataURL(blob);
      });
      const base64 = dataUri.slice(dataUri.indexOf(',') + 1);

      const fileName = `incentive-week-${day}.pdf`;
      const path = `${ReactNativeBlobUtil.fs.dirs.DownloadDir}/${fileName}`;
      await ReactNativeBlobUtil.fs.writeFile(path, base64, 'base64');

      // Registers it with Android's download manager so it shows up in the
      // Downloads app rather than only existing as a file on disk.
      if (Platform.OS === 'android') {
        await ReactNativeBlobUtil.android.addCompleteDownload({
          title: fileName,
          description: 'Weekly incentive report',
          mime: 'application/pdf',
          path,
          showNotification: true,
        }).catch(() => null);
      }

      Alert.alert(
        'Saved',
        `${fileName} is in your Downloads.`,
        [
          { text: 'Open', onPress: () => ReactNativeBlobUtil.android.actionViewIntent(path, 'application/pdf').catch(() => null) },
          { text: 'Done', style: 'cancel' },
        ],
      );
    } catch (e) {
      console.log('[Report] weekly report failed', String(e?.message || e));
      Alert.alert('Not saved', String(e?.message || e));
    } finally {
      setDownloading(false);
    }
  };

  /** Any day inside this week, and inside the one before it. */
  const thisWeekDay = new Date();
  const lastWeekDay = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const openCategoryRow = (categoryData?.categories || []).find((row) => row.category === openCategory) || null;

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

      {/*
        * Selectors Bar
        *
        * The month list opens in a modal rather than as an absolutely
        * positioned panel below the button. Hanging out of the bar it drew
        * fine, but Android delivers no touch events to the part of a child
        * that falls outside its parent's bounds — so all twelve months were
        * visible while the list could neither be scrolled nor, below the first
        * row or two, tapped at all.
        */}
      <View style={styles.selectorsBar}>
        <TouchableOpacity style={[styles.selectorBtn, styles.selectorGrow]} onPress={() => setPicker('month')}>
          <Text style={styles.selectorBtnText}>
            {selectedMonthObj ? selectedMonthObj.label : 'Select Month'} ▼
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.selectorBtn, styles.selectorGrow]} onPress={() => setPicker('year')}>
          <Text style={styles.selectorBtnText}>{selectedYear} ▼</Text>
        </TouchableOpacity>
      </View>

      <Modal visible={!!picker} transparent animationType="fade" onRequestClose={() => setPicker('')}>
        <Pressable style={styles.pickerBackdrop} onPress={() => setPicker('')}>
          {/* Swallows taps inside the sheet, which would otherwise close it. */}
          <Pressable style={styles.pickerSheet} onPress={() => {}}>
            <Text style={styles.pickerTitle}>{picker === 'year' ? 'Choose a year' : 'Choose a month'}</Text>
            <ScrollView style={styles.pickerScroll} showsVerticalScrollIndicator>
              {(picker === 'year' ? years : months).map((option) => {
                const active = picker === 'year' ? selectedYear === option.value : selectedMonth === option.value;
                return (
                  <TouchableOpacity
                    key={option.value}
                    style={[styles.pickerRow, active && styles.pickerRowActive]}
                    onPress={() => {
                      if (picker === 'year') setSelectedYear(option.value);
                      else setSelectedMonth(option.value);
                      setPicker('');
                    }}
                  >
                    <Text style={[styles.optionText, active && styles.activeOptionText]}>{option.label}</Text>
                    {active && <Text style={styles.pickerTick}>✓</Text>}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {loading ? (
        <View style={styles.loadingWrapper}>
          <ActivityIndicator size="large" color="#00796B" />
          <Text style={styles.loadingText}>Analyzing performance metrics...</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scrollContainer}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onPullRefresh} colors={['#00796B']} tintColor="#00796B" />
        }
      >
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

          {/* Incentive Summary */}
          <View style={styles.reportCard}>
            <Text style={styles.cardHeaderTitle}>Incentive Summary</Text>

            <View style={styles.incentiveTotalRow}>
              <View>
                <Text style={styles.valueLabel}>Total incentive this month</Text>
                <Text style={styles.incentiveTotal}>{money(categoryData?.totalIncentive)}</Text>
              </View>
              {categoryData?.planName ? (
                <View style={styles.planPill}>
                  <Text style={styles.planPillText} numberOfLines={1}>{categoryData.planName}</Text>
                </View>
              ) : null}
            </View>

            {loadingCategories ? (
              <ActivityIndicator color="#00796B" style={{ marginVertical: verticalScale(16) }} />
            ) : !categoryData ? (
              <View>
                <Text style={styles.attendanceNoteText}>
                  {categoryError || 'Could not load your incentive for this month.'}
                </Text>
                <TouchableOpacity style={styles.retryBtn} onPress={loadCategories}>
                  <Text style={styles.retryBtnText}>Try again</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                <Text style={styles.sectionLabel}>Your Performance</Text>
                <Text style={styles.sectionHint}>Tap a category to see how it is doing.</Text>

                {/*
                  * One category open at a time.
                  *
                  * Six shelves each showing five figures at once is a table
                  * nobody reads standing in a shop; opened one at a time it is
                  * a question and an answer.
                  */}
                {(categoryData.categories || []).length === 0 ? (
                  <Text style={styles.attendanceNoteText}>No product categories are set up yet.</Text>
                ) : (
                  <View style={styles.categoryChipWrap}>
                    {categoryData.categories.map((row) => {
                      const active = openCategory === row.category;
                      return (
                        <TouchableOpacity
                          key={row.category}
                          style={[styles.catChip, active && styles.catChipActive]}
                          onPress={() => setOpenCategory(active ? '' : row.category)}
                        >
                          <Text style={[styles.catChipText, active && styles.catChipTextActive]}>
                            {row.category}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}

                {openCategoryRow && (
                  <View style={styles.catDetail}>
                    <Text style={styles.catDetailTitle}>{openCategoryRow.category}</Text>

                    <View style={styles.catRow}>
                      <Text style={styles.catRowLabel}>Last month sale</Text>
                      <Text style={styles.catRowValue}>{money(openCategoryRow.lastMonthSale)}</Text>
                    </View>
                    <View style={styles.catRow}>
                      <Text style={styles.catRowLabel}>This month sale</Text>
                      <Text style={[styles.catRowValue, styles.catRowStrong]}>{money(openCategoryRow.thisMonthSale)}</Text>
                    </View>
                    <View style={styles.catRow}>
                      <Text style={styles.catRowLabel}>Target</Text>
                      <Text style={styles.catRowValue}>
                        {openCategoryRow.target > 0 ? money(openCategoryRow.target) : 'Not set'}
                      </Text>
                    </View>
                    <View style={styles.catRow}>
                      <Text style={styles.catRowLabel}>Shortfall</Text>
                      <Text style={[
                        styles.catRowValue,
                        openCategoryRow.shortfall === 0 && styles.catRowGood,
                        openCategoryRow.shortfall > 0 && styles.catRowBad,
                      ]}>
                        {openCategoryRow.shortfall === null
                          ? 'No target set'
                          : openCategoryRow.shortfall === 0
                            ? 'Target met'
                            : money(openCategoryRow.shortfall)}
                      </Text>
                    </View>
                    <View style={styles.catRow}>
                      <Text style={styles.catRowLabel}>Incentive on {openCategoryRow.category}</Text>
                      <Text style={[styles.catRowValue, styles.catRowIncentive]}>
                        {money(openCategoryRow.incentive)}
                      </Text>
                    </View>

                    {categoryData.incentiveNote ? (
                      <Text style={styles.attendanceNoteText}>{categoryData.incentiveNote}</Text>
                    ) : null}
                  </View>
                )}
              </>
            )}

            {/*
              * The week as a sheet he can keep.
              *
              * Monday to Saturday, because Sunday is not a working day here —
              * the same week the attendance percentage already counts.
              */}
            <Text style={styles.sectionLabel}>Weekly report</Text>
            <Text style={styles.sectionHint}>Monday to Saturday, saved to your Downloads.</Text>
            <View style={styles.weekBtnRow}>
              <TouchableOpacity
                style={[styles.weekBtn, downloading && styles.weekBtnBusy]}
                disabled={downloading}
                onPress={() => downloadWeeklyReport(thisWeekDay)}
              >
                {downloading
                  ? <ActivityIndicator color="#FFFFFF" size="small" />
                  : <Text style={styles.weekBtnText}>⬇  This week</Text>}
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.weekBtn, styles.weekBtnGhost, downloading && styles.weekBtnBusy]}
                disabled={downloading}
                onPress={() => downloadWeeklyReport(lastWeekDay)}
              >
                <Text style={[styles.weekBtnText, styles.weekBtnGhostText]}>⬇  Last week</Text>
              </TouchableOpacity>
            </View>
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
  selectorGrow: { flex: 1 },

  incentiveTotalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: scale(10),
    marginBottom: verticalScale(4),
  },
  incentiveTotal: {
    fontSize: responsiveFontSize(24),
    fontWeight: '900',
    color: '#00796B',
    marginTop: verticalScale(2),
  },
  planPill: {
    maxWidth: '46%',
    backgroundColor: '#E0F2F1',
    borderRadius: 999,
    paddingHorizontal: scale(10),
    paddingVertical: verticalScale(5),
  },
  planPillText: { fontSize: responsiveFontSize(10.5), fontWeight: '800', color: '#00796B' },

  weekBtnRow: { flexDirection: 'row', gap: scale(10), marginTop: verticalScale(4) },
  weekBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: verticalScale(12),
    borderRadius: 10,
    backgroundColor: '#00796B',
  },
  weekBtnGhost: { backgroundColor: '#E0F2F1' },
  weekBtnBusy: { opacity: 0.6 },
  weekBtnText: { color: '#FFFFFF', fontWeight: '800', fontSize: responsiveFontSize(12.5) },
  weekBtnGhostText: { color: '#00796B' },
  retryBtn: {
    alignSelf: 'flex-start',
    marginTop: verticalScale(10),
    paddingHorizontal: scale(16),
    paddingVertical: verticalScale(8),
    borderRadius: 8,
    backgroundColor: '#E0F2F1',
  },
  retryBtnText: { color: '#00796B', fontWeight: '800', fontSize: responsiveFontSize(12) },
  sectionLabel: {
    fontSize: responsiveFontSize(11),
    fontWeight: '900',
    color: '#64748B',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: verticalScale(18),
  },
  sectionHint: {
    fontSize: responsiveFontSize(11),
    color: '#94A3B8',
    marginTop: 2,
    marginBottom: verticalScale(10),
  },

  categoryChipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: scale(8) },
  catChip: {
    paddingHorizontal: scale(13),
    paddingVertical: verticalScale(8),
    borderRadius: 999,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  catChipActive: { backgroundColor: '#00796B', borderColor: '#00796B' },
  catChipText: { fontSize: responsiveFontSize(12), fontWeight: '700', color: '#475569' },
  catChipTextActive: { color: '#FFFFFF' },

  catDetail: {
    marginTop: verticalScale(14),
    padding: scale(14),
    borderRadius: 12,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  catDetailTitle: {
    fontSize: responsiveFontSize(14),
    fontWeight: '900',
    color: '#0F172A',
    marginBottom: verticalScale(10),
  },
  catRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: verticalScale(9),
    borderBottomWidth: 1,
    borderBottomColor: '#EEF2F7',
    gap: scale(10),
  },
  catRowLabel: { fontSize: responsiveFontSize(12), color: '#64748B', flex: 1 },
  catRowValue: { fontSize: responsiveFontSize(13), fontWeight: '700', color: '#334155' },
  catRowStrong: { color: '#0F172A', fontWeight: '900' },
  catRowGood: { color: '#059669' },
  catRowBad: { color: '#DC2626' },
  catRowIncentive: { color: '#00796B', fontWeight: '900' },
  pickerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    justifyContent: 'center',
    padding: scale(28),
  },
  pickerSheet: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingVertical: verticalScale(10),
    // Room for twelve months without filling the screen, and short enough
    // that it is obviously a list that scrolls.
    maxHeight: '70%',
  },
  pickerTitle: {
    fontSize: responsiveFontSize(12),
    fontWeight: '800',
    color: '#64748B',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    paddingHorizontal: scale(16),
    paddingBottom: verticalScale(8),
  },
  pickerScroll: { flexGrow: 0 },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: verticalScale(13),
    paddingHorizontal: scale(16),
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  pickerRowActive: { backgroundColor: '#E0F2F1' },
  pickerTick: { color: '#00796B', fontWeight: '900', fontSize: responsiveFontSize(14) },
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
