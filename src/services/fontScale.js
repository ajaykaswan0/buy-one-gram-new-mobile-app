import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * How much bigger the app's text should be, chosen by the person using it.
 *
 * Salesmen read this in daylight, on the move, and a good number of them are
 * not twenty. The phone's own font setting does not reach a React Native app
 * unless every screen opts in, and this app sets 186 font sizes as plain
 * numbers, so nothing was ever going to follow it.
 *
 * A single multiplier instead, applied in one place — see textScaling.js. Held
 * here as a tiny store rather than a React context because the thing that
 * applies it is not inside the React tree.
 */
const KEY = 'font_scale';

export const DEFAULT_SCALE = 1;
export const MIN_SCALE = 0.85;
export const MAX_SCALE = 1.6;

let scale = DEFAULT_SCALE;
const listeners = new Set();

/** Kept inside the range whatever is stored or passed in. */
const clamp = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return DEFAULT_SCALE;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, number));
};

export const getFontScale = () => scale;

export const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const setFontScale = async (next) => {
  const value = clamp(next);
  if (value === scale) return value;
  scale = value;
  listeners.forEach((listener) => listener());
  try {
    await AsyncStorage.setItem(KEY, String(value));
  } catch {
    // It still applies for this run; only the memory of it is lost.
  }
  return value;
};

export const resetFontScale = () => setFontScale(DEFAULT_SCALE);

/**
 * Read the stored size before the first screen draws.
 *
 * Awaited at startup so the app does not open at one size and jump to another
 * a moment later.
 */
export const loadFontScale = async () => {
  try {
    const stored = await AsyncStorage.getItem(KEY);
    if (stored !== null) {
      scale = clamp(stored);
      listeners.forEach((listener) => listener());
    }
  } catch {
    // The default stands.
  }
  return scale;
};
