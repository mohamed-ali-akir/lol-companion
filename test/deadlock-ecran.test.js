// Mode Deadlock : héros repérés sur l'écran (deadlock-ecran.js), avec des images fabriquées : une bande d'écran où
// l'on « peint » des icônes à la place des portraits du jeu. Les vraies captures (2560×1440, 31/10/2026) ont servi aux
// réglages (README) ; elles ne sont pas dans le dépôt.
const test = require("node:test");
const assert = require("node:assert");
const E = require("../deadlock-ecran.js");

/** Icône fabriquée : disque opaque de 128×128 fait de carrés de couleurs (propres à chaque héros), fond transparent. */
function icone(graine) {
  let x = graine * 9301 + 49297;
  const hasard = () => (x = (x * 9301 + 49297) % 233280) / 233280;
  const couleurs = Array.from({ length: 64 }, () => [Math.floor(hasard() * 256), Math.floor(hasard() * 256), Math.floor(hasard() * 256)]);
  const data = Buffer.alloc(128 * 128 * 4);
  for (let py = 0; py < 128; py++) {
    for (let px = 0; px < 128; px++) {
      const k = (py * 128 + px) * 4;
      const [b, g, r] = couleurs[Math.floor(py / 16) * 8 + Math.floor(px / 16)];
      data[k] = b;
      data[k + 1] = g;
      data[k + 2] = r;
      data[k + 3] = (px - 64) ** 2 + (py - 64) ** 2 < 60 ** 2 ? 255 : 0;
    }
  }
  return { width: 128, height: 128, data };
}

const L = 1280, H = 720;

/** Bande du haut de l'écran (fond bleu uni) avec les icônes peintes : { allie: [graines], ennemi: [graines] }. */
function bandeAvec(portraits, { fond = [120, 60, 30] } = {}) {
  const hauteur = Math.round(H * 0.11);
  const data = Buffer.alloc(L * hauteur * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = fond[0];
    data[i + 1] = fond[1];
    data[i + 2] = fond[2];
    data[i + 3] = 255;
  }
  const cote = Math.round(0.076 * H);
  for (const place of E.emplacements(L, H)) {
    const graine = (portraits[place.equipe] || [])[place.rang];
    if (graine === undefined) continue;
    const petite = E.redimensionner(icone(graine), cote);
    const x0 = Math.round(place.cx + 0.007 * H - cote / 2), y0 = 4;
    for (let y = 0; y < cote; y++) {
      for (let x = 0; x < cote; x++) {
        const s = (y * cote + x) * 4;
        if (petite.data[s + 3] < 128) continue;
        const d = ((y0 + y) * L + x0 + x) * 4;
        for (let c = 0; c < 3; c++) data[d + c] = petite.data[s + c];
      }
    }
  }
  return { width: L, height: hauteur, data };
}

const ICONES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].map((g) => E.preparerIcone(g, icone(g), H));

test("emplacements : mesurés sur l'écran de 2560×1440 (centres des 1ers portraits à 498 et 1468 px)", () => {
  const places = E.emplacements(2560, 1440);
  assert.strictEqual(places.length, 12);
  assert.deepStrictEqual(places.map((p) => p.equipe), [...Array(6).fill("allie"), ...Array(6).fill("ennemi")]);
  assert.ok(Math.abs(places[0].cx - 498) <= 3, `allié 1 : ${places[0].cx}`);
  assert.ok(Math.abs(places[6].cx - 1468) <= 3, `ennemi 1 : ${places[6].cx}`);
  assert.ok(Math.abs(places[11].cx - places[6].cx - 5 * 116.6) <= 3, "pas de 117 px");
});

test("redimensionner : moyenne des pixels, transparence comprise", () => {
  const image = { width: 2, height: 2, data: Buffer.from([0, 0, 0, 255, 200, 100, 50, 255, 0, 0, 0, 0, 200, 100, 50, 0]) };
  assert.deepStrictEqual([...E.redimensionner(image, 1).data], [100, 50, 25, 128]);
  assert.strictEqual(E.redimensionner(icone(1), 50).data.length, 50 * 50 * 4);
});

test("portraits reconnus à leur place, alliés et adverses ; le calcul rend la main régulièrement", async () => {
  let pauses = 0;
  const r = await E.reconnaitreBarre({
    bande: bandeAvec({ allie: [1, 2, 3, 4, 5, 6], ennemi: [7, 8, 9, 10, 11, 12] }),
    hauteurEcran: H,
    icones: ICONES,
    ceder: async () => pauses++,
  });
  assert.deepStrictEqual(r.allies, [1, 2, 3, 4, 5, 6]);
  assert.deepStrictEqual(r.ennemis, [7, 8, 9, 10, 11, 12]);
  assert.strictEqual(pauses, 12 * ICONES.length, "une pause après chaque héros essayé");
  assert.strictEqual(r.details.length, 12);
});

test("barre absente (menu : aucun portrait, ou du bruit) : rien n'est reconnu", async () => {
  const vide = await E.reconnaitreBarre({ bande: bandeAvec({}), hauteurEcran: H, icones: ICONES, ceder: async () => {} });
  assert.deepStrictEqual([vide.allies, vide.ennemis], [[], []]);
  const bruit = bandeAvec({});
  for (let i = 0; i < bruit.data.length; i++) if (i % 4 !== 3) bruit.data[i] = (i * 7919) % 251;
  const r = await E.reconnaitreBarre({ bande: bruit, hauteurEcran: H, icones: ICONES, ceder: async () => {} });
  assert.deepStrictEqual([r.allies, r.ennemis], [[], []]);
});

test("barre en partie seulement remplie : 4 portraits adverses sûrs suffisent, les places vides restent vides", async () => {
  const r = await E.reconnaitreBarre({
    bande: bandeAvec({ ennemi: [7, 8, undefined, 10, 11] }),
    hauteurEcran: H, icones: ICONES, equipes: ["ennemi"], ceder: async () => {},
  });
  assert.deepStrictEqual(r.ennemis, [7, 8, 10, 11]);
  assert.deepStrictEqual(r.allies, [], "alliés pas cherchés");
  const trois = await E.reconnaitreBarre({ bande: bandeAvec({ ennemi: [7, 8, 9] }), hauteurEcran: H, icones: ICONES, ceder: async () => {} });
  assert.deepStrictEqual(trois.ennemis, [], "3 portraits seulement : la barre n'est pas jugée à l'écran");
});

test("un héros n'est qu'une fois dans la partie ; entrées abîmées sans erreur", async () => {
  const r = await E.reconnaitreBarre({ bande: bandeAvec({ ennemi: [7, 8, 9, 10, 7] }), hauteurEcran: H, icones: ICONES, ceder: async () => {} });
  assert.strictEqual(r.ennemis.filter((id) => id === 7).length, 1);
  assert.deepStrictEqual(await E.reconnaitreBarre({ bande: null, hauteurEcran: H, icones: ICONES }), { allies: [], ennemis: [], details: [] });
  assert.deepStrictEqual((await E.reconnaitreBarre({ bande: bandeAvec({}), hauteurEcran: H, icones: [] })).ennemis, []);
});

test("lecteur de l'écran : 3 ennemis au moins, sinon null ; capture impossible -> null ; une analyse à la fois", async () => {
  let captures = 0;
  const bande = bandeAvec({ allie: [1, 2], ennemi: [7, 8, 9, 10, 11, 12] });
  const lecteur = E.creerLecteurEcran({ capturer: async () => (captures++, { bande, hauteurEcran: H }), icones: async () => ICONES, ceder: async () => {} });
  const [a, b] = await Promise.all([lecteur.analyser(), lecteur.analyser()]);
  assert.strictEqual(a, b, "même analyse partagée");
  assert.strictEqual(captures, 1);
  assert.deepStrictEqual(a.ennemis, [7, 8, 9, 10, 11, 12]);
  assert.strictEqual(await E.creerLecteurEcran({ capturer: async () => null, icones: async () => ICONES }).analyser(), null);
  const menu = E.creerLecteurEcran({ capturer: async () => ({ bande: bandeAvec({}), hauteurEcran: H }), icones: async () => ICONES, ceder: async () => {} });
  assert.strictEqual(await menu.analyser(), null);
});
