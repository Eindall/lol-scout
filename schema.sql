-- Schéma idempotent, rejoué à chaque démarrage.

CREATE TABLE IF NOT EXISTS players (
  puuid          TEXT PRIMARY KEY,
  game_name      TEXT NOT NULL,
  tag_line       TEXT NOT NULL,
  region         TEXT NOT NULL,
  -- Toutes les parties commencées avant cette date sont en base.
  synced_until   TIMESTAMPTZ,
  last_synced_at TIMESTAMPTZ,
  rank           JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_viewed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS players_riot_id
  ON players (region, lower(game_name), lower(tag_line));

CREATE TABLE IF NOT EXISTS matches (
  match_id     TEXT PRIMARY KEY,
  queue_id     INT NOT NULL,
  game_start   TIMESTAMPTZ NOT NULL,
  duration_s   INT NOT NULL,
  game_version TEXT,
  remake       BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS matches_game_start ON matches (game_start);

-- Les 10 joueurs de chaque partie : une game déjà téléchargée pour
-- un joueur ne sera plus jamais redemandée pour ses coéquipiers ou adversaires.
CREATE TABLE IF NOT EXISTS participants (
  match_id      TEXT NOT NULL REFERENCES matches (match_id) ON DELETE CASCADE,
  puuid         TEXT NOT NULL,
  champion_id   INT NOT NULL,
  champion_name TEXT,
  team_position TEXT,
  win           BOOLEAN NOT NULL,
  kills         INT NOT NULL DEFAULT 0,
  deaths        INT NOT NULL DEFAULT 0,
  assists       INT NOT NULL DEFAULT 0,
  cs            INT NOT NULL DEFAULT 0,
  PRIMARY KEY (match_id, puuid)
);

CREATE INDEX IF NOT EXISTS participants_puuid ON participants (puuid);
