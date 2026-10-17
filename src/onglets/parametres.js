/*
 * Onglet "Paramètres"
 * -------------------
 * Partie trouvée (acceptation automatique, notification), arrière-plan (fermer = réduire, démarrage de
 * Windows), dossier du jeu, historique de progression.
 * (Le bouton "Effacer l'historique des parties" est branché dans onglets/stats.js.)
 * Affiche aussi la carte "Acceptation auto" de l'Accueil.
 */

async function afficherParametres() {
  const config = await window.appli.lireConfig();
  $("dossierJeu").value = config.dossierJeu;
  $("dossierParDefaut").textContent = config.dossierJeuParDefaut;
  if (config.plateforme === "darwin") {
    // Mac : les augments sont lus à l'écran avec l'OCR de macOS, qui a besoin de l'autorisation
    // « Enregistrement de l'écran » : on explique où la donner tant qu'elle manque.
    $("ecranMac").hidden = config.autorisationEcran === "granted"; // augments et pings du chat lisent l'écran
    // Textes qui parlent de Windows : leur version Mac est dans l'attribut data-mac (index.html).
    for (const e of document.querySelectorAll("[data-mac]")) e.textContent = e.dataset.mac;
  }
  return config;
}

async function enregistrerDossier(dossier) {
  const reponse = await window.appli.enregistrerDossierJeu(dossier);
  if (!reponse.ok) {
    afficherEtat("etatDossier", reponse.erreur, "erreur");
    return;
  }
  $("dossierJeu").value = reponse.dossierJeu;
  afficherEtat("etatDossier", "Dossier enregistré ✓", "ok");
  recupererDepuisClient(); // on réessaie tout de suite avec le nouveau dossier
}

async function effacerProgression() {
  if (!window.confirm("Effacer tout l'historique de progression ? Ta courbe repartira de zéro.")) return;
  await window.appli.effacerProgression();
  pointsProgression = [];
  afficherEtat("etatProgression", "Historique effacé ✓", "ok");
  mettreAJour();
}

// --- Partie trouvée : acceptation automatique -------------------------------------------

let reglagesAcceptation = null; // { actif, delaiSecondes, notifier }, lus dans main.js
let dernierEvenementFile = null; // dernier message à afficher sur l'Accueil

function afficherReglagesAcceptation(r) {
  reglagesAcceptation = r;
  $("autoAccepter").checked = r.actif;
  $("delaiAcceptation").value = r.delaiSecondes;
  $("delaiAcceptation").disabled = !r.actif;
  $("notifierPartie").checked = r.notifier;
  mettreAJour();
}

async function enregistrerAcceptation() {
  const reponse = await window.appli.enregistrerAcceptation({
    actif: $("autoAccepter").checked,
    delaiSecondes: Number($("delaiAcceptation").value),
    notifier: $("notifierPartie").checked,
  });
  if (!reponse.ok) {
    afficherEtat("etatAcceptation", reponse.erreur, "erreur");
    return;
  }
  afficherReglagesAcceptation(reponse.reglages); // valeurs nettoyées (délai borné entre 0 et 8 s)
  afficherEtat(
    "etatAcceptation",
    reponse.reglages.actif ? `Acceptation automatique activée (après ${reponse.reglages.delaiSecondes} s) ✓` : "Acceptation automatique désactivée.",
    "ok"
  );
}

/** Messages de main.js : partie trouvée, puis résultat de l'acceptation. */
function surEvenementFile(info) {
  if (info.type === "trouvee") {
    dernierEvenementFile = info.autoActif
      ? `Partie trouvée à ${heure()} : acceptation dans ${info.delaiSecondes} s…`
      : `Partie trouvée à ${heure()}.`;
  } else if (info.type === "resultat") {
    dernierEvenementFile = info.accepte
      ? `Dernière partie acceptée automatiquement à ${heure()} ✓`
      : info.annule === "repondu"
        ? `Partie de ${heure()} : tu as répondu toi-même, l'appli n'a rien fait.`
        : info.annule === "fini"
          ? `Partie de ${heure()} annulée avant l'acceptation.`
          : `Acceptation impossible à ${heure()} : ${info.erreur}`;
  }
  mettreAJour();
}

/** Carte "Acceptation auto" sur l'Accueil. */
function renduCarteFile() {
  const carte = $("carteFile");
  const r = reglagesAcceptation;
  if (!r) {
    carte.hidden = true;
    return;
  }
  carte.hidden = false;
  carte.querySelector(".carte-valeur").textContent = r.actif ? "Activée ✓" : "Désactivée";
  const details = [
    r.actif ? `Accepte après ${r.delaiSecondes} s` : "Tu acceptes toi-même",
    r.notifier ? "notification activée" : "sans notification",
  ];
  carte.querySelector(".carte-detail").textContent = dernierEvenementFile
    ? `${details.join(" · ")}. ${dernierEvenementFile}`
    : `${details.join(" · ")}.`;
}

// --- Arrière-plan : fermer = réduire, démarrage de Windows --------------------------------

function afficherReglagesArrierePlan(r) {
  $("fermerReduit").checked = r.fermerReduit;
  $("lancerAuDemarrage").checked = r.lancerAuDemarrage;
  $("demarrerReduit").checked = r.demarrerReduit;
  $("demarrerReduit").disabled = !r.lancerAuDemarrage; // "démarrer réduit" n'a de sens qu'avec le démarrage de Windows
  $("prevenirClientDetecte").checked = r.prevenirClientDetecte;
  $("ouvrirAvecLeague").checked = r.ouvrirAvecLeague;
  $("majAuto").checked = r.majAuto;
}

async function enregistrerArrierePlan() {
  const reponse = await window.appli.enregistrerArrierePlan({
    fermerReduit: $("fermerReduit").checked,
    lancerAuDemarrage: $("lancerAuDemarrage").checked,
    demarrerReduit: $("demarrerReduit").checked,
    prevenirClientDetecte: $("prevenirClientDetecte").checked,
    ouvrirAvecLeague: $("ouvrirAvecLeague").checked,
    majAuto: $("majAuto").checked,
  });
  if (!reponse.ok) {
    afficherEtat("etatArrierePlan", reponse.erreur, "erreur");
    return;
  }
  afficherReglagesArrierePlan(reponse.reglages);
  afficherEtat("etatArrierePlan", "Réglages enregistrés ✓", "ok");
}

// --- Mises à jour de l'appli (mise-a-jour.js) -------------------------------------------------

/** Texte de la ligne « Version » (Paramètres) selon l'étape de la mise à jour. */
function texteMaj(etat) {
  const actuelle = `Version ${etat.version}`;
  switch (etat.etape) {
    case "indisponible":
      return etat.raison === "mac"
        ? `${actuelle} (Mac : pas de mise à jour automatique, l'appli n'est pas signée par Apple ; télécharge la nouvelle version à la main).`
        : `${actuelle} (lancée depuis le projet : pas de mise à jour automatique).`;
    case "recherche":
      return `${actuelle} · recherche d'une mise à jour…`;
    case "a-jour":
      return `${actuelle} · à jour ✓`;
    case "telechargement":
      return `${actuelle} · téléchargement de la version ${etat.nouvelle || "suivante"}${Number.isFinite(etat.pourcentage) ? ` (${etat.pourcentage} %)` : ""}…`;
    case "prete":
      return `${actuelle} · version ${etat.nouvelle} prête : redémarre l'appli pour l'installer.`;
    case "disponible": // Mac : l'appli vérifie seulement, la nouvelle version se télécharge à la main
      return `${actuelle} · version ${etat.nouvelle} disponible : télécharge-la depuis le bandeau en haut.`;
    case "erreur":
      return `${actuelle} · ${etat.message}`;
    default:
      return actuelle;
  }
}

function afficherMaj(etat) {
  if (!etat) return;
  $("majVersion").textContent = texteMaj(etat);
  $("majVerifier").disabled = etat.etape === "indisponible" || etat.etape === "recherche" || etat.etape === "telechargement" || etat.etape === "prete";
  // Windows : version téléchargée, prête à installer. Mac : version disponible, à télécharger soi-même.
  const mac = etat.etape === "disponible";
  $("bandeauMaj").hidden = etat.etape !== "prete" && !mac;
  $("bandeauMajTexte").textContent = mac
    ? `La version ${etat.nouvelle} de LoL Companion est disponible.`
    : `La version ${etat.nouvelle} de LoL Companion est prête.`;
  $("installerMaj").textContent = mac ? "Télécharger la nouvelle version" : "Redémarrer et mettre à jour";
  $("installerMaj").disabled = false;
}

function brancherMaj() {
  window.appli.surMaj(afficherMaj);
  window.appli.lireMaj().then(afficherMaj);
  $("majVerifier").addEventListener("click", () => {
    $("majVerifier").disabled = true;
    window.appli.verifierMaj();
  });
  $("installerMaj").addEventListener("click", () => {
    if ($("installerMaj").textContent.startsWith("Télécharger")) {
      // Mac : ouvre la page de téléchargement dans le navigateur ; l'appli reste ouverte.
      $("bandeauMajTexte").textContent = "Page de téléchargement ouverte : installe le .dmg, puis relance LoL Companion.";
      window.appli.installerMaj();
      return;
    }
    $("installerMaj").disabled = true; // l'appli va se fermer puis se relancer
    $("bandeauMajTexte").textContent = "Installation… l'appli redémarre dans quelques secondes.";
    window.appli.installerMaj();
  });
}

function brancherParametres() {
  brancherMaj();
  surRendu(renduCarteFile);
  window.appli.lireAcceptation().then(afficherReglagesAcceptation);
  window.appli.surAcceptation(surEvenementFile);
  window.appli.surReglagesAcceptation(afficherReglagesAcceptation); // cochée/décochée depuis l'icône
  window.appli.lireArrierePlan().then(afficherReglagesArrierePlan);
  for (const id of ["fermerReduit", "lancerAuDemarrage", "demarrerReduit", "prevenirClientDetecte", "ouvrirAvecLeague", "majAuto"]) $(id).addEventListener("change", enregistrerArrierePlan);
  for (const id of ["autoAccepter", "delaiAcceptation", "notifierPartie"]) $(id).addEventListener("change", enregistrerAcceptation);

  $("formDossier").addEventListener("submit", (e) => {
    e.preventDefault();
    enregistrerDossier($("dossierJeu").value);
  });
  $("dossierDefaut").addEventListener("click", () => enregistrerDossier(""));
  $("effacerProgression").addEventListener("click", effacerProgression);
}
