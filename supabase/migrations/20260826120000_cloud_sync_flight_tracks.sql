-- Private, one-object-per-flight GPS trace transport. Apply manually before enabling a real track test.
alter table public.flights
  add column if not exists track_generation integer not null default 1
    check (track_generation > 0);

create index if not exists flights_track_cleanup_idx
  on public.flights (user_id, deleted_at)
  where object_key is not null;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('flight-tracks', 'flight-tracks', false, 52428800, array['application/json'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "flight_tracks_select_own" on storage.objects;
create policy "flight_tracks_select_own" on storage.objects for select to authenticated
using (bucket_id = 'flight-tracks' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "flight_tracks_insert_own" on storage.objects;
create policy "flight_tracks_insert_own" on storage.objects for insert to authenticated
with check (bucket_id = 'flight-tracks' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "flight_tracks_update_own" on storage.objects;
create policy "flight_tracks_update_own" on storage.objects for update to authenticated
using (bucket_id = 'flight-tracks' and (storage.foldername(name))[1] = (select auth.uid())::text)
with check (bucket_id = 'flight-tracks' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "flight_tracks_delete_own" on storage.objects;
create policy "flight_tracks_delete_own" on storage.objects for delete to authenticated
using (bucket_id = 'flight-tracks' and (storage.foldername(name))[1] = (select auth.uid())::text);
