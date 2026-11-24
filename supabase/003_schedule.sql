-- Race schedule: moto (optional, motocross only) and a per-race holeshot flag.
-- Safe to re-run. Run after 002_results_import.sql, then: notify pgrst, 'reload schema';

alter table aptiming.races
  add column if not exists moto int,
  add column if not exists holeshot boolean not null default false;

-- Replace the schedule for an event from an uploaded sheet.
-- Existing races (matched by race number + class) are updated, never deleted, so results stay attached.
create or replace function aptiming.stage_schedule(p_event uuid, p_rows jsonb)
returns int
language plpgsql security definer set search_path = aptiming, public as $$
declare x jsonb; v_class uuid; v_n int := 0;
begin
  if not aptiming.can_manage_event(p_event) then raise exception 'not allowed'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then raise exception 'no rows to import'; end if;
  for x in select * from jsonb_array_elements(p_rows) loop
    select id into v_class from aptiming.classes where lower(class_name) = lower(x->>'className') limit 1;
    if v_class is null then
      insert into aptiming.classes(class_name) values (x->>'className') returning id into v_class;
    end if;
    insert into aptiming.races(event_id, class_id, race_number, race_name, moto, holeshot, scheduled_time)
    values (p_event, v_class, (x->>'raceNo')::int, 'Race ' || (x->>'raceNo'),
            nullif(x->>'moto','')::int, coalesce((x->>'holeshot')::boolean, false),
            case when nullif(x->>'startsAt','') is null then null
                 else (x->>'startsAt')::timestamp at time zone 'Australia/Perth' end)
    on conflict (event_id, race_number, class_id) do update
      set moto = excluded.moto, holeshot = excluded.holeshot, scheduled_time = excluded.scheduled_time,
          updated_at = now();
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

revoke all on function aptiming.stage_schedule(uuid, jsonb) from public, anon;
grant execute on function aptiming.stage_schedule(uuid, jsonb) to authenticated;
notify pgrst, 'reload schema';
