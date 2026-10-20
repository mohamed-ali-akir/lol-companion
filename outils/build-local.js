/*
 * Installateur de TEST fabriqué sur ce PC : npm run build:local
 * ---------------------------------------------------------------
 * Pourquoi (20/10/2026) : les installateurs faits sur le PC portaient le même numéro que la version publiée (1.3.1 et
 * « 1.3.1 » local étaient deux appli différentes) : impossible de savoir laquelle était installée, et la mise à jour
 * automatique pouvait se tromper. Ici, le numéro est la version SUIVANTE + « -local.N » (1.4.0 publiée -> 1.4.1-local.1,
 * puis -local.2...) :
 *  - plus grand que la version publiée : la mise à jour au lancement ne remplace pas ce build de test ;
 *  - plus petit que la vraie version suivante (1.4.1) : quand elle sera publiée, elle le remplacera.
 * package.json n'est pas modifié (le numéro est passé à electron-builder) ; N est gardé dans dist/numero-local.txt.
 * Rien n'est publié.
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const PROJET = path.join(__dirname, "..");
const version = require(path.join(PROJET, "package.json")).version;

/** "1.4.0" -> "1.4.1" (les versions de test se rangent juste avant la vraie version suivante). */
function versionSuivante(v) {
  const [majeure, mineure, correctif] = String(v).split("-")[0].split(".").map(Number);
  return `${majeure}.${mineure}.${correctif + 1}`;
}

/** Fabrique l'installateur de test (seulement quand le script est lancé, pas quand les tests le chargent). */
function fabriquer() {
  const fichierNumero = path.join(PROJET, "dist", "numero-local.txt");
  fs.mkdirSync(path.dirname(fichierNumero), { recursive: true });
  let numero = 1;
  try {
    const [base, n] = fs.readFileSync(fichierNumero, "utf8").trim().split(" ");
    if (base === version) numero = Number(n) + 1;
  } catch {
    // premier build local pour cette version
  }
  const versionLocale = `${versionSuivante(version)}-local.${numero}`;
  console.log(`Build local ${versionLocale} (version publiée : ${version}), rien n'est publié.`);
  execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", ["electron-builder", "--publish", "never", `-c.extraMetadata.version=${versionLocale}`], {
    cwd: PROJET,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  fs.writeFileSync(fichierNumero, `${version} ${numero}`);
  console.log(`Installateur : dist/LoL Companion Setup ${versionLocale}.exe`);
}

if (require.main === module) fabriquer();

module.exports = { versionSuivante };
