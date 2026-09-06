-- A room code is an invitation: signed-in accounts with the code can play.
create policy "Blocktopia accounts receive room events"
on realtime.messages for select to authenticated
using ((select auth.uid()) is not null
  and (select realtime.topic()) like 'blocktopia:%'
  and extension in ('broadcast', 'presence'));

create policy "Blocktopia accounts send room events"
on realtime.messages for insert to authenticated
with check ((select auth.uid()) is not null
  and (select realtime.topic()) like 'blocktopia:%'
  and extension in ('broadcast', 'presence'));
