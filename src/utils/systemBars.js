import { Dimensions, Platform, StatusBar } from 'react-native';

/**
 * How much room the system's own bars take at the bottom of the screen.
 *
 * The tab bar used to reserve a fixed 22dp, which is about right for a phone
 * with gesture navigation and far too little for one with the old three-button
 * bar — there the buttons sat on top of Report and Profile. The two cannot be
 * told apart by guessing, so this measures instead.
 *
 * `screen` is the whole display; `window` is what the app actually gets. The
 * difference is the system bars, and subtracting the status bar leaves the one
 * at the bottom.
 *
 * There is no dependency here on purpose. react-native-safe-area-context would
 * do this properly, but this project wires its native modules into
 * android/app/build.gradle by hand, and adding one for a number we can measure
 * ourselves is not a fair trade.
 */
const MIN_PADDING = 12;   // never flush against the edge, even with no bar
const MAX_INSET = 64;     // beyond this something has been measured wrong

export const bottomInset = () => {
  if (Platform.OS !== 'android') return 20;   // iOS home indicator

  const screen = Dimensions.get('screen');
  const window = Dimensions.get('window');
  const statusBar = StatusBar.currentHeight || 0;

  const inset = Math.round(screen.height - window.height - statusBar);

  // A negative or absurd result means the window was measured mid-rotation or
  // in a split screen; fall back rather than pushing the bar off the screen.
  if (!Number.isFinite(inset) || inset < 0 || inset > MAX_INSET) return MIN_PADDING;
  return inset;
};

/** What a bottom bar should pad itself by: the system bar, or a sane minimum. */
export const bottomBarPadding = () => Math.max(MIN_PADDING, bottomInset());
