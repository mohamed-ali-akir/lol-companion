// Tests de ce qui s'affiche par-dessus le jeu (en-jeu.js), avec une fausse fenêtre, un faux écran et de faux suivis.
const test = require("node:test");
const assert = require("node:assert");
const { creerEnJeu, lectureEcranPossible } = require("../en-jeu.js");

/** Fausse BrowserWindow : garde tout ce que l'appli lui demande. */
function fausseElectron({ mediaAccess = () => "granted" } = {}) {
  const fenetres = [];
  class FausseFenetre {
    constructor(options) {
      this.options = options;
      this.appels = [];
      this.envoyes = [];
      this.detruite = false;
      this.ecouteurs = {};
      this.webContents = {
        send: (canal, donnees) => this.envoyes.push([canal, donnees]),
        isLoading: () => false,
        once: () => {},
        setWindowOpenHandler: (f) => (this.ouvertureRefusee = f().action === "deny"),
      };
      fenetres.push(this);
    }
    setIgnoreMouseEvents(ignorer) {
      this.appels.push(["ignorerSouris", ignorer]);
    }
    setAlwaysOnTop() {}
    setVisibleOnAllWorkspaces() {
      this.appels.push(["tousLesBureaux"]);
    }
    loadFile(f) {
      this.page = f;
    }
    on(evenement, f) {
      this.ecouteurs[evenement] = f;
    }
    hide() {
      this.appels.push(["cacher"]);
    }
    showInactive() {
      this.appels.push(["montrer"]);
    }
    isDestroyed() {
      return this.detruite;
    }
    destroy() {
      this.detruite = true;
      if (this.ecouteurs.closed) this.ecouteurs.closed();
    }
  }
  return {
    fenetres,
    electron: {
      BrowserWindow: FausseFenetre,
      screen: { getPrimaryDisplay: () => ({ bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1.25 }) },
      systemPreferences: { getMediaAccessStatus: mediaAccess },
    },
  };
}

/** Faux suivis (augments, sorts) : gardent leurs appels, et donnent accès à la fonction afficher reçue. */
function fauxSuivi(journal, nom) {
  const suivi = { options: null };
  const fabrique = (options) => {
    suivi.options = options;
    return {
      demarrer: () => journal.push(`${nom}:demarrer`),
      arreter: () => journal.push(`${nom}:arreter`),
      clic: (id) => journal.push(`${nom}:clic:${id}`),
    };
  };
  return { suivi, fabrique };
}

const FAILLE = { map: { id: 11 }, gameData: { queue: { id: 420, mapId: 11 } } };
const MAYHEM = { map: { id: 12 }, gameData: { queue: { id: 2400, gameMode: "KIWI", mapId: 12 } } };
const ARENA = { map: { id: 30 }, gameData: { queue: { id: 1700, gameMode: "CHERRY", mapId: 30 } } };

function enJeu({ plateforme = "win32", partie = FAILLE, mediaAccess, reglages = { augments: true, sorts: true } } = {}) {
  const journal = [];
  const erreurs = [];
  const { electron, fenetres } = fausseElectron({ mediaAccess });
  const augments = fauxSuivi(journal, "augments");
  const sorts = fauxSuivi(journal, "sorts");
  const module = creerEnJeu({
    electron,
    plateforme,
    dossierAppli: "/appli",
    stockage: () => ({ dossierJeu: () => "/jeu-absent", reglagesBuild: () => reglages, positionSorts: () => ({ x: 0.4, y: 0.1 }) }),
    obtenirAliasChampions: async () => new Map([[103, "Ahri"], [222, "Jinx"]]),
    lecteurArammayhem: { augments: async () => ({ champion: [], global: [{ nom: "Hellbent", note: "S", rang: 3, apparition: 0.2 }] }) },
    lecteurLolalytics: {
      arena: async () => ({ victoireChampion: 0.5, augments: new Map([[48, { victoire: 0.62, choix: 0.1, parties: 900 }]]), prismatiques: new Map([[447108, { victoire: 0.7, choix: 0.2, parties: 900 }]]) }),
    },
    championPartie: () => 103,
    noter: () => {},
    proteger: (nom, f) => {
      try {
        const r = f();
        if (r && r.catch) r.catch((e) => erreurs.push([nom, e.message]));
      } catch (e) {
        erreurs.push([nom, e.message]);
      }
    },
    fabriques: {
      lirePartie: async () => partie,
      lireAugmentsClient: async () => [{ id: 48, nom: "Hellbent" }], // cherry-augments.json du client
      lireObjets: async () => ({ noms: new Map([[447108, "Sculpteur de rune"], [3089, "Coiffe de Rabadon"]]) }), // items.json du client
      creerSuiviAugments: augments.fabrique,
      creerSuiviSorts: sorts.fabrique,
      creerLecteurEcran: () => ({ lire: async () => [], arreter: () => journal.push("ecran:arreter") }),
    },
  });
  module.demarrer();
  return { module, journal, erreurs, fenetres, augments: augments.suivi, sorts: sorts.suivi };
}
const attendre = () => new Promise((ok) => setImmediate(ok));

test("fenêtre du jeu : créée au premier contenu seulement, transparente, sans clavier, isolée, popups refusées", async () => {
  const { augments, fenetres } = enJeu();
  assert.strictEqual(fenetres.length, 0, "rien à montrer : pas de fenêtre");
  augments.options.afficher([{ texte: "58 %" }]);
  assert.strictEqual(fenetres.length, 1);
  const [f] = fenetres;
  assert.strictEqual(f.options.transparent, true);
  assert.strictEqual(f.options.focusable, false, "ne vole jamais le clavier au jeu");
  assert.deepStrictEqual([f.options.webPreferences.contextIsolation, f.options.webPreferences.nodeIntegration, f.options.webPreferences.sandbox], [true, false, true]);
  assert.match(f.page.replace(/\\/g, "/"), /\/appli\/src\/overlay\.html$/);
  assert.strictEqual(f.ouvertureRefusee, true);
  assert.deepStrictEqual(f.appels[0], ["ignorerSouris", true], "les clics passent au jeu dès la création");
  assert.deepStrictEqual(f.envoyes.find(([c]) => c === "augments:etiquettes")[1], { echelle: 1.25, liste: [{ texte: "58 %" }] });
  assert.ok(f.appels.some(([a]) => a === "montrer"));
});

test("fenêtre du jeu : cachée quand il n'y a plus rien, puis réutilisée (jamais deux fenêtres)", () => {
  const { augments, fenetres } = enJeu();
  augments.options.afficher([{ texte: "x" }]);
  augments.options.afficher(null);
  assert.deepStrictEqual(fenetres[0].appels.slice(-2), [["ignorerSouris", true], ["cacher"]]);
  augments.options.afficher([{ texte: "y" }]);
  assert.strictEqual(fenetres.length, 1);
});

test("panneau des sorts : icône retrouvée par l'alias du champion, place du panneau envoyée, souris prise seulement dessus", async () => {
  const { sorts, module, fenetres } = enJeu();
  sorts.options.afficher([{ alias: "ahri", sorts: [] }, { alias: "Inconnu", sorts: [] }]);
  await attendre();
  const [f] = fenetres;
  assert.deepStrictEqual(f.envoyes.find(([c]) => c === "sorts:etat")[1].map((a) => a.championId), [103, null]);
  assert.deepStrictEqual(f.envoyes.find(([c]) => c === "sorts:position")[1], { x: 0.4, y: 0.1 });
  module.souris(true);
  module.souris(false);
  assert.deepStrictEqual(f.appels.slice(-2), [["ignorerSouris", false], ["ignorerSouris", true]]);
  sorts.options.afficher(null); // fin de partie : plus de panneau
  await attendre();
  module.souris(true);
  assert.deepStrictEqual(f.appels.at(-1), ["ignorerSouris", true], "sans panneau, la souris reste au jeu");
});

test("messages : seule la vraie fenêtre du jeu est reconnue ; un clic est transmis aux chronos", () => {
  const { module, augments, fenetres, journal } = enJeu();
  assert.strictEqual(module.estFenetre({ sender: {} }), false, "pas encore de fenêtre");
  augments.options.afficher([{ texte: "x" }]);
  assert.strictEqual(module.estFenetre({ sender: fenetres[0].webContents }), true);
  assert.strictEqual(module.estFenetre({ sender: {} }), false);
  module.clicSort("Jinx-Flash");
  assert.ok(journal.includes("sorts:clic:Jinx-Flash"));
  module.souris(true); // sans panneau des sorts : ne plante pas
});

test("phases : chronos sur la Faille, augments en ARAM Mayhem et en Arena, tout arrêté hors partie", async () => {
  const faille = enJeu({ partie: FAILLE });
  faille.module.surPhase("InProgress");
  await attendre();
  await attendre();
  assert.ok(faille.journal.includes("sorts:demarrer") && faille.journal.includes("augments:arreter"));

  const mayhem = enJeu({ partie: MAYHEM });
  mayhem.module.surPhase("InProgress");
  await new Promise((ok) => setTimeout(ok, 20));
  assert.ok(mayhem.journal.includes("augments:demarrer") && mayhem.journal.includes("sorts:arreter"));

  const arena = enJeu({ partie: ARENA });
  arena.module.surPhase("InProgress");
  await new Promise((ok) => setTimeout(ok, 20));
  assert.ok(arena.journal.includes("augments:demarrer") && arena.journal.includes("sorts:arreter"));

  const fin = enJeu();
  fin.module.surPhase("EndOfGame");
  await attendre();
  assert.deepStrictEqual(fin.journal.sort(), ["augments:arreter", "sorts:arreter"]);
  assert.deepStrictEqual([faille.erreurs, mayhem.erreurs, arena.erreurs, fin.erreurs], [[], [], [], []]);
});

test("augments : stats et étiquettes de Lolalytics en Arena, d'arammayhem.com en ARAM Mayhem", async () => {
  const cartes = [{ nom: "Hellbent", x: 700, y: 581, largeur: 100, hauteur: 20 }];
  for (const [partie, attendu] of [[ARENA, "62 % de victoires"], [MAYHEM, "Top 3 · choisi 20 %"]]) {
    const { module, augments } = enJeu({ partie });
    module.surPhase("InProgress");
    await new Promise((ok) => setTimeout(ok, 20));
    const stats = await augments.options.statsAugments();
    assert.strictEqual(augments.options.calculerEtiquettes(cartes, stats, 1440)[0].texte, attendu);
    // Objets prismatiques : reconnus et notés en Arena seulement.
    const noms = await augments.options.nomsAugments();
    assert.strictEqual(noms.has("sculpteurderune"), partie === ARENA);
    if (partie === ARENA) assert.strictEqual(stats.get("sculpteurderune").victoire, 0.7);
  }
});

test("quitter : les deux suivis s'arrêtent (les chronos aussi, oubliés avant) et la fenêtre est détruite", () => {
  const { module, augments, fenetres, journal } = enJeu();
  augments.options.afficher([{ texte: "x" }]);
  module.arreter();
  assert.ok(journal.includes("augments:arreter") && journal.includes("sorts:arreter"));
  assert.strictEqual(fenetres[0].detruite, true);
  assert.strictEqual(module.estFenetre({ sender: fenetres[0].webContents }), false);
  assert.doesNotThrow(() => module.arreter(), "deux fois : sans erreur");
});

test("lecture de l'écran : Windows et Mac seulement ; autorisation Mac lue sans jamais planter", () => {
  assert.deepStrictEqual(["win32", "darwin", "linux"].map(lectureEcranPossible), [true, true, false]);
  assert.strictEqual(enJeu({ plateforme: "linux" }).sorts.options.lireChat, null, "pas de lecture du chat sous Linux");
  assert.strictEqual(typeof enJeu({ plateforme: "win32" }).sorts.options.lireChat, "function");
  assert.strictEqual(enJeu({ plateforme: "win32" }).module.autorisationEcranMac(), null);
  assert.strictEqual(enJeu({ plateforme: "darwin" }).module.autorisationEcranMac(), "granted");
  const muet = enJeu({ plateforme: "darwin", mediaAccess: () => { throw new Error("macOS muet"); } });
  assert.strictEqual(muet.module.autorisationEcranMac(), null);
  // Augments actifs : réglage ET système capable de lire l'écran
  assert.strictEqual(enJeu({ plateforme: "linux" }).augments.options.actif(), false);
  assert.strictEqual(enJeu({ plateforme: "win32" }).augments.options.actif(), true);
});

test("Mac : la fenêtre suit le jeu sur son bureau plein écran", () => {
  const { augments, fenetres } = enJeu({ plateforme: "darwin" });
  augments.options.afficher([{ texte: "x" }]);
  assert.ok(fenetres[0].appels.some(([a]) => a === "tousLesBureaux"));
});
