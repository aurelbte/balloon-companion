begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

insert into auth.users (id, aud, role, email) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'authenticated', 'authenticated', 'runtime-a@example.test'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'authenticated', 'authenticated', 'runtime-b@example.test'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'authenticated', 'authenticated', 'runtime-c@example.test'),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'authenticated', 'authenticated', 'runtime-d@example.test');
insert into public.friend_profiles (user_id, display_name, handle) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Alice Aéro', 'alice.aero'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Bob Ballon', 'bob.ballon'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Charles Ciel', 'charles.ciel'),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'David Distance', 'david.distance');
insert into public.friendships (user_a, user_b) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc');

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
select lives_ok($$ select public.start_live_share_session('flight-runtime', array['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'::uuid], 90) $$, 'A crée une seule session pour B et C');
select results_eq($$ select count(*)::bigint from public.live_share_sessions where status = 'active' $$, $$ values (1::bigint) $$, 'une publication unique');
select results_eq($$ select count(*)::bigint from public.live_share_recipients where revoked_at is null $$, $$ values (2::bigint) $$, 'deux recipients actifs');

select set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', true);
select results_eq($$ select display_name from public.discover_live_share_sessions() $$, $$ values ('Alice Aéro'::text) $$, 'B découvre seulement la session autorisée de A');
select set_config('request.jwt.claim.sub', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', true);
select is_empty($$ select * from public.discover_live_share_sessions() $$, 'D non ami ne découvre rien');

select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
select lives_ok($$ select public.rotate_live_share_after_recipient_revocation((select id from public.live_share_sessions where status = 'active'), 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 90) $$, 'A révoque B par rotation atomique');
select results_eq($$ select count(*)::bigint from public.live_share_sessions where status = 'active' $$, $$ values (1::bigint) $$, 'une seule nouvelle session reste active');
select results_eq($$ select count(*)::bigint from public.live_share_sessions where status = 'stopped' $$, $$ values (1::bigint) $$, 'ancien topic arrêté immédiatement');
select results_eq($$ select recipient_id from public.live_share_recipients recipient join public.live_share_sessions session on session.id = recipient.session_id where session.status = 'active' and recipient.revoked_at is null $$, $$ values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc'::uuid) $$, 'C seul est reporté sur le nouveau topic');

select set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', true);
select is_empty($$ select * from public.discover_live_share_sessions() $$, 'B révoqué ne découvre plus de session');
select set_config('request.jwt.claim.sub', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', true);
select results_eq($$ select count(*)::bigint from public.discover_live_share_sessions() $$, $$ values (1::bigint) $$, 'C continue sur la nouvelle session');

select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
select lives_ok($$ select public.rotate_live_share_after_recipient_revocation((select id from public.live_share_sessions where status = 'active'), 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 90) $$, 'dernier recipient retiré');
select is_empty($$ select id from public.live_share_sessions where status = 'active' $$, 'dernier recipient arrête la session');

reset role;
select results_eq($$ select count(*)::bigint from information_schema.routines where routine_schema = 'public' and routine_name in ('discover_live_share_sessions', 'rotate_live_share_after_recipient_revocation') $$, $$ values (2::bigint) $$, 'deux fonctions runtime présentes');
select * from finish();
rollback;
