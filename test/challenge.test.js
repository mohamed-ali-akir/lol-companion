// Tests du challenge Arena (onglet Challenge) : top 3 en Arena avec tous les champions, dans l'ordre alphabétique.
//  - ordre alphabétique, champions faits / restants, prochain champion (challenge.js) ;
//  - place en Arena lue de façon tolérante dans l'historique du client (lcu.js) et gardée dans parties.json (parties.js) ;
//  - pick automatique du prochain champion en Arena, avec les garde-fous de selection.js ;
//  - lecture de la place sur un FAUX client HTTPS (127.0.0.1).
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const https = require("https");
const os = require("os");
const path = require("path");
const certificat = require("./fixtures/certificat-test.js");
const C = require("../challenge.js");
const S = require("../selection.js");
const P = require("../parties.js");
const { extraireParties, recupererCompteClient } = require("../lcu.js");

const attendre = (ms) => new Promise((ok) => setTimeout(ok, ms));
const AATROX = 266, AHRI = 103, AKALI = 84, ELISE = 60, EVELYNN = 28, KAISA = 145, ZED = 238;
const NOMS = new Map([
  [ZED, "Zed"], [AHRI, "Ahri"], [EVELYNN, "Evelynn"], [KAISA, "Kai'Sa"], [AATROX, "Aatrox"], [ELISE, "Élise"], [AKALI, "Akali"],
]);
const ORDRE = [AATROX, AHRI, AKALI, ELISE, EVELYNN, KAISA, ZED];

let prochainId = 1;
/** Partie enregistrée (format de parties.json) : Arena 2 contre 2 par défaut. */
const partie = ({ championId, file = 1700, place, date = 1000 } = {}) => ({
  id: prochainId++, riotId: "Moi#EUW", date, dureeS: 1200, file, championId, victoire: place <= 4, kills: 1, deaths: 1, assists: 1,
  ...(place === undefined ? {} : { place }),
});

// --- Liste des champions et progression ---------------------------------------------------------

test("ordre alphabétique français : accents et majuscules ignorés, données abîmées écartées", () => {
  const noms = new Map([...NOMS, [0, "Zéro"], [-1, "None"], [999, ""], [998, null], ["7", "Texte"]]);
  assert.deepStrictEqual(C.championsDansLOrdre(noms).map((c) => c.id), ORDRE, "Élise entre Akali et Evelynn");
  assert.deepStrictEqual(C.championsDansLOrdre(null), []);
  assert.deepStrictEqual(C.championsDansLOrdre([[1, "Annie"]]), [], "pas une Map");
});

test("progression : top 3 en Arena = fait ; prochain = premier pas fait dans l'ordre", () => {
  const parties = [
    partie({ championId: AATROX, place: 1 }),
    partie({ championId: AKALI, place: 3, file: 1750 }), // Arena 3x6
    partie({ championId: AHRI, place: 4 }), // 4e : pas un top 3
    partie({ championId: ELISE, place: 2, file: 1710 }),
  ];
  const p = C.progressionChallenge(NOMS, parties);
  assert.deepStrictEqual([p.total, p.faits, p.restants], [7, 3, 4]);
  assert.deepStrictEqual(p.prochain, { id: AHRI, nom: "Ahri", essais: 1 }, "1 partie d'Arena déjà tentée avec Ahri");
  assert.deepStrictEqual(p.champions.filter((c) => c.fait).map((c) => c.id), [AATROX, AKALI, ELISE]);
  assert.deepStrictEqual(C.ordreDesPicks(p), [AHRI, EVELYNN, KAISA, ZED]);
});

test("progression : un top 3 hors ordre compte quand même, le prochain reste le premier non fait", () => {
  const p = C.progressionChallenge(NOMS, [partie({ championId: ZED, place: 2 })]);
  assert.strictEqual(p.faits, 1);
  assert.deepStrictEqual(p.prochain, { id: AATROX, nom: "Aatrox", essais: 0 });
  assert.strictEqual(p.champions.at(-1).fait, true);
});

test("parties avant de réussir : jusqu'au premier top 3 compris ; essais ratés pour un champion pas fait ; moyenne", () => {
  const parties = [
    partie({ championId: AHRI, place: 6, date: 1 }),
    partie({ championId: AHRI, place: 5, date: 2 }),
    partie({ championId: AHRI, place: 2, date: 3 }), // réussi à la 3e partie
    partie({ championId: AHRI, place: 1, date: 4 }), // après la réussite : ne compte plus
    partie({ championId: ZED, place: 1, date: 9 }), // réussi du premier coup
    partie({ championId: AKALI, place: 7, date: 5 }),
    partie({ championId: AKALI, place: 4, date: 6 }), // 2 essais ratés
    partie({ championId: AKALI, place: 1, date: 7, file: 2400 }), // ARAM Mayhem : pas une partie du challenge
  ];
  const e = C.essaisParChampion(parties);
  assert.deepStrictEqual([e.get(AHRI), e.get(ZED), e.get(AKALI), e.get(AATROX)], [3, 1, 2, undefined]);
  const p = C.progressionChallenge(NOMS, parties);
  const champion = (id) => p.champions.find((c) => c.id === id);
  assert.deepStrictEqual([champion(AHRI).fait, champion(AHRI).essais], [true, 3]);
  assert.deepStrictEqual([champion(AKALI).fait, champion(AKALI).essais], [false, 2]);
  assert.strictEqual(champion(AATROX).essais, 0);
  assert.strictEqual(p.moyenneEssais, 2, "(3 + 1) / 2 champions réussis");
  assert.strictEqual(C.progressionChallenge(NOMS, []).moyenneEssais, null);
});

test("progression : seulement l'Arena, et une place lisible entre 1 et 3", () => {
  const parties = [
    partie({ championId: AATROX, place: 1, file: 2400 }), // ARAM Mayhem : ne compte pas
    partie({ championId: AATROX, place: 1, file: null }),
    partie({ championId: AATROX }), // place absente (partie enregistrée avant le 20/10/2026)
    partie({ championId: AATROX, place: 0 }),
    partie({ championId: AATROX, place: "1" }),
    partie({ championId: AATROX, place: 2.5 }),
    partie({ championId: null, place: 1 }),
    null,
    "abîmée",
  ];
  const p = C.progressionChallenge(NOMS, parties);
  assert.strictEqual(p.faits, 0);
  assert.strictEqual(p.prochain.id, AATROX);
  assert.strictEqual(C.progressionChallenge(NOMS, undefined).faits, 0);
});

test("progression : meilleure place gardée, et la première fois qu'elle a été obtenue", () => {
  const parties = [partie({ championId: AHRI, place: 3, date: 100 }), partie({ championId: AHRI, place: 1, date: 900 }), partie({ championId: AHRI, place: 1, date: 500 })];
  const ahri = C.progressionChallenge(NOMS, parties).champions.find((c) => c.id === AHRI);
  assert.deepStrictEqual([ahri.place, ahri.date], [1, 500]);
});

test("progression : tout fait -> plus de prochain ; liste vide ; champion inconnu ignoré", () => {
  const toutes = ORDRE.map((championId) => partie({ championId, place: 1 }));
  const fini = C.progressionChallenge(NOMS, [...toutes, partie({ championId: 4242, place: 1 })]);
  assert.deepStrictEqual([fini.faits, fini.restants, fini.total, fini.prochain], [7, 0, 7, null]);
  assert.deepStrictEqual(C.ordreDesPicks(fini), []);
  const vide = C.progressionChallenge(new Map(), toutes);
  assert.deepStrictEqual([vide.total, vide.faits, vide.prochain], [0, 0, null]);
  assert.deepStrictEqual(C.ordreDesPicks(null), []);
});

test("réglages : pick automatique désactivé par défaut, délai de 10 s borné", () => {
  assert.deepStrictEqual(C.normaliserReglagesChallenge(undefined), { pickActif: false, delaiSecondes: 10 });
  assert.deepStrictEqual(C.normaliserReglagesChallenge({ pickActif: "oui", delaiSecondes: 99 }), { pickActif: false, delaiSecondes: 25 });
  assert.deepStrictEqual(C.normaliserReglagesChallenge({ pickActif: true, delaiSecondes: -3 }), { pickActif: true, delaiSecondes: 0 });
});

// --- Place lue dans l'historique du client, gardée dans parties.json -------------------------------

const historique = (...parties) => ({ games: { games: parties } });
const arena = (gameId, stats, queueId = 1700) => ({
  gameId, gameCreation: 1000 + gameId, gameDuration: 1300, queueId,
  participants: [{ participantId: 1, championId: AHRI, stats: { win: true, kills: 1, deaths: 2, assists: 3, ...stats } }],
  participantIdentities: [],
});

test("lecture tolérante : place gardée seulement si c'est un entier plausible", () => {
  const parties = extraireParties(
    historique(arena(1, { subteamPlacement: 2 }), arena(2, { subteamPlacement: 0 }), arena(3, { subteamPlacement: "3" }), arena(4, {}),
      arena(5, { subteamPlacement: 99 }), arena(6, { subteamPlacement: 6 }, 1750)),
    "p"
  );
  assert.deepStrictEqual(parties.map((p) => p.place), [2, undefined, undefined, undefined, undefined, 6]);
  assert.ok(!("place" in parties[1]), "place 0 (autres modes) : pas de champ");
});

test("parties.json : place abîmée oubliée, partie gardée", () => {
  const [a, b, c] = P.partiesValides([partie({ championId: AHRI, place: 1 }), partie({ championId: AHRI, place: -2 }), partie({ championId: AHRI, place: "1" })]);
  assert.deepStrictEqual([a.place, "place" in b, "place" in c], [1, false, false]);
});

test("parties.json : une Arena déjà enregistrée sans place la reçoit quand le client la relit (sans rien remplacer)", () => {
  const ancienne = { ...partie({ championId: AHRI }), cs: 10, or: 9000 }; // enregistrée avant le 20/10/2026
  const relue = { ...ancienne, cs: 999, place: 2 };
  const { parties, completees } = P.completerDetails([ancienne], "Moi#EUW", [relue]);
  assert.strictEqual(completees, 1);
  assert.deepStrictEqual([parties[0].place, parties[0].cs], [2, 10], "la place est ajoutée, les CS déjà gardés ne changent pas");
  assert.strictEqual(P.completerDetails(parties, "Moi#EUW", [relue]).completees, 0, "déjà complète");
});

/** Lance un faux client League (HTTPS sur 127.0.0.1) qui répond aux routes données. */
async function fauxClient(routes) {
  const serveur = https.createServer(certificat, (requete, reponse) => {
    const corps = routes[requete.url.split("?")[0]];
    reponse.writeHead(corps === undefined ? 404 : 200, { "Content-Type": "application/json" });
    reponse.end(JSON.stringify(corps === undefined ? {} : corps));
  });
  await new Promise((ok) => serveur.listen(0, "127.0.0.1", ok));
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "faux-lol-challenge-"));
  fs.writeFileSync(path.join(dossier, "lockfile"), `LeagueClient:1:${serveur.address().port}:mdp:https`);
  return { dossier, fermer: () => new Promise((ok) => serveur.close(ok)) };
}

test("faux client : la place d'une Arena est lue dans l'historique, comme sur le vrai client", async () => {
  const client = await fauxClient({
    "/lol-summoner/v1/current-summoner": { gameName: "Moi", tagLine: "EUW", summonerLevel: 30, puuid: "p" },
    "/lol-match-history/v1/products/lol/current-summoner/matches": historique(
      { ...arena(10, { subteamPlacement: 3, playerSubteamId: 2 }, 1750), participantIdentities: [{ participantId: 1, player: { puuid: "p" } }] },
      { ...arena(11, { subteamPlacement: 0 }, 2400), participantIdentities: [{ participantId: 1, player: { puuid: "p" } }] }
    ),
  });
  try {
    const { parties } = await recupererCompteClient(client.dossier);
    assert.deepStrictEqual(parties.map((p) => [p.file, p.place]), [[1750, 3], [2400, undefined]]);
  } finally {
    await client.fermer();
  }
});

// --- Pick automatique du prochain champion (selection.js + challenge.js) ----------------------------

/** Session de sélection : je suis la cellule 2, mon pick (action 7) est en cours. */
function sessionArena({ monChampion = 0, allies = [], ennemis = [], bans = [], gameId = 5 } = {}) {
  return {
    gameId,
    localPlayerCellId: 2,
    actions: [[{ id: 7, actorCellId: 2, type: "pick", isInProgress: true, completed: false, championId: monChampion }]],
    myTeam: [{ cellId: 2, assignedPosition: "", championId: monChampion, championPickIntent: 0 }, ...allies],
    theirTeam: ennemis,
    bans: { myTeamBans: bans, theirTeamBans: [] },
    timer: {},
  };
}

/** Pick automatique branché comme dans main.js, avec un challenge et de faux services. */
function picker({ reglagesChallenge = { pickActif: true, delaiSecondes: 0 }, reglagesSelection = {}, arena = true, autorises = null, parties = [] } = {}) {
  const journal = { actions: [], resultats: [], lectures: 0 };
  const challenge = C.creerChallenge({
    reglages: () => reglagesChallenge,
    nomsChampions: async () => NOMS,
    parties: () => parties,
    lirePartie: async () => {
      journal.lectures++;
      return { gameData: { queue: arena ? { id: 1700, gameMode: "CHERRY" } : { id: 420, gameMode: "CLASSIC" } } };
    },
  });
  const selection = S.creerSelectionAuto({
    reglages: () => reglagesSelection,
    champsAutorises: async () => autorises,
    agir: async (id, champion) => journal.actions.push([id, champion]),
    resultat: (info) => journal.resultats.push(info),
    pickPrioritaire: () => challenge.pickPrioritaire(),
  });
  const surSession = async (session) => {
    await challenge.preparer(session);
    selection.surSession(session);
  };
  return { journal, challenge, surSession, selection };
}

test("pick du challenge : prend le prochain champion pas encore fait, en Arena", async () => {
  const { journal, surSession } = picker({ parties: [partie({ championId: AATROX, place: 1 })] });
  await surSession(sessionArena());
  await attendre(20);
  assert.deepStrictEqual(journal.actions, [[7, AHRI]]);
  assert.strictEqual(journal.resultats[0].source, "challenge");
  assert.deepStrictEqual(journal.resultats.at(-1), { type: "pick", fait: true, championId: AHRI, source: "challenge" });
});

test("pick du challenge : champion banni, pris, survolé par un coéquipier ou pas possédé -> le suivant dans l'ordre", async () => {
  const { journal, surSession } = picker({ autorises: [AKALI, ELISE, EVELYNN, KAISA, ZED, AHRI] }); // pas Aatrox
  await surSession(sessionArena({ bans: [AHRI], allies: [{ cellId: 3, championId: 0, championPickIntent: AKALI }], ennemis: [{ cellId: 6, championId: ELISE }] }));
  await attendre(20);
  assert.deepStrictEqual(journal.actions, [[7, EVELYNN]]);
});

test("pick du challenge : rien si tu survoles toi-même, et aucun champion disponible -> à toi de jouer", async () => {
  const a = picker();
  await a.surSession(sessionArena({ monChampion: ZED }));
  await attendre(20);
  assert.deepStrictEqual(a.journal.actions, []);
  assert.deepStrictEqual(a.journal.resultats, [{ type: "pick", fait: false, annule: "repondu", source: "challenge" }]);

  const b = picker({ autorises: [9999] });
  await b.surSession(sessionArena());
  await attendre(20);
  assert.deepStrictEqual(b.journal.actions, []);
  assert.strictEqual(b.journal.resultats.at(-1).raison, "indisponibles");
});

test("pick du challenge : délai avant d'agir, et tu peux encore choisir toi-même pendant ce délai", async () => {
  const { journal, surSession } = picker({ reglagesChallenge: { pickActif: true, delaiSecondes: 0.1 } });
  await surSession(sessionArena());
  assert.deepStrictEqual(journal.resultats[0], { type: "pick", prevu: true, delaiSecondes: 0.1, role: null, source: "challenge" });
  await surSession(sessionArena({ monChampion: KAISA })); // tu survoles Kai'Sa pendant le délai
  await attendre(200);
  assert.deepStrictEqual(journal.actions, []);
  assert.strictEqual(journal.resultats.at(-1).annule, "repondu");
});

test("pick du challenge : seulement en Arena et si la case est cochée ; sinon l'onglet Sélection s'applique", async () => {
  // Pas une Arena : le challenge ne fait rien, le pick de l'onglet Sélection (désactivé ici) non plus.
  const faille = picker({ arena: false });
  await faille.surSession(sessionArena());
  await attendre(20);
  assert.deepStrictEqual(faille.journal.actions, []);
  // Pas une Arena, pick de l'onglet Sélection actif : sa liste à lui.
  const selection = picker({ arena: false, reglagesSelection: { pickActif: true, delaiPickSecondes: 0, picks: { defaut: [ZED] } } });
  await selection.surSession(sessionArena());
  await attendre(20);
  assert.deepStrictEqual(selection.journal.actions, [[7, ZED]]);
  assert.ok(!("source" in selection.journal.resultats.at(-1)));
  // Arena mais case décochée (défaut) : rien du challenge.
  const decoche = picker({ reglagesChallenge: {} });
  await decoche.surSession(sessionArena());
  await attendre(20);
  assert.deepStrictEqual(decoche.journal.actions, []);
  // Arena, les deux cochés : le challenge prime sur les listes de l'onglet Sélection.
  const lesDeux = picker({ reglagesSelection: { pickActif: true, delaiPickSecondes: 0, picks: { defaut: [ZED] } } });
  await lesDeux.surSession(sessionArena());
  await attendre(20);
  assert.deepStrictEqual(lesDeux.journal.actions, [[7, AATROX]]);
});

test("pick du challenge : tout est fait -> l'onglet Sélection reprend la main", async () => {
  const toutes = ORDRE.map((championId) => partie({ championId, place: 1 }));
  const { journal, surSession } = picker({ parties: toutes, reglagesSelection: { pickActif: true, delaiPickSecondes: 0, picks: { defaut: [ZED] } } });
  await surSession(sessionArena());
  await attendre(20);
  assert.deepStrictEqual(journal.actions, [[7, ZED]]);
});

test("service : une seule lecture du mode par sélection, oubliée à la fin ; erreur de lecture = pas d'Arena", async () => {
  const { journal, challenge, surSession } = picker();
  await surSession(sessionArena({ gameId: 8 }));
  await surSession(sessionArena({ gameId: 8 }));
  assert.strictEqual(journal.lectures, 1);
  await surSession(null); // sélection finie
  assert.strictEqual(challenge.pickPrioritaire(), null);
  await surSession(sessionArena({ gameId: 9 }));
  assert.strictEqual(journal.lectures, 2);

  const casse = C.creerChallenge({ reglages: () => ({ pickActif: true }), nomsChampions: async () => NOMS, parties: () => [], lirePartie: async () => { throw new Error("client fermé"); } });
  await casse.preparer({ gameId: 1 });
  assert.strictEqual(casse.pickPrioritaire(), null);
});

test("service : progression pour la page, ou message clair quand le client est fermé", async () => {
  const ouvert = C.creerChallenge({ reglages: () => undefined, nomsChampions: async () => NOMS, parties: () => [partie({ championId: AHRI, place: 2 })], lirePartie: async () => null });
  const r = await ouvert.lire();
  assert.deepStrictEqual([r.ok, r.faits, r.restants, r.prochain.nom, r.reglages.pickActif], [true, 1, 6, "Aatrox", false]);
  const ferme = C.creerChallenge({ reglages: () => ({}), nomsChampions: async () => new Map(), parties: () => [], lirePartie: async () => null });
  const f = await ferme.lire();
  assert.strictEqual(f.ok, false);
  assert.match(f.erreur, /client League/);
});
