# Process Blueprint — Data Flow

Four flows live in this skill. Each is small. They all share one set of
tables (`email_contacts`, `email_campaigns`, `email_logs`, `email_templates`)
and one Worker.

## Flow 1 — Admin sends a campaign

```
                  ┌──────────────────────────┐
                  │ Admin SPA — Composer     │
                  │ /admin/email/compose     │
                  │                          │
                  │ 1. Save draft to         │
                  │    email_campaigns       │
                  │ 2. Click "Send Test"     │
                  │    or "Send to segment"  │
                  └────────────┬─────────────┘
                               │ POST /email/send
                               │  Authorization: Bearer <supabase JWT>
                               │  { campaignId, testTo? }
                               ▼
            ┌──────────────────────────────────────────┐
            │ Cloudflare Worker /email/send            │
            │                                          │
            │ 1. verifyAdminAuth: GET /auth/v1/user    │
            │    with the bearer; check email matches  │
            │    REVIEW_EMAIL_TO env var               │
            │ 2. Load campaign row (subject, html,     │
            │    segment_filter)                       │
            │ 3. If testTo: send 1 email, no logs,     │
            │    no campaign mutation                  │
            │ 4. Else: resolve recipients —            │
            │      a. recipientEmails override, OR     │
            │      b. segment_filter query             │
            │         (segments+tags+status=active)    │
            │ 5. Patch campaign.status='sending'       │
            │ 6. For each recipient:                   │
            │      - inject unsubscribe footer         │
            │      - POST /v3/smtp/email to Brevo      │
            │      - INSERT email_logs row             │
            │ 7. Patch campaign.status='sent' (or      │
            │    'failed' if all failed)               │
            └────────────┬─────────────────────────────┘
                         │
                         ▼
            ┌──────────────────────────┐
            │ Brevo /v3/smtp/email     │
            │ → returns messageId      │
            │ → asynchronously fans    │
            │   out to recipient inboxes│
            └────────────┬─────────────┘
                         │
                         │ (later — minutes to days)
                         ▼
            ┌──────────────────────────┐
            │ Brevo dashboard webhook  │
            │ POST https://<worker>/   │
            │   webhooks/brevo         │
            │   ?secret=<env>          │
            │                          │
            │ Event types:             │
            │   delivered, opened,     │
            │   clicked, hard_bounce,  │
            │   soft_bounce, spam,     │
            │   unsubscribed, blocked  │
            └────────────┬─────────────┘
                         │
                         ▼
            ┌──────────────────────────┐
            │ Worker handleBrevoEvent  │
            │ — PATCH email_logs WHERE │
            │   message_id=ev[msgid]   │
            │ — (suppress contact if   │
            │   hard_bounce/unsub)     │
            └──────────────────────────┘
```

## Flow 2 — Public newsletter signup → welcome

```
┌─────────────────────────────┐
│ SPA — NewsletterSignup form │
│ (footer / hero / dedicated) │
└────────────┬────────────────┘
             │ supabase.from('newsletter_subscribers').insert()
             │   (anon RLS allows INSERT only)
             ▼
┌──────────────────────────────────────────────┐
│ Postgres                                     │
│ AFTER INSERT trigger:                        │
│   mirror_newsletter_to_email_contacts()      │
│   → INSERT INTO email_contacts (             │
│       email, first_name, segment='individual',│
│       subtype_tags=['newsletter', source],   │
│       status='active')                       │
│   ON CONFLICT DO UPDATE tags                 │
│   (SECURITY DEFINER bypasses RLS)            │
└────────────┬─────────────────────────────────┘
             │ (back to SPA — fire-and-forget)
             │ fetch <worker>/newsletter/welcome
             │   { email, first_name }
             ▼
┌──────────────────────────────────────────────┐
│ Worker /newsletter/welcome                   │
│ 1. Verify address is in newsletter_subscribers│
│    (prevents arbitrary "welcome" spam)       │
│ 2. signUnsubscribeUrl(email)                 │
│ 3. sendBrevoEmail — customer welcome         │
│ 4. sendBrevoEmail — admin notice to          │
│    REVIEW_EMAIL_TO (best-effort)             │
└──────────────────────────────────────────────┘
```

## Flow 3 — Unsubscribe

```
recipient clicks footer link in any marketing email
             │
             │ GET <worker>/unsubscribe?email=X&sig=Y
             ▼
┌──────────────────────────────────────────────┐
│ Worker /unsubscribe                          │
│ 1. verifyUnsubscribeToken — HMAC over        │
│    "unsub.<lowercased-email>" with           │
│    EMAIL_LINK_SECRET. No expiry — unsub      │
│    links must work forever.                  │
│ 2. PATCH email_contacts SET status=          │
│    'unsubscribed' WHERE email=X              │
│ 3. POST Brevo /v3/contacts                   │
│    { emailBlacklisted: true, updateEnabled } │
│    (best-effort — page renders even if this  │
│    fails)                                    │
│ 4. Return HTML confirmation page             │
└──────────────────────────────────────────────┘
```

If Brevo's webhook later reports `unsubscribed` (recipient clicked the
List-Unsubscribe header in Gmail/Apple Mail), the same suppression happens
via the webhook path. Both paths converge on `email_contacts.status =
'unsubscribed'`. Neither path is necessary — having both is belt-and-suspenders.

## Flow 4 — Transactional order email (Stripe → Edge Function)

```
                Customer pays at Stripe Checkout
                              │
                              ▼
            ┌──────────────────────────────────┐
            │ Stripe sends webhook to YOUR     │
            │ supabase/functions/stripe-webhook│
            │ (not bundled — project-specific) │
            └────────────┬─────────────────────┘
                         │ on payment_intent.succeeded:
                         │   POST /functions/v1/send-order-email
                         │   { order_id, type: 'confirmation' }
                         │   Bearer <service-role>
                         │
                         │ also: { order_id, type: 'admin_new_order' }
                         ▼
            ┌──────────────────────────────────────┐
            │ Supabase Edge Function               │
            │ send-order-email                     │
            │                                      │
            │ 1. Load order + items via SR key     │
            │ 2. Load email_templates row          │
            │    (type, lang) — fallback to        │
            │    hardcoded defaults if missing     │
            │ 3. Render HTML:                      │
            │      - header (brand chrome)         │
            │      - intro / heading from template │
            │      - items + totals table          │
            │      - ship-to or tracking block     │
            │      - .ics calendar button (if      │
            │        order has reservation items)  │
            │      - footer (brand socials)        │
            │ 4. POST Brevo /v3/smtp/email         │
            │      to: customer (or admin)         │
            │      bcc: ADMIN_NOTIFY_EMAIL on      │
            │           confirmation+refund        │
            └──────────────────────────────────────┘
```

The `.ics` calendar button uses `signCalendarUrl` (HMAC over `cal.<order-id>`
with `EMAIL_LINK_SECRET`). When the customer clicks, the Worker's
`/calendar/order/:id.ics` route verifies the signature and emits a valid
VCALENDAR with VEVENTs for each reservation line item.

## Why HMAC instead of session tokens?

Unsubscribes and calendar links go out in emails that must work years later.
A Supabase JWT expires in 1 hour. HMAC over a stable payload
(`unsub.<email>` or `cal.<order-id>`) gives us:

- No expiry needed (good — recipients shouldn't be locked out of
  unsubscribing).
- No DB lookup needed at click time (one HMAC compute is enough).
- Tamper-proof: an attacker can't change `email=X` to `email=Y` because
  the signature would no longer verify.
- Secret can rotate: change `EMAIL_LINK_SECRET` and old links break — useful
  if the secret leaks. Calendar links break too, but they're typically used
  within 60 days of order anyway.

## Brevo event-state machine

```
queued ──┐
         ├──> sent ──> delivered ──> opened ──> clicked
         │              │
         │              └──> bounced (hard / soft)
         │                     │
         │                     └──> hard_bounce sets contact.status='bounced'
         │
         └──> spam ─┐
                   ├──> unsubscribed sets contact.status='unsubscribed'
                   ├──> blocked
                   └──> deferred (retryable, Brevo will retry)
```

Three subtle rules in `handleBrevoEvent`:

1. **`sent` won't overwrite `delivered`/`opened`/`clicked`/`bounced`** — Brevo
   sometimes reports the "request" event after delivery confirmation.
2. **`opened` won't overwrite `clicked`** — clicked is strictly later in
   the lifecycle.
3. **`opened` is idempotent** — `opened_at` is set once; subsequent open
   events update only `raw_event` (so we don't re-stamp the timestamp).

## Schema-relation summary

```
newsletter_subscribers  ──trigger──>  email_contacts
                                          │
                                          │ used at send time
                                          ▼
                                  email_campaigns ──send──> email_logs
                                                              │
                                                              │ patched by
                                                              ▼
                                                       Brevo webhook events

orders, order_items ──read by──> send-order-email ──reads copy from──> email_templates
```
