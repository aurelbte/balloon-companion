begin;

create extension if not exists pgtap with schema extensions;
select plan(15);

insert into auth.users (id, aud, role, email) values
  ('11111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated', 'a@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'authenticated', 'authenticated', 'b@example.test'),
  ('33333333-3333-4333-8333-333333333333', 'authenticated', 'authenticated', 'c@example.test');
insert into public.friend_profiles (user_id, display_name, handle, search_enabled) values
  ('11111111-1111-4111-8111-111111111111', 'Pilote A', 'pilot.a', true),
  ('22222222-2222-4222-8222-222222222222', 'Pilote B', 'pilot.b', true),
  ('33333333-3333-4333-8333-333333333333', 'Pilote C', 'pilot.c', false);
insert into public.friend_requests (id, sender_id, recipient_id) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333');
insert into public.friendships (id, user_a, user_b) values
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333');

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select throws_ok(
  $$ insert into public.friend_requests (sender_id, recipient_id) values ('11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111') $$,
  '42501', null, 'impossible de se demander soi-même'
);
select throws_ok(
  $$ insert into public.friend_requests (sender_id, recipient_id) values ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222') $$,
  '23505', null, 'impossible de dupliquer une demande pending'
);
select results_eq(
  $$ select handle from public.friend_profiles where search_enabled order by handle $$,
  $$ values ('pilot.a'::text), ('pilot.b'::text) $$,
  'un profil non partageable reste absent de la recherche'
);
select results_eq(
  $$ select id from public.friend_requests order by id $$,
  $$ values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid) $$,
  'A voit uniquement les demandes auxquelles il participe'
);
select is_empty(
  $$ select id from public.friendships $$,
  'A ne voit pas amitié B/C'
);
select throws_ok(
  $$ select public.accept_friend_request('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') $$,
  '42501', null, 'seul le destinataire accepte'
);

select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select lives_ok(
  $$ select public.accept_friend_request('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') $$,
  'B accepte atomiquement la demande de A'
);
select results_eq(
  $$ select count(*)::bigint from public.friendships where user_a = '11111111-1111-4111-8111-111111111111' and user_b = '22222222-2222-4222-8222-222222222222' $$,
  $$ values (1::bigint) $$,
  'acceptation crée exactement une amitié canonique'
);
select results_eq(
  $$ select status from public.friend_requests where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' $$,
  $$ values ('accepted'::text) $$,
  'la demande est acceptée dans la même transaction'
);

select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', true);
select lives_ok(
  $$ select public.decline_friend_request('cccccccc-cccc-4ccc-8ccc-cccccccccccc') $$,
  'C refuse sa demande'
);
select results_eq(
  $$ select count(*)::bigint from public.friendships where user_a = '22222222-2222-4222-8222-222222222222' and user_b = '33333333-3333-4333-8333-333333333333' and created_at > statement_timestamp() - interval '1 minute' $$,
  $$ values (1::bigint) $$,
  'le refus ne crée aucune nouvelle amitié'
);
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select lives_ok(
  $$ select public.revoke_friendship((select id from public.friendships where user_a = '11111111-1111-4111-8111-111111111111' and user_b = '22222222-2222-4222-8222-222222222222')) $$,
  'un membre révoque son amitié'
);
select is_empty(
  $$ select id from public.friendships where revoked_at is null $$,
  'l’amitié révoquée disparaît de la liste active de A'
);

reset role;
select throws_ok(
  $$ insert into public.friend_profiles (user_id, display_name, handle) values ('44444444-4444-4444-8444-444444444444', 'Doublon', 'PILOT.A') $$,
  '23514', null, 'le format impose un handle canonique en minuscules'
);
select results_eq(
  $$ select count(*)::bigint from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname in ('friend_profiles', 'friend_requests', 'friendships') and c.relrowsecurity and c.relforcerowsecurity $$,
  $$ values (3::bigint) $$,
  'RLS forcée sur les trois tables Amis'
);

select * from finish();
rollback;
