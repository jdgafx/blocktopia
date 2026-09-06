create table public.saved_expeditions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 48),
  seed bigint not null check (seed between 0 and 4294967295),
  mode text not null check (mode in ('creative', 'expedition')),
  snapshot jsonb not null check (
    octet_length(snapshot::text) <= 2097152
    and coalesce(jsonb_typeof(snapshot) = 'object'
      and jsonb_typeof(snapshot->'epoch') = 'number'
      and (snapshot->>'epoch') ~ '^[0-9]+$'
      and jsonb_typeof(snapshot->'lastSeq') = 'number'
      and (snapshot->>'lastSeq') ~ '^[0-9]+$'
      and jsonb_typeof(snapshot->'entries') = 'array'
      and jsonb_typeof(snapshot->'intentIds') = 'array'
      and jsonb_typeof(snapshot->'supplies') = 'object', false)
  ),
  revision bigint not null default 1 check (revision between 1 and 9007199254740991),
  updated_at timestamptz not null default now()
);

create index saved_expeditions_owner_updated on public.saved_expeditions(user_id, updated_at desc);
alter table public.saved_expeditions enable row level security;
revoke all on public.saved_expeditions from anon, authenticated;
grant select, delete on public.saved_expeditions to authenticated;
grant insert (user_id, name, seed, mode, snapshot) on public.saved_expeditions to authenticated;
grant update (name, seed, mode, snapshot) on public.saved_expeditions to authenticated;

create policy "Owners read expeditions" on public.saved_expeditions
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Owners create expeditions" on public.saved_expeditions
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Owners update expeditions" on public.saved_expeditions
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "Owners delete expeditions" on public.saved_expeditions
  for delete to authenticated using ((select auth.uid()) = user_id);

create function public.advance_expedition_revision() returns trigger
  language plpgsql security invoker set search_path = '' as $$
begin
  new.revision := old.revision + 1;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
revoke all on function public.advance_expedition_revision() from public, anon, authenticated;
create trigger advance_expedition_revision before update on public.saved_expeditions
  for each row execute function public.advance_expedition_revision();
