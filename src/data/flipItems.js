// All items eligible for city-to-city market flipping.
// Covers weapon/armor from the crafting TREE, capes (T4-T8), and bags (T4-T8).

import { TREE, buildItemId } from './craftItems.js';

const TIERS   = [4, 5, 6, 7, 8];
const ENCHANTS = [0, 1, 2, 3, 4];

// Map family key → flip display category
const FAMILY_CATEGORY = {
  sword: 'weapons', axe: 'weapons', mace: 'weapons', hammer: 'weapons',
  warGloves: 'weapons',
  bow: 'weapons', crossbow: 'weapons', dagger: 'weapons', spear: 'weapons',
  quarterstaff: 'weapons', natureStaff: 'weapons', scythe: 'weapons',
  fireStaff: 'weapons', holyStaff: 'weapons', arcaneStaff: 'weapons',
  frostStaff: 'weapons', cursedStaff: 'weapons', shapeshifterStaff: 'weapons',
  shield: 'weapons', torch: 'weapons', tome: 'weapons',
  plateHead: 'head', leatherHead: 'head', clothHead: 'head',
  plateChest: 'chest', leatherChest: 'chest', clothChest: 'chest',
  plateShoes: 'shoes', leatherShoes: 'shoes', clothShoes: 'shoes',
};

// Cape patterns that exist at T4-T8 with all enchants
const CAPE_T4_T8 = [
  ['CAPE',                       'Cape'],
  ['CAPEITEM_FW_BRIDGEWATCH',    'Bridgewatch Cape'],
  ['CAPEITEM_FW_FORTSTERLING',   'Fort Sterling Cape'],
  ['CAPEITEM_FW_LYMHURST',       'Lymhurst Cape'],
  ['CAPEITEM_FW_MARTLOCK',       'Martlock Cape'],
  ['CAPEITEM_FW_THETFORD',       'Thetford Cape'],
  ['CAPEITEM_FW_CAERLEON',       'Caerleon Cape'],
  ['CAPEITEM_FW_BRECILIEN',      'Brecilien Cape'],
  ['CAPEITEM_AVALON',            'Avalonian Cape'],
  ['CAPEITEM_SMUGGLER',          'Smuggler Cape'],
  ['CAPEITEM_HERETIC',           'Heretic Cape'],
  ['CAPEITEM_UNDEAD',            'Undead Cape'],
  ['CAPEITEM_KEEPER',            'Keeper Cape'],
  ['CAPEITEM_MORGANA',           'Morgana Cape'],
  ['CAPEITEM_DEMON',             'Demon Cape'],
  ['CAPEITEM_FW_BRIDGEWATCH_BP', 'Bridgewatch Crest'],
  ['CAPEITEM_FW_FORTSTERLING_BP','Fort Sterling Crest'],
  ['CAPEITEM_FW_LYMHURST_BP',    'Lymhurst Crest'],
  ['CAPEITEM_FW_MARTLOCK_BP',    'Martlock Crest'],
  ['CAPEITEM_FW_THETFORD_BP',    'Thetford Crest'],
  ['CAPEITEM_FW_CAERLEON_BP',    'Caerleon Crest'],
  ['CAPEITEM_FW_BRECILIEN_BP',   'Brecilien Crest'],
  ['CAPEITEM_AVALON_BP',         'Avalonian Crest'],
  ['CAPEITEM_SMUGGLER_BP',       'Smuggler Crest'],
  ['CAPEITEM_HERETIC_BP',        'Heretic Crest'],
  ['CAPEITEM_UNDEAD_BP',         'Undead Crest'],
  ['CAPEITEM_KEEPER_BP',         'Keeper Crest'],
  ['CAPEITEM_MORGANA_BP',        'Morgana Crest'],
  ['CAPEITEM_DEMON_BP',          'Demon Crest'],
];

// Special capes with restricted tiers
const CAPE_SPECIAL = [
  ...[4, 6, 8].map(t => ({ pattern: 'CAPE_ARENA_BANNER',    name: 'Arena Banner Cape', tier: t })),
  ...['PLATE', 'LEATHER', 'CLOTH'].flatMap(mat => [
    { pattern: `CAPE_${mat}_UNDEAD`,  name: `Undead ${mat[0] + mat.slice(1).toLowerCase()} Cape`,  tier: 6 },
    { pattern: `CAPE_${mat}_KEEPER`,  name: `Keeper ${mat[0] + mat.slice(1).toLowerCase()} Cape`,  tier: 6 },
    { pattern: `CAPE_${mat}_MORGANA`, name: `Morgana ${mat[0] + mat.slice(1).toLowerCase()} Cape`, tier: 6 },
  ]),
];

function buildItems() {
  const items = [];

  // Weapons + armor from TREE (skip toolmaker)
  for (const [stationKey, station] of Object.entries(TREE)) {
    if (stationKey === 'toolmaker') continue;
    for (const [, cat] of Object.entries(station.categories)) {
      for (const [famKey, fam] of Object.entries(cat.families)) {
        const category = FAMILY_CATEGORY[famKey] ?? 'weapons';
        for (const item of fam.items) {
          for (const tier of TIERS) {
            for (const enchant of ENCHANTS) {
              items.push({ itemId: buildItemId(item.id, tier, enchant), name: item.name, category, tier, enchant });
            }
          }
        }
      }
    }
  }

  // Capes T4-T8
  for (const [pattern, name] of CAPE_T4_T8) {
    for (const tier of TIERS) {
      for (const enchant of ENCHANTS) {
        const itemId = enchant === 0 ? `T${tier}_${pattern}` : `T${tier}_${pattern}@${enchant}`;
        items.push({ itemId, name, category: 'cape', tier, enchant });
      }
    }
  }

  // Special capes (specific tiers)
  for (const { pattern, name, tier } of CAPE_SPECIAL) {
    for (const enchant of ENCHANTS) {
      const itemId = enchant === 0 ? `T${tier}_${pattern}` : `T${tier}_${pattern}@${enchant}`;
      items.push({ itemId, name, category: 'cape', tier, enchant });
    }
  }

  // Bags
  for (const [key, name] of [['BAG', 'Bag'], ['BAG_INSIGHT', 'Satchel of Insight']]) {
    for (const tier of TIERS) {
      for (const enchant of ENCHANTS) {
        const itemId = enchant === 0 ? `T${tier}_${key}` : `T${tier}_${key}@${enchant}`;
        items.push({ itemId, name, category: 'bag', tier, enchant });
      }
    }
  }

  return items;
}

export const FLIP_ITEMS = buildItems();

// Fast lookup: itemId → descriptor
export const FLIP_ITEM_MAP = new Map(FLIP_ITEMS.map(i => [i.itemId, i]));
