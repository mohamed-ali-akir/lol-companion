/*
 * Réglages de l'appli enregistrés sur l'ordinateur
 * ------------------------------------------------
 * Fichier : <userData>/config.json, par exemple %APPDATA%\lol-level-calculator\config.json.
 * Ce dossier appartient à l'utilisateur Windows : il n'est jamais dans le projet, donc jamais dans Git.
 *
 * On y garde :
 *  - le dossier où League of Legends est installé (pour trouver le lockfile du client) ;
 *  - le dernier compte lu dans le client, pour l'afficher même quand le client est fermé ;
 *  - l'onglet ouvert, pour le rouvrir au prochain lancement ;
 *  - les réglages de l'acceptation automatique (désactivée par défaut) ;
 *  - les réglages du pick et du ban automatiques et tes listes de champions (désactivés par défaut) ;
 *  - les réglages du build automatique : stats OP.GG, runes, set d'objets (désactivés par défaut) ;
 *  - les réglages de la session (début de session, alertes de pause) ;
 *  - les réglages de l'arrière-plan (fermer = réduire, démarrage avec Windows).
 * L'appli n'utilise plus de clé API Riot.
 */
const fs = require("fs");
const path = require("path");
const { normaliserReglages } = require("./acceptation.js");
const { normaliserReglagesSelection } = require("./selection.js");
const { normaliserReglagesBuild } = require("./build.js");
const { normaliserReglagesSession } = require("./src/calculs.js");
const { normaliserReglagesArrierePlan } = require("./arriere-plan.js");

const DOSSIER_JEU_PAR_DEFAUT = "C:\\Riot Games\\League of Legends";

// Réglages des anciennes versions (clé API, recherche en ligne) : plus utilisés.
const ANCIENS_REGLAGES = ["cleApi", "cleApiChiffree", "dernierRiotId", "region"];

class ErreurStockage extends Error {}

function creerStockage({ dossier }) {
  const fichier = path.join(dossier, "config.json");

  function lire() {
    try {
      return JSON.parse(fs.readFileSync(fichier, "utf-8"));
    } catch {
      return {}; // pas encore de fichier (ou fichier abîmé) : réglages vides
    }
  }

  function ecrire(config) {
    fs.mkdirSync(dossier, { recursive: true });
    fs.writeFileSync(fichier, JSON.stringify(config, null, 2));
  }

  function modifier(changements) {
    const config = { ...lire(), ...changements };
    for (const cle of Object.keys(config)) if (config[cle] === undefined) delete config[cle];
    ecrire(config);
  }

  /**
   * Efface les réglages des anciennes versions, dont la clé API si elle avait été enregistrée.
   * Appelé au démarrage de l'appli : une clé qui ne sert plus n'a rien à faire sur le disque.
   */
  function nettoyerAnciensReglages() {
    const config = lire();
    if (!ANCIENS_REGLAGES.some((cle) => cle in config)) return false;
    for (const cle of ANCIENS_REGLAGES) delete config[cle];
    ecrire(config);
    return true;
  }

  function dossierJeu() {
    return lire().dossierJeu || DOSSIER_JEU_PAR_DEFAUT;
  }

  function enregistrerDossierJeu(dossierDuJeu) {
    const texte = String(dossierDuJeu || "").trim();
    if (!texte) return modifier({ dossierJeu: undefined }); // vide = revenir au dossier par défaut
    if (!path.win32.isAbsolute(texte) && !path.isAbsolute(texte)) {
      throw new ErreurStockage("Indique un chemin complet, par exemple D:\\Jeux\\Riot Games\\League of Legends.");
    }
    modifier({ dossierJeu: texte });
  }

  /**
   * Enregistre le dernier compte lu dans le client (un seul : si le Riot ID change,
   * l'ancien compte est simplement remplacé).
   */
  function enregistrerDernierCompte(compte, date = new Date()) {
    modifier({
      dernierCompte: {
        nom: compte.nom || "",
        tag: compte.tag || "",
        niveau: compte.niveau,
        progression: compte.progression,
        stats: compte.stats || {},
        date: date.toISOString(),
      },
    });
  }

  /** Le dernier compte enregistré, ou null s'il n'y en a pas (ou s'il est abîmé). */
  function dernierCompte() {
    const c = lire().dernierCompte;
    const valide =
      c && Number.isInteger(c.niveau) && c.niveau >= 1 && Number.isFinite(c.progression) && !Number.isNaN(Date.parse(c.date));
    return valide ? c : null;
  }

  /** Onglet ouvert en dernier (juste un nom court en minuscules ; la page vérifie qu'il existe). */
  function ongletActif() {
    const nom = lire().ongletActif;
    return typeof nom === "string" && /^[a-z]{1,20}$/.test(nom) ? nom : null;
  }

  function enregistrerOngletActif(nom) {
    if (typeof nom !== "string" || !/^[a-z]{1,20}$/.test(nom)) throw new ErreurStockage("Nom d'onglet invalide.");
    if (lire().ongletActif !== nom) modifier({ ongletActif: nom }); // pas d'écriture inutile
  }

  /** Réglages de l'acceptation automatique, toujours valides (désactivée par défaut). */
  function reglagesAcceptation() {
    return normaliserReglages(lire().acceptationAuto);
  }

  function enregistrerReglagesAcceptation(reglages) {
    const propres = normaliserReglages(reglages);
    modifier({ acceptationAuto: propres });
    return propres;
  }

  /** Réglages du pick et du ban automatiques (onglet Sélection), toujours valides (désactivés par défaut). */
  function reglagesSelection() {
    return normaliserReglagesSelection(lire().selectionAuto);
  }

  function enregistrerReglagesSelection(reglages) {
    const propres = normaliserReglagesSelection(reglages);
    modifier({ selectionAuto: propres });
    return propres;
  }

  /**
   * Build automatique (onglet Build) : stats OP.GG, page de runes, set d'objets ; tout désactivé par défaut.
   * L'ancien réglage "runesAuto" (runes seules) est repris puis effacé au premier enregistrement.
   */
  function reglagesBuild() {
    const config = lire();
    return normaliserReglagesBuild(config.buildAuto, config.runesAuto);
  }

  function enregistrerReglagesBuild(reglages) {
    const propres = normaliserReglagesBuild(reglages);
    modifier({ buildAuto: propres, runesAuto: undefined });
    return propres;
  }

  /** Réglages du bilan de session et des alertes de pause, toujours valides. */
  function reglagesSession() {
    return normaliserReglagesSession(lire().session);
  }

  function enregistrerReglagesSession(reglages) {
    const propres = normaliserReglagesSession(reglages);
    modifier({ session: propres });
    return propres;
  }

  /** Réglages du fonctionnement en arrière-plan (fermer = réduire, démarrage de Windows). */
  function reglagesArrierePlan() {
    return normaliserReglagesArrierePlan(lire().arrierePlan);
  }

  function enregistrerReglagesArrierePlan(reglages) {
    const propres = normaliserReglagesArrierePlan(reglages);
    modifier({ arrierePlan: propres });
    return propres;
  }

  /** A-t-on déjà expliqué que l'appli tourne toujours quand la fenêtre est cachée ? (une seule fois) */
  function dejaPrevenuReduction() {
    return lire().prevenuReduction === true;
  }

  function noterPrevenuReduction() {
    modifier({ prevenuReduction: true });
  }

  return {
    lire,
    modifier,
    reglagesAcceptation,
    enregistrerReglagesAcceptation,
    reglagesSelection,
    enregistrerReglagesSelection,
    reglagesBuild,
    enregistrerReglagesBuild,
    reglagesArrierePlan,
    enregistrerReglagesArrierePlan,
    dejaPrevenuReduction,
    noterPrevenuReduction,
    reglagesSession,
    enregistrerReglagesSession,
    nettoyerAnciensReglages,
    dossierJeu,
    enregistrerDossierJeu,
    enregistrerDernierCompte,
    dernierCompte,
    ongletActif,
    enregistrerOngletActif,
  };
}

module.exports = { creerStockage, ErreurStockage, DOSSIER_JEU_PAR_DEFAUT };
