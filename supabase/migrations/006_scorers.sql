-- ============================================================
-- Fase 6: Marcatori
-- ============================================================
create table public.player_scorers (
  id serial primary key,
  external_id integer unique not null,
  name text not null,
  team_id integer references public.teams(id) on delete set null,
  goals integer not null,
  played_matches integer not null,
  assists integer,
  updated_at timestamptz not null default now()
);

create index player_scorers_team_idx on public.player_scorers(team_id);

alter table public.player_scorers enable row level security;
create policy "player_scorers: authenticated read" on public.player_scorers
  for select using (auth.role() = 'authenticated');
