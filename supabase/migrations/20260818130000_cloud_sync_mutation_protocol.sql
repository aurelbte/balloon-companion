-- Balloon Companion cloud sync V1 mutation protocol.
-- A synchronized creation is revision 0; every later successful mutation increments it.

alter table public.sync_idempotency
  add column server_updated_at timestamptz,
  add column result_deleted_at timestamptz;

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
    when 'profile' then 'profile' when 'profiles' then 'profile'
    when 'balloon' then 'balloon' when 'balloons' then 'balloon'
    when 'favorite-weather-place' then 'favorite_weather_place'
    when 'favorite_weather_place' then 'favorite_weather_place'
    when 'favorite_weather_places' then 'favorite_weather_place'
    when 'flight' then 'flight' when 'flights' then 'flight'
    else null
  end;
  if canonical_type is null then
    raise exception using errcode = '22023', message = 'Unsupported entityType';
  end if;

  -- Serializes replays before any business write, including concurrent first attempts.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor_id::text || ':mutation:' || p_mutation_id::text, 0));
  select * into receipt
  from public.sync_idempotency i
  where i.user_id = actor_id and i.mutation_id = p_mutation_id;
  if found then
    return query select 'ALREADY_APPLIED', receipt.entity_id, receipt.result_revision,
      receipt.server_updated_at, receipt.result_deleted_at;
    return;
  end if;

  -- Serializes competing revisions and also protects the not-yet-created row case.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor_id::text || ':entity:' || canonical_type || ':' || p_entity_id, 0));

  select key into invalid_key
  from jsonb_object_keys(p_payload) as supplied(key)
  where not (case canonical_type
    when 'profile' then key = any (array['first_name','last_name','license_number','usual_function','flight_test_due_date','medical_due_date','experience_confirmed','opening_ascensions','opening_official_duration_minutes'])
    when 'balloon' then key = any (array['registration','display_name','manufacturer','model','category','volume_m3','applicable_mtom_kg','configuration_limits_confirmed','color','weights','is_favorite','last_used_at'])
    when 'favorite_weather_place' then key = any (array['sync_id','name','latitude','longitude'])
    when 'flight' then key = any (array['schema_version','status','started_at','ended_at','balloon_id','balloon_registration','start_location_label','end_location_label','generated_title','custom_title','notes','origin','logbook_status','recovered','summary','weather_model','weather_snapshot','ground_calibration'])
    else false end)
  limit 1;
  if invalid_key is not null then
    raise exception using errcode = '22023', message = 'Payload field is not allowed: ' || invalid_key;
  end if;

  if canonical_type = 'profile' then
    select t.revision, t.updated_at, t.deleted_at into current_revision, current_updated_at, current_deleted_at
    from public.profiles t where t.user_id = actor_id and t.id = p_entity_id for update;
  elsif canonical_type = 'balloon' then
    select t.revision, t.updated_at, t.deleted_at into current_revision, current_updated_at, current_deleted_at
    from public.balloons t where t.user_id = actor_id and t.id = p_entity_id for update;
  elsif canonical_type = 'favorite_weather_place' then
    select t.revision, t.updated_at, t.deleted_at into current_revision, current_updated_at, current_deleted_at
    from public.favorite_weather_places t where t.user_id = actor_id and t.id = p_entity_id for update;
  else
    select t.revision, t.updated_at, t.deleted_at into current_revision, current_updated_at, current_deleted_at
    from public.flights t where t.user_id = actor_id and t.id = p_entity_id for update;
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

    if canonical_type = 'profile' then
      insert into public.profiles (id, user_id, first_name, last_name, license_number, usual_function,
        flight_test_due_date, medical_due_date, experience_confirmed, opening_ascensions, opening_official_duration_minutes)
      values (p_entity_id, actor_id, coalesce(p_payload->>'first_name',''), coalesce(p_payload->>'last_name',''),
        coalesce(p_payload->>'license_number',''), p_payload->>'usual_function', (p_payload->>'flight_test_due_date')::date,
        (p_payload->>'medical_due_date')::date, coalesce((p_payload->>'experience_confirmed')::boolean,false),
        (p_payload->>'opening_ascensions')::integer, (p_payload->>'opening_official_duration_minutes')::integer)
      returning profiles.revision, profiles.updated_at, profiles.deleted_at into result_revision, result_updated_at, result_deleted_at;
    elsif canonical_type = 'balloon' then
      insert into public.balloons (id, user_id, registration, display_name, manufacturer, model, category, volume_m3,
        applicable_mtom_kg, configuration_limits_confirmed, color, weights, is_favorite, last_used_at)
      values (p_entity_id, actor_id, p_payload->>'registration', p_payload->>'display_name', p_payload->>'manufacturer',
        p_payload->>'model', p_payload->>'category', (p_payload->>'volume_m3')::numeric,
        (p_payload->>'applicable_mtom_kg')::numeric, coalesce((p_payload->>'configuration_limits_confirmed')::boolean,false),
        p_payload->>'color', coalesce(p_payload->'weights','{"fullCylinders":[]}'::jsonb),
        coalesce((p_payload->>'is_favorite')::boolean,false), (p_payload->>'last_used_at')::timestamptz)
      returning balloons.revision, balloons.updated_at, balloons.deleted_at into result_revision, result_updated_at, result_deleted_at;
    elsif canonical_type = 'favorite_weather_place' then
      insert into public.favorite_weather_places (id, user_id, sync_id, name, latitude, longitude)
      values (p_entity_id, actor_id, (p_payload->>'sync_id')::uuid, p_payload->>'name',
        (p_payload->>'latitude')::double precision, (p_payload->>'longitude')::double precision)
      returning favorite_weather_places.revision, favorite_weather_places.updated_at, favorite_weather_places.deleted_at
      into result_revision, result_updated_at, result_deleted_at;
    else
      insert into public.flights (id, user_id, schema_version, status, started_at, ended_at, balloon_id,
        balloon_registration, start_location_label, end_location_label, generated_title, custom_title, notes, origin,
        logbook_status, recovered, summary, weather_model, weather_snapshot, ground_calibration)
      values (p_entity_id, actor_id, coalesce((p_payload->>'schema_version')::integer,1), p_payload->>'status',
        (p_payload->>'started_at')::timestamptz, (p_payload->>'ended_at')::timestamptz, p_payload->>'balloon_id',
        p_payload->>'balloon_registration', p_payload->>'start_location_label', p_payload->>'end_location_label',
        p_payload->>'generated_title', p_payload->>'custom_title', p_payload->>'notes', p_payload->>'origin',
        p_payload->>'logbook_status', coalesce((p_payload->>'recovered')::boolean,false), coalesce(p_payload->'summary','{}'::jsonb),
        p_payload->>'weather_model', p_payload->'weather_snapshot', p_payload->'ground_calibration')
      returning flights.revision, flights.updated_at, flights.deleted_at into result_revision, result_updated_at, result_deleted_at;
    end if;
  else
    if current_deleted_at is not null or current_revision <> p_base_revision then
      return query select 'CONFLICT', p_entity_id, current_revision, current_updated_at, current_deleted_at;
      return;
    end if;

    if p_operation = 'DELETE' then
      if canonical_type = 'profile' then
        update public.profiles t set deleted_at = statement_timestamp() where t.user_id = actor_id and t.id = p_entity_id
        returning t.revision, t.updated_at, t.deleted_at into result_revision, result_updated_at, result_deleted_at;
      elsif canonical_type = 'balloon' then
        update public.balloons t set deleted_at = statement_timestamp() where t.user_id = actor_id and t.id = p_entity_id
        returning t.revision, t.updated_at, t.deleted_at into result_revision, result_updated_at, result_deleted_at;
      elsif canonical_type = 'favorite_weather_place' then
        update public.favorite_weather_places t set deleted_at = statement_timestamp() where t.user_id = actor_id and t.id = p_entity_id
        returning t.revision, t.updated_at, t.deleted_at into result_revision, result_updated_at, result_deleted_at;
      else
        update public.flights t set deleted_at = statement_timestamp() where t.user_id = actor_id and t.id = p_entity_id
        returning t.revision, t.updated_at, t.deleted_at into result_revision, result_updated_at, result_deleted_at;
      end if;
    elsif canonical_type = 'profile' then
      update public.profiles t set
        first_name = case when p_payload ? 'first_name' then p_payload->>'first_name' else t.first_name end,
        last_name = case when p_payload ? 'last_name' then p_payload->>'last_name' else t.last_name end,
        license_number = case when p_payload ? 'license_number' then p_payload->>'license_number' else t.license_number end,
        usual_function = case when p_payload ? 'usual_function' then p_payload->>'usual_function' else t.usual_function end,
        flight_test_due_date = case when p_payload ? 'flight_test_due_date' then (p_payload->>'flight_test_due_date')::date else t.flight_test_due_date end,
        medical_due_date = case when p_payload ? 'medical_due_date' then (p_payload->>'medical_due_date')::date else t.medical_due_date end,
        experience_confirmed = case when p_payload ? 'experience_confirmed' then (p_payload->>'experience_confirmed')::boolean else t.experience_confirmed end,
        opening_ascensions = case when p_payload ? 'opening_ascensions' then (p_payload->>'opening_ascensions')::integer else t.opening_ascensions end,
        opening_official_duration_minutes = case when p_payload ? 'opening_official_duration_minutes' then (p_payload->>'opening_official_duration_minutes')::integer else t.opening_official_duration_minutes end
      where t.user_id = actor_id and t.id = p_entity_id
      returning t.revision, t.updated_at, t.deleted_at into result_revision, result_updated_at, result_deleted_at;
    elsif canonical_type = 'balloon' then
      update public.balloons t set
        registration = case when p_payload ? 'registration' then p_payload->>'registration' else t.registration end,
        display_name = case when p_payload ? 'display_name' then p_payload->>'display_name' else t.display_name end,
        manufacturer = case when p_payload ? 'manufacturer' then p_payload->>'manufacturer' else t.manufacturer end,
        model = case when p_payload ? 'model' then p_payload->>'model' else t.model end,
        category = case when p_payload ? 'category' then p_payload->>'category' else t.category end,
        volume_m3 = case when p_payload ? 'volume_m3' then (p_payload->>'volume_m3')::numeric else t.volume_m3 end,
        applicable_mtom_kg = case when p_payload ? 'applicable_mtom_kg' then (p_payload->>'applicable_mtom_kg')::numeric else t.applicable_mtom_kg end,
        configuration_limits_confirmed = case when p_payload ? 'configuration_limits_confirmed' then (p_payload->>'configuration_limits_confirmed')::boolean else t.configuration_limits_confirmed end,
        color = case when p_payload ? 'color' then p_payload->>'color' else t.color end,
        weights = case when p_payload ? 'weights' then p_payload->'weights' else t.weights end,
        is_favorite = case when p_payload ? 'is_favorite' then (p_payload->>'is_favorite')::boolean else t.is_favorite end,
        last_used_at = case when p_payload ? 'last_used_at' then (p_payload->>'last_used_at')::timestamptz else t.last_used_at end
      where t.user_id = actor_id and t.id = p_entity_id
      returning t.revision, t.updated_at, t.deleted_at into result_revision, result_updated_at, result_deleted_at;
    elsif canonical_type = 'favorite_weather_place' then
      update public.favorite_weather_places t set
        sync_id = case when p_payload ? 'sync_id' then (p_payload->>'sync_id')::uuid else t.sync_id end,
        name = case when p_payload ? 'name' then p_payload->>'name' else t.name end,
        latitude = case when p_payload ? 'latitude' then (p_payload->>'latitude')::double precision else t.latitude end,
        longitude = case when p_payload ? 'longitude' then (p_payload->>'longitude')::double precision else t.longitude end
      where t.user_id = actor_id and t.id = p_entity_id
      returning t.revision, t.updated_at, t.deleted_at into result_revision, result_updated_at, result_deleted_at;
    else
      update public.flights t set
        schema_version = case when p_payload ? 'schema_version' then (p_payload->>'schema_version')::integer else t.schema_version end,
        status = case when p_payload ? 'status' then p_payload->>'status' else t.status end,
        started_at = case when p_payload ? 'started_at' then (p_payload->>'started_at')::timestamptz else t.started_at end,
        ended_at = case when p_payload ? 'ended_at' then (p_payload->>'ended_at')::timestamptz else t.ended_at end,
        balloon_id = case when p_payload ? 'balloon_id' then p_payload->>'balloon_id' else t.balloon_id end,
        balloon_registration = case when p_payload ? 'balloon_registration' then p_payload->>'balloon_registration' else t.balloon_registration end,
        start_location_label = case when p_payload ? 'start_location_label' then p_payload->>'start_location_label' else t.start_location_label end,
        end_location_label = case when p_payload ? 'end_location_label' then p_payload->>'end_location_label' else t.end_location_label end,
        generated_title = case when p_payload ? 'generated_title' then p_payload->>'generated_title' else t.generated_title end,
        custom_title = case when p_payload ? 'custom_title' then p_payload->>'custom_title' else t.custom_title end,
        notes = case when p_payload ? 'notes' then p_payload->>'notes' else t.notes end,
        origin = case when p_payload ? 'origin' then p_payload->>'origin' else t.origin end,
        logbook_status = case when p_payload ? 'logbook_status' then p_payload->>'logbook_status' else t.logbook_status end,
        recovered = case when p_payload ? 'recovered' then (p_payload->>'recovered')::boolean else t.recovered end,
        summary = case when p_payload ? 'summary' then p_payload->'summary' else t.summary end,
        weather_model = case when p_payload ? 'weather_model' then p_payload->>'weather_model' else t.weather_model end,
        weather_snapshot = case when p_payload ? 'weather_snapshot' then p_payload->'weather_snapshot' else t.weather_snapshot end,
        ground_calibration = case when p_payload ? 'ground_calibration' then p_payload->'ground_calibration' else t.ground_calibration end
      where t.user_id = actor_id and t.id = p_entity_id
      returning t.revision, t.updated_at, t.deleted_at into result_revision, result_updated_at, result_deleted_at;
    end if;
  end if;

  insert into public.sync_idempotency
    (mutation_id, user_id, entity_type, entity_id, operation, result_revision, server_updated_at, result_deleted_at)
  values
    (p_mutation_id, actor_id, canonical_type, p_entity_id, p_operation, result_revision, result_updated_at, result_deleted_at);

  return query select 'APPLIED', p_entity_id, result_revision, result_updated_at, result_deleted_at;
end;
$$;

comment on function public.apply_cloud_sync_mutation(uuid, text, text, text, bigint, jsonb) is
  'Atomic authenticated V1 mutation protocol. User ownership comes exclusively from auth.uid().';

revoke all on function public.apply_cloud_sync_mutation(uuid, text, text, text, bigint, jsonb) from public, anon;
grant execute on function public.apply_cloud_sync_mutation(uuid, text, text, text, bigint, jsonb) to authenticated;
