// Composant tableau principal.
// Affiche les résultats de calcul (raffinage / transmutation) sous forme de lignes triables :
// ressource, tier, ville d'achat, ville de vente, profit/unité, profit/lot, ROI%.
// Se re-rend à chaque mise à jour des données ou changement de filtres.

import { RESOURCES, getIconUrl } from '../data/items.js';
import { CITIES }                 from '../data/cities.js';
import { getDataAge }             from '../api/albionApi.js';

// ── Constantes ────────────────────────────────────────────────────

const LOT = 10;

const REFINED_LABELS = {
  METALBAR: 'Metal Bar',
  PLANKS:   'Planches',
  CLOTH:    'Tissu',
  LEATHER:  'Cuir',
};

// Ordre d'affichage dans le tableau
const REFINED_ORDER = ['METALBAR', 'PLANKS', 'CLOTH', 'LEATHER'];

// Map select-value HTML → city id API (ex: 'fortsterling' → 'Fort Sterling')
const CITY_SELECT_MAP = Object.fromEntries(
  CITIES.map(c => [c.id.toLowerCase().replace(/\s+/g, ''), c.id])
);
const ALL_CITY_IDS = CITIES.map(c => c.id);

// ── Helpers ───────────────────────────────────────────────────────

function parseItemId(itemId) {
  // T4_METALBAR            → { tier:4, refinedKey:'METALBAR', enchant:0 }
  // T4_METALBAR_LEVEL2@2   → { tier:4, refinedKey:'METALBAR', enchant:2 }
  const m = itemId.match(/^T(\d+)_([A-Z]+)(?:_LEVEL(\d+)@\d+)?$/);
  if (!m) return null;
  return { tier: Number(m[1]), refinedKey: m[2], enchant: m[3] ? Number(m[3]) : 0 };
}

function tierLabel(tier, enchant) {
  return enchant === 0 ? `T${tier}` : `T${tier}.${enchant}`;
}

function fmt(n) {
  if (!n || n === 0) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

// ── Calcul des opportunités ───────────────────────────────────────

/**
 * Pour chaque item (refinedKey × tier × enchant), cherche la meilleure paire
 * de villes (achat ≠ vente) en comparant sell_price_min(achat) vs buy_price_max(vente).
 *
 * @param {Array}  data          Résultat de fetchPrices
 * @param {string} buyCityFilter Valeur du select HTML ('all' | 'caerleon' | ...)
 * @param {string} sellCityFilter
 * @returns {Array} Lignes triées par tier > type > enchant
 */
export function computeMarketOpportunities(data, buyCityFilter, sellCityFilter) {
  // Index : itemId → cityId → entry
  const idx = {};
  for (const e of data) {
    (idx[e.item_id] ??= {})[e.city] = e;
  }

  const buyCities  = buyCityFilter  === 'all'
    ? ALL_CITY_IDS
    : [CITY_SELECT_MAP[buyCityFilter]].filter(Boolean);
  const sellCities = sellCityFilter === 'all'
    ? ALL_CITY_IDS
    : [CITY_SELECT_MAP[sellCityFilter]].filter(Boolean);

  // Une seule meilleure ligne par item
  const best = {};

  for (const [itemId, byCity] of Object.entries(idx)) {
    const parsed = parseItemId(itemId);
    if (!parsed || !REFINED_LABELS[parsed.refinedKey]) continue;

    for (const bc of buyCities) {
      const buyE = byCity[bc];
      if (!buyE?.sell_price_min) continue;

      for (const sc of sellCities) {
        if (sc === bc) continue;
        const sellE = byCity[sc];
        if (!sellE?.buy_price_max) continue;

        const buyPrice  = buyE.sell_price_min;
        const sellPrice = sellE.buy_price_max;
        const profit    = sellPrice - buyPrice;
        const roi       = buyPrice > 0 ? (profit / buyPrice) * 100 : 0;

        const key = `${parsed.refinedKey}.${parsed.tier}.${parsed.enchant}`;
        if (!best[key] || profit > best[key].profit) {
          best[key] = {
            itemId,
            ...parsed,
            buyCity:  bc,
            sellCity: sc,
            buyPrice,
            sellPrice,
            profit,
            roi,
            buyDate:  buyE.sell_price_min_date,
            sellDate: sellE.buy_price_max_date,
          };
        }
      }
    }
  }

  const rows = Object.values(best);
  rows.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    const ai = REFINED_ORDER.indexOf(a.refinedKey);
    const bi = REFINED_ORDER.indexOf(b.refinedKey);
    if (ai !== bi) return ai - bi;
    return a.enchant - b.enchant;
  });
  return rows;
}

// ── Rendu tableau Market ──────────────────────────────────────────

export function renderMarketTable(rows) {
  const tbody = document.getElementById('market-tbody');

  if (!rows.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="11" class="muted">Aucune opportunité trouvée.</td></tr>`;
    return;
  }

  const html = [];
  let currentTier = null;

  for (const r of rows) {
    // En-tête de groupe par tier
    if (r.tier !== currentTier) {
      html.push(
        `<tr class="group-row t${r.tier}"><td colspan="11">Tier ${r.tier}</td></tr>`
      );
      currentTier = r.tier;
    }

    const label    = tierLabel(r.tier, r.enchant);
    const iconUrl  = getIconUrl(r.itemId);
    const resLabel = REFINED_LABELS[r.refinedKey] ?? r.refinedKey;
    const pCls     = r.profit > 0 ? 'num-pos' : r.profit < 0 ? 'num-neg' : '';
    const rCls     = r.roi > 15   ? 'num-pos' : r.roi < 0    ? 'num-neg' : 'num-mid';
    const ageDate  = r.buyDate && r.sellDate
      ? (r.buyDate < r.sellDate ? r.buyDate : r.sellDate)
      : (r.buyDate ?? r.sellDate);
    const ageLabel = ageDate ? getDataAge(ageDate).label : '—';

    html.push(`<tr>
      <td>
        <span class="item-cell">
          <img class="item-icon" src="${iconUrl}" alt="" width="24" height="24"
               loading="lazy" onerror="this.style.visibility='hidden'" />
          <span>${resLabel}</span>
        </span>
      </td>
      <td style="text-align:center"><span class="tier-badge t${r.tier}">${label}</span></td>
      <td>${r.buyCity}</td>
      <td class="num">${fmt(r.buyPrice)}</td>
      <td>${r.sellCity}</td>
      <td class="num">${fmt(r.sellPrice)}</td>
      <td class="num ${pCls}">${fmt(r.profit)}</td>
      <td class="num ${pCls}">${fmt(r.profit * LOT)}</td>
      <td class="num ${rCls}">${r.roi.toFixed(1)}%</td>
      <td style="text-align:center"><span class="chip chip-hdv">HDV</span></td>
      <td class="num muted">${ageLabel}</td>
    </tr>`);
  }

  tbody.innerHTML = html.join('');
}

// ── Mise à jour stats + dot ───────────────────────────────────────

export function updateMarketStats(rows) {
  const best = rows.find(r => r.profit > 0);
  document.getElementById('stat-best').textContent    = best ? `${fmt(best.profit)}/u` : '—';
  document.getElementById('stat-count').textContent   = rows.filter(r => r.profit > 0).length;

  const timeStr = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  document.getElementById('stat-updated').textContent = timeStr;
  document.getElementById('status-dot').className     = 'dot fresh';
  document.getElementById('status-label').textContent = `màj ${timeStr}`;
}
