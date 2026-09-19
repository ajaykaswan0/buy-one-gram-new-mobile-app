import React, { useSyncExternalStore } from 'react';
import { StyleSheet } from 'react-native';

/**
 * The app's colours, swapped from the server.
 *
 * A festival should change the app, not add a banner to it. The screens set
 * their colours as plain hex — 146 places say white, 72 say the pale grey the
 * screens sit on, 53 say the teal — so there is nothing to hand a theme to.
 * This swaps those four wherever they appear, which recolours every card and
 * every screen at once without touching a single one of them.
 *
 * Only the four are swapped. A warning red and a success green mean what they
 * mean whatever the season, and a theme that repainted those would be lying.
 *
 * Costs nothing when no festival is on: with no palette set the wrapper hands
 * the props straight back, so the ordinary app pays nothing for this.
 */

/** What the screens actually say today. Lower case, because the files are not consistent. */
const CARD = new Set(['#ffffff', '#fff', 'white']);
const SCREEN = new Set(['#f7f9fc']);
const SOFT = new Set(['#edf2f7']);
const BRAND = new Set(['#00796b']);

let palette = null;
let theme = null;
const listeners = new Set();

export const getSkin = () => palette;
/** The whole theme, for the screen that draws the greeting. */
export const getTheme = () => theme;

export const subscribeSkin = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/**
 * `null` puts the app back to its own colours.
 *
 * A theme with no colours in it is the same as none: a festival that only sets
 * a greeting should not repaint anything.
 */
export const setTheme = (next) => {
  theme = next || null;
  const colours = next
    ? { card: next.cardColor || '', screen: next.screenColor || '', soft: next.softColor || '', brand: next.brandColor || '' }
    : null;
  // A festival that only sets a greeting must not repaint anything.
  palette = colours && (colours.card || colours.screen || colours.brand) ? colours : null;
  listeners.forEach((listener) => listener());
};

const swap = (colour) => {
  if (!palette || typeof colour !== 'string') return colour;
  const key = colour.trim().toLowerCase();
  if (palette.card && CARD.has(key)) return palette.card;
  if (palette.screen && SCREEN.has(key)) return palette.screen;
  if (palette.soft && SOFT.has(key)) return palette.soft;
  if (palette.brand && BRAND.has(key)) return palette.brand;
  return colour;
};

const restyle = (style) => {
  const flat = StyleSheet.flatten(style);
  if (!flat) return style;

  const patch = {};
  // Borders too: a white card on a white border is one thing, a coloured card
  // with a white line round it is a mistake nobody would draw on purpose.
  for (const key of ['backgroundColor', 'borderColor', 'borderTopColor', 'borderBottomColor', 'borderLeftColor', 'borderRightColor']) {
    const current = flat[key];
    if (!current) continue;
    const next = swap(current);
    if (next !== current) patch[key] = next;
  }
  return Object.keys(patch).length ? [style, patch] : style;
};

const wrap = (Original, displayName) => {
  const Skinned = React.forwardRef((props, ref) => {
    const skin = useSyncExternalStore(subscribeSkin, getSkin, getSkin);
    // No festival: hand the props straight back, untouched and uncopied.
    if (!skin || !props.style) return React.createElement(Original, { ...props, ref });
    return React.createElement(Original, { ...props, ref, style: restyle(props.style) });
  });
  Skinned.displayName = displayName;
  Object.keys(Original).forEach((key) => {
    if (Skinned[key] === undefined) Skinned[key] = Original[key];
  });
  return Skinned;
};

let applied = false;

/**
 * Call once, before the first screen renders.
 *
 * Swallows a failure on purpose: if a React Native version stops allowing this,
 * the app runs in its own colours rather than not running.
 */
export const applyAppSkin = () => {
  if (applied) return;
  applied = true;

  /**
   * Replaces what the module hands back, however it hands it back.
   *
   * defineProperty rather than assignment because `export default` compiles to
   * a plain property on some Babel versions and a getter on others, and an
   * assignment to a getter does nothing at all — silently.
   */
  const patch = (module, name) => {
    if (!module) return;
    try {
      const original = module.default;
      if (!original || original.__skinned) return;
      const wrapped = wrap(original, name);
      wrapped.__skinned = true;
      Object.defineProperty(module, 'default', {
        value: wrapped, configurable: true, writable: true, enumerable: true,
      });
    } catch (error) {
      console.log(`[Skin] could not wrap ${name}:`, error?.message);
    }
  };

  // Written out one by one: Metro resolves modules when it bundles, so a
  // require whose path is a variable is not a module it can find.
  patch(require('react-native/Libraries/Components/View/View'), 'SkinnedView');
  patch(require('react-native/Libraries/Components/ScrollView/ScrollView'), 'SkinnedScrollView');
};

/**
 * Applied the moment this module is loaded, not when somebody calls it.
 *
 * ES imports are all evaluated before the first statement of the importing
 * file, so `import App from './App'` — which pulls in every screen — ran before
 * `applyAppSkin()` did. The screens had already taken their copy of View by
 * then and never saw the wrapper, which is why the colours never changed
 * however plainly the server sent them.
 *
 * index.js imports this above './App', and import order is kept, so doing it
 * here is what makes it happen first.
 */
applyAppSkin();
