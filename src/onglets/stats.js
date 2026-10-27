/*
 * Onglet "Stats" (et sa carte sur l'Accueil)
 * -----------------------------------------
 * Taux de victoire, KDA et nombre de parties par champion et par mode, meilleurs champions,
 * créneaux horaires et jours de la semaine, série en cours, et temps passé sur le jeu (compté + estimé).
 * Les parties viennent de l'historique local (parties.json, lu par main.js) : il s'enrichit à chaque
 * lecture du client et reste disponible quand le client est fermé. Les calculs sont dans calculs.js.
 * Chaque chiffre indique sur combien de parties il est calculé.
 *
 * Deux périodes (sous-onglets) : "30 derniers jours" (par défaut) et "Tout" (toutes les parties connues).
 * Le bouton "Importer tout mon historique" demande à main.js de remonter l'historique du client page par page.
 */

let partiesStats = []; // parties du compte affiché (de la plus récente à la plus ancienne)
let periodeStats = "30"; // "30" (30 derniers jours) ou "tout"
let fileStats = "tous"; // filtre par mode
let triStats = { colonne: "parties", sens: "desc" };

/** Demande à main.js les parties enregistrées du compte affiché, puis redessine. */
async function chargerStats() {
  if (!window.appli || !identite) return;
  const demande = identite;
  const parties = await window.appli.lireStats(identite);
  if (demande !== identite) return; // un autre compte a été affiché entre-temps
  partiesStats = Array.isArray(parties) ? parties : [];
  mettreAJour();
}

const JOURS_PERIODE = 30;
const nomPeriode = () => (periodeStats === "30" ? `ces ${JOURS_PERIODE} derniers jours` : "depuis le début de ton historique");
const formatDateLongue = (date) => new Date(date).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });

/** Parties de la période choisie (le filtre par mode s'applique ensuite). */
function partiesDeLaPeriode() {
  return filtrerParPeriode(partiesStats, periodeStats === "30" ? JOURS_PERIODE : null);
}

const pourcent = (taux) => `${Math.round(taux * 100)} %`;
const texteKda = (k) => (k.parfait ? `Parfait (${formatNombre(Math.round(k.valeur * 10) / 10)})` : formatNombre(Math.round(k.valeur * 100) / 100));
const surParties = (n) => `sur ${formatNombre(n)} partie${n > 1 ? "s" : ""}`;
const texteSerie = (s) => (s ? `${s.longueur} ${s.victoire ? "victoire" : "défaite"}${s.longueur > 1 ? "s" : ""}` : "—");

function cellule(balise, texte, classe) {
  const e = document.createElement(balise);
  if (classe) e.className = classe;
  if (texte !== undefined) e.textContent = texte;
  return e;
}

/** Cellule "champion" d'un tableau : icône + nom. (Le flex est sur un bloc intérieur : une cellule
 *  de tableau en display: flex perd sa largeur de colonne et ses bordures se décalent.) */
function celluleChampion(championId, nom) {
  const td = document.createElement("td");
  const bloc = cellule("div", undefined, "col-nom");
  bloc.append(iconeChampion(championId), cellule("span", nom));
  td.append(bloc);
  return td;
}

function iconeChampion(championId) {
  const image = document.createElement("img");
  image.src = `lcu-image://champion/${championId}`;
  image.alt = "";
  image.width = 28;
  image.height = 28;
  image.loading = "lazy";
  image.className = "icone-champion";
  image.addEventListener("error", () => image.classList.add("sans-image"));
  return image;
}

/** Filtre par mode : "Tous les modes (48)", "ARAM (20)"... */
function remplirFiltre(parModeTous, nombreTotal) {
  const choix = $("filtreMode");
  const options = [["tous", `Tous les modes (${nombreTotal})`], ...parModeTous.map((m) => [String(m.file), `${m.nom} (${m.parties})`])];
  if (!options.some(([valeur]) => valeur === String(fileStats))) fileStats = "tous";
  choix.replaceChildren(...options.map(([valeur, texte]) => {
    const option = document.createElement("option");
    option.value = valeur;
    option.textContent = texte;
    return option;
  }));
  choix.value = String(fileStats);
}

function renduResume(resume) {
  $("statsParties").textContent = formatNombre(resume.parties);
  $("statsVictoires").textContent = pourcent(resume.tauxVictoire);
  $("statsVictoiresDetail").textContent = `${resume.victoires} victoire${resume.victoires > 1 ? "s" : ""}`;
  $("statsKda").textContent = texteKda(resume.kda);
  $("statsSerie").textContent = texteSerie(resume.serie);
  $("statsSerie").classList.toggle("serie-defaites", Boolean(resume.serie && !resume.serie.victoire));
}

function renduMeilleurs(champions) {
  const meilleurs = meilleursChampions(champions);
  $("meilleursVide").hidden = meilleurs.length > 0;
  $("meilleursVide").textContent = `Joue au moins 3 parties avec un même champion pour le voir ici.`;
  $("meilleurs").replaceChildren(...meilleurs.map((c, i) => {
    const li = cellule("li", undefined, "meilleur");
    li.append(cellule("span", `${i + 1}`, "meilleur-rang"), iconeChampion(c.championId));
    const texte = cellule("div");
    texte.append(cellule("strong", c.nom), cellule("span", `${pourcent(c.tauxVictoire)} de victoires · KDA ${texteKda(c.kda)}`), cellule("small", surParties(c.parties)));
    li.append(texte);
    return li;
  }));
}

function renduTableau(champions) {
  for (const bouton of document.querySelectorAll("#tableChampions th button")) {
    const actif = bouton.dataset.colonne === triStats.colonne;
    bouton.parentElement.setAttribute("aria-sort", actif ? (triStats.sens === "asc" ? "ascending" : "descending") : "none");
  }
  const lignes = trierChampions(champions, triStats.colonne, triStats.sens).map((c) => {
    const tr = document.createElement("tr");
    const nom = celluleChampion(c.championId, c.nom);
    const m = c.moyennes;
    tr.append(
      nom,
      cellule("td", formatNombre(c.parties), "nombre"),
      cellule("td", pourcent(c.tauxVictoire), "nombre"),
      cellule("td", texteKda(c.kda), "nombre"),
      cellule("td", `${formatNombre(Math.round(m.kills * 10) / 10)} / ${formatNombre(Math.round(m.deaths * 10) / 10)} / ${formatNombre(Math.round(m.assists * 10) / 10)}`, "nombre")
    );
    return tr;
  });
  $("corpsChampions").replaceChildren(...lignes);
}

function renduModes(modes) {
  $("carteModes").hidden = fileStats !== "tous" || modes.length < 2;
  $("corpsModes").replaceChildren(...modes.map((m) => {
    const tr = document.createElement("tr");
    tr.append(cellule("td", m.nom), cellule("td", formatNombre(m.parties), "nombre"), cellule("td", pourcent(m.tauxVictoire), "nombre"), cellule("td", texteKda(m.kda), "nombre"));
    return tr;
  }));
}

/** Graphique en barres (SVG dessiné à la main) : taux de victoire par créneau, avec le nombre de parties. */
function dessinerBarres(idSvg, lignes, titre) {
  // Dessiné à la largeur réelle de la carte : les textes restent lisibles sur une petite fenêtre.
  const largeur = Math.max(300, largeurDansCarte());
  const etroit = largeur < 560;
  const g = geometrieBarres(lignes, { largeur, gauche: etroit ? 168 : 190, droite: etroit ? 84 : 120 });
  const zone = $(idSvg);
  zone.setAttribute("viewBox", `0 0 ${g.largeur} ${g.hauteur + 18}`);
  zone.replaceChildren(svg("title", {}, titre));
  // Repère à 50 % (trait fin, discret) et son libellé.
  zone.append(svg("line", { x1: g.x50, x2: g.x50, y1: 0, y2: g.hauteur, class: "grille" }));
  zone.append(svg("text", { x: g.x50, y: g.hauteur + 14, "text-anchor": "middle", class: "graduation" }, "50 %"));
  for (const b of g.barres) {
    const milieu = b.y + g.epaisseur / 2 + 4;
    zone.append(svg("text", { x: g.gauche - 10, y: milieu, "text-anchor": "end", class: "barre-nom" }, b.nom));
    if (!b.vide) {
      const barre = svg("rect", { x: g.gauche, y: b.y, width: Math.max(b.largeur, 2), height: g.epaisseur, rx: 4, class: "barre" });
      barre.append(svg("title", {}, `${b.nom} : ${b.texte} de victoires ${surParties(b.parties)}`));
      zone.append(barre);
    }
    zone.append(
      svg("text", { x: g.gauche + (b.vide ? 0 : b.largeur) + 8, y: milieu, class: b.vide ? "barre-valeur vide" : "barre-valeur" }, `${b.texte} (${b.parties})`)
    );
  }
}

function renduCreneaux(parties) {
  const tranches = statsParCreneau(parties, "tranches");
  const jours = statsParCreneau(parties, "jours");
  $("creneauxVide").hidden = Boolean(tranches);
  $("creneauxContenu").hidden = !tranches;
  $("creneauxVide").textContent =
    `Pas encore assez de parties pour comparer les heures et les jours (${parties.length} / ${MIN_PARTIES_CRENEAUX}).`;
  if (!tranches) return;
  dessinerBarres("svgTranches", tranches, "Taux de victoire par moment de la journée");
  dessinerBarres("svgJours", jours, "Taux de victoire par jour de la semaine");
}

/** Redessine l'onglet Stats et sa carte sur l'Accueil (appelée par mettreAJour). */
function renduStats() {
  const dansLaPeriode = partiesDeLaPeriode();
  const parModeTous = statsParMode(dansLaPeriode);
  if (fileStats !== "tous" && !parModeTous.some((m) => String(m.file) === String(fileStats))) fileStats = "tous"; // mode absent de la période
  const parties = filtrerParFile(dansLaPeriode, fileStats === "tous" ? "tous" : Number(fileStats));
  const resume = resumeStats(parties);
  renduCarteAccueilStats();
  renduTemps();
  renduPeriodes();

  $("statsSansDonnees").hidden = Boolean(resume);
  $("statsContenu").hidden = !resume;
  if (!resume) {
    $("statsSansDonnees").textContent = !identite
      ? "Lance League of Legends pour voir tes stats."
      : partiesStats.length > 0
        ? `Aucune partie ${nomPeriode()}. Regarde l'onglet « Tout » pour tes parties plus anciennes.`
        : "Aucune partie enregistrée pour l'instant : lance League of Legends, tes parties récentes seront lues automatiquement (ou importe tout ton historique ci-dessus).";
    return;
  }
  $("titreStats").textContent = periodeStats === "30" ? `Tes stats des ${JOURS_PERIODE} derniers jours` : "Tes stats depuis le début";
  remplirFiltre(parModeTous, dansLaPeriode.length);
  const champions = statsParChampion(parties);
  renduResume(resume);
  renduMeilleurs(champions);
  renduTableau(champions);
  renduModes(statsParMode(parties));
  renduCreneaux(parties);
}

/** Sous-onglets de période : un seul sélectionné, et lui seul atteignable avec Tab (flèches pour changer). */
function renduPeriodes() {
  for (const bouton of document.querySelectorAll(".periodes [role=tab]")) {
    const actif = bouton.dataset.periode === periodeStats;
    bouton.setAttribute("aria-selected", String(actif));
    bouton.tabIndex = actif ? 0 : -1;
  }
}

function choisirPeriode(periode) {
  if (periode !== "30" && periode !== "tout") return;
  periodeStats = periode;
  mettreAJour();
}

// --- Import de tout l'historique ------------------------------------------------------------

const RAISONS_ARRET = {
  fin: "le client n'a pas de parties plus anciennes à donner",
  repetition: "le client renvoie toujours les mêmes parties au-delà : c'est sa limite",
  limite: "l'appli s'est arrêtée à sa limite de sécurité (20 000 parties lues)",
};

function afficherProgressionImport(info) {
  afficherEtat("etatImport", `Import en cours… ${formatNombre(info.parties)} partie${info.parties > 1 ? "s" : ""} lue${info.parties > 1 ? "s" : ""} (page ${info.pages}).`, "info");
}

async function importerHistorique() {
  const bouton = $("boutonImport");
  bouton.disabled = true;
  afficherEtat("etatImport", "Import en cours… (connexion au client)", "info");
  try {
    const r = await window.appli.importerHistorique();
    if (!r.ok) {
      const dejaFait = r.nouvelles > 0 ? ` Les ${formatNombre(r.nouvelles)} nouvelles parties déjà lues ont bien été gardées.` : "";
      afficherEtat("etatImport", `${r.erreur}${dejaFait}`, "erreur");
      return;
    }
    const nouvelles = r.nouvelles > 0 ? `${formatNombre(r.nouvelles)} nouvelle${r.nouvelles > 1 ? "s" : ""}` : "aucune nouvelle (tu les avais déjà)";
    const depuis = r.plusAncienne ? ` La plus ancienne date du ${formatDateLongue(r.plusAncienne)}.` : "";
    afficherEtat(
      "etatImport",
      `Import terminé ✓ ${formatNombre(r.total)} partie${r.total > 1 ? "s" : ""} lue${r.total > 1 ? "s" : ""}, ${nouvelles}.${depuis} ` +
        `Arrêt : ${RAISONS_ARRET[r.arret] || RAISONS_ARRET.fin}.`,
      "ok"
    );
    await chargerStats();
  } finally {
    bouton.disabled = false;
  }
}

// --- Temps passé sur LoL (calculs.js : tempsDeJeu) --------------------------------------------

/** "1 895 h", ou "4,5 h" sous 10 h. */
const texteHeures = (h) => `${formatNombre(h < 10 ? Math.round(h * 10) / 10 : Math.round(h))} h`;

/**
 * Bloc « Temps passé sur LoL » de l'onglet Stats et sa carte sur l'Accueil.
 * Toujours sur TOUT le compte (ni la période ni le filtre de mode ne s'appliquent).
 */
function renduTemps() {
  const t = tempsDeJeu({ parties: partiesStats, compte });
  const carte = $("carteTempsJeu");
  carte.classList.toggle("bientot", !t);
  $("blocTemps").hidden = !t;
  if (!t) {
    carte.querySelector(".carte-valeur").textContent = "";
    carte.querySelector(".carte-detail").textContent = "Lance League of Legends pour le calculer.";
    return;
  }
  const estimation = t.estime !== null && t.total === t.estime.heures;
  carte.querySelector(".carte-valeur").textContent = `≈ ${texteHeures(t.total)}`;
  carte.querySelector(".carte-detail").textContent = `soit ${formatNombre(Math.round(t.jours * 10) / 10)} jours de jeu${estimation ? " depuis la création du compte" : ""}`;

  $("tempsTotal").textContent = `≈ ${texteHeures(t.total)}`;
  $("tempsTotalDetail").textContent = `≈ ${formatNombre(Math.round(t.jours * 10) / 10)} jours${t.estime ? ` · ≈ ${formatNombre(t.estime.parties)} parties` : ""}`;
  $("tempsCompte").textContent = texteHeures(t.compte.heures);
  $("tempsCompteDetail").textContent = t.compte.depuis
    ? `${surParties(t.compte.parties)} depuis le ${formatDateLongue(t.compte.depuis)}`
    : "aucune partie enregistrée";
  $("tempsSemaine").textContent = texteHeures(t.heuresParSemaine);
  $("tempsFilms").textContent = formatNombre(t.films);

  const lignes = [];
  if (t.plusLongue) {
    const avec = t.plusLongue.champion ? ` avec ${t.plusLongue.champion}` : "";
    lignes.push(`Ta plus longue partie : ${t.plusLongue.minutes} min${avec} (${t.plusLongue.victoire ? "victoire" : "défaite"}).`);
  }
  if (t.modes.length > 0) lignes.push(`Tes modes : ${t.modes.map((m) => `${m.nom} ${texteHeures(m.heures)}`).join(" · ")}.`);
  if (t.champions.length > 0) lignes.push(`Tes champions : ${t.champions.map((c) => `${c.nom} ${texteHeures(c.heures)}`).join(" · ")}.`);
  if (t.compte.parties > 0) lignes.push(`Parties entre minuit et 6 h : ${pourcent(t.partiesDeNuit)}.`);
  $("tempsAmusant").replaceChildren(...lignes.map((l) => cellule("li", l)));
}

/** Carte "Tes stats" sur l'Accueil (tous modes confondus, toutes les parties connues). */
function renduCarteAccueilStats() {
  const carte = $("carteStats");
  const resume = resumeStats(partiesStats);
  carte.classList.toggle("bientot", !resume);
  if (!resume) {
    carte.querySelector(".carte-valeur").textContent = "";
    carte.querySelector(".carte-detail").textContent = "Pas encore de parties enregistrées.";
    return;
  }
  const meilleur = meilleursChampions(statsParChampion(partiesStats), { nombre: 1 })[0];
  carte.querySelector(".carte-valeur").textContent = `${pourcent(resume.tauxVictoire)} de victoires`;
  carte.querySelector(".carte-detail").textContent = [
    surParties(resume.parties),
    `série : ${texteSerie(resume.serie)}`,
    meilleur ? `meilleur : ${meilleur.nom}` : null,
  ].filter(Boolean).join(" · ");
}

function brancherStats() {
  $("filtreMode").addEventListener("change", (e) => {
    fileStats = e.target.value;
    mettreAJour();
  });
  for (const bouton of document.querySelectorAll("#tableChampions th button")) {
    bouton.addEventListener("click", () => {
      const colonne = bouton.dataset.colonne;
      triStats = {
        colonne,
        // nouveau clic sur la même colonne : on inverse ; sinon, le nom commence par A, les nombres par le plus grand
        sens: triStats.colonne === colonne ? (triStats.sens === "asc" ? "desc" : "asc") : colonne === "nom" ? "asc" : "desc",
      };
      mettreAJour();
    });
  }
  const periodes = [...document.querySelectorAll(".periodes [role=tab]")];
  for (const bouton of periodes) {
    bouton.addEventListener("click", () => choisirPeriode(bouton.dataset.periode));
    bouton.addEventListener("keydown", (e) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
      e.preventDefault();
      const i = periodes.indexOf(bouton);
      const suivant =
        e.key === "Home" ? 0 : e.key === "End" ? periodes.length - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + periodes.length) % periodes.length;
      choisirPeriode(periodes[suivant].dataset.periode);
      periodes[suivant].focus();
    });
  }
  if (window.appli) {
    $("boutonImport").addEventListener("click", importerHistorique);
    window.appli.surProgressionImport(afficherProgressionImport);
  }
  surRendu(renduStats);
}
