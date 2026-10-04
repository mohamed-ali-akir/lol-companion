// Tests de l'onglet Missions : lecture (missions.js) et impact sur le calcul (src/calculs.js).
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const https = require("https");
const os = require("os");
const path = require("path");
const certificat = require("./fixtures/certificat-test.js");
const M = require("../missions.js");
const S = require("../src/calculs.js");

const MAINTENANT = Date.parse("2026-09-30T18:00:00Z");
const JOUR = 24 * 3600 * 1000;

/** Mission au format du client (PlayerMissionDTO). */
function mission({ id, titre, statut = "PENDING", fin = MAINTENANT + 3 * JOUR, actuel = 0, total = 3, recompenses = [], termineeLe }) {
  return {
    id,
    title: titre,
    description: `Description de ${titre}`,
    status: statut,
    endTime: fin,
    completedDate: termineeLe,
    seriesName: "Série test",
    objectives: [{ description: "Joue des parties", sequence: 1, progress: { currentProgress: actuel, totalCount: total } }],
    rewards: recompenses,
  };
}
const xp = (quantite, extra = {}) => ({ rewardType: "SUMMONER_XP", description: `${quantite} XP`, quantity: quantite, rewardFulfilled: false, ...extra });

// --- Reconnaître l'XP de compte -------------------------------------------------------------

test("récompenses en XP de compte reconnues, les faux amis écartés", () => {
  assert.strictEqual(M.xpDeRecompense(xp(400)), 400);
  assert.strictEqual(M.xpDeRecompense({ rewardType: "ACCOUNT_XP", quantity: 250 }), 250);
  // quantité à 1 : on lit le nombre dans la description
  assert.strictEqual(M.xpDeRecompense({ rewardType: "CURRENCY", description: "1 200 XP", quantity: 1 }), 1200);
  // pas de l'XP de compte
  assert.strictEqual(M.xpDeRecompense({ rewardType: "BOOST", description: "Boost d'XP 3 victoires", quantity: 3 }), 0);
  assert.strictEqual(M.xpDeRecompense({ rewardType: "CHAMPION_MASTERY", description: "500 XP de maîtrise", quantity: 500 }), 0);
  assert.strictEqual(M.xpDeRecompense({ rewardType: "EVENT_PASS_TOKEN", description: "50 jetons", quantity: 50 }), 0);
  assert.strictEqual(M.xpDeRecompense({ rewardType: "CURRENCY", description: "250 Essence bleue", quantity: 250 }), 0);
  assert.strictEqual(M.xpDeRecompense({ rewardType: "SUMMONER_XP", description: "XP", quantity: 1 }), 0); // montant illisible
  assert.strictEqual(M.xpDeRecompense(null), 0);
});

// --- Normalisation ------------------------------------------------------------------------

test("mission normalisée : titre, progression x / y, fin, récompenses", () => {
  const m = M.normaliserMission(mission({ id: "a", titre: "Joue 3 parties", actuel: 1, total: 3, recompenses: [xp(400)] }), MAINTENANT);
  assert.strictEqual(m.titre, "Joue 3 parties");
  assert.deepStrictEqual(m.objectifs, [{ description: "Joue des parties", actuel: 1, total: 3 }]);
  assert.strictEqual(m.fin, MAINTENANT + 3 * JOUR);
  assert.strictEqual(m.xp, 400);
  assert.strictEqual(m.terminee, false);
  assert.deepStrictEqual(m.recompenses, [{ description: "400 XP", quantite: 400, xp: 400, recue: false }]);
});

test("missions inutilisables ou expirées ignorées", () => {
  assert.strictEqual(M.normaliserMission(mission({ titre: "  " }), MAINTENANT), null);
  assert.strictEqual(M.normaliserMission(mission({ titre: "Vieille", fin: MAINTENANT - 1 }), MAINTENANT), null);
  assert.strictEqual(M.normaliserMission(null, MAINTENANT), null);
  assert.strictEqual(M.normaliserMission("?", MAINTENANT), null);
});

test("progression abîmée : pas de plantage, valeurs bornées", () => {
  const brute = mission({ titre: "Abîmée", recompenses: [xp(100)] });
  brute.objectives = [null, { progress: { currentProgress: "?", totalCount: -2 } }, { progress: { currentProgress: 9, totalCount: 5 } }, "x"];
  const m = M.normaliserMission(brute, MAINTENANT);
  assert.deepStrictEqual(m.objectifs.map((o) => [o.actuel, o.total]), [[null, null], [5, 5]]);
  assert.strictEqual(m.terminee, false); // un objectif illisible : on ne la déclare pas terminée
  const sansObjectifs = M.normaliserMission({ ...brute, objectives: "pas une liste", rewards: null }, MAINTENANT);
  assert.deepStrictEqual(sansObjectifs.objectifs, []);
  assert.strictEqual(sansObjectifs.xp, 0);
});

test("mission terminée : récompense à récupérer, ou déjà reçue", () => {
  const aRecuperer = M.normaliserMission(mission({ titre: "Finie", statut: "COMPLETED", actuel: 3, recompenses: [xp(300)] }), MAINTENANT);
  assert.strictEqual(aRecuperer.terminee, true);
  assert.strictEqual(aRecuperer.aRecuperer, true);
  assert.strictEqual(aRecuperer.xp, 300); // pas encore reçue : encore disponible
  const recue = M.normaliserMission(mission({ titre: "Reçue", statut: "COMPLETED", actuel: 3, recompenses: [xp(300, { rewardFulfilled: true })] }), MAINTENANT);
  assert.strictEqual(recue.aRecuperer, false);
  assert.strictEqual(recue.xp, 0);
  // statut inconnu mais objectifs remplis : terminée
  assert.strictEqual(M.normaliserMission(mission({ titre: "X", statut: "", actuel: 3, total: 3 }), MAINTENANT).terminee, true);
});

// --- Tri et résumé ---------------------------------------------------------------------------

test("tri : à récupérer, puis XP en cours, puis autres, puis terminées ; fin la plus proche d'abord", () => {
  const brutes = [
    mission({ id: 1, titre: "Sans XP", recompenses: [{ rewardType: "LOOT", description: "Coffre", quantity: 1, rewardFulfilled: false }] }),
    mission({ id: 2, titre: "XP loin", fin: MAINTENANT + 9 * JOUR, recompenses: [xp(200)] }),
    mission({ id: 3, titre: "Reçue", statut: "COMPLETED", actuel: 3, recompenses: [xp(300, { rewardFulfilled: true })] }),
    mission({ id: 4, titre: "XP bientôt", fin: MAINTENANT + 1 * JOUR, recompenses: [xp(100)] }),
    mission({ id: 5, titre: "À récupérer", statut: "COMPLETED", actuel: 3, recompenses: [xp(50)] }),
    mission({ id: 6, titre: "XP loin avancée", fin: MAINTENANT + 9 * JOUR, actuel: 2, recompenses: [xp(200)] }),
  ];
  const r = M.resumerMissions(brutes, MAINTENANT);
  assert.deepStrictEqual(r.missions.map((m) => m.titre), ["À récupérer", "XP bientôt", "XP loin avancée", "XP loin", "Sans XP", "Reçue"]);
});

test("XP disponible : missions sans XP, déjà terminées, liste vide ou abîmée", () => {
  const r = M.resumerMissions(
    [
      mission({ titre: "A", recompenses: [xp(400), xp(100)] }),
      mission({ titre: "B", recompenses: [{ rewardType: "LOOT", description: "Coffre", quantity: 1 }] }),
      mission({ titre: "C", statut: "COMPLETED", actuel: 3, recompenses: [xp(999, { rewardFulfilled: true })] }),
      mission({ titre: "D", statut: "COMPLETED", actuel: 3, recompenses: [xp(250)] }),
    ],
    MAINTENANT
  );
  assert.strictEqual(r.xpDisponible, 500); // 400 + 100 : seulement les missions en cours (pas les terminées)
  assert.strictEqual(r.enCours, 2);
  assert.strictEqual(r.enCoursAvecXp, 1);
  assert.strictEqual(r.aRecuperer, 1);
  assert.strictEqual(r.xpARecuperer, 250);
  assert.deepStrictEqual(M.resumerMissions([], MAINTENANT), {
    missions: [], xpDisponible: 0, enCours: 0, enCoursAvecXp: 0, aRecuperer: 0, xpARecuperer: 0,
  });
  assert.strictEqual(M.resumerMissions({ pas: "une liste" }, MAINTENANT).xpDisponible, 0);
});

// --- Impact sur le calcul ----------------------------------------------------------------------

const base = {
  niveauActuel: 24, progression: 50, niveauCible: 30, attenteMin: 5, heuresParJour: 3, boostDuree: false, boostVictoire: false,
};

test("bonus d'XP : niveau et progression de départ avancés, passage de niveau compris", () => {
  const p = S.appliquerBonusXp(base, 1152); // 24 à 50 % + 1152 XP = 25 à 0 %
  assert.strictEqual(p.niveauActuel, 25);
  assert.ok(Math.abs(p.progression) < 1e-9);
  assert.strictEqual(S.appliquerBonusXp(base, 0), base);
  assert.strictEqual(S.appliquerBonusXp(base, NaN), base);
});

test("XP des missions : moins de parties, et la différence est expliquée", () => {
  const r = S.calculerModesAvecMissions(base, {}, 1200);
  assert.strictEqual(r.xpMissions, 1200);
  for (const mode of Object.keys(S.MODES)) {
    assert.ok(r.calculs[mode].resultat.parties < r.sansMissions[mode].resultat.parties, mode);
  }
  // Sans XP de missions : exactement le calcul habituel, et pas de "sans missions".
  const sans = S.calculerModesAvecMissions(base, {}, 0);
  assert.deepStrictEqual(sans.calculs, S.calculerModes(base, {}));
  assert.strictEqual(sans.sansMissions, null);
});

test("missions qui suffisent à atteindre l'objectif : 0 partie", () => {
  const r = S.calculerModesAvecMissions({ ...base, niveauCible: 25 }, {}, 50000);
  assert.strictEqual(r.calculs.mayhem.resultat.parties, 0);
});

// --- Lecture avec un faux client --------------------------------------------------------------

async function fauxClient(reponse, status = 200) {
  const serveur = https.createServer(certificat, (req, res) => {
    res.writeHead(req.url === "/lol-missions/v1/missions" ? status : 404, { "Content-Type": "application/json" });
    res.end(JSON.stringify(req.url === "/lol-missions/v1/missions" ? reponse : {}));
  });
  await new Promise((ok) => serveur.listen(0, "127.0.0.1", ok));
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "faux-lol-"));
  fs.writeFileSync(path.join(dossier, "lockfile"), `LeagueClient:1:${serveur.address().port}:mdp:https`);
  return { dossier, fermer: () => new Promise((ok) => serveur.close(ok)) };
}

test("client : missions lues et résumées", async () => {
  const client = await fauxClient([mission({ titre: "A", fin: Date.now() + JOUR, recompenses: [xp(400)] })]);
  try {
    const r = await M.recupererMissions(client.dossier);
    assert.strictEqual(r.xpDisponible, 400);
    assert.strictEqual(r.missions[0].titre, "A");
  } finally {
    await client.fermer();
  }
});

test("client : réponse inattendue -> erreur claire", async () => {
  const client = await fauxClient({ pas: "une liste" });
  try {
    await assert.rejects(M.recupererMissions(client.dossier), /missions/);
  } finally {
    await client.fermer();
  }
});

test("date de fin lisible", () => {
  assert.strictEqual(S.texteFin(null, MAINTENANT), "");
  assert.strictEqual(S.texteFin(MAINTENANT - 1, MAINTENANT), "terminée");
  assert.strictEqual(S.texteFin(MAINTENANT + 5 * 3600 * 1000, MAINTENANT), "se termine dans 5 h");
  assert.strictEqual(S.texteFin(MAINTENANT + 60 * 1000, MAINTENANT), "se termine dans 1 h");
  assert.match(S.texteFin(MAINTENANT + 3 * JOUR, MAINTENANT), /^jusqu'au \d\d\/\d\d$/);
});
