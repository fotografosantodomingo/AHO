-- 0076_blog_posts_translation_group.sql
--
-- Multi-language blog: one post = one translation group of up to 7
-- rows (one per locale, sharing the same `translation_group_id`).
--
-- v1 ships English-only (one row, group_id=row_id by default — see
-- the trigger below). The next cron run translates each English
-- post into the 6 marketing locales (es / pl / pt / de / fr / it)
-- via Anthropic Haiku and inserts a sibling row per locale, all
-- pointing at the same group_id. The page render + sitemap walk the
-- group to emit hreflang alternates.
--
-- Constraint: WITHIN a group, language is unique. That guarantees
-- exactly one canonical URL per language per topic — Google requires
-- a 1:1 reciprocal hreflang for the rich-snippet rule.
--
-- ai_failed rows are also in a group of 1; they're invisible to the
-- public-facing rendering (RLS gates on status='published') so they
-- don't pollute the sibling lookup.

-- Add the column. Default NULL so existing rows have a group of 1.
-- A trigger backfills `id` into `translation_group_id` on insert when
-- the caller didn't pass one, so the schema-level invariant "every
-- row belongs to a group" holds even when single-language inserts
-- omit the field.
alter table public.blog_posts
  add column translation_group_id uuid;

-- Back-fill existing rows so each is its own group of 1.
update public.blog_posts
   set translation_group_id = id
 where translation_group_id is null;

-- Now make it not-null + index it for the sibling lookup.
alter table public.blog_posts
  alter column translation_group_id set not null;

create index idx_blog_posts_translation_group
  on public.blog_posts(translation_group_id);

-- Within a published group, language is unique. The partial index
-- skips draft / ai_failed / review / archived rows since we only
-- enforce the constraint on public siblings (an ai_failed EN sibling
-- shouldn't block an ES translation from sharing the same group).
create unique index uq_blog_posts_group_language_published
  on public.blog_posts(translation_group_id, language)
  where status = 'published';

-- Trigger: on insert, default translation_group_id to id when the
-- caller doesn't supply one. Lets single-language inserts continue
-- to work without knowing about the group_id field.
create or replace function public.blog_posts_default_group_id()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.translation_group_id is null then
    new.translation_group_id := new.id;
  end if;
  return new;
end;
$$;

revoke all on function public.blog_posts_default_group_id() from public;
grant execute on function public.blog_posts_default_group_id() to service_role;

create trigger blog_posts_default_group_id
  before insert on public.blog_posts
  for each row execute function public.blog_posts_default_group_id();

comment on column public.blog_posts.translation_group_id is
  'UUID linking all language variants of one logical post together. Defaults to the row''s own id on single-language insert; the cron sets it explicitly when inserting a translated sibling. Used by the page-render to emit hreflang alternates + by sitemap-blog.xml to group locale URLs.';
