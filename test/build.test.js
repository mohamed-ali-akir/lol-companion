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

test("réglages : désactivés par défaut, sauf le set d'objets et les augments (toujours) ; reprise de l'ancien réglage des runes", () => {
  assert.deepStrictEqual(B.normaliserReglagesBuild(undefined), { stats: false, runes: false, objets: true, rank1: false, augments: true, sorts: false, sortsPings: false, sortsAuto: false });
  assert.deepStrictEqual(B.normaliserReglagesBuild({ stats: "oui", runes: 1, objets: false, augments: false }), { stats: false, runes: false, objets: true, rank1: false, augments: true, sorts: false, sortsPings: false, sortsAuto: false }, "plus de case : toujours actifs");
  assert.deepStrictEqual(B.normaliserReglagesBuild(undefined, { actif: true }), { stats: false, runes: true, objets: true, rank1: false, augments: true, sorts: false, sortsPings: false, sortsAuto: false });
  assert.deepStrictEqual(B.normaliserReglagesBuild({ runes: false }, { actif: true }), { stats: false, runes: false, objets: true, rank1: false, augments: true, sorts: false, sortsPings: false, sortsAuto: false });
  // Ancienne config : les cases de l'alerte des objectifs (supprimée le 17/10/2026) sont simplement ignorées
  assert.ok(!("objectifs" in B.normaliserReglagesBuild({ objectifs: true, reapparitions: true })));
});

test("réglages : une seule case pour les chronos des sorts ET les pings du chat (17/10/2026)", () => {
  assert.deepStrictEqual([B.normaliserReglagesBuild({ sorts: true }).sorts, B.normaliserReglagesBuild({ sorts: true }).sortsPings], [true, true]);
  assert.strictEqual(B.normaliserReglagesBuild({ sorts: false, sortsPings: true }).sortsPings, false, "jamais les pings sans les chronos");
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

test("recommandé = l'option fiable la plus achetée ; les 2 autres choix au taux de victoire prudent", () => {
  // Kayle en ARAM (Lolalytics, 17/10/2026) : départ Dague + Jambières (33 %) et pas Bottes + Arc + Tome (19 %, 51,9 %)
  const depart = B.troisChoix([option([1042, 3006], 20562, 10425, 0.33), option([1001, 1043, 1052], 11675, 6059, 0.19), option([1042, 3006, 2003], 4403, 2281, 0.07)]);
  assert.deepStrictEqual(depart.map((o) => o.ids[0]), [1042, 1001, 1042]);
  // Objet 1 : Lame du roi déchu (40 %) devant Dent de Nashor (26 %, un peu meilleur taux)
  const objet1 = B.troisChoix([option([3153], 24599, 12668, 0.4), option([3115], 16113, 8363, 0.26), option([3124], 9133, 4576, 0.15)]);
  assert.deepStrictEqual(objet1.map((o) => o.ids[0]), [3153, 3115, 3124]);
  // Aucune option fiable (< 10 % des achats) : l'ancien ordre, au taux de victoire prudent
  const variees = B.troisChoix([option([1], 900, 450, 0.08), option([2], 700, 420, 0.06)]);
  assert.deepStrictEqual(variees.map((o) => o.ids[0]), [2, 1]);
  // Toutes les options de l'emplacement sont gardées (candidats), pour compléter le set d'une famille
  const etapes = B.composerParEmplacement(LOLA);
  assert.deepStrictEqual(etapes[1].candidats.map((o) => o.ids[0]), [2503, 6655, 3003, 6653]);
});

test("build par emplacement : Départ, Objet 1, Bottes, Objets 2 à 5, 3 choix chacun, pas de doublon recommandé", () => {
  const etapes = B.composerParEmplacement(LOLA);
  assert.deepStrictEqual(etapes.map((e) => e.titre), ["Départ", "Objet 1", "Bottes", "Objet 2", "Objet 3", "Objet 4", "Objet 5"]);
  assert.ok(etapes.every((e) => e.autres.length <= 2));
  const recommandes = etapes.slice(1).map((e) => e.option.ids[0]);
  // Objet 2 : Flamme-ombre, la plus achetée (21 936 parties), devant la Ceinture-roquette (meilleur taux sur 6 430) :
  // le recommandé suit le chemin de la majorité des joueurs, comme le build affiché par Lolalytics (17/10/2026)
  assert.deepStrictEqual(recommandes, [2503, 3020, 4645, 3089, 3157, 3135]);
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
  // Le set principal (setsObjets) porte « · Recommandé » à la fin (17/10/2026)
  assert.strictEqual(B.setObjets({ etapes: B.composerBuild(ANALYSE), championId: AHRI, nomChampion: "Ahri", role: "middle", recommande: true }).title, "LoL Companion - Ahri (Milieu) · Recommandé");
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

test("sets : seuls ceux du champion actuel sont écrits ; les tiens sont reconnus (pour être sauvegardés), les nôtres non", () => {
  const porofessor = { title: "Porofessor - LeBlanc (Mid)", associatedChampions: [7], uid: "a" };
  const notreAhri = { title: "LoL Companion - Ahri (Haut)", associatedChampions: [AHRI], uid: "b" };
  const notreLux = { title: "LoL Companion - Lux (Support)", associatedChampions: [99], uid: "c" };
  const monSetAhri = { title: "Mon set Ahri", associatedChampions: [AHRI], uid: "d" };
  const monSetLoL = { title: "LoL Companion perso", associatedChampions: [], uid: "f" }; // pas notre préfixe exact
  const nouveau = { title: "LoL Companion - Ahri (Milieu)", associatedChampions: [AHRI], uid: "e" };
  assert.deepStrictEqual(B.fusionnerSets(nouveau), [{ ...nouveau, sortrank: 0 }]);
  assert.deepStrictEqual(B.autresSets([porofessor, notreAhri, notreLux, monSetAhri, monSetLoL, null, "abîmé"]), [porofessor, monSetAhri, monSetLoL]);
  assert.deepStrictEqual(B.autresSets(undefined), []);
  assert.deepStrictEqual(B.fusionnerSets([nouveau, null]), [{ ...nouveau, sortrank: 0 }]);
});

test("sets : 40 anciens sets LoL Companion -> il n'en reste qu'un (évite le refus 413 du client), et ils ne sont pas sauvegardés", () => {
  const anciens = Array.from({ length: 40 }, (_, i) => ({ title: `LoL Companion - Champion ${i}`, associatedChampions: [i + 1], uid: `x${i}` }));
  const porofessor = Array.from({ length: 6 }, (_, i) => ({ title: `Porofessor - LeBlanc ${i}`, associatedChampions: [7], uid: `p${i}` }));
  const nouveau = { title: "LoL Companion - Cassiopeia (Milieu)", associatedChampions: [69], uid: "n" };
  assert.deepStrictEqual(B.fusionnerSets(nouveau).map((s) => s.uid), ["n"]);
  assert.deepStrictEqual(B.autresSets([...porofessor, ...anciens]), porofessor);
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
function session({ verrouille = true, gameId = 1, champion = AHRI, sorts = [4, 12] } = {}) {
  return {
    gameId,
    localPlayerCellId: 2,
    myTeam: [{ cellId: 2, championId: champion, assignedPosition: "middle", spell1Id: sorts[0], spell2Id: sorts[1] }],
    actions: [[{ id: 7, actorCellId: 2, type: "pick", completed: verrouille, isInProgress: !verrouille }]],
  };
}

const RECO_RIOT = {
  primaryPerkStyleId: 8200, secondaryPerkStyleId: 8100,
  perks: [8992, 8226, 8210, 8237, 8139, 8106, 5005, 5008, 5001].map((id) => ({ id, name: `Riot ${id}` })),
};

function logique({ reglages = { stats: true, runes: true, objets: true }, analyse = ANALYSE, emplacements, echecs = {}, rank1 } = {}) {
  const journal = { analyses: [], runes: [], nomsPages: [], sets: [], sorts: [], resultats: [], rank1: [] };
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
    analyserRank1:
      rank1 === undefined
        ? null
        : async (demande) => {
          journal.rank1.push(demande);
          if (rank1 instanceof Error) throw rank1;
          return rank1;
        },
    runesRiot: async () => [RECO_RIOT],
    appliquerRunes: async (page, noms) => {
      if (echecs.runes) throw new Error(echecs.runes);
      journal.runes.push(page);
      journal.nomsPages.push(noms);
      return noms ? noms[0] : undefined;
    },
    appliquerSorts: async (ids) => {
      if (echecs.sorts) throw new Error(echecs.sorts);
      journal.sorts.push(ids);
    },
    appliquerObjets: async (sets) => {
      if (echecs.objets) throw new Error(echecs.objets);
      journal.sets.push(...sets); // un set, ou un par famille de build
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
  assert.strictEqual(journal.sets[0].title, "LoL Companion - Ahri (Milieu) · Recommandé");
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
  assert.deepStrictEqual(journal, { analyses: [], runes: [], nomsPages: [], sets: [], sorts: [], resultats: [], rank1: [] });
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

test("faux client : tes sets sauvegardés exactement comme lus, puis SEULS les nôtres écrits dans le client", async () => {
  const porofessor = { title: "Porofessor - LeBlanc (Mid)", associatedChampions: [7], blocks: [{ type: "x", items: [] }], uid: "a" };
  const ancien = { title: "LoL Companion - Lux (Support)", uid: "1c0a9a10-0000-4000-8000-000000000099" };
  const client = await fauxClient({ sets: [porofessor, ancien] });
  try {
    const set = B.setObjets({ etapes: B.composerBuild(ANALYSE), championId: AHRI, nomChampion: "Ahri", role: "middle" });
    const sauvegardes = [];
    await B.appliquerSet(client.dossier, set, { sauvegarder: (compte, sets) => sauvegardes.push([compte, sets]) });
    assert.deepStrictEqual(sauvegardes, [["42", [porofessor]]], "sauvegardés pour CE compte, sans nos anciens sets");
    const put = client.requetes.find((r) => r.methode === "PUT");
    assert.strictEqual(put.url, "/lol-item-sets/v1/item-sets/42/sets");
    assert.strictEqual(put.corps.accountId, 42);
    assert.deepStrictEqual(put.corps.itemSets, [{ ...set, sortrank: 0 }]);
  } finally {
    await client.fermer();
  }
});

test("faux client : sauvegarde impossible -> rien n'est retiré du client (pas d'écriture)", async () => {
  const client = await fauxClient({ sets: [{ title: "Mon set", uid: "m" }] });
  try {
    const set = B.setObjets({ etapes: B.composerBuild(ANALYSE), championId: AHRI, nomChampion: "Ahri", role: "middle" });
    const sauvegarder = () => {
      throw new Error("disque plein");
    };
    await assert.rejects(B.appliquerSet(client.dossier, set, { sauvegarder }), /disque plein/);
    assert.ok(!client.requetes.some((r) => r.methode === "PUT"));
  } finally {
    await client.fermer();
  }
});

test("faux client : « Remettre mes anciens sets » renvoie les sets absents, les nôtres restent en dernier", async () => {
  const notre = { title: "LoL Companion - Ahri (Milieu)", uid: "1c0a9a10-0000-4000-8000-000000000103", sortrank: 0 };
  const nouveauDuJoueur = { title: "Créé depuis", uid: "n" };
  const client = await fauxClient({ sets: [nouveauDuJoueur, notre] });
  try {
    const sauves = [{ title: "Porofessor", uid: "p" }, { title: "Créé depuis", uid: "n" }, { title: "LoL Companion - Lux", uid: "x" }];
    assert.strictEqual(await B.remettreSets(client.dossier, async (compte) => (compte === "42" ? sauves : [])), 1);
    const put = client.requetes.find((r) => r.methode === "PUT");
    assert.deepStrictEqual(put.corps.itemSets.map((s) => s.uid), ["n", "p", notre.uid]);
  } finally {
    await client.fermer();
  }
  const rien = await fauxClient({ sets: [{ title: "Porofessor", uid: "p" }] });
  try {
    assert.strictEqual(await B.remettreSets(rien.dossier, () => [{ title: "Porofessor", uid: "p" }]), 0);
    assert.ok(!rien.requetes.some((r) => r.methode === "PUT"), "rien à remettre : pas d'écriture");
  } finally {
    await rien.fermer();
  }
  const plein = await fauxClient({ sets: [], statusPut: 413 });
  try {
    await assert.rejects(B.remettreSets(plein.dossier, () => [{ title: "Porofessor", uid: "p" }]), /Trop de sets/);
  } finally {
    await plein.fermer();
  }
});

test("remise des sets : sets sans identifiant comparés par titre, entrées abîmées ignorées", () => {
  const { sets, remis } = B.remettreDansListe([null, { title: "A" }], [{ title: "A" }, { title: "B" }, null, 3]);
  assert.deepStrictEqual([sets.map((s) => s.title), remis], [["A", "B"], 1]);
  assert.deepStrictEqual(B.remettreDansListe(undefined, undefined), { sets: [], remis: 0 });
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

// --- Nom de la page et sorts d'invocateur (10/10/2026) -------------------------------------------

test("page de runes nommée d'après le champion et le poste : « Ahri · Mid · LoL Companion »", async () => {
  const { journal, auto } = logique();
  auto.surSession(session());
  await attendre(20);
  assert.deepStrictEqual(journal.nomsPages[0], ["Ahri · Mid · LoL Companion", "Ahri · Mid · LoLC", "LoL Companion"]);
  assert.strictEqual(journal.resultats[0].runes.nomPage, "Ahri · Mid · LoL Companion");
});

test("ordre des sorts : chaque sort garde ta touche (Flash sur D ou F), le reste dans l'ordre d'OP.GG", () => {
  assert.deepStrictEqual(B.ordreSorts([4, 14], [12, 4]), [14, 4]); // Flash était sur F : il y reste
  assert.deepStrictEqual(B.ordreSorts([4, 14], [4, 12]), [4, 14]);
  assert.deepStrictEqual(B.ordreSorts([4, 14], [14, 4]), [14, 4]); // déjà les bons : rien ne bouge
  assert.deepStrictEqual(B.ordreSorts([4, 14], [7, 21]), [4, 14]); // aucun en commun : ordre d'OP.GG
  assert.deepStrictEqual(B.ordreSorts([4, 14], undefined), [4, 14]);
  assert.strictEqual(B.ordreSorts([4], [4, 12]), null);
  assert.strictEqual(B.ordreSorts([4, 4], [4, 12]), null);
  assert.strictEqual(B.ordreSorts(null, [4, 12]), null);
});

test("sorts d'invocateur : les plus joués d'OP.GG, Flash gardé sur sa touche ; seulement si la case est cochée", async () => {
  const avec = logique({ reglages: { stats: true, runes: false, objets: false, sortsAuto: true } });
  avec.auto.surSession(session({ sorts: [12, 4] })); // Téléportation sur D, Flash sur F
  await attendre(20);
  assert.deepStrictEqual(avec.journal.sorts, [[14, 4]]); // Embrasement sur D, Flash reste sur F
  assert.deepStrictEqual(avec.journal.resultats[0].sortsChoisis, ["Embrasement", "Saut éclair"]);

  const sans = logique({ reglages: { stats: true, runes: false, objets: false } });
  sans.auto.surSession(session());
  await attendre(20);
  assert.deepStrictEqual(sans.journal.sorts, []);
  assert.strictEqual(sans.journal.resultats[0].sortsChoisis, null);
});

test("sorts d'invocateur : OP.GG sans sorts ou client qui refuse -> erreur signalée, le reste continue", async () => {
  const vide = logique({ reglages: { stats: true, runes: true, objets: false, sortsAuto: true }, analyse: { ...ANALYSE, sorts: null } });
  vide.auto.surSession(session());
  await attendre(20);
  assert.match(vide.journal.resultats[0].erreurs.sortsAuto, /Pas de sorts/);
  assert.strictEqual(vide.journal.runes.length, 1);

  const refus = logique({ reglages: { stats: true, runes: false, objets: false, sortsAuto: true }, echecs: { sorts: "code 500" } });
  refus.auto.surSession(session());
  await attendre(20);
  assert.strictEqual(refus.journal.resultats[0].erreurs.sortsAuto, "code 500");
});

// --- Plusieurs sets : un par famille de build (familles.js) ---------------------------------------

// Deux familles fictives pour Ahri : ses Objets 1 à 3 propres ; le reste vient du build général (LOLA).
const choixFamille = (id, parties, selection) => ({ ids: [id], parties, selection, noms: [`Objet ${id}`] });
const FAMILLES = [
  { nom: "AP", part: 0.7, parties: 7000, emplacements: [[choixFamille(6655, 5000, 0.7)], [choixFamille(4645, 4000, 0.6), choixFamille(6655, 900, 0.2)], []] },
  { nom: "Tank", part: 0.3, parties: 3000, emplacements: [[choixFamille(3068, 2000, 0.8)], [choixFamille(3075, 1500, 0.6)], [choixFamille(3157, 700, 0.4)]] },
];

test("set d'une famille : Objets 1 à 3 propres (sinon ceux du build général), jamais un objet en double", () => {
  const etapes = B.composerParEmplacement(LOLA);
  const ap = B.etapesFamille(etapes, FAMILLES[0]);
  assert.deepStrictEqual(ap.map((e) => e.cle), etapes.map((e) => e.cle));
  const objet = (liste, cle) => liste.find((e) => e.cle === cle);
  assert.deepStrictEqual(objet(ap, "objet1").option.ids, [6655]);
  assert.deepStrictEqual(objet(ap, "objet2").option.ids, [4645]);
  assert.deepStrictEqual(objet(ap, "objet2").autres, [], "6655 déjà pris en Objet 1 : pas reproposé");
  // Objet 3 : rien de propre à la famille -> choix du build général, sans 4645 (déjà pris)
  assert.ok(!objet(ap, "objet3").option.ids.includes(4645));
  assert.deepStrictEqual(objet(ap, "depart").option, objet(etapes, "depart").option);
  assert.deepStrictEqual(objet(ap, "bottes").option, objet(etapes, "bottes").option);
});

test("set d'une famille : emplacement sans choix propre complété avec TOUTES les options, du style de la famille d'abord", () => {
  // Kayle AP en ARAM (17/10/2026) : l'objet 3 du build général (Fin de l'esprit, Terminus...) est à l'impact, exclu du
  // set AP ; avant, l'objet 3 disparaissait du set. Maintenant : la Coiffe de Rabadon (AP), même moins achetée.
  const fin = { ...option([3091], 12638, 6964, 0.26), style: "À l'impact" };
  const terminus = { ...option([3302], 8422, 4784, 0.17), style: "À l'impact" };
  const rabadon = { ...option([3089], 2598, 1582, 0.05), style: "AP" };
  const rare = { ...option([3100], 90, 60, 0.002), style: "AP" }; // moins de 200 parties : jamais proposé
  const etapes = [{ cle: "objet3", titre: "Objet 3", option: fin, autres: [terminus], fiable: true, note: null, candidats: [fin, terminus, rabadon, rare] }];
  const famille = { nom: "AP", emplacements: [[], [], []], exclus: [3091, 3302] };
  const [objet3] = B.etapesFamille(etapes, famille);
  assert.deepStrictEqual(objet3.option.ids, [3089]);
  assert.deepStrictEqual(objet3.autres, []);
  // Sans liste complète (ancien format), on garde les choix du build général
  assert.deepStrictEqual(B.etapesFamille([{ ...etapes[0], candidats: undefined }], { ...famille, exclus: [] })[0].option.ids, [3091]);
});

test("plusieurs sets : un par famille, titres et identifiants différents ; sans famille, un seul set comme avant", () => {
  const etapes = B.composerParEmplacement(LOLA);
  const commun = { etapes, championId: AHRI, nomChampion: "Ahri", role: "middle", carte: 11, troisParBloc: true };
  const sets = B.setsObjets({ ...commun, familles: FAMILLES });
  assert.deepStrictEqual(sets.map((s) => s.title), ["LoL Companion - Ahri (Milieu) · AP · Recommandé", "LoL Companion - Ahri (Milieu) · Tank"]);
  assert.strictEqual(new Set(sets.map((s) => s.uid)).size, 2);
  assert.match(sets[1].uid, /^[0-9a-f-]{36}$/);
  assert.strictEqual(sets[0].uid, B.setObjets(commun).uid, "le 1er set garde l'identifiant habituel");
  // Objets propres à la famille : pas de taux de victoire (inconnu), seulement la part des achats
  assert.strictEqual(sets[1].blocks.find((b) => b.type.startsWith("Objet 1")).type, "Objet 1 · 80 % choix");
  assert.deepStrictEqual(B.setsObjets({ ...commun, familles: [] }).map((s) => s.title), ["LoL Companion - Ahri (Milieu) · Recommandé"]);
  assert.deepStrictEqual(B.setsObjets({ ...commun, familles: [FAMILLES[0]] }).length, 1, "une seule famille : rien à séparer");
  assert.strictEqual(B.setsObjets({ ...commun, troisParBloc: false, familles: FAMILLES }).length, 1, "build d'OP.GG : un seul set");
});

test("sets : tous les sets du champion sont écrits (un par façon de jouer)", () => {
  const nouveaux = [{ title: "LoL Companion - Kayn (Jungle) · Bleu", uid: "x" }, { title: "LoL Companion - Kayn (Jungle) · Rouge", uid: "y" }];
  assert.deepStrictEqual(B.fusionnerSets(nouveaux), [
    { ...nouveaux[1], sortrank: 1 },
    { ...nouveaux[0], sortrank: 0 },
  ]);
});

test("fusion : le 1er set (famille la plus jouée) sélectionné d'office : DERNIER de la liste ET plus petit sortrank", () => {
  // Vu en jeu le 17/10/2026 : Tank 10188 / AP 10187 / Rank 1 10186 -> la boutique a pris « Rank 1 » (le dernier, le plus petit).
  const nouveaux = [{ title: "LoL Companion - Cho'Gath · Tank", uid: "a" }, { title: "LoL Companion - Cho'Gath · AP", uid: "b" }, { title: "Cho'Gath Rank 1", uid: "r" }];
  const fusion = B.fusionnerSets(nouveaux);
  assert.deepStrictEqual(fusion.map((s) => s.uid), ["r", "b", "a"]);
  assert.deepStrictEqual(fusion.map((s) => s.sortrank), [2, 1, 0]);
  assert.strictEqual(fusion.at(-1).uid, "a", "le set principal tout à la fin");
  assert.strictEqual(nouveaux[0].sortrank, undefined, "les sets reçus ne sont pas modifiés");
});

test("champion à plusieurs builds verrouillé : un set par famille, et la page connaît les sets créés", async () => {
  const { journal, auto } = logique({ emplacements: { ...LOLA, familles: FAMILLES } });
  auto.surSession(session());
  await attendre(20);
  assert.deepStrictEqual(journal.sets.map((s) => s.title), ["LoL Companion - Ahri (Milieu) · AP · Recommandé", "LoL Companion - Ahri (Milieu) · Tank"]);
  const [r] = journal.resultats;
  assert.strictEqual(r.objets, true);
  assert.deepStrictEqual(r.setsCrees, journal.sets.map((s) => s.title));
  assert.deepStrictEqual(r.build.familles.map((f) => f.nom), ["AP", "Tank"]);
  assert.deepStrictEqual(r.build.familles[1].objets, ["Objet 3068", "Objet 3075", "Objet 3157"]);
});

test("set d'une famille : les objets exclus (autre famille) ne sont pas proposés aux objets 4 et 5", () => {
  const etapes = B.composerParEmplacement(LOLA);
  const avant = B.etapesFamille(etapes, FAMILLES[0]).find((e) => e.cle === "objet4");
  const exclu = avant.option.ids[0];
  const apres = B.etapesFamille(etapes, { ...FAMILLES[0], exclus: [exclu] }).find((e) => e.cle === "objet4");
  assert.ok(!apres || ![apres.option, ...apres.autres].some((o) => o.ids.includes(exclu)));
});

// --- Set « Champion Rank 1 » : build des meilleurs joueurs (Lolalytics « 1trick »), 17/10/2026 ---------------

const RANK1 = { emplacements: LOLA, libelle: "Meilleurs joueurs", parties: 2774 };
const AVEC_RANK1 = { stats: true, runes: false, objets: true, rank1: true };

test("réglage rank1 : sa propre case, désactivée par défaut", () => {
  assert.strictEqual(B.normaliserReglagesBuild({}).rank1, false);
  assert.strictEqual(B.normaliserReglagesBuild({ rank1: true }).rank1, true);
});

test("set Rank 1 : comme le build classique (Départ, Objet 1, Bottes, Objets 2 à 5), APRÈS le set principal", async () => {
  const { journal, auto } = logique({ reglages: AVEC_RANK1, rank1: RANK1 });
  auto.surSession(session());
  await attendre(20);
  assert.deepStrictEqual(journal.rank1, [{ championId: AHRI, role: "middle" }]);
  assert.deepStrictEqual(journal.sets.map((s) => s.title), ["LoL Companion - Ahri (Milieu) · Recommandé", "Ahri Rank 1"]);
  const [principal, rank1] = journal.sets;
  assert.deepStrictEqual(rank1.blocks.map((b) => b.type.split(" ·")[0]), ["Départ", "Objet 1", "Bottes", "Objet 2", "Objet 3", "Objet 4", "Objet 5"]);
  assert.deepStrictEqual(rank1.blocks[1].items.map((i) => i.id), ["2503", "6655", "6653"], "3 choix, le plus acheté d'abord");
  assert.match(rank1.blocks[1].type, /% V · \d+ % choix/, "taux de victoire et part des achats, comme le build classique");
  assert.ok(rank1.uid.startsWith("1c0a9a10-0000-4000-9000-"), "identifiant du set Rank 1 (remplacé à chaque fois)");
  assert.notStrictEqual(rank1.uid, principal.uid);
  const [r] = journal.resultats;
  assert.deepStrictEqual(r.rank1, { titre: "Ahri Rank 1", rang: "Meilleurs joueurs", parties: 2774 });
  assert.deepStrictEqual(r.setsCrees, ["LoL Companion - Ahri (Milieu) · Recommandé"], "le set Rank 1 est compté à part");
  assert.deepStrictEqual(r.erreurs, {});
});

test("set Rank 1 : case décochée -> aucune demande ; Lolalytics en échec -> erreur signalée, set principal créé quand même", async () => {
  const sans = logique({ reglages: { stats: true, runes: false, objets: true }, rank1: RANK1 });
  sans.auto.surSession(session());
  await attendre(20);
  assert.deepStrictEqual(sans.journal.rank1, []);
  assert.deepStrictEqual(sans.journal.sets.map((s) => s.title), ["LoL Companion - Ahri (Milieu) · Recommandé"]);

  const echec = logique({ reglages: AVEC_RANK1, rank1: new Error("Pas de classement des meilleurs joueurs pour ce champion.") });
  echec.auto.surSession(session());
  await attendre(20);
  assert.deepStrictEqual(echec.journal.sets.map((s) => s.title), ["LoL Companion - Ahri (Milieu) · Recommandé"]);
  assert.match(echec.journal.resultats[0].erreurs.rank1, /Pas de classement/);
  assert.strictEqual(echec.journal.resultats[0].rank1, null);

  const vide = { ...LOLA, depart: [], bottes: [], emplacements: [[], [], [], [], []] };
  const peu = logique({ reglages: AVEC_RANK1, rank1: { ...RANK1, emplacements: vide } });
  peu.auto.surSession(session());
  await attendre(20);
  assert.match(peu.journal.resultats[0].erreurs.rank1, /Pas assez de parties/);
});

test("sets : l'ancien set Rank 1 (sans le préfixe « LoL Companion ») est reconnu comme le nôtre, pas comme le tien", () => {
  const ancienRank1 = { title: "Lux Rank 1", uid: "1c0a9a10-0000-4000-9000-000000000099" };
  const monSet = { title: "Ahri Rank 1 (le mien)", uid: "a1b2c3" };
  const nouveaux = [{ title: "LoL Companion - Ahri (Milieu)", uid: "1c0a9a10-0000-4000-8000-000000001033" }, { title: "Ahri Rank 1", uid: "1c0a9a10-0000-4000-9000-000000000103" }];
  assert.deepStrictEqual(B.autresSets([ancienRank1, monSet]), [monSet], "seul ton set est sauvegardé");
  assert.deepStrictEqual(B.fusionnerSets(nouveaux).map((s) => s.title), ["Ahri Rank 1", "LoL Companion - Ahri (Milieu)"]);
});

test("Arena : étape « Objet prismatique » juste après le départ, avec ses 3 choix", () => {
  const option = (id, parties, victoires) => ({ ids: [id], parties, victoires, selection: 0.3, minute: null, noms: [`Objet ${id}`] });
  const arena = {
    depart: [option(223020, 9000, 5400)],
    prismatique: [option(447108, 4478, 2739), option(447113, 4105, 2705), option(444636, 3476, 2294), option(446656, 3274, 2084)],
    bottes: [],
    emplacements: [[option(223089, 3198, 1953)], [option(220004, 3001, 1880)], [], [], []],
  };
  const etapes = B.composerParEmplacement(arena);
  assert.deepStrictEqual(etapes.map((e) => e.titre), ["Départ", "Objet prismatique", "Objet 1", "Objet 2"]);
  assert.strictEqual(etapes[1].option.ids[0], 447108, "le plus pris d'abord");
  assert.strictEqual(etapes[1].autres.length, 2);
  assert.ok(!B.composerParEmplacement(LOLA).some((e) => e.cle === "prismatique"), "pas d'étape prismatique hors Arena");
});
