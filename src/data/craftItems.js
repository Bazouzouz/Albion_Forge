// Crafting data: tree structure (stations → categories → families → items),
// city bonus mapping, and item ID helpers.
//
// ID format for crafted weapons/armor:
//   enchant 0 → T{tier}_{baseId}
//   enchant 1-4 → T{tier}_{baseId}@{n}
// (NOT _LEVEL{n}@{n} — that format is only for raw/refined resources)
//
// Recipes verified against ao-data/ao-bin-dumps items.json (2026-05-16).
// NOTE: Shapeshifter staffs also require 2× T3_ALCHEMY_RARE_* per item (not tracked here).
// NOTE: Royal items use upgrade-from-set-item + tokens, incompatible with this cost model.

export const TIERS = [4, 5, 6, 7, 8];

// Maps refined bar key (as used in TREE) → RESOURCES key (for getUnitInvest / items.js)
export const BAR_TO_RESOURCE = {
  METALBAR: 'ORE',
  PLANKS:   'WOOD',
  CLOTH:    'FIBER',
  LEATHER:  'HIDE',
};

// Recommended craft city per weapon/armor type (+15% RRR biome bonus)
export const CITY_BONUS = {
  SWORD:        'Lymhurst',
  AXE:          'Martlock',
  MACE:         'Thetford',
  HAMMER:       'Fort Sterling',
  WAR_GLOVES:   'Martlock',
  CROSSBOW:     'Bridgewatch',
  SPEAR:        'Fort Sterling',
  BOW:          'Lymhurst',
  DAGGER:       'Bridgewatch',
  QUARTERSTAFF: 'Martlock',
  NATURESTAFF:  'Thetford',
  FIRESTAFF:    'Thetford',
  HOLYSTAFF:    'Fort Sterling',
  ARCANESTAFF:  'Lymhurst',
  FROSTSTAFF:   'Martlock',
  CURSEDSTAFF:  'Bridgewatch',
  SHIELD:       'Martlock',
  TORCH:        'Martlock',
  TOME:         'Martlock',
  SCYTHE:       null,
  SHAPESHIFTERSTAFF: null,
  PLATE_HEAD:   'Fort Sterling',
  PLATE_ARMOR:  'Bridgewatch',
  PLATE_SHOES:  'Martlock',
  LEATHER_HEAD: 'Lymhurst',
  LEATHER_ARMOR:'Thetford',
  LEATHER_SHOES:'Lymhurst',
  CLOTH_HEAD:   'Thetford',
  CLOTH_ARMOR:  'Fort Sterling',
  CLOTH_SHOES:  'Bridgewatch',
  TOOLS:        null,
};

// Artifact types and their default prices by tier (silver).
// rune=Undead, soul=Keeper, relic=Hell, avalonian=Avalon, morgana=Morgana, crystal=Crystal
// fey=Veilweaver/Mistwalker/Feyscale, royal=Royal Sigil
export const ARTIFACT_DEFAULTS = {
  rune:      { 4: 18000,   5: 45000,   6: 95000,   7: 180000,  8: 420000   },
  soul:      { 4: 22000,   5: 55000,   6: 110000,  7: 220000,  8: 500000   },
  relic:     { 4: 30000,   5: 75000,   6: 150000,  7: 320000,  8: 720000   },
  avalonian: { 4: 90000,   5: 220000,  6: 480000,  7: 950000,  8: 2100000  },
  morgana:   { 4: 60000,   5: 140000,  6: 290000,  7: 580000,  8: 1300000  },
  crystal:   { 4: 60000,   5: 140000,  6: 290000,  7: 580000,  8: 1300000  },
  fey:       { 4: 40000,   5: 100000,  6: 210000,  7: 430000,  8: 950000   },
  royal:     { 4: 25000,   5: 65000,   6: 130000,  7: 270000,  8: 600000   },
};

// Item tree: station → category → family → items[]
// Each item: { id, name, rss, qty, rss2?, qty2?, artifact? }
// rss/rss2: bar key (METALBAR / PLANKS / CLOTH / LEATHER)
// artifact: 'rune'|'soul'|'relic'|'avalonian'|'morgana'|'crystal'
// All items have enchant variants @0-@4 (no hasPristine exceptions needed).
export const TREE = {
  warrior: {
    label: "Warrior's Forge", emoji: '🛡️',
    categories: {
      weapons: { label: 'Weapons', families: {
        sword: { name: 'Sword Line', bonusType: 'SWORD', items: [
          { id: 'MAIN_SWORD',              name: 'Broadsword',     rss: 'METALBAR', qty: 16, rss2: 'LEATHER', qty2: 8 },
          { id: '2H_CLAYMORE',             name: 'Claymore',       rss: 'METALBAR', qty: 20, rss2: 'LEATHER', qty2: 12 },
          { id: '2H_DUALSWORD',            name: 'Dual Swords',    rss: 'METALBAR', qty: 20, rss2: 'LEATHER', qty2: 12 },
          { id: '2H_CLEAVER_HELL',         name: 'Carving Sword',  rss: 'METALBAR', qty: 20, rss2: 'LEATHER', qty2: 12, artifact: 'relic' },
          { id: '2H_DUALSCIMITAR_UNDEAD',  name: 'Galatine Pair',  rss: 'METALBAR', qty: 20, rss2: 'LEATHER', qty2: 12, artifact: 'rune' },
          { id: 'MAIN_RAPIER_MORGANA',     name: 'Bloodletter',    rss: 'METALBAR', qty: 16, rss2: 'LEATHER', qty2: 8,  artifact: 'morgana' },
          { id: 'MAIN_SCIMITAR_MORGANA',   name: 'Clarent Blade',  rss: 'METALBAR', qty: 16, rss2: 'LEATHER', qty2: 8,  artifact: 'morgana' },
          { id: '2H_CLAYMORE_AVALON',      name: 'Kingmaker',      rss: 'METALBAR', qty: 20, rss2: 'LEATHER', qty2: 12, artifact: 'avalonian' },
          { id: 'MAIN_SWORD_CRYSTAL',      name: 'Infinity Blade', rss: 'METALBAR', qty: 16, rss2: 'LEATHER', qty2: 8,  artifact: 'crystal' },
        ]},
        axe: { name: 'Axe Line', bonusType: 'AXE', items: [
          { id: 'MAIN_AXE',            name: 'Battleaxe',     rss: 'PLANKS', qty: 8,  rss2: 'METALBAR', qty2: 16 },
          { id: '2H_AXE',              name: 'Greataxe',      rss: 'PLANKS', qty: 12, rss2: 'METALBAR', qty2: 20 },
          { id: '2H_HALBERD',          name: 'Halberd',       rss: 'PLANKS', qty: 20, rss2: 'METALBAR', qty2: 12 },
          { id: '2H_HALBERD_MORGANA',  name: 'Carrioncaller', rss: 'PLANKS', qty: 20, rss2: 'METALBAR', qty2: 12, artifact: 'morgana' },
          { id: '2H_DUALAXE_KEEPER',   name: 'Bear Paws',     rss: 'PLANKS', qty: 12, rss2: 'METALBAR', qty2: 20, artifact: 'soul' },
          { id: '2H_AXE_AVALON',       name: 'Realmbreaker',  rss: 'PLANKS', qty: 12, rss2: 'METALBAR', qty2: 20, artifact: 'avalonian' },
        ]},
        mace: { name: 'Mace Line', bonusType: 'MACE', items: [
          { id: 'MAIN_MACE',           name: 'Mace',               rss: 'METALBAR', qty: 16, rss2: 'CLOTH', qty2: 8 },
          { id: '2H_MACE',             name: 'Heavy Mace',         rss: 'METALBAR', qty: 20, rss2: 'CLOTH', qty2: 12 },
          { id: '2H_FLAIL',            name: 'Morning Star',       rss: 'METALBAR', qty: 20, rss2: 'CLOTH', qty2: 12 },
          { id: 'MAIN_MACE_HELL',      name: 'Incubus Mace',       rss: 'METALBAR', qty: 16, rss2: 'CLOTH', qty2: 8,  artifact: 'relic' },
          { id: 'MAIN_ROCKMACE_KEEPER',name: 'Bedrock Mace',       rss: 'METALBAR', qty: 16, rss2: 'CLOTH', qty2: 8,  artifact: 'soul' },
          { id: '2H_MACE_MORGANA',     name: 'Camlann Mace',       rss: 'METALBAR', qty: 20, rss2: 'CLOTH', qty2: 12, artifact: 'morgana' },
          { id: '2H_DUALMACE_AVALON',  name: 'Oathkeepers',        rss: 'METALBAR', qty: 20, rss2: 'CLOTH', qty2: 12, artifact: 'avalonian' },
          { id: 'MAIN_MACE_CRYSTAL',   name: 'Dreadstorm Monarch', rss: 'METALBAR', qty: 16, rss2: 'CLOTH', qty2: 8,  artifact: 'crystal' },
        ]},
        hammer: { name: 'Hammer Line', bonusType: 'HAMMER', items: [
          { id: 'MAIN_HAMMER',         name: 'Hammer',          rss: 'METALBAR', qty: 24 },
          { id: '2H_HAMMER',           name: 'Great Hammer',    rss: 'METALBAR', qty: 20, rss2: 'CLOTH', qty2: 12 },
          { id: '2H_POLEHAMMER',       name: 'Polehammer',      rss: 'METALBAR', qty: 20, rss2: 'CLOTH', qty2: 12 },
          { id: '2H_HAMMER_UNDEAD',    name: 'Tombhammer',      rss: 'METALBAR', qty: 20, rss2: 'CLOTH', qty2: 12, artifact: 'rune' },
          { id: '2H_DUALHAMMER_HELL',  name: 'Forge Hammers',   rss: 'METALBAR', qty: 20, rss2: 'CLOTH', qty2: 12, artifact: 'relic' },
          { id: '2H_HAMMER_AVALON',    name: 'Hand of Justice', rss: 'METALBAR', qty: 20, rss2: 'CLOTH', qty2: 12, artifact: 'avalonian' },
          { id: '2H_HAMMER_CRYSTAL',   name: 'Truebolt Hammer', rss: 'METALBAR', qty: 20, rss2: 'CLOTH', qty2: 12, artifact: 'crystal' },
        ]},
        warGloves: { name: 'War Gloves', bonusType: 'WAR_GLOVES', items: [
          { id: '2H_KNUCKLES_SET1',     name: 'Brawler Gloves',     rss: 'METALBAR', qty: 12, rss2: 'LEATHER', qty2: 20 },
          { id: '2H_KNUCKLES_SET2',     name: 'Battle Bracers',     rss: 'METALBAR', qty: 12, rss2: 'LEATHER', qty2: 20 },
          { id: '2H_KNUCKLES_SET3',     name: 'Spiked Gauntlets',   rss: 'METALBAR', qty: 12, rss2: 'LEATHER', qty2: 20 },
          { id: '2H_KNUCKLES_KEEPER',   name: 'Ursine Maulers',     rss: 'METALBAR', qty: 12, rss2: 'LEATHER', qty2: 20, artifact: 'soul' },
          { id: '2H_KNUCKLES_HELL',     name: 'Hellfire Hands',     rss: 'METALBAR', qty: 12, rss2: 'LEATHER', qty2: 20, artifact: 'relic' },
          { id: '2H_KNUCKLES_MORGANA',  name: 'Ravenstrike Cestus', rss: 'METALBAR', qty: 12, rss2: 'LEATHER', qty2: 20, artifact: 'morgana' },
          { id: '2H_KNUCKLES_AVALON',   name: 'Fists of Avalon',    rss: 'METALBAR', qty: 12, rss2: 'LEATHER', qty2: 20, artifact: 'avalonian' },
          { id: '2H_KNUCKLES_CRYSTAL',  name: 'Forcepulse Bracers', rss: 'METALBAR', qty: 12, rss2: 'LEATHER', qty2: 20, artifact: 'crystal' },
          { id: '2H_IRONGAUNTLETS_HELL',name: 'Black Hands',        rss: 'METALBAR', qty: 12, rss2: 'LEATHER', qty2: 20, artifact: 'relic' },
        ]},
      }},
      armor: { label: 'Plate Armor', families: {
        plateHead:  { name: 'Helmets', bonusType: 'PLATE_HEAD',  items: [
          { id: 'HEAD_PLATE_SET1',   name: 'Soldier Helmet',    rss: 'METALBAR', qty: 8 },
          { id: 'HEAD_PLATE_SET2',   name: 'Knight Helmet',     rss: 'METALBAR', qty: 8 },
          { id: 'HEAD_PLATE_SET3',   name: 'Guardian Helmet',   rss: 'METALBAR', qty: 8 },
          { id: 'HEAD_PLATE_HELL',   name: 'Demon Helmet',      rss: 'METALBAR', qty: 8, artifact: 'relic' },
          { id: 'HEAD_PLATE_UNDEAD', name: 'Graveguard Helmet', rss: 'METALBAR', qty: 8, artifact: 'rune' },
          { id: 'HEAD_PLATE_KEEPER', name: 'Judicator Helmet',  rss: 'METALBAR', qty: 8, artifact: 'soul' },
          { id: 'HEAD_PLATE_FEY',    name: 'Duskweaver Helmet', rss: 'METALBAR', qty: 8, artifact: 'fey' },
          { id: 'HEAD_PLATE_ROYAL',  name: 'Royal Helmet',      rss: 'METALBAR', qty: 8, artifact: 'royal' },
          { id: 'HEAD_PLATE_AVALON', name: 'Helmet of Valor',   rss: 'METALBAR', qty: 8, artifact: 'avalonian' },
        ]},
        plateChest: { name: 'Chest',   bonusType: 'PLATE_ARMOR', items: [
          { id: 'ARMOR_PLATE_SET1',   name: 'Soldier Armor',    rss: 'METALBAR', qty: 16 },
          { id: 'ARMOR_PLATE_SET2',   name: 'Knight Armor',     rss: 'METALBAR', qty: 16 },
          { id: 'ARMOR_PLATE_SET3',   name: 'Guardian Armor',   rss: 'METALBAR', qty: 16 },
          { id: 'ARMOR_PLATE_HELL',   name: 'Demon Armor',      rss: 'METALBAR', qty: 16, artifact: 'relic' },
          { id: 'ARMOR_PLATE_UNDEAD', name: 'Graveguard Armor', rss: 'METALBAR', qty: 16, artifact: 'rune' },
          { id: 'ARMOR_PLATE_KEEPER', name: 'Judicator Armor',  rss: 'METALBAR', qty: 16, artifact: 'soul' },
          { id: 'ARMOR_PLATE_FEY',    name: 'Duskweaver Armor', rss: 'METALBAR', qty: 16, artifact: 'fey' },
          { id: 'ARMOR_PLATE_ROYAL',  name: 'Royal Armor',      rss: 'METALBAR', qty: 16, artifact: 'royal' },
          { id: 'ARMOR_PLATE_AVALON', name: 'Armor of Valor',   rss: 'METALBAR', qty: 16, artifact: 'avalonian' },
        ]},
        plateShoes: { name: 'Boots',   bonusType: 'PLATE_SHOES', items: [
          { id: 'SHOES_PLATE_SET1',   name: 'Soldier Boots',    rss: 'METALBAR', qty: 8 },
          { id: 'SHOES_PLATE_SET2',   name: 'Knight Boots',     rss: 'METALBAR', qty: 8 },
          { id: 'SHOES_PLATE_SET3',   name: 'Guardian Boots',   rss: 'METALBAR', qty: 8 },
          { id: 'SHOES_PLATE_HELL',   name: 'Demon Boots',      rss: 'METALBAR', qty: 8, artifact: 'relic' },
          { id: 'SHOES_PLATE_UNDEAD', name: 'Graveguard Boots', rss: 'METALBAR', qty: 8, artifact: 'rune' },
          { id: 'SHOES_PLATE_KEEPER', name: 'Judicator Boots',  rss: 'METALBAR', qty: 8, artifact: 'soul' },
          { id: 'SHOES_PLATE_FEY',    name: 'Duskweaver Boots', rss: 'METALBAR', qty: 8, artifact: 'fey' },
          { id: 'SHOES_PLATE_ROYAL',  name: 'Royal Boots',      rss: 'METALBAR', qty: 8, artifact: 'royal' },
          { id: 'SHOES_PLATE_AVALON', name: 'Boots of Valor',   rss: 'METALBAR', qty: 8, artifact: 'avalonian' },
        ]},
      }},
      offhands: { label: 'Off-Hands', families: {
        shield: { name: 'Shields', bonusType: 'SHIELD', items: [
          { id: 'OFF_SHIELD',               name: 'Shield',           rss: 'PLANKS', qty: 4, rss2: 'METALBAR', qty2: 4 },
          { id: 'OFF_TOWERSHIELD_UNDEAD',   name: 'Sarcophagus',      rss: 'PLANKS', qty: 4, rss2: 'METALBAR', qty2: 4, artifact: 'rune' },
          { id: 'OFF_SHIELD_HELL',          name: 'Caitiff Shield',   rss: 'PLANKS', qty: 4, rss2: 'METALBAR', qty2: 4, artifact: 'relic' },
          { id: 'OFF_SPIKEDSHIELD_MORGANA', name: 'Facebreaker',      rss: 'PLANKS', qty: 4, rss2: 'METALBAR', qty2: 4, artifact: 'morgana' },
          { id: 'OFF_SHIELD_AVALON',        name: 'Astral Aegis',     rss: 'PLANKS', qty: 4, rss2: 'METALBAR', qty2: 4, artifact: 'avalonian' },
          { id: 'OFF_SHIELD_CRYSTAL',       name: 'Unbreakable Ward', rss: 'PLANKS', qty: 4, rss2: 'METALBAR', qty2: 4, artifact: 'crystal' },
        ]},
      }},
    },
  },

  hunter: {
    label: "Hunter's Lodge", emoji: '🏹',
    categories: {
      weapons: { label: 'Weapons', families: {
        bow: { name: 'Bow Line', bonusType: 'BOW', items: [
          { id: '2H_BOW',              name: 'Bow',            rss: 'PLANKS', qty: 32 },
          { id: '2H_LONGBOW',          name: 'Longbow',        rss: 'PLANKS', qty: 32 },
          { id: '2H_WARBOW',           name: 'Warbow',         rss: 'PLANKS', qty: 32 },
          { id: '2H_LONGBOW_UNDEAD',   name: 'Whispering Bow', rss: 'PLANKS', qty: 32, artifact: 'rune' },
          { id: '2H_BOW_HELL',         name: 'Wailing Bow',    rss: 'PLANKS', qty: 32, artifact: 'relic' },
          { id: '2H_BOW_KEEPER',       name: 'Bow of Badon',   rss: 'PLANKS', qty: 32, artifact: 'soul' },
          { id: '2H_BOW_AVALON',       name: 'Mistpiercer',    rss: 'PLANKS', qty: 32, artifact: 'avalonian' },
          { id: '2H_BOW_CRYSTAL',      name: 'Skystrider Bow', rss: 'PLANKS', qty: 32, artifact: 'crystal' },
        ]},
        crossbow: { name: 'Crossbow Line', bonusType: 'CROSSBOW', items: [
          { id: '2H_CROSSBOW',                  name: 'Crossbow',          rss: 'PLANKS', qty: 20, rss2: 'METALBAR', qty2: 12 },
          { id: '2H_CROSSBOWLARGE',             name: 'Heavy Crossbow',    rss: 'PLANKS', qty: 20, rss2: 'METALBAR', qty2: 12 },
          { id: 'MAIN_1HCROSSBOW',              name: 'Light Crossbow',    rss: 'PLANKS', qty: 16, rss2: 'METALBAR', qty2: 8 },
          { id: '2H_REPEATINGCROSSBOW_UNDEAD',  name: 'Weeping Repeater',  rss: 'PLANKS', qty: 20, rss2: 'METALBAR', qty2: 12, artifact: 'rune' },
          { id: '2H_DUALCROSSBOW_HELL',         name: 'Boltcasters',       rss: 'PLANKS', qty: 20, rss2: 'METALBAR', qty2: 12, artifact: 'relic' },
          { id: '2H_CROSSBOWLARGE_MORGANA',     name: 'Siegebow',          rss: 'PLANKS', qty: 20, rss2: 'METALBAR', qty2: 12, artifact: 'morgana' },
          { id: '2H_CROSSBOW_CANNON_AVALON',    name: 'Energy Shaper',     rss: 'PLANKS', qty: 20, rss2: 'METALBAR', qty2: 12, artifact: 'avalonian' },
          { id: '2H_DUALCROSSBOW_CRYSTAL',      name: 'Arclight Blasters', rss: 'PLANKS', qty: 20, rss2: 'METALBAR', qty2: 12, artifact: 'crystal' },
        ]},
        dagger: { name: 'Dagger Line', bonusType: 'DAGGER', items: [
          { id: 'MAIN_DAGGER',            name: 'Dagger',        rss: 'METALBAR', qty: 12, rss2: 'LEATHER', qty2: 12 },
          { id: '2H_DAGGERPAIR',          name: 'Dagger Pair',   rss: 'METALBAR', qty: 16, rss2: 'LEATHER', qty2: 16 },
          { id: '2H_CLAWPAIR',            name: 'Claws',         rss: 'METALBAR', qty: 12, rss2: 'LEATHER', qty2: 20 },
          { id: 'MAIN_DAGGER_HELL',       name: 'Demonfang',     rss: 'METALBAR', qty: 12, rss2: 'LEATHER', qty2: 12, artifact: 'relic' },
          { id: '2H_DUALSICKLE_UNDEAD',   name: 'Deathgivers',   rss: 'METALBAR', qty: 16, rss2: 'LEATHER', qty2: 16, artifact: 'rune' },
          { id: '2H_DAGGER_KATAR_AVALON', name: 'Bridled Fury',  rss: 'METALBAR', qty: 12, rss2: 'LEATHER', qty2: 20, artifact: 'avalonian' },
          { id: '2H_DAGGERPAIR_CRYSTAL',  name: 'Twin Slayers',  rss: 'METALBAR', qty: 16, rss2: 'LEATHER', qty2: 16, artifact: 'crystal' },
        ]},
        spear: { name: 'Spear Line', bonusType: 'SPEAR', items: [
          { id: 'MAIN_SPEAR',               name: 'Spear',         rss: 'PLANKS', qty: 16, rss2: 'METALBAR', qty2: 8 },
          { id: '2H_SPEAR',                 name: 'Pike',          rss: 'PLANKS', qty: 20, rss2: 'METALBAR', qty2: 12 },
          { id: '2H_GLAIVE',                name: 'Glaive',        rss: 'PLANKS', qty: 12, rss2: 'METALBAR', qty2: 20 },
          { id: 'MAIN_SPEAR_KEEPER',        name: 'Heron Spear',   rss: 'PLANKS', qty: 16, rss2: 'METALBAR', qty2: 8,  artifact: 'soul' },
          { id: '2H_HARPOON_HELL',          name: 'Spirithunter',  rss: 'PLANKS', qty: 20, rss2: 'METALBAR', qty2: 12, artifact: 'relic' },
          { id: '2H_TRIDENT_UNDEAD',        name: 'Trinity Spear', rss: 'PLANKS', qty: 20, rss2: 'METALBAR', qty2: 12, artifact: 'rune' },
          { id: '2H_GLAIVE_CRYSTAL',        name: 'Rift Glaive',   rss: 'PLANKS', qty: 12, rss2: 'METALBAR', qty2: 20, artifact: 'crystal' },
          { id: 'MAIN_SPEAR_LANCE_AVALON',  name: 'Daybreaker',    rss: 'PLANKS', qty: 16, rss2: 'METALBAR', qty2: 8,  artifact: 'avalonian' },
        ]},
        quarterstaff: { name: 'Quarterstaff Line', bonusType: 'QUARTERSTAFF', items: [
          { id: '2H_QUARTERSTAFF',              name: 'Quarterstaff',        rss: 'METALBAR', qty: 12, rss2: 'LEATHER', qty2: 20 },
          { id: '2H_IRONCLADEDSTAFF',           name: 'Iron-clad Staff',     rss: 'METALBAR', qty: 12, rss2: 'LEATHER', qty2: 20 },
          { id: '2H_DOUBLEBLADEDSTAFF',         name: 'Double Bladed Staff', rss: 'METALBAR', qty: 12, rss2: 'LEATHER', qty2: 20 },
          { id: '2H_COMBATSTAFF_MORGANA',       name: 'Black Monk Stave',    rss: 'METALBAR', qty: 12, rss2: 'LEATHER', qty2: 20, artifact: 'morgana' },
          { id: '2H_QUARTERSTAFF_AVALON',       name: 'Grailseeker',         rss: 'METALBAR', qty: 12, rss2: 'LEATHER', qty2: 20, artifact: 'avalonian' },
          { id: '2H_DOUBLEBLADEDSTAFF_CRYSTAL', name: 'Phantom Twinblade',   rss: 'METALBAR', qty: 12, rss2: 'LEATHER', qty2: 20, artifact: 'crystal' },
        ]},
        natureStaff: { name: 'Nature Staff Line', bonusType: 'NATURESTAFF', items: [
          { id: 'MAIN_NATURESTAFF',         name: 'Nature Staff',       rss: 'PLANKS', qty: 16, rss2: 'CLOTH', qty2: 8 },
          { id: '2H_NATURESTAFF',           name: 'Great Nature Staff', rss: 'PLANKS', qty: 20, rss2: 'CLOTH', qty2: 12 },
          { id: '2H_WILDSTAFF',             name: 'Wild Staff',         rss: 'PLANKS', qty: 20, rss2: 'CLOTH', qty2: 12 },
          { id: 'MAIN_NATURESTAFF_KEEPER',  name: 'Druidic Staff',      rss: 'PLANKS', qty: 16, rss2: 'CLOTH', qty2: 8,  artifact: 'soul' },
          { id: '2H_NATURESTAFF_HELL',      name: 'Blight Staff',       rss: 'PLANKS', qty: 20, rss2: 'CLOTH', qty2: 12, artifact: 'relic' },
          { id: '2H_NATURESTAFF_KEEPER',    name: 'Rampant Staff',      rss: 'PLANKS', qty: 20, rss2: 'CLOTH', qty2: 12, artifact: 'soul' },
          { id: '2H_RAM_KEEPER',            name: 'Grovekeeper',        rss: 'METALBAR', qty: 20, rss2: 'CLOTH', qty2: 12, artifact: 'soul' },
          { id: 'MAIN_NATURESTAFF_AVALON',  name: 'Ironroot Staff',     rss: 'PLANKS', qty: 16, rss2: 'CLOTH', qty2: 8,  artifact: 'avalonian' },
          { id: 'MAIN_NATURESTAFF_CRYSTAL', name: 'Forgebark Staff',    rss: 'PLANKS', qty: 16, rss2: 'CLOTH', qty2: 8,  artifact: 'crystal' },
        ]},
        scythe: { name: 'Scythe Line', bonusType: 'SCYTHE', items: [
          { id: '2H_SCYTHE_HELL',     name: 'Infernal Scythe', rss: 'PLANKS',   qty: 12, rss2: 'METALBAR', qty2: 20, artifact: 'relic' },
          { id: '2H_SCYTHE_CRYSTAL',  name: 'Crystal Reaper',  rss: 'PLANKS',   qty: 12, rss2: 'METALBAR', qty2: 20, artifact: 'crystal' },
          { id: '2H_TWINSCYTHE_HELL', name: 'Soulscythe',      rss: 'METALBAR', qty: 12, rss2: 'LEATHER',  qty2: 20, artifact: 'relic' },
        ]},
      }},
      armor: { label: 'Leather Armor', families: {
        leatherHead:  { name: 'Hoods',   bonusType: 'LEATHER_HEAD',  items: [
          { id: 'HEAD_LEATHER_SET1',    name: 'Mercenary Hood',   rss: 'LEATHER', qty: 8 },
          { id: 'HEAD_LEATHER_SET2',    name: 'Hunter Hood',      rss: 'LEATHER', qty: 8 },
          { id: 'HEAD_LEATHER_SET3',    name: 'Assassin Hood',    rss: 'LEATHER', qty: 8 },
          { id: 'HEAD_LEATHER_HELL',    name: 'Hellion Hood',     rss: 'LEATHER', qty: 8, artifact: 'relic' },
          { id: 'HEAD_LEATHER_UNDEAD',  name: 'Specter Hood',     rss: 'LEATHER', qty: 8, artifact: 'rune' },
          { id: 'HEAD_LEATHER_MORGANA', name: 'Stalker Hood',     rss: 'LEATHER', qty: 8, artifact: 'morgana' },
          { id: 'HEAD_LEATHER_FEY',     name: 'Mistwalker Hood',  rss: 'LEATHER', qty: 8, artifact: 'fey' },
          { id: 'HEAD_LEATHER_ROYAL',   name: 'Royal Hood',       rss: 'LEATHER', qty: 8, artifact: 'royal' },
          { id: 'HEAD_LEATHER_AVALON',  name: 'Hood of Tenacity', rss: 'LEATHER', qty: 8, artifact: 'avalonian' },
        ]},
        leatherChest: { name: 'Jackets', bonusType: 'LEATHER_ARMOR', items: [
          { id: 'ARMOR_LEATHER_SET1',    name: 'Mercenary Jacket',   rss: 'LEATHER', qty: 16 },
          { id: 'ARMOR_LEATHER_SET2',    name: 'Hunter Jacket',      rss: 'LEATHER', qty: 16 },
          { id: 'ARMOR_LEATHER_SET3',    name: 'Assassin Jacket',    rss: 'LEATHER', qty: 16 },
          { id: 'ARMOR_LEATHER_HELL',    name: 'Hellion Jacket',     rss: 'LEATHER', qty: 16, artifact: 'relic' },
          { id: 'ARMOR_LEATHER_UNDEAD',  name: 'Specter Jacket',     rss: 'LEATHER', qty: 16, artifact: 'rune' },
          { id: 'ARMOR_LEATHER_MORGANA', name: 'Stalker Jacket',     rss: 'LEATHER', qty: 16, artifact: 'morgana' },
          { id: 'ARMOR_LEATHER_FEY',     name: 'Mistwalker Jacket',  rss: 'LEATHER', qty: 16, artifact: 'fey' },
          { id: 'ARMOR_LEATHER_ROYAL',   name: 'Royal Jacket',       rss: 'LEATHER', qty: 16, artifact: 'royal' },
          { id: 'ARMOR_LEATHER_AVALON',  name: 'Jacket of Tenacity', rss: 'LEATHER', qty: 16, artifact: 'avalonian' },
        ]},
        leatherShoes: { name: 'Shoes',   bonusType: 'LEATHER_SHOES', items: [
          { id: 'SHOES_LEATHER_SET1',    name: 'Mercenary Shoes',   rss: 'LEATHER', qty: 8 },
          { id: 'SHOES_LEATHER_SET2',    name: 'Hunter Shoes',      rss: 'LEATHER', qty: 8 },
          { id: 'SHOES_LEATHER_SET3',    name: 'Assassin Shoes',    rss: 'LEATHER', qty: 8 },
          { id: 'SHOES_LEATHER_HELL',    name: 'Hellion Shoes',     rss: 'LEATHER', qty: 8, artifact: 'relic' },
          { id: 'SHOES_LEATHER_UNDEAD',  name: 'Specter Shoes',     rss: 'LEATHER', qty: 8, artifact: 'rune' },
          { id: 'SHOES_LEATHER_MORGANA', name: 'Stalker Shoes',     rss: 'LEATHER', qty: 8, artifact: 'morgana' },
          { id: 'SHOES_LEATHER_FEY',     name: 'Mistwalker Shoes',  rss: 'LEATHER', qty: 8, artifact: 'fey' },
          { id: 'SHOES_LEATHER_ROYAL',   name: 'Royal Shoes',       rss: 'LEATHER', qty: 8, artifact: 'royal' },
          { id: 'SHOES_LEATHER_AVALON',  name: 'Shoes of Tenacity', rss: 'LEATHER', qty: 8, artifact: 'avalonian' },
        ]},
      }},
      offhands: { label: 'Off-Hands', families: {
        torch: { name: 'Torches & Off-Hands', bonusType: 'TORCH', items: [
          { id: 'OFF_TORCH',           name: 'Torch',           rss: 'PLANKS', qty: 4, rss2: 'CLOTH', qty2: 4 },
          { id: 'OFF_HORN_KEEPER',     name: 'Mistcaller',      rss: 'PLANKS', qty: 4, rss2: 'CLOTH', qty2: 4, artifact: 'soul' },
          { id: 'OFF_LAMP_UNDEAD',     name: 'Cryptcandle',     rss: 'PLANKS', qty: 4, rss2: 'CLOTH', qty2: 4, artifact: 'rune' },
          { id: 'OFF_JESTERCANE_HELL', name: 'Leering Cane',    rss: 'PLANKS', qty: 4, rss2: 'CLOTH', qty2: 4, artifact: 'relic' },
          { id: 'OFF_TALISMAN_AVALON', name: 'Sacred Scepter',  rss: 'PLANKS', qty: 4, rss2: 'CLOTH', qty2: 4, artifact: 'avalonian' },
          { id: 'OFF_TORCH_CRYSTAL',   name: 'Blueflame Torch', rss: 'PLANKS', qty: 4, rss2: 'CLOTH', qty2: 4, artifact: 'crystal' },
        ]},
      }},
    },
  },

  mage: {
    label: "Mage's Tower", emoji: '🔮',
    categories: {
      weapons: { label: 'Weapons', families: {
        fireStaff: { name: 'Fire Staff Line', bonusType: 'FIRESTAFF', items: [
          { id: 'MAIN_FIRESTAFF',          name: 'Fire Staff',        rss: 'PLANKS', qty: 16, rss2: 'METALBAR', qty2: 8 },
          { id: '2H_FIRESTAFF',            name: 'Great Fire Staff',  rss: 'PLANKS', qty: 20, rss2: 'METALBAR', qty2: 12 },
          { id: '2H_INFERNOSTAFF',         name: 'Infernal Staff',    rss: 'PLANKS', qty: 20, rss2: 'METALBAR', qty2: 12 },
          { id: 'MAIN_FIRESTAFF_KEEPER',   name: 'Wildfire Staff',    rss: 'PLANKS', qty: 16, rss2: 'METALBAR', qty2: 8,  artifact: 'soul' },
          { id: 'MAIN_FIRESTAFF_CRYSTAL',  name: 'Flamewalker Staff', rss: 'PLANKS', qty: 16, rss2: 'METALBAR', qty2: 8,  artifact: 'crystal' },
          { id: '2H_FIRESTAFF_HELL',       name: 'Brimstone Staff',   rss: 'PLANKS', qty: 20, rss2: 'METALBAR', qty2: 12, artifact: 'relic' },
          { id: '2H_INFERNOSTAFF_MORGANA', name: 'Blazing Staff',     rss: 'PLANKS', qty: 20, rss2: 'METALBAR', qty2: 12, artifact: 'morgana' },
          { id: '2H_FIRE_RINGPAIR_AVALON', name: 'Dawnsong',          rss: 'PLANKS', qty: 20, rss2: 'METALBAR', qty2: 12, artifact: 'avalonian' },
        ]},
        holyStaff: { name: 'Holy Staff Line', bonusType: 'HOLYSTAFF', items: [
          { id: 'MAIN_HOLYSTAFF',         name: 'Holy Staff',        rss: 'PLANKS', qty: 16, rss2: 'CLOTH', qty2: 8 },
          { id: '2H_HOLYSTAFF',           name: 'Great Holy Staff',  rss: 'PLANKS', qty: 20, rss2: 'CLOTH', qty2: 12 },
          { id: '2H_DIVINESTAFF',         name: 'Divine Staff',      rss: 'PLANKS', qty: 20, rss2: 'CLOTH', qty2: 12 },
          { id: 'MAIN_HOLYSTAFF_MORGANA', name: 'Lifetouch Staff',   rss: 'PLANKS', qty: 16, rss2: 'CLOTH', qty2: 8,  artifact: 'morgana' },
          { id: '2H_HOLYSTAFF_HELL',      name: 'Fallen Staff',      rss: 'PLANKS', qty: 20, rss2: 'CLOTH', qty2: 12, artifact: 'relic' },
          { id: '2H_HOLYSTAFF_UNDEAD',    name: 'Redemption Staff',  rss: 'PLANKS', qty: 20, rss2: 'CLOTH', qty2: 12, artifact: 'rune' },
          { id: 'MAIN_HOLYSTAFF_AVALON',  name: 'Hallowfall',        rss: 'PLANKS', qty: 16, rss2: 'CLOTH', qty2: 8,  artifact: 'avalonian' },
          { id: '2H_HOLYSTAFF_CRYSTAL',   name: 'Exalted Staff',     rss: 'PLANKS', qty: 20, rss2: 'CLOTH', qty2: 12, artifact: 'crystal' },
        ]},
        arcaneStaff: { name: 'Arcane Staff Line', bonusType: 'ARCANESTAFF', items: [
          { id: 'MAIN_ARCANESTAFF',          name: 'Arcane Staff',       rss: 'PLANKS', qty: 16, rss2: 'METALBAR', qty2: 8 },
          { id: '2H_ARCANESTAFF',            name: 'Great Arcane Staff', rss: 'PLANKS', qty: 20, rss2: 'METALBAR', qty2: 12 },
          { id: '2H_ENIGMATICSTAFF',         name: 'Enigmatic Staff',    rss: 'PLANKS', qty: 20, rss2: 'METALBAR', qty2: 12 },
          { id: 'MAIN_ARCANESTAFF_UNDEAD',   name: 'Witchwork Staff',    rss: 'PLANKS', qty: 16, rss2: 'METALBAR', qty2: 8,  artifact: 'rune' },
          { id: '2H_ARCANESTAFF_HELL',       name: 'Occult Staff',       rss: 'PLANKS', qty: 20, rss2: 'METALBAR', qty2: 12, artifact: 'relic' },
          { id: '2H_ENIGMATICORB_MORGANA',   name: 'Malevolent Locus',   rss: 'PLANKS', qty: 20, rss2: 'METALBAR', qty2: 12, artifact: 'morgana' },
          { id: '2H_ARCANE_RINGPAIR_AVALON', name: 'Evensong',           rss: 'PLANKS', qty: 20, rss2: 'METALBAR', qty2: 12, artifact: 'avalonian' },
          { id: '2H_ARCANESTAFF_CRYSTAL',    name: 'Astral Staff',       rss: 'PLANKS', qty: 20, rss2: 'METALBAR', qty2: 12, artifact: 'crystal' },
          { id: '2H_ROCKSTAFF_KEEPER',       name: 'Staff of Balance',   rss: 'METALBAR', qty: 12, rss2: 'LEATHER', qty2: 20, artifact: 'soul' },
        ]},
        frostStaff: { name: 'Frost Staff Line', bonusType: 'FROSTSTAFF', items: [
          { id: 'MAIN_FROSTSTAFF',         name: 'Frost Staff',       rss: 'PLANKS', qty: 16, rss2: 'METALBAR', qty2: 8 },
          { id: '2H_FROSTSTAFF',           name: 'Great Frost Staff', rss: 'PLANKS', qty: 20, rss2: 'METALBAR', qty2: 12 },
          { id: '2H_GLACIALSTAFF',         name: 'Glacial Staff',     rss: 'PLANKS', qty: 20, rss2: 'METALBAR', qty2: 12 },
          { id: 'MAIN_FROSTSTAFF_KEEPER',  name: 'Hoarfrost Staff',   rss: 'PLANKS', qty: 16, rss2: 'METALBAR', qty2: 8,  artifact: 'soul' },
          { id: '2H_ICECRYSTAL_UNDEAD',    name: 'Permafrost Prism',  rss: 'PLANKS', qty: 20, rss2: 'METALBAR', qty2: 12, artifact: 'rune' },
          { id: '2H_ICEGAUNTLETS_HELL',    name: 'Icicle Staff',      rss: 'PLANKS', qty: 20, rss2: 'METALBAR', qty2: 12, artifact: 'relic' },
          { id: 'MAIN_FROSTSTAFF_AVALON',  name: 'Chillhowl',         rss: 'PLANKS', qty: 16, rss2: 'METALBAR', qty2: 8,  artifact: 'avalonian' },
          { id: '2H_FROSTSTAFF_CRYSTAL',   name: 'Arctic Staff',      rss: 'PLANKS', qty: 20, rss2: 'METALBAR', qty2: 12, artifact: 'crystal' },
        ]},
        cursedStaff: { name: 'Cursed Staff Line', bonusType: 'CURSEDSTAFF', items: [
          { id: 'MAIN_CURSEDSTAFF',         name: 'Cursed Staff',       rss: 'PLANKS', qty: 16, rss2: 'METALBAR', qty2: 8 },
          { id: '2H_CURSEDSTAFF',           name: 'Great Cursed Staff', rss: 'PLANKS', qty: 20, rss2: 'METALBAR', qty2: 12 },
          { id: '2H_DEMONICSTAFF',          name: 'Demonic Staff',      rss: 'PLANKS', qty: 20, rss2: 'METALBAR', qty2: 12 },
          { id: 'MAIN_CURSEDSTAFF_UNDEAD',  name: 'Lifecurse Staff',    rss: 'PLANKS', qty: 16, rss2: 'METALBAR', qty2: 8,  artifact: 'rune' },
          { id: '2H_CURSEDSTAFF_MORGANA',   name: 'Damnation Staff',    rss: 'PLANKS', qty: 20, rss2: 'METALBAR', qty2: 12, artifact: 'morgana' },
          { id: 'MAIN_CURSEDSTAFF_AVALON',  name: 'Shadowcaller',       rss: 'PLANKS', qty: 16, rss2: 'METALBAR', qty2: 8,  artifact: 'avalonian' },
          { id: 'MAIN_CURSEDSTAFF_CRYSTAL', name: 'Rotcaller Staff',    rss: 'PLANKS', qty: 16, rss2: 'METALBAR', qty2: 8,  artifact: 'crystal' },
          { id: '2H_SKULLORB_HELL',         name: 'Cursed Skull',       rss: 'PLANKS', qty: 20, rss2: 'METALBAR', qty2: 12, artifact: 'relic' },
        ]},
        shapeshifterStaff: { name: 'Shapeshifter Staff Line', bonusType: 'SHAPESHIFTERSTAFF', items: [
          { id: '2H_SHAPESHIFTER_SET1',    name: 'Prowling Staff',  rss: 'PLANKS', qty: 20, rss2: 'LEATHER', qty2: 12 },
          { id: '2H_SHAPESHIFTER_SET2',    name: 'Rootbound Staff', rss: 'PLANKS', qty: 20, rss2: 'LEATHER', qty2: 12 },
          { id: '2H_SHAPESHIFTER_SET3',    name: 'Primal Staff',    rss: 'PLANKS', qty: 20, rss2: 'LEATHER', qty2: 12 },
          { id: '2H_SHAPESHIFTER_HELL',    name: 'Hellspawn Staff', rss: 'PLANKS', qty: 20, rss2: 'LEATHER', qty2: 12, artifact: 'relic' },
          { id: '2H_SHAPESHIFTER_KEEPER',  name: 'Earthrune Staff', rss: 'PLANKS', qty: 20, rss2: 'LEATHER', qty2: 12, artifact: 'soul' },
          { id: '2H_SHAPESHIFTER_MORGANA', name: 'Bloodmoon Staff', rss: 'PLANKS', qty: 20, rss2: 'LEATHER', qty2: 12, artifact: 'morgana' },
          { id: '2H_SHAPESHIFTER_AVALON',  name: 'Lightcaller',     rss: 'PLANKS', qty: 20, rss2: 'LEATHER', qty2: 12, artifact: 'avalonian' },
          { id: '2H_SHAPESHIFTER_CRYSTAL', name: 'Stillgaze Staff', rss: 'PLANKS', qty: 20, rss2: 'LEATHER', qty2: 12, artifact: 'crystal' },
        ]},
      }},
      armor: { label: 'Cloth Armor', families: {
        clothHead:  { name: 'Cowls',   bonusType: 'CLOTH_HEAD',  items: [
          { id: 'HEAD_CLOTH_SET1',    name: 'Scholar Cowl',    rss: 'CLOTH', qty: 8 },
          { id: 'HEAD_CLOTH_SET2',    name: 'Mage Cowl',       rss: 'CLOTH', qty: 8 },
          { id: 'HEAD_CLOTH_SET3',    name: 'Druid Cowl',      rss: 'CLOTH', qty: 8 },
          { id: 'HEAD_CLOTH_HELL',    name: 'Demon Cowl',      rss: 'CLOTH', qty: 8, artifact: 'relic' },
          { id: 'HEAD_CLOTH_KEEPER',  name: 'Keeper Cowl',     rss: 'CLOTH', qty: 8, artifact: 'soul' },
          { id: 'HEAD_CLOTH_MORGANA', name: 'Morgana Cowl',    rss: 'CLOTH', qty: 8, artifact: 'morgana' },
          { id: 'HEAD_CLOTH_AVALON',  name: 'Avalonian Cowl',  rss: 'CLOTH', qty: 8, artifact: 'avalonian' },
          { id: 'HEAD_CLOTH_ROYAL',   name: 'Royal Cowl',      rss: 'CLOTH', qty: 8, artifact: 'royal' },
        ]},
        clothChest: { name: 'Robes',   bonusType: 'CLOTH_ARMOR', items: [
          { id: 'ARMOR_CLOTH_SET1',    name: 'Scholar Robe',    rss: 'CLOTH', qty: 16 },
          { id: 'ARMOR_CLOTH_SET2',    name: 'Mage Robe',       rss: 'CLOTH', qty: 16 },
          { id: 'ARMOR_CLOTH_SET3',    name: 'Druid Robe',      rss: 'CLOTH', qty: 16 },
          { id: 'ARMOR_CLOTH_HELL',    name: 'Demon Robe',      rss: 'CLOTH', qty: 16, artifact: 'relic' },
          { id: 'ARMOR_CLOTH_KEEPER',  name: 'Keeper Robe',     rss: 'CLOTH', qty: 16, artifact: 'soul' },
          { id: 'ARMOR_CLOTH_MORGANA', name: 'Morgana Robe',    rss: 'CLOTH', qty: 16, artifact: 'morgana' },
          { id: 'ARMOR_CLOTH_AVALON',  name: 'Avalonian Robe',  rss: 'CLOTH', qty: 16, artifact: 'avalonian' },
          { id: 'ARMOR_CLOTH_ROYAL',   name: 'Royal Robe',      rss: 'CLOTH', qty: 16, artifact: 'royal' },
        ]},
        clothShoes: { name: 'Sandals', bonusType: 'CLOTH_SHOES', items: [
          { id: 'SHOES_CLOTH_SET1',    name: 'Scholar Sandals',  rss: 'CLOTH', qty: 8 },
          { id: 'SHOES_CLOTH_SET2',    name: 'Mage Sandals',     rss: 'CLOTH', qty: 8 },
          { id: 'SHOES_CLOTH_SET3',    name: 'Druid Sandals',    rss: 'CLOTH', qty: 8 },
          { id: 'SHOES_CLOTH_HELL',    name: 'Demon Sandals',    rss: 'CLOTH', qty: 8, artifact: 'relic' },
          { id: 'SHOES_CLOTH_KEEPER',  name: 'Keeper Sandals',   rss: 'CLOTH', qty: 8, artifact: 'soul' },
          { id: 'SHOES_CLOTH_MORGANA', name: 'Morgana Sandals',  rss: 'CLOTH', qty: 8, artifact: 'morgana' },
          { id: 'SHOES_CLOTH_AVALON',  name: 'Avalonian Sandals',rss: 'CLOTH', qty: 8, artifact: 'avalonian' },
          { id: 'SHOES_CLOTH_ROYAL',   name: 'Royal Sandals',    rss: 'CLOTH', qty: 8, artifact: 'royal' },
        ]},
      }},
      offhands: { label: 'Off-Hands', families: {
        tome: { name: 'Tomes & Off-Hands', bonusType: 'TOME', items: [
          { id: 'OFF_BOOK',            name: 'Tome of Spells',      rss: 'CLOTH', qty: 4, rss2: 'LEATHER', qty2: 4 },
          { id: 'OFF_DEMONSKULL_HELL', name: 'Muisak',              rss: 'CLOTH', qty: 4, rss2: 'LEATHER', qty2: 4, artifact: 'relic' },
          { id: 'OFF_TOTEM_KEEPER',    name: 'Taproot',             rss: 'CLOTH', qty: 4, rss2: 'LEATHER', qty2: 4, artifact: 'soul' },
          { id: 'OFF_ORB_MORGANA',     name: 'Eye of Secrets',      rss: 'CLOTH', qty: 4, rss2: 'LEATHER', qty2: 4, artifact: 'morgana' },
          { id: 'OFF_CENSER_AVALON',   name: 'Celestial Censer',    rss: 'CLOTH', qty: 4, rss2: 'LEATHER', qty2: 4, artifact: 'avalonian' },
          { id: 'OFF_TOME_CRYSTAL',    name: 'Timelocked Grimoire', rss: 'CLOTH', qty: 4, rss2: 'LEATHER', qty2: 4, artifact: 'crystal' },
        ]},
      }},
    },
  },

  toolmaker: {
    label: 'Toolmaker', emoji: '🪓',
    categories: {
      tools: { label: 'Gathering Tools', families: {
        all: { name: 'Gathering Tools', bonusType: 'TOOLS', items: [
          { id: '2H_TOOL_PICK',   name: "Miner's Pick",   rss: 'PLANKS', qty: 6, rss2: 'METALBAR', qty2: 2 },
          { id: '2H_TOOL_AXE',    name: "Logger's Axe",   rss: 'PLANKS', qty: 6, rss2: 'METALBAR', qty2: 2 },
          { id: '2H_TOOL_SICKLE', name: 'Sickle',         rss: 'PLANKS', qty: 6, rss2: 'METALBAR', qty2: 2 },
          { id: '2H_TOOL_KNIFE',  name: 'Skinning Knife', rss: 'PLANKS', qty: 6, rss2: 'METALBAR', qty2: 2 },
        ]},
      }},
    },
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const RENDER_BASE = 'https://render.albiononline.com/v1/item';

/** Build the full Albion item ID for an item at a given tier and enchant.
 *  Weapons/armor use @N suffix (not _LEVEL{N}@{N} which is for resources only). */
export function buildItemId(baseId, tier, enchant) {
  if (enchant === 0) return `T${tier}_${baseId}`;
  return `T${tier}_${baseId}@${enchant}`;
}

/** Icon URL for a crafted item. */
export function craftIconUrl(baseId, tier, enchant = 0) {
  return `${RENDER_BASE}/${buildItemId(baseId, tier, enchant)}.png`;
}

/** Collect all item IDs for a family at a given tier (all enchants 0-4). */
export function familyItemIds(familyItems, tier) {
  const ids = [];
  for (const item of familyItems) {
    for (let e = 0; e <= 4; e++) {
      ids.push(buildItemId(item.id, tier, e));
    }
  }
  return ids;
}
