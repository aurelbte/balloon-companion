-- Ephemeral live-flight authorization only. No position or GPS history is stored here.

create table public.live_share_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  flight_id text,
  status text not null default 'active' check (status in ('active', 'stopped')),
  started_at timestamptz not null default statement_timestamp(),
  ended_at timestamptz,
  expires_at timestamptz not null,
  last_heartbeat_at timestamptz not null default statement_timestamp(),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  check ((status = 'active' and ended_at is null) or (status = 'stopped' and ended_at is not null)),
  check (expires_at > started_at)
);

create table public.live_share_recipients (
  session_id uuid not null references public.live_share_sessions(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  granted_at timestamptz not null default statement_timestamp(),
  revoked_at timestamptz,
  primary key (session_id, recipient_id)
);

create index live_share_sessions_owner_active_idx on public.live_share_sessions (owner_id, expires_at desc) where status = 'active';
create index live_share_recipients_recipient_active_idx on public.live_share_recipients (recipient_id, session_id) where revoked_at is null;

alter table public.live_share_sessions enable row level security;
alter table public.live_share_sessions force row level security;
alter table public.live_share_recipients enable row level security;
alter table public.live_share_recipients force row level security;
revoke all on public.live_share_sessions, public.live_share_recipients from anon;
grant select on public.live_share_sessions, public.live_share_recipients to authenticated;

create or replace function public.can_read_live_share_session(p_session_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.live_share_sessions session
    where session.id = p_session_id
      and (
        session.owner_id = auth.uid()
        or (session.status = 'active' and session.expires_at > statement_timestamp() and exists (
          select 1 from public.live_share_recipients recipient
          where recipient.session_id = session.id and recipient.recipient_id = auth.uid() and recipient.revoked_at is null
        ))
      )
  );
$$;

create or replace function public.can_manage_live_share_session(p_session_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.live_share_sessions where id = p_session_id and owner_id = auth.uid());
$$;

create or replace function public.can_receive_live_share_topic(p_topic text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.live_share_sessions session
    where p_topic = 'flight-share:' || session.id::text
      and session.status = 'active' and session.expires_at > statement_timestamp()
      and (session.owner_id = auth.uid() or exists (
        select 1 from public.live_share_recipients recipient
        where recipient.session_id = session.id and recipient.recipient_id = auth.uid() and recipient.revoked_at is null
      ))
  );
$$;

create or replace function public.can_send_live_share_topic(p_topic text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.live_share_sessions session
    where p_topic = 'flight-share:' || session.id::text
      and session.owner_id = auth.uid() and session.status = 'active' and session.expires_at > statement_timestamp()
  );
$$;

create policy live_share_sessions_select_authorized on public.live_share_sessions
for select to authenticated using (
  public.can_read_live_share_session(id)
);

create policy live_share_recipients_select_authorized on public.live_share_recipients
for select to authenticated using (
  recipient_id = (select auth.uid())
  or public.can_manage_live_share_session(session_id)
);

create or replace function public.start_live_share_session(
  p_flight_id text,
  p_recipient_ids uuid[],
  p_ttl_seconds integer default 90
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  session_id uuid;
  recipient_count integer;
  authorized_count integer;
begin
  if actor_id is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if p_ttl_seconds < 60 or p_ttl_seconds > 180 then raise exception 'INVALID_LIVE_TTL' using errcode = '22023'; end if;
  select count(distinct requested.recipient_id) into recipient_count
  from unnest(coalesce(p_recipient_ids, '{}'::uuid[])) as requested(recipient_id);
  if recipient_count < 1 then raise exception 'LIVE_RECIPIENT_REQUIRED' using errcode = '22023'; end if;
  if actor_id = any(p_recipient_ids) then raise exception 'LIVE_SELF_RECIPIENT_FORBIDDEN' using errcode = '42501'; end if;
  select count(*) into authorized_count
  from (select distinct recipient_id from unnest(p_recipient_ids) as input(recipient_id)) requested
  where exists (
    select 1 from public.friendships friendship
    where friendship.revoked_at is null
      and friendship.user_a = least(actor_id, requested.recipient_id)
      and friendship.user_b = greatest(actor_id, requested.recipient_id)
  );
  if authorized_count <> recipient_count then raise exception 'LIVE_RECIPIENT_NOT_ACTIVE_FRIEND' using errcode = '42501'; end if;
  insert into public.live_share_sessions (owner_id, flight_id, expires_at)
  values (actor_id, nullif(trim(p_flight_id), ''), statement_timestamp() + make_interval(secs => p_ttl_seconds))
  returning id into session_id;
  insert into public.live_share_recipients (session_id, recipient_id)
  select session_id, recipient_id from (select distinct recipient_id from unnest(p_recipient_ids) as input(recipient_id)) requested;
  return session_id;
end;
$$;

create or replace function public.heartbeat_live_share_session(p_session_id uuid, p_ttl_seconds integer default 90)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); next_expiry timestamptz;
begin
  if actor_id is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if p_ttl_seconds < 60 or p_ttl_seconds > 180 then raise exception 'INVALID_LIVE_TTL' using errcode = '22023'; end if;
  update public.live_share_sessions set
    last_heartbeat_at = statement_timestamp(),
    expires_at = statement_timestamp() + make_interval(secs => p_ttl_seconds),
    updated_at = statement_timestamp()
  where id = p_session_id and owner_id = actor_id and status = 'active' and expires_at > statement_timestamp()
  returning expires_at into next_expiry;
  if not found then raise exception 'LIVE_SESSION_NOT_HEARTBEATABLE' using errcode = '42501'; end if;
  return next_expiry;
end;
$$;

create or replace function public.stop_live_share_session(p_session_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid();
begin
  if actor_id is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  update public.live_share_sessions set status = 'stopped', ended_at = statement_timestamp(), expires_at = statement_timestamp(), updated_at = statement_timestamp()
  where id = p_session_id and owner_id = actor_id and status = 'active';
  if not found then raise exception 'LIVE_SESSION_NOT_STOPPABLE' using errcode = '42501'; end if;
  update public.live_share_recipients set revoked_at = coalesce(revoked_at, statement_timestamp()) where session_id = p_session_id;
end;
$$;

create or replace function public.add_live_share_recipient(p_session_id uuid, p_recipient_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid();
begin
  if actor_id is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if actor_id = p_recipient_id then raise exception 'LIVE_SELF_RECIPIENT_FORBIDDEN' using errcode = '42501'; end if;
  if not exists (select 1 from public.live_share_sessions where id = p_session_id and owner_id = actor_id and status = 'active' and expires_at > statement_timestamp()) then raise exception 'LIVE_SESSION_NOT_ACTIVE' using errcode = '42501'; end if;
  if not exists (select 1 from public.friendships where revoked_at is null and user_a = least(actor_id, p_recipient_id) and user_b = greatest(actor_id, p_recipient_id)) then raise exception 'LIVE_RECIPIENT_NOT_ACTIVE_FRIEND' using errcode = '42501'; end if;
  insert into public.live_share_recipients (session_id, recipient_id, revoked_at) values (p_session_id, p_recipient_id, null)
  on conflict (session_id, recipient_id) do update set granted_at = statement_timestamp(), revoked_at = null;
end;
$$;

-- Realtime permissions are cached for a connected channel. Revoking one recipient
-- therefore stops the whole session; continuing requires a new session/topic.
create or replace function public.revoke_live_share_recipient(p_session_id uuid, p_recipient_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid();
begin
  if actor_id is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if not exists (select 1 from public.live_share_sessions where id = p_session_id and owner_id = actor_id and status = 'active') then raise exception 'LIVE_SESSION_NOT_ACTIVE' using errcode = '42501'; end if;
  update public.live_share_recipients set revoked_at = statement_timestamp() where session_id = p_session_id and recipient_id = p_recipient_id and revoked_at is null;
  if not found then raise exception 'LIVE_RECIPIENT_NOT_REVOCABLE' using errcode = '42501'; end if;
  update public.live_share_sessions set status = 'stopped', ended_at = statement_timestamp(), expires_at = statement_timestamp(), updated_at = statement_timestamp() where id = p_session_id;
  update public.live_share_recipients set revoked_at = coalesce(revoked_at, statement_timestamp()) where session_id = p_session_id;
end;
$$;

create policy live_share_broadcast_receive on realtime.messages
for select to authenticated using (
  realtime.messages.extension = 'broadcast'
  and public.can_receive_live_share_topic((select realtime.topic()))
);

create policy live_share_broadcast_send on realtime.messages
for insert to authenticated with check (
  realtime.messages.extension = 'broadcast'
  and public.can_send_live_share_topic((select realtime.topic()))
);

revoke execute on function public.can_read_live_share_session(uuid) from public, anon;
revoke execute on function public.can_manage_live_share_session(uuid) from public, anon;
revoke execute on function public.can_receive_live_share_topic(text) from public, anon;
revoke execute on function public.can_send_live_share_topic(text) from public, anon;
grant execute on function public.can_read_live_share_session(uuid) to authenticated;
grant execute on function public.can_manage_live_share_session(uuid) to authenticated;
grant execute on function public.can_receive_live_share_topic(text) to authenticated;
grant execute on function public.can_send_live_share_topic(text) to authenticated;

revoke execute on function public.start_live_share_session(text, uuid[], integer) from public, anon;
revoke execute on function public.heartbeat_live_share_session(uuid, integer) from public, anon;
revoke execute on function public.stop_live_share_session(uuid) from public, anon;
revoke execute on function public.add_live_share_recipient(uuid, uuid) from public, anon;
revoke execute on function public.revoke_live_share_recipient(uuid, uuid) from public, anon;
grant execute on function public.start_live_share_session(text, uuid[], integer) to authenticated;
grant execute on function public.heartbeat_live_share_session(uuid, integer) to authenticated;
grant execute on function public.stop_live_share_session(uuid) to authenticated;
grant execute on function public.add_live_share_recipient(uuid, uuid) to authenticated;
grant execute on function public.revoke_live_share_recipient(uuid, uuid) to authenticated;

comment on table public.live_share_sessions is 'Short-lived authorization sessions only; contains no live position history.';
comment on table public.live_share_recipients is 'Explicit recipients for a live flight session; contains no GPS data.';
