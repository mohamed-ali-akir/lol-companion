/*
 * Lecture de la partie en cours (API officielle « Live Client Data » de Riot)
 * --------------------------------------------------------------------------
 * Tourne dans le processus principal (Node). Utilisé par les chronos des sorts adverses (sorts.js).
 * (Ces fonctions étaient dans objectifs.js, supprimé avec l'alerte des objectifs le 17/10/2026.)
 *
 * Le jeu ouvre cette API sur ce PC pendant une partie :
 *   GET https://127.0.0.1:2999/liveclientdata/allgamedata -> {
 *     gameData: { gameTime (secondes) },
 *     activePlayer: { riotId, summonerName }, allPlayers: [{ summonerName, riotId, riotIdGameName, team: "ORDER" | "CHAOS" }],
 *     events: { Events: [...] } }
 * Pas de mot de passe ; certificat de Riot accepté seulement pour cet appel à 127.0.0.1 (comme lcu.js).
 * Rien n'est lu dans la mémoire du jeu, rien ne part sur Internet.
 */
const https = require("https");

const CARTE_FAILLE = 11;
const PORT_JEU = 2999;
const DELAI_MAX_MS = 2000;

// --- Fonctions pures (testées) ---------------------------------------------------------------

/** La partie en cours (/lol-gameflow/v1/session) est-elle sur la Faille de l'invocateur ? (ARAM : carte 12) */
function estFaille(partie) {
  const carte = partie && partie.map && partie.map.id;
  const carteFile = partie && partie.gameData && partie.gameData.queue && partie.gameData.queue.mapId;
  return carte === CARTE_FAILLE || carteFile === CARTE_FAILLE;
}

const simplifier = (nom) => String(nom || "").trim().toLowerCase();

/** Nom de joueur (tous les formats que le jeu utilise) -> équipe ("ORDER" ou "CHAOS"). */
function equipesDesJoueurs(joueurs) {
  const equipes = new Map();
  for (const j of Array.isArray(joueurs) ? joueurs : []) {
    if (!j || (j.team !== "ORDER" && j.team !== "CHAOS")) continue;
    const riotId = simplifier(j.riotId);
    for (const nom of [j.summonerName, j.riotIdGameName, j.riotId, riotId.split("#")[0]]) if (simplifier(nom)) equipes.set(simplifier(nom), j.team);
  }
  return equipes;
}

/** Équipe du joueur de ce PC ("ORDER" ou "CHAOS"), ou null. */
function monEquipe(actif, joueurs) {
  if (!actif) return null;
  const equipes = equipesDesJoueurs(joueurs);
  return [actif.riotId, actif.summonerName, actif.riotIdGameName].map((n) => equipes.get(simplifier(n))).find(Boolean) || null;
}

/**
 * Ton joueur dans la partie (activePlayer retrouvé dans allPlayers par son nom), ou null.
 * Sert à connaître ton champion quand l'appli a été lancée en pleine partie (sans la sélection des champions).
 */
function monJoueur(actif, joueurs) {
  if (!actif || !Array.isArray(joueurs)) return null;
  const miens = new Set([actif.riotId, actif.summonerName, actif.riotIdGameName, simplifier(actif.riotId).split("#")[0]].map(simplifier).filter(Boolean));
  return joueurs.find((j) => j && [j.riotId, j.summonerName, j.riotIdGameName].some((n) => miens.has(simplifier(n)))) || null;
}

/** Nom interne de ton champion dans la partie (« MonkeyKing »), d'après rawChampionName, ou null. */
function monAlias(actif, joueurs) {
  const moi = monJoueur(actif, joueurs);
  const alias = moi ? String(moi.rawChampionName || "").replace(/^game_character_displayname_/, "") : "";
  return alias || null;
}

/** Réponse de /liveclientdata/allgamedata -> { tempsS, evenements, joueurs, actif }, ou null si illisible. */
function lireDonneesJeu(donnees) {
  const temps = donnees && donnees.gameData ? donnees.gameData.gameTime : undefined;
  if (!Number.isFinite(temps)) return null;
  const evenements = donnees.events && Array.isArray(donnees.events.Events) ? donnees.events.Events : [];
  const actif = donnees.activePlayer && typeof donnees.activePlayer === "object" ? donnees.activePlayer : null;
  return { tempsS: temps, evenements, joueurs: Array.isArray(donnees.allPlayers) ? donnees.allPlayers : [], actif };
}

// --- Lecture du jeu ------------------------------------------------------------------------------

/** État de la partie : { tempsS, evenements, joueurs, actif }, ou null (pas de partie, chargement, réponse illisible). */
function lireJeu({ port = PORT_JEU } = {}) {
  // Même règle que lcu.js : certificat de Riot accepté UNIQUEMENT dans cet agent, UNIQUEMENT pour 127.0.0.1.
  const agentLocal = new https.Agent({ rejectUnauthorized: false });
  return new Promise((resoudre) => {
    const requete = https.get(
      { host: "127.0.0.1", port, path: "/liveclientdata/allgamedata", agent: agentLocal, timeout: DELAI_MAX_MS },
      (reponse) => {
        const morceaux = [];
        reponse.on("data", (m) => morceaux.push(m));
        reponse.on("end", () => {
          if (reponse.statusCode !== 200) return resoudre(null);
          try {
            resoudre(lireDonneesJeu(JSON.parse(Buffer.concat(morceaux).toString("utf8"))));
          } catch {
            resoudre(null);
          }
        });
      }
    );
    requete.on("timeout", () => requete.destroy());
    requete.on("error", () => resoudre(null)); // jeu pas encore prêt (chargement) : on réessaiera
  });
}

/**
 * Lecture du jeu PARTAGÉE : plusieurs lectures dans la même seconde n'interrogent le jeu qu'une fois.
 *  - si une lecture est en cours, on attend la même ;
 *  - si la dernière est arrivée il y a moins de dureeMs, on la réutilise, avec le temps de jeu avancé du temps écoulé
 *    (pour que les chronos restent exacts) ;
 *  - sinon, on relit le jeu.
 * lire et maintenant sont modifiables pour les tests.
 */
function creerLectureJeuPartagee({ lire = lireJeu, dureeMs = 900, maintenant = Date.now } = {}) {
  let derniere = null; // { date, arrivee (null tant que la lecture est en cours), promesse }

  return async function lireJeuPartage() {
    const enCours = derniere && derniere.arrivee === null;
    const recente = derniere && derniere.arrivee !== null && maintenant() - derniere.date < dureeMs;
    if (!enCours && !recente) {
      const lecture = { date: maintenant(), arrivee: null, promesse: null };
      lecture.promesse = Promise.resolve()
        .then(() => lire())
        .finally(() => {
          lecture.arrivee = maintenant();
        });
      derniere = lecture;
    }
    const lecture = derniere;
    const jeu = await lecture.promesse;
    if (!jeu) return null;
    const ecartS = (maintenant() - lecture.arrivee) / 1000;
    return ecartS > 0 ? { ...jeu, tempsS: jeu.tempsS + ecartS } : jeu;
  };
}

module.exports = {
  PORT_JEU,
  monJoueur,
  monAlias,
  estFaille,
  equipesDesJoueurs,
  monEquipe,
  lireDonneesJeu,
  lireJeu,
  creerLectureJeuPartagee,
};
