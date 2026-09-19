-- Cloud Sync mutations must use apply_cloud_sync_mutation(). Authenticated
-- clients retain read access, while flight trace metadata keeps its existing
-- owner-scoped direct update path.

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'profiles', 'balloons', 'favorite_launch_sites', 'favorite_weather_places',
    'aviation_preferences', 'user_preferences', 'logbook_entries', 'documents',
    'sync_devices', 'sync_idempotency'
  ] loop
    execute format('revoke insert, update, delete on table public.%I from public, anon, authenticated', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_insert_own', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_update_own', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_delete_own', table_name);
  end loop;
end;
$$;

revoke insert, update, delete on table public.flights from public, anon, authenticated;
drop policy if exists flights_insert_own on public.flights;
drop policy if exists flights_delete_own on public.flights;

grant update (
  storage_provider,
  object_key,
  format_version,
  checksum,
  blob_status,
  blob_size,
  track_generation
) on table public.flights to authenticated;

-- flights_update_own remains the RLS boundary for the technical metadata
-- update above. SELECT policies and grants are deliberately unchanged.
