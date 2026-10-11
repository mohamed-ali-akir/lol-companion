/*
 * Fonctionnement en arrière-plan : réglages et décisions (fonctions pures, testées)
 * ------------------------------------------------------------------------------
 * main.js s'occupe de la partie Electron (icône dans la zone de notification, fenêtre, démarrage
 * avec Windows) ; ici, on décide seulement QUOI faire, sans toucher à Electron :
 *  - fermer la fenêtre : la cacher (l'appli continue de surveiller le client) ou quitter ;
 *  - lancement au démarrage de Windows : quoi passer à app.setLoginItemSettings ;
 *  - démarrage "réduit" : l'appli a-t-elle été lancée avec --reduit ?
 *  - League détecté : ouvrir la fenêtre, ou notification « LoL Companion est prêt » (quand, et quel texte) ;
 *  - le menu de l'icône (Ouvrir, Acceptation auto, Quitter).
 */

const ARGUMENT_REDUIT = "--reduit";

const REGLAGES_ARRIERE_PLAN_PAR_DEFAUT = {
  fermerReduit: true, // la croix cache la fenêtre au lieu de quitter (activé par défaut)
  lancerAuDemarrage: false, // lancer l'appli au démarrage de Windows (désactivé par défaut)
  demarrerReduit: false, // au démarrage de Windows : sans ouvrir la fenêtre
  prevenirClientDetecte: true, // notification « LoL Companion est prêt » quand League est détecté (fenêtre cachée)
  ouvrirAvecLeague: false, // ouvrir la fenêtre quand League se lance (fenêtre cachée ; désactivé par défaut)
};

/** Réglages toujours valides : une valeur absente ou abîmée prend la valeur par défaut. */
function normaliserReglagesArrierePlan(r) {
  const s = r && typeof r === "object" ? r : {};
  const d = REGLAGES_ARRIERE_PLAN_PAR_DEFAUT;
  const booleen = (valeur, defaut) => (typeof valeur === "boolean" ? valeur : defaut);
  const lancerAuDemarrage = booleen(s.lancerAuDemarrage, d.lancerAuDemarrage);
  return {
    fermerReduit: booleen(s.fermerReduit, d.fermerReduit),
    lancerAuDemarrage,
    // "Démarrer réduit" n'a de sens que si l'appli se lance avec Windows.
    demarrerReduit: lancerAuDemarrage && booleen(s.demarrerReduit, d.demarrerReduit),
    prevenirClientDetecte: booleen(s.prevenirClientDetecte, d.prevenirClientDetecte),
    ouvrirAvecLeague: booleen(s.ouvrirAvecLeague, d.ouvrirAvecLeague),
  };
}

/**
 * League vient d'être détecté : que faire ? "ouvrir" la fenêtre (option cochée), "notifier"
 * (« LoL Companion est prêt »), ou null. Rien si la fenêtre est déjà visible ou si c'est déjà fait
 * pour ce lancement de League.
 */
function actionClientDetecte({ reglages, fenetreVisible, dejaPrevenu }) {
  const r = normaliserReglagesArrierePlan(reglages);
  if (fenetreVisible || dejaPrevenu) return null;
  if (r.ouvrirAvecLeague) return "ouvrir";
  return r.prevenirClientDetecte ? "notifier" : null;
}

/** Texte de la notification : ce qui est actif (acceptation, pick/ban, build), ou une phrase simple. */
function texteClientDetecte({ acceptation = false, pick = false, ban = false, build = false } = {}) {
  const actifs = [];
  if (acceptation) actifs.push("acceptation auto");
  if (pick && ban) actifs.push("pick et ban auto");
  else if (pick) actifs.push("pick auto");
  else if (ban) actifs.push("ban auto");
  if (build) actifs.push("build auto");
  if (actifs.length === 0) return "League est détecté : l'appli suit ton compte en arrière-plan.";
  const liste = actifs.length === 1 ? actifs[0] : `${actifs.slice(0, -1).join(", ")} et ${actifs.at(-1)}`;
  return `League est détecté. Actif : ${liste}.`;
}

/**
 * Que faire quand on clique sur la croix de la fenêtre ?
 *  - "quitter" si tu as choisi "Quitter" (menu de l'icône), si le réglage est désactivé,
 *    ou si l'icône n'a pas pu être créée (sinon plus aucun moyen de rouvrir l'appli) ;
 *  - "cacher" sinon.
 */
function actionFermeture(reglages, { quitteEnCours = false, iconeDisponible = true } = {}) {
  if (quitteEnCours || !iconeDisponible) return "quitter";
  return normaliserReglagesArrierePlan(reglages).fermerReduit ? "cacher" : "quitter";
}

/**
 * Paramètres pour app.setLoginItemSettings (démarrage de Windows).
 *  - appli installée : on lance l'exécutable de l'appli ;
 *  - pendant le développement (npm start) : l'exécutable est electron.exe, il faut lui donner
 *    le dossier du projet en premier argument.
 * "--reduit" est ajouté si l'option "démarrer réduit" est cochée.
 */
function parametresDemarrageWindows(reglages, { executable, dossierAppli, emballee }) {
  const r = normaliserReglagesArrierePlan(reglages);
  const args = [];
  if (!emballee && dossierAppli) args.push(dossierAppli);
  if (r.demarrerReduit) args.push(ARGUMENT_REDUIT);
  return { openAtLogin: r.lancerAuDemarrage, path: executable, args };
}

/** L'appli a-t-elle été lancée réduite (par le démarrage de Windows) ? */
function estDemarrageReduit(argv) {
  return Array.isArray(argv) && argv.includes(ARGUMENT_REDUIT);
}

/** Faut-il expliquer (une seule fois) que l'appli tourne toujours après avoir caché la fenêtre ? */
function doitPrevenirReduction({ action, dejaPrevenu }) {
  return action === "cacher" && !dejaPrevenu;
}

/**
 * Modèle du menu de l'icône. main.js y branche les actions (clic) par "id".
 * La case "Acceptation auto" reflète le réglage actuel.
 */
function modeleMenuIcone({ acceptationActive }) {
  return [
    { id: "ouvrir", label: "Ouvrir LoL Companion" },
    { type: "separator" },
    { id: "acceptation", label: "Acceptation auto des parties", type: "checkbox", checked: Boolean(acceptationActive) },
    { type: "separator" },
    { id: "quitter", label: "Quitter" },
  ];
}

module.exports = {
  ARGUMENT_REDUIT,
  REGLAGES_ARRIERE_PLAN_PAR_DEFAUT,
  normaliserReglagesArrierePlan,
  actionFermeture,
  parametresDemarrageWindows,
  estDemarrageReduit,
  doitPrevenirReduction,
  actionClientDetecte,
  texteClientDetecte,
  modeleMenuIcone,
};
