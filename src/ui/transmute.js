import { RESOURCES, TIERS, ENCHANTS, getIconUrl } from '../data/items.js';
import { fetchPricesForResource, clearCache }        from '../api/albionApi.js';
import { getTransmuteCost }                         from './catalogue.js';
import { BONUS_CITY }                               from '../data/cities.js';

const RAW_NAMES = {
  ORE:   { 4:'Iron Ore',    5:'Titanium Ore',  6:'Runite Ore',    7:'Meteorite Ore', 8:'Adamantium Ore' },
  WOOD:  { 4:'Birch Logs',  5:'Chestnut Logs', 6:'Pine Logs',     7:'Cedar Logs',    8:'Bloodoak Logs'  },
  FIBER: { 4:'Cotton',      5:'Flax',          6:'Hemp',          7:'Skyflower',     8:'Redleaf Cotton' },
  HIDE:  { 4:'Medium Hide', 5:'Heavy Hide',    6:'Robust Hide',   7:'Thick Hide',    8:'Resilient Hide' },
};

const ENCHANT_PREFIXES = ['', 'Uncommon ', 'Rare ', 'Exceptional ', 'Pristine '];

let currentResource = 'ORE';
let currentCity     = BONUS_CITY['ORE'];
let apiPrices       = {}; // itemId → city → { sell_price_min }
let manualPrices    = {}; // resourceType → tierKey → number

// ── localStorage ──────────────────────────────────────────────────────────────

function lsManualKey(rt, tk) {
  return `transmute.manual.${rt}.${tk}`;
}

function loadManualPrices() {
  const result = {};
  for (const rt of ['ORE', 'WOOD', 'FIBER', 'HIDE']) {
    result[rt] = {};
    for (const tier of TIERS) {
      for (const enchant of ENCHANTS) {
        const tk = tierKey(tier, enchant);
        const v  = localStorage.getItem(lsManualKey(rt, tk));
        if (v !== null) result[rt][tk] = Number(v);
      }
    }
  }
  return result;
}

function saveManualPrice(rt, tk, value) {
  if (value == null) {
    localStorage.removeItem(lsManualKey(rt, tk));
    delete manualPrices[rt][tk];
  } else {
    localStorage.setItem(lsManualKey(rt, tk), String(value));
    manualPrices[rt][tk] = value;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function tierKey(tier, enchant) {
  return enchant === 0 ? `T${tier}` : `T${tier}.${enchant}`;
}

function fmt(n) {
  if (n == null) return '—';
  return Math.round(n).toLocaleString('en-US').replace(/,/g, ' ');
}

function getApiPrice(rt, tier, enchant) {
  const itemId = RESOURCES[rt].tiers[`T${tier}`].raw[enchant];
  return apiPrices[itemId]?.[currentCity]?.sell_price_min ?? null;
}

function getEffectivePrice(rt, tier, enchant) {
  const tk     = tierKey(tier, enchant);
  const manual = manualPrices[rt]?.[tk];
  if (manual != null) return manual;
  return getApiPrice(rt, tier, enchant);
}

function getR1Cost(rt, tier, enchant) {
  if (tier <= 4) return null;
  const tk   = tierKey(tier, enchant);
  const cost = getTransmuteCost(tk, 'r1');
  if (cost == null) return null;
  const src = getEffectivePrice(rt, tier - 1, enchant);
  if (src == null) return null;
  return src + cost;
}

function getR2Cost(rt, tier, enchant) {
  if (enchant === 0) return null;
  const tk   = tierKey(tier, enchant);
  const cost = getTransmuteCost(tk, 'r2');
  if (cost == null) return null;
  const src = getEffectivePrice(rt, tier, enchant - 1);
  if (src == null) return null;
  return src + cost;
}

function decide(hdv, r1, r2) {
  const candidates = [];
  if (hdv != null) candidates.push({ key: 'hdv', label: 'HDV',      val: hdv });
  if (r1  != null) candidates.push({ key: 'r1',  label: 'R1 (T-1)', val: r1  });
  if (r2  != null) candidates.push({ key: 'r2',  label: 'R2 (E-1)', val: r2  });
  if (!candidates.length) return { best: { key: 'hdv', label: 'HDV', val: null }, savings: 0, second: null };
  candidates.sort((a, b) => a.val - b.val);
  return {
    best:    candidates[0],
    savings: candidates.length > 1 ? candidates[1].val - candidates[0].val : 0,
    second:  candidates.length > 1 ? candidates[1] : null,
  };
}

// ── Tooltip builders ──────────────────────────────────────────────────────────

function buildTooltip(rows) {
  return rows.map(([label, value]) => {
    if (label === '__formula__') return `<div class="tt-formula">${value}</div>`;
    return `<div><span class="tt-label">${label}</span> <span class="tt-value">${value}</span></div>`;
  }).join('');
}

function trmR1Tooltip(srcTk, srcPrice, transmuteCost, total) {
  if (srcPrice == null || transmuteCost == null) {
    return buildTooltip([['R1 — not available for T4', '']]);
  }
  return buildTooltip([
    [`Source (${srcTk}) :`, fmt(srcPrice)],
    ['Transmute cost :', fmt(transmuteCost)],
    ['__formula__', `${fmt(srcPrice)} + ${fmt(transmuteCost)} = ${fmt(total)}`],
  ]);
}

function trmR2Tooltip(srcTk, srcPrice, transmuteCost, total) {
  if (srcPrice == null || transmuteCost == null) {
    return buildTooltip([['R2 — not available for E0', '']]);
  }
  return buildTooltip([
    [`Source (${srcTk}) :`, fmt(srcPrice)],
    ['Transmute cost :', fmt(transmuteCost)],
    ['__formula__', `${fmt(srcPrice)} + ${fmt(transmuteCost)} = ${fmt(total)}`],
  ]);
}

function trmDecisionTooltip(hdv, r1, r2, best) {
  return buildTooltip([
    ['HDV :', hdv != null ? fmt(hdv) : '—'],
    ['R1 :', r1  != null ? fmt(r1)  : '—'],
    ['R2 :', r2  != null ? fmt(r2)  : '—'],
    ['__formula__', `Best : ${best.label} = ${fmt(best.val)}`],
  ]);
}

function trmSavingsTooltip(best, second, savings) {
  if (second == null || savings <= 0) {
    return buildTooltip([['No cheaper alternative', '']]);
  }
  return buildTooltip([
    [`${second.label} :`, fmt(second.val)],
    [`${best.label} :`, fmt(best.val)],
    ['__formula__', `${fmt(second.val)} − ${fmt(best.val)} = ${fmt(savings)} silver saved`],
  ]);
}

// ── Render ────────────────────────────────────────────────────────────────────

function renderTable() {
  const tbody = document.getElementById('transmute-tbody');
  if (!tbody) return;

  const names = RAW_NAMES[currentResource];
  const html  = [];

  for (const tier of TIERS) {
    html.push(`<tr class="group-row t${tier}"><td colspan="8">Tier ${tier}</td></tr>`);

    for (const enchant of ENCHANTS) {
      const tk       = tierKey(tier, enchant);
      const itemId   = RESOURCES[currentResource].tiers[`T${tier}`].raw[enchant];
      const itemName = ENCHANT_PREFIXES[enchant] + names[tier];

      const hdvApi       = getApiPrice(currentResource, tier, enchant);
      const manual       = manualPrices[currentResource]?.[tk] ?? null;
      const effectiveHdv = manual != null ? manual : hdvApi;

      // Inline R1/R2 breakdown for tooltips
      const r1Cost = tier > 4 ? getTransmuteCost(tk, 'r1') : null;
      const r1Src  = tier > 4 ? getEffectivePrice(currentResource, tier - 1, enchant) : null;
      const r1     = (r1Cost != null && r1Src != null) ? r1Src + r1Cost : null;

      const r2Cost = enchant > 0 ? getTransmuteCost(tk, 'r2') : null;
      const r2Src  = enchant > 0 ? getEffectivePrice(currentResource, tier, enchant - 1) : null;
      const r2     = (r2Cost != null && r2Src != null) ? r2Src + r2Cost : null;

      const { best, savings, second } = decide(effectiveHdv, r1, r2);

      const hdvBest    = best.key === 'hdv' && manual == null;
      const manualWins = best.key === 'hdv' && manual != null;
      const r1SrcTk = tier > 4 ? tierKey(tier - 1, enchant) : '';
      const r2SrcTk = enchant > 0 ? tierKey(tier, enchant - 1) : '';

      html.push(`<tr>
        <td><div class="item-cell">
          <img class="cat-item-icon" src="${getIconUrl(itemId)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'" />
          <span class="cat-item-name">${itemName}</span>
        </div></td>
        <td style="text-align:center"><span class="cat-tier-tag">${tk}</span></td>
        <td class="num${hdvBest ? ' best' : ''}">${fmt(hdvApi)}</td>
        <td class="col-manual"><input class="trm-manual-input${manual != null ? ' overridden' : ''}${manualWins ? ' winning' : ''}" type="number"
          placeholder="—" value="${manual ?? ''}"
          data-rt="${currentResource}" data-tk="${tk}" /></td>
        <td class="num${best.key === 'r1' ? ' best' : ''}${r1 == null ? ' muted' : ''} has-tooltip">
          ${fmt(r1)}<span class="tooltip">${trmR1Tooltip(r1SrcTk, r1Src, r1Cost, r1)}</span>
        </td>
        <td class="num${best.key === 'r2' ? ' best' : ''}${r2 == null ? ' muted' : ''} has-tooltip">
          ${fmt(r2)}<span class="tooltip">${trmR2Tooltip(r2SrcTk, r2Src, r2Cost, r2)}</span>
        </td>
        <td class="has-tooltip" style="text-align:center">
          <span class="chip ${best.key}">${best.label}</span>
          <span class="tooltip">${trmDecisionTooltip(effectiveHdv, r1, r2, best)}</span>
        </td>
        <td class="${savings > 0 ? 'savings-pos' : 'savings-zero'} has-tooltip">
          ${savings > 0 ? '(' + fmt(savings) + ')' : '—'}
          <span class="tooltip">${trmSavingsTooltip(best, second, savings)}</span>
        </td>
      </tr>`);
    }
  }

  tbody.innerHTML = html.join('');

  tbody.querySelectorAll('.trm-manual-input').forEach(input => {
    input.addEventListener('change', () => {
      const rt  = input.dataset.rt;
      const tk  = input.dataset.tk;
      const val = input.value.trim();
      const n   = val === '' ? null : parseInt(val, 10);
      saveManualPrice(rt, tk, n == null || isNaN(n) || n <= 0 ? null : n);
      renderTable();
      window.dispatchEvent(new CustomEvent('forge:prices-changed'));
    });
  });
}

// ── Fetch ─────────────────────────────────────────────────────────────────────

async function doRefresh() {
  const btn = document.getElementById('trm-refresh-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Loading…'; }

  try {
    clearCache();
    apiPrices = await fetchPricesForResource(currentResource, [currentCity]);
    renderTable();
    window.dispatchEvent(new CustomEvent('forge:prices-changed'));
  } catch (err) {
    console.error('[transmute] fetch error:', err);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '↻ Refresh'; }
  }
}

// ── Public exports (for Refining tab) ────────────────────────────────────────

export function getEffectiveRawPrice(resourceType, tk) {
  const m = tk.match(/^T(\d+)(?:\.(\d+))?$/);
  if (!m) return null;
  const tier    = Number(m[1]);
  const enchant = m[2] != null ? Number(m[2]) : 0;

  const hdv = getEffectivePrice(resourceType, tier, enchant);
  const r1  = getR1Cost(resourceType, tier, enchant);
  const r2  = getR2Cost(resourceType, tier, enchant);

  const candidates = [hdv, r1, r2].filter(v => v != null);
  return candidates.length ? Math.min(...candidates) : null;
}

export function getDecision(resourceType, tk) {
  const m = tk.match(/^T(\d+)(?:\.(\d+))?$/);
  if (!m) return 'hdv';
  const tier    = Number(m[1]);
  const enchant = m[2] != null ? Number(m[2]) : 0;

  const hdv = getEffectivePrice(resourceType, tier, enchant);
  const r1  = getR1Cost(resourceType, tier, enchant);
  const r2  = getR2Cost(resourceType, tier, enchant);

  return decide(hdv, r1, r2).best.key;
}

export function getManualPrice(resourceType, tk) {
  return manualPrices[resourceType]?.[tk] ?? null;
}

/**
 * Remonte la chaîne d'acquisition optimale pour une raw cible.
 * Retourne le point d'achat HDV et la liste des transmutations dans l'ordre HDV→cible.
 *
 * @param {string} rss       - 'ORE' | 'WOOD' | 'FIBER' | 'HIDE'
 * @param {number} tier      - 4–8
 * @param {number} enchant   - 0–4
 * @returns {{ hdvBuy: { rss, tier, enchant, tierKey }, steps: Array }}
 */
export function getAcquisitionChain(rss, tier, enchant) {
  const steps = [];

  function recurse(t, e, depth) {
    if (depth > 12) return { tier: t, enchant: e };
    const hdv = getEffectivePrice(rss, t, e);
    const r1  = getR1Cost(rss, t, e);
    const r2  = getR2Cost(rss, t, e);
    const dec = decide(hdv, r1, r2).best.key;

    if (dec === 'r1' && t > 4) {
      const hdvNode = recurse(t - 1, e, depth + 1);
      steps.push({
        from: { tier: t - 1, enchant: e,     tierKey: tierKey(t - 1, e) },
        to:   { tier: t,     enchant: e,     tierKey: tierKey(t, e) },
        via: 'r1',
        silverCost: getTransmuteCost(tierKey(t, e), 'r1') ?? 0,
      });
      return hdvNode;
    }

    if (dec === 'r2' && e > 0) {
      const hdvNode = recurse(t, e - 1, depth + 1);
      steps.push({
        from: { tier: t, enchant: e - 1, tierKey: tierKey(t, e - 1) },
        to:   { tier: t, enchant: e,     tierKey: tierKey(t, e) },
        via: 'r2',
        silverCost: getTransmuteCost(tierKey(t, e), 'r2') ?? 0,
      });
      return hdvNode;
    }

    return { tier: t, enchant: e };
  }

  const hdvNode = recurse(tier, enchant, 0);
  return {
    hdvBuy: { rss, tier: hdvNode.tier, enchant: hdvNode.enchant, tierKey: tierKey(hdvNode.tier, hdvNode.enchant) },
    steps,
  };
}

// ── Init ──────────────────────────────────────────────────────────────────────

function loadCityForResource(rt) {
  return localStorage.getItem(`transmute.city.${rt}`) ?? BONUS_CITY[rt];
}

export async function initTransmute() {
  const savedResource = localStorage.getItem('transmute.resource');
  if (['ORE', 'WOOD', 'FIBER', 'HIDE'].includes(savedResource)) currentResource = savedResource;

  currentCity = loadCityForResource(currentResource);

  manualPrices = loadManualPrices();

  // Resource pills
  const pills = document.querySelectorAll('.trm-resource-pill');
  const citySelect = document.getElementById('trm-city-select');
  pills.forEach(pill => {
    pill.classList.toggle('on', pill.dataset.resource === currentResource);
    pill.addEventListener('click', () => {
      pills.forEach(p => p.classList.remove('on'));
      pill.classList.add('on');
      currentResource = pill.dataset.resource;
      localStorage.setItem('transmute.resource', currentResource);
      currentCity = loadCityForResource(currentResource);
      if (citySelect) citySelect.value = currentCity;
      doRefresh();
    });
  });

  // City select
  if (citySelect) {
    citySelect.value = currentCity;
    citySelect.addEventListener('change', () => {
      currentCity = citySelect.value;
      localStorage.setItem(`transmute.city.${currentResource}`, currentCity);
      doRefresh();
    });
  }

  document.getElementById('trm-refresh-btn')?.addEventListener('click', doRefresh);

  renderTable();
  await doRefresh();
}
