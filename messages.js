/*
 * Messages de la page et de la fenêtre transparente du jeu vers le processus principal (ipcMain)
 * ------------------------------------------------------------------------------------------------
 * Tourne dans le processus principal. Sorti de main.js le 17/10/2026 (main.js passait les 1 100 lignes et ses
 * messages n'étaient pas testés) : test/messages.test.js les essaie avec un faux ipcMain et de faux services.
 *
 * Chaque canal correspond à une fonction de preload.js (window.appli) ou de preload-overlay.js (window.overlay) ;
 * test/page.test.js vérifie que les deux listes restent d'accord.
 *
 * Deux règles pour tous les messages :
 *  - ORIGINE vérifiée : un message n'est accepté que de la fenêtre qui doit l'envoyer (la page de l'appli, ou la
 *    fenêtre transparente du jeu). Recommandation de sécurité d'Electron : une page étrangère qui arriverait à
 *    s'afficher dans l'appli ne pourrait rien demander ;
 *  - ERREUR jamais muette : une erreur inattendue est écrite dans le journal (signalerErreur), puis renvoyée à la
 *    page comme avant (la promesse de window.appli.xxx() échoue).
 */
const { ErreurClient } = require("./lcu.js");
const { ErreurStockage } = require("./stockage.js");
const { ErreurOpgg } = require("./opgg.js");
const { ErreurLolalytics } = require("./lolalytics.js");
const { ErreurDeadlockApi } = require("./deadlock-api.js");
const { assemblerBuild } = require("./build.js");
const { riotIdDe } = require("./progression.js");

// Erreurs « prévues » : leur message est déjà fait pour être lu par le joueur.
const ERREURS_PREVUES = [ErreurClient, ErreurStockage, ErreurOpgg, ErreurLolalytics, ErreurDeadlockApi];

/** Transforme une erreur en réponse simple pour la page : { ok: false, erreur, probleme }. */
function reponseErreur(erreur) {
  const prevue = ERREURS_PREVUES.some((type) => erreur instanceof type);
  const message = erreur && erreur.message ? erreur.message : String(erreur);
  return {
    ok: false,
    erreur: prevue ? message : `Erreur inattendue : ${message}`,
    probleme: (erreur && erreur.probleme) || null,
  };
}

/** Exécute action() et renvoie { ok: true, ...résultat } ou la réponse d'erreur (réglages enregistrés...). */
async function essayer(action) {
  try {
    return { ok: true, ...(await action()) };
  } catch (erreur) {
    return reponseErreur(erreur);
  }
}

/** Demande de consultation d'un build (onglet Build) -> { championId, role, mode }, ou null si elle est invalide. */
function lireDemandeBuild(demande) {
  const championId = Number(demande && demande.championId);
  if (!Number.isInteger(championId) || championId <= 0) return null;
  const role = typeof demande.role === "string" && demande.role ? demande.role : null;
  const mode = demande.mode === "aram" || demande.mode === "arena" ? demande.mode : "ranked";
  return { championId, role, mode };
}

/** Noms des champions (Map id -> nom) -> liste triée par nom pour les listes de l'onglet Sélection. */
function listeChampions(noms) {
  return [...noms]
    .filter(([id, nom]) => Number.isInteger(id) && id > 0 && typeof nom === "string")
    .map(([id, nom]) => ({ id, nom }))
    .sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
}

/**
 * Branche tous les messages. ipcMain : celui d'Electron (ou un faux dans les tests).
 * services : ce dont les messages ont besoin, lu au moment du message (les objets de main.js sont créés plus tard
 * ou changent : fenêtre recréée, surveillance relancée...) :
 *  - estPage(evenement), estOverlay(evenement) : le message vient-il de la page de l'appli / de la fenêtre du jeu ?
 *  - stockage(), progression(), historiqueParties() : fichiers de données ;
 *  - remettreSets() : tes sets sauvegardés remis dans le client (renvoie leur nombre) ;
 *  - config() : { dossierJeuParDefaut, plateforme, autorisationEcran, lancement } ;
 *  - lireCompte(), lireMaitrise(), importerHistorique(), obtenirNomsChampions(), analyserOpgg(c), analyserLolalytics(c) ;
 *  - lireChallenge() : progression du challenge Arena (challenge.js) ;
 *  - deadlock() : le service du mode Deadlock (deadlock.js) ;
 *  - apresReglagesAcceptation(), appliquerDemarrageWindows(reglages) ;
 *  - souris(dessus), clicSort(id) : fenêtre du jeu (panneau des sorts) ;
 *  - dernierConseil(), clientConnecte(), etatAppli() ;
 *  - majAppli() : suivi de la mise à jour, ou null ; versionAppli() ; avantInstallation() : appelée juste avant
 *    de quitter pour installer ;
 *  - proteger(nom, fonction), signalerErreur(nom, erreur) : cloisons de main.js.
 */
function brancherMessages(ipcMain, services) {
  const s = services;

  /** Réponse à une question de la page (ipcRenderer.invoke) : origine vérifiée, erreur jamais muette. */
  function repondre(canal, traiter) {
    ipcMain.handle(canal, async (evenement, ...args) => {
      if (!s.estPage(evenement)) throw new Error(`Message « ${canal} » refusé : il ne vient pas de la page de l'appli.`);
      try {
        return await traiter(...args);
      } catch (erreur) {
        s.signalerErreur(`message « ${canal} »`, erreur);
        throw erreur;
      }
    });
  }

  /** Message de la fenêtre transparente du jeu (ipcRenderer.send) : ignoré s'il vient d'ailleurs. */
  function ecouterOverlay(canal, traiter) {
    ipcMain.on(canal, (evenement, ...args) => {
      if (s.estOverlay(evenement)) s.proteger(`message « ${canal} » du jeu`, () => traiter(...args));
    });
  }

  // --- Réglages généraux ---
  repondre("config:lire", () => ({
    ...s.config(),
    dossierJeu: s.stockage().dossierJeu(),
    dernierCompte: s.stockage().dernierCompte(), // pour l'afficher même si le client est fermé
    ongletActif: s.stockage().ongletActif(), // pour rouvrir le même onglet
    assistantVu: s.stockage().assistantVu(), // assistant de première ouverture déjà vu ?
  }));
  repondre("config:assistantVu", () => s.stockage().noterAssistantVu());
  repondre("config:enregistrerOnglet", (nom) => essayer(() => s.stockage().enregistrerOngletActif(nom)));
  repondre("config:enregistrerDossierJeu", (dossier) =>
    essayer(() => {
      s.stockage().enregistrerDossierJeu(dossier);
      return { dossierJeu: s.stockage().dossierJeu() };
    })
  );

  // --- Compte, maîtrise, progression, historique (lus dans le client ou sur le disque) ---
  repondre("client:recuperer", () => s.lireCompte());
  repondre("maitrise:lire", () => s.lireMaitrise());
  repondre("progression:lire", (compte) => s.progression().pointsDu(riotIdDe(compte)));
  repondre("stats:lire", (compte) => s.historiqueParties().partiesDu(riotIdDe(compte)));
  repondre("stats:importer", () => s.importerHistorique());

  // --- Acceptation automatique (Paramètres), pick et ban (Sélection), build (Build) ---
  repondre("acceptation:lire", () => s.stockage().reglagesAcceptation());
  repondre("acceptation:enregistrer", (reglages) =>
    essayer(() => {
      const propres = s.stockage().enregistrerReglagesAcceptation(reglages);
      s.apresReglagesAcceptation(); // la case "Acceptation auto" du menu de l'icône suit le réglage
      return { reglages: propres };
    })
  );
  repondre("selection:lire", () => s.stockage().reglagesSelection());
  repondre("selection:enregistrer", (reglages) => essayer(() => ({ reglages: s.stockage().enregistrerReglagesSelection(reglages) })));
  repondre("selection:champions", async () => {
    const champions = listeChampions(await s.obtenirNomsChampions());
    if (champions.length === 0) return { ok: false, erreur: "Lance le client League pour charger la liste des champions." };
    return { ok: true, champions };
  });
  repondre("draft:lire", () => s.dernierConseil()); // si la page s'ouvre pendant une sélection
  // Challenge Arena (onglet Challenge) : progression recalculée depuis parties.json, et sa case de pick automatique.
  repondre("challenge:lire", () => s.lireChallenge());
  repondre("challenge:enregistrer", (reglages) => essayer(() => ({ reglages: s.stockage().enregistrerReglagesChallenge(reglages) })));
  repondre("build:lire", () => s.stockage().reglagesBuild());
  repondre("build:enregistrer", (reglages) => essayer(() => ({ reglages: s.stockage().enregistrerReglagesBuild(reglages) })));
  // « Remettre mes anciens sets » (onglet Build) : tes sets sauvegardés renvoyés au client -> { ok, remis }.
  repondre("build:remettreSets", () => essayer(async () => ({ remis: await s.remettreSets() })));
  // Consulter le build d'un champion (bouton de l'onglet Build) : lecture seule, rien n'est appliqué.
  repondre("build:consulter", async (demande) => {
    try {
      const contexte = lireDemandeBuild(demande);
      if (!contexte) return { ok: false, erreur: "Choisis un champion." };
      const [opgg, lolalytics] = await Promise.allSettled([s.analyserOpgg(contexte), s.analyserLolalytics(contexte)]);
      if (opgg.status === "rejected" && lolalytics.status === "rejected") throw lolalytics.reason;
      const { resume } = assemblerBuild({
        opgg: opgg.status === "fulfilled" ? opgg.value : null,
        emplacements: lolalytics.status === "fulfilled" ? lolalytics.value : null,
      });
      if (!resume) return { ok: false, erreur: "Pas assez de données pour ce champion et ce rôle." };
      const avertissement = lolalytics.status === "rejected" ? `${lolalytics.reason.message} Objets d'OP.GG affichés.` : null;
      const noms = await s.obtenirNomsChampions();
      return { ok: true, nom: noms.get(contexte.championId) || null, role: contexte.role, mode: contexte.mode, build: resume, avertissement };
    } catch (erreur) {
      return reponseErreur(erreur);
    }
  });

  // --- Arrière-plan (Paramètres) ---
  repondre("arrierePlan:lire", () => s.stockage().reglagesArrierePlan());
  repondre("arrierePlan:enregistrer", (reglages) =>
    essayer(() => {
      const propres = s.stockage().enregistrerReglagesArrierePlan(reglages);
      s.appliquerDemarrageWindows(propres);
      return { reglages: propres };
    })
  );

  // --- Mise à jour de l'appli : état (bandeau, Paramètres), « Vérifier maintenant », « Redémarrer et mettre à jour » ---
  repondre("maj:lire", () => {
    const miseAJour = s.majAppli();
    if (miseAJour) return miseAJour.lire();
    return { etape: "indisponible", version: s.versionAppli(), raison: s.config().plateforme === "darwin" ? "mac" : "projet" };
  });
  repondre("maj:verifier", () => {
    const miseAJour = s.majAppli();
    return miseAJour ? miseAJour.verifierMaintenant() : false;
  });
  repondre("maj:installer", () => {
    const miseAJour = s.majAppli();
    if (!miseAJour) return false;
    const etape = miseAJour.lire().etape;
    if (etape === "disponible") return miseAJour.installer(); // Mac : ouvre la page de téléchargement, l'appli reste ouverte
    if (etape !== "prete") return false;
    s.avantInstallation(); // la croix ne doit pas juste cacher la fenêtre pendant l'installation
    return miseAJour.installer();
  });

  // --- Mode Deadlock (deadlock.js) : lecture seule, sauf ses réglages ---
  repondre("deadlock:etat", () => s.deadlock().etat());
  repondre("deadlock:accueil", () => essayer(() => s.deadlock().accueil()));
  repondre("deadlock:heros", () => essayer(() => s.deadlock().heros()));
  repondre("deadlock:listeHeros", () => essayer(async () => ({ heros: await s.deadlock().listeHeros() })));
  repondre("deadlock:build", (heroId) =>
    essayer(() => {
      const id = Number(heroId);
      if (!Number.isInteger(id) || id <= 0) return Promise.reject(new ErreurDeadlockApi("Choisis un héros."));
      return s.deadlock().build(id);
    })
  );
  repondre("deadlock:enregistrer", (reglages) => essayer(() => ({ reglages: s.deadlock().enregistrer(reglages) })));

  // --- État de l'appli (au démarrage de la page ; ensuite, main.js prévient la page tout seul) ---
  repondre("client:etatConnexion", () => s.clientConnecte());
  repondre("appli:etat", () => s.etatAppli());

  // --- Fenêtre transparente du jeu (panneau des sorts) ---
  ecouterOverlay("overlay:souris", (dessus) => s.souris(dessus === true));
  ecouterOverlay("sorts:position", (position) => s.stockage().enregistrerPositionSorts(position));
  ecouterOverlay("sorts:clic", (id) => {
    if (typeof id === "string") s.clicSort(id);
  });
}

module.exports = { brancherMessages, reponseErreur, lireDemandeBuild, listeChampions };
