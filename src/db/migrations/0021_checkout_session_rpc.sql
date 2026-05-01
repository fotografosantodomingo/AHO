-- 0021_checkout_session_rpc.sql
-- Closes pre-live Stripe blocker #1 from the strategic doc + Phase 2A
-- prep: the checkout.session.completed handler does multi-statement
-- DB writes (org INSERT → org_member UPSERT → subscription UPSERT)
-- with no transaction wrapper. On retry after a partial failure, the
-- handler re-INSERTs the org without on-conflict because the
-- `existingSub` lookup misses (subscription wasn't written on the
-- failed run), creating a duplicate organization for the same user.
--
-- Fix: a single SECURITY DEFINER RPC `materialize_subscription_from_
-- checkout(...)` that does all three writes inside one Postgres
-- transaction. PG transactions are atomic: either all three commit
-- or none do. Idempotency: if a subscription row already exists for
-- the given stripe_subscription_id, the function returns the
-- existing org + sub row IDs without re-inserting.
--
-- Slug uniqueness lives inside the function: appends a numeric suffix
-- on conflict, up to 50 attempts. Replaces the JS `uniqueOrgSlug`
-- loop which was N-statement and races under concurrent retries.

create or replace function public.materialize_subscription_from_checkout(
  p_user_id uuid,
  p_org_name text,
  p_slug_base text,
  p_plan_id text,
  p_listing_cap int,
  p_seats_included int,
  p_stripe_customer_id text,
  p_stripe_subscription_id text,
  p_status text,
  p_current_period_start timestamptz,
  p_current_period_end timestamptz,
  p_cancel_at_period_end boolean,
  p_trial_end timestamptz
)
returns table (org_id uuid, subscription_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing_sub_id uuid;
  v_existing_org_id uuid;
  v_org_id uuid;
  v_sub_id uuid;
  v_slug text;
  v_attempt int := 0;
begin
  -- Idempotency short-circuit: if a subscription with this Stripe
  -- subscription id already exists, return its org/sub ids without
  -- doing any inserts. Covers Stripe webhook redelivery after a
  -- successful prior run.
  select s.id, s.org_id into v_existing_sub_id, v_existing_org_id
  from public.subscriptions s
  where s.stripe_subscription_id = p_stripe_subscription_id
  limit 1;

  if v_existing_sub_id is not null then
    -- Refresh the mutable subscription fields in case Stripe state has
    -- moved on between the original delivery and the retry. The org
    -- itself is immutable on this path (we never re-create it).
    update public.subscriptions
    set
      status = p_status,
      current_period_start = p_current_period_start,
      current_period_end = p_current_period_end,
      cancel_at_period_end = p_cancel_at_period_end,
      trial_end = p_trial_end
    where id = v_existing_sub_id;

    -- Best-effort: ensure the owner membership exists. The user could
    -- have been removed between deliveries (unusual) — re-add them.
    insert into public.organization_members (org_id, user_id, role, joined_at)
    values (v_existing_org_id, p_user_id, 'owner', now())
    on conflict (org_id, user_id) do nothing;

    return query select v_existing_org_id, v_existing_sub_id;
    return;
  end if;

  -- Fresh path: pick a unique slug, then insert org + member + sub
  -- atomically. PG advisory lock keeps concurrent retries for the
  -- SAME subscription serial — second one wins via the dedup at top
  -- after the first commits.
  perform pg_advisory_xact_lock(hashtext(p_stripe_subscription_id));

  -- Re-check after acquiring the lock — concurrent retry may have
  -- committed by now.
  select s.id, s.org_id into v_existing_sub_id, v_existing_org_id
  from public.subscriptions s
  where s.stripe_subscription_id = p_stripe_subscription_id
  limit 1;

  if v_existing_sub_id is not null then
    return query select v_existing_org_id, v_existing_sub_id;
    return;
  end if;

  -- Pick a unique slug: try base, then base-2, base-3, … up to base-50.
  loop
    v_attempt := v_attempt + 1;
    v_slug := case when v_attempt = 1 then p_slug_base
                   else p_slug_base || '-' || v_attempt::text
              end;
    exit when not exists (select 1 from public.organizations where slug = v_slug);
    if v_attempt >= 50 then
      raise exception 'Could not find a unique slug after 50 attempts for %', p_slug_base;
    end if;
  end loop;

  -- Insert the org.
  insert into public.organizations (name, slug, type, listing_cap, seats_total)
  values (p_org_name, v_slug, 'agent', p_listing_cap, p_seats_included)
  returning id into v_org_id;

  -- Insert owner membership.
  insert into public.organization_members (org_id, user_id, role, joined_at)
  values (v_org_id, p_user_id, 'owner', now());

  -- Insert subscription. status / period fields come from the live
  -- Stripe object the caller fetched fresh.
  insert into public.subscriptions (
    org_id, user_id, plan_id,
    stripe_customer_id, stripe_subscription_id,
    status,
    current_period_start, current_period_end,
    cancel_at_period_end, trial_end
  )
  values (
    v_org_id, null, p_plan_id,
    p_stripe_customer_id, p_stripe_subscription_id,
    p_status,
    p_current_period_start, p_current_period_end,
    p_cancel_at_period_end, p_trial_end
  )
  returning id into v_sub_id;

  return query select v_org_id, v_sub_id;
end;
$$;

-- Service-role only. The webhook handler calls via the admin client.
revoke execute on function public.materialize_subscription_from_checkout(
  uuid, text, text, text, int, int, text, text, text,
  timestamptz, timestamptz, boolean, timestamptz
) from anon, authenticated;
