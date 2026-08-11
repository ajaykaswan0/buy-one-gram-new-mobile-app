import React, { useState, useEffect, useCallback } from 'react';
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
  Alert,
  FlatList,
} from 'react-native';
import { scale, verticalScale, responsiveFontSize, maxContainerWidth } from '../utils/responsive';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Geolocation from '@react-native-community/geolocation';
import { PermissionsAndroid, Platform, BackHandler } from 'react-native';
import { launchCamera } from 'react-native-image-picker';
import PartyProfileScreen from './PartyProfileScreen';
import { uploadFile } from '../services/firebaseUploadService';

export default function VisitScreen({ token, user, apiUrl, onBack, onNavigateToOrder, onNavigateToCollection }) {
  const [partiesList, setPartiesList] = useState([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searchingLoading, setSearchingLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Search & Filters
  const [searchQuery, setSearchQuery] = useState('');
  const isSearching = searchQuery.trim().length > 0;

  // Add Party Modal states
  const [addModalVisible, setAddModalVisible] = useState(false);

  // Form states - Required
  const [newPartyName, setNewPartyName] = useState('');
  const [newPartyMobile, setNewPartyMobile] = useState('');
  const [newPartyAddress, setNewPartyAddress] = useState('');
  const [newPartyArea, setNewPartyArea] = useState('');
  const [newPartyOwnerName, setNewPartyOwnerName] = useState('');
  const [newPartyCity, setNewPartyCity] = useState('');
  const [newPartyState, setNewPartyState] = useState('');
  const [newPartyPincode, setNewPartyPincode] = useState('');
  const [newPartyPhoto, setNewPartyPhoto] = useState(''); // Base64 string

  // Form states - Optional
  const [newPartyWhatsapp, setNewPartyWhatsapp] = useState('');
  const [newPartyEmail, setNewPartyEmail] = useState('');
  const [newPartyGstNo, setNewPartyGstNo] = useState('');
  const [newPartyCreditLimit, setNewPartyCreditLimit] = useState('');
  const [newPartyPaymentTerms, setNewPartyPaymentTerms] = useState('7 Days');
  const [newPartyNotes, setNewPartyNotes] = useState('');

  // Location states
  const [fetchingLocation, setFetchingLocation] = useState(false);
  const [lat, setLat] = useState(null);
  const [lng, setLng] = useState(null);
  const [locationAccuracy, setLocationAccuracy] = useState(null);
  const [locationStatusText, setLocationStatusText] = useState('');
  const [locationWarning, setLocationWarning] = useState('');
  const [newPartyPhotoAsset, setNewPartyPhotoAsset] = useState(null);
  const [creatingPartyLoading, setCreatingPartyLoading] = useState(false);

  // Duplication & Assignment states
  const [existingPartyId, setExistingPartyId] = useState(null);
  const [assignmentSubmitting, setAssignmentSubmitting] = useState(false);
  const [visitStartingId, setVisitStartingId] = useState(null);
  const [selectedProfilePartyId, setSelectedProfilePartyId] = useState(null);

  // ── Paginated Party Fetch & Server-Side Search ──
  const fetchPartiesPage = useCallback(async (pageNum = 1, query = '') => {
    const isSearchActive = query.trim().length > 0;
    if (pageNum === 1) {
      if (isSearchActive) {
        setSearchingLoading(true);
      } else {
        setLoading(true);
      }
    } else {
      setLoadingMore(true);
    }
    setError('');

    try {
      const endpoint = isSearchActive
        ? `${apiUrl}/parties?search=${encodeURIComponent(query.trim())}&page=${pageNum}&limit=20`
        : `${apiUrl}/parties/my?page=${pageNum}&limit=20`;

      const response = await fetch(endpoint, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();

      if (response.ok) {
        const newParties = data.data || [];
        const meta = data.meta || {};

        setPartiesList(prev => pageNum === 1 ? newParties : [...prev, ...newParties]);
        setPage(pageNum);
        if (meta.totalPages) {
          setHasMore(pageNum < meta.totalPages);
        } else {
          setHasMore(newParties.length >= 20);
        }
      } else {
        throw new Error(data.message || 'Failed to load parties.');
      }
    } catch (err) {
      setError(err.message || 'Connection error.');
    } finally {
      setLoading(false);
      setLoadingMore(false);
      setSearchingLoading(false);
    }
  }, [apiUrl, token]);

  const loadMyParties = useCallback(() => {
    return fetchPartiesPage(1, searchQuery);
  }, [fetchPartiesPage, searchQuery]);

  // Initial load on mount
  useEffect(() => {
    fetchPartiesPage(1, '');
  }, [fetchPartiesPage]);

  // Debounced server-side search
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchPartiesPage(1, searchQuery);
    }, 350);
    return () => clearTimeout(timer);
  }, [searchQuery, fetchPartiesPage]);

  const handleLoadMore = () => {
    if (!loading && !loadingMore && hasMore) {
      fetchPartiesPage(page + 1, searchQuery);
    }
  };

  const handleOpenAddModal = async () => {
    // Reset required
    setNewPartyName('');
    setNewPartyMobile('');
    setNewPartyAddress('');
    setNewPartyOwnerName('');
    setNewPartyArea('');
    setNewPartyCity('');
    setNewPartyState('');
    setNewPartyPincode('');
    setNewPartyPhoto('');
    setNewPartyPhotoAsset(null);

    // Reset optional
    setNewPartyWhatsapp('');
    setNewPartyEmail('');
    setNewPartyGstNo('');
    setNewPartyCreditLimit('');
    setNewPartyPaymentTerms('7 Days');
    setNewPartyNotes('');

    setLat(null);
    setLng(null);
    setLocationAccuracy(null);
    setLocationStatusText('');
    setLocationWarning('');
    setFetchingLocation(false);
    setExistingPartyId(null);
    setError('');
    setSuccess('');
    setAddModalVisible(true);
  };

  const startPreciseLocationCapture = async () => {
    setFetchingLocation(true);
    setLocationStatusText('Getting precise location (waiting for accuracy ≤10m)...');
    setLocationWarning('');
    setLat(null);
    setLng(null);
    setLocationAccuracy(null);

    try {
      if (Platform.OS === 'android') {
        await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
      }

      let bestLocation = null;
      let watchId = null;
      let timer = null;

      const finishLocation = (coords, warningMsg = '') => {
        if (watchId !== null) Geolocation.clearWatch(watchId);
        if (timer) clearTimeout(timer);
        setLat(coords.latitude);
        setLng(coords.longitude);
        setLocationAccuracy(coords.accuracy);
        if (warningMsg) setLocationWarning(warningMsg);
        setFetchingLocation(false);
      };

      // 30-second fallback timer
      timer = setTimeout(() => {
        if (watchId !== null) Geolocation.clearWatch(watchId);
        if (bestLocation) {
          const roundedAcc = Math.round(bestLocation.accuracy);
          finishLocation(
            bestLocation,
            `Location accuracy is lower than expected (~${roundedAcc}m). You can continue, but the pinned location may be less precise.`
          );
        } else {
          setFetchingLocation(false);
          setError('Could not obtain GPS location within 30 seconds.');
        }
      }, 30000);

      watchId = Geolocation.watchPosition(
        (position) => {
          const { latitude, longitude, accuracy } = position.coords;
          if (!bestLocation || accuracy < bestLocation.accuracy) {
            bestLocation = { latitude, longitude, accuracy };
          }

          if (accuracy <= 10) {
            finishLocation({ latitude, longitude, accuracy });
          } else {
            setLocationStatusText(`Getting precise location... Current accuracy: ~${Math.round(accuracy)}m (waiting for ≤10m)`);
          }
        },
        (err) => {
          console.warn('GPS watch error:', err.message);
        },
        {
          enableHighAccuracy: true,
          distanceFilter: 0,
          interval: 1000,
          fastestInterval: 500,
          timeout: 30000,
          maximumAge: 0,
        }
      );
    } catch (e) {
      console.warn('GPS request failed:', e.message);
      setFetchingLocation(false);
      setError('GPS permission or hardware error.');
    }
  };

  const handleCaptureNewPartyPhoto = () => {
    launchCamera(
      {
        mediaType: 'photo',
        quality: 0.3,
        includeBase64: true,
      },
      (response) => {
        if (response.didCancel) {
          Alert.alert('Photo Cancelled', 'Shop front photo is required to register a party.');
          return;
        }

        if (response.errorCode) {
          Alert.alert('Camera Error', response.errorMessage || 'Failed to start camera.');
          return;
        }

        const asset = response.assets?.[0];
        if (asset) {
          setNewPartyPhoto(asset.base64);
          setNewPartyPhotoAsset(asset);
          // High accuracy location mode captured ONLY when outlet photo is captured
          startPreciseLocationCapture();
        }
      }
    );
  };

  const handleCreateParty = async () => {
    if (
      !newPartyName.trim() ||
      !newPartyMobile.trim() ||
      !newPartyAddress.trim() ||
      !newPartyArea.trim() ||
      !newPartyCity.trim() ||
      !newPartyState.trim() ||
      !newPartyPincode.trim()
    ) {
      setError('Please fill in all required text fields (*).');
      return;
    }

    if (!newPartyPhoto) {
      setError('Shop Front Photo is mandatory to create a new party.');
      return;
    }

    if (!lat || !lng) {
      setError('GPS coordinates are mandatory to register a new party.');
      return;
    }

    setError('');
    setSuccess('');
    setCreatingPartyLoading(true);

    try {
      let finalShopPhotoUrl = '';
      if (newPartyPhotoAsset) {
        try {
          const uploadRes = await uploadFile({
            file: newPartyPhotoAsset,
            module: 'party',
            relatedModel: 'Party',
            token,
            apiUrl,
          });
          finalShopPhotoUrl = uploadRes.storagePath || uploadRes.url || '';
        } catch (uploadErr) {
          console.warn('Photo upload service fallback:', uploadErr.message);
        }
      }
      if (!finalShopPhotoUrl && newPartyPhoto) {
        finalShopPhotoUrl = newPartyPhoto.startsWith('data:') ? newPartyPhoto : `data:image/jpeg;base64,${newPartyPhoto}`;
      }

      const response = await fetch(`${apiUrl}/parties`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          partyName: newPartyName.trim(),
          mobile: newPartyMobile.trim(),
          address: newPartyAddress.trim(),
          area: newPartyArea.trim(),
          ownerName: newPartyOwnerName.trim() || undefined,
          shopPhoto: finalShopPhotoUrl,
          whatsapp: newPartyWhatsapp.trim() || undefined,
          email: newPartyEmail.trim() || undefined,
          gstNo: newPartyGstNo.trim() || undefined,
          city: newPartyCity.trim(),
          state: newPartyState.trim(),
          pincode: newPartyPincode.trim(),
          creditLimit: parseFloat(newPartyCreditLimit) || undefined,
          paymentTerms: newPartyPaymentTerms || undefined,
          notes: newPartyNotes.trim() || undefined,
          location: {
            latitude: lat,
            longitude: lng,
          },
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (data.message && data.message.includes('already exists')) {
          setExistingPartyId(data.data?.existingPartyId || 'duplicate');
          throw new Error('This party already exists in the system with this mobile number.');
        }
        throw new Error(data.message || 'Failed to create party.');
      }

      setSuccess('Party created successfully!');
      setAddModalVisible(false);
      loadMyParties();
    } catch (err) {
      setError(err.message || 'Network error.');
    } finally {
      setCreatingPartyLoading(false);
    }
  };

  const handleRequestAssignment = async () => {
    if (!existingPartyId || existingPartyId === 'duplicate') return;
    setAssignmentSubmitting(true);
    setError('');
    setSuccess('');
    try {
      const response = await fetch(`${apiUrl}/parties/${existingPartyId}/request-assignment`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await response.json();
      if (response.ok) {
        setSuccess('Assignment request sent successfully to Admin.');
        setTimeout(() => setAddModalVisible(false), 2000);
      } else {
        throw new Error(data.message || 'Failed to request assignment.');
      }
    } catch (err) {
      setError(err.message || 'Error sending request.');
    } finally {
      setAssignmentSubmitting(false);
    }
  };

  const handleRequestAssignmentFromCard = async (party) => {
    setAssignmentSubmitting(true);
    try {
      const response = await fetch(`${apiUrl}/parties/${party._id}/request-assignment`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await response.json();
      if (response.ok) {
        Alert.alert('Request Sent', 'Your assignment request has been successfully sent to Admin.');
        loadMyParties();
      } else {
        throw new Error(data.message || 'Failed to request assignment.');
      }
    } catch (err) {
      Alert.alert('Request Failed', err.message || 'Connection error.');
    } finally {
      setAssignmentSubmitting(false);
    }
  };

  const handleVisitParty = async (party) => {
    // Prevent double visit
    if (party.visitedToday) {
      Alert.alert('Already Visited', `You have already visited "${party.partyName}" today.`);
      return;
    }

    launchCamera(
      {
        mediaType: 'photo',
        quality: 0.3,
        includeBase64: true,
      },
      async (response) => {
        if (response.didCancel) {
          Alert.alert('Visit Cancelled', 'Shop front photo is mandatory to start a visit.');
          return;
        }

        if (response.errorCode) {
          Alert.alert('Camera Error', response.errorMessage || 'Failed to start camera.');
          return;
        }

        const base64Photo = response.assets[0].base64;
        setVisitStartingId(party._id);
        setError('');

        try {
          const logId = await AsyncStorage.getItem('active_log_id');
          if (!logId) {
            Alert.alert('Error', 'Please check in first to start daily visits.');
            setVisitStartingId(null);
            return;
          }

          const startRes = await fetch(`${apiUrl}/visit/start`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              partyId: party._id,
              shopPhoto: `data:image/jpeg;base64,${base64Photo}`,
              logId,
            }),
          });

          const startData = await startRes.json();
          if (startRes.ok) {
            Alert.alert('Visit Started', `Your visit at "${party.partyName}" is now active!`);
            loadMyParties();
          } else {
            throw new Error(startData.message || 'Failed to register visit arrival.');
          }
        } catch (err) {
          Alert.alert('Visit Failed', err.message || 'Network error.');
        } finally {
          setVisitStartingId(null);
        }
      }
    );
  };

  const renderPartyCard = (item) => {
    const isAssignedToMe = item.isAssignedToMe !== undefined ? item.isAssignedToMe : true;

    return (
      <TouchableOpacity
        activeOpacity={0.85}
        style={[
          styles.partyCard,
          item.visitedToday && styles.partyCardVisited,
        ]}
        key={item._id}
        onPress={() => setSelectedProfilePartyId(item._id)}
      >
        <View style={styles.cardHeader}>
          <View style={{ flex: 1 }}>
            <View style={styles.nameRow}>
              <Text style={styles.partyName}>{item.partyName}</Text>
              {item.visitedToday && (
                <View style={styles.visitedBadge}>
                  <Text style={styles.visitedBadgeText}>✓ Visited</Text>
                </View>
              )}
            </View>
            <Text style={styles.partyCode}>Code: {item.partyCode || 'Generating...'}</Text>
          </View>
        </View>

        <View style={styles.cardBody}>
          <Text style={styles.partyDetail}>📞 Mobile: <Text style={styles.bold}>{item.mobile}</Text></Text>
          {item.ownerName ? (
            <Text style={styles.partyDetail}>👤 Owner: <Text style={styles.bold}>{item.ownerName}</Text></Text>
          ) : null}
          <Text style={styles.partyDetail}>📍 Address: <Text style={styles.bold}>{item.address}</Text></Text>
          {!isAssignedToMe && (
            <Text style={styles.partyDetail}>👤 Assigned: <Text style={[styles.bold, { color: '#E53E3E' }]}>
              {item.assignedSalesman?.name || 'Another Representative'}
            </Text></Text>
          )}
        </View>

        {/* Action Buttons Row */}
        <View style={styles.cardButtonsRow}>
          {isAssignedToMe ? (
            <>
              <TouchableOpacity
                style={{
                  flex: 1,
                  height: 38,
                  backgroundColor: '#00796B',
                  borderRadius: 8,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                onPress={() => onNavigateToOrder && onNavigateToOrder(item)}
              >
                <Text style={{ color: '#FFFFFF', fontWeight: '800', fontSize: 11 }}>📦 Order</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={{
                  flex: 1,
                  height: 38,
                  backgroundColor: '#D69E2E',
                  borderRadius: 8,
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginLeft: 6,
                }}
                onPress={() => onNavigateToCollection && onNavigateToCollection(item)}
              >
                <Text style={{ color: '#FFFFFF', fontWeight: '800', fontSize: 11 }}>💰 Collect</Text>
              </TouchableOpacity>
            </>
          ) : (
            <TouchableOpacity
              style={[styles.requestBtn, { flex: 1, marginBottom: 0 }, assignmentSubmitting && styles.disabledBtn]}
              onPress={() => handleRequestAssignmentFromCard(item)}
              disabled={assignmentSubmitting}
            >
              {assignmentSubmitting ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.requestBtnText}>Request Assign</Text>
              )}
            </TouchableOpacity>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  // If a profile is selected, show the profile screen
  if (selectedProfilePartyId) {
    return (
      <PartyProfileScreen
        token={token}
        apiUrl={apiUrl}
        partyId={selectedProfilePartyId}
        onBack={() => setSelectedProfilePartyId(null)}
        onNavigateToOrder={(party) => {
          setSelectedProfilePartyId(null);
          onNavigateToOrder && onNavigateToOrder(party);
        }}
      />
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={onBack}>
          <Text style={styles.backBtnText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Parties</Text>
      </View>

      {/* Search & Add Row */}
      <View style={styles.searchRow}>
        <View style={[styles.searchInput, { flexDirection: 'row', alignItems: 'center', flex: 1, paddingHorizontal: 12 }]}>
          <TextInput
            style={{ flex: 1, color: '#1A202C', fontSize: 14, paddingVertical: 8 }}
            placeholder="Search all parties..."
            placeholderTextColor="#A0AEC0"
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchingLoading ? (
            <ActivityIndicator size="small" color="#00796B" style={{ marginLeft: 6 }} />
          ) : null}
        </View>
        <TouchableOpacity style={styles.addBtn} onPress={handleOpenAddModal}>
          <Text style={styles.addBtnText}>+ Add</Text>
        </TouchableOpacity>
      </View>

      {/* Mode indicator */}
      <View style={styles.modeIndicator}>
        <Text style={styles.modeText}>
          {isSearching ? '🔍 Search Results (All Parties)' : `📋 My Parties (${partiesList.length})`}
        </Text>
        {isSearching ? (
          <TouchableOpacity onPress={() => setSearchQuery('')}>
            <Text style={styles.clearSearch}>Clear</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Parties List with Infinite Scroll & Consistent Loaders */}
      <FlatList
        data={partiesList}
        keyExtractor={(item) => item._id}
        renderItem={({ item }) => renderPartyCard(item)}
        contentContainerStyle={styles.container}
        onEndReached={handleLoadMore}
        onEndReachedThreshold={0.5}
        ListHeaderComponent={
          error ? (
            <View style={styles.errorCard}>
              <Text style={styles.errorText}>{error}</Text>
              <TouchableOpacity style={styles.retryBtn} onPress={() => fetchPartiesPage(1, searchQuery)}>
                <Text style={styles.retryBtnText}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : null
        }
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator size="large" color="#00796B" style={{ marginVertical: 40 }} />
          ) : (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>
                {isSearching
                  ? 'No matching parties found in the system.'
                  : 'No parties assigned to you yet.'}
              </Text>
            </View>
          )
        }
        ListFooterComponent={
          loadingMore ? (
            <ActivityIndicator size="small" color="#00796B" style={{ marginVertical: 16 }} />
          ) : null
        }
      />

      {/* Comprehensive Add Party Modal */}
      <Modal
        visible={addModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setAddModalVisible(false)}
      >
        <SafeAreaView style={styles.modalSafeArea}>
          <View style={styles.modalWrapper}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitleText}>Add New Party</Text>
              <TouchableOpacity style={styles.closeXBtn} onPress={() => setAddModalVisible(false)}>
                <Text style={styles.closeXText}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.modalFormContent}>
              {error ? <Text style={styles.errorText}>{error}</Text> : null}
              {success ? <Text style={styles.successText}>{success}</Text> : null}

              {/* 1. Required Section */}
              <Text style={styles.sectionHeading}>Required Details</Text>

              <Text style={styles.fieldLabel}>Party Name *</Text>
              <TextInput
                style={styles.input}
                placeholder="Shop Name / Business Title"
                placeholderTextColor="#A0AEC0"
                value={newPartyName}
                onChangeText={setNewPartyName}
              />

              <Text style={styles.fieldLabel}>Mobile Number *</Text>
              <TextInput
                style={styles.input}
                placeholder="10-digit mobile number"
                placeholderTextColor="#A0AEC0"
                keyboardType="phone-pad"
                value={newPartyMobile}
                onChangeText={setNewPartyMobile}
              />

              <Text style={styles.fieldLabel}>Full Address *</Text>
              <TextInput
                style={[styles.input, styles.textarea]}
                placeholder="Shop location address details"
                placeholderTextColor="#A0AEC0"
                multiline
                numberOfLines={2}
                value={newPartyAddress}
                onChangeText={setNewPartyAddress}
              />

              {/* Required Shop Front Photo */}
              <Text style={styles.fieldLabel}>Shop Front Photo *</Text>
              <TouchableOpacity style={styles.photoCaptureBtn} onPress={handleCaptureNewPartyPhoto}>
                <Text style={styles.photoCaptureBtnText}>📸 Capture Shop Photo</Text>
              </TouchableOpacity>
              {newPartyPhoto ? (
                <Text style={styles.photoSuccessText}>✓ Shop Front Photo Captured successfully</Text>
              ) : (
                <Text style={styles.photoErrorText}>Photo is mandatory to create party *</Text>
              )}

              {/* 2. Contact Details */}
              <Text style={styles.sectionHeading}>Contact Details</Text>

              <Text style={styles.fieldLabel}>Owner Name (Optional)</Text>
              <TextInput
                style={styles.input}
                placeholder="Proprietor / Owner full name"
                placeholderTextColor="#A0AEC0"
                value={newPartyOwnerName}
                onChangeText={setNewPartyOwnerName}
              />

              <Text style={styles.fieldLabel}>WhatsApp Number (Optional)</Text>
              <TextInput
                style={styles.input}
                placeholder="WhatsApp contact phone"
                placeholderTextColor="#A0AEC0"
                keyboardType="phone-pad"
                value={newPartyWhatsapp}
                onChangeText={setNewPartyWhatsapp}
              />

              <Text style={styles.fieldLabel}>Email Address (Optional)</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. shop@example.com"
                placeholderTextColor="#A0AEC0"
                keyboardType="email-address"
                autoCapitalize="none"
                value={newPartyEmail}
                onChangeText={setNewPartyEmail}
              />

              <Text style={styles.fieldLabel}>GST Number (Optional)</Text>
              <TextInput
                style={styles.input}
                placeholder="15-digit GSTIN"
                placeholderTextColor="#A0AEC0"
                autoCapitalize="characters"
                value={newPartyGstNo}
                onChangeText={setNewPartyGstNo}
              />

              {/* 3. Location Details */}
              <Text style={styles.sectionHeading}>Area & Location Details</Text>

              <Text style={styles.fieldLabel}>Area / Locality *</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. Nehru Place"
                placeholderTextColor="#A0AEC0"
                value={newPartyArea}
                onChangeText={setNewPartyArea}
              />

              <View style={styles.rowInputs}>
                <View style={styles.halfInput}>
                  <Text style={styles.fieldLabel}>City *</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="City name"
                    placeholderTextColor="#A0AEC0"
                    value={newPartyCity}
                    onChangeText={setNewPartyCity}
                  />
                </View>

                <View style={styles.halfInput}>
                  <Text style={styles.fieldLabel}>State *</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="State name"
                    placeholderTextColor="#A0AEC0"
                    value={newPartyState}
                    onChangeText={setNewPartyState}
                  />
                </View>
              </View>

              <Text style={styles.fieldLabel}>Pincode *</Text>
              <TextInput
                style={styles.input}
                placeholder="6-digit postal code"
                placeholderTextColor="#A0AEC0"
                keyboardType="numeric"
                value={newPartyPincode}
                onChangeText={setNewPartyPincode}
              />

              {/* GPS Coordinates Fetch Box */}
              <Text style={styles.fieldLabel}>GPS Auto-location *</Text>
              <View style={styles.locationContainer}>
                {fetchingLocation ? (
                  <View style={styles.row}>
                    <ActivityIndicator color="#00796B" size="small" style={{ marginRight: 8 }} />
                    <Text style={styles.locationStatus}>{locationStatusText || 'Getting precise location...'}</Text>
                  </View>
                ) : lat && lng ? (
                  <View>
                    <Text style={styles.locationCoords}>
                      📍 Latitude: {lat.toFixed(5)} | Longitude: {lng.toFixed(5)} {locationAccuracy ? `(Accuracy: ~${Math.round(locationAccuracy)}m)` : ''}
                    </Text>
                    {locationWarning ? (
                      <Text style={{ color: '#D69E2E', fontSize: 11, marginTop: 4, fontWeight: '600' }}>
                        ⚠️ {locationWarning}
                      </Text>
                    ) : null}
                  </View>
                ) : (
                  <Text style={styles.locationError}>Location will be captured automatically when you take the shop front photo.</Text>
                )}
              </View>

              {/* 4. Limits & Terms (Optional) */}
              <Text style={styles.sectionHeading}>Billing & Credit Terms (Optional)</Text>

              <Text style={styles.fieldLabel}>Credit Limit (INR)</Text>
              <TextInput
                style={styles.input}
                placeholder="Max outstanding limit"
                placeholderTextColor="#A0AEC0"
                keyboardType="numeric"
                value={newPartyCreditLimit}
                onChangeText={setNewPartyCreditLimit}
              />

              <Text style={styles.fieldLabel}>Payment Terms</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: 6 }}>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {['Advance', 'Cash', '7 Days', '14 Days'].map((opt) => {
                    const isSelected = newPartyPaymentTerms === opt;
                    return (
                      <TouchableOpacity
                        key={opt}
                        style={{
                          paddingVertical: 10,
                          paddingHorizontal: 16,
                          borderRadius: 20,
                          backgroundColor: isSelected ? '#00796B' : '#EDF2F7',
                          borderWidth: 1,
                          borderColor: isSelected ? '#004D40' : '#CBD5E0',
                        }}
                        onPress={() => setNewPartyPaymentTerms(opt)}
                      >
                        <Text style={{ color: isSelected ? '#FFFFFF' : '#2D3748', fontWeight: isSelected ? '700' : '600', fontSize: 13 }}>
                          {opt}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </ScrollView>

              <Text style={styles.fieldLabel}>Notes / Special Instructions</Text>
              <TextInput
                style={[styles.input, styles.textarea]}
                placeholder="Special notes or guidelines for this party..."
                placeholderTextColor="#A0AEC0"
                multiline
                numberOfLines={3}
                value={newPartyNotes}
                onChangeText={setNewPartyNotes}
              />

              {/* Duplicate Request Button */}
              {existingPartyId && existingPartyId !== 'duplicate' ? (
                <TouchableOpacity
                  style={[styles.requestBtn, assignmentSubmitting && styles.disabledBtn]}
                  onPress={handleRequestAssignment}
                  disabled={assignmentSubmitting}
                >
                  {assignmentSubmitting ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.requestBtnText}>Send Assignment Request</Text>
                  )}
                </TouchableOpacity>
              ) : null}
            </ScrollView>

            {/* Bottom Actions Row */}
            <View style={styles.modalActionsFooter}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => setAddModalVisible(false)}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.submitBtn}
                onPress={handleCreateParty}
              >
                <Text style={styles.submitBtnText}>Create Party</Text>
              </TouchableOpacity>
            </View>
          </View>
        </SafeAreaView>
      </Modal>

      {/* Non-cancellable loading progress modal on Create Party */}
      <Modal
        visible={creatingPartyLoading}
        transparent
        animationType="fade"
        onRequestClose={() => {}}
      >
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
          <View style={{ backgroundColor: '#FFFFFF', borderRadius: 16, padding: 24, width: '85%', alignItems: 'center', gap: 12 }}>
            <ActivityIndicator color="#00796B" size="large" />
            <Text style={{ fontSize: 16, fontWeight: '700', color: '#1A202C' }}>Creating Party...</Text>
            <Text style={{ fontSize: 13, color: '#718096', textAlign: 'center' }}>Please wait while your party details and outlet photo are being saved.</Text>
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
  searchRow: {
    flexDirection: 'row',
    paddingHorizontal: scale(16),
    paddingVertical: verticalScale(12),
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    gap: verticalScale(10),
    alignItems: 'center',
  },
  searchInput: {
    flex: 1,
    height: verticalScale(40),
    backgroundColor: '#F7F9FC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    paddingHorizontal: scale(12),
    fontSize: responsiveFontSize(13.5),
    color: '#2D3748',
  },
  addBtn: {
    height: verticalScale(40),
    paddingHorizontal: scale(16),
    backgroundColor: '#00796B',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: responsiveFontSize(13.5),
  },
  // Mode indicator bar
  modeIndicator: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: scale(16),
    paddingVertical: verticalScale(8),
    backgroundColor: '#EDF2F7',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  modeText: {
    fontSize: responsiveFontSize(12.5),
    fontWeight: '700',
    color: '#4A5568',
  },
  clearSearch: {
    fontSize: responsiveFontSize(12.5),
    fontWeight: '700',
    color: '#E53E3E',
  },
  container: {
    padding: scale(16),
    paddingBottom: verticalScale(40),
  },
  partiesList: {
    gap: verticalScale(14),
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
  // Party card styles
  partyCard: {
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
  partyCardVisited: {
    borderColor: '#38A169',
    borderWidth: 1.5,
    backgroundColor: '#F0FFF4',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: '#EDF2F7',
    paddingBottom: verticalScale(10),
    marginBottom: verticalScale(10),
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: verticalScale(8),
    flexWrap: 'wrap',
  },
  partyName: {
    fontSize: responsiveFontSize(15.5),
    fontWeight: '700',
    color: '#2D3748',
  },
  visitedBadge: {
    backgroundColor: '#38A169',
    paddingHorizontal: scale(8),
    paddingVertical: verticalScale(3),
    borderRadius: 10,
  },
  visitedBadgeText: {
    color: '#FFFFFF',
    fontSize: responsiveFontSize(10.5),
    fontWeight: '800',
  },
  partyCode: {
    fontSize: responsiveFontSize(12),
    color: '#718096',
    marginTop: verticalScale(2),
    fontWeight: '600',
  },
  cardBody: {
    gap: verticalScale(6),
    marginBottom: verticalScale(14),
  },
  partyDetail: {
    fontSize: responsiveFontSize(13),
    color: '#4A5568',
  },
  bold: {
    fontWeight: '600',
    color: '#2D3748',
  },
  // Card action buttons row
  cardButtonsRow: {
    flexDirection: 'row',
    gap: verticalScale(10),
  },
  profileBtn: {
    height: verticalScale(38),
    paddingHorizontal: scale(14),
    backgroundColor: '#4A5568',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: responsiveFontSize(12.5),
  },
  // Visit button
  visitBtn: {
    height: verticalScale(38),
    backgroundColor: '#00796B',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabledBtn: {
    opacity: 0.6,
  },
  visitBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: responsiveFontSize(13),
  },
  // Visited disabled button
  visitedDisabledBtn: {
    height: verticalScale(38),
    backgroundColor: '#C6F6D5',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#9AE6B4',
  },
  visitedDisabledText: {
    color: '#276749',
    fontWeight: '700',
    fontSize: responsiveFontSize(13),
  },
  // Modal layout
  modalSafeArea: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalWrapper: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    marginTop: verticalScale(40),
    display: 'flex',
  },
  modalHeader: {
    height: verticalScale(54),
    borderBottomWidth: 1,
    borderBottomColor: '#EDF2F7',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: scale(20),
  },
  modalTitleText: {
    fontSize: responsiveFontSize(16.5),
    fontWeight: '800',
    color: '#2D3748',
  },
  closeXBtn: {
    padding: scale(6),
  },
  closeXText: {
    fontSize: responsiveFontSize(18),
    color: '#A0AEC0',
    fontWeight: '600',
  },
  modalFormContent: {
    padding: scale(20),
    paddingBottom: verticalScale(40),
  },
  sectionHeading: {
    fontSize: responsiveFontSize(12),
    fontWeight: '800',
    color: '#00796B',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: verticalScale(8),
    marginBottom: verticalScale(14),
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    paddingBottom: verticalScale(6),
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
  input: {
    height: verticalScale(44),
    backgroundColor: '#F7F9FC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    color: '#2D3748',
    paddingHorizontal: scale(12),
    fontSize: responsiveFontSize(14),
    marginBottom: verticalScale(16),
  },
  textarea: {
    height: verticalScale(64),
    textAlignVertical: 'top',
    paddingVertical: verticalScale(8),
  },
  rowInputs: {
    flexDirection: 'row',
    gap: verticalScale(12),
  },
  halfInput: {
    flex: 1,
  },
  photoCaptureBtn: {
    height: verticalScale(44),
    backgroundColor: '#E2E8F0',
    borderWidth: 1,
    borderColor: '#CBD5E0',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: verticalScale(8),
  },
  photoCaptureBtnText: {
    color: '#4A5568',
    fontWeight: '700',
    fontSize: responsiveFontSize(13.5),
  },
  photoSuccessText: {
    fontSize: responsiveFontSize(12.5),
    color: '#38A169',
    fontWeight: '700',
    marginBottom: verticalScale(16),
  },
  photoErrorText: {
    fontSize: responsiveFontSize(12.5),
    color: '#E53E3E',
    fontWeight: '600',
    marginBottom: verticalScale(16),
  },
  locationContainer: {
    backgroundColor: '#F7F9FC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    padding: scale(12),
    marginBottom: verticalScale(18),
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  locationStatus: {
    fontSize: responsiveFontSize(13),
    color: '#718096',
    fontWeight: '600',
  },
  locationCoords: {
    fontSize: responsiveFontSize(13),
    color: '#00796B',
    fontWeight: '700',
  },
  locationError: {
    fontSize: responsiveFontSize(13),
    color: '#E53E3E',
    fontWeight: '600',
  },
  requestBtn: {
    height: verticalScale(44),
    backgroundColor: '#D69E2E',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: verticalScale(16),
  },
  requestBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: responsiveFontSize(14),
  },
  modalActionsFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: verticalScale(12),
    padding: scale(16),
    borderTopWidth: 1,
    borderTopColor: '#EDF2F7',
    backgroundColor: '#FFFFFF',
  },
  cancelBtn: {
    flex: 1,
    height: verticalScale(44),
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtnText: {
    color: '#718096',
    fontSize: responsiveFontSize(14),
    fontWeight: '700',
  },
  submitBtn: {
    flex: 1,
    height: verticalScale(44),
    backgroundColor: '#00796B',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitBtnText: {
    color: '#FFFFFF',
    fontSize: responsiveFontSize(14),
    fontWeight: '700',
  },
});
