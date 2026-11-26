-- Run only on a disposable local database with the sync migrations installed.
-- No Supabase remote connection; all fixtures and temporary helpers roll back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();
insert into auth.users(id, aud, role, email) values
 ('16161616-1616-4161-8161-161616161616','authenticated','authenticated','mlm-owner@example.test'),
 ('17171717-1717-4171-8171-171717171717','authenticated','authenticated','mlm-other@example.test');
insert into public.balloons(id,user_id,registration,manufacturer,model,category,volume_m3,applicable_mtom_kg,weights)
 values('mlm-audit','16161616-1616-4161-8161-161616161616','CN-CBN','Cameron','Z275','Libre à air chaud',7788,2494,'{}');

-- Test fixture reset only, not an application RPC. New binding deliberately
-- represents an explicit renewed review, not a calculated documentary proof.
create function pg_temp.reset_mlm_fixture() returns void language sql security definer set search_path = '' as $$
 update public.balloons set registration='CN-CBN',manufacturer='Cameron',model='Z275',category='Libre à air chaud',volume_m3=7788,applicable_mtom_kg=2494,
 weights=pg_catalog.jsonb_build_object('basketKg',300,'fullCylinders',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id','c1','fullWeightKg',150)),
 'minimumLandingMass',pg_catalog.jsonb_build_object('valueKg',1247,'reference','manual/edition/fixture','ruleKey','documentary-fixture',
 'confirmed',true,'confirmationKey',gen_random_uuid()::text))
 where id='mlm-audit' and user_id='16161616-1616-4161-8161-161616161616';
$$;
create function pg_temp.apply_mlm_fixture(payload jsonb) returns text language sql as $$
 select status from public.apply_cloud_sync_mutation(gen_random_uuid(),'balloon','mlm-audit','UPSERT',
 (select revision from public.balloons where id='mlm-audit'),payload);
$$;
select pg_temp.reset_mlm_fixture();
create temporary table mlm_initial as select weights from public.balloons where id='mlm-audit';
select throws_ok($$update public.balloons set weights=NULL where id='mlm-audit'$$,'23502',null,'SQL NULL rejected by NOT NULL');
select throws_ok($$update public.balloons set weights='null'::jsonb where id='mlm-audit'$$,'23514',null,'JSON null rejected by object CHECK, not by jsonb_set');
select throws_ok($$update public.balloons set weights='[]'::jsonb where id='mlm-audit'$$,'23514',null,'array rejected by object CHECK');
select throws_ok($$update public.balloons set weights='42'::jsonb where id='mlm-audit'$$,'23514',null,'scalar rejected by object CHECK');
select is((select weights from public.balloons where id='mlm-audit'),(select weights from mlm_initial),'invalid weights leave the original record intact');
-- No weights in SET: the trigger must still revoke a stale review.
update public.balloons set model='Z105' where id='mlm-audit';
select is((select weights->'minimumLandingMass'->>'confirmed' from public.balloons where id='mlm-audit'),'false','model-only direct update revokes review');
select pg_temp.reset_mlm_fixture();

select ok(not has_table_privilege('authenticated','public.balloons','UPDATE'),'authenticated direct UPDATE remains forbidden');
select ok(not has_function_privilege('anon','public.apply_cloud_sync_mutation(uuid,text,text,text,bigint,jsonb)','EXECUTE'),'anon cannot call sync RPC');
select ok(not has_function_privilege('authenticated','public.preserve_balloon_minimum_landing_mass()','EXECUTE'),'trigger helper has no public application execute grant');
select ok((select prosecdef from pg_proc where oid='public.apply_cloud_sync_mutation(uuid,text,text,text,bigint,jsonb)'::regprocedure),'sync RPC remains SECURITY DEFINER');
select ok(not (select prosecdef from pg_proc where oid='public.preserve_balloon_minimum_landing_mass()'::regprocedure),'MLM trigger is SECURITY INVOKER');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='public.balloons'::regclass),'RLS remains enabled and forced');

set local role authenticated;
select set_config('request.jwt.claim.sub','16161616-1616-4161-8161-161616161616',true);
select is(pg_temp.apply_mlm_fixture('{"weights":{"basketKg":300,"fullCylinders":[{"id":"c1","fullWeightKg":150}]}}'),'APPLIED','old-client RPC accepted');
select is((select weights->'minimumLandingMass'->>'valueKg' from public.balloons where id='mlm-audit'),'1247','old client preserves minimum value');
select is((select weights->'minimumLandingMass'->>'reference' from public.balloons where id='mlm-audit'),'manual/edition/fixture','old client preserves documentary reference');
select is((select weights->'minimumLandingMass'->>'confirmed' from public.balloons where id='mlm-audit'),'true','unchanged configuration preserves confirmation');
select is(pg_temp.apply_mlm_fixture('{"color":"Rouge"}'),'APPLIED','unrelated update accepted');
select is((select weights->'minimumLandingMass'->>'confirmed' from public.balloons where id='mlm-audit'),'true','color change does not revoke review');
select throws_ok($$select pg_temp.apply_mlm_fixture('{"weights":null}')$$,'23514',null,'RPC JSON null rejected atomically');
select throws_ok($$update public.balloons set model='other' where id='mlm-audit'$$,'42501',null,'direct authenticated write still denied');

select pg_temp.reset_mlm_fixture();
select is(pg_temp.apply_mlm_fixture('{"model":"Z105"}'),'APPLIED','old client changes model with weights omitted');
select is((select weights->'minimumLandingMass'->>'confirmed' from public.balloons where id='mlm-audit'),'false','model RPC revokes inherited review');
select ok((select not (weights->'minimumLandingMass' ? 'confirmationKey') from public.balloons where id='mlm-audit'),'stale binding removed');
select is((select weights->'minimumLandingMass'->>'valueKg' from public.balloons where id='mlm-audit'),'1247','invalidation never discards the old value');
select is(pg_temp.apply_mlm_fixture('{"model":"Z275"}'),'APPLIED','model can be restored');
select is((select weights->'minimumLandingMass'->>'confirmed' from public.balloons where id='mlm-audit'),'false','restoring model does not resurrect review');

select pg_temp.reset_mlm_fixture();
select is(pg_temp.apply_mlm_fixture('{"weights":{"basketKg":301,"fullCylinders":[{"id":"c1","fullWeightKg":150}]}}'),'APPLIED','old client changes equipment mass');
select is((select weights->'minimumLandingMass'->>'confirmed' from public.balloons where id='mlm-audit'),'false','equipment change revokes review');
select pg_temp.reset_mlm_fixture();
select is(pg_temp.apply_mlm_fixture('{"weights":{"basketKg":300,"fullCylinders":[{"id":"c2","fullWeightKg":150}]}}'),'APPLIED','equal-mass cylinder replacement accepted');
select is((select weights->'minimumLandingMass'->>'confirmed' from public.balloons where id='mlm-audit'),'false','cylinder identity change revokes review');
select pg_temp.reset_mlm_fixture();
select is(pg_temp.apply_mlm_fixture('{"weights":{}}'),'APPLIED','empty weights object remains schema-valid');
select is((select weights->'minimumLandingMass'->>'valueKg' from public.balloons where id='mlm-audit'),'1247','empty object preserves minimum value');
select is((select weights->'minimumLandingMass'->>'confirmed' from public.balloons where id='mlm-audit'),'false','missing configuration masses revoke confirmation');
select ok((select not (weights ? 'basketKg') from public.balloons where id='mlm-audit'),'empty object never fabricates equipment masses');

select pg_temp.reset_mlm_fixture();
select is(pg_temp.apply_mlm_fixture('{"weights":{"basketKg":300,"fullCylinders":[{"id":"c1","fullWeightKg":150}],"minimumLandingMass":null}}'),'APPLIED','explicit MLM JSON null clears metadata');
select is((select weights->'minimumLandingMass' from public.balloons where id='mlm-audit'),'null'::jsonb,'intentional null remains null');
select is(pg_temp.apply_mlm_fixture('{"weights":{"basketKg":300,"fullCylinders":[{"id":"c1","fullWeightKg":150}]}}'),'APPLIED','subsequent old client accepted');
select is((select weights->'minimumLandingMass' from public.balloons where id='mlm-audit'),'null'::jsonb,'old client cannot resurrect intentionally deleted metadata');

select pg_temp.reset_mlm_fixture();
select is(pg_temp.apply_mlm_fixture(pg_catalog.jsonb_build_object('model','Z105','weights',(select weights from public.balloons where id='mlm-audit'))),'APPLIED','echoing all old weights accepted');
select is((select weights->'minimumLandingMass'->>'confirmed' from public.balloons where id='mlm-audit'),'false','echoed stale confirmation is revoked too');
select pg_temp.reset_mlm_fixture();
select is(pg_temp.apply_mlm_fixture(pg_catalog.jsonb_build_object('model','Z105','weights',(select pg_catalog.jsonb_set(weights,'{minimumLandingMass,confirmationKey}','"new-explicit-review"') from public.balloons where id='mlm-audit'))),'APPLIED','new explicit configuration binding accepted');
select is((select weights->'minimumLandingMass'->>'confirmed' from public.balloons where id='mlm-audit'),'true','explicit renewed review remains available for application validation');

-- Every relevant non-JSON configuration column participates in invalidation.
select pg_temp.reset_mlm_fixture(); select pg_temp.apply_mlm_fixture('{"registration":"CN-OTHER"}');
select is((select weights->'minimumLandingMass'->>'confirmed' from public.balloons where id='mlm-audit'),'false','registration change revokes review');
select pg_temp.reset_mlm_fixture(); select pg_temp.apply_mlm_fixture('{"manufacturer":"Other"}');
select is((select weights->'minimumLandingMass'->>'confirmed' from public.balloons where id='mlm-audit'),'false','manufacturer change revokes review');
select pg_temp.reset_mlm_fixture(); select pg_temp.apply_mlm_fixture('{"volume_m3":7787}');
select is((select weights->'minimumLandingMass'->>'confirmed' from public.balloons where id='mlm-audit'),'false','volume/variant change revokes review');
select pg_temp.reset_mlm_fixture(); select pg_temp.apply_mlm_fixture('{"category":"Libre à gaz"}');
select is((select weights->'minimumLandingMass'->>'confirmed' from public.balloons where id='mlm-audit'),'false','category change revokes review');
select pg_temp.reset_mlm_fixture(); select pg_temp.apply_mlm_fixture('{"applicable_mtom_kg":1999}');
select is((select weights->'minimumLandingMass'->>'confirmed' from public.balloons where id='mlm-audit'),'false','MTOM configuration change revokes review');

-- One revision/receipt per mutation, no extra UPDATE in the trigger.
select pg_temp.reset_mlm_fixture();
select revision as before_revision from public.balloons where id='mlm-audit' \gset
select gen_random_uuid() as replay_id \gset
select is((select status from public.apply_cloud_sync_mutation(:'replay_id','balloon','mlm-audit','UPSERT',:before_revision,'{"model":"Z105"}')),'APPLIED','sync mutation applied');
select is((select revision from public.balloons where id='mlm-audit'),(:before_revision)::bigint+1,'trigger adds exactly one business revision');
select is((select status from public.apply_cloud_sync_mutation(:'replay_id','balloon','mlm-audit','UPSERT',:before_revision,'{"model":"Z105"}')),'ALREADY_APPLIED','idempotent replay unchanged');
select is((select revision from public.balloons where id='mlm-audit'),(:before_revision)::bigint+1,'replay does not increment revision');
select is((select status from public.apply_cloud_sync_mutation(gen_random_uuid(),'balloon','mlm-audit','UPSERT',:before_revision,'{"model":"UNKNOWN"}')),'CONFLICT','stale revision still conflicts');
select is((select model from public.balloons where id='mlm-audit'),'Z105','conflict leaves model intact');

select set_config('request.jwt.claim.sub','17171717-1717-4171-8171-171717171717',true);
select is((select count(*)::integer from public.balloons where id='mlm-audit'),0,'RLS hides another owner’s profile and MLM');
select is((select status from public.apply_cloud_sync_mutation(gen_random_uuid(),'balloon','mlm-audit','UPSERT',1,'{"model":"FORBIDDEN"}')),'CONFLICT','RPC cannot update another owner’s profile');
select set_config('request.jwt.claim.sub','',true);
select throws_ok($$select public.apply_cloud_sync_mutation(gen_random_uuid(),'balloon','mlm-audit','UPSERT',0,'{}')$$,'42501',null,'RPC rejects missing authenticated user');
reset role;
select is((select model from public.balloons where id='mlm-audit'),'Z105','cross-owner attempts leave original row intact');
select * from finish();
rollback;
