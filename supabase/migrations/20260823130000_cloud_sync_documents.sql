alter function public.apply_cloud_sync_mutation(uuid, text, text, text, bigint, jsonb)
  rename to balloon_companion_apply_cloud_sync_mutation_logbook_entries;

revoke all on function public.balloon_companion_apply_cloud_sync_mutation_logbook_entries(uuid, text, text, text, bigint, jsonb)
  from public, anon, authenticated;

create or replace function public.apply_cloud_sync_mutation(
  p_mutation_id uuid,
  p_entity_type text,
  p_entity_id text,
  p_operation text,
  p_base_revision bigint,
  p_payload jsonb default '{}'::jsonb
)
returns table (status text, entity_id text, revision bigint, server_updated_at timestamptz, deleted_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  receipt public.sync_idempotency%rowtype;
  current_revision bigint;
  current_updated_at timestamptz;
  current_deleted_at timestamptz;
  result_revision bigint;
  result_updated_at timestamptz;
  result_deleted_at timestamptz;
  invalid_key text;
begin
  if p_entity_type <> 'document' then
    return query select * from public.balloon_companion_apply_cloud_sync_mutation_logbook_entries(
      p_mutation_id, p_entity_type, p_entity_id, p_operation, p_base_revision, p_payload
    );
    return;
  end if;
  if actor_id is null then raise exception using errcode = '42501', message = 'Authenticated user required'; end if;
  if p_mutation_id is null or p_entity_id is null or btrim(p_entity_id) = '' then
    raise exception using errcode = '22023', message = 'mutationId and entityId are required';
  end if;
  if p_base_revision is null or p_base_revision < 0 then
    raise exception using errcode = '22023', message = 'baseRevision must be non-negative';
  end if;
  if p_operation not in ('UPSERT', 'DELETE') then
    raise exception using errcode = '22023', message = 'Unsupported operation';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception using errcode = '22023', message = 'payload must be a JSON object';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(actor_id::text || ':mutation:' || p_mutation_id::text, 0)
  );
  select * into receipt from public.sync_idempotency i
    where i.user_id = actor_id and i.mutation_id = p_mutation_id;
  if found then
    return query select 'ALREADY_APPLIED', receipt.entity_id, receipt.result_revision,
      receipt.server_updated_at, receipt.result_deleted_at;
    return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(actor_id::text || ':entity:document:' || p_entity_id, 0)
  );
  select key into invalid_key from jsonb_object_keys(p_payload) as supplied(key)
  where key <> all (array[
    'balloon_id', 'category', 'title', 'original_filename', 'mime_type', 'size_bytes',
    'notes', 'issue_date', 'expiry_date'
  ]) limit 1;
  if invalid_key is not null then
    raise exception using errcode = '22023', message = 'Payload field is not allowed: ' || invalid_key;
  end if;

  select t.revision, t.updated_at, t.deleted_at
    into current_revision, current_updated_at, current_deleted_at
  from public.documents t
  where t.user_id = actor_id and t.id = p_entity_id
  for update;

  if not found then
    if p_operation = 'DELETE' then
      return query select 'NOT_FOUND', p_entity_id, null::bigint, null::timestamptz, null::timestamptz;
      return;
    end if;
    if p_base_revision <> 0 then
      return query select 'CONFLICT', p_entity_id, null::bigint, null::timestamptz, null::timestamptz;
      return;
    end if;
    insert into public.documents (
      id, user_id, balloon_id, category, title, original_filename, mime_type, size_bytes,
      notes, issue_date, expiry_date
    ) values (
      p_entity_id, actor_id, p_payload->>'balloon_id', p_payload->>'category',
      coalesce(p_payload->>'title', ''), coalesce(p_payload->>'original_filename', ''),
      p_payload->>'mime_type', (p_payload->>'size_bytes')::bigint, p_payload->>'notes',
      (p_payload->>'issue_date')::date, (p_payload->>'expiry_date')::date
    ) returning documents.revision, documents.updated_at, documents.deleted_at
      into result_revision, result_updated_at, result_deleted_at;
  else
    if current_deleted_at is not null or current_revision <> p_base_revision then
      return query select 'CONFLICT', p_entity_id, current_revision, current_updated_at, current_deleted_at;
      return;
    end if;
    if p_operation = 'DELETE' then
      update public.documents t set deleted_at = statement_timestamp()
      where t.user_id = actor_id and t.id = p_entity_id
      returning t.revision, t.updated_at, t.deleted_at
        into result_revision, result_updated_at, result_deleted_at;
    else
      update public.documents t set
        balloon_id = case when p_payload ? 'balloon_id' then p_payload->>'balloon_id' else t.balloon_id end,
        category = case when p_payload ? 'category' then p_payload->>'category' else t.category end,
        title = case when p_payload ? 'title' then p_payload->>'title' else t.title end,
        original_filename = case when p_payload ? 'original_filename' then p_payload->>'original_filename' else t.original_filename end,
        mime_type = case when p_payload ? 'mime_type' then p_payload->>'mime_type' else t.mime_type end,
        size_bytes = case when p_payload ? 'size_bytes' then (p_payload->>'size_bytes')::bigint else t.size_bytes end,
        notes = case when p_payload ? 'notes' then p_payload->>'notes' else t.notes end,
        issue_date = case when p_payload ? 'issue_date' then (p_payload->>'issue_date')::date else t.issue_date end,
        expiry_date = case when p_payload ? 'expiry_date' then (p_payload->>'expiry_date')::date else t.expiry_date end
      where t.user_id = actor_id and t.id = p_entity_id
      returning t.revision, t.updated_at, t.deleted_at
        into result_revision, result_updated_at, result_deleted_at;
    end if;
  end if;

  insert into public.sync_idempotency
    (mutation_id, user_id, entity_type, entity_id, operation, result_revision, server_updated_at, result_deleted_at)
  values
    (p_mutation_id, actor_id, 'document', p_entity_id, p_operation, result_revision, result_updated_at, result_deleted_at);
  return query select 'APPLIED', p_entity_id, result_revision, result_updated_at, result_deleted_at;
end;
$$;

revoke all on function public.apply_cloud_sync_mutation(uuid, text, text, text, bigint, jsonb) from public, anon;
grant execute on function public.apply_cloud_sync_mutation(uuid, text, text, text, bigint, jsonb) to authenticated;
