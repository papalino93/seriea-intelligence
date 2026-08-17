-- ============================================================
-- Serie A Betting Intelligence — Fase 1 (MVP) schema
-- Incolla ed esegui questo file per intero nell'SQL editor di Supabase.
-- ============================================================

-- ---------- Ruoli utente ----------
create type public.user_role as enum ('admin', 'user');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role public.user_role not null default 'user',
  created_at timestamptz not null default now()
);

-- ---------- Anagrafica calcio ----------
create table public.competitions (
  id serial primary key,
  external_id integer unique not null,
  name text not null,
  country text not null default 'Italy',
  logo_url text
);

create table public.seasons (
  id serial primary key,
  competition_id integer not null references public.competitions(id) on delete cascade,
  year integer not null,
  external_id integer unique not null,
  is_current boolean not null default false,
  unique (competition_id, year)
);

create table public.teams (
  id serial primary key,
  external_id integer unique not null,
  name text not null,
  short_name text,
  logo_url text
);

create table public.rounds (
  id serial primary key,
  season_id integer not null references public.seasons(id) on delete cascade,
  round_number integer not null,
  label text not null,          -- es. "Regular Season - 5"
  unique (season_id, round_number)
);

create table public.matches (
  id serial primary key,
  external_id integer unique not null,
  season_id integer not null references public.seasons(id) on delete cascade,
  round_id integer references public.rounds(id) on delete set null,
  home_team_id integer not null references public.teams(id),
  away_team_id integer not null references public.teams(id),
  kickoff_at timestamptz not null,
  venue text,
  status text not null default 'scheduled',  -- scheduled | live | finished | postponed
  home_score integer,
  away_score integer,
  updated_at timestamptz not null default now()
);

create index matches_round_idx on public.matches(round_id);
create index matches_kickoff_idx on public.matches(kickoff_at);

-- ---------- Trasparenza dati (principio "Data Quality" del documento di progettazione) ----------
create table public.sync_logs (
  id serial primary key,
  source text not null,             -- es. 'api-football'
  sync_type text not null,          -- es. 'calendar'
  status text not null,             -- 'success' | 'error'
  requests_used integer default 0,
  message text,
  created_at timestamptz not null default now()
);

-- ============================================================
-- Row Level Security
-- ============================================================
alter table public.profiles enable row level security;
alter table public.competitions enable row level security;
alter table public.seasons enable row level security;
alter table public.teams enable row level security;
alter table public.rounds enable row level security;
alter table public.matches enable row level security;
alter table public.sync_logs enable row level security;

-- Ogni utente autenticato legge il proprio profilo
create policy "profiles: self read" on public.profiles
  for select using (auth.uid() = id);

-- Dati calcio: lettura per qualunque utente autenticato (i 3 utenti del progetto)
create policy "competitions: authenticated read" on public.competitions
  for select using (auth.role() = 'authenticated');
create policy "seasons: authenticated read" on public.seasons
  for select using (auth.role() = 'authenticated');
create policy "teams: authenticated read" on public.teams
  for select using (auth.role() = 'authenticated');
create policy "rounds: authenticated read" on public.rounds
  for select using (auth.role() = 'authenticated');
create policy "matches: authenticated read" on public.matches
  for select using (auth.role() = 'authenticated');

-- sync_logs: leggibile solo da admin
create policy "sync_logs: admin read" on public.sync_logs
  for select using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

-- Nota: nessuna policy di insert/update per il client su nessuna tabella.
-- Tutte le scritture passano dalle API route server-side con la service role key,
-- che bypassa RLS by design — coerente con "nessuna credenziale/scrittura dal browser".

-- ============================================================
-- Trigger: crea automaticamente un profilo alla registrazione utente
-- ============================================================
create function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, role)
  values (new.id, new.email, 'user');
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ============================================================
-- Dopo aver eseguito questo file: invita i 3 utenti da
-- Supabase Dashboard → Authentication → Users → Invite user.
-- Per promuovere un utente ad admin:
--   update public.profiles set role = 'admin' where email = 'tua@email.it';
-- ============================================================
