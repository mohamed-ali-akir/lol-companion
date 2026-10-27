/*
 * Mode Deadlock, onglet Build (27/10/2026)
 * ----------------------------------------
 * Pour un héros : les objets les plus achetés, rangés par moment de la partie, et les héros qui le contrent.
 * Données de deadlock-api.com, calculées par main.js (deadlock-stats.js : buildDuHeros, contresDuHeros).
 * Lecture seule : l'appli ne met rien dans le jeu (Deadlock a son propre navigateur de builds).
 */

const NOMS_EMPLACEMENTS = { arme: "Arme", vitalite: "Vitalité", esprit: "Esprit" };
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

/** Un objet : nom, emplacement (couleur du jeu), minute d'achat, part des achats, taux de victoire, ★. */
function ligneObjetDeadlock(o) {
  const ligne = element("li", o.emplacement ? `objet-${o.emplacement}` : null);
  ligne.append(element("strong", null, `${o.conseille ? "★ " : ""}${o.nom}`));
  const details = [
    NOMS_EMPLACEMENTS[o.emplacement],
    Number.isFinite(o.prix) ? `${formatNombre(o.prix)} âmes` : null,
    Number.isFinite(o.minute) ? `vers ${Math.round(o.minute)} min` : null,
    Number.isFinite(o.achat) ? `acheté dans ${formatPourcent(o.achat)} des parties` : null,
    `${formatPourcent(o.tauxVictoire)} V`,
  ].filter(Boolean);
  ligne.append(element("span", "build-taux", ` · ${details.join(" · ")}`));
  return ligne;
}

function listeContres(titre, contres, nomHeros) {
  const bloc = document.createDocumentFragment();
  bloc.append(element("h4", null, titre));
  if (contres.length === 0) {
    bloc.append(element("p", "aide", "Pas assez de duels joués."));
    return bloc;
  }
  const liste = element("ul", "build-etapes");
  for (const c of contres) {
    const ligne = element("li");
    ligne.append(element("strong", null, c.nom), element("span", "build-taux", ` · ${nomHeros} gagne ${formatPourcent(c.tauxVictoire)} des duels (${formatNombre(c.parties)} parties)`));
    liste.append(ligne);
  }
  bloc.append(liste);
  return bloc;
}

/** Dessine le build reçu de main.js. */
function dessinerBuildDeadlock(r) {
  const conteneur = $("deadlockBuildResultat");
  conteneur.replaceChildren();
  conteneur.append(element("h3", null, `Build ${r.heros.nom}`));
  conteneur.append(element("p", "aide", `${r.heros.nom} : ${formatNombre(r.build.parties)} parties sur les ${r.periodeJours} derniers jours${Number.isInteger(r.rang) ? " (niveau choisi dans l'onglet Héros et plus)" : ""}.`));
  for (const phase of r.build.phases) {
    conteneur.append(element("h4", null, phase.titre));
    if (phase.objets.length === 0) {
      conteneur.append(element("p", "aide", "Aucun objet assez acheté à ce moment-là."));
      continue;
    }
    const liste = element("ol", "build-etapes");
    liste.append(...phase.objets.map(ligneObjetDeadlock));
    conteneur.append(liste);
  }
  conteneur.append(listeContres("Plus dur contre", r.contres.difficiles, r.heros.nom));
  conteneur.append(listeContres("Plus facile contre", r.contres.faciles, r.heros.nom));
}

async function consulterBuildDeadlock() {
  const heroId = Number($("deadlockHeros").value);
  if (!heroId) return;
  const bouton = $("formDeadlockBuild").querySelector("button");
  bouton.disabled = true;
  afficherEtat("etatDeadlockBuild", "Lecture du build sur deadlock-api.com…", "info");
  try {
    const r = await window.appli.consulterBuildDeadlock(heroId);
    if (!r.ok) {
      afficherEtat("etatDeadlockBuild", r.erreur, "erreur");
      return;
    }
    dessinerBuildDeadlock(r);
    buildDeadlockAffiche = heroId;
    afficherEtat("etatDeadlockBuild", `Lu à ${heure()} ✓`, "ok");
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
