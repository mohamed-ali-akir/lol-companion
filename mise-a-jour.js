/*
 * Mise à jour automatique de l'appli (electron-updater, Releases GitHub du dépôt public)
 * --------------------------------------------------------------------------------------
 * Exception décidée par le propriétaire le 11/10/2026 : l'appli contacte github.com pour savoir s'il existe
 * une version plus récente (fichier latest.yml de la dernière Release du dépôt mohamed-ali-akir/lol-companion).
 *  - vérification 15 s après le démarrage, puis toutes les 6 h (désactivable : Paramètres, Arrière-plan) ;
 *  - si une version plus récente existe, elle est téléchargée en arrière-plan ; electron-updater vérifie son
 *    empreinte (sha512 de latest.yml) avant de l'accepter ;
 *  - une fois prête : bandeau dans l'appli « Redémarrer et mettre à jour ». Si tu l'ignores, elle s'installe
 *    quand tu quittes l'appli. Jamais de redémarrage forcé (par exemple en pleine sélection des champions).
 * On n'envoie rien de personnel : electron-updater ne fait que télécharger des fichiers publics.
 * Ce module ne dépend pas d'Electron : main.js lui donne l'objet "autoUpdater" (un faux dans les tests).
 */

const DELAI_PREMIERE_VERIFICATION_MS = 15 * 1000; // laisse l'appli démarrer tranquillement
const INTERVALLE_VERIFICATION_MS = 6 * 60 * 60 * 1000; // l'appli peut rester ouverte des jours en arrière-plan

/**
 * Crée le suivi des mises à jour.
 *  - updater      : autoUpdater d'electron-updater (ou un faux : on(), checkForUpdates(), quitAndInstall()) ;
 *  - version      : version actuelle de l'appli (ex. "1.1.0") ;
 *  - actif()      : la vérification automatique est-elle cochée ? (relu à chaque fois) ;
 *  - envoyer(etat): prévient la page ; etat = { etape, version, nouvelle, pourcentage, message } ;
 *  - journal(...) : note les étapes dans journal.txt.
 * Étapes : "attente" (rien à signaler), "recherche", "a-jour", "telechargement", "prete", "erreur".
 */
function creerMiseAJour({
  updater,
  version,
  actif = () => true,
  envoyer = () => {},
  journal = () => {},
  delaiMs = DELAI_PREMIERE_VERIFICATION_MS,
  intervalleMs = INTERVALLE_VERIFICATION_MS,
}) {
  let etat = { etape: "attente", version, nouvelle: null, pourcentage: null, message: null };
  let minuterieDepart = null;
  let minuterieIntervalle = null;

  function changer(modifs) {
    etat = { ...etat, ...modifs };
    envoyer({ ...etat });
  }

  updater.autoDownload = true; // télécharge tout seul dès qu'une version plus récente existe
  updater.autoInstallOnAppQuit = true; // si tu ne cliques pas sur le bandeau : installée quand tu quittes
  updater.logger = null; // electron-updater écrirait dans la console : on note nous-mêmes dans le journal

  updater.on("checking-for-update", () => {
    if (etat.etape !== "telechargement" && etat.etape !== "prete") changer({ etape: "recherche", message: null });
  });
  updater.on("update-not-available", () => changer({ etape: "a-jour", nouvelle: null, message: null }));
  updater.on("update-available", (info) => {
    journal("Mise à jour : version", info && info.version, "trouvée, téléchargement");
    changer({ etape: "telechargement", nouvelle: (info && info.version) || null, pourcentage: 0, message: null });
  });
  updater.on("download-progress", (progres) => {
    const pourcentage = progres && Number.isFinite(progres.percent) ? Math.round(progres.percent) : null;
    if (pourcentage !== etat.pourcentage) changer({ etape: "telechargement", pourcentage });
  });
  updater.on("update-downloaded", (info) => {
    journal("Mise à jour : version", info && info.version, "prête (installée au prochain redémarrage)");
    changer({ etape: "prete", nouvelle: (info && info.version) || etat.nouvelle, pourcentage: 100, message: null });
  });
  updater.on("error", (erreur) => {
    journal("Mise à jour : ERREUR", erreur && erreur.message);
    // Une mise à jour déjà prête le reste (une vérification suivante peut échouer sans rien casser).
    if (etat.etape !== "prete") changer({ etape: "erreur", message: "Impossible de vérifier les mises à jour (Internet ou GitHub indisponible)." });
  });

  /** Cherche une mise à jour (sauf si la vérification est décochée, ou si une version est déjà prête). */
  async function verifier({ forcer = false } = {}) {
    if (!forcer && !actif()) return false;
    if (etat.etape === "prete" || etat.etape === "telechargement") return false;
    try {
      await updater.checkForUpdates();
      return true;
    } catch (erreur) {
      // electron-updater prévient aussi par l'événement "error" : on ne fait que le noter ici.
      journal("Mise à jour : vérification impossible", erreur && erreur.message);
      return false;
    }
  }

  return {
    demarrer() {
      this.arreter();
      minuterieDepart = setTimeout(() => verifier(), delaiMs);
      minuterieIntervalle = setInterval(() => verifier(), intervalleMs);
    },
    arreter() {
      clearTimeout(minuterieDepart);
      clearInterval(minuterieIntervalle);
      minuterieDepart = null;
      minuterieIntervalle = null;
    },
    /** Bouton « Vérifier maintenant » : même si la vérification automatique est décochée. */
    verifierMaintenant: () => verifier({ forcer: true }),
    /** Bouton du bandeau : installe et relance l'appli. Faux si aucune version n'est prête. */
    installer() {
      if (etat.etape !== "prete") return false;
      journal("Mise à jour : installation de la version", etat.nouvelle);
      updater.quitAndInstall(true, true); // installation silencieuse, puis l'appli se relance
      return true;
    },
    lire: () => ({ ...etat }),
  };
}

// --- Au lancement : installer la mise à jour AVANT d'ouvrir l'appli (Windows, 17/10/2026) ----------------------

const DELAI_RECHERCHE_DEMARRAGE_MS = 10 * 1000; // GitHub lent ou pas d'Internet : on n'attend pas plus
const DELAI_TELECHARGEMENT_DEMARRAGE_MS = 3 * 60 * 1000; // environ 95 Mo ; au-delà, l'appli s'ouvre et finit en arrière-plan

/**
 * Au lancement de l'appli (choix du propriétaire, 17/10/2026) : s'il existe une version plus récente, on la télécharge
 * et on l'installe tout de suite (installation silencieuse, puis l'appli se relance dans la nouvelle version), AVANT
 * d'ouvrir quoi que ce soit. Jamais bloquant : sans réponse de GitHub en 10 s, ou téléchargement trop long, ou erreur,
 * l'appli démarre normalement (le téléchargement en cours se finit en arrière-plan : bandeau habituel ensuite).
 *  - updater    : autoUpdater d'electron-updater (un faux dans les tests) ;
 *  - trouvee(v) : prévenu quand une version plus récente est trouvée (main.js affiche « Mise à jour… ») ;
 *  - progression(pourcentage) : avancement du téléchargement.
 * Résultat (promesse) : "installation" (l'appli va se fermer pour s'installer), "a-jour", "erreur" ou "trop-long".
 */
function majAuDemarrage({
  updater,
  journal = () => {},
  trouvee = () => {},
  progression = () => {},
  delaiRechercheMs = DELAI_RECHERCHE_DEMARRAGE_MS,
  delaiTelechargementMs = DELAI_TELECHARGEMENT_DEMARRAGE_MS,
}) {
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.logger = null;
  return new Promise((resoudre) => {
    let fini = false;
    let minuterie = null;
    const ecouteurs = {};
    const terminer = (resultat) => {
      if (fini) return;
      fini = true;
      clearTimeout(minuterie);
      for (const [evenement, f] of Object.entries(ecouteurs)) updater.removeListener(evenement, f);
      resoudre(resultat);
    };
    const ecouter = (evenement, f) => {
      ecouteurs[evenement] = f;
      updater.on(evenement, f);
    };
    const attendre = (ms, raison) => {
      clearTimeout(minuterie);
      minuterie = setTimeout(() => {
        journal(`Mise à jour au lancement : ${raison}, l'appli démarre (elle finira en arrière-plan)`);
        terminer("trop-long");
      }, ms);
    };
    ecouter("update-not-available", () => terminer("a-jour"));
    ecouter("error", (erreur) => {
      journal("Mise à jour au lancement : impossible", erreur && erreur.message);
      terminer("erreur");
    });
    ecouter("update-available", (info) => {
      journal("Mise à jour au lancement : version", info && info.version, "trouvée, installation avant d'ouvrir l'appli");
      trouvee(info && info.version);
      attendre(delaiTelechargementMs, "téléchargement trop long");
    });
    ecouter("download-progress", (p) => progression(p && Number.isFinite(p.percent) ? Math.round(p.percent) : null));
    ecouter("update-downloaded", (info) => {
      journal("Mise à jour au lancement : installation de la version", info && info.version);
      terminer("installation");
      updater.quitAndInstall(true, true); // installation silencieuse, puis l'appli se relance
    });
    attendre(delaiRechercheMs, "GitHub ne répond pas");
    Promise.resolve()
      .then(() => updater.checkForUpdates())
      .catch((erreur) => {
        journal("Mise à jour au lancement : impossible", erreur && erreur.message);
        terminer("erreur");
      });
  });
}

// --- Mac : vérification seulement (16/10/2026) ---------------------------------------------------
// Sur Mac, electron-updater ne peut installer qu'une appli signée par Apple (compte payant) : l'appli ne fait donc
// que VÉRIFIER. Elle lit latest.yml de la dernière Release (le même fichier que la mise à jour de Windows, publié
// à chaque version) et, s'il annonce une version plus récente, le bandeau propose d'ouvrir la page de téléchargement.
// Même exception que sur Windows (github.com, désactivable), rien de personnel envoyé (internet.js).

const DEPOT = "mohamed-ali-akir/lol-companion";
const ADRESSE_LATEST_YML = `https://github.com/${DEPOT}/releases/latest/download/latest.yml`;
const PAGE_TELECHARGEMENT = `https://github.com/${DEPOT}/releases/latest`; // fixe : jamais une adresse reçue

/** Version annoncée par latest.yml ("version: 1.2.0"), ou null si le fichier est inattendu. */
function versionDepuisLatestYml(texte) {
  const m = /^version:\s*["']?(\d+\.\d+\.\d+)["']?\s*$/m.exec(String(texte || ""));
  return m ? m[1] : null;
}

/** Compare deux versions "X.Y.Z" : 1 si a est plus récente, -1 si plus ancienne, 0 si égales (ou illisibles). */
function comparerVersions(a, b) {
  const lire = (v) => (/^\d+\.\d+\.\d+$/.test(String(v || "")) ? String(v).split(".").map(Number) : null);
  const [va, vb] = [lire(a), lire(b)];
  if (!va || !vb) return 0;
  for (let i = 0; i < 3; i++) if (va[i] !== vb[i]) return va[i] > vb[i] ? 1 : -1;
  return 0;
}

/**
 * Vérification des versions pour Mac, avec les mêmes fonctions que creerMiseAJour (le reste de l'appli ne voit
 * pas la différence). Étapes : "attente", "recherche", "a-jour", "disponible" (nouvelle = la version), "erreur".
 *  - lireLatestYml() : texte de latest.yml (promesse ; internet.js dans main.js, un faux dans les tests) ;
 *  - ouvrir(adresse) : ouvre la page de téléchargement dans le navigateur (shell.openExternal dans main.js).
 */
function creerVerificationMac({
  lireLatestYml,
  ouvrir,
  version,
  actif = () => true,
  envoyer = () => {},
  journal = () => {},
  delaiMs = DELAI_PREMIERE_VERIFICATION_MS,
  intervalleMs = INTERVALLE_VERIFICATION_MS,
}) {
  let etat = { etape: "attente", version, nouvelle: null, pourcentage: null, message: null, raison: "mac" };
  let minuterieDepart = null;
  let minuterieIntervalle = null;
  let enCours = false;

  function changer(modifs) {
    etat = { ...etat, ...modifs };
    envoyer({ ...etat });
  }

  async function verifier({ forcer = false } = {}) {
    if ((!forcer && !actif()) || enCours) return false;
    enCours = true;
    if (etat.etape !== "disponible") changer({ etape: "recherche", message: null });
    try {
      const derniere = versionDepuisLatestYml(await lireLatestYml());
      if (!derniere) throw new Error("latest.yml illisible");
      if (comparerVersions(derniere, version) > 0) {
        if (etat.nouvelle !== derniere) journal("Mise à jour (Mac) : version", derniere, "disponible au téléchargement");
        changer({ etape: "disponible", nouvelle: derniere, message: null });
      } else {
        changer({ etape: "a-jour", nouvelle: null, message: null });
      }
      return true;
    } catch (erreur) {
      journal("Mise à jour (Mac) : vérification impossible", erreur && erreur.message);
      // Une version déjà annoncée le reste (une vérification suivante peut échouer sans rien casser).
      if (etat.etape !== "disponible") changer({ etape: "erreur", message: "Impossible de vérifier les mises à jour (Internet ou GitHub indisponible)." });
      return false;
    } finally {
      enCours = false;
    }
  }

  return {
    demarrer() {
      this.arreter();
      minuterieDepart = setTimeout(() => verifier(), delaiMs);
      minuterieIntervalle = setInterval(() => verifier(), intervalleMs);
    },
    arreter() {
      clearTimeout(minuterieDepart);
      clearInterval(minuterieIntervalle);
      minuterieDepart = null;
      minuterieIntervalle = null;
    },
    verifierMaintenant: () => verifier({ forcer: true }),
    /** Bouton du bandeau : ouvre la page de téléchargement (adresse fixe). Faux si aucune version n'est annoncée. */
    installer() {
      if (etat.etape !== "disponible") return false;
      journal("Mise à jour (Mac) : ouverture de la page de téléchargement");
      ouvrir(PAGE_TELECHARGEMENT);
      return true;
    },
    lire: () => ({ ...etat }),
  };
}

module.exports = {
  creerMiseAJour,
  majAuDemarrage,
  DELAI_RECHERCHE_DEMARRAGE_MS,
  creerVerificationMac,
  versionDepuisLatestYml,
  comparerVersions,
  ADRESSE_LATEST_YML,
  PAGE_TELECHARGEMENT,
  DELAI_PREMIERE_VERIFICATION_MS,
  INTERVALLE_VERIFICATION_MS,
};
