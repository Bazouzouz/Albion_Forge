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

Albion Forge is a vanilla JS + Vite single-page app (no framework) for tracking refining and transmutation profits in Albion Online (EU server). All state lives in module-level variables and `localStorage`; there is no reactive framework or global store.

### Tab structure

Four lazy-loaded tabs, each initialized once on first visit:

| Tab (`data-tab`) | Init function | Source |
|---|---|---|
| `transmute` | `initTransmute()` | `src/ui/transmute.js` |
| `raffinage` | `initRefining()` | `src/ui/refining.js` |
| `orders` | `initOrders()` | `src/ui/orders.js` |
| `catalogue` | `initCatalogue()` | `src/ui/catalogue.js` |

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
```

### Event bus

`window.dispatchEvent(new CustomEvent('forge:prices-changed'))` — fired by Catalogue and Transmute when a price changes. Refining and Orders listen to re-render without a full refresh.

### Key files

- `src/data/items.js` — single source of truth for item IDs, tier/enchant structure, icon URLs, `T3_REFINED_IDS`
- `src/data/cities.js` — city list, API IDs, `BONUS_CITY` (which city grants the +15% RRR bonus per resource)
- `src/api/albionApi.js` — fetches from `europe.albion-online-data.com`; 5-minute in-memory cache; chunks requests at 50 items; `fetchPrices` (flat list), `fetchPricesForResource` (nested lookup by itemId → city)
- `src/logic/refining.js` — pure calculation functions (`calcRecipe`, `calcProfit`, `calcEquilibriumPrice`, `calcSPF`, `calcBatchInvestment`, `calcFullRow`)
- `src/logic/transmute.js` — pure memoized DAG solver (`buildTransmuteChain`, `calcSessionChain`)
- `src/main.js` — entry point; tab router; Market table refresh + client-side filter logic

### Item ID format

```
T{tier}_{KEY}                      → enchant 0  (e.g. T4_ORE, T5_METALBAR)
T{tier}_{KEY}_LEVEL{n}@{n}         → enchant n  (e.g. T4_ORE_LEVEL2@2)
```

Resource keys: `ORE` / `WOOD` / `FIBER` / `HIDE` (raw); `METALBAR` / `PLANKS` / `CLOTH` / `LEATHER` (refined).

### localStorage keys

| Prefix | Used by |
|---|---|
| `cat_*` | Catalogue (premium, heart prices, focus costs, transmute costs) |
| `refining.*` | Refining tab (resource, city, focus, stack settings, manual bar prices) |
| `transmute.manual.*` | Transmute tab (manual raw prices) |

### Deployment

`vite.config.js` sets `base: '/Albion_Forge/'` for GitHub Pages deployment. The `dist/` folder contains the last build.
