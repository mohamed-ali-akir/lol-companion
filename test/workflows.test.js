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

// --- Version de Node : une seule source, .nvmrc (17/10/2026) ---------------------------------------
// Avant, le PC de développement avait Node 26 et GitHub Node 24, écrit en dur dans chaque workflow : un code qui marche
// d'un côté pouvait casser de l'autre. Maintenant, .nvmrc fixe la version, les workflows la lisent, et package.json
// (engines) l'annonce.

const RACINE = path.join(__dirname, "..");
const versionNvmrc = () => Number(fs.readFileSync(path.join(RACINE, ".nvmrc"), "utf8").trim());

test("Node : .nvmrc, engines de package.json et Node utilisé pour ces tests sont d'accord", () => {
  const majeure = versionNvmrc();
  assert.ok(Number.isInteger(majeure) && majeure >= 20, ".nvmrc doit contenir une version majeure de Node (ex. 24)");
  const paquet = JSON.parse(fs.readFileSync(path.join(RACINE, "package.json"), "utf8"));
  assert.strictEqual(paquet.engines && paquet.engines.node, `>=${majeure}`, "engines.node doit suivre .nvmrc");
  const actuelle = Number(process.versions.node.split(".")[0]);
  assert.ok(actuelle >= majeure, `Node ${process.versions.node} trop ancien : il faut Node ${majeure} ou plus (.nvmrc)`);
});

test("Node : chaque workflow prend la version de .nvmrc (jamais une version écrite en dur)", { skip: !yaml && "js-yaml absent" }, () => {
  for (const fichier of fs.readdirSync(DOSSIER).filter((f) => f.endsWith(".yml"))) {
    const workflow = yaml.load(fs.readFileSync(path.join(DOSSIER, fichier), "utf8"));
    for (const [nom, job] of Object.entries(workflow.jobs)) {
      for (const etape of (job.steps || []).filter((e) => String(e.uses || "").startsWith("actions/setup-node"))) {
        assert.strictEqual(etape.with && etape.with["node-version-file"], ".nvmrc", `${fichier} / ${nom} : node-version-file: .nvmrc attendu`);
        assert.ok(!("node-version" in etape.with), `${fichier} / ${nom} : pas de node-version écrite en dur`);
      }
    }
  }
});

test("Dependabot : configuration valide, npm et actions GitHub surveillés chaque semaine", { skip: !yaml && "js-yaml absent" }, () => {
  const config = yaml.load(fs.readFileSync(path.join(RACINE, ".github", "dependabot.yml"), "utf8"));
  assert.strictEqual(config.version, 2);
  assert.ok(Array.isArray(config.updates), "updates : liste des paquets à surveiller");
  const ecosystemes = config.updates.map((u) => u["package-ecosystem"]).sort();
  assert.deepStrictEqual(ecosystemes, ["github-actions", "npm"]);
  for (const u of config.updates) {
    assert.strictEqual(u.directory, "/", `${u["package-ecosystem"]} : dossier du projet`);
    assert.ok(["daily", "weekly", "monthly"].includes(u.schedule && u.schedule.interval), `${u["package-ecosystem"]} : fréquence valide`);
  }
  // Les pull requests de Dependabot sont testées comme les autres (tests + essai complet).
  const tests = yaml.load(fs.readFileSync(path.join(DOSSIER, "tests.yml"), "utf8"));
  assert.ok("pull_request" in tests.on, "tests.yml doit tourner sur les pull requests");
});

test("build local : version suivante + « -local.N » (jamais le numéro d'une version publiée)", () => {
  const { versionSuivante } = require("../outils/build-local.js"); // chargé sans rien fabriquer
  assert.strictEqual(versionSuivante("1.4.0"), "1.4.1");
  assert.strictEqual(versionSuivante("1.4.9"), "1.4.10");
  assert.strictEqual(versionSuivante("2.0.0-local.3"), "2.0.1");
});
