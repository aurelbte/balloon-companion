-- C3 regression tests for an isolated disposable database with the versioned
-- schema installed. This file does NOT install/apply migrations. Rollback always.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, aud, role, email) values
('77777777-7777-4777-8777-777777777777', 'authenticated', 'authenticated', 'trace-revision@example.test');
set local role authenticated;
select set_config('request.jwt.claim.sub', '77777777-7777-4777-8777-777777777777', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select results_eq(
 $$select status, revision from public.apply_cloud_sync_mutation(
 'cccccccc-0000-4000-8000-000000000001','flight','trace-c3','UPSERT',0,
 '{"status":"COMPLETED","started_at":"2026-09-17T08:00:00Z","notes":"A"}'::jsonb)$$,
 $$values ('APPLIED'::text,0::bigint)$$, 'initial business sync N=0');
create temporary table c3_before as select revision,updated_at,created_at from public.flights where id='trace-c3';

update public.flights set storage_provider='R2',object_key='users/77777777-7777-4777-8777-777777777777/flights/trace-c3/track-v1.json',
 format_version=1,checksum=repeat('a',64),blob_status='READY',blob_size=100,track_generation=1 where id='trace-c3';
select is((select revision from public.flights where id='trace-c3'),0::bigint,'blob-only preserves revision');
select is((select updated_at from public.flights where id='trace-c3'),(select updated_at from c3_before),'blob-only preserves business timestamp');
select is((select created_at from public.flights where id='trace-c3'),(select created_at from c3_before),'creation timestamp preserved');

-- Retried metadata update / finalization after a lost response.
update public.flights set storage_provider='R2',object_key='users/77777777-7777-4777-8777-777777777777/flights/trace-c3/track-v1.json',
 format_version=1,checksum=repeat('a',64),blob_status='READY',blob_size=100,track_generation=1 where id='trace-c3';
select is((select revision from public.flights where id='trace-c3'),0::bigint,'retry has no revision drift');
select is((select updated_at from public.flights where id='trace-c3'),(select updated_at from c3_before),'retry has no business timestamp drift');

select results_eq(
 $$select status,revision from public.apply_cloud_sync_mutation(
 'cccccccc-0000-4000-8000-000000000002','flight','trace-c3','UPSERT',0,'{"notes":"B"}'::jsonb)$$,
 $$values ('APPLIED'::text,1::bigint)$$,'business edit after upload succeeds at old base N');
select ok((select updated_at > (select updated_at from c3_before) from public.flights where id='trace-c3'),'business update advances updated_at');

update public.flights set notes='mixed',checksum=repeat('b',64) where id='trace-c3';
select is((select revision from public.flights where id='trace-c3'),2::bigint,'mixed update is business N to N+1');

-- Exercise the exact cleanup metadata patch on a live fixture to test the
-- comparison. Operational cleanup separately requires a tombstone (below).
truncate c3_before;
insert into c3_before select revision,updated_at,created_at from public.flights where id='trace-c3';
update public.flights set object_key=null,checksum=null,blob_size=null,blob_status='LOCAL_ONLY',storage_provider=null,format_version=null where id='trace-c3';
select is((select revision from public.flights where id='trace-c3'),2::bigint,'cleanup patch preserves business revision');
select is((select updated_at from public.flights where id='trace-c3'),(select updated_at from c3_before),'cleanup patch preserves business timestamp');
select results_eq(
 $$select status,revision from public.apply_cloud_sync_mutation(
 'cccccccc-0000-4000-8000-000000000003','flight','trace-c3','UPSERT',2,'{"notes":"C"}'::jsonb)$$,
 $$values ('APPLIED'::text,3::bigint)$$,'business edit after cleanup patch succeeds');

-- Legacy migration/replay patches are technical too.
update public.flights set storage_provider='R2',object_key='r2-key' where id='trace-c3';
select is((select revision from public.flights where id='trace-c3'),3::bigint,'legacy provider switch preserves revision');
update public.flights set track_generation=2 where id='trace-c3';
select is((select revision from public.flights where id='trace-c3'),3::bigint,'track generation is technical');

-- A concurrent business writer must still invalidate the old base revision.
update public.flights set notes='concurrent writer' where id='trace-c3';
select results_eq(
 $$select status,revision from public.apply_cloud_sync_mutation(
 'cccccccc-0000-4000-8000-000000000004','flight','trace-c3','UPSERT',3,'{"notes":"stale edit"}'::jsonb)$$,
 $$values ('CONFLICT'::text,4::bigint)$$,'genuine business concurrency still conflicts');
select is((select notes from public.flights where id='trace-c3'),'concurrent writer','conflict does not overwrite server business data');

select results_eq(
 $$select status,revision from public.apply_cloud_sync_mutation(
 'cccccccc-0000-4000-8000-000000000005','flight','trace-c3','DELETE',4,'{}'::jsonb)$$,
 $$values ('APPLIED'::text,5::bigint)$$,'business DELETE increments revision');
truncate c3_before;
insert into c3_before select revision,updated_at,created_at from public.flights where id='trace-c3';
update public.flights set object_key=null,checksum=null,blob_size=null,blob_status='LOCAL_ONLY',storage_provider=null,format_version=null where id='trace-c3';
select is((select revision from public.flights where id='trace-c3'),5::bigint,'cleanup after DELETE preserves revision');
select is((select updated_at from public.flights where id='trace-c3'),(select updated_at from c3_before),'cleanup after DELETE preserves date');
select ok((select deleted_at is not null from public.flights where id='trace-c3'),'cleanup preserves tombstone');
select results_eq(
 $$select status,revision from public.apply_cloud_sync_mutation(
 'cccccccc-0000-4000-8000-000000000005','flight','trace-c3','DELETE',4,'{}'::jsonb)$$,
 $$values ('ALREADY_APPLIED'::text,5::bigint)$$,'DELETE retry remains idempotent after cleanup');
select results_eq(
 $$select status,revision from public.apply_cloud_sync_mutation(
 'cccccccc-0000-4000-8000-000000000006','flight','trace-c3','UPSERT',5,'{"notes":"resurrect"}'::jsonb)$$,
 $$values ('CONFLICT'::text,5::bigint)$$,'tombstone resurrection remains refused');

-- Direct changes to protocol metadata are never considered blob-only.
update public.flights set revision=99,updated_at='2000-01-01Z' where id='trace-c3';
select is((select revision from public.flights where id='trace-c3'),6::bigint,'explicit revision write cannot bypass increment');
select ok((select updated_at > (select updated_at from c3_before) from public.flights where id='trace-c3'),'explicit date write cannot force business date');

select * from finish();
rollback;
