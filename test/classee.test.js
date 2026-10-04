// Tests de l'onglet Classée : lecture du client (classee.js) et calculs (src/calculs.js).
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const https = require("https");
const os = require("os");
const path = require("path");
const certificat = require("./fixtures/certificat-test.js");
const C = require("../classee.js");
const S = require("../src/calculs.js");

// --- Champions possédés ---------------------------------------------------------------

const champ = (id, name, ownership, extra = {}) => ({ id, name, ownership, ...extra });
const JOUABLES = [
  champ(1, "Annie", { owned: true, rental: { rented: false } }),
  champ(2, "Olaf", { owned: true, rental: { rented: false } }, { freeToPlay: true }), // possédé ET dans la rotation : compte
  champ(3, "Galio", { owned: false, rental: { rented: false } }, { freeToPlay: true }), // rotation gratuite : ne compte pas
  champ(4, "Twisted Fate", { owned: true, rental: { rented: true } }), // loué : ne compte pas
  champ(5, "Xin Zhao", { owned: true, xboxGPReward: true }), // prêté (Game Pass) : ne compte pas
  champ(6, "Urgot", { owned: true }), // pas d'info de location : compte
  champ(7, "Sans info"), // pas d'ownership : ne compte pas
  null,
];

test("champions possédés : rotation gratuite, locations et prêts exclus", () => {
  assert.deepStrictEqual([...C.idsPossedes(JOUABLES)].sort(), [1, 2, 6]);
  assert.strictEqual(C.idsPossedes(null).size, 0);
  assert.strictEqual(C.idsPossedes({ pas: "une liste" }).size, 0);
});

// --- Essence bleue ------------------------------------------------------------------------

test("Essence bleue : portefeuille, sinon butin, sinon inconnue", () => {
  assert.strictEqual(C.lireEssenceBleue({ portefeuille: { lol_blue_essence: 4200, RP: 10 } }), 4200);
  assert.strictEqual(C.lireEssenceBleue({ portefeuille: { lol_blue_essence: 0 } }), 0);
  assert.strictEqual(C.lireEssenceBleue({ portefeuille: {}, butin: { CURRENCY_champion: { count: 900 } } }), 900);
  assert.strictEqual(C.lireEssenceBleue({ portefeuille: { lol_blue_essence: "beaucoup" } }), null);
  assert.strictEqual(C.lireEssenceBleue({}), null);
  assert.strictEqual(C.lireEssenceBleue(), null);
});

// --- Prix -------------------------------------------------------------------------------

test("prix en Essence bleue depuis le catalogue (IP ou lol_blue_essence), RP ignorés", () => {
  const catalogue = [
    { itemId: 1, inventoryType: "CHAMPION", prices: [{ currency: "RP", cost: 260 }, { currency: "IP", cost: 450 }] },
    { itemId: 3, inventoryType: "CHAMPION", prices: [{ currency: "lol_blue_essence", cost: 6300 }] },
    { itemId: 4, inventoryType: "CHAMPION", prices: [{ currency: "RP", cost: 975 }] }, // pas de prix en EB
    { itemId: 8, inventoryType: "CHAMPION_SKIN", prices: [{ currency: "IP", cost: 10 }] }, // pas un champion
    { itemId: 9, prices: "?" },
    null,
  ];
  const table = C.tableDesPrix(catalogue);
  assert.deepStrictEqual([...table], [[1, 450], [3, 6300]]);
  assert.strictEqual(C.tableDesPrix(null).size, 0);
});

test("assemblage : tous les champions, possédés ou non, avec leur prix", () => {
  const resume = [{ id: -1, name: "None" }, { id: 1, name: "Annie" }, { id: 3, name: "Galio" }, { id: 10, name: "Kayle" }];
  const liste = C.assemblerChampions({ resume, jouables: JOUABLES, prix: new Map([[3, 6300], [10, 450]]) });
  const galio = liste.find((c) => c.id === 3);
  assert.deepStrictEqual(galio, { id: 3, nom: "Galio", possede: false, prix: 6300 });
  assert.strictEqual(liste.find((c) => c.id === 1).possede, true);
  assert.strictEqual(liste.find((c) => c.id === 1).prix, null);
  assert.ok(!liste.some((c) => c.id <= 0)); // "None" exclu
  assert.deepStrictEqual(liste.map((c) => c.nom).slice(0, 3), ["Annie", "Galio", "Kayle"]); // trié par nom
});

// --- Calculs de la page (calculs.js) ---------------------------------------------------------

const CATALOGUE = [
  { id: 1, nom: "Annie", possede: true, prix: 450 },
  { id: 2, nom: "Garen", possede: false, prix: 450 },
  { id: 3, nom: "Ashe", possede: false, prix: 450 },
  { id: 4, nom: "Ahri", possede: false, prix: 3150 },
  { id: 5, nom: "Yasuo", possede: false, prix: 6300 },
  { id: 6, nom: "Sans prix", possede: false, prix: null },
];

test("checklist de la classée", () => {
  assert.deepStrictEqual(S.checklistClassee({ niveau: 24, possedes: 12 }), {
    niveauOk: false, niveauxManquants: 6, championsOk: false, championsManquants: 8, pret: false,
  });
  assert.strictEqual(S.checklistClassee({ niveau: 30, possedes: 20 }).pret, true);
  assert.strictEqual(S.checklistClassee({ niveau: 45, possedes: 60 }).championsManquants, 0);
  assert.strictEqual(S.checklistClassee({ niveau: undefined, possedes: null }).niveauxManquants, 30);
});

test("champions achetables : du moins cher au plus cher, prix manquant ignoré", () => {
  assert.deepStrictEqual(S.championsAchetables(CATALOGUE, 3150).map((c) => c.nom), ["Ashe", "Garen", "Ahri"]);
});

test("champions achetables : EB juste suffisante", () => {
  assert.deepStrictEqual(S.championsAchetables(CATALOGUE, 450).map((c) => c.nom), ["Ashe", "Garen"]);
  assert.deepStrictEqual(S.championsAchetables(CATALOGUE, 449), []);
});

test("champions achetables : rien d'achetable, liste vide, EB inconnue", () => {
  assert.deepStrictEqual(S.championsAchetables(CATALOGUE, 0), []);
  assert.deepStrictEqual(S.championsAchetables([], 99999), []);
  assert.deepStrictEqual(S.championsAchetables(null, 99999), []);
  assert.deepStrictEqual(S.championsAchetables(CATALOGUE, null), []);
});

test("combien de champions en tout, les moins chers d'abord", () => {
  assert.strictEqual(S.nombreAchetablesEnTout(CATALOGUE, 900), 2); // Ashe + Garen
  assert.strictEqual(S.nombreAchetablesEnTout(CATALOGUE, 4049), 2); // 900 + 3150 = 4050 > 4049
  assert.strictEqual(S.nombreAchetablesEnTout(CATALOGUE, 4050), 3);
  assert.strictEqual(S.nombreAchetablesEnTout(CATALOGUE, 0), 0);
  assert.strictEqual(S.nombreAchetablesEnTout([], 5000), 0);
});

test("coût des N champions les moins chers", () => {
  assert.strictEqual(S.coutDesMoinsChers(CATALOGUE, 0), 0);
  assert.strictEqual(S.coutDesMoinsChers(CATALOGUE, 3), 4050);
  assert.strictEqual(S.coutDesMoinsChers(CATALOGUE, 5), null); // seulement 4 prix connus
});

// --- Icônes ------------------------------------------------------------------------------

test("protocole des icônes : seules les icônes de champions sont autorisées", () => {
  assert.strictEqual(C.routeIcone("lcu-image://champion/266"), "/lol-game-data/assets/v1/champion-icons/266.png");
  assert.strictEqual(C.routeIcone("lcu-image://champion/266/"), "/lol-game-data/assets/v1/champion-icons/266.png");
  assert.strictEqual(C.routeIcone("lcu-image://champion/../../lol-summoner/v1/current-summoner"), null);
  assert.strictEqual(C.routeIcone("lcu-image://autre/266"), null);
  assert.strictEqual(C.routeIcone("https://champion/266"), null);
  assert.strictEqual(C.routeIcone("lcu-image://champion/abc"), null);
  assert.strictEqual(C.routeIcone("pas une adresse"), null);
});

test("cache des icônes : une seule demande par icône, taille limitée", async () => {
  const demandes = [];
  const obtenir = C.creerCacheIcones(async (route) => {
    demandes.push(route);
    return route === "/absente" ? null : { octets: Buffer.from(route), type: "image/png" };
  }, 2);
  await obtenir("/a");
  await obtenir("/a");
  assert.deepStrictEqual(demandes, ["/a"]);
  await obtenir("/absente");
  await obtenir("/absente"); // une image absente n'est pas mise en cache (on réessaiera)
  assert.strictEqual(demandes.filter((d) => d === "/absente").length, 2);
  await obtenir("/b");
  await obtenir("/c"); // dépasse la taille : "/a" est oubliée
  await obtenir("/a");
  assert.strictEqual(demandes.filter((d) => d === "/a").length, 2);
});

// --- Lecture complète avec un faux client ----------------------------------------------------

const MOT_DE_PASSE = "motDePasseDeTest";

async function fauxClient(routes) {
  const requetes = [];
  const serveur = https.createServer(certificat, (req, res) => {
    requetes.push(req.url);
    const reponse = routes[req.url];
    if (reponse === undefined) {
      res.writeHead(404, { "Content-Type": "application/json" });
      return res.end("{}");
    }
    if (Buffer.isBuffer(reponse)) {
      res.writeHead(200, { "Content-Type": "image/png" });
      return res.end(reponse);
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(reponse));
  });
  await new Promise((ok) => serveur.listen(0, "127.0.0.1", ok));
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "faux-lol-"));
  fs.writeFileSync(path.join(dossier, "lockfile"), `LeagueClient:1:${serveur.address().port}:${MOT_DE_PASSE}:https`);
  return { dossier, requetes, fermer: () => new Promise((ok) => serveur.close(ok)) };
}

const PORTEFEUILLE = `/lol-inventory/v1/wallet?currencyTypes=${encodeURIComponent('["lol_blue_essence"]')}`;

test("client : champions, EB et prix lus ensemble", async () => {
  const client = await fauxClient({
    "/lol-champions/v1/owned-champions-minimal": JOUABLES,
    "/lol-game-data/assets/v1/champion-summary.json": [{ id: 1, name: "Annie" }, { id: 3, name: "Galio" }],
    [PORTEFEUILLE]: { lol_blue_essence: 7000 },
    "/lol-catalog/v1/items/CHAMPION": [{ itemId: 3, inventoryType: "CHAMPION", prices: [{ currency: "IP", cost: 6300 }] }],
  });
  try {
    const r = await C.recupererClassee(client.dossier);
    assert.strictEqual(r.possedes, 3);
    assert.strictEqual(r.essenceBleue, 7000);
    assert.strictEqual(r.prixDisponibles, true);
    assert.deepStrictEqual(r.champions.find((c) => c.id === 3), { id: 3, nom: "Galio", possede: false, prix: 6300 });
  } finally {
    await client.fermer();
  }
});

test("client : routes de secours (butin pour l'EB, ancien catalogue pour les prix)", async () => {
  const client = await fauxClient({
    "/lol-champions/v1/owned-champions-minimal": JOUABLES,
    "/lol-player-loot/v1/player-loot-map": { CURRENCY_champion: { count: 1234 } },
    [`/lol-store/v1/catalog?inventoryType=${encodeURIComponent('["CHAMPION"]')}`]: [
      { itemId: 3, inventoryType: "CHAMPION", prices: [{ currency: "IP", cost: 450 }] },
    ],
  });
  try {
    const r = await C.recupererClassee(client.dossier);
    assert.strictEqual(r.essenceBleue, 1234);
    assert.strictEqual(r.champions.find((c) => c.id === 3).prix, 450);
  } finally {
    await client.fermer();
  }
});

test("client : EB et prix introuvables -> pas de plantage, on le signale", async () => {
  const client = await fauxClient({ "/lol-champions/v1/owned-champions-minimal": JOUABLES });
  try {
    const r = await C.recupererClassee(client.dossier);
    assert.strictEqual(r.essenceBleue, null);
    assert.strictEqual(r.prixDisponibles, false);
    assert.strictEqual(r.possedes, 3);
  } finally {
    await client.fermer();
  }
});

test("client : liste des champions indisponible -> erreur claire", async () => {
  const client = await fauxClient({});
  try {
    await assert.rejects(C.recupererClassee(client.dossier), C.ErreurClient || Error);
  } finally {
    await client.fermer();
  }
});

test("client : icône récupérée avec son type, absente -> null", async () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  const client = await fauxClient({ "/lol-game-data/assets/v1/champion-icons/266.png": png });
  try {
    const image = await C.chargerImageClient(client.dossier, "/lol-game-data/assets/v1/champion-icons/266.png");
    assert.deepStrictEqual(image, { octets: png, type: "image/png" });
    assert.strictEqual(await C.chargerImageClient(client.dossier, "/lol-game-data/assets/v1/champion-icons/1.png"), null);
  } finally {
    await client.fermer();
  }
});
