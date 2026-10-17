// Tests des images PNG et du nettoyage de la zone du chat (image.js).
const test = require("node:test");
const assert = require("node:assert");
const zlib = require("zlib");
const I = require("../image.js");

/** Fabrique un PNG de test : type de couleur, et un filtre PNG imposé pour toutes les lignes (0 à 4). */
function fabriquerPng({ largeur, hauteur, couleur, pixels, filtre = 0 }) {
  const canaux = { 0: 1, 2: 3, 4: 2, 6: 4 }[couleur];
  const ligne = largeur * canaux;
  const brut = Buffer.alloc(hauteur * (ligne + 1));
  for (let y = 0; y < hauteur; y++) {
    brut[y * (ligne + 1)] = filtre;
    for (let i = 0; i < ligne; i++) {
      const x = pixels[y * ligne + i];
      const a = i >= canaux ? pixels[y * ligne + i - canaux] : 0;
      const b = y > 0 ? pixels[(y - 1) * ligne + i] : 0;
      const c = y > 0 && i >= canaux ? pixels[(y - 1) * ligne + i - canaux] : 0;
      const p = a + b - c;
      const paeth = Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c;
      const prediction = [0, a, b, (a + b) >> 1, paeth][filtre];
      brut[y * (ligne + 1) + 1 + i] = (x - prediction) & 0xff;
    }
  }
  const morceau = (type, contenu) => {
    const l = Buffer.alloc(4);
    l.writeUInt32BE(contenu.length);
    const tc = Buffer.concat([Buffer.from(type, "latin1"), contenu]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(I.crc32(tc));
    return Buffer.concat([l, tc, crc]);
  };
  const entete = Buffer.alloc(13);
  entete.writeUInt32BE(largeur, 0);
  entete.writeUInt32BE(hauteur, 4);
  entete[8] = 8;
  entete[9] = couleur;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    morceau("IHDR", entete),
    morceau("tEXt", Buffer.from("autre morceau ignoré")),
    morceau("IDAT", zlib.deflateSync(brut)),
    morceau("IEND", Buffer.alloc(0)),
  ]);
}

const aleatoire = (n, graine = 7) => Buffer.from(Array.from({ length: n }, (_, i) => (i * 97 + graine * 31 + ((i * i) % 13)) & 0xff));

test("lirePng : les 5 filtres PNG et les 4 types de couleur donnent les bons pixels", () => {
  for (const couleur of [0, 2, 4, 6]) {
    const canaux = { 0: 1, 2: 3, 4: 2, 6: 4 }[couleur];
    const pixels = aleatoire(5 * 4 * canaux, couleur);
    for (const filtre of [0, 1, 2, 3, 4]) {
      const img = I.lirePng(fabriquerPng({ largeur: 5, hauteur: 4, couleur, pixels, filtre }));
      assert.deepStrictEqual([img.largeur, img.hauteur, img.canaux], [5, 4, canaux]);
      assert.ok(img.pixels.equals(pixels), `couleur ${couleur}, filtre ${filtre}`);
    }
  }
});

test("lirePng : erreurs claires (pas un PNG, coupé, format non pris en charge, abîmé)", () => {
  assert.throws(() => I.lirePng(Buffer.from("pas une image")), /pas une image PNG/);
  assert.throws(() => I.lirePng(undefined), I.ErreurImage);
  const bon = fabriquerPng({ largeur: 2, hauteur: 2, couleur: 2, pixels: aleatoire(12) });
  assert.throws(() => I.lirePng(bon.subarray(0, 40)), I.ErreurImage);
  const seize = Buffer.from(bon);
  seize[24] = 16; // 16 bits par canal
  assert.throws(() => I.lirePng(seize), /non pris en charge/);
  const abime = Buffer.from(bon);
  abime.fill(0, abime.indexOf("IDAT") + 4, abime.indexOf("IDAT") + 10);
  assert.throws(() => I.lirePng(abime), I.ErreurImage);
});

test("ecrirePngGris : relu à l'identique", () => {
  const image = { largeur: 7, hauteur: 3, pixels: aleatoire(21) };
  const relu = I.lirePng(I.ecrirePngGris(image));
  assert.deepStrictEqual([relu.largeur, relu.hauteur, relu.canaux], [7, 3, 1]);
  assert.ok(relu.pixels.equals(image.pixels));
});

test("texte du chat : couleurs vives et saturées oui, décor sombre ou terne non", () => {
  const r = { saturation: 110, luminosite: 160 };
  assert.ok(I.estTexteChat(230, 70, 70, r), "rouge des ennemis");
  assert.ok(I.estTexteChat(250, 170, 40, r), "orange des sorts");
  assert.ok(I.estTexteChat(70, 170, 235, r), "bleu des pseudos");
  assert.ok(!I.estTexteChat(40, 50, 30, r), "herbe sombre");
  assert.ok(!I.estTexteChat(170, 190, 120, r), "herbe claire, terne");
  assert.ok(!I.estTexteChat(230, 230, 230, r), "blanc (non saturé)");
});

test("nettoyerChat (seuils fixes) : agrandi 3 fois, texte en noir sur blanc", () => {
  // 2 x 1 pixels RVB : un pixel « texte rouge » et un pixel « décor ».
  const image = { largeur: 2, hauteur: 1, canaux: 3, pixels: Buffer.from([230, 60, 60, 40, 60, 40]) };
  const propre = I.nettoyerChat(image, { adaptatif: false });
  assert.deepStrictEqual([propre.largeur, propre.hauteur], [6, 3]);
  assert.strictEqual(propre.pixels[0], 0, "à gauche : texte -> noir");
  assert.strictEqual(propre.pixels[5], 255, "à droite : décor -> blanc");
  // RVBA marche aussi ; une image vide est refusée
  const rvba = I.nettoyerChat({ largeur: 1, hauteur: 1, canaux: 4, pixels: Buffer.from([250, 170, 40, 255]) }, { facteur: 2, adaptatif: false });
  assert.deepStrictEqual([...rvba.pixels], [0, 0, 0, 0]);
  assert.throws(() => I.nettoyerChat({ largeur: 0, hauteur: 0, canaux: 3, pixels: Buffer.alloc(0) }), /vide/);
});

test("teintes du chat : rouge, orange et bleu gardés ; vert et jaune du décor jamais", () => {
  const r = { luminosite: 100, saturation: 60 };
  assert.ok(I.estTexteChat(230, 60, 60, r), "rouge");
  assert.ok(I.estTexteChat(250, 170, 40, r), "orange");
  assert.ok(I.estTexteChat(70, 170, 235, r), "bleu");
  assert.ok(!I.estTexteChat(120, 210, 60, r), "herbe verte saturée");
  assert.ok(!I.estTexteChat(220, 220, 60, r), "jaune");
  assert.ok(I.estTexteChat(120, 210, 60, { ...r, teintes: null }), "sans tri des teintes, l'herbe passait");
  assert.strictEqual(Math.round(I.teinte(255, 0, 0)), 0);
  assert.strictEqual(Math.round(I.teinte(0, 255, 0)), 120);
  assert.strictEqual(Math.round(I.teinte(0, 0, 255)), 240);
});

/** Fausse zone de chat 40 x 10 : une bande de « texte » orange, le reste du décor ; tout multiplié par `lumiere`. */
function fauxChat({ lumiere = 1, decor = [40, 60, 40] } = {}) {
  const px = Buffer.alloc(40 * 10 * 3);
  for (let i = 0; i < 400; i++) {
    const texte = Math.floor(i / 40) === 4; // la 5e ligne de pixels
    const [r, v, b] = texte ? [250, 170, 40] : decor;
    px[i * 3] = Math.round(r * lumiere);
    px[i * 3 + 1] = Math.round(v * lumiere);
    px[i * 3 + 2] = Math.round(b * lumiere);
  }
  return { largeur: 40, hauteur: 10, canaux: 3, pixels: px };
}
const ligneNoire = (propre, ligne) => [...propre.pixels.subarray(ligne * propre.largeur, (ligne + 1) * propre.largeur)].every((p) => p === 0);
const toutBlanc = (propre, de, a) => [...propre.pixels.subarray(de * propre.largeur, a * propre.largeur)].every((p) => p === 255);

test("seuil adaptatif : le texte est gardé aussi bien sur un décor clair que terne et sombre (x 0,3)", () => {
  for (const lumiere of [1, 0.6, 0.3]) {
    const propre = I.nettoyerChat(fauxChat({ lumiere }), { facteur: 1 });
    assert.ok(ligneNoire(propre, 4), `texte gardé (lumière ${lumiere})`);
    assert.ok(toutBlanc(propre, 0, 3) && toutBlanc(propre, 6, 10), `décor effacé (lumière ${lumiere})`);
    // Avec l'ancien seuil fixe (160), le texte terne disparaissait
    if (lumiere < 0.6) assert.ok(!ligneNoire(I.nettoyerChat(fauxChat({ lumiere }), { facteur: 1, adaptatif: false }), 4));
  }
});

test("seuil adaptatif : herbe verte vive effacée ; zone sans couleur du chat -> image blanche", () => {
  const herbe = I.nettoyerChat(fauxChat({ decor: [110, 220, 60] }), { facteur: 1 });
  assert.ok(ligneNoire(herbe, 4) && toutBlanc(herbe, 0, 3));
  const vide = { largeur: 10, hauteur: 10, canaux: 3, pixels: Buffer.alloc(300, 30) };
  assert.strictEqual(I.luminositeReference(vide, { teintes: I.TEINTES_CHAT, proportion: 0.45 }), null);
  assert.ok(I.nettoyerChat(vide).pixels.every((p) => p === 255));
});
