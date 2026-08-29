begin;

create extension if not exists pgtap with schema extensions;
select plan(26);

insert into auth.users (id, aud, role, email) values
  ('a1000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'rls-a@example.test'),
  ('b2000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'rls-b@example.test'),
  ('c3000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'rls-c@example.test'),
  ('d4000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'rls-d@example.test');

insert into public.friend_profiles (user_id, display_name, handle, search_enabled) values
  ('a1000000-0000-4000-8000-000000000001', 'RLS Pilote A', 'rls.pilot.a', true),
  ('b2000000-0000-4000-8000-000000000002', 'RLS Pilote B', 'rls.pilot.b', true),
  ('c3000000-0000-4000-8000-000000000003', 'RLS Pilote C', 'rls.pilot.c', true),
  ('d4000000-0000-4000-8000-000000000004', 'RLS Pilote D', 'rls.pilot.d', false);

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);

select results_eq(
  $$ select handle from public.friend_profiles where handle = 'rls.pilot.b' $$,
  $$ values ('rls.pilot.b'::text) $$,
  'A trouve le profil partageable de B'
);
select is_empty(
  $$ select handle from public.friend_profiles where handle = 'rls.pilot.d' $$,
  'A ne trouve pas le profil non partageable de D'
);
select lives_ok(
  $$ insert into public.friend_requests (id, sender_id, recipient_id) values ('ab000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000002') $$,
  'A crée une demande vers B sans récursion RLS'
);
select results_eq(
  $$ select id from public.friend_requests where id = 'ab000000-0000-4000-8000-000000000001' $$,
  $$ values ('ab000000-0000-4000-8000-000000000001'::uuid) $$,
  'A voit sa demande envoyée'
);
select throws_ok(
  $$ insert into public.friend_requests (sender_id, recipient_id) values ('a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'A ne peut pas se demander lui-même'
);
select throws_ok(
  $$ insert into public.friend_requests (sender_id, recipient_id) values ('a1000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000002') $$,
  '23505', null, 'une demande active A/B ne peut pas être dupliquée'
);

select set_config('request.jwt.claim.sub', 'b2000000-0000-4000-8000-000000000002', true);
select results_eq(
  $$ select id from public.friend_requests where id = 'ab000000-0000-4000-8000-000000000001' $$,
  $$ values ('ab000000-0000-4000-8000-000000000001'::uuid) $$,
  'B voit la demande reçue'
);
select set_config('request.jwt.claim.sub', 'c3000000-0000-4000-8000-000000000003', true);
select throws_ok(
  $$ select public.accept_friend_request('ab000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'C ne peut pas accepter la demande pending A/B'
);
select throws_ok(
  $$ select public.decline_friend_request('ab000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'C ne peut pas refuser la demande pending A/B'
);
select throws_ok(
  $$ select public.cancel_friend_request('ab000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'C ne peut pas annuler la demande pending A/B'
);
select set_config('request.jwt.claim.sub', 'b2000000-0000-4000-8000-000000000002', true);
select lives_ok(
  $$ select public.accept_friend_request('ab000000-0000-4000-8000-000000000001') $$,
  'B accepte atomiquement la demande de A'
);
select results_eq(
  $$ select count(*)::bigint from public.friendships where user_a = 'a1000000-0000-4000-8000-000000000001' and user_b = 'b2000000-0000-4000-8000-000000000002' and revoked_at is null $$,
  $$ values (1::bigint) $$,
  'acceptation crée exactement une friendship A/B'
);

select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);
select results_eq(
  $$ select count(*)::bigint from public.friendships where user_a = 'a1000000-0000-4000-8000-000000000001' and user_b = 'b2000000-0000-4000-8000-000000000002' $$,
  $$ values (1::bigint) $$,
  'A voit friendship A/B'
);

select set_config('request.jwt.claim.sub', 'b2000000-0000-4000-8000-000000000002', true);
select results_eq(
  $$ select count(*)::bigint from public.friendships where user_a = 'a1000000-0000-4000-8000-000000000001' and user_b = 'b2000000-0000-4000-8000-000000000002' $$,
  $$ values (1::bigint) $$,
  'B voit friendship A/B'
);

select set_config('request.jwt.claim.sub', 'c3000000-0000-4000-8000-000000000003', true);
select is_empty(
  $$ select id from public.friend_requests where id = 'ab000000-0000-4000-8000-000000000001' $$,
  'C ne voit pas la demande A/B'
);
select is_empty(
  $$ select id from public.friendships where user_a = 'a1000000-0000-4000-8000-000000000001' and user_b = 'b2000000-0000-4000-8000-000000000002' $$,
  'C ne voit pas friendship A/B'
);
select throws_ok(
  $$ select public.accept_friend_request('ab000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'C ne peut pas accepter la demande A/B'
);

select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);
select lives_ok(
  $$ insert into public.friend_requests (id, sender_id, recipient_id) values ('ac000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000003') $$,
  'A crée une demande distincte vers C'
);
select set_config('request.jwt.claim.sub', 'c3000000-0000-4000-8000-000000000003', true);
select lives_ok(
  $$ select public.decline_friend_request('ac000000-0000-4000-8000-000000000001') $$,
  'C refuse la demande de A'
);
select is_empty(
  $$ select id from public.friendships where user_a = 'a1000000-0000-4000-8000-000000000001' and user_b = 'c3000000-0000-4000-8000-000000000003' $$,
  'le refus ne crée pas friendship A/C'
);

select set_config('request.jwt.claim.sub', 'b2000000-0000-4000-8000-000000000002', true);
select lives_ok(
  $$ insert into public.friend_requests (id, sender_id, recipient_id) values ('bc000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000002', 'c3000000-0000-4000-8000-000000000003') $$,
  'B crée une demande vers C'
);
select lives_ok(
  $$ select public.cancel_friend_request('bc000000-0000-4000-8000-000000000001') $$,
  'B annule sa demande vers C'
);

select set_config('request.jwt.claim.sub', 'c3000000-0000-4000-8000-000000000003', true);
select throws_ok(
  $$ select public.revoke_friendship((select id from public.friendships where user_a = 'a1000000-0000-4000-8000-000000000001' and user_b = 'b2000000-0000-4000-8000-000000000002')) $$,
  '42501', null, 'C ne peut pas révoquer friendship A/B'
);

select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);
select lives_ok(
  $$ select public.revoke_friendship((select id from public.friendships where user_a = 'a1000000-0000-4000-8000-000000000001' and user_b = 'b2000000-0000-4000-8000-000000000002')) $$,
  'A révoque friendship A/B'
);
select is_empty(
  $$ select id from public.friendships where user_a = 'a1000000-0000-4000-8000-000000000001' and user_b = 'b2000000-0000-4000-8000-000000000002' and revoked_at is null $$,
  'friendship A/B révoquée disparaît des amitiés actives'
);
select results_eq(
  $$ select count(*)::bigint from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname in ('friend_profiles', 'friend_requests', 'friendships') and c.relrowsecurity and c.relforcerowsecurity $$,
  $$ values (3::bigint) $$,
  'RLS reste activée et forcée sur les trois tables'
);

select * from finish();
rollback;
