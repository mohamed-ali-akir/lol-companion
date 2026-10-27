/*
 * Mode Deadlock, onglet Build (27/10/2026)
 * ----------------------------------------
 * Pour un héros : les objets les plus achetés, rangés par moment de la partie, et les héros qui le contrent.
 * Données de deadlock-api.com, calculées par main.js (deadlock-stats.js : buildDuHeros, contresDuHeros).
 * Lecture seule : l'appli ne met rien dans le jeu (Deadlock a son propre navigateur de builds).
 */

let listeHerosDeadlockLue = false;

/** Remplit le choix du héros (une fois) ; ton héros le plus joué est choisi d'office. */
async function remplirHerosDeadlock() {
  if (listeHerosDeadlockLue) return true;
  const r = await window.appli.listeHerosDeadlock();
  if (!r.ok) {
    afficherEtat("etatDeadlockBuild", r.erreur, "erreur");
    return false;
  }
  const options = r.heros.map((h) => {
    const option = element("option", null, h.nom);
    option.value = String(h.id);
    return option;
  });
  $("deadlockHeros").replaceChildren(...options);
  if (herosLePlusJoue && r.heros.some((h) => h.id === herosLePlusJoue)) $("deadlockHeros").value = String(herosLePlusJoue);
  listeHerosDeadlockLue = true;
  return true;
}

/**
 * Carte d'un objet : nom (couleur de son emplacement), ★ pour le plus sûr de sa période, puis 3 chiffres : quand,
 * dans combien de parties, et son prix. Le taux de victoire n'est plus affiché (presque toujours autour de 50 %, il
 * n'aidait pas à choisir) : il sert à l'étoile, au survol (title) pour les curieux.
 */
function carteObjetDeadlock(o) {
  const carte = element("div", `dl-objet${o.emplacement ? ` objet-${o.emplacement}` : ""}`);
  carte.title = `${formatPourcent(o.tauxVictoire)} de victoires chez ceux qui l'achètent`;
  const tete = element("div", "dl-objet-tete");
  tete.append(element("strong", null, o.nom));
  if (o.conseille) tete.append(puce("★ le plus sûr", "puce-or"));
  const puces = element("div", "puces");
  if (Number.isFinite(o.minute)) puces.append(puce(`${Math.round(o.minute)} min`));
  if (Number.isFinite(o.achat)) puces.append(puce(`${Math.round(o.achat * 100)} % des parties`));
  if (Number.isFinite(o.prix)) puces.append(puce(`${formatNombre(o.prix)} âmes`));
  carte.append(tete, puces);
  return carte;
}

/** Un groupe d'objets d'une période (« Presque toujours » ou « Selon la partie »), ou rien s'il est vide. */
function groupeObjets(titre, objets) {
  if (objets.length === 0) return [];
  const grille = element("div", "dl-objets");
  grille.append(...objets.map(carteObjetDeadlock));
  return [element("p", "dl-groupe", titre), grille];
}

/** Une période de la partie : titre, puis les objets à prendre presque toujours, puis ceux de situation. */
function periodeDeadlock(phase) {
  const bloc = element("section", "dl-phase");
  const titre = element("h3");
  titre.append(document.createTextNode(`${phase.titre} `), puce(phase.quand));
  bloc.append(titre);
  if (phase.objets.length === 0) {
    bloc.append(element("p", "texte-vide", "Aucun objet assez acheté à ce moment-là."));
    return bloc;
  }
  bloc.append(
    ...groupeObjets("Presque toujours", phase.objets.filter((o) => o.essentiel)),
    ...groupeObjets("Selon la partie", phase.objets.filter((o) => !o.essentiel)),
  );
  return bloc;
}

/** Colonne des contres : chaque héros avec le taux de victoire du héros choisi contre lui. */
function colonneContres(titre, contres, classe) {
  const colonne = element("div", "dl-contres-colonne");
  colonne.append(element("h3", null, titre));
  if (contres.length === 0) {
    colonne.append(element("p", "texte-vide", "Pas assez de duels joués."));
    return colonne;
  }
  for (const c of contres) {
    const ligne = element("div", "dl-contre");
    ligne.append(element("strong", null, c.nom), puce(`${formatPourcent(c.tauxVictoire)} de victoires`, classe));
    colonne.append(ligne);
  }
  return colonne;
}

/** Dessine le build reçu de main.js. */
function dessinerBuildDeadlock(r) {
  const conteneur = $("deadlockBuildResultat");
  const contres = element("div", "dl-contres");
  contres.append(colonneContres("Plus dur contre", r.contres.difficiles, "puce-mauvais"), colonneContres("Plus facile contre", r.contres.faciles, "puce-bon"));
  conteneur.replaceChildren(element("h2", null, `Build ${r.heros.nom}`), ...r.build.phases.map(periodeDeadlock), contres);
}

async function consulterBuildDeadlock() {
  const heroId = Number($("deadlockHeros").value);
  if (!heroId) return;
  const bouton = $("formDeadlockBuild").querySelector("button");
  bouton.disabled = true;
  afficherEtat("etatDeadlockBuild", "Chargement…", "info");
  try {
    const r = await window.appli.consulterBuildDeadlock(heroId);
    if (!r.ok) {
      afficherEtat("etatDeadlockBuild", r.erreur, "erreur");
      return;
    }
    dessinerBuildDeadlock(r);
    buildDeadlockAffiche = heroId;
    afficherEtat("etatDeadlockBuild", "");
  } finally {
    bouton.disabled = false;
  }
}

function brancherDeadlockBuild() {
  document.addEventListener("onglet", async (evenement) => {
    if (evenement.detail !== "deadlockbuild") return;
    if (!(await remplirHerosDeadlock())) return;
    if (buildDeadlockAffiche === null) consulterBuildDeadlock(); // premier passage : le build de ton héros tout de suite
  });
  $("formDeadlockBuild").addEventListener("submit", (evenement) => {
    evenement.preventDefault();
    consulterBuildDeadlock();
  });
}
