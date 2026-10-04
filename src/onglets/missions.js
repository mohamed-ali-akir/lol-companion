/*
 * Onglet "Missions" (et sa carte sur l'Accueil)
 * --------------------------------------------
 * Missions en cours et XP de compte encore disponible. Les missions déjà terminées ne sont pas affichées.
 * Lecture seule : l'appli ne récupère aucune récompense. Les données viennent de main.js (missions.js),
 * déjà triées : à récupérer, puis missions qui donnent de l'XP, puis les autres, puis les terminées.
 * L'XP disponible (resumeMissions, dans commun.js) est aussi utilisée par le calcul de l'onglet Niveau.
 */

let erreurMissions = null;

/** Demande les missions à main.js (au démarrage, et quand on relit le compte). */
async function chargerMissions() {
  if (!window.appli) return;
  appliquerMissions(await window.appli.lireMissions());
}

/** Réponse de main.js (demandée, ou envoyée toute seule quand les missions changent). */
function appliquerMissions(reponse) {
  if (reponse.ok) {
    resumeMissions = reponse;
    erreurMissions = null;
  } else if (!resumeMissions) {
    erreurMissions = reponse; // on garde les dernières missions lues si le client vient de se fermer
  }
  mettreAJour();
}

const pluriel = (n, un, plusieurs) => `${formatNombre(n)} ${n > 1 ? plusieurs : un}`;

function element(balise, classe, texte) {
  const e = document.createElement(balise);
  if (classe) e.className = classe;
  if (texte !== undefined) e.textContent = texte;
  return e;
}

/** Une mission : titre + badges, description, objectifs avec barre x / y, récompenses, date de fin. */
function creerMission(mission) {
  const li = element("li", "card mission");

  const entete = element("div", "mission-entete");
  entete.append(element("h3", "mission-titre", mission.titre));
  if (mission.xp > 0) entete.append(element("span", "badge badge-xp", `+${formatNombre(mission.xp)} XP`));
  li.append(entete);

  if (mission.description && mission.description !== mission.titre) li.append(element("p", "mission-description", mission.description));

  for (const objectif of mission.objectifs) {
    const ligne = element("div", "objectif");
    if (objectif.description && objectif.description !== mission.description && objectif.description !== mission.titre) {
      ligne.append(element("span", "objectif-texte", objectif.description));
    }
    if (objectif.total) {
      const actuel = objectif.actuel ?? 0;
      const barre = element("div", "mini-barre");
      const remplissage = element("span");
      remplissage.style.width = `${Math.min(100, (actuel / objectif.total) * 100)}%`;
      barre.append(remplissage);
      barre.setAttribute("role", "progressbar");
      barre.setAttribute("aria-valuemin", "0");
      barre.setAttribute("aria-valuemax", String(objectif.total));
      barre.setAttribute("aria-valuenow", String(actuel));
      ligne.append(barre, element("span", "objectif-compte", `${formatNombre(actuel)} / ${formatNombre(objectif.total)}`));
    }
    li.append(ligne);
  }

  const pied = element("p", "mission-pied");
  const recompenses = mission.recompenses.map((r) => (r.recue ? `${r.description} (reçue)` : r.description));
  if (recompenses.length) pied.append(element("span", null, `Récompenses : ${recompenses.join(", ")}`));
  const fin = texteFin(mission.fin);
  if (fin) pied.append(element("span", "mission-fin", fin));
  if (mission.serie) pied.append(element("span", "mission-serie", mission.serie));
  li.append(pied);
  return li;
}

/** Redessine l'onglet Missions et sa carte sur l'Accueil (appelée par mettreAJour). */
function renduMissions() {
  const r = resumeMissions;
  $("missionsContenu").hidden = !r;
  $("missionsSansDonnees").hidden = Boolean(r);
  renduCarteAccueilMissions();
  if (!r) {
    $("missionsSansDonnees").textContent =
      erreurMissions && erreurMissions.probleme !== "pas-lance"
        ? erreurMissions.erreur
        : "Lance League of Legends pour voir tes missions en cours.";
    return;
  }

  $("missionsXp").textContent = r.xpDisponible > 0 ? `+${formatNombre(r.xpDisponible)} XP disponibles` : "Aucune XP de compte à gagner";
  $("missionsResume").textContent =
    r.enCours === 0
      ? "Aucune mission en cours pour l'instant."
      : `${pluriel(r.enCours, "mission en cours", "missions en cours")}` +
        (r.enCoursAvecXp ? `, dont ${pluriel(r.enCoursAvecXp, "qui donne", "qui donnent")} de l'XP de compte.` : ".");
  // Seulement les missions en cours : celles déjà terminées ne sont pas affichées.
  const enCours = r.missions.filter((m) => !m.terminee);
  $("listeMissions").replaceChildren(...enCours.map(creerMission));
}

/** Carte "Missions" sur l'Accueil. */
function renduCarteAccueilMissions() {
  const carte = $("carteMissions");
  const r = resumeMissions;
  carte.classList.toggle("bientot", !r);
  if (!r) {
    carte.querySelector(".carte-valeur").textContent = "";
    carte.querySelector(".carte-detail").textContent = "Lance League of Legends pour voir tes missions.";
    return;
  }
  carte.querySelector(".carte-valeur").textContent = r.xpDisponible > 0 ? `+${formatNombre(r.xpDisponible)} XP` : "—";
  carte.querySelector(".carte-detail").textContent = r.enCours
    ? pluriel(r.enCours, "mission en cours", "missions en cours")
    : "Aucune mission en cours";
}

function brancherMissions() {
  surRendu(renduMissions);
  if (window.appli) window.appli.surMissions(appliquerMissions); // mission avancée ou terminée
}
