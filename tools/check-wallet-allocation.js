/**
 * The wallet screen's arithmetic, on the example the work was asked for.
 *
 * Four collections of 10,000 and five bills of 15,000 / 12,000 / 13,000 /
 * 20,000 / 10,000. The 15,000 bill is closed off two slips - 10,000 from the
 * first and 5,000 from the second - and the wallet must read 25,000 afterwards,
 * with the second slip still holding 5,000 for the next bill.
 *
 *   node tools/check-wallet-allocation.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

// The module is ESM for the bundler; loaded here without a build step.
const src = fs.readFileSync(path.join(__dirname, '../src/utils/allocationMath.js'), 'utf8');
const m = {};
new Function('exports', `${src.replace(/export const /g, 'const ')}
  Object.assign(exports, { round2, drafted, slipLeft, billLeft, ceilingFor, place, draftTotal, walletLeft });`)(m);
const { billLeft, ceilingFor, draftTotal, drafted, place, slipLeft, walletLeft } = m;

const slips = [1, 2, 3, 4].map((n) => ({ _id: `s${n}`, free: 10000 }));
const bills = [15000, 12000, 13000, 20000, 10000].map((b, i) => ({ _id: `b${i + 1}`, balance: b, promised: 0 }));
const bill = (id) => bills.find((b) => b._id === id);
const slip = (id) => slips.find((s) => s._id === id);

let draft = {};
assert.strictEqual(walletLeft(draft, slips), 40000, 'four cheques of 10,000 read as a wallet of 40,000');

// Slip 1, all of it, onto the 15,000 bill.
draft = place(draft, slips, slip('s1'), bill('b1'), '10000');
assert.strictEqual(slipLeft(draft, slip('s1')), 0, 'slip 1 is spent');
assert.strictEqual(billLeft(draft, slips, bill('b1')), 5000, 'the 15,000 bill still wants 5,000');
assert.strictEqual(walletLeft(draft, slips), 30000, 'the wallet is down to 30,000');

// Slip 2 closes it, and only 5,000 of slip 2 is used.
draft = place(draft, slips, slip('s2'), bill('b1'), '5000');
assert.strictEqual(billLeft(draft, slips, bill('b1')), 0, 'the 15,000 bill is covered');
assert.strictEqual(slipLeft(draft, slip('s2')), 5000, 'slip 2 keeps 5,000 for the next bill');
assert.strictEqual(walletLeft(draft, slips), 25000, 'the wallet reads 25,000, as the example says');
assert.strictEqual(draftTotal(draft, slips), 15000, '15,000 is being placed');

// One bill, two slips, both recorded — the reference the user asked to keep.
const onB1 = slips.filter((s) => drafted(draft, s._id, 'b1') > 0).map((s) => s._id);
assert.deepStrictEqual(onB1, ['s1', 's2'], 'the bill carries both slips as its reference');

// A covered bill can take nothing more, from any slip.
assert.strictEqual(ceilingFor(draft, slips, slip('s3'), bill('b1')), 0, 'a covered bill takes nothing more');
draft = place(draft, slips, slip('s3'), bill('b1'), '4000');
assert.strictEqual(drafted(draft, 's3', 'b1'), 0, 'and typing into it is held at nil');

// A slip cannot give more than it holds, even to a bill that wants more.
assert.strictEqual(ceilingFor(draft, slips, slip('s2'), bill('b4')), 5000, 'slip 2 can give its remaining 5,000');
draft = place(draft, slips, slip('s2'), bill('b4'), '20000');
assert.strictEqual(drafted(draft, 's2', 'b4'), 5000, 'asking for 20,000 from a 5,000 slip gives 5,000');
assert.strictEqual(slipLeft(draft, slip('s2')), 0, 'slip 2 is now spent');

// Clearing an entry puts the money back, live.
draft = place(draft, slips, slip('s2'), bill('b4'), '');
assert.strictEqual(walletLeft(draft, slips), 25000, 'clearing an entry returns it to the wallet');

// Nothing is ever over-placed: every slip and every bill stays within itself.
draft = place(draft, slips, slip('s3'), bill('b2'), '10000');
draft = place(draft, slips, slip('s4'), bill('b2'), '10000');
assert.strictEqual(drafted(draft, 's4', 'b2'), 2000, 'the second slip only fills what the 12,000 bill had left');
for (const s of slips) assert.ok(slipLeft(draft, s) >= -0.001, `${s._id} is not overdrawn`);
for (const b of bills) assert.ok(billLeft(draft, slips, b) >= -0.001, `${b._id} is not over-paid`);

// A bill another slip has already been put against offers only what is left of
// it. Without this both slips are shown the full balance and it is paid twice.
const halfPromised = [{ _id: 'b9', balance: 12000, promised: 7000 }];
const twoSlips = [{ _id: 'x1', free: 10000 }, { _id: 'x2', free: 10000 }];
assert.strictEqual(billLeft({}, twoSlips, halfPromised[0]), 5000, 'a bill 7,000 of which is promised has 5,000 left');
assert.strictEqual(ceilingFor({}, twoSlips, twoSlips[0], halfPromised[0]), 5000, 'and no slip may exceed that');
let d2 = place({}, twoSlips, twoSlips[0], halfPromised[0], '5000');
assert.strictEqual(billLeft(d2, twoSlips, halfPromised[0]), 0, 'the second slip closes it');
assert.strictEqual(ceilingFor(d2, twoSlips, twoSlips[1], halfPromised[0]), 0, 'a third slip is offered nothing');

// A slip that has promised part of itself offers only the rest.
const partlyPromised = { _id: 'x3', free: 4000 };   // 10,000 collected, 6,000 already put on a bill
assert.strictEqual(slipLeft({}, partlyPromised), 4000, 'only the free part of a slip is on offer');
const capped = place({}, [partlyPromised], partlyPromised, { _id: 'b9', balance: 50000, promised: 0 }, '9000');
assert.strictEqual(drafted(capped, 'x3', 'b9'), 4000, 'asking for more than the free part gives the free part');

console.log('wallet allocation: 40,000 in four slips closes a 15,000 bill off two of them and reads 25,000 after; a promised bill offers only its remainder and a promised slip only its free part');
