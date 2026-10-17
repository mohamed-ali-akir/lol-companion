// Tests de la mise à jour automatique (mise-a-jour.js) avec un faux electron-updater : rien n'est téléchargé.
const test = require("node:test");
const assert = require("node:assert");
const { EventEmitter } = require("events");
const { creerMiseAJour } = require("../mise-a-jour.js");

/** Faux autoUpdater : on déclenche ses événements à la main. */
function fauxUpdater({ echec = null } = {}) {
  const u = new EventEmitter();
  u.verifications = 0;
  u.installations = [];
  u.checkForUpdates = async () => {
    u.verifications++;
    u.emit("checking-for-update");
    if (echec) {
      u.emit("error", echec);
      throw echec;
    }
    return null;
  };
  u.quitAndInstall = (...args) => u.installations.push(args);
  return u;
}

function creer(options = {}) {
  const updater = options.updater || fauxUpdater();
  const etats = [];
  const notes = [];
  const maj = creerMiseAJour({
    updater,
    version: "1.1.0",
    envoyer: (etat) => etats.push(etat),
    journal: (...morceaux) => notes.push(morceaux.join(" ")),
    ...options,
  });
  return { maj, updater, etats, notes };
}

test("réglages d'electron-updater : téléchargement auto, installation en quittant, pas de logs dans la console", () => {
  const { updater, maj } = creer();
  assert.strictEqual(updater.autoDownload, true);
  assert.strictEqual(updater.autoInstallOnAppQuit, true);
  assert.strictEqual(updater.logger, null);
  assert.deepStrictEqual(maj.lire(), { etape: "attente", version: "1.1.0", nouvelle: null, pourcentage: null, message: null });
});

test("aucune version plus récente : « à jour »", async () => {
  const { maj, updater, etats } = creer();
  assert.strictEqual(await maj.verifierMaintenant(), true);
  updater.emit("update-not-available", { version: "1.1.0" });
  assert.deepStrictEqual(etats.map((e) => e.etape), ["recherche", "a-jour"]);
  assert.strictEqual(maj.installer(), false); // rien à installer
  assert.strictEqual(updater.installations.length, 0);
});

test("nouvelle version : téléchargement, pourcentage, prête, puis installation silencieuse avec relance", async () => {
  const { maj, updater, etats, notes } = creer();
  await maj.verifierMaintenant();
  updater.emit("update-available", { version: "1.2.0" });
  updater.emit("download-progress", { percent: 41.6 });
  updater.emit("download-progress", { percent: 41.9 }); // même pourcentage arrondi : pas de nouveau message
  updater.emit("update-downloaded", { version: "1.2.0" });
  assert.deepStrictEqual(etats.map((e) => [e.etape, e.pourcentage]), [
    ["recherche", null],
    ["telechargement", 0],
    ["telechargement", 42],
    ["prete", 100],
  ]);
  assert.strictEqual(maj.lire().nouvelle, "1.2.0");
  assert.strictEqual(await maj.verifierMaintenant(), false); // déjà prête : on ne revérifie pas
  assert.strictEqual(maj.installer(), true);
  assert.deepStrictEqual(updater.installations, [[true, true]]);
  assert.ok(notes.some((n) => n.includes("1.2.0") && n.includes("prête")));
});

test("erreur (pas d'Internet, GitHub en panne) : message clair, notée dans le journal, rien ne plante", async () => {
  const { maj, etats, notes } = creer({ updater: fauxUpdater({ echec: new Error("net::ERR_INTERNET_DISCONNECTED") }) });
  assert.strictEqual(await maj.verifierMaintenant(), false);
  const dernier = etats.at(-1);
  assert.strictEqual(dernier.etape, "erreur");
  assert.match(dernier.message, /Impossible de vérifier/);
  assert.ok(notes.some((n) => n.includes("ERR_INTERNET_DISCONNECTED")));
});

test("une erreur après le téléchargement ne cache pas la version prête", () => {
  const { maj, updater } = creer();
  updater.emit("update-downloaded", { version: "1.2.0" });
  updater.emit("error", new Error("vérification suivante ratée"));
  assert.strictEqual(maj.lire().etape, "prete");
});

test("vérification automatique : au démarrage puis à intervalle, seulement si la case est cochée", async (t) => {
  let actif = true;
  const { maj, updater } = creer({ actif: () => actif, delaiMs: 5, intervalleMs: 20 });
  t.after(() => maj.arreter());
  maj.demarrer();
  await new Promise((r) => setTimeout(r, 60));
  assert.ok(updater.verifications >= 2, `${updater.verifications} vérifications`);

  actif = false; // case décochée : plus aucune vérification automatique
  const avant = updater.verifications;
  await new Promise((r) => setTimeout(r, 50));
  assert.strictEqual(updater.verifications, avant);
  assert.strictEqual(await maj.verifierMaintenant(), true); // mais le bouton « Vérifier maintenant » marche
  maj.arreter();
});

// --- Mac : vérification seulement (pas d'installation sans signature Apple) ---------------------

const M = require("../mise-a-jour.js");

test("Mac : version lue dans latest.yml, comparaison des versions", () => {
  assert.strictEqual(M.versionDepuisLatestYml("version: 1.2.0\nfiles:\n  - url: x.exe\n"), "1.2.0");
  assert.strictEqual(M.versionDepuisLatestYml("version: '1.10.3'\r\npath: x"), "1.10.3");
  assert.strictEqual(M.versionDepuisLatestYml("<html>page d'erreur</html>"), null);
  assert.strictEqual(M.versionDepuisLatestYml(undefined), null);
  assert.strictEqual(M.comparerVersions("1.2.0", "1.1.1"), 1);
  assert.strictEqual(M.comparerVersions("1.10.0", "1.9.9"), 1, "10 > 9 : comparaison en nombres, pas en texte");
  assert.strictEqual(M.comparerVersions("1.1.1", "1.1.1"), 0);
  assert.strictEqual(M.comparerVersions("1.0.0", "1.1.0"), -1);
  assert.strictEqual(M.comparerVersions("abc", "1.0.0"), 0);
  assert.match(M.ADRESSE_LATEST_YML, /^https:\/\/github\.com\/mohamed-ali-akir\/lol-companion\/releases\/latest\/download\/latest\.yml$/);
});

function verificationMac({ reponses, version = "1.1.1", actif = () => true }) {
  const etats = [];
  const ouvertes = [];
  const journal = [];
  const verif = M.creerVerificationMac({
    lireLatestYml: async () => {
      const r = reponses.shift();
      if (r instanceof Error) throw r;
      return r;
    },
    ouvrir: (adresse) => ouvertes.push(adresse),
    version,
    actif,
    envoyer: (e) => etats.push(e),
    journal: (...m) => journal.push(m.join(" ")),
  });
  return { verif, etats, ouvertes, journal };
}

test("Mac : nouvelle version -> « disponible », le bandeau ouvre la page de téléchargement (adresse fixe)", async () => {
  const { verif, etats, ouvertes } = verificationMac({ reponses: ["version: 1.2.0\n"] });
  assert.strictEqual(verif.installer(), false, "rien à ouvrir avant la vérification");
  assert.strictEqual(await verif.verifierMaintenant(), true);
  assert.deepStrictEqual(etats.map((e) => e.etape), ["recherche", "disponible"]);
  assert.strictEqual(verif.lire().nouvelle, "1.2.0");
  assert.strictEqual(verif.lire().raison, "mac");
  assert.strictEqual(verif.installer(), true);
  assert.deepStrictEqual(ouvertes, [M.PAGE_TELECHARGEMENT]);
});

test("Mac : déjà à jour, erreur réseau, latest.yml illisible ; une version annoncée le reste", async () => {
  const aJour = verificationMac({ reponses: ["version: 1.1.1\n"] });
  await aJour.verif.verifierMaintenant();
  assert.strictEqual(aJour.verif.lire().etape, "a-jour");

  const panne = verificationMac({ reponses: [new Error("GitHub ne répond pas"), "<html>"] });
  assert.strictEqual(await panne.verif.verifierMaintenant(), false);
  assert.strictEqual(panne.verif.lire().etape, "erreur");
  assert.strictEqual(await panne.verif.verifierMaintenant(), false);
  assert.ok(panne.journal.some((l) => /illisible/.test(l)));

  const garde = verificationMac({ reponses: ["version: 1.3.0", new Error("plus d'Internet")] });
  await garde.verif.verifierMaintenant();
  await garde.verif.verifierMaintenant();
  assert.strictEqual(garde.verif.lire().etape, "disponible");
  assert.strictEqual(garde.verif.lire().nouvelle, "1.3.0");
});

test("Mac : case décochée -> pas de vérification automatique, mais « Vérifier maintenant » marche ; minuteries arrêtées", async () => {
  const { verif, etats } = verificationMac({ reponses: ["version: 1.2.0"], actif: () => false });
  verif.demarrer();
  try {
    verif.arreter();
    assert.deepStrictEqual(etats, []);
    assert.strictEqual(await verif.verifierMaintenant(), true);
    assert.strictEqual(verif.lire().etape, "disponible");
  } finally {
    verif.arreter();
  }
});

// --- Au lancement : installer avant d'ouvrir l'appli (17/10/2026) ---------------------------------------

const { majAuDemarrage } = require("../mise-a-jour.js");
const attendreMs = (ms) => new Promise((ok) => setTimeout(ok, ms));

test("lancement : nouvelle version -> téléchargée puis installée avant d'ouvrir l'appli (silencieux, relance)", async () => {
  const updater = fauxUpdater();
  const trouvees = [];
  const promesse = majAuDemarrage({ updater, trouvee: (v) => trouvees.push(v), delaiRechercheMs: 1000, delaiTelechargementMs: 1000 });
  await attendreMs(5);
  updater.emit("update-available", { version: "1.3.2" });
  updater.emit("download-progress", { percent: 50 });
  updater.emit("update-downloaded", { version: "1.3.2" });
  assert.strictEqual(await promesse, "installation");
  assert.deepStrictEqual(trouvees, ["1.3.2"]);
  assert.deepStrictEqual(updater.installations, [[true, true]]);
  assert.strictEqual(updater.autoDownload, true);
  assert.strictEqual(updater.listenerCount("update-downloaded"), 0, "plus aucun écouteur : la mise à jour en arrière-plan prend le relais");
});

test("lancement : déjà à jour, erreur ou pas d'Internet -> l'appli démarre normalement, sans rien installer", async () => {
  const aJour = fauxUpdater();
  const p1 = majAuDemarrage({ updater: aJour, delaiRechercheMs: 1000 });
  await attendreMs(5);
  aJour.emit("update-not-available", { version: "1.3.1" });
  assert.strictEqual(await p1, "a-jour");
  assert.strictEqual(aJour.installations.length, 0);

  const enPanne = fauxUpdater({ echec: new Error("net::ERR_INTERNET_DISCONNECTED") });
  const notes = [];
  assert.strictEqual(await majAuDemarrage({ updater: enPanne, journal: (...m) => notes.push(m.join(" ")) }), "erreur");
  assert.ok(notes.some((n) => n.includes("ERR_INTERNET_DISCONNECTED")));
});

test("lancement : GitHub muet ou téléchargement trop long -> l'appli démarre quand même (jamais bloquée)", async () => {
  const muet = fauxUpdater();
  assert.strictEqual(await majAuDemarrage({ updater: muet, delaiRechercheMs: 20 }), "trop-long");

  const lent = fauxUpdater();
  const p = majAuDemarrage({ updater: lent, delaiRechercheMs: 1000, delaiTelechargementMs: 30 });
  await attendreMs(5);
  lent.emit("update-available", { version: "1.3.2" });
  assert.strictEqual(await p, "trop-long");
  lent.emit("update-downloaded", { version: "1.3.2" }); // fini plus tard : plus rien à faire ici
  assert.strictEqual(lent.installations.length, 0);
});
