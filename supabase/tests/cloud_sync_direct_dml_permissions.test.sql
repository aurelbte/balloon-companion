-- C13 regression tests for a disposable local database with all migrations
-- installed. This test is transactional and always rolls back its fixtures.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, aud, role, email) values
  ('13131313-1313-4313-8313-131313131313', 'authenticated', 'authenticated', 'c13-owner@example.test'),
  ('23232323-2323-4232-8232-232323232323', 'authenticated', 'authenticated', 'c13-other@example.test');

select ok(has_table_privilege('authenticated', 'public.profiles', 'SELECT'), 'authenticated retains profile SELECT');
select ok(has_table_privilege('authenticated', 'public.flights', 'SELECT'), 'authenticated retains flight SELECT');

select ok(not exists (
  select 1 from (values
    ('profiles'), ('balloons'), ('favorite_launch_sites'), ('favorite_weather_places'),
    ('aviation_preferences'), ('user_preferences'), ('logbook_entries'), ('documents'),
    ('sync_devices'), ('sync_idempotency')
  ) as expected(table_name)
  where has_table_privilege('authenticated', 'public.' || expected.table_name, 'INSERT')
     or has_table_privilege('authenticated', 'public.' || expected.table_name, 'UPDATE')
     or has_table_privilege('authenticated', 'public.' || expected.table_name, 'DELETE')
), 'RPC-only and infrastructure tables expose no authenticated direct DML');

select ok(not exists (
  select 1 from pg_policies
  where schemaname = 'public'
    and tablename in (
      'profiles', 'balloons', 'favorite_launch_sites', 'favorite_weather_places',
      'aviation_preferences', 'user_preferences', 'logbook_entries', 'documents',
      'sync_devices', 'sync_idempotency'
    )
    and cmd in ('INSERT', 'UPDATE', 'DELETE')
), 'RPC-only and infrastructure write policies are removed');

select ok(not has_table_privilege('authenticated', 'public.flights', 'INSERT'), 'direct flight INSERT is revoked');
select ok(not has_table_privilege('authenticated', 'public.flights', 'DELETE'), 'direct flight DELETE is revoked');
select ok(not has_table_privilege('authenticated', 'public.flights', 'UPDATE'), 'table-wide direct flight UPDATE is revoked');
select ok(exists (
  select 1 from pg_policies where schemaname = 'public' and tablename = 'flights'
    and policyname = 'flights_update_own' and cmd = 'UPDATE'
), 'owner-scoped flight technical UPDATE policy remains');

select ok(not exists (
  select 1 from (values
    ('storage_provider'), ('object_key'), ('format_version'), ('checksum'),
    ('blob_status'), ('blob_size'), ('track_generation')
  ) as expected(column_name)
  where not has_column_privilege('authenticated', 'public.flights', expected.column_name, 'UPDATE')
), 'authenticated may update exactly the seven flight trace columns');

select ok(not exists (
  select 1 from information_schema.columns c
  where c.table_schema = 'public' and c.table_name = 'flights'
    and c.column_name not in (
      'storage_provider', 'object_key', 'format_version', 'checksum',
      'blob_status', 'blob_size', 'track_generation'
    )
    and has_column_privilege('authenticated', 'public.flights', c.column_name, 'UPDATE')
), 'no business or protocol flight column is directly updateable');

set local role authenticated;
select set_config('request.jwt.claim.sub', '13131313-1313-4313-8313-131313131313', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select results_eq(
  $$select status, revision from public.apply_cloud_sync_mutation(
    '13131313-0000-4000-8000-000000000001', 'profile', 'profile', 'UPSERT', 0,
    '{"first_name":"C13","last_name":"Owner"}'::jsonb)$$,
  $$values ('APPLIED'::text, 0::bigint)$$,
  'RPC CREATE remains functional');
select is((select first_name from public.profiles where id = 'profile'), 'C13', 'owner can still SELECT its row');

select throws_ok(
  $$insert into public.profiles (id, user_id) values ('direct', '13131313-1313-4313-8313-131313131313')$$,
  '42501', null, 'direct INSERT is refused');
select throws_ok(
  $$update public.profiles set first_name = 'bypass' where id = 'profile'$$,
  '42501', null, 'direct UPDATE is refused');
select throws_ok(
  $$delete from public.profiles where id = 'profile'$$,
  '42501', null, 'direct DELETE is refused');

select results_eq(
  $$select status, revision from public.apply_cloud_sync_mutation(
    '13131313-0000-4000-8000-000000000002', 'profile', 'profile', 'UPSERT', 0,
    '{"first_name":"Updated"}'::jsonb)$$,
  $$values ('APPLIED'::text, 1::bigint)$$,
  'RPC UPDATE remains functional');
select results_eq(
  $$select status, revision from public.apply_cloud_sync_mutation(
    '13131313-0000-4000-8000-000000000003', 'profile', 'profile', 'UPSERT', 0,
    '{"first_name":"Stale"}'::jsonb)$$,
  $$values ('CONFLICT'::text, 1::bigint)$$,
  'RPC revision conflict remains enforced');
select results_eq(
  $$select status, revision from public.apply_cloud_sync_mutation(
    '13131313-0000-4000-8000-000000000004', 'profile', 'profile', 'DELETE', 1,
    '{}'::jsonb)$$,
  $$values ('APPLIED'::text, 2::bigint)$$,
  'RPC DELETE remains functional');
select ok((select deleted_at is not null from public.profiles where id = 'profile'), 'RPC DELETE creates a tombstone');
select is((select count(*) from public.profiles where id = 'profile'), 1::bigint, 'RPC DELETE preserves the physical row');
select results_eq(
  $$select status, revision from public.apply_cloud_sync_mutation(
    '13131313-0000-4000-8000-000000000004', 'profile', 'profile', 'DELETE', 1,
    '{}'::jsonb)$$,
  $$values ('ALREADY_APPLIED'::text, 2::bigint)$$,
  'RPC DELETE retry remains idempotent');

select throws_ok(
  $$delete from public.sync_idempotency where user_id = '13131313-1313-4313-8313-131313131313'$$,
  '42501', null, 'authenticated cannot manipulate idempotency receipts');

select results_eq(
  $$select status, revision from public.apply_cloud_sync_mutation(
    '13131313-0000-4000-8000-000000000005', 'flight', 'flight-c13', 'UPSERT', 0,
    '{"status":"COMPLETED","started_at":"2026-09-19T08:00:00Z","notes":"initial"}'::jsonb)$$,
  $$values ('APPLIED'::text, 0::bigint)$$,
  'flight RPC CREATE remains functional');

update public.flights set
  storage_provider = 'R2',
  object_key = 'users/13131313-1313-4313-8313-131313131313/flights/flight-c13/track-v1.json',
  format_version = 1,
  checksum = repeat('a', 64),
  blob_status = 'READY',
  blob_size = 128,
  track_generation = 1
where id = 'flight-c13';
select is((select revision from public.flights where id = 'flight-c13'), 0::bigint, 'seven-column R2 update remains compatible with C3');

select throws_ok(
  $$update public.flights set checksum = repeat('b', 64), notes = 'mixed bypass' where id = 'flight-c13'$$,
  '42501', null, 'mixed technical and business UPDATE is refused');
select throws_ok(
  $$delete from public.flights where id = 'flight-c13'$$,
  '42501', null, 'physical flight DELETE is refused');

select set_config('request.jwt.claim.sub', '23232323-2323-4232-8232-232323232323', true);
update public.flights set checksum = repeat('c', 64) where id = 'flight-c13';
select is((select checksum from public.flights where id = 'flight-c13'), null::text, 'other user cannot observe owner flight');

select * from finish();
rollback;
