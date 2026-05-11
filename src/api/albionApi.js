// API layer for the Albion Online Data Project (EU server).
// Fetches market prices for raw and refined resources, tiers T4–T8.
// Includes a 5-minute in-memory cache to avoid redundant requests.

import { allRawIds, allRefinedIds, T3_REFINED_IDS } from '../data/items.js';

const API_BASE  = 'https://europe.albion-online-data.com/api/v2/stats/prices';
const TTL_MS    = 5 * 60 * 1000; // 5-minute cache
const CHUNK_SIZE = 50;            // keep URLs within browser limits

// ─── Cache ────────────────────────────────────────────────────────────────────

const cache = new Map(); // key → { data, timestamp }

function cacheKey(itemIds, cities) {
  return [...itemIds].sort().join(',') + '|' + [...cities].sort().join(',');
}

// ─── Internal fetch ───────────────────────────────────────────────────────────

async function fetchChunk(itemIds, cities) {
  const url = `${API_BASE}/${itemIds.join(',')}?locations=${cities.join(',')}&qualities=1`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return res.json();
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetches market prices for a list of item IDs across the given cities.
 * - Splits large requests into chunks of 50 to stay within URL limits.
 * - Filters out entries where sell_price_min === 0 (no active listing).
 * - Falls back to stale cache if the API is unreachable.
 *
 * @param {string[]} itemIds  e.g. ["T4_ORE", "T4_ORE_LEVEL1@1"]
 * @param {string[]} cities   e.g. ["Thetford", "Fort Sterling"]
 * @returns {Promise<Array<{ item_id, city, sell_price_min, sell_price_min_date }>>}
 */
export async function fetchPrices(itemIds, cities) {
  const key = cacheKey(itemIds, cities);
  const hit = cache.get(key);

  if (hit && Date.now() - hit.timestamp < TTL_MS) {
    return hit.data;
  }

  // Split into chunks and fetch in parallel
  const chunks = [];
  for (let i = 0; i < itemIds.length; i += CHUNK_SIZE) {
    chunks.push(itemIds.slice(i, i + CHUNK_SIZE));
  }

  let raw;
  try {
    const results = await Promise.all(chunks.map(chunk => fetchChunk(chunk, cities)));
    raw = results.flat();
  } catch (err) {
    if (hit) {
      console.warn('[albionApi] API unreachable — serving stale cache:', err.message);
      return hit.data;
    }
    throw new Error(
      `Albion Data API is unreachable. Check your connection or try again later.\n(${err.message})`
    );
  }

  const data = raw
    .filter(e => e.sell_price_min > 0 || e.buy_price_max > 0)
    .map(e => ({
      item_id:              e.item_id,
      city:                 e.city,
      sell_price_min:       e.sell_price_min,
      sell_price_min_date:  e.sell_price_min_date,
      buy_price_max:        e.buy_price_max,
      buy_price_max_date:   e.buy_price_max_date,
    }));

  cache.set(key, { data, timestamp: Date.now() });
  return data;
}

/**
 * Fetches all raw + refined prices for one resource type in a single API call.
 * Returns a nested lookup: prices[item_id][city] = { sell_price_min, sell_price_min_date }
 *
 * @param {'ORE'|'WOOD'|'FIBER'|'HIDE'} resourceType
 * @param {string[]} cities
 * @returns {Promise<Record<string, Record<string, { sell_price_min: number, sell_price_min_date: string }>>>}
 */
export async function fetchPricesForResource(resourceType, cities) {
  const t3Id    = T3_REFINED_IDS[resourceType];
  const itemIds = [
    ...allRawIds(resourceType),
    ...allRefinedIds(resourceType),
    ...(t3Id ? [t3Id] : []),
  ];
  const flat    = await fetchPrices(itemIds, cities);

  const grouped = {};
  for (const entry of flat) {
    if (!grouped[entry.item_id]) grouped[entry.item_id] = {};
    grouped[entry.item_id][entry.city] = {
      sell_price_min:      entry.sell_price_min,
      sell_price_min_date: entry.sell_price_min_date,
    };
  }
  return grouped;
}

/**
 * Returns a human-readable age and freshness status for an API date string.
 *
 * Status thresholds:
 *   fresh  → < 1 hour   (label: "X min")
 *   stale  → 1 h–24 h   (label: "X h")
 *   old    → > 24 hours  (label: "X d")
 *
 * @param {string} dateString  ISO date returned by the API
 * @returns {{ label: string, status: 'fresh' | 'stale' | 'old' }}
 */
export function getDataAge(dateString) {
  const diffMs  = Date.now() - new Date(dateString).getTime();
  const diffMin = Math.floor(diffMs  / 60_000);
  const diffH   = Math.floor(diffMin / 60);
  const diffD   = Math.floor(diffH   / 24);

  if (diffMin < 60) return { label: diffMin <= 1 ? '1 min' : `${diffMin} min`, status: 'fresh' };
  if (diffH   < 24) return { label: `${diffH} h`,                              status: 'stale' };
  return               { label: `${diffD} d`,                                  status: 'old'   };
}

/** Clears the in-memory cache (useful for a forced refresh). */
export function clearCache() {
  cache.clear();
}
