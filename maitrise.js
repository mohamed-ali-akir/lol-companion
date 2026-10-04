/*
 * Onglet "Maîtrise" : lecture de la maîtrise des champions dans le client
 * ----------------------------------------------------------------------
 * Tourne dans le processus principal (Node). Lecture seule.
 *
 * Routes (non documentées officiellement par Riot) :
 *  - /lol-champion-mastery/v1/local-player/champion-mastery : maîtrise du joueur connecté ;
 *  - secours : /lol-champion-mastery/v1/<puuid>/champion-mastery (utilisée par le projet LeagueAkari).
 *
 * Format depuis la refonte de 2024 (vérifié dans les types de LeagueAkari et dans la doc de
 * champion-mastery-v4 de Riot) :
 *   { championId, championLevel, championPoints,
 *     championPointsSinceLastLevel, championPointsUntilNextLevel,   // points dans le niveau / restants
 *     markRequiredForNextLevel,   // marques de maîtrise nécessaires pour passer le niveau (0 aux petits niveaux)
 *     tokensEarned,               // marques déjà obtenues pour ce niveau
 *     championSeasonMilestone, milestoneGrades,                     // palier de la saison, notes obtenues
 *     nextSeasonMilestone: { requireGradeCounts: { "A-": 1 }, rewardMarks, bonus },  // prochain palier
 *     highestGrade, lastPlayTime }
 * Depuis 2024, il n'y a plus de niveau maximum : à partir d'un certain niveau, il faut à la fois
 * des points ET des marques de maîtrise (gagnées avec de bonnes notes en partie).
 * Chaque champ est lu prudemment : s'il manque, on affiche moins de choses, sans planter.
 *
 * Estimation "≈ N parties" : le client ne dit pas combien de points chaque partie a rapportés.
 * L'appli le mesure elle-même : à chaque lecture, elle compare les points d'un champion avec la
 * lecture précédente, et compte les nouvelles parties jouées avec lui (parties.json).
 * Exemple : +1 800 points et 2 nouvelles parties -> un échantillon "1 800 points en 2 parties".
 * Ces échantillons sont gardés dans <userData>/maitrise.json.
 */
const fs = require("fs");
const path = require("path");
const { lireLockfile, lireJson, lireJsonOuNull, extraireInvocateur, ROUTE_COMPTE, ErreurClient } = require("./lcu.js");

const ROUTE_MAITRISE = "/lol-champion-mastery/v1/local-player/champion-mastery";
const routeMaitrisePuuid = (puuid) => `/lol-champion-mastery/v1/${encodeURIComponent(puuid)}/champion-mastery`;

// --- Normalisation (fonctions pures, testées) ---------------------------------------------

const positifOuNull = (n) => (Number.isFinite(n) ? Math.max(0, Math.floor(n)) : null);
const NOTE = /^[SABCD][+-]?$/;

/** { "A-": 1 } -> [{ note: "A-", nombre: 1 }] (valeurs abîmées ignorées). */
function lireNotesRequises(objet) {
  if (!objet || typeof objet !== "object" || Array.isArray(objet)) return [];
  return Object.entries(objet)
    .filter(([note, nombre]) => NOTE.test(note) && Number.isInteger(nombre) && nombre > 0)
    .map(([note, nombre]) => ({ note, nombre }));
}

/**
 * Une entrée du client -> format simple pour la page, ou null si inutilisable (pas d'id de champion).
 * { championId, niveau, points, depuisNiveau, restants, marquesRequises, marquesObtenues,
 *   marquesManquantes, palier, notesPalier, meilleureNote, dernierePartie }
 */
function normaliserMaitrise(brute) {
  if (!brute || typeof brute !== "object") return null;
  const championId = brute.championId;
  if (!Number.isInteger(championId) || championId <= 0) return null;

  const requises = positifOuNull(brute.markRequiredForNextLevel);
  const obtenues = positifOuNull(brute.tokensEarned);
  const palier = brute.nextSeasonMilestone && typeof brute.nextSeasonMilestone === "object" ? brute.nextSeasonMilestone : null;
  const notesRequises = palier ? lireNotesRequises(palier.requireGradeCounts) : [];

  return {
    championId,
    niveau: positifOuNull(brute.championLevel),
    points: positifOuNull(brute.championPoints) ?? 0,
    depuisNiveau: positifOuNull(brute.championPointsSinceLastLevel),
    // Peut être négatif quand les points sont atteints mais pas les marques : on ramène à 0.
    restants: positifOuNull(brute.championPointsUntilNextLevel),
    marquesRequises: requises,
    marquesObtenues: obtenues,
    marquesManquantes: requises === null ? 0 : Math.max(0, requises - (obtenues ?? 0)),
    palier: notesRequises.length
      ? { notes: notesRequises, marques: positifOuNull(palier.rewardMarks), bonus: palier.bonus === true }
      : null,
    notesPalier: Array.isArray(brute.milestoneGrades) ? brute.milestoneGrades.filter((n) => typeof n === "string" && NOTE.test(n)) : [],
    meilleureNote: typeof brute.highestGrade === "string" && NOTE.test(brute.highestGrade) ? brute.highestGrade : null,
    dernierePartie: Number.isFinite(brute.lastPlayTime) && brute.lastPlayTime > 0 ? brute.lastPlayTime : null,
  };
}

/** Réponse du client (liste, ou objet { masteries: [...] }) -> liste normalisée. null si le format est inconnu. */
function normaliserListe(donnees) {
  const liste = Array.isArray(donnees) ? donnees : donnees && Array.isArray(donnees.masteries) ? donnees.masteries : null;
  if (!liste) return null;
  const vus = new Set();
  return liste.map(normaliserMaitrise).filter((m) => m && !vus.has(m.championId) && vus.add(m.championId));
}

// --- Points gagnés par partie (fonctions pures, testées) ---------------------------------------

const FENETRE_MS = 3 * 60 * 60 * 1000; // une partie commencée jusqu'à 3 h avant une lecture peut ne pas encore y être comptée
const MAX_PARTIES_ECHANTILLON = 10; // au-delà, on ne sait plus bien quoi attribuer à quoi : on n'en tire rien
const MAX_ECHANTILLONS_PAR_CHAMPION = 30;
const FILES_SANS_MAITRISE = new Set([0]); // parties personnalisées : pas de points de maîtrise

function etatVide() {
  return { releves: {}, echantillons: [] };
}

function etatValide(etat) {
  if (!etat || typeof etat !== "object") return etatVide();
  const releves = etat.releves && typeof etat.releves === "object" && !Array.isArray(etat.releves) ? etat.releves : {};
  const echantillons = Array.isArray(etat.echantillons)
    ? etat.echantillons.filter(
        (e) => e && Number.isInteger(e.championId) && Number.isFinite(e.points) && e.points > 0 && Number.isInteger(e.parties) && e.parties > 0
      )
    : [];
  return { releves, echantillons };
}

/**
 * Compare la maîtrise lue maintenant avec la lecture précédente et ajoute des échantillons
 * "N points en M parties" quand c'est clair. Renvoie un nouvel état (l'ancien n'est pas modifié).
 *  - points en plus ET nouvelles parties avec ce champion : échantillon, puis nouvelle référence ;
 *  - l'un sans l'autre (le client n'a pas encore tout mis à jour) : on attend la prochaine lecture ;
 *  - rien de nouveau : rien à faire.
 */
function mettreAJourSuivi(ancien, maitrises, parties, maintenant = Date.now()) {
  const etat = etatValide(ancien);
  const releves = { ...etat.releves };
  const echantillons = [...etat.echantillons];
  const partiesUtiles = (Array.isArray(parties) ? parties : []).filter(
    (p) => p && Number.isFinite(p.id) && Number.isFinite(p.date) && !FILES_SANS_MAITRISE.has(p.file)
  );
  const idsRecents = (championId) =>
    partiesUtiles.filter((p) => p.championId === championId && p.date >= maintenant - FENETRE_MS).map((p) => p.id);

  for (const m of Array.isArray(maitrises) ? maitrises : []) {
    if (!m || !Number.isInteger(m.championId) || !Number.isFinite(m.points)) continue;
    const cle = String(m.championId);
    const avant = releves[cle];
    const nouvelleReference = { points: m.points, date: maintenant, ids: idsRecents(m.championId) };
    if (!avant || !Number.isFinite(avant.points) || !Number.isFinite(avant.date) || !Array.isArray(avant.ids)) {
      releves[cle] = nouvelleReference; // première lecture de ce champion
      continue;
    }
    const gain = m.points - avant.points;
    const dejaVues = new Set(avant.ids);
    const nouvelles = partiesUtiles.filter(
      (p) => p.championId === m.championId && p.date >= avant.date - FENETRE_MS && !dejaVues.has(p.id)
    );
    if (gain < 0) {
      releves[cle] = nouvelleReference; // incohérent (compte différent ?) : on repart de zéro
    } else if (gain > 0 && nouvelles.length > 0) {
      if (nouvelles.length <= MAX_PARTIES_ECHANTILLON) {
        echantillons.push({ championId: m.championId, points: gain, parties: nouvelles.length, date: maintenant });
      }
      releves[cle] = nouvelleReference;
    }
    // sinon : rien de nouveau, ou une moitié seulement (points ou parties) -> on attend
  }

  // On garde les échantillons les plus récents de chaque champion.
  const parChampion = new Map();
  for (const e of echantillons) parChampion.set(e.championId, [...(parChampion.get(e.championId) || []), e]);
  const gardes = [...parChampion.values()].flatMap((liste) => liste.slice(-MAX_ECHANTILLONS_PAR_CHAMPION));
  return { releves, echantillons: gardes };
}

/** Moyenne de points par partie pour chaque champion : Map id -> { moyenne, parties }. */
function moyennesParChampion(echantillons) {
  const totaux = new Map();
  for (const e of Array.isArray(echantillons) ? echantillons : []) {
    if (!e || !Number.isInteger(e.championId) || !(e.points > 0) || !(e.parties > 0)) continue;
    const t = totaux.get(e.championId) || { points: 0, parties: 0 };
    totaux.set(e.championId, { points: t.points + e.points, parties: t.parties + e.parties });
  }
  const moyennes = new Map();
  for (const [id, t] of totaux) moyennes.set(id, { moyenne: Math.round(t.points / t.parties), parties: t.parties });
  return moyennes;
}

// --- Fichier maitrise.json ---------------------------------------------------------------------

function creerSuiviMaitrise({ dossier }) {
  const fichier = path.join(dossier, "maitrise.json");

  function toutLire() {
    try {
      const donnees = JSON.parse(fs.readFileSync(fichier, "utf-8"));
      return donnees && typeof donnees === "object" && !Array.isArray(donnees) ? donnees : {};
    } catch {
      return {}; // pas encore de fichier, ou fichier abîmé
    }
  }

  return {
    lire: (riotId) => etatValide(toutLire()[riotId]),
    enregistrer(riotId, etat) {
      const tout = toutLire();
      tout[riotId] = etat;
      fs.mkdirSync(dossier, { recursive: true });
      fs.writeFileSync(fichier, JSON.stringify(tout));
    },
    effacer() {
      try {
        fs.unlinkSync(fichier);
      } catch (erreur) {
        if (erreur.code !== "ENOENT") throw erreur;
      }
    },
  };
}

// --- Lecture dans le client -----------------------------------------------------------------------

/** Point d'entrée : { compte: { nom, tag }, maitrises }. */
async function recupererMaitrise(dossierJeu) {
  const connexion = lireLockfile(dossierJeu);
  const donnees = await lireJson(connexion, ROUTE_COMPTE);
  const compte = extraireInvocateur(donnees);

  let maitrises = normaliserListe(await lireJsonOuNull(connexion, ROUTE_MAITRISE));
  if (maitrises === null && typeof donnees.puuid === "string" && donnees.puuid) {
    maitrises = normaliserListe(await lireJsonOuNull(connexion, routeMaitrisePuuid(donnees.puuid)));
  }
  if (maitrises === null) throw new ErreurClient("Le client League n'a pas donné ta maîtrise des champions. Réessaie dans un instant.");
  return { compte: { nom: compte.nom, tag: compte.tag }, maitrises };
}

module.exports = {
  ROUTE_MAITRISE,
  normaliserMaitrise,
  normaliserListe,
  mettreAJourSuivi,
  moyennesParChampion,
  creerSuiviMaitrise,
  recupererMaitrise,
  FENETRE_MS,
};
