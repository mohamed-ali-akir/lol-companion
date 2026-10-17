/*
 * Onglet "Accueil"
 * ----------------
 * Un tableau de bord court : l'essentiel en un coup d'œil, et des cartes cliquables
 * (attribut data-vers) qui ouvrent l'onglet détaillé.
 * Ici : les cartes Niveau, Objectif et Rythme. Les autres cartes sont remplies par leur onglet
 * (session.js pour la carte principale "Ta session", stats.js, maitrise.js...).
 */

/** Remplit une carte de l'Accueil : grande valeur + détail. */
function remplirCarte(id, valeur, detail) {
  const carte = $(id);
  carte.querySelector(".carte-valeur").textContent = valeur;
  carte.querySelector(".carte-detail").textContent = detail;
}

/** Redessine l'Accueil (appelée par mettreAJour, voir commun.js). */
function renduAccueil({ compte, params, erreur, calculs }) {
  $("accueilSansCompte").hidden = Boolean(compte);
  $("accueilCartes").hidden = !compte;
  if (!compte) return;

  // Carte "Ton niveau"
  remplirCarte("carteNiveau", `Niveau ${compte.niveau}`, `${compte.progression} % vers le niveau ${compte.niveau + 1}`);
  $("carteNiveauBarre").style.width = `${compte.progression}%`;

  // Carte "Objectif" : le mode le plus rapide pour le niveau visé
  const objectif = calculs ? resumeObjectif(calculs) : null;
  if (erreur || !objectif) {
    remplirCarte("carteObjectif", "À régler", erreur || "Choisis un niveau visé dans l'onglet Niveau.");
  } else {
    remplirCarte(
      "carteObjectif",
      `≈ ${formatNombre(objectif.parties)} parties`,
      `${de(objectif.nom)} pour le niveau ${params.niveauCible}, soit ≈ ${formatNombre(objectif.jours)} jours ` +
        `à ${formatNombre(params.heuresParJour)} h par jour`
    );
  }

  // Carte "Rythme" : rythme réel sur les derniers jours
  const rythme = rythmeRecent(pointsProgression);
  if (!rythme) {
    remplirCarte("carteRythme", "—", "Reviens après quelques parties pour voir ton rythme réel.");
  } else {
    const xpRestante = params ? xpTotaleAuNiveau(params.niveauCible) - xpDuCompte(compte) : 0;
    const date = params ? dateEstimee(xpRestante, rythme.xpParJour) : null;
    remplirCarte(
      "carteRythme",
      `+${formatNombre(Math.round(rythme.xpParJour))} XP / jour`,
      date && !erreur
        ? `À ce rythme, niveau ${params.niveauCible} vers le ${date.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })}`
        : "Rythme réel sur tes derniers jours de jeu"
    );
  }
}

function brancherAccueil() {
  surRendu(renduAccueil);
}
