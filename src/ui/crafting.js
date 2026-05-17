import { TREE, CITY_BONUS, BAR_TO_RESOURCE, buildItemId, craftIconUrl, familyItemIds } from '../data/craftItems.js';
import { ARTIFACT_NAMES } from '../data/artifactNames.js';
import { RESOURCES }                from '../data/items.js';
import { fetchPrices, clearCache }  from '../api/albionApi.js';
import { calcCraftRow }             from '../logic/crafting.js';
import { getUnitInvest }            from './refining.js';
import { DEFAULT_CRR_NO_FOCUS, DEFAULT_CRR_FOCUS } from '../logic/crafting.js';
import { addPin as csAddPin } from '../logic/craftSession.js';

// Default artifact prices by type and tier (silver)
const ARTIFACT_DEFAULTS = {
  rune:      { 4: 18000,  5: 45000,  6: 95000,  7: 180000,  8: 420000  },
  soul:      { 4: 22000,  5: 55000,  6: 110000, 7: 220000,  8: 500000  },
  relic:     { 4: 30000,  5: 75000,  6: 150000, 7: 320000,  8: 720000  },
  avalonian: { 4: 90000,  5: 220000, 6: 480000, 7: 950000,  8: 2100000 },
  crystal:   { 4: 60000,  5: 140000, 6: 290000, 7: 580000,  8: 1300000 },
};

// ── State ─────────────────────────────────────────────────────────────────────

let currentPath  = ['mage', 'weapons', 'frostStaff'];
let currentTier  = 7;
let useFocus     = false;
let taxRate      = 3;
let crrNoFocus   = DEFAULT_CRR_NO_FOCUS;
let crrFocus     = DEFAULT_CRR_FOCUS;
let currentCity  = 'Caerleon';
let sellQuality  = 1;       // 1=Normal 2=Good 3=Outstanding 4=Excellent 5=Masterpiece
let rssSources   = {};      // { METALBAR: 'api'|'refining', ... } — per-RSS price source
let rssCities    = {};      // { METALBAR: 'Caerleon', ... } — buy city when source=api
let artifactCity = 'Caerleon';

let apiPrices         = {};  // itemId → sell_price_min (crafted items + bars)
let artifactApiPrices = {};  // artifactKey → price, fetched from API (session only, not persisted)
let sellOverrides     = {};  // itemId → manual sell price (session only, cleared on refresh)
const artifactPrices = loadArtifactPrices();

// Pin modal context — set when opening the modal
let pinCtx = null; // { item, tier, enchant }

const CITY_LIST  = ['Fort Sterling','Lymhurst','Bridgewatch','Martlock','Thetford','Caerleon','Brecilien','Black Market'];
const RSS_LABELS = { METALBAR: 'Bars', PLANKS: 'Planks', CLOTH: 'Cloth', LEATHER: 'Leather' };
const RSS_NAMES = { METALBAR: 'Metal Bars', PLANKS: 'Planks', CLOTH: 'Cloth', LEATHER: 'Leather' };
const RENDER    = 'https://render.albiononline.com/v1/item';

function cityOptsHTML(selected) {
  return CITY_LIST.map(c => `<option value="${c}"${c === selected ? ' selected' : ''}>${c}</option>`).join('');
}

// ── localStorage ──────────────────────────────────────────────────────────────

function lsGet(key, def)  { const v = localStorage.getItem(key); return v !== null ? v : def; }
function lsGetN(key, def) { const v = localStorage.getItem(key); if (v === null) return def; const n = Number(v); return isNaN(n) ? def : n; }
function lsSet(key, val)  { localStorage.setItem(key, String(val)); }

function artifactKey(itemId, tier) { return `craft.artifact.${itemId}.T${tier}`; }

function loadArtifactPrices() {
  const result = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith('craft.artifact.')) result[k] = Number(localStorage.getItem(k));
  }
  return result;
}

function loadState() {
  const savedPath = localStorage.getItem('craft.path');
  if (savedPath) {
    try {
      const p = JSON.parse(savedPath);
      if (Array.isArray(p) && p.length === 3 && TREE[p[0]]?.categories[p[1]]?.families[p[2]]) {
        currentPath = p;
      }
    } catch (_) {}
  }
  currentTier = lsGetN('craft.tier', 7);
  if (![4,5,6,7,8].includes(currentTier)) currentTier = 7;
  useFocus    = lsGet('craft.useFocus',    '0') === '1';
  taxRate     = lsGetN('craft.tax',        3);
  crrNoFocus  = lsGetN('craft.crrNoFocus', DEFAULT_CRR_NO_FOCUS * 100) / 100;
  crrFocus    = lsGetN('craft.crrFocus',   DEFAULT_CRR_FOCUS    * 100) / 100;
  currentCity  = lsGet('craft.city',        'Caerleon');
  sellQuality  = lsGetN('craft.sellQuality', 1);
  if (![1,2,3,4,5].includes(sellQuality)) sellQuality = 1;
  rssSources   = JSON.parse(lsGet('craft.rssSources', '{}'));
  rssCities    = JSON.parse(lsGet('craft.rssCities',  '{}'));
  artifactCity = lsGet('craft.artifactCity', 'Caerleon');
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n) {
  if (n == null || isNaN(n)) return '—';
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  return Math.round(n).toLocaleString('en-US').replace(/,/g, ' ');
}

function fmtSigned(n) {
  if (n == null || isNaN(n)) return '—';
  const abs = fmt(Math.abs(n));
  return n >= 0 ? '+' + abs : '−' + abs;
}

function fmtPct(n) {
  if (n == null || isNaN(n)) return '—';
  return (n * 100).toFixed(1) + '%';
}

function getCurrentFamily() {
  const [s, c, f] = currentPath;
  return TREE[s].categories[c].families[f];
}

// ── Price lookups ─────────────────────────────────────────────────────────────

function getBarCost(rssKey, tier, enchant) {
  const resKey = BAR_TO_RESOURCE[rssKey];
  const src    = rssSources[rssKey] ?? 'api';
  if (src === 'refining') {
    const tk = enchant === 0 ? `T${tier}` : `T${tier}.${enchant}`;
    const r  = getUnitInvest(resKey, tk);
    if (r != null) return r;
  }
  const barId = RESOURCES[resKey]?.tiers[`T${tier}`]?.refined[enchant];
  return barId && apiPrices[barId] > 0 ? apiPrices[barId] : null;
}

function getSellPrice(itemId) {
  if (sellOverrides[itemId] != null) return sellOverrides[itemId];
  return apiPrices[itemId] > 0 ? apiPrices[itemId] : null;
}

function getArtifactCost(item, tier) {
  if (!item.artifact) return 0;
  const k = artifactKey(item.id, tier);
  return artifactPrices[k] ?? artifactApiPrices[k] ?? ARTIFACT_DEFAULTS[item.artifact]?.[tier] ?? 0;
}

// ── Tooltip builders ─────────────────────────────────────────────────────────

function buildTooltip(title, rows) {
  const header = title ? `<div class="tt-title">${title}</div>` : '';
  const body   = rows.map(([label, value]) => {
    if (label === '__formula__') return `<div class="tt-formula">${value}</div>`;
    return `<div><span class="tt-label">${label}</span> <span class="tt-value">${value}</span></div>`;
  }).join('');
  return header + body;
}

function costTooltip(item, bar1, bar2, artCost, crr, result) {
  const mat1 = item.qty * bar1;
  const mat2 = item.rss2 && bar2 ? item.qty2 * bar2 : 0;
  const u = s => `<span class="tt-unit"> · ${fmt(s)}/u</span>`;
  const rows = [
    [`${item.qty}× ${item.rss} :`, `${fmt(mat1)}${u(bar1)}`],
  ];
  if (item.rss2 && bar2) rows.push([`${item.qty2}× ${item.rss2} :`, `${fmt(mat2)}${u(bar2)}`]);
  rows.push(['CRR :', (crr * 100).toFixed(1) + '%']);
  if (artCost > 0) rows.push(['Artifact :', fmt(artCost)]);
  const crrPart = mat2 > 0
    ? `(${fmt(mat1)} + ${fmt(mat2)}) × (1 − ${(crr * 100).toFixed(1)}%)`
    : `${fmt(mat1)} × (1 − ${(crr * 100).toFixed(1)}%)`;
  const artPart = artCost > 0 ? ` + ${fmt(artCost)}` : '';
  rows.push(['__formula__', `${crrPart}${artPart} = ${fmt(result.craftCost)}`]);
  return buildTooltip('Craft Cost', rows);
}

function sellTooltip(sell, tax, result) {
  return buildTooltip('Sell Price', [
    ['Sell price :', fmt(sell)],
    ['Tax :', (tax * 100).toFixed(1) + '%'],
    ['__formula__', `${fmt(sell)} × (1 − ${(tax * 100).toFixed(1)}%) = ${fmt(result.saleAfterTax)}`],
  ]);
}

function profitTooltip(result, tax) {
  const sign = result.profit >= 0 ? '+' : '−';
  return buildTooltip('Profit', [
    ['Sale after tax :', fmt(result.saleAfterTax)],
    ['Craft cost :', fmt(result.craftCost)],
    ['__formula__', `${fmt(result.saleAfterTax)} − ${fmt(result.craftCost)} = ${sign}${fmt(Math.abs(result.profit))}`],
  ]);
}

function roiTooltip(result) {
  const sign = result.roi >= 0 ? '+' : '−';
  return buildTooltip('ROI', [
    ['Profit :', fmtSigned(result.profit)],
    ['Craft cost :', fmt(result.craftCost)],
    ['__formula__', `${fmtSigned(result.profit)} / ${fmt(result.craftCost)} = ${sign}${fmtPct(Math.abs(result.roi))}`],
  ]);
}

// ── RSS / Artifact buy-city selectors ────────────────────────────────────────

function renderRssCitySelectors() {
  const wrap = document.getElementById('cft-rss-cities-wrap');
  if (!wrap) return;

  const fam         = getCurrentFamily();
  const rssKeys     = [...new Set(fam.items.flatMap(i => [i.rss, i.rss2].filter(Boolean)))];
  const hasArtifact = fam.items.some(i => i.artifact);

  let html = '<div class="rfn-sep"></div>';
  for (const key of rssKeys) {
    const src  = rssSources[key] ?? 'api';
    const city = rssCities[key] || 'Caerleon';
    html += `<div class="toggle-group">
      <label>${RSS_LABELS[key] || key} buy</label>
      <div class="toggle-row" style="gap:4px">
        <div class="cft-segmented cft-mini-seg" data-rss-src="${key}">
          <div class="cft-seg${src === 'api'      ? ' on' : ''}" data-src="api">API</div>
          <div class="cft-seg${src === 'refining' ? ' on' : ''}" data-src="refining">Refine</div>
        </div>
        ${src === 'api' ? `<select class="rfn-city-select" id="cft-rss-city-${key}">${cityOptsHTML(city)}</select>` : ''}
      </div>
    </div>`;
  }
  if (hasArtifact) {
    html += `<div class="toggle-group">
      <label for="cft-artifact-city">Artifact buy</label>
      <select class="rfn-city-select" id="cft-artifact-city">${cityOptsHTML(artifactCity)}</select>
    </div>`;
  }
  wrap.innerHTML = html;

  for (const key of rssKeys) {
    wrap.querySelectorAll(`[data-rss-src="${key}"] .cft-seg`).forEach(seg => {
      seg.addEventListener('click', () => {
        rssSources[key] = seg.dataset.src;
        lsSet('craft.rssSources', JSON.stringify(rssSources));
        renderRssCitySelectors();
        if (seg.dataset.src === 'api') {
          doRefresh();
        } else {
          renderTable();
        }
      });
    });
    document.getElementById(`cft-rss-city-${key}`)?.addEventListener('change', e => {
      rssCities[key] = e.target.value;
      lsSet('craft.rssCities', JSON.stringify(rssCities));
      doRefresh();
    });
  }
  if (hasArtifact) {
    document.getElementById('cft-artifact-city')?.addEventListener('change', e => {
      artifactCity = e.target.value;
      lsSet('craft.artifactCity', artifactCity);
      doRefresh();
    });
  }
}

// ── Picker ────────────────────────────────────────────────────────────────────

function renderPicker() {
  renderPickerStation();
  renderPickerCategory();
  renderPickerFamily();
}

function renderPickerStation() {
  const [s] = currentPath;
  document.getElementById('cft-pick-station').innerHTML =
    Object.entries(TREE).map(([stKey, st]) =>
      `<button class="cft-pill${stKey === s ? ' active' : ''}" onclick="cftPickStation('${stKey}')">${st.emoji} ${st.label}</button>`
    ).join('');
}

function renderPickerCategory() {
  const [s, c] = currentPath;
  document.getElementById('cft-pick-category').innerHTML =
    Object.entries(TREE[s].categories).map(([catKey, cat]) =>
      `<button class="cft-pill${catKey === c ? ' active' : ''}" onclick="cftPickCategory('${catKey}')">${cat.label}</button>`
    ).join('');
}

function renderPickerFamily() {
  const [s, c, f] = currentPath;
  document.getElementById('cft-pick-family').innerHTML =
    Object.entries(TREE[s].categories[c].families).map(([famKey, fam]) =>
      `<button class="cft-pill${famKey === f ? ' active' : ''}" onclick="cftPickFamily('${famKey}')">${fam.name}</button>`
    ).join('');
}

window.cftPickStation = function(stKey) {
  const firstCat = Object.keys(TREE[stKey].categories)[0];
  const firstFam = Object.keys(TREE[stKey].categories[firstCat].families)[0];
  currentPath    = [stKey, firstCat, firstFam];
  lsSet('craft.path', JSON.stringify(currentPath));
  renderPicker();
  renderRecommendedCity();
  renderRssCitySelectors();
  renderTable();
};

window.cftPickCategory = function(catKey) {
  const [s] = currentPath;
  const firstFam = Object.keys(TREE[s].categories[catKey].families)[0];
  currentPath    = [s, catKey, firstFam];
  lsSet('craft.path', JSON.stringify(currentPath));
  renderPickerCategory();
  renderPickerFamily();
  renderRecommendedCity();
  renderRssCitySelectors();
  renderTable();
};

window.cftPickFamily = function(famKey) {
  const [s, c] = currentPath;
  currentPath = [s, c, famKey];
  lsSet('craft.path', JSON.stringify(currentPath));
  renderPickerFamily();
  renderRecommendedCity();
  renderRssCitySelectors();
  renderTable();
};

function renderRecommendedCity() {
  const [s, c, f] = currentPath;
  const fam  = TREE[s].categories[c].families[f];
  const city = CITY_BONUS[fam.bonusType];
  const tag  = document.getElementById('cft-recommended-tag');
  const txt  = document.getElementById('cft-recommended-text');
  if (city) {
    tag.style.display = '';
    txt.textContent   = `Best craft city: ${city} (+15% CRR)`;
  } else {
    tag.style.display = 'none';
  }
}

// ── Recipe tooltip ───────────────────────────────────────────────────────────

function recipeTooltip(item, tier) {
  const row = (id, qty, label) =>
    `<div class="cft-rtt-row">
      <img class="cft-rtt-icon" src="${RENDER}/${id}.png" alt="" onerror="this.style.visibility='hidden'" />
      <span class="cft-rtt-qty">${qty}×</span>
      <span class="cft-rtt-name">${label}</span>
    </div>`;
  let html = row(`T${tier}_${item.rss}`, item.qty, RSS_NAMES[item.rss] || item.rss);
  if (item.rss2) html += row(`T${tier}_${item.rss2}`, item.qty2, RSS_NAMES[item.rss2] || item.rss2);
  if (item.artifact) {
    const artName = ARTIFACT_NAMES[item.id] ?? (item.artifact === 'royal' ? 'Royal Sigil' : item.artifact);
    html += row(`T${tier}_ARTEFACT_${item.id}`, 1, artName);
  }
  return `<div class="cft-rtt">${html}</div>`;
}

// ── Table ─────────────────────────────────────────────────────────────────────

function renderTable() {
  const tbody = document.getElementById('cft-tbody');
  if (!tbody) return;

  const fam  = getCurrentFamily();
  const crr  = useFocus ? crrFocus : crrNoFocus;
  const tax  = taxRate / 100;
  const tier = currentTier;

  let html = '';
  for (const item of fam.items) {
    const isArtifact = !!item.artifact;
    const artCost    = getArtifactCost(item, tier);
    const artKey     = artifactKey(item.id, tier);
    const artOverrid = artifactPrices[artKey] != null;
    const rowCls     = isArtifact ? 'cft-artifact-row' : '';

    // Item cell
    const iconId  = buildItemId(item.id, tier, 0);
    let recipe    = `${item.qty}× ${item.rss}`;
    if (item.rss2) recipe += ` + ${item.qty2}× ${item.rss2}`;
    if (item.artifact) recipe += ` + 1× ${item.artifact}`;

    html += `<tr class="${rowCls}">
      <td>
        <div class="cft-item-cell has-tooltip">
          <img class="cft-item-icon" src="${craftIconUrl(item.id, tier, 0)}"
               alt="" loading="lazy" onerror="retryIcon(this,'visibility')" />
          <div>
            <div class="cft-item-name">${item.name}${isArtifact ? ` <span class="cft-artifact-badge">${item.artifact}</span>` : ''}</div>
            <div class="cft-item-meta">${recipe}</div>
          </div>
          <span class="tooltip left">${recipeTooltip(item, tier)}</span>
        </div>
        <button class="cft-add-btn" data-item-id="${item.id}" data-tier="${tier}" title="Add to Orders">+ Add to Orders</button>
      </td>`;

    // Artifact price column
    if (isArtifact) {
      html += `<td class="cft-col-artifact cft-artifact-cell">
        <input class="cft-artifact-input${artOverrid ? ' overridden' : ''}"
               type="number" min="0" step="100"
               value="${artCost || ''}"
               placeholder="default"
               data-artkey="${artKey}" data-itemid="${item.id}" data-tier="${tier}" />
      </td>`;
    } else {
      html += `<td class="cft-col-artifact cft-artifact-cell"><span class="cft-artifact-na">n/a</span></td>`;
    }

    // One column per enchant (0..4) — all enchants are craftable, .4 uses .4 resources
    for (let e = 0; e <= 4; e++) {
      const cellCls  = `cft-ench-cell e${e}`;

      const itemId   = buildItemId(item.id, tier, e);
      const bar1     = getBarCost(item.rss, tier, e);
      const bar2     = item.rss2 ? getBarCost(item.rss2, tier, e) : null;
      const sell     = getSellPrice(itemId);
      const result   = calcCraftRow(item.qty, bar1, item.qty2 || 0, bar2, artCost, sell, crr, tax);

      const profitCls = result?.profit != null ? (result.profit >= 0 ? 'profit-pos' : 'profit-neg') : 'muted';
      const roiStr    = result?.roi   != null ? fmtPct(result.roi) : '—';

      const overridden  = sellOverrides[itemId] != null;
      const sellRaw     = getSellPrice(itemId);   // already override-aware
      const sellInputVal = sellRaw != null ? sellRaw : '';

      const ttCost   = result ? `<span class="tooltip">${costTooltip(item, bar1, bar2, artCost, crr, result)}</span>` : '';
      const ttProfit = (result?.profit != null) ? `<span class="tooltip">${profitTooltip(result, tax)}</span>` : '';
      const ttRoi    = (result?.roi    != null) ? `<span class="tooltip left">${roiTooltip(result)}</span>` : '';

      html += `<td class="${cellCls}">
        <div class="cft-ench-tier">T${tier}.${e}</div>
        <div class="cft-ench-cost${result ? ' has-tooltip' : ''}">${result ? fmt(result.craftCost) : '—'}${ttCost}</div>
        <input class="cft-sell-input${overridden ? ' overridden' : ''}"
               type="number" min="0" step="100"
               value="${sellInputVal}"
               placeholder="—"
               data-itemid="${itemId}" />
        <div class="cft-ench-profit ${profitCls}${result?.profit != null ? ' has-tooltip' : ''}">${result?.profit != null ? fmtSigned(result.profit) : '—'}${ttProfit}</div>
        <div class="cft-ench-roi muted${result?.roi != null ? ' has-tooltip' : ''}">${roiStr}${ttRoi}</div>
      </td>`;
    }

    html += `</tr>`;
  }

  tbody.innerHTML = html || `<tr><td colspan="7" class="cft-empty">No items.</td></tr>`;

  // Sell price input listeners
  tbody.querySelectorAll('.cft-sell-input').forEach(input => {
    input.addEventListener('change', () => {
      const { itemid } = input.dataset;
      const val = input.value.trim();
      if (val === '') {
        delete sellOverrides[itemid];
        input.classList.remove('overridden');
      } else {
        sellOverrides[itemid] = Number(val);
        input.classList.add('overridden');
      }
      renderTable();
    });
  });

  // Artifact input listeners
  tbody.querySelectorAll('.cft-artifact-input').forEach(input => {
    input.addEventListener('change', () => {
      const { artkey } = input.dataset;
      const val = input.value.trim();
      if (val === '') {
        delete artifactPrices[artkey];
        localStorage.removeItem(artkey);
        input.classList.remove('overridden');
      } else {
        const n = Number(val);
        artifactPrices[artkey] = n;
        lsSet(artkey, n);
        input.classList.add('overridden');
      }
      renderTable();
    });
  });

  // Add-to-Orders button listeners (one per item row)
  tbody.querySelectorAll('.cft-add-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const fam  = getCurrentFamily();
      const tier = parseInt(btn.dataset.tier);
      const item = fam.items.find(i => i.id === btn.dataset.itemId);
      if (!item) return;
      openPinModal(item, tier);
    });
  });
}

// ── Refresh ───────────────────────────────────────────────────────────────────

async function doRefresh() {
  const btn = document.getElementById('cft-refresh-btn');
  if (btn) { btn.disabled = true; btn.textContent = '…'; }

  try {
    clearCache();
    sellOverrides = {};
    const fam  = getCurrentFamily();
    const tier = currentTier;

    // Sell prices → currentCity + sellQuality (bars and artifacts always quality 1)
    const sellIds  = familyItemIds(fam.items, tier);
    const sellFlat = await fetchPrices(sellIds, [currentCity], sellQuality);
    apiPrices = {};
    for (const entry of sellFlat) {
      if (entry.sell_price_min > 0) apiPrices[entry.item_id] = entry.sell_price_min;
    }

    // Bar prices grouped by buy city — only for api-sourced RSS
    const barsByCity = {};
    const rssKeys = [...new Set(fam.items.flatMap(i => [i.rss, i.rss2].filter(Boolean)))];
    for (const rssKey of rssKeys) {
      if ((rssSources[rssKey] ?? 'api') !== 'api') continue;
      const city   = rssCities[rssKey] || 'Caerleon';
      const resKey = BAR_TO_RESOURCE[rssKey];
      for (let e = 0; e <= 4; e++) {
        const id = RESOURCES[resKey]?.tiers[`T${tier}`]?.refined[e];
        if (id) (barsByCity[city] ??= []).push(id);
      }
    }
    for (const [city, ids] of Object.entries(barsByCity)) {
      const flat = await fetchPrices([...new Set(ids)], [city]);
      for (const entry of flat) {
        if (entry.sell_price_min > 0) apiPrices[entry.item_id] = entry.sell_price_min;
      }
    }

    // Artifact prices → artifactCity (session cache only, not persisted)
    artifactApiPrices = {};
    const artItems = fam.items.filter(i => i.artifact);
    if (artItems.length > 0) {
      const artIds = artItems.map(i => `T${tier}_ARTEFACT_${i.id}`);
      const flat   = await fetchPrices(artIds, [artifactCity]);
      for (const entry of flat) {
        if (entry.sell_price_min > 0) {
          const m = entry.item_id.match(/^T(\d+)_ARTEFACT_(.+)$/);
          if (m) artifactApiPrices[`craft.artifact.${m[2]}.T${m[1]}`] = entry.sell_price_min;
        }
      }
    }
  } catch (err) {
    console.error('[crafting] fetch error:', err);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '↻ Refresh'; }
  }

  renderTable();
}

// ── Focus UI ──────────────────────────────────────────────────────────────────

function updateFocusUI() {
  document.getElementById('cft-focus-state-on')?.classList.toggle('on', useFocus);
  document.getElementById('cft-focus-state-off')?.classList.toggle('on', !useFocus);
  const disp = document.getElementById('cft-crr-display');
  if (disp) disp.textContent = ((useFocus ? crrFocus : crrNoFocus) * 100).toFixed(1) + '%';
}

// ── Tier select colour ────────────────────────────────────────────────────────

function updateTierSelect() {
  const el = document.getElementById('cft-tier');
  if (!el) return;
  el.classList.remove('t4','t5','t6','t7','t8');
  el.classList.add(`t${currentTier}`);
}

// ── Pin modal ─────────────────────────────────────────────────────────────────

function recalcPinRecap() {
  if (!pinCtx) return;
  const { item } = pinCtx;
  const focus    = document.getElementById('cft-pin-focus')?.checked ?? false;
  const crr      = focus ? crrFocus : crrNoFocus;
  const qty      = Math.max(1, parseInt(document.getElementById('cft-pin-qty')?.value) || 1);
  const r1Price  = parseFloat(document.getElementById('cft-pin-r1-price')?.value) || 0;
  const r2Price  = item.rss2 ? (parseFloat(document.getElementById('cft-pin-r2-price')?.value) || 0) : null;
  const artPrice = item.artifact ? (parseFloat(document.getElementById('cft-pin-art-price')?.value) || 0) : 0;
  const sell     = parseFloat(document.getElementById('cft-pin-sell')?.value) || 0;
  const tax      = (parseFloat(document.getElementById('cft-pin-tax')?.value) || 0) / 100;

  const crrEl = document.getElementById('cft-pin-crr');
  if (crrEl) crrEl.textContent = (crr * 100).toFixed(1) + '%';

  const result = calcCraftRow(item.qty, r1Price || null, item.qty2 || 0, r2Price, artPrice, sell || null, crr, tax);

  const set   = (id, val)  => { const el = document.getElementById(id); if (el) el.textContent = val; };
  const setTT = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML   = html; };

  // CRR tooltip
  setTT('cft-pin-tt-crr', buildTooltip('CRR', [
    ['No focus',   (crrNoFocus * 100).toFixed(1) + '%'],
    ['With focus', (crrFocus   * 100).toFixed(1) + '%'],
    ['Active',     (crr        * 100).toFixed(1) + '%'],
  ]));

  if (result) {
    const net = result.profit ?? null;
    const roi = result.roi   ?? null;
    set('cft-pin-cost',       fmt(result.craftCost));
    set('cft-pin-revenue',    result.saleAfterTax != null ? fmt(result.saleAfterTax) : '—');
    set('cft-pin-net',        net != null ? fmtSigned(net) : '—');
    set('cft-pin-roi',        roi != null ? (roi * 100).toFixed(1) + '%' : '—');
    set('cft-pin-total-cost', fmt(result.craftCost * qty));
    set('cft-pin-net-total',  net != null ? fmtSigned(net * qty) : '—');

    // Cost/u tooltip
    const mat1 = item.qty  * r1Price;
    const mat2 = (item.rss2 && r2Price) ? item.qty2 * r2Price : 0;
    const crrRows = [[`${item.qty}× ${item.rss}`, fmt(mat1)]];
    if (item.rss2 && r2Price) crrRows.push([`${item.qty2}× ${item.rss2}`, fmt(mat2)]);
    crrRows.push(['CRR', (crr * 100).toFixed(1) + '%']);
    if (artPrice > 0) crrRows.push(['Artifact', fmt(artPrice)]);
    const base = mat2 > 0
      ? `(${fmt(mat1)} + ${fmt(mat2)}) × (1 − ${(crr*100).toFixed(1)}%)`
      : `${fmt(mat1)} × (1 − ${(crr*100).toFixed(1)}%)`;
    crrRows.push(['__formula__', `${base}${artPrice > 0 ? ` + ${fmt(artPrice)}` : ''} = ${fmt(result.craftCost)}`]);
    setTT('cft-pin-tt-cost', buildTooltip('Cost /u', crrRows));

    // Revenue/u tooltip
    if (result.saleAfterTax != null) {
      setTT('cft-pin-tt-revenue', buildTooltip('Revenue /u', [
        ['Sell price', fmt(sell)],
        ['Tax',        (tax * 100).toFixed(1) + '%'],
        ['__formula__', `${fmt(sell)} × (1 − ${(tax*100).toFixed(1)}%) = ${fmt(result.saleAfterTax)}`],
      ]));
    }

    // Net/u tooltip
    if (net != null) {
      setTT('cft-pin-tt-net', buildTooltip('Net /u', [
        ['Revenue /u', fmt(result.saleAfterTax)],
        ['Cost /u',    fmt(result.craftCost)],
        ['__formula__', `${fmt(result.saleAfterTax)} − ${fmt(result.craftCost)} = ${fmtSigned(net)}`],
      ]));
      setTT('cft-pin-tt-net-total', buildTooltip('Total net', [
        ['Net /u', fmtSigned(net)],
        ['Qty',    String(qty)],
        ['__formula__', `${fmtSigned(net)} × ${qty} = ${fmtSigned(net * qty)}`],
      ]));
    }

    // Total cost tooltip
    setTT('cft-pin-tt-total-cost', buildTooltip('Total cost', [
      ['Cost /u', fmt(result.craftCost)],
      ['Qty',     String(qty)],
      ['__formula__', `${fmt(result.craftCost)} × ${qty} = ${fmt(result.craftCost * qty)}`],
    ]));

    // ROI tooltip
    if (roi != null) {
      setTT('cft-pin-tt-roi', buildTooltip('ROI', [
        ['Net /u',  fmtSigned(net)],
        ['Cost /u', fmt(result.craftCost)],
        ['__formula__', `${fmtSigned(net)} / ${fmt(result.craftCost)} = ${(roi*100).toFixed(1)}%`],
      ]));
    }
  } else {
    ['cft-pin-cost','cft-pin-revenue','cft-pin-net','cft-pin-roi','cft-pin-total-cost','cft-pin-net-total'].forEach(id => set(id, '—'));
  }

  const submitBtn = document.getElementById('cft-pin-submit');
  if (submitBtn) submitBtn.disabled = qty < 1;
}

function updateModalPrices(enchant) {
  if (!pinCtx) return;
  const { item, tier } = pinCtx;
  const setTT = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };

  // R1
  const r1Label = document.getElementById('cft-pin-r1-label');
  if (r1Label) r1Label.textContent = `${item.rss} /u`;
  document.getElementById('cft-pin-r1-price').value = getBarCost(item.rss, tier, enchant) ?? '';
  const r1Src    = rssSources[item.rss] ?? 'api';
  const r1City   = rssCities[item.rss] || 'Caerleon';
  const r1ItemId = RESOURCES[BAR_TO_RESOURCE[item.rss]]?.tiers[`T${tier}`]?.refined[enchant] ?? '—';
  setTT('cft-pin-tt-r1', buildTooltip(item.rss, [
    ['Source',     r1Src === 'api' ? `API · ${r1City}` : 'Refining tab'],
    ['Item',       r1ItemId],
    ['Qty/craft',  `${item.qty}×`],
  ]));

  // R2
  const r2Row = document.getElementById('cft-pin-r2-row');
  if (item.rss2) {
    const r2Label = document.getElementById('cft-pin-r2-label');
    if (r2Label) r2Label.textContent = `${item.rss2} /u`;
    document.getElementById('cft-pin-r2-price').value = getBarCost(item.rss2, tier, enchant) ?? '';
    const r2Src    = rssSources[item.rss2] ?? 'api';
    const r2City   = rssCities[item.rss2] || 'Caerleon';
    const r2ItemId = RESOURCES[BAR_TO_RESOURCE[item.rss2]]?.tiers[`T${tier}`]?.refined[enchant] ?? '—';
    setTT('cft-pin-tt-r2', buildTooltip(item.rss2, [
      ['Source',    r2Src === 'api' ? `API · ${r2City}` : 'Refining tab'],
      ['Item',      r2ItemId],
      ['Qty/craft', `${item.qty2}×`],
    ]));
    r2Row.hidden = false;
  } else {
    r2Row.hidden = true;
  }

  // Artifact
  const artRow = document.getElementById('cft-pin-art-row');
  if (item.artifact) {
    document.getElementById('cft-pin-art-price').value = getArtifactCost(item, tier) || '';
    const artItemId = `T${tier}_ARTEFACT_${item.id}`;
    setTT('cft-pin-tt-art', buildTooltip(item.artifact, [
      ['Source', `API · ${artifactCity}`],
      ['Item',   artItemId],
      ['Note',   'Not subject to CRR'],
    ]));
    artRow.hidden = false;
  } else {
    artRow.hidden = true;
  }

  document.getElementById('cft-pin-sell').value = getSellPrice(buildItemId(item.id, tier, enchant)) ?? '';
}

function openPinModal(item, tier) {
  pinCtx = { item, tier };

  document.getElementById('cft-pin-title').textContent = `${item.name} — T${tier}`;

  // Default enchant to .0
  document.querySelectorAll('#cft-pin-enchants .tier-btn').forEach(b => b.classList.toggle('on', b.dataset.e === '0'));

  document.getElementById('cft-pin-qty').value     = 1;
  document.getElementById('cft-pin-focus').checked = useFocus;
  document.getElementById('cft-pin-quality').value = sellQuality;
  document.getElementById('cft-pin-tax').value     = taxRate;

  updateModalPrices(0);
  recalcPinRecap();
  document.getElementById('cft-pin-modal-overlay').classList.add('show');
}

function closePinModal() {
  document.getElementById('cft-pin-modal-overlay').classList.remove('show');
  pinCtx = null;
}

function submitPinModal() {
  if (!pinCtx) return;
  const { item, tier } = pinCtx;
  const enchant = parseInt(document.querySelector('#cft-pin-enchants .tier-btn.on')?.dataset.e ?? '0');

  const qty      = Math.max(1, parseInt(document.getElementById('cft-pin-qty').value) || 1);
  const city     = currentCity;
  const focus    = document.getElementById('cft-pin-focus').checked;
  const crr      = focus ? crrFocus : crrNoFocus;
  const r1Price  = parseFloat(document.getElementById('cft-pin-r1-price').value) || 0;
  const r2Price  = item.rss2 ? (parseFloat(document.getElementById('cft-pin-r2-price').value) || 0) : null;
  const artPrice = item.artifact ? (parseFloat(document.getElementById('cft-pin-art-price').value) || 0) : 0;
  const sell     = parseFloat(document.getElementById('cft-pin-sell').value) || 0;
  const quality  = parseInt(document.getElementById('cft-pin-quality').value);
  const tax      = (parseFloat(document.getElementById('cft-pin-tax').value) || 0) / 100;

  const result = calcCraftRow(item.qty, r1Price || null, item.qty2 || 0, r2Price, artPrice, sell || null, crr, tax);

  // Build mats array
  const r1ResKey = BAR_TO_RESOURCE[item.rss];
  const r1ItemId = RESOURCES[r1ResKey]?.tiers[`T${tier}`]?.refined[enchant];
  const r1BuyCity = (rssSources[item.rss] ?? 'api') === 'api' ? (rssCities[item.rss] || 'Caerleon') : null;
  const mats = [{ rssKey: item.rss, itemId: r1ItemId, qtyPerCraft: item.qty, unitPrice: r1Price, buyCity: r1BuyCity }];

  if (item.rss2) {
    const r2ResKey  = BAR_TO_RESOURCE[item.rss2];
    const r2ItemId  = RESOURCES[r2ResKey]?.tiers[`T${tier}`]?.refined[enchant];
    const r2BuyCity = (rssSources[item.rss2] ?? 'api') === 'api' ? (rssCities[item.rss2] || 'Caerleon') : null;
    mats.push({ rssKey: item.rss2, itemId: r2ItemId, qtyPerCraft: item.qty2, unitPrice: r2Price, buyCity: r2BuyCity });
  }

  const artifact = item.artifact
    ? { itemId: `T${tier}_ARTEFACT_${item.id}`, unitPrice: artPrice, buyCity: artifactCity }
    : null;

  const [s] = currentPath;
  const station = `${TREE[s].emoji} ${TREE[s].label}`;

  const snapshot = {
    id:          crypto.randomUUID(),
    itemId:      buildItemId(item.id, tier, enchant),
    name:        item.name,
    tier,
    enchant,
    station,
    stationCity: city,
    qty,
    useFocus:    focus,
    crrPct:      crr * 100,
    mats,
    artifact,
    sellPrice:   sell,
    sellQuality: quality,
    sellCity:    city,
    taxPct:      tax * 100,
    costPerUnit: result?.craftCost ?? 0,
    netPerUnit:  result?.profit    ?? 0,
    roiPct:      result?.roi       ?? null,
    done:        false,
    pinnedAt:    Date.now(),
  };

  csAddPin(snapshot);
  closePinModal();

  // Flash the clicked button
  const btn = document.querySelector(`.cft-add-btn[data-item-id="${item.id}"]`);
  if (btn) {
    btn.classList.add('added');
    setTimeout(() => btn.classList.remove('added'), 800);
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────

export async function initCrafting() {
  loadState();

  // Tier select
  const tierEl = document.getElementById('cft-tier');
  if (tierEl) {
    tierEl.value = currentTier;
    updateTierSelect();
    tierEl.addEventListener('change', () => {
      currentTier = parseInt(tierEl.value);
      lsSet('craft.tier', currentTier);
      updateTierSelect();
      doRefresh();
    });
  }

  // Sell city
  const cityEl = document.getElementById('cft-city');
  if (cityEl) {
    cityEl.value = currentCity;
    cityEl.addEventListener('change', () => {
      currentCity = cityEl.value;
      lsSet('craft.city', currentCity);
      doRefresh();
    });
  }

  // Sell quality
  const qualityEl = document.getElementById('cft-quality');
  if (qualityEl) {
    qualityEl.value = sellQuality;
    qualityEl.addEventListener('change', () => {
      sellQuality = parseInt(qualityEl.value);
      lsSet('craft.sellQuality', sellQuality);
      doRefresh();
    });
  }

  // Focus toggle
  const focusToggle = document.getElementById('cft-focus-toggle');
  if (focusToggle) {
    focusToggle.checked = useFocus;
    updateFocusUI();
    focusToggle.addEventListener('change', () => {
      useFocus = focusToggle.checked;
      lsSet('craft.useFocus', useFocus ? '1' : '0');
      updateFocusUI();
      renderTable();
    });
  }

  // CRR inputs
  const crrNfEl = document.getElementById('cft-crr-nofocus');
  if (crrNfEl) {
    crrNfEl.value = (crrNoFocus * 100).toFixed(1);
    crrNfEl.addEventListener('change', () => {
      crrNoFocus = (parseFloat(crrNfEl.value) || 0) / 100;
      lsSet('craft.crrNoFocus', crrNoFocus * 100);
      updateFocusUI();
      renderTable();
    });
  }
  const crrFEl = document.getElementById('cft-crr-focus');
  if (crrFEl) {
    crrFEl.value = (crrFocus * 100).toFixed(1);
    crrFEl.addEventListener('change', () => {
      crrFocus = (parseFloat(crrFEl.value) || 0) / 100;
      lsSet('craft.crrFocus', crrFocus * 100);
      updateFocusUI();
      renderTable();
    });
  }

  // Tax
  const taxEl = document.getElementById('cft-tax');
  if (taxEl) {
    taxEl.value = taxRate;
    const applyTax = () => {
      taxRate = parseFloat(taxEl.value) || 3;
      lsSet('craft.tax', taxRate);
      renderTable();
    };
    taxEl.addEventListener('input', applyTax);
    taxEl.addEventListener('change', applyTax);
  }

  // Refresh button
  document.getElementById('cft-refresh-btn')?.addEventListener('click', doRefresh);

  // Pin modal wiring
  document.getElementById('cft-pin-modal-overlay')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) closePinModal();
  });
  document.getElementById('cft-pin-cancel')?.addEventListener('click', closePinModal);
  document.getElementById('cft-pin-submit')?.addEventListener('click', submitPinModal);

  // Enchant selector in modal — refresh prices + recap on change
  document.querySelectorAll('#cft-pin-enchants .tier-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#cft-pin-enchants .tier-btn').forEach(b => b.classList.remove('on'));
      btn.classList.add('on');
      updateModalPrices(parseInt(btn.dataset.e));
      recalcPinRecap();
    });
  });

  // Live recap on any modal input change
  ['cft-pin-qty','cft-pin-focus','cft-pin-r1-price','cft-pin-r2-price',
   'cft-pin-art-price','cft-pin-sell','cft-pin-quality','cft-pin-tax'].forEach(id => {
    document.getElementById(id)?.addEventListener('input',  recalcPinRecap);
    document.getElementById(id)?.addEventListener('change', recalcPinRecap);
  });

  // Re-render when refining tab updates prices
  window.addEventListener('forge:prices-changed', () => renderTable());

  renderPicker();
  renderRecommendedCity();
  updateFocusUI();

  await doRefresh();
}
