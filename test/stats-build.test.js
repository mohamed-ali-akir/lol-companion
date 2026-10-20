// Tests des stats de build (stats-build.js) avec un faux client et de faux lecteurs OP.GG / Lolalytics : sans Internet.
const test = require("node:test");
const assert = require("node:assert");
const { creerStatsBuild, enObjetsArena, DECALAGE_ARENA, TIERS_RANK1 } = require("../stats-build.js");

const KAYLE = 10;
const partieAram = { map: { id: 12, gameMode: "ARAM" }, gameData: { queue: { id: 450, gameMode: "ARAM", mapId: 12 } } };
const partieArena = { map: { id: 30, gameMode: "CHERRY" }, gameData: { queue: { id: 1700, gameMode: "CHERRY", mapId: 30 } } };
const partieFaille = { map: { id: 11, gameMode: "CLASSIC" }, gameData: { queue: { id: 420, gameMode: "CLASSIC", mapId: 11 } } };

/** Faux client (lectures comptées) et faux lecteurs qui notent ce qu'on leur demande. */
function monter({ arenaVide = false, partie = partieFaille, recommandations = [{ position: "TOP" }], parties = { "1trick": 2774, master_plus: 6708 } } = {}) {
  const appels = { opgg: [], lolalytics: [], alias: 0 };
  const client = {
    lireNomsChampions: async () => new Map([[KAYLE, "Kayle"]]),
    lireAliasChampions: async () => {
      appels.alias++;
      return new Map([[KAYLE, "Kayle"]]);
    },
    lireObjets: async () => ({ noms: new Map([[3115, "Dent de Nashor"], [223115, "Dent de Nashor"], [223020, "Chaussures de sorcier"], [223089, "Coiffe de Rabadon"]]), categories: new Map([[3115, ["SpellDamage"]]]), details: new Map() }),
    lirePartie: async () => partie,
    lireRecommandations: async () => recommandations,
  };
  const lecteurOpgg = {
    analyser: async (demande) => {
      appels.opgg.push(demande);
      return { runes: { mode: demande.mode }, sorts: { ids: demande.mode === "aram" ? [4, 32] : [4, 14] } };
    },
  };
  const lecteurLolalytics = {
    analyserArena: async (demande) => {
      appels.lolalytics.push({ ...demande, arena: true });
      if (arenaVide) return { stats: { parties: 12 }, prismatique: [], emplacements: [[], [], [], [], []] };
      return { stats: { parties: 17606 }, prismatique: [], emplacements: [[{ ids: [223115] }]], nom: demande.nomObjet(3115) };
    },
    analyser: async (demande) => {
      appels.lolalytics.push(demande);
      const n = demande.tier ? parties[demande.tier] : 45000;
      if (n === undefined) throw new Error("page introuvable");
      const option = (id, parties) => ({ ids: [id], parties, victoires: parties / 2, selection: 0.5, noms: [`Objet ${id}`] });
      return {
        stats: { parties: n },
        depart: [option(1056, 900)],
        bottes: [option(3020, 800), option(1001, 100)], // 1001 (bottes de base) : pas d'équivalent en Arena
        emplacements: [[option(3115, 700)], [option(3089, 600), option(9999, 50)]],
        familles: [{ nom: "AP" }],
        nom: demande.nomObjet(3115),
        categories: demande.categoriesObjet(3115),
      };
    },
  };
  const s = creerStatsBuild({ dossierJeu: () => "C:\\Riot Games\\League of Legends", lecteurOpgg, lecteurLolalytics, client });
  return { s, appels };
}

test("build automatique : toujours la Faille, même en ARAM ; rôle principal du champion d'après Riot", async () => {
  const { s } = monter({ partie: partieAram });
  assert.deepStrictEqual(await s.contexteBuild({ championId: KAYLE, role: null }), { alias: "Kayle", role: "top", mode: "ranked", modeJeu: "aram" });
  const faille = monter({ partie: partieFaille }).s;
  assert.deepStrictEqual(await faille.contexteBuild({ championId: KAYLE, role: "middle" }), { alias: "Kayle", role: "middle", mode: "ranked", modeJeu: "ranked" });
  // Pas de recommandation de Riot : Milieu par défaut ; mode inconnu (partie illisible) : la Faille
  const inconnu = monter({ partie: null, recommandations: [] }).s;
  assert.deepStrictEqual(await inconnu.contexteBuild({ championId: KAYLE, role: null }), { alias: "Kayle", role: "middle", mode: "ranked", modeJeu: "ranked" });
});

test("consultation de l'onglet Build : le mode choisi est respecté (ARAM sans rôle)", async () => {
  const { s } = monter({ partie: partieFaille });
  assert.deepStrictEqual(await s.contexteBuild({ championId: KAYLE, role: null, mode: "aram" }), { alias: "Kayle", role: null, mode: "aram", modeJeu: "aram" });
  await assert.rejects(s.contexteBuild({ championId: 999, role: "top" }), /Champion inconnu/);
});

test("OP.GG : stats de la Faille, mais en ARAM les sorts d'invocateur viennent des stats ARAM", async () => {
  const { s, appels } = monter({ partie: partieAram });
  const a = await s.analyserOpgg({ championId: KAYLE, role: null });
  assert.strictEqual(a.runes.mode, "ranked", "runes de la Faille");
  assert.deepStrictEqual(a.sorts.ids, [4, 32], "sorts de l'ARAM (Flash + Boule de neige), pas Téléportation");
  assert.deepStrictEqual(appels.opgg.map((d) => d.mode), ["ranked", "aram"]);
  const faille = monter({ partie: partieFaille });
  assert.deepStrictEqual((await faille.s.analyserOpgg({ championId: KAYLE, role: "top" })).sorts.ids, [4, 14]);
  assert.strictEqual(faille.appels.opgg.length, 1, "sur la Faille, une seule demande");
});

test("Lolalytics : noms et catégories des objets du client ; lus une seule fois", async () => {
  const { s, appels } = monter();
  const a = await s.analyserLolalytics({ championId: KAYLE, role: "top" });
  assert.strictEqual(a.nom, "Dent de Nashor");
  assert.deepStrictEqual(a.categories, ["SpellDamage"]);
  await s.analyserLolalytics({ championId: KAYLE, role: "top" });
  assert.strictEqual(appels.alias, 1, "alias des champions gardés en mémoire");
});

test("set Rank 1 : meilleurs joueurs (1trick), sinon Maître et plus ; erreur claire si rien d'utilisable", async () => {
  assert.deepStrictEqual(TIERS_RANK1.map((t) => t.tier), ["1trick", "master_plus"]);
  const ok = monter();
  const r = await ok.s.analyserRank1({ championId: KAYLE, role: "top" });
  assert.strictEqual(r.libelle, "Meilleurs joueurs");
  assert.strictEqual(r.parties, 2774);
  assert.deepStrictEqual(ok.appels.lolalytics.map((d) => [d.tier, d.mode]), [["1trick", "ranked"]]);

  const peu = monter({ parties: { "1trick": 120, master_plus: 6708 } });
  assert.strictEqual((await peu.s.analyserRank1({ championId: KAYLE, role: "top" })).libelle, "Maître et plus");

  const rien = monter({ parties: {} });
  await assert.rejects(rien.s.analyserRank1({ championId: KAYLE, role: "top" }), /page introuvable/);
});

test("Arena : stats de l'Arena (pas de la Faille), sans rôle ; ni OP.GG ni set Rank 1", async () => {
  const { s, appels } = monter({ partie: partieArena });
  assert.deepStrictEqual(await s.contexteBuild({ championId: KAYLE, role: null }), { alias: "Kayle", role: null, mode: "arena", modeJeu: "arena" });
  const a = await s.analyserLolalytics({ championId: KAYLE, role: null });
  assert.deepStrictEqual([a.stats.parties, a.nom], [17606, "Dent de Nashor"]);
  assert.strictEqual(appels.lolalytics[0].arena, true);
  await assert.rejects(s.analyserOpgg({ championId: KAYLE, role: null }), /OP\.GG n'a pas de stats/);
  await assert.rejects(s.analyserRank1({ championId: KAYLE, role: null }), /Rank 1 en Arena/);
  assert.strictEqual(appels.opgg.length, 0);
  // Consultation de l'onglet Build : mode Arena choisi, même sur la Faille.
  const faille = monter({ partie: partieFaille }).s;
  assert.strictEqual((await faille.contexteBuild({ championId: KAYLE, role: "top", mode: "arena" })).mode, "arena");
});

test("Arena sans build sur Lolalytics : build de la Faille (rôle principal), converti en objets Arena", async () => {
  const { s, appels } = monter({ partie: partieArena, arenaVide: true });
  const a = await s.analyserLolalytics({ championId: KAYLE, role: null });
  assert.strictEqual(a.depuisFaille, true);
  assert.deepStrictEqual(appels.lolalytics.map((d) => (d.arena ? "arena" : `${d.mode} ${d.role}`)), ["arena", "ranked top"]);
  assert.deepStrictEqual(a.depart, [], "pas de départ de la Faille en Arena (Anneau de Doran...)");
  assert.deepStrictEqual(a.bottes.map((o) => o.ids), [[223020]]);
  assert.deepStrictEqual(a.emplacements.map((e) => e.map((o) => o.ids[0])), [[223115], [223089]], "objet sans version Arena retiré");
  assert.deepStrictEqual(a.familles, []);
});

test("enObjetsArena : numéro + 220000 si la version Arena existe ; noms du client", () => {
  const existe = (id) => [223115, 223006].includes(id);
  const faille = { stats: { parties: 1 }, depart: [{ ids: [1056, 2003] }], bottes: [{ ids: [3006] }, { ids: [1001] }], emplacements: [[{ ids: [3115] }, { ids: [223115] }]], familles: [{}] };
  const a = enObjetsArena(faille, existe, (id) => `n°${id}`);
  assert.deepStrictEqual(a.bottes, [{ ids: [223006], noms: ["n°223006"] }]);
  assert.deepStrictEqual(a.emplacements[0].map((o) => o.ids), [[223115], [223115]], "un numéro déjà Arena est gardé");
  assert.strictEqual(DECALAGE_ARENA, 220000);
});

test("rôle principal : Riot répond « NONE » (19/10/2026) -> voie habituelle de Lolalytics ; Lolalytics muet -> Milieu", async () => {
  const demandes = [];
  const avecVoie = creerStatsBuild({
    dossierJeu: () => "C:\\Riot Games\\League of Legends",
    lecteurOpgg: { analyser: async () => ({}) },
    lecteurLolalytics: { roleHabituel: async (d) => (demandes.push(d), "jungle") },
    client: {
      lireAliasChampions: async () => new Map([[KAYLE, "Kayle"]]),
      lirePartie: async () => partieAram,
      lireRecommandations: async () => [{ position: "NONE" }],
    },
  });
  assert.deepStrictEqual(await avecVoie.contexteBuild({ championId: KAYLE, role: null }), { alias: "Kayle", role: "jungle", mode: "ranked", modeJeu: "aram" });
  assert.deepStrictEqual(demandes, [{ alias: "Kayle" }]);
  // Rôle déjà connu (Faille) : Lolalytics n'est pas interrogé pour ça
  assert.strictEqual((await avecVoie.contexteBuild({ championId: KAYLE, role: "top" })).role, "top");
  assert.strictEqual(demandes.length, 1);
  const muet = creerStatsBuild({
    dossierJeu: () => "C:\\Riot Games\\League of Legends",
    lecteurOpgg: { analyser: async () => ({}) },
    lecteurLolalytics: { roleHabituel: async () => { throw new Error("hors ligne"); } },
    client: { lireAliasChampions: async () => new Map([[KAYLE, "Kayle"]]), lirePartie: async () => partieAram, lireRecommandations: async () => [] },
  });
  assert.strictEqual((await muet.contexteBuild({ championId: KAYLE, role: null })).role, "middle");
});
