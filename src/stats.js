import { config } from './config.js';
import { pool } from './db.js';

export const ROLES = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];

const QUEUE_FILTERS = {
  ranked: [420, 440],
  solo: [420],
  flex: [440],
  all: null,
};

async function championsSince(puuid, since, queues, role) {
  const { rows } = await pool.query(
    `SELECT p.champion_id,
            max(p.champion_name)                 AS champion_name,
            count(*)::int                        AS games,
            count(*) FILTER (WHERE p.win)::int   AS wins,
            sum(p.kills)::int                    AS kills,
            sum(p.deaths)::int                   AS deaths,
            sum(p.assists)::int                  AS assists,
            max(m.game_start)                    AS last_played
       FROM participants p
       JOIN matches m USING (match_id)
      WHERE p.puuid = $1
        AND NOT m.remake
        AND m.game_start >= $2
        AND ($3::int[] IS NULL OR m.queue_id = ANY ($3))
        AND ($4::text IS NULL OR p.team_position = $4)
      GROUP BY p.champion_id
      ORDER BY games DESC, last_played DESC`,
    [puuid, since, queues, role],
  );
  return rows;
}

async function roleSplit(puuid, since, queues) {
  const { rows } = await pool.query(
    `SELECT coalesce(p.team_position, 'UNKNOWN') AS role, count(*)::int AS games
       FROM participants p
       JOIN matches m USING (match_id)
      WHERE p.puuid = $1
        AND NOT m.remake
        AND m.game_start >= $2
        AND ($3::int[] IS NULL OR m.queue_id = ANY ($3))
      GROUP BY 1
      ORDER BY games DESC`,
    [puuid, since, queues],
  );
  return rows;
}

async function recentGames(puuid, queues, role, limit) {
  const { rows } = await pool.query(
    `SELECT m.match_id, m.queue_id, m.game_start, m.duration_s,
            p.champion_id, p.champion_name, p.team_position, p.win,
            p.kills, p.deaths, p.assists, p.cs
       FROM participants p
       JOIN matches m USING (match_id)
      WHERE p.puuid = $1
        AND NOT m.remake
        AND ($2::int[] IS NULL OR m.queue_id = ANY ($2))
        AND ($3::text IS NULL OR p.team_position = $3)
      ORDER BY m.game_start DESC
      LIMIT $4`,
    [puuid, queues, role, limit],
  );
  return rows;
}

export async function playerStats(puuid, { role, queue }) {
  const queues = queue in QUEUE_FILTERS ? QUEUE_FILTERS[queue] : QUEUE_FILTERS.ranked;
  const position = ROLES.includes(role) ? role : null;
  const since30 = new Date(Date.now() - 30 * 24 * 3600 * 1000);

  const [season, last30, roles, recent] = await Promise.all([
    championsSince(puuid, config.seasonStart, queues, position),
    championsSince(puuid, since30, queues, position),
    roleSplit(puuid, config.seasonStart, queues),
    recentGames(puuid, queues, position, 15),
  ]);

  return { seasonStart: config.seasonStart, since30, season, last30, roles, recent };
}
