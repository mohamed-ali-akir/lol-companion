// Tests du fonctionnement en arrière-plan : réglages, croix, démarrage de Windows, menu de l'icône.
// (La partie Electron — icône, fenêtre cachée, instance unique — se vérifie en lançant l'appli.)
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const A = require("../arriere-plan.js");
const { creerStockage } = require("../stockage.js");

test("réglages par défaut : la croix réduit, pas de démarrage avec Windows", () => {
  assert.deepStrictEqual(A.normaliserReglagesArrierePlan(undefined), {
    fermerReduit: true, lancerAuDemarrage: false, demarrerReduit: false, prevenirClientDetecte: true, ouvrirAvecLeague: false, majAuto: true,
  });
  assert.deepStrictEqual(A.normaliserReglagesArrierePlan({ fermerReduit: "non", lancerAuDemarrage: 1, prevenirClientDetecte: "?" }), {
    fermerReduit: true, // pas un booléen : valeur par défaut
    lancerAuDemarrage: false,
    demarrerReduit: false,
    prevenirClientDetecte: true,
    ouvrirAvecLeague: false,
    majAuto: true,
  });
  assert.strictEqual(A.normaliserReglagesArrierePlan({ prevenirClientDetecte: false }).prevenirClientDetecte, false);
  assert.strictEqual(A.normaliserReglagesArrierePlan({ ouvrirAvecLeague: true }).ouvrirAvecLeague, true);
});

test("« LoL Companion est prêt » : seulement fenêtre cachée, option cochée, une fois par lancement de League", () => {
  const coche = { prevenirClientDetecte: true };
  assert.strictEqual(A.actionClientDetecte({ reglages: coche, fenetreVisible: false, dejaPrevenu: false }), "notifier");
  assert.strictEqual(A.actionClientDetecte({ reglages: coche, fenetreVisible: true, dejaPrevenu: false }), null);
  assert.strictEqual(A.actionClientDetecte({ reglages: coche, fenetreVisible: false, dejaPrevenu: true }), null);
  assert.strictEqual(A.actionClientDetecte({ reglages: { prevenirClientDetecte: false }, fenetreVisible: false, dejaPrevenu: false }), null);
  assert.strictEqual(A.actionClientDetecte({ reglages: undefined, fenetreVisible: false, dejaPrevenu: false }), "notifier"); // cochée par défaut
});

test("« Ouvrir la fenêtre quand League se lance » : ouvre au lieu de notifier, une fois, fenêtre cachée seulement", () => {
  const ouvrir = { ouvrirAvecLeague: true, prevenirClientDetecte: false };
  assert.strictEqual(A.actionClientDetecte({ reglages: ouvrir, fenetreVisible: false, dejaPrevenu: false }), "ouvrir");
  assert.strictEqual(A.actionClientDetecte({ reglages: { ouvrirAvecLeague: true }, fenetreVisible: false, dejaPrevenu: false }), "ouvrir");
  assert.strictEqual(A.actionClientDetecte({ reglages: ouvrir, fenetreVisible: true, dejaPrevenu: false }), null); // déjà ouverte
  assert.strictEqual(A.actionClientDetecte({ reglages: ouvrir, fenetreVisible: false, dejaPrevenu: true }), null); // même lancement de League
});

test("texte de la notification : ce qui est actif", () => {
  assert.strictEqual(A.texteClientDetecte({ acceptation: true }), "League est détecté. Actif : acceptation auto.");
  assert.strictEqual(
    A.texteClientDetecte({ acceptation: true, pick: true, ban: true, build: true }),
    "League est détecté. Actif : acceptation auto, pick et ban auto et build auto."
  );
  assert.strictEqual(A.texteClientDetecte({ ban: true }), "League est détecté. Actif : ban auto.");
  assert.match(A.texteClientDetecte(), /suit ton compte/);
});

test("« démarrer réduit » n'a de sens qu'avec le démarrage de Windows", () => {
  assert.strictEqual(A.normaliserReglagesArrierePlan({ lancerAuDemarrage: false, demarrerReduit: true }).demarrerReduit, false);
  assert.strictEqual(A.normaliserReglagesArrierePlan({ lancerAuDemarrage: true, demarrerReduit: true }).demarrerReduit, true);
});

test("la croix : cacher par défaut, quitter si réglage désactivé, si on quitte vraiment ou sans icône", () => {
  assert.strictEqual(A.actionFermeture({}), "cacher");
  assert.strictEqual(A.actionFermeture({ fermerReduit: false }), "quitter");
  assert.strictEqual(A.actionFermeture({ fermerReduit: true }, { quitteEnCours: true }), "quitter"); // menu "Quitter"
  assert.strictEqual(A.actionFermeture({ fermerReduit: true }, { iconeDisponible: false }), "quitter"); // sinon plus moyen de rouvrir
  assert.strictEqual(A.actionFermeture(null, {}), "cacher");
});

test("prévenir une seule fois que l'appli tourne toujours", () => {
  assert.strictEqual(A.doitPrevenirReduction({ action: "cacher", dejaPrevenu: false }), true);
  assert.strictEqual(A.doitPrevenirReduction({ action: "cacher", dejaPrevenu: true }), false);
  assert.strictEqual(A.doitPrevenirReduction({ action: "quitter", dejaPrevenu: false }), false);
});

test("démarrage de Windows : appli installée", () => {
  const lieu = { executable: "C:\\Program Files\\LoL Companion\\LoL Companion.exe", dossierAppli: "C:\\...\\app.asar", emballee: true };
  assert.deepStrictEqual(A.parametresDemarrageWindows({ lancerAuDemarrage: true }, lieu), { openAtLogin: true, path: lieu.executable, args: [] });
  assert.deepStrictEqual(A.parametresDemarrageWindows({ lancerAuDemarrage: true, demarrerReduit: true }, lieu), {
    openAtLogin: true,
    path: lieu.executable,
    args: ["--reduit"],
  });
  assert.strictEqual(A.parametresDemarrageWindows({}, lieu).openAtLogin, false); // désactivé : Windows l'oublie
});

test("démarrage de Windows : pendant le développement, electron.exe reçoit le dossier du projet", () => {
  const lieu = { executable: "C:\\projet\\node_modules\\electron\\dist\\electron.exe", dossierAppli: "C:\\projet", emballee: false };
  assert.deepStrictEqual(A.parametresDemarrageWindows({ lancerAuDemarrage: true, demarrerReduit: true }, lieu).args, ["C:\\projet", "--reduit"]);
});

test("estDemarrageReduit lit l'argument --reduit", () => {
  assert.strictEqual(A.estDemarrageReduit(["electron.exe", "C:\\projet", "--reduit"]), true);
  assert.strictEqual(A.estDemarrageReduit(["LoL Companion.exe"]), false);
  assert.strictEqual(A.estDemarrageReduit(undefined), false);
});

test("menu de l'icône : Ouvrir, Acceptation auto (cochée selon le réglage), Quitter", () => {
  const menu = A.modeleMenuIcone({ acceptationActive: true });
  assert.deepStrictEqual(menu.filter((e) => e.id).map((e) => e.id), ["ouvrir", "acceptation", "quitter"]);
  const caseAcceptation = menu.find((e) => e.id === "acceptation");
  assert.strictEqual(caseAcceptation.type, "checkbox");
  assert.strictEqual(caseAcceptation.checked, true);
  assert.strictEqual(A.modeleMenuIcone({}).find((e) => e.id === "acceptation").checked, false);
  assert.strictEqual(menu[menu.length - 1].id, "quitter"); // Quitter en dernier, comme d'habitude sous Windows
});

test("stockage : réglages d'arrière-plan et « déjà prévenu » enregistrés", () => {
  const stockage = creerStockage({ dossier: fs.mkdtempSync(path.join(os.tmpdir(), "arriere-plan-")) });
  assert.deepStrictEqual(stockage.reglagesArrierePlan(), A.REGLAGES_ARRIERE_PLAN_PAR_DEFAUT);
  const propres = stockage.enregistrerReglagesArrierePlan({ fermerReduit: false, lancerAuDemarrage: true, demarrerReduit: true });
  assert.deepStrictEqual(stockage.reglagesArrierePlan(), propres);
  assert.strictEqual(propres.demarrerReduit, true);
  assert.strictEqual(stockage.dejaPrevenuReduction(), false);
  stockage.noterPrevenuReduction();
  assert.strictEqual(stockage.dejaPrevenuReduction(), true);
});

test("menu Mac : Édition (Cmd+C, Cmd+V...) et Quitter (Cmd+Q), en français", () => {
  const menu = A.modeleMenuMac("LoL Companion");
  assert.deepStrictEqual(menu.map((m) => m.label), ["LoL Companion", "Édition", "Fenêtre"]);
  const roles = (label) => menu.find((m) => m.label === label).submenu.map((l) => l.role).filter(Boolean);
  assert.deepStrictEqual(roles("Édition"), ["undo", "redo", "cut", "copy", "paste", "selectAll"]);
  assert.ok(roles("LoL Companion").includes("quit"));
  assert.ok(roles("LoL Companion").includes("hide"));
  assert.strictEqual(menu[0].submenu.find((l) => l.role === "quit").label, "Quitter LoL Companion");
});
