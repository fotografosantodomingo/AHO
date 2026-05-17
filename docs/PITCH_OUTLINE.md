# AHO — investor pitch outline

> A 1-page narrative scaffold for cold outreach + first calls. Convert to slides in your own time; this is the story, not the deck.
>
> Audience: pre-seed / seed VCs writing $100k-$2M checks in vertical SaaS, AI-application, or real-estate-tech.
>
> Last update: 2026-05-17.

---

## One-sentence pitch

**AHO turns any real estate agent's listing URL into a complete, ready-to-publish, multi-language social-media campaign in 60 seconds — and publishes it to Facebook, Instagram, and LinkedIn in one click.**

---

## The wedge (this is the demo you lead with)

Open `https://advertisehomes.online/en/for-agents` in incognito. Paste any portal listing URL (otodom, idealista, Zillow, Rightmove). Sixty seconds later: 9 captions in 3 languages, 3 branded graphics in market-appropriate visual style, a one-click publish grid. No signup. No card. **Live working product, today.**

Recording a 60-second screencap of that flow is stronger than any deck.

---

## The market problem

- ~3M real estate agents globally (1.5M US, 100k+ in PL, 200k+ in DE, …) all need to post listings to multiple social channels in multiple languages.
- Today's path: agent manually writes captions in 1-2 languages, formats per platform, designs graphics in Canva, posts one platform at a time. **~45 minutes per listing.**
- Existing tools (Lofty, kvCORE, Followup Boss, AgencyAnalytics) are CRM-first; social-publishing is bolted on.
- Zero tools do **local-language nuance** at scale. Google-Translate Polish ≠ how a Polish agent writes.

## Our wedge

Paste URL → done in 60 seconds. The agent does no writing. We do the *localized* writing using per-market system prompts (US lifestyle / DE technical / IT cinematic / PL practical) — a defensible moat against "ChatGPT can do this" because vanilla LLMs default to English-flavored output regardless of locale.

## Why now

Three things converged in 2024-2026:
1. **Cheap multimodal AI** (Claude Haiku 4.5 + Sonnet 4.6) — the wedge wasn't economic in 2022.
2. **Real-estate agent SaaS at $99/mo became normal** (Lofty, kvCORE both shifted from $300+/mo enterprise to mid-market).
3. **Cloudflare Containers GA (2026)** — per-video Reels render at $0.05 instead of $0.50 via external services.

We're catching the wave with a non-US-default geography focus.

---

## What's built today (~3000 LOC of AI + social plumbing)

- **Free Audit wedge** — URL → 9 captions × 3 languages + 3 branded graphics, in 60s, no signup
- **Per-market context engine** — captions in Polish, German, French, Italian, Portuguese (not translated EN)
- **Per-market visual treatment** — DE Bauhaus / IT Tuscan / FR Parisian / PL clean palettes
- **One-click multi-platform publish** — Facebook Page + Instagram Business + LinkedIn from one approval grid
- **In-line OAuth UX** — connection state on the preview, no navigation needed
- **Cost observability** — every Anthropic call logged with per-market rollups
- **7-language localization** end-to-end (UI + content) — EN/ES/PL/PT/DE/FR/IT
- **Enterprise security baseline** — RLS on all tables, X-Robots-Tag on every authed surface, server-side auth gates

---

## The 90-day roadmap (`docs/SUPER_PRO_STAGE_1_PLAN.md`)

| Week | Phase | Status |
|---|---|---|
| 1 | Free Audit widget + 9 captions | ✅ shipped 2026-05-17 |
| 2 | Creative Factory (3 branded graphics per audit) | ✅ shipped 2026-05-17 |
| 3 | Approval grid + atomic 1-click publish | ✅ shipped 2026-05-17 |
| 4-5 | Auto-video engine (15-30s Reel per audit) — Super Pro tier differentiator | In progress |
| 6 | Multilingual context engine (per-market tone + jargon) | ✅ shipped early 2026-05-17 |
| 7-9 | Push to Facebook + Google Ads Manager — draft paid ads | Planned |

Day-63 target (~2026-07-17): cold visitor → Free Audit → signup → first paid ad live in <5 minutes.

---

## Business model

- **Agent** $29/mo — list properties on AHO marketplace
- **Pro Automation** $99/mo — one-click multi-platform social publishing (the wedge converts here)
- **Super Pro** $199-249/mo — adds auto-video Reels + paid-ad draft creation in Ads Manager
- **Enterprise / White-label** custom — for agencies + MLS partners (post-PMF)

Anchor pricing aligns with kvCORE / Lofty mid-market. Super Pro is where the AI gross margin works (per-audit cost ~$0.30; ~50 audits/month/agent = $15/mo cost / $200 ARPU = 92% margin).

---

## What we need

**Amount:** $___ (pre-seed / seed — fill in based on your runway target)

**Use of funds (illustrative):**
- 60% — engineering velocity (auto-video, Ads Manager push, AI customer service agent for the agents themselves)
- 25% — soft-beta cohort expansion (PL + DR + ES → DE + IT + FR)
- 10% — Meta + Google + LinkedIn API approval fees + legal
- 5% — runway buffer

**Milestones the round buys:**
- 30 paying agents by day 90
- $5k MRR by day 90
- Auto-video shipped + Super Pro tier live
- First white-label agency conversation by day 120

---

## Why us

- **Solo founder** in Dominican Republic, originally Poland — bilingual market understanding from day 1, not bolted on
- **Real estate / photography background** — knows the agent's actual workflow, not a tech-first guess
- **Building velocity** — Free Audit wedge + Creative Factory + multi-locale + approval grid + observability shipped in one day with AI co-development (proof of small-team capital efficiency)
- **Real product live at `advertisehomes.online`** — not a deck, a thing you can use right now

---

## The ask

15 minutes. Email me at `info@advertisehomes.online` or schedule directly: `[calendar link]`.

I'll send the 60-second product demo screencast in the reply.

---

## Conversion appendix — what I'm prepared to discuss

- Unit economics deep-dive (per-audit cost actually logged in `ai_generation_log` — happy to share the queries)
- Tech stack tradeoffs (Next.js + Supabase + Cloudflare; not novel; bet is on shipping speed)
- Why we chose Cloudflare over Vercel + AWS (cost predictability + global edge + Containers + Workers + R2 + Images all on one bill)
- Competitive map (kvCORE, Lofty, Followup Boss, AgencyAnalytics, Listings-to-Leads, Local Spaces, Wise Agent, …) and why each is a partial-overlap, not a head-on collision
- Multi-language moat defensibility (it's not just translation — it's per-market prompts + per-market visual + per-market jargon — measurable in side-by-side blind tests)
- Acquisition strategy (the Free Audit IS the acquisition surface — cold-outreach DM with "I built you a campaign in 60s for your latest listing")
- Why Dominican Republic + Poland as launch markets (lower CAC, less competition, real-estate-agent density per capita comparable to US, FX-favorable for ARR converted to USD)

---

## Customization checklist before sending

- [ ] Replace `$___` with your actual ask amount
- [ ] Add your calendar link (Cal.com / Calendly)
- [ ] Update Day-90 numbers if Meta BV slips and you can't get to 30 paying agents
- [ ] Record + link the 60-second screencast
- [ ] Triple-check the `advertisehomes.online` link works in incognito on mobile
