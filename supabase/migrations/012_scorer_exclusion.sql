-- ============================================================
-- Fase 12: Esclusione manuale marcatori (infortunati/squalificati)
-- ============================================================
-- Non esiste una fonte dati gratuita per infortuni/squalifiche (verificato:
-- football-data.org non ha endpoint infortuni sul piano free, API-Football
-- limita il piano free alle stagioni vecchie anche per l'endpoint infortuni).
-- Soluzione: un admin può escludere manualmente un giocatore dai marcatori
-- consigliati quando sa che è indisponibile — nessun dato inventato, solo un
-- filtro manuale su dati reali.
alter table public.player_scorers add column excluded boolean not null default false;
