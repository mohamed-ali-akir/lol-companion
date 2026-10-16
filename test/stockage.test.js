// Tests de l'enregistrement des réglages (dans un dossier temporaire, sans Electron).
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { creerStockage, ErreurStockage, DOSSIER_JEU_PAR_DEFAUT } = require("../stockage.js");

function nouveauStockage() {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "config-test-"));
  const stockage = creerStockage({ dossier });
  const contenuFichier = () => fs.readFileSync(path.join(dossier, "config.json"), "utf-8");
  return { dossier, stockage, contenuFichier };
}

test("dossier du jeu : défaut, changement, retour au défaut", () => {
  const { stockage } = nouveauStockage();
  assert.strictEqual(stockage.dossierJeu(), DOSSIER_JEU_PAR_DEFAUT);

  stockage.enregistrerDossierJeu("D:\\Jeux\\Riot Games\\League of Legends");
  assert.strictEqual(stockage.dossierJeu(), "D:\\Jeux\\Riot Games\\League of Legends");

  assert.throws(() => stockage.enregistrerDossierJeu("dossier-relatif"), ErreurStockage);

  stockage.enregistrerDossierJeu("");
  assert.strictEqual(stockage.dossierJeu(), DOSSIER_JEU_PAR_DEFAUT);
});

test("fichier de réglages abîmé -> réglages par défaut, sans planter", () => {
  const { stockage, dossier } = nouveauStockage();
  fs.writeFileSync(path.join(dossier, "config.json"), "{ pas du json");
  assert.strictEqual(stockage.dossierJeu(), DOSSIER_JEU_PAR_DEFAUT);
});

test("l'ancienne clé API est effacée du disque, les autres réglages sont gardés", () => {
  const { stockage, dossier, contenuFichier } = nouveauStockage();
  const CLE = "RGAPI-12345678-abcd-efgh-ijkl-000000000000";
  fs.writeFileSync(
    path.join(dossier, "config.json"),
    JSON.stringify({ cleApi: CLE, cleApiChiffree: "abc", dernierRiotId: "Test#EUW", region: "euw", dossierJeu: "D:\\LoL" })
  );

  assert.strictEqual(stockage.nettoyerAnciensReglages(), true);
  assert.ok(!contenuFichier().includes(CLE));
  assert.deepStrictEqual(stockage.lire(), { dossierJeu: "D:\\LoL" });

  // Deuxième appel : rien à nettoyer, le fichier n'est pas réécrit.
  assert.strictEqual(stockage.nettoyerAnciensReglages(), false);
});

test("dernier compte : enregistré, relu, remplacé par un autre compte", () => {
  const { stockage } = nouveauStockage();
  assert.strictEqual(stockage.dernierCompte(), null);

  const date = new Date("2026-09-30T16:05:00Z");
  stockage.enregistrerDernierCompte(
    { nom: "wDark", tag: "Amumu", niveau: 24, progression: 63, stats: { total: 3 }, avertissement: null },
    date
  );
  assert.deepStrictEqual(stockage.dernierCompte(), {
    nom: "wDark",
    tag: "Amumu",
    niveau: 24,
    progression: 63,
    stats: { total: 3 },
    date: "2026-09-30T16:05:00.000Z",
  });

  // Autre compte : il remplace le premier. Le dossier du jeu est gardé.
  stockage.enregistrerDossierJeu("D:\\LoL");
  stockage.enregistrerDernierCompte({ nom: "Autre", tag: "EUW", niveau: 80, progression: 5 }, date);
  assert.strictEqual(stockage.dernierCompte().nom, "Autre");
  assert.strictEqual(stockage.dossierJeu(), "D:\\LoL");
});

test("dernier compte abîmé dans le fichier -> ignoré", () => {
  const { stockage, dossier } = nouveauStockage();
  fs.writeFileSync(path.join(dossier, "config.json"), JSON.stringify({ dernierCompte: { nom: "x", niveau: "vingt" } }));
  assert.strictEqual(stockage.dernierCompte(), null);
});

test("onglet actif : mémorisé, noms bizarres refusés", () => {
  const { stockage, dossier } = nouveauStockage();
  assert.strictEqual(stockage.ongletActif(), null);
  stockage.enregistrerOngletActif("classee");
  assert.strictEqual(stockage.ongletActif(), "classee");
  assert.throws(() => stockage.enregistrerOngletActif("../../etc"), ErreurStockage);
  assert.throws(() => stockage.enregistrerOngletActif(42), ErreurStockage);
  // Valeur abîmée dans le fichier : ignorée.
  fs.writeFileSync(path.join(dossier, "config.json"), JSON.stringify({ ongletActif: "<script>" }));
  assert.strictEqual(stockage.ongletActif(), null);
});

test("acceptation automatique : désactivée par défaut, réglages enregistrés et nettoyés", () => {
  const { stockage, dossier } = nouveauStockage();
  assert.deepStrictEqual(stockage.reglagesAcceptation(), { actif: false, delaiSecondes: 2, notifier: true });
  stockage.enregistrerReglagesAcceptation({ actif: true, delaiSecondes: 3, notifier: false, bizarre: "x" });
  assert.deepStrictEqual(stockage.reglagesAcceptation(), { actif: true, delaiSecondes: 3, notifier: false });
  // Fichier modifié à la main avec des valeurs folles : bornées.
  fs.writeFileSync(path.join(dossier, "config.json"), JSON.stringify({ acceptationAuto: { actif: 1, delaiSecondes: 500 } }));
  assert.deepStrictEqual(stockage.reglagesAcceptation(), { actif: false, delaiSecondes: 8, notifier: true });
});

test("dossier du jeu par défaut : Windows ou Mac selon le système (Windows si inconnu)", () => {
  const { dossierJeuParDefaut } = require("../stockage.js");
  assert.strictEqual(dossierJeuParDefaut("win32"), "C:\\Riot Games\\League of Legends");
  assert.strictEqual(dossierJeuParDefaut("darwin"), "/Applications/League of Legends.app/Contents/LoL");
  assert.strictEqual(dossierJeuParDefaut("linux"), "C:\\Riot Games\\League of Legends");
});
