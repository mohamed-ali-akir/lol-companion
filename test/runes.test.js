// Tests des runes : fonctions pures, puis avec un FAUX client HTTPS. (La logique automatique est testée dans build.test.js.)
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const https = require("https");
const os = require("os");
const path = require("path");
const certificat = require("./fixtures/certificat-test.js");
const R = require("../runes.js");

const AHRI = 103;

// Recommandation au format vérifié sur le vrai client (02/10/2026), raccourcie.
const RECO = {
  position: "MIDDLE",
  primaryPerkStyleId: 8200,
  secondaryPerkStyleId: 8100,
  keystone: { id: 8992, name: "Deathfire Touch" },
  perks: [8992, 8226, 8210, 8237, 8139, 8106, 5005, 5008, 5001].map((id, i) => ({ id, name: `Rune ${i}` })),
};

/** Session : je suis la cellule 2 (Milieu). picks : mes actions "pick" [{ fini }] ; champion : mon champion. */
function session({ champion = AHRI, picks = [{ fini: true }], gameId = 1, role = "middle" } = {}) {
  return {
    gameId,
    localPlayerCellId: 2,
    myTeam: [{ cellId: 2, championId: champion, assignedPosition: role }],
    actions: [picks.map((p, i) => ({ id: 10 + i, actorCellId: 2, type: "pick", completed: p.fini === true, isInProgress: !p.fini }))],
    timer: { phase: "BAN_PICK" },
  };
}

test("mon champion : seulement une fois verrouillé ; en ARAM (pas de pick) tout de suite", () => {
  assert.deepStrictEqual(R.monChampion(session()), { championId: AHRI, role: "middle" });
  assert.strictEqual(R.monChampion(session({ picks: [{ fini: false }] })), null); // seulement survolé
  assert.deepStrictEqual(R.monChampion(session({ picks: [], role: "" })), { championId: AHRI, role: null }); // ARAM
  assert.strictEqual(R.monChampion(session({ champion: 0 })), null);
  assert.strictEqual(R.monChampion(null), null);
  assert.strictEqual(R.monChampion({ myTeam: "?" }), null);
});

test("page depuis une recommandation : 9 runes, styles, nom LoL Companion, sélectionnée", () => {
  assert.deepStrictEqual(R.pageDepuisRecommandation(RECO), {
    name: "LoL Companion",
    primaryStyleId: 8200,
    subStyleId: 8100,
    selectedPerkIds: [8992, 8226, 8210, 8237, 8139, 8106, 5005, 5008, 5001],
    current: true,
  });
  assert.strictEqual(R.pageDepuisRecommandation({ ...RECO, perks: RECO.perks.slice(0, 8) }), null); // incomplète
  assert.strictEqual(R.pageDepuisRecommandation({ ...RECO, primaryPerkStyleId: "?" }), null);
  assert.strictEqual(R.pageDepuisRecommandation(null), null);
});

// --- Avec un faux client HTTPS -----------------------------------------------------------------

/** Faux client : pages existantes, place disponible, carte de la partie. */
async function fauxClient({ pages = [], place = true, carte = 11 } = {}) {
  const requetes = [];
  const serveur = https.createServer(certificat, (req, res) => {
    let corps = "";
    req.on("data", (m) => (corps += m));
    req.on("end", () => {
      requetes.push({ methode: req.method, url: req.url, corps: corps ? JSON.parse(corps) : null });
      const json = (donnees) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(donnees));
      };
      if (req.method === "GET" && req.url === "/lol-perks/v1/pages") return json(pages);
      if (req.method === "GET" && req.url === "/lol-perks/v1/inventory") return json({ canAddCustomPage: place });
      if (req.method === "GET" && req.url === "/lol-gameflow/v1/session") return json({ map: { id: carte } });
      if (req.method === "GET" && req.url.startsWith("/lol-perks/v1/recommended-pages/")) return json([RECO]);
      res.writeHead(req.method === "GET" ? 404 : 204);
      res.end();
    });
  });
  await new Promise((ok) => serveur.listen(0, "127.0.0.1", ok));
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "faux-lol-"));
  fs.writeFileSync(path.join(dossier, "lockfile"), `LeagueClient:1:${serveur.address().port}:mdp:https`);
  const ecritures = () => requetes.filter((r) => r.methode !== "GET");
  return { dossier, requetes, ecritures, fermer: () => new Promise((ok) => serveur.close(ok)) };
}

const PAGE = R.pageDepuisRecommandation(RECO);

test("faux client : recommandations demandées pour le champion, le rôle et la carte de la partie", async () => {
  const client = await fauxClient({ carte: 12 });
  try {
    const pages = await R.lireRecommandations(client.dossier, AHRI, null);
    assert.strictEqual(pages.length, 1);
    assert.ok(client.requetes.some((r) => r.url === "/lol-perks/v1/recommended-pages/champion/103/position/none/map/12"));
  } finally {
    await client.fermer();
  }
});

test("faux client : première fois -> page créée, aucune autre page touchée", async () => {
  const client = await fauxClient({ pages: [{ id: 5, name: "Ma page", isEditable: true }] });
  try {
    await R.appliquerPage(client.dossier, PAGE);
    assert.deepStrictEqual(client.ecritures(), [{ methode: "POST", url: "/lol-perks/v1/pages", corps: PAGE }]);
  } finally {
    await client.fermer();
  }
});

test("faux client : page LoL Companion existante -> remplacée (seulement elle)", async () => {
  const client = await fauxClient({ pages: [{ id: 5, name: "Ma page" }, { id: 8, name: "LoL Companion", isEditable: true }] });
  try {
    await R.appliquerPage(client.dossier, PAGE);
    assert.deepStrictEqual(client.ecritures(), [
      { methode: "DELETE", url: "/lol-perks/v1/pages/8", corps: null },
      { methode: "POST", url: "/lol-perks/v1/pages", corps: PAGE },
    ]);
  } finally {
    await client.fermer();
  }
});

test("faux client : plus de place -> erreur claire, rien de supprimé", async () => {
  const client = await fauxClient({ pages: [{ id: 5, name: "Ma page" }], place: false });
  try {
    await assert.rejects(R.appliquerPage(client.dossier, PAGE), /Plus de place/);
    assert.deepStrictEqual(client.ecritures(), []);
  } finally {
    await client.fermer();
  }
});
