-- ============================================================
-- Squadra preferita per utente (dashboard personalizzata)
-- ============================================================
alter table public.profiles add column favorite_team_id integer references public.teams(id);
