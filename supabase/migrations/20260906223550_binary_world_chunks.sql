-- Only changed voxels are stored; untouched terrain is regenerated from the saved seed/generation.
create table public.world_chunks (
  id uuid primary key default gen_random_uuid(),
  world_id uuid not null references public.saved_expeditions(id) on delete cascade,
  chunk_x integer not null check (chunk_x between -62500 and 62500),
  chunk_y integer not null check (chunk_y between 0 and 3),
  chunk_z integer not null check (chunk_z between -62500 and 62500),
  voxel_data bytea not null check (octet_length(voxel_data) between 15 and 2097152
    and substring(voxel_data from 1 for 4) = decode('42545601', 'hex')),
  updated_at timestamptz not null default now(),
  unique(world_id, chunk_x, chunk_y, chunk_z)
);
alter table public.world_chunks enable row level security;
revoke all on public.world_chunks from anon, authenticated;
grant select, insert, update, delete on public.world_chunks to authenticated;
create policy "Owners manage expedition chunks" on public.world_chunks for all to authenticated
  using (exists (select 1 from public.saved_expeditions s where s.id = world_id and s.user_id = (select auth.uid())))
  with check (exists (select 1 from public.saved_expeditions s where s.id = world_id and s.user_id = (select auth.uid())));

create function public.save_binary_expedition(expedition_id uuid, expected_revision bigint,
  expedition_name text, world_seed bigint, world_mode text, world_snapshot jsonb, chunks jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare saved public.saved_expeditions; total_bytes bigint;
begin
  if auth.uid() is null then raise exception 'Sign in to save an expedition'; end if;
  if jsonb_typeof(chunks) is distinct from 'array' or jsonb_array_length(chunks) > 20000
    or world_snapshot->>'chunkFormat' is distinct from 'BTV1'
    or world_snapshot->'entries' is distinct from '[]'::jsonb
    or (world_snapshot->>'chunkCount')::integer is distinct from jsonb_array_length(chunks)
    or coalesce((world_snapshot->>'entryCount')::integer, -1) not between 0 and 20000 then
    raise exception 'Invalid binary expedition';
  end if;
  select coalesce(sum(octet_length((c->>'voxel_data')::bytea)),0) into total_bytes from jsonb_array_elements(chunks) c;
  if total_bytes + octet_length(world_snapshot::text) > 4194304 then raise exception 'Expedition exceeds binary save limit'; end if;
  if expedition_id is null then
    insert into public.saved_expeditions(user_id,name,seed,mode,snapshot)
      values(auth.uid(),expedition_name,world_seed,world_mode,world_snapshot) returning * into saved;
  else
    -- The row lock and revision predicate serialize competing tabs; chunk replacement is in this same transaction.
    update public.saved_expeditions set name=coalesce(expedition_name,name),seed=world_seed,mode=world_mode,snapshot=world_snapshot
      where id=expedition_id and user_id=auth.uid() and revision=expected_revision returning * into saved;
    if not found then return null; end if;
  end if;
  delete from public.world_chunks where world_id=saved.id;
  insert into public.world_chunks(world_id,chunk_x,chunk_y,chunk_z,voxel_data)
    select saved.id,(c->>'chunk_x')::integer,(c->>'chunk_y')::integer,(c->>'chunk_z')::integer,(c->>'voxel_data')::bytea
      from jsonb_array_elements(chunks) c;
  return to_jsonb(saved) - 'snapshot';
end;
$$;
revoke all on function public.save_binary_expedition(uuid,bigint,text,bigint,text,jsonb,jsonb) from public,anon;
grant execute on function public.save_binary_expedition(uuid,bigint,text,bigint,text,jsonb,jsonb) to authenticated;

create function public.load_binary_expedition(expedition_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select to_jsonb(s) || jsonb_build_object('chunks', coalesce((select jsonb_agg(jsonb_build_object(
    'chunk_x',c.chunk_x,'chunk_y',c.chunk_y,'chunk_z',c.chunk_z,'voxel_data',c.voxel_data))
    from public.world_chunks c where c.world_id=s.id), '[]'::jsonb))
  from public.saved_expeditions s where s.id=expedition_id and s.user_id=auth.uid();
$$;
revoke all on function public.load_binary_expedition(uuid) from public,anon;
grant execute on function public.load_binary_expedition(uuid) to authenticated;
