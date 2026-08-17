-- ============================================================
-- Fase 4: Prediction Engine in produzione (Dixon-Coles)
-- ============================================================
create table public.team_ratings (
  id serial primary key,
  team_id integer not null references public.teams(id) on delete cascade,
  model_version text not null,
  attack numeric not null,
  defense numeric not null,
  rating integer not null,          -- 0-100, vedi teamRatings() in dixon-coles.ts
  computed_at timestamptz not null default now()
);

create index team_ratings_team_idx on public.team_ratings(team_id, computed_at desc);

create table public.predictions (
  id serial primary key,
  match_id integer not null references public.matches(id) on delete cascade,
  model_version text not null,
  home_win numeric not null,
  draw numeric not null,
  away_win numeric not null,
  over_2_5 numeric not null,
  under_2_5 numeric not null,
  btts_yes numeric not null,
  btts_no numeric not null,
  top_scores jsonb not null,        -- [{home, away, probability}, ...] top 5
  computed_at timestamptz not null default now()
);

-- Una previsione "corrente" per partita+versione modello: evitiamo di
-- riempire la tabella di duplicati a ogni ricalcolo dello stesso giorno,
-- ma versioniamo per modello così cambiare il modello non cancella lo storico.
create unique index predictions_match_model_idx on public.predictions(match_id, model_version);

alter table public.team_ratings enable row level security;
alter table public.predictions enable row level security;

create policy "team_ratings: authenticated read" on public.team_ratings
  for select using (auth.role() = 'authenticated');
create policy "predictions: authenticated read" on public.predictions
  for select using (auth.role() = 'authenticated');
