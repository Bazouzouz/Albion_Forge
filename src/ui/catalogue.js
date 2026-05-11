import { RESOURCES, TIERS, ENCHANTS, getIconUrl, T3_REFINED_IDS } from '../data/items.js';
import { CITIES }                                   from '../data/cities.js';
import { fetchPricesForResource, getDataAge }        from '../api/albionApi.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const FOCUS_PER_MONTH = 300_000;

const ITEM_NAMES = {
  ORE: {
    rawNames:     { 4:'Iron Ore',        5:'Titanium Ore',       6:'Runite Ore',         7:'Meteorite Ore',        8:'Adamantium Ore'        },
    refinedNames: { 4:'Steel Bar',        5:'Titanium Steel Bar', 6:'Runite Steel Bar',   7:'Meteorite Steel Bar',  8:'Adamantium Steel Bar'  },
  },
  WOOD: {
    rawNames:     { 4:'Birch Logs',       5:'Chestnut Logs',      6:'Pine Logs',          7:'Cedar Logs',           8:'Bloodoak Logs'         },
    refinedNames: { 4:'Birch Planks',     5:'Chestnut Planks',    6:'Pine Planks',        7:'Cedar Planks',         8:'Bloodoak Planks'       },
  },
  FIBER: {
    rawNames:     { 4:'Cotton',           5:'Flax',               6:'Hemp',               7:'Skyflower',            8:'Redleaf Cotton'        },
    refinedNames: { 4:'Simple Cloth',     5:'Neat Cloth',         6:'Fine Cloth',         7:'Ornate Cloth',         8:'Lavish Cloth'          },
  },
  HIDE: {
    rawNames:     { 4:'Medium Hide',      5:'Heavy Hide',         6:'Robust Hide',        7:'Thick Hide',           8:'Resilient Hide'        },
    refinedNames: { 4:'Worked Leather',   5:'Cured Leather',      6:'Hardened Leather',   7:'Reinforced Leather',   8:'Fortified Leather'     },
  },
};

const ENCHANT_PREFIXES = ['', 'Uncommon ', 'Rare ', 'Exceptional ', 'Pristine '];

const COST_DEFAULTS = {
  'T4':   { focus: 3,   r1: null,   r2: null    },
  'T4.1': { focus: 6,   r1: null,   r2: 1745    },
  'T4.2': { focus: 9,   r1: null,   r2: 3494    },
  'T4.3': { focus: 15,  r1: null,   r2: 6992    },
  'T4.4': { focus: 24,  r1: null,   r2: 27860   },
  'T5':   { focus: 6,   r1: 908,    r2: null    },
  'T5.1': { focus: 10,  r1: 1817,   r2: 2322    },
  'T5.2': { focus: 17,  r1: 3633,   r2: 4644    },
  'T5.3': { focus: 29,  r1: 7265,   r2: 9288    },
  'T5.4': { focus: 48,  r1: 28980,  r2: 37072   },
  'T6':   { focus: 10,  r1: 1453,   r2: null    },
  'T6.1': { focus: 18,  r1: 2905,   r2: 3483    },
  'T6.2': { focus: 30,  r1: 5810,   r2: 6966    },
  'T6.3': { focus: 53,  r1: 19134,  r2: 22949   },
  'T6.4': { focus: 88,  r1: 76416,  r2: 91675   },
  'T7':   { focus: 18,  r1: 2902,   r2: null    },
  'T7.1': { focus: 31,  r1: 5804,   r2: 5573    },
  'T7.2': { focus: 54,  r1: 18255,  r2: 17527   },
  'T7.3': { focus: 94,  r1: 60179,  r2: 57776   },
  'T7.4': { focus: 156, r1: 240525, r2: 230911  },
  'T8':   { focus: 31,  r1: 5804,   r2: null    },
  'T8.1': { focus: 55,  r1: 17388,  r2: 16694   },
  'T8.2': { focus: 95,  r1: 57717,  r2: 52532   },
  'T8.3': { focus: 167, r1: 180442, r2: 173232  },
  'T8.4': { focus: 277, r1: 901631, r2: 865581  },
};

const HEARTS = [
  { resourceType: 'ORE',   name: 'Mountainheart', desc: '⛏ Ore recipes',   iconId: 'T1_FACTION_MOUNTAIN_TOKEN_1' },
  { resourceType: 'WOOD',  name: 'Treeheart',     desc: '🪵 Wood recipes',  iconId: 'T1_FACTION_FOREST_TOKEN_1'   },
  { resourceType: 'FIBER', name: 'Vineheart',     desc: '🌿 Fiber recipes', iconId: 'T1_FACTION_SWAMP_TOKEN_1'    },
  { resourceType: 'HIDE',  name: 'Beastheart',    desc: '🐾 Hide recipes',  iconId: 'T1_FACTION_STEPPE_TOKEN_1'   },
];

// ── State ─────────────────────────────────────────────────────────────────────

let currentResource = 'ORE';
// itemId → cityId → { sell_price_min, sell_price_min_date }
let apiPrices = {};

// ── localStorage helpers ──────────────────────────────────────────────────────

function lsGet(key, def) {
  const v = localStorage.getItem(key);
  if (v === null) return def;
  const n = Number(v);
  return isNaN(n) ? def : n;
}

function lsSet(key, val) {
  localStorage.setItem(key, String(val));
}

function lsGetStr(key, def) {
  return localStorage.getItem(key) ?? def;
}

// ── Public exports (used by Transmute / Refining tabs) ───────────────────────

export function getPremiumPrice() {
  return lsGet('cat_premium', 24_000_000);
}

export function getCostPerFocus() {
  return getPremiumPrice() / FOCUS_PER_MONTH;
}

export function getFocusCost(tierKey) {
  const stored = localStorage.getItem(`cat_focus_${tierKey}`);
  if (stored !== null) return Number(stored);
  return COST_DEFAULTS[tierKey]?.focus ?? 0;
}

export function getTransmuteCost(tierKey, recipe) {
  const lsKey = `cat_${recipe}_${tierKey}`;
  const stored = localStorage.getItem(lsKey);
  if (stored !== null) return Number(stored);
  return COST_DEFAULTS[tierKey]?.[recipe] ?? null;
}

export function getHeartPrice(resourceType) {
  return lsGet(`cat_heart_${resourceType}`, 38_000);
}

export function getApiPrice(itemId, city) {
  return apiPrices[itemId]?.[city]?.sell_price_min ?? null;
}

export function getT3RefinedPrice(resourceType) {
  const itemId = T3_REFINED_IDS[resourceType];
  if (!itemId) return 0;
  const city = document.getElementById('cat-refined-city')?.value;
  if (city) {
    const p = apiPrices[itemId]?.[city]?.sell_price_min ?? 0;
    if (p > 0) return p;
  }
  // Fallback: first city with a valid price
  const cityPrices = apiPrices[itemId];
  if (!cityPrices) return 0;
  for (const entry of Object.values(cityPrices)) {
    if (entry.sell_price_min > 0) return entry.sell_price_min;
  }
  return 0;
}

// ── Formatting ────────────────────────────────────────────────────────────────

function fmt(n) {
  if (!n || n === 0) return '—';
  return n.toLocaleString('en-US').replace(/,/g, ' ');
}

function tierKey(tier, enchant) {
  return enchant === 0 ? `T${tier}` : `T${tier}.${enchant}`;
}

// ── Render: main catalogue table ──────────────────────────────────────────────

function itemBlock(itemId, name, price, ageObj) {
  return `<div class="item-block">
    <div class="item-cell">
      <img class="cat-item-icon" src="${getIconUrl(itemId)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'" />
      <span class="cat-item-name">${name}</span>
    </div>
    <div class="price-block">
      <div class="num${price ? '' : ' muted'}">${price ? fmt(price) : '—'}</div>
      <div class="cat-age${ageObj ? ` ${ageObj.status}` : ''}">${ageObj ? ageObj.label : '—'}</div>
    </div>
  </div>`;
}

function renderCatalogueTable() {
  const tbody = document.getElementById('cat-tbody');
  if (!tbody) return;

  const rawCity     = document.getElementById('cat-raw-city')?.value     ?? CITIES[0].id;
  const refinedCity = document.getElementById('cat-refined-city')?.value ?? CITIES[0].id;
  const rDef  = RESOURCES[currentResource];
  const names = ITEM_NAMES[currentResource];
  const html  = [];

  for (const tier of TIERS) {
    html.push(`<tr class="cat-group-row cat-group-t${tier}"><td colspan="2">Tier ${tier}</td></tr>`);

    for (const enchant of ENCHANTS) {
      const rawId  = rDef.tiers[`T${tier}`].raw[enchant];
      const refId  = rDef.tiers[`T${tier}`].refined[enchant];
      const label  = tierKey(tier, enchant);
      const prefix = ENCHANT_PREFIXES[enchant];

      const rawEntry  = apiPrices[rawId]?.[rawCity];
      const rawPrice  = rawEntry?.sell_price_min || 0;
      const rawAgeObj = rawEntry?.sell_price_min_date ? getDataAge(rawEntry.sell_price_min_date) : null;

      const refEntry  = apiPrices[refId]?.[refinedCity];
      const refPrice  = refEntry?.sell_price_min || 0;
      const refAgeObj = refEntry?.sell_price_min_date ? getDataAge(refEntry.sell_price_min_date) : null;

      html.push(`<tr>
        <td style="text-align:center"><span class="cat-tier-tag">${label}</span></td>
        <td class="split-cell">
          <div class="split-row">
            <div>${itemBlock(rawId, prefix + names.rawNames[tier],     rawPrice, rawAgeObj)}</div>
            <div>${itemBlock(refId, prefix + names.refinedNames[tier], refPrice, refAgeObj)}</div>
          </div>
        </td>
      </tr>`);
    }
  }

  tbody.innerHTML = html.join('');
}

// ── Render: focus/transmute cost table ────────────────────────────────────────

function renderCostTable() {
  const tbody = document.getElementById('cat-cost-tbody');
  if (!tbody) return;

  const groups = [
    { tier: 'T4', cls: 'cat-fgroup-t4', keys: ['T4','T4.1','T4.2','T4.3','T4.4'] },
    { tier: 'T5', cls: 'cat-fgroup-t5', keys: ['T5','T5.1','T5.2','T5.3','T5.4'] },
    { tier: 'T6', cls: 'cat-fgroup-t6', keys: ['T6','T6.1','T6.2','T6.3','T6.4'] },
    { tier: 'T7', cls: 'cat-fgroup-t7', keys: ['T7','T7.1','T7.2','T7.3','T7.4'] },
    { tier: 'T8', cls: 'cat-fgroup-t8', keys: ['T8','T8.1','T8.2','T8.3','T8.4'] },
  ];

  const html = [];
  for (const { tier, cls, keys } of groups) {
    html.push(`<tr class="cat-fgroup ${cls}"><td colspan="4">${tier}</td></tr>`);
    for (const k of keys) {
      const def      = COST_DEFAULTS[k];
      const focusVal = lsGet(`cat_focus_${k}`, def.focus);
      const r1Val    = def.r1 === null ? null : lsGet(`cat_r1_${k}`, def.r1);
      const r2Val    = def.r2 === null ? null : lsGet(`cat_r2_${k}`, def.r2);

      const r1Cell = r1Val === null
        ? `<input class="cat-small-input" disabled value="—" />`
        : `<input class="cat-small-input" type="number" data-key="${k}" data-field="r1" value="${r1Val}" />`;
      const r2Cell = r2Val === null
        ? `<input class="cat-small-input" disabled value="—" />`
        : `<input class="cat-small-input" type="number" data-key="${k}" data-field="r2" value="${r2Val}" />`;

      html.push(`<tr>
        <td class="cat-ftier">${k}</td>
        <td style="text-align:right"><input class="cat-small-input" type="number" data-key="${k}" data-field="focus" value="${focusVal}" /></td>
        <td style="text-align:right">${r1Cell}</td>
        <td style="text-align:right">${r2Cell}</td>
      </tr>`);
    }
  }

  tbody.innerHTML = html.join('');

  tbody.querySelectorAll('.cat-small-input[data-field]').forEach(input => {
    input.addEventListener('change', () => {
      const v = Number(input.value);
      if (!isNaN(v)) {
        lsSet(`cat_${input.dataset.field}_${input.dataset.key}`, v);
        window.dispatchEvent(new CustomEvent('forge:prices-changed'));
      }
    });
  });
}

// ── Render: city hearts ───────────────────────────────────────────────────────

function renderHearts() {
  const container = document.getElementById('cat-hearts-container');
  if (!container) return;

  container.innerHTML = HEARTS.map(h => {
    const price   = lsGet(`cat_heart_${h.resourceType}`, 38_000);
    const iconUrl = `https://render.albiononline.com/v1/item/${h.iconId}.png?size=40`;
    return `<div class="cat-heart-row">
      <img class="cat-heart-icon" src="${iconUrl}" alt="" onerror="this.style.display='none'" />
      <div class="cat-heart-info">
        <div class="cat-heart-name">${h.name}</div>
        <div class="cat-heart-id">${h.desc}</div>
      </div>
      <input class="cat-heart-input" type="number" data-resource="${h.resourceType}" value="${price}" />
    </div>`;
  }).join('');

  container.querySelectorAll('.cat-heart-input').forEach(input => {
    input.addEventListener('change', () => {
      lsSet(`cat_heart_${input.dataset.resource}`, Number(input.value));
      window.dispatchEvent(new CustomEvent('forge:prices-changed'));
    });
  });
}

// ── Update cost-per-focus display ─────────────────────────────────────────────

function updateCostPerFocusDisplay() {
  const el = document.getElementById('cat-cost-per-focus');
  if (el) el.textContent = Math.round(getCostPerFocus()) + ' s';
}

// ── Refresh (API fetch) ───────────────────────────────────────────────────────

export async function doRefresh() {
  const btn = document.getElementById('cat-refresh-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Loading…'; }

  const rawCity     = document.getElementById('cat-raw-city')?.value     ?? CITIES[0].id;
  const refinedCity = document.getElementById('cat-refined-city')?.value ?? CITIES[0].id;
  const cities = [...new Set([rawCity, refinedCity])];

  try {
    apiPrices = await fetchPricesForResource(currentResource, cities);
    renderCatalogueTable();
    window.dispatchEvent(new CustomEvent('forge:prices-changed'));
  } catch (err) {
    console.error('[catalogue] fetch error:', err);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '↻ Refresh'; }
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────

export function initCatalogue() {
  // Restore persisted state
  const savedResource = lsGetStr('cat_resource', 'ORE');
  if (['ORE','WOOD','FIBER','HIDE'].includes(savedResource)) {
    currentResource = savedResource;
  }
  document.querySelectorAll('.cat-resource-pill').forEach(pill => {
    pill.classList.toggle('on', pill.dataset.resource === currentResource);
  });

  const savedRawCity = lsGetStr('cat_raw_city', '');
  const savedRefCity = lsGetStr('cat_ref_city', '');
  const rawCitySel   = document.getElementById('cat-raw-city');
  const refCitySel   = document.getElementById('cat-refined-city');
  if (rawCitySel && savedRawCity)  rawCitySel.value  = savedRawCity;
  if (refCitySel && savedRefCity)  refCitySel.value  = savedRefCity;

  // Premium price
  const premiumInput = document.getElementById('cat-premium-price');
  if (premiumInput) {
    premiumInput.value = lsGet('cat_premium', 24_000_000);
    premiumInput.addEventListener('input', () => {
      lsSet('cat_premium', Number(premiumInput.value) || 24_000_000);
      updateCostPerFocusDisplay();
      window.dispatchEvent(new CustomEvent('forge:prices-changed'));
    });
  }

  // Resource pills
  document.querySelectorAll('.cat-resource-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.cat-resource-pill').forEach(p => p.classList.remove('on'));
      pill.classList.add('on');
      currentResource = pill.dataset.resource;
      lsSet('cat_resource', currentResource);
      apiPrices = {};
      doRefresh();
    });
  });

  // City selects
  rawCitySel?.addEventListener('change', () => {
    lsSet('cat_raw_city', rawCitySel.value);
    renderCatalogueTable();
  });
  refCitySel?.addEventListener('change', () => {
    lsSet('cat_ref_city', refCitySel.value);
    renderCatalogueTable();
  });

  // Refresh button
  document.getElementById('cat-refresh-btn')?.addEventListener('click', doRefresh);

  updateCostPerFocusDisplay();
  renderCostTable();
  renderHearts();
}
