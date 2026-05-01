-- 0022_founder_rate_atomic_claim.sql
-- Closes pre-live Stripe blocker #2 from the strategic-doc audit:
-- the founder-rate counter could leak by 1 when the JS handler:
--   1. called claim_founder_rate_slot()  → counter incremented
--   2. INSERT founder_rate_grants        → failed (FK / unique / etc.)
-- The counter stayed incremented; no grant row existed; subsequent
-- claims would eventually exhaust the "first 50" cap with fewer than
-- 50 actual founders.
--
-- Root cause: Supabase JS client doesn't issue explicit transactions.
-- Each `.rpc()` / `.from(...).insert(...)` is its own auto-committed
-- statement. The 0008 comment "Inside the same transaction the caller
-- should also insert a founder_rate_grants row" was a polite fiction.
--
-- Fix: a single SECURITY DEFINER function that does the counter +1
-- AND the grant insert in one transaction. If the grant insert fails,
-- the counter increment rolls back automatically.

create or replace function public.claim_founder_rate_slot_with_grant(
  p_subscription_id uuid,
  p_user_id uuid,
  p_original_price_id text
)
returns table (claimed int, grant_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claimed int;
  v_grant_id uuid;
begin
  -- Idempotency: if a grant already exists for this subscription,
  -- return early without touching the counter. Covers webhook retry
  -- after a successful prior delivery.
  select id into v_grant_id
  from public.founder_rate_grants
  where subscription_id = p_subscription_id;

  if v_grant_id is not null then
    select claimed into v_claimed from public.founder_rate_counter where id = 1;
    return query select v_claimed, v_grant_id;
    return;
  end if;

  -- Atomic counter increment.
  update public.founder_rate_counter
    set claimed = claimed + 1, updated_at = now()
    where id = 1 and claimed < cap
    returning claimed into v_claimed;

  if v_claimed is null then
    -- Cap reached. Return null grant_id; caller stays on standard price.
    return query select null::int, null::uuid;
    return;
  end if;

  -- Insert the grant row. If this throws (FK violation, unique-violation
  -- on subscription_id, etc.), the counter increment ABOVE rolls back
  -- because we're inside a single function-level transaction.
  insert into public.founder_rate_grants (
    subscription_id, user_id, original_price_id
  ) values (
    p_subscription_id, p_user_id, p_original_price_id
  )
  returning id into v_grant_id;

  return query select v_claimed, v_grant_id;
end;
$$;

-- Service-role only.
revoke execute on function public.claim_founder_rate_slot_with_grant(uuid, uuid, text)
  from anon, authenticated;
