// Tests du deuxième canal (sondage du client toutes les secondes), du bandeau « pas encore prête » et du journal.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const https = require("https");
const os = require("os");
const path = require("path");
const certificat = require("./fixtures/certificat-test.js");
const S = require("../sondage.js");
const J = require("../journal.js");
const A = require("../acceptation.js");

const attendre = (ms) => new Promise((ok) => setTimeout(ok, ms));

/** Faux client : on change sa phase, son ready check et sa sélection en cours de test. */
async function fauxClient() {
  const etat = { phase: "Lobby", readyCheck: null, session: null, repond: true };
  const acceptations = [];
  const serveur = https.createServer(certificat, (req, res) => {
    const json = (d) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(d));
    };
    if (!etat.repond) {
      res.writeHead(503);
      return res.end();
    }
    if (req.url === "/lol-gameflow/v1/gameflow-phase") return json(etat.phase);
    if (req.url === "/lol-matchmaking/v1/ready-check" && req.method === "GET" && etat.readyCheck) return json(etat.readyCheck);
    if (req.url === "/lol-matchmaking/v1/ready-check/accept" && req.method === "POST") {
      acceptations.push(Date.now());
      etat.readyCheck = { ...etat.readyCheck, playerResponse: "Accepted" };
      res.writeHead(204);
      return res.end();
    }
    if (req.url === "/lol-champ-select/v1/session" && etat.session) return json(etat.session);
    res.writeHead(404);
    res.end();
  });
  await new Promise((ok) => serveur.listen(0, "127.0.0.1", ok));
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "faux-lol-"));
  fs.writeFileSync(path.join(dossier, "lockfile"), `LeagueClient:1:${serveur.address().port}:mdp:https`);
  return { etat, dossier, acceptations, fermer: () => new Promise((ok) => serveur.close(ok)) };
}

test("bandeau : rien si League est fermé ou si tout est prêt ; un message clair sinon", () => {
  assert.deepStrictEqual(S.etatPreparation({ clientLance: false, clientRepond: false, directConnecte: false }), { pret: false, message: null });
  assert.match(S.etatPreparation({ clientLance: true, clientRepond: false, directConnecte: false }).message, /League démarre/);
  assert.match(S.etatPreparation({ clientLance: true, clientRepond: true, directConnecte: false }).message, /l'acceptation automatique fonctionne déjà/);
  assert.deepStrictEqual(S.etatPreparation({ clientLance: true, clientRepond: true, directConnecte: true }), { pret: true, message: null });
});

test("sondage : sans connexion en direct, la partie trouvée est quand même ACCEPTÉE (le cas d'après un redémarrage)", async () => {
  const client = await fauxClient();
  const acceptation = A.creerAcceptation({ reglages: () => ({ actif: true, delaiSecondes: 0 }), accepter: () => A.accepterReadyCheck(client.dossier) });
  const sondage = S.creerSondage({ dossierJeu: () => client.dossier, aReadyCheck: acceptation.surReadyCheck, intervalleMs: 20 });
  try {
    sondage.demarrer();
    await attendre(80);
    client.etat.phase = "ReadyCheck";
    client.etat.readyCheck = { state: "InProgress", playerResponse: "None", timer: 0 };
    await attendre(250);
    assert.strictEqual(client.acceptations.length, 1); // une seule fois, même vue à chaque sondage
  } finally {
    sondage.arreter();
    acceptation.arreter();
    await client.fermer();
  }
});

test("sondage : phase, état du client, sélection transmise puis null en sortant", async () => {
  const client = await fauxClient();
  const vus = { etats: [], phases: [], selections: [], readyChecks: [] };
  const sondage = S.creerSondage({
    dossierJeu: () => client.dossier,
    aEtat: (e) => vus.etats.push(`${e.clientLance}/${e.clientRepond}/${e.phase}`),
    aPhase: (p) => vus.phases.push(p),
    aSelection: (s) => vus.selections.push(s && s.gameId),
    aReadyCheck: (r) => vus.readyChecks.push(r && r.state),
    intervalleMs: 20,
  });
  try {
    sondage.demarrer();
    await attendre(60);
    client.etat.phase = "ChampSelect";
    client.etat.session = { gameId: 42, localPlayerCellId: 0 };
    await attendre(60);
    client.etat.phase = "InProgress";
    await attendre(60);
    assert.strictEqual(vus.etats[0], "true/true/Lobby");
    assert.deepStrictEqual(vus.phases, ["Lobby", "ChampSelect", "InProgress"]);
    assert.ok(vus.selections.includes(42));
    assert.strictEqual(vus.selections.at(-1), null); // sortie de la sélection
    assert.deepStrictEqual(vus.readyChecks, []); // jamais en file : rien
    assert.deepStrictEqual(sondage.etat(), { clientLance: true, clientRepond: true, phase: "InProgress" });
  } finally {
    sondage.arreter();
    await client.fermer();
  }
});

test("sondage : League fermé ou qui ne répond pas encore -> état correct, aucune erreur", async () => {
  const sansClient = S.creerSondage({ dossierJeu: () => path.join(os.tmpdir(), "pas-de-league-ici"), intervalleMs: 20 });
  sansClient.demarrer();
  await attendre(50);
  assert.deepStrictEqual(sansClient.etat(), { clientLance: false, clientRepond: false, phase: null });
  sansClient.arreter();

  const client = await fauxClient();
  client.etat.repond = false; // client qui démarre encore
  const sondage = S.creerSondage({ dossierJeu: () => client.dossier, intervalleMs: 20 });
  try {
    sondage.demarrer();
    await attendre(60);
    assert.deepStrictEqual(sondage.etat(), { clientLance: true, clientRepond: false, phase: null });
    client.etat.repond = true;
    await attendre(60);
    assert.strictEqual(sondage.etat().clientRepond, true);
  } finally {
    sondage.arreter();
    await client.fermer();
  }
});

test("sondage : une erreur dans un rappel est signalée et ne casse pas le sondage", async () => {
  const client = await fauxClient();
  const erreurs = [];
  let phases = 0;
  const sondage = S.creerSondage({
    dossierJeu: () => client.dossier,
    aPhase: () => {
      phases++;
      throw new Error("bug");
    },
    aErreur: (nom, e) => erreurs.push(`${nom} : ${e.message}`),
    intervalleMs: 20,
  });
  try {
    sondage.demarrer();
    await attendre(50);
    client.etat.phase = "Matchmaking";
    await attendre(60);
    assert.strictEqual(phases, 2); // le sondage a continué après l'erreur
    assert.deepStrictEqual(erreurs, ["phase de jeu : bug", "phase de jeu : bug"]);
  } finally {
    sondage.arreter();
    await client.fermer();
  }
});

// --- Journal -------------------------------------------------------------------------------

test("journal : horodatage, une ligne par message, erreurs lisibles", () => {
  const ligne = J.ligneJournal(new Date(2026, 9, 2, 20, 13, 32).getTime(), ["Client :", { phase: "Lobby" }]);
  assert.strictEqual(ligne, '2026-10-02 20:13:32  Client : {"phase":"Lobby"}\n');
  assert.ok(!J.ligneJournal(0, [new Error("a\nb")]).slice(0, -1).includes("\n")); // toujours une seule ligne
});

test("journal : écrit dans le fichier, et garde la taille limitée (ancien journal)", () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "journal-"));
  const fichier = path.join(dossier, "journal.txt");
  const journal = J.creerJournal({ fichier, tailleMax: 100 });
  for (let i = 0; i < 10; i++) journal.ecrire(`message numéro ${i}`);
  assert.ok(fs.readFileSync(fichier, "utf8").includes("message numéro 9"));
  assert.ok(fs.existsSync(path.join(dossier, "journal.ancien.txt")));
  assert.ok(fs.statSync(fichier).size < 200);
  // Un journal impossible à écrire ne casse rien
  J.creerJournal({ fichier: path.join(fichier, "impossible", "journal.txt") }).ecrire("rien");
});
