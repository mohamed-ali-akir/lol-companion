// Tests de l'onglet Stats : extraction des parties (lcu.js), historique local (parties.js)
// et calculs (src/calculs.js).
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { extraireParties } = require("../lcu.js");
const P = require("../parties.js");
const S = require("../src/calculs.js");

/** Date locale (pour les tranches horaires et les jours). */
const le = (annee, mois, jour, heure) => new Date(annee, mois - 1, jour, heure, 0).getTime();
let prochainId = 1;
const partie = (o) => ({
  id: o.id ?? prochainId++, date: o.date ?? le(2026, 9, 28, 20), dureeS: 1200, file: o.file ?? 450,
  championId: o.championId ?? 1, championNom: o.championNom ?? "Annie", victoire: o.victoire ?? true,
  kills: o.k ?? 5, deaths: o.d ?? 5, assists: o.a ?? 5,
});

// --- Extraction depuis l'historique du client ------------------------------------------------

test("extraction : champion, K/D/A, date ; remakes et parties illisibles écartés", () => {
  const moi = (stats, extra = {}) => ({ participants: [{ participantId: 1, championId: 103, stats }], participantIdentities: [], ...extra });
  const historique = {
    games: {
      games: [
        { gameId: 11, gameCreation: 1000, gameDuration: 1500, queueId: 450, ...moi({ win: true, kills: 7, deaths: 0, assists: 12 }) },
        { gameId: 12, gameCreation: 2000, gameDuration: 200, queueId: 450, ...moi({ win: false, kills: 0, deaths: 1, assists: 0 }) }, // remake
        { gameId: 13, gameCreation: 3000, gameDuration: 1500, queueId: 400, ...moi({ win: false, gameEndedInEarlySurrender: true }) },
        { gameId: 14, gameCreation: 4000, gameDuration: 1500, queueId: 400, ...moi({ kills: 1 }) }, // pas de victoire/défaite
        { gameCreation: 5000, gameDuration: 1500, ...moi({ win: true }) }, // pas d'identifiant
        null,
      ],
    },
  };
  assert.deepStrictEqual(extraireParties(historique, "p"), [
    { id: 11, date: 1000, dureeS: 1500, file: 450, championId: 103, victoire: true, kills: 7, deaths: 0, assists: 12 },
  ]);
  assert.deepStrictEqual(extraireParties(null, "p"), []);
});

test("extraction : le joueur est retrouvé par puuid ou, sur un ancien client, par summonerId", () => {
  const partieA10 = (player) => ({
    gameId: 1, gameCreation: 1, gameDuration: 1500, queueId: 400,
    participants: [
      { participantId: 1, championId: 1, stats: { win: false, kills: 0, deaths: 9, assists: 0 } },
      { participantId: 2, championId: 2, stats: { win: true, kills: 9, deaths: 0, assists: 0 } },
    ],
    participantIdentities: [{ participantId: 1, player: { summonerId: 111 } }, { participantId: 2, player }],
  });
  const historique = (player) => ({ games: { games: [partieA10(player)] } });
  assert.strictEqual(extraireParties(historique({ puuid: "moi" }), { puuid: "moi" })[0].championId, 2);
  assert.strictEqual(extraireParties(historique({ summonerId: 222 }), { puuid: "moi", summonerId: 222 })[0].championId, 2);
  assert.deepStrictEqual(extraireParties(historique({ summonerId: 333 }), { puuid: "moi", summonerId: 222 }), []);
});

// --- Historique local : dédoublonnage et fichier abîmé ---------------------------------------------

test("dédoublonnage par identifiant de partie (et par compte)", () => {
  const a = partie({ id: 100 });
  let r = P.fusionnerParties([], "A#1", [a, { ...a }], { noms: new Map([[1, "Annie"]]) }); // doublon dans la même lecture
  assert.strictEqual(r.ajoutees, 1);
  r = P.fusionnerParties(r.parties, "A#1", [a, partie({ id: 101 })]);
  assert.strictEqual(r.ajoutees, 1); // la 100 est déjà là
  r = P.fusionnerParties(r.parties, "B#2", [a]); // même partie, autre compte : gardée séparément
  assert.strictEqual(r.ajoutees, 1);
  assert.strictEqual(r.parties.length, 3);
});

test("limite par compte : on garde les parties les plus récentes", () => {
  const vieilles = [1, 2, 3].map((i) => partie({ id: i, date: i }));
  const r = P.fusionnerParties([], "A#1", [...vieilles, partie({ id: 4, date: 4 })], { max: 2 });
  assert.deepStrictEqual(r.parties.map((p) => p.id), [4, 3]);
});

test("nom du champion gardé (pour afficher les stats même client fermé)", () => {
  const r = P.fusionnerParties([], "A#1", [{ ...partie({ id: 7 }), championNom: undefined, championId: 99 }], { noms: new Map([[99, "Zoé"]]) });
  assert.strictEqual(r.parties[0].championNom, "Zoé");
});

test("fichier : ajout, relecture triée, fichier abîmé, effacement", () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "parties-test-"));
  const h = P.creerHistoriqueParties({ dossier });
  assert.deepStrictEqual(h.partiesDu("A#1"), []);
  assert.strictEqual(h.ajouter("A#1", [partie({ id: 1, date: 10 }), partie({ id: 2, date: 30 })]), 2);
  assert.strictEqual(h.ajouter("A#1", [partie({ id: 2, date: 30 }), partie({ id: 3, date: 20 })]), 1);
  assert.deepStrictEqual(h.partiesDu("A#1").map((p) => p.id), [2, 3, 1]);

  fs.writeFileSync(path.join(dossier, "parties.json"), "{ pas du json");
  assert.deepStrictEqual(h.lire(), []);
  fs.writeFileSync(path.join(dossier, "parties.json"), JSON.stringify([{ riotId: "A#1", id: 5 }, partie({ id: 6 }), null]));
  assert.deepStrictEqual(h.lire(), []); // la partie 6 n'a pas de riotId : écartée aussi
  h.effacer();
  h.effacer();
});

// --- Calculs --------------------------------------------------------------------------------

test("KDA, y compris avec 0 mort (parfait)", () => {
  assert.deepStrictEqual(S.kda(6, 3, 6), { valeur: 4, parfait: false });
  assert.deepStrictEqual(S.kda(4, 0, 8), { valeur: 12, parfait: true });
  assert.deepStrictEqual(S.kda(0, 0, 0), { valeur: 0, parfait: true });
});

test("agrégation par champion : parties, taux de victoire, KDA, moyennes", () => {
  const parties = [
    partie({ championId: 1, championNom: "Annie", victoire: true, k: 10, d: 2, a: 4 }),
    partie({ championId: 1, championNom: "Annie", victoire: false, k: 2, d: 6, a: 8 }),
    partie({ championId: 2, championNom: "Olaf", victoire: true, k: 3, d: 0, a: 5 }),
  ];
  const [annie, olaf] = S.statsParChampion(parties);
  assert.strictEqual(annie.nom, "Annie");
  assert.strictEqual(annie.parties, 2);
  assert.strictEqual(annie.tauxVictoire, 0.5);
  assert.deepStrictEqual(annie.kda, { valeur: 3, parfait: false }); // (12 + 12) / 8
  assert.deepStrictEqual(annie.moyennes, { kills: 6, deaths: 4, assists: 6 });
  assert.deepStrictEqual(olaf.kda, { valeur: 8, parfait: true });
  assert.deepStrictEqual(S.statsParChampion([]), []);
});

test("agrégation par mode, avec les noms des files", () => {
  const parties = [partie({ file: 450 }), partie({ file: 450, victoire: false }), partie({ file: 2400 }), partie({ file: 9999 })];
  const modes = S.statsParMode(parties);
  assert.deepStrictEqual(modes.map((m) => [m.nom, m.parties, m.tauxVictoire]), [
    ["ARAM", 2, 0.5],
    ["ARAM du Chaos", 1, 1],
    ["Autre mode (file 9999)", 1, 1],
  ]);
  assert.strictEqual(S.filtrerParFile(parties, 450).length, 2);
  assert.strictEqual(S.filtrerParFile(parties, "tous").length, 4);
});

test("meilleurs champions : au moins 3 parties, puis taux de victoire, puis KDA", () => {
  const n = (championId, nom, victoires, defaites, k = 5) => [
    ...Array.from({ length: victoires }, () => partie({ championId, championNom: nom, victoire: true, k })),
    ...Array.from({ length: defaites }, () => partie({ championId, championNom: nom, victoire: false, k })),
  ];
  const stats = S.statsParChampion([...n(1, "Annie", 3, 1), ...n(2, "Olaf", 2, 0), ...n(3, "Lux", 3, 1, 20), ...n(4, "Jax", 1, 3)]);
  assert.deepStrictEqual(S.meilleursChampions(stats).map((c) => c.nom), ["Lux", "Annie", "Jax"]); // Olaf : 2 parties seulement
});

test("tranches horaires : matin, après-midi, soir, nuit (et pas assez de parties -> rien)", () => {
  assert.strictEqual(S.trancheDe(le(2026, 9, 28, 6)), "matin");
  assert.strictEqual(S.trancheDe(le(2026, 9, 28, 11)), "matin");
  assert.strictEqual(S.trancheDe(le(2026, 9, 28, 12)), "apresMidi");
  assert.strictEqual(S.trancheDe(le(2026, 9, 28, 18)), "soir");
  assert.strictEqual(S.trancheDe(le(2026, 9, 28, 23)), "soir");
  assert.strictEqual(S.trancheDe(le(2026, 9, 28, 0)), "nuit");
  assert.strictEqual(S.trancheDe(le(2026, 9, 28, 5)), "nuit");

  assert.strictEqual(S.statsParCreneau([partie({})], "tranches"), null); // pas assez de parties
  const parties = [
    ...[1, 2, 3, 4].map(() => partie({ date: le(2026, 9, 28, 21), victoire: true })),
    ...[1, 2].map(() => partie({ date: le(2026, 9, 28, 21), victoire: false })),
    ...[1, 2, 3].map(() => partie({ date: le(2026, 9, 28, 9), victoire: false })),
    partie({ date: le(2026, 9, 28, 2), victoire: true }),
  ];
  const tranches = S.statsParCreneau(parties, "tranches");
  const soir = tranches.find((t) => t.nom.startsWith("Soir"));
  assert.deepStrictEqual([soir.parties, soir.tauxVictoire], [6, 4 / 6]);
  assert.strictEqual(tranches.find((t) => t.nom.startsWith("Matin")).tauxVictoire, 0);
  const nuit = tranches.find((t) => t.nom.startsWith("Nuit"));
  assert.deepStrictEqual([nuit.parties, nuit.tauxVictoire], [1, null]); // 1 partie : pas de taux affiché
});

test("jours de la semaine (lundi en premier)", () => {
  const lundi = le(2026, 9, 28, 20); // le 28/09/2026 est un lundi
  const parties = Array.from({ length: 10 }, (_, i) => partie({ date: lundi, victoire: i < 7 }));
  const jours = S.statsParCreneau(parties, "jours");
  assert.strictEqual(jours[0].nom, "Lundi");
  assert.deepStrictEqual([jours[0].parties, jours[0].tauxVictoire], [10, 0.7]);
  assert.strictEqual(jours[6].parties, 0);
});

test("série en cours : victoires ou défaites depuis la partie la plus récente", () => {
  const serie = (resultats) => resultats.map((v, i) => partie({ date: 1000 - i, victoire: v })); // du plus récent au plus ancien
  assert.deepStrictEqual(S.serieEnCours(serie([true, true, true, false, true])), { victoire: true, longueur: 3 });
  assert.deepStrictEqual(S.serieEnCours(serie([false, true])), { victoire: false, longueur: 1 });
  assert.deepStrictEqual(S.serieEnCours([...serie([false, false, true])].reverse()), { victoire: false, longueur: 2 }); // ordre d'entrée indifférent
  assert.strictEqual(S.serieEnCours([]), null);
});

test("résumé global et tri du tableau", () => {
  const parties = [partie({ championId: 1, championNom: "Annie", victoire: true, date: 5 }), partie({ championId: 2, championNom: "Zed", victoire: false, date: 9 })];
  const r = S.resumeStats(parties);
  assert.deepStrictEqual([r.parties, r.victoires, r.tauxVictoire, r.depuis], [2, 1, 0.5, 5]);
  assert.deepStrictEqual(r.serie, { victoire: false, longueur: 1 });
  assert.strictEqual(S.resumeStats([]), null);

  const champions = S.statsParChampion(parties);
  assert.deepStrictEqual(S.trierChampions(champions, "nom", "asc").map((c) => c.nom), ["Annie", "Zed"]);
  assert.deepStrictEqual(S.trierChampions(champions, "tauxVictoire", "desc").map((c) => c.nom), ["Annie", "Zed"]);
  assert.deepStrictEqual(S.trierChampions(champions, "tauxVictoire", "asc").map((c) => c.nom), ["Zed", "Annie"]);
});

test("géométrie des barres : largeur proportionnelle au taux, lignes sans taux vides", () => {
  const g = S.geometrieBarres(
    [{ nom: "Soir", parties: 6, tauxVictoire: 0.5 }, { nom: "Nuit", parties: 1, tauxVictoire: null }, { nom: "Matin", parties: 0, tauxVictoire: null }],
    { largeur: 300, gauche: 100, droite: 0, hauteurLigne: 20, epaisseur: 10 }
  );
  assert.deepStrictEqual([g.hauteur, g.zone, g.x50], [60, 200, 200]);
  assert.deepStrictEqual(g.barres.map((b) => [b.y, b.largeur, b.texte, b.vide]), [
    [5, 100, "50 %", false],
    [25, 0, "trop peu", true],
    [45, 0, "—", true],
  ]);
});

// --- Import de tout l'historique (pagination) avec un faux client ----------------------------

const https = require("https");
const certificat = require("./fixtures/certificat-test.js");
const { lireToutHistorique } = require("../lcu.js");

/** Faux client dont l'historique contient "nombre" parties ; comportement réglable pour la pagination. */
async function fauxClientHistorique(nombre, { ignorePagination = false, plafond = Infinity } = {}) {
  const jeux = Array.from({ length: nombre }, (_, i) => ({
    gameId: 90000 - i, gameCreation: 1_700_000_000_000 - i * 3_600_000, gameDuration: 1500, queueId: 450,
    participants: [{ participantId: 1, championId: 1 + (i % 5), stats: { win: i % 2 === 0, kills: 1, deaths: 1, assists: 1 } }],
    participantIdentities: [],
  }));
  const demandes = [];
  const serveur = https.createServer(certificat, (req, res) => {
    const url = new URL(req.url, "https://x");
    res.setHeader("Content-Type", "application/json");
    if (url.pathname === "/lol-summoner/v1/current-summoner") return res.end(JSON.stringify({ gameName: "A", tagLine: "1", summonerLevel: 30, puuid: "p" }));
    if (url.pathname.startsWith("/lol-match-history")) {
      let debut = Number(url.searchParams.get("begIndex"));
      let fin = Number(url.searchParams.get("endIndex"));
      demandes.push([debut, fin]);
      if (ignorePagination) [debut, fin] = [0, 19];
      const page = jeux.slice(debut, Math.min(fin + 1, plafond));
      return res.end(JSON.stringify({ games: { games: page } }));
    }
    res.statusCode = 404;
    res.end("{}");
  });
  await new Promise((ok) => serveur.listen(0, "127.0.0.1", ok));
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "faux-lol-"));
  fs.writeFileSync(path.join(dossier, "lockfile"), `LeagueClient:1:${serveur.address().port}:mdp:https`);
  return { dossier, demandes, fermer: () => new Promise((ok) => serveur.close(ok)) };
}

test("import : toutes les pages lues jusqu'à la page vide, progression signalée", async () => {
  const client = await fauxClientHistorique(230);
  try {
    const pages = [];
    const r = await lireToutHistorique(client.dossier, {
      taillePage: 50,
      surPage: (info) => pages.push([info.page, info.parties.length, info.total, info.compte.nom]),
    });
    assert.strictEqual(r.total, 230);
    assert.strictEqual(r.arret, "fin");
    assert.deepStrictEqual(pages, [[0, 50, 50, "A"], [1, 50, 100, "A"], [2, 50, 150, "A"], [3, 50, 200, "A"], [4, 30, 230, "A"]]);
    assert.deepStrictEqual(client.demandes.slice(0, 2), [[0, 49], [50, 99]]);
    assert.strictEqual(r.plusAncienne, 1_700_000_000_000 - 229 * 3_600_000);
    assert.deepStrictEqual(r.compte, { nom: "A", tag: "1" });
  } finally {
    await client.fermer();
  }
});

test("import : le client ignore la pagination -> arrêt, pas de boucle infinie", async () => {
  const client = await fauxClientHistorique(100, { ignorePagination: true });
  try {
    const r = await lireToutHistorique(client.dossier, { taillePage: 50 });
    assert.strictEqual(r.arret, "repetition");
    assert.strictEqual(r.total, 20);
    assert.strictEqual(r.pages, 2);
  } finally {
    await client.fermer();
  }
});

test("import : le client ne remonte pas plus loin qu'un plafond -> arrêt propre", async () => {
  const client = await fauxClientHistorique(500, { plafond: 120 });
  try {
    const r = await lireToutHistorique(client.dossier, { taillePage: 50 });
    assert.strictEqual(r.arret, "fin");
    assert.strictEqual(r.total, 120);
  } finally {
    await client.fermer();
  }
});

test("import : limite de sécurité sur le nombre de pages", async () => {
  const client = await fauxClientHistorique(500);
  try {
    const r = await lireToutHistorique(client.dossier, { taillePage: 50, maxPages: 3 });
    assert.strictEqual(r.arret, "limite");
    assert.strictEqual(r.total, 150);
  } finally {
    await client.fermer();
  }
});

test("import + historique local : relancer l'import n'ajoute aucun doublon", async () => {
  const client = await fauxClientHistorique(120);
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "parties-import-"));
  const h = P.creerHistoriqueParties({ dossier });
  try {
    let nouvelles = 0;
    await lireToutHistorique(client.dossier, { surPage: ({ parties }) => (nouvelles += h.ajouter("A#1", parties)) });
    assert.strictEqual(nouvelles, 120);
    nouvelles = 0;
    await lireToutHistorique(client.dossier, { surPage: ({ parties }) => (nouvelles += h.ajouter("A#1", parties)) });
    assert.strictEqual(nouvelles, 0);
    assert.strictEqual(h.partiesDu("A#1").length, 120);
  } finally {
    await client.fermer();
  }
});

test("période : 30 derniers jours ou tout", () => {
  const maintenant = Date.parse("2026-09-30T20:00:00Z");
  const jour = 24 * 3600 * 1000;
  const parties = [partie({ date: maintenant - 2 * jour }), partie({ date: maintenant - 30 * jour + 1000 }), partie({ date: maintenant - 31 * jour })];
  assert.strictEqual(S.filtrerParPeriode(parties, 30, maintenant).length, 2);
  assert.strictEqual(S.filtrerParPeriode(parties, null, maintenant).length, 3);
  assert.deepStrictEqual(S.filtrerParPeriode(null, 30, maintenant), []);
});
