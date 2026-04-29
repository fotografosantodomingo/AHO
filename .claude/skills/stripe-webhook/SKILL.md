---
name: stripe-webhook
description: Add or change a Stripe webhook handler with signature verification, idempotency, and side-effect testing
---

# When to use this skill
Use when adding a new Stripe event type to the webhook Worker, or when modifying behavior for an existing one (e.g., a new dunning step on `invoice.payment_failed`).

# Required reading before starting
- `docs/HANDOFF.md` §7.3 (checkout flow), §7.4 (events to handle), §7.5 (dunning)
- `docs/RISKS.md` R8 (webhook ordering and replay)
- `CLAUDE.md` "Hard rules" #3 (verify signatures, be idempotent, DB is a cache of Stripe state)

# Steps
1. Add or update the event handler in the Stripe webhook Worker.
2. **Verify the signature** using the Stripe webhook secret on every request. Reject before parsing the body if invalid.
3. **Dedup by `stripe_event_id`** against the `stripe_events_processed` table inside the same DB transaction as the side effects. If the event was already processed, return 200 immediately.
4. Compute final state from the event payload, not from event ordering. Out-of-order delivery must not corrupt state.
5. Write or update the side effects (subscription row updates, payment row insert, entitlement recomputation, email triggers).
6. Add a test that replays the event payload and asserts the resulting DB state. Test the idempotency path (replay twice, assert single side effect).
7. Use the Stripe CLI to fire test events in local dev: `stripe trigger <event_name>`. For ordering edge cases, use `stripe events resend <id>` to replay out of sequence.
8. Update `docs/HANDOFF.md` §7.4 if the event-to-action mapping changes.

# Caveats
- TODO: link to the canonical webhook handler file path once it exists.
- TODO: document the test fixture pattern for replaying captured events.
- Stripe webhook secrets are per-environment. Never reuse a live secret in test.
