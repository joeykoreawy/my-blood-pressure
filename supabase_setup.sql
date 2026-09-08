-- MyPressure V1.0 Supabase schema
create table if not exists public.bp_measurements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  measured_at timestamptz not null default now(),
  systolic smallint not null check (systolic between 40 and 300),
  diastolic smallint not null check (diastolic between 20 and 200),
  pulse smallint check (pulse between 20 and 250),
  tags text[] not null default '{}',
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  medication_started_on date,
  timezone text not null default 'Asia/Seoul',
  daily_plan jsonb not null default '[{"id":"morning_pre_med","label":"아침 · 약 복용 전","tags":["기상직후","아침","약복용전"]},{"id":"morning_post_med","label":"오전 · 약 복용 후","tags":["오전","약복용후"]},{"id":"afternoon_post_med","label":"오후 · 약 복용 후","tags":["오후","약복용후"]}]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists bp_measurements_user_time_idx on public.bp_measurements (user_id, measured_at desc);
create index if not exists bp_measurements_tags_idx on public.bp_measurements using gin (tags);

alter table public.bp_measurements enable row level security;
alter table public.user_settings enable row level security;
revoke all on public.bp_measurements from anon;
revoke all on public.user_settings from anon;
grant usage on schema public to authenticated;
grant select,insert,update,delete on public.bp_measurements to authenticated;
grant select,insert,update,delete on public.user_settings to authenticated;

drop policy if exists "Users can view own measurements" on public.bp_measurements;
drop policy if exists "Users can insert own measurements" on public.bp_measurements;
drop policy if exists "Users can update own measurements" on public.bp_measurements;
drop policy if exists "Users can delete own measurements" on public.bp_measurements;
drop policy if exists "Users can view own settings" on public.user_settings;
drop policy if exists "Users can insert own settings" on public.user_settings;
drop policy if exists "Users can update own settings" on public.user_settings;
drop policy if exists "Users can delete own settings" on public.user_settings;

create policy "Users can view own measurements" on public.bp_measurements for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can insert own measurements" on public.bp_measurements for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users can update own measurements" on public.bp_measurements for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users can delete own measurements" on public.bp_measurements for delete to authenticated using ((select auth.uid()) = user_id);
create policy "Users can view own settings" on public.user_settings for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can insert own settings" on public.user_settings for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users can update own settings" on public.user_settings for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users can delete own settings" on public.user_settings for delete to authenticated using ((select auth.uid()) = user_id);
