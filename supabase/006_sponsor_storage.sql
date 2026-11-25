-- Sponsor logo uploads. Safe to re-run. Run after 005_display_zones.sql.
-- Creates a public storage bucket for logos (anyone can view a logo by its link; only timing staff can add or remove).

create or replace function aptiming.is_staff() returns boolean
language sql stable security definer set search_path = aptiming, public as $$
  select exists (select 1 from aptiming.profiles p where p.id = auth.uid() and p.role in ('admin','timing'));
$$;
revoke all on function aptiming.is_staff() from public, anon;
grant execute on function aptiming.is_staff() to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('sponsor-logos', 'sponsor-logos', true, 5242880, array['image/jpeg','image/png'])
on conflict (id) do update set public = true, file_size_limit = 5242880, allowed_mime_types = array['image/jpeg','image/png'];

drop policy if exists "staff upload sponsor logos" on storage.objects;
create policy "staff upload sponsor logos" on storage.objects for insert to authenticated
  with check (bucket_id = 'sponsor-logos' and aptiming.is_staff());
drop policy if exists "staff delete sponsor logos" on storage.objects;
create policy "staff delete sponsor logos" on storage.objects for delete to authenticated
  using (bucket_id = 'sponsor-logos' and aptiming.is_staff());
drop policy if exists "staff read sponsor logos" on storage.objects;
create policy "staff read sponsor logos" on storage.objects for select to authenticated
  using (bucket_id = 'sponsor-logos' and aptiming.is_staff());
