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
 *  - effacement : le fichier ET sa copie (sinon la copie reviendrait à la lecture suivante) ;
 *  - un fichier présent mais illisible est SIGNALÉ (surProbleme : main.js l'écrit dans journal.txt) et mis de côté
 *    une fois en « fichier.abime » avant d'être réécrit, pour pouvoir récupérer ses données à la main.
 */
const fs = require("fs");
const path = require("path");

const copie = (fichier) => `${fichier}.bak`;
const abime = (fichier) => `${fichier}.abime`;
let signaler = () => {}; // prévenu quand un fichier est abîmé (main.js : journal.txt)
const dejaSignales = new Set(); // une seule fois par fichier et par lancement

/** signaler(message) : appelée quand un fichier de données présent est illisible (copie .bak relue ou pas). */
function surProbleme(fonction) {
  signaler = typeof fonction === "function" ? fonction : () => {};
}
const temporaire = (fichier) => `${fichier}.tmp`;

/** Contenu JSON de fichier (ou de sa copie .bak s'il est absent ou abîmé). Erreur si aucun des deux n'est lisible. */
function lireJson(fichier) {
  let derniere = null;
  let principalAbime = false;
  for (const f of [fichier, copie(fichier)]) {
    try {
      const valeur = JSON.parse(fs.readFileSync(f, "utf-8"));
      if (principalAbime) prevenir(fichier, `${path.basename(fichier)} abîmé : copie de secours (.bak) relue`);
      return valeur;
    } catch (erreur) {
      if (f === fichier && erreur.code !== "ENOENT") principalAbime = true; // présent mais illisible
      derniere = erreur;
    }
  }
  if (principalAbime) prevenir(fichier, `${path.basename(fichier)} illisible et pas de copie de secours : repart de zéro`);
  throw derniere;
}

/** Signale un fichier abîmé (une fois) et le met de côté en .abime, pour récupérer ses données à la main. */
function prevenir(fichier, message) {
  if (dejaSignales.has(fichier)) return;
  dejaSignales.add(fichier);
  try {
    fs.copyFileSync(fichier, abime(fichier));
    signaler(`${message} (fichier abîmé gardé : ${path.basename(abime(fichier))})`);
  } catch {
    signaler(message);
  }
}

/** Le fichier existe-t-il et contient-il du JSON valide ? */
function estLisible(fichier) {
  try {
    JSON.parse(fs.readFileSync(fichier, "utf-8"));
    return true;
  } catch {
    return false;
  }
}

/** Écrit valeur en JSON dans fichier, sans jamais laisser un fichier à moitié écrit (voir en tête). */
function ecrireJson(fichier, valeur, { espaces = 0 } = {}) {
  fs.mkdirSync(path.dirname(fichier), { recursive: true });
  const tmp = temporaire(fichier);
  fs.writeFileSync(tmp, JSON.stringify(valeur, null, espaces || undefined));
  try {
    // La version d'avant devient la copie de secours, seulement si elle est lisible (un fichier abîmé ne doit pas
    // écraser une bonne copie : il est déjà gardé à part en .abime par lireJson).
    if (estLisible(fichier)) fs.renameSync(fichier, copie(fichier));
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

module.exports = { lireJson, ecrireJson, effacerJson, surProbleme };
