-- ============================================================
-- Commento IA della giornata (layer AI, documento sezione 3): trasforma i
-- numeri già calcolati (previsioni, value, marcatori) in testo — mai il
-- contrario, l'IA non genera previsioni proprie, solo le racconta.
-- ============================================================
create table public.round_summaries (
  id serial primary key,
  round_id integer not null references public.rounds(id) on delete cascade,
  summary_text text not null,
  model text not null,
  generated_at timestamptz not null default now()
);

create unique index round_summaries_round_idx on public.round_summaries(round_id);

alter table public.round_summaries enable row level security;
create policy "round_summaries: authenticated read" on public.round_summaries
  for select using (auth.role() = 'authenticated');
