import Geolocation from '@react-native-community/geolocation';
import AsyncStorage from '@react-native-async-storage/async-storage';

const ACTIVE_VISIT_KEY = 'active_visit';

// The server counts one out-of-radius strike per ping and closes the visit
// after several in a row, so the ping rate here is what its auto-departure
// timing is calibrated against.
const PING_EVERY_MS = 20 * 1000;

let watchId = null;
let pingTimer = null;
let lastPosition = null;
let onAutoClose = null;

/**
 * Tracks the visit a salesman is currently inside.
 *
 * The screen used to know only "started" or "visited today", so a salesman who
 * tapped Start saw the same button again and nothing ever ended the visit. This
 * holds the open visit, pings its location while it runs, and reports back when
 * the server closes it because he walked away.
 */
export const getActiveVisit = async () => {
  try {
    const raw = await AsyncStorage.getItem(ACTIVE_VISIT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const setActiveVisit = async (visit) => {
  if (visit) await AsyncStorage.setItem(ACTIVE_VISIT_KEY, JSON.stringify(visit));
  else await AsyncStorage.removeItem(ACTIVE_VISIT_KEY);
};

/**
 * Sends where the salesman is now.
 *
 * The reply is what ends the visit: the server owns the radius rule and the
 * strike count, so the phone never decides on its own that someone has left —
 * a single bad GPS fix would otherwise close a visit he is still standing in.
 */
const ping = async ({ apiUrl, token, visitId, logId }) => {
  if (!lastPosition) return;
  try {
    const response = await fetch(`${apiUrl}/visit/location`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        visitId,
        logId,
        latitude: lastPosition.latitude,
        longitude: lastPosition.longitude,
      }),
    });
    const data = await response.json().catch(() => null);

    if (data?.autoLeft) {
      await stopVisitTracking();
      onAutoClose?.(data);
      return;
    }
    // A visit closed some other way — from the web, or already ended — should
    // not keep pinging.
    if (!response.ok && /already completed/i.test(data?.message || '')) {
      await stopVisitTracking();
      onAutoClose?.({ ...data, alreadyClosed: true });
    }
  } catch (error) {
    // Offline mid-visit is normal; the next ping carries on.
    console.log('[Visit] location ping failed:', error.message);
  }
};

/** Starts watching and pinging for an open visit. */
export const startVisitTracking = async ({ apiUrl, token, visit, logId, onClosed }) => {
  await setActiveVisit(visit);
  onAutoClose = onClosed;

  if (watchId === null) {
    try {
      watchId = Geolocation.watchPosition(
        (position) => { lastPosition = position.coords; },
        (error) => console.log('[Visit] location error:', error?.message || error),
        { enableHighAccuracy: true, distanceFilter: 0, interval: 10000, maximumAge: 0, timeout: 30000 },
      );
    } catch (error) {
      console.log('[Visit] could not watch location:', error.message);
    }
  }

  if (!pingTimer) {
    pingTimer = setInterval(
      () => { ping({ apiUrl, token, visitId: visit._id, logId }).catch(() => {}); },
      PING_EVERY_MS,
    );
  }
};

export const stopVisitTracking = async () => {
  if (watchId !== null) {
    try { Geolocation.clearWatch(watchId); } catch { /* already gone */ }
    watchId = null;
  }
  if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
  lastPosition = null;
  await setActiveVisit(null);
};

/** Ends the visit deliberately, from the End Visit button. */
export const endVisit = async ({ apiUrl, token, visitId }) => {
  try {
    const response = await fetch(`${apiUrl}/visit/complete/${visitId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({}),
    });
    const data = await response.json().catch(() => null);
    // Cleared even on failure: leaving a phantom open visit on screen is worse
    // than a visit the server thinks is still running, which its own departure
    // rule will close anyway.
    await stopVisitTracking();
    if (!response.ok) throw new Error(data?.message || `HTTP ${response.status}`);
    return data;
  } catch (error) {
    await stopVisitTracking();
    throw error;
  }
};

/**
 * Re-attaches to a visit left open when the app was closed.
 *
 * Without this, force-quitting mid-visit would strand it: the screen would show
 * Start Visit again while the server still had one running.
 */
export const resumeVisitTracking = async ({ apiUrl, token, logId, onClosed }) => {
  try {
    const response = await fetch(`${apiUrl}/visit/my/today`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await response.json().catch(() => null);
    const ongoing = (data?.data || []).find((row) => row.status === 'ongoing');

    if (!ongoing) {
      await stopVisitTracking();
      return null;
    }
    await startVisitTracking({ apiUrl, token, visit: ongoing, logId, onClosed });
    return ongoing;
  } catch (error) {
    console.log('[Visit] could not resume:', error.message);
    return getActiveVisit();
  }
};

export { ACTIVE_VISIT_KEY, PING_EVERY_MS };

const VISITED_TODAY_KEY = 'visited_today';

const todayKey = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

/**
 * The parties already visited today, remembered on the phone.
 *
 * The server is the authority, but its flag only arrives on the next refresh —
 * and an older build of the API does not send it at all. Without this the
 * salesman sees "Start Visit" again the moment he ends one, and can walk
 * straight back into the same shop.
 */
export const getVisitedToday = async () => {
  try {
    const raw = await AsyncStorage.getItem(VISITED_TODAY_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    // Keyed by date so yesterday's list never suppresses today's visits.
    if (!parsed || parsed.date !== todayKey()) return [];
    return Array.isArray(parsed.partyIds) ? parsed.partyIds : [];
  } catch {
    return [];
  }
};

export const markVisitedToday = async (partyId) => {
  if (!partyId) return;
  const current = await getVisitedToday();
  const id = String(partyId);
  if (current.includes(id)) return;
  await AsyncStorage.setItem(
    VISITED_TODAY_KEY,
    JSON.stringify({ date: todayKey(), partyIds: [...current, id] }),
  );
};

export { VISITED_TODAY_KEY };
