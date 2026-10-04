// Tests de l'enregistrement de la progression (dans un dossier temporaire, sans Electron).
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { creerProgression, ajouterPoint, creerPoint, pointsValides, riotIdDe } = require("../progression.js");

const point = (riotId, niveau, progression, date) => ({ date, riotId, niveau, progression, xpTotale: niveau * 1000 + progression });

function nouvelleProgression() {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "progression-test-"));
  return { dossier, progression: creerProgression({ dossier }) };
}

test("Riot ID : pseudo#tag, ou juste le pseudo", () => {
  assert.strictEqual(riotIdDe({ nom: "wDark", tag: "Amumu" }), "wDark#Amumu");
  assert.strictEqual(riotIdDe({ nom: "wDark" }), "wDark");
  assert.strictEqual(riotIdDe({}), "Compte");
});

test("point créé à partir du compte lu dans le client", () => {
  const p = creerPoint({ nom: "wDark", tag: "Amumu", niveau: 24, progression: 63 }, 25123.6, new Date("2026-09-30T16:05:00Z"));
  assert.deepStrictEqual(p, { date: "2026-09-30T16:05:00.000Z", riotId: "wDark#Amumu", niveau: 24, progression: 63, xpTotale: 25124 });
});

test("pas de doublon : rien n'a changé -> pas de nouveau point", () => {
  let r = ajouterPoint([], point("A#1", 24, 50, "2026-09-30T10:00:00Z"));
  assert.strictEqual(r.ajoute, true);
  r = ajouterPoint(r.points, point("A#1", 24, 50, "2026-09-30T11:00:00Z"));
  assert.strictEqual(r.ajoute, false);
  assert.strictEqual(r.points.length, 1);
  r = ajouterPoint(r.points, point("A#1", 24, 55, "2026-09-30T12:00:00Z"));
  assert.strictEqual(r.ajoute, true);
  assert.strictEqual(r.points.length, 2);
});

test("changement de compte : chaque compte a sa propre liste", () => {
  let { points } = ajouterPoint([], point("A#1", 24, 50, "2026-09-30T10:00:00Z"));
  // Même niveau et progression, mais autre compte : ce n'est pas un doublon.
  ({ points } = ajouterPoint(points, point("B#2", 24, 50, "2026-09-30T10:05:00Z")));
  assert.strictEqual(points.length, 2);
});

test("au maximum N points par compte : les plus anciens sont supprimés", () => {
  let points = [point("Autre#1", 5, 0, "2026-01-01T00:00:00Z")];
  for (let i = 0; i < 5; i++) {
    ({ points } = ajouterPoint(points, point("A#1", 10, i, `2026-09-0${i + 1}T00:00:00Z`), 3));
  }
  const duCompte = points.filter((p) => p.riotId === "A#1");
  assert.deepStrictEqual(duCompte.map((p) => p.progression), [2, 3, 4]);
  assert.strictEqual(points.filter((p) => p.riotId === "Autre#1").length, 1); // l'autre compte n'est pas touché
});

test("points abîmés ignorés", () => {
  assert.deepStrictEqual(pointsValides(null), []);
  assert.deepStrictEqual(pointsValides({ pas: "une liste" }), []);
  const bon = point("A#1", 24, 50, "2026-09-30T10:00:00Z");
  assert.deepStrictEqual(pointsValides([bon, { riotId: "A#1", niveau: "x" }, null, { ...bon, date: "hier" }]), [bon]);
});

test("fichier : ajout, lecture triée par date, effacement", () => {
  const { progression } = nouvelleProgression();
  assert.deepStrictEqual(progression.pointsDu("A#1"), []);

  progression.ajouter(point("A#1", 24, 60, "2026-09-30T12:00:00Z"));
  progression.ajouter(point("A#1", 24, 60, "2026-09-30T13:00:00Z")); // doublon
  progression.ajouter(point("B#2", 50, 10, "2026-09-30T12:30:00Z"));
  progression.ajouter(point("A#1", 25, 5, "2026-10-01T12:00:00Z"));

  assert.deepStrictEqual(progression.pointsDu("A#1").map((p) => p.niveau), [24, 25]);
  assert.strictEqual(progression.pointsDu("B#2").length, 1);

  progression.effacer();
  assert.deepStrictEqual(progression.lire(), []);
  progression.effacer(); // deux fois de suite : pas d'erreur
});

test("fichier JSON abîmé -> on repart de zéro sans planter", () => {
  const { dossier, progression } = nouvelleProgression();
  fs.writeFileSync(path.join(dossier, "progression.json"), "{ pas du json");
  assert.deepStrictEqual(progression.lire(), []);
  assert.strictEqual(progression.ajouter(point("A#1", 24, 60, "2026-09-30T12:00:00Z")), true);
  assert.strictEqual(progression.lire().length, 1);
});
