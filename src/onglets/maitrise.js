/*
 * Onglet "Maîtrise" (et sa carte sur l'Accueil)
 * --------------------------------------------
 * Champions les plus proches du niveau de maîtrise suivant (points restants, marques de maîtrise
 * qui manquent, estimation "≈ N parties"), champions les plus joués, et liste complète avec
 * recherche et tri. Lecture seule. Les données viennent de main.js (maitrise.js) ;
 * les calculs sont dans calculs.js. Utilise cellule() et iconeChampion() de onglets/stats.js
 * et pluriel() de onglets/missions.js (chargés avant ce fichier).
 */

// Réponse du client : { compte, champions } (null tant qu'on n'a rien lu).
let donneesMaitrise = null;
let erreurMaitrise = null;
let rechercheMaitrise = "";
let triMaitrise = "points";

async function chargerMaitrise() {
  if (!window.appli) return;
  appliquerMaitrise(await window.appli.lireMaitrise());
}

/** Réponse de main.js (demandée, ou envoyée toute seule après une partie). */
function appliquerMaitrise(reponse) {
  if (reponse.ok) {
    donneesMaitrise = reponse;
    erreurMaitrise = null;
  } else if (!donneesMaitrise) {
    erreurMaitrise = reponse; // on garde les dernières données lues si le client vient de se fermer
  }
  mettreAJour();
}

// --- Petits textes ------------------------------------------------------------------------

const texteNiveauSuivant = (c) => (Number.isFinite(c.niveau) ? `Niveau ${c.niveau} → ${c.niveau + 1}` : "Niveau inconnu");

/** "≈ 3 parties", ou "" quand on ne peut pas estimer (pas de moyenne mesurée). */
function texteEstimation(c) {
  const n = estimerPartiesMaitrise(c);
  if (n === null || n === 0) return "";
  return `≈ ${pluriel(n, "partie", "parties")}`;
}

/** Explication de la moyenne utilisée (infobulle). */
function texteMoyenne(c) {
  return Number.isFinite(c.moyenneParPartie) && c.moyenneParPartie > 0
    ? `Ta moyenne sur ce champion : ${formatNombre(c.moyenneParPartie)} points par partie (mesurée ${surParties(c.partiesMesurees)}).`
    : "Pas encore de moyenne mesurée sur ce champion : joue une partie avec lui, l'appli la calculera.";
}

/** Ce qu'il faut en plus des points : "1 marque de maîtrise (tu en as 0 / 1)" ou "". */
function texteMarques(c) {
  if (!(c.marquesManquantes > 0)) return "";
  const texte = `${pluriel(c.marquesManquantes, "marque de maîtrise", "marques de maîtrise")}`;
  return Number.isFinite(c.marquesRequises) ? `${texte} (tu en as ${c.marquesObtenues ?? 0} / ${c.marquesRequises})` : texte;
}

/** Comment gagner la prochaine marque : "Prochaine marque : 1 partie notée A- ou mieux (+1 marque)". */
function texteProchainPalier(c) {
  const notes = texteNotesRequises(c.palier);
  if (!notes) return "";
  const gain = c.palier.marques > 0 ? ` (+${pluriel(c.palier.marques, "marque", "marques")})` : "";
  const dejaObtenues = c.notesPalier && c.notesPalier.length ? ` Notes déjà obtenues pour ce palier : ${c.notesPalier.join(", ")}.` : "";
  return `Pour en gagner : ${notes}${gain}.${dejaObtenues}`;
}

/** Ligne "points" d'un champion proche du niveau suivant. */
function textePoints(c) {
  if (c.restants === 0) return c.marquesManquantes > 0 ? "Points atteints ✓" : "Niveau suivant atteint ✓";
  const estimation = texteEstimation(c);
  return `${formatNombre(c.restants)} points restants${estimation ? ` · ${estimation}` : ""}`;
}

// --- Rendu ----------------------------------------------------------------------------------

function barreProgression(c) {
  const barre = cellule("span", undefined, "mini-barre");
  const rempli = document.createElement("span");
  const total = (c.depuisNiveau ?? 0) + (c.restants ?? 0);
  const part = total > 0 && Number.isFinite(c.depuisNiveau) ? Math.min(1, c.depuisNiveau / total) : c.restants === 0 ? 1 : 0;
  rempli.style.width = `${Math.round(part * 100)}%`;
  barre.append(rempli);
  barre.setAttribute("role", "img");
  barre.setAttribute("aria-label", `${Math.round(part * 100)} % du niveau suivant (points)`);
  return barre;
}

function creerProche(c) {
  const li = cellule("li", undefined, "maitrise-ligne");
  li.append(iconeChampion(c.championId));
  const texte = cellule("div", undefined, "maitrise-texte");
  const titre = cellule("div", undefined, "maitrise-titre");
  titre.append(cellule("strong", c.nom), cellule("span", texteNiveauSuivant(c)));
  const points = cellule("span", textePoints(c), "maitrise-points");
  points.title = texteMoyenne(c);
  texte.append(titre, barreProgression(c), points);
  const marques = texteMarques(c);
  if (marques) {
    texte.append(cellule("span", `+ ${marques}`, "maitrise-condition"));
    const palier = texteProchainPalier(c);
    if (palier) texte.append(cellule("small", palier));
  }
  li.append(texte);
  return li;
}

function creerPlusJoue(c, rang) {
  const li = cellule("li", undefined, "maitrise-ligne");
  li.append(cellule("span", `${rang}`, "meilleur-rang"), iconeChampion(c.championId));
  const texte = cellule("div", undefined, "maitrise-texte");
  const titre = cellule("div", undefined, "maitrise-titre");
  titre.append(cellule("strong", c.nom), cellule("span", Number.isFinite(c.niveau) ? `Niveau ${c.niveau}` : ""));
  texte.append(
    titre,
    cellule(
      "span",
      `${formatNombre(c.points)} points` + (c.partiesEnregistrees ? ` · ${pluriel(c.partiesEnregistrees, "partie enregistrée", "parties enregistrées")}` : ""),
      "maitrise-points"
    )
  );
  li.append(texte);
  return li;
}

function creerLigneTableau(c) {
  const tr = document.createElement("tr");
  const nom = celluleChampion(c.championId, c.nom);
  const estimation = cellule("td", c.restants === 0 ? "—" : texteEstimation(c) || "—", "nombre");
  estimation.title = texteMoyenne(c);
  tr.append(
    nom,
    cellule("td", Number.isFinite(c.niveau) ? String(c.niveau) : "?", "nombre"),
    cellule("td", formatNombre(c.points), "nombre"),
    cellule("td", Number.isFinite(c.restants) ? (c.restants === 0 ? "✓" : formatNombre(c.restants)) : "?", "nombre"),
    c.marquesManquantes > 0 ? cellule("td", pluriel(c.marquesManquantes, "marque", "marques"), "nombre manque") : cellule("td", "—", "nombre"),
    estimation
  );
  return tr;
}

/** Redessine l'onglet Maîtrise et sa carte sur l'Accueil (appelée par mettreAJour). */
function renduMaitrise() {
  const d = donneesMaitrise;
  const champions = d ? d.champions : [];
  const resume = resumeMaitrise(champions);
  renduCarteAccueilMaitrise();

  $("maitriseContenu").hidden = !resume;
  $("maitriseSansDonnees").hidden = Boolean(resume);
  if (!resume) {
    $("maitriseSansDonnees").textContent = d
      ? "Aucun point de maîtrise pour l'instant : joue une partie pour commencer."
      : erreurMaitrise && erreurMaitrise.probleme !== "pas-lance"
        ? erreurMaitrise.erreur
        : "Lance League of Legends pour voir ta maîtrise des champions.";
    return;
  }

  $("maitriseJoues").textContent = formatNombre(resume.joues);
  $("maitrisePoints").textContent = formatNombre(resume.pointsTotal);
  $("maitriseNiveauMax").textContent = formatNombre(resume.niveauMax);
  $("maitrise10").textContent = formatNombre(resume.niveau10EtPlus);

  const aDesMoyennes = champions.some((c) => c.moyenneParPartie > 0);
  $("maitriseEstimationAide").textContent = aDesMoyennes
    ? "« ≈ N parties » : calculé avec ta moyenne de points par partie sur ce champion, mesurée par l'appli après tes parties (survole le texte pour voir la moyenne)."
    : "L'estimation « ≈ N parties » apparaîtra quand l'appli aura mesuré tes points gagnés par partie : laisse-la ouverte pendant que tu joues.";
  $("maitriseProches").replaceChildren(...plusProchesDuNiveau(champions, 5).map(creerProche));
  $("maitriseJouesListe").replaceChildren(
    ...trierMaitrises(champions.filter((c) => c.points > 0), "points").slice(0, 5).map((c, i) => creerPlusJoue(c, i + 1))
  );

  const joues = champions.filter((c) => c.points > 0);
  const liste = trierMaitrises(filtrerMaitrises(joues, rechercheMaitrise), triMaitrise);
  $("maitriseCompte").textContent = rechercheMaitrise
    ? `${pluriel(liste.length, "champion trouvé", "champions trouvés")} sur ${formatNombre(joues.length)}.`
    : `${pluriel(joues.length, "champion joué", "champions joués")}.`;
  $("corpsMaitrise").replaceChildren(...liste.map(creerLigneTableau));
}

/** Carte "Maîtrise" sur l'Accueil : le champion le plus proche du niveau suivant. */
function renduCarteAccueilMaitrise() {
  const carte = $("carteMaitrise");
  const proche = donneesMaitrise ? plusProchesDuNiveau(donneesMaitrise.champions, 1)[0] : null;
  carte.classList.toggle("bientot", !proche);
  if (!proche) {
    carte.querySelector(".carte-valeur").textContent = "";
    carte.querySelector(".carte-detail").textContent = donneesMaitrise ? "Pas encore de points de maîtrise." : "Lance League of Legends pour voir ta maîtrise.";
    return;
  }
  carte.querySelector(".carte-valeur").textContent = Number.isFinite(proche.niveau) ? `${proche.nom} → niv. ${proche.niveau + 1}` : proche.nom;
  const marques = texteMarques(proche);
  carte.querySelector(".carte-detail").textContent = `${textePoints(proche)}${marques ? ` · + ${marques}` : ""}`;
}

function brancherMaitrise() {
  $("rechercheMaitrise").addEventListener("input", (e) => {
    rechercheMaitrise = e.target.value;
    renduMaitrise(); // seulement cet onglet : pas besoin de tout redessiner à chaque lettre
  });
  $("triMaitrise").addEventListener("change", (e) => {
    triMaitrise = e.target.value === "proximite" ? "proximite" : "points";
    renduMaitrise();
  });
  surRendu(renduMaitrise);
  if (window.appli) window.appli.surMaitrise(appliquerMaitrise); // relue après chaque partie
}
