-- Live runtime discovery and atomic recipient rotation. No GPS position is stored.

create or replace function public.discover_live_share_sessions()
returns table (
  session_id uuid,
  owner_id uuid,
  display_name text,
  handle text,
  expires_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct on (session.owner_id) session.id, session.owner_id, profile.display_name, profile.handle, session.expires_at
  from public.live_share_recipients recipient
  join public.live_share_sessions session on session.id = recipient.session_id
  join public.friend_profiles profile on profile.user_id = session.owner_id
  where recipient.recipient_id = auth.uid()
    and recipient.revoked_at is null
    and session.status = 'active'
    and session.expires_at > statement_timestamp()
    and exists (
      select 1 from public.friendships friendship
      where friendship.revoked_at is null
        and friendship.user_a = least(auth.uid(), session.owner_id)
        and friendship.user_b = greatest(auth.uid(), session.owner_id)
    )
  order by session.owner_id, session.last_heartbeat_at desc, session.id desc;
$$;

create or replace function public.rotate_live_share_after_recipient_revocation(
  p_session_id uuid,
  p_recipient_id uuid,
  p_ttl_seconds integer default 90
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  current_session public.live_share_sessions%rowtype;
  next_session_id uuid;
  remaining_ids uuid[];
begin
  if actor_id is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if p_ttl_seconds < 60 or p_ttl_seconds > 180 then raise exception 'INVALID_LIVE_TTL' using errcode = '22023'; end if;

  select * into current_session from public.live_share_sessions
  where id = p_session_id and owner_id = actor_id and status = 'active' and expires_at > statement_timestamp()
  for update;
  if not found then raise exception 'LIVE_SESSION_NOT_ACTIVE' using errcode = '42501'; end if;

  if not exists (
    select 1 from public.live_share_recipients
    where session_id = p_session_id and recipient_id = p_recipient_id and revoked_at is null
  ) then raise exception 'LIVE_RECIPIENT_NOT_REVOCABLE' using errcode = '42501'; end if;

  select coalesce(array_agg(recipient.recipient_id order by recipient.recipient_id), '{}'::uuid[])
  into remaining_ids
  from public.live_share_recipients recipient
  where recipient.session_id = p_session_id
    and recipient.revoked_at is null
    and recipient.recipient_id <> p_recipient_id
    and exists (
      select 1 from public.friendships friendship
      where friendship.revoked_at is null
        and friendship.user_a = least(actor_id, recipient.recipient_id)
        and friendship.user_b = greatest(actor_id, recipient.recipient_id)
    );

  -- Stop the old topic first. A recipient already authorized on that topic can no
  -- longer receive anything because the publisher rotates to a brand-new topic.
  update public.live_share_sessions set status = 'stopped', ended_at = statement_timestamp(),
    expires_at = statement_timestamp(), updated_at = statement_timestamp()
  where id = p_session_id;
  update public.live_share_recipients set revoked_at = coalesce(revoked_at, statement_timestamp())
  where session_id = p_session_id;

  if cardinality(remaining_ids) > 0 then
    insert into public.live_share_sessions (owner_id, flight_id, expires_at)
    values (actor_id, current_session.flight_id, statement_timestamp() + make_interval(secs => p_ttl_seconds))
    returning id into next_session_id;

    insert into public.live_share_recipients (session_id, recipient_id)
    select next_session_id, recipient_id from unnest(remaining_ids) recipient_id;
  end if;

  return next_session_id;
end;
$$;

revoke execute on function public.discover_live_share_sessions() from public, anon;
revoke execute on function public.rotate_live_share_after_recipient_revocation(uuid, uuid, integer) from public, anon;
grant execute on function public.discover_live_share_sessions() to authenticated;
grant execute on function public.rotate_live_share_after_recipient_revocation(uuid, uuid, integer) to authenticated;

comment on function public.discover_live_share_sessions() is 'Returns only active friend-owned sessions explicitly shared with auth.uid().';
comment on function public.rotate_live_share_after_recipient_revocation(uuid, uuid, integer) is 'Revokes one recipient immediately by rotating remaining recipients to a new private topic.';
