// API layer for the Albion Online Data Project (EU server).
// Fetches market prices for raw and refined resources, tiers T4–T8.
// Includes a 5-minute in-memory cache to avoid redundant requests.

import { allRawIds, allRefinedIds, T3_REFINED_IDS } from '../data/items.js';

const API_BASE      = 'https://europe.albion-online-data.com/api/v2/stats/prices';
const API_HISTORY   = 'https://europe.albion-online-data.com/api/v2/stats/history';
const TTL_MS        = 5 * 60 * 1000; // 5-minute cache
const CHUNK_SIZE    = 200;            // items per request — 200 items × 8 cities = 1600 entries, well within URL limits
const CONCURRENCY   = 3;             // max simultaneous requests
const REQ_DELAY_MS  = 80;            // ms delay between requests per worker to avoid 429

// ─── Date parsing ────────────────────────────────────────────────────────────

// Albion API returns "0001-01-01T00:00:00" as sentinel when a price field has no data.
function parseDate(str) {
  if (!str || str.startsWith('0001-01-01')) return null;
  return new Date(str);
}

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
      // Stagger requests: delay before every request except the very first
      if (idx > 0) await new Promise(r => setTimeout(r, REQ_DELAY_MS));
      results[idx] = await tasks[idx]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

// ─── Internal fetch ───────────────────────────────────────────────────────────

async function fetchChunk(url, retries = 3) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url);
    if (res.ok) return res.json();
    if (res.status === 429 && attempt < retries) {
      await new Promise(r => setTimeout(r, (attempt + 1) * 2000));
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
 * @param {{ bypassCache?: boolean }} [opts]
 * @returns {Promise<Array<{ item_id, city, sell_price_min, sell_price_min_date, sell_price_max, sell_price_max_date, buy_price_min, buy_price_min_date, buy_price_max, buy_price_max_date }>>}
 */
export async function fetchPrices(itemIds, cities, quality = 1, { bypassCache = false } = {}) {
  const key = cacheKey(itemIds, cities, quality);
  const hit = cache.get(key);

  if (!bypassCache && hit && Date.now() - hit.timestamp < TTL_MS) {
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
      quality:              e.quality,
      sell_price_min:       e.sell_price_min,
      sell_price_min_date:  parseDate(e.sell_price_min_date),
      sell_price_max:       e.sell_price_max,
      sell_price_max_date:  parseDate(e.sell_price_max_date),
      buy_price_min:        e.buy_price_min,
      buy_price_min_date:   parseDate(e.buy_price_min_date),
      buy_price_max:        e.buy_price_max,
      buy_price_max_date:   parseDate(e.buy_price_max_date),
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
 * @param {{ bypassCache?: boolean }} [opts]
 * @returns {Promise<Record<string, Record<string, object>>>}
 */
export async function fetchPricesForResource(resourceType, cities, { bypassCache = false } = {}) {
  const t3Id    = T3_REFINED_IDS[resourceType];
  const itemIds = [
    ...allRawIds(resourceType),
    ...allRefinedIds(resourceType),
    ...(t3Id ? [t3Id] : []),
  ];
  const flat    = await fetchPrices(itemIds, cities, 1, { bypassCache });

  const grouped = {};
  for (const entry of flat) {
    if (!grouped[entry.item_id]) grouped[entry.item_id] = {};
    grouped[entry.item_id][entry.city] = {
      sell_price_min:       entry.sell_price_min,
      sell_price_min_date:  entry.sell_price_min_date,
      sell_price_max:       entry.sell_price_max,
      sell_price_max_date:  entry.sell_price_max_date,
      buy_price_min:        entry.buy_price_min,
      buy_price_min_date:   entry.buy_price_min_date,
      buy_price_max:        entry.buy_price_max,
      buy_price_max_date:   entry.buy_price_max_date,
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
export function getDataAge(date) {
  const ts      = date instanceof Date ? date.getTime() : new Date(date).getTime();
  const diffMs  = Date.now() - ts;
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
export async function fetchHistory(itemIds, cities, quality = 1, days = 7, { bypassCache = false } = {}) {
  const key = `hist|${[...itemIds].sort().join(',')}|${[...cities].sort().join(',')}|q${quality}`;
  const hit = cache.get(key);
  if (!bypassCache && hit && Date.now() - hit.timestamp < TTL_MS) return hit.data;

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
