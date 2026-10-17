// Tests de la surveillance en direct, avec un FAUX client League :
// un serveur HTTPS + WebSocket sur 127.0.0.1, avec un certificat auto-signé, comme le vrai.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const https = require("https");
const os = require("os");
const path = require("path");
const { WebSocketServer } = require("ws");
const certificat = require("./fixtures/certificat-test.js");
const {
  surveillerClient,
  lireMessage,
  EVENEMENT_PHASE,
  EVENEMENT_COMPTE,
  EVENEMENT_READY_CHECK,
  EVENEMENT_SELECTION,
} = require("../surveillance.js");

const MOT_DE_PASSE = "motDePasseDeTest";
const AUTH_ATTENDUE = "Basic " + Buffer.from(`riot:${MOT_DE_PASSE}`).toString("base64");
const DELAIS = { reconnexionMs: 50, apresPartieMs: 30, antiRebondMs: 20 };

const attendre = (ms) => new Promise((ok) => setTimeout(ok, ms));

/** Attend qu'une condition devienne vraie (ou échoue au bout de 2 s). */
async function attendreQue(condition) {
  for (let i = 0; i < 100; i++) {
    if (condition()) return;
    await attendre(20);
  }
  assert.fail("condition jamais remplie");
}

/**
 * Lance un faux client League. Renvoie de quoi lui faire envoyer des événements.
 * pret : le client répond-il déjà à /lol-gameflow/v1/gameflow-phase ? (modifiable avec demarre())
 */
async function fauxClient(port = 0, { pret = true } = {}) {
  let estPret = pret;
  const serveur = https.createServer(certificat, (req, res) => {
    const ok = estPret && req.url === "/lol-gameflow/v1/gameflow-phase";
    res.writeHead(ok ? 200 : 404, { "Content-Type": "application/json" });
    res.end(ok ? '"None"' : "{}");
  });
  const ws = new WebSocketServer({
    server: serveur,
    verifyClient: ({ req }) => req.headers.authorization === AUTH_ATTENDUE, // refuse les mauvais mots de passe
  });
  const abonnements = [];
  let protocole = null;
  ws.on("connection", (socket, requete) => {
    protocole = requete.headers["sec-websocket-protocol"];
    socket.on("message", (m) => abonnements.push(JSON.parse(m.toString())));
  });
  await new Promise((ok) => serveur.listen(port, "127.0.0.1", ok));

  return {
    port: serveur.address().port,
    abonnements,
    connectes: () => ws.clients.size,
    demarre() {
      estPret = true;
    },
    protocole: () => protocole,
    envoyer(evenement, data) {
      for (const client of ws.clients) client.send(JSON.stringify([8, evenement, { data, eventType: "Update" }]));
    },
    fermer() {
      for (const client of ws.clients) client.terminate();
      ws.close();
      return new Promise((ok) => serveur.close(ok));
    },
  };
}

function fauxDossierJeu(port, motDePasse = MOT_DE_PASSE) {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "faux-lol-"));
  if (port) fs.writeFileSync(path.join(dossier, "lockfile"), `LeagueClient:1:${port}:${motDePasse}:https`);
  return dossier;
}

/** Démarre la surveillance et enregistre tout ce qu'elle signale. */
function surveiller(dossier) {
  const journal = { raisons: [], connexions: [] };
  const surveillance = surveillerClient({
    dossierJeu: () => dossier,
    aRafraichir: (raison) => journal.raisons.push(raison),
    aChangementConnexion: (etat) => journal.connexions.push(etat),
    delais: DELAIS,
  });
  return { journal, surveillance };
}

test("lecture des messages du client (format WAMP)", () => {
  assert.deepStrictEqual(lireMessage(`[8,"${EVENEMENT_PHASE}",{"data":"EndOfGame","eventType":"Update"}]`), {
    evenement: EVENEMENT_PHASE,
    donnees: "EndOfGame",
    type: "Update",
  });
  assert.strictEqual(lireMessage("pas du json"), null);
  assert.strictEqual(lireMessage("[0,\"bienvenue\",1]"), null); // message d'accueil : ignoré
});

test("cloisons : si la sélection plante, l'acceptation reçoit quand même « partie trouvée »", async () => {
  const client = await fauxClient();
  const recus = [];
  const erreurs = [];
  let appels = 0;
  const surveillance = surveillerClient({
    dossierJeu: () => fauxDossierJeu(client.port),
    aRafraichir: () => {},
    aSelection: () => {
      appels++;
      if (appels === 1) throw new Error("bug dans le pick/ban"); // plante tout de suite
      return Promise.reject(new Error("bug plus tard dans le build")); // plante dans une promesse
    },
    aReadyCheck: (etat) => recus.push(etat),
    aErreur: (nom, erreur) => erreurs.push(`${nom} : ${erreur.message}`),
    delais: DELAIS,
  });
  try {
    await attendreQue(() => client.abonnements.length === 4);
    client.envoyer(EVENEMENT_SELECTION, { localPlayerCellId: 1 });
    client.envoyer(EVENEMENT_SELECTION, { localPlayerCellId: 1 });
    client.envoyer(EVENEMENT_READY_CHECK, { state: "InProgress", playerResponse: "None" });
    await attendreQue(() => recus.length === 1 && erreurs.length === 2);
    assert.deepStrictEqual(recus, [{ state: "InProgress", playerResponse: "None" }]);
    assert.deepStrictEqual(erreurs, [
      "sélection des champions : bug dans le pick/ban",
      "sélection des champions : bug plus tard dans le build",
    ]);
  } finally {
    surveillance.arreter();
    await client.fermer();
  }
});

test("cloisons : si l'acceptation plante, les messages suivants sont toujours lus", async () => {
  const client = await fauxClient();
  const recus = [];
  const surveillance = surveillerClient({
    dossierJeu: () => fauxDossierJeu(client.port),
    aRafraichir: () => {},
    aReadyCheck: (etat) => {
      recus.push(etat && etat.timer);
      if (etat && etat.timer === 0) throw new Error("plantage");
    },
    aErreur: () => {}, // pas de bruit dans les tests
    delais: DELAIS,
  });
  try {
    await attendreQue(() => client.abonnements.length === 4);
    client.envoyer(EVENEMENT_READY_CHECK, { state: "InProgress", playerResponse: "None", timer: 0 });
    client.envoyer(EVENEMENT_READY_CHECK, { state: "InProgress", playerResponse: "None", timer: 1 });
    await attendreQue(() => recus.length === 2);
    assert.deepStrictEqual(recus, [0, 1]);
  } finally {
    surveillance.arreter();
    await client.fermer();
  }
});

test("reconnecter() : la connexion en direct est refaite et les abonnements renvoyés (chien de garde)", async () => {
  const client = await fauxClient();
  const { journal, surveillance } = surveiller(fauxDossierJeu(client.port));
  try {
    await attendreQue(() => client.abonnements.length === 4);
    surveillance.reconnecter();
    await attendreQue(() => client.abonnements.length === 8); // nouvelle connexion, nouveaux abonnements
    assert.deepStrictEqual(journal.connexions, [true, false, true]);
  } finally {
    surveillance.arreter();
    await client.fermer();
  }
});

test("vérification « client prêt » qui ne répond jamais : on n'attend pas indéfiniment", async () => {
  const client = await fauxClient();
  let appels = 0;
  const surveillance = surveillerClient({
    dossierJeu: () => fauxDossierJeu(client.port),
    aRafraichir: () => {},
    clientPret: () => {
      appels++;
      return appels === 1 ? new Promise(() => {}) : Promise.resolve(true); // la 1re ne répond jamais
    },
    delais: { ...DELAIS, delaiPretMs: 50 },
  });
  try {
    await attendreQue(() => client.abonnements.length === 4); // la 2e tentative a abouti
    assert.ok(appels >= 2);
  } finally {
    surveillance.arreter();
    await client.fermer();
  }
});

test("client qui démarre encore : pas d'abonnement avant qu'il soit prêt, puis abonnement normal", async () => {
  const client = await fauxClient(0, { pret: false });
  const { journal, surveillance } = surveiller(fauxDossierJeu(client.port));
  try {
    await attendre(200); // plusieurs tentatives (toutes les 50 ms) pendant que le client démarre
    assert.strictEqual(client.connectes(), 0); // pas de WebSocket ouvert trop tôt
    assert.deepStrictEqual(journal.connexions, []);
    client.demarre();
    await attendreQue(() => client.abonnements.length === 4);
    assert.deepStrictEqual(journal.connexions, [true]);
  } finally {
    surveillance.arreter();
    await client.fermer();
  }
});

test("connexion : mot de passe, protocole wamp et abonnements", async () => {
  const client = await fauxClient();
  const { journal, surveillance } = surveiller(fauxDossierJeu(client.port));
  try {
    await attendreQue(() => client.abonnements.length === 4);
    assert.deepStrictEqual(client.abonnements, [
      [5, EVENEMENT_PHASE],
      [5, EVENEMENT_COMPTE],
      [5, EVENEMENT_READY_CHECK],
      [5, EVENEMENT_SELECTION],
    ]);
    assert.strictEqual(client.protocole(), "wamp");
    assert.deepStrictEqual(journal.connexions, [true]);
    // À la connexion, on relit le compte une fois.
    await attendreQue(() => journal.raisons.length === 1);
    assert.deepStrictEqual(journal.raisons, ["client-lance"]);
  } finally {
    surveillance.arreter();
    await client.fermer();
  }
});

test("fin de partie -> une relecture, les autres phases sont ignorées", async () => {
  const client = await fauxClient();
  const { journal, surveillance } = surveiller(fauxDossierJeu(client.port));
  try {
    await attendreQue(() => journal.raisons.length === 1); // relecture de connexion
    client.envoyer(EVENEMENT_PHASE, "ChampSelect");
    client.envoyer(EVENEMENT_PHASE, "InProgress");
    await attendre(100);
    assert.strictEqual(journal.raisons.length, 1);

    client.envoyer(EVENEMENT_PHASE, "EndOfGame");
    await attendreQue(() => journal.raisons.length === 2);
    assert.strictEqual(journal.raisons[1], "fin-de-partie");
  } finally {
    surveillance.arreter();
    await client.fermer();
  }
});

test("plusieurs événements d'affilée -> une seule relecture", async () => {
  const client = await fauxClient();
  const { journal, surveillance } = surveiller(fauxDossierJeu(client.port));
  try {
    await attendreQue(() => journal.raisons.length === 1);
    client.envoyer(EVENEMENT_PHASE, "EndOfGame");
    client.envoyer(EVENEMENT_COMPTE, { summonerLevel: 25 });
    client.envoyer(EVENEMENT_COMPTE, { summonerLevel: 25 });
    await attendre(200);
    assert.deepStrictEqual(journal.raisons, ["client-lance", "fin-de-partie"]);
  } finally {
    surveillance.arreter();
    await client.fermer();
  }
});

test("client fermé puis relancé -> l'appli se reconnecte toute seule", async () => {
  const client = await fauxClient();
  const dossier = fauxDossierJeu(client.port);
  const { journal, surveillance } = surveiller(dossier);
  let relance;
  try {
    await attendreQue(() => journal.connexions.length === 1);
    await client.fermer();
    await attendreQue(() => journal.connexions.length === 2);
    assert.deepStrictEqual(journal.connexions, [true, false]);

    // Le client revient, avec un nouveau port (il écrit un nouveau lockfile).
    relance = await fauxClient();
    fs.writeFileSync(path.join(dossier, "lockfile"), `LeagueClient:2:${relance.port}:${MOT_DE_PASSE}:https`);
    await attendreQue(() => journal.connexions.length === 3);
    assert.deepStrictEqual(journal.connexions, [true, false, true]);
  } finally {
    surveillance.arreter();
    if (relance) await relance.fermer();
  }
});

test("client pas encore lancé -> on attend, puis on se connecte quand il arrive", async () => {
  const dossier = fauxDossierJeu(); // pas de lockfile
  const { journal, surveillance } = surveiller(dossier);
  let client;
  try {
    await attendre(150);
    assert.deepStrictEqual(journal.connexions, []);

    client = await fauxClient();
    fs.writeFileSync(path.join(dossier, "lockfile"), `LeagueClient:1:${client.port}:${MOT_DE_PASSE}:https`);
    await attendreQue(() => journal.raisons.includes("client-lance"));
  } finally {
    surveillance.arreter();
    if (client) await client.fermer();
  }
});

test("mauvais mot de passe -> pas de connexion, pas de plantage", async () => {
  const client = await fauxClient();
  const { journal, surveillance } = surveiller(fauxDossierJeu(client.port, "ancienMotDePasse"));
  try {
    await attendre(200);
    assert.deepStrictEqual(journal.connexions, []);
    assert.deepStrictEqual(journal.raisons, []);
  } finally {
    surveillance.arreter();
    await client.fermer();
  }
});

test("portefeuille, champions possédés, missions : plus lus (onglets Classée et Missions supprimés le 17/10/2026)", async () => {
  const client = await fauxClient();
  const { journal, surveillance } = surveiller(fauxDossierJeu(client.port));
  try {
    await attendreQue(() => journal.raisons.length === 1); // relecture de connexion
    client.envoyer("OnJsonApiEvent_lol-inventory_v1_wallet", { lol_blue_essence: 5000 });
    client.envoyer("OnJsonApiEvent_lol-champions_v1_owned-champions-minimal", []);
    client.envoyer("OnJsonApiEvent_lol-missions_v1_missions", []);
    await attendre(250);
    assert.deepStrictEqual(journal.raisons, ["client-lance"], "aucune relecture de plus");
    client.envoyer(EVENEMENT_PHASE, "EndOfGame");
    await attendreQue(() => journal.raisons.length === 2);
    assert.deepStrictEqual(journal.raisons, ["client-lance", "fin-de-partie"]);
  } finally {
    surveillance.arreter();
    await client.fermer();
  }
});
