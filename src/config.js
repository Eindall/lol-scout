function required(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Variable d'environnement manquante : ${name}`);
    process.exit(1);
  }
  return value;
}

// "19:1,95:120" -> 19 requêtes / 1 s et 95 requêtes / 120 s
function parseLimits(str) {
  return str.split(',').map((part) => {
    const [count, seconds] = part.split(':').map(Number);
    if (!count || !seconds) throw new Error(`RIOT_RATE_LIMITS invalide : ${str}`);
    return { count, windowMs: seconds * 1000 };
  });
}

const seasonStart = new Date(process.env.SEASON_START ?? '2026-01-08T00:00:00Z');
if (Number.isNaN(seasonStart.getTime())) {
  console.error(`SEASON_START invalide : ${process.env.SEASON_START}`);
  process.exit(1);
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  riotApiKey: required('RIOT_API_KEY'),
  databaseUrl: required('DATABASE_URL'),
  seasonStart,
  // Types Riot : ranked, normal, tourney (clash / codes de tournoi)
  matchTypes: (process.env.MATCH_TYPES ?? 'ranked')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  // Un peu sous la limite d'une clé perso (20/1 s, 100/2 min) pour garder de la marge
  rateLimits: parseLimits(process.env.RIOT_RATE_LIMITS ?? '19:1,95:120'),
  // Uniquement pour les tests avec un faux serveur Riot
  riotBaseOverride: process.env.RIOT_BASE_OVERRIDE || null,
};
