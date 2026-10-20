import { config } from './config.js';
import * as db from './db.js';
import { riot } from './riot.js';

// Une synchro par joueur à la fois, gardée en mémoire 10 min après la fin.
const jobs = new Map();

export function getJob(puuid) {
  return jobs.get(puuid) ?? null;
}

export function startSync(player) {
  const existing = jobs.get(player.puuid);
  if (existing?.state === 'running') return existing;

  const job = { state: 'running', phase: 'ids', total: 0, done: 0, startedAt: Date.now(), error: null };
  jobs.set(player.puuid, job);

  runSync(player, job)
    .then(() => {
      job.state = 'done';
    })
    .catch((err) => {
      job.state = 'error';
      job.error = err.message;
      console.error(`[sync] ${player.game_name}#${player.tag_line} :`, err);
    })
    .finally(() => {
      job.finishedAt = Date.now();
      setTimeout(() => {
        if (jobs.get(player.puuid) === job) jobs.delete(player.puuid);
      }, 10 * 60 * 1000).unref();
    });

  return job;
}

function simplifyRank(entries) {
  const pick = (queueType) => {
    const e = entries.find((x) => x.queueType === queueType);
    return e ? { tier: e.tier, division: e.rank, lp: e.leaguePoints, wins: e.wins, losses: e.losses } : null;
  };
  return { solo: pick('RANKED_SOLO_5x5'), flex: pick('RANKED_FLEX_SR') };
}

// "EUW1_7234567890" -> 7234567890 : croissant dans le temps pour une plateforme
const matchNumber = (id) => Number(id.split('_')[1] ?? 0);

async function runSync(player, job) {
  const { puuid, region } = player;
  const startedAt = Date.now();

  // Pseudo à jour (les Riot ID changent) et rang : non bloquants
  try {
    const account = await riot.accountByPuuid(region, puuid);
    if (account?.gameName) await db.updateRiotId(puuid, account.gameName, account.tagLine);
  } catch (err) {
    console.warn('[sync] compte non rafraîchi :', err.message);
  }
  try {
    const entries = await riot.leagueEntries(region, puuid);
    if (Array.isArray(entries)) await db.setRank(puuid, simplifyRank(entries));
  } catch (err) {
    console.warn('[sync] rang non rafraîchi :', err.message);
  }

  const since =
    player.synced_until && player.synced_until > config.seasonStart
      ? player.synced_until
      : config.seasonStart;
  const startTime = Math.floor(since.getTime() / 1000);

  const ids = new Set();
  for (const type of config.matchTypes) {
    for (let start = 0; ; start += 100) {
      const page = (await riot.matchIds(region, puuid, { startTime, type, start, count: 100 })) ?? [];
      page.forEach((id) => ids.add(id));
      if (page.length < 100) break;
    }
  }

  // Plus récentes d'abord : les 30 derniers jours se remplissent en premier
  const sorted = [...ids].sort((a, b) => matchNumber(b) - matchNumber(a));
  const missing = await db.missingMatchIds(sorted);

  job.phase = 'matches';
  job.total = missing.length;

  for (const matchId of missing) {
    const match = await riot.match(region, matchId);
    if (match?.info) await db.saveMatch(match);
    job.done++;
  }

  // Marge de 2 h : une partie en cours au moment de la synchro sera
  // reprise la fois suivante (les IDs déjà en base sont ignorés).
  await db.markSynced(puuid, new Date(startedAt - 2 * 3600 * 1000));
}
