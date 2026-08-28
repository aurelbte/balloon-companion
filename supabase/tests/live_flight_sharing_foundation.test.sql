begin;
create extension if not exists pgtap with schema extensions;
select plan(23);

insert into auth.users (id, aud, role, email) values
  ('11111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated', 'a-live@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'authenticated', 'authenticated', 'b-live@example.test'),
  ('33333333-3333-4333-8333-333333333333', 'authenticated', 'authenticated', 'c-live@example.test');
insert into public.friendships (user_a, user_b) values ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222');

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

select lives_ok($$ select public.start_live_share_session(null, array['22222222-2222-4222-8222-222222222222'::uuid], 90) $$, 'A démarre une session avec son ami B');
select throws_ok($$ select public.start_live_share_session(null, array['33333333-3333-4333-8333-333333333333'::uuid], 90) $$, '42501', null, 'A ne peut pas autoriser C non ami');
select throws_ok($$ select public.start_live_share_session(null, array['11111111-1111-4111-8111-111111111111'::uuid], 90) $$, '42501', null, 'A ne peut pas se choisir comme destinataire');
select results_eq($$ select count(*)::bigint from public.live_share_sessions $$, $$ values (1::bigint) $$, 'A voit sa session');
select results_eq($$ select count(*)::bigint from public.live_share_recipients $$, $$ values (1::bigint) $$, 'A voit le destinataire de sa session');
select ok(public.can_send_live_share_topic('flight-share:' || (select id from public.live_share_sessions limit 1)::text), 'A peut émettre sur son canal');

select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select results_eq($$ select count(*)::bigint from public.live_share_sessions $$, $$ values (1::bigint) $$, 'B voit la session après autorisation');
select ok(public.can_receive_live_share_topic('flight-share:' || (select id from public.live_share_sessions limit 1)::text), 'B peut recevoir après autorisation');
select throws_ok($$ select public.heartbeat_live_share_session((select id from public.live_share_sessions limit 1), 90) $$, '42501', null, 'B ne peut pas heartbeat la session de A');

select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', true);
select is_empty($$ select id from public.live_share_sessions $$, 'C ne voit pas la session A/B');
select is(public.can_receive_live_share_topic('flight-share:00000000-0000-4000-8000-000000000000'), false, 'C ne peut écouter A');

select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select lives_ok($$ select public.heartbeat_live_share_session((select id from public.live_share_sessions limit 1), 90) $$, 'owner heartbeat accepté');
select lives_ok($$ select public.revoke_live_share_recipient((select id from public.live_share_sessions limit 1), '22222222-2222-4222-8222-222222222222') $$, 'owner révoque B');
select results_eq($$ select status from public.live_share_sessions limit 1 $$, $$ values ('stopped'::text) $$, 'révocation arrête le canal mis en cache');
select lives_ok($$ select public.start_live_share_session('flight-test', array['22222222-2222-4222-8222-222222222222'::uuid], 90) $$, 'A peut démarrer une nouvelle session indépendante');
select lives_ok($$ select public.stop_live_share_session((select id from public.live_share_sessions where status = 'active' limit 1)) $$, 'A arrête explicitement sa session active');
select is_empty($$ select id from public.live_share_sessions where status = 'active' $$, 'aucune session arrêtée ne reste active');

select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select is_empty($$ select id from public.live_share_sessions $$, 'B perd la lecture après révocation');
select is(public.can_receive_live_share_topic('flight-share:' || (select id from public.live_share_sessions limit 1)::text), false, 'ancien canal inutilisable après révocation');

reset role;
insert into public.live_share_sessions (id, owner_id, status, started_at, expires_at, last_heartbeat_at)
values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', '11111111-1111-4111-8111-111111111111', 'active', statement_timestamp() - interval '2 minutes', statement_timestamp() - interval '1 minute', statement_timestamp() - interval '2 minutes');
insert into public.live_share_recipients (session_id, recipient_id)
values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', '22222222-2222-4222-8222-222222222222');
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select is_empty($$ select id from public.live_share_sessions where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' $$, 'une session sans heartbeat devenue expirée est illisible');
select is(public.can_receive_live_share_topic('flight-share:eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'), false, 'une session expirée est inutilisable sur Realtime');

reset role;
select results_eq($$ select count(*)::bigint from pg_policies where schemaname = 'realtime' and tablename = 'messages' and policyname in ('live_share_broadcast_receive', 'live_share_broadcast_send') $$, $$ values (2::bigint) $$, 'deux policies Realtime Broadcast présentes');
select results_eq($$ select count(*)::bigint from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname in ('live_share_sessions', 'live_share_recipients') and c.relrowsecurity and c.relforcerowsecurity $$, $$ values (2::bigint) $$, 'RLS forcée sur les tables Live');

select * from finish();
rollback;
