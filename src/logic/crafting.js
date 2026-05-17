// Pure crafting profit calculations.
// CRR (Crafting Return Rate): fraction of refined materials returned by the station.
// Artifacts are NOT returned — their cost is added flat after applying CRR to bars.
//
// Cost = (qty1*bar1 + qty2*bar2) * (1 - crr) + artifactCost
// Profit = salePrice * (1 - tax) - cost

export const DEFAULT_CRR_NO_FOCUS = 0.152;
export const DEFAULT_CRR_FOCUS    = 0.369;

/**
 * Full row calculation for one item × tier × enchant.
 * Supports single-resource, two-resource, and artifact items.
 *
 * @param {number}      qty          Primary bar quantity
 * @param {number|null} barCost      Primary bar cost per unit
 * @param {number}      qty2         Secondary bar quantity (0 if none)
 * @param {number|null} barCost2     Secondary bar cost per unit (null if none)
 * @param {number}      artifactCost Artifact price (0 if none); not subject to CRR
 * @param {number|null} salePrice    HDV sell price of the crafted item
 * @param {number}      crr          Crafting Return Rate (0–1)
 * @param {number}      tax          Market tax rate (0–1)
 */
export function calcCraftRow(qty, barCost, qty2, barCost2, artifactCost, salePrice, crr, tax) {
  if (!barCost) return null;
  if (qty2 && !barCost2) return null;

  const matCost   = qty * barCost + (qty2 && barCost2 ? qty2 * barCost2 : 0);
  const craftCost = matCost * (1 - crr) + (artifactCost || 0);

  if (!salePrice) return { craftCost, saleAfterTax: null, profit: null, roi: null };

  const saleAfterTax = salePrice * (1 - tax);
  const profit       = saleAfterTax - craftCost;
  const roi          = craftCost > 0 ? profit / craftCost : null;
  return { craftCost, saleAfterTax, profit, roi };
}
