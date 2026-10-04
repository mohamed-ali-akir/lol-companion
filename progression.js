/*
 * Suivi de progression dans le temps
 * ----------------------------------
 * À chaque lecture du compte, on ajoute un point dans <userData>/progression.json :
 *   { date, riotId, niveau, progression, xpTotale }
 * La page s'en sert pour dessiner ta courbe d'XP et calculer ton rythme réel.
 *
 * Fichier séparé de config.json : il peut grossir (jusqu'à 1000 points par compte),
 * et on peut l'effacer sans toucher aux réglages.
 *
 * Les fonctions "pures" (sans fichier) sont exportées pour être testées facilement.
 */
const fs = require("fs");
const path = require("path");

const MAX_POINTS_PAR_COMPTE = 1000;

/** "Pseudo#TAG" (ou juste le pseudo s'il n'y a pas de tag). */
function riotIdDe(compte) {
  const nom = (compte && compte.nom) || "Compte";
  return compte && compte.tag ? `${nom}#${compte.tag}` : nom;
}

/** Garde uniquement les points bien formés (le fichier a pu être abîmé ou modifié à la main). */
function pointsValides(donnees) {
  if (!Array.isArray(donnees)) return [];
  return donnees.filter(
    (p) =>
      p &&
      typeof p.riotId === "string" &&
      Number.isInteger(p.niveau) &&
      Number.isFinite(p.progression) &&
      Number.isFinite(p.xpTotale) &&
      !Number.isNaN(Date.parse(p.date))
  );
}

/**
 * Ajoute un point à la liste (sans modifier la liste reçue) :
 *  - pas de doublon : si rien n'a changé depuis le dernier point de ce compte, on ne l'ajoute pas ;
 *  - au maximum MAX_POINTS_PAR_COMPTE points par compte : on supprime les plus anciens.
 * Renvoie { points, ajoute }.
 */
function ajouterPoint(points, point, max = MAX_POINTS_PAR_COMPTE) {
  const duCompte = points.filter((p) => p.riotId === point.riotId);
  const dernier = duCompte[duCompte.length - 1];
  if (dernier && dernier.niveau === point.niveau && dernier.progression === point.progression) {
    return { points, ajoute: false };
  }

  let resultat = [...points, point];
  const enTrop = duCompte.length + 1 - max;
  if (enTrop > 0) {
    // On retire les "enTrop" plus anciens points de CE compte, sans toucher aux autres comptes.
    let aRetirer = enTrop;
    resultat = resultat.filter((p) => !(p.riotId === point.riotId && aRetirer-- > 0));
  }
  return { points: resultat, ajoute: true };
}

/** Crée le point à enregistrer à partir d'un compte lu dans le client. */
function creerPoint(compte, xpTotale, date = new Date()) {
  return {
    date: date.toISOString(),
    riotId: riotIdDe(compte),
    niveau: compte.niveau,
    progression: compte.progression,
    xpTotale: Math.round(xpTotale),
  };
}

function creerProgression({ dossier }) {
  const fichier = path.join(dossier, "progression.json");

  function lire() {
    try {
      return pointsValides(JSON.parse(fs.readFileSync(fichier, "utf-8")));
    } catch {
      return []; // pas encore de fichier, ou fichier abîmé : on repart de zéro
    }
  }

  function ecrire(points) {
    fs.mkdirSync(dossier, { recursive: true });
    fs.writeFileSync(fichier, JSON.stringify(points));
  }

  /** Ajoute un point (si quelque chose a changé). Renvoie true s'il a été ajouté. */
  function ajouter(point) {
    const { points, ajoute } = ajouterPoint(lire(), point);
    if (ajoute) ecrire(points);
    return ajoute;
  }

  /** Les points d'un compte, du plus ancien au plus récent. */
  function pointsDu(riotId) {
    return lire()
      .filter((p) => p.riotId === riotId)
      .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  }

  function effacer() {
    try {
      fs.unlinkSync(fichier);
    } catch (erreur) {
      if (erreur.code !== "ENOENT") throw erreur; // déjà effacé : pas grave
    }
  }

  return { ajouter, pointsDu, effacer, lire };
}

module.exports = { creerProgression, ajouterPoint, creerPoint, pointsValides, riotIdDe, MAX_POINTS_PAR_COMPTE };
