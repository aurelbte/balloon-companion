-- C3: trace transport is independent of the flight business revision.
-- Only flights changes trigger; all other tables retain the shared touch function.
create or replace function public.balloon_companion_touch_flight_sync_row()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Preserve the existing immutable creation timestamp.
  new.created_at := old.created_at;
  -- Closed allowlist: every other column (including future columns, ownership,
  -- deleted_at, revision and updated_at) participates in the business comparison.
  if (pg_catalog.to_jsonb(new) - array[
    'storage_provider', 'object_key', 'format_version', 'checksum',
    'blob_status', 'blob_size', 'track_generation'
  ]::text[]) is not distinct from (pg_catalog.to_jsonb(old) - array[
    'storage_provider', 'object_key', 'format_version', 'checksum',
    'blob_status', 'blob_size', 'track_generation'
  ]::text[]) then
    new.revision := old.revision;
    new.updated_at := old.updated_at;
  else
    new.revision := old.revision + 1;
    new.updated_at := statement_timestamp();
  end if;
  return new;
end;
$$;

revoke execute on function public.balloon_companion_touch_flight_sync_row() from public, anon, authenticated;

drop trigger flights_touch_sync_row on public.flights;
create trigger flights_touch_sync_row
before update on public.flights
for each row execute function public.balloon_companion_touch_flight_sync_row();
