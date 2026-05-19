# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # dev server at http://localhost:5173
npm run build    # production build → dist/
npm run preview  # preview the production build
```

No test suite. Verify changes by running `npm run dev` and testing in a browser.

## Architecture

Albion Forge is a vanilla JS + Vite single-page app (no framework) for tracking refining, transmutation, and crafting profits in Albion Online (EU server). All state lives in module-level variables and `localStorage`; there is no reactive framework or global store.

### Tab structure

Six lazy-loaded tabs, each initialized once on first visit:

| Tab (`data-tab`) | Init function | Source |
|---|---|---|
| `transmute` | `initTransmute()` | `src/ui/transmute.js` |
| `raffinage` | `initRefining()` | `src/ui/refining.js` |
| `orders` | `initOrders()` | `src/ui/orders.js` |
| `catalogue` | `initCatalogue()` | `src/ui/catalogue.js` |
| `crafting` | `initCrafting()` | `src/ui/crafting.js` |
| `flip` | `initFlip()` | `src/ui/flip.js` |

The Market view (the default `#transmute` tab in older navigation — now just the `transmute` tab) is initialized inline in `src/main.js`.

### Price cascade (dependency order)

Data flows in one direction. Each layer reads from layers above it:

```
Catalogue  (API + localStorage: premium, focus cost, transmute costs, heart prices)
  ↓ exports: getPremiumPrice, getFocusCost, getTransmuteCost, getHeartPrice, getApiPrice
Transmute  (reads Catalogue; computes cheapest acquisition path via memoized DAG search)
  ↓ exports: getEffectiveRawPrice, getDecision, getAcquisitionChain
Refining   (reads Transmute + Catalogue; computes craft cost, profit, SPF)
  ↓ exports: getUnitInvest, getRefiningResult, getBestRecipeDecision
Orders     (reads Transmute + Catalogue + Refining; builds a full session bill)
Crafting   (reads Refining prices or API directly; computes craft cost, profit, ROI per enchant)
Flip       (independent — reads API directly; city-to-city arbitrage on weapons/armor/capes/bags)
```

### Event bus

`window.dispatchEvent(new CustomEvent('forge:prices-changed'))` — fired by Catalogue and Transmute when a price changes. Refining, Orders and Crafting listen to re-render without a full refresh.

`window.dispatchEvent(new CustomEvent('forge:flip-session-changed'))` — fired by `src/logic/flipSession.js` on every mutation (add/remove/update/clear). Orders listens to re-render the Flip session view. Do **not** emit `forge:prices-changed` from flip session code.

`window.dispatchEvent(new CustomEvent('forge:craft-session-changed'))` — fired by `src/logic/craftSession.js` on every mutation. Orders listens to re-render the Crafting session view. Do **not** emit `forge:prices-changed` from craft session code.

### Key files

- `src/data/items.js` — single source of truth for item IDs, tier/enchant structure, icon URLs, `T3_REFINED_IDS`
- `src/data/cities.js` — city list, API IDs, `BONUS_CITY` (which city grants the +15% RRR bonus per resource). Includes Black Market.
- `src/data/craftItems.js` — crafting tree: stations → categories → families → items. Exports `TIERS`, `BAR_TO_RESOURCE`, `CITY_BONUS`, `ARTIFACT_DEFAULTS`, `TREE`, `buildItemId()`, `craftIconUrl()`, `familyItemIds()`
- `src/data/flipItems.js` — 6 660 flip-eligible items built from TREE (weapons/armor, skip toolmaker) + capes (T4–T8, 29 patterns + special) + bags. Exports `FLIP_ITEMS` array and `FLIP_ITEM_MAP`. Categories: `weapons`, `head`, `chest`, `shoes`, `cape`, `bag`.
- `src/api/albionApi.js` — fetches from `europe.albion-online-data.com`; 5-minute in-memory cache; `CHUNK_SIZE=200`, `CONCURRENCY=3` with 80 ms inter-request delay (`REQ_DELAY_MS`); retry-on-429 (2 s / 4 s / 6 s backoff, 3 retries). `fetchPrices(itemIds, cities, quality=1)` (flat list), `fetchPricesForResource` (nested lookup by itemId → city), `fetchHistory(itemIds, cities, quality=1, days=7)` → `Map<itemId, Map<city, avgDailyVolume>>` (time-scale=24 daily buckets). `quality` param maps to API `&qualities=N` (1=Normal…5=Masterpiece).
- `src/ui/table.js` — Market tab rendering: `computeMarketOpportunities(data, buyCityFilter, sellCityFilter)` → sorted rows of best buy/sell city pairs for refined resources; `renderMarketTable(rows)` → fills `#market-tbody`; `updateMarketStats(rows)` → updates stat-best / stat-count / status-dot. Imported and called by `src/main.js`.
- `src/data/artifactNames.js` — exports `ARTIFACT_NAMES`: map of artifact base ID → display name (extracted from ao-bin-dumps items.txt 2026-05-16). Used in Crafting tab tooltips.
- `src/logic/flip.js` — pure flip calculation: `calcFlipRow(buy, sell, sellMode, taxPct)` → `{net, setupFee, salesTax, roiPct}`; `bestPair(pricesByCity, buyCities, sellCities, sellMode, taxPct)` → best route or null; `buildFlipList(items, priceMap, volumeMap, filters)` → sorted array (valid first, no-price last).
- `src/logic/flipSession.js` — pinned flip state: `addPin(snapshot)`, `removePin(id)`, `updatePin(id, changes)`, `clearAll()`, `clearDone()`, `getItems()`. Persists to `localStorage.flipSession.items`. Emits `forge:flip-session-changed` on every write. Deduplication: same `itemId+buyCity+sellCity` → qty is accumulated instead of creating a duplicate.
- `src/logic/craftSession.js` — pinned craft state: same API as flipSession. Persists to `localStorage.craftSession.items`. Emits `forge:craft-session-changed` on every write. Deduplication key: `itemId+stationCity+useFocus+r1Price+r2Price+artifactPrice+sellPrice`.
- `src/logic/refining.js` — pure calculation functions (`calcRecipe`, `calcProfit`, `calcEquilibriumPrice`, `calcSPF`, `calcBatchInvestment`, `calcFullRow`)
- `src/logic/transmute.js` — pure memoized DAG solver (`buildTransmuteChain`, `calcSessionChain`)
- `src/logic/crafting.js` — pure crafting profit calculation (`calcCraftRow`). Formula: `cost = (qty1*bar1 + qty2*bar2) * (1 - crr) + artifactCost`
- `src/ui/flip.js` — Flip tab UI: toolbar (buy/sell city multi-select, sell mode, quality, tier pills, enchant pills, tax%, min ROI, min net, max age, show-no-data), category chips, mosaic grid of flip cards with icon, route, price blocks, ROI badge, breakdown tooltip. Volume from `fetchHistory`. BUY_CITIES excludes Black Market; SELL_CITIES includes all cities. Pin button (`.pin-btn`) on each card calls `addPin()` with a full snapshot; `.pinned` CSS class applied for 800 ms as feedback.
- `src/ui/crafting.js` — full crafting UI: sidebar tree, enchant columns (.0–.4), artifact inputs, sell price inputs, per-RSS source+city selectors, sell quality selector, tooltips
- `src/main.js` — entry point; tab router; Market table refresh + client-side filter logic

### Item ID format

```
T{tier}_{KEY}                      → enchant 0  (e.g. T4_ORE, T5_METALBAR)
T{tier}_{KEY}_LEVEL{n}@{n}         → enchant n for raw/refined resources  (e.g. T4_ORE_LEVEL2@2)
T{tier}_{baseId}@{n}               → enchant n for crafted weapons/armor  (e.g. T7_MAIN_SWORD@3)
```

Resource keys: `ORE` / `WOOD` / `FIBER` / `HIDE` (raw); `METALBAR` / `PLANKS` / `CLOTH` / `LEATHER` (refined).

**Important:** crafted weapons/armor use `@N` suffix only (NOT `_LEVEL{N}@{N}`).

### Crafting tab details

- **Stations**: 🛡️ Warrior's Forge, 🏹 Hunter's Lodge, 🔮 Mage's Tower, 🪓 Toolmaker (single "Gathering Tools" family with all 4 tool items as rows — no sub-categories)
- **Enchants**: columns .0 to .4 (all craftable; .4 uses .4-enchanted resources, same recipe as .3)
- **CRR formula**: `cost = (qty1*bar1 + qty2*bar2) * (1 - crr) + artifactCost`. Artifacts are NOT subject to CRR.
- **Artifact types**: `rune` (Undead), `soul` (Keeper), `relic` (Hell), `avalonian`, `morgana`, `crystal`, `fey` (Duskweaver/Mistwalker/Feyscale), `royal`
- **Price source (per-RSS)**: each resource independently set to `api` (with per-city selector) or `refining` (uses Refining tab's `getUnitInvest`). State: `rssSources: { [rssKey]: 'api'|'refining' }`, persisted as `craft.rssSources`. Artifact city is always API.
- **Sell quality**: selector Normal→Masterpiece, passed as `quality` param to sell price fetch only. Bars and artifacts always quality=1. Persisted as `craft.sellQuality`.
- **Sell price**: pre-filled from API, manually overridable; resets on Refresh
- **Enchant column colors**: match in-game — .0 grey, .1 green, .2 blue, .3 purple, .4 gold
- **Tooltip system**: `buildTooltip(title, rows)` helper — same CSS pattern as other tabs (`.has-tooltip` + `<span class="tooltip">`) but with title header; forced below cells in the table. Cost tooltip shows `· X/u` unit price per material line.
- **Recipes**: verified against `ao-data/ao-bin-dumps items.json` (2026-05-16). Shapeshifter staffs also require `2× T3_ALCHEMY_RARE_*` (not tracked). Royal items modeled as set-item bars + `artifact: 'royal'` (token price entered manually).

### Flip tab details

- **Sell modes**: `instant` (sell to buy orders → `buy_price_max`) / `order` (list at `sell_price_min`; +2.5% setup fee)
- **Flip formula**: `setupFee = order ? sell*0.025 : 0; salesTax = sell*taxPct/100; net = sell - buy - setupFee - salesTax; roi = net/buy*100`
- **Default filters**: tiers `[5,6,7]`, enchants `[0,1,2,3]`, sellMode `instant`, quality `1`, taxPct `4`, minRoi `8`, minNet `0`, maxAgeMin `500`, showNoPrice `false`
- **No-price reasons**: `no-data` (no API entry for item at all) vs `no-route` (data exists but no valid buy→sell pair passes filters)
- **showNoPrice is exclusive**: when checked, shows ONLY items without price data (valid flips are hidden). `buildFlipList` returns `noPrice` array when `showNoPrice=true`, `valid` array otherwise.
- **Volume**: `fetchHistory` called in background after first render; cards show `buyVol / sellVol` (avg daily, quality-filtered)
- **Enchant pill colors** (hardcoded, match in-game): .0 neutral, .1 purple, .2 orange, .3 green, .4 red
- **City tag colors**: per-city dark tints hardcoded in CSS (no design-token equivalent exists)
- **Icon**: `render.albiononline.com/v1/item/${itemId}.png`; tier gradient overlay on `.fc-icon.t{tier}`
- **Editable sell price**: the sell price on each flip card is an `<input class="fc-sell-input">` — typing a new value live-recalculates net/ROI via event delegation on `#flip-mosaic`. Style: transparent background, bottom border only, no spinner arrows.
- **Pin to Orders**: clicking 📌 on a card snapshots the opportunity and calls `addPin()`. The snapshot freezes prices at click time — no live updates. `renderedItems` (module-level `Map<itemId, item>`) is rebuilt on every `render()` call to support pin lookup by `data-item-id` on the card element. Qty auto-set to `Math.max(1, round(sellVol ?? 1))` (daily volume).
- **Add to Orders (Crafting)**: each enchant cell (.0–.4) has a `+ Add` button (`.cft-add-btn`, disabled if no bar cost). Opens a singleton modal (`#cft-pin-modal-overlay`) pre-filled with the current cell's prices. Modal has live recap (cost/net/ROI/totals). Submit → `csAddPin(snapshot)` → 800 ms green flash on button. `pinCtx` module-level variable stores `{ item, tier, enchant }` for the open modal. Modal wired once in `initCrafting()`.
- **Header styling**: `.flip-header` uses `border-radius: 8px` + `overflow: hidden` so child backgrounds (toolbar, cat bar) clip cleanly to the rounded corners — same pattern as `.rfn-card` in Refining.

### Orders tab details

The Orders tab has three sub-sections selected by a segmented control at the top. Active section persisted in `orders.activeSection` (`'refining'` default | `'craft'` | `'flip'`).

- **Refining session** (`data-section="refining"`, default) — existing refine bill: orders list, shopping bill, transmutations, refining recipes, city hearts, focus cost, totals.
- **Crafting session** (`data-section="craft"`) — pinned crafts from the Crafting tab. Rendered by `renderCraftSession()` in `orders.js`, re-triggered on `forge:craft-session-changed`. Contains: totals bandeau (Total invest / Total revenue / Total net / Avg ROI), Clear done / Clear all, rows table (checkbox done, icon, name+meta, station city tag, qty input, cost/u, sell/u, net/u, total net, ROI, ↻ Refresh per row, delete). Refresh re-fetches API prices for each mat (by `buyCity`) and sell price (by `sellCity`+`sellQuality`), then recalculates and saves via `csUpdatePin`. Shopping list collapsible, grouped by `buyCity` (`null` → `🔨 To refine` group). Copy outputs `itemId\tqty` per line.
- **Flip session** (`data-section="flip"`) — pinned flips from the Flip tab. Rendered by `renderFlipSession()` in `orders.js`, re-triggered on `forge:flip-session-changed`. Contains: totals bandeau (Total invest / Total net / Avg ROI), Clear done / Clear all actions, rows table (checkbox done, icon, name, route, qty editable input, buy/sell/net-per-unit/total-net, delete), collapsible shopping list grouped by buyCity with Copy button per city. Done rows are grayed + struck through and excluded from totals.

### localStorage keys

| Prefix | Used by |
|---|---|
| `cat_*` | Catalogue (premium, heart prices, focus costs, transmute costs) |
| `refining.*` | Refining tab (resource, city, focus, stack settings, manual bar prices) |
| `transmute.manual.*` | Transmute tab (manual raw prices) |
| `craft.*` | Crafting tab (selected path, tier, city, quality, CRR, tax, focus, artifact prices, per-RSS sources, per-RSS buy cities) |
| `flipSession.items` | Flip session pinned opportunities (JSON array of pinned flip snapshots) |
| `craftSession.items` | Crafting session pinned snapshots (JSON array) |
| `orders.activeSection` | Active Orders sub-tab (`'refining'` default \| `'craft'` \| `'flip'`) |

### Branding

- **Nav**: `.nav-author` span inside `.nav-meta` — "by Bazouzouz", right-aligned, small italic, color `#9e958a`.
- **Footer**: `.footer-discord` span — "Discord : @bazouzouz", `margin-left: auto` pushes it to the far right. Same style as `.nav-author`.

### Deployment

`vite.config.js` sets `base: '/Albion_Forge/'` for GitHub Pages deployment. The `dist/` folder contains the last build.

> **Note:** Never push, create PRs, or upload to GitHub unless the user explicitly authorizes it in the conversation. When authorized, always ask for confirmation before executing the push.
