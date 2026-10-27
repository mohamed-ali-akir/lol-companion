// Tests des messages de la page et de la fenêtre du jeu (messages.js), avec un faux ipcMain et de faux services.
const test = require("node:test");
const assert = require("node:assert");
const M = require("../messages.js");
const { ErreurClient } = require("../lcu.js");
const { ErreurStockage } = require("../stockage.js");

const PAGE = { sender: "page" };
const OVERLAY = { sender: "overlay" };
const ETRANGER = { sender: "autre fenêtre" };

/** Faux ipcMain : garde les récepteurs ; demander() / envoyer() jouent un message comme Electron. */
function fauxIpc() {
  const reponses = new Map();
  const ecoutes = new Map();
  return {
    handle: (canal, f) => reponses.set(canal, f),
    on: (canal, f) => ecoutes.set(canal, f),
    canaux: () => ({ reponses: [...reponses.keys()], ecoutes: [...ecoutes.keys()] }),
    demander: (canal, evenement = PAGE, ...args) => reponses.get(canal)(evenement, ...args),
    envoyer: (canal, evenement = OVERLAY, ...args) => ecoutes.get(canal)(evenement, ...args),
  };
}

/** Faux services de main.js ; journal.erreurs garde ce que signalerErreur aurait écrit. */
function fauxServices(changements = {}) {
  const journal = { erreurs: [], appels: [] };
  const reglages = { dossierJeu: "C:\\Riot Games\\League of Legends" };
  const stockage = {
    dossierJeu: () => reglages.dossierJeu,
    dernierCompte: () => ({ nom: "Moi", tag: "EUW" }),
    ongletActif: () => "stats",
    enregistrerOngletActif: (nom) => {
      if (nom === "?") throw new ErreurStockage("Nom d'onglet invalide.");
    },
    enregistrerDossierJeu: (d) => (reglages.dossierJeu = d),
    reglagesAcceptation: () => ({ actif: false }),
    enregistrerReglagesAcceptation: (r) => ({ actif: r.actif === true }),
    reglagesSelection: () => ({}),
    enregistrerReglagesSelection: (r) => r,
    enregistrerReglagesChallenge: (r) => ({ pickActif: r.pickActif === true, delaiSecondes: 10 }),
    reglagesBuild: () => ({ stats: false }),
    enregistrerReglagesBuild: (r) => r,
    reglagesArrierePlan: () => ({}),
    enregistrerReglagesArrierePlan: (r) => ({ ...r, propre: true }),
    enregistrerPositionSorts: (p) => journal.appels.push(["position", p]),
    assistantVu: () => reglages.assistantVu === true,
    noterAssistantVu: () => (reglages.assistantVu = true),
  };
  const services = {
    estPage: (e) => e === PAGE,
    estOverlay: (e) => e === OVERLAY,
    stockage: () => stockage,
    progression: () => ({ pointsDu: (riotId) => [riotId] }),
    historiqueParties: () => ({ partiesDu: (riotId) => [riotId] }),
    remettreSets: async () => 3,
    config: () => ({ dossierJeuParDefaut: "C:\\Riot Games\\League of Legends", plateforme: "win32", autorisationEcran: null, lancement: 123 }),
    lireCompte: async () => ({ ok: true }),
    lireMaitrise: async () => ({ ok: true }),
    importerHistorique: async () => ({ ok: true, nouvelles: 0 }),
    lireChallenge: async () => ({ ok: true, faits: 1, restants: 2 }),
    obtenirNomsChampions: async () => new Map([[103, "Ahri"], [1, "Annie"], [-1, "Aucun"], [266, "Aatrox"]]),
    analyserOpgg: async () => {
      throw new Error("OP.GG en panne");
    },
    analyserLolalytics: async () => {
      throw new Error("Lolalytics en panne");
    },
    apresReglagesAcceptation: () => journal.appels.push(["menu"]),
    appliquerDemarrageWindows: (r) => journal.appels.push(["demarrage", r]),
    souris: (dessus) => journal.appels.push(["souris", dessus]),
    clicSort: (id) => journal.appels.push(["clic", id]),
    dernierConseil: () => null,
    clientConnecte: () => true,
    etatAppli: () => ({ pret: true }),
    majAppli: () => null,
    versionAppli: () => "1.3.3",
    avantInstallation: () => journal.appels.push(["installation"]),
    proteger: (nom, f) => {
      try {
        f();
      } catch (erreur) {
        journal.erreurs.push([nom, erreur.message]);
      }
    },
    signalerErreur: (nom, erreur) => journal.erreurs.push([nom, erreur.message]),
    ...changements,
  };
  return { services, journal };
}

function brancher(changements) {
  const ipc = fauxIpc();
  const { services, journal } = fauxServices(changements);
  M.brancherMessages(ipc, services);
  return { ipc, journal };
}

// --- Règles communes -------------------------------------------------------------------------------

test("origine : une question qui ne vient pas de la page de l'appli est refusée", async () => {
  const { ipc } = brancher();
  await assert.rejects(ipc.demander("config:lire", ETRANGER), /refusé : il ne vient pas de la page/);
  await assert.rejects(ipc.demander("config:lire", OVERLAY), /refusé/, "la fenêtre du jeu ne pose pas les questions de la page");
  assert.strictEqual((await ipc.demander("config:lire")).ongletActif, "stats");
});

test("origine : un message de la fenêtre du jeu venant d'ailleurs est ignoré", () => {
  const { ipc, journal } = brancher();
  ipc.envoyer("sorts:clic", PAGE, "Ahri-Flash");
  ipc.envoyer("sorts:clic", ETRANGER, "Ahri-Flash");
  assert.deepStrictEqual(journal.appels, []);
  ipc.envoyer("sorts:clic", OVERLAY, "Ahri-Flash");
  ipc.envoyer("sorts:clic", OVERLAY, 42); // pas un identifiant de sort : ignoré
  ipc.envoyer("overlay:souris", OVERLAY, "oui"); // seul true veut dire « dessus »
  ipc.envoyer("sorts:position", OVERLAY, { x: 0.5, y: 0.1 });
  assert.deepStrictEqual(journal.appels, [["clic", "Ahri-Flash"], ["souris", false], ["position", { x: 0.5, y: 0.1 }]]);
});

test("erreur inattendue : écrite dans le journal, et la page reçoit l'erreur comme avant", async () => {
  const { ipc, journal } = brancher({
    lireMaitrise: async () => {
      throw new Error("plantage");
    },
  });
  await assert.rejects(ipc.demander("maitrise:lire"), /plantage/);
  assert.deepStrictEqual(journal.erreurs, [["message « maitrise:lire »", "plantage"]]);
});

test("erreur d'un message de la fenêtre du jeu : rattrapée dans sa bulle, rien ne casse", () => {
  const { ipc, journal } = brancher({
    clicSort: () => {
      throw new Error("chrono cassé");
    },
  });
  assert.doesNotThrow(() => ipc.envoyer("sorts:clic", OVERLAY, "x"));
  assert.deepStrictEqual(journal.erreurs, [["message « sorts:clic » du jeu", "chrono cassé"]]);
});

test("réponse d'erreur : message lisible pour une erreur prévue, « inattendue » sinon", () => {
  assert.deepStrictEqual(M.reponseErreur(new ErreurClient("Lance League of Legends.")), { ok: false, erreur: "Lance League of Legends.", probleme: null });
  const pasLance = Object.assign(new ErreurClient("Client fermé."), { probleme: "pas-lance" });
  assert.strictEqual(M.reponseErreur(pasLance).probleme, "pas-lance");
  assert.strictEqual(M.reponseErreur(new TypeError("x is undefined")).erreur, "Erreur inattendue : x is undefined");
  assert.strictEqual(M.reponseErreur("texte").erreur, "Erreur inattendue : texte", "même une erreur qui n'est pas un objet Error");
});

// --- Messages ---------------------------------------------------------------------------------------

test("réglages : enregistrés -> { ok, reglages } ; refusés -> { ok: false, erreur } ; effets à côté appliqués", async () => {
  const { ipc, journal } = brancher();
  assert.deepStrictEqual(await ipc.demander("config:enregistrerOnglet", PAGE, "stats"), { ok: true });
  assert.deepStrictEqual(await ipc.demander("config:enregistrerOnglet", PAGE, "?"), { ok: false, erreur: "Nom d'onglet invalide.", probleme: null });
  assert.deepStrictEqual(await ipc.demander("config:enregistrerDossierJeu", PAGE, "D:\\LoL"), { ok: true, dossierJeu: "D:\\LoL" });
  assert.deepStrictEqual(await ipc.demander("acceptation:enregistrer", PAGE, { actif: true }), { ok: true, reglages: { actif: true } });
  assert.deepStrictEqual(await ipc.demander("arrierePlan:enregistrer", PAGE, { reduire: true }), { ok: true, reglages: { reduire: true, propre: true } });
  assert.deepStrictEqual(journal.appels, [["menu"], ["demarrage", { reduire: true, propre: true }]]);
});

test("challenge : progression demandée à challenge.js, case enregistrée (désactivée si la valeur est bizarre)", async () => {
  const { ipc } = brancher();
  assert.deepStrictEqual(await ipc.demander("challenge:lire"), { ok: true, faits: 1, restants: 2 });
  assert.deepStrictEqual(await ipc.demander("challenge:enregistrer", PAGE, { pickActif: "oui" }), { ok: true, reglages: { pickActif: false, delaiSecondes: 10 } });
  await assert.rejects(ipc.demander("challenge:lire", ETRANGER), /refusé/);
});

test("config:lire : réglages du disque et de l'appli réunis", async () => {
  const { ipc } = brancher();
  assert.deepStrictEqual(await ipc.demander("config:lire"), {
    dossierJeuParDefaut: "C:\\Riot Games\\League of Legends",
    plateforme: "win32",
    autorisationEcran: null,
    lancement: 123,
    dossierJeu: "C:\\Riot Games\\League of Legends",
    dernierCompte: { nom: "Moi", tag: "EUW" },
    ongletActif: "stats",
    assistantVu: false,
  });
});

test("anciens sets remis : nombre renvoyé ; client fermé -> erreur claire, pas d'exception", async () => {
  assert.deepStrictEqual(await brancher().ipc.demander("build:remettreSets"), { ok: true, remis: 3 });
  const ferme = brancher({ remettreSets: async () => { throw new ErreurClient("Client League fermé."); } });
  assert.deepStrictEqual(await ferme.ipc.demander("build:remettreSets"), { ok: false, erreur: "Client League fermé.", probleme: null });
});

test("assistant de première ouverture : noté comme vu, puis config:lire le dit", async () => {
  const { ipc } = brancher();
  assert.strictEqual((await ipc.demander("config:lire")).assistantVu, false);
  await ipc.demander("config:assistantVu");
  assert.strictEqual((await ipc.demander("config:lire")).assistantVu, true);
  await assert.rejects(ipc.demander("config:assistantVu", ETRANGER), /refusé/);
});

test("progression et historique : demandés avec le Riot ID du compte", async () => {
  const { ipc } = brancher();
  assert.deepStrictEqual(await ipc.demander("progression:lire", PAGE, { nom: "Moi", tag: "EUW" }), ["Moi#EUW"]);
  assert.deepStrictEqual(await ipc.demander("stats:lire", PAGE, { nom: "Moi", tag: "EUW" }), ["Moi#EUW"]);
});

test("liste des champions : triée par nom, entrées invalides ignorées ; client fermé -> message clair", async () => {
  const { ipc } = brancher();
  assert.deepStrictEqual((await ipc.demander("selection:champions")).champions.map((c) => c.nom), ["Aatrox", "Ahri", "Annie"]);
  const vide = brancher({ obtenirNomsChampions: async () => new Map() });
  assert.deepStrictEqual(await vide.ipc.demander("selection:champions"), { ok: false, erreur: "Lance le client League pour charger la liste des champions." });
});

test("consulter un build : demande vérifiée ; les deux sites en panne -> erreur lisible, jamais d'exception", async () => {
  assert.deepStrictEqual(M.lireDemandeBuild({ championId: "103", role: "middle", mode: "aram" }), { championId: 103, role: "middle", mode: "aram" });
  assert.deepStrictEqual(M.lireDemandeBuild({ championId: 103, role: "", mode: "?" }), { championId: 103, role: null, mode: "ranked" });
  for (const mauvaise of [null, {}, { championId: 0 }, { championId: -3 }, { championId: 1.5 }, { championId: "abc" }]) {
    assert.strictEqual(M.lireDemandeBuild(mauvaise), null);
  }
  const { ipc } = brancher();
  assert.deepStrictEqual(await ipc.demander("build:consulter", PAGE, { championId: 0 }), { ok: false, erreur: "Choisis un champion." });
  const r = await ipc.demander("build:consulter", PAGE, { championId: 103 });
  assert.strictEqual(r.ok, false);
  assert.match(r.erreur, /Lolalytics en panne/);
});

test("mise à jour : indisponible hors appli installée ; installer seulement une mise à jour prête (ou la page Mac)", async () => {
  const { ipc } = brancher();
  assert.deepStrictEqual(await ipc.demander("maj:lire"), { etape: "indisponible", version: "1.3.3", raison: "projet" });
  assert.strictEqual(await ipc.demander("maj:installer"), false);

  for (const [etape, attendu, installation] of [["prete", "installe", true], ["disponible", "installe", false], ["recherche", false, false]]) {
    const suivi = { lire: () => ({ etape }), installer: () => "installe", verifierMaintenant: () => true };
    const { ipc: i, journal } = brancher({ majAppli: () => suivi });
    assert.strictEqual(await i.demander("maj:installer"), attendu, etape);
    assert.strictEqual(journal.appels.some(([quoi]) => quoi === "installation"), installation, `${etape} : on ne quitte que pour installer`);
  }
});

test("canaux : la liste est stable (preload.js et preload-overlay.js en dépendent, voir test/page.test.js)", () => {
  const { ipc } = brancher();
  const { reponses, ecoutes } = ipc.canaux();
  assert.strictEqual(new Set(reponses).size, reponses.length, "aucun canal branché deux fois");
  assert.deepStrictEqual(ecoutes.sort(), ["overlay:souris", "sorts:clic", "sorts:position"]);
  assert.ok(reponses.includes("config:lire") && reponses.includes("build:consulter") && reponses.length >= 20);
});

test("mode Deadlock : état, onglets et réglages passent par deadlock.js ; héros vérifié ; erreur du site lisible", async () => {
  const { ErreurDeadlockApi } = require("../deadlock-api.js");
  const appels = [];
  const deadlock = {
    etat: async () => ({ lance: true }),
    accueil: async () => {
      throw new ErreurDeadlockApi("deadlock-api.com est surchargé pour le moment : réessaie dans quelques minutes.");
    },
    heros: async () => ({ tierListe: [] }),
    listeHeros: async () => [{ id: 1, nom: "Infernus" }],
    build: async (id) => {
      appels.push(["build", id]);
      return { heros: { id, nom: "Infernus" } };
    },
    enregistrer: (r) => ({ rang: Number.isInteger(r.rang) ? r.rang : null }),
  };
  const { ipc, journal } = brancher({ deadlock: () => deadlock });
  assert.deepStrictEqual(await ipc.demander("deadlock:etat"), { lance: true });
  await assert.rejects(ipc.demander("deadlock:etat", ETRANGER), /refusé/);
  assert.deepStrictEqual(await ipc.demander("deadlock:accueil"), {
    ok: false, erreur: "deadlock-api.com est surchargé pour le moment : réessaie dans quelques minutes.", probleme: null,
  });
  assert.deepStrictEqual(await ipc.demander("deadlock:heros"), { ok: true, tierListe: [] });
  assert.deepStrictEqual(await ipc.demander("deadlock:listeHeros"), { ok: true, heros: [{ id: 1, nom: "Infernus" }] });
  assert.strictEqual((await ipc.demander("deadlock:build", PAGE, "1")).heros.nom, "Infernus");
  for (const invalide of [0, -3, "abc", null, 1.5]) {
    assert.deepStrictEqual(await ipc.demander("deadlock:build", PAGE, invalide), { ok: false, erreur: "Choisis un héros.", probleme: null }, String(invalide));
  }
  assert.deepStrictEqual(appels, [["build", 1]]);
  assert.deepStrictEqual(await ipc.demander("deadlock:enregistrer", PAGE, { rang: 8 }), { ok: true, reglages: { rang: 8 } });
  assert.deepStrictEqual(journal.erreurs, [], "les erreurs prévues ne remplissent pas le journal");
});
