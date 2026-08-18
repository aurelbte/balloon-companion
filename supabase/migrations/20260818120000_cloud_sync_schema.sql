-- Balloon Companion cloud sync V1: structured metadata only.
-- GPS traces and document binaries intentionally remain outside Postgres.

create or replace function public.balloon_companion_touch_sync_row()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.created_at := old.created_at;
  new.updated_at := statement_timestamp();
  new.revision := old.revision + 1;
  return new;
end;
$$;

create or replace function public.balloon_companion_initialize_sync_row()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.revision := 0;
  new.created_at := statement_timestamp();
  new.updated_at := statement_timestamp();
  return new;
end;
$$;

create table public.profiles (
  id text not null default 'profile',
  user_id uuid not null references auth.users(id) on delete cascade,
  revision bigint not null default 0 check (revision >= 0),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  deleted_at timestamptz,
  first_name text not null default '',
  last_name text not null default '',
  license_number text not null default '',
  usual_function text check (usual_function is null or usual_function in ('Pilote', 'Élève')),
  flight_test_due_date date,
  medical_due_date date,
  experience_confirmed boolean not null default false,
  opening_ascensions integer check (opening_ascensions is null or opening_ascensions >= 0),
  opening_official_duration_minutes integer check (opening_official_duration_minutes is null or opening_official_duration_minutes >= 0),
  primary key (user_id, id),
  unique (user_id)
);

create table public.balloons (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  revision bigint not null default 0 check (revision >= 0),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  deleted_at timestamptz,
  registration text not null,
  display_name text,
  manufacturer text not null,
  model text not null,
  category text not null check (category in ('Libre à air chaud', 'Libre à gaz')),
  volume_m3 numeric not null check (volume_m3 >= 0),
  applicable_mtom_kg numeric check (applicable_mtom_kg is null or applicable_mtom_kg > 0),
  configuration_limits_confirmed boolean not null default false,
  color text,
  weights jsonb not null default '{"fullCylinders":[]}'::jsonb check (jsonb_typeof(weights) = 'object'),
  is_favorite boolean not null default false,
  last_used_at timestamptz,
  primary key (user_id, id)
);

create table public.favorite_launch_sites (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  revision bigint not null default 0 check (revision >= 0),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  deleted_at timestamptz,
  sync_id uuid,
  name text not null,
  source_name text,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  icao_code text,
  altitude_amsl_m double precision,
  primary key (user_id, id)
);

create unique index favorite_launch_sites_user_sync_id_idx
  on public.favorite_launch_sites (user_id, sync_id) where sync_id is not null;

create table public.favorite_weather_places (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  revision bigint not null default 0 check (revision >= 0),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  deleted_at timestamptz,
  sync_id uuid,
  name text not null,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  primary key (user_id, id)
);

create unique index favorite_weather_places_user_sync_id_idx
  on public.favorite_weather_places (user_id, sync_id) where sync_id is not null;

create table public.aviation_preferences (
  id text not null default 'aviation',
  user_id uuid not null references auth.users(id) on delete cascade,
  revision bigint not null default 0 check (revision >= 0),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  deleted_at timestamptz,
  airport_icao text,
  favorites jsonb not null default '[]'::jsonb check (jsonb_typeof(favorites) = 'array'),
  schema_version integer not null default 1 check (schema_version > 0),
  primary key (user_id, id),
  unique (user_id)
);

create table public.user_preferences (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  revision bigint not null default 0 check (revision >= 0),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  deleted_at timestamptz,
  schema_version integer not null default 1 check (schema_version > 0),
  preferences jsonb not null default '{}'::jsonb check (jsonb_typeof(preferences) = 'object'),
  primary key (user_id, id)
);

create table public.flights (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  revision bigint not null default 0 check (revision >= 0),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  deleted_at timestamptz,
  schema_version integer not null default 1 check (schema_version > 0),
  status text not null check (status in ('RECORDING', 'COMPLETED', 'INTERRUPTED')),
  started_at timestamptz not null,
  ended_at timestamptz,
  balloon_id text,
  balloon_registration text,
  start_location_label text,
  end_location_label text,
  generated_title text,
  custom_title text,
  notes text,
  origin text check (origin is null or origin in ('REAL_GPS', 'MANUAL', 'DEMO')),
  logbook_status text check (logbook_status is null or logbook_status in ('CARNET_PENDING', 'CARNET_VALIDATED', 'JOURNAL_ONLY')),
  recovered boolean not null default false,
  summary jsonb not null default '{}'::jsonb check (jsonb_typeof(summary) = 'object'),
  weather_model text,
  weather_snapshot jsonb,
  ground_calibration jsonb,
  storage_provider text,
  object_key text,
  format_version integer check (format_version is null or format_version > 0),
  checksum text,
  blob_status text not null default 'LOCAL_ONLY' check (blob_status in ('LOCAL_ONLY', 'PENDING', 'READY', 'FAILED')),
  blob_size bigint check (blob_size is null or blob_size >= 0),
  primary key (user_id, id),
  foreign key (user_id, balloon_id) references public.balloons(user_id, id)
);

create table public.logbook_entries (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  revision bigint not null default 0 check (revision >= 0),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  deleted_at timestamptz,
  flight_id text,
  source text not null check (source in ('GPS_BALLOON_COMPANION', 'MANUAL')),
  date_iso date not null,
  balloon_model text not null default '',
  balloon_manufacturer text,
  registration text not null default '',
  departure text not null default '',
  arrival text not null default '',
  category text not null check (category in ('Libre à air chaud', 'Libre à gaz')),
  pilot_function text not null check (pilot_function in ('Pilote', 'Élève')),
  night_flight boolean not null default false,
  maximum_altitude_m double precision,
  gps_duration_minutes integer check (gps_duration_minutes is null or gps_duration_minutes >= 0),
  official_duration_minutes integer not null check (official_duration_minutes > 0),
  observations text not null default '',
  logbook_status text check (logbook_status is null or logbook_status in ('CARNET_PENDING', 'CARNET_VALIDATED', 'JOURNAL_ONLY')),
  primary key (user_id, id),
  foreign key (user_id, flight_id) references public.flights(user_id, id)
);

create table public.documents (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  revision bigint not null default 0 check (revision >= 0),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  deleted_at timestamptz,
  balloon_id text not null,
  category text not null check (category in ('REGISTRATION_CERTIFICATE', 'AIRWORTHINESS_CERTIFICATE', 'INSURANCE', 'AIRCRAFT_STATION_LICENCE', 'FLIGHT_MANUAL', 'FLIGHT_MANUAL_SUPPLEMENT', 'WEIGHING_SHEET', 'INSPECTIONS', 'OTHER')),
  title text not null,
  original_filename text not null,
  mime_type text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/heif')),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 26214400),
  notes text,
  issue_date date,
  expiry_date date,
  checksum text,
  storage_provider text,
  object_key text,
  format_version integer check (format_version is null or format_version > 0),
  blob_generation integer not null default 1 check (blob_generation > 0),
  blob_status text not null default 'LOCAL_ONLY' check (blob_status in ('LOCAL_ONLY', 'PENDING', 'READY', 'FAILED')),
  primary key (user_id, id),
  foreign key (user_id, balloon_id) references public.balloons(user_id, id)
);

create table public.sync_devices (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  revision bigint not null default 0 check (revision >= 0),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  deleted_at timestamptz,
  first_seen_at timestamptz not null default statement_timestamp(),
  last_seen_at timestamptz not null default statement_timestamp(),
  last_sync_at timestamptz,
  label text,
  primary key (user_id, id)
);

-- Short-lived receipts make mutation replay idempotent without retaining a permanent event log.
create table public.sync_idempotency (
  mutation_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  entity_type text not null,
  entity_id text not null,
  operation text not null check (operation in ('UPSERT', 'DELETE')),
  result_revision bigint check (result_revision is null or result_revision >= 0),
  created_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null default (statement_timestamp() + interval '90 days'),
  primary key (user_id, mutation_id)
);

create index profiles_user_updated_idx on public.profiles (user_id, updated_at desc);
create index balloons_user_updated_idx on public.balloons (user_id, updated_at desc);
create index favorite_launch_sites_user_updated_idx on public.favorite_launch_sites (user_id, updated_at desc);
create index favorite_weather_places_user_updated_idx on public.favorite_weather_places (user_id, updated_at desc);
create index flights_user_updated_idx on public.flights (user_id, updated_at desc);
create index flights_user_deleted_idx on public.flights (user_id, deleted_at) where deleted_at is not null;
create index logbook_entries_user_updated_idx on public.logbook_entries (user_id, updated_at desc);
create index logbook_entries_flight_idx on public.logbook_entries (user_id, flight_id) where flight_id is not null;
create index documents_balloon_idx on public.documents (user_id, balloon_id);
create index documents_user_updated_idx on public.documents (user_id, updated_at desc);
create index sync_devices_user_last_sync_idx on public.sync_devices (user_id, last_sync_at desc);
create index sync_idempotency_expiry_idx on public.sync_idempotency (expires_at);

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'profiles', 'balloons', 'favorite_launch_sites', 'favorite_weather_places',
    'aviation_preferences', 'user_preferences', 'flights', 'logbook_entries',
    'documents', 'sync_devices', 'sync_idempotency'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('alter table public.%I force row level security', table_name);
    execute format('revoke all on public.%I from anon', table_name);
    execute format('grant select, insert, update, delete on public.%I to authenticated', table_name);
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select auth.uid()) = user_id)',
      table_name || '_select_own', table_name
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated with check ((select auth.uid()) = user_id)',
      table_name || '_insert_own', table_name
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)',
      table_name || '_update_own', table_name
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using ((select auth.uid()) = user_id)',
      table_name || '_delete_own', table_name
    );
  end loop;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'profiles', 'balloons', 'favorite_launch_sites', 'favorite_weather_places',
    'aviation_preferences', 'user_preferences', 'flights', 'logbook_entries',
    'documents', 'sync_devices'
  ] loop
    execute format(
      'create trigger %I before insert on public.%I for each row execute function public.balloon_companion_initialize_sync_row()',
      table_name || '_initialize_sync_row', table_name
    );
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.balloon_companion_touch_sync_row()',
      table_name || '_touch_sync_row', table_name
    );
  end loop;
end;
$$;

comment on table public.flights is 'Structured flight metadata only; the complete GPS trace is stored as an external private blob.';
comment on table public.documents is 'Balloon document metadata only; the original binary is stored as an external private blob.';
comment on column public.sync_devices.id is 'Technical device identifier; never an authentication credential.';

revoke execute on function public.balloon_companion_touch_sync_row() from public, anon, authenticated;
revoke execute on function public.balloon_companion_initialize_sync_row() from public, anon, authenticated;
