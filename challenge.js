/*
 * Onglet "Challenge" : top 3 en Arena avec TOUS les champions, dans l'ordre alphabétique (demandé le 20/10/2026)
 * ---------------------------------------------------------------------------------------------------------
 * Tourne dans le processus principal (Node). La page (src/onglets/challenge.js) ne fait qu'afficher ce que renvoie lire().
 *
 * Règles du challenge :
 *  - la liste : tous les champions du jeu (noms lus dans le client), triés par ordre alphabétique (français) ;
 *  - un champion est FAIT dès que tu as fini une partie d'Arena (files 1700, 1710, 1750 « Arena 3x6 ») avec lui
 *    à la place 1, 2 ou 3. La place vient de l'historique du client (stats.subteamPlacement, vu le 20/10/2026),
 *    gardée dans parties.json (champ "place") ;
 *  - un top 3 avec un champion « hors ordre » compte quand même (c'est honnête : tu l'as fait) ;
 *  - le PROCHAIN champion est le premier de la liste alphabétique qui n'est pas encore fait.
 * Rien n'est enregistré à part : la progression est recalculée à chaque fois depuis parties.json.
 *
 * Pick automatique du prochain champion (case de l'onglet, DÉSACTIVÉE par défaut) : il réutilise le pick automatique
 * de selection.js (exception décidée par le propriétaire le 02/10/2026) et TOUS ses garde-fous (délai, seulement ton
 * action, rien si tu survoles ou choisis toi-même, jamais un champion pris, banni ou survolé par un coéquipier).
 * Seulement en Arena. Quand la case est cochée, en Arena, la liste du challenge REMPLACE les listes de picks de
 * l'onglet Sélection (et son délai) ; partout ailleurs, l'onglet Sélection marche comme avant. Les bans ne changent pas.
 */
const { estArena } = require("./augments.js");
const { delaiBorne } = require("./selection.js");

const FILES_ARENA = new Set(require("./donnees-jeu.js").FILES.arena); // 1750 : « Arena 3x6 » (6 équipes de 3), vu dans le client le 20/10/2026
const PLACE_MAX = 3; // top 3
const DELAI_PAR_DEFAUT_S = 10; // comme le pick automatique de l'onglet Sélection

// --- Fonctions pures (testées) ------------------------------------------------------------------

/** Réglages lisibles quoi qu'il y ait dans config.json (clé "challenge") : pick automatique désactivé par défaut. */
function normaliserReglagesChallenge(brut) {
  const r = brut && typeof brut === "object" ? brut : {};
  return { pickActif: r.pickActif === true, delaiSecondes: delaiBorne(r.delaiSecondes, DELAI_PAR_DEFAUT_S) };
}

/**
 * Noms des champions (Map id -> nom) -> [{ id, nom }] dans l'ordre alphabétique (français : accents et majuscules ignorés).
 * Un nom en double n'est gardé qu'une fois, avec le plus petit numéro (20/10/2026 : le client liste aussi 77 copies des
 * champions, numéros 60001 et plus, nom interne « Jade_Annie »..., avec le même nom que le vrai champion).
 */
function championsDansLOrdre(noms) {
  const liste = noms instanceof Map ? [...noms] : [];
  const parNom = new Map(); // nom (sans majuscules) -> champion au plus petit numéro
  for (const [id, nom] of liste) {
    if (!Number.isInteger(id) || id <= 0 || typeof nom !== "string" || nom.trim() === "") continue;
    const cle = nom.trim().toLocaleLowerCase("fr");
    const avant = parNom.get(cle);
    if (!avant || id < avant.id) parNom.set(cle, { id, nom });
  }
  return [...parNom.values()].sort((a, b) => a.nom.localeCompare(b.nom, "fr", { sensitivity: "base" }) || a.id - b.id);
}

/** Cette partie est-elle un top 3 en Arena ? (place absente ou abîmée : non) */
const estTop3Arena = (p) => Boolean(p) && FILES_ARENA.has(p.file) && Number.isInteger(p.place) && p.place >= 1 && p.place <= PLACE_MAX;

/**
 * Champions faits : Map championId -> { place, date } (meilleure place, puis première fois qu'elle a été obtenue).
 * parties : celles de parties.json (n'importe quel ordre, données abîmées ignorées).
 */
function championsFaits(parties) {
  const faits = new Map();
  for (const p of Array.isArray(parties) ? parties : []) {
    if (!estTop3Arena(p) || !Number.isInteger(p.championId)) continue;
    const date = Number.isFinite(p.date) ? p.date : null;
    const avant = faits.get(p.championId);
    const meilleure = !avant || p.place < avant.place || (p.place === avant.place && date !== null && (avant.date === null || date < avant.date));
    if (meilleure) faits.set(p.championId, { place: p.place, date });
  }
  return faits;
}

/**
 * Parties d'Arena jouées avec chaque champion AVANT de réussir le challenge (demandé le 20/10/2026) :
 * Map championId -> nombre. Champion fait : les parties jusqu'à son PREMIER top 3 compris (combien d'essais il a
 * fallu) ; pas encore fait : toutes ses parties d'Arena (les essais ratés). Une partie sans date compte comme jouée
 * avant (on ne sait pas la ranger).
 */
function essaisParChampion(parties) {
  const arenas = (Array.isArray(parties) ? parties : []).filter((p) => p && FILES_ARENA.has(p.file) && Number.isInteger(p.championId));
  const premierTop3 = new Map(); // championId -> date du premier top 3 (-Infinity si sans date)
  for (const p of arenas) {
    if (!estTop3Arena(p)) continue;
    const date = Number.isFinite(p.date) ? p.date : -Infinity;
    if (!premierTop3.has(p.championId) || date < premierTop3.get(p.championId)) premierTop3.set(p.championId, date);
  }
  const essais = new Map();
  for (const p of arenas) {
    const limite = premierTop3.has(p.championId) ? premierTop3.get(p.championId) : Infinity;
    const date = Number.isFinite(p.date) ? p.date : -Infinity;
    if (date <= limite) essais.set(p.championId, (essais.get(p.championId) || 0) + 1);
  }
  return essais;
}

/**
 * Progression du challenge : { total, faits, restants, prochain, champions, moyenneEssais }.
 *  - champions : [{ id, nom, fait, place, date, essais }] dans l'ordre alphabétique (place et date : null si pas fait ;
 *    essais : parties d'Arena jouées avec lui avant de réussir, voir essaisParChampion) ;
 *  - moyenneEssais : parties par champion réussi, en moyenne (null tant qu'aucun n'est fait) ;
 *  - prochain : { id, nom } (premier pas fait), ou null quand tout est fait (ou liste vide).
 * Un top 3 avec un champion inconnu de la liste (retiré du jeu, liste pas à jour) n'est pas compté.
 */
function progressionChallenge(noms, parties) {
  const faits = championsFaits(parties);
  const essais = essaisParChampion(parties);
  const champions = championsDansLOrdre(noms).map((c) => {
    const f = faits.get(c.id);
    return { ...c, fait: Boolean(f), place: f ? f.place : null, date: f ? f.date : null, essais: essais.get(c.id) || 0 };
  });
  const reussis = champions.filter((c) => c.fait);
  const nbFaits = reussis.length;
  const prochain = champions.find((c) => !c.fait);
  const moyenneEssais = nbFaits > 0 ? reussis.reduce((s, c) => s + Math.max(1, c.essais), 0) / nbFaits : null;
  return {
    total: champions.length,
    faits: nbFaits,
    restants: champions.length - nbFaits,
    prochain: prochain ? { id: prochain.id, nom: prochain.nom, essais: prochain.essais } : null,
    champions,
    moyenneEssais,
  };
}

/** Identifiants des champions pas encore faits, dans l'ordre : la liste essayée par le pick automatique. */
const ordreDesPicks = (progression) => (progression && Array.isArray(progression.champions) ? progression.champions.filter((c) => !c.fait).map((c) => c.id) : []);

// --- Service (branché par main.js ; testé avec de faux services) ------------------------------------

/**
 * reglages()             : réglages du challenge (stockage.reglagesChallenge) ;
 * nomsChampions()        : Map id -> nom (promesse ; Map vide si le client est fermé) ;
 * parties()              : parties enregistrées du compte connecté (parties.json) ;
 * lirePartie()           : session du "gameflow" du client (promesse), pour savoir si la sélection est une Arena.
 * Renvoie { lire(), preparer(session), pickPrioritaire() } :
 *  - lire() : { ok, ...progression, reglages } pour la page ;
 *  - preparer(session) : à attendre AVANT de passer la session de sélection au pick automatique. Une seule lecture
 *    par sélection (même gameId) : est-ce une Arena, et quels champions restent ;
 *  - pickPrioritaire() : { liste, delaiSecondes, source: "challenge" } si la case est cochée et que la sélection en
 *    cours est une Arena avec des champions à faire ; sinon null (selection.js utilise alors l'onglet Sélection).
 */
function creerChallenge({ reglages, nomsChampions, parties, lirePartie }) {
  let selection = { gameId: undefined, promesse: null, arena: false, liste: [] };

  async function lire() {
    const noms = await nomsChampions();
    if (!(noms instanceof Map) || noms.size === 0) {
      return { ok: false, erreur: "Lance le client League pour charger la liste des champions.", reglages: normaliserReglagesChallenge(reglages()) };
    }
    return { ok: true, ...progressionChallenge(noms, parties()), reglages: normaliserReglagesChallenge(reglages()) };
  }

  function preparer(session) {
    const gameId = session && typeof session === "object" ? session.gameId : undefined;
    if (gameId === undefined || gameId === null) {
      selection = { gameId: undefined, promesse: null, arena: false, liste: [] }; // sélection finie : on oublie
      return Promise.resolve();
    }
    if (selection.promesse && selection.gameId === gameId) return selection.promesse;
    const etat = { gameId, promesse: null, arena: false, liste: [] };
    etat.promesse = (async () => {
      try {
        etat.arena = estArena(await lirePartie());
        if (etat.arena) etat.liste = ordreDesPicks(progressionChallenge(await nomsChampions(), parties()));
      } catch {
        etat.arena = false; // lecture impossible : on laisse l'onglet Sélection faire comme d'habitude
      }
    })();
    selection = etat;
    return etat.promesse;
  }

  function pickPrioritaire() {
    const r = normaliserReglagesChallenge(reglages());
    if (!r.pickActif || !selection.arena || selection.liste.length === 0) return null;
    return { liste: selection.liste, delaiSecondes: r.delaiSecondes, source: "challenge" };
  }

  return { lire, preparer, pickPrioritaire };
}

module.exports = {
  essaisParChampion,
  FILES_ARENA,
  PLACE_MAX,
  normaliserReglagesChallenge,
  championsDansLOrdre,
  championsFaits,
  progressionChallenge,
  ordreDesPicks,
  creerChallenge,
};
