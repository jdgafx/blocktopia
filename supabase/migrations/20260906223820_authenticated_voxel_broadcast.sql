-- This topic is receive-only for clients. The RPC stamps an RLS-bound sender,
-- so another invited player cannot impersonate the host in a Broadcast payload.
create policy "Registered players receive voxel broadcasts" on realtime.messages
for select to authenticated using (
  extension = 'broadcast' and exists (select 1 from public.blocktopia_room_actors a
    where a.user_id = (select auth.uid()) and (select realtime.topic()) = 'blocktopia-voxel:' || a.room_code)
);

create function public.broadcast_voxel_event(room text, peer uuid, message jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not exists (select 1 from public.blocktopia_room_actors a
    where a.room_code=room and a.peer_id=peer and a.user_id=auth.uid()) then
    raise exception 'Room identity is not registered' using errcode='42501';
  end if;
  if octet_length(message::text) > 48000 or coalesce(message->>'t','') not in ('intent','commit')
    or coalesce(message->'intent'->>'kind',message->'commit'->>'kind','') <> 'block' then
    raise exception 'Invalid voxel event';
  end if;
  perform realtime.send(jsonb_build_object('from',peer,'message',message), 'voxel', 'blocktopia-voxel:' || room, true);
end;
$$;
revoke all on function public.broadcast_voxel_event(text,uuid,jsonb) from public,anon;
grant execute on function public.broadcast_voxel_event(text,uuid,jsonb) to authenticated;
