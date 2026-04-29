-- 0001_init.sql
-- Database extensions for AHO. See docs/HANDOFF.md §3.3 + §4.

create extension if not exists "uuid-ossp";
create extension if not exists "citext";
create extension if not exists "pg_trgm";
create extension if not exists "postgis";
create extension if not exists "pgcrypto";

-- pgsodium: encrypted social-platform tokens (HANDOFF_part2 §12.2 + CRITIQUE §B5).
-- Supabase makes this available; enabling explicitly so future Worker code
-- and key-rotation procedures can reference it from any Supabase environment.
create extension if not exists "pgsodium";

-- Reusable updated_at trigger function. Tables that want auto-updated
-- updated_at columns attach this trigger BEFORE UPDATE.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
