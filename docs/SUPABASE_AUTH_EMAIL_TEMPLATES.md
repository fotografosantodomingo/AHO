# Supabase Auth email templates — DP-2d palette

Supabase Auth-managed emails (signup confirmation, magic link, password reset, change email, invite) live **outside** the project's database — they're stored in project config and only the Supabase **Management API** (or the dashboard UI) can mutate them. Project keys (anon, service-role) only work against PostgREST / auth / storage at the project URL — not `api.supabase.com`.

## Preferred path: `pnpm supabase:templates`

Source of truth: [`scripts/lib/supabase-auth-templates.ts`](../scripts/lib/supabase-auth-templates.ts) — typed module that builds the 5 templates from a shared shell + per-template heading / body / CTA / helper. Edit there; one PR captures both the diff and the deploy.

**Run:**

```bash
# One-time setup: generate a PAT
#   https://supabase.com/dashboard/account/tokens
#   → "Generate new token", name it "AHO automation"
#   → copy the sbp_xxxx value

# Add to .env.local:
#   SUPABASE_ACCESS_TOKEN=sbp_xxxx

# Sync:
pnpm supabase:templates
```

The script PATCHes `https://api.supabase.com/v1/projects/{ref}/config/auth` with all 5 subjects + 5 HTML bodies in one call. Idempotent; rerun any time the templates module changes.

## Fallback path: paste-ready HTML in the dashboard

If a PAT isn't available, paste each template manually into:

> **Supabase Dashboard → Authentication → Email Templates**

The HTML below mirrors the script-generated content. Subject lines and Supabase template variables (`{{ .ConfirmationURL }}`, `{{ .Token }}`, `{{ .SiteURL }}`, `{{ .Email }}`, `{{ .NewEmail }}`) MUST stay verbatim — Supabase substitutes them at send time.

After saving, trigger each flow to verify:
- **Confirm signup** → `/{locale}/signup`
- **Magic link** → `/{locale}/magic-link`
- **Reset password** → `/{locale}/forgot-password`
- **Change email** → user changes email in Supabase Auth (no AHO surface yet for this; trigger via SQL or admin console)

---

## Shared shell (referenced by every template below)

The structure is identical across all four templates: warm cream body, forest accent strip, white card with 12px radius, soft-cream footer. Only the heading + body copy + CTA label change.

> ⚠️ Supabase email templates don't support shared partials. Each template below repeats the full HTML inline. Yes, this duplicates ~50 lines per template. The alternative (a shared external CSS) is not supported in transactional email anyway — every styling rule has to be inline.

---

## 1. Confirm signup

**Subject** (set in the field above the HTML body):

```
Confirm your AHO account
```

**Message Body (HTML):**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Confirm your AHO account</title>
  </head>
  <body style="background:#f4ede1;margin:0;padding:24px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a1612;letter-spacing:-0.01em;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid rgba(112,95,70,0.18);border-radius:12px;overflow:hidden;">
            <tr>
              <td style="background:#1d5a3c;line-height:0;font-size:0;height:4px;" height="4">&nbsp;</td>
            </tr>
            <tr>
              <td style="padding:32px 28px;line-height:1.55;font-size:15px;color:#3a342c;">
                <a href="{{ .SiteURL }}" style="font-weight:700;font-size:20px;letter-spacing:-0.02em;color:#1a1612;text-decoration:none;">AHO</a>
                <div style="margin-top:24px;color:#1a1612;">
                  <h1 style="margin:0 0 16px;font-size:24px;font-weight:700;letter-spacing:-0.02em;color:#1a1612;">Welcome to AHO</h1>
                  <p style="margin:0 0 18px;color:#3a342c;">Tap the button below to confirm your email and finish setting up your account.</p>
                  <p style="margin:0 0 24px;">
                    <a href="{{ .ConfirmationURL }}" style="display:inline-block;padding:11px 22px;background:#1d5a3c;color:#ffffff;text-decoration:none;border-radius:9999px;font-weight:600;font-size:14px;letter-spacing:-0.01em;">Confirm my email</a>
                  </p>
                  <p style="margin:0;color:#5e574d;font-size:13px;">If you didn't sign up for AHO, you can safely ignore this email — no account will be created without confirmation.</p>
                  <p style="margin:16px 0 0;color:#8a7e6c;font-size:11px;word-break:break-all;">{{ .ConfirmationURL }}</p>
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 28px;font-size:12px;color:#5e574d;border-top:1px solid rgba(112,95,70,0.18);background:#ebe1ce;">
                <p style="margin:0 0 10px;font-size:12px;color:#5e574d;">Need help? <a href="mailto:info@advertisehomes.online" style="color:#1d5a3c;text-decoration:underline;font-weight:600;">info@advertisehomes.online</a></p>
                <p style="margin:0 0 10px;font-size:12px;color:#5e574d;">
                  <a href="https://facebook.com/advertisehomesonline" style="color:#5e574d;text-decoration:underline;">Facebook</a>
                  &nbsp;·&nbsp;
                  <a href="https://instagram.com/advertisehomesonline" style="color:#5e574d;text-decoration:underline;">Instagram</a>
                  &nbsp;·&nbsp;
                  <a href="https://linkedin.com/company/advertisehomesonline" style="color:#5e574d;text-decoration:underline;">LinkedIn</a>
                  &nbsp;·&nbsp;
                  <a href="https://advertisehomes.online" style="color:#5e574d;text-decoration:underline;">advertisehomes.online</a>
                </p>
                <p style="margin:0;font-size:11px;color:#8a7e6c;">AHO · Advertise Homes Online · Santo Domingo, Dominican Republic</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
```

---

## 2. Magic Link

**Subject:**

```
Your AHO sign-in link
```

**Message Body (HTML):** identical to template #1 above with these substitutions:

- `<title>Confirm your AHO account</title>` → `<title>Your AHO sign-in link</title>`
- H1 `Welcome to AHO` → `Sign in to AHO`
- Body `Tap the button below to confirm your email…` → `Tap the button below to sign in. The link is single-use and expires in 1 hour.`
- CTA label `Confirm my email` → `Sign me in`
- Helper line `If you didn't sign up for AHO…` → `If you didn't request this link, you can safely ignore this email — no one can sign in to your account without it.`

The CTA `href` stays `{{ .ConfirmationURL }}` — Supabase reuses this template variable for magic-link flows.

---

## 3. Reset Password

**Subject:**

```
Reset your AHO password
```

**Message Body (HTML):** same shell, with these substitutions:

- `<title>` → `Reset your AHO password`
- H1 → `Reset your password`
- Body → `Tap the button below to choose a new password. The link expires in 1 hour.`
- CTA label → `Reset password`
- Helper line → `If you didn't request a password reset, you can safely ignore this email — your current password stays unchanged.`

CTA `href` stays `{{ .ConfirmationURL }}`.

---

## 4. Change Email Address (confirmation)

**Subject:**

```
Confirm your new email on AHO
```

**Message Body (HTML):** same shell, with these substitutions:

- `<title>` → `Confirm your new email on AHO`
- H1 → `Confirm your new email`
- Body → `You requested to change the email on your AHO account from <strong>{{ .Email }}</strong> to <strong>{{ .NewEmail }}</strong>. Tap the button below to confirm. The link expires in 1 hour.`
- CTA label → `Confirm new email`
- Helper line → `If you didn't request this change, please contact us immediately so we can secure your account.`

CTA `href` stays `{{ .ConfirmationURL }}`.

---

## 5. Invite User (optional — only if you ever invite via Supabase Auth admin API)

Same shell as above. Subject `You're invited to AHO`. H1 `You're invited to AHO`. Body `<p>An admin invited you to join AHO. Tap below to set up your account:</p>`. CTA `Accept invitation`. Helper `If you weren't expecting this invite, you can safely ignore it.`.

---

## After applying

Verify each template renders correctly:
1. Trigger the flow (e.g. sign up a fresh test account).
2. Open the email in Gmail web + Apple Mail mobile + Outlook.com if possible.
3. Check that the forest accent strip + cream canvas + pill CTA all render.
4. Confirm `{{ .ConfirmationURL }}` substituted correctly (link works, lands on /auth/callback?…).

If something looks off:
- Outlook can strip CSS gradients or `border-radius` → the design above uses `rgb()` solid colors and `border-radius: 12px / 9999px`, both supported.
- Gmail can strip styles inside `<style>` tags → all our styles are inline, so this is fine.
- Some clients ignore `font-family` → fallback chain ends in `Helvetica,Arial,sans-serif`, universally supported.

## Variables reference

Supabase template variables (DO NOT replace these in the HTML):

| Variable | Used in template | Renders as |
|---|---|---|
| `{{ .SiteURL }}` | All four (brand link in header) | The Site URL configured under Auth → URL Configuration |
| `{{ .ConfirmationURL }}` | All four (CTA href) | The signed callback URL with `?token_hash=...&type=...&next=...` |
| `{{ .Email }}` | Change Email only | Current email on the account |
| `{{ .NewEmail }}` | Change Email only | New email being confirmed |
| `{{ .Token }}` | (Not used here; OTP-only flows) | 6-digit numeric code |

Source: <https://supabase.com/docs/guides/auth/auth-email-templates>
