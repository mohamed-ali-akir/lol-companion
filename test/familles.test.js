// Tests des familles de builds (plusieurs sets d'objets) : catégories des objets, combinaisons, Kayn, seuils.
const test = require("node:test");
const assert = require("node:assert");
const F = require("../familles.js");

// Objets de test avec leurs catégories (comme dans /lol-game-data/assets/v1/items.json).
const BOTTES = 3047;
const TRINITY = 3078; // combattant
const COUPERET = 3071; // combattant (Santé + pénétration)
const DANSE = 6333; // neutre (Armure + dégâts)
const CYCLOSABRE = 6699; // létalité
const ORGUEIL = 6697; // létalité
const COLLECTEUR = 6676; // critique + létalité
const DOMINIK = 3036; // critique
const ECLIPSE = 6692; // neutre
const SHOJIN = 3161; // combattant
const CATEGORIES = {
  [BOTTES]: ["Armor", "Boots"],
  [TRINITY]: ["Health", "Damage", "AttackSpeed", "OnHit"],
  [COUPERET]: ["Health", "Damage", "ArmorPenetration"],
  [DANSE]: ["Armor", "Damage"],
  [CYCLOSABRE]: ["Damage", "ArmorPenetration"],
  [ORGUEIL]: ["Damage", "ArmorPenetration"],
  [COLLECTEUR]: ["Damage", "CriticalStrike", "ArmorPenetration"],
  [DOMINIK]: ["Damage", "CriticalStrike", "ArmorPenetration"],
  [ECLIPSE]: ["Damage", "AbilityHaste"],
  [SHOJIN]: ["Health", "Damage", "AbilityHaste"],
};
const categoriesObjet = (id) => CATEGORIES[id] || [];

/** itemSets au format de Lolalytics : { itemBootSet3: { "a_b_c": [parties, autre] } }. */
const itemSets = (lignes) => ({ itemBootSet3: Object.fromEntries(lignes.map(([ids, parties]) => [ids.join("_"), [parties, 0]])) });

test("famille d'un objet d'après ses catégories (bottes et objets neutres : null)", () => {
  assert.strictEqual(F.familleObjet(["SpellDamage", "Health"]), "AP");
  assert.strictEqual(F.familleObjet(CATEGORIES[COLLECTEUR]), "Létalité / Critique");
  assert.strictEqual(F.familleObjet(CATEGORIES[CYCLOSABRE]), "Létalité / Critique");
  assert.strictEqual(F.familleObjet(CATEGORIES[TRINITY]), "Combattant");
  assert.strictEqual(F.familleObjet(CATEGORIES[COUPERET]), "Combattant", "le Couperet a de la Santé : pas létalité");
  assert.strictEqual(F.familleObjet(["Health", "Armor"]), "Tank");
  assert.strictEqual(F.familleObjet(["Damage", "AttackSpeed"]), "À l'impact");
  // Objets hybrides (catégories du vrai client, 17/10/2026) : Guinsoo et Statikk sont à l'impact, pas AP ;
  // Terminus (pénétration + à l'impact) est à l'impact ; Dent de Nashor et Aube et crépuscule restent AP.
  assert.strictEqual(F.familleObjet(["Damage", "AttackSpeed", "SpellDamage", "OnHit"]), "À l'impact"); // Guinsoo
  assert.strictEqual(F.familleObjet(["Damage", "AttackSpeed", "SpellDamage", "OnHit", "NonbootsMovement"]), "À l'impact"); // Statikk
  assert.strictEqual(F.familleObjet(["Damage", "AttackSpeed", "OnHit", "MagicPenetration", "ArmorPenetration"]), "À l'impact"); // Terminus
  assert.strictEqual(F.familleObjet(["AttackSpeed", "SpellDamage", "OnHit", "AbilityHaste"]), "AP"); // Nashor
  assert.strictEqual(F.familleObjet(["Health", "AttackSpeed", "SpellDamage", "OnHit", "AbilityHaste"]), "AP"); // Aube et crépuscule
  assert.strictEqual(F.familleObjet(["Damage", "ArmorPenetration"]), "Létalité / Critique");
  assert.strictEqual(F.familleObjet(CATEGORIES[BOTTES]), null);
  assert.strictEqual(F.familleObjet(CATEGORIES[ECLIPSE]), null);
  assert.strictEqual(F.familleObjet(undefined), null);
});

test("famille d'une combinaison : le premier objet décide ; s'il est neutre, la famille la plus fréquente", () => {
  assert.strictEqual(F.familleCombinaison([TRINITY, CYCLOSABRE], categoriesObjet), "Combattant");
  assert.strictEqual(F.familleCombinaison([ECLIPSE, COLLECTEUR, DOMINIK], categoriesObjet), "Létalité / Critique");
  assert.strictEqual(F.familleCombinaison([ECLIPSE, DANSE], categoriesObjet), "Mixte");
});

test("combinaisons : bottes retirées, doublons additionnés, données abîmées ignorées", () => {
  const liste = F.combinaisons(
    { itemBootSet3: { [`${TRINITY}_${BOTTES}_${COUPERET}`]: [100, 1], [`${TRINITY}_${COUPERET}_${BOTTES}`]: [50, 1], "abc": [10], [`${TRINITY}_${BOTTES}`]: [99, 1], [`${ECLIPSE}_${DANSE}`]: ["x"] } },
    (id) => id === BOTTES,
  );
  assert.deepStrictEqual(liste, [{ ids: [TRINITY, COUPERET], parties: 150 }]);
  assert.deepStrictEqual(F.combinaisons(null, () => false), []);
  assert.deepStrictEqual(F.combinaisons({ itemBootSet3: "abîmé" }, () => false), []);
});

test("choix d'un emplacement : seulement les objets d'au moins 200 parties et 10 % des achats", () => {
  const liste = [
    { ids: [TRINITY, COUPERET], parties: 5000 },
    { ids: [TRINITY, SHOJIN], parties: 1500 },
    { ids: [ECLIPSE, COUPERET], parties: 150 }, // moins de 200 parties
    { ids: [CYCLOSABRE, COUPERET], parties: 300 }, // 200 parties mais moins de 10 %
  ];
  const premier = F.choixEmplacement(liste, 0);
  assert.deepStrictEqual(premier.map((o) => o.ids[0]), [TRINITY]);
  assert.ok(premier[0].selection > 0.9);
  assert.deepStrictEqual(F.choixEmplacement(liste, 1).map((o) => o.ids[0]), [COUPERET, SHOJIN]);
  assert.deepStrictEqual(F.choixEmplacement(liste, 2), []); // pas de 3e objet dans ces combinaisons
});

test("Vi : un set combattant et un set létalité / critique", () => {
  const familles = F.detecterFamilles({
    alias: "Vi",
    categoriesObjet,
    itemSets: itemSets([
      [[TRINITY, BOTTES, COUPERET], 6000],
      [[TRINITY, COUPERET, DANSE], 2000],
      [[COLLECTEUR, BOTTES, DOMINIK], 1200],
      [[ECLIPSE, COLLECTEUR, DOMINIK], 900],
      [[CYCLOSABRE, COLLECTEUR], 50], // trop peu de parties : jamais proposé
    ]),
  });
  assert.deepStrictEqual(familles.map((f) => f.nom), ["Combattant", "Létalité / Critique"]);
  const [combattant, letalite] = familles;
  assert.deepStrictEqual(combattant.emplacements[0].map((o) => o.ids[0]), [TRINITY]);
  assert.deepStrictEqual(combattant.emplacements[1].map((o) => o.ids[0]), [COUPERET]);
  assert.deepStrictEqual(letalite.emplacements[0].map((o) => o.ids[0]), [COLLECTEUR, ECLIPSE]);
  assert.ok(!letalite.emplacements.flat().some((o) => o.ids[0] === CYCLOSABRE));
  assert.ok(Math.abs(combattant.part + letalite.part - 1) < 0.01);
});

test("Kayn : bleu sans aucun objet de Santé (jamais de Couperet), rouge dès qu'il y en a un", () => {
  const familles = F.detecterFamilles({
    alias: "Kayn",
    categoriesObjet,
    itemSets: itemSets([
      [[CYCLOSABRE, BOTTES, ORGUEIL], 3000],
      [[ORGUEIL, CYCLOSABRE], 1500],
      [[CYCLOSABRE, COUPERET, DANSE], 2500], // Cyclosabre acheté avant de connaître la forme, puis Couperet : rouge
      [[ECLIPSE, COUPERET], 1000],
    ]),
  });
  assert.deepStrictEqual(familles.map((f) => f.nom), [F.KAYN.bleu, F.KAYN.rouge]);
  const [bleu, rouge] = familles;
  assert.ok(!bleu.emplacements.flat().some((o) => o.ids[0] === COUPERET), "pas de Couperet dans le set bleu");
  assert.deepStrictEqual(rouge.emplacements[1].map((o) => o.ids[0]), [COUPERET]);
  assert.deepStrictEqual(rouge.emplacements[0].map((o) => o.ids[0]), [CYCLOSABRE, ECLIPSE]);
});

test("une seule famille (ou une famille trop peu jouée) -> [] : un seul set, comme avant", () => {
  const unique = itemSets([[[TRINITY, COUPERET], 9000], [[TRINITY, SHOJIN], 3000]]);
  assert.deepStrictEqual(F.detecterFamilles({ itemSets: unique, categoriesObjet }), []);
  const petite = itemSets([[[TRINITY, COUPERET], 9500], [[COLLECTEUR, DOMINIK], 400]]); // 4 % des builds
  assert.deepStrictEqual(F.detecterFamilles({ itemSets: petite, categoriesObjet }), []);
  assert.deepStrictEqual(F.detecterFamilles({ itemSets: undefined, categoriesObjet }), []);
});

test("3 familles au plus, de la plus à la moins jouée", () => {
  const familles = F.detecterFamilles({
    categoriesObjet: (id) => ({ 1: ["SpellDamage"], 2: ["Health", "Damage"], 3: ["CriticalStrike"], 4: ["Damage", "AttackSpeed"], 9: ["Damage"] })[id] || [],
    itemSets: itemSets([[[1, 9], 4000], [[2, 9], 3000], [[3, 9], 2000], [[4, 9], 1500]]),
  });
  assert.deepStrictEqual(familles.map((f) => f.nom), ["AP", "Combattant", "Létalité / Critique"]);
});

test("objets exclus : ceux d'une AUTRE famille du champion ; Kayn bleu : aucun objet avec de la Santé", () => {
  const LAME = 3031; // critique
  const categories = (id) => ({ ...CATEGORIES, [LAME]: ["Damage", "CriticalStrike"] })[id] || [];
  const familles = [{ nom: "Combattant" }, { nom: "Létalité / Critique" }];
  const [combattant, letalite] = F.ajouterExclus({ familles, ids: [LAME, COUPERET, DANSE, ECLIPSE, LAME], categoriesObjet: categories });
  assert.deepStrictEqual(combattant.exclus, [LAME]);
  assert.deepStrictEqual(letalite.exclus, [COUPERET]);
  // Une famille « AP » absente pour ce champion : ses objets ne sont exclus de nulle part
  assert.deepStrictEqual(F.ajouterExclus({ familles, ids: [1], categoriesObjet: () => ["SpellDamage"] }).map((f) => f.exclus), [[], []]);
  const [bleu, rouge] = F.ajouterExclus({ familles: [{ nom: F.KAYN.bleu }, { nom: F.KAYN.rouge }], ids: [COUPERET, CYCLOSABRE, DANSE], categoriesObjet, alias: "Kayn" });
  assert.deepStrictEqual(bleu.exclus, [COUPERET]);
  assert.deepStrictEqual(rouge.exclus, []);
});
