alter table public.logbook_entries
  add column flight_nature text not null default 'STANDARD'
    check (flight_nature in ('STANDARD', 'TRAINING_BPL', 'PROFICIENCY_CHECK_BPL', 'SKILL_TEST', 'COMMERCIAL_TRAINING', 'COMMERCIAL_PROFICIENCY_CHECK', 'INSTRUCTION')),
  add column takeoff_count integer not null default 1 check (takeoff_count >= 0),
  add column landing_count integer not null default 1 check (landing_count >= 0),
  add column instructor jsonb check (instructor is null or jsonb_typeof(instructor) = 'object'),
  add column examiner jsonb check (examiner is null or jsonb_typeof(examiner) = 'object');

create index logbook_entries_user_date_idx on public.logbook_entries (user_id, date_iso desc);
create unique index logbook_entries_user_active_flight_idx
  on public.logbook_entries (user_id, flight_id)
  where flight_id is not null and deleted_at is null;

alter function public.apply_cloud_sync_mutation(uuid, text, text, text, bigint, jsonb)
  rename to balloon_companion_apply_cloud_sync_mutation_3a;

revoke all on function public.balloon_companion_apply_cloud_sync_mutation_3a(uuid, text, text, text, bigint, jsonb)
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
  if p_entity_type not in ('logbook-entry', 'logbook_entry', 'logbook_entries') then
    return query select * from public.balloon_companion_apply_cloud_sync_mutation_3a(
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
    pg_catalog.hashtextextended(actor_id::text || ':entity:logbook_entry:' || p_entity_id, 0)
  );
  select key into invalid_key from jsonb_object_keys(p_payload) as supplied(key)
  where key <> all (array[
    'flight_id', 'source', 'date_iso', 'balloon_model', 'balloon_manufacturer', 'registration',
    'departure', 'arrival', 'category', 'pilot_function', 'night_flight', 'maximum_altitude_m',
    'gps_duration_minutes', 'official_duration_minutes', 'observations', 'flight_nature',
    'takeoff_count', 'landing_count', 'instructor', 'examiner'
  ]) limit 1;
  if invalid_key is not null then
    raise exception using errcode = '22023', message = 'Payload field is not allowed: ' || invalid_key;
  end if;

  select t.revision, t.updated_at, t.deleted_at
    into current_revision, current_updated_at, current_deleted_at
  from public.logbook_entries t
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
    insert into public.logbook_entries (
      id, user_id, flight_id, source, date_iso, balloon_model, balloon_manufacturer, registration,
      departure, arrival, category, pilot_function, night_flight, maximum_altitude_m,
      gps_duration_minutes, official_duration_minutes, observations, flight_nature,
      takeoff_count, landing_count, instructor, examiner
    ) values (
      p_entity_id, actor_id, p_payload->>'flight_id', p_payload->>'source', (p_payload->>'date_iso')::date,
      coalesce(p_payload->>'balloon_model', ''), p_payload->>'balloon_manufacturer', coalesce(p_payload->>'registration', ''),
      coalesce(p_payload->>'departure', ''), coalesce(p_payload->>'arrival', ''), p_payload->>'category',
      p_payload->>'pilot_function', coalesce((p_payload->>'night_flight')::boolean, false),
      (p_payload->>'maximum_altitude_m')::double precision, (p_payload->>'gps_duration_minutes')::integer,
      (p_payload->>'official_duration_minutes')::integer, coalesce(p_payload->>'observations', ''),
      coalesce(p_payload->>'flight_nature', 'STANDARD'), coalesce((p_payload->>'takeoff_count')::integer, 1),
      coalesce((p_payload->>'landing_count')::integer, 1), nullif(p_payload->'instructor', 'null'::jsonb),
      nullif(p_payload->'examiner', 'null'::jsonb)
    ) returning logbook_entries.revision, logbook_entries.updated_at, logbook_entries.deleted_at
      into result_revision, result_updated_at, result_deleted_at;
  else
    if current_deleted_at is not null or current_revision <> p_base_revision then
      return query select 'CONFLICT', p_entity_id, current_revision, current_updated_at, current_deleted_at;
      return;
    end if;
    if p_operation = 'DELETE' then
      update public.logbook_entries t set deleted_at = statement_timestamp()
      where t.user_id = actor_id and t.id = p_entity_id
      returning t.revision, t.updated_at, t.deleted_at
        into result_revision, result_updated_at, result_deleted_at;
    else
      update public.logbook_entries t set
        flight_id = case when p_payload ? 'flight_id' then p_payload->>'flight_id' else t.flight_id end,
        source = case when p_payload ? 'source' then p_payload->>'source' else t.source end,
        date_iso = case when p_payload ? 'date_iso' then (p_payload->>'date_iso')::date else t.date_iso end,
        balloon_model = case when p_payload ? 'balloon_model' then p_payload->>'balloon_model' else t.balloon_model end,
        balloon_manufacturer = case when p_payload ? 'balloon_manufacturer' then p_payload->>'balloon_manufacturer' else t.balloon_manufacturer end,
        registration = case when p_payload ? 'registration' then p_payload->>'registration' else t.registration end,
        departure = case when p_payload ? 'departure' then p_payload->>'departure' else t.departure end,
        arrival = case when p_payload ? 'arrival' then p_payload->>'arrival' else t.arrival end,
        category = case when p_payload ? 'category' then p_payload->>'category' else t.category end,
        pilot_function = case when p_payload ? 'pilot_function' then p_payload->>'pilot_function' else t.pilot_function end,
        night_flight = case when p_payload ? 'night_flight' then (p_payload->>'night_flight')::boolean else t.night_flight end,
        maximum_altitude_m = case when p_payload ? 'maximum_altitude_m' then (p_payload->>'maximum_altitude_m')::double precision else t.maximum_altitude_m end,
        gps_duration_minutes = case when p_payload ? 'gps_duration_minutes' then (p_payload->>'gps_duration_minutes')::integer else t.gps_duration_minutes end,
        official_duration_minutes = case when p_payload ? 'official_duration_minutes' then (p_payload->>'official_duration_minutes')::integer else t.official_duration_minutes end,
        observations = case when p_payload ? 'observations' then p_payload->>'observations' else t.observations end,
        flight_nature = case when p_payload ? 'flight_nature' then p_payload->>'flight_nature' else t.flight_nature end,
        takeoff_count = case when p_payload ? 'takeoff_count' then (p_payload->>'takeoff_count')::integer else t.takeoff_count end,
        landing_count = case when p_payload ? 'landing_count' then (p_payload->>'landing_count')::integer else t.landing_count end,
        instructor = case when p_payload ? 'instructor' then nullif(p_payload->'instructor', 'null'::jsonb) else t.instructor end,
        examiner = case when p_payload ? 'examiner' then nullif(p_payload->'examiner', 'null'::jsonb) else t.examiner end
      where t.user_id = actor_id and t.id = p_entity_id
      returning t.revision, t.updated_at, t.deleted_at
        into result_revision, result_updated_at, result_deleted_at;
    end if;
  end if;

  insert into public.sync_idempotency
    (mutation_id, user_id, entity_type, entity_id, operation, result_revision, server_updated_at, result_deleted_at)
  values
    (p_mutation_id, actor_id, 'logbook_entry', p_entity_id, p_operation, result_revision, result_updated_at, result_deleted_at);
  return query select 'APPLIED', p_entity_id, result_revision, result_updated_at, result_deleted_at;
end;
$$;

revoke all on function public.apply_cloud_sync_mutation(uuid, text, text, text, bigint, jsonb) from public, anon;
grant execute on function public.apply_cloud_sync_mutation(uuid, text, text, text, bigint, jsonb) to authenticated;
