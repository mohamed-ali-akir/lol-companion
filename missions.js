/*
 * Onglet "Missions" : lecture des missions dans le client
 * -------------------------------------------------------
 * Tourne dans le processus principal (Node). Lecture seule : l'appli ne récupère aucune récompense.
 *
 * Route : GET /lol-missions/v1/missions -> liste de missions. Format vérifié dans le schéma du
 * client publié par la communauté (lcu-schema, "PlayerMissionDTO") :
 *   mission   : { id, title, description, status, endTime, completedDate, seriesName,
 *                 objectives: [...], rewards: [...] }
 *   objectif  : { description, sequence, status, progress: { currentProgress, totalCount } }
 *   récompense: { rewardType, description, quantity, itemId, uniqueName, rewardFulfilled }
 *
 * Ce que le schéma ne dit pas : le nom exact du type de récompense "XP de compte".
 * On le reconnaît donc prudemment (voir estRecompenseXp), et on écarte ce qui y ressemble
 * sans en être (boosts d'XP, XP de maîtrise, jetons de passe).
 *
 * Passe d'événement : aucune route vérifiable trouvée pour l'instant, donc on n'affiche rien
 * plutôt que d'inventer une progression.
 */
const { lireLockfile, lireJson, ErreurClient } = require("./lcu.js");

const ROUTE_MISSIONS = "/lol-missions/v1/missions";

// --- Reconnaître l'XP de compte ------------------------------------------------------------

const RESSEMBLE_A_XP = /(^|[^a-z])(xp|exp|experience|expérience)([^a-z]|$)/i;
const PAS_DE_L_XP_DE_COMPTE = /boost|mastery|maîtrise|maitrise|champion|pass|passe|token|jeton|tft|battle/i;

/** Une récompense donne-t-elle de l'XP de compte ? */
function estRecompenseXp(recompense) {
  if (!recompense || typeof recompense !== "object") return false;
  const textes = [recompense.rewardType, recompense.itemId, recompense.uniqueName, recompense.description]
    .filter((t) => typeof t === "string")
    .join(" ");
  const typeEstXp = /summoner[_ ]?xp|account[_ ]?xp|^xp$/i.test(recompense.rewardType || "");
  return (typeEstXp || RESSEMBLE_A_XP.test(textes)) && !PAS_DE_L_XP_DE_COMPTE.test(textes);
}

/** Quantité d'XP d'une récompense : "quantity" si c'est un vrai nombre, sinon le nombre écrit ("400 XP"). */
function xpDeRecompense(recompense) {
  if (!estRecompenseXp(recompense)) return 0;
  if (Number.isFinite(recompense.quantity) && recompense.quantity > 1) return recompense.quantity;
  const texte = `${recompense.description || ""} ${recompense.uniqueName || ""}`;
  const nombre = /(\d[\d\s.,]*)\s*(xp|exp)/i.exec(texte);
  if (!nombre) return 0;
  const valeur = Number(nombre[1].replace(/[\s.,]/g, ""));
  return Number.isFinite(valeur) && valeur > 0 ? valeur : 0;
}

// --- Normalisation (format simple pour la page) ---------------------------------------------

const entier = (n) => (Number.isFinite(n) ? Math.max(0, Math.floor(n)) : null);

/** Objectif lisible : { description, actuel, total } ou null. */
function normaliserObjectif(objectif) {
  if (!objectif || typeof objectif !== "object") return null;
  const p = objectif.progress || {};
  const total = entier(p.totalCount);
  const actuel = entier(p.currentProgress);
  return {
    description: typeof objectif.description === "string" ? objectif.description : "",
    actuel: actuel === null ? null : total ? Math.min(actuel, total) : actuel,
    total: total && total > 0 ? total : null,
    sequence: Number.isFinite(objectif.sequence) ? objectif.sequence : 0,
  };
}

/**
 * Mission lisible pour la page, ou null si elle est inutilisable (pas de titre) ou expirée.
 * { id, titre, description, serie, fin, terminee, objectifs, recompenses, xp, aRecuperer }
 */
function normaliserMission(mission, maintenant = Date.now()) {
  if (!mission || typeof mission !== "object") return null;
  const titre = typeof mission.title === "string" ? mission.title.trim() : "";
  if (!titre) return null;

  const fin = Number.isFinite(mission.endTime) && mission.endTime > 0 ? mission.endTime : null;
  if (fin !== null && fin < maintenant) return null; // expirée

  const objectifs = (Array.isArray(mission.objectives) ? mission.objectives : [])
    .map(normaliserObjectif)
    .filter(Boolean)
    .sort((a, b) => a.sequence - b.sequence);
  const recompenses = (Array.isArray(mission.rewards) ? mission.rewards : []).filter((r) => r && typeof r === "object");

  const statut = String(mission.status || "").toUpperCase();
  const objectifsFinis = objectifs.length > 0 && objectifs.every((o) => o.total !== null && o.actuel !== null && o.actuel >= o.total);
  const terminee = statut.startsWith("COMPLETE") || (Number.isFinite(mission.completedDate) && mission.completedDate > 0) || objectifsFinis;
  const aRecuperer = terminee && recompenses.some((r) => r.rewardFulfilled === false);

  return {
    id: String(mission.id || titre),
    titre,
    description: typeof mission.description === "string" ? mission.description : "",
    serie: typeof mission.seriesName === "string" ? mission.seriesName : "",
    fin,
    terminee,
    aRecuperer,
    objectifs: objectifs.map(({ description, actuel, total }) => ({ description, actuel, total })),
    recompenses: recompenses.map((r) => ({
      description: typeof r.description === "string" && r.description ? r.description : String(r.rewardType || "Récompense"),
      quantite: entier(r.quantity),
      xp: xpDeRecompense(r),
      recue: r.rewardFulfilled === true,
    })),
    // XP pas encore reçue : mission en cours, ou terminée mais récompense pas encore récupérée
    xp: recompenses.filter((r) => r.rewardFulfilled !== true).reduce((total, r) => total + xpDeRecompense(r), 0),
  };
}

/** Avancement d'une mission entre 0 et 1 (moyenne de ses objectifs), pour le tri. */
function avancement(mission) {
  const mesurables = mission.objectifs.filter((o) => o.total && o.actuel !== null);
  if (mesurables.length === 0) return 0;
  return mesurables.reduce((s, o) => s + o.actuel / o.total, 0) / mesurables.length;
}

/**
 * Ordre d'affichage :
 *  1. récompenses à récupérer ; 2. missions en cours qui donnent de l'XP ; 3. autres missions en cours ;
 *  4. missions terminées. Ensuite : celles qui finissent le plus tôt, puis les plus avancées, puis par titre.
 */
function trierMissions(missions) {
  const rang = (m) => (m.aRecuperer ? 0 : m.terminee ? 3 : m.xp > 0 ? 1 : 2);
  return [...missions].sort(
    (a, b) =>
      rang(a) - rang(b) ||
      (a.fin ?? Infinity) - (b.fin ?? Infinity) ||
      avancement(b) - avancement(a) ||
      a.titre.localeCompare(b.titre, "fr")
  );
}

/**
 * Résumé pour l'onglet, l'Accueil et le calcul :
 * { missions, xpDisponible, enCours, enCoursAvecXp, aRecuperer, xpARecuperer }.
 * xpDisponible = XP des missions EN COURS (celles affichées dans l'onglet ; les missions terminées n'y sont plus).
 */
function resumerMissions(brutes, maintenant = Date.now()) {
  const missions = trierMissions((Array.isArray(brutes) ? brutes : []).map((m) => normaliserMission(m, maintenant)).filter(Boolean));
  return {
    missions,
    xpDisponible: missions.filter((m) => !m.terminee).reduce((total, m) => total + m.xp, 0),
    enCours: missions.filter((m) => !m.terminee).length,
    enCoursAvecXp: missions.filter((m) => !m.terminee && m.xp > 0).length,
    aRecuperer: missions.filter((m) => m.aRecuperer).length,
    xpARecuperer: missions.filter((m) => m.aRecuperer).reduce((total, m) => total + m.xp, 0),
  };
}

/** Point d'entrée : lit les missions dans le client et les résume. */
async function recupererMissions(dossierJeu) {
  const connexion = lireLockfile(dossierJeu);
  const brutes = await lireJson(connexion, ROUTE_MISSIONS);
  if (!Array.isArray(brutes)) throw new ErreurClient("Réponse inattendue du client League (missions).");
  return resumerMissions(brutes);
}

module.exports = {
  estRecompenseXp,
  xpDeRecompense,
  normaliserMission,
  trierMissions,
  resumerMissions,
  recupererMissions,
};
