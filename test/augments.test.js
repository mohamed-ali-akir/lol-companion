// Tests des augments ARAM Mayhem en jeu : reconnaissance des cartes, étiquettes, surveillance, lecture d'écran (sans écran ni Internet).
const test = require("node:test");
const assert = require("node:assert");
const A = require("../augments.js");
const O = require("../ocr.js");
const M = require("../arammayhem.js");

const attendre = (ms) => new Promise((ok) => setTimeout(ok, ms));

// Vraies lignes lues par l'OCR de Windows sur une capture du joueur (2560x1440, 02/10/2026) ; pseudo remplacé.
const LIGNES_CAPTURE = [
  { texte: "Hellbent", x: 746, y: 581, largeur: 103, hauteur: 20 },
  { texte: "Damage Resilience", x: 726, y: 623, largeur: 141, hauteur: 14 },
  { texte: "I Joueur", x: 1503, y: 568, largeur: 46, hauteur: 11 },
  { texte: "Biggest Snowball Ever", x: 1154, y: 582, largeur: 267, hauteur: 25 },
  { texte: "Utility", x: 1266, y: 623, largeur: 42, hauteur: 14 },
  { texte: "Overloaded", x: 1706, y: 581, largeur: 142, hauteur: 20 },
  { texte: "Utility", x: 1756, y: 623, largeur: 42, hauteur: 14 },
];

// Extrait de la liste du client (cherry-augments.json) : noms dans la langue du jeu.
const NOMS = A.indexNoms(["Hellbent", "Biggest Snowball Ever", "Overloaded", "Ult Bot", "Juiced", "Stats on Stats on Stats!", "Vi"]);

// Stats d'arammayhem.com (format du 17/10/2026, extrait) : meilleurs augments de Hwei + notes tous champions.
const ARAMMAYHEM = {
  champion: [{ nom: "Infernal Conduit", rarete: "Prismatic", note: "S+", rang: 1, apparition: 0.2319 }],
  global: [
    { nom: "Hellbent", rarete: "Prismatic", note: "B", rang: 150, apparition: 0.0673 },
    { nom: "Biggest Snowball Ever", rarete: "Prismatic", note: "S", rang: 10, apparition: 0.2928 },
    { nom: "Overloaded", rarete: "Prismatic", note: "A", rang: 50, apparition: 0.2011 },
    { nom: "Infernal Conduit", rarete: "Prismatic", note: "S", rang: 12, apparition: 0.2989 },
  ],
};
const STATS = A.indexStats(ARAMMAYHEM);

test("ARAM Mayhem reconnue par le numéro de file (2400) ou le mode KIWI", () => {
  assert.strictEqual(A.estMayhem({ gameData: { queue: { id: 2400 } } }), true);
  assert.strictEqual(A.estMayhem({ gameData: { queue: { id: 9999, gameMode: "KIWI" } } }), true);
  assert.strictEqual(A.estMayhem({ gameData: { queue: { id: 450, gameMode: "ARAM" } } }), false);
  assert.strictEqual(A.estMayhem(null), false);
});

test("zone capturée : la bande des titres (36 % à 47 % de la hauteur)", () => {
  assert.deepStrictEqual(A.zoneTitres({ largeur: 2560, hauteur: 1440 }), { x: 0, y: 518, largeur: 2560, hauteur: 159 });
  assert.deepStrictEqual(A.zoneTitres({ largeur: 1920, hauteur: 1080 }), { x: 0, y: 389, largeur: 1920, hauteur: 119 });
});

test("reconnaissance : nom exact, petite erreur d'OCR tolérée, pas de faux positifs", () => {
  assert.strictEqual(A.reconnaitre("Hellbent", NOMS), "Hellbent");
  assert.strictEqual(A.reconnaitre("Biggest Snowbal Ever", NOMS), "Biggest Snowball Ever"); // 1 lettre manquante
  assert.strictEqual(A.reconnaitre("Overloadcd", NOMS), "Overloaded"); // 1 lettre mal lue
  assert.strictEqual(A.reconnaitre("Utility", NOMS), null);
  assert.strictEqual(A.reconnaitre("Vl", NOMS), null); // trop court pour être sûr
  assert.strictEqual(A.reconnaitre("", NOMS), null);
  assert.strictEqual(A.distance("kitten", "sitting"), 3);
});

test("cartes trouvées sur la vraie capture : les 3 titres, de gauche à droite, sans le bruit", () => {
  const cartes = A.trouverCartes(LIGNES_CAPTURE, NOMS);
  assert.deepStrictEqual(cartes.map((c) => c.nom), ["Hellbent", "Biggest Snowball Ever", "Overloaded"]);
  assert.deepStrictEqual(A.trouverCartes([], NOMS), []);
  assert.deepStrictEqual(A.trouverCartes(null, NOMS), []);
  // Un nom d'augment ailleurs à l'écran (pas aligné avec les titres) est ignoré
  const avecIntrus = [...LIGNES_CAPTURE, { texte: "Juiced", x: 100, y: 660, largeur: 60, hauteur: 12 }];
  assert.strictEqual(A.trouverCartes(avecIntrus, NOMS).length, 3);
});

test("stats : celles du champion passent avant les stats tous champions", () => {
  assert.deepStrictEqual(STATS.get("infernalconduit"), { note: "S+", rang: 1, apparition: 0.2319, source: "champion" });
  assert.deepStrictEqual(STATS.get("hellbent"), { note: "B", rang: 150, apparition: 0.0673, source: "global" });
  assert.strictEqual(A.indexStats().size, 0);
  assert.strictEqual(A.indexStats({ global: [{ nom: "Vieux", note: "?", rang: 1, apparition: 0.5 }] }).size, 0); // note inconnue
});

test("étiquettes (vraie capture) : notes tous champions, meilleure carte = meilleure note", () => {
  const liste = A.etiquettes(A.trouverCartes(LIGNES_CAPTURE, NOMS), STATS, 1440);
  assert.deepStrictEqual(liste.map((e) => e.texte), ["Note B · n° 150", "Note S · n° 10", "Note A · n° 50"]);
  assert.deepStrictEqual(liste.map((e) => e.detail), ["tous champions", "tous champions", "tous champions"]);
  assert.deepStrictEqual(liste.map((e) => e.meilleur), [false, true, false]); // Biggest Snowball Ever : S
  assert.strictEqual(liste[0].x, Math.round(746 + 103 / 2)); // centre du titre
  assert.strictEqual(liste[0].y, Math.round(581 + 1440 * A.DECALAGE_ETIQUETTE)); // dans le bas de la carte
  // Stats indisponibles (site en panne, pas d'Internet) : on le dit, sans inventer
  assert.deepStrictEqual(A.etiquettes(A.trouverCartes(LIGNES_CAPTURE, NOMS), null, 1440).map((e) => e.texte), [
    "Stats indisponibles", "Stats indisponibles", "Stats indisponibles",
  ]);
});

test("mise en avant : un augment du top de ton champion passe devant les notes tous champions", () => {
  const cartes = [
    { nom: "Biggest Snowball Ever", x: 0, y: 581, largeur: 10, hauteur: 20 },
    { nom: "Infernal Conduit", x: 500, y: 581, largeur: 10, hauteur: 20 },
    { nom: "Inconnu", x: 900, y: 581, largeur: 10, hauteur: 20 },
  ];
  const liste = A.etiquettes(cartes, STATS, 1440);
  assert.deepStrictEqual(liste.map((e) => e.meilleur), [false, true, false]);
  assert.strictEqual(liste[1].texte, "Note S+ · n° 1");
  assert.strictEqual(liste[1].detail, "avec ton champion · pris 23 %");
  assert.strictEqual(liste[2].texte, "Pas de données");
  // Jamais un augment trop rarement pris (< 3 %), même avec une super note
  const rare = A.indexStats({ global: [
    { nom: "Hellbent", note: "S+", rang: 1, apparition: 0.01 },
    { nom: "Overloaded", note: "A", rang: 40, apparition: 0.2 },
    { nom: "Biggest Snowball Ever", note: "S", rang: 9, apparition: 0.2 },
  ] });
  assert.deepStrictEqual(A.etiquettes(A.trouverCartes(LIGNES_CAPTURE, NOMS), rare, 1440).map((e) => e.meilleur), [false, true, false]);
  // Même note pour les 2 meilleures : pas de mise en avant (le rang seul départagerait de trop peu)
  const egalite = A.indexStats({ global: [
    { nom: "Hellbent", note: "S", rang: 5, apparition: 0.2 },
    { nom: "Overloaded", note: "S", rang: 3, apparition: 0.2 },
    { nom: "Biggest Snowball Ever", note: "A", rang: 30, apparition: 0.2 },
  ] });
  assert.deepStrictEqual(A.etiquettes(A.trouverCartes(LIGNES_CAPTURE, NOMS), egalite, 1440).map((e) => e.meilleur), [false, false, false]);
});

// --- arammayhem.com : lecture des pages (fausses pages au format réel, sans Internet) ------------------

// Extrait au format réel de https://arammayhem.com/build/hwei/ (17/10/2026)
const PAGE_CHAMPION = `<html><script>var x = "<div>Appearance rate:</div>";</script><h2>Best Augments for Hwei</h2>
<h3>Prismatic Augments</h3><div><span>Infernal Conduit</span><span>S+ · #1</span><span>Overall S · #12</span><span>Appearance rate:</span><b>23.19%</b></div>
<div><span>Quest: Wooglet&#39;s Witchcap</span><span>A+ · #11</span><span>Overall A+ · #27</span><span>Appearance rate:</span><b>8.70%</b></div>
<h3>Gold Augments</h3><div><span>Combusting Interest</span><span>S · #2</span><span>Overall S+ · #5</span><span>Appearance rate:</span><b>21.76%</b></div></html>`;
// Extrait au format réel de https://arammayhem.com/augments/ (17/10/2026) : un augment retiré (« Deleted ») est ignoré
const PAGE_GLOBALE = `<table><tr><th>Rank</th><th>Augment</th><th>Tier</th><th>Pick Rate</th><th>Top Champions</th></tr>
<tr><td>150</td><td>Hellbent</td><td>Prismatic</td><td>6.73%</td><td>B</td><td>6.73%</td></tr>
<tr><td>5</td><td>Combusting Interest</td><td>Deleted</td><td>Gold</td><td>37.77%</td><td>S+</td><td>37.77%</td></tr>
<tr><td>10</td><td>Biggest Snowball Ever</td><td>Prismatic</td><td>29.28%</td><td>S</td><td>29.28%</td></tr></table>`;

test("arammayhem : page d'un champion -> ses meilleurs augments par rareté (note, rang, apparition)", () => {
  assert.deepStrictEqual(M.augmentsDuChampion(M.texteVisible(PAGE_CHAMPION)), [
    { nom: "Infernal Conduit", rarete: "Prismatic", note: "S+", rang: 1, apparition: 0.2319 },
    { nom: "Quest: Wooglet's Witchcap", rarete: "Prismatic", note: "A+", rang: 11, apparition: 0.087 },
    { nom: "Combusting Interest", rarete: "Gold", note: "S", rang: 2, apparition: 0.2176 },
  ]);
  assert.deepStrictEqual(M.augmentsDuChampion(M.texteVisible("<p>page changée</p>")), []);
});

test("arammayhem : page des augments -> tous les augments (notes tous champions)", () => {
  assert.deepStrictEqual(M.augmentsGlobaux(M.texteVisible(PAGE_GLOBALE)), [
    { nom: "Hellbent", rarete: "Prismatic", note: "B", rang: 150, apparition: 0.0673 },
    { nom: "Biggest Snowball Ever", rarete: "Prismatic", note: "S", rang: 10, apparition: 0.2928 },
  ]);
  assert.deepStrictEqual(M.noteEtRang("S- · #6"), { note: "S-", rang: 6 });
  assert.strictEqual(M.noteEtRang("Overall S · #9"), null);
  assert.strictEqual(M.pourcentage("57.76%"), 0.5776);
  assert.strictEqual(M.pourcentage("abc"), null);
  assert.strictEqual(M.nomArammayhem("MonkeyKing"), "wukong");
  assert.strictEqual(M.nomArammayhem("KSante"), "ksante");
});

function fauxSite(pages) {
  const appels = [];
  const appeler = async (url, options) => {
    appels.push({ url, options });
    const page = pages[url];
    if (page instanceof Error) throw page;
    return page === undefined ? { ok: false, status: 404, text: async () => "" } : { ok: true, status: 200, text: async () => page };
  };
  return { appels, appeler };
}

test("arammayhem : lecture (champion + global), identification honnête, cache 3 h", async () => {
  const site = fauxSite({ "https://arammayhem.com/build/hwei/": PAGE_CHAMPION, "https://arammayhem.com/augments/": PAGE_GLOBALE });
  const lecteur = M.creerLecteurArammayhem({ appeler: site.appeler });
  const r = await lecteur.augments({ alias: "Hwei" });
  assert.strictEqual(r.champion.length, 3);
  assert.strictEqual(r.global.length, 2);
  assert.strictEqual(site.appels[0].options.headers["User-Agent"], M.IDENTITE);
  await lecteur.augments({ alias: "Hwei" });
  assert.strictEqual(site.appels.length, 2); // en cache : pas de nouvelle lecture
});

test("arammayhem : champion inconnu -> stats tous champions quand même ; site en panne ou changé -> erreur claire", async () => {
  const sansChampion = M.creerLecteurArammayhem({ appeler: fauxSite({ "https://arammayhem.com/augments/": PAGE_GLOBALE }).appeler });
  const r = await sansChampion.augments({ alias: "NouveauChampion" });
  assert.deepStrictEqual(r.champion, []);
  assert.strictEqual(r.global.length, 2);
  // Champion pas connu du tout (appli lancée en pleine partie, jeu illisible) : seulement le global, sans erreur.
  for (const alias of [null, undefined]) {
    const g = await sansChampion.augments({ alias });
    assert.deepStrictEqual(g.champion, []);
    assert.strictEqual(g.global.length, 2);
  }
  const enPanne = M.creerLecteurArammayhem({ appeler: fauxSite({ "https://arammayhem.com/augments/": new TypeError("fetch failed") }).appeler });
  await assert.rejects(enPanne.augments({ alias: "Hwei" }), /ne répond pas/);
  const change = M.creerLecteurArammayhem({ appeler: fauxSite({ "https://arammayhem.com/augments/": "<p>nouveau site</p>" }).appeler });
  await assert.rejects(change.augments({ alias: "Hwei" }), /changé de format/);
});

// --- Surveillance de l'écran (fausses lectures) -------------------------------------------------

function suivi({ lectures, actif = true, stats = STATS }) {
  const affichages = [];
  let arrets = 0;
  const s = A.creerSuiviAugments({
    actif: () => actif,
    ecran: () => ({ largeur: 2560, hauteur: 1440 }),
    lireEcran: async () => (lectures.length > 1 ? lectures.shift() : lectures[0]),
    nomsAugments: async () => NOMS,
    statsAugments: async () => stats,
    afficher: (liste) => affichages.push(liste && liste.map((e) => e.texte)),
    arreterLecture: () => arrets++,
    intervalleMs: 10,
  });
  return { s, affichages, arrets: () => arrets };
}

test("surveillance : affiche quand les cartes apparaissent, une seule fois, puis cache quand elles disparaissent", async () => {
  const { s, affichages } = suivi({ lectures: [[], LIGNES_CAPTURE, LIGNES_CAPTURE, LIGNES_CAPTURE, [], [], []] });
  s.demarrer();
  await attendre(150);
  s.arreter();
  assert.deepStrictEqual(affichages, [["Note B · n° 150", "Note S · n° 10", "Note A · n° 50"], null]);
});

test("surveillance : option décochée -> aucune lecture affichée ; arrêt -> lecture d'écran coupée", async () => {
  const { s, affichages, arrets } = suivi({ lectures: [LIGNES_CAPTURE], actif: false });
  s.demarrer();
  await attendre(60);
  s.arreter();
  assert.deepStrictEqual(affichages, []);
  assert.strictEqual(arrets(), 1);
});

test("surveillance : une seule carte reconnue (animation...) ne suffit pas", async () => {
  const { s, affichages } = suivi({ lectures: [[LIGNES_CAPTURE[0]]] });
  s.demarrer();
  await attendre(60);
  s.arreter();
  assert.deepStrictEqual(affichages, []);
});

test("surveillance : une erreur de lecture ne casse pas la boucle", async () => {
  let n = 0;
  const affichages = [];
  const s = A.creerSuiviAugments({
    actif: () => true,
    ecran: () => ({ largeur: 2560, hauteur: 1440 }),
    lireEcran: async () => {
      n++;
      if (n === 1) throw new Error("capture impossible");
      return LIGNES_CAPTURE;
    },
    nomsAugments: async () => NOMS,
    statsAugments: async () => STATS,
    afficher: (liste) => affichages.push(Boolean(liste)),
    intervalleMs: 10,
  });
  s.demarrer();
  await attendre(80);
  s.arreter();
  assert.strictEqual(affichages[0], true);
});

// --- Lecture d'écran : parties sans écran -----------------------------------------------------

test("lecture d'écran : langue du jeu -> langue de l'OCR, commande encodée, réponses tolérantes", () => {
  assert.strictEqual(O.langueOcr("en_US"), "en-US");
  assert.strictEqual(O.langueOcr("fr_FR"), "fr-FR");
  assert.strictEqual(O.langueOcr("n'importe quoi; rm"), "en-US"); // jamais de texte libre dans le script
  const script = Buffer.from(O.commandeEncodee("fr_FR"), "base64").toString("utf16le");
  assert.match(script, /TryCreateFromLanguage\(\(New-Object Windows\.Globalization\.Language 'fr-FR'\)\)/);
  assert.match(script, /IAsyncOperation`1/);
  assert.deepStrictEqual(O.lireReponse('{"lignes":{"texte":"Hellbent","x":1,"y":2,"largeur":3,"hauteur":4},"ms":5}').lignes, [
    { texte: "Hellbent", x: 1, y: 2, largeur: 3, hauteur: 4 },
  ]); // PowerShell écrit un objet seul au lieu d'un tableau d'un élément
  assert.deepStrictEqual(O.lireReponse('{"lignes":[{"texte":"x"}]}').lignes, []); // ligne incomplète ignorée
  assert.strictEqual(O.lireReponse("pas du json"), null);
});

test("lecture d'écran hors Windows : erreur claire", async () => {
  const lecteur = O.creerLecteurEcran({ plateforme: "linux" });
  await assert.rejects(lecteur.lire({ x: 0, y: 0, largeur: 10, hauteur: 10 }), /que sous Windows/);
});

// --- Mac : screencapture + Vision (faux programmes : rien n'est capturé pendant les tests) ---------

test("Mac : positions de Vision (fractions, depuis le bas) -> pixels de l'écran depuis le haut", () => {
  const zone = { x: 100, y: 200, largeur: 1000, hauteur: 400 };
  const sortie = JSON.stringify({ lignes: [{ texte: "Goliath", x: 0.1, y: 0.75, largeur: 0.2, hauteur: 0.1 }, { texte: "abîmée", x: "?" }] });
  assert.deepStrictEqual(O.lignesDepuisVision(sortie, zone), [{ texte: "Goliath", x: 200, y: 260, largeur: 200, hauteur: 40 }]);
  assert.strictEqual(O.lignesDepuisVision("pas du json", zone), null);
  assert.strictEqual(O.lignesDepuisVision('{"autre":1}', zone), null);
  assert.throws(() => O.lignesDepuisVision('{"erreur":"Vision a échoué"}', zone), /Vision a échoué/);
});

test("Mac : capture en points (écran Retina), lecture par Vision, capture effacée", async () => {
  const fs = require("fs");
  const os = require("os");
  const path = require("path");
  const dossierTemp = fs.mkdtempSync(path.join(os.tmpdir(), "lol-ocr-mac-"));
  const appels = [];
  const executer = (programme, args, options, rappel) => {
    appels.push([programme, ...args]);
    if (programme === "screencapture") {
      fs.writeFileSync(args.at(-1), "png"); // la fausse capture
      return rappel(null, "");
    }
    return rappel(null, JSON.stringify({ lignes: [{ texte: "Goliath", x: 0, y: 0.5, largeur: 0.5, hauteur: 0.5 }] }));
  };
  try {
    const lecteur = O.creerLecteurEcranMac({ langue: "fr-FR", executer, echelle: () => 2, dossierTemp });
    const lignes = await lecteur.lire({ x: 200, y: 100, largeur: 800, hauteur: 400 });
    assert.deepStrictEqual(lignes, [{ texte: "Goliath", x: 200, y: 100, largeur: 400, hauteur: 200 }]);
    const [capture, ocr] = appels;
    assert.deepStrictEqual(capture.slice(0, 6), ["screencapture", "-x", "-t", "png", "-R", "100,50,400,200"]); // pixels / 2
    assert.deepStrictEqual(ocr.slice(0, 3), ["osascript", "-l", "JavaScript"]);
    assert.strictEqual(ocr.at(-1), "fr-FR");
    assert.strictEqual(ocr.at(-2), capture.at(-1), "Vision lit bien la capture");
    await new Promise((r) => setTimeout(r, 50));
    assert.deepStrictEqual(fs.readdirSync(dossierTemp), [], "la capture ne reste pas sur le disque");
  } finally {
    fs.rmSync(dossierTemp, { recursive: true, force: true });
  }
});

test("Mac : erreurs claires (programme en échec, réponse illisible, zone invalide) ; la lecture suivante marche", async () => {
  let echec = true;
  const executer = (programme, args, options, rappel) => {
    if (programme === "screencapture") return rappel(echec ? new Error("pas d'autorisation") : null, "");
    return rappel(null, echec ? "rien" : '{"lignes":[]}');
  };
  const lecteur = O.creerLecteurEcranMac({ executer, dossierTemp: require("os").tmpdir() });
  await assert.rejects(lecteur.lire({ x: 0, y: 0, largeur: 10, hauteur: 10 }), /screencapture/);
  await assert.rejects(lecteur.lire({ x: 0, y: 0, largeur: 0, hauteur: 10 }), /Zone de lecture invalide/);
  echec = false;
  assert.deepStrictEqual(await lecteur.lire({ x: 0, y: 0, largeur: 10, hauteur: 10 }), []);
  await assert.rejects(lecteur.lireFichier("x.png", 0, 10), /que sous Windows/);
  lecteur.arreter();
  assert.match(O.SCRIPT_VISION, /VNRecognizeTextRequest/);
});

test("lecture d'écran : sur Mac, creerLecteurEcran donne le lecteur du Mac", () => {
  const lecteur = O.creerLecteurEcran({ plateforme: "darwin" });
  assert.strictEqual(typeof lecteur.lire, "function");
  assert.strictEqual(typeof lecteur.arreter, "function");
});
