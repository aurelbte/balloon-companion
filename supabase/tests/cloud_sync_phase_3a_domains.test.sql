begin;

create extension if not exists pgtap with schema extensions;
select plan(20);

insert into auth.users (id, aud, role, email)
values
  ('55555555-5555-4555-8555-555555555555', 'authenticated', 'authenticated', 'phase3a-a@example.test'),
  ('66666666-6666-4666-8666-666666666666', 'authenticated', 'authenticated', 'phase3a-b@example.test');

set local role authenticated;
select set_config('request.jwt.claim.sub', '55555555-5555-4555-8555-555555555555', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select results_eq(
  $$ select status, revision from public.apply_cloud_sync_mutation(
    '30000000-0000-4000-8000-000000000001', 'favorite_launch_site', 'launch-a', 'UPSERT', 0,
    '{"name":"Boeschepe","source_name":"Boeschepe, France","latitude":50.80135,"longitude":2.687643,"icao_code":"LFQO","altitude_amsl_m":48}'::jsonb) $$,
  $$ values ('APPLIED'::text, 0::bigint) $$,
  'favorite_launch_site CREATE revision 0'
);

select results_eq(
  $$ select name, source_name, latitude, longitude, icao_code, altitude_amsl_m
     from public.favorite_launch_sites where id = 'launch-a' $$,
  $$ values ('Boeschepe'::text, 'Boeschepe, France'::text, 50.80135::double precision,
     2.687643::double precision, 'LFQO'::text, 48::double precision) $$,
  'favorite_launch_site conserve les champs métier'
);

select results_eq(
  $$ select status, revision from public.apply_cloud_sync_mutation(
    '30000000-0000-4000-8000-000000000001', 'favorite_launch_site', 'launch-a', 'UPSERT', 0,
    '{"name":"Rejeu interdit"}'::jsonb) $$,
  $$ values ('ALREADY_APPLIED'::text, 0::bigint) $$,
  'favorite_launch_site est idempotent'
);

select results_eq(
  $$ select status, revision from public.apply_cloud_sync_mutation(
    '30000000-0000-4000-8000-000000000002', 'favorite_launch_site', 'launch-a', 'UPSERT', 0,
    '{"name":"Boeschepe Nord"}'::jsonb) $$,
  $$ values ('APPLIED'::text, 1::bigint) $$,
  'favorite_launch_site incrémente sa revision'
);

select results_eq(
  $$ select status, revision from public.apply_cloud_sync_mutation(
    '30000000-0000-4000-8000-000000000003', 'favorite_launch_site', 'launch-a', 'UPSERT', 0,
    '{"name":"Conflit"}'::jsonb) $$,
  $$ values ('CONFLICT'::text, 1::bigint) $$,
  'favorite_launch_site détecte une revision périmée'
);

select throws_ok(
  $$ select * from public.apply_cloud_sync_mutation(
    '30000000-0000-4000-8000-000000000004', 'favorite_launch_site', 'launch-invalid', 'UPSERT', 0,
    '{"name":"Interdit","latitude":50,"longitude":3,"deleted_at":"2026-08-18T00:00:00Z"}'::jsonb) $$,
  '22023', 'Payload field is not allowed: deleted_at',
  'favorite_launch_site refuse les champs serveur'
);

select results_eq(
  $$ select status, revision from public.apply_cloud_sync_mutation(
    '30000000-0000-4000-8000-000000000005', 'user_preferences', 'units', 'UPSERT', 0,
    '{"schema_version":1,"preferences":{"weather":{"windSpeedUnit":"kt"}}}'::jsonb) $$,
  $$ values ('APPLIED'::text, 0::bigint) $$,
  'user_preferences CREATE revision 0'
);

select results_eq(
  $$ select preferences from public.user_preferences where id = 'units' $$,
  $$ values ('{"weather":{"windSpeedUnit":"kt"}}'::jsonb) $$,
  'user_preferences conserve son document de domaine'
);

select results_eq(
  $$ select status, revision from public.apply_cloud_sync_mutation(
    '30000000-0000-4000-8000-000000000006', 'user_preferences', 'units', 'UPSERT', 0,
    '{"preferences":{"weather":{"windSpeedUnit":"km/h"}}}'::jsonb) $$,
  $$ values ('APPLIED'::text, 1::bigint) $$,
  'user_preferences incrémente sa revision'
);

select results_eq(
  $$ select status, revision from public.apply_cloud_sync_mutation(
    '30000000-0000-4000-8000-000000000007', 'user_preferences', 'units', 'UPSERT', 0,
    '{"preferences":{}}'::jsonb) $$,
  $$ values ('CONFLICT'::text, 1::bigint) $$,
  'user_preferences détecte un conflit'
);

select throws_ok(
  $$ select * from public.apply_cloud_sync_mutation(
    '30000000-0000-4000-8000-000000000008', 'user_preferences', 'weather', 'UPSERT', 0,
    '{"preferences":{},"revision":99}'::jsonb) $$,
  '22023', 'Payload field is not allowed: revision',
  'user_preferences refuse revision dans le payload'
);

select results_eq(
  $$ select status, revision from public.apply_cloud_sync_mutation(
    '30000000-0000-4000-8000-000000000009', 'aviation_preferences', 'aviation', 'UPSERT', 0,
    '{"airport_icao":"LFQQ","favorites":[{"icao":"LFQQ","name":"Lille"}],"schema_version":1}'::jsonb) $$,
  $$ values ('APPLIED'::text, 0::bigint) $$,
  'aviation_preferences CREATE revision 0'
);

select results_eq(
  $$ select airport_icao, jsonb_array_length(favorites) from public.aviation_preferences where id = 'aviation' $$,
  $$ values ('LFQQ'::text, 1) $$,
  'aviation_preferences conserve aérodrome et favoris'
);

select results_eq(
  $$ select status, revision from public.apply_cloud_sync_mutation(
    '30000000-0000-4000-8000-000000000009', 'aviation_preferences', 'aviation', 'UPSERT', 0,
    '{"airport_icao":"XXXX"}'::jsonb) $$,
  $$ values ('ALREADY_APPLIED'::text, 0::bigint) $$,
  'aviation_preferences est idempotent'
);

select results_eq(
  $$ select status, revision from public.apply_cloud_sync_mutation(
    '30000000-0000-4000-8000-000000000010', 'aviation_preferences', 'aviation', 'UPSERT', 0,
    '{"airport_icao":"LFAT"}'::jsonb) $$,
  $$ values ('APPLIED'::text, 1::bigint) $$,
  'aviation_preferences incrémente sa revision'
);

select results_eq(
  $$ select status, revision from public.apply_cloud_sync_mutation(
    '30000000-0000-4000-8000-000000000011', 'aviation_preferences', 'aviation', 'UPSERT', 0,
    '{"airport_icao":"EBBR"}'::jsonb) $$,
  $$ values ('CONFLICT'::text, 1::bigint) $$,
  'aviation_preferences détecte un conflit'
);

select throws_ok(
  $$ select * from public.apply_cloud_sync_mutation(
    '30000000-0000-4000-8000-000000000012', 'aviation_preferences', 'aviation-other', 'UPSERT', 0,
    '{"favorites":[],"user_id":"66666666-6666-4666-8666-666666666666"}'::jsonb) $$,
  '22023', 'Payload field is not allowed: user_id',
  'aviation_preferences refuse user_id'
);

select results_eq(
  $$ select status, revision, deleted_at is not null from public.apply_cloud_sync_mutation(
    '30000000-0000-4000-8000-000000000013', 'favorite_launch_site', 'launch-a', 'DELETE', 1, '{}'::jsonb) $$,
  $$ values ('APPLIED'::text, 2::bigint, true) $$,
  'favorite_launch_site utilise le soft delete versionné'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '66666666-6666-4666-8666-666666666666', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select results_eq(
  $$ select status from public.apply_cloud_sync_mutation(
    '30000000-0000-4000-8000-000000000014', 'user_preferences', 'units', 'DELETE', 1, '{}'::jsonb) $$,
  $$ values ('NOT_FOUND'::text) $$,
  'USER B ne peut pas cibler les préférences USER A'
);

select results_eq(
  $$ select count(*)::bigint from public.user_preferences $$,
  $$ values (0::bigint) $$,
  'RLS masque les préférences USER A à USER B'
);

select * from finish();
rollback;
