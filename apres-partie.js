/*
 * Relecture après une partie, jusqu'à ce que la partie soit dans l'historique du client (21/10/2026)
 * ---------------------------------------------------------------------------------------------------------
 * Problème vu le 21/10/2026 : après un top 3 en Arena, l'onglet Challenge ne bougeait pas, même 5 minutes après.
 * L'appli ne relisait l'historique qu'UNE fois, 4 s après l'écran de fin. Si le client n'y avait pas encore ajouté
 * la partie (il peut mettre plusieurs dizaines de secondes, et en Arena la partie n'est enregistrée qu'une fois
 * TOUTES les équipes éliminées), elle n'arrivait qu'à la fin de la partie suivante.
 *
 * Maintenant : relecture après 4 s, puis 10 s, 20 s, puis toutes les 30 s, et on s'arrête dès que la nouvelle partie
 * est enregistrée (ou après 10 minutes : partie trop courte, remake... qui ne sera jamais ajoutée).
 * Démarrée par les DEUX canaux (connexion en direct et sondage de secours) : un seul cycle à la fois.
 */

// Délais entre deux relectures (le premier compte depuis l'écran de fin) : 10 minutes en tout.
const DELAIS_MS = [4000, 6000, 10000, ...Array(19).fill(30000)];

/**
 * relire(essai) : relit le compte et l'historique (essai = 0 pour la première relecture du cycle, puis 1, 2...) ;
 *   renvoie (ou promet) le nombre de parties NOUVELLES enregistrées.
 * aErreur(nom, erreur) : une relecture qui plante n'arrête pas le cycle (le client peut être en train de charger).
 * Renvoie { demarrer(), arreter(), enCours() }.
 */
function creerRelectureApresPartie({ relire, aErreur = () => {}, delaisMs = DELAIS_MS }) {
  let minuterie = null;
  let cycle = 0; // change à chaque démarrage / arrêt : une relecture d'un ancien cycle ne relance rien

  function arreter() {
    clearTimeout(minuterie);
    minuterie = null;
    cycle++;
  }

  /** Démarre un cycle. Déjà en cours (l'autre canal a vu la même fin de partie) : on ne fait rien. */
  function demarrer() {
    if (minuterie !== null) return false;
    const moi = ++cycle;
    const etape = (i) => {
      minuterie = setTimeout(async () => {
        let nouvelles = 0;
        try {
          nouvelles = Number(await relire(i)) || 0;
        } catch (erreur) {
          aErreur("relecture après la partie", erreur);
        }
        if (moi !== cycle) return; // arrêté pendant la relecture
        if (nouvelles > 0 || i + 1 >= delaisMs.length) {
          minuterie = null; // partie trouvée (ou on abandonne) : fin du cycle
          return;
        }
        etape(i + 1);
      }, delaisMs[i]);
    };
    etape(0);
    return true;
  }

  return { demarrer, arreter, enCours: () => minuterie !== null };
}

module.exports = { creerRelectureApresPartie, DELAIS_MS };
