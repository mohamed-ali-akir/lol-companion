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

module.exports = { creerMiseAJour, DELAI_PREMIERE_VERIFICATION_MS, INTERVALLE_VERIFICATION_MS };
