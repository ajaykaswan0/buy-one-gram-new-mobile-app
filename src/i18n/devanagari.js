/**
 * Roman → Devanagari, for the names the API stores.
 *
 * A party name is written once, in Roman, and there is no Hindi copy of it
 * anywhere. Someone who cannot read English cannot read "Mahadev Wholesale
 * Traders" at all — so it is rendered in a script they can read, with the same
 * sound: "महादेव होलसेल ट्रेडर्स".
 *
 * Two rules make this readable rather than mechanical:
 *
 *  1. The sound is kept, never the meaning. "Mahesh Store" becomes
 *     "महेश स्टोर", not "महेश दुकान" — a name is a name, and translating it
 *     would rename the business.
 *
 *  2. Numbers, codes and anything with a digit are left exactly as they are.
 *     "Chambal Trading Co. 7" keeps its 7, and GSTINs, phone numbers, receipt
 *     numbers and amounts are never touched.
 *
 * This is display only. Search, invoices and anything sent to the server keep
 * the original text, so nothing stops matching.
 */


/**
 * Names that appear in the data, spelled correctly rather than sounded out.
 *
 * Phonetic transliteration cannot know that "Malviya" is मालवीय and not मलविय —
 * Roman does not record vowel length. For the words that actually occur, the
 * correct spelling is written down; everything else falls back to the rules
 * below, which are good enough to be read aloud.
 */
const KNOWN = {
  // Places
  jaipur: 'जयपुर', malviya: 'मालवीय', vaishali: 'वैशाली', mansarovar: 'मानसरोवर',
  jhotwara: 'झोटवाड़ा', tonk: 'टोंक', raja: 'राजा', adarsh: 'आदर्श',
  sitapura: 'सीतापुरा', vidhyadhar: 'विद्याधर', bani: 'बनी', marwar: 'मारवाड़',
  chambal: 'चंबल', pushkar: 'पुष्कर', ajmer: 'अजमेर', udaipur: 'उदयपुर',
  jodhpur: 'जोधपुर', kota: 'कोटा', bikaner: 'बीकानेर', delhi: 'दिल्ली',
  mi: 'एम आई', 'c-scheme': 'सी-स्कीम',

  // Names and brand words
  shree: 'श्री', shri: 'श्री', mahadev: 'महादेव', royal: 'रॉयल',
  national: 'नेशनल', star: 'स्टार', golden: 'गोल्डन', apex: 'एपेक्स',
  lakeview: 'लेकव्यू', ganesh: 'गणेश', krishna: 'कृष्णा', laxmi: 'लक्ष्मी',
  balaji: 'बालाजी', gupta: 'गुप्ता', sharma: 'शर्मा', jain: 'जैन',
  agarwal: 'अग्रवाल', ravi: 'रवि', amit: 'अमित', rajesh: 'राजेश',
  priya: 'प्रिया', neha: 'नेहा', manish: 'मनीष', devika: 'देविका',
  naresh: 'नरेश', vikram: 'विक्रम', sanjay: 'संजय', ramesh: 'रमेश',
  mahesh: 'महेश', patel: 'पटेल', singh: 'सिंह', kumar: 'कुमार',

  // Products
  besan: 'बेसन', dal: 'दाल', chana: 'चना', atta: 'आटा', rice: 'राइस',
  basmati: 'बासमती', salt: 'सॉल्ट', sugar: 'शुगर', oil: 'ऑयल', tea: 'टी',
  pack: 'पैक', kg: 'केजी',

  /**
   * The catalogue, word by word.
   *
   * Every word that appears in a product name, spelled the way the trade writes
   * it. These are the words a packer reads most often and the ones the letter
   * rules get worst: "sabut" sounded out is सबुट, which is not a word — the
   * pulse is साबुत. Forty-odd entries cover all 36 products.
   */
  arhar: 'अरहर', big: 'बिग', bold: 'बोल्ड', bura: 'बूरा', butter: 'बटर',
  channa: 'चना', chilka: 'छिलका', chitra: 'चित्रा', chocolate: 'चॉकलेट',
  cholla: 'छोला', cutting: 'कटिंग', daal: 'दाल', dana: 'दाना', desi: 'देसी',
  dollar: 'डॉलर', gold: 'गोल्ड', green: 'ग्रीन', jhambu: 'झांबू',
  kabuli: 'काबुली', kala: 'काला', kali: 'काली', lobiya: 'लोबिया',
  malka: 'मलका', masoor: 'मसूर', matar: 'मटर', mishri: 'मिश्री', mix: 'मिक्स',
  mofhli: 'मूंगफली', moofhli: 'मूंगफली', mogar: 'मोगर', moong: 'मूंग',
  moth: 'मोठ', peanut: 'पीनट', poha: 'पोहा', rajma: 'राजमा', red: 'रेड',
  regular: 'रेगुलर', sabu: 'साबू', sabut: 'साबुत', safed: 'सफ़ेद',
  silver: 'सिल्वर', small: 'स्मॉल', soyabean: 'सोयाबीन', urad: 'उड़द',
  white: 'व्हाइट',
};

/**
 * Common words, spelled in Devanagari rather than translated.
 *
 * The sound is what matters: "Mahesh Store" reads as "महेश स्टोर", not
 * "महेश दुकान" — that would rename someone's business. These entries exist
 * only because the letter rules below cannot guess English spelling, not to
 * change what any word means.
 */
const WORDS = {
  wholesale: 'होलसेल',
  traders: 'ट्रेडर्स',
  trading: 'ट्रेडिंग',
  trader: 'ट्रेडर',
  general: 'जनरल',
  provision: 'प्रोविज़न',
  departmental: 'डिपार्टमेंटल',
  kirana: 'किराना',
  store: 'स्टोर',
  stores: 'स्टोर्स',
  mart: 'मार्ट',
  supermart: 'सुपरमार्ट',
  supermarket: 'सुपरमार्केट',
  agency: 'एजेंसी',
  agencies: 'एजेंसीज़',
  enterprises: 'एंटरप्राइज़ेज़',
  enterprise: 'एंटरप्राइज़',
  brothers: 'ब्रदर्स',
  sons: 'संस',
  company: 'कंपनी',
  'co.': 'कं.',
  co: 'को',
  and: 'एंड',
  the: 'द',
  new: 'न्यू',
  shop: 'शॉप',
  market: 'मार्केट',
  road: 'रोड',
  nagar: 'नगर',
  park: 'पार्क',
  colony: 'कॉलोनी',
  scheme: 'स्कीम',
  sector: 'सेक्टर',
  bazar: 'बाज़ार',
  bazaar: 'बाज़ार',
};

/**
 * Multi-letter sounds first — order matters, because "sh" must be found before
 * "s", and "aa" before "a", or the output turns to nonsense.
 */
const CLUSTERS = [
  ['shri', 'श्री'], ['shre', 'श्रे'], ['chh', 'छ'], ['sch', 'स्क'],
  ['tch', 'च'], ['ph', 'फ'], ['bh', 'भ'], ['dh', 'ध'], ['gh', 'घ'],
  ['jh', 'झ'], ['kh', 'ख'], ['th', 'थ'], ['ch', 'च'], ['sh', 'श'],
  ['ng', 'ंग'], ['ny', 'न्य'], ['qu', 'क्व'], ['ck', 'क'],
];

const VOWELS = {
  aa: 'ा', ai: 'ै', au: 'ौ', ee: 'ी', oo: 'ू', ea: 'ी', ie: 'ी',
  a: '', i: 'ि', u: 'ु', e: 'े', o: 'ो',
};

const INITIAL_VOWELS = {
  aa: 'आ', ai: 'ऐ', au: 'औ', ee: 'ई', oo: 'ऊ', ea: 'ई',
  a: 'अ', i: 'इ', u: 'उ', e: 'ए', o: 'ओ',
};

const CONSONANTS = {
  k: 'क', g: 'ग', c: 'क', j: 'ज', t: 'ट', d: 'ड', n: 'न', p: 'प',
  b: 'ब', m: 'म', y: 'य', r: 'र', l: 'ल', v: 'व', w: 'व', s: 'स',
  h: 'ह', f: 'फ़', z: 'ज़', x: 'क्स', q: 'क',
};

/** One word, sounded out. */
const transliterateWord = (word) => {
  const lower = word.toLowerCase();
  if (KNOWN[lower]) return KNOWN[lower];
  if (WORDS[lower]) return WORDS[lower];

  let out = '';
  let i = 0;
  let atStart = true;

  while (i < lower.length) {
    // Consonant clusters.
    const cluster = CLUSTERS.find(([from]) => lower.startsWith(from, i));
    if (cluster) {
      out += cluster[1];
      i += cluster[0].length;
      atStart = false;
      continue;
    }

    // Two-letter vowels before single ones, or "aa" becomes "a"+"a".
    const twoVowel = Object.keys(VOWELS).find((v) => v.length === 2 && lower.startsWith(v, i));
    if (twoVowel) {
      out += atStart ? INITIAL_VOWELS[twoVowel] : VOWELS[twoVowel];
      i += 2;
      atStart = false;
      continue;
    }

    const ch = lower[i];
    if (VOWELS[ch] !== undefined) {
      out += atStart ? INITIAL_VOWELS[ch] : VOWELS[ch];
      i += 1;
      atStart = false;
      continue;
    }
    if (CONSONANTS[ch]) {
      const next = lower[i + 1];
      const nextIsConsonant = next && !VOWELS[next] && CONSONANTS[next];

      // "n" or "m" before another consonant is a nasal, not a syllable:
      // Tonk is टोंक, not टोनक; Chambal is चंबल, not चमबल.
      if ((ch === 'n' || ch === 'm') && nextIsConsonant) {
        out += 'ं';
        i += 1;
        atStart = false;
        continue;
      }

      out += CONSONANTS[ch];
      // Two consonants together are joined, or they each pick up an unwanted
      // "a" — which is what turned "star" into सटर instead of स्टार.
      if (nextIsConsonant) out += '्';
      i += 1;
      atStart = false;
      continue;
    }

    // Anything else — punctuation, a stray symbol — passes through.
    out += word[i];
    i += 1;
  }
  return out;
};

/**
 * Renders a stored name in Devanagari.
 *
 * Anything containing a digit is returned untouched: that covers order numbers,
 * GSTINs, phone numbers, PIN codes and the trailing counters on party names.
 */
export const toDevanagari = (text) => {
  if (!text) return text;
  const input = String(text);

  return input
    .split(/(\s+)/)
    .map((chunk) => {
      if (/^\s+$/.test(chunk)) return chunk;
      // A digit anywhere means it is an identifier, not a word.
      if (/\d/.test(chunk)) return chunk;
      // Already Devanagari, or not Roman letters at all.
      if (!/[a-zA-Z]/.test(chunk)) return chunk;

      const leading = chunk.match(/^[^a-zA-Z]*/)[0];
      const trailing = chunk.match(/[^a-zA-Z]*$/)[0];
      const core = chunk.slice(leading.length, chunk.length - trailing.length || undefined);

      // Keep "Co." style abbreviations whole.
      const withDot = `${core}${trailing}`.toLowerCase();
      if (WORDS[withDot]) return leading + WORDS[withDot];

      return leading + transliterateWord(core) + trailing;
    })
    .join('');
};

/**
 * What to show for a name, given the chosen language.
 *
 * Only Hindi changes the script. Hinglish deliberately leaves names in Roman —
 * the whole point of Hinglish is that it is read in Roman.
 */
export const displayName = (language, text) => (language === 'hi' ? toDevanagari(text) : text);
