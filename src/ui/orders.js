import { RESOURCES, getIconUrl, T3_REFINED_IDS } from '../data/items.js';
import { ARTIFACT_NAMES } from '../data/artifactNames.js';
import { fetchPricesForResource, fetchPrices }     from '../api/albionApi.js';
import { getEffectiveRawPrice, getAcquisitionChain } from './transmute.js';
import { getHeartPrice, getPremiumPrice, getFocusCost, getCostPerFocus } from './catalogue.js';
import { getManualRefinedPrice } from './refining.js';
import { getItems as fsGetItems, removePin, updatePin, clearAll as fsClearAll, clearDone as fsClearDone } from '../logic/flipSession.js';
import { getItems as csGetItems, removePin as csRemovePin, updatePin as csUpdatePin, clearAll as csClearAll, clearDone as csClearDone } from '../logic/craftSession.js';
import { calcCraftRow, DEFAULT_CRR_NO_FOCUS, DEFAULT_CRR_FOCUS } from '../logic/crafting.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const RECIPES = { 4:{r1:2,r2:1}, 5:{r1:3,r2:2}, 6:{r1:4,r2:3}, 7:{r1:5,r2:4}, 8:{r1:5,r2:4} };
const RRR_NO_FOCUS = 0.367;
const RRR_FOCUS    = 0.539;
const TAX          = 0.03;

const REFINED_NAMES = {
  ORE:   { 4:'Steel Bar',        5:'Titanium Steel Bar', 6:'Runite Steel Bar',   7:'Meteorite Steel Bar',  8:'Adamantium Steel Bar'  },
  WOOD:  { 4:'Birch Planks',     5:'Chestnut Planks',    6:'Pine Planks',        7:'Cedar Planks',         8:'Bloodoak Planks'       },
  FIBER: { 4:'Simple Cloth',     5:'Neat Cloth',         6:'Fine Cloth',         7:'Ornate Cloth',         8:'Lavish Cloth'          },
  HIDE:  { 4:'Worked Leather',   5:'Cured Leather',      6:'Hardened Leather',   7:'Reinforced Leather',   8:'Fortified Leather'     },
};

const RAW_NAMES = {
  ORE:   { 4:'Iron Ore',    5:'Titanium Ore',  6:'Runite Ore',    7:'Meteorite Ore', 8:'Adamantium Ore' },
  WOOD:  { 4:'Birch Logs',  5:'Chestnut Logs', 6:'Pine Logs',     7:'Cedar Logs',    8:'Bloodoak Logs'  },
  FIBER: { 4:'Cotton',      5:'Flax',          6:'Hemp',          7:'Skyflower',     8:'Redleaf Cotton' },
  HIDE:  { 4:'Medium Hide', 5:'Heavy Hide',    6:'Robust Hide',   7:'Thick Hide',    8:'Resilient Hide' },
};

const ENCHANT_PREFIXES = ['', 'Uncommon ', 'Rare ', 'Exceptional ', 'Pristine '];
const RESOURCE_EMOJIS  = { ORE:'⛏', WOOD:'🪵', FIBER:'🌿', HIDE:'🐾' };
const HEART_IDS   = { ORE:'T1_FACTION_MOUNTAIN_TOKEN_1', WOOD:'T1_FACTION_FOREST_TOKEN_1', FIBER:'T1_FACTION_SWAMP_TOKEN_1', HIDE:'T1_FACTION_STEPPE_TOKEN_1' };
const HEART_NAMES = { ORE:'Mountainheart', WOOD:'Treeheart', FIBER:'Vineheart', HIDE:'Beastheart' };

const BAR_TO_RSS = { METALBAR:'ORE', PLANKS:'WOOD', CLOTH:'FIBER', LEATHER:'HIDE' };

// ── State ─────────────────────────────────────────────────────────────────────

let orders       = [];
let editingId    = null;
let ordApiPrices = {}; // itemId → city → { sell_price_min }

// ── Helpers ───────────────────────────────────────────────────────────────────

function tierLabel(tier, enchant) {
  return enchant === 0 ? `T${tier}` : `T${tier}.${enchant}`;
}

function refinedName(rss, tier, enchant) {
  return ENCHANT_PREFIXES[enchant] + REFINED_NAMES[rss][tier];
}

function rawName(rss, tier, enchant) {
  return ENCHANT_PREFIXES[enchant] + RAW_NAMES[rss][tier];
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

function buildTooltip(rows, extraClass = '') {
  const inner = rows.map(([label, value]) => {
    if (label === '__formula__') return '<div class="tt-formula">' + value + '</div>';
    return '<div><span class="tt-label">' + label + '</span> <span class="tt-value">' + value + '</span></div>';
  }).join('');
  return '<span class="tooltip ' + extraClass + '">' + inner + '</span>';
}

function activeCity() {
  return localStorage.getItem('refining.city') || 'Thetford';
}

function getOrdPrice(itemId) {
  return ordApiPrices[itemId]?.[activeCity()]?.sell_price_min ?? null;
}

// Checks Refining's manual refined-resource price overrides first, then falls back to the Orders API cache.
function getBarPrice(rss, tier, enchant) {
  const tk     = tierLabel(tier, enchant);
  const manual = getManualRefinedPrice(rss, tk);
  if (manual != null) return manual;
  const itemId = RESOURCES[rss].tiers[`T${tier}`].refined[enchant];
  return getOrdPrice(itemId);
}

// ── Price fetch ───────────────────────────────────────────────────────────────

async function doRefresh() {
  const btn = document.getElementById('ord-refresh-btn');
  if (btn) { btn.disabled = true; btn.textContent = '…'; }

  const resources = [...new Set(orders.map(o => o.rss))];
  if (!resources.length) {
    if (btn) { btn.disabled = false; btn.textContent = '↻ Refresh prices'; }
    return;
  }

  try {
    const city    = activeCity();
    const results = await Promise.all(resources.map(rss => fetchPricesForResource(rss, [city])));
    ordApiPrices  = Object.assign({}, ...results);
  } catch (err) {
    console.error('[orders] fetch error:', err);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '↻ Refresh prices'; }
  }

  rebuildAll();
}

// ── Calculation ───────────────────────────────────────────────────────────────

function getRefinedInput(rss, tier, enchant, qty, useFocus, useStack, stackFromTier) {
  if (tier <= 4) {
    return { cost: getOrdPrice(T3_REFINED_IDS[rss]) ?? 0, stacked: false, subResult: null };
  }
  const rrr = useFocus ? RRR_FOCUS : RRR_NO_FOCUS;
  if (useStack && tier > stackFromTier) {
    const subQty   = Math.ceil(qty * (1 - rrr)) + 2;
    const subOrder = { id: null, rss, tier: tier - 1, enchant, tierKey: tierLabel(tier - 1, enchant), qty: subQty, useFocus, useStack, stackFromTier };
    const sub      = computeOrderResult(subOrder);
    return { cost: sub.unitCost, stacked: true, subResult: sub };
  }
  return { cost: getBarPrice(rss, tier - 1, enchant) ?? 0, stacked: false, subResult: null };
}

function computeOrderResult(order) {
  const { rss, tier, enchant, qty, useFocus, useStack, stackFromTier } = order;
  const tk  = tierLabel(tier, enchant);
  const rec = RECIPES[tier];
  const rrr = useFocus ? RRR_FOCUS : RRR_NO_FOCUS;

  let rawPrice = getEffectiveRawPrice(rss, tk);
  if (rawPrice == null) {
    const rawItemId = RESOURCES[rss].tiers[`T${tier}`].raw[enchant];
    rawPrice = getOrdPrice(rawItemId) ?? 0;
  }

  const refinedInput = getRefinedInput(rss, tier, enchant, qty, useFocus, useStack, stackFromTier);
  const heartPrice   = getHeartPrice(rss);

  const r1Cost      = (rec.r1 * rawPrice + refinedInput.cost) * (1 - rrr);
  const r2Available = enchant !== 4;
  const r2Cost      = r2Available ? (rec.r2 * rawPrice + refinedInput.cost + heartPrice) * (1 - rrr) : null;

  const decision = (r2Available && r2Cost < r1Cost) ? 'r2' : 'r1';
  const unitCost = decision === 'r2' ? r2Cost : r1Cost;

  const rawsNeeded       = Math.ceil(rec[decision] * qty * (1 - rrr)) + 3;
  const lowerInputNeeded = Math.ceil(qty * (1 - rrr)) + 2;
  const heartsNeeded     = decision === 'r2' ? Math.ceil(qty * (1 - rrr)) + 2 : 0;

  const barHdv = getBarPrice(rss, tier, enchant);
  const revenue   = barHdv != null ? barHdv * (1 - TAX) * qty : null;
  const profit    = revenue != null ? revenue - unitCost * qty : null;

  return {
    order, rec, tk, rawPrice, heartPrice,
    refinedInput, inputCost: refinedInput.cost,
    r1Cost, r2Cost, r2Available, decision, unitCost,
    rawsNeeded, lowerInputNeeded, heartsNeeded, rrr,
    totalInvest: unitCost * qty,
    barHdv, revenue, profit, qty,
  };
}

// ── Bill building ─────────────────────────────────────────────────────────────

function buildBillMaps(results) {
  const buyMap    = {};  // key → { itemId, name, qty, unitPrice, type }
  const trmMap    = {};  // key → transmutation step with aggregated qty
  const refineMap = {};  // key → { itemId, rss, tierKey, name, qty, decision, focus }
  const heartMap  = {};  // rss → { name, itemId, qty, unitPrice }

  function addBuy(key, itemId, name, qty, unitPrice, type, tierKey = '') {
    if (!buyMap[key]) buyMap[key] = { itemId, name, qty: 0, unitPrice, type, tierKey };
    buyMap[key].qty += qty;
  }

  function addRaw(rss, tier, enchant, rawsNeeded) {
    const { hdvBuy, steps } = getAcquisitionChain(rss, tier, enchant);

    const hdvItemId = RESOURCES[rss].tiers[`T${hdvBuy.tier}`].raw[hdvBuy.enchant];
    const hdvPrice  = getEffectiveRawPrice(rss, hdvBuy.tierKey) ?? getOrdPrice(hdvItemId) ?? 0;
    addBuy(`${rss}::${hdvItemId}`, hdvItemId, rawName(rss, hdvBuy.tier, hdvBuy.enchant), rawsNeeded, hdvPrice, 'raw', tierLabel(hdvBuy.tier, hdvBuy.enchant));

    for (const step of steps) {
      const srcItemId = RESOURCES[rss].tiers[`T${step.from.tier}`].raw[step.from.enchant];
      const dstItemId = RESOURCES[rss].tiers[`T${step.to.tier}`].raw[step.to.enchant];
      const k = `${rss}::${step.from.tierKey}→${step.to.tierKey}`;
      if (!trmMap[k]) trmMap[k] = {
        rss,
        srcTk: step.from.tierKey, srcTier: step.from.tier, srcEnchant: step.from.enchant, srcItemId,
        dstTk: step.to.tierKey,   dstTier: step.to.tier,   dstEnchant: step.to.enchant,   dstItemId,
        via: step.via,
        silverCostPerUnit: step.silverCost,
        qty: 0,
      };
      trmMap[k].qty += rawsNeeded;
    }
  }

  function walk(result) {
    const { order, tk, rawsNeeded, lowerInputNeeded, heartsNeeded, decision } = result;
    const { rss, tier, enchant } = order;

    addRaw(rss, tier, enchant, rawsNeeded);

    const refItemId = RESOURCES[rss].tiers[`T${tier}`].refined[enchant];
    const refKey    = `${rss}::${tk}::${decision}`;
    if (!refineMap[refKey]) refineMap[refKey] = {
      itemId: refItemId, rss, tierKey: tk,
      name: refinedName(rss, tier, enchant),
      qty: 0, decision, focus: order.useFocus,
    };
    refineMap[refKey].qty += order.qty;

    if (heartsNeeded > 0) {
      if (!heartMap[rss]) heartMap[rss] = { name: HEART_NAMES[rss], itemId: HEART_IDS[rss], qty: 0, unitPrice: getHeartPrice(rss) };
      heartMap[rss].qty += heartsNeeded;
    }

    if (tier === 4) {
      const t3Id = T3_REFINED_IDS[rss];
      addBuy(`${rss}::T3::ref`, t3Id, `T3 ${RESOURCES[rss].refinedLabel}`, lowerInputNeeded, getOrdPrice(t3Id) ?? 0, 'refined', 'T3');
    } else if (result.refinedInput.stacked && result.refinedInput.subResult) {
      walk(result.refinedInput.subResult);
    } else {
      const lowerRefId = RESOURCES[rss].tiers[`T${tier - 1}`].refined[enchant];
      addBuy(`${rss}::${lowerRefId}::lower`, lowerRefId, refinedName(rss, tier - 1, enchant), lowerInputNeeded, result.inputCost, 'refined', tierLabel(tier - 1, enchant));
    }
  }

  results.forEach(r => walk(r));
  return { buyMap, transmutes: Object.values(trmMap), refineMap, heartMap };
}

function buildBill() {
  const orderResults  = orders.map(computeOrderResult);
  const bill          = buildBillMaps(orderResults);
  let totalInvest = 0, totalRevenue = 0, totalProfit = 0;
  orderResults.forEach(r => {
    totalInvest += r.totalInvest;
    if (r.revenue != null) totalRevenue += r.revenue;
    if (r.profit  != null) totalProfit  += r.profit;
  });
  return { orderResults, ...bill, totalInvest, totalRevenue, totalProfit };
}

function buildCraftBill(pinItems) {
  const active = pinItems.filter(i => !i.done);
  const buyMap = {};
  const pseudoResults = [];

  function addDirect(key, itemId, name, qty, unitPrice, type, tierKey = '') {
    if (!buyMap[key]) buyMap[key] = { itemId, name, qty: 0, unitPrice, type, tierKey };
    buyMap[key].qty += qty;
  }

  for (const pin of active) {
    for (const mat of pin.mats) {
      const totalQty = mat.qtyPerCraft * pin.qty;
      if (mat.buyCity) {
        const rss  = BAR_TO_RSS[mat.rssKey];
        const name = rss ? refinedName(rss, pin.tier, pin.enchant) : (mat.itemId ?? mat.rssKey);
        addDirect(`direct::${mat.itemId}`, mat.itemId, name, totalQty, mat.unitPrice, 'refined bar', tierLabel(pin.tier, pin.enchant));
      } else {
        const rss = BAR_TO_RSS[mat.rssKey];
        if (!rss) continue;
        pseudoResults.push(computeOrderResult({
          id: null, rss, tier: pin.tier, enchant: pin.enchant,
          tierKey: tierLabel(pin.tier, pin.enchant),
          qty: totalQty, useFocus: pin.useFocus,
          useStack: false, stackFromTier: 7,
        }));
      }
    }
    if (pin.artifact) {
      const baseId = pin.artifact.itemId.replace(/^T\d+_ARTEFACT_/, '');
      const name   = ARTIFACT_NAMES[baseId] ?? baseId.replace(/_/g, ' ');
      addDirect(`art::${pin.artifact.itemId}`, pin.artifact.itemId, name, pin.qty, pin.artifact.unitPrice, 'artifact', `T${pin.tier}`);
    }
  }

  const refBill = buildBillMaps(pseudoResults);

  for (const [key, val] of Object.entries(refBill.buyMap)) {
    if (buyMap[key]) {
      buyMap[key].qty += val.qty;
    } else {
      buyMap[key] = val;
    }
  }

  return { buyMap, transmutes: refBill.transmutes, refineMap: refBill.refineMap, heartMap: refBill.heartMap };
}

function craftBillHtml(bill) {
  const { buyMap, transmutes, refineMap, heartMap } = bill;
  const iconUrl = id => `https://render.albiononline.com/v1/item/${id}.png?size=64`;

  // Shopping bill
  const buyItems = Object.values(buyMap);
  let buyHtml;
  if (!buyItems.length) {
    buyHtml = '<div class="bill-empty">— No items to buy —</div>';
  } else {
    const totalShoppingCost = buyItems.reduce((s, b) => s + b.qty * b.unitPrice, 0);
    const rows = buyItems.map(b => `<div class="bill-row has-tooltip">
        <img class="bill-icon" src="${iconUrl(b.itemId)}" onerror="retryIcon(this,'display')" />
        <div class="bill-name">${b.name}${b.tierKey ? ` <span class="bill-tier-tag">${b.tierKey}</span>` : ''}
          <div class="bill-name-sub">${b.type}</div>
        </div>
        <div style="text-align:right">
          <div class="bill-qty">×${fmt(b.qty)}</div>
          <div class="bill-cost">${fmt(b.qty * b.unitPrice)} silver</div>
        </div>
        ${buildTooltip([
          ['Type',       b.type],
          ['Quantity',   fmt(b.qty)],
          ['Unit price', fmt(b.unitPrice)],
          ['__formula__','qty × unitPrice'],
        ], 'left')}</div>`);
    rows.push(`<div class="bill-focus-total"><span>Total shopping cost</span><span><strong>${fmt(totalShoppingCost)} silver</strong></span></div>`);
    buyHtml = rows.join('');
  }

  // Transmutations
  const trmSorted = [...transmutes].sort((a, b) =>
    a.dstTier !== b.dstTier ? a.dstTier - b.dstTier : a.dstEnchant - b.dstEnchant);
  let trmHtml;
  if (!trmSorted.length) {
    trmHtml = '<div class="bill-empty">— No transmutes needed —</div>';
  } else {
    const totalTransmuteCost = trmSorted.reduce((s, t) => s + t.qty * t.silverCostPerUnit, 0);
    const rows = trmSorted.map(t => {
      const badgeLabel  = t.via === 'r1' ? 'R1 (T-1)' : 'R2 (E-1)';
      const totalSilver = t.qty * t.silverCostPerUnit;
      return `<div class="bill-row has-tooltip">
          <div class="bill-trm-icons">
            <img class="bill-icon" src="${iconUrl(t.srcItemId)}" onerror="retryIcon(this,'display')" />
            <span class="bill-trm-arrow">→</span>
            <img class="bill-icon" src="${iconUrl(t.dstItemId)}" onerror="retryIcon(this,'display')" />
          </div>
          <div class="bill-name">
            ${rawName(t.rss, t.srcTier, t.srcEnchant)} <span class="bill-tier-tag">${t.srcTk}</span> → ${rawName(t.rss, t.dstTier, t.dstEnchant)} <span class="bill-tier-tag">${t.dstTk}</span>
            <div class="bill-name-sub"><span class="chip ${t.via}">${badgeLabel}</span></div>
          </div>
          <div style="text-align:right">
            <div class="bill-qty">×${fmt(t.qty)}</div>
            <div class="bill-cost">${totalSilver > 0 ? fmt(totalSilver) + ' silver' : '—'}</div>
          </div>
          ${buildTooltip([
            ['From',        rawName(t.rss, t.srcTier, t.srcEnchant)],
            ['To',          rawName(t.rss, t.dstTier, t.dstEnchant)],
            ['Via',         t.via === 'r1' ? 'R1 (T-1)' : 'R2 (E-1)'],
            ['Quantity',    fmt(t.qty)],
            ['Silver/unit', t.silverCostPerUnit > 0 ? fmt(t.silverCostPerUnit) : '0 (free, focus only)'],
            ['__formula__', t.silverCostPerUnit > 0
              ? 'qty × silverCost = ' + fmt(t.qty * t.silverCostPerUnit)
              : 'No silver cost (focus-paid step)'],
          ], 'left')}
        </div>`;
    });
    rows.push(`<div class="bill-focus-total"><span>Total transmute cost</span><span><strong>${fmt(totalTransmuteCost)} silver</strong></span></div>`);
    trmHtml = rows.join('');
  }

  // Refining recipes
  const refItems = Object.values(refineMap);
  const refHtml = refItems.length
    ? refItems.map(r => `<div class="bill-row has-tooltip">
        <img class="bill-icon" src="${iconUrl(r.itemId)}" onerror="retryIcon(this,'display')" />
        <div class="bill-name">${r.name} <span class="bill-tier-tag">${r.tierKey}</span>
          <div class="bill-name-sub">${r.decision === 'r2' ? 'with city heart' : 'no heart'} · ${r.focus ? 'focus' : 'no focus'}</div>
        </div>
        <div style="text-align:right">
          <div class="bill-qty">×${fmt(r.qty)}</div>
          <div class="bill-cost">recipe ${r.decision.toUpperCase()}</div>
        </div>
        ${buildTooltip([
          ['Tier',           r.tierKey],
          ['Recipe',         r.decision === 'r2' ? 'R2 (with city heart)' : 'R1 (no heart)'],
          ['Focus',          r.focus ? 'ON' : 'OFF'],
          ['Qty to produce', fmt(r.qty)],
        ], 'left')}</div>`).join('')
    : '<div class="bill-empty">— No recipes —</div>';

  // City Hearts
  const heartItems = Object.values(heartMap);
  const heartHtml = heartItems.length
    ? heartItems.map(h => `<div class="bill-row has-tooltip">
        <img class="bill-icon" src="${iconUrl(h.itemId)}" onerror="retryIcon(this,'display')" />
        <div class="bill-name">${h.name}</div>
        <div style="text-align:right">
          <div class="bill-qty">×${fmt(h.qty)}</div>
          <div class="bill-cost">${fmt(h.qty * h.unitPrice)} silver</div>
        </div>
        ${buildTooltip([
          ['Quantity',   fmt(h.qty)],
          ['Unit price', fmt(h.unitPrice)],
          ['__formula__','qty × unitPrice'],
        ], 'left')}</div>`).join('')
    : '<div class="bill-empty">— None (no R2 recipes) —</div>';

  return `
    <div class="bill-section"><div class="bill-title">📋 Shopping bill</div>${buyHtml}</div>
    <div class="bill-section"><div class="bill-title">🔄 Transmutations</div>${trmHtml}</div>
    <div class="bill-section"><div class="bill-title">🔥 Refining recipes</div>${refHtml}</div>
    <div class="bill-section"><div class="bill-title">💎 City Hearts</div>${heartHtml}</div>
  `;
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function renderOrdersList(orderResults) {
  const list    = document.getElementById('ord-orders-list');
  const countEl = document.getElementById('ord-count');
  if (!list) return;

  if (countEl) countEl.textContent = orders.length === 1 ? '1 order' : `${orders.length} orders`;

  if (orders.length === 0) {
    list.innerHTML = `<div class="ord-empty">No orders yet<div class="ord-empty-hint">Click <strong>+ Add order</strong> to add items</div></div>`;
    return;
  }

  list.innerHTML = orderResults.map(r => {
    const o         = r.order;
    const profitCls = r.profit != null ? (r.profit >= 0 ? 'profit-pos' : 'profit-neg') : '';
    const refItemId = RESOURCES[o.rss].tiers[`T${o.tier}`].refined[o.enchant];
    const focusBadge = o.useFocus
      ? `<span class="cfg-badge focus-on">⚡ Focus</span>`
      : `<span class="cfg-badge focus-off">No focus</span>`;
    const stackBadge = o.useStack
      ? `<span class="cfg-badge stack-on">⬢ Stack T${o.stackFromTier}</span>`
      : `<span class="cfg-badge stack-off">No stack</span>`;

    const inputTier   = o.tier === 4 ? 3 : o.tier - 1;
    const inputSource = o.tier === 4 ? 'T3 input' : (r.refinedInput.stacked ? 'stacked ⬢' : 'HDV');
    const rrrPct      = (r.rrr * 100).toFixed(1) + '%';
    const recipeDesc  = r.decision === 'r2'
      ? 'R2 (' + r.rec.r2 + ' raws + 1 input + ♥)'
      : 'R1 (' + r.rec.r1 + ' raws + 1 input)';
    const ttUnitCost = buildTooltip([
      ['Recipe',                recipeDesc],
      ['Raw price',             fmt(r.rawPrice)],
      ['Refined T' + inputTier, fmt(r.inputCost) + ' (' + inputSource + ')'],
      ...(r.decision === 'r2' ? [['City Heart', fmt(r.heartPrice)]] : []),
      ['RRR',                   rrrPct],
      ['__formula__', r.decision === 'r2'
        ? '(' + r.rec.r2 + '×raw + input + ♥) × (1−RRR)'
        : '(' + r.rec.r1 + '×raw + input) × (1−RRR)'],
    ]);
    const ttInvest = buildTooltip([
      ['Unit cost',   fmt(r.unitCost)],
      ['Quantity',    String(o.qty)],
      ['__formula__', 'unitCost × qty'],
    ]);
    const saleAfterTax  = r.barHdv != null ? r.barHdv * (1 - TAX) : null;
    const profitPerUnit = saleAfterTax != null ? saleAfterTax - r.unitCost : null;
    const ttProfit = buildTooltip([
      ['Refined HDV',    fmt(r.barHdv)],
      ['Tax',            Math.round(TAX * 100) + '%'],
      ['Sale after tax', fmt(saleAfterTax)],
      ['Unit cost',      fmt(r.unitCost)],
      ['Profit/unit',    fmt(profitPerUnit)],
      ['Quantity',       String(o.qty)],
      ['__formula__',    '(sale − unitCost) × qty'],
    ]);

    return `<div class="order-item">
      <img class="order-icon" src="${getIconUrl(refItemId)}" onerror="retryIcon(this,'display')" />
      <div class="order-info">
        <div class="order-name-row">
          <span class="order-name">${refinedName(o.rss, o.tier, o.enchant)}</span>
          <span class="ord-tier-tag">${r.tk}</span>
          ${focusBadge}${stackBadge}
        </div>
        <div class="order-detail">${RESOURCE_EMOJIS[o.rss]} ${r.tk} · recipe ${r.decision.toUpperCase()}</div>
      </div>
      <div class="order-qty">×${o.qty}</div>
      <div class="order-stat has-tooltip"><span class="label">Unit cost</span><span class="val">${fmt(r.unitCost)}</span>${ttUnitCost}</div>
      <div class="order-stat has-tooltip"><span class="label">Invest</span><span class="val">${fmt(r.totalInvest)}</span>${ttInvest}</div>
      <div class="order-stat ${profitCls} has-tooltip"><span class="label">Profit</span><span class="val">${r.profit != null ? fmtSigned(r.profit) : '—'}</span>${ttProfit}</div>
      <div class="order-actions">
        <button class="icon-btn" data-action="edit" data-id="${o.id}" title="Edit">✎</button>
        <button class="icon-btn delete" data-action="delete" data-id="${o.id}" title="Remove">×</button>
      </div>
    </div>`;
  }).join('');

  list.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = parseFloat(btn.dataset.id);
      if (btn.dataset.action === 'edit') openModal(orders.find(o => o.id === id));
      else deleteOrder(id);
    });
  });
}

function renderBill(bill) {
  const { orderResults, buyMap, transmutes, refineMap, heartMap, totalInvest, totalRevenue, totalProfit } = bill;
  const iconUrl = id => `https://render.albiononline.com/v1/item/${id}.png?size=64`;

  // Shopping bill
  const buyEl = document.getElementById('ord-bill-buy');
  if (buyEl) {
    const items = Object.values(buyMap);
    if (!items.length) {
      buyEl.innerHTML = '<div class="bill-empty">— No items to buy —</div>';
    } else {
      const totalShoppingCost = items.reduce((sum, b) => sum + b.qty * b.unitPrice, 0);
      const rows = items.map(b => `<div class="bill-row has-tooltip">
          <img class="bill-icon" src="${iconUrl(b.itemId)}" onerror="retryIcon(this,'display')" />
          <div class="bill-name">${b.name}${b.tierKey ? ` <span class="bill-tier-tag">${b.tierKey}</span>` : ''}<div class="bill-name-sub">${b.type}</div></div>
          <div style="text-align:right">
            <div class="bill-qty">×${fmt(b.qty)}</div>
            <div class="bill-cost">${fmt(b.qty * b.unitPrice)} silver</div>
          </div>
          ${buildTooltip([
            ['Type',        b.type],
            ['Quantity',    fmt(b.qty)],
            ['Unit price',  fmt(b.unitPrice)],
            ['__formula__', 'qty × unitPrice'],
          ], 'left')}</div>`);
      rows.push(`<div class="bill-focus-total">
        <span>Total shopping cost</span>
        <span><strong>${fmt(totalShoppingCost)} silver</strong></span>
      </div>`);
      buyEl.innerHTML = rows.join('');
    }
  }

  // Transmutations — sorted by destination tier then enchant
  const trmEl = document.getElementById('ord-bill-transmute');
  if (trmEl) {
    const items = [...transmutes].sort((a, b) =>
      a.dstTier !== b.dstTier ? a.dstTier - b.dstTier : a.dstEnchant - b.dstEnchant
    );
    if (!items.length) {
      trmEl.innerHTML = '<div class="bill-empty">— No transmutes needed —</div>';
    } else {
      const totalTransmuteCost = items.reduce((sum, t) => sum + t.qty * t.silverCostPerUnit, 0);
      const rows = items.map(t => {
        const badgeLabel  = t.via === 'r1' ? 'R1 (T-1)' : 'R2 (E-1)';
        const totalSilver = t.qty * t.silverCostPerUnit;
        return `<div class="bill-row has-tooltip">
            <div class="bill-trm-icons">
              <img class="bill-icon" src="${iconUrl(t.srcItemId)}" onerror="retryIcon(this,'display')" />
              <span class="bill-trm-arrow">→</span>
              <img class="bill-icon" src="${iconUrl(t.dstItemId)}" onerror="retryIcon(this,'display')" />
            </div>
            <div class="bill-name">
              ${rawName(t.rss, t.srcTier, t.srcEnchant)} <span class="bill-tier-tag">${t.srcTk}</span> → ${rawName(t.rss, t.dstTier, t.dstEnchant)} <span class="bill-tier-tag">${t.dstTk}</span>
              <div class="bill-name-sub"><span class="chip ${t.via}">${badgeLabel}</span></div>
            </div>
            <div style="text-align:right">
              <div class="bill-qty">×${fmt(t.qty)}</div>
              <div class="bill-cost">${totalSilver > 0 ? fmt(totalSilver) + ' silver' : '—'}</div>
            </div>
            ${buildTooltip([
              ['From',        rawName(t.rss, t.srcTier, t.srcEnchant)],
              ['To',          rawName(t.rss, t.dstTier, t.dstEnchant)],
              ['Via',         t.via === 'r1' ? 'R1 (T-1)' : 'R2 (E-1)'],
              ['Quantity',    fmt(t.qty)],
              ['Silver/unit', t.silverCostPerUnit > 0 ? fmt(t.silverCostPerUnit) : '0 (free, focus only)'],
              ['__formula__', t.silverCostPerUnit > 0
                ? 'qty × silverCost = ' + fmt(t.qty * t.silverCostPerUnit)
                : 'No silver cost (focus-paid step)'],
            ], 'left')}
          </div>`;
      });
      rows.push(`<div class="bill-focus-total">
        <span>Total transmute cost</span>
        <span><strong>${fmt(totalTransmuteCost)} silver</strong></span>
      </div>`);
      trmEl.innerHTML = rows.join('');
    }
  }

  // Refining recipes
  const refEl = document.getElementById('ord-bill-refine');
  if (refEl) {
    const items = Object.values(refineMap);
    refEl.innerHTML = items.length
      ? items.map(r => `<div class="bill-row has-tooltip">
          <img class="bill-icon" src="${iconUrl(r.itemId)}" onerror="retryIcon(this,'display')" />
          <div class="bill-name">${r.name} <span class="bill-tier-tag">${r.tierKey}</span><div class="bill-name-sub">${r.decision === 'r2' ? 'with city heart' : 'no heart'} · ${r.focus ? 'focus' : 'no focus'}</div></div>
          <div style="text-align:right">
            <div class="bill-qty">×${fmt(r.qty)}</div>
            <div class="bill-cost">recipe ${r.decision.toUpperCase()}</div>
          </div>
          ${buildTooltip([
            ['Tier',           r.tierKey],
            ['Recipe',         r.decision === 'r2' ? 'R2 (with city heart)' : 'R1 (no heart)'],
            ['Focus',          r.focus ? 'ON' : 'OFF'],
            ['Qty to produce', fmt(r.qty)],
          ], 'left')}</div>`).join('')
      : '<div class="bill-empty">— No recipes —</div>';
  }

  // City Hearts
  const heartsEl = document.getElementById('ord-bill-hearts');
  if (heartsEl) {
    const items = Object.values(heartMap);
    heartsEl.innerHTML = items.length
      ? items.map(h => `<div class="bill-row has-tooltip">
          <img class="bill-icon" src="${iconUrl(h.itemId)}" onerror="retryIcon(this,'display')" />
          <div class="bill-name">${h.name}</div>
          <div style="text-align:right">
            <div class="bill-qty">×${fmt(h.qty)}</div>
            <div class="bill-cost">${fmt(h.qty * h.unitPrice)} silver</div>
          </div>
          ${buildTooltip([
            ['Quantity',   fmt(h.qty)],
            ['Unit price', fmt(h.unitPrice)],
            ['__formula__', 'qty × unitPrice'],
          ], 'left')}</div>`).join('')
      : '<div class="bill-empty">— None (no R2 recipes) —</div>';
  }

  // Focus Cost
  const focusEl = document.getElementById('ord-bill-focus');
  if (focusEl) {
    const costPerFocus = getCostPerFocus();
    const focusItems   = Object.values(refineMap).filter(r => r.focus);

    if (!focusItems.length) {
      focusEl.innerHTML = '<div class="bill-empty">— No focus used —</div>';
    } else {
      let grandFocus = 0, grandSilver = 0;

      const rows = focusItems.map(r => {
        const fpu    = getFocusCost(r.tierKey);
        const totalF = fpu * r.qty;
        const silver = totalF * costPerFocus;
        grandFocus  += totalF;
        grandSilver += silver;

        return `<div class="bill-row has-tooltip">
          <img class="bill-icon" src="${iconUrl(r.itemId)}" onerror="retryIcon(this,'display')" />
          <div class="bill-name">${r.name} <span class="bill-tier-tag">${r.tierKey}</span>
            <div class="bill-name-sub">${fpu} focus/unit · recipe ${r.decision.toUpperCase()}</div>
          </div>
          <div style="text-align:right">
            <div class="bill-qty">${fmt(totalF)} focus</div>
            <div class="bill-cost">${fmt(silver)} silver</div>
          </div>
          ${buildTooltip([
            ['Focus/unit',   String(fpu)],
            ['Qty',          fmt(r.qty)],
            ['Total focus',  fmt(totalF)],
            ['Silver/focus', fmt(costPerFocus)],
            ['__formula__',  `${fpu} × ${r.qty} × ${fmt(costPerFocus)} silver/focus`],
          ], 'left')}</div>`;
      });

      rows.push(`<div class="bill-focus-total">
        <span>Total focus</span>
        <span>${fmt(grandFocus)} focus = <strong>${fmt(grandSilver)} silver</strong></span>
      </div>`);

      focusEl.innerHTML = rows.join('');
    }
  }

  // Totals
  const totalsEl = document.getElementById('ord-totals');
  if (totalsEl && orders.length > 0) {
    const profitCls = totalProfit >= 0 ? 'profit-pos' : 'profit-neg';

    const ttTotalInvest = buildTooltip([
      ...orderResults.map(r => [
        refinedName(r.order.rss, r.order.tier, r.order.enchant) + ' ×' + r.order.qty,
        fmt(r.totalInvest),
      ]),
      ['__formula__', 'Σ (unitCost × qty)'],
    ], 'left below');

    const ttRevenue = buildTooltip([
      ...orderResults.map(r => [
        refinedName(r.order.rss, r.order.tier, r.order.enchant) + ' ×' + r.order.qty,
        fmt(r.revenue),
      ]),
      ['Tax', Math.round(TAX * 100) + '%'],
      ['__formula__', 'Σ (barHDV × (1−tax) × qty)'],
    ], 'left below');

    const margin = totalRevenue > 0 ? Math.round((totalProfit / totalRevenue) * 100) : null;
    const ttEstProfit = buildTooltip([
      ['Total revenue', fmt(totalRevenue)],
      ['Total invest',  fmt(totalInvest)],
      ...(margin != null ? [['Margin', margin + '%']] : []),
      ['__formula__',   'revenue − invest'],
    ], 'left below');

    totalsEl.innerHTML = `
      <div class="total-row has-tooltip"><span class="total-label">Total invest</span><span class="total-value">${fmt(totalInvest)} silver</span>${ttTotalInvest}</div>
      <div class="total-row has-tooltip"><span class="total-label">Expected revenue (after tax)</span><span class="total-value">${fmt(totalRevenue)} silver</span>${ttRevenue}</div>
      <div class="total-row big ${profitCls} has-tooltip"><span class="total-label">Estimated profit</span><span class="total-value">${fmtSigned(totalProfit)} silver</span>${ttEstProfit}</div>
    `;
  } else if (totalsEl) {
    totalsEl.innerHTML = '';
  }
}

function rebuildAll() {
  saveSession();

  if (orders.length === 0) {
    const list    = document.getElementById('ord-orders-list');
    const countEl = document.getElementById('ord-count');
    if (list)    list.innerHTML = `<div class="ord-empty">No orders yet<div class="ord-empty-hint">Click <strong>+ Add order</strong> to add items</div></div>`;
    if (countEl) countEl.textContent = '0 orders';
    const empties = { 'ord-bill-buy':'— No items to buy —', 'ord-bill-transmute':'— No transmutes —', 'ord-bill-refine':'— No recipes —', 'ord-bill-hearts':'— No hearts needed —', 'ord-bill-focus':'— No focus used —' };
    for (const [id, msg] of Object.entries(empties)) {
      const el = document.getElementById(id);
      if (el) el.innerHTML = `<div class="bill-empty">${msg}</div>`;
    }
    const totalsEl = document.getElementById('ord-totals');
    if (totalsEl) totalsEl.innerHTML = '';
    return;
  }

  const bill = buildBill();
  renderOrdersList(bill.orderResults);
  renderBill(bill);
}

// ── Persistence ───────────────────────────────────────────────────────────────

function saveSession() {
  localStorage.setItem('orders.session', JSON.stringify(orders));
}

function loadSession() {
  try {
    const saved = localStorage.getItem('orders.session');
    if (saved) orders = JSON.parse(saved);
  } catch (_) {
    orders = [];
  }
}

// ── Modal ─────────────────────────────────────────────────────────────────────

function syncModalLabels() {
  const f = document.getElementById('ord-modal-focus').checked;
  const s = document.getElementById('ord-modal-stack').checked;
  document.getElementById('ord-modal-focus-on').classList.toggle('on', f);
  document.getElementById('ord-modal-focus-off').classList.toggle('on', !f);
  document.getElementById('ord-modal-stack-on').classList.toggle('on', s);
  document.getElementById('ord-modal-stack-off').classList.toggle('on', !s);
  document.getElementById('ord-modal-stack-from-wrap').classList.toggle('disabled', !s);
}

function openModal(orderToEdit = null) {
  if (orderToEdit) {
    editingId = orderToEdit.id;
    document.getElementById('ord-modal-title').textContent  = 'Edit order';
    document.getElementById('ord-modal-submit').textContent = 'Save changes';
    document.querySelectorAll('#ord-modal-resource .pill-mini').forEach(p => {
      p.classList.toggle('on', p.dataset.rss === orderToEdit.rss);
    });
    document.getElementById('ord-modal-tier').value          = orderToEdit.tier;
    document.getElementById('ord-modal-qty').value           = orderToEdit.qty;
    document.getElementById('ord-modal-focus').checked       = orderToEdit.useFocus;
    document.getElementById('ord-modal-stack').checked       = orderToEdit.useStack;
    document.getElementById('ord-modal-stack-from').value    = orderToEdit.stackFromTier;
    document.querySelectorAll('#ord-modal-enchants .tier-btn').forEach(b => {
      b.classList.toggle('on', parseInt(b.dataset.e) === orderToEdit.enchant);
    });
  } else {
    editingId = null;
    document.getElementById('ord-modal-title').textContent  = 'Add order';
    document.getElementById('ord-modal-submit').textContent = 'Add to session';
    document.querySelectorAll('#ord-modal-resource .pill-mini').forEach((p, i) => p.classList.toggle('on', i === 0));
    document.getElementById('ord-modal-qty').value          = 100;
    document.getElementById('ord-modal-focus').checked      = false;
    document.getElementById('ord-modal-stack').checked      = true;
    document.getElementById('ord-modal-stack-from').value   = 7;
    document.querySelectorAll('#ord-modal-enchants .tier-btn').forEach(b => b.classList.remove('on'));
  }
  syncModalLabels();
  document.getElementById('ord-modal-overlay').classList.add('show');
}

function closeModal() {
  document.getElementById('ord-modal-overlay').classList.remove('show');
  editingId = null;
}

function submitModal() {
  const rss = document.querySelector('#ord-modal-resource .pill-mini.on')?.dataset.rss;
  if (!rss) return;
  const tier          = parseInt(document.getElementById('ord-modal-tier').value);
  const qty           = parseInt(document.getElementById('ord-modal-qty').value) || 100;
  const useFocus      = document.getElementById('ord-modal-focus').checked;
  const useStack      = document.getElementById('ord-modal-stack').checked;
  const stackFromTier = parseInt(document.getElementById('ord-modal-stack-from').value);
  const enchants      = [...document.querySelectorAll('#ord-modal-enchants .tier-btn.on')].map(b => parseInt(b.dataset.e));

  if (!enchants.length) return;

  if (editingId !== null) {
    const idx = orders.findIndex(o => o.id === editingId);
    if (idx >= 0) {
      const enchant = enchants[0];
      orders[idx] = { id: editingId, rss, tier, enchant, tierKey: tierLabel(tier, enchant), qty, useFocus, useStack, stackFromTier };
    }
  } else {
    enchants.forEach(enchant => {
      orders.push({ id: Date.now() + Math.random(), rss, tier, enchant, tierKey: tierLabel(tier, enchant), qty, useFocus, useStack, stackFromTier });
    });
  }

  closeModal();
  rebuildAll();
  doRefresh();
}

function deleteOrder(id) {
  const i = orders.findIndex(o => o.id === id);
  if (i >= 0) orders.splice(i, 1);
  rebuildAll();
}

// ── Flip session rendering ─────────────────────────────────────────────────────

const FLIP_CITY_CSS = {
  'Caerleon':     'caerleon',
  'Bridgewatch':  'bridgewatch',
  'Lymhurst':     'lymhurst',
  'Martlock':     'martlock',
  'Fort Sterling':'sterling',
  'Thetford':     'thetford',
  'Brecilien':    'brecilien',
  'Black Market': 'blackmarket',
};

function flipCityTag(city) {
  const cls = FLIP_CITY_CSS[city] ?? 'sterling';
  return `<span class="flip-city-tag ${cls}">${city}</span>`;
}

function fsEnchTag(enchant) {
  return `<span class="ench-tag e${enchant}">.${enchant}</span>`;
}

function renderFlipSession() {
  const el = document.getElementById('ord-flip-section');
  if (!el) return;

  const items = fsGetItems();
  const active = items.filter(i => !i.done);

  const totalInvest = active.reduce((s, i) => s + i.qty * i.buyPrice,    0);
  const totalNet    = active.reduce((s, i) => s + i.qty * i.netPerUnit,   0);
  const roi         = totalInvest > 0 ? (totalNet / totalInvest * 100) : 0;

  const roiStr    = (roi >= 0 ? '+' : '') + roi.toFixed(1) + '%';
  const netCls    = totalNet >= 0 ? 'pos' : 'neg';

  // Build rows
  const rowsHtml = items.length ? items.map(item => {
    const doneCls   = item.done ? ' fs-done' : '';
    const netTotal  = item.qty * item.netPerUnit;
    const netTotCls = netTotal >= 0 ? 'pos' : 'neg';
    const iconUrl   = `https://render.albiononline.com/v1/item/${item.itemId}.png?size=64`;
    const enchant   = item.enchant;
    return `<div class="fs-row${doneCls}" data-fs-id="${item.id}">
      <label class="fs-check"><input type="checkbox" class="fs-done-chk" ${item.done ? 'checked' : ''} /></label>
      <img class="fs-icon" src="${iconUrl}" onerror="retryIcon(this,'display')" />
      <div class="fs-item-info">
        <div class="fs-item-name">${item.itemName}</div>
        <div class="fs-item-meta">T${item.tier}${enchant > 0 ? `.${enchant}` : ''} ${fsEnchTag(enchant)}</div>
      </div>
      <div class="fs-route">
        ${flipCityTag(item.buyCity)}
        <span class="fs-arrow">→</span>
        ${flipCityTag(item.sellCity)}
      </div>
      <div class="fs-qty-wrap">
        <input type="number" class="fs-qty-input" value="${item.qty}" min="1" data-fs-id="${item.id}" />
      </div>
      <div class="fs-prices">
        <div class="fs-price-lbl">Buy</div>
        <div class="fs-price-val">${fmt(item.buyPrice)}</div>
        <div class="fs-price-lbl">Sell</div>
        <div class="fs-price-val">${fmt(item.sellPrice)}</div>
      </div>
      <div class="fs-net-unit">
        <div class="fs-price-lbl">Net/u</div>
        <div class="fs-price-val ${netTotCls}">${fmtSigned(item.netPerUnit)}</div>
      </div>
      <div class="fs-net-total">
        <div class="fs-price-lbl">Total net</div>
        <div class="fs-price-val ${netTotCls} bold">${fmtSigned(netTotal)}</div>
      </div>
      <button class="icon-btn delete fs-del-btn" data-fs-id="${item.id}" title="Remove">×</button>
    </div>`;
  }).join('') : `<div class="ord-empty">No flips pinned yet<div class="ord-empty-hint">Click 📌 on a flip card to pin it here</div></div>`;

  // Build shopping list grouped by buyCity
  const byCity = {};
  for (const item of active) {
    if (!byCity[item.buyCity]) byCity[item.buyCity] = [];
    byCity[item.buyCity].push(item);
  }
  const shoppingHtml = Object.entries(byCity).map(([city, cityItems]) => {
    const cityTotal = cityItems.reduce((s, i) => s + i.qty * i.buyPrice, 0);
    const cityClass = FLIP_CITY_CSS[city] ?? 'sterling';
    const linesTxt  = cityItems.map(i =>
      `${i.qty}× ${i.itemName} T${i.tier}${i.enchant > 0 ? `.${i.enchant}` : ''} — ${fmt(i.buyPrice)} silver/u — ${fmt(i.qty * i.buyPrice)} silver`
    ).join('\n');
    const linesHtml = cityItems.map(i => `
      <div class="fs-shop-line">
        <span class="fs-shop-qty">${i.qty}×</span>
        <span class="fs-shop-name">${i.itemName} <span class="ench-tag e${i.enchant}">T${i.tier}.${i.enchant}</span></span>
        <span class="fs-shop-price">${fmt(i.buyPrice)} /u</span>
        <span class="fs-shop-total">${fmt(i.qty * i.buyPrice)} silver</span>
      </div>`).join('');
    return `<div class="fs-shop-group">
      <div class="fs-shop-header">
        <span class="flip-city-tag ${cityClass}">${city}</span>
        <span class="fs-shop-city-total">Total: <strong>${fmt(cityTotal)} silver</strong></span>
        <button class="fs-copy-btn" data-city="${city}" data-text="${encodeURIComponent(city + '\n' + linesTxt)}" title="Copy shopping list">Copy</button>
      </div>
      ${linesHtml}
    </div>`;
  }).join('');

  el.innerHTML = `
<div class="fs-wrap">

  <div class="fs-totals">
    <div class="fs-total-block">
      <div class="fs-total-lbl">Total invest</div>
      <div class="fs-total-val">${fmt(totalInvest)} <span class="fs-silver">silver</span></div>
    </div>
    <div class="fs-total-block">
      <div class="fs-total-lbl">Total net</div>
      <div class="fs-total-val ${netCls}">${fmtSigned(totalNet)} <span class="fs-silver">silver</span></div>
    </div>
    <div class="fs-total-block">
      <div class="fs-total-lbl">Avg ROI</div>
      <div class="fs-total-val ${netCls}">${roiStr}</div>
    </div>
  </div>

  <div class="fs-actions">
    <button class="ord-clear-btn" id="fs-clear-done-btn" type="button">Clear done</button>
    <button class="ord-clear-btn" id="fs-clear-all-btn" type="button">Clear all</button>
  </div>

  <div class="fs-rows" id="fs-rows">
    ${rowsHtml}
  </div>

  ${active.length > 0 ? `
  <details class="fs-shop-details">
    <summary class="fs-shop-summary">🛒 Shopping list by city</summary>
    <div class="fs-shop-body">${shoppingHtml}</div>
  </details>` : ''}

</div>`;

  // Wire row interactions
  el.querySelectorAll('.fs-done-chk').forEach(chk => {
    chk.addEventListener('change', () => {
      const id = chk.closest('[data-fs-id]').dataset.fsId;
      updatePin(id, { done: chk.checked });
    });
  });

  el.querySelectorAll('.fs-qty-input').forEach(inp => {
    inp.addEventListener('change', () => {
      const qty = Math.max(1, parseInt(inp.value) || 1);
      inp.value = qty;
      updatePin(inp.dataset.fsId, { qty });
    });
  });

  el.querySelectorAll('.fs-del-btn').forEach(btn => {
    btn.addEventListener('click', () => removePin(btn.dataset.fsId));
  });

  el.querySelector('#fs-clear-done-btn')?.addEventListener('click', () => {
    fsClearDone();
  });

  el.querySelector('#fs-clear-all-btn')?.addEventListener('click', () => {
    if (!items.length) return;
    if (!confirm('Clear all pinned flips?')) return;
    fsClearAll();
  });

  el.querySelectorAll('.fs-copy-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const text = decodeURIComponent(btn.dataset.text);
      navigator.clipboard.writeText(text).catch(() => {});
      btn.textContent = '✓';
      setTimeout(() => { btn.textContent = 'Copy'; }, 1200);
    });
  });
}

// ── Craft session rendering ────────────────────────────────────────────────────

async function refreshCraftPin(id, btn) {
  const items = csGetItems();
  const pin   = items.find(i => i.id === id);
  if (!pin) return;

  btn.disabled    = true;
  btn.textContent = '…';

  try {
    const newMats = pin.mats.map(m => ({ ...m }));

    for (const mat of newMats) {
      if (mat.buyCity && mat.itemId) {
        const flat = await fetchPrices([mat.itemId], [mat.buyCity]);
        const p = flat.find(e => e.item_id === mat.itemId && e.sell_price_min > 0);
        if (p) mat.unitPrice = p.sell_price_min;
      }
    }

    let newArtifact = pin.artifact ? { ...pin.artifact } : null;
    if (newArtifact?.buyCity && newArtifact?.itemId) {
      const flat = await fetchPrices([newArtifact.itemId], [newArtifact.buyCity]);
      const p = flat.find(e => e.item_id === newArtifact.itemId && e.sell_price_min > 0);
      if (p) newArtifact.unitPrice = p.sell_price_min;
    }

    let newSell = pin.sellPrice;
    if (pin.sellCity && pin.itemId) {
      const flat = await fetchPrices([pin.itemId], [pin.sellCity], pin.sellQuality);
      const p = flat.find(e => e.item_id === pin.itemId && e.sell_price_min > 0);
      if (p) newSell = p.sell_price_min;
    }

    const crr  = pin.useFocus ? DEFAULT_CRR_FOCUS : DEFAULT_CRR_NO_FOCUS;
    const tax  = pin.taxPct / 100;
    const bar1 = newMats[0]?.unitPrice ?? null;
    const qty1 = newMats[0]?.qtyPerCraft ?? 0;
    const bar2 = newMats[1]?.unitPrice ?? null;
    const qty2 = newMats[1]?.qtyPerCraft ?? 0;
    const artCost = newArtifact?.unitPrice ?? 0;

    const result = calcCraftRow(qty1, bar1, qty2, qty2 > 0 ? bar2 : null, artCost, newSell || null, crr, tax);

    csUpdatePin(id, {
      mats:        newMats,
      artifact:    newArtifact,
      sellPrice:   newSell,
      costPerUnit: result?.craftCost  ?? pin.costPerUnit,
      netPerUnit:  result?.profit     ?? pin.netPerUnit,
      roiPct:      result?.roi        ?? pin.roiPct,
    });
  } catch (err) {
    console.error('[orders] refresh craft pin:', err);
  } finally {
    btn.disabled    = false;
    btn.textContent = '↻';
  }
}

function renderCraftSession() {
  const el = document.getElementById('ord-crafting-section');
  if (!el) return;

  const items  = csGetItems();
  const active = items.filter(i => !i.done);

  const totalInvest  = active.reduce((s, i) => s + i.costPerUnit * i.qty, 0);
  const totalNet     = active.reduce((s, i) => s + i.netPerUnit  * i.qty, 0);
  const totalRevenue = active.reduce((s, i) => s + i.sellPrice * (1 - i.taxPct / 100) * i.qty, 0);
  const roi          = totalInvest > 0 ? (totalNet / totalInvest * 100) : 0;

  const rowsHtml = items.length ? items.map(item => {
    const doneCls   = item.done ? ' cs-done' : '';
    const netTotal  = item.qty * item.netPerUnit;
    const netCls    = item.netPerUnit >= 0 ? 'pos' : 'neg';
    const netTotCls = netTotal >= 0 ? 'pos' : 'neg';
    const roiPct    = item.roiPct != null ? (item.roiPct * 100).toFixed(1) + '%' : '—';
    const iconUrl   = `https://render.albiononline.com/v1/item/${item.itemId}.png?size=64`;
    const enchLabel = item.enchant > 0 ? `.${item.enchant}` : '';
    return `<div class="cs-row${doneCls}" data-cs-id="${item.id}">
      <label class="cs-check"><input type="checkbox" class="cs-done-chk" ${item.done ? 'checked' : ''} /></label>
      <img class="cs-icon" src="${iconUrl}" onerror="retryIcon(this,'display')" />
      <div class="cs-item-info">
        <div class="cs-item-name">${item.name}</div>
        <div class="cs-item-meta">T${item.tier}${enchLabel} · ${item.station}</div>
      </div>
      <div class="cs-station">${flipCityTag(item.stationCity)}</div>
      <div class="cs-qty-wrap">
        <input type="number" class="cs-qty-input" value="${item.qty}" min="1" data-cs-id="${item.id}" />
      </div>
      <div class="cs-price-val">${fmt(item.costPerUnit)}</div>
      <div class="cs-price-val">${fmt(item.sellPrice)}</div>
      <div class="cs-price-val ${netCls}">${fmtSigned(item.netPerUnit)}</div>
      <div class="cs-price-val ${netTotCls} bold">${fmtSigned(netTotal)}</div>
      <div class="cs-roi ${netCls}">${roiPct}</div>
      <button class="icon-btn cs-refresh-row-btn" data-cs-id="${item.id}" title="Refresh prices">↻</button>
      <button class="icon-btn delete cs-del-btn" data-cs-id="${item.id}" title="Remove">×</button>
    </div>`;
  }).join('') : `<div class="ord-empty">No crafts pinned yet<div class="ord-empty-hint">Click <strong>+ Add</strong> on a crafting row to pin it here</div></div>`;

  el.innerHTML = `
<div class="cs-wrap">

  <div class="cs-totals">
    <div class="cs-total-block">
      <div class="cs-total-lbl">Total invest</div>
      <div class="cs-total-val">${fmt(totalInvest)} <span class="cs-silver">silver</span></div>
    </div>
    <div class="cs-total-block">
      <div class="cs-total-lbl">Total revenue</div>
      <div class="cs-total-val">${fmt(totalRevenue)} <span class="cs-silver">silver</span></div>
    </div>
    <div class="cs-total-block">
      <div class="cs-total-lbl">Total net</div>
      <div class="cs-total-val ${totalNet >= 0 ? 'pos' : 'neg'}">${fmtSigned(totalNet)} <span class="cs-silver">silver</span></div>
    </div>
    <div class="cs-total-block">
      <div class="cs-total-lbl">Avg ROI</div>
      <div class="cs-total-val ${roi >= 0 ? 'pos' : 'neg'}">${(roi >= 0 ? '+' : '') + roi.toFixed(1)}%</div>
    </div>
  </div>

  <div class="cs-actions">
    <button class="ord-clear-btn" id="cs-clear-done-btn" type="button">Clear done</button>
    <button class="ord-clear-btn" id="cs-clear-all-btn" type="button">Clear all</button>
  </div>

  <div class="cs-header-row">
    <span></span><span></span>
    <span class="cs-col-hdr">Item</span>
    <span class="cs-col-hdr">City</span>
    <span class="cs-col-hdr">Qty</span>
    <span class="cs-col-hdr">Cost/u</span>
    <span class="cs-col-hdr">Sell/u</span>
    <span class="cs-col-hdr">Net/u</span>
    <span class="cs-col-hdr">Total net</span>
    <span class="cs-col-hdr">ROI</span>
    <span></span><span></span>
  </div>

  <div class="cs-rows" id="cs-rows">
    ${rowsHtml}
  </div>

  ${active.length > 0 ? craftBillHtml(buildCraftBill(items)) : ''}

</div>`;

  el.querySelectorAll('.cs-done-chk').forEach(chk => {
    chk.addEventListener('change', () => {
      const id = chk.closest('[data-cs-id]').dataset.csId;
      csUpdatePin(id, { done: chk.checked });
    });
  });

  el.querySelectorAll('.cs-qty-input').forEach(inp => {
    inp.addEventListener('change', () => {
      const qty = Math.max(1, parseInt(inp.value) || 1);
      inp.value = qty;
      csUpdatePin(inp.dataset.csId, { qty });
    });
  });

  el.querySelectorAll('.cs-del-btn').forEach(btn => {
    btn.addEventListener('click', () => csRemovePin(btn.dataset.csId));
  });

  el.querySelectorAll('.cs-refresh-row-btn').forEach(btn => {
    btn.addEventListener('click', () => refreshCraftPin(btn.dataset.csId, btn));
  });

  el.querySelector('#cs-clear-done-btn')?.addEventListener('click', () => csClearDone());
  el.querySelector('#cs-clear-all-btn')?.addEventListener('click', () => {
    if (!items.length) return;
    if (!confirm('Clear all crafting pins?')) return;
    csClearAll();
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────

export function initOrders() {
  loadSession();

  window.addEventListener('forge:prices-changed',       () => rebuildAll());
  window.addEventListener('forge:flip-session-changed',  () => renderFlipSession());
  window.addEventListener('forge:craft-session-changed', () => renderCraftSession());

  // Segmented control (3 sections)
  function switchSection(section) {
    document.querySelectorAll('.ord-section-btn').forEach(b => b.classList.toggle('on', b.dataset.section === section));
    document.getElementById('ord-craft-section').hidden    = section !== 'refining';
    document.getElementById('ord-crafting-section').hidden = section !== 'craft';
    document.getElementById('ord-flip-section').hidden     = section !== 'flip';
    if (section === 'craft') renderCraftSession();
    if (section === 'flip')  renderFlipSession();
    localStorage.setItem('orders.activeSection', section);
  }

  document.querySelectorAll('.ord-section-btn').forEach(btn => {
    btn.addEventListener('click', () => switchSection(btn.dataset.section));
  });

  // Restore active section
  const savedSection = localStorage.getItem('orders.activeSection') ?? 'refining';
  if (savedSection !== 'refining') switchSection(savedSection);

  document.getElementById('ord-modal-overlay')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal();
  });
  document.getElementById('ord-add-btn')?.addEventListener('click', () => openModal());
  document.getElementById('ord-clear-btn')?.addEventListener('click', () => {
    if (!orders.length) return;
    if (!confirm('Clear all orders?')) return;
    orders = [];
    rebuildAll();
  });
  document.getElementById('ord-refresh-btn')?.addEventListener('click', doRefresh);
  document.getElementById('ord-modal-cancel')?.addEventListener('click', closeModal);
  document.getElementById('ord-modal-submit')?.addEventListener('click', submitModal);

  document.querySelectorAll('#ord-modal-resource .pill-mini').forEach(p => {
    p.addEventListener('click', () => {
      document.querySelectorAll('#ord-modal-resource .pill-mini').forEach(x => x.classList.remove('on'));
      p.classList.add('on');
    });
  });

  document.querySelectorAll('#ord-modal-enchants .tier-btn').forEach(b => {
    b.addEventListener('click', () => {
      if (editingId !== null) {
        document.querySelectorAll('#ord-modal-enchants .tier-btn').forEach(x => x.classList.remove('on'));
      }
      b.classList.toggle('on');
    });
  });

  document.getElementById('ord-modal-focus')?.addEventListener('change', syncModalLabels);
  document.getElementById('ord-modal-stack')?.addEventListener('change', syncModalLabels);

  rebuildAll();
  if (orders.length > 0) doRefresh();
}
