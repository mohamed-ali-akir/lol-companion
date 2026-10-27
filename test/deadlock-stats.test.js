// Mode Deadlock : calculs (deadlock-stats.js) sur des extraits au format réel de deadlock-api.com (27/10/2026),
// lignes abîmées comprises : une API de la communauté, un jeu en bêta, des champs qui changent.
const test = require("node:test");
const assert = require("node:assert");
const S = require("../deadlock-stats.js");

const HEROS_API = [
  { id: 1, name: "Infernus", player_selectable: true, disabled: false, in_development: false },
  { id: 2, name: "Seven", player_selectable: true },
  { id: 3, name: "Vindicta", player_selectable: true },
  { id: 50, name: "Héros en test", player_selectable: true, in_development: true },
  { id: 51, name: "Désactivé", disabled: true },
  { id: 52, name: "Pas jouable", player_selectable: false },
  { id: 0, name: "Zéro" },
  { id: 4, name: "  " },
  null,
  "abîmé",
];
const HEROS = S.normaliserHeros(HEROS_API);

test("héros : seulement les jouables, données abîmées ignorées", () => {
  assert.deepStrictEqual([...HEROS.values()], [{ id: 1, nom: "Infernus" }, { id: 2, nom: "Seven" }, { id: 3, nom: "Vindicta" }]);
  assert.strictEqual(S.normaliserHeros(null).size, 0);
  assert.strictEqual(S.normaliserHeros({ pas: "une liste" }).size, 0);
});

test("objets : améliorations de la boutique, emplacement traduit, le reste ignoré", () => {
  const objets = S.normaliserObjets([
    { id: 1548066885, name: "Extended Magazine", type: "upgrade", item_slot_type: "weapon", item_tier: 1, cost: 800, shopable: true },
    { id: 2, name: "Extra Spirit", type: "upgrade", item_slot_type: "spirit", item_tier: 1, cost: 800 },
    { id: 3, name: "Arme du héros", type: "weapon", item_slot_type: "weapon" }, // pas un objet de la boutique
    { id: 4, name: "Retiré", type: "upgrade", shopable: false },
    { id: 5, name: "Inconnu", type: "upgrade", item_slot_type: "nouveau", cost: -3 },
  ]);
  assert.deepStrictEqual(objets.get(1548066885), { id: 1548066885, nom: "Extended Magazine", emplacement: "arme", palier: 1, prix: 800 });
  assert.strictEqual(objets.get(2).emplacement, "esprit");
  assert.deepStrictEqual([...objets.keys()], [1548066885, 2, 5]);
  assert.deepStrictEqual(objets.get(5), { id: 5, nom: "Inconnu", emplacement: null, palier: null, prix: null });
});

test("rangs et niveau minimal : du plus bas au plus haut, badge = rang x 10", () => {
  assert.deepStrictEqual(S.normaliserRangs([{ tier: 8, name: "Oracle" }, { tier: 0, name: "Obscurus" }, { tier: "x", name: "?" }]), [
    { rang: 0, nom: "Obscurus" },
    { rang: 8, nom: "Oracle" },
  ]);
  assert.strictEqual(S.badgeMinimal(8), 80);
  assert.strictEqual(S.badgeMinimal(null), null);
  assert.strictEqual(S.badgeMinimal(0), null, "Obscurus et plus = tous les niveaux");
  assert.strictEqual(S.badgeMinimal(12), null);
});

// Ligne réelle de /v1/players/{id}/match-history (joueur public du classement, 27/10/2026)
const PARTIE_API = {
  account_id: 415301036, match_id: 125460363, hero_id: 58, hero_level: 20, start_time: 1793052059, game_mode: 1, match_mode: 1,
  player_team: 0, player_kills: 2, player_deaths: 0, player_assists: 4, denies: 3, net_worth: 14206, last_hits: 76,
  abandoned_time_s: 0, match_duration_s: 660, match_result: 0, player_match_outcome: 1,
};

test("partie : victoire = équipe gagnante, type de partie, dates en millisecondes", () => {
  assert.deepStrictEqual(S.partieDepuisApi(PARTIE_API), {
    id: 125460363, heroId: 58, debut: 1793052059000, dureeS: 660, victoire: true, eliminations: 2, morts: 0, assistances: 4,
    ames: 14206, derniersCoups: 76, type: "Normale", abandon: false,
  });
  assert.strictEqual(S.partieDepuisApi({ ...PARTIE_API, match_result: 1 }).victoire, false);
  assert.strictEqual(S.partieDepuisApi({ ...PARTIE_API, match_result: undefined }).victoire, null);
  assert.strictEqual(S.partieDepuisApi({ ...PARTIE_API, game_mode: 4 }).type, "Street Brawl");
  assert.strictEqual(S.partieDepuisApi({ ...PARTIE_API, match_mode: 4 }).type, "Classée");
  assert.strictEqual(S.partieDepuisApi({ ...PARTIE_API, match_mode: 99 }).type, "Autre");
  assert.strictEqual(S.partieDepuisApi({ ...PARTIE_API, abandoned_time_s: 300 }).abandon, true);
  assert.strictEqual(S.partieDepuisApi({ ...PARTIE_API, player_kills: -1 }).eliminations, null);
  for (const abime of [null, {}, { ...PARTIE_API, match_id: "x" }, { ...PARTIE_API, hero_id: 1.5 }, { ...PARTIE_API, start_time: null }]) {
    assert.strictEqual(S.partieDepuisApi(abime), null);
  }
});

test("historique : plus récente d'abord, sans doublons ni lignes abîmées", () => {
  const parties = S.partiesDepuisApi([
    { ...PARTIE_API, match_id: 1, start_time: 100 },
    { ...PARTIE_API, match_id: 2, start_time: 300 },
    { ...PARTIE_API, match_id: 1, start_time: 100 },
    { match_id: 3 },
  ]);
  assert.deepStrictEqual(parties.map((p) => p.id), [2, 1]);
  assert.deepStrictEqual(S.partiesDepuisApi("pas une liste"), []);
});

test("résumé : taux de victoire, KDA (0 mort compté 1), héros les plus joués", () => {
  const parties = [
    { id: 3, heroId: 1, debut: 3, victoire: true, eliminations: 10, morts: 0, assistances: 5 },
    { id: 2, heroId: 2, debut: 2, victoire: false, eliminations: 2, morts: 4, assistances: 3 },
    { id: 1, heroId: 1, debut: 1, victoire: true, eliminations: 4, morts: 2, assistances: 6 },
    { id: 0, heroId: 1, debut: 0, victoire: null, eliminations: null, morts: null, assistances: null },
  ];
  const r = S.resumeParties(parties, HEROS, { combien: 2 });
  assert.strictEqual(r.nombre, 4);
  assert.strictEqual(r.victoires, 2);
  assert.strictEqual(r.tauxVictoire, 2 / 3, "parties au résultat inconnu non comptées");
  assert.strictEqual(r.kda, (10 + 5 + 2 + 3 + 4 + 6) / (1 + 4 + 2));
  assert.deepStrictEqual(r.dernieres.map((p) => [p.id, p.nomHeros]), [[3, "Infernus"], [2, "Seven"]]);
  assert.deepStrictEqual(r.parHeros.map((h) => [h.nom, h.parties, h.victoires]), [["Infernus", 2, 2], ["Seven", 1, 0]]);
  const vide = S.resumeParties([], HEROS);
  assert.deepStrictEqual([vide.nombre, vide.tauxVictoire, vide.kda, vide.dernieres, vide.parHeros], [0, null, null, [], []]);
  assert.strictEqual(S.resumeParties([{ id: 9, heroId: 77, debut: 0, victoire: true }]).dernieres[0].nomHeros, "Héros n° 77");
});

test("tes stats par héros (/v1/players/hero-stats) : du plus joué au moins joué", () => {
  const mes = S.mesStatsParHeros([
    { hero_id: 1, matches_played: 177, wins: 102, kills: 1341, deaths: 1180, assists: 1620, time_played: 326620, last_played: 1785777952 },
    { hero_id: 2, matches_played: 3, wins: 9, kills: 1, deaths: 0, assists: 1 },
    { hero_id: 3, matches_played: 0, wins: 0 },
    { hero_id: "x", matches_played: 4 },
  ], HEROS);
  assert.deepStrictEqual(mes.map((h) => h.nom), ["Infernus", "Seven"]);
  assert.strictEqual(mes[0].tauxVictoire, 102 / 177);
  assert.strictEqual(mes[0].kda, (1341 + 1620) / 1180);
  assert.strictEqual(mes[0].derniere, 1785777952000);
  assert.strictEqual(mes[1].victoires, 3, "plus de victoires que de parties : ramené au nombre de parties");
  assert.strictEqual(mes[1].kda, 2, "0 mort compté 1");
});

test("tier list : taux prudent (un héros peu joué ne passe pas devant), popularité, héros non jouables écartés", () => {
  const tl = S.tierListe([
    { hero_id: 1, wins: 5500, losses: 4500, matches: 10000 }, // 55 % sur 10 000
    { hero_id: 2, wins: 342, losses: 258, matches: 600 }, // 57 % sur 600 : moins sûr que 55 % sur 10 000
    { hero_id: 3, wins: 100, losses: 50, matches: 150 }, // trop peu de parties
    { hero_id: 50, wins: 9000, losses: 1000, matches: 10000 }, // pas jouable
    { hero_id: 2, wins: "?", matches: "?" },
  ], HEROS);
  assert.deepStrictEqual(tl.map((h) => h.nom), ["Infernus", "Seven"]);
  assert.strictEqual(tl[1].tauxVictoire, 0.57);
  assert.ok(tl[1].prudent < tl[0].prudent);
  const total = (10000 + 600 + 150 + 10000) / 12;
  assert.ok(Math.abs(tl[0].popularite - Math.min(1, 10000 / total)) < 1e-12);
  assert.ok(tl.every((h) => h.popularite <= 1), "jamais plus de 100 %");
  assert.deepStrictEqual(S.tierListe(null), []);
});

// Extrait de /v1/analytics/item-stats?hero_id=1 (27/10/2026, chiffres arrondis)
const OBJETS = S.normaliserObjets([
  { id: 11, name: "Extended Magazine", type: "upgrade", item_slot_type: "weapon", cost: 800 },
  { id: 12, name: "Extra Spirit", type: "upgrade", item_slot_type: "spirit", cost: 800 },
  { id: 13, name: "Titanic Magazine", type: "upgrade", item_slot_type: "weapon", cost: 3200 },
  { id: 14, name: "Boundless Spirit", type: "upgrade", item_slot_type: "spirit", cost: 6400 },
  { id: 15, name: "Rare", type: "upgrade", item_slot_type: "spirit", cost: 1600 },
]);

test("build : par moment de la partie, les plus achetés, ★ au plus sûr de sa période, objets rares écartés", () => {
  const b = S.buildDuHeros([
    { item_id: 11, wins: 49000, losses: 51000, matches: 100000, avg_buy_time_s: 360 },
    { item_id: 12, wins: 40000, losses: 38000, matches: 78000, avg_buy_time_s: 240 },
    { item_id: 13, wins: 41000, losses: 41000, matches: 82000, avg_buy_time_s: 660 },
    { item_id: 14, wins: 26000, losses: 22000, matches: 48000, avg_buy_time_s: 1860 },
    { item_id: 15, wins: 300, losses: 100, matches: 400, avg_buy_time_s: 300 }, // 0,3 % des parties : écarté
    { item_id: 99, wins: 1, losses: 1, matches: 2, avg_buy_time_s: 300 }, // objet inconnu
    { item_id: 11, wins: 1, matches: 0 },
  ], OBJETS, { partiesHeros: 120000 });
  assert.strictEqual(b.parties, 120000);
  assert.deepStrictEqual(b.phases.map((p) => p.cle), ["debut", "milieu", "fin"]);
  const [debut, milieu, fin] = b.phases;
  assert.deepStrictEqual(debut.objets.map((o) => o.nom), ["Extra Spirit", "Extended Magazine"], "rangés par minute d'achat");
  assert.deepStrictEqual(debut.objets.map((o) => o.conseille), [true, false], "51,3 % sur 78 000 > 49 % sur 100 000");
  assert.strictEqual(debut.objets[1].achat, 100000 / 120000);
  assert.strictEqual(debut.objets[0].minute, 4);
  assert.strictEqual("prudent" in debut.objets[0], false, "le score de classement n'est pas envoyé à la page");
  assert.deepStrictEqual(milieu.objets.map((o) => [o.nom, o.conseille]), [["Titanic Magazine", false]], "un seul objet : pas d'étoile");
  assert.deepStrictEqual(fin.objets.map((o) => o.nom), ["Boundless Spirit"]);
  // Sans le total du héros : le plus acheté sert d'estimation
  assert.strictEqual(S.buildDuHeros([{ item_id: 11, wins: 50, losses: 50, matches: 1000, avg_buy_time_s: 60 }], OBJETS).parties, 1000);
  assert.deepStrictEqual(S.buildDuHeros(null, OBJETS).phases.map((p) => p.objets), [[], [], []]);
});

test("contres : difficiles sous 50 %, faciles au-dessus, duels trop rares écartés, jamais lui-même", () => {
  const c = S.contresDuHeros([
    { hero_id: 1, enemy_hero_id: 2, wins: 4190, matches_played: 10000 },
    { hero_id: 1, enemy_hero_id: 3, wins: 5460, matches_played: 10000 },
    { hero_id: 1, enemy_hero_id: 1, wins: 5000, matches_played: 10000 },
    { hero_id: 1, enemy_hero_id: 50, wins: 1000, matches_played: 10000 }, // héros pas jouable
    { hero_id: 2, enemy_hero_id: 1, wins: 5810, matches_played: 10000 }, // un autre héros
    { hero_id: 1, enemy_hero_id: 3, wins: 10, matches_played: 20 },
  ], 1, HEROS);
  assert.deepStrictEqual(c.difficiles.map((d) => [d.nom, d.tauxVictoire]), [["Seven", 0.419]]);
  assert.deepStrictEqual(c.faciles.map((d) => [d.nom, d.tauxVictoire]), [["Vindicta", 0.546]]);
  assert.deepStrictEqual(S.contresDuHeros(undefined, 1, HEROS), { difficiles: [], faciles: [] });
});

test("temps de jeu : aujourd'hui depuis minuit, 7 jours, total, session en cours comprise", () => {
  const maintenant = new Date(2026, 9, 27, 12, 0).getTime(); // 27/10/2026 à midi (heure du PC)
  const h = 3600 * 1000;
  const sessions = [
    { debut: new Date(2026, 9, 26, 23, 0).getTime(), fin: new Date(2026, 9, 27, 1, 0).getTime() }, // à cheval sur minuit
    { debut: maintenant - 10 * 24 * h, fin: maintenant - 10 * 24 * h + 2 * h }, // il y a 10 jours
    { debut: 5, fin: 1 }, // abîmée
  ];
  const t = S.tempsDeJeu(sessions, maintenant - 0.5 * h, maintenant);
  assert.strictEqual(t.aujourdhui, 1 * h + 0.5 * h);
  assert.strictEqual(t.septJours, 2 * h + 0.5 * h);
  assert.strictEqual(t.total, 4 * h + 0.5 * h);
  assert.deepStrictEqual(S.tempsDeJeu(null, null, maintenant), { aujourdhui: 0, septJours: 0, total: 0 });
});
