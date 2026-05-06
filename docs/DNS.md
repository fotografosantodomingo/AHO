# DNS records — `advertisehomes.online`

Draft of the DNS records to add once the domain's nameservers are pointing at Cloudflare. Per `DECISIONS.md` "Account ownership", PO controls the registrar and either (a) pastes these records into Cloudflare manually or (b) grants Claude DNS-edit permission scoped to just this zone.

> **Sequence:** Cloudflare zone created → PO updates registrar nameservers → propagation (up to 24h) → records below applied. Email warm-up starts only after the email-related records are live and Brevo has verified them.

---

## Apex + www

| Type | Name | Content | Proxy | TTL | Purpose |
|---|---|---|---|---|---|
| A | `@` | (Cloudflare Pages target IP) | Proxied | Auto | Apex points to Cloudflare Pages production deployment |
| CNAME | `www` | `advertisehomes.online` | Proxied | Auto | `www.` → apex |
| CNAME | `staging` | (Cloudflare Pages staging hostname) | Proxied | Auto | Staging environment |

The exact apex / staging targets come from Cloudflare Pages once the project is created and a custom domain is added. Cloudflare will display the required DNS values in the Pages dashboard.

---

## Email — Brevo (LIVE as of 2026-05-05)

Brevo authenticated the **apex** `advertisehomes.online` directly (rather than a `mail.` subdomain). Records are live and Brevo's dashboard reports all four matching. First successful test send: `<202605061157.27580665178@smtp-relay.mailin.fr>` to `homekrypto@gmail.com`.

### Records as actually deployed

| Type | Name | Content | Status |
|---|---|---|---|
| TXT | `@` | `brevo-code:7978ba39b25b2ae5c3ced5175654eee0` | ✓ One-time domain-ownership verification |
| CNAME | `brevo1._domainkey` | `b1.advertisehomes-online.dkim.brevo.com` | ✓ DKIM key 1 |
| CNAME | `brevo2._domainkey` | `b2.advertisehomes-online.dkim.brevo.com` | ✓ DKIM key 2 |
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:rua@dmarc.brevo.com` | ✓ DMARC at `p=none` (Brevo's default — collects reports without quarantining; ramp to `quarantine` then `reject` once warm-up complete) |

**Note on SPF:** Brevo's modern "Authenticated Domains" flow uses DKIM as the primary auth signal and doesn't strictly require an SPF record on the apex. If we later add other senders on the same apex (e.g. Google Workspace, Zoho) we may need a combined SPF: `v=spf1 include:spf.brevo.com include:_spf.google.com ~all`. For now Brevo-only sends are signed by DKIM and pass DMARC alignment.

### What the Brevo wrapper sends

`src/lib/email/brevo.ts` defaults to `info@advertisehomes.online` (the apex, monitored mailbox) — matches the authenticated domain. PO directive 2026-05-06: send FROM the monitored mailbox so user replies (questions, issues) reach a human instead of bouncing off `noreply@`. Override via `BREVO_FROM_EMAIL` / `BREVO_FROM_NAME` env vars if needed.

### Still pending — Supabase Auth → SMTP relay

Supabase sends signup-confirmation, password-reset, and magic-link emails directly (NOT through our `brevo.ts` wrapper). To route those through Brevo too, configure Supabase Auth → Project Settings → SMTP with:
  - Host: `smtp-relay.brevo.com`
  - Port: `587`
  - Username + password: a Brevo SMTP key (separate from the transactional API key)
  - From: `info@advertisehomes.online`

Until that's set, Supabase falls back to its built-in SMTP provider (`@noreply.supabase.co`) which is rate-limited and lacks AHO branding.

### Inbound (lead-reply relay) — deferred

Inbound parsing on `inbound.advertisehomes.online` is out of scope for v1; lead replies route through the agent's own email client. If we need an inbound parser later we'll either use a separate provider (Postmark Inbound, SendGrid Inbound Parse) or run our own MX → Cloudflare Worker pipeline.

---

## Verification (one-time)

| Type | Name | Content | Purpose |
|---|---|---|---|
| TXT | `@` | `google-site-verification=...` | Google Search Console |
| TXT | `@` | (Bing webmaster verification token) | Bing webmaster + IndexNow |

---

## Subdomains reserved for future use (do not add yet)

- `agencies.advertisehomes.online` — Agency-tier path-based branding base (v1.1)
- `status.advertisehomes.online` — public status page (v1.1)
- `api.advertisehomes.online` — public API for Expert tier (v2)

---

## Notes

- Web subdomains (`@`, `www`, `staging`) are **proxied** through Cloudflare for WAF, rate limiting, and edge cache.
- Email subdomains (`mail`, `tx`) are **DNS-only** — Cloudflare's proxy doesn't support SMTP traffic. Mark these as "DNS only" (grey cloud) in the Cloudflare dashboard.
- HSTS preload is **not** enabled until every subdomain is HTTPS-only (per `docs/CRITIQUE.md` §C). Set `Strict-Transport-Security: max-age=300; includeSubDomains` first, observe for two weeks, then ramp to a year, then submit to https://hstspreload.org. Once preloaded, you cannot run an HTTP-only subdomain.
- Once the email records are live and Brevo verifies the domain, **email warm-up starts immediately** with low-volume sends. ~30 days of gradual ramp is needed before public launch to avoid spam-folder placement of welcome / verification / password-reset mail.
