# DNS records — `advertisehomes.online`

Draft of the DNS records to add once the domain's nameservers are pointing at Cloudflare. Per `DECISIONS.md` "Account ownership", PO controls the registrar and either (a) pastes these records into Cloudflare manually or (b) grants Claude DNS-edit permission scoped to just this zone.

> **Sequence:** Cloudflare zone created → PO updates registrar nameservers → propagation (up to 24h) → records below applied. Email warm-up starts only after the email-related records are live and Resend has verified them.

---

## Apex + www

| Type | Name | Content | Proxy | TTL | Purpose |
|---|---|---|---|---|---|
| A | `@` | (Cloudflare Pages target IP) | Proxied | Auto | Apex points to Cloudflare Pages production deployment |
| CNAME | `www` | `advertisehomes.online` | Proxied | Auto | `www.` → apex |
| CNAME | `staging` | (Cloudflare Pages staging hostname) | Proxied | Auto | Staging environment |

The exact apex / staging targets come from Cloudflare Pages once the project is created and a custom domain is added. Cloudflare will display the required DNS values in the Pages dashboard.

---

## Email — Resend

Replace placeholders with the exact values Resend's dashboard provides when you add `mail.advertisehomes.online` and `tx.advertisehomes.online` as sending domains.

### `mail.advertisehomes.online` (transactional outbound — auth, password reset, lead notifications, etc.)

| Type | Name | Content | TTL | Purpose |
|---|---|---|---|---|
| TXT | `mail` | `v=spf1 include:_spf.resend.com ~all` | Auto | SPF |
| CNAME | `resend._domainkey.mail` | (DKIM target from Resend dashboard) | Auto | DKIM |

### `tx.advertisehomes.online` (a separate sender for high-priority transactional, isolating reputation)

| Type | Name | Content | TTL | Purpose |
|---|---|---|---|---|
| TXT | `tx` | `v=spf1 include:_spf.resend.com ~all` | Auto | SPF |
| CNAME | `resend._domainkey.tx` | (DKIM target from Resend dashboard) | Auto | DKIM |

### Domain-wide DMARC

| Type | Name | Content | TTL | Purpose |
|---|---|---|---|---|
| TXT | `_dmarc` | `v=DMARC1; p=quarantine; rua=mailto:dmarc@advertisehomes.online; ruf=mailto:dmarc@advertisehomes.online; fo=1; pct=100` | Auto | DMARC. Start at `quarantine`; ramp to `reject` after 30 days of clean reports. |

`dmarc@advertisehomes.online` must exist before the DMARC record goes live (Resend Inbound mailbox or simple forward to the PO's address).

### Inbound (lead-reply relay)

| Type | Name | Content | TTL | Purpose |
|---|---|---|---|---|
| MX | `inbound` | (Resend Inbound MX target, priority 10) | Auto | Inbound for lead reply relay (`lead-{id}@inbound.advertisehomes.online`) |

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
- Email subdomains (`mail`, `tx`, `inbound`) are **DNS-only** — Cloudflare's proxy doesn't support SMTP traffic. Mark these as "DNS only" (grey cloud) in the Cloudflare dashboard.
- HSTS preload is **not** enabled until every subdomain is HTTPS-only (per `docs/CRITIQUE.md` §C). Set `Strict-Transport-Security: max-age=300; includeSubDomains` first, observe for two weeks, then ramp to a year, then submit to https://hstspreload.org. Once preloaded, you cannot run an HTTP-only subdomain.
- Once the email records are live and Resend verifies the domain, **email warm-up starts immediately** with low-volume sends. ~30 days of gradual ramp is needed before public launch to avoid spam-folder placement of welcome / verification / password-reset mail.
