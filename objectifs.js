/*
 * Alerte avant les objectifs, en jeu (Faille de l'invocateur)
 * -----------------------------------------------------------
 * Tourne dans le processus principal (Node). Désactivé par défaut (cases de l'onglet Build).
 *
 * 30 secondes avant l'apparition d'un objectif, un bandeau discret s'affiche en haut à droite du jeu, sous le chrono
 * (« Larves du Néant dans 30 s »), avec un compte à rebours ; il disparaît à l'apparition. Plusieurs objectifs en
 * même temps : une ligne chacun.
 *  - Premières apparitions : à heure fixe, connues de tous (un réveil réglé sur le chrono du jeu).
 *  - Réapparitions (dragon, Baron, inhibiteurs) : option séparée. EXCEPTION décidée par le propriétaire (10/10/2026),
 *    en connaissance du risque : Riot a jugé injuste (2014) un chrono qui n'existe que dans une appli tierce. Ces morts
 *    sont pourtant annoncées à tous les joueurs ; l'appli ne fait que noter l'heure à leur place.
 *
 * Données : API officielle « Live Client Data » de Riot, ouverte par le jeu pendant une partie sur ce PC :
 *   GET https://127.0.0.1:2999/liveclientdata/allgamedata -> {
 *     gameData: { gameTime (secondes) },
 *     activePlayer: { riotId, summonerName }, allPlayers: [{ summonerName, riotId, riotIdGameName, team: "ORDER" | "CHAOS" }],
 *     events: { Events: [{ EventName: "DragonKill" | "BaronKill" | "InhibKilled" | ..., EventTime, KillerName, Assisters,
 *                          DragonType, InhibKilled: "Barracks_T2_C1" }] } }
 * Pas de mot de passe ; certificat de Riot accepté seulement pour cet appel à 127.0.0.1 (comme lcu.js).
 * Rien n'est lu dans la mémoire du jeu, rien ne part sur Internet.
 */
const https = require("https");

/**
 * Premières apparitions (secondes de jeu). Vérifié le 10/10/2026 sur le wiki officiel de League
 * (wiki.leagueoflegends.com, patch 26.x) :
 *  - Carapateurs de la Faille à 2:55 (V26.01 : 2:55 au lieu de 3:30 ; leur réapparition n'est pas annoncée, donc absente) ;
 *  - dragon élémentaire à 5:00, puis 5:00 après chaque mort ; dragon ancestral 6:00 après l'âme, puis 6:00 après chaque mort ;
 *  - Larves du Néant à 8:00 (V25.09 : 8:00 au lieu de 6:00, plus de réapparition) ;
 *  - Héraut de la Faille à 15:00 (V25.09), une seule fois (parti à 19:45) ;
 *  - Baron Nashor à 20:00 (V26.01 : retour à 20:00 avec la suppression d'Atakhan), puis 6:00 après chaque mort ;
 *  - inhibiteurs : 5:00 après leur destruction.
 * Pas d'Atakhan (supprimé en 2026), et les plaques des tourelles ne tombent plus à 14:00 (V26.01).
 * À revérifier à chaque nouvelle saison : Riot change parfois ces heures.
 */
const OBJECTIFS = [
  { cle: "carapateurs", nom: "Carapateurs", apparitionS: 2 * 60 + 55 },
  { cle: "dragon", nom: "Premier dragon", apparitionS: 5 * 60 },
  { cle: "larves", nom: "Larves du Néant", apparitionS: 8 * 60 },
  { cle: "heraut", nom: "Héraut de la Faille", apparitionS: 15 * 60 },
  { cle: "baron", nom: "Baron Nashor", apparitionS: 20 * 60 },
];
const REAPPARITION_DRAGON_S = 5 * 60;
const REAPPARITION_ANCESTRAL_S = 6 * 60; // dragon ancestral : après l'âme (4 dragons pour une équipe), puis après chaque mort
const REAPPARITION_BARON_S = 6 * 60;
const REAPPARITION_INHIBITEUR_S = 5 * 60;
const VOIES_INHIBITEURS = { L1: "haut", C1: "milieu", R1: "bas" }; // "Barracks_T1_C1" : équipe 1 (ORDER), voie du milieu
const DRAGONS_POUR_AME = 4;
const AVANCE_S = 30; // la ligne apparaît 30 s avant, et disparaît à l'apparition
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
 * Prochaines réapparitions d'après les objectifs déjà tués : [{ cle, nom, apparitionS }].
 * Dragon : 5:00 après la mort ; une fois qu'une équipe a 4 dragons (l'âme), ce sont des dragons ancestraux, 6:00 après.
 * Si on ne sait pas qui a tué (nom introuvable), 7 dragons tués suffisent à savoir qu'une équipe en a 4.
 * Baron : 6:00 après la mort. Inhibiteurs : 5:00 après leur destruction (« allié » / « ennemi » si on connaît ton équipe).
 */
function reapparitions(evenements, joueurs, equipe = null) {
  const equipes = equipesDesJoueurs(joueurs);
  const equipeDe = (e) => [e.KillerName, ...(Array.isArray(e.Assisters) ? e.Assisters : [])].map((n) => equipes.get(simplifier(n))).find(Boolean);
  const dragons = { ORDER: 0, CHAOS: 0 };
  let total = 0;
  let ame = false;
  let dragon = null;
  let baron = null;
  const inhibiteurs = new Map(); // un seul chrono par inhibiteur (le dernier détruit)
  const tries = (Array.isArray(evenements) ? evenements : [])
    .filter((e) => e && Number.isFinite(e.EventTime))
    .sort((a, b) => a.EventTime - b.EventTime);
  for (const e of tries) {
    if (e.EventName === "DragonKill") {
      if (String(e.DragonType) !== "Elder") {
        total += 1;
        const equipeTueur = equipeDe(e);
        if (equipeTueur) dragons[equipeTueur] += 1;
        if (dragons.ORDER >= DRAGONS_POUR_AME || dragons.CHAOS >= DRAGONS_POUR_AME || total >= 2 * DRAGONS_POUR_AME - 1) ame = true;
      }
      dragon = ame
        ? { cle: "dragon", nom: "Dragon ancestral", apparitionS: e.EventTime + REAPPARITION_ANCESTRAL_S }
        : { cle: "dragon", nom: "Dragon", apparitionS: e.EventTime + REAPPARITION_DRAGON_S };
    } else if (e.EventName === "BaronKill") {
      baron = { cle: "baron", nom: "Baron Nashor", apparitionS: e.EventTime + REAPPARITION_BARON_S };
    } else if (e.EventName === "InhibKilled") {
      const m = /_T([12])_([LCR]1)/.exec(String(e.InhibKilled || ""));
      if (!m) continue;
      const proprietaire = m[1] === "1" ? "ORDER" : "CHAOS";
      const camp = equipe ? (equipe === proprietaire ? " allié" : " ennemi") : "";
      inhibiteurs.set(m[0], { cle: `inhibiteur${m[0]}`, nom: `Inhibiteur ${VOIES_INHIBITEURS[m[2]]}${camp}`, apparitionS: e.EventTime + REAPPARITION_INHIBITEUR_S });
    }
  }
  return [dragon, baron, ...inhibiteurs.values()].filter(Boolean);
}

/**
 * Lignes du bandeau au temps de jeu tempsS (secondes) : [{ cle, texte, restantS }], la plus proche d'abord.
 * prochaines : réapparitions à surveiller en plus des premières apparitions (voir reapparitions()).
 * Une ligne apparaît 30 s avant et disparaît à l'apparition (pas de « maintenant ! »).
 */
function alertesObjectifs(tempsS, prochaines = []) {
  if (!Number.isFinite(tempsS) || tempsS < 0) return [];
  return [...OBJECTIFS, ...(Array.isArray(prochaines) ? prochaines : [])]
    .filter((o) => o && Number.isFinite(o.apparitionS))
    .map((o) => ({ o, restant: o.apparitionS - tempsS }))
    .filter(({ restant }) => restant > 0 && restant <= AVANCE_S)
    .sort((a, b) => a.restant - b.restant)
    .map(({ o, restant }) => ({ cle: o.cle, texte: `${o.nom} dans ${Math.ceil(restant)} s`, restantS: Math.ceil(restant) }));
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

// --- Suivi pendant la partie ----------------------------------------------------------------------

/**
 * Lit le jeu toutes les secondes pendant une partie sur la Faille et affiche / cache le bandeau.
 *  reglages()        : { objectifs, reapparitions } (cases de l'onglet Build, relues à chaque seconde)
 *  lire()            : { tempsS, evenements, joueurs, actif } ou null
 *  afficher(lignes)  : [{ cle, texte, restantS }] ou null (cacher)
 */
function creerSuiviObjectifs({ reglages, lire = lireJeu, afficher, intervalleMs = 1000, journal = () => {} }) {
  let minuterie = null;
  let dernierTexte = null;
  let enCours = false;

  function montrer(lignes) {
    const liste = lignes && lignes.length ? lignes : null;
    const texte = liste ? liste.map((l) => l.texte).join("\n") : null;
    if (texte === dernierTexte) return;
    dernierTexte = texte;
    afficher(liste);
  }

  async function tour() {
    if (enCours) return; // une lecture lente ne doit pas s'empiler
    enCours = true;
    try {
      const r = reglages() || {};
      const jeu = r.objectifs ? await lire() : null;
      const prochaines = jeu && r.reapparitions ? reapparitions(jeu.evenements, jeu.joueurs, monEquipe(jeu.actif, jeu.joueurs)) : [];
      montrer(jeu ? alertesObjectifs(jeu.tempsS, prochaines) : null);
    } catch (erreur) {
      journal("Alerte des objectifs :", erreur.message);
    } finally {
      enCours = false;
    }
  }

  function demarrer() {
    if (minuterie) return;
    minuterie = setInterval(tour, intervalleMs);
    tour();
  }

  function arreter() {
    if (minuterie) clearInterval(minuterie);
    minuterie = null;
    montrer(null);
  }

  return { demarrer, arreter, estDemarre: () => minuterie !== null };
}

module.exports = {
  OBJECTIFS,
  AVANCE_S,
  PORT_JEU,
  estFaille,
  equipesDesJoueurs,
  monEquipe,
  reapparitions,
  alertesObjectifs,
  lireDonneesJeu,
  lireJeu,
  creerSuiviObjectifs,
};
