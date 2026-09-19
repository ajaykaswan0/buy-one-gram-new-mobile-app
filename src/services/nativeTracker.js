import { NativeModules, Platform } from 'react-native';

/**
 * The Android foreground service, from JavaScript.
 *
 * Recording moved into Kotlin because a JS `watchPosition` stops the moment the
 * React thread does — the app going to the background, or the screen locking,
 * ended the trail. The service keeps running, buffers offline and uploads in
 * batches, so all this side has to do is switch it on at login and off at
 * logout.
 *
 * Everywhere that is not Android falls back to the JavaScript tracker in
 * locationTracker.js, which is still correct while the app is open.
 */
const native = NativeModules.SFATracking;

export const hasNativeTracking = Platform.OS === 'android' && Boolean(native);

export const startNativeTracking = async (profile, apiUrl) => {
  if (!hasNativeTracking || !profile?.userId || !apiUrl) return false;
  try {
    await native.start({
      userId: String(profile.userId),
      userName: String(profile.userName || ''),
      userMobile: String(profile.userMobile || ''),
      deviceId: String(profile.deviceId || ''),
      deviceLabel: String(profile.deviceLabel || 'android-device'),
      apiUrl: String(apiUrl),
    });
    return true;
  } catch (error) {
    console.log('[Tracker] native start failed:', error.message);
    return false;
  }
};

export const stopNativeTracking = async () => {
  if (!hasNativeTracking) return;
  try {
    await native.stop();
  } catch (error) {
    console.log('[Tracker] native stop failed:', error.message);
  }
};

/**
 * Ask the service to check in now.
 *
 * Called when a push arrives saying somebody wants to watch. It does not turn
 * live mode on — the server already did that — it only saves the phone waiting
 * out its ten-minute upload window before finding out.
 */
export const wakeNativeTracking = async () => {
  if (!hasNativeTracking || !native.wake) return false;
  try {
    return await native.wake();
  } catch (error) {
    console.log('[Tracker] wake failed:', error.message);
    return false;
  }
};

/** `{ enabled, queued, userId }` — for the diagnostics screen. */
export const nativeTrackingStatus = async () => {
  if (!hasNativeTracking) return null;
  try {
    return await native.status();
  } catch {
    return null;
  }
};
