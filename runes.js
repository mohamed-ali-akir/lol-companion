/*
 * Runes : page "LoL Companion" et runes recommandées par Riot
 * ------------------------------------------------------------
 * Tourne dans le processus principal (Node). Utilisé par build.js (onglet "Build").
 *
 * Quand tu as ton champion (verrouillé en sélection, ou attribué en ARAM), l'appli crée une page de runes
 * "LoL Companion" : runes d'OP.GG (build.js), ou, en secours, les runes RECOMMANDÉES PAR RIOT pour ce champion
 * et ton rôle (calculées par Riot sur les statistiques des joueurs, "recommendationId" = date).
 * Autorisé par Riot (comme l'import de runes de Blitz ou Porofessor). Désactivé par défaut.
 *
 * Routes vérifiées sur le client le 02/10/2026 :
 *   GET    /lol-perks/v1/recommended-pages/champion/{id}/position/{pos}/map/{mapId}
 *          -> [{ primaryPerkStyleId, secondaryPerkStyleId, perks: [{ id, name }] (9), keystone: { name }, position }]
 *          pos : "top", "jungle", "middle", "bottom", "utility" ou "none" ; mapId : 11 (Faille), 12 (Abîme hurlant)
 *   GET    /lol-perks/v1/pages      -> tes pages [{ id, name, isEditable }]
 *   GET    /lol-perks/v1/inventory  -> { canAddCustomPage }
 *   GET    /lol-gameflow/v1/session -> { map: { id } } (carte de la partie)
 *   POST   /lol-perks/v1/pages { name, primaryStyleId, subStyleId, selectedPerkIds, current: true }
 *   DELETE /lol-perks/v1/pages/{id}
 *
 * Règle : l'appli ne touche QU'À SA page. Tes autres pages ne sont jamais modifiées.
 * Nom de sa page (10/10/2026) : « Hwei · Mid · LoL Companion ». La longueur maximale d'un nom de page n'est documentée
 * nulle part : si le client refuse ou raccourcit le nom, l'appli essaie « Hwei · Mid · LoLC », puis « LoL Companion ».
 * Elle reconnaît sa page à cette fin de nom (et l'ancien nom « LoL Companion » tout court).
 */
const { lireLockfile, lireJsonOuNull, appelerClient, ErreurClient } = require("./lcu.js");
const { monRole } = require("./selection.js");

const NOM_PAGE = "LoL Companion";
const MARQUE_COURTE = "LoLC";
const POSTES_COURTS = { top: "Top", jungle: "Jungle", middle: "Mid", bottom: "ADC", utility: "Support" };
const NB_RUNES = 9; // 1 clé de voûte + 3 principales + 2 secondaires + 3 fragments
const CARTE_PAR_DEFAUT = 11; // Faille de l'invocateur

// --- Fonctions pures (testées) ------------------------------------------------------------

/**
 * Ton champion, une fois qu'il est à toi : { championId, role }, ou null.
 *  - partie avec choix (Draft, Classée...) : ton action "pick" doit être verrouillée (completed) ;
 *  - partie sans choix (ARAM) : pas d'action "pick", le champion attribué compte tout de suite.
 */
function monChampion(session) {
  if (!session || typeof session !== "object" || !Number.isInteger(session.localPlayerCellId)) return null;
  const cellule = session.localPlayerCellId;
  const moi = (Array.isArray(session.myTeam) ? session.myTeam : []).find((j) => j && j.cellId === cellule);
  if (!moi || !Number.isInteger(moi.championId) || moi.championId <= 0) return null;
  const actions = Array.isArray(session.actions) ? session.actions.flat().filter((a) => a && typeof a === "object") : [];
  const mesPicks = actions.filter((a) => a.actorCellId === cellule && a.type === "pick");
  if (mesPicks.length > 0 && !mesPicks.some((a) => a.completed === true)) return null; // seulement survolé
  return { championId: moi.championId, role: monRole(session) };
}

/** Noms à essayer pour la page, du plus joli au plus court : ["Hwei · Mid · LoL Companion", "Hwei · Mid · LoLC", "LoL Companion"]. */
function nomsPage(nomChampion, role) {
  const debut = [String(nomChampion || "").trim(), POSTES_COURTS[role]].filter(Boolean).join(" · ");
  const noms = debut ? [`${debut} · ${NOM_PAGE}`, `${debut} · ${MARQUE_COURTE}`, NOM_PAGE] : [NOM_PAGE];
  return noms.filter((n, i) => noms.indexOf(n) === i);
}

/** Cette page a-t-elle été créée par l'appli ? (d'après la fin de son nom) */
function estPageAppli(nom) {
  const n = String(nom || "");
  return n === NOM_PAGE || n.endsWith(` · ${NOM_PAGE}`) || n.endsWith(` · ${MARQUE_COURTE}`);
}

/** Page de runes prête à envoyer, à partir d'une recommandation de Riot, ou null si elle est incomplète. */
function pageDepuisRecommandation(reco) {
  if (!reco || typeof reco !== "object") return null;
  const ids = Array.isArray(reco.perks) ? reco.perks.map((p) => p && p.id) : [];
  const valides = ids.length === NB_RUNES && ids.every((id) => Number.isInteger(id) && id > 0);
  if (!valides || !Number.isInteger(reco.primaryPerkStyleId) || !Number.isInteger(reco.secondaryPerkStyleId)) return null;
  return {
    name: NOM_PAGE,
    primaryStyleId: reco.primaryPerkStyleId,
    subStyleId: reco.secondaryPerkStyleId,
    selectedPerkIds: ids,
    current: true,
  };
}

// --- Appels au client ------------------------------------------------------------------------

const reussi = (status) => status >= 200 && status < 300;

/** Pages recommandées par Riot pour ce champion, ce rôle et la carte de la partie en cours. */
async function lireRecommandations(dossierJeu, championId, role) {
  const connexion = lireLockfile(dossierJeu);
  const partie = await lireJsonOuNull(connexion, "/lol-gameflow/v1/session");
  const carte = partie && partie.map && Number.isInteger(partie.map.id) ? partie.map.id : CARTE_PAR_DEFAUT;
  const route = `/lol-perks/v1/recommended-pages/champion/${championId}/position/${role || "none"}/map/${carte}`;
  const pages = await lireJsonOuNull(connexion, route);
  return Array.isArray(pages) ? pages : [];
}

/**
 * Remplace la page de l'appli (et seulement elle) par la nouvelle, et la sélectionne.
 * noms : noms à essayer dans l'ordre (voir nomsPage) ; renvoie le nom finalement gardé par le client.
 */
async function appliquerPage(dossierJeu, page, { noms = [page.name || NOM_PAGE] } = {}) {
  const connexion = lireLockfile(dossierJeu);
  const pages = await lireJsonOuNull(connexion, "/lol-perks/v1/pages");
  const anciennes = Array.isArray(pages) ? pages.filter((p) => p && estPageAppli(p.name) && p.isEditable !== false) : [];
  if (anciennes.length > 0) {
    for (const ancienne of anciennes) {
      const { status } = await appelerClient(connexion, `/lol-perks/v1/pages/${ancienne.id}`, { methode: "DELETE" });
      if (!reussi(status)) throw new ErreurClient(`Impossible de remplacer la page « ${ancienne.name} » (code ${status}).`);
    }
  } else {
    const inventaire = await lireJsonOuNull(connexion, "/lol-perks/v1/inventory");
    if (inventaire && inventaire.canAddCustomPage === false) {
      throw new ErreurClient("Plus de place pour une page de runes : supprime une de tes pages dans le client.");
    }
  }
  let dernierStatut = null;
  for (const nom of noms) {
    const reponse = await appelerClient(connexion, "/lol-perks/v1/pages", { methode: "POST", corps: { ...page, name: nom } });
    dernierStatut = reponse.status;
    if (!reussi(reponse.status)) continue; // nom refusé (trop long ?) : on essaie le suivant
    let creee = null;
    try {
      creee = JSON.parse(reponse.corps);
    } catch {
      // pas de réponse lisible : on considère que le nom est accepté tel quel
    }
    if (creee && typeof creee.name === "string" && creee.name !== nom && Number.isInteger(creee.id)) {
      // Le client a raccourci le nom : on ne la reconnaîtrait plus la prochaine fois. On la retire et on essaie plus court.
      await appelerClient(connexion, `/lol-perks/v1/pages/${creee.id}`, { methode: "DELETE" });
      continue;
    }
    return nom;
  }
  throw new ErreurClient(`Le client a refusé la page de runes (code ${dernierStatut}).`);
}

module.exports = {
  NOM_PAGE,
  nomsPage,
  estPageAppli,
  monChampion,
  pageDepuisRecommandation,
  lireRecommandations,
  appliquerPage,
};
