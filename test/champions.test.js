// Tests des noms et icônes des champions (champions.js), avec un faux client sur 127.0.0.1.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const https = require("https");
const os = require("os");
const path = require("path");
const certificat = require("./fixtures/certificat-test.js");
const C = require("../champions.js");

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

// --- Faux client ---------------------------------------------------------------------------

async function fauxClient(routes) {
  const serveur = https.createServer(certificat, (req, res) => {
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
  fs.writeFileSync(path.join(dossier, "lockfile"), `LeagueClient:1:${serveur.address().port}:motDePasseDeTest:https`);
  return { dossier, fermer: () => new Promise((ok) => serveur.close(ok)) };
}

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

test("client : noms des champions ; entrées abîmées ignorées ; indisponibles -> liste vide", async () => {
  const client = await fauxClient({
    "/lol-game-data/assets/v1/champion-summary.json": [{ id: -1, name: "Aucun" }, { id: 103, name: "Ahri" }, null, { id: 62, name: "Wukong" }, { id: 7 }],
  });
  try {
    assert.deepStrictEqual([...(await C.lireNomsChampions(client.dossier))], [[103, "Ahri"], [62, "Wukong"]]);
  } finally {
    await client.fermer();
  }
  const vide = await fauxClient({});
  try {
    assert.strictEqual((await C.lireNomsChampions(vide.dossier)).size, 0);
  } finally {
    await vide.fermer();
  }
});
