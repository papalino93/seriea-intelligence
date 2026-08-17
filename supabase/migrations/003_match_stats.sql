-- ============================================================
-- Fase 3: statistiche avanzate — risultato 1° tempo e arbitro
-- (già inclusi gratis nella risposta football-data.org, non ancora salvati)
-- ============================================================
alter table public.matches add column home_score_ht integer;
alter table public.matches add column away_score_ht integer;
alter table public.matches add column referee_name text;
