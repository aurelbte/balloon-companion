begin;

create extension if not exists pgtap with schema extensions;
select plan(21);

insert into auth.users (id, aud, role, email)
values
  ('11111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated', 'user-a@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'authenticated', 'authenticated', 'user-b@example.test');

insert into public.balloons (id, user_id, registration, manufacturer, model, category, volume_m3)
values
  ('balloon-a', '11111111-1111-4111-8111-111111111111', 'F-AAAA', 'Cameron', 'Z105', 'Libre à air chaud', 2973),
  ('balloon-b', '22222222-2222-4222-8222-222222222222', 'F-BBBB', 'Cameron', 'Z105', 'Libre à air chaud', 2973);

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select results_eq(
  $$ select id from public.balloons order by id $$,
  $$ values ('balloon-a'::text) $$,
  'USER A lit uniquement ses ballons'
);

select lives_ok(
  $$ insert into public.favorite_weather_places (id, user_id, revision, created_at, updated_at, name, latitude, longitude)
     values ('weather-a', '11111111-1111-4111-8111-111111111111', 99, '2000-01-01', '2000-01-01', 'Lille', 50.63, 3.06) $$,
  'USER A insère ses données'
);

select results_eq(
  $$ select revision, created_at = updated_at, created_at > '2020-01-01'::timestamptz
     from public.favorite_weather_places where id = 'weather-a' $$,
  $$ values (0::bigint, true, true) $$,
  'revision et timestamps initiaux sont imposés par le serveur'
);

select results_eq(
  $$ select deleted_at is null from public.favorite_weather_places where id = 'weather-a' $$,
  $$ values (true) $$,
  'deleted_at est nullable et initialement absent'
);

select lives_ok(
  $$ update public.favorite_weather_places set name = 'Lille centre' where id = 'weather-a' $$,
  'USER A modifie ses données'
);

select results_eq(
  $$ select revision from public.favorite_weather_places where id = 'weather-a' $$,
  $$ values (1::bigint) $$,
  'une modification incrémente la révision côté serveur'
);

select results_eq(
  $$ select updated_at > created_at from public.favorite_weather_places where id = 'weather-a' $$,
  $$ values (true) $$,
  'updated_at est remplacé par une heure serveur à UPDATE'
);

select lives_ok(
  $$ update public.favorite_weather_places set deleted_at = statement_timestamp() where id = 'weather-a' $$,
  'USER A peut soft-delete ses données'
);

select results_eq(
  $$ select count(*)::bigint from public.balloons where id = 'balloon-b' $$,
  $$ values (0::bigint) $$,
  'USER A ne lit pas USER B'
);

select results_eq(
  $$ with changed as (update public.balloons set model = 'INTERDIT' where id = 'balloon-b' returning 1) select count(*)::bigint from changed $$,
  $$ values (0::bigint) $$,
  'USER A ne modifie pas USER B'
);

select results_eq(
  $$ with removed as (delete from public.balloons where id = 'balloon-b' returning 1) select count(*)::bigint from removed $$,
  $$ values (0::bigint) $$,
  'USER A ne supprime pas USER B'
);

select throws_ok(
  $$ insert into public.favorite_weather_places (id, user_id, name, latitude, longitude)
     values ('forged', '22222222-2222-4222-8222-222222222222', 'Interdit', 50, 3) $$,
  '42501',
  null,
  'USER A ne peut pas insérer avec user_id USER B'
);

select throws_ok(
  $$ insert into public.documents (id, user_id, balloon_id, category, title, original_filename, mime_type, size_bytes)
     values ('doc-cross-user', '11111111-1111-4111-8111-111111111111', 'balloon-b', 'OTHER', 'Interdit', 'x.pdf', 'application/pdf', 10) $$,
  '23503',
  null,
  'un document USER A ne peut pas référencer un ballon USER B'
);

select lives_ok(
  $$ insert into public.documents (id, user_id, balloon_id, category, title, original_filename, mime_type, size_bytes)
     values ('doc-a', '11111111-1111-4111-8111-111111111111', 'balloon-a', 'OTHER', 'Document', 'x.pdf', 'application/pdf', 10) $$,
  'un document peut référencer un ballon du même utilisateur'
);

select throws_ok(
  $$ insert into public.documents (id, user_id, balloon_id, category, title, original_filename, mime_type, size_bytes)
     values ('doc-too-large', '11111111-1111-4111-8111-111111111111', 'balloon-a', 'OTHER', 'Trop grand', 'large.pdf', 'application/pdf', 26214401) $$,
  '23514',
  null,
  'un document dépassant 25 Mo est refusé'
);

select results_eq(
  $$ select id from public.documents $$,
  $$ values ('doc-a'::text) $$,
  'USER A ne voit que ses documents'
);

select throws_ok(
  $$ insert into public.sync_devices (id, user_id)
     values ('device-forged', '22222222-2222-4222-8222-222222222222') $$,
  '42501',
  null,
  'un device ne peut pas changer le propriétaire imposé par auth.uid()'
);

select lives_ok(
  $$ insert into public.sync_idempotency (mutation_id, user_id, entity_type, entity_id, operation)
     values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'balloon', 'balloon-a', 'UPSERT') $$,
  'USER A peut enregistrer son reçu idempotent'
);

select throws_ok(
  $$ insert into public.sync_idempotency (mutation_id, user_id, entity_type, entity_id, operation)
     values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '22222222-2222-4222-8222-222222222222', 'balloon', 'balloon-b', 'UPSERT') $$,
  '42501',
  null,
  'USER A ne peut pas enregistrer un reçu idempotent pour USER B'
);

reset role;

select results_eq(
  $$ select count(*)::bigint from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = any (array[
       'profiles', 'balloons', 'favorite_launch_sites', 'favorite_weather_places',
       'aviation_preferences', 'user_preferences', 'flights', 'logbook_entries',
       'documents', 'sync_devices', 'sync_idempotency'
     ]) and c.relrowsecurity and c.relforcerowsecurity $$,
  $$ values (11::bigint) $$,
  'RLS est activée et forcée sur les onze tables privées'
);

select results_eq(
  $$ select count(*)::bigint from pg_constraint
     where contype = 'f' and conrelid in ('public.documents'::regclass, 'public.logbook_entries'::regclass, 'public.flights'::regclass)
       and array_length(conkey, 1) = 2 $$,
  $$ values (3::bigint) $$,
  'les trois relations métier utilisent une clé étrangère composite'
);

select * from finish();
rollback;
