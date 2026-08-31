import React, { useState, useEffect, useCallback } from 'react';
import { getCurrentLocation } from '../services/currentLocation';
import { getActiveLogId, hasActiveLog } from '../services/activeLog';
import VisitOutcomeSheet from '../components/VisitOutcomeSheet';
import { openPartyOnMap } from '../services/openOnMap';
import { useLanguage } from '../i18n';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ActivityIndicator,
  SafeAreaView,
  ScrollView,
  RefreshControl,
  Alert,
} from 'react-native';
import { scale, verticalScale, responsiveFontSize, maxContainerWidth } from '../utils/responsive';
import { launchCamera } from 'react-native-image-picker';
import { uploadPhoto } from '../services/photoUpload';
import { startVisitTracking, stopVisitTracking, endVisit, resumeVisitTracking, getActiveVisit, getVisitedToday, markVisitedToday } from '../services/activeVisit';

export default function BeatPlanScreen({
  token,
  apiUrl,
  activeLogId,
  user,
  onNavigateToPartyProfile,
  onNavigateToOrder,
}) {
  const { t, term, name } = useLanguage();
  const [activeTab, setActiveTab] = useState('serving'); // 'serving' or 'skip'
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Today's beat plan state
  const [todayBeat, setTodayBeat] = useState(null);
  // Where the salesman is, used only to order the list nearest-first.
  const [myLocation, setMyLocation] = useState(null);
  const [outcomeParty, setOutcomeParty] = useState(null);
  const [startedVisit, setStartedVisit] = useState(null);
  const [savingOutcome, setSavingOutcome] = useState(false);
  const [todayStatus, setTodayStatus] = useState(''); // 'weekly_off', 'holiday', 'no_plan' etc.
  const [todayReason, setTodayReason] = useState('');

  // Skipped beats list
  // Parties still owed a visit, worked out by the server from the beat ledger
  // and the visits that actually happened.
  const [pendingParties, setPendingParties] = useState([]);
  const [pendingLoading, setPendingLoading] = useState(false);
  const [visitStartingId, setVisitStartingId] = useState(null);

  const getLocalDateString = (date) => {
    const offset = date.getTimezoneOffset();
    const localDate = new Date(date.getTime() - offset * 60 * 1000);
    return localDate.toISOString().split('T')[0];
  };

  const todayStr = getLocalDateString(new Date());

  // 1. Fetch Today's Beat Plan
  const fetchTodayBeat = async () => {
    if (!token || !activeLogId) {
      setLoading(false);
      setRefreshing(false);
      return;
    }
    setLoading(true);
    try {
      const response = await fetch(`${apiUrl}/beat-plan/my/today`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (response.ok && data.success) {
        if (data.data.cyclePaused) {
          setTodayStatus(data.data.status);
          setTodayReason(data.data.reason || '');
          setTodayBeat(null);
        } else {
          setTodayBeat(data.data);
          setTodayStatus('');
          setTodayReason('');
        }
      } else {
        setTodayBeat(null);
        setTodayStatus('no_plan');
      }
    } catch (e) {
      console.warn('Today beat fetch error:', e.message);
      setTodayBeat(null);
      setTodayStatus('error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'serving') {
      fetchTodayBeat();
    } else {
      fetchPendingParties();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, activeLogId, token, apiUrl]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    if (activeTab === 'serving') {
      fetchTodayBeat();
    } else {
      fetchPendingParties().finally(() => setRefreshing(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, activeLogId, token, apiUrl]);

  /**
   * The visit currently open, if any.
   *
   * Only one can run at a time, so this drives the whole button: the party it
   * belongs to shows End Visit, every other party's Start Visit is disabled,
   * and a party already done shows the green completed label instead.
   */
  const [activeVisit, setActiveVisit] = useState(null);
  const [endingVisit, setEndingVisit] = useState(false);
  // Parties finished on this phone today. Merged with the server's own flag so
  // the button disappears immediately, without waiting for a refresh.
  const [visitedLocally, setVisitedLocally] = useState([]);

  const handleVisitClosed = useCallback((info) => {
    setActiveVisit((current) => {
      const partyId = current?.partyId?._id || current?.partyId;
      if (partyId) {
        markVisitedToday(partyId);
        setVisitedLocally((list) => [...new Set([...list, String(partyId)])]);
      }
      return null;
    });
    fetchTodayBeat();
    Alert.alert(
      info?.alreadyClosed ? 'Visit Closed' : 'Visit Ended',
      info?.alreadyClosed
        ? 'This visit was already closed.'
        : 'You left the shop, so the visit was completed automatically.',
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Picks up a visit left open when the app was last closed, so force-quitting
  // mid-visit does not strand it showing Start Visit again.
  useEffect(() => {
    let alive = true;
    (async () => {
      const cached = await getActiveVisit();
      if (alive && cached) setActiveVisit(cached);
      const done = await getVisitedToday();
      if (alive) setVisitedLocally(done);
      const logId = await getActiveLogId();
      const ongoing = await resumeVisitTracking({ apiUrl, token, logId, onClosed: handleVisitClosed });
      if (alive) setActiveVisit(ongoing);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiUrl, token]);

  const handleEndVisit = async () => {
    if (!activeVisit) return;
    setEndingVisit(true);
    try {
      await endVisit({ apiUrl, token, visitId: activeVisit._id });
      const partyId = activeVisit.partyId?._id || activeVisit.partyId;
      await markVisitedToday(partyId);
      setVisitedLocally((list) => [...new Set([...list, String(partyId)])]);
      setActiveVisit(null);
      fetchTodayBeat();
      Alert.alert('Visit Completed', 'Your visit has been recorded.');
    } catch (err) {
      Alert.alert('Could not end the visit', err.message || 'Network error.');
    } finally {
      setEndingVisit(false);
    }
  };

  // Start Visit handler
  /**
   * Tapping Start Visit asks the outcome first.
   *
   * Asking before the visit rather than after is deliberate: afterwards the
   * salesman is already walking to the next shop and the honest answer is the
   * one nobody stops to give.
   */
  /**
   * The nearest shop first.
   *
   * A beat is walked, not read in the order it was typed. Sorting by straight
   * -line distance is enough here — over a few streets it agrees with the
   * walking order, and it needs no routing service.
   *
   * A party with no coordinates keeps its original place at the end rather
   * than being dropped: it still has to be visited.
   */
  const metresBetween = (a, b) => {
    const toRad = (deg) => (deg * Math.PI) / 180;
    const R = 6371000;
    const dLat = toRad(b.latitude - a.latitude);
    const dLng = toRad(b.longitude - a.longitude);
    const h = Math.sin(dLat / 2) ** 2
      + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  };

  const orderedParties = (() => {
    const entries = todayBeat?.parties || [];

    /**
     * What is left to do, nearest first; what is finished, underneath.
     *
     * Two separate questions, so they are sorted separately. A shop still to
     * visit is ranked by how far away it is — that is what decides where he
     * walks next. A shop already done is ranked by when he did it, because the
     * only thing that list is good for is reading back the day in order.
     *
     * Sorting happens with or without a GPS fix: without one the pending shops
     * simply keep the order the route gave them, but the finished ones still
     * drop to the bottom, which is the part that matters on screen.
     */
    const decorated = entries.map((entry) => {
      const loc = entry.partyId?.location;
      const distance = myLocation && loc?.latitude != null && loc?.longitude != null
        ? metresBetween(myLocation, loc)
        : null;

      // Either source counts: the server's flag, or a visit this phone
      // finished a moment ago and the server has not been asked about yet.
      const done = Boolean(entry.visitedToday)
        || visitedLocally.includes(String(entry.partyId?._id || entry.partyId));

      return {
        entry,
        distance,
        done,
        visitedAt: entry.visitedAt ? new Date(entry.visitedAt).getTime() : null,
      };
    });

    const pending = decorated
      .filter((row) => !row.done)
      .sort((a, b) => {
        if (a.distance == null && b.distance == null) return 0;
        if (a.distance == null) return 1;
        if (b.distance == null) return -1;
        return a.distance - b.distance;
      });

    const finished = decorated
      .filter((row) => row.done)
      .sort((a, b) => {
        // Oldest first, so the list reads as the day happened. A visit with no
        // recorded time goes last rather than jumping to the front.
        if (a.visitedAt == null && b.visitedAt == null) return 0;
        if (a.visitedAt == null) return 1;
        if (b.visitedAt == null) return -1;
        return a.visitedAt - b.visitedAt;
      });

    return [...pending, ...finished].map(({ entry, distance, done }) => ({
      ...entry,
      distanceFromMe: distance,
      isDone: done,
    }));
  })();

  /**
   * Tapping Start Visit takes the photo and opens the visit; the outcome is
   * asked straight afterwards.
   *
   * Asking first meant a salesman could answer for a visit that then failed to
   * start — a wasted answer, and a confusing one. The visit now exists before
   * the question, so the answer always has something to attach to.
   */
  const handleStartVisit = async (party) => {
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
          // The day was never started. The server is the authority here — the
          // phone's own idea of being on duty can be stale.
          if (!startRes.ok && startData?.data?.reason === 'attendance_required') {
            Alert.alert('Attendance not marked', startData.message);
            setVisitStartingId(null);
            return;
          }
          // He has an earlier visit he never answered for. Refusing is not
          // enough — reopen that question so he can clear it and carry on.
          if (!startRes.ok && startData?.data?.reason === 'unanswered_visit') {
            Alert.alert('One visit still open', startData.message);
            await askAboutUnansweredVisit();
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
            const visit = startData.data;
            setActiveVisit(visit);
            // Pinging from here is what makes the server's auto-departure work;
            // without it nothing ever told the server he had walked away.
            await startVisitTracking({ apiUrl, token, visit, logId, onClosed: handleVisitClosed });
            fetchTodayBeat(); // reload list

            // The visit is live; now ask what came of it.
            setStartedVisit(visit);
            setOutcomeParty(party);
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

  useEffect(() => {
    let alive = true;
    getCurrentLocation({ timeout: 15000 })
      .then((here) => { if (alive) setMyLocation(here); })
      .catch(() => { /* no pin, no sorting — the list still works */ });
    return () => { alive = false; };
  }, []);

  /**
   * Saves the answer against the visit that was just opened.
   *
   * A failure here leaves the visit alone — it is already running, and losing
   * the outcome is far better than losing the visit.
   */
  const saveVisitOutcome = async (outcome) => {
    if (!startedVisit) return;
    setSavingOutcome(true);
    try {
      const response = await fetch(`${apiUrl}/visit/${startedVisit._id}/outcome`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(outcome),
      });
      /**
       * A server without this endpoint yet must not block the salesman.
       *
       * The visit is already running and is the part that matters; the answer
       * is a note on top of it. Against an older server the note is lost and
       * everything else carries on, rather than showing an error for something
       * he cannot do anything about.
       */
      const data = await response.json().catch(() => ({}));
      if (!response.ok && response.status !== 404) {
        throw new Error(data.message || 'Could not save that.');
      }

      /**
       * The issue is raised after the answer is saved, and separately.
       *
       * If it fails, the visit and its reason are already recorded — the worst
       * case is a lost ticket, not a lost visit. He is told either way, so he
       * can raise it again from the party profile rather than assuming the
       * office has heard about it.
       */
      let issueNumber = '';
      if (outcome.issue && startedVisit) {
        try {
          const issueRes = await fetch(`${apiUrl}/feedback`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({
              type: 'issue',
              targetType: 'party',
              partyId: outcomeParty?._id,
              visitId: startedVisit._id,
              category: outcome.issue.category,
              priority: 'medium',
              subject: outcome.issue.subject,
              description: outcome.issue.description,
            }),
          });
          const issueData = await issueRes.json().catch(() => ({}));
          if (issueRes.ok && issueData.success) issueNumber = issueData.data?.issueNumber || 'Issue';
          else throw new Error(issueData.message || 'could not be raised');
        } catch (issueError) {
          Alert.alert(
            'Visit saved, issue not raised',
            `Your answer was recorded. The issue could not be sent (${issueError.message}). Raise it from the party profile when you have signal.`
          );
        }
      }

      const party = outcomeParty;
      setOutcomeParty(null);
      setStartedVisit(null);

      // He said an order is coming, so take him straight to writing it rather
      // than making him find the party again.
      if (outcome.orderReceived && onNavigateToOrder && party) {
        onNavigateToOrder(party);
      } else {
        Alert.alert(
          issueNumber ? `Visit started · ${issueNumber} raised` : 'Visit Started',
          `You are now visiting "${name(party?.partyName || party?.name || '')}". Tap End Visit when you leave, or it will close itself once you are away from the shop.`
        );
      }
    } catch (err) {
      Alert.alert('Could not save', err.message);
    } finally {
      setSavingOutcome(false);
    }
  };

  /**
   * Brings back the question for a visit that was never answered.
   *
   * The server will not let him start another visit until it is answered, so
   * the app has to give him somewhere to answer it rather than just refusing.
   * Checked whenever the beat plan is shown.
   */
  const askAboutUnansweredVisit = async () => {
    try {
      const response = await fetch(`${apiUrl}/visit/my/today`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) return;
      const data = await response.json();
      const visits = Array.isArray(data.data) ? data.data : [];
      const pending = visits.find((visit) => visit.orderReceived === null || visit.orderReceived === undefined);
      if (!pending) return;

      setStartedVisit(pending);
      setOutcomeParty(pending.partyId?._id ? pending.partyId : { _id: pending.partyId, partyName: '' });
    } catch {
      // Offline or an older server: nothing to ask about right now.
    }
  };

  useEffect(() => {
    askAboutUnansweredVisit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiUrl, token]);

  /**
   * The shops he still owes a visit.
   *
   * This used to be worked out on the phone from attendance alone, which meant
   * it listed skipped *days* rather than un-visited *shops*, and a party he had
   * since gone back to still showed as outstanding. The server has the beat
   * ledger and every visit, so it can answer the real question.
   */
  const fetchPendingParties = async () => {
    setPendingLoading(true);
    try {
      const response = await fetch(`${apiUrl}/beat-plan/my/pending`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) { setPendingParties([]); return; }
      const data = await response.json();
      setPendingParties(Array.isArray(data.data) ? data.data : []);
    } catch {
      // Offline, or a server without this yet: the tab simply shows nothing.
      setPendingParties([]);
    } finally {
      setPendingLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'skip') fetchPendingParties();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, apiUrl, token]);

  const isOnline = activeLogId !== null;

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Asked before the visit begins; the answer travels with it. */}
      <VisitOutcomeSheet
        visible={!!outcomeParty && !!startedVisit}
        partyName={outcomeParty ? name(outcomeParty.partyName || outcomeParty.name) : ''}
        busy={savingOutcome}
        mandatory
        onCancel={() => { setOutcomeParty(null); setStartedVisit(null); }}
        onSubmit={saveVisitOutcome}
      />

      {/* Header */}
      <View style={styles.topHeader}>
        <Text style={styles.topHeaderTitle}>Beat Routes & Plans</Text>
      </View>

      {/* Tabs */}
      <View style={styles.tabRow}>
        <TouchableOpacity
          style={[styles.tabBtn, activeTab === 'serving' && styles.activeTabBtn]}
          onPress={() => setActiveTab('serving')}
        >
          <Text style={[styles.tabBtnText, activeTab === 'serving' && styles.activeTabBtnText]}>
            Serving Beat Plan
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabBtn, activeTab === 'skip' && styles.activeTabBtn]}
          onPress={() => setActiveTab('skip')}
        >
          <Text style={[styles.tabBtnText, activeTab === 'skip' && styles.activeTabBtnText]}>
            Skip Beat Plan
          </Text>
        </TouchableOpacity>
      </View>

      {/* Main Content scrollable */}
      {!isOnline && activeTab === 'serving' ? (
        <View style={styles.offlineBox}>
          <Text style={styles.lockIcon}>🔒</Text>
          <Text style={styles.offlineTitle}>Check-In Required</Text>
          <Text style={styles.offlineDesc}>
            Please mark your attendance check-in first to unlock and start today's beat plan.
          </Text>
        </View>
      ) : loading && !refreshing ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#00796B" />
          <Text style={styles.loadingText}>Syncing beat plan details...</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#00796B']} />
          }
        >
          {activeTab === 'serving' ? (
            todayBeat ? (
              <View>
                {/* Beat Meta Banner */}
                <View style={styles.beatBanner}>
                  <Text style={styles.beatBannerTitle}>
                    📅 Day {todayBeat.cycleDay} • Route Plan
                  </Text>
                  <Text style={styles.beatBannerArea}>Area: {todayBeat.area || 'General'}</Text>
                  <Text style={styles.beatBannerCount}>
                    {todayBeat.totalParties} customer(s) scheduled
                  </Text>
                </View>

                {/* Scheduled Party Cards */}
                <View style={styles.partyList}>
                  {orderedParties.map((entry) => {
                    /**
                     * `party` is the shop; `entry` is the shop's place on the
                     * route. Whether it has been visited, and when, belong to
                     * the entry — reading them off `party` silently returns
                     * undefined, which is why a finished shop kept offering
                     * "Start Visit" as though it had never been called on.
                     */
                    const party = entry.partyId;
                    if (!party) return null;
                    const isDone = entry.isDone;
                    const visitedAt = entry.visitedAt;

                    return (
                      <View key={party._id} style={[styles.partyCard, isDone && styles.partyCardDone]}>
                        <View style={styles.partyHeader}>
                          <View style={{ flex: 1 }}>
                            <Text style={name(styles.partyName)}>{name(party.partyName || party.name)}</Text>
                            <Text style={styles.partyCode}>Code: {party.partyCode}</Text>
                            {entry.distanceFromMe != null && (
                              <Text style={styles.partyDistance}>
                                {entry.distanceFromMe < 1000
                                  ? `📍 ${Math.round(entry.distanceFromMe)}m away`
                                  : `📍 ${(entry.distanceFromMe / 1000).toFixed(1)}km away`}
                              </Text>
                            )}
                          </View>
                          {isDone && (
                            <View style={styles.visitedBadge}>
                              <Text style={styles.visitedBadgeText}>✓ Visited</Text>
                            </View>
                          )}
                        </View>

                        <Text style={styles.partyDetail}>👤 Owner: {party.ownerName || '—'}</Text>
                        <Text style={styles.partyDetail}>📞 Contact: {party.mobile}</Text>
                        <Text style={styles.partyDetail}>📍 Address: {party.address}</Text>

                        <View style={styles.divider} />

                        {/* Action buttons */}
                        <View style={styles.btnRow}>
                          <TouchableOpacity
                            style={styles.viewBtn}
                            onPress={() => onNavigateToPartyProfile && onNavigateToPartyProfile(party._id)}
                          >
                            <Text style={styles.viewBtnText}>👤 View Party</Text>
                          </TouchableOpacity>

                          {/* Hands the pin to the phone's map app, which is the
                              only thing that can actually walk him there. */}
                          <TouchableOpacity
                            style={styles.mapBtn}
                            onPress={() => openPartyOnMap(party, name(party.partyName || party.name))}
                          >
                            <Text style={styles.mapBtnText}>🗺️ Map</Text>
                          </TouchableOpacity>

                          {(() => {
                            const visitingHere = activeVisit
                              && String(activeVisit.partyId?._id || activeVisit.partyId) === String(party._id);
                            const busyElsewhere = Boolean(activeVisit) && !visitingHere;

                            // Decided once, when the list was ordered, so the
                            // card and the sorting can never disagree.
                            const doneToday = isDone;
                            if (doneToday && !visitingHere) {
                              return (
                                <View style={styles.visitedLabel}>
                                  <Text style={styles.visitedLabelText}>
                                    ✓ Visit Complete
                                    {visitedAt
                                      ? ` · ${new Date(visitedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                                      : ''}
                                  </Text>
                                </View>
                              );
                            }

                            // The one open visit: the only thing offered is ending it.
                            if (visitingHere) {
                              return (
                                <TouchableOpacity
                                  style={[styles.endVisitBtn, endingVisit && styles.disabledBtn]}
                                  onPress={handleEndVisit}
                                  disabled={endingVisit}
                                >
                                  {endingVisit ? (
                                    <ActivityIndicator color="#fff" size="small" />
                                  ) : (
                                    <Text style={styles.visitBtnText}>🚪 End Visit</Text>
                                  )}
                                </TouchableOpacity>
                              );
                            }

                            return (
                              <TouchableOpacity
                                style={[styles.visitBtn, (visitStartingId === party._id || busyElsewhere) && styles.disabledBtn]}
                                onPress={() => handleStartVisit(party)}
                                disabled={visitStartingId === party._id || busyElsewhere}
                              >
                                {visitStartingId === party._id ? (
                                  <ActivityIndicator color="#fff" size="small" />
                                ) : (
                                  <Text style={styles.visitBtnText}>
                                    {busyElsewhere ? '⏳ Finish current visit' : '📍 Start Visit'}
                                  </Text>
                                )}
                              </TouchableOpacity>
                            );
                          })()}
                        </View>
                      </View>
                    );
                  })}
                </View>
              </View>
            ) : (
              <View style={styles.emptyBox}>
                <Text style={styles.emptyIcon}>🏖️</Text>
                <Text style={styles.emptyTitle}>
                  {todayStatus === 'weekly_off'
                    ? 'Weekly Off Today'
                    : todayStatus === 'holiday'
                    ? 'Company Holiday'
                    : 'No Beat Planned'}
                </Text>
                <Text style={styles.emptyDesc}>
                  {todayStatus === 'weekly_off'
                    ? `Enjoy your weekly off! Reason: ${todayReason || 'Scheduled off'}`
                    : todayStatus === 'holiday'
                    ? `Reason: ${todayReason || 'Festive/National holiday'}`
                    : 'No routes or beat plans have been scheduled for today.'}
                </Text>
              </View>
            )
          ) : (
            /*
              Shops he still owes a visit.

              One row per shop rather than one card per skipped day: the same
              shop missed on three different days is still one shop to go and
              see, and listing it three times only makes the list look worse
              than the work actually is.
            */
            <View>
              {pendingLoading ? (
                <View style={styles.centered}>
                  <ActivityIndicator size="large" color="#2C5282" />
                  <Text style={styles.loadingText}>Working out what is still owed…</Text>
                </View>
              ) : pendingParties.length === 0 ? (
                <View style={styles.emptyBox}>
                  <Text style={styles.emptyIcon}>🎉</Text>
                  <Text style={styles.emptyTitle}>Nothing pending</Text>
                  <Text style={styles.emptyDesc}>
                    Every shop on your beat has been visited. Anything you missed has been covered.
                  </Text>
                </View>
              ) : (
                <View style={styles.skippedList}>
                  <Text style={styles.sectionTitle}>
                    Still to visit ({pendingParties.length})
                  </Text>
                  <Text style={styles.pendingHint}>
                    These shops were on your beat on the dates shown and have not been visited since.
                  </Text>

                  {pendingParties.map((row) => {
                    const party = row.party;
                    const due = new Date(`${row.dueDate}T00:00:00`);
                    const daysLate = Math.max(
                      0,
                      Math.round((Date.now() - due.getTime()) / (24 * 60 * 60 * 1000))
                    );

                    return (
                      <View key={String(party._id)} style={styles.skippedCard}>
                        <View style={styles.skippedHeader}>
                          <View style={{ flex: 1 }}>
                            <Text style={name(styles.skippedPartyName)}>{name(party.partyName)}</Text>
                            <Text style={styles.skippedDayLbl}>
                              {party.partyCode ? `${party.partyCode} · ` : ''}
                              {party.area || party.city || 'No area'}
                            </Text>
                          </View>
                          <View style={styles.skippedBadge}>
                            <Text style={styles.skippedBadgeText}>
                              {daysLate <= 1 ? 'YESTERDAY' : `${daysLate} DAYS`}
                            </Text>
                          </View>
                        </View>

                        <Text style={styles.skippedArea}>
                          📅 Due {due.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                          {row.cycleDay ? ` · Beat day ${row.cycleDay}` : ''}
                          {row.timesMissed > 1 ? ` · missed ${row.timesMissed} times` : ''}
                        </Text>
                        {row.dayReason ? (
                          <Text style={styles.pendingReason}>{row.dayReason}</Text>
                        ) : null}

                        <View style={styles.divider} />

                        <View style={styles.pendingActions}>
                          <TouchableOpacity
                            style={styles.skippedPartyViewBtn}
                            onPress={() => onNavigateToPartyProfile && onNavigateToPartyProfile(party._id)}
                          >
                            <Text style={styles.skippedPartyViewText}>👤 View</Text>
                          </TouchableOpacity>

                          <TouchableOpacity
                            style={styles.mapBtn}
                            onPress={() => openPartyOnMap(party, name(party.partyName))}
                          >
                            <Text style={styles.mapBtnText}>🗺️ Map</Text>
                          </TouchableOpacity>

                          {/* He can clear the debt from here rather than
                              hunting for the shop in another list. */}
                          <TouchableOpacity
                            style={[
                              styles.pendingVisitBtn,
                              (visitStartingId === party._id || Boolean(activeVisit)) && styles.disabledBtn,
                            ]}
                            disabled={visitStartingId === party._id || Boolean(activeVisit)}
                            onPress={() => handleStartVisit(party)}
                          >
                            <Text style={styles.pendingVisitBtnText}>
                              {visitStartingId === party._id
                                ? 'Starting…'
                                : activeVisit
                                  ? 'Finish current visit'
                                  : '📸 Start Visit'}
                            </Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}
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
    height: verticalScale(56),
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  topHeaderTitle: {
    fontSize: responsiveFontSize(16.5),
    fontWeight: '800',
    color: '#1A202C',
  },

  // Tabs Row
  tabRow: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  tabBtn: {
    flex: 1,
    paddingVertical: verticalScale(14),
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  activeTabBtn: {
    borderBottomColor: '#00796B',
  },
  tabBtnText: {
    fontSize: responsiveFontSize(13.5),
    fontWeight: '700',
    color: '#718096',
  },
  activeTabBtnText: {
    color: '#00796B',
  },

  // Content
  scrollContent: {
    padding: scale(16),
    paddingBottom: verticalScale(40),
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: verticalScale(120),
    gap: verticalScale(12),
  },
  loadingText: {
    fontSize: responsiveFontSize(13),
    color: '#718096',
    fontWeight: '600',
  },

  // Offline lockbox
  offlineBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: scale(40),
    paddingVertical: verticalScale(100),
  },
  lockIcon: {
    fontSize: responsiveFontSize(48),
    marginBottom: verticalScale(16),
  },
  offlineTitle: {
    fontSize: responsiveFontSize(18),
    fontWeight: '750',
    color: '#2D3748',
    marginBottom: verticalScale(8),
  },
  offlineDesc: {
    fontSize: responsiveFontSize(13),
    color: '#718096',
    textAlign: 'center',
    lineHeight: 19,
  },

  // Empty box
  emptyBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: verticalScale(80),
    paddingHorizontal: scale(20),
  },
  emptyIcon: {
    fontSize: responsiveFontSize(48),
    marginBottom: verticalScale(16),
  },
  emptyTitle: {
    fontSize: responsiveFontSize(17),
    fontWeight: '700',
    color: '#2D3748',
    marginBottom: verticalScale(8),
  },
  emptyDesc: {
    fontSize: responsiveFontSize(13),
    color: '#718096',
    textAlign: 'center',
    lineHeight: 18,
  },

  // Beat Banner
  beatBanner: {
    backgroundColor: '#00796B',
    borderRadius: 14,
    padding: scale(18),
    marginBottom: verticalScale(16),
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 2,
  },
  beatBannerTitle: {
    fontSize: responsiveFontSize(15.5),
    fontWeight: '800',
    color: '#FFFFFF',
    marginBottom: verticalScale(4),
  },
  beatBannerArea: {
    fontSize: responsiveFontSize(12.5),
    color: 'rgba(255, 255, 255, 0.85)',
    fontWeight: '600',
    marginBottom: verticalScale(8),
  },
  beatBannerCount: {
    fontSize: responsiveFontSize(11),
    color: '#E6FFFA',
    fontWeight: '700',
  },

  // Scheduled parties
  partyList: {
    gap: verticalScale(12),
  },
  partyCardDone: { opacity: 0.62 },
  partyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: scale(16),
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.02,
    shadowRadius: 6,
    elevation: 1,
  },
  partyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: verticalScale(10),
  },
  partyName: {
    fontSize: responsiveFontSize(14.5),
    fontWeight: '800',
    color: '#2D3748',
  },
  partyDistance: { fontSize: responsiveFontSize(10), color: '#3182CE', fontWeight: '700', marginTop: 2 },
  partyCode: {
    fontSize: responsiveFontSize(10.5),
    color: '#A0AEC0',
    fontWeight: '600',
    marginTop: verticalScale(2),
  },
  visitedBadge: {
    backgroundColor: '#E6FFFA',
    paddingHorizontal: scale(8),
    paddingVertical: verticalScale(3),
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#9AE6B4',
  },
  visitedBadgeText: {
    color: '#234E52',
    fontSize: responsiveFontSize(10),
    fontWeight: '800',
  },
  partyDetail: {
    fontSize: responsiveFontSize(12.5),
    color: '#4A5568',
    marginBottom: verticalScale(4),
    lineHeight: 17,
  },
  divider: {
    height: 1,
    backgroundColor: '#EDF2F7',
    marginVertical: verticalScale(12),
  },
  btnRow: {
    flexDirection: 'row',
    gap: verticalScale(10),
  },
  mapBtn: {
    backgroundColor: '#E6F0FF',
    borderWidth: 1,
    borderColor: '#3182CE',
    borderRadius: 8,
    paddingVertical: verticalScale(9),
    paddingHorizontal: scale(12),
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapBtnText: { color: '#2B6CB0', fontWeight: '700', fontSize: responsiveFontSize(11) },
  viewBtn: {
    flex: 1,
    height: verticalScale(38),
    backgroundColor: '#EDF2F7',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewBtnText: {
    fontSize: responsiveFontSize(12.5),
    color: '#4A5568',
    fontWeight: '700',
  },
  visitBtn: {
    flex: 1.2,
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
    fontSize: responsiveFontSize(12.5),
    color: '#FFFFFF',
    fontWeight: '800',
  },
  endVisitBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 10, borderRadius: 8, backgroundColor: '#dc2626',
  },
  visitedLabel: {
    flex: 1.2,
    height: verticalScale(38),
    backgroundColor: '#F0FFF4',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#C6F6D5',
  },
  visitedLabelText: {
    fontSize: responsiveFontSize(12.5),
    color: '#276749',
    fontWeight: '800',
  },

  // Skipped list
  pendingHint: {
    fontSize: responsiveFontSize(10),
    color: '#718096',
    marginBottom: verticalScale(10),
    lineHeight: responsiveFontSize(14),
  },
  pendingReason: { fontSize: responsiveFontSize(10), color: '#D69E2E', marginTop: 3 },
  pendingActions: { flexDirection: 'row', gap: scale(8), alignItems: 'center' },
  pendingVisitBtn: {
    flex: 1,
    backgroundColor: '#2C5282',
    borderRadius: 8,
    paddingVertical: verticalScale(9),
    alignItems: 'center',
    justifyContent: 'center',
  },
  pendingVisitBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: responsiveFontSize(11) },
  skippedList: {
    gap: verticalScale(14),
  },
  sectionTitle: {
    fontSize: responsiveFontSize(13),
    fontWeight: '800',
    color: '#718096',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: verticalScale(6),
  },
  skippedCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: scale(16),
    borderLeftWidth: 5,
    borderLeftColor: '#E53E3E',
  },
  skippedHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: verticalScale(6),
  },
  skippedDate: {
    fontSize: responsiveFontSize(14.5),
    fontWeight: '800',
    color: '#2D3748',
  },
  skippedDayLbl: {
    fontSize: responsiveFontSize(10.5),
    color: '#A0AEC0',
    fontWeight: '700',
    marginTop: verticalScale(2),
  },
  skippedBadge: {
    backgroundColor: '#FFF5F5',
    paddingHorizontal: scale(8),
    paddingVertical: verticalScale(3),
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FED7D7',
  },
  skippedBadgeText: {
    color: '#9B2C2C',
    fontSize: responsiveFontSize(9),
    fontWeight: '800',
  },
  skippedArea: {
    fontSize: responsiveFontSize(12.5),
    color: '#4A5568',
    fontWeight: '650',
    marginTop: verticalScale(4),
  },
  partiesScheduledTitle: {
    fontSize: responsiveFontSize(11),
    fontWeight: '800',
    color: '#718096',
    textTransform: 'uppercase',
    marginBottom: verticalScale(8),
  },
  skippedPartyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: verticalScale(6),
    borderBottomWidth: 1,
    borderBottomColor: '#F7F9FC',
  },
  skippedPartyName: {
    fontSize: responsiveFontSize(12.5),
    fontWeight: '600',
    color: '#4A5568',
    flex: 1,
  },
  skippedPartyViewBtn: {
    paddingHorizontal: scale(8),
    paddingVertical: verticalScale(3),
    backgroundColor: '#EDF2F7',
    borderRadius: 6,
  },
  skippedPartyViewText: {
    fontSize: responsiveFontSize(11),
    fontWeight: '700',
    color: '#4A5568',
  },
});
