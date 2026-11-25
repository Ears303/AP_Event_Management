-- HOLESHOT TEST SETUP: run AFTER seed_test_data.sql, 003_schedule.sql and 004_events_holeshots.sql.
-- 1) Marks three of the test races as having a holeshot (races 3, 6 and 12).
-- 2) Puts the ZZ TEST EVENT in the same organisation as YOUR login, so /manager lets you enter holeshots.
--    Replace the email below with the one you sign in to /manager with.
-- remove_test_data.sql still removes everything afterwards.

update aptiming.races set holeshot = true
 where event_id = 'ee000000-0000-4000-8000-000000000001' and race_number in (3, 6, 12);

update aptiming.events
   set organisation_id = (select p.organisation_id
                            from aptiming.profiles p join auth.users u on u.id = p.id
                           where lower(u.email) = lower('YOUR-LOGIN-EMAIL@example.com'))
 where id = 'ee000000-0000-4000-8000-000000000001'
   and exists (select 1 from aptiming.profiles p join auth.users u on u.id = p.id
                where lower(u.email) = lower('YOUR-LOGIN-EMAIL@example.com') and p.organisation_id is not null);

-- Shows what was set up (expect 3 races with holeshot = true, and an organisation that is not "ZZ TEST ORG").
select r.race_number, c.class_name, r.holeshot, o.name as event_organisation
  from aptiming.races r
  join aptiming.classes c on c.id = r.class_id
  join aptiming.events e on e.id = r.event_id
  join aptiming.organisations o on o.id = e.organisation_id
 where r.event_id = 'ee000000-0000-4000-8000-000000000001' and r.holeshot
 order by r.race_number;
