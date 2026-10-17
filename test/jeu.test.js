// Tests de la lecture de la partie en cours (jeu.js), avec un faux jeu sur 127.0.0.1.
const test = require("node:test");
const assert = require("node:assert");
const https = require("https");
const J = require("../jeu.js");
const certificat = require("./fixtures/certificat-test.js");

test("carte : Faille (11) oui, ARAM (12) non, données abîmées non", () => {
  assert.strictEqual(J.estFaille({ map: { id: 11 } }), true);
  assert.strictEqual(J.estFaille({ gameData: { queue: { mapId: 11 } } }), true);
  assert.strictEqual(J.estFaille({ map: { id: 12 }, gameData: { queue: { mapId: 12 } } }), false);
  assert.strictEqual(J.estFaille(null), false);
  assert.strictEqual(J.estFaille({ map: "?" }), false);
});

const JOUEURS = [
  { riotId: "Moi#EUW", riotIdGameName: "Moi", summonerName: "Moi#EUW", team: "ORDER" },
  { riotId: "Lui#EUW", riotIdGameName: "Lui", summonerName: "Lui#EUW", team: "CHAOS" },
];

test("mon équipe : retrouvée par le Riot ID du joueur de ce PC", () => {
  assert.strictEqual(J.monEquipe({ riotId: "Moi#EUW" }, JOUEURS), "ORDER");
  assert.strictEqual(J.monEquipe({ summonerName: "lui#euw" }, JOUEURS), "CHAOS");
  assert.strictEqual(J.monEquipe(null, JOUEURS), null);
  assert.strictEqual(J.monEquipe({ riotId: "Inconnu" }, JOUEURS), null);
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
    reponse.end(JSON.stringify({ gameData: { gameTime: 301.5 }, activePlayer: { riotId: "Moi#EUW" }, allPlayers: JOUEURS, events: { Events: [{ EventName: "GameStart", EventTime: 0 }] } }));
  });
  const lu = await J.lireJeu({ port: jeu.port });
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
  assert.strictEqual(await J.lireJeu({ port: chargement.port }), null);
  await chargement.fermer();

  const casse = await fauxJeu((_q, reponse) => reponse.end("pas du json"));
  assert.strictEqual(await J.lireJeu({ port: casse.port }), null);
  await casse.fermer();

  assert.strictEqual(await J.lireJeu({ port: jeu.port }), null); // jeu fermé : pas d'erreur
  assert.deepStrictEqual(J.lireDonneesJeu({ gameData: { gameTime: 12 } }), { tempsS: 12, evenements: [], joueurs: [], actif: null });
  assert.strictEqual(J.lireDonneesJeu({ gameData: {} }), null);
});

// --- Lecture partagée -----------------------------------------------------------------------------

test("lecture partagée : deux lectures dans la même seconde -> une seule lecture du jeu", async () => {
  let maintenant = 0;
  let lectures = 0;
  const lire = J.creerLectureJeuPartagee({ lire: async () => ({ tempsS: 100 + lectures++ }), maintenant: () => maintenant });
  assert.strictEqual((await lire()).tempsS, 100);
  maintenant = 300; // 0,3 s plus tard : même lecture, temps de jeu avancé de 0,3 s
  assert.strictEqual((await lire()).tempsS, 100.3);
  assert.strictEqual(lectures, 1);
  maintenant = 1000; // seconde suivante : nouvelle lecture
  assert.strictEqual((await lire()).tempsS, 101);
  assert.strictEqual(lectures, 2);
});

test("lecture partagée : une lecture en cours est attendue, pas relancée", async () => {
  let lectures = 0;
  let finir;
  const lire = J.creerLectureJeuPartagee({
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
  const vide = J.creerLectureJeuPartagee({ lire: async () => null, maintenant: () => maintenant });
  assert.strictEqual(await vide(), null);
  let essais = 0;
  const enPanne = J.creerLectureJeuPartagee({
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
