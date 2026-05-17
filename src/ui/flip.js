// Flip tab: city-to-city market arbitrage for weapons, armor, capes, and bags.

import { CITIES }               from '../data/cities.js';
import { FLIP_ITEMS }           from '../data/flipItems.js';
import { fetchPrices, fetchHistory, clearCache } from '../api/albionApi.js';
import { buildFlipList }        from '../logic/flip.js';
import { addPin }               from '../logic/flipSession.js';

// ── Constants ────────────────────────────────────────────────────────────────

const BUY_CITIES  = CITIES.filter(c => c.id !== 'Black Market').map(c => c.id);
const SELL_CITIES = CITIES.map(c => c.id);
const ALL_TIERS   = [4, 5, 6, 7, 8];
const ALL_ENCHANTS = [0, 1, 2, 3, 4];
const RENDER_BASE  = 'https://render.albiononline.com/v1/item';

const QUALITY_NAMES = { 0: 'All qualities', 1: 'Normal', 2: 'Good', 3: 'Outstanding', 4: 'Excellent', 5: 'Masterpiece' };

const CATEGORY_INFO = {
  weapons: { label: 'Weapons', emoji: '⚔' },
  head:    { label: 'Head',    emoji: '🪖' },
  chest:   { label: 'Chest',   emoji: '🎽' },
  shoes:   { label: 'Shoes',   emoji: '👢' },
  cape:    { label: 'Cape',    emoji: '🧣' },
  bag:     { label: 'Bag',     emoji: '🎒' },
};

const CITY_CSS = {
  'Caerleon':     'caerleon',
  'Bridgewatch':  'bridgewatch',
  'Lymhurst':     'lymhurst',
  'Martlock':     'martlock',
  'Fort Sterling':'sterling',
  'Thetford':     'thetford',
  'Brecilien':    'brecilien',
  'Black Market': 'blackmarket',
};

// ── State ────────────────────────────────────────────────────────────────────

const state = {
  buyCityFilter:  '',
  sellCityFilter: '',
  sellMode:       'instant',
  quality:        1,
  tiers:          [5, 6, 7],
  enchants:       [0, 1, 2, 3],
  categories:     ['weapons', 'head', 'chest', 'shoes', 'cape', 'bag'],
  taxPct:         4,
  minRoi:         8,
  minNet:         0,
  maxAgeMin:      500,
  showNoPrice:    false,
};

let priceMap             = new Map(); // itemId → Map<city, priceEntry>  (single quality)
let allQualityPriceMaps  = new Map(); // quality → priceMap             (quality === 0 mode)
let volumeMap            = new Map(); // itemId → Map<city, avgDailyVolume>
let loading              = false;
let renderedItems        = new Map(); // "itemId_qN" → full item+pair object (for pin lookup)

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n) {
  if (!n && n !== 0) return '—';
  return Math.round(n).toLocaleString('fr-FR');
}

function fmtNet(n) {
  if (n == null) return '—';
  return (n >= 0 ? '+' : '') + fmt(n);
}

function ageLabel(min) {
  if (!isFinite(min)) return '?';
  if (min < 60)   return `${min}min`;
  if (min < 1440) return `${Math.floor(min / 60)}h`;
  return `${Math.floor(min / 1440)}d`;
}

function roiBadgeClass(roi) {
  if (roi >= 15) return 'good';
  if (roi >= 5)  return 'mid';
  return 'low';
}

function cityTag(city) {
  const cls = CITY_CSS[city] ?? 'sterling';
  return `<span class="flip-city-tag ${cls}">${city}</span>`;
}

function ageStatus(min) {
  if (!isFinite(min)) return 'old';
  if (min < 60)  return 'fresh';
  if (min < 360) return 'stale';
  return 'old';
}

// ── Toolbar HTML ─────────────────────────────────────────────────────────────

function buildToolbar() {
  const cityOptions = (cities, selected) => cities.map(c =>
    `<option value="${c}" ${c === selected ? 'selected' : ''}>${c}</option>`
  ).join('');

  const tierPills = ALL_TIERS.map(t =>
    `<button class="flip-pill tier-pill ${state.tiers.includes(t) ? 'on' : ''}" data-tier="${t}" type="button">T${t}</button>`
  ).join('');

  const enchantPills = ALL_ENCHANTS.map(e =>
    `<button class="flip-pill ench-pill e${e} ${state.enchants.includes(e) ? 'on' : ''}" data-enchant="${e}" type="button">.${e}</button>`
  ).join('');

  return `
<div class="flip-toolbar" id="flip-toolbar">

  <div class="flip-tg">
    <label>Buy city</label>
    <select id="flip-buy-city" class="flip-select">
      <option value="">All cities</option>
      ${cityOptions(BUY_CITIES, state.buyCityFilter)}
    </select>
  </div>

  <div class="flip-tg">
    <label>Sell city</label>
    <select id="flip-sell-city" class="flip-select">
      <option value="">All cities</option>
      ${cityOptions(SELL_CITIES, state.sellCityFilter)}
    </select>
  </div>

  <div class="flip-sep"></div>

  <div class="flip-tg">
    <label>Sell mode</label>
    <div class="flip-seg" id="flip-sell-mode">
      <button class="flip-seg-btn ${state.sellMode === 'instant' ? 'on' : ''}" data-mode="instant" type="button">Instant sell</button>
      <button class="flip-seg-btn ${state.sellMode === 'order'   ? 'on' : ''}" data-mode="order"   type="button">Sell order</button>
    </div>
  </div>

  <div class="flip-tg">
    <label>Quality</label>
    <select id="flip-quality" class="flip-select" style="min-width:108px;">
      ${[0,1,2,3,4,5].map(q => `<option value="${q}" ${q === state.quality ? 'selected' : ''}>${QUALITY_NAMES[q]}</option>`).join('')}
    </select>
  </div>

  <div class="flip-sep"></div>

  <div class="flip-tg">
    <label>Tier</label>
    <div class="flip-pill-group" id="flip-tier-pills">${tierPills}</div>
  </div>

  <div class="flip-tg">
    <label>Enchants</label>
    <div class="flip-pill-group" id="flip-enchant-pills">${enchantPills}</div>
  </div>

  <div class="flip-sep"></div>

  <div class="flip-tg">
    <label>Tax %</label>
    <input id="flip-tax" class="flip-num" type="number" value="${state.taxPct}" step="0.5" min="0" max="25" />
  </div>

  <div class="flip-tg">
    <label>Min ROI %</label>
    <input id="flip-min-roi" class="flip-num" type="number" value="${state.minRoi}" min="0" />
  </div>

  <div class="flip-tg">
    <label>Min net</label>
    <input id="flip-min-net" class="flip-num" type="number" value="${state.minNet}" style="width:80px;" min="0" />
  </div>

  <div class="flip-tg">
    <label>Max age (min)</label>
    <input id="flip-max-age" class="flip-num" type="number" value="${state.maxAgeMin}" min="0" title="0 = no limit" />
  </div>

  <div class="flip-sep"></div>

  <div class="flip-tg">
    <label>Show no data</label>
    <label class="flip-toggle-switch">
      <input type="checkbox" id="flip-show-no-price" ${state.showNoPrice ? 'checked' : ''}>
      <span class="flip-toggle-slider"></span>
    </label>
  </div>

  <button class="flip-refresh-btn" id="flip-refresh-btn" type="button">↻ Refresh</button>
</div>`;
}

// ── Category chips ────────────────────────────────────────────────────────────

function buildCatBar() {
  const chips = Object.entries(CATEGORY_INFO).map(([key, { label, emoji }]) =>
    `<button class="flip-cat-chip ${state.categories.includes(key) ? 'active' : ''}" data-cat="${key}" type="button">
       <span class="flip-cat-emoji">${emoji}</span> ${label}
     </button>`
  ).join('');

  return `
<div class="flip-cat-bar" id="flip-cat-bar">
  ${chips}
  <span class="flip-sort-info" id="flip-sort-info">—</span>
</div>`;
}

// ── Card rendering ────────────────────────────────────────────────────────────

function renderCard(item) {
  const { itemId, name, category, tier, enchant } = item;
  const { pair, buyAgeMin, sellAgeMin, buyVol, sellVol } = item;
  const quality = item.displayQuality ?? state.quality;

  if (!pair) {
    const msg = item.noPriceReason === 'no-route'
      ? 'No cross-city route'
      : 'No market data';
    return `
<div class="flip-card no-price">
  <div class="fc-head">
    <div class="fc-icon t${tier}">
      <img src="${RENDER_BASE}/${itemId}.png" alt="" onerror="this.style.visibility='hidden'" loading="lazy" />
    </div>
    <div class="fc-title">
      <div class="fc-name">${name}</div>
      <div class="fc-meta">T${tier} <span class="ench-tag e${enchant}">.${enchant}</span></div>
    </div>
    <span class="roi-badge low">—</span>
  </div>
  <div class="fc-no-price-msg">${msg}</div>
</div>`;
  }

  const maxAge    = Math.max(buyAgeMin, sellAgeMin);
  const isStale   = isFinite(maxAge) && maxAge > 60;
  const roiClass  = roiBadgeClass(pair.roiPct);
  const netClass  = pair.net > 0 ? 'pos' : 'neg';

  const buyVolHtml  = buyVol  != null ? `<span class="vol-icon">📦</span>${buyVol}/day`  : `<span class="vol-icon">📦</span>—`;
  const sellVolHtml = sellVol != null ? `<span class="vol-icon">📈</span>${sellVol}/day` : `<span class="vol-icon">📈</span>—`;

  const tooltip = `
<div class="tooltip">
  <div class="tooltip-title">
    <span class="ench-tag e${enchant}">T${tier}.${enchant}</span>
    <span>${name} — breakdown</span>
  </div>
  <table>
    <tr><td>Buy price (${pair.buyCity})</td><td class="r">−${fmt(pair.buy)}</td></tr>
    ${state.sellMode === 'order' ? `<tr><td>Setup fee 2.5%</td><td class="r">−${fmt(pair.setupFee)}</td></tr>` : ''}
    <tr><td>Sell price (${pair.sellCity})</td><td class="r g">+${fmt(pair.sell)}</td></tr>
    <tr><td>Sales tax ${state.taxPct}%</td><td class="r">−${fmt(pair.salesTax)}</td></tr>
    <tr class="tot"><td>Net / unit</td><td class="r g">${fmtNet(pair.net)}</td></tr>
  </table>
  <div class="tooltip-foot">
    <span>🕐 Buy <b class="${ageStatus(buyAgeMin)}">${ageLabel(buyAgeMin)}</b> · Sell <b class="${ageStatus(sellAgeMin)}">${ageLabel(sellAgeMin)}</b></span>
    <span>ROI <b>${pair.roiPct.toFixed(1)}%</b></span>
  </div>
</div>`;

  return `
<div class="flip-card ${isStale ? 'stale' : ''}" data-item-id="${itemId}" data-card-quality="${quality}">
  <div class="fc-head">
    <div class="fc-icon t${tier}">
      <img src="${RENDER_BASE}/${itemId}.png" alt="" onerror="this.style.visibility='hidden'" loading="lazy" />
    </div>
    <div class="fc-title">
      <div class="fc-name">${name}</div>
      <div class="fc-meta">T${tier} <span class="ench-tag e${enchant}">.${enchant}</span> · ${QUALITY_NAMES[quality]}</div>
    </div>
    <span class="roi-badge ${roiClass}">${pair.roiPct >= 0 ? '+' : ''}${pair.roiPct.toFixed(1)}%</span>
  </div>

  <div class="fc-route">
    <div class="route-side">
      <div class="route-label">Buy</div>
      ${cityTag(pair.buyCity)}
    </div>
    <span class="route-arrow">→</span>
    <div class="route-side r">
      <div class="route-label">Sell</div>
      ${cityTag(pair.sellCity)}
    </div>
  </div>

  <div class="fc-prices">
    <div class="price-block">
      <div class="lbl">Buy price</div>
      <div class="val">${fmt(pair.buy)}</div>
      <div class="vol">${buyVolHtml}</div>
    </div>
    <div class="price-block">
      <div class="lbl">Sell price</div>
      <input type="number" class="fc-sell-input" value="${pair.sell}" min="0" step="100" />
      <div class="vol">${sellVolHtml}</div>
    </div>
  </div>

  <div class="fc-foot has-tooltip">
    <div>
      <div class="lbl">Net / unit</div>
      <div class="net ${netClass}">${fmtNet(pair.net)}</div>
    </div>
    <button class="pin-btn" title="Pin">📌</button>
    ${tooltip}
  </div>
</div>`;
}

// ── Main render ───────────────────────────────────────────────────────────────

function render() {
  const mosaic   = document.getElementById('flip-mosaic');
  const sortInfo = document.getElementById('flip-sort-info');
  if (!mosaic) return;

  const buyCities  = state.buyCityFilter  ? [state.buyCityFilter]  : BUY_CITIES;
  const sellCities = state.sellCityFilter ? [state.sellCityFilter] : SELL_CITIES;

  const filters = {
    buyCities, sellCities,
    sellMode:    state.sellMode,
    taxPct:      state.taxPct,
    tiers:       state.tiers,
    enchants:    state.enchants,
    categories:  state.categories,
    minRoi:      state.minRoi,
    minNet:      state.minNet,
    maxAgeMin:   state.maxAgeMin,
    showNoPrice: state.showNoPrice,
  };

  let items;
  if (state.quality === 0 && allQualityPriceMaps.size > 0) {
    const allItems = [];
    for (const [q, pm] of allQualityPriceMaps) {
      for (const it of buildFlipList(FLIP_ITEMS, pm, volumeMap, filters)) {
        allItems.push({ ...it, displayQuality: q });
      }
    }
    if (!state.showNoPrice) allItems.sort((a, b) => b.pair.net - a.pair.net);
    items = allItems;
  } else {
    items = buildFlipList(FLIP_ITEMS, priceMap, volumeMap, filters);
  }

  const withPair = items.filter(i => i.pair);
  const noData   = items.filter(i => !i.pair);
  let info = `${withPair.length} flip${withPair.length !== 1 ? 's' : ''} · sorted by net profit ↓`;
  const dataSize = state.quality === 0
    ? (allQualityPriceMaps.size > 0 ? [...allQualityPriceMaps.values()][0].size : 0)
    : priceMap.size;
  if (dataSize > 0) {
    const total = FLIP_ITEMS.filter(i =>
      state.tiers.includes(i.tier) &&
      state.enchants.includes(i.enchant) &&
      state.categories.includes(i.category)
    ).length;
    info += ` · ${dataSize}/${total} items with API data`;
  }
  sortInfo.textContent = info;

  if (!items.length) {
    mosaic.innerHTML = '<div class="flip-empty">No flip opportunities match your filters. Try adjusting tier, enchant, or ROI thresholds, or click Refresh.</div>';
    return;
  }

  renderedItems.clear();
  for (const item of items) {
    if (item.pair) {
      const q = item.displayQuality ?? state.quality;
      renderedItems.set(item.itemId + '_q' + q, item);
    }
  }
  mosaic.innerHTML = items.map(renderCard).join('');
}

// ── Fetch ─────────────────────────────────────────────────────────────────────

async function doRefresh() {
  if (loading) return;
  loading = true;

  const btn = document.getElementById('flip-refresh-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⟳ Loading…'; }

  const mosaic = document.getElementById('flip-mosaic');
  if (mosaic) mosaic.innerHTML = '<div class="flip-empty">Loading prices…</div>';

  try {
    clearCache();

    // Build item IDs for current filter selection
    const selectedItems = FLIP_ITEMS.filter(i =>
      state.tiers.includes(i.tier) &&
      state.enchants.includes(i.enchant) &&
      state.categories.includes(i.category)
    );
    const itemIds = [...new Set(selectedItems.map(i => i.itemId))];

    // Fetch prices across all cities
    const flat = await fetchPrices(itemIds, SELL_CITIES, state.quality);

    // Build priceMap(s): itemId → Map<city, entry>
    priceMap = new Map();
    allQualityPriceMaps = new Map();
    for (const e of flat) {
      const entry = {
        sell_price_min:      e.sell_price_min,
        sell_price_min_date: e.sell_price_min_date,
        buy_price_max:       e.buy_price_max,
        buy_price_max_date:  e.buy_price_max_date,
      };
      if (state.quality === 0) {
        const q = e.quality ?? 1;
        if (!allQualityPriceMaps.has(q)) allQualityPriceMaps.set(q, new Map());
        const pm = allQualityPriceMaps.get(q);
        if (!pm.has(e.item_id)) pm.set(e.item_id, new Map());
        pm.get(e.item_id).set(e.city, entry);
      } else {
        if (!priceMap.has(e.item_id)) priceMap.set(e.item_id, new Map());
        priceMap.get(e.item_id).set(e.city, entry);
      }
    }

    console.info(
      `[flip] fetched ${itemIds.length} items → ${flat.length} price entries → ${priceMap.size} items with ≥1 city price (${itemIds.length - priceMap.size} with no data)`
    );

    render();

    // Background: fetch volume history
    fetchHistory(itemIds, SELL_CITIES, state.quality).then(hist => {
      volumeMap = hist;
      render(); // re-render with volume data
    }).catch(() => {});

  } catch (err) {
    console.error('[flip] fetch error:', err);
    if (mosaic) mosaic.innerHTML = `<div class="flip-empty">Error: ${err.message}</div>`;
  } finally {
    loading = false;
    if (btn) { btn.disabled = false; btn.textContent = '↻ Refresh'; }
  }
}

// ── Event wiring ──────────────────────────────────────────────────────────────

function wireEvents(root) {
  // Refresh
  root.querySelector('#flip-refresh-btn')?.addEventListener('click', doRefresh);

  // Buy / sell city
  root.querySelector('#flip-buy-city')?.addEventListener('change', e => {
    state.buyCityFilter = e.target.value;
    render();
  });
  root.querySelector('#flip-sell-city')?.addEventListener('change', e => {
    state.sellCityFilter = e.target.value;
    render();
  });

  // Sell mode
  root.querySelector('#flip-sell-mode')?.addEventListener('click', e => {
    const btn = e.target.closest('.flip-seg-btn');
    if (!btn) return;
    state.sellMode = btn.dataset.mode;
    root.querySelectorAll('.flip-seg-btn').forEach(b => b.classList.toggle('on', b.dataset.mode === state.sellMode));
    render();
  });

  // Quality
  root.querySelector('#flip-quality')?.addEventListener('change', e => {
    state.quality = Number(e.target.value);
  });

  // Tier pills
  root.querySelector('#flip-tier-pills')?.addEventListener('click', e => {
    const btn = e.target.closest('.tier-pill');
    if (!btn) return;
    const t = Number(btn.dataset.tier);
    const idx = state.tiers.indexOf(t);
    if (idx === -1) { state.tiers.push(t); btn.classList.add('on'); }
    else            { state.tiers.splice(idx, 1); btn.classList.remove('on'); }
    render();
  });

  // Enchant pills
  root.querySelector('#flip-enchant-pills')?.addEventListener('click', e => {
    const btn = e.target.closest('.ench-pill');
    if (!btn) return;
    const en = Number(btn.dataset.enchant);
    const idx = state.enchants.indexOf(en);
    if (idx === -1) { state.enchants.push(en); btn.classList.add('on'); }
    else            { state.enchants.splice(idx, 1); btn.classList.remove('on'); }
    render();
  });

  // Numeric inputs (re-render on change)
  const numMap = {
    '#flip-tax':     v => { state.taxPct  = v; render(); },
    '#flip-min-roi': v => { state.minRoi  = v; render(); },
    '#flip-min-net': v => { state.minNet  = v; render(); },
    '#flip-max-age': v => { state.maxAgeMin = v; render(); },
  };
  for (const [id, fn] of Object.entries(numMap)) {
    root.querySelector(id)?.addEventListener('input', e => fn(Number(e.target.value) || 0));
  }

  // Category chips
  root.querySelector('#flip-cat-bar')?.addEventListener('click', e => {
    const chip = e.target.closest('.flip-cat-chip');
    if (!chip) return;
    const cat = chip.dataset.cat;
    const idx = state.categories.indexOf(cat);
    if (idx === -1) { state.categories.push(cat);    chip.classList.add('active'); }
    else            { state.categories.splice(idx,1); chip.classList.remove('active'); }
    render();
  });

  // Show no price toggle
  root.querySelector('#flip-show-no-price')?.addEventListener('change', e => {
    state.showNoPrice = e.target.checked;
    render();
  });

  // Sell price edit — event delegation on mosaic
  root.querySelector('#flip-mosaic')?.addEventListener('input', e => {
    const inp = e.target.closest('.fc-sell-input');
    if (!inp) return;
    const card = inp.closest('[data-item-id]');
    if (!card) return;
    const item = renderedItems.get(card.dataset.itemId + '_q' + card.dataset.cardQuality);
    if (!item?.pair) return;

    const newSell  = parseFloat(inp.value) || 0;
    const setupFee = state.sellMode === 'order' ? newSell * 0.025 : 0;
    const salesTax = newSell * state.taxPct / 100;
    const net      = newSell - item.pair.buy - setupFee - salesTax;
    const roi      = item.pair.buy > 0 ? net / item.pair.buy * 100 : 0;

    const netEl = card.querySelector('.net');
    if (netEl) {
      netEl.className = `net ${net >= 0 ? 'pos' : 'neg'}`;
      netEl.textContent = fmtNet(net);
    }
    const badge = card.querySelector('.roi-badge');
    if (badge) {
      badge.className = `roi-badge ${roiBadgeClass(roi)}`;
      badge.textContent = (roi >= 0 ? '+' : '') + roi.toFixed(1) + '%';
    }
  });

  // Pin button — event delegation on mosaic
  root.querySelector('#flip-mosaic')?.addEventListener('click', e => {
    const btn = e.target.closest('.pin-btn');
    if (!btn) return;
    e.stopPropagation();

    const card = btn.closest('[data-item-id]');
    if (!card) return;
    const itemId = card.dataset.itemId;
    const item   = renderedItems.get(itemId + '_q' + card.dataset.cardQuality);
    if (!item?.pair) return;

    const { pair, name, tier, enchant, sellVol } = item;
    const qty = Math.max(1, Math.round(sellVol ?? 1));

    addPin({
      id:         `fs_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      pinnedAt:   Date.now(),
      itemId,
      itemName:   name,
      tier,
      enchant,
      quality:    state.quality,
      buyCity:    pair.buyCity,
      sellCity:   pair.sellCity,
      buyPrice:   pair.buy,
      sellPrice:  pair.sell,
      qty,
      taxPct:     state.taxPct,
      sellMode:   state.sellMode,
      setupFee:   pair.setupFee,
      salesTax:   pair.salesTax,
      netPerUnit: pair.net,
      done:       false,
    });

    btn.classList.add('pinned');
    setTimeout(() => btn.classList.remove('pinned'), 800);
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────

export async function initFlip() {
  const root = document.getElementById('app-flip');
  if (!root) return;

  root.innerHTML = `
<div class="flip-card-wrap">
  <div class="flip-header">
    ${buildToolbar()}
    ${buildCatBar()}
  </div>
  <div class="flip-mosaic-wrap">
    <div class="flip-mosaic" id="flip-mosaic">
      <div class="flip-empty">Click <b>↻ Refresh</b> to load flip opportunities.</div>
    </div>
  </div>
</div>`;

  wireEvents(root);
}
