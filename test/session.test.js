// Tests du bilan de session : découpage des sessions, défaites d'affilée, XP, temps de jeu, alertes.
// Les dates sont créées en heure locale (new Date(année, mois, jour, h, min)) : les tests passent
// quel que soit le fuseau horaire de la machine.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const C = require("../src/calculs.js");
const { alertesDuCompte, creerSuiviAlertes } = require("../session.js");
const { creerStockage } = require("../stockage.js");

const MIN = 60 * 1000;
const le = (jour, h, m = 0) => new Date(2026, 8, jour, h, m).getTime(); // septembre 2026, heure locale
let prochainId = 1;
function partie({ date, minutes = 30, victoire = true, championId = 103, championNom = "Ahri", file = 450, k = 5, d = 3, a = 8 }) {
  return { id: prochainId++, date, dureeS: minutes * 60, file, championId, championNom, victoire, kills: k, deaths: d, assists: a };
}
const ids = (liste) => liste.map((p) => p.id);

// --- Découpage des sessions ------------------------------------------------------------------------

test("session « aujourd'hui » : seulement les parties depuis minuit", () => {
  const hier = partie({ date: le(29, 15) });
  const matin = partie({ date: le(30, 10) });
  const midi = partie({ date: le(30, 12) });
  const session = C.partiesDeSession([midi, hier, matin], { mode: "aujourdhui", maintenant: le(30, 13) });
  assert.deepStrictEqual(ids(session), [matin.id, midi.id]); // de la plus ancienne à la plus récente
});

test("session « aujourd'hui » : appli lancée en cours de journée -> les parties du matin comptent quand même", () => {
  const matin = partie({ date: le(30, 9) });
  const apres = partie({ date: le(30, 16) });
  const session = C.partiesDeSession([matin, apres], { mode: "aujourdhui", lancement: le(30, 15), maintenant: le(30, 17) });
  assert.deepStrictEqual(ids(session), [matin.id, apres.id]);
});

test("session à minuit : une soirée sans vraie pause continue après minuit", () => {
  const a = partie({ date: le(29, 23, 0) }); // finit à 23:30
  const b = partie({ date: le(29, 23, 45) }); // 15 min de pause, finit à 00:15
  const c = partie({ date: le(30, 0, 30) }); // 15 min de pause
  const session = C.partiesDeSession([a, b, c], { maintenant: le(30, 1, 10) });
  assert.deepStrictEqual(ids(session), [a.id, b.id, c.id]);
});

test("session à minuit : après une vraie pause (plus de 45 min), la nouvelle journée repart de zéro", () => {
  const soir = partie({ date: le(29, 22, 0) }); // finit à 22:30
  const nuit = partie({ date: le(30, 0, 10) }); // 1 h 40 de pause
  assert.deepStrictEqual(ids(C.partiesDeSession([soir, nuit], { maintenant: le(30, 1) })), [nuit.id]);
  // Aucune partie depuis minuit : session vide, même si tu as joué tard hier soir.
  assert.deepStrictEqual(C.partiesDeSession([partie({ date: le(29, 23, 0) })], { maintenant: le(30, 0, 5) }), []);
});

test("session « depuis l'ouverture » : parties terminées après le lancement de l'appli", () => {
  const avant = partie({ date: le(30, 13, 0) }); // finit à 13:30, avant le lancement
  const enCours = partie({ date: le(30, 13, 45) }); // commencée avant, finie à 14:15 : comptée
  const apres = partie({ date: le(30, 15, 0) });
  const options = { mode: "ouverture", lancement: le(30, 14, 0), maintenant: le(30, 16) };
  assert.deepStrictEqual(ids(C.partiesDeSession([avant, enCours, apres], options)), [enCours.id, apres.id]);
  assert.deepStrictEqual(C.partiesDeSession([apres], { mode: "ouverture", maintenant: le(30, 16) }), []); // lancement inconnu
});

test("partiesDeSession : données abîmées et parties dans le futur ignorées", () => {
  const ok = partie({ date: le(30, 10) });
  const futur = partie({ date: le(30, 20) });
  assert.deepStrictEqual(ids(C.partiesDeSession([null, { id: 9 }, ok, futur], { maintenant: le(30, 12) })), [ok.id]);
  assert.deepStrictEqual(C.partiesDeSession(undefined), []);
});

// --- Défaites d'affilée, XP, temps de jeu ----------------------------------------------------------------

test("defaitesDAffilee : depuis la partie la plus récente, remakes ignorés", () => {
  const liste = [
    partie({ date: le(30, 10), victoire: true }),
    partie({ date: le(30, 11), victoire: false }),
    partie({ date: le(30, 12), victoire: true, minutes: 3 }), // remake : ne casse pas la série
    partie({ date: le(30, 13), victoire: false }),
    partie({ date: le(30, 14), victoire: false, minutes: 4 }), // remake : ne compte pas
    partie({ date: le(30, 15), victoire: false }),
  ];
  assert.strictEqual(C.defaitesDAffilee(liste), 3);
  assert.strictEqual(C.defaitesDAffilee([partie({ date: le(30, 10) })]), 0);
  assert.strictEqual(C.defaitesDAffilee([]), 0);
});

test("xpDePartie : formule du wiki, bots réduits, parties trop courtes à 0", () => {
  const victoire = partie({ date: 0, minutes: 30, victoire: true });
  const defaite = partie({ date: 0, minutes: 30, victoire: false });
  assert.strictEqual(Math.round(C.xpDePartie(victoire) * 10) / 10, 204.6); // 0,11 × 1800 + 6,6
  assert.strictEqual(Math.round(C.xpDePartie(defaite) * 10) / 10, 167.4); // 0,09 × 1800 + 5,4
  const bots = partie({ date: 0, minutes: 30, victoire: true, file: 870 });
  assert.strictEqual(Math.round(C.xpDePartie(bots, 25) * 100) / 100, Math.round(204.6 * 0.8 * 100) / 100);
  assert.strictEqual(C.xpDePartie(partie({ date: 0, minutes: 6 })), 0);
  assert.strictEqual(C.xpDePartie({ victoire: true }), 0); // durée manquante
  assert.strictEqual(C.xpDePartie(null), 0);
});

test("bilanSession : parties, V/D, XP, temps de jeu, meilleur champion (remakes exclus)", () => {
  const liste = [
    partie({ date: le(30, 10), minutes: 30, victoire: true, championId: 103, championNom: "Ahri", k: 10, d: 2, a: 5 }),
    partie({ date: le(30, 11), minutes: 20, victoire: false, championId: 99, championNom: "Lux" }),
    partie({ date: le(30, 12), minutes: 25, victoire: true, championId: 99, championNom: "Lux", k: 1, d: 6, a: 2 }),
    partie({ date: le(30, 13), minutes: 3, victoire: false }), // remake
    partie({ date: le(30, 14), minutes: 40, victoire: true, championId: 103, championNom: "Ahri", k: 4, d: 4, a: 4 }),
  ];
  const b = C.bilanSession(liste);
  assert.strictEqual(b.parties, 4);
  assert.strictEqual(b.victoires, 3);
  assert.strictEqual(b.defaites, 1);
  assert.strictEqual(b.dureeS, (30 + 20 + 25 + 40) * 60);
  const xpAttendue = 0.11 * 1800 + 6.6 + (0.09 * 1200 + 5.4) + (0.11 * 1500 + 6.6) + (0.11 * 2400 + 6.6);
  assert.strictEqual(b.xp, Math.round(xpAttendue));
  assert.strictEqual(b.debut, le(30, 10));
  assert.strictEqual(b.fin, le(30, 14, 40));
  assert.strictEqual(b.meilleur.nom, "Ahri"); // 2 victoires contre 1
  assert.strictEqual(b.meilleur.victoires, 2);
  assert.strictEqual(b.defaitesDAffilee, 0);
  assert.strictEqual(C.bilanSession([]), null);
  assert.strictEqual(C.bilanSession([partie({ date: le(30, 10), minutes: 2 })]), null); // seulement un remake
});

test("bilanSession : à victoires égales, le meilleur taux puis le meilleur KDA", () => {
  const liste = [
    partie({ date: le(30, 10), victoire: true, championId: 1, championNom: "Annie", k: 2, d: 5, a: 2 }),
    partie({ date: le(30, 11), victoire: true, championId: 222, championNom: "Jinx", k: 12, d: 1, a: 6 }),
  ];
  assert.strictEqual(C.bilanSession(liste).meilleur.nom, "Jinx");
});

test("texteDuree", () => {
  assert.strictEqual(C.texteDuree(45 * 60), "45 min");
  assert.strictEqual(C.texteDuree(3600), "1 h");
  assert.strictEqual(C.texteDuree(2 * 3600 + 5 * 60), "2 h 05");
  assert.strictEqual(C.texteDuree(undefined), "0 min");
});

// --- Réglages et alertes -----------------------------------------------------------------------------

test("normaliserReglagesSession : valeurs par défaut (rappel de durée et notification désactivés)", () => {
  assert.deepStrictEqual(C.normaliserReglagesSession(undefined), {
    mode: "aujourdhui",
    alerteDefaites: true,
    seuilDefaites: 3,
    rappelDuree: false,
    heuresRappel: 2,
    notifier: false,
  });
  const r = C.normaliserReglagesSession({ mode: "ouverture", seuilDefaites: 50, heuresRappel: "1.3", notifier: "oui", alerteDefaites: false });
  assert.strictEqual(r.mode, "ouverture");
  assert.strictEqual(r.seuilDefaites, 10); // borné
  assert.strictEqual(r.heuresRappel, 1.5); // arrondi à la demi-heure
  assert.strictEqual(r.notifier, false); // pas un booléen : valeur par défaut
  assert.strictEqual(r.alerteDefaites, false);
  assert.strictEqual(C.normaliserReglagesSession({ mode: "n'importe quoi", seuilDefaites: "" }).mode, "aujourdhui");
  assert.strictEqual(C.normaliserReglagesSession({ seuilDefaites: null }).seuilDefaites, 3);
});

function soireeDeDefaites(nombre, debut = le(30, 20)) {
  return Array.from({ length: nombre }, (_, i) => partie({ date: debut + i * 35 * MIN, minutes: 30, victoire: false }));
}

test("alertesSession : pause proposée à partir de 3 défaites d'affilée, message bienveillant", () => {
  const trois = C.bilanSession(soireeDeDefaites(3));
  const maintenant = trois.fin + 2 * MIN;
  const [alerte, ...autres] = C.alertesSession(trois, {}, maintenant);
  assert.strictEqual(autres.length, 0);
  assert.strictEqual(alerte.type, "pause");
  assert.strictEqual(alerte.titre, "3 défaites d'affilée. Une pause de 10 minutes ?");
  assert.doesNotMatch(`${alerte.titre} ${alerte.message}`, /arrête|interdit|bloqu|nul|mauvais/i);
  assert.deepStrictEqual(C.alertesSession(C.bilanSession(soireeDeDefaites(2)), {}, maintenant), []);
  assert.deepStrictEqual(C.alertesSession(trois, { alerteDefaites: false }, maintenant), []); // désactivée
  assert.deepStrictEqual(C.alertesSession(trois, { seuilDefaites: 4 }, maintenant), []); // seuil réglable
  assert.deepStrictEqual(C.alertesSession(trois, {}, trois.fin + 60 * MIN), []); // pause déjà faite
  assert.deepStrictEqual(C.alertesSession(null, {}, maintenant), []);
});

test("alertesSession : rappel « Tu joues depuis 2 h » seulement s'il est activé", () => {
  const parties = Array.from({ length: 4 }, (_, i) => partie({ date: le(30, 14) + i * 35 * MIN, victoire: i % 2 === 0 }));
  const bilan = C.bilanSession(parties); // de 14:00 à 16:15
  const maintenant = le(30, 16, 20);
  assert.deepStrictEqual(C.alertesSession(bilan, {}, maintenant), []); // désactivé par défaut
  const [rappel] = C.alertesSession(bilan, { rappelDuree: true }, maintenant);
  assert.strictEqual(rappel.type, "duree");
  assert.strictEqual(rappel.titre, "Tu joues depuis 2 h.");
  assert.deepStrictEqual(C.alertesSession(bilan, { rappelDuree: true, heuresRappel: 3 }, maintenant), []);
});

test("creerSuiviAlertes : une seule notification par alerte ; rien au lancement", () => {
  const suivi = creerSuiviAlertes();
  const pause = { type: "pause", cle: "pause-12", titre: "t", message: "m" };
  assert.deepStrictEqual(suivi.aNotifier([pause]), [pause]);
  assert.deepStrictEqual(suivi.aNotifier([pause]), []); // 4e défaite de la même série : pas de nouvelle notification
  const autre = { ...pause, cle: "pause-20" }; // nouvelle série (après une victoire)
  assert.deepStrictEqual(suivi.aNotifier([autre]), [autre]);

  const auLancement = creerSuiviAlertes();
  assert.deepStrictEqual(auLancement.aNotifier([pause], { silencieux: true }), []); // série déjà en cours au lancement
  assert.deepStrictEqual(auLancement.aNotifier([pause]), []);
  assert.deepStrictEqual(auLancement.aNotifier(undefined), []);
});

test("alertesDuCompte : de l'historique complet aux alertes du moment", () => {
  const parties = [partie({ date: le(29, 15), victoire: false }), ...soireeDeDefaites(3)];
  const derniere = parties[parties.length - 1];
  const { bilan, alertes } = alertesDuCompte({
    parties,
    reglages: C.normaliserReglagesSession({}),
    lancement: le(30, 19),
    niveau: 25,
    maintenant: derniere.date + 35 * MIN,
  });
  assert.strictEqual(bilan.parties, 3); // la défaite d'hier ne fait pas partie de la session
  assert.strictEqual(alertes.length, 1);
  assert.strictEqual(alertes[0].cle, `pause-${parties[1].id}`);
});

test("stockage : réglages de session enregistrés et nettoyés", () => {
  const stockage = creerStockage({ dossier: fs.mkdtempSync(path.join(os.tmpdir(), "session-")) });
  assert.strictEqual(stockage.reglagesSession().alerteDefaites, true);
  const propres = stockage.enregistrerReglagesSession({ mode: "ouverture", seuilDefaites: 1, rappelDuree: true });
  assert.strictEqual(propres.seuilDefaites, 2);
  assert.deepStrictEqual(stockage.reglagesSession(), propres);
});
