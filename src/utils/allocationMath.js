/**
 * The arithmetic behind the wallet screen, kept out of the component so it can
 * be checked without a phone.
 *
 * A draft is `{ [slipId]: { [billId]: amountAsText } }` — what the user has
 * typed, not what has been saved. Two limits govern every entry, and both are
 * needed: a slip cannot give more than it still holds, and a bill cannot take
 * more than it still owes, however many slips are pointed at it.
 *
 * Both limits are net of what has already been submitted:
 *
 *   - a slip's `free` is its amount less what has settled AND less what it has
 *     already been put against and is waiting on. Submitted money is gone from
 *     the salesman's hands as far as this screen is concerned.
 *   - a bill's `promised` is what other slips have already been put against it.
 *     Without this, two slips could each be shown the bill's full balance and
 *     the same bill would be paid twice.
 */

export const round2 = (v) => Math.round(Number(v || 0) * 100) / 100;

/** What the draft puts from this slip onto this bill. */
export const drafted = (draft, slipId, billId) => Number(parseFloat(draft?.[slipId]?.[billId]) || 0);

/** Of a slip's free money, what the draft has not spent yet. */
export const slipLeft = (draft, slip) => round2(
  slip.free - Object.values(draft?.[slip._id] || {}).reduce((sum, v) => sum + (parseFloat(v) || 0), 0),
);

/** What a bill can still take, after what is already promised and what is drafted. */
export const billLeft = (draft, slips, bill) => round2(
  bill.balance - bill.promised - slips.reduce((sum, slip) => sum + drafted(draft, slip._id, bill._id), 0),
);

/** The most this one slip-and-bill pair may be set to. */
export const ceilingFor = (draft, slips, slip, bill) => {
  const here = drafted(draft, slip._id, bill._id);
  return round2(Math.max(0, Math.min(slipLeft(draft, slip) + here, billLeft(draft, slips, bill) + here)));
};

/** Sets one pair, never above its ceiling. Returns the new draft. */
export const place = (draft, slips, slip, bill, raw) => {
  const text = String(raw).replace(/[^0-9.]/g, '');
  const ceiling = ceilingFor(draft, slips, slip, bill);
  const value = (parseFloat(text) || 0) > ceiling ? String(ceiling) : text;
  return { ...draft, [slip._id]: { ...(draft?.[slip._id] || {}), [bill._id]: value } };
};

/** Everything the draft is about to place, across every slip. */
export const draftTotal = (draft, slips) => round2(slips.reduce(
  (sum, slip) => sum + Object.values(draft?.[slip._id] || {}).reduce((s, v) => s + (parseFloat(v) || 0), 0), 0,
));

/** What stays in the wallet if the draft is submitted as it stands. */
export const walletLeft = (draft, slips) => round2(
  slips.reduce((sum, slip) => sum + slipLeft(draft, slip), 0),
);
