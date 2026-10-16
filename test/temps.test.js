// Tests du temps passé sur le jeu (compté sur les parties enregistrées + estimé avec l'XP du compte).
const test = require("node:test");
const assert = require("node:assert");
const C = require("../src/calculs.js");

const MAINTENANT = new Date("2026-10-16T12:00:00").getTime();
const JOUR = 24 * 3600 * 1000;
const partie = (jours, minutes, plus = {}) => ({ date: MAINTENANT - jours * JOUR, dureeS: minutes * 60, file: 400, championNom: "Ahri", victoire: true, ...plus });

test("rien à calculer : ni compte ni partie -> null", () => {
  assert.strictEqual(C.tempsDeJeu({ parties: [], compte: null }), null);
  assert.strictEqual(C.tempsDeJeu({ parties: undefined, compte: { niveau: 0 } }), null);
});

test("compté : durée exacte des parties + 1 min de file chacune ; les remakes (< 5 min) ne comptent pas", () => {
  const parties = [partie(1, 30), partie(2, 20), partie(3, 3), { date: 1 }, null];
  const t = C.tempsDeJeu({ parties, compte: null, maintenant: MAINTENANT });
  assert.strictEqual(t.compte.parties, 2);
  assert.strictEqual(t.compte.heuresEnJeu, 50 / 60);
  assert.strictEqual(t.compte.heures, 52 / 60); // 50 min de jeu + 2 × 1 min de file
  assert.strictEqual(t.compte.depuis, MAINTENANT - 2 * JOUR);
  assert.strictEqual(t.estime, null);
  assert.strictEqual(t.total, 52 / 60);
});

test("estimé : XP totale du compte / XP d'une partie moyenne (ta durée, ton taux de victoire)", () => {
  const compte = { niveau: 27, progression: 50 };
  const parties = [partie(1, 25, { victoire: true }), partie(2, 25, { victoire: false })];
  const t = C.tempsDeJeu({ parties, compte, maintenant: MAINTENANT });
  const xp = C.xpDuCompte(compte);
  const parPartie = C.xpMoyenneParPartie({ dureeMin: 25, tauxVictoire: 0.5, niveau: 27, bots: false });
  assert.strictEqual(t.estime.parties, Math.round(xp / parPartie));
  assert.ok(Math.abs(t.estime.heures - ((xp / parPartie) * 26) / 60) < 1e-9); // 25 min + 1 min de file
  assert.strictEqual(t.total, t.estime.heures);
  assert.strictEqual(t.jours, t.total / 24);
  assert.strictEqual(t.films, Math.floor(t.total / 2));
});

test("sans partie enregistrée : estimation avec une partie moyenne de 25 min et 50 % de victoires", () => {
  const t = C.tempsDeJeu({ parties: [], compte: { niveau: 100, progression: 0 } });
  assert.strictEqual(t.compte.parties, 0);
  assert.strictEqual(t.compte.depuis, null);
  assert.ok(t.estime.heures > 0);
  assert.strictEqual(t.plusLongue, null);
  assert.deepStrictEqual(t.modes, []);
});

test("total : jamais plus petit que ce qu'on a compté", () => {
  const beaucoup = Array.from({ length: 50 }, (_, i) => partie(i % 20, 40));
  const t = C.tempsDeJeu({ parties: beaucoup, compte: { niveau: 2, progression: 0 }, maintenant: MAINTENANT });
  assert.ok(t.estime.heures < t.compte.heures);
  assert.strictEqual(t.total, t.compte.heures);
});

test("stats amusantes : plus longue partie, top modes et champions, parties de nuit, rythme sur 30 jours", () => {
  const parties = [
    partie(1, 40, { championNom: "Jayce", victoire: false }),
    partie(2, 25, { championNom: "Hwei", file: 2400 }),
    partie(3, 25, { championNom: "Hwei", file: 2400 }),
    { ...partie(40, 30, { championNom: "Lux" }), date: new Date("2026-08-01T02:30:00").getTime() }, // il y a plus de 30 jours, à 2 h 30
  ];
  const t = C.tempsDeJeu({ parties, compte: null, maintenant: MAINTENANT });
  assert.deepStrictEqual(t.plusLongue, { minutes: 40, champion: "Jayce", victoire: false });
  assert.strictEqual(t.champions[0].nom, "Hwei");
  assert.strictEqual(t.modes[0].nom, C.nomFile(400)); // Draft : Jayce 40 min + Lux 30 min
  assert.strictEqual(t.partiesDeNuit, 1 / 4);
  // 30 derniers jours : 90 min de jeu + 3 × 1 min de file, ramenés à une semaine
  assert.ok(Math.abs(t.heuresParSemaine - (93 / 60) / (30 / 7)) < 1e-9);
});
