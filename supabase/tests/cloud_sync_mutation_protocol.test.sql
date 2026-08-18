begin;

create extension if not exists pgtap with schema extensions;
select plan(30);

insert into auth.users (id, aud, role, email)
values
  ('33333333-3333-4333-8333-333333333333', 'authenticated', 'authenticated', 'protocol-a@example.test'),
  ('44444444-4444-4444-8444-444444444444', 'authenticated', 'authenticated', 'protocol-b@example.test');

select is(
  (select prosecdef from pg_proc where oid = 'public.apply_cloud_sync_mutation(uuid,text,text,text,bigint,jsonb)'::regprocedure),
  true,
  'la RPC est SECURITY DEFINER'
);

select is(
  (select proconfig @> array['search_path=""'] from pg_proc where oid = 'public.apply_cloud_sync_mutation(uuid,text,text,text,bigint,jsonb)'::regprocedure),
  true,
  'la RPC fixe un search_path vide'
);

select is(
  has_function_privilege('anon', 'public.apply_cloud_sync_mutation(uuid,text,text,text,bigint,jsonb)', 'EXECUTE'),
  false,
  'anon ne peut pas exécuter la RPC'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select results_eq(
  $$ select status, revision from public.apply_cloud_sync_mutation(
       'aaaaaaaa-0000-4000-8000-000000000001', 'favorite_weather_places', 'weather-a', 'UPSERT', 0,
       '{"name":"Lille","latitude":50.63,"longitude":3.06}'::jsonb) $$,
  $$ values ('APPLIED'::text, 0::bigint) $$,
  'CREATE baseRevision 0 est appliqué avec revision 0'
);

select results_eq(
  $$ select name, latitude, longitude from public.favorite_weather_places where id = 'weather-a' $$,
  $$ values ('Lille'::text, 50.63::double precision, 3.06::double precision) $$,
  'CREATE conserve le payload métier'
);

select results_eq(
  $$ select expires_at >= created_at + interval '89 days' from public.sync_idempotency
     where mutation_id = 'aaaaaaaa-0000-4000-8000-000000000001' $$,
  $$ values (true) $$,
  'le reçu expire après environ 90 jours'
);

select results_eq(
  $$ select status, revision from public.apply_cloud_sync_mutation(
       'aaaaaaaa-0000-4000-8000-000000000001', 'favorite_weather_places', 'weather-a', 'UPSERT', 0,
       '{"name":"Valeur rejouée","latitude":0,"longitude":0}'::jsonb) $$,
  $$ values ('ALREADY_APPLIED'::text, 0::bigint) $$,
  'le même mutationId retourne ALREADY_APPLIED et sa revision originale'
);

select results_eq(
  $$ select revision, name from public.favorite_weather_places where id = 'weather-a' $$,
  $$ values (0::bigint, 'Lille'::text) $$,
  'un replay ne réapplique pas la mutation'
);

select results_eq(
  $$ select status, revision from public.apply_cloud_sync_mutation(
       'aaaaaaaa-0000-4000-8000-000000000002', 'favorite_weather_place', 'weather-a', 'UPSERT', 0,
       '{"name":"Lille centre"}'::jsonb) $$,
  $$ values ('APPLIED'::text, 1::bigint) $$,
  'un UPDATE avec la bonne revision est appliqué et incrémenté'
);

select results_eq(
  $$ select name, revision from public.favorite_weather_places where id = 'weather-a' $$,
  $$ values ('Lille centre'::text, 1::bigint) $$,
  'les données de l UPDATE réussi sont persistées'
);

select results_eq(
  $$ select status, revision, deleted_at is null from public.apply_cloud_sync_mutation(
       'aaaaaaaa-0000-4000-8000-000000000003', 'favorite-weather-place', 'weather-a', 'UPSERT', 0,
       '{"name":"Écrasement interdit"}'::jsonb) $$,
  $$ values ('CONFLICT'::text, 1::bigint, true) $$,
  'une revision périmée retourne le contexte serveur'
);

select results_eq(
  $$ select name, revision from public.favorite_weather_places where id = 'weather-a' $$,
  $$ values ('Lille centre'::text, 1::bigint) $$,
  'un conflit ne modifie pas la donnée serveur'
);

select results_eq(
  $$ select status, revision, deleted_at is not null from public.apply_cloud_sync_mutation(
       'aaaaaaaa-0000-4000-8000-000000000004', 'favorite_weather_place', 'weather-a', 'DELETE', 1, '{}'::jsonb) $$,
  $$ values ('APPLIED'::text, 2::bigint, true) $$,
  'DELETE effectue un soft delete et incrémente la revision'
);

select results_eq(
  $$ select revision, deleted_at is not null from public.favorite_weather_places where id = 'weather-a' $$,
  $$ values (2::bigint, true) $$,
  'le tombstone est persisté'
);

select results_eq(
  $$ select status, revision from public.apply_cloud_sync_mutation(
       'aaaaaaaa-0000-4000-8000-000000000004', 'favorite_weather_place', 'weather-a', 'DELETE', 1, '{}'::jsonb) $$,
  $$ values ('ALREADY_APPLIED'::text, 2::bigint) $$,
  'le replay du DELETE retourne son résultat original'
);

select results_eq(
  $$ select revision from public.favorite_weather_places where id = 'weather-a' $$,
  $$ values (2::bigint) $$,
  'le replay du DELETE n incrémente pas la revision'
);

select results_eq(
  $$ select status, revision, deleted_at is not null from public.apply_cloud_sync_mutation(
       'aaaaaaaa-0000-4000-8000-000000000005', 'favorite_weather_place', 'weather-a', 'UPSERT', 2,
       '{"name":"Résurrection interdite"}'::jsonb) $$,
  $$ values ('CONFLICT'::text, 2::bigint, true) $$,
  'UPSERT sur un tombstone ne ressuscite pas silencieusement'
);

select results_eq(
  $$ select status from public.apply_cloud_sync_mutation(
       'aaaaaaaa-0000-4000-8000-000000000006', 'favorite_weather_place', 'absent', 'DELETE', 0, '{}'::jsonb) $$,
  $$ values ('NOT_FOUND'::text) $$,
  'DELETE sur une entité inexistante retourne NOT_FOUND'
);

select throws_ok(
  $$ select * from public.apply_cloud_sync_mutation(
       'aaaaaaaa-0000-4000-8000-000000000007', 'profile', 'profile', 'UPSERT', 0,
       '{"first_name":"Alice","user_id":"44444444-4444-4444-8444-444444444444"}'::jsonb) $$,
  '22023',
  'Payload field is not allowed: user_id',
  'user_id est refusé par la whitelist'
);

select throws_ok(
  $$ select * from public.apply_cloud_sync_mutation(
       'aaaaaaaa-0000-4000-8000-000000000008', 'flight', 'flight-invalid', 'UPSERT', 0,
       '{"status":"COMPLETED","started_at":"2026-08-18T10:00:00Z","storage_provider":"r2"}'::jsonb) $$,
  '22023',
  'Payload field is not allowed: storage_provider',
  'les métadonnées blob sont refusées par la whitelist métier'
);

select results_eq(
  $$ select status, revision from public.apply_cloud_sync_mutation(
       'aaaaaaaa-0000-4000-8000-000000000009', 'profile', 'profile', 'UPSERT', 0,
       '{"first_name":"Alice","last_name":"Pilote"}'::jsonb) $$,
  $$ values ('APPLIED'::text, 0::bigint) $$,
  'le domaine profile est supporté'
);

select results_eq(
  $$ select status, revision from public.apply_cloud_sync_mutation(
       'aaaaaaaa-0000-4000-8000-000000000010', 'balloon', 'balloon-a', 'UPSERT', 0,
       '{"registration":"F-AAAA","manufacturer":"Cameron","model":"Z105","category":"Libre à air chaud","volume_m3":2973}'::jsonb) $$,
  $$ values ('APPLIED'::text, 0::bigint) $$,
  'le domaine balloon est supporté'
);

select results_eq(
  $$ select status, revision from public.apply_cloud_sync_mutation(
       'aaaaaaaa-0000-4000-8000-000000000011', 'flight', 'flight-a', 'UPSERT', 0,
       '{"status":"COMPLETED","started_at":"2026-08-18T10:00:00Z","balloon_id":"balloon-a","notes":"Vol local"}'::jsonb) $$,
  $$ values ('APPLIED'::text, 0::bigint) $$,
  'le domaine flight est supporté sans champs blob'
);

select results_eq(
  $$ select status from public.apply_cloud_sync_mutation(
       'aaaaaaaa-0000-4000-8000-000000000012', 'favorite_weather_place', 'race', 'UPSERT', 0,
       '{"name":"Initial","latitude":50,"longitude":3}'::jsonb) $$,
  $$ values ('APPLIED'::text) $$,
  'la ligne du test de concurrence est créée'
);

select results_eq(
  $$ select array[
       (select status from public.apply_cloud_sync_mutation('aaaaaaaa-0000-4000-8000-000000000013', 'favorite_weather_place', 'race', 'UPSERT', 0, '{"name":"Gagnant"}'::jsonb)),
       (select status from public.apply_cloud_sync_mutation('aaaaaaaa-0000-4000-8000-000000000014', 'favorite_weather_place', 'race', 'UPSERT', 0, '{"name":"Perdant"}'::jsonb))
     ] $$,
  $$ values (array['APPLIED','CONFLICT']::text[]) $$,
  'deux mutations partant de la même revision ne peuvent pas être APPLIED'
);

select results_eq(
  $$ select name, revision from public.favorite_weather_places where id = 'race' $$,
  $$ values ('Gagnant'::text, 1::bigint) $$,
  'seule la mutation gagnante du test de concurrence est persistée'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '44444444-4444-4444-8444-444444444444', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select results_eq(
  $$ select status, revision from public.apply_cloud_sync_mutation(
       'aaaaaaaa-0000-4000-8000-000000000001', 'favorite_weather_place', 'weather-b', 'UPSERT', 0,
       '{"name":"Bruges","latitude":51.21,"longitude":3.22}'::jsonb) $$,
  $$ values ('APPLIED'::text, 0::bigint) $$,
  'le même mutationId est indépendant entre USER A et USER B'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select results_eq(
  $$ select status from public.apply_cloud_sync_mutation(
       'aaaaaaaa-0000-4000-8000-000000000015', 'favorite_weather_place', 'weather-b', 'DELETE', 0, '{}'::jsonb) $$,
  $$ values ('NOT_FOUND'::text) $$,
  'USER A ne peut pas cibler la ligne de USER B'
);

reset role;

select results_eq(
  $$ select name, revision, deleted_at is null from public.favorite_weather_places
     where user_id = '44444444-4444-4444-8444-444444444444' and id = 'weather-b' $$,
  $$ values ('Bruges'::text, 0::bigint, true) $$,
  'la tentative USER A laisse la ligne USER B intacte'
);

select results_eq(
  $$ select count(*)::bigint from public.sync_idempotency
     where mutation_id = 'aaaaaaaa-0000-4000-8000-000000000001' $$,
  $$ values (2::bigint) $$,
  'les reçus sont scopés par user_id'
);

select * from finish();
rollback;
