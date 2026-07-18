import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ActivityIndicator,
  SafeAreaView,
  ScrollView,
  TextInput,
  RefreshControl,
  Alert,
} from 'react-native';
import PartyProfileScreen from './PartyProfileScreen';

export default function OutstandingListScreen({ token, apiUrl, onBack, onNavigateToOrder }) {
  const [parties, setParties] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Selected party for profile view
  const [selectedPartyId, setSelectedPartyId] = useState(null);

  const fetchOutstandingParties = async () => {
    if (!token) return;
    try {
      const response = await fetch(`${apiUrl}/parties/my`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (response.ok && data.success) {
        // Filter parties where currentOutstanding > 0 and sort descending
        const outstandingList = (data.data || [])
          .filter((p) => (p.currentOutstanding || 0) > 0)
          .sort((a, b) => b.currentOutstanding - a.currentOutstanding);
        setParties(outstandingList);
      } else {
        setParties([]);
      }
    } catch (e) {
      console.warn('Failed to load outstanding parties:', e.message);
      setParties([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchOutstandingParties();
  }, [token, apiUrl]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchOutstandingParties();
  };

  // Filter parties based on search query
  const filteredParties = parties.filter((p) => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return true;
    return (
      (p.partyName || '').toLowerCase().includes(q) ||
      (p.ownerName || '').toLowerCase().includes(q) ||
      (p.partyCode || '').toLowerCase().includes(q)
    );
  });

  const formatCurrency = (amount) => {
    return '₹' + Number(amount).toLocaleString('en-IN');
  };

  if (selectedPartyId) {
    return (
      <PartyProfileScreen
        token={token}
        apiUrl={apiUrl}
        partyId={selectedPartyId}
        onBack={() => {
          setSelectedPartyId(null);
          fetchOutstandingParties(); // reload list
        }}
        onNavigateToOrder={onNavigateToOrder}
      />
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Top Header */}
      <View style={styles.topHeader}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Text style={styles.backBtnText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.topHeaderTitle}>Pending Outstandings</Text>
        <View style={{ width: 36 }} />
      </View>

      {/* Search Row */}
      <View style={styles.searchRow}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search by party or owner name..."
          placeholderTextColor="#A0AEC0"
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#00796B" />
          <Text style={styles.loadingText}>Fetching pending accounts...</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#00796B']} />
          }
        >
          {filteredParties.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyIcon}>💳</Text>
              <Text style={styles.emptyTitle}>All Caught Up!</Text>
              <Text style={styles.emptyDesc}>
                {searchQuery
                  ? "No outstanding accounts match your search."
                  : 'No pending outstanding balances found for your assigned parties.'}
              </Text>
            </View>
          ) : (
            <View style={styles.listContainer}>
              {filteredParties.map((party) => (
                <TouchableOpacity
                  key={party._id}
                  style={styles.partyCard}
                  activeOpacity={0.8}
                  onPress={() => setSelectedPartyId(party._id)}
                >
                  <View style={styles.cardHeader}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.partyName}>{party.partyName}</Text>
                      <Text style={styles.partyCode}>{party.partyCode}</Text>
                    </View>
                    <Text style={styles.outstandingVal}>
                      {formatCurrency(party.currentOutstanding)}
                    </Text>
                  </View>

                  <View style={styles.divider} />

                  <View style={styles.detailsRow}>
                    <View style={styles.detailBlock}>
                      <Text style={styles.detailLabel}>Owner Name</Text>
                      <Text style={styles.detailVal}>{party.ownerName || '—'}</Text>
                    </View>
                    <View style={styles.detailBlock}>
                      <Text style={styles.detailLabel}>Credit Limit</Text>
                      <Text style={styles.detailVal}>
                        {party.creditLimit ? formatCurrency(party.creditLimit) : '—'}
                      </Text>
                    </View>
                    <View style={styles.detailBlock}>
                      <Text style={styles.detailLabel}>Mobile</Text>
                      <Text style={styles.detailVal}>{party.mobile}</Text>
                    </View>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          )}
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
    height: 56,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F7F9FC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backBtnText: {
    fontSize: 20,
    color: '#2D3748',
    fontWeight: '600',
  },
  topHeaderTitle: {
    fontSize: 16.5,
    fontWeight: '800',
    color: '#1A202C',
  },

  // Search
  searchRow: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  searchInput: {
    height: 40,
    backgroundColor: '#F7F9FC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    paddingHorizontal: 12,
    color: '#2D3748',
    fontSize: 13.5,
  },

  // Content
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  loadingText: {
    fontSize: 13.5,
    color: '#718096',
    fontWeight: '650',
  },

  // Empty state
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 80,
    paddingHorizontal: 20,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 16,
    opacity: 0.7,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#2D3748',
    marginBottom: 6,
  },
  emptyDesc: {
    fontSize: 13,
    color: '#718096',
    textAlign: 'center',
    lineHeight: 18,
  },

  // Cards
  listContainer: {
    gap: 12,
  },
  partyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.02,
    shadowRadius: 6,
    elevation: 1,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  partyName: {
    fontSize: 14.5,
    fontWeight: '800',
    color: '#2D3748',
  },
  partyCode: {
    fontSize: 11,
    color: '#A0AEC0',
    fontWeight: '600',
    marginTop: 2,
  },
  outstandingVal: {
    fontSize: 17,
    fontWeight: '850',
    color: '#E53E3E',
  },
  divider: {
    height: 1,
    backgroundColor: '#EDF2F7',
    marginVertical: 12,
  },
  detailsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
  },
  detailBlock: {
    flex: 1,
  },
  detailLabel: {
    fontSize: 9.5,
    color: '#A0AEC0',
    fontWeight: '700',
    textTransform: 'uppercase',
    marginBottom: 3,
  },
  detailVal: {
    fontSize: 12.5,
    fontWeight: '750',
    color: '#4A5568',
  },
});
