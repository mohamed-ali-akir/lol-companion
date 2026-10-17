// Tests du set « Champion Rank 1 » (rank1.js) et de sa lecture sur OP.GG (opgg.js : rank1), sans Internet.
const test = require("node:test");
const assert = require("node:assert");
const R = require("../rank1.js");
const O = require("../opgg.js");

const AHRI = 103;

// Réponses au format texte d'OP.GG, sur le modèle de celles vues le 17/10/2026 (Riot ID inventés).
const CLASSEMENT = `class LolListChampionLeaderboard: leaderboard
class Leaderboard: rank,summoner,most_champion_stat
class Summoner: game_name,tagline,league_stats
class LeagueStat: game_type,tier_info
class TierInfo: tier,lp
class MostChampionStat: play,win

LolListChampionLeaderboard([Leaderboard(1,Summoner("Joueur Un","EUW",[LeagueStat("SOLORANKED",TierInfo("MASTER",1575))]),MostChampionStat(1657,874)),Leaderboard(2,Summoner("Joueur Deux","ff15",[LeagueStat("FLEXRANKED",TierInfo("GOLD",0)),LeagueStat("SOLORANKED",TierInfo("DIAMOND",31))]),MostChampionStat(1422,741)),Leaderboard(3,Summoner("Joueur Trois","AHRI",[LeagueStat("SOLORANKED",TierInfo("GRANDMASTER",2145))]),MostChampionStat(958,548)),Leaderboard(4,Summoner("","",[]),MostChampionStat(900,450))])`;

const CHAMPIONS = `class LolListChampions: lang,data
class Data: champions
class Champion: champion_id,key,name,release_date

LolListChampions("en_US",Data([Champion(103,"Ahri","Ahri","2011-12-14"),Champion(62,"MonkeyKing","Wukong","2011-07-26"),Champion(36,"DrMundo","Dr. Mundo","2010-07-13")]))`;

/** Historique au format OP.GG : parties = [[championId, poste, [objets], "WIN" | "LOSE"]]. */
function historique(parties) {
  const lignes = parties.map(([id, poste, objets, resultat], i) => `GameHistory("partie${i}","SOLORANKED",[Participant(${id},"${poste}",[${objets.join(",")}],Stats("${resultat}"))])`);
  return `class LolListSummonerMatches: data
class Data: game_history
class GameHistory: id,game_type,participants
class Participant: champion_id,position,items,stats
class Stats: result

LolListSummonerMatches(Data([${lignes.join(",")}]))`;
}

// Objets du client (extrait de /lol-game-data/assets/v1/items.json, vérifié le 17/10/2026) : catégories, prix, « vers ».
const OBJETS = new Map([
  [1056, { categories: ["Lane", "SpellDamage"], prix: 400, vers: [] }], // Anneau de Doran (départ)
  [1082, { categories: ["SpellDamage", "Lane"], prix: 350, vers: [3041] }], // Sceau noir (départ)
  [2003, { categories: ["Consumable"], prix: 50, vers: [] }], // potion
  [3340, { categories: ["Trinket"], prix: 0, vers: [] }], // balise
  [1001, { categories: ["Boots"], prix: 300, vers: [3020, 3158] }], // simples bottes (composant)
  [3020, { categories: ["Boots", "MagicPenetration"], prix: 1100, vers: [] }], // bottes de sorcier
  [3158, { categories: ["Boots"], prix: 900, vers: [3171] }], // bottes de lucidité
  [3100, { categories: ["SpellDamage"], prix: 2900, vers: [] }], // Fléau de liche
  [3089, { categories: ["SpellDamage"], prix: 3500, vers: [] }], // Coiffe de Rabadon
  [2503, { categories: ["SpellDamage"], prix: 2800, vers: [] }], // Torche noire
  [3157, { categories: ["SpellDamage"], prix: 3250, vers: [] }], // Zhonya
  [3113, { categories: ["SpellDamage"], prix: 850, vers: [3100] }], // composant
]);

// --- Fonctions pures ---------------------------------------------------------------------------

test("nom pour le classement : nom ANGLAIS en MAJUSCULES_AVEC_TIRETS (vérifié sur les 250 champions d'OP.GG)", () => {
  const cas = { Wukong: "WUKONG", "Lee Sin": "LEE_SIN", "Dr. Mundo": "DR_MUNDO", "K'Sante": "KSANTE", "Kha'Zix": "KHAZIX", "Nunu & Willump": "NUNU_WILLUMP", "Jarvan IV": "JARVAN_IV", "Renata Glasc": "RENATA_GLASC" };
  for (const [nom, attendu] of Object.entries(cas)) assert.strictEqual(R.nomClassement(nom), attendu);
  assert.strictEqual(R.nomClassement(undefined), "");
  const noms = R.nomsAnglais(O.analyserTexteOpgg(CHAMPIONS));
  assert.deepStrictEqual([noms.get(62), noms.get(36)], ["Wukong", "Dr. Mundo"]);
  assert.strictEqual(R.nomsAnglais(null).size, 0);
});

test("classement : retrié par VRAI rang (OP.GG trie par parties jouées), file solo, Riot ID vides ignorés", () => {
  const joueurs = R.joueursParRang(O.analyserTexteOpgg(CLASSEMENT));
  assert.deepStrictEqual(joueurs.map((j) => [j.nom, j.tier, j.lp]), [
    ["Joueur Trois", "GRANDMASTER", 2145],
    ["Joueur Un", "MASTER", 1575],
    ["Joueur Deux", "DIAMOND", 31], // son rang de file SOLO, pas celui de la flexible
  ]);
  assert.deepStrictEqual(R.joueursParRang(null), []);
  assert.deepStrictEqual(R.joueursParRang({ leaderboard: [null, { summoner: { game_name: "X" } }] }), [], "Riot ID incomplet");
});

test("historique : seulement les parties sur CE champion (par numéro), poste du client, victoire", () => {
  const brut = O.analyserTexteOpgg(historique([
    [AHRI, "MID", [3100, 3089], "WIN"],
    [17, "TOP", [3071], "LOSE"], // un autre champion
    [AHRI, "ADC", [], "LOSE"],
  ]));
  assert.deepStrictEqual(R.partiesDuChampion(brut, AHRI), [
    { ids: [3100, 3089], role: "middle", victoire: true },
    { ids: [], role: "bottom", victoire: false },
  ]);
  assert.deepStrictEqual(R.partiesDuChampion({ data: {} }, AHRI), []);
  assert.deepStrictEqual(R.partiesDuChampion(undefined, AHRI), []);
});

test("sorte d'objet : bottes, objet fini ; départ, composant, potion, balise et simples bottes ignorés", () => {
  const sorte = (id) => R.sorteObjet(id, OBJETS.get(id));
  assert.strictEqual(sorte(3020), "bottes");
  assert.strictEqual(sorte(3158), "bottes");
  assert.strictEqual(sorte(3100), "fini");
  for (const id of [1056, 1082, 2003, 3340, 1001, 3113]) assert.strictEqual(sorte(id), null, `objet ${id}`);
  assert.strictEqual(R.sorteObjet(9999, undefined), null, "objet inconnu du client");
});

const partie = (ids, role = "middle", victoire = true) => ({ ids, role, victoire });

test("composition : objets les plus pris d'abord, en cœur / souvent / parfois ; bottes les plus prises", () => {
  const parties = [
    partie([1056, 3020, 3100, 3089, 2503]),
    partie([3020, 3100, 2503, 3113], "middle", false),
    partie([3158, 3100, 3089]),
    partie([3020, 3100, 2503, 3157], "middle", false),
    partie([3020, 3100, 3100]), // deux fois le même objet : compté une fois
  ];
  const c = R.composerRank1({ parties, objets: OBJETS, role: "middle" });
  assert.strictEqual(c.n, 5);
  assert.strictEqual(c.victoires, 3);
  assert.deepStrictEqual(c.bottes, [{ id: 3020, part: 0.8 }, { id: 3158, part: 0.2 }]);
  assert.deepStrictEqual(c.coeur.map((o) => [o.id, o.part]), [[3100, 1], [2503, 0.6]]);
  assert.deepStrictEqual(c.souvent.map((o) => [o.id, o.part]), [[3089, 0.4], [3157, 0.2]]);
  assert.deepStrictEqual(c.parfois, []);
});

test("composition : parties à TON poste s'il y en a au moins 3, sinon toutes ; moins de 3 parties -> null", () => {
  const parties = [partie([3100], "middle"), partie([3100], "middle"), partie([3089], "bottom"), partie([3089], "bottom"), partie([3089], "bottom")];
  assert.strictEqual(R.composerRank1({ parties, objets: OBJETS, role: "bottom" }).coeur[0].id, 3089, "3 parties au poste");
  assert.strictEqual(R.composerRank1({ parties, objets: OBJETS, role: "middle" }).n, 5, "2 seulement au poste : toutes");
  assert.strictEqual(R.composerRank1({ parties: parties.slice(0, 2), objets: OBJETS, role: "middle" }), null);
  assert.strictEqual(R.composerRank1({ parties: undefined, objets: OBJETS }), null);
  // Objets du client pas encore lus : aucune sorte connue, mais pas de plantage
  assert.deepStrictEqual(R.composerRank1({ parties, objets: undefined }).coeur, []);
});

test("set « Ahri Rank 1 » : départ du build général, bottes, objets, rang du joueur (jamais son Riot ID)", () => {
  const composition = R.composerRank1({ parties: [partie([3020, 3100, 2503]), partie([3020, 3100]), partie([3158, 3100, 3089])], objets: OBJETS });
  const set = R.setRank1({
    composition, joueur: { tier: "GRANDMASTER", lp: 2145, nom: "Joueur Trois" }, depart: [1056, 2003, 2003], championId: AHRI, nomChampion: "Ahri", carte: 11, region: "EUW",
  });
  assert.strictEqual(set.title, "Ahri Rank 1");
  assert.deepStrictEqual(set.associatedChampions, [AHRI]);
  assert.ok(set.uid.startsWith(R.PREFIXE_UID));
  assert.deepStrictEqual(set.blocks.map((b) => b.type.split(" ·")[0]), ["Départ (build général)", "Bottes du Rank 1", "Rank 1", "Rank 1"]);
  assert.deepStrictEqual(set.blocks[0].items, [{ id: "1056", count: 1 }, { id: "2003", count: 2 }]);
  assert.deepStrictEqual(set.blocks[1].items.map((i) => i.id), ["3020", "3158"]);
  assert.match(set.blocks[1].type, /67 % des parties/);
  assert.deepStrictEqual(set.blocks[2].items.map((i) => i.id), ["3100"]);
  assert.match(set.blocks[2].type, /cœur.*Grand Maître 2145 LP EUW, 3 parties récentes, 100 % V/);
  assert.ok(!JSON.stringify(set).includes("Joueur Trois"), "aucun Riot ID dans le set");
  // Sans départ connu : pas de bloc vide
  const sansDepart = R.setRank1({ composition, joueur: { tier: "MASTER", lp: 5 }, championId: AHRI, nomChampion: "Ahri" });
  assert.strictEqual(sansDepart.blocks[0].type.split(" ·")[0], "Bottes du Rank 1");
  assert.strictEqual(R.libelleRang({ tier: "?", lp: 3 }), "Rang inconnu");
});

// --- Lecture sur OP.GG (faux serveur) --------------------------------------------------------------

function fauxServeur(reponses) {
  const appels = [];
  const appeler = async (url, options) => {
    appels.push({ url, corps: JSON.parse(options.body) });
    const texte = reponses.shift();
    if (texte instanceof Error) throw texte;
    return { ok: true, status: 200, text: async () => JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: texte }] } }) };
  };
  return { appels, appeler };
}

const PARTIES_AHRI = historique([
  [AHRI, "MID", [3020, 3100, 2503], "WIN"],
  [AHRI, "MID", [3020, 3100], "LOSE"],
  [AHRI, "MID", [3158, 3100, 3089], "WIN"],
]);

test("OP.GG rank1 : classement puis historique du MIEUX classé ; envoie champion, serveur et son Riot ID, rien de toi", async () => {
  const serveur = fauxServeur([CHAMPIONS, CLASSEMENT, PARTIES_AHRI]);
  const lecteur = O.creerLecteurOpgg({ appeler: serveur.appeler });
  const r = await lecteur.rank1({ alias: "Ahri", championId: AHRI, region: "euw1" });
  assert.deepStrictEqual(r.joueur, { tier: "GRANDMASTER", lp: 2145, parties: 958, victoires: 548 }, "sans son Riot ID");
  assert.strictEqual(r.parties.length, 3);
  const [liste, classement, matchs] = serveur.appels.map((a) => a.corps.params);
  assert.deepStrictEqual([liste.name, liste.arguments], ["lol_list_champions", { lang: "en_US" }]);
  assert.strictEqual(classement.name, "lol_list_champion_leaderboard");
  assert.deepStrictEqual([classement.arguments.champion, classement.arguments.region], ["AHRI", "EUW"]);
  assert.strictEqual(matchs.name, "lol_list_summoner_matches");
  assert.deepStrictEqual([matchs.arguments.game_name, matchs.arguments.tag_line, matchs.arguments.region], ["Joueur Trois", "AHRI", "EUW"]);
  // Le cache (3 h) : pas de nouvel appel pour le même champion et le même serveur
  await lecteur.rank1({ alias: "Ahri", championId: AHRI, region: "EUW" });
  assert.strictEqual(serveur.appels.length, 3);
});

test("OP.GG rank1 : le meilleur ne joue plus le champion -> le suivant ; personne -> erreur claire", async () => {
  const autreChampion = historique([[17, "TOP", [3071], "WIN"]]);
  const serveur = fauxServeur([CHAMPIONS, CLASSEMENT, autreChampion, PARTIES_AHRI]);
  const r = await O.creerLecteurOpgg({ appeler: serveur.appeler }).rank1({ alias: "Ahri", championId: AHRI, region: "EUW" });
  assert.strictEqual(r.joueur.tier, "MASTER");
  assert.strictEqual(serveur.appels[3].corps.params.arguments.game_name, "Joueur Un");

  const personne = fauxServeur([CHAMPIONS, CLASSEMENT, autreChampion, autreChampion, autreChampion]);
  await assert.rejects(O.creerLecteurOpgg({ appeler: personne.appeler }).rank1({ alias: "Ahri", championId: AHRI, region: "EUW" }), /pas joué ce champion récemment/);
  assert.strictEqual(personne.appels.length, 5, "3 joueurs essayés au plus");

  const vide = fauxServeur([CHAMPIONS, "class LolListChampionLeaderboard: leaderboard\n\nLolListChampionLeaderboard([])"]);
  await assert.rejects(O.creerLecteurOpgg({ appeler: vide.appeler }).rank1({ alias: "Ahri", championId: AHRI, region: "EUW" }), /Pas de classement/);
  await assert.rejects(O.creerLecteurOpgg({ appeler: vide.appeler }).rank1({ alias: "Ahri", championId: AHRI, region: "" }), /serveur inconnu/);
});

test("OP.GG rank1 : Wukong demandé « WUKONG » (son nom anglais), pas « MONKEYKING » (refusé par le classement)", async () => {
  const serveur = fauxServeur([CHAMPIONS, CLASSEMENT, historique([[62, "TOP", [3071], "WIN"], [62, "TOP", [3071], "WIN"], [62, "TOP", [3071], "LOSE"]])]);
  await O.creerLecteurOpgg({ appeler: serveur.appeler }).rank1({ alias: "MonkeyKing", championId: 62, region: "EUW" });
  assert.strictEqual(serveur.appels[1].corps.params.arguments.champion, "WUKONG");
});
