# PO Decisions — open queue

> Decisions I need from you to proceed. Batch through them when you have 10 minutes — sitting down to answer 5 in one go is cheaper than being interrupted mid-task by them.
>
> Each item: **what** I need, **why** I'm stuck, **my recommendation**, **deadline**. Reply with the option letter (or "other: ..." with your direction) — I'll go execute and remove the item from this list.
>
> I (Claude) keep this file accurate. When a new decision pops up during work, it lands here instead of breaking your flow with a mid-task question.

---

## 🔴 Blocking active work

*(Nothing right now — #5 answered 2026-05-18, see "Recently answered" below. Phase 1 of AI_AGENT_PLAN now in flight.)*

---

## 🟡 Coming up — answer when convenient

### 2. Super Pro tier price point (locks in before Phase 6)

**Question:** $199, $249, or $299/mo for the Super Pro tier? Annual discount %? Featured at hero on /pricing or quieter cross-sell?

**Why I'm stuck:** The pricing presence on /pricing changes the comparison framing (Pro Automation $99 vs Super Pro $X). The bigger the gap, the more I need to justify Super Pro with feature-density on the marketing page.

**Options:**
- **A — $199/mo, 17% annual discount, hero feature.** Aggressive, captures more conversions, lower margin.
- **B — $249/mo, 17% annual discount, hero feature.** **My recommendation.** Anchors above the perceived "premium" threshold; pairs naturally with auto-video being the value-multiplier.
- **C — $299/mo, 20% annual discount, quieter cross-sell on /pricing.** Highest margin but smaller addressable market; relies on Pro Automation $99 being the funnel entry.

**Deadline:** Before Phase 4 ships (need pricing for the /pricing page).

---

### 3. Pricing tier paywall structure (Phases 3-4)

**Question:** Captions free for anon, graphics gated on signup, video gated on Super Pro? Or everything free in preview, paywall only on publish?

**Why I'm stuck:** Today everyone sees all 9 captions + 3 graphics in the preview for free, with the publish CTA being the conversion. Phase 4 video changes the value-density of the preview significantly.

**Options:**
- **A — Captions free anon, graphics + video gated on signup.** Lower-friction signup pull; signup unlocks the visual stuff.
- **B — Everything visible in preview, paywall only on publish.** **My recommendation.** Reads as "we built you an entire campaign in 60s; pay $99 to push it live." Stronger psychological close.
- **C — Captions + graphics free anon, video gated on Super Pro tier.** Tiers the upgrade path: anon → see captions + graphics → sign up Pro → publish → upgrade Super Pro → unlock video.

**Deadline:** Before Phase 4 ships.

---

### 5. Google Ads OAuth + dev token (Phase 6 pre-req)

**Question:** Open a Google Ads Manager account + start the dev-token approval flow now, or defer until Phase 6 sprint?

**Why I'm stuck:** Google Ads dev-token approval takes 2-3 weeks. If we want Phase 6 to ship on its target week, the application has to start ~3 weeks before.

**My recommendation:** Start it now even though Phase 6 is several weeks out. Application is free; the clock just runs in the background.

**Action you take:**
1. Sign in to a Google account at https://ads.google.com/
2. Create a "Manager account" (top-right "Tools & Settings → Setup")
3. Apply for developer token (https://developers.google.com/google-ads/api/docs/get-started/dev-token)
4. List me as a co-applicant or paste me the credentials when granted

**Deadline:** Whenever you can spare 20 min in the dashboard.

---

## ✅ Recently answered

| Date | Decision | You chose |
|---|---|---|
| 2026-05-17 | Auto-video render engine — Remotion (A) vs FFmpeg-WASM (B) vs Creatomate (C)? | **A — Remotion in Cloudflare Containers** (~$0.05/video, predictable infra). Phase 4 building now in slices 4a-4d. |
| 2026-05-17 | Brand mark on every generated creative — bold footer vs subtle watermark vs per-agent toggle? | **Bold "Powered by AHO" footer bar** (recorded in `docs/DECISIONS.md`) |
| 2026-05-17 | Path A (finish Stage 1 Phase 3 first) vs Path B (start AI agent now)? | **Path A** — Phase 3 shipped same day as `c385f93` |
| 2026-05-18 | AI Customer-Service Agent — 9 design decisions (D1-D9) | **All defaults (A)** — chat-only v1, always-HITL, 360dialog BSP, shared AHO WABA, AI bundled into Pro Automation, Twilio+ConversationRelay+Claude voice stack, Cloudflare Email Routing inbound, hybrid email address scheme, org-isolated knowledge per agent. Plan accepted in full. |
| 2026-05-19 | Auto-video music library (Phase 4) — royalty-free (A) vs Epidemic Sound (B)? | **A — Royalty-free only** (Pixabay + YouTube Audio Library). Recorded in `docs/DECISIONS.md`. |

---

## How to use this file

- **Look here when I say "blocked on PO decision in #N."**
- **Batch answers.** Sit down with this file once a day or once every couple of days; answer 1-5 items at a time.
- **Reply format:** "PO decisions #1=A, #2=B, #4=A" — short. I'll execute and remove.
- **I keep this current.** When you answer, I move the item to "Recently answered" with a one-line summary and the date.
- **New decisions** that surface during work go straight here, not into chat as mid-task interruptions.
