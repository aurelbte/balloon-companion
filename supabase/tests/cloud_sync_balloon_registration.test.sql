begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select no_plan();
-- Test-only access to pgTAP assertions, rolled back with the fixtures.
grant usage on schema extensions to anon, authenticated;
insert into auth.users(id, aud, role, email) values
 ('11111111-1111-4111-8111-111111111111','authenticated','authenticated','c11-a@example.test'),
 ('22222222-2222-4222-8222-222222222222','authenticated','authenticated','c11-b@example.test');
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
create function pg_temp.c11_push(entity text, registration text, token text, base bigint default 0) returns text
language sql as $$
 select status from public.apply_cloud_sync_mutation(md5(token)::uuid, 'balloon', entity, 'UPSERT', base,
 jsonb_build_object('registration',registration,'manufacturer','Cameron','model','Z105','category','Libre à air chaud','volume_m3',2973,'weights','{}'::jsonb));
$$;
-- ACLs must not depend on the migration creator's Supabase defaults.
select ok(has_function_privilege('authenticated','public.apply_cloud_sync_mutation(uuid,text,text,text,bigint,jsonb)','EXECUTE'),'wrapper: authenticated EXECUTE');
select ok(not exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid='public.apply_cloud_sync_mutation(uuid,text,text,text,bigint,jsonb)'::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE'),'wrapper: PUBLIC no EXECUTE');
select ok(not has_function_privilege('anon','public.apply_cloud_sync_mutation(uuid,text,text,text,bigint,jsonb)','EXECUTE'),'wrapper: anon no EXECUTE');
select ok(not has_function_privilege('service_role','public.apply_cloud_sync_mutation(uuid,text,text,text,bigint,jsonb)','EXECUTE'),'wrapper: service_role no EXECUTE');
select ok(not has_function_privilege('authenticated','public.balloon_companion_apply_cloud_sync_mutation_before_c11(uuid,text,text,text,bigint,jsonb)','EXECUTE'),'delegate: authenticated no EXECUTE');
select ok(not has_function_privilege('anon','public.balloon_companion_apply_cloud_sync_mutation_before_c11(uuid,text,text,text,bigint,jsonb)','EXECUTE'),'delegate: anon no EXECUTE');
select ok(not has_function_privilege('service_role','public.balloon_companion_apply_cloud_sync_mutation_before_c11(uuid,text,text,text,bigint,jsonb)','EXECUTE'),'delegate: service_role no EXECUTE');
select ok(not exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid='public.balloon_companion_apply_cloud_sync_mutation_before_c11(uuid,text,text,text,bigint,jsonb)'::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE'),'delegate: PUBLIC no EXECUTE');
select ok(has_function_privilege('authenticated','public.balloon_companion_registration_key(text)','EXECUTE'),'index helper: authenticated EXECUTE required for direct writes');
select ok(not exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid='public.balloon_companion_registration_key(text)'::regprocedure and a.grantee not in (p.proowner,(select oid from pg_roles where rolname='authenticated'))),'index helper: only owner and authenticated ACL');
select ok(not exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid='public.apply_cloud_sync_mutation(uuid,text,text,text,bigint,jsonb)'::regprocedure and a.grantee not in (p.proowner,(select oid from pg_roles where rolname='authenticated'))),'wrapper: only owner and authenticated ACL');
-- Reproduce PostgreSQL's actual expression-index EXECUTE requirement.
revoke execute on function public.balloon_companion_registration_key(text) from authenticated;
set local role authenticated;
select throws_ok($$insert into public.balloons(id,user_id,registration,manufacturer,model,category,volume_m3) values('no-helper-acl',auth.uid(),'F-NOACL','Cameron','Z105','Libre à air chaud',2973)$$,'42501','permission denied for function balloon_companion_registration_key','expression index needs helper EXECUTE for direct INSERT');
reset role;
grant execute on function public.balloon_companion_registration_key(text) to authenticated;
set local role anon;
select throws_ok($$select * from public.apply_cloud_sync_mutation(md5('anon')::uuid,'balloon','anon','UPSERT',0,'{}')$$,'42501',null,'anon cannot call wrapper');
reset role;
set local role authenticated;
select throws_ok($$insert into public.balloons(id,user_id,registration,manufacturer,model,category,volume_m3) values('wrong-user','22222222-2222-4222-8222-222222222222','F-RLS','Cameron','Z105','Libre à air chaud',2973)$$,'42501',null,'direct INSERT remains isolated by RLS');
select lives_ok($$insert into public.balloons(id,user_id,registration,manufacturer,model,category,volume_m3) values('direct-acl',auth.uid(),'F-DIRECT','Cameron','Z105','Libre à air chaud',2973)$$,'direct INSERT works with helper and index');
select lives_ok($$update public.balloons set registration='F-DIRECT2' where id='direct-acl' and user_id=auth.uid()$$,'direct UPDATE maintains expression index');
delete from public.balloons where id='direct-acl' and user_id=auth.uid();
select is(public.balloon_companion_registration_key(' f-abcd '),'F-ABCD','ASCII case/trim');
select is(public.balloon_companion_registration_key(U&'\00A0\FEFFf-abcd\3000\0009'),'F-ABCD','ECMAScript Unicode whitespace');
select is(public.balloon_companion_registration_key('ß-ı-ﬃ-é-σ-ς-𐐨'),'SS-I-FFI-É-Σ-Σ-𐐀','Unicode casing and expansions, independent of SQL collation');
select isnt(public.balloon_companion_registration_key('F ABCD'),public.balloon_companion_registration_key('F-ABCD'),'internal separators preserved');
select isnt(public.balloon_companion_registration_key('F–ABCD'),public.balloon_companion_registration_key('F-ABCD'),'en dash preserved');
select isnt(public.balloon_companion_registration_key('F—ABCD'),public.balloon_companion_registration_key('F-ABCD'),'em dash preserved');
select is(pg_temp.c11_push('a','F-ABCD','create-a'),'APPLIED','first device CREATE');
select is(pg_temp.c11_push('b','F-ABCD','create-b'),'BUSINESS_CONFLICT:DUPLICATE_REGISTRATION','second device CREATE is business conflict');
select is(pg_temp.c11_push('b',' f-abcd ','create-b-case'),'BUSINESS_CONFLICT:DUPLICATE_REGISTRATION','case and trim collision');
select is((select count(*) from public.balloons where user_id=auth.uid() and deleted_at is null),1::bigint,'no second active balloon');
select is((select count(*) from public.sync_idempotency where mutation_id=md5('create-b')::uuid),0::bigint,'business conflict has no successful receipt');
select is(pg_temp.c11_push('a','F-ABCD','create-a'),'ALREADY_APPLIED','successful retry is idempotent');
select is(pg_temp.c11_push('c','F-EFGH','create-c'),'APPLIED','independent balloon');
select is(pg_temp.c11_push('c','F-ABCD','update-c',0),'BUSINESS_CONFLICT:DUPLICATE_REGISTRATION','UPDATE collision is business conflict');
select is((select registration from public.balloons where id='c' and user_id=auth.uid()),'F-EFGH','failed UPDATE retains old value');
select is((select revision from public.balloons where id='c' and user_id=auth.uid()),0::bigint,'failed UPDATE retains revision');
select is(pg_temp.c11_push('c','F-IJKL','update-c-ok',0),'APPLIED','noncollision UPDATE');
select is(pg_temp.c11_push('c','F-ABCD','update-stale',0),'CONFLICT','real revision conflict remains distinct');
select throws_ok($$insert into public.balloons(id,user_id,registration,manufacturer,model,category,volume_m3) values('old-client',auth.uid(),' f-abcd ','Cameron','Z105','Libre à air chaud',2973)$$,
 '23505',null,'old direct client is protected by unique index');
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
select is(pg_temp.c11_push('a','F-ABCD','user-b-create'),'APPLIED','same registration allowed for another user');
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
insert into public.documents(id,user_id,balloon_id,category,title,original_filename,mime_type,size_bytes)
 values('historic-doc',auth.uid(),'a','INSURANCE','Assurance','a.pdf','application/pdf',123);
insert into public.flights(id,user_id,status,started_at,balloon_id,balloon_registration)
 values('historic-flight',auth.uid(),'COMPLETED',now(),'a','F-ABCD');
select is((select status from public.apply_cloud_sync_mutation(md5('delete-a')::uuid,'balloon','a','DELETE',0,'{}')),'APPLIED','DELETE succeeds');
select ok((select deleted_at is not null from public.balloons where id='a' and user_id=auth.uid()),'historical identity remains tombstoned');
select is(pg_temp.c11_push('b','F-ABCD','create-b'),'APPLIED','same rejected mutation retries after owner deletion');
select is(pg_temp.c11_push('b','F-ABCD','create-b'),'ALREADY_APPLIED','retry after resolution is idempotent');
select is((select balloon_id from public.documents where id='historic-doc' and user_id=auth.uid()),'a','document reference is not reassigned');
select is((select balloon_id from public.flights where id='historic-flight' and user_id=auth.uid()),'a','flight reference is not reassigned');
reset role;
-- A different unique index must not be translated into C11.
create unique index c11_test_other_unique on public.balloons(user_id,manufacturer) where id like 'other-%';
select is(pg_temp.c11_push('other-one','F-OTHER1','other-one'),'APPLIED','fixture for unrelated unique error');
select throws_ok($$select pg_temp.c11_push('other-two','F-OTHER2','other-two')$$,'23505',null,'unrelated unique violation remains SQL error');
-- Inspect the exact migration guard with duplicates present; no automatic repair.
drop index public.balloons_user_registration_active_key;
insert into public.balloons(id,user_id,registration,manufacturer,model,category,volume_m3)
 values('preexisting-duplicate',auth.uid(),' f-abcd ','Other','Other','Libre à air chaud',1000);
select throws_ok($test$do $guard$
begin
  if exists (
    select 1 from public.balloons
    where deleted_at is null
    group by user_id, public.balloon_companion_registration_key(registration) collate "C"
    having count(*) > 1
  ) then
    raise exception using errcode = '23505', message = 'C11_PRECHECK_DUPLICATE_ACTIVE_REGISTRATION: resolve duplicates explicitly before deployment';
  end if;
end;
$guard$;$test$, '23505', 'C11_PRECHECK_DUPLICATE_ACTIVE_REGISTRATION: resolve duplicates explicitly before deployment', 'migration guard refuses existing duplicates');
select is((select count(*) from public.balloons where user_id=auth.uid() and deleted_at is null and public.balloon_companion_registration_key(registration)='F-ABCD'),2::bigint,'guard neither deletes nor chooses an identity');
select * from finish();
rollback;
