-- Phase 3A adds only the three server domains required by the first client sync.
-- The Phase 2B implementation is retained privately for its existing explicit domains.

alter function public.apply_cloud_sync_mutation(uuid, text, text, text, bigint, jsonb)
  rename to balloon_companion_apply_cloud_sync_mutation_2b;

revoke all on function public.balloon_companion_apply_cloud_sync_mutation_2b(uuid, text, text, text, bigint, jsonb)
  from public, anon, authenticated;

create or replace function public.apply_cloud_sync_mutation(
  p_mutation_id uuid,
  p_entity_type text,
  p_entity_id text,
  p_operation text,
  p_base_revision bigint,
  p_payload jsonb default '{}'::jsonb
)
returns table (
  status text,
  entity_id text,
  revision bigint,
  server_updated_at timestamptz,
  deleted_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  canonical_type text;
  receipt public.sync_idempotency%rowtype;
  current_revision bigint;
  current_updated_at timestamptz;
  current_deleted_at timestamptz;
  result_revision bigint;
  result_updated_at timestamptz;
  result_deleted_at timestamptz;
  invalid_key text;
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'Authenticated user required';
  end if;

  -- Existing Phase 2B domains remain implemented by explicit, non-dynamic branches.
  if p_entity_type = any (array[
    'profile', 'profiles', 'balloon', 'balloons',
    'favorite-weather-place', 'favorite_weather_place', 'favorite_weather_places',
    'flight', 'flights'
  ]) then
    return query select * from public.balloon_companion_apply_cloud_sync_mutation_2b(
      p_mutation_id, p_entity_type, p_entity_id, p_operation, p_base_revision, p_payload
    );
    return;
  end if;

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

  canonical_type := case p_entity_type
    when 'favorite-launch-site' then 'favorite_launch_site'
    when 'favorite_launch_site' then 'favorite_launch_site'
    when 'favorite_launch_sites' then 'favorite_launch_site'
    when 'user-preferences' then 'user_preferences'
    when 'user_preferences' then 'user_preferences'
    when 'aviation-preferences' then 'aviation_preferences'
    when 'aviation_preferences' then 'aviation_preferences'
    else null
  end;
  if canonical_type is null then
    raise exception using errcode = '22023', message = 'Unsupported entityType';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(actor_id::text || ':mutation:' || p_mutation_id::text, 0)
  );
  select * into receipt
  from public.sync_idempotency i
  where i.user_id = actor_id and i.mutation_id = p_mutation_id;
  if found then
    return query select 'ALREADY_APPLIED', receipt.entity_id, receipt.result_revision,
      receipt.server_updated_at, receipt.result_deleted_at;
    return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(actor_id::text || ':entity:' || canonical_type || ':' || p_entity_id, 0)
  );

  select key into invalid_key
  from jsonb_object_keys(p_payload) as supplied(key)
  where not (case canonical_type
    when 'favorite_launch_site' then key = any (array[
      'sync_id', 'name', 'source_name', 'latitude', 'longitude', 'icao_code', 'altitude_amsl_m'
    ])
    when 'user_preferences' then key = any (array['schema_version', 'preferences'])
    when 'aviation_preferences' then key = any (array['airport_icao', 'favorites', 'schema_version'])
    else false end)
  limit 1;
  if invalid_key is not null then
    raise exception using errcode = '22023', message = 'Payload field is not allowed: ' || invalid_key;
  end if;

  if canonical_type = 'favorite_launch_site' then
    select t.revision, t.updated_at, t.deleted_at
      into current_revision, current_updated_at, current_deleted_at
    from public.favorite_launch_sites t
    where t.user_id = actor_id and t.id = p_entity_id
    for update;
  elsif canonical_type = 'user_preferences' then
    select t.revision, t.updated_at, t.deleted_at
      into current_revision, current_updated_at, current_deleted_at
    from public.user_preferences t
    where t.user_id = actor_id and t.id = p_entity_id
    for update;
  else
    select t.revision, t.updated_at, t.deleted_at
      into current_revision, current_updated_at, current_deleted_at
    from public.aviation_preferences t
    where t.user_id = actor_id and t.id = p_entity_id
    for update;
  end if;

  if not found then
    if p_operation = 'DELETE' then
      return query select 'NOT_FOUND', p_entity_id, null::bigint, null::timestamptz, null::timestamptz;
      return;
    end if;
    if p_base_revision <> 0 then
      return query select 'CONFLICT', p_entity_id, null::bigint, null::timestamptz, null::timestamptz;
      return;
    end if;

    if canonical_type = 'favorite_launch_site' then
      insert into public.favorite_launch_sites
        (id, user_id, sync_id, name, source_name, latitude, longitude, icao_code, altitude_amsl_m)
      values
        (p_entity_id, actor_id, (p_payload->>'sync_id')::uuid, p_payload->>'name',
         p_payload->>'source_name', (p_payload->>'latitude')::double precision,
         (p_payload->>'longitude')::double precision, p_payload->>'icao_code',
         (p_payload->>'altitude_amsl_m')::double precision)
      returning favorite_launch_sites.revision, favorite_launch_sites.updated_at,
        favorite_launch_sites.deleted_at
      into result_revision, result_updated_at, result_deleted_at;
    elsif canonical_type = 'user_preferences' then
      insert into public.user_preferences (id, user_id, schema_version, preferences)
      values (p_entity_id, actor_id, coalesce((p_payload->>'schema_version')::integer, 1),
        coalesce(p_payload->'preferences', '{}'::jsonb))
      returning user_preferences.revision, user_preferences.updated_at, user_preferences.deleted_at
      into result_revision, result_updated_at, result_deleted_at;
    else
      insert into public.aviation_preferences (id, user_id, airport_icao, favorites, schema_version)
      values (p_entity_id, actor_id, p_payload->>'airport_icao',
        coalesce(p_payload->'favorites', '[]'::jsonb),
        coalesce((p_payload->>'schema_version')::integer, 1))
      returning aviation_preferences.revision, aviation_preferences.updated_at,
        aviation_preferences.deleted_at
      into result_revision, result_updated_at, result_deleted_at;
    end if;
  else
    if current_deleted_at is not null or current_revision <> p_base_revision then
      return query select 'CONFLICT', p_entity_id, current_revision, current_updated_at, current_deleted_at;
      return;
    end if;

    if p_operation = 'DELETE' then
      if canonical_type = 'favorite_launch_site' then
        update public.favorite_launch_sites t set deleted_at = statement_timestamp()
        where t.user_id = actor_id and t.id = p_entity_id
        returning t.revision, t.updated_at, t.deleted_at
        into result_revision, result_updated_at, result_deleted_at;
      elsif canonical_type = 'user_preferences' then
        update public.user_preferences t set deleted_at = statement_timestamp()
        where t.user_id = actor_id and t.id = p_entity_id
        returning t.revision, t.updated_at, t.deleted_at
        into result_revision, result_updated_at, result_deleted_at;
      else
        update public.aviation_preferences t set deleted_at = statement_timestamp()
        where t.user_id = actor_id and t.id = p_entity_id
        returning t.revision, t.updated_at, t.deleted_at
        into result_revision, result_updated_at, result_deleted_at;
      end if;
    elsif canonical_type = 'favorite_launch_site' then
      update public.favorite_launch_sites t set
        sync_id = case when p_payload ? 'sync_id' then (p_payload->>'sync_id')::uuid else t.sync_id end,
        name = case when p_payload ? 'name' then p_payload->>'name' else t.name end,
        source_name = case when p_payload ? 'source_name' then p_payload->>'source_name' else t.source_name end,
        latitude = case when p_payload ? 'latitude' then (p_payload->>'latitude')::double precision else t.latitude end,
        longitude = case when p_payload ? 'longitude' then (p_payload->>'longitude')::double precision else t.longitude end,
        icao_code = case when p_payload ? 'icao_code' then p_payload->>'icao_code' else t.icao_code end,
        altitude_amsl_m = case when p_payload ? 'altitude_amsl_m' then (p_payload->>'altitude_amsl_m')::double precision else t.altitude_amsl_m end
      where t.user_id = actor_id and t.id = p_entity_id
      returning t.revision, t.updated_at, t.deleted_at
      into result_revision, result_updated_at, result_deleted_at;
    elsif canonical_type = 'user_preferences' then
      update public.user_preferences t set
        schema_version = case when p_payload ? 'schema_version' then (p_payload->>'schema_version')::integer else t.schema_version end,
        preferences = case when p_payload ? 'preferences' then p_payload->'preferences' else t.preferences end
      where t.user_id = actor_id and t.id = p_entity_id
      returning t.revision, t.updated_at, t.deleted_at
      into result_revision, result_updated_at, result_deleted_at;
    else
      update public.aviation_preferences t set
        airport_icao = case when p_payload ? 'airport_icao' then p_payload->>'airport_icao' else t.airport_icao end,
        favorites = case when p_payload ? 'favorites' then p_payload->'favorites' else t.favorites end,
        schema_version = case when p_payload ? 'schema_version' then (p_payload->>'schema_version')::integer else t.schema_version end
      where t.user_id = actor_id and t.id = p_entity_id
      returning t.revision, t.updated_at, t.deleted_at
      into result_revision, result_updated_at, result_deleted_at;
    end if;
  end if;

  insert into public.sync_idempotency
    (mutation_id, user_id, entity_type, entity_id, operation, result_revision,
     server_updated_at, result_deleted_at)
  values
    (p_mutation_id, actor_id, canonical_type, p_entity_id, p_operation, result_revision,
     result_updated_at, result_deleted_at);

  return query select 'APPLIED', p_entity_id, result_revision, result_updated_at, result_deleted_at;
end;
$$;

comment on function public.apply_cloud_sync_mutation(uuid, text, text, text, bigint, jsonb) is
  'Atomic authenticated V1 mutation protocol extended for Phase 3A preferences and launch favorites.';

revoke all on function public.apply_cloud_sync_mutation(uuid, text, text, text, bigint, jsonb)
  from public, anon;
grant execute on function public.apply_cloud_sync_mutation(uuid, text, text, text, bigint, jsonb)
  to authenticated;
