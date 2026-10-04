// Tests de l'onglet Maîtrise : lecture tolérante du client, tri, estimation du nombre de parties,
// mesure des points gagnés par partie. Lancer avec : npm test
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const https = require("https");
const os = require("os");
const path = require("path");
const certificat = require("./fixtures/certificat-test.js");
const M = require("../maitrise.js");
const C = require("../src/calculs.js");

const HEURE = 60 * 60 * 1000;
const MAINTENANT = Date.UTC(2026, 8, 30, 18, 0);

// Entrée telle que le client la donne depuis la refonte de 2024.
function brute(champs = {}) {
  return {
    championId: 103,
    championLevel: 6,
    championPoints: 38000,
    championPointsSinceLastLevel: 6400,
    championPointsUntilNextLevel: 4600,
    markRequiredForNextLevel: 1,
    tokensEarned: 0,
    championSeasonMilestone: 1,
    milestoneGrades: ["A"],
    nextSeasonMilestone: { requireGradeCounts: { "A-": 1 }, rewardMarks: 1, bonus: false, rewardConfig: { rewardValue: "", maximumReward: 0 } },
    highestGrade: "S",
    lastPlayTime: MAINTENANT - HEURE,
    puuid: "p",
    ...champs,
  };
}

// --- Normalisation -----------------------------------------------------------------------------

test("normaliserMaitrise : lit les champs de 2024 (points, restants, marques, prochain palier)", () => {
  const m = M.normaliserMaitrise(brute());
  assert.strictEqual(m.championId, 103);
  assert.strictEqual(m.niveau, 6);
  assert.strictEqual(m.points, 38000);
  assert.strictEqual(m.depuisNiveau, 6400);
  assert.strictEqual(m.restants, 4600);
  assert.strictEqual(m.marquesRequises, 1);
  assert.strictEqual(m.marquesObtenues, 0);
  assert.strictEqual(m.marquesManquantes, 1);
  assert.deepStrictEqual(m.palier, { notes: [{ note: "A-", nombre: 1 }], marques: 1, bonus: false });
  assert.deepStrictEqual(m.notesPalier, ["A"]);
  assert.strictEqual(m.meilleureNote, "S");
});

test("normaliserMaitrise : champs manquants -> valeurs neutres, sans planter", () => {
  const m = M.normaliserMaitrise({ championId: 7 });
  assert.strictEqual(m.niveau, null);
  assert.strictEqual(m.points, 0);
  assert.strictEqual(m.restants, null);
  assert.strictEqual(m.marquesRequises, null);
  assert.strictEqual(m.marquesManquantes, 0); // pas d'info sur les marques : on n'en invente pas
  assert.strictEqual(m.palier, null);
  assert.deepStrictEqual(m.notesPalier, []);
  assert.strictEqual(m.dernierePartie, null);
});

test("normaliserMaitrise : points atteints mais marques manquantes (restants négatifs -> 0)", () => {
  const m = M.normaliserMaitrise(brute({ championLevel: 10, championPointsUntilNextLevel: -2500, markRequiredForNextLevel: 2, tokensEarned: 1 }));
  assert.strictEqual(m.restants, 0);
  assert.strictEqual(m.marquesManquantes, 1);
});

test("normaliserMaitrise : entrées inutilisables et valeurs abîmées", () => {
  assert.strictEqual(M.normaliserMaitrise(null), null);
  assert.strictEqual(M.normaliserMaitrise({ championPoints: 100 }), null); // pas d'id
  assert.strictEqual(M.normaliserMaitrise({ championId: -1 }), null);
  const m = M.normaliserMaitrise(
    brute({ championPoints: "beaucoup", nextSeasonMilestone: { requireGradeCounts: { "Z+": 1, "S-": "deux", S: 0 } }, milestoneGrades: "S" })
  );
  assert.strictEqual(m.points, 0);
  assert.strictEqual(m.palier, null); // aucune condition valide
  assert.deepStrictEqual(m.notesPalier, []);
});

test("normaliserListe : liste, objet { masteries }, format inconnu, doublons", () => {
  assert.strictEqual(M.normaliserListe([brute(), brute({ championId: 1 })]).length, 2);
  assert.strictEqual(M.normaliserListe({ masteries: [brute()] }).length, 1);
  assert.strictEqual(M.normaliserListe({ autre: 1 }), null);
  assert.strictEqual(M.normaliserListe(null), null);
  assert.strictEqual(M.normaliserListe([brute(), brute(), null, "x"]).length, 1);
});

// --- Tri, recherche, estimation (calculs.js) ---------------------------------------------------------

const champion = (nom, champs) => ({ nom, championId: nom.length, points: 10000, niveau: 5, restants: 1000, marquesManquantes: 0, ...champs });

test("trierMaitrises par proximité : moins de points restants d'abord, puis moins de marques manquantes", () => {
  const liste = [
    champion("Lux", { restants: 3000 }),
    champion("Ahri", { restants: 0, marquesManquantes: 2 }),
    champion("Jinx", { restants: 500 }),
    champion("Garen", { restants: 0, marquesManquantes: 1 }),
    champion("Annie", { restants: null }), // inconnu : à la fin
  ];
  assert.deepStrictEqual(C.trierMaitrises(liste, "proximite").map((c) => c.nom), ["Garen", "Ahri", "Jinx", "Lux", "Annie"]);
});

test("trierMaitrises : égalité -> plus de points, puis nom ; par défaut : par points", () => {
  const liste = [champion("Zed", { points: 5 }), champion("Ashe", { points: 5 }), champion("Vi", { points: 9 })];
  assert.deepStrictEqual(C.trierMaitrises(liste, "proximite").map((c) => c.nom), ["Vi", "Ashe", "Zed"]);
  assert.deepStrictEqual(C.trierMaitrises(liste).map((c) => c.nom), ["Vi", "Ashe", "Zed"]);
  assert.deepStrictEqual(C.trierMaitrises([champion("A", { points: undefined }), champion("B", { points: 3 })]).map((c) => c.nom), ["B", "A"]);
  assert.deepStrictEqual(C.trierMaitrises(null), []);
  assert.strictEqual(liste[0].nom, "Zed"); // la liste d'origine n'est pas modifiée
});

test("estimerPartiesMaitrise : moyenne mesurée -> nombre de parties arrondi au-dessus", () => {
  assert.strictEqual(C.estimerPartiesMaitrise({ restants: 4600, moyenneParPartie: 1000 }), 5);
  assert.strictEqual(C.estimerPartiesMaitrise({ restants: 1000, moyenneParPartie: 1000 }), 1);
  assert.strictEqual(C.estimerPartiesMaitrise({ restants: 0, moyenneParPartie: null }), 0); // points déjà atteints
});

test("estimerPartiesMaitrise : pas d'historique, moyenne nulle ou champs manquants -> pas d'estimation", () => {
  assert.strictEqual(C.estimerPartiesMaitrise({ restants: 4600, moyenneParPartie: null }), null); // pas d'historique
  assert.strictEqual(C.estimerPartiesMaitrise({ restants: 4600 }), null);
  assert.strictEqual(C.estimerPartiesMaitrise({ restants: 4600, moyenneParPartie: 0 }), null); // moyenne nulle
  assert.strictEqual(C.estimerPartiesMaitrise({ restants: 4600, moyenneParPartie: -50 }), null);
  assert.strictEqual(C.estimerPartiesMaitrise({ restants: null, moyenneParPartie: 1000 }), null);
  assert.strictEqual(C.estimerPartiesMaitrise(null), null);
});

test("filtrerMaitrises : sans majuscules, accents ni apostrophes", () => {
  const liste = [{ nom: "Kai'Sa" }, { nom: "Nidalee" }, { nom: "Kha'Zix" }];
  assert.deepStrictEqual(C.filtrerMaitrises(liste, "kaisa").map((c) => c.nom), ["Kai'Sa"]);
  assert.deepStrictEqual(C.filtrerMaitrises(liste, "  KA ").map((c) => c.nom), ["Kai'Sa"]);
  assert.strictEqual(C.filtrerMaitrises(liste, "").length, 3);
  assert.deepStrictEqual(C.filtrerMaitrises(null, "a"), []);
});

test("simplifierNom : sans majuscules, accents, espaces ni ponctuation", () => {
  assert.strictEqual(C.simplifierNom("Kai'Sa"), "kaisa");
  assert.strictEqual(C.simplifierNom("  Nunu & Willump "), "nunuwillump");
  assert.strictEqual(C.simplifierNom("Écho"), "echo");
  assert.strictEqual(C.simplifierNom(undefined), "");
});

test("trouverChampion (recherche des onglets Sélection et Build) : exact, unique, ambigu, inconnu, vide", () => {
  const liste = [{ id: 145, nom: "Kai'Sa" }, { id: 43, nom: "Karma" }, { id: 76, nom: "Nidalee" }, { id: 223, nom: "Tahm Kench" }, { id: 77, nom: "Udyr" }, { id: 104, nom: "Graves" }];
  assert.deepStrictEqual(C.trouverChampion("kaisa", liste), { champion: liste[0] });
  assert.deepStrictEqual(C.trouverChampion("nida", liste), { champion: liste[2] }); // une seule correspondance
  assert.deepStrictEqual(C.trouverChampion("TAHM KENCH", liste), { champion: liste[3] });
  assert.match(C.trouverChampion("ka", liste).erreur, /plusieurs champions possibles \(Kai'Sa, Karma\)/);
  assert.match(C.trouverChampion("zzz", liste).erreur, /aucun champion/);
  assert.deepStrictEqual(C.trouverChampion("   ", liste), { vide: true });
  // Nom exact prioritaire même s'il est contenu dans un autre nom
  const avecDoublon = [{ id: 1, nom: "Vi" }, { id: 2, nom: "Viego" }, { id: 3, nom: "Viktor" }];
  assert.deepStrictEqual(C.trouverChampion("vi", avecDoublon), { champion: avecDoublon[0] });
  assert.deepStrictEqual(C.trouverChampion("ahri", null).erreur !== undefined, true);
});

test("plusProchesDuNiveau et resumeMaitrise ignorent les champions jamais joués", () => {
  const liste = [champion("Ahri", { restants: 200 }), champion("Neuf", { points: 0, restants: 1 }), champion("Vi", { restants: 900, niveau: 12 })];
  assert.deepStrictEqual(C.plusProchesDuNiveau(liste, 5).map((c) => c.nom), ["Ahri", "Vi"]);
  assert.deepStrictEqual(C.resumeMaitrise(liste), { joues: 2, pointsTotal: 20000, niveauMax: 12, niveau10EtPlus: 1 });
  assert.strictEqual(C.resumeMaitrise([]), null);
  assert.strictEqual(C.resumeMaitrise(undefined), null);
});

test("texteNotesRequises", () => {
  assert.strictEqual(C.texteNotesRequises({ notes: [{ note: "A-", nombre: 1 }] }), "1 partie notée A- ou mieux");
  assert.strictEqual(
    C.texteNotesRequises({ notes: [{ note: "S-", nombre: 2 }, { note: "A", nombre: 1 }] }),
    "2 parties notées S- ou mieux et 1 partie notée A ou mieux"
  );
  assert.strictEqual(C.texteNotesRequises(null), "");
});

// --- Mesure des points gagnés par partie -------------------------------------------------------------

const maitrise = (points, championId = 103) => ({ championId, points });
const partie = (id, date, championId = 103, file = 450) => ({ id, date, championId, file });

test("mettreAJourSuivi : première lecture = référence, pas d'échantillon", () => {
  const etat = M.mettreAJourSuivi(null, [maitrise(38000)], [], MAINTENANT);
  assert.deepStrictEqual(etat.echantillons, []);
  assert.strictEqual(etat.releves["103"].points, 38000);
});

test("mettreAJourSuivi : points en plus + nouvelle partie -> échantillon, puis moyenne", () => {
  let etat = M.mettreAJourSuivi(null, [maitrise(38000)], [], MAINTENANT);
  const t1 = MAINTENANT + 40 * 60 * 1000;
  etat = M.mettreAJourSuivi(etat, [maitrise(39100)], [partie(1, MAINTENANT + 5 * 60 * 1000)], t1);
  assert.deepStrictEqual(etat.echantillons, [{ championId: 103, points: 1100, parties: 1, date: t1 }]);
  // Deux parties de plus d'un coup (appli fermée entre les deux) : 1 900 points en 2 parties.
  const t2 = t1 + 2 * HEURE;
  etat = M.mettreAJourSuivi(etat, [maitrise(41000)], [partie(1, MAINTENANT + 5 * 60 * 1000), partie(2, t1 + 10), partie(3, t1 + HEURE)], t2);
  assert.strictEqual(etat.echantillons.length, 2);
  assert.deepStrictEqual(M.moyennesParChampion(etat.echantillons).get(103), { moyenne: 1000, parties: 3 }); // 3000 / 3
  // Relire sans rien de nouveau ne change rien.
  const encore = M.mettreAJourSuivi(etat, [maitrise(41000)], [partie(1, MAINTENANT + 5 * 60 * 1000), partie(2, t1 + 10), partie(3, t1 + HEURE)], t2 + 60000);
  assert.strictEqual(encore.echantillons.length, 2);
});

test("mettreAJourSuivi : points arrivés avant la partie (ou l'inverse) -> on attend, puis on associe", () => {
  let etat = M.mettreAJourSuivi(null, [maitrise(38000)], [], MAINTENANT);
  // Les points sont là, mais la partie n'est pas encore dans l'historique : on attend.
  etat = M.mettreAJourSuivi(etat, [maitrise(38900)], [], MAINTENANT + HEURE);
  assert.strictEqual(etat.echantillons.length, 0);
  assert.strictEqual(etat.releves["103"].points, 38000);
  // La partie arrive à la lecture suivante.
  etat = M.mettreAJourSuivi(etat, [maitrise(38900)], [partie(1, MAINTENANT + 20 * 60 * 1000)], MAINTENANT + HEURE + 60000);
  assert.deepStrictEqual(etat.echantillons.map((e) => [e.points, e.parties]), [[900, 1]]);

  // L'inverse : la partie est là, pas encore les points.
  let autre = M.mettreAJourSuivi(null, [maitrise(5000, 1)], [], MAINTENANT);
  autre = M.mettreAJourSuivi(autre, [maitrise(5000, 1)], [partie(9, MAINTENANT + 60000, 1)], MAINTENANT + HEURE);
  assert.strictEqual(autre.echantillons.length, 0);
  autre = M.mettreAJourSuivi(autre, [maitrise(5700, 1)], [partie(9, MAINTENANT + 60000, 1)], MAINTENANT + HEURE + 60000);
  assert.deepStrictEqual(autre.echantillons.map((e) => [e.points, e.parties]), [[700, 1]]);
});

test("mettreAJourSuivi : ignore les vieilles parties importées, les parties perso et les autres champions", () => {
  let etat = M.mettreAJourSuivi(null, [maitrise(38000)], [], MAINTENANT);
  const parties = [
    partie(1, MAINTENANT - 30 * 24 * HEURE), // importée : bien avant la référence
    partie(2, MAINTENANT + 60000, 103, 0), // partie personnalisée : pas de maîtrise
    partie(3, MAINTENANT + 60000, 222), // autre champion
    partie(4, MAINTENANT + 120000), // la vraie
  ];
  etat = M.mettreAJourSuivi(etat, [maitrise(38800)], parties, MAINTENANT + HEURE);
  assert.deepStrictEqual(etat.echantillons.map((e) => [e.points, e.parties]), [[800, 1]]);
});

test("mettreAJourSuivi : points en baisse -> nouvelle référence ; trop de parties d'un coup -> pas d'échantillon", () => {
  let etat = M.mettreAJourSuivi(null, [maitrise(38000)], [], MAINTENANT);
  etat = M.mettreAJourSuivi(etat, [maitrise(100)], [partie(1, MAINTENANT + 60000)], MAINTENANT + HEURE);
  assert.strictEqual(etat.echantillons.length, 0);
  assert.strictEqual(etat.releves["103"].points, 100);

  let beaucoup = M.mettreAJourSuivi(null, [maitrise(0)], [], MAINTENANT);
  const onze = Array.from({ length: 11 }, (_, i) => partie(100 + i, MAINTENANT + i * 60000));
  beaucoup = M.mettreAJourSuivi(beaucoup, [maitrise(12000)], onze, MAINTENANT + 2 * HEURE);
  assert.strictEqual(beaucoup.echantillons.length, 0);
  assert.strictEqual(beaucoup.releves["103"].points, 12000); // mais la référence avance
});

test("mettreAJourSuivi : état abîmé ou entrées invalides -> repart proprement", () => {
  const etat = M.mettreAJourSuivi({ releves: "x", echantillons: [{ championId: 1, points: -5, parties: 1 }, null] }, [null, { championId: 1 }], null, MAINTENANT);
  assert.deepStrictEqual(etat, { releves: {}, echantillons: [] });
});

test("moyennesParChampion : aucun échantillon -> aucune moyenne", () => {
  assert.strictEqual(M.moyennesParChampion([]).size, 0);
  assert.strictEqual(M.moyennesParChampion(undefined).size, 0);
  assert.strictEqual(M.moyennesParChampion([{ championId: 1, points: 0, parties: 2 }]).size, 0);
});

test("creerSuiviMaitrise : lit, enregistre par compte, fichier abîmé, effacer", () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "maitrise-"));
  const suivi = M.creerSuiviMaitrise({ dossier });
  assert.deepStrictEqual(suivi.lire("A#1"), { releves: {}, echantillons: [] });
  suivi.enregistrer("A#1", { releves: { 1: { points: 5, date: 1, ids: [] } }, echantillons: [{ championId: 1, points: 900, parties: 1, date: 1 }] });
  suivi.enregistrer("B#2", { releves: {}, echantillons: [] });
  assert.strictEqual(suivi.lire("A#1").echantillons.length, 1);
  fs.writeFileSync(path.join(dossier, "maitrise.json"), "{abîmé");
  assert.deepStrictEqual(suivi.lire("A#1"), { releves: {}, echantillons: [] });
  suivi.effacer();
  suivi.effacer(); // deux fois : pas d'erreur
});

// --- Lecture dans un faux client ------------------------------------------------------------------------

async function fauxClient(routes) {
  const serveur = https.createServer(certificat, (req, res) => {
    const reponse = routes[req.url];
    res.writeHead(reponse === undefined ? 404 : 200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(reponse === undefined ? {} : reponse));
  });
  await new Promise((ok) => serveur.listen(0, "127.0.0.1", ok));
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "faux-lol-"));
  fs.writeFileSync(path.join(dossier, "lockfile"), `LeagueClient:1:${serveur.address().port}:mdp:https`);
  return { dossier, fermer: () => new Promise((ok) => serveur.close(ok)) };
}

const COMPTE = { gameName: "wDark", tagLine: "Amumu", puuid: "abc-123", summonerLevel: 25 };

test("recupererMaitrise : route du joueur connecté", async () => {
  const client = await fauxClient({ "/lol-summoner/v1/current-summoner": COMPTE, [M.ROUTE_MAITRISE]: [brute(), brute({ championId: 1 })] });
  try {
    const r = await M.recupererMaitrise(client.dossier);
    assert.deepStrictEqual(r.compte, { nom: "wDark", tag: "Amumu" });
    assert.deepStrictEqual(r.maitrises.map((m) => m.championId), [103, 1]);
  } finally {
    await client.fermer();
  }
});

test("recupererMaitrise : secours par puuid si la première route n'existe pas", async () => {
  const client = await fauxClient({
    "/lol-summoner/v1/current-summoner": COMPTE,
    "/lol-champion-mastery/v1/abc-123/champion-mastery": [brute({ championId: 99 })],
  });
  try {
    const r = await M.recupererMaitrise(client.dossier);
    assert.deepStrictEqual(r.maitrises.map((m) => m.championId), [99]);
  } finally {
    await client.fermer();
  }
});

test("recupererMaitrise : aucune route ne répond -> message clair", async () => {
  const client = await fauxClient({ "/lol-summoner/v1/current-summoner": COMPTE });
  try {
    await assert.rejects(M.recupererMaitrise(client.dossier), /maîtrise/);
  } finally {
    await client.fermer();
  }
});
