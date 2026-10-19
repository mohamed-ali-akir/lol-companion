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

// --- Conseiller de draft : tier list, matchups, synergies ---------------------------------------------

/** Encode n'importe quelle valeur (objets compris) dans "objs", comme Qwik ; renvoie le numéro de la case. */
function encoderQwik(objs, v) {
  const ranger = (x) => {
    objs.push(x);
    return (objs.length - 1).toString(36);
  };
  if (Array.isArray(v)) return ranger(v.map((x) => encoderQwik(objs, x)));
  if (v && typeof v === "object") return ranger(Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encoderQwik(objs, x)])));
  return ranger(v);
}

/** Fausse tier list (format vérifié le 04/10/2026) : objets { cid, row } + objet de navigation { page, lane, patch }. */
function tierlistQwik(lignes, patch = "16.19") {
  const objs = [];
  objs.push({ page: encoderQwik(objs, "tierlist"), lane: encoderQwik(objs, "middle"), patch: encoderQwik(objs, patch) });
  for (const [cid, row] of lignes) objs.push({ cid: encoderQwik(objs, cid), row: encoderQwik(objs, row) });
  return `<script type="qwik/json">${JSON.stringify({ objs })}</script>`;
}

const LIGNE = (wr, games) => ({ rank: 1, tier: "S", lane: "middle", defaultLane: "middle", wr, games, pr: 5 });

test("tier list : taux de victoire, parties et patch de chaque champion ; lignes abîmées ignorées", () => {
  const tl = L.lignesTierlist(tierlistQwik([[103, LIGNE(52.45, 199182)], [910, LIGNE(52.47, 85046)], [7, { wr: "?" }]]));
  assert.strictEqual(tl.patch, "16.19");
  assert.strictEqual(tl.lignes.size, 2);
  assert.ok(Math.abs(tl.lignes.get(103).tauxVictoire - 0.5245) < 1e-9);
  assert.strictEqual(tl.lignes.get(910).parties, 85046);
  assert.strictEqual(L.lignesTierlist("<html></html>"), null);
  assert.strictEqual(L.lignesTierlist(tierlistQwik([])), null);
});

test("duels : delta 2 de Lolalytics en fraction, avec le nombre de parties ; lignes abîmées ignorées", () => {
  const t = L.tableDuels([[266, 54.85, 6.33, 1.96, 3.18, 2071], [1, 50, 0, "?", 1, 10], [2, 50, 0, 1, 1, 0], "x", null]);
  assert.strictEqual(t.size, 1);
  assert.ok(Math.abs(t.get(266).delta - 0.0196) < 1e-9);
  assert.strictEqual(t.get(266).parties, 2071);
  assert.strictEqual(L.tableDuels(undefined).size, 0);
});

test("matchups : lus dans la page de l'adversaire (sa voie habituelle), contre la voie demandée", async () => {
  const site = fauxSite([{ status: 200, texte: pageQwik({ ...HWEI, enemy: { middle: [[103, 48, -1, -1.5, 3, 4000]], top: [] } }) }]);
  const lecteur = L.creerLecteurLolalytics({ appeler: site.appeler });
  const m = await lecteur.matchups({ alias: "Zed", role: "middle" });
  assert.strictEqual(site.appels[0].url, "https://lolalytics.com/lol/zed/build/");
  assert.ok(Math.abs(m.get(103).delta + 0.015) < 1e-9);
  await assert.rejects(lecteur.matchups({ alias: "Zed", role: "jungle" }), /Matchups introuvables/); // même page (cache)
  assert.strictEqual(site.appels.length, 1);
});

test("synergies : API build-team avec le patch et la voie de l'allié, rien de personnel", async () => {
  const site = fauxSite([{ status: 200, texte: JSON.stringify({ team_h: [], team: { middle: [[103, 53, 1, 0.8, 4, 7637]] } }) }]);
  const lecteur = L.creerLecteurLolalytics({ appeler: site.appeler });
  const s = await lecteur.synergies({ alias: "Leona", roleAllie: "utility", role: "middle", patch: "16.19" });
  assert.strictEqual(
    site.appels[0].url,
    "https://a1.lolalytics.com/mega/?ep=build-team&v=1&patch=16.19&c=leona&lane=support&tier=emerald_plus&queue=ranked&region=all"
  );
  assert.strictEqual(site.appels[0].options.headers["User-Agent"], L.IDENTITE);
  assert.ok(Math.abs(s.get(103).delta - 0.008) < 1e-9);
  await assert.rejects(lecteur.synergies({ alias: "Leona", roleAllie: "utility", role: "middle", patch: "<script>" }), /impossible/);
});

test("tier list : un échec n'est pas gardé en cache (on réessaie à la prochaine sélection)", async () => {
  const site = fauxSite([{ status: 503, texte: "" }, { status: 200, texte: tierlistQwik([[103, LIGNE(52, 5000)]]) }]);
  const lecteur = L.creerLecteurLolalytics({ appeler: site.appeler });
  await assert.rejects(lecteur.tierlist("middle"), /code 503/);
  const tl = await lecteur.tierlist("middle");
  assert.strictEqual(site.appels[1].url, "https://lolalytics.com/lol/tierlist/?lane=middle");
  assert.strictEqual(tl.lignes.size, 1);
});

test("familles de builds : itemSets de la page -> un set par façon de jouer (catégories des objets du client)", () => {
  // Combinaisons fictives au format de Lolalytics (itemBootSet3 : "objet_bottes_objet": [parties, ...]).
  const itemSets = { itemBootSet3: { "3078_3047_3071": [6000, 0], "6676_3047_3036": [2000, 0], "3078_3071_6333": [1500, 0] } };
  const categories = { 3047: ["Boots"], 3078: ["Health", "Damage"], 3071: ["Health", "Damage"], 6333: ["Armor", "Damage"], 6676: ["CriticalStrike"], 3036: ["CriticalStrike"] };
  const noms = { 3078: "Force Trinité", 6676: "Collecteur" };
  const d = L.extraireDonnees(pageQwik({ ...HWEI, itemSets }));
  assert.deepStrictEqual(d.itemSets, itemSets);
  const a = L.analyseDepuisDonnees(d, (id) => noms[id] || `Objet ${id}`, { categoriesObjet: (id) => categories[id] || [], alias: "Vi" });
  assert.deepStrictEqual(a.familles.map((f) => f.nom), ["Combattant", "Létalité / Critique"]);
  assert.deepStrictEqual(a.familles[0].emplacements[0][0].noms, ["Force Trinité"]);
  assert.deepStrictEqual(a.familles[1].emplacements[0][0].noms, ["Collecteur"]);
  // Sans itemSets, ou sans les catégories des objets : un seul build, comme avant
  assert.deepStrictEqual(L.analyseDepuisDonnees(L.extraireDonnees(pageQwik(HWEI))).familles, []);
  assert.deepStrictEqual(L.analyseDepuisDonnees(d).familles, []);
});

// --- Arena : augments, objets prismatiques, build (format vérifié le 19/10/2026 sur la page d'Ahri) -------

// Extrait des vraies données d'Ahri en Arena : [numéro de l'augment, % victoire, % sélection, parties] ; 0 = aucun.
const AHRI_ARENA = {
  header: { cid: 103, n: 17606, wr: 58.89, place1: 21.5, place2: 19.9, place3: 17.5 },
  augment: {
    augment0: [[0, 25.01, 36.02, 6341], [48, 66.92, 19.27, 3392], [133, 63.63, 18.43, 3244], [30, 65.8, 17.6, 3099]],
    augment1: [[65, 61.26, 8.47, 1492]],
  },
  prismatic: [[447108, 61.17, 25.43, 4478], [447113, 65.9, 23.32, 4105]],
  startItem: [[223020, 60.21, 51.51, 9069], [223158, 62.23, 24.78, 4363]],
  item1: [[223020, 59.97, 55.46, 9764, 1]], // le même achat que le départ : ignoré
  item2: [[223089, 61.07, 18.16, 3198, 7], [220004, 62.65, 17.05, 3001, 7]],
  item3: [[223089, 59.57, 19.62, 3455, 11]],
  item4: [[220004, 66.84, 17.06, 3004, 14]],
  item5: [[220007, 78.07, 10.93, 1924, 18]],
  item6: [[220007, 86.72, 9.67, 1702, 20]],
};

test("Arena : adresse de la page, augments lus par numéro (sans « aucun augment »), moyenne du champion", () => {
  assert.strictEqual(L.adresseArena("MonkeyKing"), "https://lolalytics.com/lol/wukong/arena/build/");
  assert.strictEqual(L.adresseArena(""), null);
  const r = L.donneesArena(pageQwik(AHRI_ARENA, { autres: [{ augment: false, spell: false }] }));
  assert.strictEqual(r.victoireChampion, 0.5889);
  assert.strictEqual(r.parties, 17606);
  assert.deepStrictEqual([...r.augments.keys()], [48, 133, 30]);
  assert.deepStrictEqual(r.augments.get(48), { victoire: 0.6692, choix: 0.1927, parties: 3392 });
  assert.deepStrictEqual(r.prismatiques.get(447113), { victoire: 0.659, choix: 0.2332, parties: 4105 });
});

test("Arena : build (départ = bottes, objet prismatique, objets 1 à 5 sans reprendre les bottes), noms du client", () => {
  const noms = { 223020: "Chaussures de sorcier", 447108: "Sculpteur de rune", 223089: "Coiffe de Rabadon" };
  const a = L.analyseArena(L.donneesArena(pageQwik(AHRI_ARENA)), (id) => noms[id] || `Objet ${id}`);
  assert.deepStrictEqual(a.stats, { parties: 17606, tauxVictoire: 0.5889 });
  assert.deepStrictEqual(a.depart[0].noms, ["Chaussures de sorcier"]);
  assert.deepStrictEqual(a.prismatique.map((o) => o.ids[0]), [447108, 447113]);
  assert.deepStrictEqual(a.emplacements.map((e) => e[0].ids[0]), [223089, 223089, 220004, 220007, 220007]);
  assert.deepStrictEqual([a.bottes, a.familles], [[], []]);
  assert.strictEqual(L.analyseArena(null), null);
  assert.strictEqual(L.analyseArena(L.donneesArena(pageQwik({ header: {}, augment: { augment0: [[48, 60, 10, 100]] } }))), null, "page sans objets");
});

test("Arena : pages abîmées ou changées -> null (jamais d'erreur)", () => {
  for (const mauvaise of [undefined, "<html></html>", pageQwik({ header: {}, augment: {} }), pageQwik({ header: {}, augment: { augment0: [[0, 25, 36, 6341], ["x", 1, 1, 1], [5, null, 1, 10], [7, 50, 1, 0]] } })]) {
    assert.strictEqual(L.donneesArena(mauvaise), null);
  }
  const sansEntete = L.donneesArena(pageQwik({ header: "?", augment: { augment0: [[48, 60, 10, 100]] } }));
  assert.strictEqual(sansEntete.victoireChampion, null);
  assert.deepStrictEqual([sansEntete.prismatiques.size, sansEntete.objets.depart], [0, []], "sans objets : listes vides");
});

test("Arena : lecture de la page du champion, identification honnête, cache 3 h, erreurs claires", async () => {
  const site = fauxSite([{ status: 200, texte: pageQwik(AHRI_ARENA) }]);
  const lecteur = L.creerLecteurLolalytics({ appeler: site.appeler });
  const r = await lecteur.arena({ alias: "Ahri" });
  assert.strictEqual(r.augments.size, 3);
  const build = await lecteur.analyserArena({ alias: "Ahri", nomObjet: (id) => `n° ${id}` });
  assert.deepStrictEqual(build.prismatique[0].noms, ["n° 447108"]);
  assert.strictEqual(site.appels.length, 1, "augments et build : une seule lecture de la page (cache)");
  assert.strictEqual(site.appels[0].url, "https://lolalytics.com/lol/ahri/arena/build/");
  assert.strictEqual(site.appels[0].options.headers["User-Agent"], L.IDENTITE);
  const change = L.creerLecteurLolalytics({ appeler: fauxSite([{ status: 200, texte: "<html>nouveau</html>" }]).appeler });
  await assert.rejects(change.arena({ alias: "Ahri" }), /Arena de Lolalytics a changé de format/);
  await assert.rejects(lecteur.arena({ alias: null }), /inconnu/);
  const sansObjets = L.creerLecteurLolalytics({ appeler: fauxSite([{ status: 200, texte: pageQwik({ header: {}, augment: { augment0: [[48, 60, 10, 100]] } }) }]).appeler });
  await assert.rejects(sansObjets.analyserArena({ alias: "Ahri" }), /Pas d'objets Arena/);
});

test("voie habituelle : lue dans l'en-tête de la page (Riot ne la donne plus), voies de Lolalytics -> rôles du client", () => {
  // Comme sur la vraie page : les valeurs de l'en-tête sont des numéros de cases (base 36).
  const voie = (defaultLane) => L.extraireDonnees(pageQwik(HWEI, { autres: [defaultLane, 121, { cid: "1", lane: "0", defaultLane: "0" }] })).voieHabituelle;
  assert.strictEqual(voie("jungle"), "jungle");
  assert.strictEqual(voie("support"), "utility");
  assert.strictEqual(voie("all"), null, "voie inconnue : rien");
  assert.strictEqual(L.extraireDonnees(pageQwik(HWEI)).voieHabituelle, null, "pas d'en-tête : rien");
});
