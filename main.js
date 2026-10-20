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
const { creerEnJeu } = require("./en-jeu.js"); // fenêtre transparente par-dessus le jeu : augments, chronos des sorts
const path = require("path");
const os = require("os"); // os.uptime() : depuis quand le Mac est allumé (démarrage réduit)
const { recupererCompteClient, lireToutHistorique } = require("./lcu.js");
const { creerStockage, DOSSIER_JEU_PAR_DEFAUT } = require("./stockage.js");
const { surveillerClient } = require("./surveillance.js");
const { creerProgression, creerPoint, riotIdDe } = require("./progression.js");
const { xpDuCompte } = require("./src/calculs.js"); // même calcul d'XP que la page
const { creerAcceptation, accepterReadyCheck, leagueAuPremierPlan } = require("./acceptation.js");
const { creerSelectionAuto, effectuerAction, lireChampionsAutorises } = require("./selection.js");
const { lireRecommandations, appliquerPage, monChampion } = require("./runes.js");
const { creerLecteurArammayhem } = require("./arammayhem.js");
const { creerSondage, etatPreparation } = require("./sondage.js");
const { creerJournal } = require("./journal.js");
const { creerBuildAuto, lirePartie, appliquerSet, remettreSets, appliquerSorts } = require("./build.js");
const { creerSauvegardeSets } = require("./sauvegarde-sets.js"); // tes sets, copiés avant d'être retirés du client
const { creerLecteurOpgg } = require("./opgg.js");
const { creerStatsBuild } = require("./stats-build.js");
const { creerLecteurLolalytics } = require("./lolalytics.js");
const { creerHistoriqueParties } = require("./parties.js");
const { creerConseillerDraft } = require("./draft.js");
const { creerChallenge } = require("./challenge.js"); // onglet Challenge : top 3 en Arena avec tous les champions
const { recupererMaitrise, creerSuiviMaitrise, mettreAJourSuivi, moyennesParChampion } = require("./maitrise.js");
const { surProbleme } = require("./fichiers.js"); // écriture sûre des fichiers de données
const { migrerDonnees } = require("./migrations.js"); // version du format des fichiers de données
const { creerMajAppli } = require("./maj-appli.js"); // mise à jour de l'appli (au lancement, puis en arrière-plan)
const { brancherMessages, reponseErreur } = require("./messages.js"); // messages de la page et de la fenêtre du jeu
const { routeIcone, creerCacheIcones, chargerImageClient, PROTOCOLE_ICONES } = require("./champions.js");
const {
  actionFermeture,
  parametresDemarrageWindows,
  estDemarrageReduit,
  estDemandeQuitter,
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


// ---------------------------------------------------------------------------
// Messages de la page et de la fenêtre du jeu (via preload.js / preload-overlay.js) : messages.js.
// Les services sont lus au moment du message (fenêtres et suivis créés plus tard, ou recréés).
// ---------------------------------------------------------------------------

/** Sauvegarde de tes sets d'objets (sauvegarde-sets.js), dans le dossier des données de l'appli. */
const sauvegardeSets = () => creerSauvegardeSets({ dossier: app.getPath("userData") });

function brancherMessagesAppli() {
  brancherMessages(ipcMain, {
    estPage: (evenement) => Boolean(fenetre && !fenetre.isDestroyed() && evenement.sender === fenetre.webContents),
    estOverlay: (evenement) => enJeu.estFenetre(evenement),
    stockage: () => stockage,
    progression: () => progression,
    historiqueParties: () => historiqueParties,
    remettreSets: () => remettreSets(stockage.dossierJeu(), (compte) => sauvegardeSets().setsDu(compte)),
    config: () => ({
      dossierJeuParDefaut: DOSSIER_JEU_PAR_DEFAUT,
      plateforme: process.platform, // "win32" ou "darwin" (Mac) : la page adapte ses textes
      autorisationEcran: enJeu.autorisationEcranMac(), // Mac : « Enregistrement de l'écran » donné ? (augments) ; null ailleurs
      lancement, // heure d'ouverture de l'appli (session "depuis l'ouverture")
    }),
    lireCompte,
    lireMaitrise,
    importerHistorique,
    lireChallenge: () => challenge.lire(),
    obtenirNomsChampions: () => obtenirNomsChampions(),
    analyserOpgg: (contexte) => analyserOpgg(contexte),
    analyserLolalytics: (contexte) => analyserLolalytics(contexte),
    apresReglagesAcceptation: () => mettreAJourMenuIcone(),
    appliquerDemarrageWindows,
    // Panneau des sorts : la fenêtre ne prend la souris que quand elle est dessus (sinon tout passe au jeu).
    souris: (dessus) => enJeu.souris(dessus),
    clicSort: (id) => enJeu.clicSort(id),
    dernierConseil: () => dernierConseil,
    clientConnecte: () => clientConnecte,
    etatAppli: () => etatAppli,
    majAppli: () => majAppli.suivi(),
    versionAppli: () => app.getVersion(),
    avantInstallation: () => {
      quitteEnCours = true;
    },
    proteger,
    signalerErreur,
  });
}

// Stats de build (noms et alias des champions, objets du client, OP.GG, Lolalytics, set Rank 1) : stats-build.js.
const { obtenirNomsChampions, obtenirAliasChampions, analyserOpgg, analyserLolalytics, analyserRank1 } = creerStatsBuild({
  dossierJeu: () => stockage.dossierJeu(),
  lecteurOpgg,
  lecteurLolalytics,
});

// Challenge Arena (challenge.js) : progression lue dans parties.json, et liste du pick automatique en Arena.
const challenge = creerChallenge({
  reglages: () => stockage.reglagesChallenge(),
  nomsChampions: () => obtenirNomsChampions(),
  parties: () => {
    const compte = stockage.dernierCompte();
    return compte ? historiqueParties.partiesDu(riotIdDe(compte)) : [];
  },
  lirePartie: () => lirePartie(stockage.dossierJeu()),
});

// Ce qui s'affiche par-dessus le jeu (en-jeu.js) : stats des augments (ARAM Mayhem et Arena) et chronos des sorts (Faille).
const enJeu = creerEnJeu({
  electron: { BrowserWindow, screen, systemPreferences },
  dossierAppli: __dirname,
  stockage: () => stockage,
  obtenirAliasChampions,
  lecteurArammayhem,
  lecteurLolalytics, // augments Arena
  championPartie: () => championPartie,
  noter,
  proteger,
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

/**
 * Affiche une notification du système ; un clic ouvre la fenêtre de l'appli.
 * Depuis Electron 42, une notification Mac exige une appli signée par un développeur Apple : la nôtre ne l'est pas
 * (signature « ad hoc »), le système la refuse et Electron envoie « failed ». On le note dans le journal au lieu de
 * rester silencieux (Windows n'est pas concerné).
 */
function montrerNotification(options) {
  const notification = new Notification(options);
  notification.on("click", afficherFenetre);
  notification.on("failed", (_evenement, erreur) => noter("Notification refusée par le système :", options.title, "-", erreur));
  notification.show();
}

/** Notification "Partie trouvée !", seulement si l'option est cochée et que League n'est pas au premier plan. */
async function notifierPartieTrouvee({ autoActif, delaiSecondes }) {
  envoyerALaPage("acceptation:evenement", { type: "trouvee", autoActif, delaiSecondes });
  if (!stockage.reglagesAcceptation().notifier || !Notification.isSupported()) return;
  if (await leagueAuPremierPlan()) return; // tu regardes déjà League : pas besoin de te déranger
  montrerNotification({
    title: "Partie trouvée !",
    body: autoActif
      ? `LoL Companion l'accepte dans ${delaiSecondes} s. Retourne dans League si tu veux la refuser.`
      : "Retourne dans League pour l'accepter.",
    silent: false, // avec le son de notification de Windows
  });
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
  montrerNotification({
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
    // En Arena, case du challenge cochée : le prochain champion du challenge (puis les suivants) au lieu des listes.
    pickPrioritaire: () => challenge.pickPrioritaire(),
    journal: (...morceaux) => noter("Sélection :", ...morceaux),
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
    // Seuls nos sets restent dans le client (19/10/2026) : les tiens sont d'abord copiés dans sets-sauvegarde.json.
    appliquerObjets: (set) => appliquerSet(stockage.dossierJeu(), set, { sauvegarder: (compte, sets) => sauvegardeSets().ajouter(compte, sets) }),
    nomChampion: async (championId) => (await obtenirNomsChampions()).get(championId) || `Champion n° ${championId}`,
    carte: async () => {
      const partie = await lirePartie(stockage.dossierJeu()).catch(() => null);
      return (partie && partie.map && partie.map.id) || 11;
    },
    journal: (...morceaux) => noter("Build :", ...morceaux), // runes, sets, sorts et erreurs, gardés dans journal.txt
    resultat: async (info) => {
      const noms = await obtenirNomsChampions();
      envoyerALaPage("build:evenement", { ...info, nom: noms.get(info.championId) || null });
    },
  });
}

// ---------------------------------------------------------------------------
// Surveillance en direct : le client prévient quand une partie se termine.
// ---------------------------------------------------------------------------

/**
 * Sélection des champions (connexion en direct OU sondage) : pick/ban, build, et ton champion pour les augments.
 * Chacun dans sa bulle : si le pick/ban plante, le build continue (et inversement).
 */
let fileSelection = Promise.resolve(); // sessions traitées une par une, dans l'ordre d'arrivée
let derniereSession = null;

function surSelection(session) {
  // Avant le pick automatique : est-ce une Arena, et quels champions du challenge restent (une lecture par sélection) ?
  // Une session dépassée par une plus récente pendant cette lecture est sautée : seule la dernière compte.
  derniereSession = session;
  fileSelection = fileSelection
    .then(async () => {
      await challenge.preparer(session);
      if (session === derniereSession) selectionAuto.surSession(session);
    })
    .catch((erreur) => signalerErreur("pick et ban automatiques", erreur)); // la file continue après une erreur
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
      if (connecte) proteger("phase en jeu", async () => enJeu.surPhase(((await lirePartie(stockage.dossierJeu())) || {}).phase));
    },
    aReadyCheck: (etat) => acceptation.surReadyCheck(etat), // partie trouvée : tout de suite, sans attendre
    aPhase: (phase) => {
      phaseDirecte = phase;
      enJeu.surPhase(phase);
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
    aPhase: (phase) => enJeu.surPhase(phase),
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
    // Fenêtre principale vraiment fermée : la fenêtre du jeu ne doit pas garder l'appli ouverte.
    enJeu.fermerFenetre();
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
  montrerNotification({
    title: "LoL Companion tourne toujours",
    body: "L'appli reste dans la zone de notification (à côté de l'horloge) et continue de surveiller le client. " +
      "Clic droit sur son icône pour la quitter. Tu peux changer ça dans les Paramètres.",
    icon: cheminIcone("icon"),
    silent: true,
  });
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
// Lancée avec --quitter : elle a déjà prévenu l'appli ouverte (second-instance ci-dessous) ; s'il n'y en avait pas, rien à faire.
if (!instanceUnique || estDemandeQuitter(process.argv)) {
  app.quit();
} else {
  app.on("second-instance", (_evenement, argv) => {
    if (estDemandeQuitter(argv)) quitter(); // fermeture propre demandée de l'extérieur (une mise à jour prête s'installe)
    else if (!estDemarrageReduit(argv)) afficherFenetre();
  });

  app.whenReady().then(async () => {
    stockage = creerStockage({ dossier: app.getPath("userData") });
    journal = creerJournal({ fichier: path.join(app.getPath("userData"), "journal.txt") });
    surProbleme((message) => noter(`Fichier de données : ${message}`)); // fichiers.js : fichier abîmé, copie .bak relue
    noter(`--- LoL Companion démarre (${app.isPackaged ? "appli installée" : "projet, npm start"}, version ${app.getVersion()})`);
    // Une nouvelle version ? Elle s'installe d'abord, puis l'appli se relance dedans (rien d'autre ne démarre).
    if (await majAppli.installerAuDemarrage()) {
      quitteEnCours = true; // rien ne doit retenir la fermeture : l'installateur attend que l'appli soit fermée
      return;
    }
    // Fichiers de données au format de cette version, AVANT de les lire (migrations.js ; n'échoue jamais).
    migrerDonnees({ dossier: app.getPath("userData"), journal: noter });
    progression = creerProgression({ dossier: app.getPath("userData") });
    historiqueParties = creerHistoriqueParties({ dossier: app.getPath("userData") });
    suiviMaitrise = creerSuiviMaitrise({ dossier: app.getPath("userData") });
    stockage.nettoyerAnciensReglages(); // efface l'ancienne clé API si elle était enregistrée
    // Appli installée : nom et icône de l'appli dans les notifications Windows (même identifiant que l'installateur).
    if (process.platform === "win32" && app.isPackaged) app.setAppUserModelId("com.lolcalculator.app");
    brancherMessagesAppli();
    brancherIcones();
    creerIcone();
    appliquerDemarrageWindows(stockage.reglagesArrierePlan()); // garde Windows d'accord avec le réglage
    // Lancée par le démarrage de Windows (ou du Mac) avec "démarrer réduit" : la fenêtre reste cachée
    // (seulement si l'icône existe, sinon on ne pourrait plus l'ouvrir).
    creerFenetre({ visible: !(lanceeReduite() && icone) });
    majAppli.fermerEcran(); // petite fenêtre « Mise à jour… » (si la mise à jour du lancement a été abandonnée)
    demarrerAcceptation();
    demarrerSelection();
    enJeu.demarrer(); // stats des augments et chronos des sorts (ne lisent rien avant une partie)
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
  enJeu.arreter(); // augments (et lecture d'écran), chronos des sorts, fenêtre du jeu
  if (majAppli.suivi()) majAppli.suivi().arreter();
  if (icone && !icone.isDestroyed()) icone.destroy();
  icone = null;
});

// Toutes les fenêtres fermées (réglage "fermer = réduire" désactivé, ou "Quitter") : l'appli s'arrête.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
