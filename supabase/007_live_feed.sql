-- 007: live results from the MyLaps scoreboard feed. Safe to re-run. Run after 002.
-- The bridge program (bridge/live-bridge.js) signs in as a timing user and calls live_update_race
-- every few seconds with the current standings. Rows are stored as provisional and visible straight away.
-- A final MyLaps CSV import for the same race replaces them (publish_import already deletes provisional rows),
-- and live updates never overwrite a race that already has final results.

-- A race is 'live' while the feed is timing it; once the feed moves on it stays provisional until the final CSV is imported.
alter table aptiming.races add column if not exists is_live boolean not null default false;

create or replace function aptiming.live_update_race(p_event uuid, p_race_number int, p_rows jsonb)
returns int language plpgsql security definer set search_path = aptiming, public as $$
declare
  v_base text; v_class uuid; v_race uuid; v_n int := 0;
begin
  if not aptiming.can_manage_event(p_event) then
    raise exception 'not allowed for this event' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'rows must be a list'; end if;

  -- the feed has moved on to this race: earlier races are no longer live (their results stay provisional)
  update aptiming.races set is_live = false where event_id = p_event and is_live and race_number is distinct from p_race_number;

  for v_base in select distinct r->>'baseClass' from jsonb_array_elements(p_rows) r loop
    select id into v_class from aptiming.classes where class_name = v_base limit 1;
    if v_class is null then insert into aptiming.classes(class_name) values (v_base) returning id into v_class; end if;

    select id into v_race from aptiming.races where event_id = p_event and race_number = p_race_number and class_id = v_class;
    if v_race is null then
      insert into aptiming.races(event_id, class_id, race_number, race_name)
      values (p_event, v_class, p_race_number, 'Race ' || p_race_number) returning id into v_race;
    end if;

    -- final (imported) results win: leave them alone
    if exists (select 1 from aptiming.race_results where race_id = v_race and not provisional) then continue; end if;

    update aptiming.races set is_live = true where id = v_race;
    delete from aptiming.race_results where race_id = v_race and provisional;
    insert into aptiming.race_results(
      race_id, rider_id, position, pic, rider_number, rider_name, grade, status, laps,
      total_time, total_time_ms, best_lap, best_lap_ms, best_lap_on, diff_text, gap_text,
      best_speed, points, published, provisional)
    select v_race,
      (select ri.id from aptiming.riders ri
        where ri.rider_number = (x->>'raceNo')::int
          and upper(trim(coalesce(ri.first_name,'') || ' ' || coalesce(ri.last_name,''))) = upper(trim(x->>'name'))
        limit 1),
      nullif(x->>'pos','')::int, nullif(x->>'pic','')::int, (x->>'raceNo')::int, x->>'name',
      nullif(x->>'grade',''), 'finished', nullif(x->>'laps','')::int,
      nullif(x->>'totalTimeText',''), nullif(x->>'totalTimeMs','')::int,
      nullif(x->>'bestLapText',''), nullif(x->>'bestLapMs','')::int, nullif(x->>'bestLapOn','')::int,
      nullif(x->>'diffText',''), nullif(x->>'gapText',''),
      nullif(x->>'bestSpeed','')::numeric, 0, true, true
    from jsonb_array_elements(p_rows) x where x->>'baseClass' = v_base;
    v_n := v_n + 1;
  end loop;
  return v_n;   -- number of classes updated
end $$;

revoke all on function aptiming.live_update_race(uuid, int, jsonb) from public, anon;
grant execute on function aptiming.live_update_race(uuid, int, jsonb) to authenticated;
notify pgrst, 'reload schema';
