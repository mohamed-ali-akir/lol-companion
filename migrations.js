/*
 * Version des fichiers de données, et migrations d'une version à la suivante (17/10/2026)
 * -----------------------------------------------------------------------------------------
 * Tourne dans le processus principal (Node), une fois au démarrage, avant de lire les données.
 *
 * Pourquoi : config.json, parties.json, progression.json et maitrise.json n'avaient pas de numéro de version. Le jour
 * où leur format change (un champ renommé, une liste rangée autrement), l'appli n'aurait aucun moyen de savoir si un
 * fichier est à l'ancien ou au nouveau format : soit elle le lirait mal, soit elle le jetterait (les lectures sont
 * tolérantes : un fichier illisible repart de zéro), et l'historique du joueur serait perdu.
 *
 * Choix : les fichiers gardent leur forme actuelle (une ancienne version de l'appli les lit donc toujours) ; seule une
 * clé « versionDonnees » est ajoutée dans config.json. Au démarrage :
 *  - fichiers plus anciens que l'appli : chaque migration manquante est appliquée, dans l'ordre, après une copie de
 *    sécurité des fichiers dans « sauvegarde-avant-vN » (on peut toujours revenir en arrière à la main) ;
 *  - fichiers écrits par une version PLUS RÉCENTE de l'appli (retour à une ancienne version) : copie de sécurité dans
 *    « sauvegarde-donnees-vN » avant que cette ancienne version ne les réécrive, et message dans le journal.
 *
 * Pour changer un format plus tard : ajouter une migration { vers: 2, nom, appliquer } dans MIGRATIONS et passer
 * VERSION_DONNEES à 2. appliquer({ dossier, lireJson, ecrireJson }) modifie les fichiers ; elle doit accepter des
 * fichiers absents ou abîmés (un joueur peut n'avoir jamais joué).
 */
const fs = require("fs");
const path = require("path");
const fichiers = require("./fichiers.js"); // écriture sûre (copie .bak)

const VERSION_DONNEES = 1; // format actuel des fichiers (celui de toutes les versions jusqu'au 17/10/2026 compris)
const FICHIERS_DONNEES = ["config.json", "parties.json", "progression.json", "maitrise.json", "deadlock.json"]; // deadlock.json : mode Deadlock, 27/10/2026
const CLE_VERSION = "versionDonnees";

/**
 * Migrations, de la plus ancienne à la plus récente : [{ vers, nom, appliquer({ dossier, lireJson, ecrireJson }) }].
 * Aucune pour l'instant : la version 1 est le format d'aujourd'hui.
 */
const MIGRATIONS = [];

/**
 * Migrations à appliquer pour passer de la version « depuis » à la version « vers » (fonction pure, testée).
 * Erreur claire si une étape manque ou si la liste est dans le désordre : mieux vaut ne rien faire que mal migrer.
 */
function migrationsAFaire(depuis, vers = VERSION_DONNEES, migrations = MIGRATIONS) {
  if (!Number.isInteger(depuis) || !Number.isInteger(vers) || depuis >= vers) return [];
  const aFaire = [];
  for (let v = depuis + 1; v <= vers; v++) {
    const etapes = migrations.filter((m) => m && m.vers === v);
    if (etapes.length !== 1) throw new Error(`Migration des données vers la version ${v} ${etapes.length ? "en double" : "manquante"}.`);
    if (typeof etapes[0].appliquer !== "function") throw new Error(`Migration vers la version ${v} sans fonction appliquer.`);
    aFaire.push(etapes[0]);
  }
  return aFaire;
}

/** Version des fichiers d'après config.json : un nombre, ou 1 (les fichiers d'avant le numéro de version). */
function versionLue(config) {
  const v = config && typeof config === "object" ? config[CLE_VERSION] : undefined;
  return Number.isInteger(v) && v >= 1 ? v : 1;
}

/** Copie les fichiers de données présents (et leur copie .bak) dans dossier/nomSauvegarde. Rien n'est effacé. */
function sauvegarder(dossier, nomSauvegarde) {
  const cible = path.join(dossier, nomSauvegarde);
  const copies = [];
  for (const nom of FICHIERS_DONNEES) {
    for (const f of [nom, `${nom}.bak`]) {
      const source = path.join(dossier, f);
      if (!fs.existsSync(source)) continue;
      fs.mkdirSync(cible, { recursive: true });
      fs.copyFileSync(source, path.join(cible, f));
      copies.push(f);
    }
  }
  return copies;
}

function lireConfig(dossier) {
  try {
    return fichiers.lireJson(path.join(dossier, "config.json"));
  } catch {
    return {}; // pas encore de config (premier lancement) ou fichier abîmé (signalé par fichiers.js)
  }
}

function ecrireVersion(dossier, version) {
  const config = lireConfig(dossier);
  if (config[CLE_VERSION] === version) return;
  fichiers.ecrireJson(path.join(dossier, "config.json"), { ...config, [CLE_VERSION]: version }, { espaces: 2 });
}

/**
 * Met les fichiers de données au format de cette version de l'appli. N'échoue jamais : une erreur est notée dans le
 * journal et l'appli continue avec les fichiers tels quels (les lectures restent tolérantes).
 * -> { etat: "a-jour" | "migre" | "plus-recent" | "erreur", depuis, vers }
 */
function migrerDonnees({ dossier, journal = () => {}, version = VERSION_DONNEES, migrations = MIGRATIONS }) {
  let depuis = 1;
  try {
    depuis = versionLue(lireConfig(dossier));
    if (depuis > version) {
      const nom = `sauvegarde-donnees-v${depuis}`;
      if (!fs.existsSync(path.join(dossier, nom))) {
        const copies = sauvegarder(dossier, nom);
        journal(`Données écrites par une version plus récente de l'appli (format ${depuis}, celle-ci lit le ${version}) : copie gardée dans ${nom} (${copies.length} fichiers).`);
      }
      return { etat: "plus-recent", depuis, vers: version };
    }
    const aFaire = migrationsAFaire(depuis, version, migrations);
    for (const m of aFaire) {
      const copies = sauvegarder(dossier, `sauvegarde-avant-v${m.vers}`);
      m.appliquer({ dossier, lireJson: fichiers.lireJson, ecrireJson: fichiers.ecrireJson });
      ecrireVersion(dossier, m.vers); // après chaque étape : une coupure au milieu reprend à l'étape suivante
      journal(`Données migrées vers le format ${m.vers} (${m.nom}) ; copie d'avant : sauvegarde-avant-v${m.vers} (${copies.length} fichiers).`);
    }
    ecrireVersion(dossier, version);
    return { etat: aFaire.length ? "migre" : "a-jour", depuis, vers: version };
  } catch (erreur) {
    journal(`Migration des données impossible : ${erreur.message}`);
    return { etat: "erreur", depuis, vers: version };
  }
}

module.exports = { VERSION_DONNEES, FICHIERS_DONNEES, CLE_VERSION, MIGRATIONS, migrationsAFaire, versionLue, migrerDonnees };
