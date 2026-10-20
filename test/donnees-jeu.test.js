// Données du jeu (donnees-jeu.js) : une seule source, et la copie de la page (src/calculs.js) qui doit rester identique.
const test = require("node:test");
const assert = require("node:assert");
const D = require("../donnees-jeu.js");
const C = require("../src/calculs.js");

test("files : la page classe les parties comme le processus principal (Arena, ARAM Mayhem, Faille)", () => {
  for (const file of D.FILES.arena) assert.strictEqual(C.genreDePartie(file), "arena", `file ${file}`);
  assert.strictEqual(C.genreDePartie(D.FILES.mayhem), "aram");
  for (const file of D.FILES.faille) assert.strictEqual(C.genreDePartie(file), "faille", `file ${file}`);
});

test("les modules lisent bien ces données (plus de copie recopiée à la main)", () => {
  assert.deepStrictEqual([...require("../challenge.js").FILES_ARENA], D.FILES.arena);
  assert.deepStrictEqual(require("../augments.js").FILES_ARENA, D.FILES.arena);
  assert.strictEqual(require("../augments.js").FILE_MAYHEM, D.FILES.mayhem);
  assert.strictEqual(require("../stats-build.js").DECALAGE_ARENA, D.DECALAGE_ARENA);
  assert.strictEqual(D.RECHARGES_SORTS.Flash.rechargeS, 300);
  assert.match(D.VERIFIE_LE, /^\d\d\/\d\d\/\d{4}$/);
});
