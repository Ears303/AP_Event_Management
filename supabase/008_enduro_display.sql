-- 008: Enduro / Pony Express display (live results only, with time remaining). Safe to re-run. Run after 007.
-- * events.display_mode: 'motocross' (class tiles, default) or 'enduro' (one live results list + time remaining).
-- * live_status: one row per event with the feed's clock (time to go, flag) so the display can show time remaining.

alter table aptiming.events add column if not exists display_mode text not null default 'motocross';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'events_display_mode_check') then
    alter table aptiming.events add constraint events_display_mode_check check (display_mode in ('motocross','enduro'));
  end if;
end $$;

create table if not exists aptiming.live_status (
  event_id uuid primary key references aptiming.events(id) on delete cascade,
  race_number int,
  flag text,
  time_to_go text,       -- "01:23:45" countdown from the timing software (00:00:00 = not a timed countdown)
  race_time text,        -- elapsed race time
  laps_to_go int,        -- 9999 = not used
  updated_at timestamptz not null default now()
);
alter table aptiming.live_status enable row level security;
drop policy if exists public_read_live_status on aptiming.live_status;
create policy public_read_live_status on aptiming.live_status for select using (aptiming.is_event_public(event_id));
drop policy if exists staff_read_live_status on aptiming.live_status;
create policy staff_read_live_status on aptiming.live_status for select using (aptiming.can_manage_event(event_id));
grant select on aptiming.live_status to anon, authenticated;

create or replace function aptiming.live_status_update(
  p_event uuid, p_race_number int, p_flag text, p_time_to_go text, p_race_time text, p_laps_to_go int)
returns void language plpgsql security definer set search_path = aptiming, public as $$
begin
  if not aptiming.can_manage_event(p_event) then raise exception 'not allowed for this event' using errcode = '42501'; end if;
  insert into aptiming.live_status(event_id, race_number, flag, time_to_go, race_time, laps_to_go, updated_at)
  values (p_event, p_race_number, p_flag, p_time_to_go, p_race_time, p_laps_to_go, now())
  on conflict (event_id) do update set race_number = excluded.race_number, flag = excluded.flag,
    time_to_go = excluded.time_to_go, race_time = excluded.race_time, laps_to_go = excluded.laps_to_go, updated_at = now();
end $$;

create or replace function aptiming.set_display_mode(p_event uuid, p_mode text)
returns void language plpgsql security definer set search_path = aptiming, public as $$
begin
  if not aptiming.can_manage_event(p_event) then raise exception 'not allowed for this event' using errcode = '42501'; end if;
  if p_mode not in ('motocross','enduro') then raise exception 'unknown display type'; end if;
  update aptiming.events set display_mode = p_mode, updated_at = now() where id = p_event;
end $$;

revoke all on function aptiming.live_status_update(uuid, int, text, text, text, int) from public, anon;
revoke all on function aptiming.set_display_mode(uuid, text) from public, anon;
grant execute on function aptiming.live_status_update(uuid, int, text, text, text, int) to authenticated;
grant execute on function aptiming.set_display_mode(uuid, text) to authenticated;
notify pgrst, 'reload schema';
