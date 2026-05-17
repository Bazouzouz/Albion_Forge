// API layer for the Albion Online Data Project (EU server).
// Fetches market prices for raw and refined resources, tiers T4–T8.
// Includes a 5-minute in-memory cache to avoid redundant requests.

import { allRawIds, allRefinedIds, T3_REFINED_IDS } from '../data/items.js';

const API_BASE      = 'https://europe.albion-online-data.com/api/v2/stats/prices';
const API_HISTORY   = 'https://europe.albion-online-data.com/api/v2/stats/history';
const TTL_MS        = 5 * 60 * 1000; // 5-minute cache
const CHUNK_SIZE    = 100;            // items per request (URL stays well under limits)
const CONCURRENCY   = 5;             // max simultaneous requests to avoid 429

// ─── Cache ────────────────────────────────────────────────────────────────────

const cache = new Map(); // key → { data, timestamp }

function cacheKey(itemIds, cities, quality = 1) {
  return [...itemIds].sort().join(',') + '|' + [...cities].sort().join(',') + '|q' + quality;
}

// ─── Concurrency limiter ──────────────────────────────────────────────────────
// Runs `tasks` (thunks returning promises) with at most `limit` in-flight at once.

async function withConcurrency(tasks, limit) {
  const results = new Array(tasks.length);
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const idx = next++;
      results[idx] = await tasks[idx]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

// ─── Internal fetch ───────────────────────────────────────────────────────────

async function fetchChunk(url, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url);
    if (res.ok) return res.json();
    if (res.status === 429 && attempt < retries) {
      await new Promise(r => setTimeout(r, (attempt + 1) * 1500));
      continue;
    }
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
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
export async function fetchPrices(itemIds, cities, quality = 1) {
  const key = cacheKey(itemIds, cities, quality);
  const hit = cache.get(key);

  if (hit && Date.now() - hit.timestamp < TTL_MS) {
    return hit.data;
  }

  const chunks = [];
  for (let i = 0; i < itemIds.length; i += CHUNK_SIZE) {
    chunks.push(itemIds.slice(i, i + CHUNK_SIZE));
  }

  let raw;
  try {
    const tasks   = chunks.map(chunk => () => fetchChunk(
      `${API_BASE}/${chunk.join(',')}?locations=${cities.join(',')}&qualities=${quality}`
    ));
    const results = await withConcurrency(tasks, CONCURRENCY);
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

/**
 * Fetches sales-history data for volume estimation.
 * Returns a nested map: itemId → city → avgDailyVolume (items sold per day, quality-filtered).
 *
 * Uses time-scale=24 (daily buckets). Averages the last `days` data points.
 *
 * @param {string[]} itemIds
 * @param {string[]} cities
 * @param {number}   quality  1=Normal … 5=Masterpiece
 * @param {number}   days     how many recent days to average (default 7)
 * @returns {Promise<Map<string, Map<string, number>>>}
 */
export async function fetchHistory(itemIds, cities, quality = 1, days = 7) {
  const key = `hist|${[...itemIds].sort().join(',')}|${[...cities].sort().join(',')}|q${quality}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.timestamp < TTL_MS) return hit.data;

  const chunks = [];
  for (let i = 0; i < itemIds.length; i += CHUNK_SIZE) {
    chunks.push(itemIds.slice(i, i + CHUNK_SIZE));
  }

  let raw;
  try {
    const tasks   = chunks.map(chunk => () => fetchChunk(
      `${API_HISTORY}/${chunk.join(',')}?locations=${cities.join(',')}&time-scale=24&qualities=${quality}`
    ).catch(() => []));
    const results = await withConcurrency(tasks, CONCURRENCY);
    raw = results.flat();
  } catch {
    if (hit) return hit.data;
    return new Map();
  }

  const data = new Map();
  for (const entry of raw) {
    if (quality !== 0 && entry.quality !== quality) continue;
    const recentData = entry.data.slice(-days);
    if (!recentData.length) continue;
    const total = recentData.reduce((s, d) => s + d.item_count, 0);
    const avg   = Math.round(total / recentData.length);
    if (!data.has(entry.item_id)) data.set(entry.item_id, new Map());
    data.get(entry.item_id).set(entry.location, avg);
  }

  cache.set(key, { data, timestamp: Date.now() });
  return data;
}

/** Clears the in-memory cache (useful for a forced refresh). */
export function clearCache() {
  cache.clear();
}
