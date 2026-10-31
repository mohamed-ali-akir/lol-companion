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
 *  - automatiquement (sans case depuis la 1.5.1, décision du 27/10/2026) : les numéros et clés des parties trouvées dans le cache
 *    de Steam (deadlock-jeu.js), comme l'outil officiel du site, sans le nom d'utilisateur ni rien d'autre ;
 *  - pour les stats générales : le héros, la période, le niveau choisi. Jamais le pseudo, ni rien d'autre du PC.
 */
const { creerCache, telecharger } = require("./internet.js");
const S = require("./deadlock-stats.js");

const URL_API = "https://api.deadlock-api.com";
const SITE = "deadlock-api.com";
const DUREE_JOUEUR_MS = 5 * 60 * 1000;
const DUREE_DIRECT_MS = 20 * 1000; // ta partie en direct : relue au plus toutes les 20 s // ton historique change après chaque partie : 5 minutes de cache seulement
const JOURS_TIER_LISTE = 14; // « héros du moment » : les 2 dernières semaines (un patch tous les 15 jours environ)
const JOURS_BUILD = 30; // build et contres : 30 jours, pour avoir assez de parties sur chaque objet
const CLES_PAR_ENVOI = 1000; // même limite que l'outil du site
const JOUR_S = 24 * 60 * 60;
// Réponses lentes (31/10/2026) : les stats d'objets de tous les héros, pas encore calculées par le site, ont mis 19 s ;
// le détail d'une partie pèse environ 1 Mo. Ces lectures ont donc droit à 45 s au lieu de 20.
const DELAI_LENT_MS = 45 * 1000;
const JOURS_AVANT_PATCH = 14; // « avant la mise à jour » : les 2 semaines qui la précèdent

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

  const parties = creerCache({ maintenant }); // 3 h : détail des parties ouvertes (déjà réduit à l'essentiel)
  const direct = creerCache({ dureeMs: DUREE_DIRECT_MS, maintenant }); // 20 s : ta partie en cours

  /**
   * Lit une adresse (JSON), avec cache. transformer : réduit la réponse AVANT de la garder (détail d'une partie :
   * 1 Mo -> quelques Ko) ; delaiMs et introuvable : voir telecharger (internet.js).
   */
  async function lireJson(url, cache, { transformer = (x) => x, delaiMs, introuvable = null } = {}) {
    return cache.avecCache(url, async () => {
      const texte = await telecharger({
        appeler, adresse: url, options: { headers: { Accept: "application/json" } }, site: SITE, Erreur: ErreurDeadlockApi, delaiMs, introuvable,
      });
      let json;
      try {
        json = JSON.parse(texte);
      } catch {
        throw new ErreurDeadlockApi(`${SITE} a renvoyé une réponse illisible.`);
      }
      return transformer(json);
    });
  }

  const heros = async () => S.normaliserHeros(await lireJson(adresse("/v1/assets/heroes"), general));
  /** Tous les héros, même en développement (noms des joueurs d'une partie). Même lecture que heros, gardée en cache. */
  const nomsHeros = async () => S.normaliserHeros(await lireJson(adresse("/v1/assets/heroes"), general), { tous: true });
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

  /** Profil de chaque héros (dégâts d'esprit ou de balles, tank, soins, contrôles) : profilsHeros de deadlock-stats.js. */
  const profils = async () => {
    const [herosBrut, stats] = await Promise.all([lireJson(adresse("/v1/assets/heroes"), general), statsHeros()]);
    return S.profilsHeros(herosBrut, stats);
  };

  /** Familles des objets d'après leurs effets (résistance à l'esprit, anti-soin...) : famillesObjets de deadlock-stats.js. */
  const familles = async () => S.famillesObjets(await lireJson(adresse("/v1/assets/items"), general));

  /**
   * Ta partie en cours (partieEnCours de deadlock-stats.js), ou null. Seulement les parties de l'onglet « Regarder » du
   * jeu (les 200 mieux classées) : pour les autres, la page fait choisir les héros adverses à la main.
   */
  const partieEnCours = async (accountId) =>
    S.partieEnCours(await lireJson(adresse("/v1/matches/active", { account_id: numeroCompte(accountId) }), direct), accountId);

  /** Date de la dernière grosse mise à jour (millisecondes), ou null. */
  const dernierGrosPatch = async () => S.dernierGrosPatch(await lireJson(adresse("/v1/patches/big-days"), general), maintenant());

  /**
   * Stats des héros et de tous les objets avant et après une mise à jour (patch : millisecondes) :
   * { heros: { avant, apres }, objets: { avant, apres } } (réponses brutes, comparées par evolution de deadlock-stats.js).
   * Avant : les 2 semaines qui précèdent ; après : de la mise à jour à maintenant. Les dates ne bougent pas d'une heure
   * à l'autre : le cache sert jusqu'à la prochaine mise à jour (dans la limite des 3 h).
   */
  async function statsAutourDuPatch(patch, { rang = null } = {}) {
    const date = Math.floor(patch / 1000);
    const avant = { min_unix_timestamp: date - JOURS_AVANT_PATCH * JOUR_S, max_unix_timestamp: date, min_average_badge: S.badgeMinimal(rang) };
    const apres = { min_unix_timestamp: date, min_average_badge: S.badgeMinimal(rang) };
    const lent = { delaiMs: DELAI_LENT_MS };
    const [herosAvant, herosApres, objetsAvant, objetsApres] = await Promise.all([
      lireJson(adresse("/v1/analytics/hero-stats", avant), general, lent),
      lireJson(adresse("/v1/analytics/hero-stats", apres), general, lent),
      lireJson(adresse("/v1/analytics/item-stats", avant), general, lent),
      lireJson(adresse("/v1/analytics/item-stats", apres), general, lent),
    ]);
    return { heros: { avant: herosAvant, apres: herosApres }, objets: { avant: objetsAvant, apres: objetsApres } };
  }

  /** Détail d'une partie (extrairePartie de deadlock-stats.js), ou erreur claire si le site ne l'a pas. */
  async function partie(matchId) {
    if (!Number.isSafeInteger(matchId) || matchId <= 0) throw new ErreurDeadlockApi("Partie inconnue.");
    // Une réponse illisible est une erreur (et non un null gardé en cache) : la prochaine ouverture réessaie.
    const lisible = (json) => {
      const detail = S.extrairePartie(json);
      if (!detail) throw new ErreurDeadlockApi(`${SITE} a renvoyé un détail de partie illisible.`);
      return detail;
    };
    return lireJson(adresse(`/v1/matches/${matchId}/metadata`), parties, {
      transformer: lisible,
      delaiMs: DELAI_LENT_MS,
      introuvable: `${SITE} n'a pas encore le détail de cette partie : réessaie plus tard.`,
    });
  }

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

  return { heros, nomsHeros, objets, rangs, historique, mesStatsHeros, statsHeros, statsObjets, statsHerosBuild, duels, dernierGrosPatch, statsAutourDuPatch, partie, profils, familles, partieEnCours, envoyerParties };
}

module.exports = { URL_API, SITE, JOURS_TIER_LISTE, JOURS_BUILD, JOURS_AVANT_PATCH, DELAI_LENT_MS, ErreurDeadlockApi, depuis, adresse, creerLecteurDeadlock };
