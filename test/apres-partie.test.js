// Tests de la relecture après une partie (apres-partie.js) : on relit l'historique jusqu'à y trouver la partie finie.
// Minuteries de Node simulées (mock.timers) : aucun vrai délai, et rien ne reste en route à la fin d'un test.
const test = require("node:test");
const assert = require("node:assert");
const { creerRelectureApresPartie, DELAIS_MS } = require("../apres-partie.js");

/** Fait avancer le temps simulé, en laissant les relectures (promesses) se terminer entre deux étapes. */
async function avancer(t, ms) {
  t.mock.timers.tick(ms);
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

/** Relecture qui renvoie, à chaque appel, le nombre suivant de la liste (0 = partie pas encore dans l'historique). */
function fausseRelecture(resultats) {
  const essais = [];
  const relire = async (essai) => {
    essais.push(essai);
    const r = resultats.shift();
    if (r instanceof Error) throw r;
    return r ?? 0;
  };
  return { relire, essais };
}

test("relecture après partie : 10 minutes au plus, première relecture 4 s après l'écran de fin", () => {
  assert.strictEqual(DELAIS_MS[0], 4000);
  const total = DELAIS_MS.reduce((s, d) => s + d, 0);
  assert.ok(total >= 9 * 60 * 1000 && total <= 10 * 60 * 1000, `total : ${total} ms`);
});

test("relecture après partie : on réessaie tant que la partie n'est pas arrivée, puis on s'arrête", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { relire, essais } = fausseRelecture([0, 0, 1, 0]);
  const r = creerRelectureApresPartie({ relire, delaisMs: [4000, 6000, 10000, 30000] });
  try {
    assert.strictEqual(r.demarrer(), true);
    await avancer(t, 3999);
    assert.deepStrictEqual(essais, []); // pas avant 4 s
    await avancer(t, 1);
    assert.deepStrictEqual(essais, [0]);
    await avancer(t, 6000);
    assert.deepStrictEqual(essais, [0, 1]);
    await avancer(t, 10000);
    assert.deepStrictEqual(essais, [0, 1, 2]); // partie trouvée à la 3e relecture
    assert.strictEqual(r.enCours(), false);
    await avancer(t, 60000);
    assert.deepStrictEqual(essais, [0, 1, 2]); // plus rien ensuite
  } finally {
    r.arreter();
  }
});

test("relecture après partie : les deux canaux voient la fin de partie, un seul cycle", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { relire, essais } = fausseRelecture([1]);
  const r = creerRelectureApresPartie({ relire, delaisMs: [4000, 6000] });
  try {
    assert.strictEqual(r.demarrer(), true); // sondage
    assert.strictEqual(r.demarrer(), false); // connexion en direct, juste après
    await avancer(t, 4000);
    assert.deepStrictEqual(essais, [0]);
    assert.strictEqual(r.enCours(), false);
    assert.strictEqual(r.demarrer(), true); // partie suivante : nouveau cycle
  } finally {
    r.arreter();
  }
});

test("relecture après partie : partie jamais ajoutée (remake) : on abandonne après le dernier délai", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { relire, essais } = fausseRelecture([]);
  const r = creerRelectureApresPartie({ relire, delaisMs: [4000, 6000, 10000] });
  try {
    r.demarrer();
    await avancer(t, 4000);
    await avancer(t, 6000);
    await avancer(t, 10000);
    assert.deepStrictEqual(essais, [0, 1, 2]);
    assert.strictEqual(r.enCours(), false);
  } finally {
    r.arreter();
  }
});

test("relecture après partie : une relecture qui plante (client occupé) n'arrête pas le cycle", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { relire, essais } = fausseRelecture([new Error("client occupé"), "abîmé", 2]);
  const erreurs = [];
  const r = creerRelectureApresPartie({ relire, aErreur: (nom, e) => erreurs.push(`${nom} : ${e.message}`), delaisMs: [10, 10, 10, 10] });
  try {
    r.demarrer();
    for (let i = 0; i < 3; i++) await avancer(t, 10);
    assert.deepStrictEqual(essais, [0, 1, 2]); // « abîmé » compte comme 0 partie : on continue
    assert.deepStrictEqual(erreurs, ["relecture après la partie : client occupé"]);
    assert.strictEqual(r.enCours(), false);
  } finally {
    r.arreter();
  }
});

test("relecture après partie : arreter() (on quitte l'appli) annule tout, même pendant une relecture", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let finir;
  const essais = [];
  const relire = (essai) => {
    essais.push(essai);
    return new Promise((resoudre) => (finir = resoudre));
  };
  const r = creerRelectureApresPartie({ relire, delaisMs: [10, 10, 10] });
  r.demarrer();
  await avancer(t, 10);
  r.arreter(); // pendant la relecture
  finir(0);
  await avancer(t, 100);
  assert.deepStrictEqual(essais, [0]);
  assert.strictEqual(r.enCours(), false);
});
