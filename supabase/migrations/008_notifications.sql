-- ============================================================
-- Fase 11: Notifiche — traccia cosa è già stato notificato per non spammare
-- ad ogni cron (append-only, un record per evento notificato).
-- ============================================================
create table public.notifications_sent (
  id serial primary key,
  kind text not null,             -- 'value_signal' | 'odds_movement'
  match_id integer not null references public.matches(id) on delete cascade,
  outcome text,
  detail text not null,
  sent_at timestamptz not null default now()
);

create unique index notifications_sent_dedup_idx on public.notifications_sent(kind, match_id, outcome);

alter table public.notifications_sent enable row level security;
create policy "notifications_sent: admin read" on public.notifications_sent
  for select using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );
