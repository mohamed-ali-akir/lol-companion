/*
 * Barre d'onglets, et choix du jeu (League of Legends ou Deadlock)
 * ----------------------------------------------------------------
 * Un seul onglet visible à la fois. Accessible au clavier, comme les onglets d'un navigateur :
 *  - Tab arrive sur l'onglet actif (les autres ne sont pas dans l'ordre de tabulation) ;
 *  - flèches gauche/droite : onglet précédent/suivant (on boucle aux extrémités) ;
 *  - Début/Fin : premier/dernier onglet.
 * L'onglet actif est mémorisé (dans config.json, via main.js) et rouvert au prochain lancement.
 *
 * Deux jeux (27/10/2026) : chaque onglet appartient à un jeu (classe « jeu-lol » ou « jeu-deadlock » ; sans classe,
 * comme Paramètres : aux deux). Le corps de la page porte la classe « mode-deadlock » en mode Deadlock, et le CSS cache
 * tout ce qui est de l'autre jeu (style.css). Le jeu change :
 *  - avec les boutons « League of Legends / Deadlock » en haut ;
 *  - tout seul quand Deadlock est lancé (onglets/deadlock-accueil.js), ou quand League se connecte et que Deadlock
 *    n'est pas lancé (app.js) ;
 *  - en ouvrant un onglet de l'autre jeu (onglet mémorisé au lancement, lien data-vers).
 * Chaque onglet affiché prévient les autres fichiers par l'événement « onglet » (detail = son nom) : les onglets
 * Deadlock ne lisent leurs données qu'à ce moment-là (rien n'est demandé à Internet tant qu'on ne les ouvre pas).
 */

const ONGLET_PAR_DEFAUT = "accueil";
const ONGLETS_PAR_DEFAUT = { lol: "accueil", deadlock: "deadlock" };
const dernierOnglet = { lol: null, deadlock: null }; // dernier onglet ouvert dans chaque jeu

const tousLesOnglets = () => [...document.querySelectorAll('[role="tab"][data-onglet]')];
/** Jeu d'un bouton d'onglet : "lol", "deadlock", ou null s'il est aux deux (Paramètres). */
const jeuDuBouton = (bouton) => (bouton.classList.contains("jeu-deadlock") ? "deadlock" : bouton.classList.contains("jeu-lol") ? "lol" : null);
/** Jeu affiché : "lol" ou "deadlock". */
const jeuAffiche = () => (document.body.classList.contains("mode-deadlock") ? "deadlock" : "lol");
/** Onglets du jeu affiché (ceux que les flèches parcourent). */
const boutonsOnglets = () => tousLesOnglets().filter((b) => jeuDuBouton(b) === null || jeuDuBouton(b) === jeuAffiche());

/** Passe la page en mode jeu ("lol" ou "deadlock") sans changer d'onglet. */
function appliquerJeu(jeu) {
  const deadlock = jeu === "deadlock";
  document.body.classList.toggle("mode-deadlock", deadlock);
  document.title = deadlock ? "Deadlock Companion" : "LoL Companion"; // nom de la fenêtre aussi (Electron suit le titre)
  for (const bouton of document.querySelectorAll("[data-jeu-choix]")) bouton.setAttribute("aria-pressed", String(bouton.dataset.jeuChoix === jeu));
}

/** Affiche un onglet. memoriser = false au démarrage (on ne réécrit pas le réglage qu'on vient de lire). */
function activerOnglet(nom, { memoriser = true, focus = false } = {}) {
  const boutons = tousLesOnglets();
  const cible = boutons.find((b) => b.dataset.onglet === nom) || boutons.find((b) => b.dataset.onglet === ONGLET_PAR_DEFAUT);
  const jeu = jeuDuBouton(cible);
  if (jeu && jeu !== jeuAffiche()) appliquerJeu(jeu);
  dernierOnglet[jeu || jeuAffiche()] = cible.dataset.onglet;

  for (const bouton of boutons) {
    const actif = bouton === cible;
    bouton.setAttribute("aria-selected", String(actif));
    bouton.tabIndex = actif ? 0 : -1;
    $(bouton.getAttribute("aria-controls")).hidden = !actif;
  }
  if (focus) cible.focus();
  if (memoriser && window.appli) window.appli.enregistrerOnglet(cible.dataset.onglet);
  document.dispatchEvent(new CustomEvent("onglet", { detail: cible.dataset.onglet }));
}

/** Change de jeu : rouvre le dernier onglet de ce jeu (ou son Accueil). Rien si on y est déjà. */
function changerDeJeu(jeu, { memoriser = true } = {}) {
  if (jeu !== "lol" && jeu !== "deadlock") return;
  if (jeu === jeuAffiche() && dernierOnglet[jeu]) return;
  appliquerJeu(jeu);
  activerOnglet(dernierOnglet[jeu] || ONGLETS_PAR_DEFAUT[jeu], { memoriser });
}

function brancherOnglets() {
  for (const bouton of tousLesOnglets()) {
    bouton.addEventListener("click", () => activerOnglet(bouton.dataset.onglet));
    bouton.addEventListener("keydown", (evenement) => {
      const boutons = boutonsOnglets();
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

  for (const bouton of document.querySelectorAll("[data-jeu-choix]")) {
    bouton.addEventListener("click", () => changerDeJeu(bouton.dataset.jeuChoix));
  }

  // Tout élément avec data-vers="nom" (cartes de l'Accueil, liens) ouvre l'onglet correspondant.
  document.addEventListener("click", (evenement) => {
    const lien = evenement.target.closest("[data-vers]");
    if (lien) activerOnglet(lien.dataset.vers);
  });
}
