-- ============================================================
-- Fase 8: Schedina virtuale — dati PRIVATI per utente, non condivisi
-- (a differenza di tutte le altre tabelle, qui le RLS restringono per
-- auth.uid() = user_id, e la scrittura passa dalla sessione dell'utente
-- stesso, non dal service role: sono dati suoi, non dati di sistema)
-- ============================================================
create table public.bet_slips (
  id serial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  stake numeric,
  created_at timestamptz not null default now()
);

create table public.bet_slip_selections (
  id serial primary key,
  bet_slip_id integer not null references public.bet_slips(id) on delete cascade,
  match_id integer not null references public.matches(id),
  outcome text not null,
  odds_at_selection numeric not null,
  bookmaker_name text not null
);

create index bet_slips_user_idx on public.bet_slips(user_id, created_at desc);
create index bet_slip_selections_slip_idx on public.bet_slip_selections(bet_slip_id);

alter table public.bet_slips enable row level security;
alter table public.bet_slip_selections enable row level security;

create policy "bet_slips: solo proprie" on public.bet_slips
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "bet_slip_selections: solo tramite propria schedina" on public.bet_slip_selections
  for all using (
    exists (select 1 from public.bet_slips bs where bs.id = bet_slip_id and bs.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.bet_slips bs where bs.id = bet_slip_id and bs.user_id = auth.uid())
  );
