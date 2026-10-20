const ROLES = [
  { id: 'ALL', label: 'Tous' },
  { id: 'TOP', label: 'Top' },
  { id: 'JUNGLE', label: 'Jungle' },
  { id: 'MIDDLE', label: 'Mid' },
  { id: 'BOTTOM', label: 'ADC' },
  { id: 'UTILITY', label: 'Support' },
];
const ROLE_LABEL = Object.fromEntries(ROLES.map((r) => [r.id, r.label]));
ROLE_LABEL.UNKNOWN = 'Inconnu';

const QUEUES = [
  { id: 'ranked', label: 'Ranked' },
  { id: 'solo', label: 'Solo' },
  { id: 'flex', label: 'Flex' },
];
const QUEUE_LABEL = { 420: 'Solo', 440: 'Flex', 400: 'Normale', 430: 'Normale', 490: 'Rapide', 700: 'Clash', 0: 'Custom' };

const TIERS = {
  IRON: 'Fer', BRONZE: 'Bronze', SILVER: 'Argent', GOLD: 'Or', PLATINUM: 'Platine',
  EMERALD: 'Émeraude', DIAMOND: 'Diamant', MASTER: 'Maître', GRANDMASTER: 'Grand maître', CHALLENGER: 'Challenger',
};

const state = {
  player: null,
  role: 'ALL',
  queue: 'ranked',
  pollTimer: null,
  lastStatsAt: 0,
  ddragon: { version: null, champs: new Map() },
};

const $ = (id) => document.getElementById(id);
const nf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const rtf = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' });
const dateFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

/** Petit créateur d'éléments, pour ne jamais injecter de HTML brut. */
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') Object.assign(el.style, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

async function api(path, options) {
  const res = await fetch(path, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Erreur ${res.status}`);
  return body;
}

function showMessage(text) {
  const el = $('message');
  el.textContent = text ?? '';
  el.hidden = !text;
}

function relative(date) {
  const diff = (new Date(date).getTime() - Date.now()) / 1000;
  // En jours jusqu'à deux mois : plus précis que « le mois dernier » pour du scouting
  const units = [['year', 365 * 86400, 365 * 86400], ['month', 30 * 86400, 60 * 86400], ['day', 86400, 86400], ['hour', 3600, 3600], ['minute', 60, 60]];
  for (const [unit, size, threshold] of units) {
    if (Math.abs(diff) >= threshold) return rtf.format(Math.round(diff / size), unit);
  }
  return "à l'instant";
}

const pct = (n) => `${Math.round(n * 100)}\u202f%`;

// ---------- Data Dragon ----------

async function loadDDragon() {
  try {
    const versions = await (await fetch('https://ddragon.leagueoflegends.com/api/versions.json')).json();
    const version = versions[0];
    const data = await (await fetch(`https://ddragon.leagueoflegends.com/cdn/${version}/data/fr_FR/champion.json`)).json();
    state.ddragon.version = version;
    for (const c of Object.values(data.data)) {
      state.ddragon.champs.set(Number(c.key), { id: c.id, name: c.name });
    }
  } catch {
    // Sans Data Dragon, on affiche les noms bruts sans portraits.
  }
}

function champInfo(championId, fallbackName) {
  const c = state.ddragon.champs.get(championId);
  const id = c?.id ?? fallbackName;
  return {
    name: c?.name ?? fallbackName ?? `#${championId}`,
    icon: state.ddragon.version && id
      ? `https://ddragon.leagueoflegends.com/cdn/${state.ddragon.version}/img/champion/${id}.png`
      : null,
  };
}

function champIcon(championId, fallbackName, cls, size) {
  const { name, icon } = champInfo(championId, fallbackName);
  return icon
    ? h('img', { class: cls, src: icon, alt: name, width: size, height: size, loading: 'lazy' })
    : h('span', { class: cls, 'aria-hidden': 'true' });
}

// ---------- URL ----------

function syncUrl() {
  const params = new URLSearchParams();
  if (state.player) {
    params.set('id', `${state.player.gameName}#${state.player.tagLine}`);
    params.set('region', state.player.region);
  }
  if (state.role !== 'ALL') params.set('role', state.role);
  if (state.queue !== 'ranked') params.set('queue', state.queue);
  const qs = params.toString();
  history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
}

// ---------- Filtres ----------

function renderSegmented(container, items, current, onPick) {
  container.replaceChildren(
    ...items.map((item) =>
      h('button', {
        type: 'button',
        'aria-pressed': String(item.id === current),
        onclick: () => onPick(item.id),
      }, item.label),
    ),
  );
}

function renderFilters() {
  renderSegmented($('role-filter'), ROLES, state.role, (role) => {
    state.role = role;
    renderFilters();
    syncUrl();
    loadStats();
  });
  renderSegmented($('queue-filter'), state.queueOptions ?? QUEUES, state.queue, (queue) => {
    state.queue = queue;
    renderFilters();
    syncUrl();
    loadStats();
  });
}

// ---------- Joueur ----------

function renderPlayerHead() {
  const p = state.player;
  $('p-name').textContent = p.gameName;
  $('p-tag').textContent = `#${p.tagLine}`;

  const ranks = [];
  for (const [key, label] of [['solo', 'Solo'], ['flex', 'Flex']]) {
    const r = p.rank?.[key];
    if (!r) continue;
    const apex = ['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(r.tier);
    const tier = `${TIERS[r.tier] ?? r.tier}${apex ? '' : ` ${r.division}`}`;
    const total = r.wins + r.losses;
    ranks.push(
      h('span', {}, `${label} `, h('strong', {}, `${tier}, ${r.lp} LP`),
        total ? ` (${total} parties, ${pct(r.wins / total)})` : ''),
    );
  }
  if (ranks.length === 0 && p.rank) ranks.push(h('span', {}, 'Non classé cette saison'));
  $('p-ranks').replaceChildren(...ranks);

  const running = p.sync?.state === 'running';
  const btn = $('sync-btn');
  btn.disabled = running;
  btn.textContent = running ? 'Mise à jour…' : 'Mettre à jour';
  $('sync-info').textContent = p.lastSyncedAt ? `Mis à jour ${relative(p.lastSyncedAt)}` : 'Jamais mis à jour';
}

function renderProgress() {
  const job = state.player?.sync;
  const box = $('progress');
  if (!job || job.state === 'done') {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  if (job.state === 'error') {
    $('progress-text').textContent = `La mise à jour a échoué : ${job.error}`;
    $('progress-fill').style.width = '0';
    return;
  }
  if (job.phase === 'ids') {
    $('progress-text').textContent = 'Recherche des parties à récupérer…';
    $('progress-fill').style.width = '2%';
    return;
  }
  const { done, total } = job;
  let eta = '';
  if (done > 5 && done < total) {
    const elapsed = Date.now() - job.startedAt;
    const remainingMin = Math.ceil(((elapsed / done) * (total - done)) / 60000);
    eta = remainingMin <= 1 ? ', moins d’une minute restante' : `, environ ${remainingMin} min restantes`;
  }
  $('progress-text').textContent = total === 0
    ? 'Aucune nouvelle partie.'
    : `Récupération des parties : ${done} sur ${total}${eta}`;
  $('progress-fill').style.width = total ? `${(done / total) * 100}%` : '100%';
}

function renderRoleSplit(roles) {
  const container = $('role-split');
  const total = roles.reduce((s, r) => s + r.games, 0);
  if (!total) {
    container.replaceChildren();
    return;
  }
  container.replaceChildren(
    ...roles.map((r) => {
      const share = r.games / total;
      return h('div', {
        class: `role-seg${r.role === state.role ? ' is-selected' : ''}`,
        style: { flex: `${r.games} 1 0` },
        title: `${ROLE_LABEL[r.role] ?? r.role} : ${r.games} parties (${pct(share)})`,
      },
      share >= 0.07 ? [ROLE_LABEL[r.role] ?? r.role, h('span', { class: 'pct' }, pct(share))] : '');
    }),
  );
}

function summary(rows) {
  const games = rows.reduce((s, r) => s + r.games, 0);
  const wins = rows.reduce((s, r) => s + r.wins, 0);
  if (!games) return '';
  return `${games} partie${games > 1 ? 's' : ''}, ${pct(wins / games)} de victoires`;
}

function renderChampList(list, rows, { maxGames, seasonById } = {}) {
  if (rows.length === 0) {
    const where = state.role === 'ALL' ? '' : ` en ${ROLE_LABEL[state.role]}`;
    list.replaceChildren(h('li', { class: 'list-empty' }, `Aucune partie${where} sur cette période.`));
    return;
  }
  const max = maxGames ?? Math.max(...rows.map((r) => r.games));
  list.replaceChildren(
    ...rows.map((r) => {
      const { name } = champInfo(r.champion_id, r.champion_name);
      const wr = r.wins / r.games;
      const kda = (r.kills + r.assists) / Math.max(1, r.deaths);
      // « Nouveau » : aucune partie sur ce champion avant les 30 derniers jours
      const isNew = seasonById && r.games >= 2 && (seasonById.get(r.champion_id) ?? 0) <= r.games;
      return h('li', { class: 'champ-row' },
        champIcon(r.champion_id, r.champion_name, 'champ-icon', 40),
        h('div', { class: 'champ-main' },
          h('div', { class: 'champ-name' }, h('span', {}, name), isNew ? h('span', { class: 'badge-new' }, 'Nouveau') : null),
          h('div', { class: 'games-bar' },
            h('span', { class: 'bar', style: { width: `${Math.max(4, (r.games / max) * 120)}px` } }),
            h('span', {}, `dernière ${relative(r.last_played)}`)),
        ),
        h('div', { class: 'champ-games', title: 'Parties jouées' }, r.games),
        h('div', { class: 'champ-stats' },
          h('span', { class: `champ-wr ${r.games >= 3 ? (wr >= 0.55 ? 'wr-good' : wr < 0.45 ? 'wr-bad' : '') : ''}` }, pct(wr)),
          h('span', { class: 'champ-kda' }, `${nf.format(kda)} KDA`),
        ),
      );
    }),
  );
}

function renderGames(games) {
  const strip = $('games-strip');
  if (games.length === 0) {
    strip.replaceChildren(h('li', { class: 'list-empty' }, 'Aucune partie récente.'));
    return;
  }
  strip.replaceChildren(
    ...games.map((g) => {
      const { name } = champInfo(g.champion_id, g.champion_name);
      const title = `${name}, ${g.win ? 'victoire' : 'défaite'} ${g.kills}/${g.deaths}/${g.assists}, ${ROLE_LABEL[g.team_position] ?? '?'}, ${QUEUE_LABEL[g.queue_id] ?? g.queue_id}, ${relative(g.game_start)}`;
      return h('li', { class: `game${g.win ? ' is-win' : ''}`, title },
        champIcon(g.champion_id, g.champion_name, 'game-icon', 48),
        h('span', { class: 'kda' }, `${g.kills}/${g.deaths}/${g.assists}`),
      );
    }),
  );
}

async function loadStats() {
  if (!state.player) return;
  const { puuid } = state.player;
  const params = new URLSearchParams({ role: state.role, queue: state.queue });
  try {
    const stats = await api(`/api/players/${puuid}/stats?${params}`);
    if (state.player?.puuid !== puuid) return;
    state.lastStatsAt = state.player.sync?.done ?? 0;

    const seasonById = new Map(stats.season.map((r) => [r.champion_id, r.games]));
    renderRoleSplit(stats.roles);
    renderChampList($('season-list'), stats.season);
    renderChampList($('last30-list'), stats.last30, { seasonById });
    $('season-sub').textContent = [`depuis le ${dateFmt.format(new Date(stats.seasonStart))}`, summary(stats.season)].filter(Boolean).join(', ');
    $('last30-sub').textContent = summary(stats.last30);
    renderGames(stats.recent);
  } catch (err) {
    showMessage(err.message);
  }
}

// ---------- Synchro ----------

function stopPolling() {
  clearTimeout(state.pollTimer);
  state.pollTimer = null;
}

async function poll() {
  if (!state.player) return;
  const { puuid } = state.player;
  try {
    const fresh = await api(`/api/players/${puuid}`);
    if (state.player?.puuid !== puuid) return;
    state.player = fresh;
    renderPlayerHead();
    renderProgress();
    const job = fresh.sync;
    if (job?.state === 'running') {
      // Les parties arrivent des plus récentes aux plus anciennes : on rafraîchit au fil de l'eau
      if (job.done - state.lastStatsAt >= 25) loadStats();
      state.pollTimer = setTimeout(poll, 2000);
    } else {
      loadStats();
      loadRecent();
    }
  } catch (err) {
    showMessage(err.message);
    state.pollTimer = setTimeout(poll, 5000);
  }
}

async function startSync() {
  if (!state.player) return;
  try {
    state.player.sync = await api(`/api/players/${state.player.puuid}/sync`, { method: 'POST' });
    state.lastStatsAt = 0;
    renderPlayerHead();
    renderProgress();
    stopPolling();
    state.pollTimer = setTimeout(poll, 1000);
  } catch (err) {
    showMessage(err.message);
  }
}

// ---------- Recherche ----------

async function lookup(riotId, region) {
  showMessage(null);
  stopPolling();
  const btn = document.querySelector('#search-form button');
  btn.disabled = true;
  try {
    const player = await api(`/api/lookup?${new URLSearchParams({ riotId, region })}`);
    state.player = player;
    $('riot-id').value = `${player.gameName}#${player.tagLine}`;
    $('region').value = player.region;
    $('empty-state').hidden = true;
    $('player').hidden = false;
    renderPlayerHead();
    renderProgress();
    renderFilters();
    syncUrl();
    loadStats();
    loadRecent();

    if (player.sync?.state === 'running') {
      state.pollTimer = setTimeout(poll, 1000);
    } else if (!player.lastSyncedAt) {
      startSync();
    }
  } catch (err) {
    showMessage(err.message);
  } finally {
    btn.disabled = false;
  }
}

async function loadRecent() {
  try {
    const players = await api('/api/players');
    $('recent').replaceChildren(
      ...players
        .filter((p) => p.puuid !== state.player?.puuid)
        .slice(0, 10)
        .map((p) =>
          h('button', { type: 'button', onclick: () => lookup(`${p.gameName}#${p.tagLine}`, p.region) },
            `${p.gameName}#${p.tagLine}`),
        ),
    );
  } catch {
    // liste facultative
  }
}

// ---------- Démarrage ----------

async function init() {
  const [meta] = await Promise.all([api('/api/meta').catch(() => null), loadDDragon()]);
  const regions = meta?.regions ?? [{ id: 'euw', label: 'EUW' }];
  $('region').replaceChildren(...regions.map((r) => h('option', { value: r.id }, r.label)));
  if (meta?.matchTypes?.some((t) => t !== 'ranked')) {
    state.queueOptions = [...QUEUES, { id: 'all', label: 'Tout' }];
  }

  $('search-form').addEventListener('submit', (e) => {
    e.preventDefault();
    lookup($('riot-id').value, $('region').value);
  });
  $('sync-btn').addEventListener('click', startSync);

  const params = new URLSearchParams(location.search);
  if (ROLE_LABEL[params.get('role')]) state.role = params.get('role');
  if (params.get('queue')) state.queue = params.get('queue');
  renderFilters();

  if (params.get('id')) {
    lookup(params.get('id'), params.get('region') ?? 'euw');
  } else {
    loadRecent();
  }
}

init();
