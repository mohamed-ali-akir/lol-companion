/*
 * Mode Deadlock : lecture de deadlock-api.com (27/10/2026)
 * ---------------------------------------------------------
 * Tourne dans le processus principal (Node). SEULE porte de l'appli vers https://api.deadlock-api.com (exception
 * Internet décidée par le propriétaire le 27/10/2026, CLAUDE.md). Mêmes règles que les autres sites (internet.js) :
 * User-Agent honnête, cache, délai maximal, certificats vérifiés normalement, messages d'erreur clairs.
 *
 * Pourquoi ce site : Deadlock n'a pas d'API officielle. deadlock-api.com est l'API gratuite de la communauté (code
 * ouvert, licence MIT, github.com/deadlock-api/deadlock-api), sans clé, prévue pour les applis (documentation
 * https://api.deadlock-api.com/docs). Elle n'est pas liée à Valve. Limites annoncées : 100 demandes/s par adresse IP,
 * 200/min pour les statistiques (« analytics ») : l'appli en fait quelques-unes par heure grâce au cache.
 *
 * Ce qui est envoyé (accord du propriétaire, 27/10/2026) :
 *  - ton numéro de compte Steam (public), pour TON historique et TES stats ;
 *  - seulement si la case « Envoyer mes parties » est cochée : les numéros et clés des parties trouvées dans le cache
 *    de Steam (deadlock-jeu.js), comme l'outil officiel du site, sans le nom d'utilisateur ni rien d'autre ;
 *  - pour les stats générales : le héros, la période, le niveau choisi. Jamais le pseudo, ni rien d'autre du PC.
 */
const { creerCache, telecharger } = require("./internet.js");
const S = require("./deadlock-stats.js");

const URL_API = "https://api.deadlock-api.com";
const SITE = "deadlock-api.com";
const DUREE_JOUEUR_MS = 5 * 60 * 1000; // ton historique change après chaque partie : 5 minutes de cache seulement
const JOURS_TIER_LISTE = 14; // « héros du moment » : les 2 dernières semaines (un patch tous les 15 jours environ)
const JOURS_BUILD = 30; // build et contres : 30 jours, pour avoir assez de parties sur chaque objet
const CLES_PAR_ENVOI = 1000; // même limite que l'outil du site
const JOUR_S = 24 * 60 * 60;

class ErreurDeadlockApi extends Error {}

/** Début de la période : il y a `jours` jours, arrondi au début du jour (UTC) pour que le cache serve toute la journée. */
const depuis = (jours, maintenant) => Math.floor(maintenant / 1000 / JOUR_S) * JOUR_S - jours * JOUR_S;

/** Numéro de compte Steam valide (entier positif sur 32 bits), sinon erreur claire. */
function numeroCompte(accountId) {
  if (!Number.isInteger(accountId) || accountId <= 0 || accountId >= 2 ** 32) throw new ErreurDeadlockApi("Compte Steam introuvable sur ce PC.");
  return accountId;
}

function numeroHeros(heroId) {
  if (!Number.isInteger(heroId) || heroId <= 0 || heroId > 10000) throw new ErreurDeadlockApi("Héros inconnu.");
  return heroId;
}

/** Adresse de l'API avec ses paramètres (les valeurs null ou undefined sont omises). */
function adresse(chemin, parametres = {}) {
  const url = new URL(chemin, URL_API);
  for (const [cle, valeur] of Object.entries(parametres)) if (valeur !== null && valeur !== undefined) url.searchParams.set(cle, String(valeur));
  return url.toString();
}

/**
 * Lecteur de deadlock-api.com. appeler (fetch) et maintenant sont modifiables pour les tests.
 * Toutes les fonctions renvoient des données déjà lues et vérifiées (deadlock-stats.js), jamais la réponse brute.
 */
function creerLecteurDeadlock({ appeler = (...a) => fetch(...a), maintenant = Date.now } = {}) {
  const general = creerCache({ maintenant }); // 3 h : héros, objets, stats de tout le monde
  const joueur = creerCache({ dureeMs: DUREE_JOUEUR_MS, maintenant }); // 5 min : ton historique

  async function lireJson(url, cache) {
    return cache.avecCache(url, async () => {
      const texte = await telecharger({ appeler, adresse: url, options: { headers: { Accept: "application/json" } }, site: SITE, Erreur: ErreurDeadlockApi });
      try {
        return JSON.parse(texte);
      } catch {
        throw new ErreurDeadlockApi(`${SITE} a renvoyé une réponse illisible.`);
      }
    });
  }

  const heros = async () => S.normaliserHeros(await lireJson(adresse("/v1/assets/heroes"), general));
  const objets = async () => S.normaliserObjets(await lireJson(adresse("/v1/assets/items"), general));
  const rangs = async () => S.normaliserRangs(await lireJson(adresse("/v1/assets/ranks"), general));

  /** Ton historique : parties lisibles (deadlock-stats.js), de la plus récente à la plus ancienne. */
  const historique = async (accountId) => S.partiesDepuisApi(await lireJson(adresse(`/v1/players/${numeroCompte(accountId)}/match-history`), joueur));

  /** Tes stats par héros (données brutes vérifiées ensuite par mesStatsParHeros). */
  const mesStatsHeros = async (accountId) => lireJson(adresse("/v1/players/hero-stats", { account_ids: numeroCompte(accountId) }), joueur);

  /** Stats de tous les héros sur les 2 dernières semaines (rang : 0 à 11, filtre de niveau ; null = tous). */
  const statsHeros = async ({ rang = null } = {}) =>
    lireJson(adresse("/v1/analytics/hero-stats", { min_unix_timestamp: depuis(JOURS_TIER_LISTE, maintenant()), min_average_badge: S.badgeMinimal(rang) }), general);

  /** Stats des objets d'un héros sur 30 jours. */
  const statsObjets = async (heroId, { rang = null } = {}) =>
    lireJson(adresse("/v1/analytics/item-stats", { hero_id: numeroHeros(heroId), min_unix_timestamp: depuis(JOURS_BUILD, maintenant()), min_average_badge: S.badgeMinimal(rang) }), general);

  /** Duels entre héros sur 30 jours (une seule lecture pour tous les héros, gardée 3 h). */
  const duels = async ({ rang = null } = {}) =>
    lireJson(adresse("/v1/analytics/hero-counter-stats", { min_unix_timestamp: depuis(JOURS_BUILD, maintenant()), min_average_badge: S.badgeMinimal(rang) }), general);

  /** Parties sur la période du build (pour la part des achats de chaque objet). */
  const statsHerosBuild = async ({ rang = null } = {}) =>
    lireJson(adresse("/v1/analytics/hero-stats", { min_unix_timestamp: depuis(JOURS_BUILD, maintenant()), min_average_badge: S.badgeMinimal(rang) }), general);

  /**
   * Envoie les parties trouvées dans le cache de Steam ([{ match_id, cluster_id, metadata_salt?, replay_salt? }]) :
   * POST /v1/matches/salts, par paquets de 1 000. Renvoie le nombre envoyé. Jamais mis en cache.
   */
  async function envoyerParties(cles) {
    const valides = (Array.isArray(cles) ? cles : []).filter((c) => c && Number.isSafeInteger(c.match_id) && Number.isSafeInteger(c.cluster_id));
    for (let i = 0; i < valides.length; i += CLES_PAR_ENVOI) {
      const paquet = valides.slice(i, i + CLES_PAR_ENVOI).map((c) => ({
        match_id: c.match_id,
        cluster_id: c.cluster_id,
        metadata_salt: Number.isSafeInteger(c.metadata_salt) ? c.metadata_salt : null,
        replay_salt: Number.isSafeInteger(c.replay_salt) ? c.replay_salt : null,
      }));
      await telecharger({
        appeler,
        adresse: adresse("/v1/matches/salts"),
        options: { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(paquet) },
        site: SITE,
        Erreur: ErreurDeadlockApi,
      });
    }
    return valides.length;
  }

  return { heros, objets, rangs, historique, mesStatsHeros, statsHeros, statsObjets, statsHerosBuild, duels, envoyerParties };
}

module.exports = { URL_API, SITE, JOURS_TIER_LISTE, JOURS_BUILD, ErreurDeadlockApi, depuis, adresse, creerLecteurDeadlock };
