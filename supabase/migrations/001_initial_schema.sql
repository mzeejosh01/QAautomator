-- Enable necessary extensions
create extension if not exists "uuid-ossp";

-- Users table (extends Supabase auth.users)
create table public.profiles (
  id uuid references auth.users on delete cascade primary key,
  email text unique not null,
  full_name text,
  avatar_url text,
  github_token text,
  slack_webhook_url text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Projects table
create table public.projects (
  id uuid default uuid_generate_v4() primary key,
  name text not null,
  description text,
  repository_url text,
  repository_name text,
  github_repo_id bigint,
  owner_id uuid references public.profiles(id) on delete cascade not null,
  settings jsonb default '{}',
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Test cases table
create table public.test_cases (
  id uuid default uuid_generate_v4() primary key,
  project_id uuid references public.projects(id) on delete cascade not null,
  name text not null,
  description text,
  steps jsonb not null, -- Array of {action, expected_result}
  test_data jsonb default '{}',
  priority text check (priority in ('Low', 'Medium', 'High')) default 'Medium',
  category text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Test runs table
create table public.test_runs (
  id uuid default uuid_generate_v4() primary key,
  project_id uuid references public.projects(id) on delete cascade not null,
  name text not null,
  environment text not null,
  status text check (status in ('pending', 'running', 'completed', 'failed')) default 'pending',
  trigger_type text check (trigger_type in ('manual', 'github_pr', 'scheduled')) not null,
  trigger_data jsonb default '{}',
  started_by uuid references public.profiles(id) on delete set null,
  started_at timestamp with time zone default timezone('utc'::text, now()) not null,
  completed_at timestamp with time zone,
  total_tests integer default 0,
  passed_tests integer default 0,
  failed_tests integer default 0,
  duration_seconds integer,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Test results table
create table public.test_results (
  id uuid default uuid_generate_v4() primary key,
  test_run_id uuid references public.test_runs(id) on delete cascade not null,
  test_case_id uuid references public.test_cases(id) on delete cascade not null,
  status text check (status in ('pass', 'fail', 'skip')) not null,
  error_message text,
  logs text,
  screenshots jsonb default '[]', -- Array of screenshot URLs
  duration_seconds integer,
  executed_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- GitHub webhooks table
create table public.github_webhooks (
  id uuid default uuid_generate_v4() primary key,
  project_id uuid references public.projects(id) on delete cascade not null,
  webhook_id bigint unique not null,
  repository_id bigint not null,
  secret text not null,
  active boolean default true,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- AI generated features table
create table public.ai_features (
  id uuid default uuid_generate_v4() primary key,
  project_id uuid references public.projects(id) on delete cascade not null,
  source_type text check (source_type in ('description', 'github_pr', 'repository_analysis')) not null,
  source_data jsonb not null,
  generated_test_cases jsonb not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable Row Level Security (RLS)
alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.test_cases enable row level security;
alter table public.test_runs enable row level security;
alter table public.test_results enable row level security;
alter table public.github_webhooks enable row level security;
alter table public.ai_features enable row level security;

-- RLS Policies
-- Profiles: Users can only see/edit their own profile
create policy "Users can view own profile" on public.profiles
  for select using (auth.uid() = id);

create policy "Users can update own profile" on public.profiles
  for update using (auth.uid() = id);

-- Projects: Users can only access their own projects
create policy "Users can view own projects" on public.projects
  for select using (auth.uid() = owner_id);

create policy "Users can create projects" on public.projects
  for insert with check (auth.uid() = owner_id);

create policy "Users can update own projects" on public.projects
  for update using (auth.uid() = owner_id);

create policy "Users can delete own projects" on public.projects
  for delete using (auth.uid() = owner_id);

-- Test cases: Users can access test cases for their projects
create policy "Users can view test cases for their projects" on public.test_cases
  for select using (
    exists (
      select 1 from public.projects
      where projects.id = test_cases.project_id
      and projects.owner_id = auth.uid()
    )
  );

create policy "Users can manage test cases for their projects" on public.test_cases
  for all using (
    exists (
      select 1 from public.projects
      where projects.id = test_cases.project_id
      and projects.owner_id = auth.uid()
    )
  );

-- Similar policies for other tables...
create policy "Users can view test runs for their projects" on public.test_runs
  for select using (
    exists (
      select 1 from public.projects
      where projects.id = test_runs.project_id
      and projects.owner_id = auth.uid()
    )
  );

create policy "Users can manage test runs for their projects" on public.test_runs
  for all using (
    exists (
      select 1 from public.projects
      where projects.id = test_runs.project_id
      and projects.owner_id = auth.uid()
    )
  );

-- Functions and triggers for updated_at
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = timezone('utc'::text, now());
  return new;
end;
$$ language plpgsql;

create trigger handle_updated_at before update on public.profiles
  for each row execute procedure public.handle_updated_at();

create trigger handle_updated_at before update on public.projects
  for each row execute procedure public.handle_updated_at();

create trigger handle_updated_at before update on public.test_cases
  for each row execute procedure public.handle_updated_at();

-- Function to automatically create profile on user signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name');
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();