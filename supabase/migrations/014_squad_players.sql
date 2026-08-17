-- ============================================================
-- Fase 14: Rosa completa (non solo marcatori)
-- ============================================================
-- player_scorers contiene solo chi ha già segnato — troppo stretto per un
-- "outsider" scelto a caso: se il pool sono sempre gli stessi 5-8 marcatori,
-- non è mai davvero una sorpresa. Questa tabella tiene l'intera rosa attuale
-- (anche difensori/portieri a 0 gol) come bacino per la scelta random.
create table public.players (
  id serial primary key,
  external_id integer unique not null,
  name text not null,
  team_id integer references public.teams(id) on delete set null,
  position text,
  updated_at timestamptz not null default now()
);

create index players_team_idx on public.players(team_id);

alter table public.players enable row level security;
create policy "players: authenticated read" on public.players
  for select using (auth.role() = 'authenticated');
