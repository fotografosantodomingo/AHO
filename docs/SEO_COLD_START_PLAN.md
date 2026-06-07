# AHO SEO Cold-Start Plan — "Get Indexed Worldwide Without Burning the Domain"

> **Status:** Phase 0 BUILT (2026-06-07) — migration `0082`, Drizzle mirror, ingest script, Unique Value Contract + tests, RLS tests. Awaiting migration apply to run the ingest, then Phase 1. (Plan v2 after PO + partner review.)
> **Authored:** 2026-06-07, in chat with PO + PO's partner. This is the synthesized plan after two rounds of review.
> **Decision locked:** Market data source of truth = **real public datasets / APIs** (PO 2026-06-07). No invented statistics — ever (see §6, this is a hard rule).
> **Companion docs:** `CONTENT_HUB_VISION.md` (social-distribution engine — different system), `RISKS.md` R11 (test-fixture filtering precedent reused here), CLAUDE.md Hard Rule #8 (no fake data).

---

## 0. TL;DR

We solve AHO's **marketplace cold-start problem** (empty inventory → thin SEO → no discovery → can't recruit agents → stays empty) by building a **Location Knowledge Graph** that generates a durable, real-data SEO surface *before* we have inventory — without ever publishing fake listings or invented numbers.

The engine: real geo/market **entities** (country → city → neighborhood → building → agent → listing) drive auto-generated, richly **interlinked** content (market pages, buying guides, comparisons, agent service-area pages). Every page carries real, **cited** data and a **conversion CTA**. We scale in **quality- and indexation-gated phases**, never a 100k-page dump.

We **do not** seed fake listings (§2 Tier 3 explains why, and gives the removal architecture if PO overrides). We do not need to — the knowledge graph reaches the same SEO goal with zero teardown liability.

---

## 1. The problem (named precisely)

This is **not** an SEO problem. It is a **two-sided-marketplace cold-start problem**. Most founders solve it by faking inventory. We solve it by creating *real* search visibility (knowledge + market data) that has standalone value and survives the arrival of real inventory.

Key tension to respect throughout: **"indexed" and "removable" pull in opposite directions.** Once Google indexes a URL, removing it later has a cost. Therefore the plan is built so that *nothing we index ever needs removal* — everything is real.

---

## 2. The approach spectrum (safest → riskiest)

### Tier 0 — Real-data knowledge graph + programmatic pages  ✅ PRIMARY
Build the SEO surface from content that is real and never needs removal: market-data pages, buying guides, comparisons, agent service-area pages — all generated from the knowledge graph (§4), all citing real sources (§6).
**Removability:** N/A — nothing fake. **SEO risk:** none (this is what Google rewards for YMYL real estate).

### Tier 1 — Honest demand-capture / "claim this market" overlays  ✅ COMPANION
Real geographies, zero fake listings. Empty city pages convert into a signal: buyer waitlist ("notify me of listings in [city]") + agent recruitment ("be the first agent in [city]"). Every city page becomes SEO asset + lead-gen asset + recruitment asset simultaneously.
**Removability:** N/A — evolves into a real listings page when inventory arrives. **SEO risk:** none (pair with Tier 0 data so pages aren't thin).

### Tier 2 — Synthetic "sample" listings, NOINDEXED, gated  ⚠️ OPTIONAL, GUARDED
A few clearly-labeled *sample* listings + demo agent profile, shown only to logged-in prospective agents (or behind `/preview`), every page `noindex` + excluded from sitemaps. Purpose: show a recruited agent what a finished listing looks like. **Does not help SEO (by design); only human conversion.**
**Removability:** trivial + SEO-cost-free (Google never saw it). **SEO risk:** ~zero IF noindex + sitemap-exclusion + gating never leak.
**Note:** Allow only if recruited agents are literally bouncing on an empty dashboard. Still bends Hard Rule #8 in spirit — defensible only because noindexed + gated + labeled "sample."

### Tier 3 — Indexed synthetic listings  🛑 NOT RECOMMENDED (removal architecture below)
The original "seed fakes for SEO" idea. **Avoid.** If PO overrides after the partner consult, §7 specifies the strongest possible segregation + removal architecture — but read §3 first: "removable" bounds the damage, it does not make it free.

---

## 3. Why even a perfect Tier-3 removal still costs you (decision record)

Even with flawless segregation:
1. **Photos are unwinnable.** No real photos exist for fake homes; stock = reverse-image-searchable in one click; AI photos increasingly auto-detected. First buyer who checks → trust gone.
2. **Scaled-content-abuse (Google, Mar 2024)** targets mass pages produced to rank without unique value. Real estate is **YMYL** — highest scrutiny. Risk = manual action / algorithmic suppression, 6–12 mo recovery.
3. **The removal itself is a negative signal.** Mass 410-ing your "best" content teaches Google the domain churns fake pages.
4. **Legal:** advertising properties not for sale = false advertising in most markets; fake agent credentials touch licensing law; fake faces touch likeness rights.
5. **Two-class contamination** until fully torn down — every public surface must remember the filter (sitemap, city landing, agent profiles, by-bbox, search).

**Conclusion:** Tier 3 is insurance on a fire you choose to light. Tier 0+1 reach the same goal with no fire.

---

## 4. The Location Knowledge Graph (the moat — PO partner's keystone idea)

Model geography + market facts as **first-class entities**, then *generate content from the graph*. This gives internal linking, breadcrumbs, related pages, topical clusters, and schema **automatically** — and it's extremely hard for competitors to replicate.

### Entity hierarchy
```
Country
  └─ City
       └─ Neighborhood
            └─ Building / Development        (later phase)
                 └─ Listing  (real, from agents)
Agent ──────────── operates-in ───────────► City / Neighborhood   (service-area pages)
Developer ──────── builds ─────────────────► Building              (later phase)
```

### Proposed tables (extends existing `organizations` / `profiles` / `properties`)
| Table | Purpose | Key columns |
|---|---|---|
| `geo_countries` | one row per country | `iso2` (PK), `name_en/es/...`, `region`, `currency`, `centroid` (PostGIS), `source_id` |
| `geo_cities` | cities within a country | `id`, `country_iso2` (FK), `slug`, `name_*`, `centroid`, `population`, `admin_region`, `source_id` |
| `geo_neighborhoods` | neighborhoods within a city | `id`, `city_id` (FK), `slug`, `name_*`, `centroid`, `polygon` (optional), `source_id` |
| `geo_buildings` | named towers / developments (later) | `id`, `neighborhood_id` (FK), `developer_id`, `slug`, `name`, `year_built`, `source_id` |
| `market_metrics` | **provenanced** numeric facts | `entity_type`, `entity_id`, `metric` (median_price/rent_index/cost_of_living/tax_rate/...), `value`, `unit`, `as_of_date`, `source_id` |
| `content_guides` | generated/edited prose pages | `id`, `scope` (country/city/neighborhood/topic), `entity_id`, `locale`, `slug`, `title`, `body_html`, `status`, `source_ids[]` |
| `content_comparisons` | A-vs-B pages | `id`, `entity_a`, `entity_b`, `dimension`, `locale`, `body_html` |
| `data_sources` | **license + attribution registry** | `id`, `name`, `url`, `license`, `attribution_text`, `accessed_at` |

Every numeric claim on a page joins to `market_metrics → data_sources` so the page can render "Source: World Bank, 2024" — turning provenance into an E-E-A-T signal. No metric renders without a `source_id`.

### Page types the graph generates
1. **Country hub** — `/{locale}/real-estate/{country}` — overview, cities list, buying rules, taxes, links down.
2. **City hub** — extends existing `/{locale}/properties-in/{country}/{city}` — adds market data band + neighborhoods list + guide content + listings (when real).
3. **Neighborhood page** — `/{locale}/real-estate/{country}/{city}/{neighborhood}` — character, real stats, nearby POIs (OSM), listings when real.
4. **Market-report page** — focused data page ("Average apartment prices in {city}, {year}").
5. **Buying-guide page** — "Buying property in {country} as a foreigner" (legal/tax/visa, real + cited).
6. **Comparison page** — "{City A} vs {City B} for expats / taxes / investment."
7. **Agent service-area page** (Phase 4, when real agents exist) — "{Agent} — {specialty} in {city}" — every real agent = many legit nodes.

---

## 5. Internal linking & topical clusters (PO partner: lift 6/10 → 10/10)

The graph makes linking automatic. Rules:
- **Breadcrumbs** on every page from the hierarchy (already implemented via `buildBreadcrumbList`).
- **Hub-and-spoke**: each hub links to all children; each child links up to its hub + sideways to siblings (other neighborhoods in the city; other cities in the country).
- **Related content rail**: each page links to its market-report, buying-guide, and any comparison it participates in.
- **Contextual in-body links**: guide prose links named entities (cities, neighborhoods) to their pages.
- **hreflang reciprocity** across all 7 locales (pattern already in city page; extend graph-wide).
- **JSON-LD**: `Place`, `BreadcrumbList`, `ItemList` (have these), add `Dataset`/`Article` for market reports + guides, `RealEstateAgent` for service-area pages.

---

## 6. Data integrity — the hard rule neither original draft scored (CRITICAL)

**A hallucinated statistic is fake data in a YMYL context — the same trust crime as a fake listing, just less visible until a buyer or Google catches a wrong number.** Therefore:

> **HARD RULE (SEO):** No numeric market claim ships without a real source row in `data_sources` and an `as_of_date`. AI may *write prose around* real numbers; AI may **never** invent the numbers. Pages render their source attribution.

### Approved real sources (with licensing reality — verify before ingest)
| Source | Data | License | Notes |
|---|---|---|---|
| **World Bank Open Data** | country macro (population, GDP, urban %) | CC BY 4.0 | free API, clean attribution |
| **REST Countries** | country facts (capital, currency, languages) | free | backbone country attributes |
| **OECD / Eurostat** | house-price indices, demographics (OECD/EU) | free, attribution | best for EU/OECD hard numbers |
| **BIS residential property prices** | residential price indices (central-bank) | free | clean macro price trend data |
| **GeoNames** | city/admin hierarchy, population, coords | CC BY 4.0 | graph backbone for cities |
| **Wikidata / Wikipedia** | entity descriptions, geo hierarchy, coords | CC BY-SA 4.0 | facts not copyrightable; attribute; avoid copying substantial prose (share-alike) |
| **OpenStreetMap** (Nominatim/Overpass) | neighborhoods, POIs, schools, transit, coords | ODbL | attribution required; facts ok; respect ODbL |
| **National statistics offices** | official local market/tax data | per-source | cite explicitly per country |
| **Numbeo** | cost-of-living, price-to-income, rent index | ⚠️ paid/restricted API; ToS limits scraping | **license eval required before any use** |

**Licensing caveat:** OSM (ODbL) and Wikidata (CC-BY-SA) carry share-alike obligations on *databases/substantial prose*; individual *facts* aren't copyrightable, so we ingest facts + attribute, and never paste substantial copyrighted text. Numbeo needs a paid license — do not scrape.

---

## 7. IF PO overrides to Tier 3: segregation + removal architecture (insurance only)

1. **Immutable origin tag.** `data_origin` enum (`'real' | 'seed'`) on `organizations`, `profiles`, `properties`. Default `'real'`; seed stamped `'seed'` at creation.
2. **Reserved slug prefixes** (mirrors R11 test-fixture pattern): seed orgs `aho-seed-%`, seed listings `aho-seed-` prefix.
3. **One-way DB door.** CHECK/trigger so a `seed` row can never flip to `real`; RLS service-role-only on seed rows.
4. **Registry + log.** `seed_registry` table + `docs/SEED_LOG.md` + a memory file — the authoritative "real vs fake" list: `SELECT * FROM properties WHERE data_origin='seed'`.
5. **"Real agent claims a market" handoff.** When a real agent registers for a city, retire that city's seed rows *first*.
6. **Removal procedure:** soft-delete (status flip) → serve **HTTP 410 Gone** (not 404) on retired URLs → remove from `sitemap.xml` same deploy → submit removals via Search Console + IndexNow → hard-delete after Google drops them.
7. **Mandatory filtering everywhere:** sitemap, city landing, agent profiles, by-bbox API, search — all filter `data_origin`/slug, exactly like R11. Miss one → fakes leak.

---

## 8. Conversion architecture (PO partner: SEO that doesn't convert is vanity)

Funnel baked into every page, not bolted on:
```
Organic traffic
  → Country / City / Neighborhood / Guide page  (value + trust)
    → Lead magnet (market report PDF / "notify me of listings in {city}")
      → Buyer account  OR  Agent "claim this market"
        → Agent match / inquiry
          → Conversation → property inquiry → (real listing when inventory lands)
```
Every page ships with: primary CTA, email capture, account-creation path, and (where relevant) agent-request. Measured via existing `audit_funnel_events`.

---

## 9. Phased rollout — quality- & indexation-gated (the guardrail)

Authority *before* inventory (partner) — but **prove → index → scale**, never dump.

| Phase | Scope | Gate to advance |
|---|---|---|
| **0** ✅ built | Knowledge-graph schema (migration `0082`) + `data_sources` registry + ingest (`scripts/ingest-geo.ts`: REST Countries + World Bank) + Unique Value Contract + RLS/unit tests | schema shipped ✅ + RLS/unit tests written ✅ + ingest authored ✅ — **remaining: apply migration, then run ingest** |
| **1** | ~50 flagship pages: top countries/cities, hand-quality, real cited data, fully interlinked, full JSON-LD | submitted to Search Console; indexed + at least some ranking; no thin-content flags |
| **2** | ~500 country/city pages from the graph + buying guides | >70% indexed in GSC; no manual action; comparison pages added |
| **3** | Neighborhood + market-report pages (5k tier) via OSM/Eurostat | indexation rate holds; CTR/impressions trending up |
| **4** | Supporting articles (blog engine) + **agent service-area pages** as real agents arrive | real agents onboarding; conversion funnel measured |
| **5** | Real inventory backfills the demand captured in Tier 1 | — |

**Unique Value Contract (ships with the generator):** before a page type scales, each instance must contain real, specific, non-templated value (real stats / real local insight / real comparison). If two instances differ only by find-replacing the place name → it's a doorway page → it does not ship.

---

## 10. Tracking discipline (the "what's done / real vs fake" list PO asked for)

- This doc = the plan of record. Update phase table as phases land.
- `data_sources` table = provenance of every fact.
- If Tier 3 is ever used: `seed_registry` + `docs/SEED_LOG.md` = authoritative fake list for later removal.
- Per CLAUDE.md ritual: `STATUS.md` reflects current phase; `PROGRESS.md` logs each session; architectural choices → `DECISIONS.md`.

---

## 11. Scorecard alignment (vs PO partner's review)

| Dimension | Before | This plan |
|---|---|---|
| SEO safety / Google compliance | 10/10 | held — via Unique Value Contract + indexation gates + no invented data |
| Cold-start strategy | 9/10 | held |
| Internal linking | 6/10 | → 10/10 via knowledge graph (automatic) |
| Conversion architecture | 6/10 | → funnel-by-design (§8) |
| Entity SEO / knowledge graph | 7/10 | → centerpiece (§4) |
| **Data integrity** | unscored | → first-class hard rule (§6) — the gap in both original drafts |

---

## 12. Immediate next build (all real-data, zero risk)

Phase 0: author the knowledge-graph migrations (`geo_countries`, `geo_cities`, `geo_neighborhoods`, `market_metrics`, `data_sources`, `content_guides`) with paired RLS tests, + the first ingest pipeline (World Bank + GeoNames + REST Countries → countries & top cities). Then Phase 1's ~50 flagship pages.
