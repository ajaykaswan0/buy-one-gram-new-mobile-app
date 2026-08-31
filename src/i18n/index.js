import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import hi from './hi';
import hinglish from './hinglish';
import { term } from './apiTerms';
import { displayName } from './devanagari';

const STORAGE_KEY = 'app_language';

export const LANGUAGES = [
  { code: 'en', label: 'English', native: 'English' },
  { code: 'hi', label: 'Hindi', native: 'हिन्दी' },
  { code: 'hinglish', label: 'Hinglish', native: 'Hinglish' },
];

/**
 * Dictionaries are keyed by the English text itself.
 *
 * The alternative — invented keys like `party.create.title` — means every
 * string has to be registered before it can be shown, and a missed one renders
 * as a raw key in front of a customer. Keying on the English means an
 * untranslated string simply appears in English, which is the safe failure.
 */
const DICTIONARIES = { en: {}, hi, hinglish };

const LanguageContext = createContext({ language: 'en', setLanguage: () => {}, t: (text) => text });

/**
 * Translates one string.
 *
 * Also handles simple interpolation — t('Visits ({count})', { count: 4 }) —
 * so a sentence with a number in it stays one translatable phrase rather than
 * three fragments glued together, which is what makes Hindi word order work.
 */
export const translate = (language, text, values) => {
  const dictionary = DICTIONARIES[language] || {};
  let out = dictionary[text] ?? text;

  if (values) {
    for (const [key, value] of Object.entries(values)) {
      out = out.split(`{${key}}`).join(String(value));
    }
  }
  return out;
};

export function LanguageProvider({ children }) {
  const [language, setLanguageState] = useState('en');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((saved) => {
        if (saved && DICTIONARIES[saved]) setLanguageState(saved);
      })
      .catch(() => { /* first run, or storage unavailable — English it is */ })
      .finally(() => setReady(true));
  }, []);

  const setLanguage = (code) => {
    if (!DICTIONARIES[code]) return;
    setLanguageState(code);
    AsyncStorage.setItem(STORAGE_KEY, code).catch(() => { /* it will still apply for this session */ });
  };

  const value = useMemo(() => ({
    language,
    setLanguage,
    ready,
    t: (text, values) => translate(language, text, values),
    // For values the API sends — order status, payment mode and the like.
    // Names are deliberately not passed through here; see apiTerms.js.
    term: (value) => term(language, value),
    // A stored name, in a script the reader can actually read. Display only —
    // search and anything sent to the server keep the original text.
    name: (value) => displayName(language, value),
  }), [language, ready]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export const useLanguage = () => useContext(LanguageContext);

/** For the odd place that cannot use a hook. */
export const useT = () => useContext(LanguageContext).t;
export { term } from './apiTerms';
export { toDevanagari, displayName } from './devanagari';
