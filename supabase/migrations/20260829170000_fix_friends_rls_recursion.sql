-- Break the friend_profiles <-> friend_requests RLS dependency cycle.
-- Existing rows and friendship workflow functions are intentionally unchanged.

create or replace function public.can_read_friend_profile(
  p_profile_user_id uuid,
  p_search_enabled boolean
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    auth.uid() is not null
    and (
      p_profile_user_id = auth.uid()
      or p_search_enabled
      or exists (
        select 1
        from public.friend_requests request
        where (request.sender_id = auth.uid() and request.recipient_id = p_profile_user_id)
           or (request.recipient_id = auth.uid() and request.sender_id = p_profile_user_id)
      )
      or exists (
        select 1
        from public.friendships friendship
        where friendship.revoked_at is null
          and friendship.user_a = least(auth.uid(), p_profile_user_id)
          and friendship.user_b = greatest(auth.uid(), p_profile_user_id)
      )
    );
$$;

create or replace function public.can_create_friend_request(
  p_sender_id uuid,
  p_recipient_id uuid,
  p_status text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    auth.uid() is not null
    and p_sender_id = auth.uid()
    and p_sender_id <> p_recipient_id
    and p_status = 'pending'
    and exists (
      select 1
      from public.friend_profiles sender_profile
      where sender_profile.user_id = p_sender_id
    )
    and exists (
      select 1
      from public.friend_profiles recipient_profile
      where recipient_profile.user_id = p_recipient_id
        and recipient_profile.search_enabled
    )
    and not exists (
      select 1
      from public.friendships friendship
      where friendship.revoked_at is null
        and friendship.user_a = least(p_sender_id, p_recipient_id)
        and friendship.user_b = greatest(p_sender_id, p_recipient_id)
    );
$$;

revoke execute on function public.can_read_friend_profile(uuid, boolean) from public, anon;
revoke execute on function public.can_create_friend_request(uuid, uuid, text) from public, anon;
grant execute on function public.can_read_friend_profile(uuid, boolean) to authenticated;
grant execute on function public.can_create_friend_request(uuid, uuid, text) to authenticated;

drop policy if exists friend_profiles_select_authorized on public.friend_profiles;
create policy friend_profiles_select_authorized on public.friend_profiles
for select to authenticated using (
  public.can_read_friend_profile(user_id, search_enabled)
);

drop policy if exists friend_requests_insert_sender on public.friend_requests;
create policy friend_requests_insert_sender on public.friend_requests
for insert to authenticated with check (
  public.can_create_friend_request(sender_id, recipient_id, status)
);

comment on function public.can_read_friend_profile(uuid, boolean) is
  'RLS-safe friend profile visibility check. Returns one authorization boolean and does not expose friend rows.';
comment on function public.can_create_friend_request(uuid, uuid, text) is
  'RLS-safe friend request creation check bound to auth.uid(). Returns one authorization boolean.';
