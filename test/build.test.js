// Tests du build automatique : classement, composition, runes, set d'objets, logique, faux client HTTPS.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const https = require("https");
const os = require("os");
const path = require("path");
const certificat = require("./fixtures/certificat-test.js");
const B = require("../build.js");
const O = require("../opgg.js");

const attendre = (ms) => new Promise((ok) => setTimeout(ok, ms));
const AHRI = 103;

const option = (ids, parties, victoires, selection, noms = ids.map((id) => `Objet ${id}`)) => ({ ids, noms, parties, victoires, selection });

// Analyse proche de la vraie (Ahri milieu).
const ANALYSE = {
  stats: { parties: 139371, tauxVictoire: 0.51, tauxSelection: 0.1 },
  depart: option([1056, 2003, 2003], 126012, 63921, 0.99),
  principaux: option([3118, 4645, 3157], 9587, 5071, 0.13),
  bottes: option([3020], 76231, 39052, 0.59),
  quatrieme: [option([3089], 9660, 5694, 0.32), option([3157], 7712, 4570, 0.25), option([3135], 2716, 1458, 0.09)],
  cinquieme: [option([3089], 1504, 967, 0.19), option([3135], 1329, 760, 0.17), option([3102], 30, 25, 0.02)],
  sixieme: [option([4629], 24, 10, 0.17), option([3102], 21, 11, 0.15)],
  sorts: option([4, 14], 69813, 35984, 0.53),
  runes: {
    stylePrincipal: 8100, styleSecondaire: 8200, nomStylePrincipal: "Domination", nomStyleSecondaire: "Sorcellerie",
    runesPrincipales: [8112, 8139, 8140, 8106], runesSecondaires: [8210, 8226], fragments: [5005, 5008, 5001],
    noms: ["Électrocution", "Goût du sang", "Impact soudain", "Chasseur ultime", "Transcendance", "Flux de mana"],
    parties: 61499, victoires: 30841, selection: 0.47,
  },
};

test("réglages : tout désactivé par défaut ; reprise de l'ancien réglage des runes", () => {
  assert.deepStrictEqual(B.normaliserReglagesBuild(undefined), { stats: false, runes: false, objets: false, augments: false });
  assert.deepStrictEqual(B.normaliserReglagesBuild({ stats: "oui", runes: 1, objets: true, augments: "oui" }), {
    stats: false, runes: false, objets: true, augments: false,
  });
  assert.deepStrictEqual(B.normaliserReglagesBuild(undefined, { actif: true }), { stats: false, runes: true, objets: false, augments: false });
  assert.deepStrictEqual(B.normaliserReglagesBuild({ runes: false }, { actif: true }), { stats: false, runes: false, objets: false, augments: false });
  assert.strictEqual(B.normaliserReglagesBuild({ augments: true }).augments, true);
});

test("taux de victoire prudent : moins de parties = plus de marge", () => {
  assert.strictEqual(B.scorePrudent(0, 0), 0);
  const gros = B.scorePrudent(5310, 9000); // 59 % sur 9 000 parties
  const petit = B.scorePrudent(15, 24); // 62 % sur 24 parties
  assert.ok(gros > 0.57 && gros < 0.59);
  assert.ok(petit < 0.45, "24 parties : très incertain");
  assert.ok(gros > petit);
  assert.ok(B.scorePrudent(10, 10) < 1);
});

test("classement : prudent d'abord, options rares (< 5 %) en dernier, objets déjà pris exclus", () => {
  const classees = B.classerOptions(ANALYSE.cinquieme, new Set([3089]));
  assert.deepStrictEqual(classees.map((o) => o.ids[0]), [3135, 3102]); // Rabadon déjà pris ; 3102 rare (2 %) en dernier
  // Seulement des rares : on garde quand même la meilleure. 67 % sur 30 parties < 53 % sur 3 000 parties (prudent).
  const rares = B.classerOptions([option([1], 30, 20, 0.02), option([2], 3000, 1600, 0.01)]);
  assert.deepStrictEqual(rares.map((o) => o.ids[0]), [2, 1]);
  assert.deepStrictEqual(B.classerOptions(undefined), []);
});

test("composition : départ, principaux, bottes, puis meilleur 4e/5e/6e sans doublon", () => {
  const etapes = B.composerBuild(ANALYSE);
  assert.deepStrictEqual(etapes.map((e) => e.cle), ["depart", "principaux", "bottes", "quatrieme", "cinquieme", "sixieme"]);
  const [, , , quatrieme, cinquieme, sixieme] = etapes;
  assert.deepStrictEqual(quatrieme.option.ids, [3089]); // Zhonya (59,3 %) est déjà dans les principaux
  assert.deepStrictEqual(quatrieme.autres.map((o) => o.ids[0]), [3135]);
  assert.deepStrictEqual(cinquieme.option.ids, [3135]); // Rabadon déjà pris en 4e
  assert.deepStrictEqual(sixieme.option.ids, [3102]); // meilleur score prudent parmi les deux
  assert.deepStrictEqual(B.composerBuild(null), []);
  assert.deepStrictEqual(B.composerBuild({ quatrieme: [], cinquieme: [], sixieme: [] }), []);
});

// Vraies données de Hwei milieu (02/10/2026) : le 6e objet repose sur 5, 4 et 4 parties.
const HWEI = {
  depart: option([1056, 2003, 2003], 54471, 27780, 0.97),
  principaux: option([2503, 6653, 4645], 3661, 1973, 0.12),
  bottes: option([3020], 32727, 17018, 0.6),
  quatrieme: [option([3089], 3147, 1776, 0.26), option([3157], 2972, 1621, 0.25), option([3135], 1159, 602, 0.1)],
  cinquieme: [option([3089], 602, 325, 0.22), option([3157], 504, 281, 0.18), option([3135], 331, 183, 0.12)],
  sixieme: [option([3135], 5, 2, 0.15), option([3152], 4, 4, 0.12), option([3102], 4, 1, 0.12)],
};

test("seuil relevé : fiable = au moins 10 % des parties ET 200 parties", () => {
  assert.strictEqual(B.SELECTION_MIN, 0.1);
  assert.strictEqual(B.PARTIES_MIN, 200);
  // 9 % de sélection (sous 10 %) passe après une option fiable, même avec un meilleur taux
  const classees = B.classerOptions([option([1], 5000, 3000, 0.09), option([2], 1000, 520, 0.2)]);
  assert.deepStrictEqual(classees.map((o) => o.ids[0]), [2, 1]);
});

test("Hwei : 6e objet trop incertain -> meilleur objet fiable restant (pas la Ceinture-roquette sur 4 parties)", () => {
  const etapes = B.composerBuild(HWEI);
  const [, , , quatrieme, cinquieme, sixieme] = etapes;
  assert.deepStrictEqual(quatrieme.option.ids, [3089]); // Rabadon
  assert.deepStrictEqual(cinquieme.option.ids, [3157]); // Zhonya
  // Bâton du vide, d'après les 4e/5e : la version au meilleur score prudent (5e : 55 % sur 331 parties).
  assert.deepStrictEqual(sixieme.option.ids, [3135]);
  assert.ok(sixieme.option.parties >= B.PARTIES_MIN);
  assert.strictEqual(sixieme.fiable, true);
  assert.match(sixieme.note, /Pas assez de parties/);
  assert.ok(!etapes.some((e) => e.option.ids.includes(3152)), "Ceinture-roquette jamais retenue");
});

test("3 choix par emplacement (le retenu + 2 autres) pour s'adapter", () => {
  const [, , , quatrieme] = B.composerBuild(HWEI);
  assert.deepStrictEqual(quatrieme.autres.map((o) => o.ids[0]), [3157, 3135]); // Zhonya puis Bâton du vide
  assert.ok(B.composerBuild(HWEI).every((e) => e.autres.length <= 2));
});

// --- Build emplacement par emplacement (Lolalytics) --------------------------------------------

// Données de Lolalytics pour Hwei milieu (02/10/2026), raccourcies ; selection = part des achats de l'emplacement.
const LOLA = {
  stats: { parties: 65113, tauxVictoire: 0.517 },
  depart: [option([1056, 2003, 2003], 63197, 33311, 0.98), option([3070, 2003, 2003], 1311, 690, 0.02)],
  bottes: [option([3020], 38026, 20416, 0.62), option([3158], 18195, 9560, 0.3), option([3111], 4645, 2364, 0.08)],
  emplacements: [
    [option([2503], 54627, 28947, 0.86), option([6655], 8105, 4187, 0.13), option([3003], 768, 405, 0.012), option([6653], 226, 127, 0.004)],
    [option([4645], 21936, 11885, 0.4), option([6653], 18081, 9708, 0.33), option([3152], 6430, 3574, 0.12), option([2503], 500, 300, 0.01)],
    [option([4645], 9376, 5372, 0.25), option([3089], 8646, 4929, 0.23), option([3157], 5856, 3300, 0.16)],
    [option([3089], 3656, 2105, 0.2), option([3157], 3442, 1917, 0.19), option([3041], 978, 693, 0.05)],
    [option([3157], 663, 372, 0.08), option([3135], 414, 221, 0.05), option([4646], 36, 23, 0.01)],
  ],
};

test("3 choix : fiables d'abord (≥ 10 % et ≥ 200 parties), puis ≥ 2 % et ≥ 200, puis le reste", () => {
  // Torche et Luden sont fiables ; Archange (1,2 %) et Liandry (0,4 %) sont tous deux sous 2 % des achats :
  // départagés au score prudent (Liandry 56 % sur 226 parties > Archange 53 % sur 768).
  const choix = B.troisChoix(LOLA.emplacements[0]);
  assert.deepStrictEqual(choix.map((o) => o.ids[0]), [2503, 6655, 6653]);
  assert.deepStrictEqual(B.troisChoix(LOLA.emplacements[0], new Set([2503])).map((o) => o.ids[0]), [6655, 6653, 3003]);
  // ≥ 2 % et ≥ 200 parties passe avant le reste, même avec un moins bon taux
  const ordre = B.troisChoix([option([1], 300, 200, 0.01), option([2], 500, 255, 0.03)]);
  assert.deepStrictEqual(ordre.map((o) => o.ids[0]), [2, 1]);
  assert.deepStrictEqual(B.troisChoix(undefined), []);
});

test("build par emplacement : Départ, Objet 1, Bottes, Objets 2 à 5, 3 choix chacun, pas de doublon recommandé", () => {
  const etapes = B.composerParEmplacement(LOLA);
  assert.deepStrictEqual(etapes.map((e) => e.titre), ["Départ", "Objet 1", "Bottes", "Objet 2", "Objet 3", "Objet 4", "Objet 5"]);
  assert.ok(etapes.every((e) => e.autres.length <= 2));
  const recommandes = etapes.slice(1).map((e) => e.option.ids[0]);
  // Objet 2 : Ceinture-roquette (55,6 % sur 6 430 parties) devant Flamme-ombre (54,2 % sur 21 936) au score prudent
  assert.deepStrictEqual(recommandes, [2503, 3020, 3152, 4645, 3089, 3157]);
  assert.strictEqual(new Set(recommandes).size, recommandes.length);
  // Objet 3 : la Ceinture-roquette (recommandée en objet 2) n'est plus proposée
  assert.ok(![etapes[4].option, ...etapes[4].autres].some((o) => o.ids.includes(3152)));
  // Objet 5 : Zhonya, seulement 8 % des achats (achats variés en fin de partie) mais 663 parties :
  // assez de parties = fiable, pas d'avertissement « peu de données »
  assert.strictEqual(etapes[6].fiable, true);
  assert.deepStrictEqual(B.composerParEmplacement(null), []);
});

test("set par emplacement : 3 objets par bloc (recommandé d'abord), départ = une seule combinaison, pas de bloc en plus", () => {
  const etapes = B.composerParEmplacement(LOLA);
  const set = B.setObjets({ etapes, championId: 910, nomChampion: "Hwei", role: "middle", troisParBloc: true });
  assert.deepStrictEqual(set.blocks.map((b) => b.type.split(" ·")[0]), ["Départ", "Objet 1", "Bottes", "Objet 2", "Objet 3", "Objet 4", "Objet 5"]);
  assert.deepStrictEqual(set.blocks[0].items, [{ id: "1056", count: 1 }, { id: "2003", count: 2 }]);
  assert.deepStrictEqual(set.blocks[1].items.map((i) => i.id), ["2503", "6655", "6653"]);
  assert.deepStrictEqual(set.blocks[2].items.map((i) => i.id), ["3020", "3158", "3111"]);
});

test("assemblage : objets de Lolalytics si disponibles, sinon d'OP.GG ; runes et sorts d'OP.GG", () => {
  const lola = B.assemblerBuild({ opgg: ANALYSE, emplacements: LOLA });
  assert.strictEqual(lola.troisParBloc, true);
  assert.strictEqual(lola.resume.source, "Lolalytics");
  assert.deepStrictEqual(lola.resume.stats, LOLA.stats);
  assert.deepStrictEqual(lola.resume.runes.styles, ["Domination", "Sorcellerie"]); // runes d'OP.GG
  const opgg = B.assemblerBuild({ opgg: ANALYSE, emplacements: null });
  assert.strictEqual(opgg.troisParBloc, false);
  assert.strictEqual(opgg.resume.source, "OP.GG");
  const lolaSeul = B.assemblerBuild({ opgg: null, emplacements: LOLA });
  assert.strictEqual(lolaSeul.resume.runes, null);
  assert.deepStrictEqual(B.assemblerBuild({}), { etapes: [], troisParBloc: false, resume: null });
});

test("page de runes d'OP.GG : 9 runes dans l'ordre, sinon null", () => {
  assert.deepStrictEqual(B.pageDepuisOpgg(ANALYSE.runes), {
    name: "LoL Companion", primaryStyleId: 8100, subStyleId: 8200,
    selectedPerkIds: [8112, 8139, 8140, 8106, 8210, 8226, 5005, 5008, 5001], current: true,
  });
  assert.strictEqual(B.pageDepuisOpgg({ ...ANALYSE.runes, fragments: [] }), null);
  assert.strictEqual(B.pageDepuisOpgg(null), null);
});

test("set d'objets : format du client, potions regroupées, taux dans les titres", () => {
  const set = B.setObjets({ etapes: B.composerBuild(ANALYSE), championId: AHRI, nomChampion: "Ahri", role: "middle", carte: 11 });
  assert.strictEqual(set.title, "LoL Companion - Ahri (Milieu)");
  assert.deepStrictEqual(set.associatedChampions, [AHRI]);
  assert.deepStrictEqual(set.associatedMaps, [11]);
  assert.strictEqual(set.type, "custom");
  assert.match(set.uid, /^[0-9a-f-]{36}$/);
  assert.deepStrictEqual(set.blocks[0], {
    type: "Départ · 51 % V · 99 % choix",
    items: [{ id: "1056", count: 1 }, { id: "2003", count: 2 }],
    hideIfSummonerSpell: "",
    showIfSummonerSpell: "",
  });
  assert.strictEqual(set.blocks.length, 7); // 6 étapes + « Pour t'adapter »
  const adapter = set.blocks[6];
  assert.strictEqual(adapter.type, "Pour t'adapter (autres choix)");
  const dansLeBuild = new Set(set.blocks.slice(0, 6).flatMap((b) => b.items.map((i) => i.id)));
  assert.ok(adapter.items.length > 0 && adapter.items.every((i) => !dansLeBuild.has(i.id)), "seulement des objets hors du build");
  assert.strictEqual(B.setObjets({ etapes: [], championId: 1, nomChampion: "X", role: null }).title, "LoL Companion - X");
});

test("fusion des sets : tes sets intacts, seul notre set du même champion est remplacé", () => {
  const porofessor = { title: "Porofessor - LeBlanc (Mid)", associatedChampions: [7], uid: "a" };
  const notreAhri = { title: "LoL Companion - Ahri (Haut)", associatedChampions: [AHRI], uid: "b" };
  const notreLux = { title: "LoL Companion - Lux (Support)", associatedChampions: [99], uid: "c" };
  const monSetAhri = { title: "Mon set Ahri", associatedChampions: [AHRI], uid: "d" };
  const nouveau = { title: "LoL Companion - Ahri (Milieu)", associatedChampions: [AHRI], uid: "e" };
  assert.deepStrictEqual(B.fusionnerSets([porofessor, notreAhri, notreLux, monSetAhri], nouveau), [porofessor, notreLux, monSetAhri, nouveau]);
  assert.deepStrictEqual(B.fusionnerSets(undefined, nouveau), [nouveau]);
});

test("résumé pour l'appli : étapes avec taux, runes, sorts nommés", () => {
  const r = B.resumeBuild({ analyse: ANALYSE, etapes: B.composerBuild(ANALYSE) });
  assert.strictEqual(r.etapes[1].titre, "Objets principaux");
  assert.ok(Math.abs(r.etapes[1].tauxVictoire - 5071 / 9587) < 1e-9);
  assert.deepStrictEqual(r.runes.styles, ["Domination", "Sorcellerie"]);
  assert.deepStrictEqual(r.sorts.noms, ["Saut éclair", "Embrasement"]);
});

// --- Logique automatique --------------------------------------------------------------------

/** Session : je suis la cellule 2 (Milieu). verrouille : ma sélection est-elle verrouillée ? */
function session({ verrouille = true, gameId = 1, champion = AHRI } = {}) {
  return {
    gameId,
    localPlayerCellId: 2,
    myTeam: [{ cellId: 2, championId: champion, assignedPosition: "middle" }],
    actions: [[{ id: 7, actorCellId: 2, type: "pick", completed: verrouille, isInProgress: !verrouille }]],
  };
}

const RECO_RIOT = {
  primaryPerkStyleId: 8200, secondaryPerkStyleId: 8100,
  perks: [8992, 8226, 8210, 8237, 8139, 8106, 5005, 5008, 5001].map((id) => ({ id, name: `Riot ${id}` })),
};

function logique({ reglages = { stats: true, runes: true, objets: true }, analyse = ANALYSE, emplacements, echecs = {} } = {}) {
  const journal = { analyses: [], runes: [], sets: [], resultats: [] };
  const auto = B.creerBuildAuto({
    reglages: () => reglages,
    analyser: async (demande) => {
      journal.analyses.push(demande);
      if (echecs.stats) throw new O.ErreurOpgg(echecs.stats);
      return analyse;
    },
    analyserEmplacements:
      emplacements === undefined
        ? null
        : async () => {
          if (echecs.emplacements) throw new Error(echecs.emplacements);
          return emplacements;
        },
    runesRiot: async () => [RECO_RIOT],
    appliquerRunes: async (page) => {
      if (echecs.runes) throw new Error(echecs.runes);
      journal.runes.push(page);
    },
    appliquerObjets: async (set) => {
      if (echecs.objets) throw new Error(echecs.objets);
      journal.sets.push(set);
    },
    nomChampion: async () => "Ahri",
    carte: async () => 11,
    resultat: (info) => journal.resultats.push(info),
  });
  return { journal, auto };
}

test("champion verrouillé : stats OP.GG, runes OP.GG et set d'objets, une seule fois", async () => {
  const { journal, auto } = logique();
  auto.surSession(session({ verrouille: false })); // survol : rien
  auto.surSession(session());
  auto.surSession(session()); // le client renvoie la session à chaque changement
  await attendre(20);
  assert.deepStrictEqual(journal.analyses, [{ championId: AHRI, role: "middle" }]);
  assert.strictEqual(journal.runes[0].primaryStyleId, 8100); // runes d'OP.GG
  assert.strictEqual(journal.sets[0].title, "LoL Companion - Ahri (Milieu)");
  const [r] = journal.resultats;
  assert.strictEqual(r.runes.source, "OP.GG");
  assert.strictEqual(r.objets, true);
  assert.deepStrictEqual(r.erreurs, {});
  assert.strictEqual(r.build.etapes.length, 6);
});

test("avec Lolalytics : set à 3 choix par emplacement, runes d'OP.GG", async () => {
  const { journal, auto } = logique({ emplacements: LOLA });
  auto.surSession(session());
  await attendre(20);
  const [set] = journal.sets;
  assert.strictEqual(set.blocks[1].type.split(" ·")[0], "Objet 1");
  assert.strictEqual(set.blocks[1].items.length, 3);
  assert.strictEqual(journal.runes[0].primaryStyleId, 8100);
  const [r] = journal.resultats;
  assert.strictEqual(r.build.source, "Lolalytics");
  assert.deepStrictEqual(r.erreurs, {});
});

test("Lolalytics indisponible (site changé...) : objets d'OP.GG, et l'appli le dit", async () => {
  const { journal, auto } = logique({ emplacements: LOLA, echecs: { emplacements: "La page de Lolalytics a changé de format." } });
  auto.surSession(session());
  await attendre(20);
  const [r] = journal.resultats;
  assert.strictEqual(r.build.source, "OP.GG");
  assert.strictEqual(journal.sets[0].blocks.at(-1).type, "Pour t'adapter (autres choix)");
  assert.deepStrictEqual(r.erreurs, { emplacements: "La page de Lolalytics a changé de format." });
});

test("OP.GG indisponible : runes recommandées par Riot en secours, pas de set d'objets", async () => {
  const { journal, auto } = logique({ echecs: { stats: "OP.GG ne répond pas (pas d'Internet ?)." } });
  auto.surSession(session());
  await attendre(20);
  assert.strictEqual(journal.runes[0].primaryStyleId, 8200); // runes de Riot
  assert.deepStrictEqual(journal.sets, []);
  const [r] = journal.resultats;
  assert.strictEqual(r.runes.source, "Riot");
  assert.strictEqual(r.build, null);
  assert.deepStrictEqual(r.erreurs, { stats: "OP.GG ne répond pas (pas d'Internet ?)." });
});

test("runes seules (sans stats) : aucune connexion à OP.GG, runes de Riot", async () => {
  const { journal, auto } = logique({ reglages: { stats: false, runes: true, objets: true } });
  auto.surSession(session());
  await attendre(20);
  assert.deepStrictEqual(journal.analyses, []);
  assert.strictEqual(journal.runes.length, 1);
  assert.deepStrictEqual(journal.sets, []); // le set d'objets a besoin des stats
});

test("tout désactivé (par défaut) : rien du tout, aucune connexion", async () => {
  const { journal, auto } = logique({ reglages: B.normaliserReglagesBuild(undefined) });
  auto.surSession(session());
  await attendre(20);
  assert.deepStrictEqual(journal, { analyses: [], runes: [], sets: [], resultats: [] });
});

test("erreurs du client (runes, set) : signalées, le reste continue", async () => {
  const { journal, auto } = logique({ echecs: { runes: "plus de place", objets: "refusé" } });
  auto.surSession(session());
  await attendre(20);
  const [r] = journal.resultats;
  assert.strictEqual(r.runes, null);
  assert.strictEqual(r.objets, false);
  assert.deepStrictEqual(r.erreurs, { runes: "plus de place", objets: "refusé" });
  assert.ok(r.build); // le build reste affiché
});

test("nouvelle sélection ou relance de champion (ARAM) : refait", async () => {
  const { journal, auto } = logique();
  auto.surSession(session({ gameId: 1 }));
  await attendre(20);
  auto.surSession(session({ gameId: 1, champion: 99 }));
  await attendre(20);
  auto.surSession(null);
  auto.surSession(session({ gameId: 2, champion: 99 }));
  await attendre(20);
  assert.deepStrictEqual(journal.analyses.map((a) => a.championId), [AHRI, 99, 99]);
});

// --- Faux client HTTPS : set d'objets -------------------------------------------------------------

async function fauxClient({ sets, statusPut = 201 }) {
  const requetes = [];
  const serveur = https.createServer(certificat, (req, res) => {
    let corps = "";
    req.on("data", (m) => (corps += m));
    req.on("end", () => {
      requetes.push({ methode: req.method, url: req.url, corps: corps ? JSON.parse(corps) : null });
      const json = (d) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(d));
      };
      if (req.url === "/lol-summoner/v1/current-summoner") return json({ summonerId: 42 });
      if (req.method === "GET" && req.url === "/lol-item-sets/v1/item-sets/42/sets") return json({ accountId: 42, itemSets: sets, timestamp: 1 });
      res.writeHead(req.method === "PUT" ? statusPut : 404);
      res.end();
    });
  });
  await new Promise((ok) => serveur.listen(0, "127.0.0.1", ok));
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "faux-lol-"));
  fs.writeFileSync(path.join(dossier, "lockfile"), `LeagueClient:1:${serveur.address().port}:mdp:https`);
  return { dossier, requetes, fermer: () => new Promise((ok) => serveur.close(ok)) };
}

test("faux client : PUT de TOUS les sets, les tiens renvoyés exactement comme lus", async () => {
  const porofessor = { title: "Porofessor - LeBlanc (Mid)", associatedChampions: [7], blocks: [{ type: "x", items: [] }], uid: "a" };
  const client = await fauxClient({ sets: [porofessor] });
  try {
    const set = B.setObjets({ etapes: B.composerBuild(ANALYSE), championId: AHRI, nomChampion: "Ahri", role: "middle" });
    await B.appliquerSet(client.dossier, set);
    const put = client.requetes.find((r) => r.methode === "PUT");
    assert.strictEqual(put.url, "/lol-item-sets/v1/item-sets/42/sets");
    assert.strictEqual(put.corps.accountId, 42);
    assert.deepStrictEqual(put.corps.itemSets, [porofessor, set]);
  } finally {
    await client.fermer();
  }
});

test("faux client : set refusé -> erreur claire", async () => {
  const client = await fauxClient({ sets: [], statusPut: 400 });
  try {
    const set = B.setObjets({ etapes: B.composerBuild(ANALYSE), championId: AHRI, nomChampion: "Ahri", role: "middle" });
    await assert.rejects(B.appliquerSet(client.dossier, set), /refusé le set d'objets \(code 400\)/);
  } finally {
    await client.fermer();
  }
});
