/**
 * The allocation arithmetic, on the case that was reported.
 *
 * 20,000 collected against five open bills. Allocate 2,000 to a 2,000 bill; it
 * clears and 18,000 is left. Come back, allocate 3,000 to a 5,000 bill; that
 * bill should then show 2,000 still owed and 15,000 should be left — and the
 * first allocation must still be there, which is what the old sheet lost.
 */
const assert = require('assert');

const round2 = (v) => Number(Number(v || 0).toFixed(2));

/** The sheet's model: what the boxes hold, and what falls out of them. */
const sheet = (receipt, bills, promisedByOthers = {}, mine = {}) => {
  const amounts = { ...mine };
  const free = (bill) => round2(Number(bill.balanceDue) - (promisedByOthers[bill.id] || 0));
  const used = () => round2(Object.values(amounts).reduce((s, v) => s + (parseFloat(v) || 0), 0));
  const others = (except) => round2(Object.entries(amounts).filter(([id]) => id !== except)
    .reduce((s, [, v]) => s + (parseFloat(v) || 0), 0));
  return {
    amounts,
    left: () => round2(receipt - used()),
    used,
    ceiling: (bill) => round2(Math.min(free(bill), receipt - others(bill.id))),
    put(bill, value) {
      const ceiling = this.ceiling(bill);
      amounts[bill.id] = String(Math.min(parseFloat(value) || 0, ceiling));
      return this;
    },
    clear(bill) { delete amounts[bill.id]; return this; },
    // What the list shows: a bill with nothing left to promise drops out,
    // unless this payment is already on it.
    visible: (list) => list.filter((b) => free(b) > 0.01 || amounts[b.id]),
    remaining: (bill) => round2(free(bill) - (parseFloat(amounts[bill.id]) || 0)),
  };
};

const bills = [
  { id: 'b1', balanceDue: 2000 },
  { id: 'b2', balanceDue: 5000 },
  { id: 'b3', balanceDue: 8000 },
  { id: 'b4', balanceDue: 3000 },
  { id: 'b5', balanceDue: 9000 },
];

// First visit: 20,000 in hand, nothing allocated.
let s = sheet(20000, bills);
assert.strictEqual(s.left(), 20000);
assert.strictEqual(s.visible(bills).length, 5);

s.put(bills[0], 2000);
assert.strictEqual(s.used(), 2000, 'allocating 2,000 should be counted');
assert.strictEqual(s.left(), 18000, '18,000 should be left, live');
assert.strictEqual(s.remaining(bills[0]), 0, 'a 2,000 bill paid 2,000 clears');

// Taking it off again puts the money back, live.
s.clear(bills[0]);
assert.strictEqual(s.left(), 20000, 'removing an allocation returns the money');
s.put(bills[0], 2000);

// Second visit: the sheet reloads with what this payment already carries.
s = sheet(20000, bills, {}, { b1: '2000' });
assert.strictEqual(s.used(), 2000, 'the earlier allocation must come back prefilled');
assert.strictEqual(s.left(), 18000, 'unallocated should read 18,000 on reopening');

s.put(bills[1], 3000);
assert.strictEqual(s.left(), 15000, '15,000 left after a second 3,000');
assert.strictEqual(s.remaining(bills[1]), 2000, 'a 5,000 bill paid 3,000 still owes 2,000');
// Both survive: the whole set is what gets sent, so the first is not dropped.
assert.deepStrictEqual(Object.keys(s.amounts).sort(), ['b1', 'b2']);

// A bill cannot take more than it owes.
s.put(bills[3], 99999);
assert.strictEqual(parseFloat(s.amounts.b4), 3000, 'a 3,000 bill cannot take more than 3,000');

// Nor can the receipt give more than it holds.
s = sheet(20000, bills);
s.put(bills[4], 9000).put(bills[2], 8000).put(bills[1], 5000);
assert.strictEqual(s.used(), 20000, 'the receipt stops at what it holds');
assert.strictEqual(s.left(), 0);
assert.strictEqual(parseFloat(s.amounts.b2), 3000, 'the last bill takes only what is left');

// A bill another payment has fully promised drops out of the list.
s = sheet(5000, bills, { b1: 2000 });
assert.strictEqual(s.visible(bills).length, 4, 'a fully promised bill is not offered again');

console.log('allocation math: live totals, nothing lost on reopening, no bill or receipt overdrawn');
