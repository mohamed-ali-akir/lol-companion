/*
 * Mode Deadlock, onglet En partie (31/10/2026)
 * --------------------------------------------
 * Objets conseillés contre l'équipe adverse (deadlock-stats.js : conseilsContreEquipe, calculé par main.js).
 *  - Ta partie est cherchée sur deadlock-api.com toutes les 30 s pendant que Deadlock tourne (deadlock.js). Quand elle est
 *    trouvée, ton héros et les héros adverses sont remplis tout seuls et l'appli ouvre cet onglet.
 *  - Le site ne voit que les parties de l'onglet « Regarder » du jeu (les 200 mieux classées) : pour les autres, l'appli
 *    reconnaît les portraits de la barre du haut de ton écran (deadlock-ecran.js, case « Repérer les héros sur mon
 *    écran », cochée d'office). Sinon, tu cliques sur les héros adverses (3 au moins).
 *  - Repérés sur l'écran, tes alliés sont connus mais pas TON portrait : ton héros reste celui de la liste s'il est
 *    parmi tes alliés, sinon ton héros le plus joué parmi eux.
 * Rien n'est lu dans le jeu lui-même (anti-triche de Valve) et rien n'est mis dans le jeu.
 */

const ENNEMIS_MAX = 6;
let herosDirectLus = null; // [{ id, nom }] (liste du choix des héros), null : pas encore lue
let ennemisDirect = []; // numéros des héros adverses choisis ou détectés
let partieDirectVue = null; // numéro de la dernière partie détectée (pour n'ouvrir l'onglet qu'une fois par partie)
let demandeConseils = 0; // numéro de la dernière demande : une réponse plus ancienne arrivée après est ignorée

/** Texte du haut : partie détectée, ou ce qu'il faut faire. */
function statutDirect() {
  const p = etatDeadlock.partie;
  const nom = (id) => ((herosDirectLus || []).find((h) => h.id === id) || {}).nom || `Héros n° ${id}`;
  const statut = $("deadlockDirectStatut");
  statut.classList.toggle("actif", Boolean(p));
  if (p && p.source === "ecran") statut.textContent = "● Héros adverses repérés sur ton écran";
  else if (p) statut.textContent = `● Partie détectée : tu joues ${nom(p.heroId)}`;
  else if (etatDeadlock.lance) statut.textContent = "Partie pas détectée : choisis les héros adverses.";
  else statut.textContent = "Deadlock est fermé : tu peux préparer ta prochaine partie.";
}

/** Boutons des héros adverses (un par héros, enfoncé s'il est choisi). */
function dessinerChoixEnnemis() {
  const boutons = (herosDirectLus || []).map((h) => {
    const bouton = element("button", "bouton-secondaire", h.nom);
    bouton.type = "button";
    bouton.dataset.heros = String(h.id);
    bouton.setAttribute("aria-pressed", String(ennemisDirect.includes(h.id)));
    bouton.disabled = h.id === Number($("deadlockDirectHeros").value);
    return bouton;
  });
  $("deadlockDirectEnnemis").replaceChildren(...boutons);
  $("deadlockDirectCompte").textContent = `${ennemisDirect.length} / ${ENNEMIS_MAX}`;
}

/** Lit la liste des héros une fois, remplit le choix de ton héros (ton plus joué d'office). */
async function remplirDirect() {
  if (herosDirectLus) return true;
  const r = await window.appli.listeHerosDeadlock();
  if (!r.ok) {
    afficherEtat("etatDeadlockDirect", r.erreur, "erreur");
    return false;
  }
  herosDirectLus = r.heros;
  $("deadlockDirectHeros").replaceChildren(
    ...r.heros.map((h) => {
      const option = element("option", null, h.nom);
      option.value = String(h.id);
      return option;
    }),
  );
  const parDefaut = (etatDeadlock.partie && etatDeadlock.partie.heroId) || herosLePlusJoue;
  $("deadlockDirectEcran").checked = etatDeadlock.reglages.ecran !== false;
  if (parDefaut && r.heros.some((h) => h.id === parDefaut)) $("deadlockDirectHeros").value = String(parDefaut);
  dessinerChoixEnnemis();
  return true;
}

/** Carte d'un objet conseillé : nom (couleur de son emplacement), puis vers quelle minute, combien le prennent, son prix. */
function carteConseilDeadlock(o) {
  const carte = element("div", `dl-objet${o.emplacement ? ` objet-${o.emplacement}` : ""}`);
  const tete = element("div", "dl-objet-tete");
  tete.append(element("strong", null, o.nom));
  const puces = element("div", "puces");
  if (Number.isFinite(o.minute)) puces.append(puce(`vers ${Math.round(o.minute)} min`));
  if (Number.isFinite(o.achat)) puces.append(puce(`${Math.round(o.achat * 100)} % des parties`));
  if (Number.isFinite(o.prix)) puces.append(puce(`${formatNombre(o.prix)} âmes`));
  carte.append(tete, puces);
  return carte;
}

/** Dessine la réponse de main.js : les menaces de l'équipe adverse, puis un bloc par famille d'objets conseillée. */
function dessinerConseils(r) {
  const conteneur = $("deadlockDirectConseils");
  if (r.manque > 0) {
    conteneur.replaceChildren(element("p", "texte-vide", `Choisis encore ${r.manque} héros adverse${r.manque > 1 ? "s" : ""}.`));
    return;
  }
  const blocs = [];
  if (r.menaces.length > 0) {
    const menaces = element("div", "puces");
    menaces.append(...r.menaces.map((m) => puce(`${m.heros.length} ${m.texte}`, "puce-alerte")));
    blocs.push(menaces);
  }
  if (r.conseils.length === 0) {
    blocs.push(element("p", "texte-vide", `Rien de particulier contre cette équipe : suis le build habituel de ${r.heros.nom} (onglet Build).`));
  }
  for (const c of r.conseils) {
    const bloc = element("section", "dl-phase");
    bloc.append(element("h3", null, c.titre), element("p", "build-note", c.raison));
    const grille = element("div", "dl-objets");
    grille.append(...c.objets.map(carteConseilDeadlock));
    bloc.append(grille);
    blocs.push(bloc);
  }
  conteneur.replaceChildren(...blocs);
}

/** Demande les conseils pour ton héros et les ennemis choisis. */
async function conseillerDirect() {
  const heroId = Number($("deadlockDirectHeros").value);
  if (!heroId) return;
  const numero = ++demandeConseils;
  if (ennemisDirect.length < 3) {
    afficherEtat("etatDeadlockDirect", "");
    dessinerConseils({ manque: 3 - ennemisDirect.length, menaces: [], conseils: [] });
    return;
  }
  afficherEtat("etatDeadlockDirect", "Chargement…", "info");
  const r = await window.appli.conseilsDeadlock({ heroId, ennemis: ennemisDirect });
  if (numero !== demandeConseils) return;
  if (!r.ok) {
    afficherEtat("etatDeadlockDirect", r.erreur, "erreur");
    return;
  }
  afficherEtat("etatDeadlockDirect", "");
  dessinerConseils(r);
}

/**
 * Appelé à chaque état reçu de main.js (deadlock-accueil.js : afficherEtatDeadlock). Partie nouvellement détectée :
 * ton héros et les ennemis sont remplis, et l'onglet s'ouvre (une seule fois par partie, en mode Deadlock).
 */
/** Repérés sur l'écran : ton héros parmi tes alliés (celui de la liste s'il y est, sinon ton plus joué parmi eux). */
function tonHerosParmi(allies) {
  const actuel = Number($("deadlockDirectHeros").value);
  if (allies.includes(actuel)) return actuel;
  if (herosLePlusJoue && allies.includes(herosLePlusJoue)) return herosLePlusJoue;
  return null;
}

async function surEtatDirect(etat) {
  const p = etat.partie;
  const cle = p ? p.matchId || `ecran:${p.ennemis.join(",")}` : null; // une partie de l'écran n'a pas de numéro
  if (p && cle !== partieDirectVue) {
    partieDirectVue = cle;
    ennemisDirect = p.ennemis.slice(0, ENNEMIS_MAX);
    if (await remplirDirect()) {
      const heroId = p.heroId || tonHerosParmi(p.allies || []);
      if (heroId && (herosDirectLus || []).some((h) => h.id === heroId)) $("deadlockDirectHeros").value = String(heroId);
      ennemisDirect = ennemisDirect.filter((id) => id !== Number($("deadlockDirectHeros").value));
      dessinerChoixEnnemis();
    }
    if (jeuAffiche() === "deadlock") activerOnglet("deadlockdirect");
    else conseillerDirect();
  }
  statutDirect();
}

function brancherDeadlockDirect() {
  document.addEventListener("onglet", async (evenement) => {
    if (evenement.detail !== "deadlockdirect") return;
    statutDirect();
    if (await remplirDirect()) conseillerDirect();
  });
  $("deadlockDirectEnnemis").addEventListener("click", (evenement) => {
    const bouton = evenement.target.closest("button[data-heros]");
    if (!bouton) return;
    const id = Number(bouton.dataset.heros);
    if (ennemisDirect.includes(id)) ennemisDirect = ennemisDirect.filter((x) => x !== id);
    else if (ennemisDirect.length < ENNEMIS_MAX) ennemisDirect = [...ennemisDirect, id];
    dessinerChoixEnnemis();
    conseillerDirect();
  });
  $("deadlockDirectHeros").addEventListener("change", () => {
    const heroId = Number($("deadlockDirectHeros").value);
    ennemisDirect = ennemisDirect.filter((id) => id !== heroId); // ton héros n'est pas dans l'équipe adverse
    dessinerChoixEnnemis();
    conseillerDirect();
  });
  $("deadlockDirectEcran").addEventListener("change", async () => {
    const reglages = await enregistrerReglagesDeadlock({ ecran: $("deadlockDirectEcran").checked }, "etatDeadlockDirect");
    if (!reglages) $("deadlockDirectEcran").checked = !$("deadlockDirectEcran").checked; // pas enregistré : on remet
  });
  $("deadlockDirectVider").addEventListener("click", () => {
    ennemisDirect = [];
    dessinerChoixEnnemis();
    conseillerDirect();
  });
}
