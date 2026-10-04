/*
 * Onglet "Classée" : lecture des champions, de l'Essence bleue et des prix dans le client
 * --------------------------------------------------------------------------------------
 * Tourne dans le processus principal (Node). Lecture seule : l'appli n'achète rien.
 *
 * Routes du client utilisées (non documentées officiellement par Riot, vérifiées dans des
 * projets de la communauté : lcu-driver, disenchanter, LoL-DIY-Programs) :
 *  - /lol-champions/v1/owned-champions-minimal : champions jouables, avec "ownership"
 *      { owned, rental: { rented }, loyaltyReward, xboxGPReward } et "freeToPlay" ;
 *  - /lol-game-data/assets/v1/champion-summary.json : noms de TOUS les champions (id, name) ;
 *  - /lol-inventory/v1/wallet : portefeuille, clé "lol_blue_essence" (secours : butin
 *      CURRENCY_champion) ;
 *  - /lol-catalog/v1/items/CHAMPION : catalogue, chaque objet a itemId + prices [{ currency, cost }]
 *      (secours : /lol-store/v1/catalog).
 * Chaque lecture est tolérante : un champ manquant ne fait pas planter, on renvoie ce qu'on a.
 */
const { lireLockfile, lireJson, lireJsonOuNull, appelerClient, ErreurClient } = require("./lcu.js");

const ROUTE_CHAMPIONS = "/lol-champions/v1/owned-champions-minimal";
const ROUTE_RESUME = "/lol-game-data/assets/v1/champion-summary.json";
const ROUTES_PORTEFEUILLE = [
  `/lol-inventory/v1/wallet?currencyTypes=${encodeURIComponent('["lol_blue_essence"]')}`,
  "/lol-inventory/v1/wallet",
];
const ROUTES_BUTIN = ["/lol-player-loot/v1/player-loot-map", "/lol-loot/v1/player-loot-map"];
const ROUTES_CATALOGUE = [
  "/lol-catalog/v1/items/CHAMPION",
  `/lol-store/v1/catalog?inventoryType=${encodeURIComponent('["CHAMPION"]')}`,
];
// Dans les prix, l'Essence bleue s'appelle "IP" (ancien nom) ou "lol_blue_essence" selon les versions.
const DEVISES_ESSENCE_BLEUE = ["IP", "lol_blue_essence", "BE"];

// --- Fonctions pures (testées) -------------------------------------------------------

/**
 * Un champion compte pour la classée seulement s'il est vraiment possédé :
 * pas de la rotation gratuite, pas loué, pas prêté (PC café, Game Pass).
 */
function estReellementPossede(champion) {
  const o = champion && champion.ownership;
  if (!o || o.owned !== true) return false;
  if (o.rental && o.rental.rented === true) return false;
  if (o.loyaltyReward === true || o.xboxGPReward === true) return false;
  return true;
}

/** Ensemble des identifiants des champions vraiment possédés. */
function idsPossedes(liste) {
  if (!Array.isArray(liste)) return new Set();
  return new Set(liste.filter(estReellementPossede).map((c) => c.id).filter((id) => Number.isInteger(id) && id > 0));
}

const nombreValide = (n) => (Number.isFinite(n) && n >= 0 ? n : null);

/** Essence bleue depuis le portefeuille ({ lol_blue_essence }) ou le butin (CURRENCY_champion). null si inconnue. */
function lireEssenceBleue({ portefeuille, butin } = {}) {
  if (portefeuille && typeof portefeuille === "object") {
    const valeur = nombreValide(portefeuille.lol_blue_essence ?? portefeuille.ip);
    if (valeur !== null) return valeur;
  }
  if (butin && typeof butin === "object") {
    const monnaie = butin.CURRENCY_champion;
    const valeur = nombreValide(monnaie && monnaie.count);
    if (valeur !== null) return valeur;
  }
  return null;
}

/** Prix en Essence bleue d'un objet du catalogue, ou null. */
function prixEnEssence(objet) {
  const prix = objet && Array.isArray(objet.prices) ? objet.prices : [];
  const ligne = prix.find((p) => p && DEVISES_ESSENCE_BLEUE.includes(p.currency) && Number.isFinite(p.cost) && p.cost > 0);
  return ligne ? ligne.cost : null;
}

/** Table id du champion -> prix en EB, à partir du catalogue (liste d'objets). */
function tableDesPrix(catalogue) {
  const table = new Map();
  if (!Array.isArray(catalogue)) return table;
  for (const objet of catalogue) {
    if (!objet || (objet.inventoryType && objet.inventoryType !== "CHAMPION")) continue;
    const prix = prixEnEssence(objet);
    if (Number.isInteger(objet.itemId) && prix !== null) table.set(objet.itemId, prix);
  }
  return table;
}

/**
 * Assemble la liste de tous les champions : [{ id, nom, possede, prix }], triée par nom.
 * Les noms viennent du résumé du jeu, sinon de la liste des champions jouables.
 */
function assemblerChampions({ resume, jouables, prix }) {
  const possedes = idsPossedes(jouables);
  const noms = new Map();
  for (const source of [jouables, resume]) {
    if (!Array.isArray(source)) continue;
    for (const c of source) {
      if (c && Number.isInteger(c.id) && c.id > 0 && typeof c.name === "string" && c.name) noms.set(c.id, c.name);
    }
  }
  return [...noms]
    .map(([id, nom]) => ({ id, nom, possede: possedes.has(id), prix: prix.has(id) ? prix.get(id) : null }))
    .sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
}

/** Noms de tous les champions (Map id -> nom), depuis les fichiers du jeu. Map vide si indisponible. */
async function lireNomsChampions(dossierJeu) {
  const resume = await lireJsonOuNull(lireLockfile(dossierJeu), ROUTE_RESUME);
  const noms = new Map();
  if (Array.isArray(resume)) {
    for (const c of resume) if (c && Number.isInteger(c.id) && c.id > 0 && typeof c.name === "string") noms.set(c.id, c.name);
  }
  return noms;
}

// --- Lecture dans le client ------------------------------------------------------------

/** Essaie plusieurs routes et renvoie la première réponse qui convient à "valide". */
async function premiereReponse(connexion, routes, valide) {
  for (const route of routes) {
    const donnees = await lireJsonOuNull(connexion, route);
    if (donnees !== null && valide(donnees)) return donnees;
  }
  return null;
}

/**
 * Point d'entrée : { champions, possedes, essenceBleue, prixDisponibles }.
 * La liste des champions jouables est indispensable (sinon erreur) ; le reste est facultatif.
 */
async function recupererClassee(dossierJeu) {
  const connexion = lireLockfile(dossierJeu);
  const jouables = await lireJson(connexion, ROUTE_CHAMPIONS);
  if (!Array.isArray(jouables)) throw new ErreurClient("Réponse inattendue du client League (liste des champions).");

  const [resume, portefeuille, catalogue] = await Promise.all([
    lireJsonOuNull(connexion, ROUTE_RESUME),
    premiereReponse(connexion, ROUTES_PORTEFEUILLE, (d) => lireEssenceBleue({ portefeuille: d }) !== null),
    premiereReponse(connexion, ROUTES_CATALOGUE, (d) => tableDesPrix(d).size > 0),
  ]);
  const butin = portefeuille ? null : await premiereReponse(connexion, ROUTES_BUTIN, (d) => lireEssenceBleue({ butin: d }) !== null);

  const prix = tableDesPrix(catalogue);
  return {
    champions: assemblerChampions({ resume, jouables, prix }),
    possedes: idsPossedes(jouables).size,
    essenceBleue: lireEssenceBleue({ portefeuille, butin }),
    prixDisponibles: prix.size > 0,
  };
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
  estReellementPossede,
  idsPossedes,
  lireEssenceBleue,
  prixEnEssence,
  tableDesPrix,
  assemblerChampions,
  recupererClassee,
  lireNomsChampions,
  routeIcone,
  creerCacheIcones,
  chargerImageClient,
};
