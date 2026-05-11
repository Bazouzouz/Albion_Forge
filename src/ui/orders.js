import { RESOURCES, getIconUrl, T3_REFINED_IDS } from '../data/items.js';
import { fetchPricesForResource }                  from '../api/albionApi.js';
import { getEffectiveRawPrice, getAcquisitionChain } from './transmute.js';
import { getHeartPrice, getPremiumPrice }           from './catalogue.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const RECIPES = { 4:{r1:2,r2:1}, 5:{r1:3,r2:2}, 6:{r1:4,r2:3}, 7:{r1:5,r2:4}, 8:{r1:6,r2:5} };
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
const HEART_IDS   = { ORE:'T1_FACTION_MOUNTAIN_TOKEN_1', WOOD:'T1_FACTION_FOREST_TOKEN_1', FIBER:'T1_FACTION_STEPPE_TOKEN_1', HIDE:'T1_FACTION_SWAMP_TOKEN_1' };
const HEART_NAMES = { ORE:'Mountainheart', WOOD:'Treeheart', FIBER:'Vineheart', HIDE:'Beastheart' };

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
    const subQty   = Math.ceil(qty * (1 - rrr));
    const subOrder = { id: null, rss, tier: tier - 1, enchant, tierKey: tierLabel(tier - 1, enchant), qty: subQty, useFocus, useStack, stackFromTier };
    const sub      = computeOrderResult(subOrder);
    return { cost: sub.unitCost, stacked: true, subResult: sub };
  }
  const lowerRefId = RESOURCES[rss].tiers[`T${tier - 1}`].refined[enchant];
  return { cost: getOrdPrice(lowerRefId) ?? 0, stacked: false, subResult: null };
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

  const rawsNeeded       = Math.ceil(rec[decision] * qty * (1 - rrr));
  const lowerInputNeeded = Math.ceil(qty * (1 - rrr));
  const heartsNeeded     = decision === 'r2' ? Math.ceil(qty * (1 - rrr)) : 0;

  const refItemId = RESOURCES[rss].tiers[`T${tier}`].refined[enchant];
  const barHdv    = getOrdPrice(refItemId);
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

function buildBill() {
  const buyMap    = {};  // key → { itemId, name, qty, unitPrice, type }
  const trmMap    = {};  // key → transmutation step with aggregated qty
  const refineMap = {};  // key → { itemId, rss, tierKey, name, qty, decision, focus }
  const heartMap  = {};  // rss → { name, itemId, qty, unitPrice }
  let totalInvest = 0, totalRevenue = 0, totalProfit = 0;

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

  const orderResults = orders.map(computeOrderResult);
  orderResults.forEach(r => {
    walk(r);
    totalInvest += r.totalInvest;
    if (r.revenue != null) totalRevenue += r.revenue;
    if (r.profit  != null) totalProfit  += r.profit;
  });

  return { orderResults, buyMap, transmutes: Object.values(trmMap), refineMap, heartMap, totalInvest, totalRevenue, totalProfit };
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
      ['Bar HDV',        fmt(r.barHdv)],
      ['Tax',            Math.round(TAX * 100) + '%'],
      ['Sale after tax', fmt(saleAfterTax)],
      ['Unit cost',      fmt(r.unitCost)],
      ['Profit/unit',    fmt(profitPerUnit)],
      ['Quantity',       String(o.qty)],
      ['__formula__',    '(sale − unitCost) × qty'],
    ]);

    return `<div class="order-item">
      <img class="order-icon" src="${getIconUrl(refItemId)}" onerror="this.style.display='none'" />
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
    buyEl.innerHTML = items.length
      ? items.map(b => `<div class="bill-row has-tooltip">
          <img class="bill-icon" src="${iconUrl(b.itemId)}" onerror="this.style.display='none'" />
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
          ], 'left')}</div>`).join('')
      : '<div class="bill-empty">— No items to buy —</div>';
  }

  // Transmutations — sorted by destination tier then enchant
  const trmEl = document.getElementById('ord-bill-transmute');
  if (trmEl) {
    const items = [...transmutes].sort((a, b) =>
      a.dstTier !== b.dstTier ? a.dstTier - b.dstTier : a.dstEnchant - b.dstEnchant
    );
    trmEl.innerHTML = items.length
      ? items.map(t => {
          const badgeLabel  = t.via === 'r1' ? 'R1 (T-1)' : 'R2 (E-1)';
          const totalSilver = t.qty * t.silverCostPerUnit;
          return `<div class="bill-row has-tooltip">
            <div class="bill-trm-icons">
              <img class="bill-icon" src="${iconUrl(t.srcItemId)}" onerror="this.style.display='none'" />
              <span class="bill-trm-arrow">→</span>
              <img class="bill-icon" src="${iconUrl(t.dstItemId)}" onerror="this.style.display='none'" />
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
        }).join('')
      : '<div class="bill-empty">— No transmutes needed —</div>';
  }

  // Refining recipes
  const refEl = document.getElementById('ord-bill-refine');
  if (refEl) {
    const items = Object.values(refineMap);
    refEl.innerHTML = items.length
      ? items.map(r => `<div class="bill-row has-tooltip">
          <img class="bill-icon" src="${iconUrl(r.itemId)}" onerror="this.style.display='none'" />
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
          <img class="bill-icon" src="${iconUrl(h.itemId)}" onerror="this.style.display='none'" />
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
    const empties = { 'ord-bill-buy':'— No items to buy —', 'ord-bill-transmute':'— No transmutes —', 'ord-bill-refine':'— No recipes —', 'ord-bill-hearts':'— No hearts needed —' };
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

// ── Init ──────────────────────────────────────────────────────────────────────

export function initOrders() {
  loadSession();

  window.addEventListener('forge:prices-changed', () => rebuildAll());

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
