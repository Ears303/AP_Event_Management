-- Create events from the app, and enter holeshots. Safe to re-run. Run after 003_schedule.sql.

-- A holeshot can be entered with just the rider number; the name fills in when that race's results load.
alter table aptiming.holeshots alter column rider_name drop not null;

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

  -- Name comes from this race's results if they are loaded; otherwise from what was typed; otherwise it stays
  -- blank ("pending") and is filled in automatically when the results are published.
  select rider_id, rider_name into v_rider, v_name from aptiming.race_results
   where race_id = p_race and rider_number = p_rider_number limit 1;
  v_name := coalesce(v_name, nullif(trim(p_rider_name), ''));

  insert into aptiming.holeshots(event_id, class_id, race_id, rider_id, rider_number, rider_name, award, prize_amount)
  values (v_event, v_class, p_race, v_rider, p_rider_number, v_name, 'Holeshot', p_prize)
  on conflict (event_id, class_id, race_id) do update
    set rider_id = excluded.rider_id, rider_number = excluded.rider_number, rider_name = excluded.rider_name,
        prize_amount = excluded.prize_amount, entered_by = auth.uid(), entered_at = now()
  returning id into v_id;
  return v_id;
end $$;

-- When results for a race are loaded or published, fill in the holeshot rider's name (and link) from them.
create or replace function aptiming.holeshot_fill_from_results() returns trigger
language plpgsql security definer set search_path = aptiming, public as $$
begin
  update aptiming.holeshots h
     set rider_name = new.rider_name, rider_id = coalesce(new.rider_id, h.rider_id)
   where h.race_id = new.race_id and h.rider_number = new.rider_number
     and h.rider_name is distinct from new.rider_name;
  return null;
end $$;
drop trigger if exists holeshot_fill_from_results on aptiming.race_results;
create trigger holeshot_fill_from_results after insert or update of rider_name, rider_number, published
  on aptiming.race_results for each row when (new.published) execute function aptiming.holeshot_fill_from_results();

revoke all on function aptiming.create_event(text, text, date, date, boolean) from public, anon;
revoke all on function aptiming.save_holeshot(uuid, int, text, numeric) from public, anon;
grant execute on function aptiming.create_event(text, text, date, date, boolean) to authenticated;
grant execute on function aptiming.save_holeshot(uuid, int, text, numeric) to authenticated;
notify pgrst, 'reload schema';
