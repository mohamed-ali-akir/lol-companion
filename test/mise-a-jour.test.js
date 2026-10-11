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
