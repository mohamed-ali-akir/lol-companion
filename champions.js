/*
 * Noms et icônes des champions, lus dans le client
 * ------------------------------------------------
 * Tourne dans le processus principal (Node). Lecture seule. Utilisé par plusieurs onglets (Stats, Maîtrise,
 * Sélection, Build) et par la fenêtre transparente du jeu (icônes du panneau des sorts).
 * (Ces fonctions étaient dans classee.js, supprimé avec l'onglet Classée le 17/10/2026.)
 *
 * Routes du client :
 *  - /lol-game-data/assets/v1/champion-summary.json : noms de TOUS les champions (id, name) ;
 *  - /lol-game-data/assets/v1/champion-icons/<id>.png : icône d'un champion ;
 *  - /lol-game-data/assets/v1/champions/<id>.json : fiche d'un champion (résistance, contrôles, type de dégâts),
 *    pour adapter le build à l'équipe adverse (adversaires.js, 26/10/2026).
 */
const { lireLockfile, lireJsonOuNull, appelerClient } = require("./lcu.js");
const { profilChampion } = require("./adversaires.js");

const ROUTE_RESUME = "/lol-game-data/assets/v1/champion-summary.json";

/** Noms de tous les champions (Map id -> nom), depuis les fichiers du jeu. Map vide si indisponible. */
async function lireNomsChampions(dossierJeu) {
  const resume = await lireJsonOuNull(lireLockfile(dossierJeu), ROUTE_RESUME);
  const noms = new Map();
  if (Array.isArray(resume)) {
    for (const c of resume) if (c && Number.isInteger(c.id) && c.id > 0 && typeof c.name === "string") noms.set(c.id, c.name);
  }
  return noms;
}

/**
 * Profils des champions (adversaires.js) : [{ id, nom, resistance, controle, degats }], une fiche lue une seule fois
 * (gardée en mémoire : elle ne change qu'avec un patch). Une fiche illisible est simplement absente de la liste.
 */
function creerLecteurProfils(lireFiche) {
  const cache = new Map();
  return async function profils(ids) {
    const liste = [];
    for (const id of Array.isArray(ids) ? ids : []) {
      if (!cache.has(id)) {
        const profil = profilChampion(await lireFiche(id).catch(() => null));
        if (profil) cache.set(id, profil);
      }
      if (cache.has(id)) liste.push(cache.get(id));
    }
    return liste;
  };
}

/** Fiche d'un champion dans les fichiers du jeu, ou null. */
async function lireFicheChampion(dossierJeu, id) {
  return Number.isInteger(id) && id > 0 ? lireJsonOuNull(lireLockfile(dossierJeu), `/lol-game-data/assets/v1/champions/${id}.json`) : null;
}

// --- Icônes des champions ------------------------------------------------------------

// Protocole maison pour afficher les icônes dans la page : <img src="lcu-image://champion/266">.
// La page n'a pas le mot de passe du client : c'est main.js qui va chercher l'image.
const PROTOCOLE_ICONES = "lcu-image";

/**
 * Traduit une adresse lcu-image://champion/266 en route du client.
 * Seules les icônes de champions sont autorisées : la page ne peut PAS s'en servir
 * pour appeler n'importe quelle route du client.
 */
function routeIcone(adresse) {
  let url;
  try {
    url = new URL(adresse);
  } catch {
    return null;
  }
  if (url.protocol !== `${PROTOCOLE_ICONES}:` || url.hostname !== "champion") return null;
  const id = /^\/(\d{1,6})\/?$/.exec(url.pathname);
  return id ? `/lol-game-data/assets/v1/champion-icons/${Number(id[1])}.png` : null;
}

/**
 * Cache des icônes en mémoire (une icône n'est demandée qu'une fois au client).
 * charger(route) -> { octets, type } ; max = nombre d'icônes gardées.
 */
function creerCacheIcones(charger, max = 400) {
  const cache = new Map();
  return async function obtenir(route) {
    if (cache.has(route)) return cache.get(route);
    const image = await charger(route);
    if (image) {
      if (cache.size >= max) cache.delete(cache.keys().next().value); // on oublie la plus ancienne
      cache.set(route, image);
    }
    return image;
  };
}

/** Va chercher une image dans le client. null si elle n'existe pas. */
async function chargerImageClient(dossierJeu, route) {
  const connexion = lireLockfile(dossierJeu);
  const { status, brut, type } = await appelerClient(connexion, route);
  if (status !== 200 || brut.length === 0) return null;
  return { octets: brut, type: type.startsWith("image/") ? type : "image/png" };
}

module.exports = {
  PROTOCOLE_ICONES,
  lireNomsChampions,
  creerLecteurProfils,
  lireFicheChampion,
  routeIcone,
  creerCacheIcones,
  chargerImageClient,
};
