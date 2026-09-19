import { AppRegistry } from 'react-native';
import { applyTextScaling } from './src/services/textScaling';
import { applyAppSkin } from './src/services/appSkin';

/**
 * The chosen text size, applied before any screen is built.
 *
 * Here rather than inside App.js because it replaces the Text component React
 * Native hands out, and that has to happen before the first screen imports it.
 */
/**
 * Both wrappers apply themselves when their modules load, which is above the
 * import of './App' — and that is the point. Calling them here would be too
 * late: every screen has already been loaded by then and taken its copy of
 * Text and View.
 *
 * Called again all the same, harmlessly, so this file still says out loud that
 * the app is wrapped.
 */
applyTextScaling();
applyAppSkin();
import { getMessaging, setBackgroundMessageHandler } from '@react-native-firebase/messaging';
import Geolocation from '@react-native-community/geolocation';
import App from './App';

/**
 * Use Google's fused location provider, not Android's raw one.
 *
 * The library defaults to `new AndroidLocationManager()` in its constructor and
 * only ever switches if this is called with 'playServices' — 'auto' is passed
 * through as undefined and matches neither branch, so without this line the
 * app has been on the raw provider the whole time. play-services-location is
 * already a dependency; it was shipped in the APK and never used.
 *
 * The raw provider asks exactly one source: GPS when highAccuracy is on,
 * the network when it is off. GPS from cold indoors frequently never answers,
 * which is where the twenty-second waits come from. The fused provider blends
 * GPS, wifi, cell and the phone's recent fixes and normally answers in a second
 * or two.
 *
 * Set here, at module scope, because it has to be in place before any screen
 * asks for a position.
 */
try {
  Geolocation.setRNConfiguration({ locationProvider: 'playServices', skipPermissionRequests: false });
} catch (error) {
  // A device with no Play Services keeps the raw provider, which still works.
  console.log('[Location] Could not switch to the fused provider:', error?.message);
}

/**
 * Handles a push that arrives while the app is backgrounded or killed.
 *
 * Registered here at module scope rather than inside the React tree: when
 * Android wakes the app for a data message there is no mounted component yet,
 * so a handler set up in App.js would never be reached.
 *
 * Uses the modular API because @react-native-firebase v26 removed the default
 * export — `import messaging from '...'` is undefined there, and calling it
 * crashed the app before the JS runtime was even ready.
 */
try {
  setBackgroundMessageHandler(getMessaging(), async (remoteMessage) => {
    /**
     * A silent message asking the tracker to check in.
     *
     * This is the one thing that has to work with the app swiped away, which is
     * why it is handled here and not in the React tree: when Android wakes the
     * app for a data message there is no mounted component to receive it. The
     * recording service is already running; this only asks it to upload now,
     * and the reply to that upload is what turns live mode on.
     */
    if (remoteMessage?.data?.type === 'tracking-wake') {
      try {
        const { wakeNativeTracking } = require('./src/services/nativeTracker');
        await wakeNativeTracking();
      } catch (error) {
        console.log('[Push] Could not wake the tracker:', error?.message);
      }
      return;
    }
    // Anything else: let the system display it. The unread badge refreshes when
    // the app next comes to the foreground.
  });
} catch (error) {
  // A missing google-services.json must not stop the app from starting.
  console.log('[Push] Could not register the background handler:', error?.message);
}

AppRegistry.registerComponent('main', () => App);
AppRegistry.registerComponent('MobileApp', () => App);
AppRegistry.registerComponent('mobileapp', () => App);
