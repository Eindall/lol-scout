import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { config } from './config.js';

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 5 });

export async function migrate() {
  const sql = await readFile(new URL('../schema.sql', import.meta.url), 'utf8');
  await pool.query(sql);
}

// ---------- Joueurs ----------

export async function findPlayerByRiotId(region, gameName, tagLine) {
  const { rows } = await pool.query(
    `SELECT * FROM players
      WHERE region = $1 AND lower(game_name) = lower($2) AND lower(tag_line) = lower($3)
      ORDER BY last_synced_at DESC NULLS LAST
      LIMIT 1`,
    [region, gameName, tagLine],
  );
  return rows[0] ?? null;
}

export async function getPlayer(puuid) {
  const { rows } = await pool.query('SELECT * FROM players WHERE puuid = $1', [puuid]);
  return rows[0] ?? null;
}

export async function upsertPlayer({ puuid, gameName, tagLine, region }) {
  const { rows } = await pool.query(
    `INSERT INTO players (puuid, game_name, tag_line, region)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (puuid) DO UPDATE
       SET game_name = EXCLUDED.game_name,
           tag_line = EXCLUDED.tag_line,
           region = EXCLUDED.region,
           last_viewed_at = now()
     RETURNING *`,
    [puuid, gameName, tagLine, region],
  );
  return rows[0];
}

export async function touchPlayer(puuid) {
  await pool.query('UPDATE players SET last_viewed_at = now() WHERE puuid = $1', [puuid]);
}

export async function updateRiotId(puuid, gameName, tagLine) {
  await pool.query('UPDATE players SET game_name = $2, tag_line = $3 WHERE puuid = $1', [
    puuid,
    gameName,
    tagLine,
  ]);
}

export async function setRank(puuid, rank) {
  await pool.query('UPDATE players SET rank = $2 WHERE puuid = $1', [puuid, rank]);
}

export async function markSynced(puuid, syncedUntil) {
  await pool.query(
    'UPDATE players SET synced_until = $2, last_synced_at = now() WHERE puuid = $1',
    [puuid, syncedUntil],
  );
}

export async function recentPlayers(limit = 12) {
  const { rows } = await pool.query(
    `SELECT puuid, game_name, tag_line, region, last_synced_at
       FROM players ORDER BY last_viewed_at DESC LIMIT $1`,
    [limit],
  );
  return rows;
}

// ---------- Parties ----------

/** Renvoie, dans l'ordre reçu, les IDs absents de la base. */
export async function missingMatchIds(ids) {
  if (ids.length === 0) return [];
  const { rows } = await pool.query(
    `SELECT t.id
       FROM unnest($1::text[]) WITH ORDINALITY AS t(id, ord)
      WHERE NOT EXISTS (SELECT 1 FROM matches m WHERE m.match_id = t.id)
      ORDER BY t.ord`,
    [ids],
  );
  return rows.map((r) => r.id);
}

export async function saveMatch(match) {
  const { metadata, info } = match;
  const participants = info.participants ?? [];
  const remake =
    participants.some((p) => p.gameEndedInEarlySurrender) || (info.gameDuration ?? 0) < 300;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO matches (match_id, queue_id, game_start, duration_s, game_version, remake)
       VALUES ($1, $2, to_timestamp($3 / 1000.0), $4, $5, $6)
       ON CONFLICT (match_id) DO NOTHING`,
      [
        metadata.matchId,
        info.queueId ?? 0,
        info.gameStartTimestamp ?? info.gameCreation,
        info.gameDuration ?? 0,
        info.gameVersion ?? null,
        remake,
      ],
    );

    if (participants.length > 0) {
      const values = [];
      const params = [];
      participants.forEach((p, i) => {
        const o = i * 10;
        values.push(
          `($${o + 1}, $${o + 2}, $${o + 3}, $${o + 4}, $${o + 5}, $${o + 6}, $${o + 7}, $${o + 8}, $${o + 9}, $${o + 10})`,
        );
        params.push(
          metadata.matchId,
          p.puuid,
          p.championId,
          p.championName ?? null,
          p.teamPosition || null,
          Boolean(p.win),
          p.kills ?? 0,
          p.deaths ?? 0,
          p.assists ?? 0,
          (p.totalMinionsKilled ?? 0) + (p.neutralMinionsKilled ?? 0),
        );
      });
      await client.query(
        `INSERT INTO participants
           (match_id, puuid, champion_id, champion_name, team_position, win, kills, deaths, assists, cs)
         VALUES ${values.join(', ')}
         ON CONFLICT (match_id, puuid) DO NOTHING`,
        params,
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
