// Refining profit calculation logic.
// All prices are in silver. Effective costs are computed after applying RRR.

// ─── Constants ────────────────────────────────────────────────────────────────

export const RRR_NO_FOCUS = 0.367; // specialized city, no focus
export const RRR_FOCUS    = 0.539; // specialized city, with focus
export const TAX          = 0.03;  // market tax (3%)

// Raw input counts per recipe variant.
// R1 = standard (bruts only + 1 rafInf from tier below)
// R2 = city heart (fewer bruts + 1 heart + 1 rafInf from tier below)
export const RECIPES = {
  4: { r1: 2, r2: 1 },
  5: { r1: 3, r2: 2 },
  6: { r1: 4, r2: 3 },
  7: { r1: 5, r2: 4 },
  8: { r1: 5, r2: 4 },
};

// ─── Functions ────────────────────────────────────────────────────────────────

/**
 * Effective cost of refining one unit (both variants).
 * (1 - rrr) accounts for raw resources returned by the refining station.
 *
 * @param {number}  tier
 * @param {number}  priceBrut    Market price of one raw resource
 * @param {number}  priceRafInf  Market price of one refined unit (tier - 1)
 * @param {number}  priceHeart   Market price of one city heart
 * @param {boolean} useFocus
 * @returns {{ r1, r2, best, decision: 'r1'|'r2', rrr }}
 */
export function calcRecipe(tier, priceBrut, priceRafInf, priceHeart, useFocus) {
  const rrr    = useFocus ? RRR_FOCUS : RRR_NO_FOCUS;
  const recipe = RECIPES[tier];

  const r1 = (recipe.r1 * priceBrut + priceRafInf)              * (1 - rrr);
  const r2 = (recipe.r2 * priceBrut + priceRafInf + priceHeart) * (1 - rrr);

  const decision = r1 <= r2 ? 'r1' : 'r2';
  return { r1, r2, best: Math.min(r1, r2), decision, rrr };
}

/**
 * Net profit from selling one refined unit on the market after tax.
 *
 * @param {number} salePriceHDV  Listed sell price (before tax)
 * @param {number} recipeCost    Effective craft cost (from calcRecipe)
 * @returns {{ profit, salePriceAfterTax }}
 */
export function calcProfit(salePriceHDV, recipeCost) {
  const salePriceAfterTax = salePriceHDV * (1 - TAX);
  return { profit: salePriceAfterTax - recipeCost, salePriceAfterTax };
}

/**
 * Break-even cost when accounting for premium subscription and focus usage.
 * costPerFocus = cost of 1 focus point, assuming 300,000 focus per premium month.
 *
 * @param {number} recipeCost     Effective craft cost
 * @param {number} premiumSilver  Monthly premium price in silver
 * @param {number} focusCost      Focus points consumed per craft
 * @returns {{ equilibrium, focusSilver, costPerFocus }}
 */
export function calcEquilibriumPrice(recipeCost, premiumSilver, focusCost) {
  const costPerFocus = premiumSilver / 300_000;
  const focusSilver  = costPerFocus * focusCost;
  return { equilibrium: recipeCost + focusSilver, focusSilver, costPerFocus };
}

/**
 * Silver earned per focus point spent (efficiency metric for focus planning).
 * Returns null when focusCost is 0 to avoid division-by-zero in the UI.
 *
 * @param {number} profit
 * @param {number} focusCost
 * @returns {number|null}
 */
export function calcSPF(profit, focusCost) {
  return focusCost > 0 ? profit / focusCost : null;
}

/**
 * Total investment and units produced for a bulk batch.
 *
 * unitsProduced accounts for the raw resources returned by the station (RRR):
 * a batch of N raws produces floor(N / brutsPerCraft / (1 - rrr)) refined units.
 *
 * @param {number}        recipeCost   Effective cost per unit
 * @param {number}        batchSize    Number of raw inputs available
 * @param {number}        tier
 * @param {boolean}       useFocus
 * @param {'r1'|'r2'}     decision     Which recipe variant to use
 * @returns {{ investGlobal, unitsProduced }}
 */
export function calcBatchInvestment(recipeCost, batchSize, tier, useFocus, decision = 'r1') {
  const rrr             = useFocus ? RRR_FOCUS : RRR_NO_FOCUS;
  const brutsPerCraft   = RECIPES[tier][decision];
  const unitsProduced   = Math.floor(batchSize / brutsPerCraft / (1 - rrr));
  return { investGlobal: unitsProduced * recipeCost, unitsProduced };
}

/**
 * Full calculation for one row of the results table (one tier + enchant combination).
 * Orchestrates: calcRecipe → calcProfit → calcEquilibriumPrice → calcSPF → calcBatchInvestment.
 * Returns null if any required market price is missing or zero (no active listing).
 *
 * @param {number} tier
 * @param {number} enchant  0–4
 * @param {{ brut: number, rafInf: number, bar: number }} prices
 * @param {{ useFocus: boolean, premiumSilver: number, focusCost: number, heartPrice: number, batchSize: number }} config
 * @returns {object|null}
 */
export function calcFullRow(tier, enchant, prices, config) {
  const { useFocus, premiumSilver, focusCost, heartPrice, batchSize } = config;
  const { brut, rafInf, bar } = prices;

  if (!brut || !rafInf || !bar) return null;

  const recipe                        = calcRecipe(tier, brut, rafInf, heartPrice, useFocus);
  const { profit, salePriceAfterTax } = calcProfit(bar, recipe.best);
  const { equilibrium, focusSilver, costPerFocus } = calcEquilibriumPrice(
    recipe.best, premiumSilver, focusCost
  );
  const spf                           = calcSPF(profit, focusCost);
  const { investGlobal, unitsProduced } = calcBatchInvestment(
    recipe.best, batchSize, tier, useFocus, recipe.decision
  );

  return {
    tier,
    enchant,
    // Recipe
    r1:                 recipe.r1,
    r2:                 recipe.r2,
    best:               recipe.best,
    decision:           recipe.decision,
    rrr:                recipe.rrr,
    // Profit
    profit,
    salePriceAfterTax,
    // Focus accounting
    equilibrium,
    focusSilver,
    costPerFocus,
    spf,
    // Batch
    investGlobal,
    unitsProduced,
    // True profit after subtracting focus opportunity cost
    profitOverDecision: salePriceAfterTax - equilibrium,
  };
}
