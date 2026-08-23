begin;

create extension if not exists pgtap with schema extensions;
select plan(8);

insert into auth.users (id, aud, role, email)
values ('88888888-8888-4888-8888-888888888888', 'authenticated', 'authenticated', 'documents@example.test');

set local role authenticated;
select set_config('request.jwt.claim.sub', '88888888-8888-4888-8888-888888888888', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

insert into public.balloons (id, user_id, registration, display_name, manufacturer, model, category, volume_m3, configuration_limits_confirmed, weights)
values ('balloon-document-parent', '88888888-8888-4888-8888-888888888888', 'F-DOCS', 'F-DOCS', 'Cameron', 'Z105', 'Libre à air chaud', 2973, true, '{}'::jsonb);

select results_eq(
  $$ select status, revision from public.apply_cloud_sync_mutation(
    '50000000-0000-4000-8000-000000000001', 'document', 'document-a', 'UPSERT', 0,
    '{"balloon_id":"balloon-document-parent","category":"INSURANCE","title":"Assurance","original_filename":"assurance.pdf","mime_type":"application/pdf","size_bytes":1234,"notes":"Métadonnées","issue_date":"2026-08-01","expiry_date":"2027-08-01"}'::jsonb) $$,
  $$ values ('APPLIED'::text, 0::bigint) $$,
  'document CREATE revision 0'
);

select results_eq(
  $$ select balloon_id, object_key is null, blob_status from public.documents where id = 'document-a' $$,
  $$ values ('balloon-document-parent'::text, true, 'LOCAL_ONLY'::text) $$,
  'document reste sans blob'
);

select results_eq(
  $$ select status, revision from public.apply_cloud_sync_mutation(
    '50000000-0000-4000-8000-000000000001', 'document', 'document-a', 'UPSERT', 0, '{}'::jsonb) $$,
  $$ values ('ALREADY_APPLIED'::text, 0::bigint) $$,
  'document est idempotent'
);

select results_eq(
  $$ select status, revision from public.apply_cloud_sync_mutation(
    '50000000-0000-4000-8000-000000000002', 'document', 'document-a', 'UPSERT', 0, '{"title":"Assurance mise à jour"}'::jsonb) $$,
  $$ values ('APPLIED'::text, 1::bigint) $$,
  'document UPDATE incrémente la revision'
);

select results_eq(
  $$ select status, revision from public.apply_cloud_sync_mutation(
    '50000000-0000-4000-8000-000000000003', 'document', 'document-a', 'UPSERT', 0, '{"title":"Conflit"}'::jsonb) $$,
  $$ values ('CONFLICT'::text, 1::bigint) $$,
  'document détecte une revision périmée'
);

select throws_ok(
  $$ select * from public.apply_cloud_sync_mutation(
    '50000000-0000-4000-8000-000000000004', 'document', 'document-a', 'UPSERT', 1, '{"object_key":"interdit"}'::jsonb) $$,
  '22023', 'Payload field is not allowed: object_key',
  'document refuse les champs blob'
);

select results_eq(
  $$ select status, revision, deleted_at is not null from public.apply_cloud_sync_mutation(
    '50000000-0000-4000-8000-000000000005', 'document', 'document-a', 'DELETE', 1, '{}'::jsonb) $$,
  $$ values ('APPLIED'::text, 2::bigint, true) $$,
  'document utilise un tombstone versionné'
);

select results_eq(
  $$ select status from public.apply_cloud_sync_mutation(
    '50000000-0000-4000-8000-000000000006', 'document', 'absent', 'DELETE', 0, '{}'::jsonb) $$,
  $$ values ('NOT_FOUND'::text) $$,
  'document DELETE absent retourne NOT_FOUND'
);

select * from finish();
rollback;
