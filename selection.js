/*
 * Pick et ban automatiques en sélection des champions (onglet "Sélection")
 * ------------------------------------------------------------------------
 * Tourne dans le processus principal (Node).
 *
 * ATTENTION : les règles de Riot interdisent aux applis de choisir ou bannir à la place du joueur.
 * Le propriétaire du projet a choisi de lever cette règle pour lui-même (02/10/2026), en connaissance
 * du risque pour son compte. D'où les garde-fous ci-dessous.
 *
 * Format de la sélection (documentation de la communauté, lcu-schema) :
 *   GET /lol-champ-select/v1/session -> {
 *     gameId, localPlayerCellId,
 *     actions: [[{ id, actorCellId, championId, completed, isInProgress, type: "ban" | "pick" }]],
 *     myTeam: [{ cellId, assignedPosition, championId, championPickIntent }], theirTeam: [...],
 *     bans: { myTeamBans: [ids], theirTeamBans: [ids] }, timer: { adjustedTimeLeftInPhase (ms) } }
 *   PATCH /lol-champ-select/v1/session/actions/{id}  { championId, completed: true } -> choisit et verrouille
 *   POST  /lol-champ-select/v1/session/actions/{id}/complete       -> verrouille (secours)
 *   L'appli relit ensuite la session pour vérifier que l'action est bien "completed".
 * Le WebSocket envoie "OnJsonApiEvent_lol-champ-select_v1_session" à chaque changement
 * (surveillance.js le transmet ici).
 *
 * Garde-fous :
 *  - DÉSACTIVÉ par défaut (pick et ban séparément) ;
 *  - seulement TON action, en cours, et une seule fois par action ;
 *  - un délai (10 s pour le pick, 5 s pour le ban par défaut) pour te laisser faire toi-même ;
 *  - si tu survoles ou verrouilles un champion toi-même, l'appli ne touche à rien ;
 *  - jamais un champion banni, déjà pris, ou survolé/déclaré par un coéquipier.
 */
const { lireLockfile, lireJsonOuNull, appelerClient, ErreurClient } = require("./lcu.js");

const ROLES = ["top", "jungle", "middle", "bottom", "utility"];
const LISTES_PICKS = ["defaut", ...ROLES]; // "defaut" : partie sans rôles, ou liste du rôle vide/indisponible (picks ET bans)
const NB_CHOIX = 3;
const DELAI_MAX_SECONDES = 25; // un tour de sélection dure environ 30 s
const MARGE_FIN_DE_TOUR_S = 2; // si le délai dépasse le temps restant, on agit 2 s avant la fin
const ROUTES_AUTORISES = {
  pick: "/lol-champ-select/v1/pickable-champion-ids",
  ban: "/lol-champ-select/v1/bannable-champion-ids",
};
const ROUTE_SESSION = "/lol-champ-select/v1/session";
const routeAction = (id) =>`/lol-champ-select/v1/session/actions/${id}`;

// Le client écrit normalement "middle", "bottom", "utility" ; on accepte aussi les noms courants.
const ALIAS_ROLES = { mid: "middle", bot: "bottom", adc: "bottom", support: "utility", sup: "utility" };

// --- Réglages ------------------------------------------------------------------------------

/** Jusqu'à 3 identifiants de champions, sans doublon, dans l'ordre. */
function listeChampions(brut) {
  if (!Array.isArray(brut)) return [];
  const ids = [];
  for (const valeur of brut) {
    const id = Number(valeur);
    if (Number.isInteger(id) && id > 0 && !ids.includes(id)) ids.push(id);
    if (ids.length === NB_CHOIX) break;
  }
  return ids;
}

function delaiBorne(valeur, parDefaut) {
  if (valeur === null || valeur === "" || valeur === undefined) return parDefaut;
  const n = Number(valeur);
  return Number.isFinite(n) ? Math.min(DELAI_MAX_SECONDES, Math.max(0, Math.round(n * 10) / 10)) : parDefaut;
}

/** Une liste par rôle + "Par défaut" (mêmes clés pour les picks et les bans). */
function listesParRole(brut) {
  const listes = {};
  const source = brut && typeof brut === "object" && !Array.isArray(brut) ? brut : {};
  for (const nom of LISTES_PICKS) listes[nom] = listeChampions(source[nom]);
  return listes;
}

/**
 * Réglages lisibles et bornés, quoi qu'il y ait dans le fichier (tout désactivé par défaut).
 * Bans : jusqu'au 10/10/2026, une seule liste (tableau) ; elle devient la liste "Par défaut".
 */
function normaliserReglagesSelection(brut) {
  const r = brut && typeof brut === "object" ? brut : {};
  const picks = listesParRole(r.picks);
  const bans = Array.isArray(r.bans) ? listesParRole({ defaut: r.bans }) : listesParRole(r.bans);
  return {
    pickActif: r.pickActif === true,
    banActif: r.banActif === true,
    conseilActif: r.conseilActif === true, // conseiller de draft (draft.js) : lit Lolalytics, donc désactivé par défaut
    delaiPickSecondes: delaiBorne(r.delaiPickSecondes, 10),
    delaiBanSecondes: delaiBorne(r.delaiBanSecondes, 5),
    picks,
    bans,
  };
}

// --- Lecture de la session (fonctions pures, testées) --------------------------------------

const estSession = (s) => Boolean(s) && typeof s === "object" && Number.isInteger(s.localPlayerCellId);
const equipe = (liste) => (Array.isArray(liste) ? liste.filter((j) => j && typeof j === "object") : []);

/** Toutes les actions (le client les range par tour : tableau de tableaux). */
function toutesLesActions(session) {
  if (!estSession(session) || !Array.isArray(session.actions)) return [];
  return session.actions.flat().filter((a) => a && typeof a === "object");
}

/** Ton rôle attribué ("top", "jungle", "middle", "bottom", "utility"), ou null (partie sans rôles). */
function monRole(session) {
  if (!estSession(session)) return null;
  const moi = equipe(session.myTeam).find((j) => j.cellId === session.localPlayerCellId);
  const brut = moi && typeof moi.assignedPosition === "string" ? moi.assignedPosition.trim().toLowerCase() : "";
  const role = ALIAS_ROLES[brut] || brut;
  return ROLES.includes(role) ? role : null;
}

/**
 * Ton action en cours du type demandé ("pick" ou "ban"), ou null.
 * Vu sur le vrai client (02/10/2026) : pendant la phase de préparation ("PLANNING"), ton ban est déjà marqué
 * "isInProgress", mais le client l'ignore si on bannit à ce moment-là. On attend donc la phase "BAN_PICK"
 * (si le client n'indique pas de phase, on se fie à isInProgress).
 */
function monActionEnCours(session, type) {
  if (!estSession(session)) return null;
  const phase = session.timer && typeof session.timer.phase === "string" ? session.timer.phase : null;
  if (phase !== null && phase !== "BAN_PICK") return null;
  return (
    toutesLesActions(session).find(
      (a) =>
        a.actorCellId === session.localPlayerCellId &&
        a.type === type &&
        a.isInProgress === true &&
        a.completed !== true &&
        Number.isInteger(a.id)
    ) || null
  );
}

/**
 * Champions à ne pas prendre ni bannir : bans des deux équipes, champions déjà choisis,
 * et ceux survolés ou déclarés par tes coéquipiers (on ne leur vole pas, on ne les bannit pas).
 */
function championsIndisponibles(session) {
  const ids = new Set();
  const ajouter = (id) => Number.isInteger(id) && id > 0 && ids.add(id);
  if (!estSession(session)) return ids;
  const bans = session.bans && typeof session.bans === "object" ? session.bans : {};
  for (const liste of [bans.myTeamBans, bans.theirTeamBans]) if (Array.isArray(liste)) liste.forEach(ajouter);
  for (const a of toutesLesActions(session)) if (a.completed === true) ajouter(a.championId);
  for (const j of equipe(session.myTeam)) {
    if (j.cellId === session.localPlayerCellId) continue; // ton propre survol ne te bloque pas
    ajouter(j.championId);
    ajouter(j.championPickIntent);
  }
  for (const j of equipe(session.theirTeam)) ajouter(j.championId);
  return ids;
}

/** Liste à essayer ("pick" ou "ban") : celle du rôle d'abord, puis "Par défaut". */
function listePourAction(reglages, type, role) {
  const r = normaliserReglagesSelection(reglages);
  const listes = type === "ban" ? r.bans : r.picks;
  const liste = [...(role ? listes[role] : []), ...listes.defaut];
  return liste.filter((id, i) => liste.indexOf(id) === i);
}

/** Liste des picks à essayer : celle du rôle d'abord, puis "Par défaut". */
const listePourPick = (reglages, role) => listePourAction(reglages, "pick", role);

/** Premier champion de la liste ni indisponible, ni refusé par le client (autorises : Set ou null). */
function choisirChampion(liste, indisponibles, autorises = null) {
  return liste.find((id) => !indisponibles.has(id) && (!autorises || autorises.has(id))) || null;
}

/** Délai à appliquer : le délai réglé, sauf s'il dépasse le temps restant du tour (on agit alors 2 s avant la fin). */
function delaiEffectif(delaiSecondes, session) {
  const restantMs = session && session.timer ? Number(session.timer.adjustedTimeLeftInPhase) : NaN;
  if (!Number.isFinite(restantMs) || restantMs <= 0) return delaiSecondes;
  return Math.max(0, Math.min(delaiSecondes, restantMs / 1000 - MARGE_FIN_DE_TOUR_S));
}

// --- Logique (testée sans client ni Electron) ---------------------------------------------

/**
 * Tout ce qui touche au monde extérieur est passé en paramètre :
 *  - reglages()               : réglages actuels (relus au début du tour et au moment d'agir) ;
 *  - champsAutorises(type)    : identifiants proposés par le client (promesse, tableau ou null) ;
 *  - agir(actionId, champion) : survole puis verrouille (promesse) ;
 *  - resultat(info)           : { type, prevu: true, delaiSecondes, role }
 *                               | { type, fait: true, championId }
 *                               | { type, fait: false, annule: "fini" | "repondu" | "desactive" }
 *                               | { type, fait: false, raison: "liste-vide" | "indisponibles" }
 *                               | { type, fait: false, erreur } ;
 *  - journal(...)             : (facultatif) écrit les décisions dans le terminal, pour le diagnostic.
 * Renvoie { surSession(session), arreter() }.
 */
function creerSelectionAuto({ reglages, champsAutorises = async () => null, agir, resultat = () => {}, journal = () => {} }) {
  let derniere = null; // dernière session reçue
  let partie; // gameId de la sélection en cours
  const traitees = new Set(); // actions déjà prises en charge (une seule fois chacune)
  const prevues = new Map(); // actionId -> { minuterie, type }

  /** Ton action n° id du type donné, si elle est toujours en cours. */
  const actionToujoursEnCours = (id, type) => {
    const a = monActionEnCours(derniere, type);
    return a && a.id === id ? a : null;
  };

  function annulerPrevue(id, raison) {
    const prevue = prevues.get(id);
    if (!prevue) return;
    clearTimeout(prevue.minuterie);
    prevues.delete(id);
    journal(`${prevue.type} n°${id} annulé :`, raison);
    resultat({ type: prevue.type, fait: false, annule: raison });
  }

  async function executer(id, type) {
    prevues.delete(id);
    const actifMaintenant = () => {
      const r = normaliserReglagesSelection(reglages());
      return type === "pick" ? r.pickActif : r.banActif;
    };
    const verifier = () => {
      const a = actionToujoursEnCours(id, type);
      if (!a) return "fini";
      if (a.championId > 0) return "repondu"; // tu as survolé ou choisi toi-même
      if (!actifMaintenant()) return "desactive";
      return null;
    };

    let probleme = verifier();
    if (probleme) {
      journal(`${type} n°${id} abandonné au dernier moment :`, probleme);
      return resultat({ type, fait: false, annule: probleme });
    }

    const r = normaliserReglagesSelection(reglages());
    const liste = listePourAction(r, type, monRole(derniere)); // liste du rôle, puis "Par défaut"
    if (liste.length === 0) return resultat({ type, fait: false, raison: "liste-vide" });

    let autorises = null;
    try {
      const ids = await champsAutorises(type);
      if (Array.isArray(ids) && ids.length > 0) autorises = new Set(ids);
    } catch {
      // lecture impossible : on ne filtre pas, le client refusera lui-même un champion interdit
    }

    probleme = verifier(); // l'état a pu changer pendant la lecture
    if (probleme) {
      journal(`${type} n°${id} abandonné au dernier moment :`, probleme);
      return resultat({ type, fait: false, annule: probleme });
    }

    const championId = choisirChampion(liste, championsIndisponibles(derniere), autorises);
    if (!championId) {
      journal(`${type} n°${id} : aucun champion disponible dans la liste`, liste);
      return resultat({ type, fait: false, raison: "indisponibles" });
    }
    journal(`${type} n°${id} : envoi du champion ${championId}...`);
    try {
      await agir(id, championId);
      journal(`${type} n°${id} OK`);
      resultat({ type, fait: true, championId });
    } catch (erreur) {
      journal(`${type} n°${id} en ERREUR :`, erreur.message);
      resultat({ type, fait: false, erreur: erreur.message });
    }
  }

  function surSession(session) {
    derniere = estSession(session) ? session : null;

    // Sélection finie, esquivée, ou nouvelle sélection : on oublie tout.
    const nouvellePartie = derniere ? derniere.gameId : undefined;
    if (!derniere || nouvellePartie !== partie) {
      for (const id of [...prevues.keys()]) annulerPrevue(id, "fini");
      traitees.clear();
      partie = nouvellePartie;
      if (!derniere) return;
    }

    // Actions prévues qui ne sont plus valables : tour fini, ou tu as agi toi-même.
    for (const [id, { type }] of [...prevues]) {
      const a = actionToujoursEnCours(id, type);
      if (!a) annulerPrevue(id, "fini");
      else if (a.championId > 0) annulerPrevue(id, "repondu");
    }

    for (const type of ["ban", "pick"]) {
      const action = monActionEnCours(derniere, type);
      if (!action || traitees.has(action.id)) continue;
      traitees.add(action.id);

      const r = normaliserReglagesSelection(reglages());
      if (!(type === "pick" ? r.pickActif : r.banActif)) continue;
      if (action.championId > 0) {
        journal(`${type} n°${action.id} : tu as déjà survolé un champion, l'appli ne fait rien`);
        resultat({ type, fait: false, annule: "repondu" });
        continue;
      }
      const delai = delaiEffectif(type === "pick" ? r.delaiPickSecondes : r.delaiBanSecondes, derniere);
      const role = monRole(derniere);
      journal(`TON TOUR (${type} n°${action.id}), rôle ${role || "aucun"} : action prévue dans ${delai} s`);
      resultat({ type, prevu: true, delaiSecondes: delai, role });
      const id = action.id;
      prevues.set(id, { type, minuterie: setTimeout(() => executer(id, type), delai * 1000) });
    }
  }

  function arreter() {
    for (const { minuterie } of prevues.values()) clearTimeout(minuterie);
    prevues.clear();
  }

  return { surSession, arreter };
}

// --- Appels au client ------------------------------------------------------------------------

const reussi = (status) => status >= 200 && status < 300;

/** L'action n° actionId est-elle vraiment verrouillée ? (relu dans la session du client) */
async function estVerrouillee(connexion, actionId) {
  const session = await lireJsonOuNull(connexion, ROUTE_SESSION);
  const action = toutesLesActions(session).find((a) => a.id === actionId);
  return Boolean(action && action.completed === true);
}

/**
 * Survole puis verrouille un champion pour ton action, et VÉRIFIE que c'est verrouillé.
 * Vu sur le vrai client (02/10/2026) : PATCH { championId } puis POST .../complete répondaient tous les deux
 * 204, mais le champion restait seulement survolé. On verrouille donc d'abord avec PATCH { championId,
 * completed: true } (méthode des outils de la communauté), on relit la session, et si ce n'est pas
 * verrouillé on essaie POST .../complete.
 */
async function effectuerAction(dossierJeu, actionId, championId, { attenteMs = 400 } = {}) {
  const connexion = lireLockfile(dossierJeu);
  const route = routeAction(actionId);

  const verrou = await appelerClient(connexion, route, { methode: "PATCH", corps: { championId, completed: true } });
  if (!reussi(verrou.status)) throw new ErreurClient(`Le client a refusé le champion (code ${verrou.status}).`);
  await new Promise((ok) => setTimeout(ok, attenteMs)); // le client met un instant à mettre la session à jour
  if (await estVerrouillee(connexion, actionId)) return;

  await appelerClient(connexion, `${route}/complete`, { methode: "POST" });
  await new Promise((ok) => setTimeout(ok, attenteMs));
  if (await estVerrouillee(connexion, actionId)) return;
  throw new ErreurClient("Champion survolé, mais le client ne l'a pas verrouillé. Verrouille-le toi-même.");
}

/** Identifiants des champions que le client te laisse choisir ("pick") ou bannir ("ban"), ou null. */
async function lireChampionsAutorises(dossierJeu, type) {
  const ids = await lireJsonOuNull(lireLockfile(dossierJeu), ROUTES_AUTORISES[type]);
  return Array.isArray(ids) ? ids.filter((id) => Number.isInteger(id) && id > 0) : null;
}

module.exports = {
  ROLES,
  LISTES_PICKS,
  NB_CHOIX,
  DELAI_MAX_SECONDES,
  normaliserReglagesSelection,
  monRole,
  monActionEnCours,
  championsIndisponibles,
  listePourPick,
  listePourAction,
  choisirChampion,
  delaiEffectif,
  creerSelectionAuto,
  effectuerAction,
  lireChampionsAutorises,
};
