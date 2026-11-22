-- REMOVE the ZZ TEST event and everything the seed script loaded. Safe to run any time.
-- Only touches rows tagged for the test: event id ee000000-0000-4000-8000-000000000001,
-- classes named "ZZTEST ...", and the organisation "ZZ TEST ORG" (only if it is empty).
delete from aptiming.holeshots      where event_id = 'ee000000-0000-4000-8000-000000000001';
delete from aptiming.announcements  where event_id = 'ee000000-0000-4000-8000-000000000001';
delete from aptiming.grid_draws     where race_id in (select id from aptiming.races where event_id = 'ee000000-0000-4000-8000-000000000001');
delete from aptiming.race_results   where race_id in (select id from aptiming.races where event_id = 'ee000000-0000-4000-8000-000000000001');
delete from aptiming.points_results where event_id = 'ee000000-0000-4000-8000-000000000001';
delete from aptiming.imports        where event_id = 'ee000000-0000-4000-8000-000000000001';
delete from aptiming.event_classes  where event_id = 'ee000000-0000-4000-8000-000000000001';
delete from aptiming.event_sponsors where event_id = 'ee000000-0000-4000-8000-000000000001';
delete from aptiming.display_screens where event_id = 'ee000000-0000-4000-8000-000000000001';
delete from aptiming.races          where event_id = 'ee000000-0000-4000-8000-000000000001';
delete from aptiming.events         where id = 'ee000000-0000-4000-8000-000000000001';
delete from aptiming.classes        where class_name like 'ZZTEST %';
delete from aptiming.organisations o
 where o.name = 'ZZ TEST ORG'
   and not exists (select 1 from aptiming.events e   where e.organisation_id = o.id)
   and not exists (select 1 from aptiming.series s   where s.organisation_id = o.id)
   and not exists (select 1 from aptiming.profiles p where p.organisation_id = o.id);

-- Check: every count below should be 0
select (select count(*) from aptiming.events where id = 'ee000000-0000-4000-8000-000000000001') as events,
       (select count(*) from aptiming.classes where class_name like 'ZZTEST %') as classes,
       (select count(*) from aptiming.race_results rr join aptiming.races r on r.id = rr.race_id where r.event_id = 'ee000000-0000-4000-8000-000000000001') as results,
       (select count(*) from aptiming.organisations where name = 'ZZ TEST ORG') as test_org;
