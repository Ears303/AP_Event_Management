-- Create events from the app, and enter holeshots. Safe to re-run. Run after 003_schedule.sql.

-- New event in the caller's own organisation (taken from their profile; admin/timing only).
create or replace function aptiming.create_event(
  p_name text, p_venue text, p_start date, p_end date, p_public boolean default true)
returns uuid
language plpgsql security definer set search_path = aptiming, public as $$
declare v_org uuid; v_id uuid;
begin
  select organisation_id into v_org from aptiming.profiles
   where id = auth.uid() and role in ('admin','timing');
  if v_org is null then raise exception 'not allowed'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'event name is required'; end if;
  insert into aptiming.events(organisation_id, event_name, venue, start_date, end_date, status, is_public)
  values (v_org, trim(p_name), nullif(trim(p_venue), ''), p_start, coalesce(p_end, p_start), 'live', coalesce(p_public, true))
  returning id into v_id;
  return v_id;
end $$;

-- Record the holeshot for one race (one per race; saving again replaces it).
-- Only races marked as having a holeshot in the schedule are accepted.
-- The rider name is filled from the race results (or the rider list) when left blank.
create or replace function aptiming.save_holeshot(
  p_race uuid, p_rider_number int, p_rider_name text default null, p_prize numeric default null)
returns uuid
language plpgsql security definer set search_path = aptiming, public as $$
declare v_event uuid; v_class uuid; v_has boolean; v_name text; v_rider uuid; v_id uuid;
begin
  select event_id, class_id, holeshot into v_event, v_class, v_has from aptiming.races where id = p_race;
  if v_event is null then raise exception 'race not found'; end if;
  if not aptiming.can_manage_event(v_event) then raise exception 'not allowed'; end if;
  if not v_has then raise exception 'this race is not marked as having a holeshot in the schedule'; end if;

  select rider_id, rider_name into v_rider, v_name from aptiming.race_results
   where race_id = p_race and rider_number = p_rider_number limit 1;
  if v_rider is null then
    select id into v_rider from aptiming.riders where rider_number = p_rider_number limit 1;
  end if;
  v_name := coalesce(nullif(trim(p_rider_name), ''), v_name,
    (select trim(coalesce(first_name,'') || ' ' || coalesce(last_name,'')) from aptiming.riders where id = v_rider));
  if coalesce(v_name, '') = '' then raise exception 'rider % not found - type the rider name', p_rider_number; end if;

  insert into aptiming.holeshots(event_id, class_id, race_id, rider_id, rider_number, rider_name, award, prize_amount)
  values (v_event, v_class, p_race, v_rider, p_rider_number, v_name, 'Holeshot', p_prize)
  on conflict (event_id, class_id, race_id) do update
    set rider_id = excluded.rider_id, rider_number = excluded.rider_number, rider_name = excluded.rider_name,
        prize_amount = excluded.prize_amount, entered_by = auth.uid(), entered_at = now()
  returning id into v_id;
  return v_id;
end $$;

revoke all on function aptiming.create_event(text, text, date, date, boolean) from public, anon;
revoke all on function aptiming.save_holeshot(uuid, int, text, numeric) from public, anon;
grant execute on function aptiming.create_event(text, text, date, date, boolean) to authenticated;
grant execute on function aptiming.save_holeshot(uuid, int, text, numeric) to authenticated;
notify pgrst, 'reload schema';
