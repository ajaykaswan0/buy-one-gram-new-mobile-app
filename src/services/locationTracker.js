import Geolocation from '@react-native-community/geolocation';
import AsyncStorage from '@react-native-async-storage/async-storage';

const QUEUE_KEY = 'location_queue';
const TRACKING_PROFILE_KEY = 'tracking_profile';

/**
 * How often to record and upload.
 *
 * These are only the starting values: the server returns the cadence it wants
 * in the reply to every upload, so the policy can be changed for everyone
 * without shipping a new build. Recording and uploading are separate numbers
 * because they cost different things — the GPS radio drains the battery, the
 * request count costs the server.
 */
const DEFAULT_RECORD_MS = 30 * 1000;
const DEFAULT_UPLOAD_MS = 3 * 60 * 1000;

// Movement smaller than this is GPS jitter, not the person going anywhere.
const MIN_DISTANCE_M = 25;

/**
 * While the phone is not moving, recording slows down step by step: there is
 * nothing to draw between two identical points, and arrival and departure —
 * the two timestamps dwell time is actually measured from — are both still
 * captured. Any real movement resets to the fast rate immediately.
 */
const STATIONARY_BACKOFF = [30000, 60000, 120000, 300000];

const MAX_QUEUE = 5000;

let watchId = null;
let flushTimer = null;
let lastPoint = null;
let getContext = null;

// The cadence currently in force. Updated from the server's reply.
let recordEveryMs = DEFAULT_RECORD_MS;
let uploadEveryMs = DEFAULT_UPLOAD_MS;
let stillFor = 0;          // consecutive stationary samples, drives the backoff
let liveUntil = 0;         // epoch ms; while in the future, no backoff applies

const metresBetween = (a, b) => {
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2
    + Math.sin(dLng / 2) ** 2 * Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude));
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
};

const readQueue = async () => {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const writeQueue = async (points) => {
  // Oldest points are dropped first if the queue ever runs away, so a phone
  // that was offline for days still uploads its most recent movements.
  const trimmed = points.length > MAX_QUEUE ? points.slice(points.length - MAX_QUEUE) : points;
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(trimmed));
};

/**
 * Sends everything buffered, and puts it back if the upload fails.
 *
 * The queue is cleared before the request and restored on failure rather than
 * cleared after success, so two overlapping flushes cannot send the same points
 * twice.
 */
export const flushQueue = async () => {
  const context = await (getContext ? getContext() : null);
  if (!context?.token || !context?.profile?.userId) return { sent: 0 };

  const queued = await readQueue();
  if (!queued.length) return { sent: 0 };

  await writeQueue([]);

  try {
    const response = await fetch(`${context.apiUrl}/device-tracking/ping-batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: context.profile.userId,
        userName: context.profile.userName,
        userMobile: context.profile.userMobile,
        deviceId: context.profile.deviceId,
        deviceLabel: context.profile.deviceLabel,
        permissionStatus: context.permissionStatus,
        points: queued,
      }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    // The server decides how fast this phone should run. Riding the answer on
    // the upload the device was making anyway means live mode costs no extra
    // request and needs no polling.
    const body = await response.json().catch(() => null);
    applyCadence(body?.data?.cadence);

    return { sent: queued.length };
  } catch (error) {
    const current = await readQueue();
    await writeQueue([...queued, ...current]);
    console.log('[Tracker] batch upload failed, points kept for retry:', error.message);
    return { sent: 0, error: error.message };
  }
};

/**
 * Adopts the cadence the server asked for.
 *
 * The upload timer is only rebuilt when the interval actually changes, so a
 * steady state does not tear down and recreate a timer every few minutes.
 */
const applyCadence = (cadence) => {
  if (!cadence) return;

  const nextRecord = Number(cadence.recordEveryMs) || recordEveryMs;
  const nextUpload = Number(cadence.uploadEveryMs) || uploadEveryMs;
  liveUntil = cadence.liveUntil ? new Date(cadence.liveUntil).getTime() : 0;

  recordEveryMs = nextRecord;

  if (nextUpload !== uploadEveryMs) {
    uploadEveryMs = nextUpload;
    if (flushTimer) {
      clearInterval(flushTimer);
      flushTimer = setInterval(() => { flushQueue().catch(() => {}); }, uploadEveryMs);
    }
  }
};

/** How long to wait before the next point, given how still the phone has been. */
const currentRecordInterval = () => {
  // Someone is watching: never back off.
  if (liveUntil > Date.now()) return recordEveryMs;
  const step = Math.min(stillFor, STATIONARY_BACKOFF.length - 1);
  return Math.max(recordEveryMs, STATIONARY_BACKOFF[step]);
};

const record = async (position) => {
  const { latitude, longitude, accuracy } = position.coords;
  const now = Date.now();

  if (lastPoint) {
    const movedM = metresBetween(lastPoint, { latitude, longitude });
    const sinceMs = now - lastPoint.at;
    const moved = movedM >= MIN_DISTANCE_M;

    // Real movement is always worth a point, and resets the backoff so the
    // moment someone leaves a shop is captured at full resolution.
    if (!moved && sinceMs < currentRecordInterval()) return;

    if (moved) {
      stillFor = 0;
      // Leaving a stop is the most interesting moment of the hour, so it goes
      // up straight away rather than waiting for the next upload window.
      if (liveUntil <= Date.now()) flushQueue().catch(() => {});
    } else {
      stillFor += 1;
    }
  }

  const context = await (getContext ? getContext() : null);
  lastPoint = { latitude, longitude, at: now };

  const queued = await readQueue();
  queued.push({
    latitude,
    longitude,
    accuracy: Number.isFinite(accuracy) ? accuracy : null,
    timestamp: new Date(now).toISOString(),
    // Whether the person was clocked in when the point was taken. The server
    // checks this itself too, but sending it keeps a buffered point honest
    // about the moment it was recorded rather than the moment it uploaded.
    onDuty: Boolean(context?.onDuty),
  });
  await writeQueue(queued);
};

/**
 * Starts continuous tracking.
 *
 * Replaces a single getCurrentPosition call that, despite its name, never
 * repeated and never ran in the background — which is why no trail was ever
 * recorded. `context` is read fresh on every point so a shift starting or
 * ending is picked up without restarting the watch.
 */
export const startTracking = async (contextProvider) => {
  getContext = contextProvider;
  if (watchId !== null) return;

  try {
    watchId = Geolocation.watchPosition(
      (position) => { record(position).catch(() => {}); },
      (error) => { console.log('[Tracker] location error:', error?.message || error); },
      {
        enableHighAccuracy: true,
        // Deliberately 0, not MIN_DISTANCE_M: a distance filter stops the OS
        // calling back at all while the phone is still, which would mean no
        // points for the whole time someone is inside a shop — exactly the
        // stretch that matters. The interval above does the throttling instead.
        distanceFilter: 0,
        // The OS is asked for a steady stream; how much of it is kept is
        // decided above, where the movement state is known.
        interval: 10000,
        fastestInterval: 5000,
        maximumAge: 0,
        timeout: 60000,
      }
    );
  } catch (error) {
    console.log('[Tracker] could not start watching location:', error.message);
    return;
  }

  if (!flushTimer) {
    flushTimer = setInterval(() => { flushQueue().catch(() => {}); }, uploadEveryMs);
  }
  // One immediate flush, so anything buffered from a previous session goes up
  // without waiting for the first interval.
  flushQueue().catch(() => {});
};

export const stopTracking = async () => {
  if (watchId !== null) {
    try { Geolocation.clearWatch(watchId); } catch { /* already gone */ }
    watchId = null;
  }
  if (flushTimer) { clearInterval(flushTimer); flushTimer = null; }
  lastPoint = null;
  stillFor = 0;
  liveUntil = 0;
  // Anything still buffered belongs to the shift that just ended.
  await flushQueue().catch(() => {});
};

export const isTracking = () => watchId !== null;
/** Exposed for the diagnostics screen and for tests. */
export const currentCadence = () => ({
  recordEveryMs: currentRecordInterval(),
  uploadEveryMs,
  live: liveUntil > Date.now(),
  stillFor,
});
export const queueSize = async () => (await readQueue()).length;
export { TRACKING_PROFILE_KEY, QUEUE_KEY };
