/**
 * How a pack size is written, and what a kilo of it costs.
 *
 * The filter tabs read "500", "1", "30" — a bare number that says nothing about
 * whether it is grams or kilos. And a 30kg rate of 3,150 cannot be compared with
 * a 1kg rate of 114 by eye, which is the comparison a salesman standing in a
 * shop actually needs to make.
 *
 * So the label carries its unit, and the big packs carry their per-kilo price
 * beside the pack price. Only the big ones: on a 500gm pack the per-kilo figure
 * is noise, and on a 1kg pack it is the same number twice.
 */

/** Pack sizes big enough that a per-kilo price is worth showing, and their weight. */
const PER_KG_PACKS = { '30kg': 30, '10kg': 10 };

/** "500" + "gm" -> "500gm". Falls back to whatever the variant is called. */
export const packLabel = (packSize, unit, variantName) => {
  const size = String(packSize ?? '').trim();
  const suffix = String(unit ?? '').trim();
  if (size && suffix) return `${size}${suffix}`;
  return String(variantName ?? size ?? '').trim();
};

/** The weight in kilos, where this pack is one we quote per kilo. */
export const perKgWeight = (packSize, unit, variantName) => PER_KG_PACKS[packLabel(packSize, unit, variantName)] || 0;

/**
 * "(₹105.00/kg)" for a 30kg or 10kg pack, and nothing at all for the rest.
 */
export const perKgLabel = (rate, packSize, unit, variantName) => {
  const weight = perKgWeight(packSize, unit, variantName);
  const price = Number(rate);
  if (!weight || !Number.isFinite(price) || price <= 0) return '';
  return `(₹${(price / weight).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/kg)`;
};

export default packLabel;
