// Logique de calcul des profits de transmutation (T4→T5→T6→T7→T8).
// Calcule le coût en argent de la chaîne de transmutation (taxe de transmutation)
// et le compare au prix de vente du tier supérieur pour déterminer la rentabilité.

// Toutes les combinaisons tier/enchant possibles (T4.0 → T8.4).
export const TRANSMUTE_TIERS = [];
for (let tier = 4; tier <= 8; tier++) {
  for (let enchant = 0; enchant <= 4; enchant++) {
    TRANSMUTE_TIERS.push({ tier, enchant, label: `T${tier}.${enchant}` });
  }
}

// ─── Helpers internes ────────────────────────────────────────────────────────

// transmuteCosts accepte soit un nombre (silver only), soit { silver, focus }.
function silverOf(cost) {
  if (cost == null) return null;
  return typeof cost === 'object' ? (cost.silver ?? null) : cost;
}

function focusOf(cost) {
  if (cost == null) return 0;
  return typeof cost === 'object' ? (cost.focus ?? 0) : 0;
}

// ─── 1. calcTransmuteCost ────────────────────────────────────────────────────

/**
 * Coût total pour obtenir 1 unité via une transmutation.
 *
 * @param {number} basePrice     - Prix de marché (HDV) de la ressource source.
 * @param {number} transmuteCost - Taxe silver de l'opération.
 * @returns {number}
 */
export function calcTransmuteCost(basePrice, transmuteCost) {
  return basePrice + transmuteCost;
}

// ─── 2. calcTransmuteDecision ────────────────────────────────────────────────

/**
 * Choisit la meilleure option d'acquisition parmi HDV, R1 et R2.
 *
 * @param {number|null} hdvPrice - Achat direct au HDV.
 * @param {number|null} r1Cost   - Obtention via R1 (tier-1 → tier, même enchant).
 * @param {number|null} r2Cost   - Obtention via R2 (enchant-1 → enchant, même tier).
 * @returns {{ best: number, decision: "hdv"|"r1"|"r2", hdvPrice, r1Cost, r2Cost, savings: number }|null}
 */
export function calcTransmuteDecision(hdvPrice, r1Cost, r2Cost) {
  const candidates = [
    { key: 'hdv', cost: hdvPrice },
    { key: 'r1', cost: r1Cost },
    { key: 'r2', cost: r2Cost },
  ].filter(({ cost }) => cost !== null && cost !== undefined && Number.isFinite(cost));

  if (!candidates.length) return null;

  candidates.sort((a, b) => a.cost - b.cost);
  const [winner, runner] = candidates;

  return {
    best: winner.cost,
    decision: winner.key,
    hdvPrice,
    r1Cost,
    r2Cost,
    savings: runner ? runner.cost - winner.cost : 0,
  };
}

// ─── 3. buildTransmuteChain (+ helper interne) ───────────────────────────────

/**
 * Recherche récursive mémoïsée du chemin le moins cher vers (tier, enchant).
 *
 * prices          : prices[tier][enchant] = silver au HDV
 * transmuteCosts  : { r1: { [srcTier]: { [enchant]: cost } },
 *                     r2: { [tier]: { [srcEnchant]: cost } } }
 *                   cost peut être un number (silver) ou { silver, focus }.
 */
function cheapestFor(tier, enchant, prices, transmuteCosts, memo) {
  const key = `${tier}.${enchant}`;
  if (key in memo) return memo[key];

  // Marquer d'abord null pour éviter les cycles (le graphe est un DAG, mais par sécurité).
  memo[key] = null;

  let best = null;

  const update = (candidate) => {
    if (candidate && (!best || candidate.totalCost < best.totalCost)) best = candidate;
  };

  // Option A : achat direct au HDV.
  const buyPrice = prices?.[tier]?.[enchant];
  if (buyPrice != null) {
    update({
      totalCost: buyPrice,
      totalFocus: 0,
      steps: [{
        action: 'buy',
        from: null,
        to: { tier, enchant },
        qty: 1,
        unitCost: buyPrice,
        totalCost: buyPrice,
      }],
    });
  }

  // Option B : R1 depuis (tier-1, enchant) → (tier, enchant).
  if (tier > 4) {
    const srcTier = tier - 1;
    const rawCost = transmuteCosts?.r1?.[srcTier]?.[enchant];
    const silver = silverOf(rawCost);
    if (silver != null) {
      const upstream = cheapestFor(srcTier, enchant, prices, transmuteCosts, memo);
      if (upstream) {
        update({
          totalCost: upstream.totalCost + silver,
          totalFocus: upstream.totalFocus + focusOf(rawCost),
          steps: [
            ...upstream.steps,
            {
              action: 'r1',
              from: { tier: srcTier, enchant },
              to: { tier, enchant },
              qty: 1,
              unitCost: silver,
              totalCost: silver,
            },
          ],
        });
      }
    }
  }

  // Option C : R2 depuis (tier, enchant-1) → (tier, enchant).
  if (enchant > 0) {
    const srcEnchant = enchant - 1;
    const rawCost = transmuteCosts?.r2?.[tier]?.[srcEnchant];
    const silver = silverOf(rawCost);
    if (silver != null) {
      const upstream = cheapestFor(tier, srcEnchant, prices, transmuteCosts, memo);
      if (upstream) {
        update({
          totalCost: upstream.totalCost + silver,
          totalFocus: upstream.totalFocus + focusOf(rawCost),
          steps: [
            ...upstream.steps,
            {
              action: 'r2',
              from: { tier, enchant: srcEnchant },
              to: { tier, enchant },
              qty: 1,
              unitCost: silver,
              totalCost: silver,
            },
          ],
        });
      }
    }
  }

  memo[key] = best;
  return best;
}

/**
 * Calcule la chaîne de transmutations optimale pour obtenir 1x ressource cible.
 *
 * @param {number} targetTier
 * @param {number} targetEnchant
 * @param {object} prices         - prices[tier][enchant] = silver HDV
 * @param {object} transmuteCosts - { r1: {...}, r2: {...} }
 * @returns {Array<{ action: string, from: object|null, to: object, qty: number, unitCost: number, totalCost: number }>}
 */
export function buildTransmuteChain(targetTier, targetEnchant, prices, transmuteCosts) {
  const result = cheapestFor(targetTier, targetEnchant, prices, transmuteCosts, {});
  return result ? result.steps : [];
}

// ─── 4. calcSessionChain ─────────────────────────────────────────────────────

/**
 * Planifie une session complète pour produire qty × ressource cible.
 *
 * stackProfit = true  → raffine les ressources brutes intermédiaires soi-même
 *                        (toRefine contiendra chaque étape de la chaîne)
 * stackProfit = false → achète les bars intermédiaires au HDV
 *                        (toBuy contiendra les bars nécessaires au raffinage)
 *
 * @param {{ tier: number, enchant: number, resourceType: string }} targetItem
 * @param {number}  qty
 * @param {object}  prices
 * @param {object}  transmuteCosts
 * @param {boolean} stackProfit
 * @returns {{ toBuy: Array, toTransmute: Array, toRefine: Array, totalInvest: number, totalFocus: number }|null}
 */
export function calcSessionChain(targetItem, qty, prices, transmuteCosts, stackProfit) {
  const { tier, enchant, resourceType } = targetItem;
  const chain = cheapestFor(tier, enchant, prices, transmuteCosts, {});
  if (!chain) return null;

  const toBuy = [];
  const toTransmute = [];
  const toRefine = [];

  // Répartir les étapes de la chaîne unitaire × qty.
  for (const step of chain.steps) {
    const scaled = { ...step, qty, totalCost: step.unitCost * qty };
    if (step.action === 'buy') toBuy.push(scaled);
    else toTransmute.push(scaled);
  }

  // Nœuds intermédiaires traversés (toutes les étapes sauf la cible finale).
  const intermediates = chain.steps
    .map(s => s.to)
    .filter(n => !(n.tier === tier && n.enchant === enchant));

  if (stackProfit) {
    // Raffiner soi-même à chaque étape intermédiaire pour empiler les profits.
    for (const node of intermediates) {
      toRefine.push({ tier: node.tier, enchant: node.enchant, resourceType, qty });
    }
    toRefine.push({ tier, enchant, resourceType, qty });
  } else {
    // Acheter les bars intermédiaires au HDV (inputs du raffinage final).
    for (const node of intermediates) {
      const barPrice = prices?.[node.tier]?.[node.enchant];
      if (barPrice != null) {
        toBuy.push({
          action: 'buy',
          from: null,
          to: { tier: node.tier, enchant: node.enchant, resourceType },
          qty,
          unitCost: barPrice,
          totalCost: barPrice * qty,
          note: 'intermediate-bar',
        });
      }
    }
    toRefine.push({ tier, enchant, resourceType, qty });
  }

  const totalInvest = [...toBuy, ...toTransmute].reduce((sum, s) => sum + s.totalCost, 0);
  const totalFocus = chain.totalFocus * qty;

  return { toBuy, toTransmute, toRefine, totalInvest, totalFocus };
}
