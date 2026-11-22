-- 002: results import (MyLaps CSV), holeshots, officials PIN, and row level security.
-- Built against the LIVE aptiming schema (organisations, series, events, classes, races,
-- race_results, riders, profiles, announcements ...). It only ADDS to existing tables.
-- Safe to re-run. Run in the Supabase SQL editor.
--
-- Assumptions (change them in the marked places if wrong):
--  * Staff are rows in aptiming.profiles with role 'admin' or 'timing', and they can only
--    manage events belonging to their own organisation (profiles.organisation_id).
--  * Public visitors see an event when events.is_public is true and status <> 'draft'.
--  * A result is visible to the public when race_results.published = true.

create extension if not exists pgcrypto;

-- ---------- Extend existing tables ----------
alter table aptiming.events
  add column if not exists round_number int,
  add column if not exists holeshot_mode text not null default 'none';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'events_holeshot_mode_check') then
    alter table aptiming.events add constraint events_holeshot_mode_check
      check (holeshot_mode in ('none','every_race','per_round_class'));
  end if;
end $$;

alter table aptiming.announcements
  add column if not exists created_by uuid;

create unique index if not exists races_event_number_class
  on aptiming.races (event_id, race_number, class_id);

-- ---------- Imports: audit trail for every uploaded CSV ----------
create table if not exists aptiming.imports (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references aptiming.events(id) on delete cascade,
  kind text not null check (kind in ('points','race')),
  filename text,
  row_count int,
  warnings jsonb not null default '[]',
  imported_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  published_at timestamptz          -- null = still a preview
);

-- ---------- Per-race results: add the columns the MyLaps export has ----------
-- Existing: race_id, rider_id, position, rider_number, rider_name, laps, best_lap (text),
--           total_time (text), points, published, created_at.
-- position = Pos (overall in class). pic = position within the rider's grade.
alter table aptiming.race_results
  add column if not exists import_id uuid references aptiming.imports(id) on delete cascade,
  add column if not exists grade text,                          -- A / B / C, null if ungraded
  add column if not exists status text not null default 'finished',
  add column if not exists pic int,
  add column if not exists total_time_ms int,
  add column if not exists best_lap_ms int,
  add column if not exists best_lap_on int,                     -- "In Lap"
  add column if not exists diff_text text,                      -- "9.762", "1 Lap"
  add column if not exists gap_text text,
  add column if not exists avg_speed numeric(7,3),
  add column if not exists best_speed numeric(7,3),
  add column if not exists provisional boolean not null default false,  -- live feed rows
  add column if not exists updated_at timestamptz default now();

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'race_results_status_check') then
    alter table aptiming.race_results add constraint race_results_status_check
      check (status in ('finished','dnf'));
  end if;
end $$;

create index if not exists race_results_race_idx   on aptiming.race_results (race_id);
create index if not exists race_results_import_idx on aptiming.race_results (import_id);

-- ---------- Points results (the "Graded Results" export) ----------
create table if not exists aptiming.points_results (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references aptiming.imports(id) on delete cascade,
  event_id uuid not null references aptiming.events(id) on delete cascade,
  class_id uuid not null references aptiming.classes(id),
  grade text,
  rider_id uuid references aptiming.riders(id),
  rider_number int not null,
  rider_name text not null,
  pos int not null,
  total_points numeric not null,
  race_points numeric[] not null,       -- R1..Rn in order
  tie_note text,                        -- set when a tie could not be broken
  published boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists points_results_event_idx on aptiming.points_results (event_id, class_id);

-- ---------- Holeshots (prize only, never counted in championship points) ----------
create table if not exists aptiming.holeshots (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references aptiming.events(id) on delete cascade,
  class_id uuid not null references aptiming.classes(id),
  race_id uuid not null references aptiming.races(id) on delete cascade,
  rider_id uuid references aptiming.riders(id),
  rider_number int not null,
  rider_name text not null,
  award text,
  prize_amount numeric(10,2),
  entered_by uuid default auth.uid(),
  entered_at timestamptz not null default now()
);
-- One per race. "Once per round, per class" mode (events.holeshot_mode) is checked in the entry code.
create unique index if not exists holeshots_one_per_race
  on aptiming.holeshots (event_id, class_id, race_id);

-- ---------- Officials: shared PIN per event (hash only; checked server-side) ----------
create table if not exists aptiming.event_access (
  event_id uuid primary key references aptiming.events(id) on delete cascade,
  pin_hash text not null,               -- crypt(pin, gen_salt('bf'))
  expires_at timestamptz,
  enabled boolean not null default true,
  failed_attempts int not null default 0,
  locked_until timestamptz
);

-- ---------- Permission helpers (security definer, so rules can look at profiles safely) ----------
-- CHANGE HERE if your profiles.role values differ.
create or replace function aptiming.can_manage_org(p_org uuid) returns boolean
language sql stable security definer set search_path = aptiming, public as $$
  select exists (
    select 1 from aptiming.profiles p
    where p.id = auth.uid()
      and p.role in ('admin','timing')
      and p.organisation_id = p_org);
$$;

create or replace function aptiming.can_manage_event(p_event uuid) returns boolean
language sql stable security definer set search_path = aptiming, public as $$
  select exists (select 1 from aptiming.events e
                 where e.id = p_event and aptiming.can_manage_org(e.organisation_id));
$$;

create or replace function aptiming.can_manage_race(p_race uuid) returns boolean
language sql stable security definer set search_path = aptiming, public as $$
  select exists (select 1 from aptiming.races r
                 where r.id = p_race and aptiming.can_manage_event(r.event_id));
$$;

create or replace function aptiming.is_event_public(p_event uuid) returns boolean
language sql stable security definer set search_path = aptiming, public as $$
  select exists (select 1 from aptiming.events e
                 where e.id = p_event and e.is_public and e.status <> 'draft');
$$;

create or replace function aptiming.is_race_public(p_race uuid) returns boolean
language sql stable security definer set search_path = aptiming, public as $$
  select exists (select 1 from aptiming.races r
                 where r.id = p_race and aptiming.is_event_public(r.event_id));
$$;

-- ---------- Row level security ----------
alter table aptiming.events         enable row level security;
alter table aptiming.classes        enable row level security;
alter table aptiming.races          enable row level security;
alter table aptiming.race_results   enable row level security;
alter table aptiming.imports        enable row level security;
alter table aptiming.points_results enable row level security;
alter table aptiming.holeshots      enable row level security;
alter table aptiming.announcements  enable row level security;
alter table aptiming.event_access   enable row level security;   -- no policies: server-side only

-- Public (anon) read
drop policy if exists public_read_events on aptiming.events;
create policy public_read_events on aptiming.events for select
  using (is_public and status <> 'draft');
drop policy if exists public_read_classes on aptiming.classes;
create policy public_read_classes on aptiming.classes for select using (active);
drop policy if exists public_read_races on aptiming.races;
create policy public_read_races on aptiming.races for select
  using (aptiming.is_event_public(event_id));
drop policy if exists public_read_race_results on aptiming.race_results;
create policy public_read_race_results on aptiming.race_results for select
  using (published and aptiming.is_race_public(race_id));
drop policy if exists public_read_points on aptiming.points_results;
create policy public_read_points on aptiming.points_results for select
  using (published and aptiming.is_event_public(event_id));
drop policy if exists public_read_holeshots on aptiming.holeshots;
create policy public_read_holeshots on aptiming.holeshots for select
  using (aptiming.is_event_public(event_id));
drop policy if exists public_read_announcements on aptiming.announcements;
create policy public_read_announcements on aptiming.announcements for select
  using (active and event_id is not null and aptiming.is_event_public(event_id));

-- Staff (profiles.role admin/timing) manage their own organisation's events
drop policy if exists staff_all_events on aptiming.events;
create policy staff_all_events on aptiming.events for all
  using (aptiming.can_manage_org(organisation_id)) with check (aptiming.can_manage_org(organisation_id));
drop policy if exists staff_all_races on aptiming.races;
create policy staff_all_races on aptiming.races for all
  using (aptiming.can_manage_event(event_id)) with check (aptiming.can_manage_event(event_id));
drop policy if exists staff_all_race_results on aptiming.race_results;
create policy staff_all_race_results on aptiming.race_results for all
  using (aptiming.can_manage_race(race_id)) with check (aptiming.can_manage_race(race_id));
drop policy if exists staff_all_imports on aptiming.imports;
create policy staff_all_imports on aptiming.imports for all
  using (aptiming.can_manage_event(event_id)) with check (aptiming.can_manage_event(event_id));
drop policy if exists staff_all_points on aptiming.points_results;
create policy staff_all_points on aptiming.points_results for all
  using (aptiming.can_manage_event(event_id)) with check (aptiming.can_manage_event(event_id));
drop policy if exists staff_all_holeshots on aptiming.holeshots;
create policy staff_all_holeshots on aptiming.holeshots for all
  using (aptiming.can_manage_event(event_id)) with check (aptiming.can_manage_event(event_id));
drop policy if exists staff_all_announcements on aptiming.announcements;
create policy staff_all_announcements on aptiming.announcements for all
  using (event_id is not null and aptiming.can_manage_event(event_id))
  with check (event_id is not null and aptiming.can_manage_event(event_id));

-- ---------- Staging and publishing (the import screen calls these) ----------
-- stage_race_import: saves a previewed per-race file as UNPUBLISHED rows.
-- p_rows is the importer's `rows` array (camelCase keys) as JSON.
create or replace function aptiming.stage_race_import(
  p_event uuid, p_race_number int, p_filename text, p_rows jsonb, p_warnings jsonb default '[]')
returns uuid language plpgsql security definer set search_path = aptiming, public as $$
declare
  v_import uuid; v_class uuid; v_race uuid; v_class_name text;
begin
  if not aptiming.can_manage_event(p_event) then
    raise exception 'not allowed to import for this event' using errcode = '42501';
  end if;
  if jsonb_array_length(p_rows) = 0 then raise exception 'no rows to import'; end if;
  if (select count(distinct r->>'baseClass') from jsonb_array_elements(p_rows) r) > 1 then
    raise exception 'file contains more than one class';
  end if;
  v_class_name := p_rows->0->>'baseClass';

  insert into aptiming.imports(event_id, kind, filename, row_count, warnings)
  values (p_event, 'race', p_filename, jsonb_array_length(p_rows), coalesce(p_warnings, '[]'))
  returning id into v_import;

  select id into v_class from aptiming.classes where class_name = v_class_name limit 1;
  if v_class is null then
    insert into aptiming.classes(class_name) values (v_class_name) returning id into v_class;
  end if;

  select id into v_race from aptiming.races
   where event_id = p_event and race_number = p_race_number and class_id = v_class;
  if v_race is null then
    insert into aptiming.races(event_id, class_id, race_number, race_name)
    values (p_event, v_class, p_race_number, 'Race ' || p_race_number) returning id into v_race;
  end if;

  insert into aptiming.race_results(
    race_id, import_id, rider_id, position, pic, rider_number, rider_name, grade, status, laps,
    total_time, total_time_ms, best_lap, best_lap_ms, best_lap_on, diff_text, gap_text,
    avg_speed, best_speed, points, published, provisional)
  select v_race, v_import,
    (select ri.id from aptiming.riders ri
      where ri.rider_number = (x->>'raceNo')::int
        and upper(trim(coalesce(ri.first_name,'') || ' ' || coalesce(ri.last_name,''))) = upper(trim(x->>'name'))
      limit 1),
    nullif(x->>'pos','')::int, nullif(x->>'pic','')::int, (x->>'raceNo')::int, x->>'name',
    nullif(x->>'grade',''), coalesce(x->>'status','finished'), nullif(x->>'laps','')::int,
    nullif(x->>'totalTimeText',''), nullif(x->>'totalTimeMs','')::int,
    nullif(x->>'bestLapText',''), nullif(x->>'bestLapMs','')::int, nullif(x->>'bestLapOn','')::int,
    nullif(x->>'diffText',''), nullif(x->>'gapText',''),
    nullif(x->>'avgSpeed','')::numeric, nullif(x->>'bestSpeed','')::numeric,
    coalesce(nullif(x->>'points','')::numeric, 0), false, false
  from jsonb_array_elements(p_rows) x;

  return v_import;
end $$;

-- stage_points_import: saves a previewed graded-points file as UNPUBLISHED rows.
create or replace function aptiming.stage_points_import(
  p_event uuid, p_filename text, p_rows jsonb, p_warnings jsonb default '[]')
returns uuid language plpgsql security definer set search_path = aptiming, public as $$
declare v_import uuid;
begin
  if not aptiming.can_manage_event(p_event) then
    raise exception 'not allowed to import for this event' using errcode = '42501';
  end if;
  if jsonb_array_length(p_rows) = 0 then raise exception 'no rows to import'; end if;

  insert into aptiming.imports(event_id, kind, filename, row_count, warnings)
  values (p_event, 'points', p_filename, jsonb_array_length(p_rows), coalesce(p_warnings, '[]'))
  returning id into v_import;

  insert into aptiming.classes(class_name)
  select distinct x->>'baseClass' from jsonb_array_elements(p_rows) x
  where not exists (select 1 from aptiming.classes c where c.class_name = x->>'baseClass');

  insert into aptiming.points_results(
    import_id, event_id, class_id, grade, rider_id, rider_number, rider_name,
    pos, total_points, race_points, tie_note, published)
  select v_import, p_event, c.id, nullif(x->>'grade',''),
    (select ri.id from aptiming.riders ri
      where ri.rider_number = (x->>'raceNo')::int
        and upper(trim(coalesce(ri.first_name,'') || ' ' || coalesce(ri.last_name,''))) = upper(trim(x->>'name'))
      limit 1),
    (x->>'raceNo')::int, x->>'name', (x->>'pos')::int, (x->>'totalPoints')::numeric,
    (select array_agg(v::numeric order by ord) from jsonb_array_elements_text(x->'racePoints') with ordinality t(v, ord)),
    nullif(x->>'tieNote',''), false
  from jsonb_array_elements(p_rows) x
  join aptiming.classes c on c.class_name = x->>'baseClass';

  return v_import;
end $$;

-- publish_import: makes a previewed import visible to the public. It REPLACES whatever was
-- published before for the same race (or the same classes, for points), including live
-- provisional rows from the scoreboard feed.
create or replace function aptiming.publish_import(p_import uuid)
returns void language plpgsql security definer set search_path = aptiming, public as $$
declare v_event uuid; v_kind text;
begin
  select event_id, kind into v_event, v_kind from aptiming.imports where id = p_import;
  if v_event is null then raise exception 'import not found'; end if;
  if not aptiming.can_manage_event(v_event) then
    raise exception 'not allowed to publish for this event' using errcode = '42501';
  end if;

  if v_kind = 'race' then
    delete from aptiming.race_results rr
    where rr.race_id in (select race_id from aptiming.race_results where import_id = p_import)
      and ((rr.import_id is not null and rr.import_id <> p_import) or rr.provisional);
    update aptiming.race_results set published = true, updated_at = now() where import_id = p_import;
  else
    delete from aptiming.points_results pr
    where pr.event_id = v_event and pr.import_id <> p_import
      and pr.class_id in (select class_id from aptiming.points_results where import_id = p_import);
    update aptiming.points_results set published = true where import_id = p_import;
  end if;

  update aptiming.imports set published_at = now() where id = p_import;
end $$;

-- ---------- API grants (only the tables above; RLS decides the rows) ----------
grant usage on schema aptiming to anon, authenticated;
grant select on aptiming.events, aptiming.classes, aptiming.races, aptiming.race_results,
                aptiming.points_results, aptiming.holeshots, aptiming.announcements
  to anon, authenticated;
grant insert, update, delete on aptiming.events, aptiming.classes, aptiming.races,
                aptiming.race_results, aptiming.points_results, aptiming.holeshots,
                aptiming.announcements to authenticated;
grant select, insert, update, delete on aptiming.imports to authenticated;

revoke all on function aptiming.stage_race_import(uuid, int, text, jsonb, jsonb) from public, anon;
revoke all on function aptiming.stage_points_import(uuid, text, jsonb, jsonb) from public, anon;
revoke all on function aptiming.publish_import(uuid) from public, anon;
grant execute on function aptiming.stage_race_import(uuid, int, text, jsonb, jsonb) to authenticated;
grant execute on function aptiming.stage_points_import(uuid, text, jsonb, jsonb) to authenticated;
grant execute on function aptiming.publish_import(uuid) to authenticated;

-- The "aptiming" schema must be exposed to the API:
-- Supabase dashboard -> Settings -> API -> Exposed schemas -> add "aptiming".
