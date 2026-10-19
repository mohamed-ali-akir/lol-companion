/*
 * Ce qui s'affiche PAR-DESSUS LE JEU : fenêtre transparente, stats des augments (ARAM Mayhem, Arena), chronos des sorts (Faille)
 * -----------------------------------------------------------------------------------------------------------------------
 * Tourne dans le processus principal. Sorti de main.js le 17/10/2026 (main.js devenait trop gros, et cette partie
 * n'était pas testée) : test/en-jeu.test.js l'essaie avec une fausse fenêtre et un faux écran.
 * La logique de chaque fonction est dans son module, déjà testé : augments.js (cartes), sorts.js (chronos),
 * pings.js (chat), ocr.js (lecture de l'écran), jeu.js (API officielle du jeu). Ici, on les branche :
 *  - une seule fenêtre transparente (src/overlay.html), créée au premier contenu, cachée quand il n'y a rien ;
 *    elle laisse passer les clics au jeu et ne prend jamais le clavier, sauf la souris sur le panneau des sorts ;
 *  - une seule lecture d'écran (un seul processus PowerShell / Vision) partagée par les augments et le chat ;
 *  - surPhase(phase) : augments seulement pendant une ARAM Mayhem ou une Arena, chronos seulement sur la Faille.
 */
const path = require("path");
const augments = require("./augments.js");
const { lireObjets } = require("./build.js"); // objets du client (noms des objets prismatiques, en Arena)
const { creerLecteurEcran } = require("./ocr.js");
const jeu = require("./jeu.js");
const { creerSuiviSorts } = require("./sorts.js");
const { creerLecteurChat } = require("./pings.js");
const { lirePartie } = require("./build.js");

/** Lecture d'écran possible sur ce système ? (OCR de Windows, ou Vision sur Mac ; rien sous Linux) */
const lectureEcranPossible = (plateforme) => plateforme === "win32" || plateforme === "darwin";

/**
 * electron : { BrowserWindow, screen, systemPreferences } ; plateforme : process.platform ;
 * dossierAppli : dossier de main.js (pour src/overlay.html et preload-overlay.js) ;
 * stockage() : réglages (build, place du panneau) ; obtenirAliasChampions() : Map id -> alias (stats-build.js) ;
 * lecteurArammayhem : arammayhem.js ; lecteurLolalytics : lolalytics.js (augments Arena) ; championPartie() : ton champion retenu pendant la sélection, ou null ;
 * noter(...), proteger(nom, f) : journal et cloisons de main.js.
 * fabriques : (tests) remplace lirePartie, lireAugmentsClient, lireObjets, creerSuiviAugments, creerSuiviSorts, creerLecteurEcran.
 */
function creerEnJeu({ electron, plateforme = process.platform, dossierAppli, stockage, obtenirAliasChampions, lecteurArammayhem, lecteurLolalytics, championPartie, noter, proteger, fabriques = {} }) {
  const { BrowserWindow, screen, systemPreferences } = electron;
  const f = { lirePartie, lireAugmentsClient: augments.lireAugmentsClient, lireObjets, creerSuiviAugments: augments.creerSuiviAugments, creerSuiviSorts, creerLecteurEcran, ...fabriques };
  let fenetre = null; // fenêtre transparente par-dessus le jeu
  const contenu = { augments: null, sorts: null }; // ce qu'elle affiche
  let lecteurEcran = null; // lecture d'écran (ocr.js), lancée seulement quand il faut lire l'écran
  let langueJeu = null; // "en_US"...
  let augmentsClient = null; // tous les augments du client : [{ id, nom }] (langue du jeu)
  let indexAugments = null; // leurs noms, pour reconnaître les cartes
  let prismatiques = null; // objets prismatiques du client : [{ id, nom }] (Arena)
  let indexArena = null; // noms des augments ET des objets prismatiques (cartes de l'Arena)
  let modeAugments = null; // "mayhem" ou "arena" : la partie en cours (choisit la source des stats)
  let suiviAugments = null;
  let suiviSorts = null;

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
   * Mac : l'autorisation « Enregistrement de l'écran » (nécessaire pour lire les augments et le chat) est-elle
   * donnée ? "granted", "denied", "not-determined"... ; null hors Mac ou si macOS ne répond pas.
   */
  function autorisationEcranMac() {
    if (plateforme !== "darwin") return null;
    try {
      return systemPreferences.getMediaAccessStatus("screen");
    } catch {
      return null;
    }
  }

  const fenetreOuverte = () => Boolean(fenetre && !fenetre.isDestroyed());

  /** Fenêtre transparente par-dessus le jeu : elle laisse passer les clics et ne prend jamais la main (focus). */
  function creerFenetre() {
    const { bounds } = screen.getPrimaryDisplay();
    fenetre = new BrowserWindow({
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
        preload: path.join(dossierAppli, "preload-overlay.js"),
      },
    });
    // Les clics passent au jeu ; "forward" laisse quand même la page voir la souris, pour rendre cliquable
    // le seul panneau des sorts quand la souris passe dessus (voir souris()).
    fenetre.setIgnoreMouseEvents(true, { forward: true });
    fenetre.setAlwaysOnTop(true, "screen-saver"); // au-dessus du jeu en mode « Sans bordure »
    if (plateforme === "darwin") {
      // Mac : un jeu en plein écran a son propre bureau (« Space ») ; sans ça, la fenêtre resterait sur le bureau
      // normal, invisible pendant la partie. skipTransformProcessType : l'icône du Dock ne disparaît pas.
      try {
        fenetre.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
      } catch (erreur) {
        noter("Overlay sur Mac :", erreur.message); // l'overlay marche quand même hors plein écran
      }
    }
    fenetre.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    fenetre.loadFile(path.join(dossierAppli, "src", "overlay.html"));
    fenetre.on("closed", () => {
      fenetre = null;
    });
  }

  const vide = () => !contenu.augments && !contenu.sorts;

  /** Met la fenêtre à jour avec le contenu ; elle est cachée quand il n'y a rien à montrer. */
  function majFenetre() {
    if (vide()) {
      if (fenetreOuverte()) {
        fenetre.setIgnoreMouseEvents(true, { forward: true }); // plus de panneau : tout repasse au jeu
        fenetre.hide();
      }
      return;
    }
    if (!fenetreOuverte()) creerFenetre();
    const envoyer = () => {
      if (!fenetreOuverte()) return;
      // Contenu relu au moment d'envoyer : jamais un état plus ancien que le dernier demandé.
      fenetre.webContents.send("augments:etiquettes", { echelle: ecranJeu().echelle, liste: contenu.augments || [] });
      fenetre.webContents.send("sorts:position", stockage().positionSorts());
      fenetre.webContents.send("sorts:etat", contenu.sorts);
      if (!contenu.sorts) fenetre.setIgnoreMouseEvents(true, { forward: true });
      if (vide()) return fenetre.hide();
      fenetre.showInactive(); // visible sans prendre la main
      fenetre.setAlwaysOnTop(true, "screen-saver");
    };
    if (fenetre.webContents.isLoading()) fenetre.webContents.once("did-finish-load", envoyer);
    else envoyer();
  }

  /** Étiquettes sous les cartes d'augments (liste), ou rien (null). */
  function afficherAugments(liste) {
    contenu.augments = liste || null;
    majFenetre();
  }

  /** Panneau des sorts adverses (avec l'icône de chaque champion), ou rien (null). */
  async function afficherSorts(panneau) {
    if (panneau) {
      const ids = new Map([...(await obtenirAliasChampions())].map(([id, alias]) => [String(alias).toLowerCase(), id]));
      panneau = panneau.map((a) => ({ ...a, championId: ids.get(String(a.alias).toLowerCase()) || null }));
    }
    contenu.sorts = panneau || null;
    majFenetre();
  }

  async function obtenirLangueJeu() {
    if (!langueJeu) langueJeu = await augments.lireLangueJeu(stockage().dossierJeu()).catch(() => "en_US");
    return langueJeu;
  }

  async function obtenirAugmentsClient() {
    if (!augmentsClient || augmentsClient.length === 0) augmentsClient = await f.lireAugmentsClient(stockage().dossierJeu());
    return augmentsClient;
  }

  async function obtenirPrismatiques() {
    if (!prismatiques || prismatiques.length === 0) prismatiques = augments.objetsPrismatiques((await f.lireObjets(stockage().dossierJeu())).noms);
    return prismatiques;
  }

  /** Noms à reconnaître sur les cartes : augments ; en Arena, aussi les objets prismatiques. */
  async function obtenirIndexAugments() {
    if (modeAugments === "arena") {
      if (!indexArena || indexArena.size === 0) {
        const [client, objets] = await Promise.all([obtenirAugmentsClient(), obtenirPrismatiques().catch(() => [])]);
        indexArena = augments.indexNoms([...client, ...objets].map((a) => a.nom));
      }
      return indexArena;
    }
    if (!indexAugments || indexAugments.size === 0) indexAugments = augments.indexNoms((await obtenirAugmentsClient()).map((a) => a.nom));
    return indexAugments;
  }

  /** Alias de TON champion : retenu pendant la sélection, sinon lu dans la partie en cours (jeu.js), sinon null. */
  async function aliasPartie() {
    const id = championPartie();
    const alias = id ? (await obtenirAliasChampions()).get(id) : null;
    if (alias) return alias;
    const partie = await jeu.lireJeu();
    return partie ? jeu.monAlias(partie.actif, partie.joueurs) : null;
  }

  function obtenirLecteurEcran() {
    if (!lecteurEcran) lecteurEcran = f.creerLecteurEcran({ langue: langueJeu || "en_US", echelle: () => ecranJeu().echelle }); // échelle : Mac (Retina)
    return lecteurEcran;
  }

  /** Crée les deux suivis (augments et chronos des sorts) ; ils ne lisent rien avant surPhase(). */
  function demarrer() {
    suiviAugments = f.creerSuiviAugments({
      actif: () => lectureEcranPossible(plateforme) && stockage().reglagesBuild().augments,
      ecran: ecranJeu,
      lireEcran: (zone) => obtenirLecteurEcran().lire(zone),
      nomsAugments: obtenirIndexAugments,
      // ARAM Mayhem : notes d'arammayhem.com (arammayhem.js), avec ton champion, sinon tous champions.
      // Arena (19/10/2026) : taux de victoire de Lolalytics (lolalytics.js) avec ton champion, pour les augments
      // et pour les objets prismatiques (même page).
      // Champion retenu pendant la sélection ; appli lancée en pleine partie (vu le 17/10/2026 : « Stats
      // indisponibles ») : on le lit dans la partie en cours (jeu.js).
      statsAugments: async () => {
        const alias = await aliasPartie();
        if (modeAugments === "arena") {
          const [client, objets, arena] = await Promise.all([obtenirAugmentsClient(), obtenirPrismatiques().catch(() => []), lecteurLolalytics.arena({ alias })]);
          return augments.indexStatsArena(client, arena, objets);
        }
        return augments.indexStats(await lecteurArammayhem.augments({ alias }));
      },
      calculerEtiquettes: (...args) => (modeAugments === "arena" ? augments.etiquettesArena(...args) : augments.etiquettes(...args)),
      afficher: afficherAugments,
      arreterLecture: () => {
        if (lecteurEcran) lecteurEcran.arreter();
        lecteurEcran = null;
      },
      journal: noter, // dans journal.txt (sinon seulement dans le terminal, invisible dans l'appli installée)
    });

    const lire = jeu.creerLectureJeuPartagee(); // une seule lecture du jeu par seconde
    // Pings des sorts lus dans le chat (pings.js, exception du 16/10/2026 ; même case que les chronos).
    // Le lecteur d'écran est demandé à chaque lecture : c'est le même que celui des augments (un seul processus).
    const lecteurChat = creerLecteurChat({
      lecteur: {
        capturer: (...args) => obtenirLecteurEcran().capturer(...args),
        lireImage: (...args) => obtenirLecteurEcran().lireImage(...args),
      },
      ecran: () => ecranJeu(),
    });
    suiviSorts = f.creerSuiviSorts({
      reglages: () => stockage().reglagesBuild(), // case « sorts » (chronos et pings)
      lire,
      afficher: (panneau) => proteger("chronos des sorts", () => afficherSorts(panneau)),
      journal: noter,
      lireChat: lectureEcranPossible(plateforme) ? () => lecteurChat.lire() : null,
    });
  }

  /** Augments : on lit l'écran seulement pendant une partie ARAM Mayhem ou Arena, et on arrête tout le reste du temps. */
  async function surPhaseAugments(phase) {
    if (!suiviAugments) return;
    if (phase !== "InProgress") return suiviAugments.arreter();
    const partie = await f.lirePartie(stockage().dossierJeu()).catch(() => null);
    modeAugments = augments.estArena(partie) ? "arena" : augments.estMayhem(partie) ? "mayhem" : null;
    if (!modeAugments) return suiviAugments.arreter();
    await obtenirLangueJeu();
    suiviAugments.demarrer();
  }

  /** Chronos des sorts : seulement pendant une partie sur la Faille. */
  async function surPhaseSorts(phase) {
    if (!suiviSorts) return;
    if (phase !== "InProgress") return suiviSorts.arreter();
    const partie = await f.lirePartie(stockage().dossierJeu()).catch(() => null);
    if (jeu.estFaille(partie)) suiviSorts.demarrer();
    else suiviSorts.arreter();
  }

  /** Phase de jeu (client) : chaque fonction dans sa bulle, une erreur de l'une n'empêche pas l'autre. */
  function surPhase(phase) {
    proteger("augments en jeu", () => surPhaseAugments(phase));
    proteger("chronos des sorts", () => surPhaseSorts(phase));
  }

  /** Le message vient-il de la fenêtre transparente du jeu ? (messages.js) */
  const estFenetre = (evenement) => fenetreOuverte() && evenement.sender === fenetre.webContents;

  /** Souris sur le panneau des sorts (cliquable) ou ailleurs (tout passe au jeu). */
  function souris(dessus) {
    if (fenetreOuverte()) fenetre.setIgnoreMouseEvents(!dessus || !contenu.sorts, { forward: true });
  }

  /** Clic sur un sort du panneau (le joueur l'a vu utilisé). */
  function clicSort(id) {
    if (suiviSorts) suiviSorts.clic(id);
  }

  /** Quitter : tout s'arrête (lectures, minuteries, fenêtre), pour que rien ne garde l'appli en mémoire. */
  function arreter() {
    if (suiviAugments) suiviAugments.arreter(); // arrête aussi la lecture d'écran
    if (suiviSorts) suiviSorts.arreter();
    fermerFenetre();
  }

  /** Ferme la fenêtre transparente (fenêtre principale fermée, ou appli qui quitte). */
  function fermerFenetre() {
    if (fenetreOuverte()) fenetre.destroy();
  }

  return { demarrer, surPhase, estFenetre, souris, clicSort, arreter, fermerFenetre, ecranJeu, autorisationEcranMac };
}

module.exports = { creerEnJeu, lectureEcranPossible };
