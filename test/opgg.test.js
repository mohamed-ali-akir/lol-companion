// Tests de la lecture des statistiques d'OP.GG : format texte, données tolérantes, appel (faux serveur, sans Internet).
const test = require("node:test");
const assert = require("node:assert");
const O = require("../opgg.js");

// Vraie réponse d'OP.GG (Ahri, milieu, 02/10/2026), runes raccourcies.
const REPONSE_AHRI = `class LolGetChampionAnalysis: data
class Data: summary,core_items,boots,starter_items,fourth_items,fifth_items,sixth_items,summoner_spells,runes
class Summary: average_stats
class AverageStats: play,win_rate,pick_rate
class CoreItems: ids,ids_names,play,win,pick_rate
class Runes: primary_page_id,primary_page_name,primary_rune_ids,primary_rune_names,secondary_page_id,secondary_page_name,secondary_rune_ids,secondary_rune_names,stat_mod_ids,play,win,pick_rate

LolGetChampionAnalysis(Data(Summary(AverageStats(139371,0.51,0.1)),CoreItems([3118,4645,3157],["Malfaisance","Flamme-ombre","Sablier de Zhonya"],9587,5071,0.13),CoreItems([3020],["Chaussures de sorcier"],76231,39052,0.59),CoreItems([1056,2003,2003],["Anneau de Doran","Potion de soin","Potion de soin"],126012,63921,0.99),[CoreItems([3089],["Coiffe de Rabadon"],9660,5694,0.32),CoreItems([3157],["Sablier de Zhonya"],7712,4570,0.25),CoreItems([3135],["Bâton du vide"],2716,1458,0.09)],[CoreItems([3089],["Coiffe de Rabadon"],1504,967,0.19)],[],CoreItems([4,14],[4,14],69813,35984,0.53),Runes(8100,"Domination",[8112,8139,8140,8106],["Électrocution","Goût du sang","Impact soudain","Chasseur ultime"],8200,"Sorcellerie",[8210,8226],["Transcendance","Flux de mana"],[5005,5008,5001],61499,30841,0.47)))`;

test("format texte d'OP.GG : champs nommés grâce aux lignes « class »", () => {
  const brut = O.analyserTexteOpgg(REPONSE_AHRI);
  assert.deepStrictEqual(brut.data.summary.average_stats, { play: 139371, win_rate: 0.51, pick_rate: 0.1 });
  assert.deepStrictEqual(brut.data.boots.ids_names, ["Chaussures de sorcier"]);
  assert.strictEqual(brut.data.fourth_items.length, 3);
  assert.deepStrictEqual(brut.data.sixth_items, []);
  assert.strictEqual(brut.data.runes.primary_page_name, "Domination");
});

test("format texte : guillemets échappés, virgules et parenthèses dans les noms, valeurs spéciales", () => {
  const texte = 'class A: nom,ok,rien,n\n\nA("Jak\'Sho, le (Protéiforme) \\"x\\"",True,None,-1.5e2)';
  assert.deepStrictEqual(O.analyserTexteOpgg(texte), { nom: 'Jak\'Sho, le (Protéiforme) "x"', ok: true, rien: null, n: -150 });
});

test("format texte illisible : null, jamais de plantage", () => {
  for (const mauvais of [undefined, 42, "", "pas du tout ça", "class A: x\n\nA(1,", "A(1)(2"]) {
    assert.strictEqual(O.analyserTexteOpgg(mauvais), null, String(mauvais));
  }
});

test("analyse : options propres (ids, noms, parties, victoires, taux de sélection) et runes", () => {
  const a = O.analyseDepuis(O.analyserTexteOpgg(REPONSE_AHRI));
  assert.deepStrictEqual(a.stats, { parties: 139371, tauxVictoire: 0.51, tauxSelection: 0.1 });
  assert.deepStrictEqual(a.principaux, {
    ids: [3118, 4645, 3157], noms: ["Malfaisance", "Flamme-ombre", "Sablier de Zhonya"], parties: 9587, victoires: 5071, selection: 0.13,
  });
  assert.strictEqual(a.depart.ids.length, 3); // 2 potions
  assert.strictEqual(a.quatrieme.length, 3);
  assert.deepStrictEqual(a.cinquieme.map((o) => o.ids[0]), [3089]);
  assert.deepStrictEqual(a.sixieme, []);
  assert.deepStrictEqual(a.runes.runesPrincipales, [8112, 8139, 8140, 8106]);
  assert.deepStrictEqual(a.runes.fragments, [5005, 5008, 5001]);
  assert.deepStrictEqual(a.runes.noms.slice(0, 2), ["Électrocution", "Goût du sang"]);
});

test("analyse tolérante : champs manquants ou abîmés ignorés", () => {
  const a = O.analyseDepuis({ data: { core_items: { ids: "?" }, fourth_items: [null, { ids: [0, -2] }, { ids: [3089], play: -5 }], runes: null } });
  assert.strictEqual(a.principaux, null);
  assert.deepStrictEqual(a.quatrieme, [{ ids: [3089], noms: [], parties: 0, victoires: 0, selection: 0 }]);
  assert.strictEqual(a.runes, null);
  assert.deepStrictEqual(O.analyseDepuis(null).quatrieme, []);
});

test("noms, positions et modes au format d'OP.GG", () => {
  assert.strictEqual(O.nomOpgg("MonkeyKing"), "MONKEYKING");
  assert.strictEqual(O.nomOpgg("Kai'Sa"), "KAISA");
  assert.strictEqual(O.positionOpgg("middle", "ranked"), "mid");
  assert.strictEqual(O.positionOpgg("bottom", "ranked"), "adc");
  assert.strictEqual(O.positionOpgg("utility", "flex"), "support");
  assert.strictEqual(O.positionOpgg(null, "aram"), "mid"); // ARAM : OP.GG exige une position, "all" est refusé
  assert.strictEqual(O.positionOpgg(null, "ranked"), null);
  assert.strictEqual(O.modeOpgg({ map: { id: 12 }, gameData: { queue: { gameMode: "ARAM" } } }), "aram");
  assert.strictEqual(O.modeOpgg({ gameData: { queue: { gameMode: "CLASSIC", id: 420 } } }), "ranked");
  assert.strictEqual(O.modeOpgg({ gameData: { queue: { gameMode: "CLASSIC", id: 440 } } }), "flex");
  assert.strictEqual(O.modeOpgg({ gameData: { queue: { gameMode: "URF" } } }), "urf");
  assert.strictEqual(O.modeOpgg({ gameData: { queue: { gameMode: "CHERRY" } } }), null); // Arena : pas de stats
  assert.strictEqual(O.modeOpgg({ map: { id: 11 }, gameData: { queue: { gameMode: "PRACTICETOOL" } } }), "ranked"); // outil d'entraînement
  assert.strictEqual(O.modeOpgg(null), "ranked"); // hors partie (consultation)
});

// --- Appel (faux serveur : aucune connexion à Internet pendant les tests) -------------------------

function fauxServeur(reponses) {
  const appels = [];
  const appeler = async (url, options) => {
    appels.push({ url, corps: JSON.parse(options.body) });
    const r = reponses.shift();
    if (r instanceof Error) throw r;
    return { ok: r.status === 200, status: r.status, text: async () => r.texte };
  };
  return { appels, appeler };
}

const reponseJson = (texte) => ({ status: 200, texte: JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: texte }] } }) });
const DEMANDE = { alias: "Ahri", position: "mid", mode: "ranked" };

test("appel : bon outil, champion, position, mode, langue, et RIEN de personnel", async () => {
  const serveur = fauxServeur([reponseJson(REPONSE_AHRI)]);
  const lecteur = O.creerLecteurOpgg({ appeler: serveur.appeler });
  const a = await lecteur.analyser(DEMANDE);
  assert.strictEqual(a.stats.parties, 139371);
  assert.strictEqual(serveur.appels[0].url, "https://mcp-api.op.gg/mcp");
  const { method, params } = serveur.appels[0].corps;
  assert.strictEqual(method, "tools/call");
  assert.strictEqual(params.name, "lol_get_champion_analysis");
  const { desired_output_fields, ...args } = params.arguments;
  assert.deepStrictEqual(args, { champion: "AHRI", position: "mid", game_mode: "ranked", lang: "fr_FR" });
  assert.ok(desired_output_fields.length > 0);
});

test("appel : réponse en flux « data: » acceptée aussi", async () => {
  const flux = { status: 200, texte: `event: message\ndata: ${reponseJson(REPONSE_AHRI).texte}\n\n` };
  const lecteur = O.creerLecteurOpgg({ appeler: fauxServeur([flux]).appeler });
  assert.strictEqual((await lecteur.analyser(DEMANDE)).stats.parties, 139371);
});

test("cache : un seul appel pendant quelques heures, puis on relit", async () => {
  let maintenant = 0;
  const serveur = fauxServeur([reponseJson(REPONSE_AHRI), reponseJson(REPONSE_AHRI)]);
  const lecteur = O.creerLecteurOpgg({ appeler: serveur.appeler, maintenant: () => maintenant });
  await lecteur.analyser(DEMANDE);
  await lecteur.analyser(DEMANDE);
  assert.strictEqual(serveur.appels.length, 1);
  maintenant = 4 * 60 * 60 * 1000;
  await lecteur.analyser(DEMANDE);
  assert.strictEqual(serveur.appels.length, 2);
});

test("erreurs : messages clairs (pas d'Internet, code HTTP, champion inconnu, réponse illisible, pas de données)", async () => {
  const cas = [
    [new TypeError("fetch failed"), /ne répond pas/],
    [{ status: 503, texte: "" }, /code 503/],
    [{ status: 200, texte: JSON.stringify({ error: { code: -32600, message: "position invalide" } }) }, /ne connaît pas/],
    [{ status: 200, texte: "<html>" }, /illisible/],
    [reponseJson("n'importe quoi"), /inattendu/],
    [reponseJson("class R: data\nclass D: x\n\nR(D(1))"), /Pas assez de parties/],
  ];
  for (const [reponse, attendu] of cas) {
    const lecteur = O.creerLecteurOpgg({ appeler: fauxServeur([reponse]).appeler });
    await assert.rejects(lecteur.analyser(DEMANDE), (e) => e instanceof O.ErreurOpgg && attendu.test(e.message), String(attendu));
  }
  const lecteur = O.creerLecteurOpgg({ appeler: fauxServeur([]).appeler });
  await assert.rejects(lecteur.analyser({ alias: "Ahri", position: null, mode: "ranked" }), /inconnu/);
});
