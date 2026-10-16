// Les fichiers des workflows GitHub (.github/workflows) doivent être du YAML valide : sinon GitHub ne lance rien,
// et une étiquette de version ne publie rien (vu le 16/10/2026 : un « : » dans un texte cassait publier.yml).
// js-yaml est déjà installé avec electron-builder : aucune dépendance ajoutée. S'il manque, le test est sauté.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

let yaml = null;
try {
  yaml = require("js-yaml");
} catch {
  // pas de js-yaml : test sauté
}

const DOSSIER = path.join(__dirname, "..", ".github", "workflows");

test("workflows GitHub : YAML valide, avec leurs déclencheurs et leurs jobs", { skip: !yaml && "js-yaml absent" }, () => {
  const fichiers = fs.readdirSync(DOSSIER).filter((f) => f.endsWith(".yml"));
  assert.ok(fichiers.includes("publier.yml") && fichiers.includes("mac.yml"));
  for (const fichier of fichiers) {
    let workflow;
    assert.doesNotThrow(() => {
      workflow = yaml.load(fs.readFileSync(path.join(DOSSIER, fichier), "utf8"));
    }, `${fichier} : YAML invalide`);
    assert.ok(workflow && workflow.on && workflow.jobs, `${fichier} : « on » et « jobs » attendus`);
  }
  const publier = yaml.load(fs.readFileSync(path.join(DOSSIER, "publier.yml"), "utf8"));
  assert.deepStrictEqual(publier.on.push.tags, ["v*"]);
  assert.strictEqual(publier.jobs.mac.needs, "publier", "le .dmg après la Release créée par le job Windows");
});
