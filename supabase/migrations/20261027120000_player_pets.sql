-- One egg or pet per signed-in player, saved with the account (not with a room).
create table public.player_pets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  pet jsonb not null check (jsonb_typeof(pet) = 'object' and octet_length(pet::text) <= 512),
  updated_at timestamptz not null default now()
);

alter table public.player_pets enable row level security;
revoke all on public.player_pets from anon, authenticated;
grant select, insert, update on public.player_pets to authenticated;

create policy "Owners read their pet" on public.player_pets
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Owners create their pet" on public.player_pets
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Owners update their pet" on public.player_pets
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
