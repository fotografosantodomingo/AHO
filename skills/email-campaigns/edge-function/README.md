# Edge Function — `send-order-email`

Transactional email dispatcher for orders. Lives in Supabase, not Cloudflare,
because Stripe webhooks call it with the service-role key in the
`Authorization` header — keeping it inside Supabase removes one network hop.

## What it handles

A single endpoint that accepts:

```json
POST /send-order-email
{
  "order_id": "<uuid>",
  "type": "confirmation" | "tracking" | "refund" | "abandoned_cart" | "admin_new_order" | "admin_refunded"
}
```

It then:

1. Loads the order + items from Postgres using the service role key.
2. Loads matching `email_templates` row (`type` + `lang`) for editable copy.
   Falls back to hardcoded defaults if absent.
3. Renders HTML (subject, body, total table, ship-to block, tracking link,
   abandoned-cart CTA, .ics calendar button for orders containing
   reservation items).
4. POSTs to Brevo `/v3/smtp/email`. BCCs admin on confirmation/refund.

## Required secrets

Push via Supabase CLI:

```bash
supabase secrets set BREVO_API_KEY="<xkeysib-...>"
supabase secrets set ORDER_EMAIL_FROM='Kibay <orders@kibay.com.do>'
supabase secrets set ADMIN_NOTIFY_EMAIL='info@kibay.com.do'
supabase secrets set EMAIL_LINK_SECRET='<same value as Worker>'
supabase secrets set WORKER_BASE_URL='https://<your-worker>.workers.dev'
```

Notes:

- `EMAIL_LINK_SECRET` **must match** the Worker's secret. The function mints
  HMAC-signed `.ics` URLs that the Worker's `GET /calendar/order/:id.ics`
  route then verifies.
- `WORKER_BASE_URL` is the host the calendar links point at.
- `ORDER_EMAIL_FROM` must be a Brevo-verified sender. Verify a single
  address at app.brevo.com/senders/list (fast) or your full domain via DNS
  for production.
- `ADMIN_NOTIFY_EMAIL`: set to `""` (empty string) to disable admin BCC.

`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_ANON_KEY` are
auto-injected by Supabase — you do not push these.

## Deploy

```bash
cd <your-project>
# Copy the function into your Supabase folder structure
mkdir -p supabase/functions/send-order-email
cp skills/email-campaigns/edge-function/send-order-email/index.ts supabase/functions/send-order-email/

supabase functions deploy send-order-email
```

## Calling from your Stripe webhook

This skill **doesn't ship the Stripe webhook itself** — that's project-
specific (which Stripe events you care about, etc). But the calling pattern
the Kibay webhook uses is:

```ts
// In your stripe-webhook Edge Function:
async function sendOrderEmail(orderId: string, type: 'confirmation' | 'admin_new_order') {
  await fetch(`${supabaseUrl}/functions/v1/send-order-email`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${supabaseServiceRoleKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ order_id: orderId, type }),
  });
}

// On payment_intent.succeeded:
await sendOrderEmail(order.id, 'confirmation');
await sendOrderEmail(order.id, 'admin_new_order');
```

For refunds, fire `refund` to the customer and `admin_refunded` to admin.
For shipping notifications fired manually from the admin UI, hit the same
endpoint with `type: 'tracking'`.

## Calling from the admin SPA

There's a "Resend confirmation" button on the order detail page that POSTs
directly to the function with the user's session JWT. The function checks
admin status via `auth.uid()` against `public.users.role`.

## Brand-genericization

Open `index.ts` and search for `Kibay` / `kibay.com.do` — there are ~12
hits, mostly in the HTML chrome (wordmark, address, social links, footer
copyright). The cleanest pattern is to add a `BRAND` const at the top:

```ts
const BRAND = {
  name: 'YourBrand',
  domain: 'yourbrand.com',
  siteUrl: 'https://yourbrand.com',
  address: '...',
  socials: { instagram: '...', facebook: '...', tiktok: '...', linkedin: '...' },
};
```

Then replace each hardcoded reference. The migration `03_email_templates_table.sql`
also has copy that mentions `kibay.com.do/cart` in the abandoned-cart body —
update either the SQL before applying or `UPDATE email_templates SET outro = ...`
afterwards.

The `email_templates` table is the right surface for copy edits the operator
will want to tune over time. Anything in HTML chrome (logo wordmark, brand
colours, footer layout) lives in the function source and changes there
require a redeploy.

## Verifying after deploy

Pick a real order in your DB and call:

```bash
curl -X POST \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"order_id":"<real-uuid>","type":"confirmation"}' \
  "$SUPABASE_URL/functions/v1/send-order-email"

# Expect: { "ok": true, "messageId": "..." }
```

If the order has a reservation line item, the email should include an
"Add to calendar" button. Click it — it should download a valid `.ics`
file from the Worker's `/calendar/order/:id.ics` endpoint.
