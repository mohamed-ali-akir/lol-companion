/*
 * Onglet "Niveau"
 * ---------------
 * Le calculateur : objectif (niveau visé, temps de jeu, boosts), une carte par mode,
 * le conseil "mode le plus rapide", et la courbe "Ta progression" (graphique SVG dessiné à la main).
 */

/** Crée une carte de résultats par mode, à partir de MODES (au lieu de copier le HTML). */
function creerCartesModes() {
  const conteneur = $("modes");
  conteneur.replaceChildren();
  for (const [mode, defaut] of Object.entries(MODES)) {
    const carte = document.createElement("article");
    carte.className = "mode";
    carte.id = `mode-${mode}`;

    const titre = document.createElement("h3");
    titre.textContent = defaut.nom;
    if (defaut.precision) {
      const petit = document.createElement("small");
      petit.textContent = ` (${defaut.precision})`;
      titre.append(petit);
    }

    const stats = document.createElement("div");
    stats.className = "stats";
    for (const [champ, libelle] of [["parties", "parties"], ["heures", "heures"], ["jours", "jours"]]) {
      const stat = document.createElement("div");
      stat.className = "stat";
      stat.innerHTML = `<span class="stat-value" data-champ="${champ}">–</span><span class="stat-label">${libelle}</span>`;
      stats.append(stat);
    }

    const detail = document.createElement("p");
    detail.className = "mode-detail";
    detail.dataset.champ = "xp";
    const source = document.createElement("p");
    source.className = "mode-source";
    source.dataset.champ = "source";

    carte.append(titre, stats, detail, source);
    conteneur.append(carte);
  }
}

function afficherMode(mode, calcul, sansMissions, xpMissions) {
  const carte = $(`mode-${mode}`);
  const champ = (nom) => carte.querySelector(`[data-champ="${nom}"]`);
  const r = calcul.resultat;
  const duree = Math.round(calcul.dureeMin);
  const taux = Math.round(calcul.tauxVictoire * 100);

  if (!r) {
    ["parties", "heures", "jours"].forEach((nom) => (champ(nom).textContent = "–"));
    champ("xp").textContent = "Parties trop courtes (moins de 7 min) : elles ne rapportent pas d'XP.";
  } else {
    champ("parties").textContent = formatNombre(r.parties);
    champ("heures").textContent = formatNombre(Math.round(r.heures));
    champ("jours").textContent = formatNombre(r.jours);
    champ("xp").textContent = `≈ ${r.xpParPartie} XP par partie`;
    // XP des missions comptée : on explique d'où vient la différence.
    const avant = sansMissions && sansMissions.resultat;
    if (avant && xpMissions > 0) {
      const gagnees = avant.parties - r.parties;
      champ("xp").textContent +=
        ` · dont ${formatNombre(xpMissions)} XP de missions` + (gagnees > 0 ? ` (−${formatNombre(gagnees)} partie${gagnees > 1 ? "s" : ""})` : "");
    }
  }

  if (calcul.perso) {
    champ("source").textContent =
      `D'après tes ${calcul.partiesAnalysees} dernières parties : ${duree} min en moyenne, ${taux} % de victoires.`;
  } else if (calcul.partiesAnalysees > 0) {
    champ("source").textContent =
      `Seulement ${calcul.partiesAnalysees} partie(s) récente(s) : valeurs moyennes utilisées (${duree} min, ${taux} % de victoires).`;
  } else {
    champ("source").textContent = `Valeurs moyennes : ${duree} min par partie, ${taux} % de victoires.`;
  }
}

function afficherConseil(calculs, params) {
  const meilleur = modeLePlusRapide(calculs);
  if (!meilleur) {
    $("conseil").textContent = "";
    return;
  }
  const ecart = Math.round(meilleur.ecartHeures);
  $("conseil").textContent =
    ecart >= 1
      ? `Le plus rapide pour atteindre le niveau ${params.niveauCible} : ${MODES[meilleur.mode].nom}, ` +
        `environ ${formatNombre(ecart)} h de jeu en moins que le mode le plus lent.`
      : "Tous les modes te prendront à peu près le même temps.";
}

/** Propose un niveau visé si celui choisi n'est pas plus haut que le niveau du compte. */
function proposerNiveauVise(niveau) {
  if (!(Number($("niveauCible").value) > niveau)) $("niveauCible").value = niveauParDefaut(niveau);
}

/** Redessine l'onglet Niveau (appelée par mettreAJour, voir commun.js). */
function renduNiveau({ compte, params, erreur, calculs, sansMissions, xpMissions }) {
  const blocErreur = $("erreur");
  const blocResultats = $("resultats");

  // Pas de compte récupéré : pas d'estimation (on n'invente pas de niveau).
  $("sansCompte").hidden = Boolean(compte);
  $("carteProgression").hidden = !compte || Boolean(erreur);
  if (!compte) {
    blocErreur.hidden = true;
    blocResultats.hidden = true;
    return;
  }

  if (erreur) {
    blocErreur.textContent = erreur;
    blocErreur.hidden = false;
    blocResultats.hidden = true;
    return;
  }
  blocErreur.hidden = true;
  blocResultats.hidden = false;

  for (const mode of Object.keys(MODES)) afficherMode(mode, calculs[mode], sansMissions && sansMissions[mode], xpMissions);
  afficherConseil(calculs, params);
  dessinerProgression(params, calculs);

  // La barre de progression et l'XP restante ne dépendent pas du mode.
  const xpDepart = xpDuCompte(compte);
  const xpCible = xpTotaleAuNiveau(params.niveauCible);
  const pourcentage = xpDepart / xpCible;

  $("labelDebut").textContent = `Niv. ${params.niveauActuel}`;
  $("labelFin").textContent = `Niv. ${params.niveauCible}`;
  $("labelPourcentage").textContent = `${Math.round(pourcentage * 100)} % de l'XP nécessaire`;
  $("barre").style.width = `${pourcentage * 100}%`;
  $("detail").textContent =
    `Il te reste ${formatNombre(Math.round(xpCible - xpDepart))} XP` +
    (xpMissions > 0 ? `, dont ${formatNombre(xpMissions)} XP apportés par tes missions en cours ` : " ") +
    `(à ${formatNombre(params.heuresParJour)} h de jeu par jour, ${ATTENTE_PAR_PARTIE_MIN} min d'attente comptées par partie).`;
  renduOptionMissions();
}

// --- Courbe "Ta progression" -----------------------------------------------------------

const SVG_NS = "http://www.w3.org/2000/svg";
/** Taille du graphique : la largeur de la carte (entre 300 et 800 px), un peu moins haut sur petit écran. */
function tailleGraphique() {
  const largeur = Math.min(800, Math.max(300, largeurDansCarte()));
  return { largeur, hauteur: largeur < 500 ? 200 : 240 };
}

/** Crée un élément SVG avec ses attributs. */
function svg(nom, attributs = {}, texte) {
  const element = document.createElementNS(SVG_NS, nom);
  for (const [cle, valeur] of Object.entries(attributs)) element.setAttribute(cle, valeur);
  if (texte !== undefined) element.textContent = texte;
  return element;
}

function dessinerProgression(params, calculs) {
  const maintenant = new Date();
  const xpActuelle = xpDuCompte(compte);
  const xpCible = xpTotaleAuNiveau(params.niveauCible);

  // Points réels : l'historique enregistré (ou, s'il est vide, juste le compte actuel).
  const reels = pointsProgression.length
    ? pointsProgression
    : [{ date: maintenant.toISOString(), xpTotale: xpActuelle, niveau: compte.niveau, progression: compte.progression }];

  const meilleur = modeLePlusRapide(calculs);
  const projection = meilleur
    ? projectionPrevue({ xpActuelle, xpCible, heures: calculs[meilleur.mode].resultat.heures, heuresParJour: params.heuresParJour, maintenant })
    : [];

  const g = geometrieGraphique(reels, projection, tailleGraphique());
  const zone = $("svgProgression");
  zone.setAttribute("viewBox", `0 0 ${g.largeur} ${g.hauteur}`);
  zone.replaceChildren(svg("title", { id: "titreGraphique" }, "XP totale dans le temps : courbe réelle et courbe prévue"));

  // Grille horizontale (niveaux entiers) et graduations.
  const bas = g.hauteur - g.marge.bas;
  for (const { niveau, y } of g.graduationsNiveaux) {
    zone.append(svg("line", { x1: g.marge.gauche, x2: g.largeur - g.marge.droite, y1: y, y2: y, class: "grille" }));
    zone.append(svg("text", { x: g.marge.gauche - 8, y: y + 4, "text-anchor": "end", class: "graduation" }, `Niv. ${niveau}`));
  }
  g.graduationsDates.forEach(({ x, texte }, i) => {
    const ancre = i === 0 ? "start" : i === g.graduationsDates.length - 1 ? "end" : "middle";
    zone.append(svg("text", { x, y: bas + 18, "text-anchor": ancre, class: "graduation" }, texte));
  });

  // Courbes : prévue (pointillés) sous la réelle.
  if (g.prevu) zone.append(svg("path", { d: g.prevu, class: "courbe courbe-prevue" }));
  if (g.reel) zone.append(svg("path", { d: g.reel, class: "courbe courbe-reelle" }));
  const dernier = g.pointsReels[g.pointsReels.length - 1];
  zone.append(svg("circle", { cx: dernier.x, cy: dernier.y, r: 4, class: "point-reel" }));

  // Survol : ligne verticale + point + infobulle sur le point réel le plus proche.
  const reperes = svg("g", { class: "survol", visibility: "hidden" });
  const ligne = svg("line", { y1: g.marge.haut, y2: bas, class: "ligne-survol" });
  const rond = svg("circle", { r: 5, class: "point-reel" });
  reperes.append(ligne, rond);
  zone.append(reperes);
  zone.append(svg("rect", { x: 0, y: 0, width: g.largeur, height: g.hauteur, fill: "transparent", class: "zone-survol" }));

  const infobulle = $("infobulle");
  zone.onpointermove = (evenement) => {
    const cadre = zone.getBoundingClientRect();
    const xVue = ((evenement.clientX - cadre.left) / cadre.width) * g.largeur;
    const proche = g.pointsReels.reduce((a, b) => (Math.abs(b.x - xVue) < Math.abs(a.x - xVue) ? b : a));
    ligne.setAttribute("x1", proche.x);
    ligne.setAttribute("x2", proche.x);
    rond.setAttribute("cx", proche.x);
    rond.setAttribute("cy", proche.y);
    reperes.setAttribute("visibility", "visible");
    const p = proche.point;
    infobulle.textContent = `${formatDateHeure(p.date)} · niveau ${p.niveau}, ${p.progression} %`;
    infobulle.hidden = false;
    const gauche = (proche.x / g.largeur) * cadre.width;
    infobulle.style.left = `${Math.min(Math.max(gauche, 90), cadre.width - 90)}px`;
    infobulle.style.top = `${(proche.y / g.hauteur) * cadre.height}px`;
  };
  zone.onpointerleave = () => {
    reperes.setAttribute("visibility", "hidden");
    infobulle.hidden = true;
  };

  $("rythme").textContent = texteRythme(pointsProgression, xpCible - xpActuelle, maintenant);

  // Tableau des données (accessible sans le graphique) : les 10 points les plus récents.
  const lignes = [...reels].reverse().slice(0, 10).map((p) => {
    const tr = document.createElement("tr");
    for (const valeur of [formatDateHeure(p.date), p.niveau, `${p.progression} %`, formatNombre(p.xpTotale)]) {
      const td = document.createElement("td");
      td.textContent = valeur;
      tr.append(td);
    }
    return tr;
  });
  $("tableProgression").replaceChildren(...lignes);
}

/** Texte à côté de la case "Compter l'XP des missions en cours". */
function renduOptionMissions() {
  const texte = !resumeMissions
    ? "(missions pas encore lues)"
    : resumeMissions.xpDisponible > 0
      ? `(${formatNombre(resumeMissions.xpDisponible)} XP disponibles)`
      : "(aucune XP de mission en cours)";
  $("infoMissions").textContent = texte;
}

function brancherNiveau() {
  creerCartesModes();
  document.querySelectorAll("#panneau-niveau input[type=number], #panneau-niveau input[type=checkbox]").forEach((champ) => {
    champ.addEventListener("input", mettreAJour);
  });
  surRendu(renduNiveau);
}
