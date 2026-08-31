import { AppRegistry } from 'react-native';
import { getMessaging, setBackgroundMessageHandler } from '@react-native-firebase/messaging';
import App from './App';

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
  setBackgroundMessageHandler(getMessaging(), async () => {
    // Nothing to do beyond letting the system display the notification; the
    // unread badge refreshes when the app next comes to the foreground.
  });
} catch (error) {
  // A missing google-services.json must not stop the app from starting.
  console.log('[Push] Could not register the background handler:', error?.message);
}

AppRegistry.registerComponent('main', () => App);
AppRegistry.registerComponent('MobileApp', () => App);
AppRegistry.registerComponent('mobileapp', () => App);
