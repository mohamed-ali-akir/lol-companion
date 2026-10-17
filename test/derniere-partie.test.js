// Tests du résumé d'après-partie (carte « Ta dernière partie » de l'Accueil) :
// lecture des détails dans l'historique du client (lcu.js), parties déjà enregistrées complétées (parties.js),
// comparaison avec tes habitudes (src/calculs.js).
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { extraireParties } = require("../lcu.js");
const P = require("../parties.js");
const C = require("../src/calculs.js");

const MIN = 60 * 1000;
let prochainId = 1;
/** Partie de 30 min par défaut, sur la Faille (Classée Solo/Duo). */
function partie({ date, minutes = 30, file = 420, victoire = true, k = 5, d = 5, a = 5, ...details } = {}) {
  return { id: prochainId++, date, dureeS: minutes * 60, file, championId: 103, championNom: "Ahri", victoire, kills: k, deaths: d, assists: a, ...details };
}
/** n parties précédentes identiques, de plus en plus anciennes avant "debut". */
const habitudes = (n, debut, o) => Array.from({ length: n }, (_, i) => partie({ date: debut - (i + 1) * 60 * MIN, ...o }));
const mesure = (resume, cle) => resume.mesures.find((m) => m.cle === cle);

// --- Lecture dans l'historique du client -----------------------------------------------------------

test("extraction : CS (sbires + monstres), or, dégâts, vision ; champs absents ou abîmés oubliés", () => {
  const moi = (stats) => ({ participants: [{ participantId: 1, championId: 103, stats }], participantIdentities: [] });
  const historique = {
    games: {
      games: [
        { gameId: 1, gameCreation: 1, gameDuration: 1800, queueId: 420,
          ...moi({ win: true, kills: 1, deaths: 2, assists: 3, totalMinionsKilled: 180, neutralMinionsKilled: 12, goldEarned: 11000, totalDamageDealtToChampions: 21000, visionScore: 25 }) },
        { gameId: 2, gameCreation: 2, gameDuration: 1800, queueId: 420,
          ...moi({ win: false, kills: 0, deaths: 0, assists: 0, totalMinionsKilled: -3, neutralMinionsKilled: 4, goldEarned: "beaucoup", visionScore: null }) },
      ],
    },
  };
  const [a, b] = extraireParties(historique, "p");
  assert.deepStrictEqual([a.cs, a.or, a.degats, a.vision], [192, 11000, 21000, 25]);
  assert.strictEqual(b.cs, 4, "sbires illisibles : seulement les monstres");
  assert.ok(!("or" in b) && !("degats" in b) && !("vision" in b));
});

// --- Historique local : anciennes parties complétées ----------------------------------------------

test("parties enregistrées sans détails : complétées quand le client les relit avec (une fois, sans toucher aux autres comptes)", () => {
  const ancienne = { ...partie({ date: 1000 }), riotId: "Moi#EUW" };
  const autreCompte = { ...ancienne, riotId: "Autre#EUW" };
  const relue = { ...ancienne, cs: 200, or: 12000, degats: -5 };
  const { parties, completees } = P.completerDetails([ancienne, autreCompte], "Moi#EUW", [relue]);
  assert.strictEqual(completees, 1);
  assert.deepStrictEqual([parties[0].cs, parties[0].or, "degats" in parties[0]], [200, 12000, false], "détail abîmé : oublié");
  assert.strictEqual(parties[1], autreCompte);
  // Déjà complétée : rien à refaire
  const encore = P.completerDetails(parties, "Moi#EUW", [{ ...relue, cs: 999 }]);
  assert.deepStrictEqual([encore.completees, encore.parties[0].cs], [0, 200]);
  assert.strictEqual(P.completerDetails([ancienne], "Moi#EUW", null).completees, 0);
});

test("fichier modifié à la main : un détail abîmé est oublié, la partie est gardée", () => {
  const [p] = P.partiesValides([{ ...partie({ date: 1 }), riotId: "Moi#EUW", cs: "beaucoup", or: 9000 }]);
  assert.deepStrictEqual(["cs" in p, p.or], [false, 9000]);
});

test("historique sur disque : les anciennes parties sont complétées et enregistrées", () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "parties-details-"));
  const historique = P.creerHistoriqueParties({ dossier });
  const sans = partie({ date: 5000 });
  historique.ajouter("Moi#EUW", [sans]);
  assert.strictEqual(historique.ajouter("Moi#EUW", [{ ...sans, cs: 150 }]), 0, "pas une partie nouvelle");
  assert.strictEqual(historique.partiesDu("Moi#EUW")[0].cs, 150);
});

// --- Comparaison avec tes habitudes ---------------------------------------------------------------

test("dernière partie comparée à la moyenne des précédentes : valeurs par minute, écart, tendance", () => {
  const maintenant = Date.now();
  // Habitude : 6 CS/min (180 en 30 min), 400 or/min, KDA 2.
  const avant = habitudes(5, maintenant, { cs: 180, or: 12000, degats: 15000, vision: 30, k: 4, d: 4, a: 4 });
  const derniere = partie({ date: maintenant, cs: 240, or: 11000, degats: 15300, vision: 15, k: 10, d: 2, a: 6 });
  const resume = C.resumeDernierePartie([...avant, derniere]);
  assert.strictEqual(resume.partie, derniere);
  assert.deepStrictEqual([resume.genre, resume.comparees], ["faille", 5]);
  assert.deepStrictEqual(resume.mesures.map((m) => m.cle), ["kda", "cs", "or", "degats", "vision"]);
  assert.deepStrictEqual([mesure(resume, "cs").valeur, mesure(resume, "cs").moyenne, mesure(resume, "cs").ecart], [8, 6, 2]);
  assert.deepStrictEqual(resume.mesures.map((m) => m.tendance), ["mieux", "mieux", "moins", "pareil", "moins"]);
  assert.strictEqual(C.phraseDernierePartie(resume), "Dans tes habitudes (sur 5 points).");
});

test("ARAM : comparée seulement aux ARAM (pas de vision) ; Arena : ni CS ni vision", () => {
  const maintenant = Date.now();
  const faille = habitudes(5, maintenant, { cs: 300 });
  const aram = habitudes(3, maintenant - 10 * 60 * MIN, { file: 450, cs: 60, vision: 5 });
  const resume = C.resumeDernierePartie([...faille, ...aram, partie({ date: maintenant, file: 450, cs: 60, vision: 5 })]);
  assert.deepStrictEqual([resume.genre, resume.comparees], ["aram", 3]);
  assert.deepStrictEqual(resume.mesures.map((m) => m.cle), ["kda", "cs"]);
  assert.strictEqual(mesure(resume, "cs").tendance, "pareil");
  const arena = C.resumeDernierePartie([partie({ date: maintenant, file: 1700, cs: 0, or: 9000, vision: 0 })]);
  assert.deepStrictEqual(arena.mesures.map((m) => m.cle), ["kda", "or"]);
  assert.strictEqual(C.genreDePartie(null), "faille", "file inconnue : Faille");
});

test("pas assez de parties à comparer : valeurs montrées, sans moyenne ni phrase", () => {
  const maintenant = Date.now();
  const resume = C.resumeDernierePartie([...habitudes(2, maintenant, { cs: 100 }), partie({ date: maintenant, cs: 200 })]);
  assert.deepStrictEqual([mesure(resume, "cs").moyenne, mesure(resume, "cs").tendance], [null, null]);
  assert.strictEqual(C.phraseDernierePartie(resume), null);
  // Anciennes parties sans détails : elles ne comptent que pour le KDA
  const anciennes = C.resumeDernierePartie([...habitudes(5, maintenant, {}), partie({ date: maintenant, cs: 200 })]);
  assert.deepStrictEqual([mesure(anciennes, "kda").tendance, mesure(anciennes, "cs").moyenne], ["pareil", null]);
});

test("remakes, parties abîmées, liste vide : ignorés sans planter", () => {
  const maintenant = Date.now();
  const remake = partie({ date: maintenant, minutes: 3 });
  const abimee = { ...partie({ date: maintenant + 1 }), kills: -1 };
  const vraie = partie({ date: maintenant - MIN });
  assert.strictEqual(C.resumeDernierePartie([remake, abimee, vraie, null]).partie, vraie);
  assert.strictEqual(C.resumeDernierePartie([]), null);
  assert.strictEqual(C.resumeDernierePartie(undefined), null);
  assert.strictEqual(C.phraseDernierePartie(null), null);
  // Durée illisible : pas de valeur par minute, le KDA reste
  assert.deepStrictEqual(C.resumeDernierePartie([{ ...vraie, dureeS: null, cs: 100 }]).mesures.map((m) => m.cle), ["kda"]);
});

test("phrases : partout mieux, partout moins, plus de mieux, plus de moins, égalité", () => {
  const avec = (...tendances) => ({ mesures: tendances.map((t) => ({ tendance: t })) });
  assert.strictEqual(C.phraseDernierePartie(avec("mieux", "mieux")), "Au-dessus de tes habitudes partout. Belle partie !");
  assert.match(C.phraseDernierePartie(avec("moins", "moins")), /En dessous de tes habitudes partout/);
  assert.strictEqual(C.phraseDernierePartie(avec("mieux", "mieux", "moins")), "Mieux que d'habitude sur 2 points (sur 3 points).");
  assert.strictEqual(C.phraseDernierePartie(avec("moins", "moins", "mieux")), "En dessous de tes habitudes sur 2 points (sur 3 points).");
  assert.strictEqual(C.phraseDernierePartie(avec("mieux", "moins", "pareil")), "Dans tes habitudes (sur 3 points).");
  assert.strictEqual(C.phraseDernierePartie(avec("mieux", null)), "Au-dessus de tes habitudes partout. Belle partie !");
});
