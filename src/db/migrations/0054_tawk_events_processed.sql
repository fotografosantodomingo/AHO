-- ============================================================
-- 0054_tawk_events_processed
--
-- Dedup table for Tawk.to webhook events, mirroring the
-- `stripe_events_processed` pattern from migration 0003.
--
-- Tawk delivers each webhook with retry-on-non-2xx, so the handler
-- must be idempotent. The primary key is a deterministic
-- `${event}:${chatId-or-ticketId}` string constructed in the
-- route handler — chat:start, chat:end, and ticket:create all have
-- a stable identifier we can combine with the event name.
--
-- No RLS — service-role-only writes (the webhook handler runs
-- under the admin client). Anon + authenticated can't see this
-- table at all; the deny-all RLS pattern is enforced by enabling
-- RLS without any policies. Same shape as stripe_events_processed.
-- ============================================================

create table if not exists public.tawk_events_processed (
  event_id text primary key,
  event_type text not null,
  chat_id text,
  property_id_external text,
  received_at timestamptz not null default now(),
  payload_summary jsonb
);

create index if not exists idx_tawk_events_processed_received
  on public.tawk_events_processed(received_at desc);

alter table public.tawk_events_processed enable row level security;
-- No policies: service-role only, anon + authenticated denied by default.
