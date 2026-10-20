/*
 * Onglet "Challenge" : top 3 en Arena avec tous les champions, dans l'ordre alphabétique
 * -------------------------------------------------------------------------------------
 * Tout est calculé par main.js (challenge.js, à la racine) depuis tes parties enregistrées (parties.json) :
 * cette page ne fait qu'afficher la progression, le prochain champion et les deux listes (restants, faits).
 * La case « Choisir automatiquement le prochain champion » est enregistrée par main.js (clé "challenge" de config.json) ;
 * le pick lui-même est fait par selection.js, avec ses garde-fous, seulement en Arena.
 * La progression est relue à l'ouverture de l'onglet, après chaque partie et quand le client se connecte.
 */

let progressionChallengeAffichee = null; // dernière réponse de main.js (pour ne pas tout redessiner pour rien)

/** « 1 partie », « 3 parties ». */
const texteParties = (n) => `${formatNombre(n)} partie${n > 1 ? "s" : ""}`;

/**
 * Une ligne de liste : icône + nom, + place, date et nombre de parties qu'il a fallu pour un champion fait,
 * ou nombre de parties déjà tentées pour un champion pas encore fait (rien s'il n'a jamais été joué en Arena).
 */
function ligneChallenge(c) {
  const ligne = element("li", c.fait ? "challenge-fait" : "");
  const nom = element("span", "challenge-nom", c.nom);
  ligne.append(iconeChampion(c.id), nom);
  const essais = Number.isInteger(c.essais) ? c.essais : 0;
  if (c.fait) {
    const date = Number.isFinite(c.date) ? ` le ${new Date(c.date).toLocaleDateString("fr-FR")}` : "";
    ligne.append(element("small", "", `top ${c.place}${date} · en ${texteParties(Math.max(1, essais))}`));
  } else if (essais > 0) {
    ligne.append(element("small", "", `${texteParties(essais)} sans top 3`));
  }
  return ligne;
}

function afficherChallenge(reponse) {
  afficherReglagesChallenge(reponse.reglages);
  if (!reponse.ok) {
    afficherEtat("etatChallenge", reponse.erreur, "info");
    return;
  }
  afficherEtat("etatChallenge", "");
  const memeContenu = progressionChallengeAffichee && JSON.stringify(progressionChallengeAffichee.champions) === JSON.stringify(reponse.champions);
  progressionChallengeAffichee = reponse;

  $("challengeFaits").textContent = formatNombre(reponse.faits);
  $("challengeRestants").textContent = formatNombre(reponse.restants);
  $("challengeTotal").textContent = formatNombre(reponse.total);
  // Parties par champion réussi, en moyenne (1 chiffre après la virgule) ; « – » tant qu'aucun n'est fait.
  $("challengeMoyenne").textContent = Number.isFinite(reponse.moyenneEssais) ? formatNombre(Math.round(reponse.moyenneEssais * 10) / 10) : "–";
  const pourcentage = reponse.total > 0 ? Math.floor((reponse.faits / reponse.total) * 100) : 0;
  $("challengePourcentage").textContent = `${pourcentage} %`;
  $("challengeRemplissage").style.width = `${reponse.total > 0 ? (reponse.faits / reponse.total) * 100 : 0}%`;
  $("challengeBarre").setAttribute("aria-valuenow", String(pourcentage));

  const prochain = $("challengeProchain");
  if (reponse.prochain) {
    const icone = iconeChampion(reponse.prochain.id);
    icone.width = 56;
    icone.height = 56;
    icone.loading = "eager";
    const texte = element("div");
    texte.append(element("span", "challenge-prochain-titre", "Prochain champion"), element("strong", "", reponse.prochain.nom));
    const essais = reponse.prochain.essais || 0;
    texte.append(element("span", "challenge-prochain-essais", essais > 0 ? `Déjà ${texteParties(essais)} sans top 3` : "Jamais joué en Arena"));
    prochain.replaceChildren(icone, texte);
  } else {
    prochain.replaceChildren(element("strong", "", reponse.total > 0 ? "Challenge terminé : top 3 avec tous les champions ! 🎉" : ""));
  }

  if (memeContenu) return; // listes identiques : on garde les icônes déjà affichées
  const restants = reponse.champions.filter((c) => !c.fait);
  const faits = reponse.champions.filter((c) => c.fait);
  $("challengeListeRestants").replaceChildren(...restants.map(ligneChallenge));
  $("challengeListeFaits").replaceChildren(...faits.map(ligneChallenge));
  $("challengeResumeFaits").textContent = `Faits (${formatNombre(faits.length)})`;
}

function afficherReglagesChallenge(r) {
  if (!r) return;
  $("challengePick").checked = r.pickActif;
  $("challengeDelai").value = r.delaiSecondes;
  $("challengeDelai").disabled = !r.pickActif;
}

async function chargerChallenge() {
  try {
    afficherChallenge(await window.appli.lireChallenge());
  } catch (erreur) {
    afficherEtat("etatChallenge", `Challenge illisible : ${erreur.message}`, "erreur");
  }
}

async function enregistrerChallenge() {
  const reponse = await window.appli.enregistrerChallenge({
    pickActif: $("challengePick").checked,
    delaiSecondes: Number($("challengeDelai").value),
  });
  if (!reponse.ok) {
    afficherEtat("etatPickChallenge", reponse.erreur, "erreur");
    return;
  }
  afficherReglagesChallenge(reponse.reglages);
  const r = reponse.reglages;
  afficherEtat("etatPickChallenge", `Enregistré ✓ (${r.pickActif ? `pick du challenge en Arena après ${r.delaiSecondes} s` : "pick manuel"})`, "ok");
}

/** Messages du pick automatique (selection.js) : seulement ceux du challenge. */
function surEvenementChallenge(info) {
  if (info.source !== "challenge") return;
  let texte;
  if (info.prevu) texte = `Arena : l'appli choisit le prochain champion du challenge dans ${info.delaiSecondes} s…`;
  else if (info.fait) texte = `${info.nom || "Champion"} choisi automatiquement pour le challenge à ${heure()} ✓`;
  else if (info.annule === "repondu") texte = `Tu as choisi toi-même : l'appli n'a rien fait (${heure()}).`;
  else if (info.annule === "fini") texte = `Tour terminé avant l'action de l'appli (${heure()}).`;
  else if (info.annule === "desactive") texte = `Option désactivée entre-temps : l'appli n'a rien fait (${heure()}).`;
  else if (info.raison === "indisponibles") texte = `Aucun champion restant du challenge n'est disponible : à toi de jouer (${heure()}).`;
  else if (info.raison === "liste-vide") texte = `Plus aucun champion à faire : à toi de jouer (${heure()}).`;
  else texte = `Impossible de choisir à ${heure()} : ${info.erreur}`;
  afficherEtat("evenementChallenge", texte, info.erreur ? "erreur" : info.fait ? "ok" : "info");
}

function brancherChallenge() {
  chargerChallenge();
  $("onglet-challenge").addEventListener("click", chargerChallenge); // parties importées depuis : on relit
  window.appli.surMiseAJour(chargerChallenge); // après chaque partie
  window.appli.surConnexion((connecte) => {
    if (connecte) chargerChallenge(); // client lancé après l'appli : la liste des champions arrive
  });
  window.appli.surSelection(surEvenementChallenge);
  for (const id of ["challengePick", "challengeDelai"]) $(id).addEventListener("change", enregistrerChallenge);
  $("formChallenge").addEventListener("submit", (e) => e.preventDefault());
}
