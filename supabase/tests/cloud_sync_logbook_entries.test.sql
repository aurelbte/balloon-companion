begin;

create extension if not exists pgtap with schema extensions;
select plan(7);

insert into auth.users (id, aud, role, email)
values ('77777777-7777-4777-8777-777777777777', 'authenticated', 'authenticated', 'logbook@example.test');

set local role authenticated;
select set_config('request.jwt.claim.sub', '77777777-7777-4777-8777-777777777777', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

insert into public.flights (id, user_id, status, started_at)
values ('flight-logbook', '77777777-7777-4777-8777-777777777777', 'COMPLETED', '2026-08-23T06:00:00Z');

select results_eq(
  $$ select status, revision from public.apply_cloud_sync_mutation(
    '40000000-0000-4000-8000-000000000001', 'logbook_entry', 'ascension-a', 'UPSERT', 0,
    '{"flight_id":"flight-logbook","source":"GPS_BALLOON_COMPANION","date_iso":"2026-08-23","balloon_model":"Z105","balloon_manufacturer":"Cameron","registration":"F-TEST","departure":"Boeschepe","arrival":"Lille","category":"Libre à air chaud","pilot_function":"Pilote","night_flight":false,"maximum_altitude_m":850,"gps_duration_minutes":60,"official_duration_minutes":55,"observations":"RAS","flight_nature":"TRAINING_BPL","takeoff_count":2,"landing_count":2,"instructor":{"name":"Alice","licenceNumber":"FI-1"},"examiner":null}'::jsonb) $$,
  $$ values ('APPLIED'::text, 0::bigint) $$,
  'logbook_entry CREATE revision 0'
);

select results_eq(
  $$ select flight_id, flight_nature, takeoff_count, landing_count, instructor->>'licenceNumber', examiner is null
     from public.logbook_entries where id = 'ascension-a' $$,
  $$ values ('flight-logbook'::text, 'TRAINING_BPL'::text, 2, 2, 'FI-1'::text, true) $$,
  'logbook_entry conserve tous les champs étendus'
);

select results_eq(
  $$ select status, revision from public.apply_cloud_sync_mutation(
    '40000000-0000-4000-8000-000000000001', 'logbook_entry', 'ascension-a', 'UPSERT', 0, '{}'::jsonb) $$,
  $$ values ('ALREADY_APPLIED'::text, 0::bigint) $$,
  'logbook_entry est idempotent'
);

select results_eq(
  $$ select status, revision from public.apply_cloud_sync_mutation(
    '40000000-0000-4000-8000-000000000002', 'logbook_entry', 'ascension-a', 'UPSERT', 0,
    '{"official_duration_minutes":56}'::jsonb) $$,
  $$ values ('APPLIED'::text, 1::bigint) $$,
  'logbook_entry UPDATE incrémente la revision'
);

select results_eq(
  $$ select status, revision from public.apply_cloud_sync_mutation(
    '40000000-0000-4000-8000-000000000003', 'logbook_entry', 'ascension-a', 'UPSERT', 0,
    '{"official_duration_minutes":57}'::jsonb) $$,
  $$ values ('CONFLICT'::text, 1::bigint) $$,
  'logbook_entry détecte une revision périmée'
);

select results_eq(
  $$ select status, revision, deleted_at is not null from public.apply_cloud_sync_mutation(
    '40000000-0000-4000-8000-000000000004', 'logbook_entry', 'ascension-a', 'DELETE', 1, '{}'::jsonb) $$,
  $$ values ('APPLIED'::text, 2::bigint, true) $$,
  'logbook_entry utilise un tombstone versionné'
);

select results_eq(
  $$ select status from public.apply_cloud_sync_mutation(
    '40000000-0000-4000-8000-000000000005', 'logbook_entry', 'absent', 'DELETE', 0, '{}'::jsonb) $$,
  $$ values ('NOT_FOUND'::text) $$,
  'logbook_entry DELETE absent retourne NOT_FOUND'
);

select * from finish();
rollback;
