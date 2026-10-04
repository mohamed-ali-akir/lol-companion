// Tests du pick et du ban automatiques : fonctions pures, logique, puis avec un FAUX client HTTPS.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const https = require("https");
const os = require("os");
const path = require("path");
const certificat = require("./fixtures/certificat-test.js");
const S = require("../selection.js");

const attendre = (ms) => new Promise((ok) => setTimeout(ok, ms));

// Champions utilisés dans les tests.
const AHRI = 103, LUX = 99, ZED = 238, YASUO = 157, YONE = 777, LEESIN = 64;

/**
 * Une session de sélection : je suis la cellule 2 (rôle "middle").
 * mesActions : mes actions [{ id, type, enCours, fini, champion }].
 */
function session({ mesActions = [], role = "middle", bans = [], allies = [], ennemis = [], gameId = 1, resteMs } = {}) {
  return {
    gameId,
    localPlayerCellId: 2,
    actions: [
      mesActions.map((a) => ({
        id: a.id,
        actorCellId: 2,
        type: a.type,
        isInProgress: a.enCours !== false,
        completed: a.fini === true,
        championId: a.champion || 0,
      })),
    ],
    myTeam: [{ cellId: 2, assignedPosition: role, championId: 0, championPickIntent: 0 }, ...allies],
    theirTeam: ennemis,
    bans: { myTeamBans: bans, theirTeamBans: [] },
    timer: resteMs === undefined ? {} : { adjustedTimeLeftInPhase: resteMs },
  };
}

const REGLAGES = {
  pickActif: true,
  banActif: true,
  delaiPickSecondes: 0,
  delaiBanSecondes: 0,
  picks: { defaut: [LUX], middle: [AHRI, ZED, YASUO] },
  bans: [YONE, LEESIN],
};

function logique(reglages = REGLAGES, { delaiMs, autorises = null } = {}) {
  const journal = { actions: [], resultats: [] };
  const r = { ...reglages };
  const selection = S.creerSelectionAuto({
    reglages: () => (delaiMs === undefined ? r : { ...r, delaiPickSecondes: delaiMs / 1000, delaiBanSecondes: delaiMs / 1000 }),
    champsAutorises: async () => autorises,
    agir: async (id, champion) => journal.actions.push([id, champion]),
    resultat: (info) => journal.resultats.push(info),
  });
  return { journal, selection, reglages: r };
}

// --- Réglages -----------------------------------------------------------------------------

test("réglages : tout désactivé par défaut, délais 10 s (pick) et 5 s (ban)", () => {
  const r = S.normaliserReglagesSelection(undefined);
  assert.strictEqual(r.pickActif, false);
  assert.strictEqual(r.banActif, false);
  assert.strictEqual(r.delaiPickSecondes, 10);
  assert.strictEqual(r.delaiBanSecondes, 5);
  assert.deepStrictEqual(r.bans, []);
  assert.deepStrictEqual(Object.keys(r.picks), ["defaut", "top", "jungle", "middle", "bottom", "utility"]);
});

test("réglages : 3 champions max, sans doublon ni valeur bizarre, délais bornés", () => {
  const r = S.normaliserReglagesSelection({
    pickActif: "oui",
    delaiPickSecondes: 99,
    delaiBanSecondes: -4,
    picks: { middle: [AHRI, AHRI, 0, "abc", -3, ZED, YASUO, LUX], inconnu: [1] },
    bans: "pas une liste",
  });
  assert.strictEqual(r.pickActif, false);
  assert.strictEqual(r.delaiPickSecondes, 25);
  assert.strictEqual(r.delaiBanSecondes, 0);
  assert.deepStrictEqual(r.picks.middle, [AHRI, ZED, YASUO]);
  assert.strictEqual(r.picks.inconnu, undefined);
  assert.deepStrictEqual(r.bans, []);
  assert.strictEqual(S.normaliserReglagesSelection({ delaiPickSecondes: "" }).delaiPickSecondes, 10);
});

// --- Lecture de la session --------------------------------------------------------------------

test("rôle détecté (avec les noms courants), null sans rôle ou données abîmées", () => {
  assert.strictEqual(S.monRole(session({ role: "middle" })), "middle");
  assert.strictEqual(S.monRole(session({ role: "UTILITY" })), "utility");
  assert.strictEqual(S.monRole(session({ role: "mid" })), "middle");
  assert.strictEqual(S.monRole(session({ role: "" })), null);
  assert.strictEqual(S.monRole(null), null);
  assert.strictEqual(S.monRole({ myTeam: "?" }), null);
});

test("mon action en cours : seulement la mienne, du bon type, pas terminée", () => {
  const s = session({ mesActions: [{ id: 1, type: "ban", fini: true, enCours: false }, { id: 7, type: "pick" }] });
  s.actions.push([{ id: 8, actorCellId: 5, type: "pick", isInProgress: true, completed: false }]); // un coéquipier
  assert.strictEqual(S.monActionEnCours(s, "pick").id, 7);
  assert.strictEqual(S.monActionEnCours(s, "ban"), null);
  assert.strictEqual(S.monActionEnCours({ actions: "?" }, "pick"), null);
});

test("indisponibles : bans, champions pris, survols et intentions des coéquipiers, pas mon survol", () => {
  const s = session({
    bans: [YONE],
    allies: [{ cellId: 3, championId: ZED, championPickIntent: 0 }, { cellId: 4, championId: 0, championPickIntent: LEESIN }],
    ennemis: [{ cellId: 6, championId: YASUO }],
  });
  s.myTeam[0].championId = AHRI; // mon propre survol
  assert.deepStrictEqual([...S.championsIndisponibles(s)].sort(), [YONE, ZED, LEESIN, YASUO].sort());
});

test("liste de picks : rôle d'abord, puis Par défaut ; Par défaut seul sans rôle", () => {
  assert.deepStrictEqual(S.listePourPick(REGLAGES, "middle"), [AHRI, ZED, YASUO, LUX]);
  assert.deepStrictEqual(S.listePourPick(REGLAGES, null), [LUX]);
  assert.deepStrictEqual(S.listePourPick(REGLAGES, "top"), [LUX]); // liste du rôle vide
});

test("choix : le premier disponible et autorisé par le client", () => {
  assert.strictEqual(S.choisirChampion([AHRI, ZED], new Set([AHRI])), ZED);
  assert.strictEqual(S.choisirChampion([AHRI, ZED], new Set(), new Set([ZED])), ZED); // Ahri pas possédée
  assert.strictEqual(S.choisirChampion([AHRI], new Set([AHRI])), null);
});

test("délai : réglé, sauf s'il dépasse le temps restant du tour (2 s de marge)", () => {
  assert.strictEqual(S.delaiEffectif(10, session({ resteMs: 30000 })), 10);
  assert.strictEqual(S.delaiEffectif(10, session({ resteMs: 8000 })), 6);
  assert.strictEqual(S.delaiEffectif(10, session({ resteMs: 1000 })), 0);
  assert.strictEqual(S.delaiEffectif(10, session()), 10);
});

// --- Logique ----------------------------------------------------------------------------------

test("mon tour de choisir : 1er choix du rôle verrouillé, une seule fois", async () => {
  const { journal, selection } = logique();
  const s = session({ mesActions: [{ id: 7, type: "pick" }] });
  selection.surSession(s);
  selection.surSession({ ...s }); // le client renvoie la session à chaque changement
  await attendre(30);
  assert.deepStrictEqual(journal.actions, [[7, AHRI]]);
  assert.deepStrictEqual(journal.resultats[0], { type: "pick", prevu: true, delaiSecondes: 0, role: "middle" });
  assert.deepStrictEqual(journal.resultats[1], { type: "pick", fait: true, championId: AHRI });
});

test("1er choix banni, 2e pris par un coéquipier : le 3e est choisi", async () => {
  const { journal, selection } = logique();
  selection.surSession(session({
    mesActions: [{ id: 7, type: "pick" }],
    bans: [AHRI],
    allies: [{ cellId: 3, championId: ZED }],
  }));
  await attendre(30);
  assert.deepStrictEqual(journal.actions, [[7, YASUO]]);
});

test("toute la liste du rôle indisponible : Par défaut ; rien de dispo : on ne fait rien", async () => {
  const a = logique();
  a.selection.surSession(session({ mesActions: [{ id: 7, type: "pick" }], bans: [AHRI, ZED, YASUO] }));
  await attendre(30);
  assert.deepStrictEqual(a.journal.actions, [[7, LUX]]);

  const b = logique();
  b.selection.surSession(session({ mesActions: [{ id: 7, type: "pick" }], bans: [AHRI, ZED, YASUO, LUX] }));
  await attendre(30);
  assert.deepStrictEqual(b.journal.actions, []);
  assert.deepStrictEqual(b.journal.resultats.at(-1), { type: "pick", fait: false, raison: "indisponibles" });
});

test("mon tour de bannir : 1er ban, sauf s'il est survolé par un coéquipier", async () => {
  const { journal, selection } = logique();
  selection.surSession(session({
    mesActions: [{ id: 2, type: "ban" }],
    allies: [{ cellId: 3, championId: 0, championPickIntent: YONE }],
  }));
  await attendre(30);
  assert.deepStrictEqual(journal.actions, [[2, LEESIN]]);
});

test("phase de préparation (PLANNING) : ban marqué en cours mais on attend BAN_PICK (vu en vrai)", async () => {
  const { journal, selection } = logique();
  const preparation = session({ mesActions: [{ id: 9, type: "ban" }] });
  preparation.timer = { phase: "PLANNING", adjustedTimeLeftInPhase: 12000 };
  selection.surSession(preparation);
  await attendre(30);
  assert.deepStrictEqual(journal.actions, []); // rien pendant la préparation
  selection.surSession({ ...preparation, timer: { phase: "BAN_PICK", adjustedTimeLeftInPhase: 25000 } });
  await attendre(30);
  assert.deepStrictEqual(journal.actions, [[9, YONE]]);
});

test("désactivé (par défaut) : rien du tout", async () => {
  const { journal, selection } = logique(S.normaliserReglagesSelection({ picks: REGLAGES.picks }));
  selection.surSession(session({ mesActions: [{ id: 7, type: "pick" }, { id: 2, type: "ban" }] }));
  await attendre(30);
  assert.deepStrictEqual(journal.actions, []);
  assert.deepStrictEqual(journal.resultats, []);
});

test("ce n'est pas mon tour (action d'un autre) : rien", async () => {
  const { journal, selection } = logique();
  const s = session();
  s.actions = [[{ id: 9, actorCellId: 4, type: "pick", isInProgress: true, completed: false, championId: 0 }]];
  selection.surSession(s);
  await attendre(30);
  assert.deepStrictEqual(journal.actions, []);
});

test("le délai est respecté : rien avant, action après", async () => {
  const { journal, selection } = logique(REGLAGES, { delaiMs: 200 });
  selection.surSession(session({ mesActions: [{ id: 7, type: "pick" }] }));
  await attendre(100);
  assert.strictEqual(journal.actions.length, 0);
  await attendre(200);
  assert.strictEqual(journal.actions.length, 1);
});

test("tu survoles un champion pendant le délai : l'appli ne fait rien", async () => {
  const { journal, selection } = logique(REGLAGES, { delaiMs: 200 });
  selection.surSession(session({ mesActions: [{ id: 7, type: "pick" }] }));
  await attendre(50);
  selection.surSession(session({ mesActions: [{ id: 7, type: "pick", champion: LUX }] }));
  await attendre(300);
  assert.deepStrictEqual(journal.actions, []);
  assert.deepStrictEqual(journal.resultats.at(-1), { type: "pick", fait: false, annule: "repondu" });
});

test("tu avais déjà survolé un champion au début du tour : l'appli ne fait rien", async () => {
  const { journal, selection } = logique();
  selection.surSession(session({ mesActions: [{ id: 7, type: "pick", champion: LUX }] }));
  await attendre(30);
  assert.deepStrictEqual(journal.actions, []);
});

test("sélection annulée (esquive) pendant le délai : rien", async () => {
  const { journal, selection } = logique(REGLAGES, { delaiMs: 200 });
  selection.surSession(session({ mesActions: [{ id: 7, type: "pick" }] }));
  await attendre(50);
  selection.surSession(null);
  await attendre(300);
  assert.deepStrictEqual(journal.actions, []);
  assert.deepStrictEqual(journal.resultats.at(-1), { type: "pick", fait: false, annule: "fini" });
});

test("option coupée pendant le délai : rien", async () => {
  const { journal, selection, reglages } = logique(REGLAGES, { delaiMs: 200 });
  selection.surSession(session({ mesActions: [{ id: 7, type: "pick" }] }));
  await attendre(50);
  reglages.pickActif = false;
  await attendre(300);
  assert.deepStrictEqual(journal.actions, []);
});

test("nouvelle sélection (autre partie) avec le même numéro d'action : traitée à nouveau", async () => {
  const { journal, selection } = logique();
  selection.surSession(session({ mesActions: [{ id: 7, type: "pick" }], gameId: 1 }));
  await attendre(30);
  selection.surSession(session({ mesActions: [{ id: 7, type: "pick" }], gameId: 2 }));
  await attendre(30);
  assert.strictEqual(journal.actions.length, 2);
});

test("champion non autorisé par le client (pas possédé) : on passe au suivant", async () => {
  const { journal, selection } = logique(REGLAGES, { autorises: [ZED, LUX] });
  selection.surSession(session({ mesActions: [{ id: 7, type: "pick" }] }));
  await attendre(30);
  assert.deepStrictEqual(journal.actions, [[7, ZED]]);
});

test("erreur du client : signalée, pas de plantage ni de nouvel essai", async () => {
  const resultats = [];
  let essais = 0;
  const selection = S.creerSelectionAuto({
    reglages: () => REGLAGES,
    agir: async () => {
      essais++;
      throw new Error("refusé");
    },
    resultat: (info) => resultats.push(info),
  });
  const s = session({ mesActions: [{ id: 7, type: "pick" }] });
  selection.surSession(s);
  await attendre(30);
  selection.surSession(s);
  await attendre(30);
  assert.strictEqual(essais, 1);
  assert.deepStrictEqual(resultats.at(-1), { type: "pick", fait: false, erreur: "refusé" });
});

test("données bizarres du client : ignorées", async () => {
  const { journal, selection } = logique();
  for (const bizarre of [undefined, "?", 42, {}, { localPlayerCellId: 2, actions: "?" }, { localPlayerCellId: 2, actions: [[null, 3]] }]) {
    selection.surSession(bizarre);
  }
  await attendre(30);
  assert.deepStrictEqual(journal.actions, []);
});

// --- Avec un faux client HTTPS -----------------------------------------------------------------

/**
 * Faux client : l'action n° 7 existe. verrouillePar dit quelle requête verrouille vraiment :
 * "patch" (PATCH completed: true), "complete" (POST .../complete) ou "rien" (le client répond 204 sans verrouiller).
 */
async function fauxClient({ verrouillePar = "patch" } = {}) {
  const requetes = [];
  let verrouillee = false;
  const serveur = https.createServer(certificat, (req, res) => {
    let corps = "";
    req.on("data", (m) => (corps += m));
    req.on("end", () => {
      const json = corps ? JSON.parse(corps) : null;
      if (req.method === "GET" && req.url === "/lol-champ-select/v1/session") {
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify(session({ mesActions: [{ id: 7, type: "pick", fini: verrouillee }] })));
      }
      requetes.push({ methode: req.method, url: req.url, corps: json });
      if (!req.url.startsWith("/lol-champ-select/v1/session/actions/7")) {
        res.writeHead(404);
        return res.end();
      }
      if (verrouillePar === "patch" && req.method === "PATCH" && json.completed === true) verrouillee = true;
      if (verrouillePar === "complete" && req.url.endsWith("/complete")) verrouillee = true;
      res.writeHead(204);
      res.end();
    });
  });
  await new Promise((ok) => serveur.listen(0, "127.0.0.1", ok));
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "faux-lol-"));
  fs.writeFileSync(path.join(dossier, "lockfile"), `LeagueClient:1:${serveur.address().port}:mdp:https`);
  return { dossier, requetes, fermer: () => new Promise((ok) => serveur.close(ok)) };
}

const VITE = { attenteMs: 10 };

test("faux client : PATCH { championId, completed: true }, verrouillage vérifié, rien de plus", async () => {
  const client = await fauxClient();
  try {
    await S.effectuerAction(client.dossier, 7, AHRI, VITE);
    assert.deepStrictEqual(client.requetes, [
      { methode: "PATCH", url: "/lol-champ-select/v1/session/actions/7", corps: { championId: AHRI, completed: true } },
    ]);
  } finally {
    await client.fermer();
  }
});

test("faux client : PATCH répond OK sans verrouiller (vu en vrai) -> secours POST complete", async () => {
  const client = await fauxClient({ verrouillePar: "complete" });
  try {
    await S.effectuerAction(client.dossier, 7, AHRI, VITE);
    assert.deepStrictEqual(client.requetes.at(-1), { methode: "POST", url: "/lol-champ-select/v1/session/actions/7/complete", corps: null });
  } finally {
    await client.fermer();
  }
});

test("faux client : jamais verrouillé -> erreur claire (pas de faux « OK »)", async () => {
  const client = await fauxClient({ verrouillePar: "rien" });
  try {
    await assert.rejects(S.effectuerAction(client.dossier, 7, AHRI, VITE), /pas verrouillé/);
  } finally {
    await client.fermer();
  }
});

test("faux client : action refusée -> erreur claire", async () => {
  const client = await fauxClient();
  try {
    await assert.rejects(S.effectuerAction(client.dossier, 99, AHRI, VITE), /refusé le champion \(code 404\)/);
  } finally {
    await client.fermer();
  }
});
