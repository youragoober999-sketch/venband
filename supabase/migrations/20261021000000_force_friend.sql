-- Force friend: platform admins, owners and founders can make a friendship
-- accepted even against a pending or ignored request. Mirrors force_unblock:
-- the staff member overrules, so nobody can wall staff off by ignoring them.

create or replace function public.force_accept_friend_request(p_other uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not public.can_force_contact() then raise exception 'admins, owners and founders only'; end if;
  if p_other = v_uid then raise exception 'cannot befriend yourself'; end if;
  if not exists (select 1 from public.profiles where id = p_other) then
    raise exception 'user not found';
  end if;
  insert into public.friendships (user_a, user_b, requester, accepted)
  values (least(v_uid, p_other), greatest(v_uid, p_other), v_uid, true)
  on conflict (user_a, user_b) do update set accepted = true;
  insert into public.mod_actions (actor_id, target_user, action, detail)
  values (v_uid, p_other, 'force_friend', 'forced an accepted friendship (staff overrule)');
end;
$$;

revoke execute on function public.force_accept_friend_request(uuid) from public, anon;
grant execute on function public.force_accept_friend_request(uuid) to authenticated;
