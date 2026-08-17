-- ============================================================
-- Fase 2: comparatore quote (The Odds API, free tier)
-- ============================================================
create table public.bookmakers (
  id serial primary key,
  external_key text unique not null,   -- es. 'unibet_fr', dalla Odds API
  name text not null
);

-- Dinamica per costruzione (dynamic per design), non enum fisso: consente
-- di aggiungere mercati (over/under, gg/ng...) senza migrazioni future.
create table public.markets (
  id serial primary key,
  market_type text unique not null,    -- es. 'h2h'
  market_label text not null           -- es. '1X2'
);

-- Append-only: ogni sync inserisce nuove righe (mai update in place), così
-- lo storico delle variazioni quota è gratis. is_current marca le righe
-- valide "adesso" per le query della dashboard.
create table public.odds (
  id serial primary key,
  match_id integer not null references public.matches(id) on delete cascade,
  bookmaker_id integer not null references public.bookmakers(id),
  market_id integer not null references public.markets(id),
  outcome text not null,               -- 'home' | 'draw' | 'away'
  value numeric not null,
  is_current boolean not null default true,
  created_at timestamptz not null default now()
);

create index odds_match_idx on public.odds(match_id);
create index odds_current_idx on public.odds(match_id, is_current);

alter table public.bookmakers enable row level security;
alter table public.markets enable row level security;
alter table public.odds enable row level security;

create policy "bookmakers: authenticated read" on public.bookmakers
  for select using (auth.role() = 'authenticated');
create policy "markets: authenticated read" on public.markets
  for select using (auth.role() = 'authenticated');
create policy "odds: authenticated read" on public.odds
  for select using (auth.role() = 'authenticated');

-- Nessuna policy di scrittura per il client: stesso pattern delle altre
-- tabelle, tutte le scritture passano dalla route server-side con service role.
