create extension if not exists pgcrypto;

create table if not exists public.hazard_reports (
  id uuid primary key default gen_random_uuid(),
  hazard_id uuid not null,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  hazard_type text not null check (hazard_type in (
    '가로수 뿌리', '보도블록 파손', '단차·턱', '급경사',
    '좁은 보도', '공사 장애물', '맨홀·배수구', '미끄러운 노면'
  )),
  title text not null check (char_length(title) between 1 and 140),
  detail text not null check (char_length(detail) between 1 and 500),
  place text not null check (char_length(place) between 1 and 160),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  passability jsonb not null check (
    passability->>'wheelchair' in ('지나갈 수 있음', '어려움', '불가능') and
    passability->>'stroller' in ('지나갈 수 있음', '어려움', '불가능') and
    passability->>'walking' in ('지나갈 수 있음', '어려움', '불가능')
  ),
  severity smallint not null check (severity between 1 and 3),
  memo text not null default '' check (char_length(memo) <= 300),
  photos text[] not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists hazard_reports_group_created_idx
  on public.hazard_reports (hazard_id, created_at desc);

alter table public.hazard_reports enable row level security;
grant select on public.hazard_reports to anon, authenticated;
grant insert on public.hazard_reports to authenticated;

drop policy if exists "Anyone can read shared hazard reports" on public.hazard_reports;
create policy "Anyone can read shared hazard reports"
  on public.hazard_reports for select to anon, authenticated
  using (true);

drop policy if exists "Signed-in users can add their own reports" on public.hazard_reports;
create policy "Signed-in users can add their own reports"
  on public.hazard_reports for insert to authenticated
  with check (reporter_id = auth.uid());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('hazard-photos', 'hazard-photos', true, 6291456, array['image/jpeg'])
on conflict (id) do update set public = true, file_size_limit = 6291456, allowed_mime_types = array['image/jpeg'];

drop policy if exists "Anyone can view shared hazard photos" on storage.objects;
create policy "Anyone can view shared hazard photos"
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'hazard-photos');

drop policy if exists "Users can upload photos into their own folder" on storage.objects;
create policy "Users can upload photos into their own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'hazard-photos' and
    (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users can replace photos in their own folder" on storage.objects;
create policy "Users can replace photos in their own folder"
  on storage.objects for update to authenticated
  using (bucket_id = 'hazard-photos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'hazard-photos' and (storage.foldername(name))[1] = auth.uid()::text);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'hazard_reports'
  ) then
    alter publication supabase_realtime add table public.hazard_reports;
  end if;
end $$;

notify pgrst, 'reload schema';
