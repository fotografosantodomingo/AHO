---
name: social-platform-integration
description: Add a new social platform to the one-click distribution system (OAuth, token storage, post formatter, retries)
---

# When to use this skill
Use when adding a new platform (e.g., Pinterest, Threads, YouTube Shorts) to the social fan-out system, or substantially changing an existing platform's posting behavior.

# Required reading before starting
- `docs/HANDOFF.md` §10 — entire section
- `docs/RISKS.md` R2 (app review), R3 (TikTok video), R4 (X pricing)
- `CLAUDE.md` — token encryption rule (AES-GCM 256, master key in Worker secret, never log raw tokens)

# Steps
1. **Reality check first.** Update `docs/HANDOFF.md` §10.1 with the platform's current API status, auth model, content limits, approval requirements, and cost. APIs and pricing change — do not trust this skill's reading list as authoritative for the platform's current state.
2. **Submit app review immediately** if approval is required. Do not block on review — build against sandbox.
3. Add the platform to the `platform` enum in `social_accounts` and `social_posts` (migration via the `supabase-migration` skill).
4. Implement OAuth:
   - Build OAuth URL with our `client_id`, scopes, `redirect_uri`, and a CSRF state token bound to the user session.
   - Implement the callback: exchange code for tokens, validate with a benign API call, store encrypted in `social_accounts`.
   - For platforms with sub-accounts (FB Pages, IG Business via FB), implement the picker UX.
5. Implement the post formatter — a pure function from `(property, social_account, language)` to rendered text + media references. Add unit tests for known edge cases (long titles, missing fields, non-Latin characters, empty amenities).
6. Add the platform branch in the `SocialPostConsumer` Worker. Distinguish retryable vs permanent errors per the platform's documented error codes.
7. Add per-platform rate-limit awareness — track posts-per-window per `social_account_id`, back off before hitting limits.
8. Add a connection test endpoint the agent can hit from the Settings UI to verify their token still works.
9. Wire the platform into the post-publish "Share" modal (§10.3). Add a preview renderer.
10. Update the daily token-refresh cron to include the new platform.

# Caveats
- TODO: fill in the canonical Worker file structure once the first platform (Facebook recommended) is implemented.
- Token encryption must use the existing key-management module — never roll new crypto for a new platform.
- Some platforms strip URLs from captions (Instagram). Document this in the renderer.
- Some jurisdictions require disclosures (license number) in agent posts — append from the org-level field.
