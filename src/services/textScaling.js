import React, { useSyncExternalStore } from 'react';
import { StyleSheet } from 'react-native';
import { getFontScale, subscribe } from './fontScale';

/**
 * Applies the chosen text size to every piece of text in the app, from here.
 *
 * The alternative was editing the 186 places that write a font size as a plain
 * number, plus the 33 screens that go through the responsive helper, and then
 * remembering to do it again for the next screen anybody adds. This wraps the
 * Text component React Native hands out, so a size chosen in the profile
 * reaches text nobody thought about.
 *
 * The wrapper reads whatever size the component actually ended up with — after
 * StyleSheet has flattened everything — and multiplies that, so relative sizes
 * stay relative: a heading stays bigger than the body text it sits above.
 *
 * Patching the module rather than asking every screen to import a different
 * Text: React Native exports Text through a getter that re-reads this module,
 * so replacing what the module hands back reaches every `import { Text } from
 * 'react-native'` already written.
 */
const scaleStyle = (style, scale) => {
  if (scale === 1) return style;
  const flat = StyleSheet.flatten(style);
  const size = flat?.fontSize;
  if (!size) return style;
  // Appended rather than replacing, so everything else in the style survives.
  return [style, { fontSize: Math.round(size * scale) }];
};

const wrap = (Original, displayName) => {
  const Scaled = React.forwardRef((props, ref) => {
    // Re-renders every piece of text the moment the size changes, without a
    // context every screen would have to be wrapped in.
    const scale = useSyncExternalStore(subscribe, getFontScale, getFontScale);
    return React.createElement(Original, {
      ...props,
      ref,
      style: scaleStyle(props.style, scale),
    });
  });
  Scaled.displayName = displayName;
  // Static members some libraries reach for — propTypes, Text.Provider, and so
  // on — would otherwise disappear behind the wrapper.
  Object.keys(Original).forEach((key) => {
    if (Scaled[key] === undefined) Scaled[key] = Original[key];
  });
  return Scaled;
};

let applied = false;

/**
 * Call once, before the first screen renders.
 *
 * Failure is swallowed on purpose: if a React Native version stops allowing
 * this, the app runs at the normal size rather than not running.
 */
export const applyTextScaling = () => {
  if (applied) return;
  applied = true;

  // Written out one by one rather than looped: Metro resolves modules when it
  // bundles, so a require whose path is a variable is not a module it can find
  // — it refuses the build outright.
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
      if (!original || original.__scaled) return;
      const wrapped = wrap(original, name);
      wrapped.__scaled = true;
      Object.defineProperty(module, 'default', {
        value: wrapped, configurable: true, writable: true, enumerable: true,
      });
    } catch (error) {
      console.log(`[FontScale] could not wrap ${name}:`, error?.message);
    }
  };

  patch(require('react-native/Libraries/Text/Text'), 'ScaledText');
  patch(require('react-native/Libraries/Components/TextInput/TextInput'), 'ScaledTextInput');
};

/**
 * Applied on import, for the same reason as the colours: everything that
 * imports Text is loaded before any statement in index.js could run.
 */
applyTextScaling();
