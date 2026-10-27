/*
 * Petits calculs de statistiques partagés (LoL et Deadlock)
 * ----------------------------------------------------------
 * Fonctions pures, testées (test/build.test.js, test/deadlock-stats.test.js).
 * Sorti de build.js le 27/10/2026 : le mode Deadlock classe aussi ses objets et ses héros avec le même score, et une
 * seule formule évite que les deux jeux finissent par calculer différemment.
 */

const Z_95 = 1.96; // 95 % de confiance

/**
 * Taux de victoire prudent : borne basse de l'intervalle de Wilson à 95 %. 0 sans parties.
 * Pourquoi : 62 % sur 24 parties n'est pas plus sûr que 59 % sur 9 000. Le score prudent tient compte du nombre de
 * parties : moins il y en a, plus il est tiré vers le bas.
 */
function scorePrudent(victoires, parties) {
  if (!(parties > 0)) return 0;
  const p = Math.min(1, Math.max(0, victoires / parties));
  const z2 = Z_95 * Z_95;
  const centre = p + z2 / (2 * parties);
  const marge = Z_95 * Math.sqrt((p * (1 - p)) / parties + z2 / (4 * parties * parties));
  return (centre - marge) / (1 + z2 / parties);
}

module.exports = { Z_95, scorePrudent };
