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
} from 'react-native';
import { scale, verticalScale, responsiveFontSize, maxContainerWidth } from '../utils/responsive';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

export default function ProfileScreen({ user, token, apiUrl, onLogout }) {
  const [payrolls, setPayrolls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedSlip, setSelectedSlip] = useState(null);
  const [slipModalVisible, setSlipModalVisible] = useState(false);

  // Get initials for profile avatar
  const initials = user.name
    ? user.name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .substring(0, 2)
        .toUpperCase()
    : 'EE';

  const loadPayrolls = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`${apiUrl}/payroll/my`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await response.json();
      if (response.ok) {
        setPayrolls(data.data || []);
      } else {
        throw new Error(data.message || 'Failed to load salary slips');
      }
    } catch (err) {
      console.warn('Payroll fetch error:', err.message);
      setError('Could not retrieve payslip data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (token && apiUrl) {
      loadPayrolls();
    }
  }, [token, apiUrl]);

  const formatMonthLabel = (monthStr) => {
    if (!monthStr) return '';
    const parts = monthStr.split('-');
    if (parts.length === 2) {
      const year = parts[0];
      const mIdx = parseInt(parts[1], 10) - 1;
      if (mIdx >= 0 && mIdx < 12) {
        return `${MONTH_NAMES[mIdx]} ${year}`;
      }
    }
    return monthStr;
  };

  const formatCurrency = (val) => {
    return (val || 0).toLocaleString('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    });
  };

  const openSlipDetails = (slip) => {
    setSelectedSlip(slip);
    setSlipModalVisible(true);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        {/* Profile Info Header */}
        <View style={styles.profileHeader}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <Text style={styles.profileName}>{user.name}</Text>
          <Text style={styles.profileRole}>
            {user.roleDisplayName || user.role?.displayName || user.roleName || 'Employee'}
          </Text>
        </View>

        {/* Account Details Card */}
        <View style={styles.detailsCard}>
          <Text style={styles.cardTitle}>Account Details</Text>
          
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Mobile Number</Text>
            <Text style={styles.detailValue}>{user.mobile}</Text>
          </View>
          
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Email Address</Text>
            <Text style={styles.detailValue}>{user.email || 'Not Configured'}</Text>
          </View>

          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Base Salary Plan</Text>
            <Text style={styles.detailValue}>{formatCurrency(user.salary)}</Text>
          </View>

          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Reports To</Text>
            <Text style={styles.detailValue}>{user.reportsTo?.name || 'Top Manager'}</Text>
          </View>
        </View>

        {/* Salary Slips / Payroll History Card */}
        <View style={styles.detailsCard}>
          <Text style={styles.cardTitle}>Salary Slips & Payroll</Text>
          
          {loading ? (
            <ActivityIndicator color="#00796B" style={{ marginVertical: 20 }} />
          ) : error ? (
            <Text style={styles.errorText}>{error}</Text>
          ) : payrolls.length === 0 ? (
            <Text style={styles.emptyText}>No processed salary slips found.</Text>
          ) : (
            <View style={styles.payrollsList}>
              {payrolls.map((item) => (
                <TouchableOpacity
                  key={item._id}
                  style={styles.payrollItem}
                  onPress={() => openSlipDetails(item)}
                >
                  <View>
                    <Text style={styles.payrollMonth}>{formatMonthLabel(item.month)}</Text>
                    <Text style={styles.payrollNet}>{formatCurrency(item.netSalary)} Net Paid</Text>
                  </View>

                  <View style={[
                    styles.statusPill,
                    item.status === 'paid' ? styles.paidPill : styles.pendingPill
                  ]}>
                    <Text style={[
                      styles.statusPillText,
                      item.status === 'paid' ? styles.paidPillText : styles.pendingPillText
                    ]}>
                      {item.status}
                    </Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

        {onLogout ? (
          <View style={styles.actionsCard}>
            <TouchableOpacity style={styles.logoutBtn} onPress={onLogout}>
              <Text style={styles.logoutBtnText}>Log Out Account</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </ScrollView>

      {/* Salary Slip Breakdown Detail Modal */}
      {selectedSlip && (
        <Modal
          visible={slipModalVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setSlipModalVisible(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.slipCard}>
              <Text style={styles.slipHeaderTitle}>Salary Slip</Text>
              <Text style={styles.slipMonthSubtitle}>{formatMonthLabel(selectedSlip.month)}</Text>

              {/* Employee brief */}
              <View style={styles.slipDivider} />
              <Text style={styles.slipMetaText}>Name: <Text style={styles.boldText}>{user.name}</Text></Text>
              <Text style={styles.slipMetaText}>Role: <Text style={styles.boldText}>{user.roleDisplayName || user.roleName}</Text></Text>
              
              {/* Working stats */}
              <View style={styles.slipDivider} />
              <View style={styles.slipRow}>
                <Text style={styles.slipLabel}>Working Days</Text>
                <Text style={styles.slipValue}>{selectedSlip.totalWorkingDays} Days</Text>
              </View>
              <View style={styles.slipRow}>
                <Text style={styles.slipLabel}>Approved Leaves</Text>
                <Text style={styles.slipValue}>{selectedSlip.totalLeaves} Days</Text>
              </View>

              {/* Salary Structure Breakdown */}
              <View style={styles.slipDivider} />
              
              <View style={styles.slipRow}>
                <Text style={styles.slipLabel}>Basic Salary</Text>
                <Text style={styles.slipValue}>{formatCurrency(selectedSlip.basicSalary)}</Text>
              </View>
              
              <View style={styles.slipRow}>
                <Text style={styles.slipLabel}>Allowances (+)</Text>
                <Text style={[styles.slipValue, styles.goodText]}>
                  {formatCurrency(selectedSlip.allowances)}
                </Text>
              </View>
              
              <View style={styles.slipRow}>
                <Text style={styles.slipLabel}>Deductions (-)</Text>
                <Text style={[styles.slipValue, styles.badText]}>
                  {formatCurrency(selectedSlip.deductions)}
                </Text>
              </View>

              <View style={styles.slipDivider} />
              
              {/* Net Payout */}
              <View style={[styles.slipRow, styles.netPayoutRow]}>
                <Text style={styles.netPayoutLabel}>Net Payout</Text>
                <Text style={styles.netPayoutValue}>{formatCurrency(selectedSlip.netSalary)}</Text>
              </View>

              <View style={styles.slipDivider} />
              
              {/* Payment Details */}
              <Text style={styles.slipMetaText}>
                Status: <Text style={[styles.boldText, selectedSlip.status === 'paid' ? styles.goodText : styles.warnText]}>
                  {selectedSlip.status.toUpperCase()}
                </Text>
              </Text>
              
              {selectedSlip.paidAt ? (
                <Text style={styles.slipMetaText}>
                  Paid Date: <Text style={styles.boldText}>{new Date(selectedSlip.paidAt).toLocaleDateString()}</Text>
                </Text>
              ) : null}

              {selectedSlip.remarks ? (
                <Text style={styles.slipRemarks}>
                  <Text style={styles.boldText}>Remarks: </Text>{selectedSlip.remarks}
                </Text>
              ) : null}

              {/* Close Button */}
              <TouchableOpacity
                style={styles.closeBtn}
                onPress={() => setSlipModalVisible(false)}
              >
                <Text style={styles.closeBtnText}>Close Details</Text>
              </TouchableOpacity>
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
  container: {
    padding: scale(20),
    paddingBottom: verticalScale(40),
  },
  profileHeader: {
    alignItems: 'center',
    marginTop: verticalScale(10),
    marginBottom: verticalScale(24),
  },
  avatar: {
    width: scale(90),
    height: verticalScale(90),
    borderRadius: 45,
    backgroundColor: '#E0F2F1',
    borderWidth: 3,
    borderColor: '#00796B',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#1A202C',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 3,
    marginBottom: verticalScale(12),
  },
  avatarText: {
    fontSize: responsiveFontSize(28),
    fontWeight: '800',
    color: '#00796B',
  },
  profileName: {
    fontSize: responsiveFontSize(22),
    fontWeight: '700',
    color: '#2D3748',
  },
  profileRole: {
    fontSize: responsiveFontSize(13),
    color: '#718096',
    marginTop: verticalScale(4),
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  detailsCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: scale(20),
    shadowColor: '#1A202C',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.03,
    shadowRadius: 10,
    elevation: 2,
    marginBottom: verticalScale(20),
  },
  cardTitle: {
    fontSize: responsiveFontSize(14),
    fontWeight: '700',
    color: '#2D3748',
    marginBottom: verticalScale(16),
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: verticalScale(12),
    borderBottomWidth: 1,
    borderBottomColor: '#EDF2F7',
  },
  detailLabel: {
    color: '#718096',
    fontSize: responsiveFontSize(13),
    fontWeight: '500',
  },
  detailValue: {
    color: '#2D3748',
    fontSize: responsiveFontSize(13.5),
    fontWeight: '600',
  },
  emptyText: {
    color: '#A0AEC0',
    fontSize: responsiveFontSize(13),
    textAlign: 'center',
    marginVertical: verticalScale(10),
  },
  errorText: {
    color: '#E53E3E',
    fontSize: responsiveFontSize(13),
    textAlign: 'center',
    marginVertical: verticalScale(10),
  },
  payrollsList: {
    gap: verticalScale(10),
  },
  payrollItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: verticalScale(12),
    borderBottomWidth: 1,
    borderBottomColor: '#EDF2F7',
  },
  payrollMonth: {
    fontSize: responsiveFontSize(14.5),
    fontWeight: '700',
    color: '#2D3748',
  },
  payrollNet: {
    fontSize: responsiveFontSize(12.5),
    color: '#718096',
    marginTop: verticalScale(2),
  },
  statusPill: {
    paddingVertical: verticalScale(4),
    paddingHorizontal: scale(10),
    borderRadius: 12,
  },
  paidPill: {
    backgroundColor: '#E0F2F1',
  },
  paidPillText: {
    color: '#00796B',
    fontSize: responsiveFontSize(11),
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  pendingPill: {
    backgroundColor: '#FEFCBF',
  },
  pendingPillText: {
    color: '#D69E2E',
    fontSize: responsiveFontSize(11),
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  actionsCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: scale(16),
    shadowColor: '#1A202C',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.03,
    shadowRadius: 10,
    elevation: 2,
  },
  logoutBtn: {
    height: verticalScale(44),
    borderRadius: 8,
    backgroundColor: '#FFF5F5',
    borderWidth: 1,
    borderColor: '#FED7D7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoutBtnText: {
    color: '#E53E3E',
    fontSize: responsiveFontSize(14),
    fontWeight: '700',
  },
  // Modal layout
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: scale(24),
  },
  slipCard: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: scale(22),
    shadowColor: '#000',
    shadowOffset: { width: 0, height: verticalScale(10) },
    shadowOpacity: 0.1,
    shadowRadius: 20,
    elevation: 10,
  },
  slipHeaderTitle: {
    fontSize: responsiveFontSize(18),
    fontWeight: '800',
    color: '#1A202C',
    textAlign: 'center',
  },
  slipMonthSubtitle: {
    fontSize: responsiveFontSize(13),
    fontWeight: '600',
    color: '#718096',
    textAlign: 'center',
    marginTop: verticalScale(4),
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  slipDivider: {
    height: 1,
    backgroundColor: '#E2E8F0',
    marginVertical: verticalScale(12),
  },
  slipMetaText: {
    fontSize: responsiveFontSize(13.5),
    color: '#4A5568',
    marginBottom: verticalScale(6),
  },
  boldText: {
    fontWeight: '700',
    color: '#2D3748',
  },
  slipRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: verticalScale(8),
  },
  slipLabel: {
    color: '#718096',
    fontSize: responsiveFontSize(13.5),
  },
  slipValue: {
    color: '#2D3748',
    fontSize: responsiveFontSize(13.5),
    fontWeight: '600',
  },
  goodText: {
    color: '#00796B',
  },
  badText: {
    color: '#E53E3E',
  },
  warnText: {
    color: '#D69E2E',
  },
  netPayoutRow: {
    paddingVertical: verticalScale(12),
    backgroundColor: '#F7F9FC',
    paddingHorizontal: scale(12),
    borderRadius: 8,
  },
  netPayoutLabel: {
    fontWeight: '800',
    color: '#1A202C',
    fontSize: responsiveFontSize(14.5),
  },
  netPayoutValue: {
    fontWeight: '800',
    color: '#00796B',
    fontSize: responsiveFontSize(16),
  },
  slipRemarks: {
    fontSize: responsiveFontSize(13),
    color: '#718096',
    backgroundColor: '#F7F9FC',
    padding: scale(10),
    borderRadius: 8,
    marginTop: verticalScale(10),
    lineHeight: 18,
  },
  closeBtn: {
    marginTop: verticalScale(20),
    height: verticalScale(44),
    backgroundColor: '#00796B',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    color: '#FFFFFF',
    fontSize: responsiveFontSize(14.5),
    fontWeight: '700',
  },
});
