-- 0032_agent_faqs.sql
--
-- Per-org FAQ entries surfaced on the public agent profile page
-- (/en/agents/{slug}, /es/agentes/{slug}). Renders as <details>
-- accordions + emits FAQPage JSON-LD so Google can attach the entries
-- as rich-result snippets in SERP.
--
-- Each row is bilingual (question_en/es + answer_en/es). Both languages
-- are independently optional — if only EN is filled, only the EN locale
-- shows the FAQ; ES locale silently omits it (no fallback across
-- languages, per the project's no-language-fallback rule).
--
-- RLS:
--   - anon SELECT: rows owned by an org that has ≥1 active+published
--     listing (mirrors the pattern in migration 0031). Keeps FAQs
--     private until the org has public inventory.
--   - org owner/manager INSERT/UPDATE/DELETE on their own org's rows.
--   - super-admin: full read/write via the existing platform-admin path.

create table public.agent_faqs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  question_en text,
  question_es text,
  answer_en text,
  answer_es text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- At least one bilingual pair must be filled so the row is usable.
  -- Empty rows would render as broken "Q. — A. —" in the UI.
  constraint agent_faqs_at_least_one_locale check (
    (question_en is not null and answer_en is not null)
    or (question_es is not null and answer_es is not null)
  )
);

create index idx_agent_faqs_org_sort on public.agent_faqs (org_id, sort_order);

create trigger agent_faqs_updated_at
  before update on public.agent_faqs
  for each row execute function public.touch_updated_at();

alter table public.agent_faqs enable row level security;

-- Anon read — only when the org has public listings.
drop policy if exists agent_faqs_public_select on public.agent_faqs;
create policy agent_faqs_public_select on public.agent_faqs
  for select
  using (
    exists (
      select 1
      from public.properties p
      where p.org_id = agent_faqs.org_id
        and p.status = 'active'
        and p.published_at is not null
    )
  );

-- Org members with manage-rights (owner or manager) can do everything
-- on their own org's FAQs. Read-only roles (analyst, viewer) cannot.
drop policy if exists agent_faqs_org_admin_all on public.agent_faqs;
create policy agent_faqs_org_admin_all on public.agent_faqs
  for all
  using (
    exists (
      select 1
      from public.organization_members m
      where m.org_id = agent_faqs.org_id
        and m.user_id = auth.uid()
        and m.role in ('owner', 'manager')
    )
  )
  with check (
    exists (
      select 1
      from public.organization_members m
      where m.org_id = agent_faqs.org_id
        and m.user_id = auth.uid()
        and m.role in ('owner', 'manager')
    )
  );

-- Super-admin escape hatch — mirrors the pattern in 0002.
drop policy if exists agent_faqs_platform_admin_all on public.agent_faqs;
create policy agent_faqs_platform_admin_all on public.agent_faqs
  for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());
