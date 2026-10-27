// Tests des règles communes des appels à Internet (cache, User-Agent, erreurs) et de la liste des fichiers de l'installateur.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const I = require("../internet.js");

class ErreurTest extends Error {}

// --- Cache ---------------------------------------------------------------------------------------

test("cache : une seule lecture pendant 3 h, puis on relit", async () => {
  let maintenant = 0;
  let lectures = 0;
  const { avecCache } = I.creerCache({ maintenant: () => maintenant });
  const lire = async () => ++lectures;
  assert.strictEqual(await avecCache("a", lire), 1);
  assert.strictEqual(await avecCache("a", lire), 1);
  maintenant = I.DUREE_CACHE_MS;
  assert.strictEqual(await avecCache("a", lire), 2);
});

test("cache : deux demandes en même temps -> une seule lecture", async () => {
  let lectures = 0;
  const { avecCache } = I.creerCache();
  const lire = async () => ++lectures;
  const [a, b] = await Promise.all([avecCache("a", lire), avecCache("a", lire)]);
  assert.deepStrictEqual([a, b, lectures], [1, 1, 1]);
});

test("cache : un échec n'est pas gardé, la demande suivante réessaie", async () => {
  let essais = 0;
  const { avecCache, taille } = I.creerCache();
  const lire = async () => {
    essais++;
    if (essais === 1) throw new ErreurTest("panne");
    return "ok";
  };
  await assert.rejects(avecCache("a", lire), /panne/);
  assert.strictEqual(taille(), 0);
  assert.strictEqual(await avecCache("a", lire), "ok");
});

test("cache : une erreur lancée tout de suite (pas dans une promesse) est aussi rattrapée", async () => {
  const { avecCache } = I.creerCache();
  await assert.rejects(avecCache("a", () => { throw new ErreurTest("tout de suite"); }), /tout de suite/);
});

test("cache : les entrées périmées sont supprimées (la mémoire ne grossit pas)", async () => {
  let maintenant = 0;
  const { avecCache, taille } = I.creerCache({ maintenant: () => maintenant });
  await avecCache("a", async () => 1);
  await avecCache("b", async () => 2);
  assert.strictEqual(taille(), 2);
  maintenant = I.DUREE_CACHE_MS + 1;
  await avecCache("c", async () => 3);
  assert.strictEqual(taille(), 1);
});

// --- Téléchargement ------------------------------------------------------------------------------

function fauxSite(reponse) {
  const appels = [];
  const appeler = async (adresse, options) => {
    appels.push({ adresse, options });
    if (reponse instanceof Error) throw reponse;
    return { ok: reponse.status === 200, status: reponse.status, text: async () => reponse.texte };
  };
  return { appels, appeler };
}

const DEMANDE = { adresse: "https://exemple.test/page", site: "Exemple", Erreur: ErreurTest };

test("telecharger : renvoie le texte, avec le User-Agent honnête et un délai maximal", async () => {
  const site = fauxSite({ status: 200, texte: "bonjour" });
  const texte = await I.telecharger({ ...DEMANDE, appeler: site.appeler, options: { headers: { Accept: "text/html" } } });
  assert.strictEqual(texte, "bonjour");
  assert.strictEqual(site.appels[0].adresse, DEMANDE.adresse);
  assert.strictEqual(site.appels[0].options.headers["User-Agent"], I.IDENTITE);
  assert.strictEqual(site.appels[0].options.headers.Accept, "text/html");
  assert.ok(site.appels[0].options.signal, "délai maximal (AbortSignal)");
  assert.match(I.IDENTITE, /LoLCompanion/);
});

test("telecharger : garde la méthode et le corps (POST d'OP.GG)", async () => {
  const site = fauxSite({ status: 200, texte: "{}" });
  await I.telecharger({ ...DEMANDE, appeler: site.appeler, options: { method: "POST", body: "{}" } });
  assert.strictEqual(site.appels[0].options.method, "POST");
  assert.strictEqual(site.appels[0].options.body, "{}");
});

test("telecharger : messages clairs (pas d'Internet, 404, autre code)", async () => {
  const cas = [
    [new TypeError("fetch failed"), {}, /Exemple ne répond pas/],
    [{ status: 404 }, { introuvable: "Champion inconnu de Exemple." }, /Champion inconnu/],
    [{ status: 404 }, {}, /code 404/],
    [{ status: 503 }, {}, /surchargé/],
    [{ status: 429 }, {}, /surchargé/],
    [{ status: 500 }, {}, /code 500/],
  ];
  for (const [reponse, plus, attendu] of cas) {
    await assert.rejects(
      I.telecharger({ ...DEMANDE, ...plus, appeler: fauxSite(reponse).appeler }),
      (e) => e instanceof ErreurTest && attendu.test(e.message),
      String(attendu),
    );
  }
});

// --- Installateur --------------------------------------------------------------------------------

test("installateur : chaque module chargé par l'appli est bien dans la liste build.files de package.json", () => {
  const racine = path.join(__dirname, "..");
  const paquet = JSON.parse(fs.readFileSync(path.join(racine, "package.json"), "utf8"));
  const fichiers = new Set(paquet.build.files);
  // On part de main.js et on suit les require("./...") de module en module.
  const aVisiter = ["main.js"];
  const vus = new Set();
  while (aVisiter.length > 0) {
    const fichier = aVisiter.pop();
    if (vus.has(fichier)) continue;
    vus.add(fichier);
    const code = fs.readFileSync(path.join(racine, fichier), "utf8");
    for (const [, chemin] of code.matchAll(/require\(["']\.\/([^"']+)["']\)/g)) aVisiter.push(chemin);
  }
  const oublies = [...vus].filter((f) => !f.startsWith("src/") && !fichiers.has(f));
  assert.deepStrictEqual(oublies, [], "fichiers à ajouter dans build.files de package.json");
});
