-- ============================================================
-- Fase 5: Value Engine
-- ============================================================
create table public.value_signals (
  id serial primary key,
  match_id integer not null references public.matches(id) on delete cascade,
  outcome text not null,              -- 'home' | 'draw' | 'away'
  model_probability numeric not null,
  implied_probability numeric not null,  -- normalizzata (overround rimosso)
  best_odds numeric not null,
  bookmaker_name text not null,
  edge numeric not null,              -- model_probability - implied_probability
  ev numeric not null,                -- expected value per unità puntata
  computed_at timestamptz not null default now()
);

create unique index value_signals_match_outcome_idx on public.value_signals(match_id, outcome);

alter table public.value_signals enable row level security;
create policy "value_signals: authenticated read" on public.value_signals
  for select using (auth.role() = 'authenticated');
