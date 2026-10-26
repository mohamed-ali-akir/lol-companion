// Build adapté à l'équipe adverse (adversaires.js, 26/10/2026) : profils des ennemis lus dans le client, bottes et
// objets anti-tank, toujours parmi les objets vraiment achetés sur le champion, et remise à jour en sélection.
const test = require("node:test");
const assert = require("node:assert");
const A = require("../adversaires.js");
const B = require("../build.js");

const attendre = (ms) => new Promise((ok) => setTimeout(ok, ms));
const option = (ids, parties, victoires, selection) => ({ ids, noms: ids.map((id) => `Objet ${id}`), parties, victoires, selection });

// Lolalytics, Hwei milieu (02/10/2026, raccourci, comme test/build.test.js) : Bâton du vide (3135) seulement en objet 5,
// Sandales de Mercure (3111) en 3e choix des bottes.
const HWEI = {
  stats: { parties: 65113, tauxVictoire: 0.517 },
  depart: [option([1056, 2003, 2003], 63197, 33311, 0.98)],
  bottes: [option([3020], 38026, 20416, 0.62), option([3158], 18195, 9560, 0.3), option([3111], 4645, 2364, 0.08)],
  emplacements: [
    [option([2503], 54627, 28947, 0.86), option([6655], 8105, 4187, 0.13)],
    [option([4645], 21936, 11885, 0.4), option([3152], 6430, 3574, 0.12)],
    [option([3089], 8646, 4929, 0.23), option([3157], 5856, 3300, 0.16), option([3135], 150, 80, 0.01)],
    [option([3157], 3442, 1917, 0.19), option([3089], 3000, 1700, 0.2), option([3041], 978, 693, 0.05)],
    [option([3041], 663, 372, 0.08), option([3135], 414, 221, 0.05), option([4646], 36, 23, 0.01)],
  ],
};

// Fiches du client (/lol-game-data/assets/v1/champions/<id>.json), vues le 26/10/2026
const fiche = (id, name, durability, crowdControl, damageType) => ({ id, name, playstyleInfo: { durability, crowdControl }, tacticalInfo: { damageType } });
const FICHES = {
  54: fiche(54, "Malphite", 3, 3, "kMagic"),
  516: fiche(516, "Ornn", 3, 3, "kMagic"),
  14: fiche(14, "Sion", 3, 3, "kPhysical"),
  103: fiche(103, "Ahri", 1, 2, "kMagic"),
  238: fiche(238, "Zed", 1, 1, "kPhysical"),
  22: fiche(22, "Ashe", 1, 2, "kPhysical"),
  157: fiche(157, "Yasuo", 1, 2, "kPhysical"),
  7: fiche(7, "LeBlanc", 1, 2, "kMagic"),
};
const equipe = (...ids) => A.profilEquipe(ids.map((id) => A.profilChampion(FICHES[id])));

test("profil d'un champion : résistance, contrôles, type de dégâts ; fiche abîmée ignorée", () => {
  assert.deepStrictEqual(A.profilChampion(FICHES[54]), { id: 54, nom: "Malphite", resistance: 3, controle: 3, degats: "magiques" });
  assert.deepStrictEqual(A.profilChampion({ id: 1, name: "Annie", playstyleInfo: { durability: 9 }, tacticalInfo: { damageType: "kMixed" } }), {
    id: 1, nom: "Annie", resistance: null, controle: null, degats: "mixtes",
  });
  assert.strictEqual(A.profilChampion(null), null);
  assert.strictEqual(A.profilChampion({ id: 0 }), null);
  assert.deepStrictEqual(equipe(54, 516, 238), { nombre: 3, tanks: ["Malphite", "Ornn"], controles: ["Malphite", "Ornn"], physiques: ["Zed"], magiques: ["Malphite", "Ornn"] });
});

test("moins de 3 ennemis connus : rien ne change", () => {
  const etapes = B.composerParEmplacement(HWEI);
  assert.deepStrictEqual(A.adapterEtapes(etapes, equipe(54, 516)), { etapes, raisons: [] });
  assert.deepStrictEqual(A.adapterEtapes(etapes, null), { etapes, raisons: [] });
});

test("3 magiques : Sandales de Mercure ; 2 tanks : Bâton du vide remonte (acheté sur assez de parties)", () => {
  const etapes = B.composerParEmplacement(HWEI);
  const { etapes: adaptees, raisons } = A.adapterEtapes(etapes, equipe(54, 516, 103, 238));
  const bottes = adaptees.find((e) => e.cle === "bottes");
  assert.deepStrictEqual(bottes.option.ids, [3111]);
  assert.deepStrictEqual(bottes.autres.map((o) => o.ids[0]), [3020, 3158], "l'ancien choix reste proposé en premier");
  assert.strictEqual(bottes.adaptation, "contre 3 magiques");
  assert.match(bottes.note, /3 ennemis à dégâts magiques \(Malphite, Ornn, Ahri\), au lieu de Objet 3020/);
  // Objet 3 : le Bâton du vide n'y a que 150 parties (pas assez) ; objet 4 : absent ; objet 5 : 414 parties -> oui
  const parCle = Object.fromEntries(adaptees.map((e) => [e.cle, e]));
  assert.deepStrictEqual(parCle.objet3.option.ids, [3089]);
  assert.deepStrictEqual(parCle.objet5.option.ids, [3135]);
  assert.strictEqual(parCle.objet5.adaptation, "contre 2 tanks");
  assert.deepStrictEqual(raisons, [
    "Bottes : Objet 3111, contre 3 ennemis à dégâts magiques (Malphite, Ornn, Ahri)",
    "Objet 5 : Objet 3135, contre 2 tanks en face (Malphite, Ornn)",
  ]);
  assert.deepStrictEqual(etapes.find((e) => e.cle === "bottes").option.ids, [3020], "le build d'origine n'est pas modifié");
});

test("3 physiques : Coques en acier seulement si le champion en achète ; un anti-tank déjà dans le build suffit", () => {
  const avecCoques = { ...HWEI, bottes: [...HWEI.bottes, option([3047], 900, 470, 0.02)] };
  const r = A.adapterEtapes(B.composerParEmplacement(avecCoques), equipe(238, 22, 157));
  assert.deepStrictEqual(r.etapes.find((e) => e.cle === "bottes").option.ids, [3047]);
  assert.deepStrictEqual(A.adapterEtapes(B.composerParEmplacement(HWEI), equipe(238, 22, 157)).raisons, [], "pas de Coques achetées : rien");
  // Bâton du vide déjà en objet 5 : 2 tanks en face ne changent rien
  const dejaAntiTank = { ...HWEI, emplacements: [...HWEI.emplacements.slice(0, 4), [option([3135], 5000, 2600, 0.3)]] };
  assert.deepStrictEqual(A.adapterEtapes(B.composerParEmplacement(dejaAntiTank), equipe(54, 14, 238, 22)).raisons.filter((x) => /tanks/.test(x)), []);
});

test("set de la boutique : la raison est dans le titre du bloc", () => {
  const { etapes } = A.adapterEtapes(B.composerParEmplacement(HWEI), equipe(54, 516, 103));
  const [set] = B.setsObjets({ etapes, championId: 910, nomChampion: "Hwei", role: "middle", troisParBloc: true });
  assert.ok(set.blocks.some((b) => b.type.startsWith("Bottes (contre 3 magiques) · ")));
  assert.ok(set.blocks.some((b) => b.type.startsWith("Objet 5 (contre 2 tanks) · ")));
});

test("lecteur de profils : une fiche lue une seule fois, fiche illisible absente", async () => {
  const lues = [];
  const { creerLecteurProfils } = require("../champions.js");
  const profils = creerLecteurProfils(async (id) => {
    lues.push(id);
    if (id === 999) throw new Error("client fermé");
    return FICHES[id] || null;
  });
  assert.deepStrictEqual((await profils([54, 999, 238])).map((p) => p.nom), ["Malphite", "Zed"]);
  assert.deepStrictEqual((await profils([54])).map((p) => p.nom), ["Malphite"]);
  assert.deepStrictEqual(lues, [54, 999, 238]);
});

// --- En sélection : le set suit les ennemis verrouillés ----------------------------------------------

/** Session : je suis Hwei (cellule 2, verrouillé) ; ennemis : cellules 5 à 9, verrouillés dans cet ordre. */
function session(ennemis) {
  const leurs = ennemis.map((id, i) => ({ cellId: 5 + i, championId: id }));
  return {
    gameId: 1,
    localPlayerCellId: 2,
    myTeam: [{ cellId: 2, championId: 910, assignedPosition: "middle", spell1Id: 4, spell2Id: 14 }],
    theirTeam: leurs,
    actions: [[
      { id: 1, actorCellId: 2, type: "pick", completed: true, championId: 910 },
      ...leurs.map((j, i) => ({ id: 10 + i, actorCellId: j.cellId, type: "pick", completed: true, championId: j.championId })),
    ]],
  };
}

function logique() {
  const journal = { sets: [], resultats: [], analyses: 0, runes: 0 };
  const auto = B.creerBuildAuto({
    reglages: () => ({ stats: true, runes: true, objets: true }),
    analyser: async () => {
      journal.analyses++;
      return null;
    },
    analyserEmplacements: async () => HWEI,
    runesRiot: async () => [],
    appliquerRunes: async () => {
      journal.runes++;
    },
    appliquerObjets: async (sets) => journal.sets.push(sets),
    nomChampion: async () => "Hwei",
    carte: async () => 11,
    profilsChampions: async (ids) => ids.map((id) => A.profilChampion(FICHES[id])).filter(Boolean),
    resultat: (info) => journal.resultats.push(info),
  });
  return { journal, auto };
}

test("sélection : set créé tout de suite, puis refait seulement quand l'adaptation change", async () => {
  const { journal, auto } = logique();
  await auto.surSession(session([54])); // 1 ennemi : build normal
  assert.strictEqual(journal.sets.length, 1);
  assert.deepStrictEqual(journal.resultats[0].adaptation, []);
  await auto.surSession(session([54, 516])); // 2 ennemis : toujours trop peu, rien de refait
  assert.strictEqual(journal.sets.length, 1);
  await auto.surSession(session([54, 516, 103])); // 3 : Mercure + Bâton du vide
  assert.strictEqual(journal.sets.length, 2);
  const dernier = journal.resultats.at(-1);
  assert.strictEqual(dernier.adaptation.length, 2);
  assert.deepStrictEqual(dernier.build.adaptation, dernier.adaptation);
  assert.ok(dernier.setsCrees[0].includes("Hwei"));
  await auto.surSession(session([54, 516, 103, 22])); // Ashe : même adaptation -> pas de nouvelle écriture
  assert.strictEqual(journal.sets.length, 2);
  assert.strictEqual(journal.analyses, 1, "rien n'est redemandé à Internet");
  assert.strictEqual(journal.runes, 0, "les runes ne sont pas refaites");
});
