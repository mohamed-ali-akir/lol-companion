// Point d'entrée de l'appli Electron (processus principal, qui a accès à Node.js).
// Il crée la fenêtre, garde les réglages et lit le client League lancé sur ce PC.
// Il surveille aussi le client en direct (surveillance.js) pour mettre la page à jour
// toute seule après chaque partie.
// Tout passe par l'API locale du client (lcu.js). Seules exceptions : les statistiques de builds d'OP.GG
// (opgg.js) et de Lolalytics (lolalytics.js), lues seulement si tu l'actives dans l'onglet Build (ou Sélection
// pour le conseiller de draft, draft.js), sans aucune donnée personnelle.
// La page, elle, n'a accès à ces fonctions qu'à travers preload.js.
// En arrière-plan (fenêtre cachée), l'appli reste dans la zone de notification de Windows
// et continue de surveiller le client (voir la partie "Arrière-plan" en bas de ce fichier).
const { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, protocol, Notification, screen, shell, systemPreferences } = require("electron");
const path = require("path");
const os = require("os"); // os.uptime() : depuis quand le Mac est allumé (démarrage réduit)
const { recupererCompteClient, lireToutHistorique, ErreurClient } = require("./lcu.js");
const { creerStockage, ErreurStockage, DOSSIER_JEU_PAR_DEFAUT } = require("./stockage.js");
const { surveillerClient } = require("./surveillance.js");
const { creerProgression, creerPoint, riotIdDe } = require("./progression.js");
const { xpDuCompte } = require("./src/calculs.js"); // même calcul d'XP que la page
const { creerAcceptation, accepterReadyCheck, leagueAuPremierPlan } = require("./acceptation.js");
const { creerSelectionAuto, effectuerAction, lireChampionsAutorises } = require("./selection.js");
const { lireRecommandations, appliquerPage, monChampion } = require("./runes.js");
const { estMayhem, indexNoms, indexStats, creerSuiviAugments, lireNomsAugments, lireLangueJeu } = require("./augments.js");
const { creerLecteurEcran } = require("./ocr.js");
const { creerLecteurArammayhem } = require("./arammayhem.js");
const { creerSondage, etatPreparation } = require("./sondage.js");
const { creerJournal } = require("./journal.js");
const { creerBuildAuto, assemblerBuild, lirePartie, appliquerSet, appliquerSorts } = require("./build.js");
const { creerLecteurOpgg, ErreurOpgg } = require("./opgg.js");
const { creerStatsBuild } = require("./stats-build.js");
const { creerLecteurLolalytics, ErreurLolalytics } = require("./lolalytics.js");
const { creerHistoriqueParties } = require("./parties.js");
const { creerConseillerDraft } = require("./draft.js");
const { creerLectureJeuPartagee, estFaille, lireJeu, monAlias } = require("./jeu.js");
const { creerSuiviSorts } = require("./sorts.js");
const { creerLecteurChat } = require("./pings.js");
const { recupererMaitrise, creerSuiviMaitrise, mettreAJourSuivi, moyennesParChampion } = require("./maitrise.js");
const { creerMajAppli } = require("./maj-appli.js"); // mise à jour de l'appli (au lancement, puis en arrière-plan)
const { routeIcone, creerCacheIcones, chargerImageClient, PROTOCOLE_ICONES } = require("./champions.js");
const {
  actionFermeture,
  parametresDemarrageWindows,
  estDemarrageReduit,
  estDemarrageReduitMac,
  doitPrevenirReduction,
  actionClientDetecte,
  texteClientDetecte,
  modeleMenuIcone,
  modeleMenuMac,
} = require("./arriere-plan.js");

let stockage; // créé quand l'appli est prête (app.getPath en a besoin)
let progression; // historique de progression (progression.json), créé au même moment
let historiqueParties; // parties déjà lues (parties.json), pour l'onglet Stats
let suiviMaitrise; // points de maîtrise gagnés par partie (maitrise.json), pour l'onglet Maîtrise
let importEnCours = false; // un seul import de l'historique à la fois
let fenetre = null;
let surveillance = null;
let clientConnecte = false;
let clientDejaSignale = false; // notification « LoL Companion est prêt » déjà montrée pour ce lancement de League
let acceptation = null;
let selectionAuto = null; // pick et ban automatiques (selection.js)
let conseillerDraft = null; // meilleurs champions pour la draft en cours (draft.js), désactivé par défaut
let dernierConseil = null; // dernier conseil envoyé (pour la page qui s'ouvre en pleine sélection)
let buildAuto = null; // build automatique : stats OP.GG, runes, set d'objets (build.js)
// Seules connexions à Internet de l'appli (onglet Build, désactivées par défaut) : OP.GG et Lolalytics.
const lecteurOpgg = creerLecteurOpgg();
const lecteurLolalytics = creerLecteurLolalytics();
const lecteurArammayhem = creerLecteurArammayhem(); // taux de victoire des augments ARAM Mayhem
// Augments ARAM Mayhem affichés en jeu (augments.js) : désactivé par défaut (onglet Build).
let championPartie = null; // ton champion, retenu pendant la sélection
let indexAugments = null; // noms de tous les augments (langue du jeu)
let langueJeu = null; // "en_US"...
let lecteurEcran = null; // lecture d'écran (ocr.js), lancée seulement pendant une ARAM Mayhem
let fenetreAugments = null; // fenêtre transparente par-dessus le jeu
let suiviAugments = null;
let suiviSorts = null; // chronos des sorts d'invocateur adverses, cliquables en jeu (sorts.js), désactivé par défaut
const contenuOverlay = { augments: null, sorts: null }; // ce qu'affiche la fenêtre transparente
const lancement = Date.now(); // ouverture de l'appli : début de session en mode "depuis l'ouverture"
let icone = null; // icône dans la zone de notification (Tray)
let quitteEnCours = false; // true quand on quitte vraiment (menu "Quitter") : la croix ne cache plus
const DOSSIER_ASSETS = path.join(__dirname, "assets");

// Journal sur le disque (journal.js) : créé quand l'appli est prête ; avant, les messages ne vont qu'au terminal.
let journal = { ecrire: () => {} };

/** Écrit dans le journal (journal.txt) et dans le terminal (npm start). */
function noter(...morceaux) {
  journal.ecrire(...morceaux);
}

/** Écrit une erreur rattrapée dans le terminal et le journal, avec le nom de la fonctionnalité concernée. */
function signalerErreur(nom, erreur) {
  console.error(`[LoL Companion] Erreur dans « ${nom} » (le reste de l'appli continue) :`, erreur);
  noter(`ERREUR dans « ${nom} » :`, erreur);
}

/**
 * Cloison de sécurité : appelle fonction() dans sa bulle. Une erreur (même dans une promesse) est écrite dans le
 * terminal au lieu de casser les autres fonctionnalités (voir aussi surveillance.js).
 */
function proteger(nom, fonction) {
  try {
    const resultat = fonction();
    if (resultat && typeof resultat.catch === "function") resultat.catch((erreur) => signalerErreur(nom, erreur));
  } catch (erreur) {
    signalerErreur(nom, erreur);
  }
}

// Filet global : une erreur qui passerait quand même entre les mailles (minuterie, promesse oubliée...) est écrite
// dans le terminal au lieu de laisser l'appli dans un état bancal.
process.on("uncaughtException", (erreur) => signalerErreur("erreur non rattrapée", erreur));
process.on("unhandledRejection", (erreur) => signalerErreur("promesse en erreur", erreur));

/** Transforme une erreur en réponse simple pour la page : { ok: false, erreur, probleme }. */
function reponseErreur(erreur) {
  const prevue = [ErreurClient, ErreurStockage, ErreurOpgg, ErreurLolalytics].some((type) => erreur instanceof type);
  return {
    ok: false,
    erreur: prevue ? erreur.message : `Erreur inattendue : ${erreur.message}`,
    probleme: erreur.probleme || null,
  };
}

// ---------------------------------------------------------------------------
// Messages que la page peut envoyer (via preload.js).
// ---------------------------------------------------------------------------

function brancherMessages() {
  ipcMain.handle("config:lire", () => ({
    dossierJeu: stockage.dossierJeu(),
    dossierJeuParDefaut: DOSSIER_JEU_PAR_DEFAUT,
    plateforme: process.platform, // "win32" ou "darwin" (Mac) : la page adapte ses textes
    autorisationEcran: autorisationEcranMac(), // Mac : « Enregistrement de l'écran » donné ? (augments) ; null ailleurs
    dernierCompte: stockage.dernierCompte(), // pour l'afficher même si le client est fermé
    ongletActif: stockage.ongletActif(), // pour rouvrir le même onglet
    lancement, // heure d'ouverture de l'appli (session "depuis l'ouverture")
  }));

  ipcMain.handle("config:enregistrerOnglet", (_evenement, nom) => {
    try {
      stockage.enregistrerOngletActif(nom);
      return { ok: true };
    } catch (erreur) {
      return reponseErreur(erreur);
    }
  });

  ipcMain.handle("config:enregistrerDossierJeu", (_evenement, dossier) => {
    try {
      stockage.enregistrerDossierJeu(dossier);
      return { ok: true, dossierJeu: stockage.dossierJeu() };
    } catch (erreur) {
      return reponseErreur(erreur);
    }
  });

  // Compte connecté (Riot ID, niveau, progression) + stats de ses dernières parties,
  // lus dans le client League lancé sur ce PC.
  ipcMain.handle("client:recuperer", () => lireCompte());

  // Onglet Maîtrise : niveau, points et marques de chaque champion (lecture seule).
  ipcMain.handle("maitrise:lire", () => lireMaitrise());

  // Points de progression d'un compte (pour le graphique).
  ipcMain.handle("progression:lire", (_evenement, compte) => progression.pointsDu(riotIdDe(compte)));

  // Onglet Stats : parties enregistrées pour un compte (disponibles même client fermé).
  ipcMain.handle("stats:lire", (_evenement, compte) => historiqueParties.partiesDu(riotIdDe(compte)));
  ipcMain.handle("stats:importer", () => importerHistorique());

  // Acceptation automatique : lire et changer les réglages (onglet Paramètres).
  ipcMain.handle("acceptation:lire", () => stockage.reglagesAcceptation());
  ipcMain.handle("acceptation:enregistrer", (_evenement, reglages) => {
    try {
      const propres = stockage.enregistrerReglagesAcceptation(reglages);
      mettreAJourMenuIcone(); // la case "Acceptation auto" du menu de l'icône suit le réglage
      return { ok: true, reglages: propres };
    } catch (erreur) {
      return reponseErreur(erreur);
    }
  });

  // Pick et ban automatiques : réglages et listes de champions (onglet Sélection).
  ipcMain.handle("selection:lire", () => stockage.reglagesSelection());
  ipcMain.handle("selection:enregistrer", (_evenement, reglages) => {
    try {
      return { ok: true, reglages: stockage.enregistrerReglagesSelection(reglages) };
    } catch (erreur) {
      return reponseErreur(erreur);
    }
  });
  // Noms de tous les champions, pour les listes de l'onglet Sélection (lus dans les fichiers du client).
  ipcMain.handle("selection:champions", async () => {
    const noms = await obtenirNomsChampions();
    if (noms.size === 0) return { ok: false, erreur: "Lance le client League pour charger la liste des champions." };
    const champions = [...noms]
      .filter(([id]) => id > 0)
      .map(([id, nom]) => ({ id, nom }))
      .sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
    return { ok: true, champions };
  });

  // Fenêtre transparente du jeu : la souris est sur le panneau des sorts (cliquable) ou ailleurs (tout passe au jeu).
  // On ne prend ces messages que de la fenêtre transparente elle-même.
  const depuisOverlay = (evenement) => fenetreAugments && !fenetreAugments.isDestroyed() && evenement.sender === fenetreAugments.webContents;
  ipcMain.on("overlay:souris", (evenement, dessus) => {
    if (depuisOverlay(evenement)) fenetreAugments.setIgnoreMouseEvents(dessus !== true || !contenuOverlay.sorts, { forward: true });
  });
  // Panneau des sorts déplacé (glissé à la souris) : sa nouvelle place, gardée pour les prochaines parties.
  ipcMain.on("sorts:position", (evenement, position) => {
    if (depuisOverlay(evenement)) proteger("place du panneau des sorts", () => stockage.enregistrerPositionSorts(position));
  });
  ipcMain.on("sorts:clic", (evenement, id) => {
    if (depuisOverlay(evenement) && typeof id === "string" && suiviSorts) proteger("chronos des sorts", () => suiviSorts.clic(id));
  });

  // Conseiller de draft : dernier conseil (si la page s'ouvre pendant une sélection).
  ipcMain.handle("draft:lire", () => dernierConseil);

  // Build automatique : réglages (onglet Build).
  ipcMain.handle("build:lire", () => stockage.reglagesBuild());
  ipcMain.handle("build:enregistrer", (_evenement, reglages) => {
    try {
      return { ok: true, reglages: stockage.enregistrerReglagesBuild(reglages) };
    } catch (erreur) {
      return reponseErreur(erreur);
    }
  });
  // Consulter le build d'un champion à la demande (bouton de l'onglet Build) : lecture seule, rien n'est appliqué.
  ipcMain.handle("build:consulter", async (_evenement, demande) => {
    try {
      const championId = Number(demande && demande.championId);
      if (!Number.isInteger(championId) || championId <= 0) return { ok: false, erreur: "Choisis un champion." };
      const role = typeof demande.role === "string" && demande.role ? demande.role : null;
      const mode = demande.mode === "aram" ? "aram" : "ranked";
      const contexte = { championId, role, mode };
      const [opgg, lolalytics] = await Promise.allSettled([analyserOpgg(contexte), analyserLolalytics(contexte)]);
      if (opgg.status === "rejected" && lolalytics.status === "rejected") throw lolalytics.reason;
      const { resume } = assemblerBuild({
        opgg: opgg.status === "fulfilled" ? opgg.value : null,
        emplacements: lolalytics.status === "fulfilled" ? lolalytics.value : null,
      });
      if (!resume) return { ok: false, erreur: "Pas assez de données pour ce champion et ce rôle." };
      const avertissement = lolalytics.status === "rejected" ? `${lolalytics.reason.message} Objets d'OP.GG affichés.` : null;
      const noms = await obtenirNomsChampions();
      return { ok: true, nom: noms.get(championId) || null, role, mode, build: resume, avertissement };
    } catch (erreur) {
      return reponseErreur(erreur);
    }
  });

  // Arrière-plan : fermer = réduire, lancement au démarrage de Windows (onglet Paramètres).
  ipcMain.handle("arrierePlan:lire", () => stockage.reglagesArrierePlan());

  // Mise à jour de l'appli : état (bandeau, Paramètres), « Vérifier maintenant », « Redémarrer et mettre à jour ».
  ipcMain.handle("maj:lire", () => {
    const miseAJour = majAppli.suivi();
    return miseAJour ? miseAJour.lire() : { etape: "indisponible", version: app.getVersion(), raison: process.platform === "darwin" ? "mac" : "projet" };
  });
  ipcMain.handle("maj:verifier", () => {
    const miseAJour = majAppli.suivi();
    return miseAJour ? miseAJour.verifierMaintenant() : false;
  });
  ipcMain.handle("maj:installer", () => {
    const miseAJour = majAppli.suivi();
    if (!miseAJour) return false;
    const etape = miseAJour.lire().etape;
    if (etape === "disponible") return miseAJour.installer(); // Mac : ouvre la page de téléchargement, l'appli reste ouverte
    if (etape !== "prete") return false;
    quitteEnCours = true; // la croix ne doit pas juste cacher la fenêtre pendant l'installation
    return miseAJour.installer();
  });
  ipcMain.handle("arrierePlan:enregistrer", (_evenement, reglages) => {
    try {
      const propres = stockage.enregistrerReglagesArrierePlan(reglages);
      appliquerDemarrageWindows(propres);
      return { ok: true, reglages: propres };
    } catch (erreur) {
      return reponseErreur(erreur);
    }
  });

  // La page demande si la surveillance en direct est branchée (au démarrage).
  ipcMain.handle("client:etatConnexion", () => clientConnecte);
  // État de l'appli pour le bandeau « pas encore prête » (au démarrage de la page ; ensuite : "appli:etat").
  ipcMain.handle("appli:etat", () => etatAppli);
}

// Stats de build (noms et alias des champions, objets du client, OP.GG, Lolalytics, set Rank 1) : stats-build.js.
const { obtenirNomsChampions, obtenirAliasChampions, analyserOpgg, analyserLolalytics, analyserRank1 } = creerStatsBuild({
  dossierJeu: () => stockage.dossierJeu(),
  lecteurOpgg,
  lecteurLolalytics,
});

/**
 * Lit le compte dans le client et, si ça marche, le garde sur le disque :
 * dernier compte, point de progression, et nouvelles parties (onglet Stats).
 */
async function lireCompte() {
  try {
    const { parties, ...compte } = await recupererCompteClient(stockage.dossierJeu());
    try {
      stockage.enregistrerDernierCompte(compte);
      progression.ajouter(creerPoint(compte, xpDuCompte(compte))); // un point de plus sur la courbe
      historiqueParties.ajouter(riotIdDe(compte), parties, await obtenirNomsChampions());
    } catch (erreur) {
      console.error("Impossible d'enregistrer le compte :", erreur); // pas grave : on affiche quand même
    }
    return { ok: true, ...compte };
  } catch (erreur) {
    return reponseErreur(erreur);
  }
}

/**
 * Importe tout l'historique que le client accepte de donner (onglet Stats, bouton "Importer").
 * Les parties sont enregistrées par paquets (pas à chaque page : ce serait lent sur un gros historique),
 * et la page est prévenue de la progression.
 */
async function importerHistorique() {
  if (importEnCours) return { ok: false, erreur: "Un import est déjà en cours." };
  importEnCours = true;
  const enAttente = [];
  let nouvelles = 0;
  let riotId = null;
  const noms = await obtenirNomsChampions();
  const enregistrer = () => {
    if (riotId && enAttente.length) nouvelles += historiqueParties.ajouter(riotId, enAttente.splice(0), noms);
  };
  try {
    const resultat = await lireToutHistorique(stockage.dossierJeu(), {
      surPage: ({ page, parties, total, compte }) => {
        riotId = riotIdDe(compte);
        enAttente.push(...parties);
        if (page % 10 === 9) enregistrer(); // tous les 10 pages : rien n'est perdu si le client se ferme
        envoyerALaPage("stats:progression", { pages: page + 1, parties: total });
      },
    });
    enregistrer();
    return { ok: true, ...resultat, nouvelles };
  } catch (erreur) {
    enregistrer(); // client fermé en plein import : on garde quand même les pages déjà lues
    return { ...reponseErreur(erreur), nouvelles };
  } finally {
    importEnCours = false;
  }
}

/**
 * Maîtrise des champions + estimation des points par partie.
 * À appeler APRÈS lireCompte : les nouvelles parties doivent déjà être dans parties.json
 * pour être comparées aux points gagnés (voir mettreAJourSuivi dans maitrise.js).
 */
async function lireMaitrise() {
  try {
    const { compte, maitrises } = await recupererMaitrise(stockage.dossierJeu());
    const riotId = riotIdDe(compte);
    const parties = historiqueParties.partiesDu(riotId);
    let moyennes = new Map();
    try {
      const etat = mettreAJourSuivi(suiviMaitrise.lire(riotId), maitrises, parties);
      suiviMaitrise.enregistrer(riotId, etat);
      moyennes = moyennesParChampion(etat.echantillons);
    } catch (erreur) {
      console.error("Impossible d'enregistrer le suivi de maîtrise :", erreur); // on affiche quand même
    }
    const partiesParChampion = new Map();
    for (const p of parties) partiesParChampion.set(p.championId, (partiesParChampion.get(p.championId) || 0) + 1);
    const noms = await obtenirNomsChampions();
    const champions = maitrises.map((m) => {
      const mesure = moyennes.get(m.championId);
      return {
        ...m,
        nom: noms.get(m.championId) || `Champion n° ${m.championId}`,
        moyenneParPartie: mesure ? mesure.moyenne : null, // null : pas encore mesurée
        partiesMesurees: mesure ? mesure.parties : 0,
        partiesEnregistrees: partiesParChampion.get(m.championId) || 0,
      };
    });
    return { ok: true, compte, champions };
  } catch (erreur) {
    return reponseErreur(erreur);
  }
}

// ---------------------------------------------------------------------------
// Icônes des champions : protocole lcu-image://champion/<id>
// La page affiche <img src="lcu-image://champion/266"> ; main.js va chercher l'image dans le
// client (avec son mot de passe) et la garde en cache. Seules les icônes de champions passent
// (voir routeIcone dans champions.js) : la page ne peut pas appeler d'autres routes du client.
// ---------------------------------------------------------------------------

// À déclarer AVANT que l'appli soit prête (exigence d'Electron).
protocol.registerSchemesAsPrivileged([{ scheme: PROTOCOLE_ICONES, privileges: { standard: true, secure: true } }]);

function brancherIcones() {
  const obtenirIcone = creerCacheIcones((route) => chargerImageClient(stockage.dossierJeu(), route));
  protocol.handle(PROTOCOLE_ICONES, async (requete) => {
    const route = routeIcone(requete.url);
    if (!route) return new Response(null, { status: 403 });
    try {
      const image = await obtenirIcone(route);
      if (!image) return new Response(null, { status: 404 });
      return new Response(image.octets, { headers: { "Content-Type": image.type } });
    } catch {
      return new Response(null, { status: 503 }); // client fermé : la page affiche une icône vide
    }
  });
}

/** Envoie un message à la page, si la fenêtre est toujours ouverte. */
function envoyerALaPage(canal, donnees) {
  if (fenetre && !fenetre.isDestroyed()) fenetre.webContents.send(canal, donnees);
}

// ---------------------------------------------------------------------------
// Partie trouvée : notification Windows et acceptation automatique (acceptation.js)
// ---------------------------------------------------------------------------

/** Notification "Partie trouvée !", seulement si l'option est cochée et que League n'est pas au premier plan. */
async function notifierPartieTrouvee({ autoActif, delaiSecondes }) {
  envoyerALaPage("acceptation:evenement", { type: "trouvee", autoActif, delaiSecondes });
  if (!stockage.reglagesAcceptation().notifier || !Notification.isSupported()) return;
  if (await leagueAuPremierPlan()) return; // tu regardes déjà League : pas besoin de te déranger
  const notification = new Notification({
    title: "Partie trouvée !",
    body: autoActif
      ? `LoL Companion l'accepte dans ${delaiSecondes} s. Retourne dans League si tu veux la refuser.`
      : "Retourne dans League pour l'accepter.",
    silent: false, // avec le son de notification de Windows
  });
  notification.on("click", afficherFenetre);
  notification.show();
}

/**
 * League vient d'être détecté. Seulement si la fenêtre est cachée (sinon tu vois déjà que l'appli marche) et une fois
 * par lancement de League (Paramètres, Arrière-plan) : soit on ouvre la fenêtre (sans voler le clavier au client
 * qui démarre), soit on affiche la notification « LoL Companion est prêt ».
 */
function notifierClientDetecte() {
  const fenetreVisible = Boolean(fenetre && !fenetre.isDestroyed() && fenetre.isVisible());
  const action = actionClientDetecte({ reglages: stockage.reglagesArrierePlan(), fenetreVisible, dejaPrevenu: clientDejaSignale });
  if (!action) return;
  clientDejaSignale = true;
  if (action === "ouvrir") {
    if (!fenetre || fenetre.isDestroyed()) creerFenetre();
    if (fenetre.isMinimized()) fenetre.restore();
    fenetre.showInactive();
    return;
  }
  if (!Notification.isSupported()) return;
  const selection = stockage.reglagesSelection();
  const build = stockage.reglagesBuild();
  const notification = new Notification({
    title: "LoL Companion est prêt",
    body: texteClientDetecte({
      acceptation: stockage.reglagesAcceptation().actif,
      pick: selection.pickActif,
      ban: selection.banActif,
      build: build.stats || build.runes,
    }),
    icon: cheminIcone("icon"),
    silent: true, // une info, pas une urgence
  });
  notification.on("click", afficherFenetre);
  notification.show();
}

function demarrerAcceptation() {
  acceptation = creerAcceptation({
    reglages: () => stockage.reglagesAcceptation(),
    accepter: () => accepterReadyCheck(stockage.dossierJeu()),
    partieTrouvee: (info) => {
      noter("Partie trouvée", info.autoActif ? `(acceptation dans ${info.delaiSecondes} s)` : "(acceptation auto désactivée)");
      notifierPartieTrouvee(info).catch((erreur) => console.error("Notification impossible :", erreur));
    },
    resultat: (info) => {
      noter("Acceptation :", info.accepte ? "OK" : info.erreur ? `ERREUR ${info.erreur}` : `annulée (${info.annule})`);
      envoyerALaPage("acceptation:evenement", { type: "resultat", ...info });
    },
  });
}

// ---------------------------------------------------------------------------
// Sélection des champions : pick et ban automatiques (selection.js), désactivés par défaut
// ---------------------------------------------------------------------------

function demarrerSelection() {
  selectionAuto = creerSelectionAuto({
    reglages: () => stockage.reglagesSelection(),
    champsAutorises: (type) => lireChampionsAutorises(stockage.dossierJeu(), type),
    agir: (actionId, championId) => effectuerAction(stockage.dossierJeu(), actionId, championId),
    resultat: async (info) => {
      // On ajoute le nom du champion pour l'afficher dans l'appli.
      const noms = info.championId ? await obtenirNomsChampions() : new Map();
      envoyerALaPage("selection:evenement", { ...info, nom: noms.get(info.championId) || null });
    },
  });
  // Conseiller de draft (lecture seule) : stats Lolalytics de la draft visible + tes parties enregistrées.
  conseillerDraft = creerConseillerDraft({
    actif: () => stockage.reglagesSelection().conseilActif,
    lecteur: lecteurLolalytics,
    alias: obtenirAliasChampions,
    jouables: async () => {
      const ids = await lireChampionsAutorises(stockage.dossierJeu(), "pick").catch(() => null);
      return ids && ids.length ? new Set(ids) : null;
    },
    parties: () => {
      const compte = stockage.dernierCompte();
      return compte ? historiqueParties.partiesDu(riotIdDe(compte)) : [];
    },
    envoyer: async (conseil) => {
      const noms = conseil ? await obtenirNomsChampions() : new Map();
      const nom = (id) => noms.get(id) || `Champion n° ${id}`;
      dernierConseil = conseil && {
        ...conseil,
        propositions: conseil.propositions.map((p) => ({ ...p, nom: nom(p.id), raisons: p.raisons.map((r) => ({ ...r, nom: nom(r.id) })) })),
        manquants: (conseil.manquants || []).map(nom),
      };
      envoyerALaPage("draft:conseil", dernierConseil);
    },
    journal: noter,
  });
  // Build automatique quand ton champion est verrouillé : stats OP.GG, runes, set d'objets (désactivé par défaut).
  buildAuto = creerBuildAuto({
    reglages: () => stockage.reglagesBuild(),
    analyser: ({ championId, role }) => analyserOpgg({ championId, role }),
    analyserEmplacements: ({ championId, role }) => analyserLolalytics({ championId, role }),
    analyserRank1: ({ championId, role }) => analyserRank1({ championId, role }), // case « rank1 » (désactivée par défaut)
    runesRiot: ({ championId, role }) => lireRecommandations(stockage.dossierJeu(), championId, role),
    appliquerRunes: (page, noms) => appliquerPage(stockage.dossierJeu(), page, { noms }),
    appliquerSorts: (ids) => appliquerSorts(stockage.dossierJeu(), ids),
    appliquerObjets: (set) => appliquerSet(stockage.dossierJeu(), set),
    nomChampion: async (championId) => (await obtenirNomsChampions()).get(championId) || `Champion n° ${championId}`,
    carte: async () => {
      const partie = await lirePartie(stockage.dossierJeu()).catch(() => null);
      return (partie && partie.map && partie.map.id) || 11;
    },
    resultat: async (info) => {
      const noms = await obtenirNomsChampions();
      envoyerALaPage("build:evenement", { ...info, nom: noms.get(info.championId) || null });
    },
  });
}

// ---------------------------------------------------------------------------
// Augments ARAM Mayhem : stats sous chaque carte, sur l'écran du jeu (augments.js, ocr.js)
// Seulement pendant une ARAM Mayhem et si la case de l'onglet Build est cochée (désactivé par défaut).
// ---------------------------------------------------------------------------

/** Écran du jeu (l'écran principal) : taille en pixels réels et échelle de Windows (100 %, 125 %...). */
function ecranJeu() {
  const ecran = screen.getPrimaryDisplay();
  return {
    largeur: Math.round(ecran.bounds.width * ecran.scaleFactor),
    hauteur: Math.round(ecran.bounds.height * ecran.scaleFactor),
    echelle: ecran.scaleFactor,
  };
}

/**
 * Mac : l'autorisation « Enregistrement de l'écran » (nécessaire pour lire les augments à l'écran) est-elle donnée ?
 * "granted", "denied", "not-determined"... ; null hors Mac ou si macOS ne répond pas.
 */
function autorisationEcranMac() {
  if (process.platform !== "darwin") return null;
  try {
    return systemPreferences.getMediaAccessStatus("screen");
  } catch {
    return null;
  }
}

/** Fenêtre transparente par-dessus le jeu : elle laisse passer les clics et ne prend jamais la main (focus). */
function creerFenetreAugments() {
  const { bounds } = screen.getPrimaryDisplay();
  fenetreAugments = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    transparent: true,
    backgroundColor: "#00000000",
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    focusable: false, // ne vole jamais le clavier au jeu
    hasShadow: false,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "preload-overlay.js"),
    },
  });
  // Les clics passent au jeu ; "forward" laisse quand même la page voir la souris, pour rendre cliquable
  // le seul panneau des sorts quand la souris passe dessus (voir "overlay:souris").
  fenetreAugments.setIgnoreMouseEvents(true, { forward: true });
  fenetreAugments.setAlwaysOnTop(true, "screen-saver"); // au-dessus du jeu en mode « Sans bordure »
  if (process.platform === "darwin") {
    // Mac : un jeu en plein écran a son propre bureau (« Space ») ; sans ça, la fenêtre resterait sur le bureau
    // normal, invisible pendant la partie. skipTransformProcessType : l'icône du Dock ne disparaît pas.
    try {
      fenetreAugments.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    } catch (erreur) {
      noter("Overlay sur Mac :", erreur.message); // l'overlay marche quand même hors plein écran
    }
  }
  fenetreAugments.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  fenetreAugments.loadFile(path.join(__dirname, "src", "overlay.html"));
  fenetreAugments.on("closed", () => {
    fenetreAugments = null;
  });
}

const overlayVide = () => !contenuOverlay.augments && !contenuOverlay.sorts;

/**
 * Met à jour la fenêtre transparente : étiquettes des augments (ARAM Mayhem) et panneau des sorts (Faille). Elle est cachée quand il n'y a rien à montrer.
 */
function majOverlay() {
  if (overlayVide()) {
    if (fenetreAugments && !fenetreAugments.isDestroyed()) {
      fenetreAugments.setIgnoreMouseEvents(true, { forward: true }); // plus de panneau : tout repasse au jeu
      fenetreAugments.hide();
    }
    return;
  }
  if (!fenetreAugments || fenetreAugments.isDestroyed()) creerFenetreAugments();
  const envoyer = () => {
    if (!fenetreAugments || fenetreAugments.isDestroyed()) return;
    // Contenu relu au moment d'envoyer : jamais un état plus ancien que le dernier demandé.
    fenetreAugments.webContents.send("augments:etiquettes", { echelle: ecranJeu().echelle, liste: contenuOverlay.augments || [] });
    fenetreAugments.webContents.send("sorts:position", stockage.positionSorts());
    fenetreAugments.webContents.send("sorts:etat", contenuOverlay.sorts);
    if (!contenuOverlay.sorts) fenetreAugments.setIgnoreMouseEvents(true, { forward: true });
    if (overlayVide()) return fenetreAugments.hide();
    fenetreAugments.showInactive(); // visible sans prendre la main
    fenetreAugments.setAlwaysOnTop(true, "screen-saver");
  };
  if (fenetreAugments.webContents.isLoading()) fenetreAugments.webContents.once("did-finish-load", envoyer);
  else envoyer();
}

/** Affiche les étiquettes sous les cartes (liste), ou les retire (null). */
function afficherAugments(liste) {
  contenuOverlay.augments = liste || null;
  majOverlay();
}

/** Affiche le panneau des sorts adverses (avec l'icône de chaque champion), ou le retire (null). */
async function afficherSorts(panneau) {
  if (panneau) {
    const ids = new Map([...(await obtenirAliasChampions())].map(([id, alias]) => [String(alias).toLowerCase(), id]));
    panneau = panneau.map((a) => ({ ...a, championId: ids.get(String(a.alias).toLowerCase()) || null }));
  }
  contenuOverlay.sorts = panneau || null;
  majOverlay();
}

async function obtenirLangueJeu() {
  if (!langueJeu) langueJeu = await lireLangueJeu(stockage.dossierJeu()).catch(() => "en_US");
  return langueJeu;
}

async function obtenirIndexAugments() {
  if (!indexAugments || indexAugments.size === 0) indexAugments = indexNoms(await lireNomsAugments(stockage.dossierJeu()));
  return indexAugments;
}

function obtenirLecteurEcran() {
  if (!lecteurEcran) lecteurEcran = creerLecteurEcran({ langue: langueJeu || "en_US", echelle: () => ecranJeu().echelle }); // échelle : Mac (Retina)
  return lecteurEcran;
}

function demarrerAugments() {
  suiviAugments = creerSuiviAugments({
    actif: () => (process.platform === "win32" || process.platform === "darwin") && stockage.reglagesBuild().augments, // OCR de Windows ou de macOS (ocr.js)
    ecran: ecranJeu,
    lireEcran: (zone) => obtenirLecteurEcran().lire(zone),
    nomsAugments: obtenirIndexAugments,
    // Taux de victoire d'arammayhem.com (arammayhem.js) : avec ton champion, sinon tous champions.
    // Champion retenu pendant la sélection ; appli lancée en pleine partie (vu le 17/10/2026 : « Stats
    // indisponibles ») : on le lit dans la partie en cours (jeu.js) ; sinon, stats tous champions seulement.
    statsAugments: async () => {
      let alias = championPartie ? (await obtenirAliasChampions()).get(championPartie) : null;
      if (!alias) {
        const jeu = await lireJeu();
        alias = jeu ? monAlias(jeu.actif, jeu.joueurs) : null;
      }
      return indexStats(await lecteurArammayhem.augments({ alias }));
    },
    afficher: afficherAugments,
    arreterLecture: () => {
      if (lecteurEcran) lecteurEcran.arreter();
      lecteurEcran = null;
    },
    journal: (...morceaux) => console.error("[LoL Companion]", ...morceaux),
  });
}

function demarrerChronosSorts() {
  const lire = creerLectureJeuPartagee(); // une seule lecture du jeu par seconde
  // Pings des sorts lus dans le chat (pings.js, exception du 16/10/2026 ; même case que les chronos, désactivée par défaut).
  // Le lecteur d'écran est demandé à chaque lecture : c'est le même que celui des augments (un seul processus).
  const lectureEcranPossible = process.platform === "win32" || process.platform === "darwin";
  const lecteurChat = creerLecteurChat({
    lecteur: {
      capturer: (...args) => obtenirLecteurEcran().capturer(...args),
      lireImage: (...args) => obtenirLecteurEcran().lireImage(...args),
    },
    ecran: () => ecranJeu(),
  });
  suiviSorts = creerSuiviSorts({
    reglages: () => stockage.reglagesBuild(), // case « sorts » (chronos et pings)
    lire,
    afficher: (panneau) => proteger("chronos des sorts", () => afficherSorts(panneau)),
    journal: noter,
    lireChat: lectureEcranPossible ? () => lecteurChat.lire() : null,
  });
}

/** Phase de jeu : panneau des sorts seulement pendant une partie sur la Faille. */
async function surPhaseSorts(phase) {
  if (!suiviSorts) return;
  if (phase !== "InProgress") return suiviSorts.arreter();
  const partie = await lirePartie(stockage.dossierJeu()).catch(() => null);
  if (estFaille(partie)) suiviSorts.demarrer();
  else suiviSorts.arreter();
}

/** Phase de jeu pour tout ce qui s'affiche en jeu, chacun dans sa bulle (augments, chronos des sorts). */
function surPhaseEnJeu(phase) {
  proteger("augments en jeu", () => surPhase(phase));
  proteger("chronos des sorts", () => surPhaseSorts(phase));
}

/** Phase de jeu : on lit l'écran seulement pendant une partie ARAM Mayhem, et on arrête tout le reste du temps. */
async function surPhase(phase) {
  if (!suiviAugments) return;
  if (phase !== "InProgress") return suiviAugments.arreter();
  const partie = await lirePartie(stockage.dossierJeu()).catch(() => null);
  if (!estMayhem(partie)) return suiviAugments.arreter();
  await obtenirLangueJeu();
  suiviAugments.demarrer();
}

// ---------------------------------------------------------------------------
// Surveillance en direct : le client prévient quand une partie se termine.
// ---------------------------------------------------------------------------

/**
 * Sélection des champions (connexion en direct OU sondage) : pick/ban, build, et ton champion pour les augments.
 * Chacun dans sa bulle : si le pick/ban plante, le build continue (et inversement).
 */
function surSelection(session) {
  proteger("pick et ban automatiques", () => selectionAuto.surSession(session));
  proteger("build automatique", () => buildAuto.surSession(session));
  proteger("conseiller de draft", () => conseillerDraft.surSession(session));
  proteger("augments en jeu", () => {
    const moi = session && monChampion(session);
    if (moi) championPartie = moi.championId; // pour les stats d'augments de TON champion
  });
}

// --- État de l'appli (bandeau « pas encore prête ») et chien de garde de la connexion en direct ---------------

let sondage = null; // deuxième canal (sondage.js)
let etatClient = { clientLance: false, clientRepond: false, phase: null }; // vu par le sondage
let etatAppli = { pret: false, message: null }; // envoyé à la page (bandeau)
let phaseDirecte = null; // dernière phase reçue par la connexion en direct
let chienDeGarde = null;
let sourdDepuis = null; // depuis quand le client répond mais la connexion en direct est absente ou muette

/** Recalcule l'état (sondage.js, etatPreparation) et prévient la page s'il a changé. */
function publierEtatAppli() {
  const nouveau = etatPreparation({ ...etatClient, directConnecte: clientConnecte });
  if (nouveau.pret === etatAppli.pret && nouveau.message === etatAppli.message) return;
  etatAppli = nouveau;
  noter("État :", nouveau.pret ? "prêt" : nouveau.message || "League fermé");
  envoyerALaPage("appli:etat", etatAppli);
}

/**
 * Chien de garde (toutes les 5 s) : si le client répond au sondage mais que la connexion en direct est absente,
 * ou qu'elle n'a pas transmis le dernier changement de phase, depuis plus de 15 s, on la refait.
 */
function surveillerConnexionDirecte() {
  const s = sondage ? sondage.etat() : etatClient;
  const sourde = s.clientRepond && (!clientConnecte || (s.phase && phaseDirecte !== null && phaseDirecte !== s.phase));
  if (!sourde) {
    sourdDepuis = null;
    return;
  }
  if (sourdDepuis === null) sourdDepuis = Date.now();
  if (Date.now() - sourdDepuis < 15000) return;
  noter("Chien de garde : connexion en direct", clientConnecte ? `muette (phase ${phaseDirecte} au lieu de ${s.phase})` : "absente", "-> reconnexion");
  sourdDepuis = Date.now();
  phaseDirecte = null;
  surveillance.reconnecter();
}

function demarrerSurveillance() {
  surveillance = surveillerClient({
    dossierJeu: () => stockage.dossierJeu(),
    aErreur: signalerErreur,
    aChangementConnexion: (connecte) => {
      clientConnecte = connecte;
      noter("Connexion en direct au client :", connecte ? "établie" : "perdue");
      // À la connexion, on suppose la phase à jour (celle vue par le sondage) ; ensuite elle doit suivre.
      phaseDirecte = connecte ? (sondage ? sondage.etat().phase : null) : null;
      envoyerALaPage("client:connexion", connecte);
      publierEtatAppli();
      if (connecte) proteger("notification « LoL Companion est prêt »", notifierClientDetecte);
      else clientDejaSignale = false; // League fermé : on préviendra au prochain lancement
      // Appli lancée en pleine partie : on regarde tout de suite (ARAM Mayhem, Faille).
      if (connecte) proteger("phase en jeu", async () => surPhaseEnJeu(((await lirePartie(stockage.dossierJeu())) || {}).phase));
    },
    aReadyCheck: (etat) => acceptation.surReadyCheck(etat), // partie trouvée : tout de suite, sans attendre
    aPhase: (phase) => {
      phaseDirecte = phase;
      surPhaseEnJeu(phase);
    },
    aSelection: surSelection,
    aRafraichir: async (raison) => {
      // Après une partie ou au lancement du client.
      const reponse = await lireCompte();
      if (reponse.ok) {
        envoyerALaPage("client:miseAJour", { ...reponse, raison });
      }
      const maitrise = await lireMaitrise(); // après lireCompte : les nouvelles parties sont déjà enregistrées
      if (maitrise.ok) envoyerALaPage("maitrise:miseAJour", maitrise);
    },
  });

  // Deuxième canal (sondage.js) : partie trouvée et sélection vues même si la connexion en direct est en retard.
  sondage = creerSondage({
    dossierJeu: () => stockage.dossierJeu(),
    aEtat: (etat) => {
      etatClient = etat;
      noter("Client :", etat.clientRepond ? `répond (phase ${etat.phase})` : etat.clientLance ? "lancé, ne répond pas encore" : "fermé");
      publierEtatAppli();
    },
    aPhase: surPhaseEnJeu,
    aReadyCheck: (etat) => acceptation.surReadyCheck(etat),
    aSelection: surSelection,
    aErreur: signalerErreur,
  });
  sondage.demarrer();
  chienDeGarde = setInterval(() => proteger("chien de garde", surveillerConnexionDirecte), 5000);
}

// ---------------------------------------------------------------------------
// Fenêtre
// ---------------------------------------------------------------------------

/** Icône de l'appli : .ico sous Windows (plusieurs tailles nettes), .png ailleurs. */
const cheminIcone = (nom) => path.join(DOSSIER_ASSETS, process.platform === "win32" && nom === "icon" ? "icon.ico" : `${nom}.png`);

function creerFenetre({ visible = true } = {}) {
  fenetre = new BrowserWindow({
    width: 900,
    height: 950,
    minWidth: 420,
    minHeight: 600,
    show: visible, // démarrage de Windows "réduit" : la fenêtre existe mais reste cachée
    icon: cheminIcone("icon"),
    backgroundColor: "#0a1428",
    title: "LoL Companion",
    webPreferences: {
      // Sécurité : la page n'a pas accès à Node.js, seulement au HTML/JS classique,
      // plus les quelques fonctions exposées par preload.js.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  // La page n'a pas besoin d'ouvrir de nouvelles fenêtres : on les bloque toutes.
  fenetre.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  // La croix : cacher la fenêtre (l'appli continue en arrière-plan) ou quitter, selon le réglage.
  fenetre.on("close", (evenement) => {
    const action = actionFermeture(stockage.reglagesArrierePlan(), { quitteEnCours, iconeDisponible: Boolean(icone) });
    if (action !== "cacher") return; // on laisse la fenêtre se fermer : l'appli quitte
    evenement.preventDefault();
    fenetre.hide();
    if (doitPrevenirReduction({ action, dejaPrevenu: stockage.dejaPrevenuReduction() })) prevenirReduction();
  });
  // Arrêt ou déconnexion de Windows : la croix ne doit pas empêcher l'appli de se fermer.
  fenetre.on("session-end", () => {
    quitteEnCours = true;
  });
  fenetre.on("closed", () => {
    fenetre = null;
    // Fenêtre principale vraiment fermée : la fenêtre des augments ne doit pas garder l'appli ouverte.
    if (fenetreAugments && !fenetreAugments.isDestroyed()) fenetreAugments.destroy();
  });

  fenetre.loadFile(path.join(__dirname, "src", "index.html"));
}

/** Réaffiche la fenêtre (menu de l'icône, clic sur une notification, appli relancée). */
function afficherFenetre() {
  if (!fenetre || fenetre.isDestroyed()) creerFenetre();
  if (fenetre.isMinimized()) fenetre.restore();
  fenetre.show();
  fenetre.focus();
}

// ---------------------------------------------------------------------------
// Arrière-plan : icône dans la zone de notification, démarrage de Windows, quitter
// (les décisions sont des fonctions pures, testées, dans arriere-plan.js)
// ---------------------------------------------------------------------------

/** La première fois que la croix cache la fenêtre, on explique que l'appli tourne toujours. */
function prevenirReduction() {
  if (!Notification.isSupported()) return; // pas de notification possible : on réessaiera la prochaine fois
  const notification = new Notification({
    title: "LoL Companion tourne toujours",
    body: "L'appli reste dans la zone de notification (à côté de l'horloge) et continue de surveiller le client. " +
      "Clic droit sur son icône pour la quitter. Tu peux changer ça dans les Paramètres.",
    icon: cheminIcone("icon"),
    silent: true,
  });
  notification.on("click", afficherFenetre);
  notification.show();
  stockage.noterPrevenuReduction();
}

/** Le menu de l'icône, reconstruit quand l'acceptation auto change (case à cocher). */
function mettreAJourMenuIcone() {
  if (!icone || icone.isDestroyed()) return;
  const actions = {
    ouvrir: afficherFenetre,
    acceptation: (element) => {
      const reglages = stockage.enregistrerReglagesAcceptation({ ...stockage.reglagesAcceptation(), actif: element.checked });
      envoyerALaPage("acceptation:reglages", reglages); // l'onglet Paramètres se met à jour
      mettreAJourMenuIcone();
    },
    quitter: quitter,
  };
  const modele = modeleMenuIcone({ acceptationActive: stockage.reglagesAcceptation().actif }).map((element) =>
    element.id ? { ...element, click: (menuElement) => actions[element.id](menuElement) } : element
  );
  icone.setContextMenu(Menu.buildFromTemplate(modele));
}

function creerIcone() {
  try {
    const image = nativeImage.createFromPath(path.join(DOSSIER_ASSETS, process.platform === "win32" ? "icon.ico" : "tray.png"));
    icone = new Tray(image.isEmpty() ? nativeImage.createFromPath(path.join(DOSSIER_ASSETS, "icon.png")) : image);
    icone.setToolTip("LoL Companion");
    icone.on("click", afficherFenetre); // clic gauche : ouvrir ; clic droit : le menu
    icone.on("double-click", afficherFenetre);
    mettreAJourMenuIcone();
  } catch (erreur) {
    // Pas de zone de notification (rare) : la croix quittera l'appli, comme avant.
    console.error("Icône de la zone de notification impossible :", erreur);
    icone = null;
  }
}

/** Lancement au démarrage de Windows (rien à faire sur les autres systèmes). */
function appliquerDemarrageWindows(reglages) {
  if (process.platform !== "win32" && process.platform !== "darwin") return;
  // Seule l'appli INSTALLÉE s'inscrit au démarrage de Windows. Lancée depuis le projet (npm start, VS Code),
  // elle s'inscrivait aussi : deux lancements au démarrage, et parfois une ancienne version qui prenait la place
  // de la nouvelle (une seule copie à la fois). Vu le 02/10/2026.
  if (!app.isPackaged) return;
  app.setLoginItemSettings(
    parametresDemarrageWindows(reglages, { executable: process.execPath, dossierAppli: app.getAppPath(), emballee: app.isPackaged })
  );
}

/**
 * L'appli a-t-elle été lancée réduite au démarrage ? Windows : argument --reduit. Mac : le système ne passe pas
 * d'argument, on regarde le réglage, ce que dit macOS et depuis quand le Mac est allumé (arriere-plan.js).
 */
function lanceeReduite() {
  if (estDemarrageReduit(process.argv)) return true;
  if (process.platform !== "darwin" || !app.isPackaged) return false;
  let ouvertAuDemarrage = false;
  try {
    ouvertAuDemarrage = app.getLoginItemSettings().wasOpenedAtLogin === true;
  } catch {
    // pas fourni par ce macOS : on se fie à l'heure d'allumage du Mac
  }
  return estDemarrageReduitMac({ reglages: stockage.reglagesArrierePlan(), ouvertAuDemarrage, uptimeS: os.uptime() });
}

// Mise à jour de l'appli (au lancement, puis en arrière-plan) : maj-appli.js.
const majAppli = creerMajAppli({
  electron: { app, BrowserWindow, shell },
  actif: () => stockage.reglagesArrierePlan().majAuto,
  envoyer: (etat) => envoyerALaPage("maj:etat", etat),
  journal: noter,
  lanceeReduite,
  icone: cheminIcone("icon"),
});

/** Quitter vraiment (menu de l'icône) : la croix ne cache plus la fenêtre, tout s'arrête. */
function quitter() {
  quitteEnCours = true;
  app.quit();
}

// Windows : pas de barre de menu (Fichier, Édition...), l'appli n'en a pas besoin.
// Mac : le menu en haut de l'écran est indispensable aux raccourcis (Cmd+C, Cmd+V, Cmd+Q...) : posé quand l'appli est prête.
Menu.setApplicationMenu(null);

// Copie de développement (dossier du projet) lancée AUTOMATIQUEMENT (--reduit : démarrage de Windows, ou Windows qui
// rouvre les applis après un redémarrage) : elle s'arrête tout de suite, sans prendre la place de l'appli installée.
// Vu le 02/10/2026 : une ancienne copie relancée par Windows bloquait l'appli installée et ne se connectait pas au client.
// (Lancée à la main depuis le projet, npm start, elle marche normalement.)
const copieDeveloppementAutomatique = !app.isPackaged && estDemarrageReduit(process.argv);

// Une seule instance à la fois : si l'appli tourne déjà, la nouvelle s'arrête tout de suite
// et l'ancienne réaffiche sa fenêtre (event "second-instance").
const instanceUnique = !copieDeveloppementAutomatique && app.requestSingleInstanceLock();
if (!instanceUnique) {
  app.quit();
} else {
  app.on("second-instance", (_evenement, argv) => {
    if (!estDemarrageReduit(argv)) afficherFenetre();
  });

  app.whenReady().then(async () => {
    stockage = creerStockage({ dossier: app.getPath("userData") });
    journal = creerJournal({ fichier: path.join(app.getPath("userData"), "journal.txt") });
    noter(`--- LoL Companion démarre (${app.isPackaged ? "appli installée" : "projet, npm start"}, version ${app.getVersion()})`);
    // Une nouvelle version ? Elle s'installe d'abord, puis l'appli se relance dedans (rien d'autre ne démarre).
    if (await majAppli.installerAuDemarrage()) {
      quitteEnCours = true; // rien ne doit retenir la fermeture : l'installateur attend que l'appli soit fermée
      return;
    }
    progression = creerProgression({ dossier: app.getPath("userData") });
    historiqueParties = creerHistoriqueParties({ dossier: app.getPath("userData") });
    suiviMaitrise = creerSuiviMaitrise({ dossier: app.getPath("userData") });
    stockage.nettoyerAnciensReglages(); // efface l'ancienne clé API si elle était enregistrée
    // Appli installée : nom et icône de l'appli dans les notifications Windows (même identifiant que l'installateur).
    if (process.platform === "win32" && app.isPackaged) app.setAppUserModelId("com.lolcalculator.app");
    brancherMessages();
    brancherIcones();
    creerIcone();
    appliquerDemarrageWindows(stockage.reglagesArrierePlan()); // garde Windows d'accord avec le réglage
    // Lancée par le démarrage de Windows (ou du Mac) avec "démarrer réduit" : la fenêtre reste cachée
    // (seulement si l'icône existe, sinon on ne pourrait plus l'ouvrir).
    creerFenetre({ visible: !(lanceeReduite() && icone) });
    majAppli.fermerEcran(); // petite fenêtre « Mise à jour… » (si la mise à jour du lancement a été abandonnée)
    demarrerAcceptation();
    demarrerSelection();
    demarrerAugments();
    demarrerChronosSorts();
    demarrerSurveillance();
    majAppli.demarrer();

    // Sur Mac : menu de l'appli (raccourcis Cmd+C, Cmd+V, Cmd+Q... : arriere-plan.js, modeleMenuMac).
    if (process.platform === "darwin") Menu.setApplicationMenu(Menu.buildFromTemplate(modeleMenuMac(app.getName())));
    // Sur Mac, on réaffiche la fenêtre quand on clique sur l'icône du dock.
    app.on("activate", afficherFenetre);
  });
}

// Quitter : on arrête proprement la surveillance (WebSocket, minuteries), l'acceptation et l'icône,
// pour que rien ne garde l'appli en mémoire.
app.on("before-quit", () => {
  quitteEnCours = true;
  if (surveillance) surveillance.arreter();
  if (sondage) sondage.arreter();
  clearInterval(chienDeGarde);
  if (acceptation) acceptation.arreter();
  if (selectionAuto) selectionAuto.arreter();
  if (suiviAugments) suiviAugments.arreter(); // arrête aussi la lecture d'écran
  if (majAppli.suivi()) majAppli.suivi().arreter();
  if (fenetreAugments && !fenetreAugments.isDestroyed()) fenetreAugments.destroy();
  if (icone && !icone.isDestroyed()) icone.destroy();
  icone = null;
});

// Toutes les fenêtres fermées (réglage "fermer = réduire" désactivé, ou "Quitter") : l'appli s'arrête.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
