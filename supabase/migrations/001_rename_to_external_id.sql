-- ============================================================
-- Rinomina api_football_id -> external_id: passiamo da API-Football
-- (che sul piano free non copre la stagione corrente) a football-data.org.
-- La colonna torna generica rispetto alla fonte dati.
-- ============================================================
alter table public.competitions rename column api_football_id to external_id;
alter table public.seasons rename column api_football_id to external_id;
alter table public.teams rename column api_football_id to external_id;
alter table public.matches rename column api_football_id to external_id;
