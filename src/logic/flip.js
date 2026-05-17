// Pure flip calculation functions.
// A "flip" = buy in city A at sell_price_min, sell in city B.
// Instant sell: sell to buy orders (buy_price_max). Sell order: list at sell_price_min.

/**
 * @param {number} buy     cost paid (sell_price_min in buy city)
 * @param {number} sell    revenue (buy_price_max or sell_price_min depending on mode)
 * @param {'instant'|'order'} sellMode
 * @param {number} taxPct  sales tax percentage
 * @returns {{ net, setupFee, salesTax, roiPct }}
 */
export function calcFlipRow(buy, sell, sellMode, taxPct) {
  const setupFee = sellMode === 'order' ? sell * 0.025 : 0;
  const salesTax = sell * taxPct / 100;
  const net      = sell - buy - setupFee - salesTax;
  const roiPct   = buy > 0 ? (net / buy) * 100 : 0;
  return {
    net:      Math.round(net),
    setupFee: Math.round(setupFee),
    salesTax: Math.round(salesTax),
    roiPct,
  };
}

/**
 * Find the best buy-city / sell-city pair for one item.
 *
 * @param {Map<string, object>} pricesByCity  city → { sell_price_min, sell_price_min_date, buy_price_max, buy_price_max_date }
 * @param {string[]} buyCities
 * @param {string[]} sellCities
 * @param {'instant'|'order'} sellMode
 * @param {number} taxPct
 * @returns {object|null}
 */
export function bestPair(pricesByCity, buyCities, sellCities, sellMode, taxPct) {
  let best = null;

  for (const buyCity of buyCities) {
    const bd = pricesByCity.get(buyCity);
    if (!bd?.sell_price_min) continue;

    for (const sellCity of sellCities) {
      if (sellCity === buyCity) continue;
      const sd = pricesByCity.get(sellCity);
      if (!sd) continue;

      const sell = sellMode === 'instant' ? sd.buy_price_max : sd.sell_price_min;
      if (!sell) continue;

      const calc = calcFlipRow(bd.sell_price_min, sell, sellMode, taxPct);
      if (!best || calc.net > best.net) {
        best = {
          buyCity, sellCity,
          buy:      bd.sell_price_min,
          buyDate:  bd.sell_price_min_date,
          sell,
          sellDate: sellMode === 'instant' ? sd.buy_price_max_date : sd.sell_price_min_date,
          ...calc,
        };
      }
    }
  }

  return best;
}

/**
 * Build the complete sorted list of flip opportunities.
 *
 * @param {Array<{itemId,name,category,tier,enchant}>} items
 * @param {Map<string, Map<string, object>>} priceMap   itemId → city → priceEntry
 * @param {Map<string, Map<string, number>>} volumeMap  itemId → city → avgDailyVolume
 * @param {object} filters
 * @returns {Array}
 */
export function buildFlipList(items, priceMap, volumeMap, filters) {
  const {
    buyCities, sellCities, sellMode, taxPct,
    tiers, enchants, categories,
    minRoi, minNet, maxAgeMin, showNoPrice,
  } = filters;

  const valid   = [];
  const noPrice = [];

  for (const item of items) {
    if (!tiers.includes(item.tier))          continue;
    if (!enchants.includes(item.enchant))    continue;
    if (!categories.includes(item.category)) continue;

    const pricesByCity = priceMap.get(item.itemId);

    if (!pricesByCity) {
      if (showNoPrice) noPrice.push({ ...item, pair: null, noPriceReason: 'no-data' });
      continue;
    }

    const pair = bestPair(pricesByCity, buyCities, sellCities, sellMode, taxPct);

    if (!pair) {
      if (showNoPrice) noPrice.push({ ...item, pair: null, noPriceReason: 'no-route' });
      continue;
    }

    const now        = Date.now();
    const buyAgeMin  = pair.buyDate  ? Math.floor((now - new Date(pair.buyDate ).getTime()) / 60_000) : Infinity;
    const sellAgeMin = pair.sellDate ? Math.floor((now - new Date(pair.sellDate).getTime()) / 60_000) : Infinity;
    const maxDataAge = Math.max(buyAgeMin, sellAgeMin);

    if (pair.net     < minNet)                       continue;
    if (pair.roiPct  < minRoi)                       continue;
    if (maxAgeMin > 0 && maxDataAge > maxAgeMin)     continue;

    const buyVol  = volumeMap?.get(item.itemId)?.get(pair.buyCity);
    const sellVol = volumeMap?.get(item.itemId)?.get(pair.sellCity);

    valid.push({ ...item, pair, buyAgeMin, sellAgeMin, buyVol, sellVol });
  }

  valid.sort((a, b) => b.pair.net - a.pair.net);

  return showNoPrice ? noPrice : valid;
}
