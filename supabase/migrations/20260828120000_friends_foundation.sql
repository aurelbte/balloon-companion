-- Balloon Companion friends foundation. Live flight sharing is intentionally excluded.

create table public.friend_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(trim(display_name)) between 1 and 80),
  handle text not null check (
    handle = lower(handle)
    and handle ~ '^[a-z0-9](?:[a-z0-9._]{1,28}[a-z0-9])$'
  ),
  search_enabled boolean not null default true,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp()
);

create unique index friend_profiles_handle_ci_idx on public.friend_profiles (lower(handle));

create table public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  check (sender_id <> recipient_id)
);

create unique index friend_requests_pending_pair_idx
  on public.friend_requests (least(sender_id, recipient_id), greatest(sender_id, recipient_id))
  where status = 'pending';
create index friend_requests_recipient_idx on public.friend_requests (recipient_id, status, created_at desc);
create index friend_requests_sender_idx on public.friend_requests (sender_id, status, created_at desc);

create table public.friendships (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references auth.users(id) on delete cascade,
  user_b uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default statement_timestamp(),
  revoked_at timestamptz,
  check (user_a < user_b),
  unique (user_a, user_b)
);

create index friendships_user_a_idx on public.friendships (user_a) where revoked_at is null;
create index friendships_user_b_idx on public.friendships (user_b) where revoked_at is null;

create or replace function public.balloon_companion_touch_friend_row()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.created_at := old.created_at;
  new.updated_at := statement_timestamp();
  return new;
end;
$$;

create trigger friend_profiles_touch before update on public.friend_profiles
for each row execute function public.balloon_companion_touch_friend_row();
create trigger friend_requests_touch before update on public.friend_requests
for each row execute function public.balloon_companion_touch_friend_row();

alter table public.friend_profiles enable row level security;
alter table public.friend_profiles force row level security;
alter table public.friend_requests enable row level security;
alter table public.friend_requests force row level security;
alter table public.friendships enable row level security;
alter table public.friendships force row level security;

revoke all on public.friend_profiles, public.friend_requests, public.friendships from anon;
grant select, insert, update on public.friend_profiles to authenticated;
grant select, insert on public.friend_requests to authenticated;
grant select, delete on public.friendships to authenticated;

create policy friend_profiles_select_authorized on public.friend_profiles
for select to authenticated using (
  user_id = (select auth.uid())
  or search_enabled
  or exists (
    select 1 from public.friend_requests request
    where (request.sender_id = (select auth.uid()) and request.recipient_id = friend_profiles.user_id)
       or (request.recipient_id = (select auth.uid()) and request.sender_id = friend_profiles.user_id)
  )
  or exists (
    select 1 from public.friendships friendship
    where friendship.revoked_at is null
      and ((friendship.user_a = (select auth.uid()) and friendship.user_b = friend_profiles.user_id)
        or (friendship.user_b = (select auth.uid()) and friendship.user_a = friend_profiles.user_id))
  )
);
create policy friend_profiles_insert_own on public.friend_profiles
for insert to authenticated with check (user_id = (select auth.uid()));
create policy friend_profiles_update_own on public.friend_profiles
for update to authenticated using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy friend_requests_select_participant on public.friend_requests
for select to authenticated using ((select auth.uid()) in (sender_id, recipient_id));
create policy friend_requests_insert_sender on public.friend_requests
for insert to authenticated with check (
  sender_id = (select auth.uid())
  and sender_id <> recipient_id
  and status = 'pending'
  and exists (
    select 1 from public.friend_profiles sender_profile
    where sender_profile.user_id = sender_id
  )
  and exists (
    select 1 from public.friend_profiles profile
    where profile.user_id = recipient_id and profile.search_enabled
  )
  and not exists (
    select 1 from public.friendships friendship
    where friendship.revoked_at is null
      and friendship.user_a = least(sender_id, recipient_id)
      and friendship.user_b = greatest(sender_id, recipient_id)
  )
);

create policy friendships_select_member on public.friendships
for select to authenticated using ((select auth.uid()) in (user_a, user_b));
create policy friendships_delete_member on public.friendships
for delete to authenticated using ((select auth.uid()) in (user_a, user_b));

create or replace function public.accept_friend_request(p_request_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  request public.friend_requests%rowtype;
  friendship_id uuid;
begin
  if actor_id is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  select * into request from public.friend_requests where id = p_request_id for update;
  if not found or request.recipient_id <> actor_id or request.status <> 'pending' then
    raise exception 'FRIEND_REQUEST_NOT_ACCEPTABLE' using errcode = '42501';
  end if;
  insert into public.friendships (user_a, user_b, revoked_at)
  values (least(request.sender_id, request.recipient_id), greatest(request.sender_id, request.recipient_id), null)
  on conflict (user_a, user_b) do update set revoked_at = null, created_at = statement_timestamp()
  returning id into friendship_id;
  update public.friend_requests set status = 'accepted' where id = request.id;
  return friendship_id;
end;
$$;

create or replace function public.decline_friend_request(p_request_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid();
begin
  if actor_id is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  update public.friend_requests set status = 'declined'
  where id = p_request_id and recipient_id = actor_id and status = 'pending';
  if not found then raise exception 'FRIEND_REQUEST_NOT_DECLINABLE' using errcode = '42501'; end if;
end;
$$;

create or replace function public.cancel_friend_request(p_request_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid();
begin
  if actor_id is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  update public.friend_requests set status = 'cancelled'
  where id = p_request_id and sender_id = actor_id and status = 'pending';
  if not found then raise exception 'FRIEND_REQUEST_NOT_CANCELLABLE' using errcode = '42501'; end if;
end;
$$;

create or replace function public.revoke_friendship(p_friendship_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid();
begin
  if actor_id is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  update public.friendships set revoked_at = statement_timestamp()
  where id = p_friendship_id and revoked_at is null and actor_id in (user_a, user_b);
  if not found then raise exception 'FRIENDSHIP_NOT_REVOCABLE' using errcode = '42501'; end if;
end;
$$;

revoke execute on function public.balloon_companion_touch_friend_row() from public, anon, authenticated;
revoke execute on function public.accept_friend_request(uuid) from public, anon;
revoke execute on function public.decline_friend_request(uuid) from public, anon;
revoke execute on function public.cancel_friend_request(uuid) from public, anon;
revoke execute on function public.revoke_friendship(uuid) from public, anon;
grant execute on function public.accept_friend_request(uuid) to authenticated;
grant execute on function public.decline_friend_request(uuid) to authenticated;
grant execute on function public.cancel_friend_request(uuid) to authenticated;
grant execute on function public.revoke_friendship(uuid) to authenticated;

comment on table public.friend_profiles is 'Opt-in public identity for friend discovery. Email is intentionally absent.';
comment on table public.friend_requests is 'Private friend requests visible only to their participants.';
comment on table public.friendships is 'Canonical private friendship pairs. No live flight data.';
