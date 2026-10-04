/*
 * Bilan de session : notifications Windows des alertes de pause
 * ------------------------------------------------------------
 * Les calculs (parties de la session, défaites d'affilée, alertes) sont dans src/calculs.js,
 * partagés avec la page. Ici, on décide seulement QUELLES alertes méritent une notification :
 *  - jamais deux fois la même alerte (même série de défaites, même tranche de temps de jeu) ;
 *  - au lancement de l'appli ou du client, les alertes déjà en cours sont notées comme "vues"
 *    sans notification : on ne prévient que pour ce qui arrive après une partie.
 * Les notifications ne sont envoyées que si l'option est cochée (désactivée par défaut).
 */
const { partiesDeSession, bilanSession, alertesSession } = require("./src/calculs.js");

/** Alertes du moment pour un compte : { bilan, alertes }. */
function alertesDuCompte({ parties, reglages, lancement, niveau, maintenant = Date.now() }) {
  const bilan = bilanSession(partiesDeSession(parties, { mode: reglages.mode, lancement, maintenant }), { niveau });
  return { bilan, alertes: alertesSession(bilan, reglages, maintenant) };
}

/** Mémoire des alertes déjà vues (le temps que l'appli est ouverte). */
function creerSuiviAlertes() {
  const vues = new Set();
  return {
    /**
     * Alertes à notifier parmi "alertes" (et les note comme vues).
     * silencieux = true : on les note seulement (lancement), sans rien notifier.
     */
    aNotifier(alertes, { silencieux = false } = {}) {
      const nouvelles = (Array.isArray(alertes) ? alertes : []).filter((a) => a && a.cle && !vues.has(a.cle));
      for (const a of nouvelles) vues.add(a.cle);
      return silencieux ? [] : nouvelles;
    },
  };
}

module.exports = { alertesDuCompte, creerSuiviAlertes };
