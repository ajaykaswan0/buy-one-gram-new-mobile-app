/**
 * The pack label and per-kilo price, checked.
 *
 * Run with `node tools/check-pack-label.js` from the MobileApp folder.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'src/utils/packLabel.js'), 'utf8')
  .replace(/export const /g, 'const ').replace(/export default[\s\S]*$/, '');
const { packLabel, perKgLabel } = (new Function(`${src}; return { packLabel, perKgLabel };`))();

// The unit comes back onto the label.
assert.strictEqual(packLabel('500', 'gm'), '500gm');
assert.strictEqual(packLabel('30', 'kg'), '30kg');
assert.strictEqual(packLabel('', '', '10kg'), '10kg');

// Only the big packs quote a kilo price, and they quote it right.
assert.strictEqual(perKgLabel(3150, '30', 'kg'), '(\u20b9105.00/kg)');
assert.strictEqual(perKgLabel(1112.5, '10', 'kg'), '(\u20b9111.25/kg)');
assert.strictEqual(perKgLabel(114.5, '1', 'kg'), '');
assert.strictEqual(perKgLabel(58.38, '500', 'gm'), '');
assert.strictEqual(perKgLabel(553.75, '5', 'kg'), '');

// A pack with no price says nothing rather than dividing by nothing.
assert.strictEqual(perKgLabel(0, '30', 'kg'), '');
assert.strictEqual(perKgLabel(null, '30', 'kg'), '');

console.log('pack label: units shown, per-kilo only on 30kg and 10kg');
