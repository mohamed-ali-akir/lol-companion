// Tests des pings de sorts lus dans le chat (pings.js) : textes VRAIMENT lus par l'OCR sur des captures du 16/10/2026.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const P = require("../pings.js");
const I = require("../image.js");

// Adversaires de la partie (sorts.js : ciblesPings), avec leurs sorts.
const CIBLES = [
  { noms: ["Karma"], sorts: [{ id: "karma|0", noms: P.NOMS_SORTS.Flash }, { id: "karma|1", noms: P.NOMS_SORTS.Dot }] },
  { noms: ["Vex"], sorts: [{ id: "vex|0", noms: P.NOMS_SORTS.Flash }, { id: "vex|1", noms: P.NOMS_SORTS.Dot }] },
  { noms: ["Cho'Gath"], sorts: [{ id: "cho|0", noms: P.NOMS_SORTS.Flash }, { id: "cho|1", noms: P.NOMS_SORTS.Teleport }] },
];

test("plier : confusions de l'OCR repliées des deux côtés (rn, nn -> m ; l, 1, | -> i ; 0 -> o)", () => {
  assert.strictEqual(P.plier("karnna"), "kamna");
  assert.strictEqual(P.plier("kainna"), "kaima");
  assert.strictEqual(P.plier("flash"), "fiash");
  assert.strictEqual(P.plier("c0met"), "comet");
});

test("normaliser et distance : sans accents, espaces ni ponctuation ; lettres à changer", () => {
  assert.strictEqual(P.normaliser("K arnia"), "karnia");
  assert.strictEqual(P.normaliser("Saut éclair"), "sauteclair");
  assert.strictEqual(P.normaliser("Cho'Gath"), "chogath");
  assert.strictEqual(P.distance("karnia", "karma"), 2);
  assert.strictEqual(P.distance("", "abc"), 3);
  assert.strictEqual(P.distance("flash", "flash"), 0);
});

test("pings reconnus malgré les erreurs de lecture (vrais textes lus par l'OCR)", () => {
  const cas = [
    ["wDark (Ashe): Vex Flash", "vex|0"],
    ["wDark (Ashe): Vex Ignite", "vex|1"],
    ["wDark (Cho'Gath): Karnia Flash", "karma|0"],
    ["wDark (Cho'Gach): K arnia Flash", "karma|0"],
    ["wDark (Shyvan a II Karma Flash", "karma|0"], // « ): » mal lu : on ne s'en sert pas
    ["Pseudo (Lux): Cho'Gath Unleashed Teleport", "cho|1"],
    ["Pseudo (Lux): Karma Saut éclair", "karma|0"], // partie en français
    // Textes VRAIMENT lus par la chaîne de l'appli (image.js + OCR de Windows) sur les captures du 16/10/2026 :
    ["wDark (ChotGach l' K arnna Flash", "karma|0"],
    ["wDark (ChotGath l: K a I-nn a Flash", "karma|0"], // « rm » lu « I-nn »
    ["wDark (Ashe)' Vex Ignite", "vex|1"],
  ];
  for (const [ligne, attendu] of cas) assert.strictEqual(P.pingDepuisLigne(ligne, CIBLES), attendu, ligne);
});

test("jamais de ping pour : ses propres sorts, une rune, un allié, le texte du jeu, un sort que l'ennemi n'a pas", () => {
  const pieges = [
    "wDark (Shyvana): Flash - Ready",
    "wDark (Shyvana): Wait For Shyvana Flash - 249s",
    "wDark (Ashe): Wait For Ashe Barrier",
    "wDark (Cho'Gath): Karma Arcane Comet", // rune, pas un sort d'invocateur
    "wDark (Cho'Gath): Karma", // la rune dont la fin (vert pâle) a été effacée par le nettoyage
    "Type /help for a list of commands",
    "Ashe has selected Role: Mid",
    "wDark (Ashe): Ashe Flash", // Ashe est une alliée : pas dans les cibles
    "wDark (Ashe): Vex Smite", // Vex n'a pas Châtiment
    "",
  ];
  for (const ligne of pieges) assert.strictEqual(P.pingDepuisLigne(ligne, CIBLES), null, ligne);
  assert.strictEqual(P.pingDepuisLigne("wDark (Ashe): Vex Flash", undefined), null);
  assert.strictEqual(P.pingDepuisLigne(undefined, CIBLES), null);
});

test("regrouperLignes : les morceaux d'une même ligne sont recollés de gauche à droite", () => {
  const morceaux = [
    { texte: "Vex Flash", x: 300, y: 961, hauteur: 30 },
    { texte: "wDark (Ashe):", x: 120, y: 960, hauteur: 30 },
    { texte: "wDark (Ashe): Wait For Ashe Flash", x: 120, y: 1008, hauteur: 30 },
    null,
  ];
  assert.deepStrictEqual(P.regrouperLignes(morceaux), ["wDark (Ashe): Vex Flash", "wDark (Ashe): Wait For Ashe Flash"]);
  assert.deepStrictEqual(P.regrouperLignes(undefined), []);
});

test("zone du chat et agrandissement selon l'écran", () => {
  assert.deepStrictEqual(P.zoneChat({ largeur: 2560, hauteur: 1440 }), { x: 38, y: 760, largeur: 563, hauteur: 252 });
  assert.strictEqual(P.facteurChat(1440), 3);
  assert.strictEqual(P.facteurChat(1080), 4);
  assert.strictEqual(P.facteurChat(2160), 2);
  assert.strictEqual(P.facteurChat(undefined), 3);
});

test("compteur : un ping n'est nouveau que si une ligne de plus apparaît (message resté à l'écran : rien)", () => {
  const c = P.creerCompteurPings();
  assert.deepStrictEqual(c.nouveaux(["karma|0", "karma|0"]), ["karma|0"], "2 lignes d'un coup : un seul ping");
  assert.deepStrictEqual(c.nouveaux(["karma|0", "karma|0"]), [], "les mêmes lignes encore à l'écran");
  assert.deepStrictEqual(c.nouveaux(["karma|0"]), [], "une ligne ratée par l'OCR...");
  assert.deepStrictEqual(c.nouveaux(["karma|0", "karma|0"]), [], "... puis relue : pas un nouveau ping");
  assert.deepStrictEqual(c.nouveaux(["karma|0", "karma|0", "karma|0", "vex|0"]), ["karma|0", "vex|0"], "une ligne de plus");
  // Le chat s'efface, puis un nouveau ping
  c.nouveaux([]);
  c.nouveaux([]);
  c.nouveaux([]);
  assert.deepStrictEqual(c.nouveaux(["karma|0"]), ["karma|0"]);
  c.vider();
  assert.deepStrictEqual(c.nouveaux(["karma|0"]), ["karma|0"]);
});

test("lecteur du chat : capture, nettoyage, OCR et regroupement ; fichiers toujours effacés", async () => {
  const dossierTemp = fs.mkdtempSync(path.join(os.tmpdir(), "lol-chat-"));
  const appels = [];
  // Faux lecteur d'écran : la « capture » est une image RVB de 2 x 1 pixels (un pixel de texte rouge).
  const lecteur = {
    capturer: async (zone, chemin) => {
      appels.push(["capturer", zone]);
      const zlib = require("zlib");
      const brut = Buffer.from([0, 230, 60, 60, 40, 60, 40]);
      const entete = Buffer.alloc(13);
      entete.writeUInt32BE(2, 0);
      entete.writeUInt32BE(1, 4);
      entete[8] = 8;
      entete[9] = 2;
      const morceau = (type, contenu) => {
        const l = Buffer.alloc(4);
        l.writeUInt32BE(contenu.length);
        const tc = Buffer.concat([Buffer.from(type, "latin1"), contenu]);
        const crc = Buffer.alloc(4);
        crc.writeUInt32BE(I.crc32(tc));
        return Buffer.concat([l, tc, crc]);
      };
      fs.writeFileSync(chemin, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), morceau("IHDR", entete), morceau("IDAT", zlib.deflateSync(brut)), morceau("IEND", Buffer.alloc(0))]));
      return chemin;
    },
    lireImage: async (chemin, taille) => {
      const propre = I.lirePng(fs.readFileSync(chemin));
      appels.push(["lireImage", taille, propre.pixels[0]]);
      return [{ texte: "Vex Flash", x: 50, y: 10, hauteur: 20 }, { texte: "wDark (Ashe):", x: 1, y: 11, hauteur: 20 }];
    },
  };
  try {
    // Image de 2 pixels : trop petite pour le seuil adaptatif (il lui faut au moins 20 pixels colorés), seuils fixes.
    const chat = P.creerLecteurChat({ lecteur, ecran: () => ({ largeur: 2560, hauteur: 1440 }), dossierTemp, nettoyage: { adaptatif: false } });
    assert.deepStrictEqual(await chat.lire(), ["wDark (Ashe): Vex Flash"]);
    assert.deepStrictEqual(appels[0], ["capturer", P.zoneChat({ largeur: 2560, hauteur: 1440 })]);
    assert.deepStrictEqual(appels[1], ["lireImage", { largeur: 6, hauteur: 3 }, 0], "image agrandie 3 fois, texte en noir");
    assert.deepStrictEqual(fs.readdirSync(dossierTemp), [], "aucun fichier ne reste");
    // Une capture ratée : erreur transmise, et toujours rien sur le disque.
    const enPanne = P.creerLecteurChat({ lecteur: { capturer: async () => { throw new Error("pas d'autorisation"); } }, ecran: () => ({ largeur: 100, hauteur: 100 }), dossierTemp });
    await assert.rejects(enPanne.lire(), /pas d'autorisation/);
    assert.deepStrictEqual(fs.readdirSync(dossierTemp), []);
  } finally {
    fs.rmSync(dossierTemp, { recursive: true, force: true });
  }
});
