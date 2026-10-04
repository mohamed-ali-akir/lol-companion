// Tests de la lecture de Lolalytics : noms, adresses, format Qwik de la page, options par emplacement, appel (sans Internet).
const test = require("node:test");
const assert = require("node:assert");
const L = require("../lolalytics.js");

/**
 * Fausse page au format Qwik de Lolalytics (vérifié le 02/10/2026) : un tableau "objs" où chaque valeur
 * (même un nombre) est rangée dans une case et désignée par son numéro en base 36.
 */
function pageQwik(donnees, { autres = [] } = {}) {
  const objs = [...autres];
  const ranger = (v) => {
    objs.push(v);
    return (objs.length - 1).toString(36);
  };
  const encoder = (v) => (Array.isArray(v) ? ranger(v.map(encoder)) : ranger(v));
  const page = {};
  for (const [cle, v] of Object.entries(donnees)) page[cle] = encoder(v);
  objs.push(page);
  return `<html><body>…</body><script type="qwik/json">${JSON.stringify({ refs: {}, ctx: {}, objs, subs: [] })}</script></html>`;
}

// Extrait des vraies données de Hwei milieu (02/10/2026).
const HWEI = {
  n: 65113,
  avgWr: 51.7,
  startSet: [["1056_2003_2003", 52.71, 97.06, 63197], ["3070_2003_2003", 52.63, 2.01, 1311], ["1056_2003", 55.86, 0.17, 111]],
  boots: [[3020, 53.69, 58.4, 38026, 14], [3158, 52.54, 27.94, 18195, 11], [3111, 50.89, 7.13, 4645, 13], [9999, 45.11, 0.28, 184, 0]],
  item1: [[2503, 52.99, 83.9, 54627, 12], [6655, 51.66, 12.45, 8105, 11], [3003, 52.73, 1.18, 768, 12]],
  item2: [[4645, 54.18, 33.69, 21936, 20], [6653, 53.69, 27.77, 18081, 20], [3152, 55.58, 9.88, 6430, 19]],
  item3: [[4645, 57.3, 14.4, 9376, 26], [3089, 57.01, 13.28, 8646, 27]],
  item4: [[3089, 57.58, 5.61, 3656, 32], [3157, 55.69, 5.29, 3442, 32]],
  item5: [[3089, 53.8, 1.11, 723, 36], [3157, 56.11, 1.02, 663, 36]],
};

test("noms Lolalytics : alias du client en minuscules, sauf MonkeyKing -> wukong", () => {
  assert.strictEqual(L.nomLolalytics("Hwei"), "hwei");
  assert.strictEqual(L.nomLolalytics("KSante"), "ksante");
  assert.strictEqual(L.nomLolalytics("MonkeyKing"), "wukong");
  assert.strictEqual(L.nomLolalytics(undefined), "");
});

test("adresses : voie du joueur en Faille, tous les rangs en ARAM / URF", () => {
  assert.strictEqual(L.adresseBuild({ alias: "Hwei", role: "middle", mode: "ranked" }), "https://lolalytics.com/lol/hwei/build/?lane=middle");
  assert.strictEqual(L.adresseBuild({ alias: "Lux", role: "utility", mode: "ranked" }), "https://lolalytics.com/lol/lux/build/?lane=support");
  assert.strictEqual(L.adresseBuild({ alias: "Lux", role: null, mode: "ranked" }), "https://lolalytics.com/lol/lux/build/");
  assert.strictEqual(L.adresseBuild({ alias: "Hwei", role: "middle", mode: "aram" }), "https://lolalytics.com/lol/hwei/aram/build/?tier=all");
  assert.strictEqual(L.adresseBuild({ alias: "Hwei", role: null, mode: "urf" }), "https://lolalytics.com/lol/hwei/urf/build/?tier=all");
  assert.strictEqual(L.adresseBuild({ alias: "", role: "top", mode: "ranked" }), null);
});

test("page Qwik : les numéros en base 36 sont résolus en vraies valeurs", () => {
  const d = L.extraireDonnees(pageQwik(HWEI, { autres: ["bruit", { autre: "objet" }] }));
  assert.strictEqual(d.n, 65113);
  assert.strictEqual(d.avgWr, 51.7);
  assert.deepStrictEqual(d.item1[0], [2503, 52.99, 83.9, 54627, 12]);
  assert.deepStrictEqual(d.startSet[0], ["1056_2003_2003", 52.71, 97.06, 63197]);
});

test("page illisible ou changée : null, jamais de plantage", () => {
  for (const mauvaise of [undefined, "", "<html>pas de données</html>", '<script type="qwik/json">{pas du json</script>',
    '<script type="qwik/json">{"objs":"?"}</script>', '<script type="qwik/json">{"objs":[{"autre":"0"}]}</script>']) {
    assert.strictEqual(L.extraireDonnees(mauvaise), null, String(mauvaise));
  }
});

test("options d'un emplacement : part des achats de l'emplacement, victoires, minute ; « pas de bottes » ignoré", () => {
  const bottes = L.optionsEmplacement(HWEI.boots);
  assert.deepStrictEqual(bottes.map((o) => o.ids[0]), [3020, 3158, 3111]); // 9999 = « No Boots » : ignoré
  const total = 38026 + 18195 + 4645;
  assert.ok(Math.abs(bottes[0].selection - 38026 / total) < 1e-9);
  assert.strictEqual(bottes[0].victoires, Math.round(0.5369 * 38026));
  assert.strictEqual(bottes[0].minute, 14);
  const departs = L.optionsEmplacement(HWEI.startSet, { combinaison: true });
  assert.deepStrictEqual(departs[0].ids, [1056, 2003, 2003]);
  assert.strictEqual(departs[0].minute, null);
  assert.deepStrictEqual(L.optionsEmplacement([null, "?", [2503, 50, 1, 0, 3], ["x", 50, 1, 10]]), []); // 0 partie, objet illisible
  assert.deepStrictEqual(L.optionsEmplacement(undefined), []);
});

test("analyse : stats générales, départ, bottes, 5 emplacements nommés", () => {
  const noms = { 2503: "Torche noire", 6655: "Écho de Luden" };
  const a = L.analyseDepuisDonnees(L.extraireDonnees(pageQwik(HWEI)), (id) => noms[id] || `Objet ${id}`);
  assert.deepStrictEqual(a.stats, { parties: 65113, tauxVictoire: 0.517 });
  assert.strictEqual(a.emplacements.length, 5);
  assert.deepStrictEqual(a.emplacements[0].map((o) => o.noms[0]), ["Torche noire", "Écho de Luden", "Objet 3003"]);
  assert.strictEqual(a.depart[0].noms.length, 3);
  assert.strictEqual(L.analyseDepuisDonnees(null), null);
  assert.strictEqual(L.analyseDepuisDonnees({ ...HWEI, item1: [] }), null); // sans objet 1 : inutilisable
});

// --- Appel (faux serveur : aucune connexion à Internet pendant les tests) -------------------------

function fauxSite(reponses) {
  const appels = [];
  const appeler = async (url, options) => {
    appels.push({ url, options });
    const r = reponses.shift();
    if (r instanceof Error) throw r;
    return { ok: r.status === 200, status: r.status, text: async () => r.texte };
  };
  return { appels, appeler };
}

const DEMANDE = { alias: "Hwei", role: "middle", mode: "ranked", nomObjet: (id) => `Objet ${id}` };

test("appel : bonne adresse, identification honnête, rien de personnel", async () => {
  const site = fauxSite([{ status: 200, texte: pageQwik(HWEI) }]);
  const a = await L.creerLecteurLolalytics({ appeler: site.appeler }).analyser(DEMANDE);
  assert.strictEqual(a.stats.parties, 65113);
  assert.strictEqual(site.appels[0].url, "https://lolalytics.com/lol/hwei/build/?lane=middle");
  assert.strictEqual(site.appels[0].options.headers["User-Agent"], L.IDENTITE);
  assert.match(L.IDENTITE, /LoLCompanion/);
});

test("cache : une seule page par champion / voie / mode pendant 3 h", async () => {
  let maintenant = 0;
  const site = fauxSite([{ status: 200, texte: pageQwik(HWEI) }, { status: 200, texte: pageQwik(HWEI) }]);
  const lecteur = L.creerLecteurLolalytics({ appeler: site.appeler, maintenant: () => maintenant });
  await lecteur.analyser(DEMANDE);
  await lecteur.analyser(DEMANDE);
  assert.strictEqual(site.appels.length, 1);
  maintenant = 4 * 60 * 60 * 1000;
  await lecteur.analyser(DEMANDE);
  assert.strictEqual(site.appels.length, 2);
});

test("erreurs : messages clairs (pas d'Internet, champion inconnu, code HTTP, page changée)", async () => {
  const cas = [
    [new TypeError("fetch failed"), /ne répond pas/],
    [{ status: 404, texte: "" }, /ne connaît pas/],
    [{ status: 503, texte: "" }, /code 503/],
    [{ status: 200, texte: "<html>nouvelle version du site</html>" }, /changé de format/],
  ];
  for (const [reponse, attendu] of cas) {
    const lecteur = L.creerLecteurLolalytics({ appeler: fauxSite([reponse]).appeler });
    await assert.rejects(lecteur.analyser(DEMANDE), (e) => e instanceof L.ErreurLolalytics && attendu.test(e.message), String(attendu));
  }
  await assert.rejects(L.creerLecteurLolalytics({ appeler: fauxSite([]).appeler }).analyser({ ...DEMANDE, alias: "" }), /inconnu/);
});
