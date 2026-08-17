-- ============================================================
-- Fase 13: Segnale "gioca ancora" per i marcatori consigliati
-- ============================================================
-- Il marcatore consigliato usava il totale gol sommato su 2 stagioni: un
-- giocatore fuori rotazione ma con un buon passato (es. Nzola) poteva
-- comparire come consigliato anche senza aver segnato in questa stagione.
-- Non abbiamo dati su minuti/titolarità, ma l'endpoint marcatori di
-- football-data.org include le presenze di chi ha già segnato in stagione
-- corrente: usiamo quello come proxy onesto di "è nelle rotazioni adesso".
alter table public.player_scorers add column current_season_matches integer not null default 0;
