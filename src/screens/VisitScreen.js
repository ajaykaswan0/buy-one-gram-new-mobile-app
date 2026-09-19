import React, { useState, useEffect, useCallback } from 'react';
import { getCurrentLocation } from '../services/currentLocation';
import { openPartyOnMap, partyCoordinates } from '../services/openOnMap';
import { getActiveLogId, hasActiveLog } from '../services/activeLog';
import { useLanguage } from '../i18n';
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
  Animated,
  Easing,
  RefreshControl,
} from 'react-native';
import { scale, verticalScale, responsiveFontSize, maxContainerWidth } from '../utils/responsive';
import { bottomBarPadding } from '../utils/systemBars';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Geolocation from '@react-native-community/geolocation';
import { PermissionsAndroid, Platform, BackHandler } from 'react-native';
import { launchCamera } from 'react-native-image-picker';
import PartyProfileScreen from './PartyProfileScreen';
import { uploadFile } from '../services/firebaseUploadService';
import { uploadPhoto } from '../services/photoUpload';

export default function VisitScreen({ token, user, apiUrl, onBack, onNavigateToOrder, onNavigateToCollection }) {
  const { t, term, name } = useLanguage();
  const ownPartyScope = ['cso', 'crm', 'salespartner'].includes(
    String(user?.roleName || user?.role?.name || user?.role || '').toLowerCase().replace(/[\s_-]/g, '')
  ) ? '&scope=own' : '';
  const [partiesList, setPartiesList] = useState([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searchingLoading, setSearchingLoading] = useState(false);
  // The party list's own error — a failed fetch, with a Retry.
  const [error, setError] = useState('');
  // The Add-Party form's error, kept apart from the list's. One shared string
  // meant a validation message from the modal stayed on screen after closing
  // it, and appeared above the party list where it made no sense.
  const [formError, setFormError] = useState('');
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
  // What the save is doing right now, and how far along it is. The bar is
  // driven by the actual stages below rather than by a timer, so it never sits
  // at 90% while something is still uploading.
  const [createStep, setCreateStep] = useState('');
  const createProgress = useState(() => new Animated.Value(0))[0];
  const [createdParty, setCreatedParty] = useState(null);

  // Duplication & Assignment states
  const [existingPartyId, setExistingPartyId] = useState(null);
  const [assignmentSubmitting, setAssignmentSubmitting] = useState(false);
  const [visitStartingId, setVisitStartingId] = useState(null);
  const [selectedProfilePartyId, setSelectedProfilePartyId] = useState(null);

  // ── Paginated Party Fetch & Server-Side Search ──
  // Pull down to reload, so the screen can be refreshed in place rather than
  // by navigating away and back.
  const [refreshing, setRefreshing] = useState(false);
  const onPullRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadMyParties();
    } catch (e) {
      console.log('[Refresh] failed:', e.message);
    } finally {
      setRefreshing(false);
    }
  }, [loadMyParties]);

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
        // A CSO's party list is the parties assigned to him, not his team's
        // book — the team's parties are reached through Team Performance.
        : `${apiUrl}/parties/my?page=${pageNum}&limit=20${ownPartyScope}`;

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
    setFormError('');
    setSuccess('');
    setAddModalVisible(true);

    /**
     * Start looking for the phone's position now, while the form is being
     * filled in.
     *
     * It used to start only once the shop photo had been taken, which is the
     * last thing anybody does — so the GPS began from cold at the exact moment
     * the salesman was ready to submit, and he watched it for twelve seconds.
     * Started here, the name, mobile and address take longer to type than the
     * fix takes to arrive, and by the time the photo is taken it is already on
     * the form.
     *
     * It costs nothing extra: the watch stops itself as soon as the fix is good
     * enough, and after twelve seconds regardless.
     */
    startPreciseLocationCapture();
  };

  /**
   * Leaves the Add-Party form and clears what belonged to it.
   *
   * Every exit goes through here — the ✕, Cancel, the Android back gesture and
   * a successful save — because a message left behind used to reappear over the
   * party list, describing a form the salesman had already closed.
   */
  const closeAddPartyModal = () => {
    setAddModalVisible(false);
    setFormError('');
    setSuccess('');
    setExistingPartyId(null);
  };

  const startPreciseLocationCapture = async () => {
    setFetchingLocation(true);
    setLocationStatusText('Getting precise location (waiting for accuracy ≤10m)...');
    setLocationWarning('');
    // A retry must not leave the previous failure on screen, or a fix that
    // worked still reads as broken.
    setFormError('');
    setLat(null);
    setLng(null);
    setLocationAccuracy(null);

    try {
      if (Platform.OS === 'android') {
        await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
      }

      /**
       * A pin on the form within a second, then quietly better.
       *
       * This used to refuse any cached fix and wait for accuracy of ten metres
       * or better, for thirty seconds, before letting the form be used. Inside a
       * shop that fix often never arrives, so the salesman watched a spinner and
       * was then told the location would be taken later — which is the complaint.
       *
       * A shop's pin does not need ten metres. The visit radius is two hundred,
       * and every pin in the book was taken by a phone on a doorstep. So:
       *
       *   - a fix the phone already has goes on the form at once, however rough,
       *     so there is always something to submit;
       *   - the watch keeps running and quietly replaces it with anything
       *     better;
       *   - fifty metres is good enough to stop waiting;
       *   - after twelve seconds it settles for the best it has rather than
       *     failing. It only fails when the phone gave nothing at all.
       */
      let bestLocation = null;
      let watchId = null;
      let timer = null;
      let settled = false;

      const GOOD_ENOUGH = 50;
      const STOP_WAITING = 12000;

      const useCoords = (coords) => {
        setLat(coords.latitude);
        setLng(coords.longitude);
        setLocationAccuracy(coords.accuracy);
      };

      const finishLocation = (coords, warningMsg = '') => {
        if (watchId !== null) Geolocation.clearWatch(watchId);
        if (timer) clearTimeout(timer);
        settled = true;
        useCoords(coords);
        if (warningMsg) setLocationWarning(warningMsg);
        setFetchingLocation(false);
      };

      /**
       * Whatever the phone can give immediately, cached or coarse. This is the
       * one that makes the form usable straight away; the watch below improves
       * on it.
       */
      Geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude, accuracy } = position.coords;
          if (settled) return;
          if (!bestLocation || accuracy < bestLocation.accuracy) bestLocation = { latitude, longitude, accuracy };
          useCoords(bestLocation);
          setLocationStatusText(`Pinned to about ${Math.round(accuracy)}m — still improving`);
        },
        () => {},
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 120000 },
      );

      timer = setTimeout(() => {
        if (watchId !== null) Geolocation.clearWatch(watchId);
        if (bestLocation) {
          finishLocation(
            bestLocation,
            bestLocation.accuracy > GOOD_ENOUGH
              ? `Pinned to about ${Math.round(bestLocation.accuracy)}m. Good enough to save — tap Retry outside the shop if you want it tighter.`
              : '',
          );
        } else {
          setFetchingLocation(false);
          setFormError('The phone gave no location at all. Check that location is switched on, then tap Retry.');
        }
      }, STOP_WAITING);

      watchId = Geolocation.watchPosition(
        (position) => {
          const { latitude, longitude, accuracy } = position.coords;
          if (!bestLocation || accuracy < bestLocation.accuracy) {
            bestLocation = { latitude, longitude, accuracy };
            useCoords(bestLocation);
          }

          if (accuracy <= GOOD_ENOUGH) {
            finishLocation({ latitude, longitude, accuracy });
          } else {
            setLocationStatusText(`Pinned to about ${Math.round(accuracy)}m — still improving`);
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
          timeout: STOP_WAITING,
          maximumAge: 0,
        }
      );
    } catch (e) {
      console.warn('GPS request failed:', e.message);
      setFetchingLocation(false);
      setFormError('GPS permission or hardware error.');
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
          // The fix has been coming in since the form opened. Only ask again if
          // it never arrived, so the photo is still a second chance rather than
          // throwing away a good pin and starting over.
          if (!lat || !lng) startPreciseLocationCapture();
        }
      }
    );
  };

  // A usable pin, and whether the form may be submitted at all. Kept here so
  // the button, its label and the note beneath it can never disagree.
  const hasPin = lat != null && lng != null;
  /**
   * A pin is enough. Waiting for the watch to settle held the form hostage to a
   * fix that may never sharpen; the pin on screen is already good enough to save
   * and the watch only ever replaces it with something better.
   */
  const canSubmitParty = hasPin && !creatingPartyLoading;

  /** Moves the bar to a stage. Animated, so it reads as progress, not as jumps. */
  const advance = (to, label) => {
    setCreateStep(label);
    Animated.timing(createProgress, {
      toValue: to,
      duration: 320,
      easing: Easing.out(Easing.quad),
      // width cannot be driven on the native thread.
      useNativeDriver: false,
    }).start();
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
      setFormError('Please fill in all required text fields (*).');
      return;
    }

    if (!newPartyPhoto) {
      setFormError('Shop Front Photo is mandatory to create a new party.');
      return;
    }

    if (!lat || !lng) {
      setFormError('GPS coordinates are mandatory to register a new party.');
      return;
    }

    setFormError('');
    setSuccess('');
    createProgress.setValue(0);
    setCreatingPartyLoading(true);
    advance(0.08, 'Checking details');

    try {
      let finalShopPhotoUrl = '';
      if (newPartyPhotoAsset || newPartyPhoto) advance(0.25, 'Uploading shop photo');
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
        finalShopPhotoUrl = await uploadPhoto({ base64: newPartyPhoto, apiUrl, token, module: 'parties' });
      }

      advance(0.6, 'Saving party');

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

      advance(0.85, 'Refreshing your parties');
      await loadMyParties();

      advance(1, 'Done');
      // A beat at 100% so the bar is seen to finish rather than vanishing full.
      await new Promise((resolve) => setTimeout(resolve, 350));

      setAddModalVisible(false);
      setCreatedParty({
        partyName: newPartyName.trim(),
        mobile: newPartyMobile.trim(),
        area: newPartyArea.trim(),
        city: newPartyCity.trim(),
        latitude: lat,
        longitude: lng,
        accuracy: locationAccuracy,
      });
    } catch (err) {
      setFormError(err.message || 'Network error.');
    } finally {
      setCreatingPartyLoading(false);
      setCreateStep('');
    }
  };

  const handleRequestAssignment = async () => {
    if (!existingPartyId || existingPartyId === 'duplicate') return;
    setAssignmentSubmitting(true);
    setFormError('');
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
      setFormError(err.message || 'Error sending request.');
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
      Alert.alert('Already Visited', `You have already visited "${name(party.partyName)}" today.`);
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
          // Checked in is one question; a usable id is another. A stale id
          // must not stop a visit — it only costs the link to the day's log.
          const logId = await getActiveLogId();
          if (!(await hasActiveLog())) {
            Alert.alert(
              'Attendance not marked',
              'Mark your attendance first. A visit is part of a working day, so the day has to be started before one can be recorded.'
            );
            setVisitStartingId(null);
            return;
          }

          /**
           * Where the visitor actually is, read before the visit is claimed.
           *
           * The server decides whether that is close enough — the phone only
           * reports its position. Checking here as well would just be a second
           * opinion that a modified app could skip.
           */
          let here;
          try {
            here = await getCurrentLocation();
          } catch (locationError) {
            Alert.alert('Location needed', locationError.message);
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
              shopPhoto: await uploadPhoto({ base64: base64Photo, apiUrl, token, module: 'visits' }),
              logId,
              // The server checks this against the shop's own coordinates and
              // refuses a visit started from somewhere else.
              latitude: here.latitude,
              longitude: here.longitude,
            }),
          });

          const startData = await startRes.json();
          // Being too far away is a normal situation, not a failure to report
          // as one — it gets its own message rather than "Visit Failed".
          if (!startRes.ok && startData?.data?.reason === 'attendance_required') {
            Alert.alert('Attendance not marked', startData.message);
            setVisitStartingId(null);
            return;
          }
          if (!startRes.ok && startData?.data?.reason === 'too_far_from_party') {
            Alert.alert(
              'Too far from the shop',
              startData.message,
              [{ text: 'OK' }],
            );
            setVisitStartingId(null);
            return;
          }
          if (startRes.ok) {
            Alert.alert('Visit Started', `Your visit at "${name(party.partyName)}" is now active!`);
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
          // A shop the office has not accepted yet. Red, because an order
          // against it will be refused and the salesman should see that from
          // the list rather than at the till.
          item.approvalStatus === 'pending' && styles.partyCardWaiting,
          item.approvalStatus === 'rejected' && styles.partyCardRejected,
        ]}
        key={item._id}
        onPress={() => setSelectedProfilePartyId(item._id)}
      >
        <View style={styles.cardHeader}>
          <View style={{ flex: 1 }}>
            <View style={styles.nameRow}>
              <Text style={name(styles.partyName)}>{name(item.partyName)}</Text>
              {item.visitedToday && (
                <View style={styles.visitedBadge}>
                  <Text style={styles.visitedBadgeText}>✓ Visited</Text>
                </View>
              )}
              {item.approvalStatus === 'pending' && (
                <View style={styles.waitingBadge}>
                  <Text style={styles.waitingBadgeText}>Waiting for approval</Text>
                </View>
              )}
              {item.approvalStatus === 'rejected' && (
                <View style={styles.rejectedBadge}>
                  <Text style={styles.rejectedBadgeText}>Not accepted</Text>
                </View>
              )}
            </View>
            <Text style={styles.partyCode}>Code: {item.partyCode || 'Generating...'}</Text>
          </View>

          {/*
            The pin sits in the corner rather than in the button row below.
            It is a shortcut, not one of the card's main actions, and putting
            it beside Order and Collect would give it the same weight as them.

            `stopPropagation` matters: the whole card opens the profile, and
            without it a tap here would do both.
          */}
          <TouchableOpacity
            style={[styles.mapPinBtn, !partyCoordinates(item) && styles.mapPinBtnMuted]}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            onPress={(event) => {
              event.stopPropagation();
              openPartyOnMap(item, name(item.partyName));
            }}
          >
            <Text style={styles.mapPinBtnText}>📍</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.cardBody}>
          <Text style={styles.partyDetail}>📞 Mobile: <Text style={styles.bold}>{item.mobile}</Text></Text>
          {item.ownerName ? (
            <Text style={styles.partyDetail}>👤 Owner: <Text style={styles.bold}>{name(item.ownerName)}</Text></Text>
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

  /**
   * The hardware back button, while a party profile is open inside this screen.
   *
   * This screen shows the profile itself rather than asking App to change
   * screens, so App still believes we are on the list and its own back handler
   * takes us to the home tab. Handled here, where the state actually lives.
   *
   * Registered only while the profile is open, and Android calls the most
   * recently added handler first, so this runs before App's and stops there.
   */
  useEffect(() => {
    if (!selectedProfilePartyId) return undefined;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setSelectedProfilePartyId(null);
      return true;
    });
    return () => subscription.remove();
  }, [selectedProfilePartyId]);

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
        onNavigateToCollection={(party) => {
          setSelectedProfilePartyId(null);
          onNavigateToCollection && onNavigateToCollection(party);
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
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onPullRefresh} colors={['#00796B']} tintColor="#00796B" />
        }
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
                <Text style={styles.retryBtnText}>{t('Retry')}</Text>
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
        onRequestClose={closeAddPartyModal}
      >
        <SafeAreaView style={styles.modalSafeArea}>
          <View style={styles.modalWrapper}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitleText}>Add New Party</Text>
              <TouchableOpacity style={styles.closeXBtn} onPress={closeAddPartyModal}>
                <Text style={styles.closeXText}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.modalFormContent}>
              {formError ? <Text style={styles.errorText}>{formError}</Text> : null}
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

              {/*
                The GPS pin is normally taken the moment the photo is, but a
                fix indoors or under a roof often does not arrive in time. The
                photo is fine — only the pin failed — so retrying must not mean
                walking back out and taking the picture again.
              */}
              {newPartyPhoto ? (
                <View style={styles.gpsBlock}>
                  <Text style={styles.gpsStatusText}>
                    {fetchingLocation
                      ? (locationStatusText || 'Getting precise location…')
                      : hasPin
                        ? `📍 Location pinned${locationAccuracy ? ` · accurate to about ${Math.round(locationAccuracy)}m` : ''}`
                        : '📍 No location yet — the shop photo is saved, so just fetch the pin again.'}
                  </Text>

                  <TouchableOpacity
                    style={[styles.gpsRetryBtn, fetchingLocation && styles.disabledBtn]}
                    onPress={startPreciseLocationCapture}
                    disabled={fetchingLocation}
                  >
                    {fetchingLocation ? (
                      <View style={styles.row}>
                        <ActivityIndicator color="#FFFFFF" size="small" style={{ marginRight: 8 }} />
                        <Text style={styles.gpsRetryBtnText}>Getting location…</Text>
                      </View>
                    ) : (
                      <Text style={styles.gpsRetryBtnText}>
                        {hasPin ? '🎯 Pin location again' : '🎯 Get GPS location'}
                      </Text>
                    )}
                  </TouchableOpacity>

                  {locationWarning ? (
                    <Text style={styles.gpsWarningText}>{locationWarning}</Text>
                  ) : null}
                </View>
              ) : null}

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
                  <Text style={styles.locationError}>No location yet. Tap Retry, or take the shop front photo — that captures one too.</Text>
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

              <Text style={styles.fieldLabel}>{t('Payment Terms')}</Text>
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

            {/* Why the button is not available yet, said once, above it. */}
            {!canSubmitParty && (
              <Text style={styles.submitBlockedNote}>
                {fetchingLocation
                  ? 'Pinning the exact shop location — hold still for a moment.'
                  : newPartyPhoto
                    ? 'The photo is saved. Tap "Get GPS location" above — near a window or outside works best.'
                    : 'Take the shop front photo to capture the GPS pin. A party cannot be created without it.'}
              </Text>
            )}

            {/* Bottom Actions Row */}
            <View style={styles.modalActionsFooter}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={closeAddPartyModal}
              >
                <Text style={styles.cancelBtnText}>{t('Cancel')}</Text>
              </TouchableOpacity>

              {/* A party without a pin is a party nobody can be routed to or
                  visit-verified against, so the button waits for one. */}
              <TouchableOpacity
                style={[styles.submitBtn, !canSubmitParty && styles.submitBtnDisabled]}
                onPress={handleCreateParty}
                disabled={!canSubmitParty}
              >
                {fetchingLocation ? (
                  <View style={styles.row}>
                    <ActivityIndicator color="#FFFFFF" size="small" style={{ marginRight: 8 }} />
                    <Text style={styles.submitBtnText}>{t('Getting location…')}</Text>
                  </View>
                ) : (
                  <Text style={styles.submitBtnText}>
                    {hasPin ? 'Create Party' : 'Location needed'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </SafeAreaView>
      </Modal>

      {/* Frosted, non-cancellable overlay while the party is being saved. The
          form stays visible behind it but is unreachable, so it is obvious the
          app is working rather than stuck. */}
      <Modal
        visible={creatingPartyLoading}
        transparent
        animationType="fade"
        onRequestClose={() => {}}
      >
        <View style={styles.savingScrim}>
          <View style={styles.savingCard}>
            <ActivityIndicator color="#00796B" size="large" />
            <Text style={styles.savingTitle}>{t('Creating party')}</Text>
            <Text style={styles.savingStep}>{createStep || 'Starting…'}</Text>

            <View style={styles.progressTrack}>
              <Animated.View
                style={[
                  styles.progressFill,
                  {
                    width: createProgress.interpolate({
                      inputRange: [0, 1],
                      outputRange: ['0%', '100%'],
                    }),
                  },
                ]}
              />
            </View>

            <Text style={styles.savingHint}>Please keep the app open.</Text>
          </View>
        </View>
      </Modal>

      {/* Confirmation, with the pin that was recorded */}
      <Modal
        visible={!!createdParty}
        transparent
        animationType="fade"
        onRequestClose={() => setCreatedParty(null)}
      >
        <View style={styles.savingScrim}>
          <View style={styles.createdCard}>
            <View style={styles.createdTick}><Text style={styles.createdTickText}>✓</Text></View>
            <Text style={styles.createdTitle}>{t('Party created')}</Text>
            <Text style={styles.createdName}>{name(createdParty?.partyName)}</Text>
            {!!createdParty?.mobile && <Text style={styles.createdSub}>📱 {createdParty.mobile}</Text>}
            {!!(createdParty?.area || createdParty?.city) && (
              <Text style={styles.createdSub}>
                {[createdParty.area, createdParty.city].filter(Boolean).join(', ')}
              </Text>
            )}
            {createdParty?.latitude != null && (
              <Text style={styles.createdPin}>
                📍 Pinned at {createdParty.latitude.toFixed(5)}, {createdParty.longitude.toFixed(5)}
                {createdParty.accuracy ? ` (~${Math.round(createdParty.accuracy)}m)` : ''}
              </Text>
            )}

            <TouchableOpacity style={styles.createdBtn} onPress={() => setCreatedParty(null)}>
              <Text style={styles.createdBtnText}>{t('Done')}</Text>
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
  partyCardWaiting: {
    borderColor: '#FC8181',
    borderWidth: 1.5,
    backgroundColor: '#FFF5F5',
  },
  partyCardRejected: {
    borderColor: '#C53030',
    borderWidth: 1.5,
    backgroundColor: '#FFF5F5',
  },
  waitingBadge: {
    backgroundColor: '#FED7D7',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  waitingBadgeText: {
    color: '#C53030',
    fontSize: 10,
    fontWeight: '900',
  },
  rejectedBadge: {
    backgroundColor: '#C53030',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  rejectedBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '900',
  },
  partyCardVisited: {
    borderColor: '#38A169',
    borderWidth: 1.5,
    backgroundColor: '#F0FFF4',
  },
  mapPinBtn: {
    width: scale(30),
    height: scale(30),
    borderRadius: scale(15),
    backgroundColor: '#EBF4FF',
    borderWidth: 1,
    borderColor: '#BEE3F8',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: scale(8),
  },
  mapPinBtnMuted: { opacity: 0.35 },
  mapPinBtnText: { fontSize: responsiveFontSize(13) },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    // Top, not centre: the pin belongs in the corner, and a long party name
    // wrapping to two lines would otherwise drag it down the card.
    alignItems: 'flex-start',
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
  gpsBlock: { marginTop: 10, marginBottom: 4 },
  gpsStatusText: { fontSize: responsiveFontSize(11), color: '#4A5568', marginBottom: 6 },
  gpsRetryBtn: {
    backgroundColor: '#3182CE',
    paddingVertical: verticalScale(10),
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gpsRetryBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: responsiveFontSize(12) },
  gpsWarningText: { fontSize: responsiveFontSize(10), color: '#D69E2E', marginTop: 6 },
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
    // Pinned to the bottom of a full-screen modal, so it clears the system
    // navigation bar rather than sitting under it.
    paddingBottom: scale(16) + bottomBarPadding(),
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
  submitBtnDisabled: {
    backgroundColor: '#B2C7C4',
  },
  submitBlockedNote: {
    paddingHorizontal: scale(16),
    paddingTop: verticalScale(8),
    fontSize: responsiveFontSize(11),
    color: '#C05621',
    textAlign: 'center',
  },

  savingScrim: {
    flex: 1,
    // Heavy frosted wash rather than a plain dim: the form stays readable
    // behind it, which makes the wait feel like part of the same screen.
    backgroundColor: 'rgba(247, 249, 252, 0.94)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: scale(24),
  },
  savingCard: {
    width: '88%',
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: scale(24),
    alignItems: 'center',
    gap: verticalScale(10),
    shadowColor: '#000',
    shadowOpacity: 0.14,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  savingTitle: {
    fontSize: responsiveFontSize(16),
    fontWeight: '800',
    color: '#1A202C',
  },
  savingStep: {
    fontSize: responsiveFontSize(13),
    color: '#4A5568',
  },
  progressTrack: {
    width: '100%',
    height: 8,
    borderRadius: 999,
    backgroundColor: '#EDF2F7',
    overflow: 'hidden',
    marginTop: verticalScale(4),
  },
  progressFill: {
    height: 8,
    borderRadius: 999,
    backgroundColor: '#00796B',
  },
  savingHint: {
    fontSize: responsiveFontSize(11),
    color: '#A0AEC0',
  },

  createdCard: {
    width: '88%',
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: scale(24),
    alignItems: 'center',
    gap: verticalScale(6),
    shadowColor: '#000',
    shadowOpacity: 0.14,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  createdTick: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#E6F6EF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: verticalScale(6),
  },
  createdTickText: { fontSize: 30, color: '#00796B', fontWeight: '800' },
  createdTitle: { fontSize: responsiveFontSize(17), fontWeight: '800', color: '#1A202C' },
  createdName: { fontSize: responsiveFontSize(15), fontWeight: '700', color: '#00796B', textAlign: 'center' },
  createdSub: { fontSize: responsiveFontSize(12), color: '#4A5568' },
  createdPin: {
    fontSize: responsiveFontSize(11),
    color: '#718096',
    marginTop: verticalScale(4),
    textAlign: 'center',
  },
  createdBtn: {
    marginTop: verticalScale(14),
    alignSelf: 'stretch',
    backgroundColor: '#00796B',
    paddingVertical: verticalScale(13),
    borderRadius: 10,
    alignItems: 'center',
  },
  createdBtnText: { color: '#FFFFFF', fontWeight: '800', fontSize: responsiveFontSize(14) },

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
