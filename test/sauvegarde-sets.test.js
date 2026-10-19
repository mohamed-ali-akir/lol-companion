// Tests de la sauvegarde de tes sets d'objets (sauvegarde-sets.js), dans un dossier temporaire.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const S = require("../sauvegarde-sets.js");

test("ajout : rien n'est oublié, la version la plus récente d'un même set remplace l'ancienne", () => {
  const anciens = [{ uid: "a", title: "Porofessor", v: 1 }, { title: "Sans identifiant", v: 1 }];
  const nouveaux = [{ uid: "a", title: "Porofessor", v: 2 }, { title: "Sans identifiant", v: 2 }, { uid: "b", title: "Nouveau" }, null];
  assert.deepStrictEqual(S.ajouterSets(anciens, nouveaux), [
    { uid: "a", title: "Porofessor", v: 2 },
    { title: "Sans identifiant", v: 2 },
    { uid: "b", title: "Nouveau" },
  ]);
  assert.deepStrictEqual(S.ajouterSets(undefined, [{ uid: "c" }]), [{ uid: "c" }]);
});

test("fichier abîmé ou modifié à la main : on garde ce qui est lisible", () => {
  assert.deepStrictEqual(S.sauvegardeValide({ 42: [{ uid: "a" }, "x", null], 7: "pas une liste" }), { 42: [{ uid: "a" }] });
  assert.deepStrictEqual(S.sauvegardeValide([1, 2]), {});
  assert.deepStrictEqual(S.sauvegardeValide(null), {});
});

test("sur le disque : un compte = une liste, cumulée d'une fois sur l'autre, jamais mélangée avec un autre compte", () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "sets-sauvegarde-"));
  const sauvegarde = S.creerSauvegardeSets({ dossier });
  assert.deepStrictEqual(sauvegarde.setsDu(42), [], "rien au départ");
  sauvegarde.ajouter(42, [{ uid: "a" }]);
  sauvegarde.ajouter("42", [{ uid: "b" }]);
  sauvegarde.ajouter(7, [{ uid: "z" }]);
  assert.deepStrictEqual(sauvegarde.setsDu("42"), [{ uid: "a" }, { uid: "b" }]);
  assert.deepStrictEqual(S.creerSauvegardeSets({ dossier }).setsDu(7), [{ uid: "z" }], "relu après redémarrage");
});
