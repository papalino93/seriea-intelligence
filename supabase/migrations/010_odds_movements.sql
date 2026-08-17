-- ============================================================
-- Notifiche variazione quota (Fase 11, completamento)
-- ============================================================
create table public.odds_movements (
  id serial primary key,
  match_id integer not null references public.matches(id) on delete cascade,
  outcome text not null,
  old_value numeric not null,
  new_value numeric not null,
  pct_change numeric not null,
  detected_at timestamptz not null default now()
);

alter table public.odds_movements enable row level security;
create policy "odds_movements: authenticated read" on public.odds_movements
  for select using (auth.role() = 'authenticated');
