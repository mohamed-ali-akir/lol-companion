/*
 * Onglet "Build" : objets et runes d'après les statistiques de Lolalytics et d'OP.GG
 * ----------------------------------------------------------------------------------
 * Réglages (stats, page de runes, set d'objets), consultation du build de n'importe quel champion,
 * et affichage du build appliqué pendant la sélection. Tout est fait par main.js (build.js, lolalytics.js, opgg.js) :
 * la page ne se connecte à rien, elle affiche seulement ce que main.js lui envoie.
 */

const LIBELLES_ROLES_BUILD = { top: "Haut", jungle: "Jungle", middle: "Milieu", bottom: "Bas", utility: "Support" };
const pourcentBuild = (x) => `${Math.round(x * 100)} %`;
// Sous ce nombre de parties, le taux de victoire est peu fiable (souvent le cas du 6e objet) : on le signale.
// Même seuil que PARTIES_MIN dans build.js (processus principal).
const PARTIES_FIABLES = 200;

/** "Potion de soin, Potion de soin" -> "Potion de soin ×2". */
function nomsRegroupes(noms) {
  const compte = new Map();
  for (const nom of noms) compte.set(nom, (compte.get(nom) || 0) + 1);
  return [...compte].map(([nom, n]) => (n > 1 ? `${nom} ×${n}` : nom)).join(", ");
}

// element(balise, classe, texte) : petit outil défini dans commun.js (chargé avant ce fichier).

/** Dessine un build : { stats, etapes, runes, sorts } (voir resumeBuild dans build.js). */
function dessinerBuild(conteneur, { titre, build }) {
  conteneur.replaceChildren();
  conteneur.append(element("h3", null, titre));
  if (build.stats && build.stats.parties) {
    conteneur.append(element("p", "aide", `${pourcentBuild(build.stats.tauxVictoire)} de victoires sur ${formatNombre(build.stats.parties)} parties (objets : ${build.source}).`));
  }
  const liste = element("ol", "build-etapes");
  for (const etape of build.etapes) {
    const ligne = element("li");
    ligne.append(element("strong", null, `${etape.titre} : `), document.createTextNode(nomsRegroupes(etape.noms)));
    const peu = etape.fiable === false ? " · ⚠ peu de données" : "";
    const minute = etape.minute ? ` · vers ${Math.round(etape.minute)} min` : "";
    ligne.append(element("span", "build-taux", ` · ${pourcentBuild(etape.tauxVictoire)} V · ${pourcentBuild(etape.selection)} choix · ${formatNombre(etape.parties)} parties${minute}${peu}`));
    if (etape.note) ligne.append(element("div", "aide", etape.note));
    if (etape.autres.length > 0) {
      const autres = etape.autres.map((o) => {
        const prudence = o.parties < PARTIES_FIABLES ? ", ⚠ peu de données" : "";
        return `${nomsRegroupes(o.noms)} (${pourcentBuild(o.tauxVictoire)} V, ${formatNombre(o.parties)} parties${prudence})`;
      });
      ligne.append(element("div", "aide", `Pour t'adapter : ${autres.join(" · ")}`));
    }
    liste.append(ligne);
  }
  conteneur.append(liste);
  if (build.runes) {
    const styles = build.runes.styles.length ? ` (${build.runes.styles.join(" + ")})` : "";
    conteneur.append(element("p", null, `Runes${styles} : ${build.runes.noms.join(", ")} · ${pourcentBuild(build.runes.tauxVictoire)} V`));
  }
  if (build.sorts) conteneur.append(element("p", null, `Sorts : ${build.sorts.noms.join(" + ")} · ${pourcentBuild(build.sorts.tauxVictoire)} V`));
  // Champion qui se joue de plusieurs façons (familles.js) : un set par façon, ses 3 premiers objets lui sont propres.
  if (Array.isArray(build.familles) && build.familles.length > 1) {
    conteneur.append(element("h4", null, "Plusieurs façons de jouer ce champion (un set d'objets chacune)"));
    const familles = element("ul", "build-etapes");
    for (const f of build.familles) {
      const ligne = element("li");
      ligne.append(element("strong", null, `${f.nom} `), element("span", "build-taux", `(${pourcentBuild(f.part)} des builds)`));
      f.objets.forEach((noms, i) => {
        if (noms) ligne.append(element("div", "aide", `Objet ${i + 1} : ${noms}`));
      });
      familles.append(ligne);
    }
    conteneur.append(familles);
  }
}

// --- Réglages -----------------------------------------------------------------------------

function afficherReglagesBuild(r) {
  $("buildStats").checked = r.stats;
  $("buildRunes").checked = r.runes;
  $("buildRank1").checked = r.rank1;
  $("buildRank1").disabled = !r.stats; // set en plus du set d'objets, qui vient du build
  $("buildSortsAuto").checked = r.sortsAuto;
  $("buildSortsAuto").disabled = !r.stats; // les sorts aussi
  $("buildSorts").checked = r.sorts;
  // Les augments (toujours actifs) et les chronos dessinent par-dessus le jeu : impossible en plein écran.
  $("rappelSansBordure").hidden = !(r.augments || r.sorts);
}

async function enregistrerBuild() {
  const reponse = await window.appli.enregistrerBuild({
    stats: $("buildStats").checked,
    runes: $("buildRunes").checked,
    rank1: $("buildStats").checked && $("buildRank1").checked,
    sortsAuto: $("buildStats").checked && $("buildSortsAuto").checked,
    sorts: $("buildSorts").checked, // chronos des sorts ET lancement par les pings du chat
  });
  if (!reponse.ok) {
    afficherEtat("etatBuild", reponse.erreur, "erreur");
    return;
  }
  afficherReglagesBuild(reponse.reglages);
  afficherEtat("etatBuild", "Enregistré ✓", "ok");
}

// --- Pendant la sélection -----------------------------------------------------------------

/** Message de main.js : build appliqué (ou pas) pour ton champion. */
function surEvenementBuild(info) {
  const role = info.role ? ` · ${LIBELLES_ROLES_BUILD[info.role] || info.role}` : "";
  const champion = info.nom || "ton champion";
  const bilan = [];
  if (info.runes) bilan.push(`page de runes « ${info.runes.nomPage || "LoL Companion"} » créée (${info.runes.source}) ✓`);
  if (info.sortsChoisis) bilan.push(`sorts : ${info.sortsChoisis.join(" + ")} ✓`);
  if (info.objets && !(Array.isArray(info.setsCrees) && info.setsCrees.length === 0)) {
    const plusieurs = Array.isArray(info.setsCrees) && info.setsCrees.length > 1;
    bilan.push(plusieurs ? `${info.setsCrees.length} sets d'objets créés (un par façon de jouer) ✓` : "set d'objets créé ✓");
  }
  if (info.rank1) bilan.push(`set « ${info.rank1.titre} » créé (${info.rank1.rang}, ${formatNombre(info.rank1.parties)} parties) ✓`);
  for (const [quoi, message] of Object.entries(info.erreurs || {})) {
    bilan.push(`${{ stats: "OP.GG", emplacements: "Lolalytics", runes: "runes", objets: "set d'objets", rank1: "set Rank 1", sortsAuto: "sorts" }[quoi]} : ${message}`);
  }
  const erreur = Object.keys(info.erreurs || {}).length > 0;
  afficherEtat("etatBuild", `${champion}${role} (${heure()}) : ${bilan.join(" · ") || "rien à faire"}`, erreur ? "erreur" : "ok");
  if (info.build) dessinerBuild($("buildResultat"), { titre: `Build ${champion}${role}`, build: info.build });
}

// --- Consulter un build -------------------------------------------------------------------

let championsBuild = []; // [{ id, nom }], pour la recherche du champion à consulter

async function remplirChampionsBuild() {
  const reponse = await window.appli.lireChampionsSelection();
  if (!reponse.ok) {
    afficherEtat("etatConsulterBuild", reponse.erreur, "info");
    return false;
  }
  championsBuild = reponse.champions;
  remplirSuggestionsChampions(championsBuild); // suggestions partagées (onglets/selection.js)
  afficherEtat("etatConsulterBuild", "");
  return true;
}

async function consulterBuild(evenement) {
  evenement.preventDefault();
  // Recherche tolérante comme dans Maîtrise : "kaisa" trouve "Kai'Sa" (trouverChampion, calculs.js).
  const trouve = trouverChampion($("buildChampion").value, championsBuild);
  if (!trouve.champion) {
    afficherEtat("etatConsulterBuild", trouve.erreur || "Tape le nom d'un champion.", "erreur");
    return;
  }
  $("buildChampion").value = trouve.champion.nom;
  const demande = { championId: trouve.champion.id, role: $("buildRole").value, mode: $("buildMode").value };
  $("boutonConsulterBuild").disabled = true;
  afficherEtat("etatConsulterBuild", "Lecture des statistiques…", "info");
  try {
    const reponse = await window.appli.consulterBuild(demande);
    if (!reponse.ok) {
      afficherEtat("etatConsulterBuild", reponse.erreur, "erreur");
      return;
    }
    afficherEtat("etatConsulterBuild", reponse.avertissement || "", "info");
    const role = reponse.mode === "aram" ? " · ARAM" : ` · ${LIBELLES_ROLES_BUILD[reponse.role] || reponse.role}`;
    dessinerBuild($("buildResultat"), { titre: `Build ${reponse.nom || "champion"}${role}`, build: reponse.build });
  } finally {
    $("boutonConsulterBuild").disabled = false;
  }
}

function brancherBuild() {
  window.appli.lireBuild().then(afficherReglagesBuild);
  window.appli.surBuild(surEvenementBuild);
  for (const id of ["buildStats", "buildRunes", "buildRank1", "buildSortsAuto", "buildSorts"]) $(id).addEventListener("change", enregistrerBuild);
  $("formConsulterBuild").addEventListener("submit", consulterBuild);
  $("buildMode").addEventListener("change", () => ($("buildRole").disabled = $("buildMode").value === "aram"));
  remplirChampionsBuild().then((ok) => {
    if (!ok) window.appli.surConnexion((connecte) => connecte && championsBuild.length === 0 && remplirChampionsBuild());
  });
}
