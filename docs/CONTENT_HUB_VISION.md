# AHO Content Hub Vision

> **One-line:** AHO is not a listings platform with social-share buttons bolted on. AHO is an **intelligent content distribution hub** for real-estate professionals — voice in, 21 platform-tuned posts out, every post links back to AHO.
>
> Authored by PO 2026-05-07 in chat; transcribed here so the vision survives session boundaries and can be shown to investors / new hires / anyone the PO wants to brief.

## Why this wins

The real-estate agent's bottleneck is **content distribution**, not lead handling. Industry data:
- Average agent spends **5-10 hours/week** writing social posts about their listings.
- Most posts go to one platform (FB) because writing for IG / LinkedIn / TikTok / Threads multiplies the time. Multi-platform reach = 3-5× more leads, but agents skip it.
- International buyers (Polish buying in Spain, Germans in Italy, Americans in DR) are systematically underserved because agents only post in their native language.

**Two specific problems we're solving:**

1. **The copy-paste curse.** Same listing, four platforms, each demands different length, tone, hashtag style. Agents either write once and post poorly across all, or write four times and burn the day.
2. **The language barrier.** Polish agent has a property worth $200k that would sell in 2 days to a Polish-American couple in Chicago. They never see it because the agent's posts are in PL only and no English version exists.

The Content Hub solves both with **one workflow per listing**: voice / URL / manual → AI generates 21 platform-tuned, locale-native posts → agent reviews and pushes.

## What's distinctive

Three things competitors (Hooquest, RealtyJuggler, Lofty's social tool) don't combine:

1. **Voice-first input** — agent leaves a property at 14:00, taps "New listing" on their phone, dictates: *"Mieszkanie 50 metrów, dwa pokoje, wysoki standard, blisko metra Wilanowska, 850 tysięcy"*. Whisper transcribes; Claude extracts structured facts; listing draft is on AHO before agent reaches their car.
2. **Locale voice (not translation)** — captions in PL read substance-first ("95 m², 3 pokoje, taras"), captions in ES read with calidez familiar, captions in EN lead with lifestyle. Each market gets its native marketer's voice. Google-Translate quality is a deal-breaker in real estate where buyers can spot it instantly.
3. **AHO URL embedded in every post** — every social post links back to `advertisehomes.online/{locale}/properties/{slug}`. Ten agents × 50 posts/month × 21 variants = 10,500 monthly inbound links to AHO. Brand authority + SEO + a built-in lead funnel that the agent can't leak to a competitor.

## The 6-step user flow

```
[1] CREATE LISTING — three input modes:
        (a) Voice note: agent dictates, Whisper STT + Claude extract → form pre-filled
        (b) URL paste:  competitor link (otodom, idealista, Zillow) → Claude scrape → form pre-filled
        (c) Manual:     traditional form fill, for agents who prefer typing
        ↓
[2] PUBLISH — agent reviews, edits, hits "Publish".
    Listing goes live at advertisehomes.online/{locale}/properties/{slug}-{shortId}.
        ↓
[3] GENERATE SOCIAL — "Generate social posts" button on the published listing.
    Claude produces 21 caption variants:
        3 platforms × 7 locales = FB / IG-feed / IG-Reel / LinkedIn × EN/ES/PL/PT/DE/FR/IT
    Every variant:
        - Includes the listing's full advertisehomes.online URL
        - Sticks to 70% of platform's "Read more" cutoff (text body only;
          URL + hashtags don't eat the budget)
        - Tone: Investment (default) — selectable in v2 (Luxury / Family)
        ↓
[4] PREVIEW + EDIT — agent sees a 21-cell grid, can tweak any cell.
        ↓
[5] PUSH — one-click publish to FB/IG/LinkedIn (Sprint 2, after Meta App Review).
    Until then: "Copy to clipboard" button per variant.
        ↓
[6] PERFORMANCE — dashboard shows reach, leads, CPL per platform per listing.
    AI surfaces: "Variant B on IG generated 3× more leads than Variant A — keep using B."
```

## Architecture

```
                      [Agent — web or PWA]
                              │
            ┌─────────────────┼──────────────────┐
            │                 │                  │
        Voice note         URL paste         Manual form
            │                 │                  │
        Whisper STT       Page scrape           direct
            │                 │                  │
            └─────────────────┴──────────────────┘
                              │
                     [Claude — fact extraction]
                              │
              { title, price, beds, baths, area,
                location, amenities, description }
                              │
                              ↓
                    [AHO listing form pre-filled]
                              │
                  Agent reviews → Publish (Save)
                              │
                              ↓
              [DB row + permanent AHO URL created]
                              │
                              ↓
              [Agent clicks "Generate social posts"]
                              │
                              ↓
                  [Claude — 21 caption variants]
                              │
                  3 platforms × 7 locales
                  Tone: Investment
                  70% char rule
                  AHO URL embedded
                              │
                              ↓
                   [Agent — preview + edit grid]
                              │
                ┌─────────────┴────────────┐
                │                          │
        Sprint 1 today:             Sprint 2 future:
       Copy → paste manual          Click "Publish all"
       to FB/IG/LinkedIn           → Meta API + LinkedIn API
                                    → posts go live automatically
                                          │
                                          ↓
                                  [Performance dashboard]
                                  reach / leads / CPL / A-B
```

## Three layers of personalization

Every caption is tuned along three axes:

1. **Platform constraints** — FB conversational 80-180 chars; IG visual + 5-8 hashtags 120-220 chars; IG Reel punchy 60-120 chars + 8-12 hashtags; LinkedIn professional 250-450 chars + investor angle.
2. **Locale voice** — each of the 7 AHO locales has its own emotional register codified in the system prompt. PL = practical / substance-first. EN = lifestyle. ES = calidez familiar. DE = specs + precision. FR = élégance. IT = emozione + bellezza. PT = warmth + family.
3. **Tone of voice** — Sprint 1 default is **Investment** (rental yield, ROI signals, capital appreciation, market positioning). Sprint 2 adds **Luxury** (exclusivity, prestige, craftsmanship) and **Family** (community, schools, safety, room for kids).

## Cost discipline

Per-listing AI cost at scale:

| Step | Provider | Per-call cost |
|---|---|---|
| Voice transcription | OpenAI Whisper | ~$0.006 / minute audio |
| Fact extraction (URL/voice → JSON) | Claude Sonnet 4.6 | ~$0.005 / call |
| Caption generation (21 variants) | Claude Sonnet 4.6 | ~$0.05 / listing |
| **Per-listing total** | | **~$0.06** |

At $99/mo Pro Automation tier and 50 listings/month/agent → ~$3 / month AI cost / agent → **97% gross margin**. Healthy.

Vision AI on photos was considered (would let Claude add details like "dębowy parkiet" the agent forgot to mention) — **deferred** in v1 (PO 2026-05-07): adds $0.10-0.30 per listing, breaks the cost discipline, agent can manually add anything missed.

## Roadmap by sprint

### Sprint 1 — content engine (this week)

| # | Deliverable | Status |
|---|---|---|
| 1 | Multi-locale, multi-platform Claude prompts (per-locale voice + per-platform constraints) | ✅ shipped (`lib/ai/copywriter.ts`) |
| 2 | Standalone playground at `/dashboard/copywriter` for testing | ✅ shipped |
| 3 | URL-import flow — paste competitor URL → AHO listing pre-filled | Day 5 |
| 4 | Voice-input flow — Whisper STT → fact extraction → AHO listing pre-filled | Day 6 |
| 5 | Generate Social button on published listing — 21 variants with embedded AHO URL | Day 4 |
| 6 | 70% character rule + Investment tone hardcoded as default | Day 4 |

**Sprint 1 acceptance:** an agent can take a property they just visited, dictate a voice note, see a pre-filled listing form, hit Publish, click Generate Social, and get 21 ready-to-paste social posts in under 5 minutes.

### Sprint 2 — automation + mobile (weeks 2-4)

- PWA setup (service worker + manifest + offline read).
- Mobile-optimized recording UI: 1-button push-to-talk, photos, push notifications.
- Tone of voice selector (Luxury / Investment / Family).
- Auto-publish to FB / IG / LinkedIn (conditional on Meta App Review approval).
- Manual share fallback if Meta approval delayed: each variant has a "Share to FB" button that opens FB compose pre-populated with the caption.

### Sprint 3 — performance + scaling (weeks 5-9)

- FB Lead Ads webhook → AHO leads.
- Performance dashboard: reach, leads, CPL per platform per listing.
- A/B test framework: post 3 variants → AI surfaces winner.
- LinkedIn Marketing API integration (separate review process).
- Buffer / Make.com integration for agents who prefer those tools.
- Soft-beta launch: 3-5 real agents in DR + PL.

### Post-MVP (months 3-6)

- Native iOS + Android (justified by ARR ≥ $10k).
- TikTok Ads API.
- AI video generator (photos → 15-30s Reels with localized captions).
- Vision AI on photos (cost discipline reversal — only if proven gross-margin allows).
- Multi-tenant white-label for large agencies.

## Success metrics

| Metric | Sprint 1 target | Sprint 3 target | Year-1 target |
|---|---|---|---|
| Listings on AHO | 5 | 50 | 1,000 |
| Active Pro Automation agents | 1 | 5 | 50 |
| Listings created via voice/URL import | 0 | 20% | 60% |
| Social posts generated through AHO | 0 | 500/mo | 25,000/mo |
| Inbound links to advertisehomes.online from social | 0 | 500/mo | 25,000/mo |
| Average time from "new listing" to "posted on social" | n/a | 30 min | 5 min |

The third row is the leading indicator. Once 60% of new listings come in via voice or URL-import, the moat is built — agents who have integrated voice-into-their-day workflow don't switch to a competitor.

## Open questions

1. **STT provider:** Whisper (OpenAI) chosen for v1 (PO 2026-05-07). Reconsider Deepgram or AssemblyAI if Whisper accuracy on real-estate jargon (street names, room types, technical specs) drops below 90%.
2. **Tone-of-voice expansion timing:** Investment is the default. When do we add Luxury + Family selector? Sprint 2 if the soft-beta feedback says agents miss it; otherwise post-MVP.
3. **Vision AI cost trigger:** Re-evaluate when gross margin >95% sustained for 3 months and feedback says agents forget photo details often.
4. **Native mobile timing:** PWA covers 90% of the value. Native iOS/Android only when revenue justifies maintaining 3 codebases AND when push-notification fidelity / camera-API latency in PWA hurts conversion.
5. **Localization beyond 7:** AHO supports EN/ES/PL/PT/DE/FR/IT. Adding NL / RU / JA / ZH each requires a new locale voice guide written by a native marketer (not Claude alone). Plan: add one new locale per quarter post-launch, prioritize by where the soft-beta agents have foreign-buyer interest.

## North-star principle

**Every feature is judged by: does it move us closer to "agent dictates a voice note → 21 platform-tuned posts go live linking back to AHO in 60 seconds"?**

If a feature doesn't move us toward that flow, it's not Sprint 1-3 work. Save for post-MVP.
