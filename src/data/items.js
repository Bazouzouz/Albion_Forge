// Static definitions for Albion Online resources.
// Single source of truth for API item_ids, labels and icons.
// Covers: Ore, Wood, Fiber, Hide — tiers T4–T8, enchantments @0–@4.

export const TIERS = [4, 5, 6, 7, 8];
export const ENCHANTS = [0, 1, 2, 3, 4];

// ─── ID builders ─────────────────────────────────────────────────────────────

function rawId(key, tier, enchant) {
  if (enchant === 0) return `T${tier}_${key}`;
  return `T${tier}_${key}_LEVEL${enchant}@${enchant}`;
}

function refinedId(key, tier, enchant) {
  if (enchant === 0) return `T${tier}_${key}`;
  return `T${tier}_${key}_LEVEL${enchant}@${enchant}`;
}

// ─── Resource type definitions ────────────────────────────────────────────────

const RESOURCE_DEFS = {
  ORE: {
    label: 'Ore',
    rawKey: 'ORE',
    refinedKey: 'METALBAR',
    rawLabel: 'Ore',
    refinedLabel: 'Metal Bar',
  },
  WOOD: {
    label: 'Wood',
    rawKey: 'WOOD',
    refinedKey: 'PLANKS',
    rawLabel: 'Wood Log',
    refinedLabel: 'Plank',
  },
  FIBER: {
    label: 'Fiber',
    rawKey: 'FIBER',
    refinedKey: 'CLOTH',
    rawLabel: 'Fiber',
    refinedLabel: 'Cloth',
  },
  HIDE: {
    label: 'Hide',
    rawKey: 'HIDE',
    refinedKey: 'LEATHER',
    rawLabel: 'Hide',
    refinedLabel: 'Leather',
  },
};

// ─── RESOURCES object ─────────────────────────────────────────────────────────
//
// Generated structure:
// RESOURCES.ORE.tiers.T4.raw[0]     → "T4_ORE"
// RESOURCES.ORE.tiers.T4.raw[2]     → "T4_ORE_LEVEL2@2"
// RESOURCES.ORE.tiers.T4.refined[1] → "T4_METALBAR_LEVEL1@1"

export const RESOURCES = Object.fromEntries(
  Object.entries(RESOURCE_DEFS).map(([key, def]) => [
    key,
    {
      label: def.label,
      rawKey: def.rawKey,
      refinedKey: def.refinedKey,
      rawLabel: def.rawLabel,
      refinedLabel: def.refinedLabel,
      tiers: Object.fromEntries(
        TIERS.map(tier => [
          `T${tier}`,
          {
            raw: Object.fromEntries(
              ENCHANTS.map(enchant => [enchant, rawId(def.rawKey, tier, enchant)])
            ),
            refined: Object.fromEntries(
              ENCHANTS.map(enchant => [enchant, refinedId(def.refinedKey, tier, enchant)])
            ),
          },
        ])
      ),
    },
  ])
);

// ─── City Hearts (+15% refining bonus) ───────────────────────────────────────

export const CITY_HEARTS = {
  ORE:   { id: 'T1_FACTION_MOUNTAIN_TOKEN_1', label: 'Mountain Heart' },
  WOOD:  { id: 'T1_FACTION_FOREST_TOKEN_1',   label: 'Forest Heart'   },
  FIBER: { id: 'T1_FACTION_STEPPE_TOKEN_1',   label: 'Steppe Heart'   },
  HIDE:  { id: 'T1_FACTION_SWAMP_TOKEN_1',    label: 'Swamp Heart'    },
};

// ─── Icons ────────────────────────────────────────────────────────────────────

const RENDER_BASE = 'https://render.albiononline.com/v1/item';

/**
 * Returns the icon URL for an item.
 * @param {string} itemId  - Full item ID (e.g. "T4_ORE", "T5_METALBAR_LEVEL2@2")
 * @param {number} [enchant=0] - Enchantment to append if itemId has no @N suffix
 */
export function getIconUrl(itemId, enchant = 0) {
  const id = enchant > 0 && !itemId.includes('@') ? `${itemId}@${enchant}` : itemId;
  return `${RENDER_BASE}/${id}.png`;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Returns all raw item_ids for a resource type (e.g. "ORE"), all tiers and enchants. */
export function allRawIds(resourceKey) {
  const res = RESOURCES[resourceKey];
  return TIERS.flatMap(tier =>
    ENCHANTS.map(enchant => res.tiers[`T${tier}`].raw[enchant])
  );
}

/** Returns all refined item_ids for a resource type, all tiers and enchants. */
export function allRefinedIds(resourceKey) {
  const res = RESOURCES[resourceKey];
  return TIERS.flatMap(tier =>
    ENCHANTS.map(enchant => res.tiers[`T${tier}`].refined[enchant])
  );
}

/** Returns all item_ids (raw + refined) across all resource types — useful for a single batched API call. */
export function allItemIds() {
  return Object.keys(RESOURCES).flatMap(key => [
    ...allRawIds(key),
    ...allRefinedIds(key),
  ]);
}

/** T3 refined item IDs (one per resource type, no enchantments). Used as input for T4 refining. */
export const T3_REFINED_IDS = {
  ORE:   'T3_METALBAR',
  WOOD:  'T3_PLANKS',
  FIBER: 'T3_CLOTH',
  HIDE:  'T3_LEATHER',
};
