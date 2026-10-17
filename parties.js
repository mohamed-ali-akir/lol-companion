/*
 * Historique local des parties (pour l'onglet Stats)
 * --------------------------------------------------
 * Le client League ne garde que tes parties récentes (20 à 50). Pour que tes stats s'enrichissent
 * avec le temps, l'appli garde chaque partie lue dans <userData>/parties.json :
 *   { riotId, id, date, dureeS, file, championId, championNom, victoire, kills, deaths, assists }
 * + depuis le 17/10/2026, quand le client les donne : cs, or, degats, vision (résumé d'après-partie).
 * Une partie n'est jamais enregistrée deux fois (même compte + même identifiant de partie).
 * Au maximum MAX_PARTIES_PAR_COMPTE parties par compte : au-delà, les plus anciennes sont oubliées.
 * Les fonctions pures (sans fichier) sont exportées pour être testées.
 */
const path = require("path");
const { lireJson, ecrireJson, effacerJson } = require("./fichiers.js"); // écriture sûre (copie .bak)

// Assez pour un compte très joué (des années de parties), tout en gardant un fichier raisonnable (~5 Mo).
const MAX_PARTIES_PAR_COMPTE = 25000;

const entierPositif = (n) => Number.isInteger(n) && n >= 0;

// Détails facultatifs (résumé d'après-partie, depuis le 17/10/2026) : absents des parties plus anciennes.
const DETAILS = ["cs", "or", "degats", "vision"];
const sansDetails = (p) => DETAILS.every((cle) => !(cle in p));

/** Copie de la partie sans les détails abîmés (un détail illisible est oublié, la partie est gardée). */
function nettoyerDetails(p) {
  const propre = { ...p };
  for (const cle of DETAILS) if (cle in propre && !(Number.isFinite(propre[cle]) && propre[cle] >= 0)) delete propre[cle];
  return propre;
}

/** Garde uniquement les parties bien formées (le fichier a pu être abîmé ou modifié à la main). */
function partiesValides(donnees) {
  if (!Array.isArray(donnees)) return [];
  return donnees
    .filter(
      (p) =>
        p &&
        typeof p.riotId === "string" &&
        Number.isFinite(p.id) &&
        Number.isFinite(p.date) &&
        typeof p.victoire === "boolean" &&
        entierPositif(p.kills) &&
        entierPositif(p.deaths) &&
        entierPositif(p.assists)
    )
    .map(nettoyerDetails);
}

/**
 * Parties déjà enregistrées SANS détails (versions d'avant le 17/10/2026) que le client relit AVEC :
 * on leur ajoute les détails, pour que le résumé d'après-partie ait tout de suite une moyenne.
 * Renvoie { parties, completees } (sans modifier la liste reçue).
 */
function completerDetails(existantes, riotId, nouvelles) {
  const details = new Map();
  for (const p of Array.isArray(nouvelles) ? nouvelles : []) {
    if (p && Number.isFinite(p.id) && !sansDetails(p)) details.set(p.id, p);
  }
  let completees = 0;
  const parties = existantes.map((p) => {
    const lue = p.riotId === riotId && sansDetails(p) ? details.get(p.id) : null;
    if (!lue) return p;
    completees++;
    const ajout = nettoyerDetails(Object.fromEntries(DETAILS.filter((cle) => cle in lue).map((cle) => [cle, lue[cle]])));
    return { ...p, ...ajout };
  });
  return { parties: completees ? parties : existantes, completees };
}

/**
 * Ajoute les nouvelles parties d'un compte à la liste, sans doublons (sans modifier la liste reçue).
 * noms : Map id du champion -> nom (facultatif), pour garder le nom même quand le client est fermé.
 * Renvoie { parties, ajoutees }.
 */
function fusionnerParties(existantes, riotId, nouvelles, { noms = new Map(), max = MAX_PARTIES_PAR_COMPTE } = {}) {
  const dejaVues = new Set(existantes.filter((p) => p.riotId === riotId).map((p) => p.id));
  const aAjouter = [];
  for (const p of Array.isArray(nouvelles) ? nouvelles : []) {
    if (!p || !Number.isFinite(p.id) || dejaVues.has(p.id)) continue;
    dejaVues.add(p.id); // doublon dans la même lecture : ignoré aussi
    aAjouter.push({ riotId, ...p, championNom: noms.get(p.championId) || p.championNom || null });
  }
  const valides = partiesValides(aAjouter);
  if (valides.length === 0) return { parties: existantes, ajoutees: 0 };

  // Limite par compte : on garde les plus récentes.
  const duCompte = [...existantes.filter((p) => p.riotId === riotId), ...valides].sort((a, b) => b.date - a.date).slice(0, max);
  const autres = existantes.filter((p) => p.riotId !== riotId);
  return { parties: [...autres, ...duCompte], ajoutees: valides.filter((p) => duCompte.includes(p)).length };
}

function creerHistoriqueParties({ dossier }) {
  const fichier = path.join(dossier, "parties.json");

  function lire() {
    try {
      return partiesValides(lireJson(fichier));
    } catch {
      return []; // pas encore de fichier, ou fichier abîmé : on repart de zéro
    }
  }

  /** Ajoute les parties lues dans le client (et complète les anciennes). Renvoie le nombre de parties nouvelles. */
  function ajouter(riotId, nouvelles, noms) {
    const { parties: completes, completees } = completerDetails(lire(), riotId, nouvelles);
    const { parties, ajoutees } = fusionnerParties(completes, riotId, nouvelles, { noms });
    if (ajoutees > 0 || completees > 0) {
      ecrireJson(fichier, parties);
    }
    return ajoutees;
  }

  /** Parties d'un compte, de la plus récente à la plus ancienne. */
  function partiesDu(riotId) {
    return lire()
      .filter((p) => p.riotId === riotId)
      .sort((a, b) => b.date - a.date);
  }

  function effacer() {
    effacerJson(fichier); // le fichier et sa copie .bak
  }

  return { lire, ajouter, partiesDu, effacer };
}

module.exports = { creerHistoriqueParties, fusionnerParties, partiesValides, completerDetails, MAX_PARTIES_PAR_COMPTE };
