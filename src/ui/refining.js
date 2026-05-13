import { RESOURCES, TIERS, ENCHANTS, getIconUrl, T3_REFINED_IDS } from '../data/items.js';
import { fetchPricesForResource, clearCache }       from '../api/albionApi.js';
import { getEffectiveRawPrice }                    from './transmute.js';
import { getHeartPrice, getFocusCost, getPremiumPrice } from './catalogue.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const RRR_NO_FOCUS    = 0.367;
const RRR_FOCUS       = 0.539;
const FOCUS_PER_MONTH = 300_000;

const RECIPES = {
  4: { r1: 2, r2: 1 },
  5: { r1: 3, r2: 2 },
  6: { r1: 4, r2: 3 },
  7: { r1: 5, r2: 4 },
  8: { r1: 5, r2: 4 },
};

const REFINED_NAMES = {
  ORE:   { 4:'Steel Bar',        5:'Titanium Steel Bar', 6:'Runite Steel Bar',   7:'Meteorite Steel Bar',  8:'Adamantium Steel Bar'  },
  WOOD:  { 4:'Birch Planks',     5:'Chestnut Planks',    6:'Pine Planks',        7:'Cedar Planks',         8:'Bloodoak Planks'       },
  FIBER: { 4:'Simple Cloth',     5:'Neat Cloth',         6:'Fine Cloth',         7:'Ornate Cloth',         8:'Lavish Cloth'          },
  HIDE:  { 4:'Worked Leather',   5:'Cured Leather',      6:'Hardened Leather',   7:'Reinforced Leather',   8:'Fortified Leather'     },
};

const ENCHANT_PREFIXES = ['', 'Uncommon ', 'Rare ', 'Exceptional ', 'Pristine '];

const HEART_INFO = {
  ORE:   { iconId: 'T1_FACTION_MOUNTAIN_TOKEN_1', name: 'Mountainheart' },
  WOOD:  { iconId: 'T1_FACTION_FOREST_TOKEN_1',   name: 'Treeheart'     },
  FIBER: { iconId: 'T1_FACTION_SWAMP_TOKEN_1',    name: 'Vineheart'     },
  HIDE:  { iconId: 'T1_FACTION_STEPPE_TOKEN_1',   name: 'Beastheart'    },
};

// ── State ─────────────────────────────────────────────────────────────────────

let currentResource = 'ORE';
let currentCity     = 'Thetford';
let useFocus        = false;
let useStack        = true;
let stackFromTier   = 7;
let qty             = 100;
let taxRate         = 3;
let apiPrices       = {}; // itemId → city → { sell_price_min, sell_price_min_date }
let manualBarPrices = {}; // resourceType → tierKey → number
const lastResults   = {}; // resourceType → tierKey → result object

// ── localStorage ──────────────────────────────────────────────────────────────

function lsGet(key, def) {
  const v = localStorage.getItem(key);
  return v !== null ? v : def;
}

function lsGetN(key, def) {
  const v = localStorage.getItem(key);
  if (v === null) return def;
  const n = Number(v);
  return isNaN(n) ? def : n;
}

function lsSet(key, val) {
  localStorage.setItem(key, String(val));
}

function loadState() {
  const saved = lsGet('refining.resource', 'ORE');
  if (['ORE', 'WOOD', 'FIBER', 'HIDE'].includes(saved)) currentResource = saved;
  currentCity   = lsGet('refining.city', 'Thetford');
  useFocus      = lsGet('refining.useFocus', '0') === '1';
  useStack      = lsGet('refining.useStack', '1') === '1';
  stackFromTier = lsGetN('refining.stackFromTier', 7);
  qty           = lsGetN('refining.qty', 100);
  taxRate       = lsGetN('refining.tax', 3);

  for (const rt of Object.keys(RESOURCES)) {
    manualBarPrices[rt] = {};
    for (const tier of TIERS) {
      for (const enchant of ENCHANTS) {
        const tk = tierKey(tier, enchant);
        const v  = localStorage.getItem(`refining.manual.${rt}.${tk}`);
        if (v !== null) manualBarPrices[rt][tk] = Number(v);
      }
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function tierKey(tier, enchant) {
  return enchant === 0 ? `T${tier}` : `T${tier}.${enchant}`;
}

function fmt(n) {
  if (n == null || isNaN(n)) return '—';
  return Math.round(n).toLocaleString('en-US').replace(/,/g, ' ');
}

function fmtSigned(n) {
  if (n == null || isNaN(n)) return '—';
  const abs = Math.abs(Math.round(n)).toLocaleString('en-US').replace(/,/g, ' ');
  return n >= 0 ? '+' + abs : '−' + abs;
}

// ── Price lookups ─────────────────────────────────────────────────────────────

function getRawApiPrice(rt, tier, enchant) {
  const itemId = RESOURCES[rt].tiers[`T${tier}`].raw[enchant];
  const data   = apiPrices[itemId]?.[currentCity];
  return (data?.sell_price_min > 0) ? data.sell_price_min : null;
}

function getApiBarPrice(tier, enchant) {
  const itemId = RESOURCES[currentResource].tiers[`T${tier}`].refined[enchant];
  const data   = apiPrices[itemId]?.[currentCity];
  return (data?.sell_price_min > 0) ? data.sell_price_min : null;
}

function getEffectiveBarPrice(tier, enchant) {
  const tk = tierKey(tier, enchant);
  return manualBarPrices[currentResource]?.[tk] ?? getApiBarPrice(tier, enchant);
}

// T3 refined price for T4 input — reads from refining's own apiPrices using the current city
function getT3BarPrice(rt) {
  const itemId = T3_REFINED_IDS[rt];
  if (!itemId) return 0;
  const data = apiPrices[itemId]?.[currentCity];
  return (data?.sell_price_min > 0) ? data.sell_price_min : 0;
}

// ── Calculation ───────────────────────────────────────────────────────────────

function getRefinedInputCost(tier, enchant, stackFromT) {
  if (tier <= 4) {
    return { cost: getT3BarPrice(currentResource), stacked: false };
  }

  if (useStack && tier > stackFromT) {
    const lower = computeRow(currentResource, tier - 1, enchant, stackFromT);
    return { cost: lower.unitInvest ?? 0, stacked: true };
  }

  const price = getEffectiveBarPrice(tier - 1, enchant);
  return { cost: price ?? 0, stacked: false };
}

function computeRow(rt, tier, enchant, stackFromT) {
  const tk  = tierKey(tier, enchant);
  const rec = RECIPES[tier];
  const rrr = useFocus ? RRR_FOCUS : RRR_NO_FOCUS;

  // Prefer transmute checker price (considers R1/R2 transmute paths); fall back to direct API
  let rawPrice = getEffectiveRawPrice(rt, tk);
  if (rawPrice == null) rawPrice = getRawApiPrice(rt, tier, enchant) ?? 0;

  const refinedInput = getRefinedInputCost(tier, enchant, stackFromT);
  const heartPrice   = getHeartPrice(rt);

  const r1 = (rec.r1 * rawPrice + refinedInput.cost) * (1 - rrr);
  const r2Available = enchant !== 4;
  const r2 = r2Available ? (rec.r2 * rawPrice + refinedInput.cost + heartPrice) * (1 - rrr) : null;

  const decision   = (r2Available && r2 < r1) ? 'r2' : 'r1';
  const unitInvest = decision === 'r2' ? r2 : r1;
  const batchInvest = unitInvest * qty;

  const barHdv            = getEffectiveBarPrice(tier, enchant);
  const tax               = taxRate / 100;
  const salePriceAfterTax = barHdv != null ? barHdv * (1 - tax) : null;

  const focusCost       = getFocusCost(tk);
  const costPerFocus    = getPremiumPrice() / FOCUS_PER_MONTH;
  const focusSilverCost = focusCost * costPerFocus;
  const equilibrium     = unitInvest + (useFocus ? focusSilverCost : 0);
  const profit          = salePriceAfterTax != null ? salePriceAfterTax - equilibrium : null;
  const spf             = (useFocus && profit != null && focusCost > 0) ? profit / focusCost : null;

  const result = {
    tier, enchant, tierKey: tk, r1, r2, decision, unitInvest, batchInvest,
    barHdv, salePriceAfterTax, equilibrium, profit, spf,
    refinedInput, rawPrice, heartPrice, focusCost, focusSilverCost, rrr, rec, tax,
  };

  if (!lastResults[rt]) lastResults[rt] = {};
  lastResults[rt][tk] = result;

  return result;
}

// ── Tooltip builders ──────────────────────────────────────────────────────────

function buildTooltip(rows) {
  return rows.map(([label, value]) => {
    if (label === '__formula__') return `<div class="tt-formula">${value}</div>`;
    return `<div><span class="tt-label">${label}</span> <span class="tt-value">${value}</span></div>`;
  }).join('');
}

function r1Tooltip(r) {
  const refLabel = r.tier === 4 ? 'T3 Refined (HDV)'
    : (r.refinedInput.stacked ? 'Refined T-1 (stacked) ⬢' : 'Refined T-1 (HDV)');
  const refValue = fmt(r.refinedInput.cost);
  return buildTooltip([
    ['Raw price :', fmt(r.rawPrice)],
    ['Raws needed :', String(r.rec.r1)],
    [refLabel + ' :', refValue],
    ['RRR :', (r.rrr * 100).toFixed(1) + '%'],
    ['__formula__', `(${r.rec.r1} × ${fmt(r.rawPrice)} + ${refValue}) × (1 − ${(r.rrr * 100).toFixed(1)}%) = ${fmt(r.r1)}`],
  ]);
}

function r2Tooltip(r) {
  const refLabel = r.tier === 4 ? 'T3 Refined (HDV)'
    : (r.refinedInput.stacked ? 'Refined T-1 (stacked) ⬢' : 'Refined T-1 (HDV)');
  const refValue = fmt(r.refinedInput.cost);
  return buildTooltip([
    ['Raw price :', fmt(r.rawPrice)],
    ['Raws needed :', String(r.rec.r2)],
    [refLabel + ' :', refValue],
    ['City Heart :', fmt(r.heartPrice)],
    ['RRR :', (r.rrr * 100).toFixed(1) + '%'],
    ['__formula__', `(${r.rec.r2} × ${fmt(r.rawPrice)} + ${refValue} + ${fmt(r.heartPrice)}) × (1 − ${(r.rrr * 100).toFixed(1)}%) = ${fmt(r.r2)}`],
  ]);
}

function unitTooltip(r) {
  return buildTooltip([
    ['R1 cost :', fmt(r.r1)],
    ['R2 cost :', r.r2 !== null ? fmt(r.r2) : 'N/A (pristine .4)'],
    ['__formula__', `Unit invest = ${r.r2 !== null ? 'min(R1, R2)' : 'R1 only'} = ${fmt(r.unitInvest)} (${r.decision.toUpperCase()})`],
  ]);
}

function batchTooltip(r) {
  return buildTooltip([
    ['Unit invest :', fmt(r.unitInvest)],
    ['Qty produced :', String(qty)],
    ['__formula__', `${fmt(r.unitInvest)} × ${qty} = ${fmt(r.batchInvest)}`],
  ]);
}

function eqTooltip(r) {
  if (!useFocus) {
    return buildTooltip([
      ['Unit invest :', fmt(r.unitInvest)],
      ['Focus : OFF', ''],
      ['__formula__', `Equilibrium = Unit invest = ${fmt(r.equilibrium)}`],
    ]);
  }
  return buildTooltip([
    ['Unit invest :', fmt(r.unitInvest)],
    ['Focus cost :', r.focusCost + ' focus'],
    ['Cost per focus :', fmt(getPremiumPrice() / FOCUS_PER_MONTH) + ' silver'],
    ['Focus silver :', fmt(r.focusSilverCost)],
    ['__formula__', `${fmt(r.unitInvest)} + ${fmt(r.focusSilverCost)} = ${fmt(r.equilibrium)}`],
  ]);
}

function profitTooltip(r) {
  const sign = (r.profit != null && r.profit >= 0) ? '+' : '−';
  return buildTooltip([
    ['Bar HDV :', fmt(r.barHdv)],
    ['Tax :', (r.tax * 100).toFixed(1) + '%'],
    ['Sale after tax :', fmt(r.salePriceAfterTax)],
    ['Equilibrium :', fmt(r.equilibrium)],
    ['__formula__', `${fmt(r.salePriceAfterTax)} − ${fmt(r.equilibrium)} = ${sign}${fmt(Math.abs(r.profit ?? 0))}`],
  ]);
}

function spfTooltip(r) {
  if (r.spf == null) {
    return buildTooltip([
      ['Focus is OFF', ''],
      ['__formula__', 'SPF only meaningful with focus'],
    ]);
  }
  const sign = r.spf >= 0 ? '+' : '−';
  return buildTooltip([
    ['Profit :', (r.profit >= 0 ? '+' : '−') + fmt(Math.abs(r.profit))],
    ['Focus cost :', r.focusCost + ' focus'],
    ['__formula__', `${fmt(r.profit)} / ${r.focusCost} = ${sign}${fmt(Math.abs(r.spf))}`],
  ]);
}

// ── Render ────────────────────────────────────────────────────────────────────

function renderTable() {
  const tbody = document.getElementById('rfn-tbody');
  if (!tbody) return;

  const rt        = currentResource;
  const rDef      = RESOURCES[rt];
  const stackFromT = stackFromTier;
  let html = '';

  for (const tier of TIERS) {
    html += `<tr class="group-row t${tier}"><td colspan="12">Tier ${tier}</td></tr>`;

    for (const enchant of ENCHANTS) {
      const result   = computeRow(rt, tier, enchant, stackFromT);
      const itemId   = rDef.tiers[`T${tier}`].refined[enchant];
      const tk       = result.tierKey;
      const baseName = REFINED_NAMES[rt][tier];
      const itemName = enchant === 0 ? baseName : ENCHANT_PREFIXES[enchant] + baseName;

      const r1Cls     = result.decision === 'r1' ? ' best' : '';
      const r2Cls     = result.decision === 'r2' ? ' best' : '';
      const profitCls = result.profit != null
        ? (result.profit >= 0 ? ' profit-pos' : ' profit-neg') : ' muted';
      const spfCls    = result.spf != null
        ? (result.spf >= 0 ? ' profit-pos' : ' profit-neg') : ' muted';
      const stackBadge = result.refinedInput.stacked
        ? '<span class="stack-indicator" title="Refined input stacked from own refining">⬢</span>'
        : '';

      const manual     = manualBarPrices[rt]?.[tk];
      const overrideCls = manual != null ? ' overridden' : '';

      html += `<tr>
        <td><div class="item-cell">
          <img class="cat-item-icon" src="${getIconUrl(itemId)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'" />
          <span class="cat-item-name">${itemName}${stackBadge}</span>
        </div></td>
        <td style="text-align:center"><span class="cat-tier-tag">${tk}</span></td>
        <td class="num">${fmt(result.barHdv)}</td>
        <td class="col-manual"><input class="rfn-manual-input${overrideCls}" type="number" placeholder="—" value="${manual ?? ''}" data-rt="${rt}" data-tk="${tk}" /></td>
        <td class="num${r1Cls} has-tooltip">${fmt(result.r1)}<span class="tooltip">${r1Tooltip(result)}</span></td>
        <td class="num${result.r2 === null ? ' muted' : r2Cls} has-tooltip">${result.r2 === null ? '—' : fmt(result.r2)}<span class="tooltip">${result.r2 === null ? 'R2 not available for pristine (.4) enchants' : r2Tooltip(result)}</span></td>
        <td style="text-align:center"><span class="chip ${result.decision}">${result.decision.toUpperCase()}</span></td>
        <td class="num best has-tooltip">${fmt(result.unitInvest)}<span class="tooltip">${unitTooltip(result)}</span></td>
        <td class="num has-tooltip">${fmt(result.batchInvest)}<span class="tooltip">${batchTooltip(result)}</span></td>
        <td class="num has-tooltip">${fmt(result.equilibrium)}<span class="tooltip">${eqTooltip(result)}</span></td>
        <td class="num${profitCls} has-tooltip">${result.profit != null ? fmtSigned(result.profit) : '—'}<span class="tooltip">${profitTooltip(result)}</span></td>
        <td class="num${spfCls} has-tooltip">${result.spf != null ? fmtSigned(result.spf) : '—'}<span class="tooltip">${spfTooltip(result)}</span></td>
      </tr>`;
    }
  }

  tbody.innerHTML = html;

  tbody.querySelectorAll('.rfn-manual-input').forEach(input => {
    input.addEventListener('change', () => {
      const { rt: inputRt, tk: inputTk } = input.dataset;
      const val = input.value.trim();
      if (!manualBarPrices[inputRt]) manualBarPrices[inputRt] = {};
      if (val === '') {
        delete manualBarPrices[inputRt][inputTk];
        localStorage.removeItem(`refining.manual.${inputRt}.${inputTk}`);
        input.classList.remove('overridden');
      } else {
        const n = Number(val);
        manualBarPrices[inputRt][inputTk] = n;
        lsSet(`refining.manual.${inputRt}.${inputTk}`, n);
        input.classList.add('overridden');
      }
      renderTable();
    });
  });
}

// ── Heart display ─────────────────────────────────────────────────────────────

function updateHeartDisplay() {
  const info  = HEART_INFO[currentResource];
  const icon  = document.getElementById('rfn-heart-icon');
  const name  = document.getElementById('rfn-heart-name');
  const input = document.getElementById('rfn-heart-price');
  if (icon)  icon.src = getIconUrl(info.iconId);
  if (name)  name.textContent = info.name;
  if (input) input.value = getHeartPrice(currentResource);
}

// ── Focus / Stack UI ──────────────────────────────────────────────────────────

function updateFocusUI() {
  document.getElementById('rfn-focus-state-on')?.classList.toggle('on', useFocus);
  document.getElementById('rfn-focus-state-off')?.classList.toggle('on', !useFocus);
}

function updateStackUI() {
  document.getElementById('rfn-stack-state-on')?.classList.toggle('on', useStack);
  document.getElementById('rfn-stack-state-off')?.classList.toggle('on', !useStack);
  document.getElementById('rfn-stack-from-wrap')?.classList.toggle('disabled', !useStack);
}

// ── Refresh ───────────────────────────────────────────────────────────────────

async function doRefresh() {
  const btn = document.getElementById('rfn-refresh-btn');
  if (btn) { btn.disabled = true; btn.textContent = '…'; }

  try {
    clearCache();
    apiPrices = await fetchPricesForResource(currentResource, [currentCity]);
  } catch (err) {
    console.error('[refining] fetch error:', err);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '↻ Refresh'; }
  }

  renderTable();
}

// ── Init ──────────────────────────────────────────────────────────────────────

export async function initRefining() {
  loadState();

  // Resource pills
  const pills = document.querySelectorAll('.rfn-resource-pill');
  pills.forEach(pill => {
    pill.classList.toggle('on', pill.dataset.resource === currentResource);
    pill.addEventListener('click', () => {
      pills.forEach(p => p.classList.remove('on'));
      pill.classList.add('on');
      currentResource = pill.dataset.resource;
      lsSet('refining.resource', currentResource);
      updateHeartDisplay();
      doRefresh();
    });
  });

  // City select
  const cityEl = document.getElementById('rfn-city');
  if (cityEl) {
    cityEl.value = currentCity;
    cityEl.addEventListener('change', () => {
      currentCity = cityEl.value;
      lsSet('refining.city', currentCity);
      doRefresh();
    });
  }

  // Heart price (writes to cat_heart_ key so Catalogue tab shares the same value)
  const heartInput = document.getElementById('rfn-heart-price');
  if (heartInput) {
    heartInput.addEventListener('change', () => {
      const val = parseInt(heartInput.value) || 0;
      localStorage.setItem(`cat_heart_${currentResource}`, String(val));
      renderTable();
    });
  }

  // Focus toggle
  const focusToggle = document.getElementById('rfn-focus-toggle');
  if (focusToggle) {
    focusToggle.checked = useFocus;
    updateFocusUI();
    focusToggle.addEventListener('change', () => {
      useFocus = focusToggle.checked;
      lsSet('refining.useFocus', useFocus ? '1' : '0');
      updateFocusUI();
      renderTable();
    });
  }

  // Stack toggle
  const stackToggle = document.getElementById('rfn-stack-toggle');
  if (stackToggle) {
    stackToggle.checked = useStack;
    updateStackUI();
    stackToggle.addEventListener('change', () => {
      useStack = stackToggle.checked;
      lsSet('refining.useStack', useStack ? '1' : '0');
      updateStackUI();
      renderTable();
    });
  }

  // Stack from
  const stackFromEl = document.getElementById('rfn-stack-from');
  if (stackFromEl) {
    stackFromEl.value = String(stackFromTier);
    stackFromEl.addEventListener('change', () => {
      stackFromTier = parseInt(stackFromEl.value);
      lsSet('refining.stackFromTier', stackFromTier);
      renderTable();
    });
  }

  // Qty
  const qtyEl = document.getElementById('rfn-qty');
  if (qtyEl) {
    qtyEl.value = qty;
    qtyEl.addEventListener('change', () => {
      qty = parseInt(qtyEl.value) || 100;
      lsSet('refining.qty', qty);
      renderTable();
    });
  }

  // Tax
  const taxEl = document.getElementById('rfn-tax');
  if (taxEl) {
    taxEl.value = taxRate;
    const applyTax = () => {
      const n = parseFloat(taxEl.value);
      taxRate = isNaN(n) ? 3 : n;
      lsSet('refining.tax', taxRate);
      renderTable();
    };
    taxEl.addEventListener('input', applyTax);
    taxEl.addEventListener('change', applyTax);
  }

  // Refresh button
  document.getElementById('rfn-refresh-btn')?.addEventListener('click', doRefresh);

  window.addEventListener('forge:prices-changed', () => renderTable());

  updateHeartDisplay();
  await doRefresh();
}

// ── Public API ────────────────────────────────────────────────────────────────

export function getBestRecipeDecision(resource, tk) {
  const result = lastResults[resource]?.[tk];
  if (!result) return null;
  if (result.enchant === 4) return 'r1';
  return result.decision;
}

export function getUnitInvest(resource, tk) {
  return lastResults[resource]?.[tk]?.unitInvest ?? null;
}

export function getRefiningResult(resource, tk) {
  return lastResults[resource]?.[tk] ?? null;
}
