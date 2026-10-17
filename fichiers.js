/*
 * Fichiers de données sur le disque (config.json, parties.json, progression.json, maitrise.json) : écriture sûre
 * -----------------------------------------------------------------------------------------------------------------
 * Tourne dans le processus principal (Node). Fonctions testées (test/fichiers.test.js).
 *
 * Pourquoi (17/10/2026) : avant, chaque fichier était réécrit directement. Si le PC s'éteignait pendant l'écriture,
 * le fichier restait à moitié écrit ; à la lecture suivante, l'appli le prenait pour un fichier vide, puis l'écrasait
 * à la partie suivante : tout l'historique était perdu sans un mot.
 * Maintenant :
 *  - écriture : le contenu va d'abord dans « fichier.tmp » ; puis l'ancien fichier devient « fichier.bak » et le
 *    temporaire prend sa place (deux renommages : quasi instantanés, jamais de fichier à moitié écrit) ;
 *  - lecture : si le fichier est absent ou abîmé, on lit la copie « .bak » (la version d'avant) ;
 *  - effacement : le fichier ET sa copie (sinon la copie reviendrait à la lecture suivante).
 */
const fs = require("fs");
const path = require("path");

const copie = (fichier) => `${fichier}.bak`;
const temporaire = (fichier) => `${fichier}.tmp`;

/** Contenu JSON de fichier (ou de sa copie .bak s'il est absent ou abîmé). Erreur si aucun des deux n'est lisible. */
function lireJson(fichier) {
  let derniere = null;
  for (const f of [fichier, copie(fichier)]) {
    try {
      return JSON.parse(fs.readFileSync(f, "utf-8"));
    } catch (erreur) {
      derniere = erreur;
    }
  }
  throw derniere;
}

/** Écrit valeur en JSON dans fichier, sans jamais laisser un fichier à moitié écrit (voir en tête). */
function ecrireJson(fichier, valeur, { espaces = 0 } = {}) {
  fs.mkdirSync(path.dirname(fichier), { recursive: true });
  const tmp = temporaire(fichier);
  fs.writeFileSync(tmp, JSON.stringify(valeur, null, espaces || undefined));
  try {
    if (fs.existsSync(fichier)) fs.renameSync(fichier, copie(fichier)); // la version d'avant, gardée en secours
    fs.renameSync(tmp, fichier);
  } catch (erreur) {
    // Renommage refusé (fichier verrouillé un instant par un antivirus...) : écriture directe, comme avant.
    fs.writeFileSync(fichier, fs.readFileSync(tmp));
    try {
      fs.unlinkSync(tmp);
    } catch {
      // le temporaire sera remplacé à la prochaine écriture
    }
  }
}

/** Efface fichier et sa copie .bak (sans erreur s'ils n'existent pas). */
function effacerJson(fichier) {
  for (const f of [fichier, copie(fichier), temporaire(fichier)]) {
    try {
      fs.unlinkSync(f);
    } catch (erreur) {
      if (erreur.code !== "ENOENT") throw erreur;
    }
  }
}

module.exports = { lireJson, ecrireJson, effacerJson };
