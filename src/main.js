// Icon retry — render.albiononline.com occasionally rate-limits or times out.
// Called via onerror on <img> tags; retries up to 2 times before hiding.
window.retryIcon = function(img, hideMode) {
  const src   = img.dataset.originalSrc || img.src;
  img.dataset.originalSrc = src;
  const tries = (img.dataset.iconRetries | 0) + 1;
  img.dataset.iconRetries = tries;
  if (tries <= 2) {
    setTimeout(() => { img.src = ''; img.src = src; }, tries * 1500);
  } else if (hideMode === 'display') {
    img.style.display = 'none';
  } else {
    img.style.visibility = 'hidden';
  }
};

// Point d'entrée principal de l'application.
// Initialise les composants UI (filtres, tableau, stats),
// orchestre les appels API et déclenche les calculs de profits.

import { RESOURCES, TIERS, ENCHANTS }             from './data/items.js';
import { CITY_IDS }                                from './data/cities.js';
import { fetchPrices, clearCache }                 from './api/albionApi.js';
import { computeMarketOpportunities,
         renderMarketTable,
         updateMarketStats }                       from './ui/table.js';
import { initCatalogue }                           from './ui/catalogue.js';
import { initTransmute }                           from './ui/transmute.js';
import { initRefining }                            from './ui/refining.js';
import { initOrders }                              from './ui/orders.js';
import { initCrafting }                            from './ui/crafting.js';
import { initFlip }                               from './ui/flip.js';

// ── Navigation ────────────────────────────────────────────────────

const tabs  = document.querySelectorAll('.nav-tab');
const views = document.querySelectorAll('.tab-view');

let catalogueLoaded  = false;
let transmuteLoaded  = false;
let refiningLoaded   = false;
let ordersLoaded     = false;
let craftingLoaded   = false;
let flipLoaded       = false;

function showTab(name) {
  tabs.forEach(t => {
    const on = t.dataset.tab === name;
    t.classList.toggle('active', on);
    t.setAttribute('aria-selected', on);
  });
  views.forEach(v => v.classList.toggle('active', v.id === `app-${name}`));
  history.replaceState(null, '', `#${name}`);

  if (name === 'catalogue' && !catalogueLoaded) {
    catalogueLoaded = true;
    document.getElementById('cat-refresh-btn')?.click();
  }

  if (name === 'transmute' && !transmuteLoaded) {
    transmuteLoaded = true;
    initTransmute().catch(err => console.error('[transmute] init error:', err));
  }

  if (name === 'raffinage' && !refiningLoaded) {
    refiningLoaded = true;
    initRefining().catch(err => console.error('[refining] init error:', err));
  }

  if (name === 'orders' && !ordersLoaded) {
    ordersLoaded = true;
    initOrders();
  }

  if (name === 'crafting' && !craftingLoaded) {
    craftingLoaded = true;
    // Ensure transmute + refining are loaded so Orders' craft bill has price data
    if (!transmuteLoaded) { transmuteLoaded = true; initTransmute().catch(e => console.error('[transmute]', e)); }
    if (!refiningLoaded)  { refiningLoaded  = true; initRefining().catch(e => console.error('[refining]', e)); }
    initCrafting().catch(err => console.error('[crafting] init error:', err));
  }

  if (name === 'flip' && !flipLoaded) {
    flipLoaded = true;
    initFlip().catch(err => console.error('[flip] init error:', err));
  }
}

tabs.forEach(tab => tab.addEventListener('click', () => showTab(tab.dataset.tab)));

initCatalogue();

const initialTab = location.hash.slice(1);
const validTabs  = [...tabs].map(t => t.dataset.tab);
showTab(validTabs.includes(initialTab) ? initialTab : 'transmute');

// ── Constantes Market ─────────────────────────────────────────────

// Mapping select-value → clé RESOURCES (pour construire les IDs d'items)
const REFINED_FILTER_MAP = {
  metalbar: 'ORE',
  planks:   'WOOD',
  cloth:    'FIBER',
  leather:  'HIDE',
};

// ── Build item IDs ─────────────────────────────────────────────────

/**
 * Construit la liste des item_ids API pour les ressources raffinées.
 * Utilise les IDs déjà générés dans RESOURCES (format correct : T4_METALBAR_LEVEL1@1).
 */
function buildMarketItemIds(resourceTypeFilter, tierFilter) {
  const resourceKeys = resourceTypeFilter === 'all'
    ? Object.keys(RESOURCES)
    : [REFINED_FILTER_MAP[resourceTypeFilter]].filter(Boolean);

  const tierKeys = tierFilter === 'all'
    ? TIERS.map(t => `T${t}`)
    : [`T${tierFilter}`];

  const ids = [];
  for (const rk of resourceKeys) {
    for (const tk of tierKeys) {
      const tierData = RESOURCES[rk]?.tiers[tk];
      if (!tierData) continue;
      ids.push(...Object.values(tierData.refined)); // enchants 0→4
    }
  }
  return ids;
}

// ── Filtres client-side ───────────────────────────────────────────

let cachedData = null;

function applyFilters() {
  if (!cachedData) return;

  const buyCity   = document.getElementById('cfg-city-buy').value;
  const sellCity  = document.getElementById('cfg-city-sell').value;
  const minProfit = Number(document.getElementById('filter-profit-min').value) * 1_000 || 0;

  let rows = computeMarketOpportunities(cachedData, buyCity, sellCity);
  if (minProfit > 0) rows = rows.filter(r => r.profit >= minProfit);

  renderMarketTable(rows);
  updateMarketStats(rows);
}

document.getElementById('cfg-city-buy').addEventListener('change',  applyFilters);
document.getElementById('cfg-city-sell').addEventListener('change', applyFilters);
document.getElementById('filter-profit-min').addEventListener('input', applyFilters);

document.querySelectorAll('.pill[data-filter="mode"]').forEach(pill => {
  pill.addEventListener('click', () => {
    document.querySelectorAll('.pill[data-filter="mode"]')
      .forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    applyFilters();
  });
});

// ── Actualiser ────────────────────────────────────────────────────

async function refresh() {
  const btn = document.getElementById('btn-refresh');
  btn.disabled    = true;
  btn.textContent = 'Chargement…';

  const resourceType = document.getElementById('cfg-resource-type').value;
  const tier         = document.getElementById('cfg-tier').value;

  try {
    clearCache(); // force fresh data à chaque refresh manuel
    const itemIds = buildMarketItemIds(resourceType, tier);
    cachedData    = await fetchPrices(itemIds, CITY_IDS);
    applyFilters();
  } catch (err) {
    console.error('[albionforge] fetch error:', err);
    document.getElementById('market-tbody').innerHTML =
      `<tr class="empty-row"><td colspan="11" class="muted">Erreur : ${err.message}</td></tr>`;
    document.getElementById('status-dot').className     = 'dot old';
    document.getElementById('status-label').textContent = 'erreur';
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Actualiser';
  }
}

document.getElementById('btn-refresh').addEventListener('click', refresh);
// Re-fetch si on change le type ou le tier (changement de scope des données)
document.getElementById('cfg-resource-type').addEventListener('change', refresh);
document.getElementById('cfg-tier').addEventListener('change', refresh);
