create schema if not exists aptiming;
create table if not exists aptiming.events(id uuid primary key default gen_random_uuid(),event_name text,status text default 'draft');
create table if not exists aptiming.classes(id uuid primary key default gen_random_uuid(),class_name text unique);
create table if not exists aptiming.races(id uuid primary key default gen_random_uuid(),event_id uuid,race_number int,class_name text);
create table if not exists aptiming.race_results(id uuid primary key default gen_random_uuid(),race_id uuid,position int,rider_number int,rider_name text,best_lap text);
insert into aptiming.classes(class_name) values ('MX1'),('MX2'),('MX3'),('JUNIORS'),('WOMEN'),('VETERANS'),('CLUBMAN') on conflict do nothing;