// Tests de l'acceptation automatique : logique seule, puis avec un FAUX client (WebSocket + HTTPS).
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const https = require("https");
const os = require("os");
const path = require("path");
const { WebSocketServer } = require("ws");
const certificat = require("./fixtures/certificat-test.js");
const A = require("../acceptation.js");
const { surveillerClient, EVENEMENT_READY_CHECK } = require("../surveillance.js");

const attendre = (ms) => new Promise((ok) => setTimeout(ok, ms));
const enCours = (reponse = "None") => ({ state: "InProgress", playerResponse: reponse, timer: 1 });
const FINI = { state: "Invalid", playerResponse: "None" };

/** Logique d'acceptation avec des réglages modifiables et un journal de ce qui se passe. */
function logique(reglages = { actif: true, delaiSecondes: 0.05 }) {
  const journal = { acceptations: 0, trouvees: [], resultats: [] };
  const r = { ...reglages };
  const acceptation = A.creerAcceptation({
    reglages: () => ({ ...r, delaiSecondes: 0 }), // sans délai ; les tests de délai utilisent logiqueAvecDelai
    accepter: async () => journal.acceptations++,
    partieTrouvee: (info) => journal.trouvees.push(info),
    resultat: (info) => journal.resultats.push(info),
  });
  return { journal, acceptation, reglages: r };
}

// Pour les tests de délai : un vrai délai court (200 ms), les événements arrivent PENDANT ce délai.
function logiqueAvecDelai(delaiMs, actif = true) {
  const journal = { acceptations: 0, trouvees: [], resultats: [] };
  const reglages = { actif, notifier: true };
  const acceptation = A.creerAcceptation({
    reglages: () => ({ ...reglages, delaiSecondes: delaiMs / 1000 }),
    accepter: async () => journal.acceptations++,
    partieTrouvee: (info) => journal.trouvees.push(info),
    resultat: (info) => journal.resultats.push(info),
  });
  return { journal, acceptation, reglages };
}

test("réglages : désactivé par défaut, délai borné entre 0 et 8 s, notification activée", () => {
  assert.deepStrictEqual(A.normaliserReglages(undefined), { actif: false, delaiSecondes: 2, notifier: true });
  assert.deepStrictEqual(A.normaliserReglages({ actif: "oui", delaiSecondes: 99, notifier: false }), {
    actif: false, delaiSecondes: 8, notifier: false,
  });
  assert.strictEqual(A.normaliserReglages({ delaiSecondes: -3 }).delaiSecondes, 0);
  assert.strictEqual(A.normaliserReglages({ delaiSecondes: "abc" }).delaiSecondes, 2);
  assert.strictEqual(A.normaliserReglages({ actif: true }).actif, true);
});

test("délai arrondi au dixième de seconde", () => {
  assert.strictEqual(A.normaliserReglages({ delaiSecondes: 2.44 }).delaiSecondes, 2.4);
  assert.strictEqual(A.normaliserReglages({ delaiSecondes: 0.1 }).delaiSecondes, 0.1);
});

test("le délai est vraiment respecté : rien avant, acceptation après", async () => {
  const { journal, acceptation } = logiqueAvecDelai(200);
  acceptation.surReadyCheck(enCours());
  await attendre(100);
  assert.strictEqual(journal.acceptations, 0); // pas encore : on te laisse le temps de refuser
  await attendre(200);
  assert.strictEqual(journal.acceptations, 1);
});

test("partie trouvée : acceptée après le délai, une seule fois", async () => {
  const { journal, acceptation } = logique();
  acceptation.surReadyCheck(enCours());
  acceptation.surReadyCheck({ ...enCours(), timer: 2 }); // le client renvoie l'état chaque seconde
  acceptation.surReadyCheck({ ...enCours(), timer: 3 });
  await attendre(50);
  assert.strictEqual(journal.acceptations, 1);
  assert.deepStrictEqual(journal.resultats, [{ accepte: true }]);
  assert.deepStrictEqual(journal.trouvees, [{ autoActif: true, delaiSecondes: 0 }]);
});

test("réglage coupé : on prévient, mais on n'accepte pas", async () => {
  const { journal, acceptation } = logique({ actif: false });
  acceptation.surReadyCheck(enCours());
  await attendre(50);
  assert.strictEqual(journal.acceptations, 0);
  assert.deepStrictEqual(journal.trouvees, [{ autoActif: false, delaiSecondes: 0 }]);
});

test("déjà refusé (pendant le délai) : jamais d'acceptation", async () => {
  const { journal, acceptation } = logiqueAvecDelai(200);
  acceptation.surReadyCheck(enCours());
  await attendre(50);
  acceptation.surReadyCheck(enCours("Declined"));
  await attendre(300);
  assert.strictEqual(journal.acceptations, 0);
  assert.deepStrictEqual(journal.resultats, [{ accepte: false, annule: "repondu" }]); // l'appli le signale
});

test("déjà refusé dès le début : jamais d'acceptation", async () => {
  const { journal, acceptation } = logique();
  acceptation.surReadyCheck(enCours("Declined"));
  await attendre(50);
  assert.strictEqual(journal.acceptations, 0);
});

test("déjà accepté à la main : on ne renvoie rien", async () => {
  const { journal, acceptation } = logiqueAvecDelai(200);
  acceptation.surReadyCheck(enCours());
  await attendre(50);
  acceptation.surReadyCheck(enCours("Accepted"));
  await attendre(300);
  assert.strictEqual(journal.acceptations, 0);
});

test("ready check annulé pendant le délai (quelqu'un a refusé) : pas d'acceptation", async () => {
  const { journal, acceptation } = logiqueAvecDelai(200);
  acceptation.surReadyCheck(enCours());
  await attendre(50);
  acceptation.surReadyCheck(FINI);
  await attendre(300);
  assert.strictEqual(journal.acceptations, 0);
  assert.deepStrictEqual(journal.resultats, [{ accepte: false, annule: "fini" }]);
  acceptation.surReadyCheck(null); // plus de ready check du tout : pas de plantage
});

test("réglage coupé pendant le délai : pas d'acceptation", async () => {
  const { journal, acceptation, reglages } = logiqueAvecDelai(200);
  acceptation.surReadyCheck(enCours());
  await attendre(50);
  reglages.actif = false;
  await attendre(300);
  assert.strictEqual(journal.acceptations, 0);
});

test("deux ready checks à la suite : un nouveau ready check est accepté à nouveau", async () => {
  const { journal, acceptation } = logique();
  acceptation.surReadyCheck(enCours());
  await attendre(30);
  acceptation.surReadyCheck(FINI); // quelqu'un d'autre a refusé : retour en file
  acceptation.surReadyCheck(enCours()); // nouvelle partie trouvée
  await attendre(30);
  assert.strictEqual(journal.acceptations, 2);
});

test("quelqu'un refuse puis nouvelle partie SANS état intermédiaire (Accepted -> None) : acceptée à nouveau", async () => {
  const { journal, acceptation } = logique();
  acceptation.surReadyCheck(enCours());
  await attendre(30);
  acceptation.surReadyCheck({ ...enCours("Accepted"), timer: 5 }); // on a accepté, un autre joueur refuse...
  acceptation.surReadyCheck({ ...enCours(), timer: 0 }); // ...nouveau ready check : le timer du client repart de 0
  await attendre(30);
  assert.strictEqual(journal.acceptations, 2);
  assert.strictEqual(journal.trouvees.length, 2); // la nouvelle partie est bien signalée
});

test("même cas, mais tu avais REFUSÉ (Declined -> None) : la nouvelle partie est une nouvelle décision", async () => {
  const { journal, acceptation } = logique();
  acceptation.surReadyCheck({ ...enCours("Declined"), timer: 4 });
  acceptation.surReadyCheck({ ...enCours(), timer: 0 });
  await attendre(30);
  assert.strictEqual(journal.acceptations, 1);
});

test("deux canaux : une réponse EN RETARD (« None » après « Accepted », timer pas reparti) est ignorée", async () => {
  const { journal, acceptation } = logique();
  acceptation.surReadyCheck({ ...enCours(), timer: 1 });
  await attendre(30);
  acceptation.surReadyCheck({ ...enCours("Accepted"), timer: 2 }); // connexion en direct : accepté
  acceptation.surReadyCheck({ ...enCours(), timer: 2 }); // sondage parti juste avant : encore « None »
  acceptation.surReadyCheck({ ...enCours("Accepted"), timer: 3 });
  await attendre(30);
  assert.strictEqual(journal.acceptations, 1); // pas de 2e acceptation
  assert.strictEqual(journal.trouvees.length, 1); // ni de 2e notification « Partie trouvée »
});

test("deux canaux : la même partie vue deux fois (connexion en direct + sondage) -> une seule acceptation", async () => {
  const { journal, acceptation } = logique();
  for (const timer of [0, 0, 1, 1, 2]) acceptation.surReadyCheck({ ...enCours(), timer }); // les 2 canaux se mélangent
  await attendre(30);
  assert.strictEqual(journal.acceptations, 1);
  assert.strictEqual(journal.trouvees.length, 1);
});

test("Accepted ou Declined annule toujours une acceptation prévue, même après un enchaînement", async () => {
  const { journal, acceptation } = logiqueAvecDelai(200);
  acceptation.surReadyCheck(enCours());
  acceptation.surReadyCheck({ ...enCours("Accepted"), timer: 5 });
  acceptation.surReadyCheck({ ...enCours(), timer: 0 }); // nouveau ready check, acceptation prévue
  await attendre(50);
  acceptation.surReadyCheck(enCours("Declined")); // tu refuses pendant le délai
  await attendre(300);
  assert.strictEqual(journal.acceptations, 0);
});

test("journal facultatif : appelé pour chaque décision", async () => {
  const lignes = [];
  const acceptation = A.creerAcceptation({
    reglages: () => ({ actif: true, delaiSecondes: 0 }),
    accepter: async () => {},
    journal: (...m) => lignes.push(m.join(" ")),
  });
  acceptation.surReadyCheck(enCours());
  await attendre(30);
  assert.ok(lignes.some((l) => l.includes("NOUVEAU")));
  assert.ok(lignes.some((l) => l.includes("OK")));
});

test("l'ancien délai ne s'applique pas au ready check suivant", async () => {
  const { journal, acceptation } = logiqueAvecDelai(200);
  acceptation.surReadyCheck(enCours());
  await attendre(50);
  acceptation.surReadyCheck(FINI);
  acceptation.surReadyCheck(enCours("Declined")); // nouveau ready check, refusé tout de suite
  await attendre(300);
  assert.strictEqual(journal.acceptations, 0);
});

test("erreur du client à l'acceptation : signalée, pas de plantage ni de nouvel essai", async () => {
  const resultats = [];
  let essais = 0;
  const acceptation = A.creerAcceptation({
    reglages: () => ({ actif: true, delaiSecondes: 0 }),
    accepter: async () => {
      essais++;
      throw new Error("refusé");
    },
    resultat: (info) => resultats.push(info),
  });
  acceptation.surReadyCheck(enCours());
  acceptation.surReadyCheck({ ...enCours(), timer: 2 });
  await attendre(50);
  assert.strictEqual(essais, 1);
  assert.deepStrictEqual(resultats, [{ accepte: false, erreur: "refusé" }]);
});

test("données bizarres du client : ignorées", async () => {
  const { journal, acceptation } = logique();
  for (const bizarre of [undefined, "?", 42, {}, { state: "InProgress" }, { playerResponse: "None" }]) acceptation.surReadyCheck(bizarre);
  await attendre(30);
  assert.strictEqual(journal.acceptations, 0);
});

// --- Fenêtre au premier plan ----------------------------------------------------------------

test("programme au premier plan : client ou jeu League reconnus", () => {
  assert.strictEqual(A.estProgrammeLeague("LeagueClientUx\r\n"), true);
  assert.strictEqual(A.estProgrammeLeague("League of Legends"), true);
  assert.strictEqual(A.estProgrammeLeague("chrome"), false);
  assert.strictEqual(A.estProgrammeLeague(""), false);
  assert.strictEqual(A.estProgrammeLeague(undefined), false);
});

test("détection du premier plan : hors Windows ou en cas d'erreur, on prévient quand même", async () => {
  assert.strictEqual(await A.leagueAuPremierPlan({ plateforme: "linux" }), false);
  const echec = (_c, _a, _o, rappel) => rappel(new Error("pas de PowerShell"), "");
  assert.strictEqual(await A.leagueAuPremierPlan({ plateforme: "win32", executer: echec }), false);
  const league = (_c, _a, _o, rappel) => rappel(null, "LeagueClientUx\r\n");
  assert.strictEqual(await A.leagueAuPremierPlan({ plateforme: "win32", executer: league }), true);
});

// --- Avec un faux client : WebSocket (événements) + HTTPS (acceptation) ----------------------------

async function fauxClient() {
  const acceptations = [];
  const serveur = https.createServer(certificat, (req, res) => {
    if (req.method === "POST" && req.url === A.ROUTE_ACCEPTER) {
      acceptations.push(req.headers.authorization);
      res.writeHead(204);
      return res.end();
    }
    if (req.url === "/lol-gameflow/v1/gameflow-phase") {
      res.writeHead(200); // client prêt (la surveillance attend cette réponse avant de s'abonner)
      return res.end('"Lobby"');
    }
    res.writeHead(404);
    res.end();
  });
  const ws = new WebSocketServer({ server: serveur });
  await new Promise((ok) => serveur.listen(0, "127.0.0.1", ok));
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "faux-lol-"));
  fs.writeFileSync(path.join(dossier, "lockfile"), `LeagueClient:1:${serveur.address().port}:mdp:https`);
  return {
    dossier,
    acceptations,
    connectes: () => ws.clients.size,
    envoyer(donnees, eventType = "Update") {
      for (const c of ws.clients) c.send(JSON.stringify([8, EVENEMENT_READY_CHECK, { data: donnees, eventType }]));
    },
    fermer() {
      for (const c of ws.clients) c.terminate();
      ws.close();
      return new Promise((ok) => serveur.close(ok));
    },
  };
}

/** Branche surveillance + acceptation comme dans main.js. */
function brancher(client, reglages) {
  const acceptation = A.creerAcceptation({ reglages: () => reglages, accepter: () => A.accepterReadyCheck(client.dossier) });
  const surveillance = surveillerClient({
    dossierJeu: () => client.dossier,
    aRafraichir: () => {},
    aReadyCheck: acceptation.surReadyCheck,
    delais: { reconnexionMs: 50, apresPartieMs: 30, antiRebondMs: 20 },
  });
  return () => {
    surveillance.arreter();
    acceptation.arreter();
  };
}

async function attendreConnexion(client) {
  for (let i = 0; i < 100 && client.connectes() === 0; i++) await attendre(20);
  await attendre(50); // abonnements envoyés
}

test("faux client : partie trouvée -> POST d'acceptation après le délai (avec le mot de passe)", async () => {
  const client = await fauxClient();
  const arreter = brancher(client, { actif: true, delaiSecondes: 0 });
  try {
    await attendreConnexion(client);
    client.envoyer(enCours());
    client.envoyer({ ...enCours(), timer: 2 });
    await attendre(200);
    assert.strictEqual(client.acceptations.length, 1);
    assert.strictEqual(client.acceptations[0], "Basic " + Buffer.from("riot:mdp").toString("base64"));
  } finally {
    arreter();
    await client.fermer();
  }
});

test("faux client : réglage coupé -> aucun POST", async () => {
  const client = await fauxClient();
  const arreter = brancher(client, { actif: false, delaiSecondes: 0 });
  try {
    await attendreConnexion(client);
    client.envoyer(enCours());
    await attendre(200);
    assert.strictEqual(client.acceptations.length, 0);
  } finally {
    arreter();
    await client.fermer();
  }
});

test("faux client : Accepted puis nouvelle partie directement -> deux POST", async () => {
  const client = await fauxClient();
  const arreter = brancher(client, { actif: true, delaiSecondes: 0 });
  try {
    await attendreConnexion(client);
    client.envoyer(enCours());
    await attendre(150);
    client.envoyer({ ...enCours("Accepted"), timer: 5 });
    client.envoyer({ ...enCours(), timer: 0 }); // nouveau ready check : le timer repart de 0
    await attendre(200);
    assert.strictEqual(client.acceptations.length, 2);
  } finally {
    arreter();
    await client.fermer();
  }
});

test("faux client : refusé ou annulé pendant le délai -> aucun POST", async () => {
  const client = await fauxClient();
  const arreter = brancher(client, { actif: true, delaiSecondes: 1 });
  try {
    await attendreConnexion(client);
    client.envoyer(enCours());
    client.envoyer(enCours("Declined"));
    client.envoyer(null, "Delete"); // puis le ready check disparaît
    await attendre(1300);
    assert.strictEqual(client.acceptations.length, 0);
  } finally {
    arreter();
    await client.fermer();
  }
});

test("Mac : League au premier plan avec lsappinfo (sans autorisation), sinon false", async () => {
  assert.strictEqual(A.nomDepuisLsappinfo('"LSDisplayName"="League of Legends"\n'), "League of Legends");
  assert.strictEqual(A.nomDepuisLsappinfo('"name"="LeagueClientUx"'), "LeagueClientUx");
  assert.strictEqual(A.nomDepuisLsappinfo("rien d'utile"), null);
  assert.strictEqual(A.estProgrammeLeague("LeagueofLegends"), true);
  // Faux lsappinfo : "front" donne l'appli au premier plan, "info" donne son nom.
  const faux = (nom, { front = "ASN:0x0-0x1a01a:\n" } = {}) => {
    const appels = [];
    const executer = (programme, args, options, rappel) => {
      appels.push([programme, ...args]);
      if (args[0] === "front") return rappel(null, front);
      return rappel(null, `"LSDisplayName"="${nom}"\n`);
    };
    return { appels, executer };
  };
  const league = faux("League of Legends");
  assert.strictEqual(await A.leagueAuPremierPlan({ plateforme: "darwin", executer: league.executer }), true);
  assert.deepStrictEqual(league.appels, [["lsappinfo", "front"], ["lsappinfo", "info", "-only", "name", "ASN:0x0-0x1a01a:"]]);
  assert.strictEqual(await A.leagueAuPremierPlan({ plateforme: "darwin", executer: faux("Safari").executer }), false);
  assert.strictEqual(await A.leagueAuPremierPlan({ plateforme: "darwin", executer: faux("League of Legends", { front: "" }).executer }), false);
  const echec = (programme, args, options, rappel) => rappel(new Error("introuvable"));
  assert.strictEqual(await A.leagueAuPremierPlan({ plateforme: "darwin", executer: echec }), false);
  const plante = () => {
    throw new Error("execFile a planté");
  };
  assert.strictEqual(await A.leagueAuPremierPlan({ plateforme: "darwin", executer: plante }), false);
});
