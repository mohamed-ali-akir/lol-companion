// Tests de la logique de calcul. Lancer avec : npm test
const test = require("node:test");
const assert = require("node:assert");
const {
  calculer,
  calculerModes,
  niveauParDefaut,
  texteHistorique,
  resumeObjectif,
  de,
  modeLePlusRapide,
  joindreListe,
  texteDonneesDu,
  MODES,
  parametresCalcul,
  verifier,
  xpGagnee,
  ATTENTE_PAR_PARTIE_MIN,
  xpMoyenneParPartie,
  xpPourNiveauSuivant,
  xpTotaleAuNiveau,
  multiplicateurBots,
} = require("../src/calculs.js");

const base = {
  niveauActuel: 24,
  progression: 50,
  niveauCible: 30,
  dureeMin: 18,
  attenteMin: 5,
  heuresParJour: 3,
  tauxVictoire: 0.5,
  bots: false,
  boostDuree: false,
  boostVictoire: false,
};

test("XP totale jusqu'au niveau 30 = 39 936", () => {
  assert.strictEqual(xpTotaleAuNiveau(1), 0);
  assert.strictEqual(xpTotaleAuNiveau(2), 144);
  assert.strictEqual(xpTotaleAuNiveau(30), 39936);
});

test("formule du wiki : victoire de 30 minutes = environ 205 XP", () => {
  const xp = xpMoyenneParPartie({ dureeMin: 30, tauxVictoire: 1, niveau: 24, bots: false });
  assert.strictEqual(Math.round(xp), 205);
});

test("une partie de moins de 7 minutes ne rapporte rien", () => {
  assert.strictEqual(xpMoyenneParPartie({ dureeMin: 6, tauxVictoire: 1, niveau: 5 }), 0);
});

test("pénalités des bots selon le niveau", () => {
  assert.strictEqual(multiplicateurBots(9), 1);
  assert.strictEqual(multiplicateurBots(10), 0.9);
  assert.strictEqual(multiplicateurBots(20), 0.8);
  assert.strictEqual(multiplicateurBots(30), 0.75);
});

test("niveau 24,5 -> 30 en ARAM du Chaos : environ 125 parties", () => {
  const r = calculer(base);
  assert.ok(r.parties >= 115 && r.parties <= 135, `obtenu ${r.parties}`);
});

test("les boosts réduisent fortement le nombre de parties", () => {
  const sans = calculer(base).parties;
  const avec = calculer({ ...base, boostDuree: true, boostVictoire: true }).parties;
  assert.ok(avec < sans / 2.5, `sans : ${sans}, avec : ${avec}`);
});

test("gagner plus fait monter plus vite", () => {
  const perdant = calculer({ ...base, tauxVictoire: 0.3 }).parties;
  const gagnant = calculer({ ...base, tauxVictoire: 0.7 }).parties;
  assert.ok(gagnant < perdant);
});

test("après le niveau 50, l'XP suit un cycle de 25 niveaux", () => {
  assert.strictEqual(xpPourNiveauSuivant(49), 3456);
  assert.strictEqual(xpPourNiveauSuivant(50), 2592);
  assert.strictEqual(xpPourNiveauSuivant(74), 3648);
  assert.strictEqual(xpPourNiveauSuivant(75), 2592);
  assert.strictEqual(xpPourNiveauSuivant(300), xpPourNiveauSuivant(50));
});

test("un compte au-dessus du niveau 50 peut être calculé", () => {
  const r = calculer({ ...base, niveauActuel: 137, niveauCible: 150 });
  assert.ok(r && r.parties > 0, "le calcul doit aboutir");
});

test("les deux modes sont calculés d'office, avec tes stats si assez de parties", () => {
  const communs = { niveauActuel: 24, progression: 50, niveauCible: 30, attenteMin: 5, heuresParJour: 3 };

  const sansStats = calculerModes(communs);
  assert.strictEqual(sansStats.mayhem.perso, false);
  assert.strictEqual(sansStats.mayhem.dureeMin, 18);
  assert.strictEqual(sansStats.draft.dureeMin, 30);
  // Mêmes réglages que le test "environ 125 parties" plus haut
  assert.strictEqual(sansStats.mayhem.resultat.parties, calculer(base).parties);

  const avecStats = calculerModes(communs, {
    mayhem: { parties: 10, dureeMoyenneMin: 20, tauxVictoire: 0.7 },
    draft: { parties: 2, dureeMoyenneMin: 40, tauxVictoire: 1 }, // trop peu de parties : ignoré
  });
  assert.strictEqual(avecStats.mayhem.perso, true);
  assert.strictEqual(avecStats.mayhem.tauxVictoire, 0.7);
  assert.strictEqual(avecStats.draft.perso, false);
  assert.strictEqual(avecStats.draft.dureeMin, 30);
});

test("niveau visé proposé après une recherche", () => {
  assert.strictEqual(niveauParDefaut(12), 30);
  assert.strictEqual(niveauParDefaut(30), 50);
  assert.strictEqual(niveauParDefaut(137), 150);
  assert.strictEqual(niveauParDefaut(150), 175);
});

test("phrase de résumé de l'historique du client", () => {
  assert.strictEqual(texteHistorique(null), "");
  assert.strictEqual(texteHistorique({ total: 0, mayhem: null, draft: null }), "");
  const texte = texteHistorique({ total: 20, mayhem: { parties: 7 }, draft: null });
  assert.ok(texte.includes("20 dernières parties"));
  assert.ok(texte.includes("7 en ARAM du Chaos"));
  assert.ok(!texte.includes("Draft")); // les modes sans partie ne sont plus listés
});

test("le niveau vient du compte, l'attente de la constante (5 min)", () => {
  assert.strictEqual(ATTENTE_PAR_PARTIE_MIN, 5);
  const p = parametresCalcul(
    { niveau: 24, progression: 63 },
    { niveauCible: 30, heuresParJour: 3, boostDuree: false, boostVictoire: true }
  );
  assert.deepStrictEqual(p, {
    niveauActuel: 24,
    progression: 63,
    attenteMin: 5,
    niveauCible: 30,
    heuresParJour: 3,
    boostDuree: false,
    boostVictoire: true,
  });
});

test("l'attente compte dans les heures, pas dans l'XP", () => {
  const sansAttente = calculer({ ...base, attenteMin: 0 });
  const avecAttente = calculer({ ...base, attenteMin: ATTENTE_PAR_PARTIE_MIN });
  assert.strictEqual(avecAttente.parties, sansAttente.parties);
  assert.ok(avecAttente.heures > sansAttente.heures);
});

test("vérification de l'objectif", () => {
  const compte = { niveau: 24, progression: 50 };
  const ok = parametresCalcul(compte, { niveauCible: 30, heuresParJour: 3 });
  assert.strictEqual(verifier(ok), null);
  assert.match(verifier({ ...ok, niveauCible: 24 }), /plus haut/);
  assert.match(verifier({ ...ok, niveauCible: NaN }), /Remplis/);
  assert.match(verifier({ ...ok, heuresParJour: 0 }), /temps de jeu/);
  assert.match(verifier({ ...ok, niveauCible: 6000 }), /5000/);
});

test("XP gagnée entre deux lectures du compte (message après une partie)", () => {
  // Niveau 24 : 2304 XP pour passer au 25. 50 % -> 75 % = 576 XP.
  assert.strictEqual(xpGagnee({ niveau: 24, progression: 50 }, { niveau: 24, progression: 75 }), 576);
  // Passage de niveau : 24 à 90 % -> 25 à 10 %.
  const gain = xpGagnee({ niveau: 24, progression: 90 }, { niveau: 25, progression: 10 });
  assert.strictEqual(gain, Math.round(2304 * 0.1 + 2496 * 0.1));
  // Pas de compte avant (premier lancement) ou rien de gagné.
  assert.strictEqual(xpGagnee(null, { niveau: 24, progression: 50 }), 0);
  assert.strictEqual(xpGagnee({ niveau: 24, progression: 50 }, { niveau: 24, progression: 50 }), 0);
});

test("4 modes calculés : ARAM du Chaos, ARAM, Swiftplay et Draft", () => {
  assert.deepStrictEqual(Object.keys(MODES), ["mayhem", "aram", "swiftplay", "draft"]);
  const calculs = calculerModes(base, {});
  assert.deepStrictEqual(Object.keys(calculs), ["mayhem", "aram", "swiftplay", "draft"]);
  assert.strictEqual(calculs.aram.dureeMin, 20);
  assert.strictEqual(calculs.swiftplay.dureeMin, 20);
  // Stats perso utilisées dès 3 parties dans le mode.
  const perso = calculerModes(base, { swiftplay: { parties: 5, dureeMoyenneMin: 16, tauxVictoire: 0.6 } });
  assert.strictEqual(perso.swiftplay.perso, true);
  assert.strictEqual(perso.swiftplay.dureeMin, 16);
});

test("mode le plus rapide parmi les 4", () => {
  const faux = (heures) => ({ resultat: { heures } });
  assert.deepStrictEqual(
    modeLePlusRapide({ mayhem: faux(40), aram: faux(45), swiftplay: faux(38), draft: faux(50) }),
    { mode: "swiftplay", ecartHeures: 12 }
  );
  // Un mode incalculable (parties trop courtes) est ignoré.
  assert.strictEqual(modeLePlusRapide({ mayhem: { resultat: null }, draft: faux(10) }).mode, "draft");
  assert.strictEqual(modeLePlusRapide({ mayhem: { resultat: null } }), null);
});

test("liste en français", () => {
  assert.strictEqual(joindreListe([]), "");
  assert.strictEqual(joindreListe(["a"]), "a");
  assert.strictEqual(joindreListe(["a", "b"]), "a et b");
  assert.strictEqual(joindreListe(["a", "b", "c"]), "a, b et c");
});

test("résumé de l'historique : chaque partie du total est expliquée", () => {
  const stats = { total: 5, autresModes: 1, ignorees: 0, mayhem: { parties: 3 }, aram: null, swiftplay: null, draft: { parties: 1 } };
  assert.strictEqual(
    texteHistorique(stats),
    "Dans tes 5 dernières parties : 3 en ARAM du Chaos et 1 en Draft. " +
      "1 partie dans un autre mode (classée, Arena, partie perso…), non comptée. " +
      "Les parties comptées donnent ta durée moyenne et ton taux de victoire par mode."
  );
  const avecRemakes = texteHistorique({ ...stats, total: 8, autresModes: 2, ignorees: 2 });
  assert.match(avecRemakes, /2 parties dans d'autres modes .*, non comptées\. 2 remakes ignorés \(partie de moins de 5 min\)\./);
  // Ancienne version (sans autresModes/ignorees) : on explique quand même l'écart.
  assert.match(texteHistorique({ total: 5, mayhem: { parties: 3 }, draft: { parties: 1 } }), /1 autre partie non comptée \(autre mode ou remake\)\./);
  // Aucune partie dans un mode suivi.
  assert.match(texteHistorique({ total: 2, autresModes: 2, ignorees: 0 }), /aucune dans un mode suivi/);
});

test("mention « Données du » pour un compte gardé en mémoire", () => {
  const date = new Date(2026, 8, 30, 18, 5); // 30/09/2026 18:05, heure locale
  assert.strictEqual(texteDonneesDu(date.toISOString()), "Données du 30/09 à 18:05 — lance League pour les mettre à jour.");
});

// --- Suivi de progression -------------------------------------------------------------

const S = require("../src/calculs.js");
const pt = (date, xpTotale) => ({ date, xpTotale, niveau: S.niveauDepuisXp(xpTotale), progression: 0, riotId: "A#1" });

test("niveau depuis l'XP totale (inverse de xpTotaleAuNiveau)", () => {
  assert.strictEqual(S.niveauDepuisXp(0), 1);
  assert.strictEqual(S.niveauDepuisXp(143), 1);
  assert.strictEqual(S.niveauDepuisXp(144), 2);
  assert.strictEqual(S.niveauDepuisXp(39935), 29);
  assert.strictEqual(S.niveauDepuisXp(39936), 30);
  for (const n of [7, 24, 50, 51, 120]) assert.strictEqual(S.niveauDepuisXp(xpTotaleAuNiveau(n)), n);
});

test("XP totale d'un compte (niveau + progression)", () => {
  assert.strictEqual(S.xpDuCompte({ niveau: 30, progression: 0 }), 39936);
  assert.strictEqual(S.xpDuCompte({ niveau: 24, progression: 50 }), xpTotaleAuNiveau(24) + 1152);
});

test("rythme réel : aucun point, un point, un seul jour -> pas de rythme", () => {
  const maintenant = new Date("2026-09-30T20:00:00");
  assert.strictEqual(S.rythmeRecent([], maintenant), null);
  assert.strictEqual(S.rythmeRecent([pt("2026-09-30T10:00:00", 1000)], maintenant), null);
  assert.strictEqual(S.rythmeRecent([pt("2026-09-30T10:00:00", 1000), pt("2026-09-30T18:00:00", 1500)], maintenant), null);
});

test("rythme réel : XP par jour sur les 7 derniers jours", () => {
  const maintenant = new Date("2026-09-30T20:00:00");
  const points = [
    pt("2026-09-10T12:00:00", 0), // trop vieux, sauf le dernier d'avant la fenêtre
    pt("2026-09-20T12:00:00", 10000), // dernier point d'avant la fenêtre = départ
    pt("2026-09-25T12:00:00", 12000),
    pt("2026-09-30T12:00:00", 17000),
  ];
  const r = S.rythmeRecent(points, maintenant);
  assert.strictEqual(r.xpParJour, 700); // 7000 XP en 10 jours
  assert.strictEqual(r.jours, 10);

  // Tout récent (2 jours) : on part du premier point.
  const court = S.rythmeRecent([pt("2026-09-29T12:00:00", 1000), pt("2026-09-30T12:00:00", 1600)], maintenant);
  assert.strictEqual(court.xpParJour, 600);
});

test("date estimée", () => {
  const maintenant = new Date("2026-09-30T12:00:00Z");
  assert.strictEqual(S.dateEstimee(1000, 500, maintenant).toISOString(), "2026-10-02T12:00:00.000Z");
  assert.strictEqual(S.dateEstimee(1000, 0, maintenant), null);
  assert.strictEqual(S.dateEstimee(-5, 500, maintenant).toISOString(), maintenant.toISOString());
});

test("phrase de rythme", () => {
  const maintenant = new Date("2026-09-30T20:00:00");
  assert.strictEqual(S.texteRythme([], 5000, maintenant), "Reviens après quelques parties pour voir ta courbe.");
  const texte = S.texteRythme([pt("2026-09-29T12:00:00", 1000), pt("2026-09-30T12:00:00", 1600)], 6000, maintenant);
  assert.match(texte, /^Rythme réel : \+600 XP par jour en moyenne sur les 2 derniers jours\./);
  assert.match(texte, /niveau visé atteint vers le 10\/10\./);
  const arret = S.texteRythme([pt("2026-09-29T12:00:00", 1000), pt("2026-09-30T12:00:00", 1000)], 6000, maintenant);
  assert.match(arret, /Joue quelques parties/);
});

test("projection prévue : de maintenant jusqu'au niveau visé", () => {
  const maintenant = new Date("2026-09-30T12:00:00Z");
  const p = S.projectionPrevue({ xpActuelle: 25000, xpCible: 39936, heures: 45, heuresParJour: 3, maintenant });
  assert.deepStrictEqual(p, [
    { date: "2026-09-30T12:00:00.000Z", xpTotale: 25000 },
    { date: "2026-10-15T12:00:00.000Z", xpTotale: 39936 },
  ]);
});

test("géométrie du graphique", () => {
  const points = [pt("2026-09-28T12:00:00Z", xpTotaleAuNiveau(24)), pt("2026-09-30T12:00:00Z", xpTotaleAuNiveau(25))];
  const projection = S.projectionPrevue({
    xpActuelle: xpTotaleAuNiveau(25), xpCible: xpTotaleAuNiveau(30), heures: 30, heuresParJour: 3,
    maintenant: new Date("2026-09-30T12:00:00Z"),
  });
  const g = S.geometrieGraphique(points, projection, { largeur: 600, hauteur: 200, marge: { haut: 0, droite: 0, bas: 0, gauche: 0 } });

  // Premier point en bas à gauche (niveau 24 = bas de l'axe), fin de la projection en haut à droite (niveau 30).
  assert.deepStrictEqual(g.pointsReels[0], { x: 0, y: 200, point: points[0] });
  assert.ok(g.prevu.endsWith("L600 0"));
  assert.ok(g.reel.startsWith("M0 200 L"));
  // Graduations : niveaux entiers de 24 à 30 (au plus 6 affichés), et 4 dates.
  assert.ok(g.graduationsNiveaux.length <= 6);
  assert.strictEqual(g.graduationsNiveaux[0].niveau, 24);
  assert.strictEqual(g.graduationsDates.length, 4);
  assert.strictEqual(S.geometrieGraphique([], []), null);
});

test("géométrie : un seul point sans projection -> pas de division par zéro", () => {
  const g = S.geometrieGraphique([pt("2026-09-30T12:00:00Z", 25000)], []);
  assert.ok(Number.isFinite(g.pointsReels[0].x) && Number.isFinite(g.pointsReels[0].y));
});

test("résumé de l'objectif pour l'Accueil : le mode le plus rapide", () => {
  const calculs = calculerModes(base, {});
  const r = resumeObjectif(calculs);
  const plusRapide = Object.values(calculs).reduce((a, b) => (b.resultat.heures < a.resultat.heures ? b : a));
  assert.strictEqual(r.heures, plusRapide.resultat.heures);
  assert.strictEqual(r.nom, MODES[r.mode].nom);
  assert.ok(r.parties > 0 && r.jours > 0);
  assert.strictEqual(resumeObjectif({ mayhem: { resultat: null } }), null);
});

test("« d'ARAM » mais « de Draft »", () => {
  assert.strictEqual(de("ARAM du Chaos"), "d'ARAM du Chaos");
  assert.strictEqual(de("ARAM"), "d'ARAM");
  assert.strictEqual(de("Draft"), "de Draft");
  assert.strictEqual(de("Swiftplay"), "de Swiftplay");
});
