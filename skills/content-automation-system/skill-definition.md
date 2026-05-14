# End-to-End Content Pipeline Architect

## Skill

Designing zero-touch content distribution systems that turn a single creative
input (an image in a folder) into a published blog post + multi-platform
social posts, with a human review gate that takes one click.

## Problem this solves

Solo operators and small brands lose hours every week to the same workflow:
take photo → write blog post → write FB caption → write IG caption → write
LinkedIn caption → upload images everywhere → publish. This pipeline reduces
that to: **drop image in folder, click Approve in email**.

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Scheduler | Cloudflare Workers (Cron Triggers) | Free tier, no server, runs on edge, 15-min CPU on Paid |
| Source watcher | Google Drive API (service account) | Universal upload UX; users already know Drive |
| LLM | Anthropic Claude Vision (Haiku for speed, Sonnet/Opus for quality) | Multimodal in one call, structured JSON output |
| Persistence | Supabase (Postgres + Storage + Auth) | Free tier covers thousands of posts; REST is Worker-friendly |
| Email | Brevo (transactional API) | 300/day free, no Workers SDK needed |
| Site | Any SPA reading from Supabase | Site stays a pure consumer of the DB |
| Cross-post | Meta Graph API (FB Page + IG Business), LinkedIn UGC API | Native APIs only — no third-party SaaS |

## What this skill does NOT include

- **Content moderation beyond a human review email** — no AI safety filter,
  no toxicity check. The approve gate IS the moderation.
- **Auto-rendering of rich HTML blocks on the site** — pipeline emits HTML
  with CSS class hooks (`.data-callout`, `.pull-quote`, `.cta-block`) but the
  site must style them.
- **Scheduled / queued publishing** — approve = publish immediately. A
  `scheduled_at` field could be added on the blog_posts table for delayed
  publishing.
- **Analytics ingestion** — cross-post results are stored in
  `cross_post_jobs` but engagement metrics from each platform are not pulled
  back.

## Performance envelope

Tested on Cloudflare Workers **Free plan** (30s `waitUntil` budget):
- Single-image post, 700-word bilingual body: **~20s** end-to-end
- Multi-image post (2 photos), bilingual: **~24s** end-to-end (parallel ES+EN
  Claude calls fit comfortably)
- 3-image carousel: tight; consider Workers Paid ($5/mo, 15-min budget) for
  4+ images or longer bodies

## When to reach for this skill

- Brand has regular visual content (photos / product shots)
- Owner wants a single review touchpoint, not a CMS
- Multi-platform reach with consistent voice
- Brand voice and content rules can be encoded in a Claude system prompt
- Volume: ≤ 50 posts/day per brand (Anthropic + Brevo + Cloudflare free tiers)
