-- 0043_favorite_remove_event.sql
-- Adds 'favorite_remove' to the property_events.event_type CHECK so the
-- favorite-toggle path can record the un-favorite action symmetrically
-- with 'favorite_add'. Without this, per-property analytics over-counts
-- favorites because toggles cancel out only in the UI, not in the event
-- log (QA report 2026-05-10 P1 #19).

alter table public.property_events
  drop constraint if exists property_events_event_type_check;

alter table public.property_events
  add constraint property_events_event_type_check
  check (event_type in (
    'property_view',
    'image_gallery_open',
    'whatsapp_click',
    'phone_click',
    'email_click',
    'lead_form_submit',
    'favorite_add',
    'favorite_remove',
    'share_click'
  ));
