📋 Albion Forge — Contexte projet
Vue d'ensemble
Albion Forge est une web app de tracking de raffinage / transmutation pour le jeu Albion Online (serveur EU). Elle remplace un Google Sheets perso et est destinée à être partagée avec les guildmates. Le user (Baz) ne sait pas coder — l'architecture doit être propre, segmentée et compréhensible.
Workflow de dev :

Conversation Claude.ai (Opus 4.7) : design, mockups HTML autonomes, formulation des prompts
Claude Code (Sonnet 4.6) dans le terminal VSCode : exécute les implémentations dans le projet
Stack : Vite + JS vanilla, pas de framework lourd, tourne sur localhost:5173

Architecture du projet
C:\Users\Baz\albion-forge\
├── index.html
├── package.json
├── mockups/                   ← référence visuelle pour Claude Code
│   ├── catalogue-mockup.html
│   ├── transmute-mockup.html
│   ├── refining-mockup.html
│   └── orders-mockup.html
├── src/
│   ├── main.js                ← navigation tabs + init
│   ├── api/albionApi.js       ← fetch europe.albion-online-data.com + cache
│   ├── data/items.js          ← IDs API + noms (ORE/WOOD/FIBER/HIDE × T4-T8 × .0-.4)
│   ├── data/cities.js         ← villes EU
│   ├── logic/refining.js      ← calculs raffinage
│   ├── logic/transmute.js     ← calculs transmutation
│   └── ui/
│       ├── catalogue.js       ✅ implémenté
│       ├── transmute.js       ✅ implémenté
│       ├── refining.js        ✅ implémenté
│       └── orders.js          ✅ implémenté
└── styles/main.css
5 onglets

Market — vue d'ensemble des opportunités du marché (peu utilisé pour l'instant)
Transmute Checker — décide HDV / R1(T-1) / R2(E-1) pour acquérir chaque ressource brute au coût optimal
Refining Checker — calcule la rentabilité du raffinage (R1 sans cœur / R2 avec cœur de ville), prend les prix bruts du Transmute Checker
Orders — planificateur de session : liste d'items à produire, génère un "bill" consolidé (achats, transmutations, raffinages, cœurs)
Catalogue — config globale : prix API, premium, focus cost, transmute cost, prix des cœurs

Cascade des prix (architecture des dépendances)
Catalogue (API + premium + focus cost + transmute cost + heart prices)
    ↓
Transmute Checker (lit prix API + manual override + transmute cost)
    → exporte getEffectiveRawPrice() = coût optimal d'acquisition d'une RSS brute
    ↓
Refining Checker (lit getEffectiveRawPrice + heart price + focus cost + premium)
    → exporte getUnitInvest() = coût de raffinage par unité
    ↓
Orders (lit tout ce qui précède + chaque ordre a sa propre config focus/stack)
    → produit le bill consolidé
Mécaniques de jeu clés
Recettes de raffinage :
TierR1 (sans cœur)R2 (avec cœur)T42 raws + 1 raf T31 raw + 1 raf T3 + 1 cœurT53 raws + 1 raf T42 raws + 1 raf T4 + 1 cœurT64 raws + 1 raf T53 raws + 1 raf T5 + 1 cœurT75 raws + 1 raf T64 raws + 1 raf T6 + 1 cœurT86 raws + 1 raf T75 raws + 1 raf T7 + 1 cœur
RRR (Return Rate) — fixe car raffinage toujours en ville spécialisée :

Sans focus : 36.7%
Avec focus : 53.9%

Formules :

R1 = (raws_r1 × prix_brut + prix_raf_inf) × (1 - RRR)
R2 = (raws_r2 × prix_brut + prix_raf_inf + prix_cœur) × (1 - RRR)
Cost per focus = premium / 300 000 (300k focus/mois avec premium)
Equilibrium = unit_invest + (cost_per_focus × focus_cost_du_tier) si focus ON
Profit = (HDV_raffiné × (1 - taxe 3%)) - equilibrium
SPF (silver per focus) = profit / focus_cost

Règles importantes :

Pristine (.4) : R2 (avec cœur) NON disponible au raffinage → décision forcée à R1
Transmutation : R1 et R2 disponibles pour TOUS les enchants y compris .4
City Hearts : Mountainheart (Ore), Treeheart (Wood), Vineheart (Fiber), Beastheart (Hide)
Notation : T4 = sans enchant, T4.1, T4.2, T4.3, T4.4 = enchants 1 à 4

Stack Profit (concept-clé du Refining/Orders)
Toggle qui détermine si les bars intermédiaires sont raffinés par toi ou achetés HDV.
Exemple "Stack from T7" :

T7 raffiné par moi → input bar T6 acheté HDV (T7 est le premier de la chaîne)
T8 raffiné par moi → input bar T7 stacké ⬢ (= mon propre coût de raffinage T7)
T9+ → idem stacké

Règle technique : stackFlag = (tier > stackFromTier)

Pour Orders, chaque ordre a sa propre config focus/stack (pas global)

Design system

Theme : light épuré, fond gris #f0efed, cards blanches #ffffff
Accent : orange #D85A30
Couleurs tiers (group rows headers) :

T4 bleu #A8C7E8
T5 rose #E8A0A0
T6 pêche #F4C08A
T7 jaune #E8D870
T8 gris #C0C0C0


Chips décision : HDV gris, R1 violet #7B2FBE, R2 orange #E65C00
Tout le site est en ANGLAIS (labels, boutons, etc.)
Icônes items : https://render.albiononline.com/v1/item/{ID}.png?size=32
Tooltips au hover sur les valeurs calculées dans Refining et Transmute (formules détaillées)

API

Endpoint : https://europe.albion-online-data.com/api/v2/stats/prices/{ids}?locations={cities}&qualities=1
Cache : in-memory, 5 min de fraîcheur
Chunks : par 50 IDs max par requête (limite URL)
Données affichées : sell_price_min + sell_price_min_date (converti en age "2 min", "1 h", "stale", "old")