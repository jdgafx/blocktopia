SET check_function_bodies = false;
DROP POLICY "Players resolve room identities" ON public.blocktopia_room_actors;
CREATE FUNCTION public.blocktopia_room_identities(room text, peers uuid[])
 RETURNS TABLE(peer_id uuid, user_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select a.peer_id, a.user_id from public.blocktopia_room_actors a
  where auth.uid() is not null and cardinality(peers) <= 8
    and a.room_code = room and a.peer_id = any(peers)
    and exists (select 1 from public.blocktopia_room_actors mine
      where mine.room_code = room and mine.user_id = auth.uid());
$function$;
GRANT ALL ON FUNCTION public.blocktopia_room_identities(text, uuid[]) TO authenticated;
REVOKE MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.blocktopia_room_actors FROM anon;
REVOKE MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.blocktopia_room_actors FROM authenticated;
CREATE POLICY "Players resolve room identities" ON public.blocktopia_room_actors FOR SELECT TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id));
