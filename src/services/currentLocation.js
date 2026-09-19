import { Platform, PermissionsAndroid } from 'react-native';
import Geolocation from '@react-native-community/geolocation';

/**
 * Where the phone is, right now, once.
 *
 * Several screens need this — starting a visit, marking attendance, recording a
 * collection — and all of them have to prove the salesman was where he says he
 * was. Written once here so they cannot drift apart on permission handling,
 * timeouts or what counts as a failure.
 */

/** Android returns nothing at all from GPS until this has been granted. */
export const ensureLocationPermission = async () => {
  if (Platform.OS !== 'android') return true;
  try {
    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      {
        title: 'Location needed',
        message: 'A visit is recorded with the location you started it from.',
        buttonPositive: 'Allow',
      },
    );
    return granted === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
};

/**
 * Resolves `{ latitude, longitude, accuracy }`, or throws something a person
 * can act on.
 *
 * Built on `watchPosition` rather than `getCurrentPosition`, which sounds like
 * the wrong way round and is not.
 *
 * The fused provider reports `onLocationAvailability(false)` the instant a
 * request starts, because no fix has arrived yet — and the library treats that
 * as a hard failure. On `getCurrentPosition` it fires the error callback and
 * the promise is settled before any position could arrive, which is the
 * "Location not available (FusedLocationProvider/lastLocation)" a salesman sees
 * the moment he taps Start Visit. On `watchPosition` the same complaint is only
 * an emitted event: the stream keeps running and the fix arrives a moment
 * later. So the watch is what is used, and the first fix wins.
 *
 * `maximumAge: 0` stays deliberate: a cached fix from the previous shop would
 * place the salesman where he no longer is, which is exactly what the radius
 * check exists to catch.
 */
export const getCurrentLocation = async ({ timeout = 20000, desiredAccuracy = 0 } = {}) => {
  const allowed = await ensureLocationPermission();
  if (!allowed) {
    throw new Error('Location permission is needed to start a visit. Allow it in Settings and try again.');
  }

  return new Promise((resolve, reject) => {
    let watchId = null;
    let timer = null;
    let best = null;
    let done = false;

    const stop = () => {
      if (done) return false;
      done = true;
      if (timer) clearTimeout(timer);
      if (watchId !== null) {
        try { Geolocation.clearWatch(watchId); } catch { /* already gone */ }
      }
      return true;
    };

    timer = setTimeout(() => {
      const first = stop();
      if (!first) return;
      // Something rough beats nothing: the caller asked where the phone is, and
      // a fix of a hundred metres still answers that.
      if (best) resolve(best);
      else reject(new Error('Could not get a GPS fix in time. Step outside or near a window and try again.'));
    }, timeout);

    watchId = Geolocation.watchPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords;
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
        if (!best || accuracy < best.accuracy) best = { latitude, longitude, accuracy };
        // Good enough, or no bar was set and any fix will do.
        if (!desiredAccuracy || accuracy <= desiredAccuracy) {
          if (stop()) resolve(best);
        }
      },
      (error) => {
        // The fused provider says "not available" before its first fix, every
        // time. Ignoring it is the whole point of using the watch; the timeout
        // above is what actually decides that nothing is coming.
        if (error?.code === 2) return;
        if (stop()) {
          reject(new Error(
            error?.code === 1
              ? 'Location permission is needed. Allow it in Settings and try again.'
              : (error?.message || 'Could not read your location.')
          ));
        }
      },
      { enableHighAccuracy: true, distanceFilter: 0, interval: 1000, fastestInterval: 500, timeout, maximumAge: 0 },
    );
  });
};

/**
 * `Geolocation.getCurrentPosition`, with the fused-provider bug taken out.
 *
 * Same shape as the call it replaces — success callback, error callback,
 * options — so a screen switches to it by changing the name and nothing else.
 * Underneath it is the watch above, which is what makes it work at all: the
 * library's own one-shot rejects before the first fix can arrive.
 *
 * The success callback is handed a `{ coords }` object, exactly like the
 * original, so nothing downstream has to be rewritten.
 */
export const getCurrentPositionSafely = (onSuccess, onError, options = {}) => {
  getCurrentLocation({ timeout: options.timeout || 20000 })
    .then((coords) => onSuccess?.({ coords, timestamp: Date.now() }))
    .catch((error) => onError?.({ code: 3, message: error.message }));
};
