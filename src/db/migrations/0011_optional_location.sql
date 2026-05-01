-- 0011_optional_location.sql
-- Make properties.location nullable. Listings without exact lat/lng are
-- legitimate — agents may want to publish without pinning a precise
-- coordinate (privacy on luxury sales, broad-area listings, etc.).
-- Listings without location simply don't appear on the map; search +
-- city landing + agent profile pages still work.
--
-- The sync_property_latlng() trigger from 0007 already handles null
-- correctly: it sets latitude/longitude to null too.

alter table public.properties
  alter column location drop not null;

-- The GIST index keeps working — it just doesn't index null rows.
-- The bbox API (/api/properties/by-bbox) already filters
-- `latitude is not null AND longitude is not null` so listings without
-- location are excluded from map results gracefully.
