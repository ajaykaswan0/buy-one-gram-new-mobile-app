/**
 * The words the API sends back, in each language.
 *
 * These are the values stored in the database — `pending_handover`, `cod`,
 * `short_visit` — and they reach the screen as-is. They are not names, so
 * unlike a party or a product they can be translated properly rather than
 * transliterated: every one of them has a real Hindi equivalent.
 *
 * Keyed on the raw stored value, so an enum nobody has translated yet falls
 * back to a tidied-up version of the English rather than vanishing.
 */
const TERMS = {
  // ── Order status ────────────────────────────────────────────────────────
  draft: { en: 'Draft', hi: 'ड्राफ़्ट', hinglish: 'Draft' },
  confirmed: { en: 'Confirmed', hi: 'पक्का हुआ', hinglish: 'Confirm ho gaya' },
  warehouse: { en: 'Warehouse', hi: 'गोदाम में', hinglish: 'Warehouse mein' },
  packed: { en: 'Packed', hi: 'पैक हो गया', hinglish: 'Pack ho gaya' },
  ready_for_delivery: { en: 'Ready for delivery', hi: 'डिलीवरी के लिए तैयार', hinglish: 'Delivery ke liye ready' },
  // Statuses the driver's own screens show that were not yet covered.
  planned: { en: 'Planned', hi: 'तय है', hinglish: 'Plan ho gaya' },
  in_transit: { en: 'In transit', hi: 'रास्ते में', hinglish: 'Raste mein' },
  dispatched: { en: 'Dispatched', hi: 'भेज दिया', hinglish: 'Nikal gaya' },
  delivered: { en: 'Delivered', hi: 'पहुँच गया', hinglish: 'Deliver ho gaya' },
  cancelled: { en: 'Cancelled', hi: 'रद्द', hinglish: 'Cancel' },
  returned: { en: 'Returned', hi: 'वापस आ गया', hinglish: 'Wapas aa gaya' },

  // ── How it is being paid for ────────────────────────────────────────────
  credit: { en: 'Credit', hi: 'उधार', hinglish: 'Credit' },
  prepaid: { en: 'Prepaid', hi: 'पहले चुकाया', hinglish: 'Pehle paid' },
  cod: { en: 'Cash on delivery', hi: 'डिलीवरी पर नकद', hinglish: 'Cash on delivery' },

  // ── Payment mode ────────────────────────────────────────────────────────
  cash: { en: 'Cash', hi: 'नकद', hinglish: 'Cash' },
  cheque: { en: 'Cheque', hi: 'चेक', hinglish: 'Cheque' },
  online: { en: 'Online', hi: 'ऑनलाइन', hinglish: 'Online' },
  upi: { en: 'UPI', hi: 'UPI', hinglish: 'UPI' },
  bank_transfer: { en: 'Bank transfer', hi: 'बैंक ट्रांसफ़र', hinglish: 'Bank transfer' },
  other: { en: 'Other', hi: 'अन्य', hinglish: 'Doosra' },

  // ── Where a payment has got to ──────────────────────────────────────────
  unallocated: { en: 'Not allocated', hi: 'किसी बिल पर नहीं लगा', hinglish: 'Kisi bill pe nahi laga' },
  allocated_pending: { en: 'Allocated, not settled', hi: 'लगाया, सेटल नहीं', hinglish: 'Laga diya, settle nahi' },
  pending_handover: { en: 'Cash with the salesman', hi: 'नकद सेल्समैन के पास', hinglish: 'Cash salesman ke paas' },
  pending_verification: { en: 'Awaiting verification', hi: 'जाँच बाकी', hinglish: 'Verify hona baaki' },
  received: { en: 'Received', hi: 'मिल गया', hinglish: 'Mil gaya' },
  held: { en: 'On hold', hi: 'रोका हुआ', hinglish: 'Rok ke rakha hai' },
  deposited: { en: 'Banked', hi: 'बैंक में जमा', hinglish: 'Bank mein jama' },
  cleared: { en: 'Cleared', hi: 'क्लियर हो गया', hinglish: 'Clear ho gaya' },
  completed: { en: 'Settled', hi: 'पूरा हुआ', hinglish: 'Settle ho gaya' },
  bounced: { en: 'Bounced', hi: 'बाउंस हो गया', hinglish: 'Bounce ho gaya' },
  rejected: { en: 'Rejected', hi: 'नामंज़ूर', hinglish: 'Reject ho gaya' },
  suspicious: { en: 'Flagged', hi: 'संदिग्ध', hinglish: 'Doubt hai' },
  pending: { en: 'Pending', hi: 'बाकी', hinglish: 'Pending' },
  // ── Packing ─────────────────────────────────────────────────────────────
  in_progress: { en: 'Being packed', hi: 'पैक हो रहा है', hinglish: 'Pack ho raha hai' },
  reconciliation_requested: { en: 'Sent back — short', hi: 'वापस भेजा — माल कम', hinglish: 'Wapas bheja — maal kam' },
  verified: { en: 'Verified', hi: 'जाँच हो गई', hinglish: 'Verify ho gaya' },

  // ── Visits ──────────────────────────────────────────────────────────────
  ongoing: { en: 'Going on', hi: 'चल रही है', hinglish: 'Chal rahi hai' },
  visited: { en: 'Visited', hi: 'हो गई', hinglish: 'Ho gayi' },
  short_visit: { en: 'Too short', hi: 'बहुत छोटी', hinglish: 'Bahut chhoti thi' },
  not_visited: { en: 'Not visited', hi: 'नहीं हुई', hinglish: 'Nahi hui' },

  // ── Delivery ────────────────────────────────────────────────────────────
  assigned: { en: 'Assigned', hi: 'सौंपा गया', hinglish: 'Assign ho gaya' },
  out_for_delivery: { en: 'Out for delivery', hi: 'डिलीवरी पर निकला', hinglish: 'Delivery pe nikla' },
  failed: { en: 'Failed', hi: 'नहीं हो पाई', hinglish: 'Nahi ho paayi' },

  // ── Credit notes ────────────────────────────────────────────────────────
  post_delivery: { en: 'After delivery', hi: 'डिलीवरी के बाद', hinglish: 'Delivery ke baad' },
  sales_return: { en: 'Pickup return', hi: 'वापसी उठाई गई', hinglish: 'Pickup return' },
  manual: { en: 'Raised by hand', hi: 'हाथ से बनाया', hinglish: 'Haath se banaya' },
  approved: { en: 'Approved', hi: 'मंज़ूर', hinglish: 'Approve ho gaya' },
  restock: { en: 'Back in stock', hi: 'स्टॉक में वापस', hinglish: 'Stock mein wapas' },
  waste: { en: 'Written off', hi: 'बट्टे खाते', hinglish: 'Write off' },
};

/**
 * Turns a stored value into readable text.
 *
 * An unknown value is tidied rather than dropped — `some_new_status` becomes
 * "Some new status" instead of disappearing, which is what a salesman needs
 * when the backend gains a state the app has not been taught yet.
 */
export const term = (language, value) => {
  if (value === null || value === undefined || value === '') return '';
  const key = String(value).trim().toLowerCase();
  const entry = TERMS[key];
  if (entry) return entry[language] || entry.en;

  const tidied = key.replace(/_/g, ' ');
  return tidied.charAt(0).toUpperCase() + tidied.slice(1);
};

export default TERMS;
