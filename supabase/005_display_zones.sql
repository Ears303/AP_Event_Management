-- Screen layout for the trailer display: up to 10 areas (5 across x 2 down), each showing one or more
-- classes (stacked), the event's sponsor logos, or nothing. Safe to re-run. Run after 004_events_holeshots.sql.

create table if not exists aptiming.display_zones (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references aptiming.events(id) on delete cascade,
  zone_no int not null check (zone_no between 1 and 10),
  zone_type text not null default 'results' check (zone_type in ('results','sponsors','empty')),
  class_names text[] not null default '{}',   -- class names shown in this area, top to bottom
  unique (event_id, zone_no)
);
alter table aptiming.display_zones enable row level security;

drop policy if exists public_read_display_zones on aptiming.display_zones;
create policy public_read_display_zones on aptiming.display_zones for select using (aptiming.is_event_public(event_id));
drop policy if exists staff_all_display_zones on aptiming.display_zones;
create policy staff_all_display_zones on aptiming.display_zones for all
  using (aptiming.can_manage_event(event_id)) with check (aptiming.can_manage_event(event_id));

-- Sponsors: the public display can read the logos of a public event's sponsors.
alter table aptiming.sponsors enable row level security;
alter table aptiming.event_sponsors enable row level security;
drop policy if exists public_read_event_sponsors on aptiming.event_sponsors;
create policy public_read_event_sponsors on aptiming.event_sponsors for select using (aptiming.is_event_public(event_id));
drop policy if exists public_read_sponsors on aptiming.sponsors;
create policy public_read_sponsors on aptiming.sponsors for select
  using (coalesce(active, true) and exists (select 1 from aptiming.event_sponsors es
          where es.sponsor_id = sponsors.id and aptiming.is_event_public(es.event_id)));
drop policy if exists staff_read_event_sponsors on aptiming.event_sponsors;
create policy staff_read_event_sponsors on aptiming.event_sponsors for select using (aptiming.can_manage_event(event_id));
drop policy if exists staff_read_sponsors on aptiming.sponsors;
create policy staff_read_sponsors on aptiming.sponsors for select
  using (exists (select 1 from aptiming.event_sponsors es where es.sponsor_id = sponsors.id and aptiming.can_manage_event(es.event_id)));

grant select on aptiming.display_zones, aptiming.sponsors, aptiming.event_sponsors to anon, authenticated;

-- Replace an event's whole layout. p_zones: [{"zoneNo":1,"type":"results","classNames":["65cc 7-U10 Yrs","65cc 10-U12 Yrs"]}, ...]
create or replace function aptiming.save_display_zones(p_event uuid, p_zones jsonb)
returns int language plpgsql security definer set search_path = aptiming, public as $$
declare z jsonb; v_n int := 0;
begin
  if not aptiming.can_manage_event(p_event) then raise exception 'not allowed'; end if;
  if jsonb_typeof(p_zones) <> 'array' then raise exception 'zones must be a list'; end if;
  delete from aptiming.display_zones where event_id = p_event;
  for z in select * from jsonb_array_elements(p_zones) loop
    insert into aptiming.display_zones(event_id, zone_no, zone_type, class_names)
    values (p_event, (z->>'zoneNo')::int, coalesce(z->>'type', 'results'),
            coalesce(array(select jsonb_array_elements_text(z->'classNames')), '{}'));
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- Add a sponsor (name + link to the logo image) to an event, or remove one.
create or replace function aptiming.add_event_sponsor(p_event uuid, p_name text, p_image_url text)
returns uuid language plpgsql security definer set search_path = aptiming, public as $$
declare v_id uuid; v_ord int;
begin
  if not aptiming.can_manage_event(p_event) then raise exception 'not allowed'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'sponsor name is required'; end if;
  if coalesce(trim(p_image_url), '') !~* '^https?://' then raise exception 'logo link must start with http:// or https://'; end if;
  insert into aptiming.sponsors(sponsor_name, image_url) values (trim(p_name), trim(p_image_url)) returning id into v_id;
  select coalesce(max(display_order), 0) + 1 into v_ord from aptiming.event_sponsors where event_id = p_event;
  insert into aptiming.event_sponsors(event_id, sponsor_id, display_order) values (p_event, v_id, v_ord);
  return v_id;
end $$;

create or replace function aptiming.remove_event_sponsor(p_event uuid, p_sponsor uuid)
returns void language plpgsql security definer set search_path = aptiming, public as $$
begin
  if not aptiming.can_manage_event(p_event) then raise exception 'not allowed'; end if;
  delete from aptiming.event_sponsors where event_id = p_event and sponsor_id = p_sponsor;
  delete from aptiming.sponsors s where s.id = p_sponsor and not exists (select 1 from aptiming.event_sponsors where sponsor_id = s.id);
end $$;

revoke all on function aptiming.save_display_zones(uuid, jsonb) from public, anon;
revoke all on function aptiming.add_event_sponsor(uuid, text, text) from public, anon;
revoke all on function aptiming.remove_event_sponsor(uuid, uuid) from public, anon;
grant execute on function aptiming.save_display_zones(uuid, jsonb) to authenticated;
grant execute on function aptiming.add_event_sponsor(uuid, text, text) to authenticated;
grant execute on function aptiming.remove_event_sponsor(uuid, uuid) to authenticated;
notify pgrst, 'reload schema';
