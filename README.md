# Scout LoL

Petit outil de scouting : un Riot ID, une région, un rôle, et il sort les champions joués sur la saison et sur les 30 derniers jours, avec la répartition des rôles et les dernières parties.

Node + Express + Postgres, une page web sans framework.

## Fonctionnement

La première recherche d'un joueur récupère tout son historique de ranked depuis `SEASON_START`. Ensuite, le bouton « Mettre à jour » ne va chercher que les parties jouées depuis la dernière mise à jour.

Chaque partie téléchargée est stockée avec ses 10 joueurs. Si tu scoutes une équipe qui joue en flex à 5, les parties communes ne sont téléchargées qu'une fois.

Avec une clé perso (100 requêtes / 2 min), compte environ 1 minute par tranche de 50 parties lors du premier scan. Les parties arrivent des plus récentes aux plus anciennes, donc les 30 derniers jours s'affichent vite et la saison se complète au fil de l'eau.

Les remakes sont exclus. Le rôle utilisé est le `teamPosition` de Riot, c'est-à-dire le rôle réellement joué dans la partie.

## Installation sur le VPS

### 1. Base de données

Dans ton conteneur Postgres existant :

```bash
docker exec -it <conteneur-postgres> psql -U <admin>
```

```sql
CREATE USER scout WITH PASSWORD 'un-mot-de-passe';
CREATE DATABASE scout OWNER scout;
```

Les tables sont créées automatiquement au démarrage de l'appli.

### 2. Code et configuration

```bash
mkdir -p ~/stacks/lol-scout && cd ~/stacks/lol-scout
# copie le contenu du dossier ici
cp .env.example .env
nano .env
```

Dans `.env` :

- `RIOT_API_KEY` : ta clé Riot. Celle de dev expire toutes les 24 h ; pour un usage durable, enregistre un produit « Personal API Key » sur developer.riotgames.com.
- `DATABASE_URL` : l'hôte est le nom du conteneur Postgres.
- `SEASON_START` : date de début de la période « Saison ». Mets le début de saison ou de split qui t'intéresse.
- `MATCH_TYPES` : `ranked` par défaut. Ajoute `normal` ou `tourney` (Clash, codes de tournoi) si besoin, au prix de plus de requêtes ; un filtre « Tout » apparaît alors dans la page.

### 3. Réseau Docker

Dans `compose.yml`, remplace `proxy` par le nom du réseau partagé avec Caddy. Si Postgres n'est pas sur ce réseau, décommente le second réseau et mets le sien.

```bash
docker compose up -d --build
docker compose logs -f
```

Tu dois voir `lol-scout prêt sur le port 3000`.

### 4. Caddy

La clé perso de Riot est réservée à un usage privé, donc la page reste derrière un mot de passe partagé avec l'équipe.

```bash
docker exec -it caddy caddy hash-password --plaintext 'mot-de-passe-equipe'
```

Dans le Caddyfile :

```
scout.tongcho7.com {
	basic_auth {
		singe <hash-obtenu>
	}
	reverse_proxy lol-scout:3000
}
```

Puis recharge Caddy et ajoute l'entrée DNS sur Cloudflare comme pour tes autres sous-domaines.

## Changer de clé Riot

Modifie `.env`, puis :

```bash
docker compose up -d
```

## Partager un scouting

L'URL reprend le joueur, la région, le rôle et la file, par exemple :

```
https://scout.tongcho7.com/?id=Hizue%23wah&region=euw&role=MIDDLE
```

## API

| Route | Rôle |
| --- | --- |
| `GET /api/lookup?riotId=Pseudo%23TAG&region=euw` | Trouve ou crée le joueur |
| `POST /api/players/:puuid/sync` | Lance une mise à jour (incrémentale) |
| `GET /api/players/:puuid` | Joueur et avancement de la mise à jour |
| `GET /api/players/:puuid/stats?role=JUNGLE&queue=ranked` | Champions saison / 30 jours, rôles, dernières parties |
| `GET /api/players` | Joueurs consultés récemment |

Rôles : `ALL`, `TOP`, `JUNGLE`, `MIDDLE`, `BOTTOM`, `UTILITY`. Files : `ranked`, `solo`, `flex`, `all`.
