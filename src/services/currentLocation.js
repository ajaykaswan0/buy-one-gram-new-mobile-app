import { Platform, PermissionsAndroid } from 'react-native';
import Geolocation from '@react-native-community/geolocation';

/**
 * Where the phone is, right now, once.
 *
 * Two screens start visits — the party list and the beat plan — and both have
 * to prove the salesman is at the shop. Written once here so the two can never
 * drift apart on permission handling, timeouts or what counts as a failure.
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
 * `maximumAge: 0` on purpose: a cached fix from the previous shop would place
 * the salesman where he no longer is, which is exactly what the radius check
 * exists to prevent.
 */
export const getCurrentLocation = ({ timeout = 20000 } = {}) => new Promise(async (resolve, reject) => {
  const allowed = await ensureLocationPermission();
  if (!allowed) {
    reject(new Error('Location permission is needed to start a visit. Allow it in Settings and try again.'));
    return;
  }

  Geolocation.getCurrentPosition(
    (position) => {
      const { latitude, longitude, accuracy } = position.coords;
      resolve({ latitude, longitude, accuracy });
    },
    (error) => {
      reject(new Error(
        error?.code === 3
          ? 'Could not get a GPS fix in time. Step outside or near a window and try again.'
          : (error?.message || 'Could not read your location.')
      ));
    },
    { enableHighAccuracy: true, timeout, maximumAge: 0 },
  );
});
