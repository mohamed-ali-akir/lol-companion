/*
 * Barre d'onglets
 * ---------------
 * Un seul onglet visible à la fois. Accessible au clavier, comme les onglets d'un navigateur :
 *  - Tab arrive sur l'onglet actif (les autres ne sont pas dans l'ordre de tabulation) ;
 *  - flèches gauche/droite : onglet précédent/suivant (on boucle aux extrémités) ;
 *  - Début/Fin : premier/dernier onglet.
 * L'onglet actif est mémorisé (dans config.json, via main.js) et rouvert au prochain lancement.
 */

const ONGLET_PAR_DEFAUT = "accueil";

const boutonsOnglets = () => [...document.querySelectorAll('[role="tab"][data-onglet]')];

/** Affiche un onglet. memoriser = false au démarrage (on ne réécrit pas le réglage qu'on vient de lire). */
function activerOnglet(nom, { memoriser = true, focus = false } = {}) {
  const boutons = boutonsOnglets();
  const cible = boutons.find((b) => b.dataset.onglet === nom) || boutons.find((b) => b.dataset.onglet === ONGLET_PAR_DEFAUT);

  for (const bouton of boutons) {
    const actif = bouton === cible;
    bouton.setAttribute("aria-selected", String(actif));
    bouton.tabIndex = actif ? 0 : -1;
    $(bouton.getAttribute("aria-controls")).hidden = !actif;
  }
  if (focus) cible.focus();
  if (memoriser && window.appli) window.appli.enregistrerOnglet(cible.dataset.onglet);
}

function brancherOnglets() {
  const boutons = boutonsOnglets();
  for (const bouton of boutons) {
    bouton.addEventListener("click", () => activerOnglet(bouton.dataset.onglet));
    bouton.addEventListener("keydown", (evenement) => {
      const i = boutons.indexOf(bouton);
      const cibles = {
        ArrowRight: boutons[(i + 1) % boutons.length],
        ArrowLeft: boutons[(i - 1 + boutons.length) % boutons.length],
        Home: boutons[0],
        End: boutons[boutons.length - 1],
      };
      const cible = cibles[evenement.key];
      if (!cible) return;
      evenement.preventDefault();
      activerOnglet(cible.dataset.onglet, { focus: true });
    });
  }

  // Tout élément avec data-vers="nom" (cartes de l'Accueil, liens) ouvre l'onglet correspondant.
  document.addEventListener("click", (evenement) => {
    const lien = evenement.target.closest("[data-vers]");
    if (lien) activerOnglet(lien.dataset.vers);
  });
}
