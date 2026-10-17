// Tests de la version des fichiers de données et des migrations (migrations.js), sur des dossiers temporaires.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const M = require("../migrations.js");

const nouveauDossier = () => fs.mkdtempSync(path.join(os.tmpdir(), "donnees-test-"));
const ecrire = (dossier, nom, valeur) => fs.writeFileSync(path.join(dossier, nom), JSON.stringify(valeur));
const lire = (dossier, nom) => JSON.parse(fs.readFileSync(path.join(dossier, nom), "utf8"));
const migration = (vers, appliquer = () => {}) => ({ vers, nom: `essai ${vers}`, appliquer });

test("migrations à faire : dans l'ordre, et une étape manquante ou en double est refusée", () => {
  const liste = [migration(2), migration(3), migration(4)];
  assert.deepStrictEqual(M.migrationsAFaire(1, 4, liste).map((m) => m.vers), [2, 3, 4]);
  assert.deepStrictEqual(M.migrationsAFaire(3, 4, liste).map((m) => m.vers), [4]);
  assert.deepStrictEqual(M.migrationsAFaire(4, 4, liste), [], "déjà à jour");
  assert.deepStrictEqual(M.migrationsAFaire(5, 4, liste), [], "plus récent : rien à faire ici");
  assert.throws(() => M.migrationsAFaire(1, 4, [migration(2), migration(4)]), /version 3 manquante/);
  assert.throws(() => M.migrationsAFaire(1, 2, [migration(2), migration(2)]), /en double/);
  assert.throws(() => M.migrationsAFaire(1, 2, [{ vers: 2, nom: "x" }]), /sans fonction appliquer/);
});

test("version lue : celle de config.json, sinon 1 (fichiers d'avant le numéro de version)", () => {
  assert.strictEqual(M.versionLue({ versionDonnees: 3 }), 3);
  for (const abime of [{}, null, { versionDonnees: "2" }, { versionDonnees: 0 }, { versionDonnees: 1.5 }]) assert.strictEqual(M.versionLue(abime), 1);
  assert.strictEqual(M.VERSION_DONNEES, 1, "format actuel : aucune migration n'existe encore");
  assert.deepStrictEqual(M.migrationsAFaire(1), [], "la liste réelle des migrations est cohérente");
});

test("premier lancement ou fichiers d'aujourd'hui : la version est notée, rien d'autre ne change", () => {
  const vide = nouveauDossier();
  assert.deepStrictEqual(M.migrerDonnees({ dossier: vide }), { etat: "a-jour", depuis: 1, vers: 1 });
  assert.deepStrictEqual(lire(vide, "config.json"), { versionDonnees: 1 });

  const existant = nouveauDossier();
  ecrire(existant, "config.json", { dossierJeu: "D:\\Jeux", ongletActif: "stats" });
  ecrire(existant, "parties.json", [{ riotId: "Moi#EUW", date: 1 }]);
  assert.strictEqual(M.migrerDonnees({ dossier: existant }).etat, "a-jour");
  assert.deepStrictEqual(lire(existant, "config.json"), { dossierJeu: "D:\\Jeux", ongletActif: "stats", versionDonnees: 1 }, "réglages gardés");
  assert.deepStrictEqual(lire(existant, "parties.json"), [{ riotId: "Moi#EUW", date: 1 }]);
  assert.ok(!fs.readdirSync(existant).some((f) => f.startsWith("sauvegarde")), "pas de sauvegarde inutile");
});

test("fichiers anciens : chaque migration est appliquée dans l'ordre, après une copie de sécurité", () => {
  const dossier = nouveauDossier();
  ecrire(dossier, "config.json", { dossierJeu: "C:\\LoL" });
  ecrire(dossier, "parties.json", [{ riotId: "Moi#EUW", duree: 1800 }]);
  const notes = [];
  const migrations = [
    migration(2, ({ dossier: d, lireJson, ecrireJson }) => {
      const parties = lireJson(path.join(d, "parties.json"));
      ecrireJson(path.join(d, "parties.json"), parties.map((p) => ({ riotId: p.riotId, dureeS: p.duree }))); // champ renommé
    }),
    migration(3, ({ dossier: d }) => fs.writeFileSync(path.join(d, "trace.txt"), "v3")),
  ];
  const r = M.migrerDonnees({ dossier, journal: (m) => notes.push(m), version: 3, migrations });
  assert.deepStrictEqual(r, { etat: "migre", depuis: 1, vers: 3 });
  assert.deepStrictEqual(lire(dossier, "parties.json"), [{ riotId: "Moi#EUW", dureeS: 1800 }]);
  assert.strictEqual(lire(dossier, "config.json").versionDonnees, 3);
  assert.strictEqual(lire(dossier, "config.json").dossierJeu, "C:\\LoL");
  // La copie d'avant la migration vers 2 a l'ANCIEN format
  assert.deepStrictEqual(lire(path.join(dossier, "sauvegarde-avant-v2"), "parties.json"), [{ riotId: "Moi#EUW", duree: 1800 }]);
  assert.strictEqual(notes.length, 2);
  assert.match(notes[0], /format 2/);
  // Relancé : plus rien à faire
  assert.strictEqual(M.migrerDonnees({ dossier, version: 3, migrations }).etat, "a-jour");
});

test("migration qui échoue : l'appli continue, la version reste à la dernière étape réussie, et reprend ensuite", () => {
  const dossier = nouveauDossier();
  ecrire(dossier, "config.json", {});
  let essais = 0;
  const notes = [];
  const migrations = [
    migration(2),
    migration(3, () => {
      essais++;
      if (essais === 1) throw new Error("disque plein");
    }),
  ];
  assert.deepStrictEqual(M.migrerDonnees({ dossier, journal: (m) => notes.push(m), version: 3, migrations }), { etat: "erreur", depuis: 1, vers: 3 });
  assert.strictEqual(lire(dossier, "config.json").versionDonnees, 2, "l'étape 2 est faite, pas la 3");
  assert.match(notes.at(-1), /impossible : disque plein/);
  assert.deepStrictEqual(M.migrerDonnees({ dossier, version: 3, migrations }), { etat: "migre", depuis: 2, vers: 3 }, "reprise à l'étape 3");
  assert.strictEqual(essais, 2);
});

test("données d'une version PLUS RÉCENTE (retour à une ancienne appli) : copie de sécurité une seule fois, rien n'est modifié", () => {
  const dossier = nouveauDossier();
  ecrire(dossier, "config.json", { versionDonnees: 4, dossierJeu: "C:\\LoL" });
  ecrire(dossier, "maitrise.json", { format: "futur" });
  const notes = [];
  assert.deepStrictEqual(M.migrerDonnees({ dossier, journal: (m) => notes.push(m) }), { etat: "plus-recent", depuis: 4, vers: 1 });
  assert.deepStrictEqual(lire(path.join(dossier, "sauvegarde-donnees-v4"), "maitrise.json"), { format: "futur" });
  assert.strictEqual(lire(dossier, "config.json").versionDonnees, 4, "la version n'est jamais redescendue");
  assert.match(notes[0], /plus récente/);
  M.migrerDonnees({ dossier, journal: (m) => notes.push(m) });
  assert.strictEqual(notes.length, 1, "pas une deuxième copie ni un deuxième message");
});

test("config.json abîmé : lu comme vide, l'appli continue (fichiers.js le signale et le garde à part)", () => {
  const dossier = nouveauDossier();
  fs.writeFileSync(path.join(dossier, "config.json"), "{ pas du json");
  assert.strictEqual(M.migrerDonnees({ dossier }).etat, "a-jour");
  assert.strictEqual(lire(dossier, "config.json").versionDonnees, 1);
});
