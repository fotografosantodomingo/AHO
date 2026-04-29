# Cloudflare resources — to be created

The moment `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are visible in the dev shell (via direnv loading `.env.local`), the resources below get created via wrangler in one batch. Listed here for product-owner review before creation. All names are prefixed `aho-` and split by environment.

## Pages projects

| Project | Purpose | Custom domain |
|---|---|---|
| `aho-web` | Next.js production | `advertisehomes.online`, `www.advertisehomes.online` |
| `aho-web-staging` | Next.js staging | `staging.advertisehomes.online` |

Pages projects auto-create a `*.aho-web.pages.dev` URL for each preview deployment, which is how PR previews work without further config.

## R2 buckets

| Bucket | Purpose |
|---|---|
| `aho-property-images-dev` | Property image originals (local + preview deployments) |
| `aho-property-images-prod` | Property image originals (production) |
| `aho-backups` | Off-account weekly backups of Supabase (per spec §25.5) |

## KV namespaces

| Namespace | Purpose |
|---|---|
| `aho-flags-dev` | Feature flags for dev/preview |
| `aho-flags-prod` | Feature flags for production |

A separate `aho-rate-limits-prod` KV may be added later if Worker-side rate limiting outgrows the WAF (per spec §21.4); not in v1.

## Queues

| Queue | Purpose |
|---|---|
| `aho-social-fanout-dev` | One-click social share fan-out (FB, IG) — dev/preview |
| `aho-social-fanout-prod` | Same — production |
| `aho-social-fanout-dlq-dev` | Dead-letter queue (3 retries → DLQ for admin inspection) |
| `aho-social-fanout-dlq-prod` | Same — production |

## Cloudflare Images

Account-level resource; one set of variants serves both dev and prod via key prefixing. Variants per spec §3.4:

| Variant | Width |
|---|---|
| `thumb` | 320 |
| `card` | 640 |
| `hero` | 1280 |
| `full` | 1920 |
| `og` | 1200×630 (cropped, for social previews) |

## Worker scripts (created later as built)

| Worker | Purpose | Dependencies |
|---|---|---|
| `aho-stripe-webhook` | Stripe webhook handler | KV (idempotency), Supabase admin client |
| `aho-social-fanout` | Queue consumer for social posts | Queues, Supabase admin, encrypted social tokens |
| `aho-cron` | Scheduled jobs (sitemap regen, expired listings, dunning checks) | Supabase admin |
| `aho-image-processor` | R2 event-triggered image variant generation | R2, Cloudflare Images |

These don't get created upfront — each Worker lands as the corresponding feature ships during slice 1 (Stripe webhook in week 3; social fanout deferred to post-slice-1 since v1 ships the manual-share fallback first; cron in week 4–5; image processor in week 4–5).

## Cloudflare Turnstile

Site key + secret key for bot detection on auth and contact endpoints (spec §6.3, §21.4). Provisioned via dashboard; secret goes into `.env.local` as `TURNSTILE_SECRET_KEY` and the public site key as `NEXT_PUBLIC_TURNSTILE_SITE_KEY`.

## Creation commands (run after Cloudflare token is in shell env)

```sh
# Verify access
wrangler whoami

# R2 buckets
wrangler r2 bucket create aho-property-images-dev
wrangler r2 bucket create aho-property-images-prod
wrangler r2 bucket create aho-backups

# KV namespaces — capture the returned IDs into wrangler.toml
wrangler kv namespace create aho-flags-dev
wrangler kv namespace create aho-flags-prod

# Queues
wrangler queues create aho-social-fanout-dev
wrangler queues create aho-social-fanout-prod
wrangler queues create aho-social-fanout-dlq-dev
wrangler queues create aho-social-fanout-dlq-prod

# Pages projects (created via dashboard or wrangler pages project create)
wrangler pages project create aho-web --production-branch main
wrangler pages project create aho-web-staging --production-branch main
```

After creation, a real `wrangler.toml` is committed at the repo root with the resulting IDs, and the values above are no longer placeholders.

## Why this is in docs/, not in wrangler.toml yet

A `wrangler.toml` with placeholder IDs causes wrangler commands to fail noisily when run. Holding the file out of the repo until the resources exist keeps `pnpm dev` and `wrangler whoami` clean for now. Once resources land, `wrangler.toml` is committed in the same PR that adds the first Worker (likely the Stripe webhook in week 3).
