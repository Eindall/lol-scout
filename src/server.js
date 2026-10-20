import express from 'express';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import * as db from './db.js';
import { REGIONS } from './regions.js';
import { RiotError, riot } from './riot.js';
import { playerStats } from './stats.js';
import { getJob, startSync } from './sync.js';

const app = express();
app.disable('x-powered-by');
app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))));

const PUUID_RE = /^[\w-]{20,100}$/;

function serializePlayer(p) {
  return {
    puuid: p.puuid,
    gameName: p.game_name,
    tagLine: p.tag_line,
    region: p.region,
    rank: p.rank,
    lastSyncedAt: p.last_synced_at,
    sync: getJob(p.puuid),
  };
}

async function loadPlayer(req, res) {
  const { puuid } = req.params;
  if (!PUUID_RE.test(puuid)) {
    res.status(400).json({ error: 'Identifiant de joueur invalide.' });
    return null;
  }
  const player = await db.getPlayer(puuid);
  if (!player) res.status(404).json({ error: 'Joueur inconnu, relance une recherche.' });
  return player;
}

app.get('/api/meta', (req, res) => {
  res.json({
    regions: Object.entries(REGIONS).map(([id, r]) => ({ id, label: r.label })),
    seasonStart: config.seasonStart,
    matchTypes: config.matchTypes,
  });
});

app.get('/api/players', async (req, res) => {
  const rows = await db.recentPlayers(12);
  res.json(
    rows.map((p) => ({
      puuid: p.puuid,
      gameName: p.game_name,
      tagLine: p.tag_line,
      region: p.region,
      lastSyncedAt: p.last_synced_at,
    })),
  );
});

app.get('/api/lookup', async (req, res) => {
  const riotId = String(req.query.riotId ?? '').trim();
  const region = String(req.query.region ?? 'euw');
  if (!REGIONS[region]) return res.status(400).json({ error: 'Région inconnue.' });

  const hash = riotId.lastIndexOf('#');
  const gameName = riotId.slice(0, hash).trim();
  const tagLine = riotId.slice(hash + 1).trim();
  if (hash < 0 || !gameName || !tagLine) {
    return res.status(400).json({ error: 'Écris le Riot ID au format Pseudo#TAG.' });
  }

  let player = await db.findPlayerByRiotId(region, gameName, tagLine);
  if (player) {
    await db.touchPlayer(player.puuid);
  } else {
    const account = await riot.accountByRiotId(region, gameName, tagLine);
    if (!account) {
      return res.status(404).json({ error: `Aucun compte ${gameName}#${tagLine} sur ${REGIONS[region].label}.` });
    }
    player = await db.upsertPlayer({
      puuid: account.puuid,
      gameName: account.gameName ?? gameName,
      tagLine: account.tagLine ?? tagLine,
      region,
    });
  }
  res.json(serializePlayer(player));
});

app.get('/api/players/:puuid', async (req, res) => {
  const player = await loadPlayer(req, res);
  if (player) res.json(serializePlayer(player));
});

app.post('/api/players/:puuid/sync', async (req, res) => {
  const player = await loadPlayer(req, res);
  if (!player) return;
  res.status(202).json(startSync(player));
});

app.get('/api/players/:puuid/stats', async (req, res) => {
  const player = await loadPlayer(req, res);
  if (!player) return;
  const stats = await playerStats(player.puuid, {
    role: String(req.query.role ?? 'ALL'),
    queue: String(req.query.queue ?? 'ranked'),
  });
  res.json(stats);
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Route inconnue.' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof RiotError) {
    return res.status(502).json({ error: err.message });
  }
  console.error(err);
  res.status(500).json({ error: 'Erreur interne, regarde les logs du conteneur.' });
});

await db.migrate();
const server = app.listen(config.port, () => {
  console.log(`lol-scout prêt sur le port ${config.port} (saison depuis ${config.seasonStart.toISOString().slice(0, 10)})`);
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    server.close(() => db.pool.end().then(() => process.exit(0)));
  });
}
