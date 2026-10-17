// Tests de l'écriture sûre des fichiers de données (fichiers.js), dans un dossier temporaire.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const F = require("../fichiers.js");

const dossierTemp = () => fs.mkdtempSync(path.join(os.tmpdir(), "fichiers-"));

test("écriture puis lecture ; dossier créé ; pas de fichier temporaire qui traîne", () => {
  const fichier = path.join(dossierTemp(), "sous-dossier", "config.json");
  F.ecrireJson(fichier, { a: 1 }, { espaces: 2 });
  assert.deepStrictEqual(F.lireJson(fichier), { a: 1 });
  assert.match(fs.readFileSync(fichier, "utf-8"), /\n {2}"a"/, "indenté si demandé");
  F.ecrireJson(fichier, { a: 2 });
  assert.deepStrictEqual(F.lireJson(fichier), { a: 2 });
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(`${fichier}.bak`, "utf-8")), { a: 1 }, "la version d'avant est gardée");
  assert.ok(!fs.existsSync(`${fichier}.tmp`));
});

test("fichier abîmé ou disparu (PC éteint pendant l'écriture) : la copie .bak est relue", () => {
  const fichier = path.join(dossierTemp(), "parties.json");
  F.ecrireJson(fichier, [1, 2]);
  F.ecrireJson(fichier, [1, 2, 3]);
  fs.writeFileSync(fichier, "[1, 2, 3"); // à moitié écrit
  assert.deepStrictEqual(F.lireJson(fichier), [1, 2]);
  fs.unlinkSync(fichier); // coupure entre les deux renommages
  assert.deepStrictEqual(F.lireJson(fichier), [1, 2]);
  // L'écriture suivante repart d'un fichier sain
  F.ecrireJson(fichier, [9]);
  assert.deepStrictEqual(F.lireJson(fichier), [9]);
});

test("rien de lisible : erreur (l'appelant choisit sa valeur par défaut) ; effacement du fichier et de sa copie", () => {
  const fichier = path.join(dossierTemp(), "maitrise.json");
  assert.throws(() => F.lireJson(fichier));
  F.ecrireJson(fichier, { x: 1 });
  F.ecrireJson(fichier, { x: 2 });
  F.effacerJson(fichier);
  assert.ok(!fs.existsSync(fichier) && !fs.existsSync(`${fichier}.bak`));
  assert.throws(() => F.lireJson(fichier), "la copie ne revient pas après un effacement");
  F.effacerJson(fichier); // déjà effacé : pas d'erreur
});

test("fichier abîmé : signalé une fois, gardé à part (.abime) ; la bonne copie .bak n'est jamais écrasée par lui", () => {
  const fichier = path.join(dossierTemp(), "progression.json");
  const messages = [];
  F.surProbleme((m) => messages.push(m));
  F.ecrireJson(fichier, ["v1"]);
  F.ecrireJson(fichier, ["v2"]); // .bak = v1
  fs.writeFileSync(fichier, "[\"v3\""); // abîmé (PC éteint)
  assert.deepStrictEqual(F.lireJson(fichier), ["v1"], "copie de secours relue");
  F.lireJson(fichier);
  assert.strictEqual(messages.length, 1, "signalé une seule fois");
  assert.match(messages[0], /progression\.json abîmé : copie de secours \(\.bak\) relue/);
  assert.strictEqual(fs.readFileSync(`${fichier}.abime`, "utf-8"), "[\"v3\"", "fichier abîmé gardé pour récupérer ses données");
  F.ecrireJson(fichier, ["v4"]); // le fichier abîmé ne doit pas devenir la copie de secours
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(`${fichier}.bak`, "utf-8")), ["v1"]);
  assert.deepStrictEqual(F.lireJson(fichier), ["v4"]);
  F.surProbleme(null);
});
