import { config } from './config.js';
import { REGIONS } from './regions.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fenêtres glissantes, file FIFO : les appels attendent leur tour
 * plutôt que de se prendre des 429.
 */
class RateLimiter {
  constructor(limits) {
    this.limits = limits;
    this.maxWindow = Math.max(...limits.map((l) => l.windowMs));
    this.stamps = [];
    this.pausedUntil = 0;
    this.queue = Promise.resolve();
  }

  acquire() {
    const turn = this.queue.then(() => this.#waitForSlot());
    this.queue = turn.catch(() => {});
    return turn;
  }

  pause(ms) {
    this.pausedUntil = Math.max(this.pausedUntil, Date.now() + ms);
  }

  async #waitForSlot() {
    for (;;) {
      const now = Date.now();
      this.stamps = this.stamps.filter((t) => now - t < this.maxWindow);
      let wait = this.pausedUntil - now;
      for (const { count, windowMs } of this.limits) {
        const recent = this.stamps.filter((t) => now - t < windowMs);
        if (recent.length >= count) {
          wait = Math.max(wait, recent[recent.length - count] + windowMs - now);
        }
      }
      if (wait <= 0) {
        this.stamps.push(now);
        return;
      }
      await sleep(wait + 25);
    }
  }
}

// Les limites Riot s'appliquent par région de routage (europe, euw1…)
const limiters = new Map();
function limiterFor(host) {
  if (!limiters.has(host)) limiters.set(host, new RateLimiter(config.rateLimits));
  return limiters.get(host);
}

export class RiotError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function riotGet(host, path, query = {}) {
  const base = config.riotBaseOverride
    ? `${config.riotBaseOverride}/${host}`
    : `https://${host}.api.riotgames.com`;
  const params = Object.entries(query).filter(([, v]) => v !== undefined && v !== null);
  const qs = new URLSearchParams(params).toString();
  const url = `${base}${path}${qs ? `?${qs}` : ''}`;
  const limiter = limiterFor(host);

  for (let attempt = 0; ; attempt++) {
    await limiter.acquire();
    let res;
    try {
      res = await fetch(url, {
        headers: { 'X-Riot-Token': config.riotApiKey },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      if (attempt < 3) {
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      throw new RiotError(0, `API Riot injoignable : ${err.message}`);
    }

    if (res.ok) return res.json();
    if (res.status === 404) return null;
    if (res.status === 429 && attempt < 5) {
      const retryAfter = Number(res.headers.get('retry-after')) || 10;
      console.warn(`[riot] 429 sur ${host}, pause de ${retryAfter} s`);
      limiter.pause(retryAfter * 1000);
      continue;
    }
    if (res.status >= 500 && attempt < 3) {
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    if (res.status === 401 || res.status === 403) {
      throw new RiotError(res.status, 'Riot API key rejected: it has expired or is invalid.');
    }
    throw new RiotError(res.status, `Riot API error ${res.status} on ${path}`);
  }
}

const enc = encodeURIComponent;

export const riot = {
  accountByRiotId: (region, gameName, tagLine) =>
    riotGet(
      REGIONS[region].account,
      `/riot/account/v1/accounts/by-riot-id/${enc(gameName)}/${enc(tagLine)}`,
    ),

  accountByPuuid: (region, puuid) =>
    riotGet(REGIONS[region].account, `/riot/account/v1/accounts/by-puuid/${enc(puuid)}`),

  matchIds: (region, puuid, params) =>
    riotGet(REGIONS[region].routing, `/lol/match/v5/matches/by-puuid/${enc(puuid)}/ids`, params),

  match: (region, matchId) =>
    riotGet(REGIONS[region].routing, `/lol/match/v5/matches/${enc(matchId)}`),

  leagueEntries: (region, puuid) =>
    riotGet(REGIONS[region].platform, `/lol/league/v4/entries/by-puuid/${enc(puuid)}`),
};
