// Tests de l'alerte des objectifs : heures d'apparition, bandeau, réapparitions, lecture du jeu (faux jeu sur 127.0.0.1).
const test = require("node:test");
const assert = require("node:assert");
const https = require("https");
const O = require("../objectifs.js");
const certificat = require("./fixtures/certificat-test.js");

const textes = (lignes) => lignes.map((l) => l.texte);

test("heures vérifiées le 10/10/2026 : Carapateurs 2:55, dragon 5:00, larves 8:00, Héraut 15:00, Baron 20:00", () => {
  assert.deepStrictEqual(O.OBJECTIFS.map((o) => [o.cle, o.apparitionS]), [
    ["carapateurs", 175], ["dragon", 300], ["larves", 480], ["heraut", 900], ["baron", 1200],
  ]);
});

test("bandeau : 30 s avant, compte à rebours, disparaît à l'apparition (pas de « maintenant »)", () => {
  assert.deepStrictEqual(O.alertesObjectifs(269), []); // 4:29 : trop tôt
  assert.deepStrictEqual(O.alertesObjectifs(270), [{ cle: "dragon", texte: "Premier dragon dans 30 s", restantS: 30 }]);
  assert.deepStrictEqual(textes(O.alertesObjectifs(461.2)), ["Larves du Néant dans 19 s"]); // arrondi au-dessus
  assert.deepStrictEqual(textes(O.alertesObjectifs(479.5)), ["Larves du Néant dans 1 s"]);
  assert.deepStrictEqual(O.alertesObjectifs(480), []); // apparu : plus rien
  assert.deepStrictEqual(textes(O.alertesObjectifs(150)), ["Carapateurs dans 25 s"]);
  assert.deepStrictEqual(textes(O.alertesObjectifs(1175)), ["Baron Nashor dans 25 s"]);
});

test("bandeau : rien après le Baron sans réapparitions ; temps illisible -> rien", () => {
  for (const t of [1200, 1500, 2400, 3600]) assert.deepStrictEqual(O.alertesObjectifs(t), [], String(t));
  for (const t of [null, undefined, NaN, -5, "300"]) assert.deepStrictEqual(O.alertesObjectifs(t), [], String(t));
});

test("carte : Faille (11) oui, ARAM (12) non, données abîmées non", () => {
  assert.strictEqual(O.estFaille({ map: { id: 11 } }), true);
  assert.strictEqual(O.estFaille({ gameData: { queue: { mapId: 11 } } }), true);
  assert.strictEqual(O.estFaille({ map: { id: 12 }, gameData: { queue: { mapId: 12 } } }), false);
  assert.strictEqual(O.estFaille(null), false);
  assert.strictEqual(O.estFaille({ map: "?" }), false);
});

// --- Réapparitions (option) -----------------------------------------------------------------

const JOUEURS = [
  { riotId: "Moi#EUW", riotIdGameName: "Moi", summonerName: "Moi#EUW", team: "ORDER" },
  { riotId: "Lui#EUW", riotIdGameName: "Lui", summonerName: "Lui#EUW", team: "CHAOS" },
];
const dragon = (temps, tueur, type = "Fire") => ({ EventName: "DragonKill", EventTime: temps, KillerName: tueur, DragonType: type, Assisters: [] });

test("mon équipe : retrouvée par le Riot ID du joueur de ce PC", () => {
  assert.strictEqual(O.monEquipe({ riotId: "Moi#EUW" }, JOUEURS), "ORDER");
  assert.strictEqual(O.monEquipe({ summonerName: "lui#euw" }, JOUEURS), "CHAOS");
  assert.strictEqual(O.monEquipe(null, JOUEURS), null);
  assert.strictEqual(O.monEquipe({ riotId: "Inconnu" }, JOUEURS), null);
});

test("réapparitions : dragon 5:00 après sa mort, Baron 6:00 après la sienne, rien sans objectif tué", () => {
  assert.deepStrictEqual(O.reapparitions([], JOUEURS), []);
  const r = O.reapparitions([{ EventName: "BaronKill", EventTime: 1300 }, dragon(310, "Moi"), { EventName: "ChampionKill", EventTime: 400 }], JOUEURS);
  assert.deepStrictEqual(r, [
    { cle: "dragon", nom: "Dragon", apparitionS: 610 },
    { cle: "baron", nom: "Baron Nashor", apparitionS: 1660 },
  ]);
  assert.deepStrictEqual(O.reapparitions("?", null), []);
});

test("réapparitions : 4 dragons pour une équipe (l'âme) -> dragon ancestral 6:00 après, puis 6:00 après chaque", () => {
  const quatre = [dragon(300, "Moi"), dragon(700, "Lui"), dragon(1100, "Moi"), dragon(1300, "Moi"), dragon(1500, "Moi")]; // Moi : 4
  assert.deepStrictEqual(O.reapparitions(quatre, JOUEURS), [{ cle: "dragon", nom: "Dragon ancestral", apparitionS: 1860 }]);
  const elder = [...quatre, dragon(1900, "Lui", "Elder")];
  assert.deepStrictEqual(O.reapparitions(elder, JOUEURS), [{ cle: "dragon", nom: "Dragon ancestral", apparitionS: 2260 }]);
  // 3 dragons pour chaque équipe : pas d'âme, dragon normal
  const partage = [dragon(300, "Moi"), dragon(600, "Lui"), dragon(900, "Moi"), dragon(1200, "Lui"), dragon(1500, "Moi"), dragon(1800, "Lui")];
  assert.strictEqual(O.reapparitions(partage, JOUEURS)[0].nom, "Dragon");
});

test("réapparitions : nom du tueur au format Riot ID, ou retrouvé par un assistant ; inconnu : 7 dragons = âme sûre", () => {
  const riotId = [dragon(300, "moi#euw"), dragon(700, "Moi"), dragon(1100, "MOI"), { ...dragon(1500, "Baron Nashor"), Assisters: ["Moi"] }];
  assert.strictEqual(O.reapparitions(riotId, JOUEURS)[0].nom, "Dragon ancestral");
  const inconnus = Array.from({ length: 7 }, (_, i) => dragon(300 + i * 400, "?"));
  assert.strictEqual(O.reapparitions(inconnus.slice(0, 6), JOUEURS)[0].nom, "Dragon");
  assert.strictEqual(O.reapparitions(inconnus, JOUEURS)[0].nom, "Dragon ancestral");
});

test("réapparitions : inhibiteurs 5:00 après, allié / ennemi selon mon équipe, un chrono par inhibiteur", () => {
  const ev = [
    { EventName: "InhibKilled", EventTime: 1600, InhibKilled: "Barracks_T2_C1", KillerName: "Moi" },
    { EventName: "InhibKilled", EventTime: 1650, InhibKilled: "Barracks_T1_L1", KillerName: "Lui" },
    { EventName: "InhibKilled", EventTime: 1950, InhibKilled: "Barracks_T2_C1", KillerName: "Moi" }, // le même, après sa réapparition
    { EventName: "InhibKilled", EventTime: 1700, InhibKilled: "???" },
  ];
  assert.deepStrictEqual(O.reapparitions(ev, JOUEURS, "ORDER"), [
    { cle: "inhibiteur_T2_C1", nom: "Inhibiteur milieu ennemi", apparitionS: 2250 },
    { cle: "inhibiteur_T1_L1", nom: "Inhibiteur haut allié", apparitionS: 1950 },
  ]);
  assert.strictEqual(O.reapparitions(ev.slice(0, 1), JOUEURS)[0].nom, "Inhibiteur milieu"); // équipe inconnue
});

test("bandeau avec réapparitions : 30 s avant ; plusieurs objectifs en même temps -> une ligne chacun", () => {
  const prochaines = O.reapparitions([dragon(310, "Moi")], JOUEURS); // retour à 10:10
  assert.deepStrictEqual(O.alertesObjectifs(579, prochaines), []);
  assert.deepStrictEqual(textes(O.alertesObjectifs(580, prochaines)), ["Dragon dans 30 s"]);
  assert.deepStrictEqual(O.alertesObjectifs(610, prochaines), []);
  assert.deepStrictEqual(O.alertesObjectifs(580), []); // option décochée : rien
  const deux = [{ cle: "baron", nom: "Baron Nashor", apparitionS: 1700 }, { cle: "dragon", nom: "Dragon", apparitionS: 1690 }];
  assert.deepStrictEqual(textes(O.alertesObjectifs(1675, deux)), ["Dragon dans 15 s", "Baron Nashor dans 25 s"]);
});

// --- Lecture du jeu (faux jeu) ------------------------------------------------------------------

async function fauxJeu(repondre) {
  const serveur = https.createServer(certificat, repondre);
  await new Promise((ok) => serveur.listen(0, "127.0.0.1", ok));
  return { port: serveur.address().port, fermer: () => new Promise((ok) => serveur.close(ok)) };
}

test("lecture : /liveclientdata/allgamedata -> temps, événements, joueurs, moi ; null si pas de partie ou illisible", async () => {
  const chemins = [];
  const jeu = await fauxJeu((requete, reponse) => {
    chemins.push(requete.url);
    reponse.writeHead(200, { "Content-Type": "application/json" });
    reponse.end(JSON.stringify({ gameData: { gameTime: 301.5 }, activePlayer: { riotId: "Moi#EUW" }, allPlayers: JOUEURS, events: { Events: [dragon(300, "Moi")] } }));
  });
  const lu = await O.lireJeu({ port: jeu.port });
  assert.strictEqual(lu.tempsS, 301.5);
  assert.strictEqual(lu.evenements.length, 1);
  assert.strictEqual(lu.joueurs.length, 2);
  assert.strictEqual(lu.actif.riotId, "Moi#EUW");
  assert.deepStrictEqual(chemins, ["/liveclientdata/allgamedata"]);
  await jeu.fermer();

  const chargement = await fauxJeu((_q, reponse) => {
    reponse.writeHead(404);
    reponse.end();
  });
  assert.strictEqual(await O.lireJeu({ port: chargement.port }), null);
  await chargement.fermer();

  const casse = await fauxJeu((_q, reponse) => reponse.end("pas du json"));
  assert.strictEqual(await O.lireJeu({ port: casse.port }), null);
  await casse.fermer();

  assert.strictEqual(await O.lireJeu({ port: jeu.port }), null); // jeu fermé : pas d'erreur
  assert.deepStrictEqual(O.lireDonneesJeu({ gameData: { gameTime: 12 } }), { tempsS: 12, evenements: [], joueurs: [], actif: null });
  assert.strictEqual(O.lireDonneesJeu({ gameData: {} }), null);
});

// --- Suivi ------------------------------------------------------------------------------------
// Chaque test arrête son suivi dans un "finally" : une minuterie oubliée empêcherait les tests de se terminer.

const attendre = (ms) => new Promise((ok) => setTimeout(ok, ms));
const texteDe = (lignes) => (lignes ? lignes.map((l) => l.texte).join(" | ") : null);

test("suivi : n'envoie que les changements, s'efface à l'arrêt, rien si la case est décochée", async () => {
  let temps = 279;
  const reglages = { objectifs: true, reapparitions: false };
  const vus = [];
  const suivi = O.creerSuiviObjectifs({
    reglages: () => reglages,
    lire: async () => ({ tempsS: temps, evenements: [], joueurs: [], actif: null }),
    afficher: (lignes) => vus.push(texteDe(lignes)),
    intervalleMs: 5,
  });
  try {
    suivi.demarrer();
    await attendre(20);
    assert.deepStrictEqual(vus, ["Premier dragon dans 21 s"]); // même texte à chaque tour : envoyé une seule fois
    temps = 290;
    await attendre(20);
    reglages.objectifs = false;
    await attendre(20);
    assert.deepStrictEqual(vus, ["Premier dragon dans 21 s", "Premier dragon dans 10 s", null]);
    reglages.objectifs = true;
  } finally {
    suivi.arreter();
  }
  assert.strictEqual(suivi.estDemarre(), false);
  assert.strictEqual(vus.at(-1), null);
});

test("suivi : réapparitions seulement si leur case est cochée", async () => {
  const reglages = { objectifs: true, reapparitions: false };
  const vus = [];
  const suivi = O.creerSuiviObjectifs({
    reglages: () => reglages,
    lire: async () => ({ tempsS: 590, evenements: [dragon(310, "Moi")], joueurs: JOUEURS, actif: { riotId: "Moi#EUW" } }),
    afficher: (lignes) => vus.push(texteDe(lignes)),
    intervalleMs: 5,
  });
  try {
    suivi.demarrer();
    await attendre(20);
    assert.deepStrictEqual(vus, []); // rien à 9:50 sans l'option
    reglages.reapparitions = true;
    await attendre(20);
  } finally {
    suivi.arreter();
  }
  assert.deepStrictEqual(vus, ["Dragon dans 20 s", null]);
});

test("suivi : une erreur de lecture ne casse rien", async () => {
  const notes = [];
  const suivi = O.creerSuiviObjectifs({
    reglages: () => ({ objectifs: true }),
    lire: async () => { throw new Error("boum"); },
    afficher: () => {},
    intervalleMs: 5,
    journal: (...m) => notes.push(m.join(" ")),
  });
  try {
    suivi.demarrer();
    await attendre(20);
  } finally {
    suivi.arreter();
  }
  assert.ok(notes.length >= 1 && notes[0].includes("boum"));
});

// --- Lecture partagée (objectifs + chronos des sorts) ---------------------------------------------

test("lecture partagée : deux suivis dans la même seconde -> une seule lecture du jeu", async () => {
  let maintenant = 0;
  let lectures = 0;
  const lire = O.creerLectureJeuPartagee({ lire: async () => ({ tempsS: 100 + lectures++ }), maintenant: () => maintenant });
  assert.strictEqual((await lire()).tempsS, 100);
  maintenant = 300; // l'autre suivi lit 0,3 s plus tard : même lecture, temps de jeu avancé de 0,3 s
  assert.strictEqual((await lire()).tempsS, 100.3);
  assert.strictEqual(lectures, 1);
  maintenant = 1000; // seconde suivante : nouvelle lecture
  assert.strictEqual((await lire()).tempsS, 101);
  assert.strictEqual(lectures, 2);
});

test("lecture partagée : une lecture en cours est attendue, pas relancée", async () => {
  let lectures = 0;
  let finir;
  const lire = O.creerLectureJeuPartagee({
    lire: () => {
      lectures++;
      return new Promise((r) => (finir = r));
    },
  });
  const a = lire();
  const b = lire();
  await Promise.resolve(); // laisse partir la lecture
  finir({ tempsS: 50 });
  const [ja, jb] = await Promise.all([a, b]);
  assert.strictEqual(lectures, 1);
  assert.ok(Math.abs(ja.tempsS - 50) < 0.1 && Math.abs(jb.tempsS - 50) < 0.1);
});

test("lecture partagée : pas de partie (null) ou erreur -> transmis tel quel, sans planter", async () => {
  let maintenant = 0;
  const vide = O.creerLectureJeuPartagee({ lire: async () => null, maintenant: () => maintenant });
  assert.strictEqual(await vide(), null);
  let essais = 0;
  const enPanne = O.creerLectureJeuPartagee({
    lire: async () => {
      essais++;
      throw new Error("jeu fermé");
    },
    maintenant: () => maintenant,
  });
  await assert.rejects(enPanne(), /jeu fermé/);
  maintenant = 2000;
  await assert.rejects(enPanne(), /jeu fermé/);
  assert.strictEqual(essais, 2, "on réessaie à la seconde suivante");
});

test("lecture partagée : branchée sur les deux suivis, ils marchent comme avant", async () => {
  let lectures = 0;
  const lire = O.creerLectureJeuPartagee({ lire: async () => (lectures++, null) });
  const S = require("../sorts.js");
  const affiches = [];
  const objectifs = O.creerSuiviObjectifs({ reglages: () => ({ objectifs: true }), lire, afficher: (l) => affiches.push(l), intervalleMs: 10000 });
  const sorts = S.creerSuiviSorts({ reglages: () => ({ sorts: true }), lire, afficher: (p) => affiches.push(p), intervalleMs: 10000 });
  try {
    objectifs.demarrer();
    sorts.demarrer();
    await new Promise((r) => setTimeout(r, 20));
    assert.strictEqual(lectures, 1);
  } finally {
    objectifs.arreter();
    sorts.arreter();
  }
});
