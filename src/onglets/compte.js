/*
 * Carte "Ton compte" (toujours visible, au-dessus des onglets)
 * -----------------------------------------------------------
 * Récupère le compte dans le client League (bouton, démarrage, ou mise à jour automatique
 * après une partie) et met à jour l'état partagé (commun.js), puis redessine les onglets.
 */

// Au démarrage, client fermé : message court (la consigne complète est dans les onglets).
const MESSAGE_LANCER_CLIENT = "Le client League n'est pas lancé pour l'instant.";

function afficherProfil(nom, tag, niveau, progression) {
  $("profilNom").textContent = tag ? `${nom}#${tag}` : nom;
  $("profilNiveau").textContent = niveau;
  $("profilProgression").textContent = `${progression} % vers le niveau ${niveau + 1}`;
  $("profil").hidden = false;
}

/** Demande à main.js les points de progression du compte affiché, puis redessine. */
async function chargerProgression() {
  if (!window.appli || !identite) return;
  const demande = identite;
  const points = await window.appli.lireProgression(identite);
  if (demande !== identite) return; // un autre compte a été affiché entre-temps
  pointsProgression = points;
  mettreAJour();
}

/**
 * Met toute la page à jour avec un compte : réponse du client (données fraîches),
 * ou dernier compte enregistré (dateMemoire = sa date de lecture).
 */
function appliquerCompte(reponse, dateMemoire = null) {
  compteMemoriseDu = dateMemoire;
  $("profil").classList.toggle("memoire", Boolean(dateMemoire));
  compte = { niveau: reponse.niveau, progression: reponse.progression };
  identite = { nom: reponse.nom, tag: reponse.tag };
  statsCompte = reponse.stats || {};
  chargerProgression(); // la courbe se redessine quand les points arrivent
  chargerStats(); // parties enregistrées (onglet Stats), disponibles même client fermé
  proposerNiveauVise(compte.niveau);
  afficherProfil(reponse.nom || "Compte connecté", reponse.tag, compte.niveau, compte.progression);

  const historique = texteHistorique(reponse.stats);
  $("historique").textContent = historique;
  $("historique").hidden = !historique;
  mettreAJour();
}

/**
 * Lit le compte connecté dans le client League lancé sur ce PC (démarrage de l'appli, ou dossier du jeu changé).
 * Ensuite, la surveillance en direct relit tout toute seule (client lancé, fin de partie) : plus de bouton.
 * auto = true au démarrage de l'appli : si le client n'est pas lancé, on affiche simplement
 * un message calme (ce n'est pas une erreur : les onglets expliquent quoi faire).
 */
async function recupererDepuisClient(auto = false) {
  afficherEtat("etatClient", "Connexion au client League…");

  const reponse = await window.appli.recupererDepuisClient();

  if (!reponse.ok) {
    if (compteMemoriseDu && reponse.probleme === "pas-lance") afficherEtat("etatClient", texteDonneesDu(compteMemoriseDu), "info");
    else if (auto && reponse.probleme === "pas-lance") afficherEtat("etatClient", MESSAGE_LANCER_CLIENT, "info");
    else afficherEtat("etatClient", reponse.erreur, "erreur");
    if (reponse.probleme === "dossier") activerOnglet("parametres");
    return;
  }

  appliquerCompte(reponse);
  chargerClassee(); // champions et Essence bleue (onglet Classée)
  chargerMissions(); // missions en cours (onglet Missions)
  chargerMaitrise(); // maîtrise des champions (onglet Maîtrise), après la lecture du compte
  afficherEtat(
    "etatClient",
    reponse.avertissement ||
      `Récupéré depuis le client : niveau ${reponse.niveau}, ${reponse.progression} % du niveau suivant.`,
    reponse.avertissement ? "info" : "ok"
  );
}

/**
 * Mise à jour envoyée toute seule par main.js (surveillance en direct) :
 *  - raison "fin-de-partie" : une partie vient de se terminer ;
 *  - raison "client-lance" : le client vient d'être lancé (ou l'appli vient de démarrer).
 */
function miseAJourAutomatique(reponse) {
  const avant = compte;
  const etaitEnMemoire = Boolean(compteMemoriseDu);
  appliquerCompte(reponse);

  if (reponse.raison === "fin-de-partie") {
    const gain = xpGagnee(avant, compte);
    const niveauGagne = avant && compte.niveau > avant.niveau;
    afficherEtat(
      "etatClient",
      `Mis à jour après ta partie (${heure()}) : ` +
        (gain > 0 ? `+${formatNombre(gain)} XP environ` : "compte relu") +
        (niveauGagne ? `, niveau ${compte.niveau} atteint ! 🎉` : `, ${compte.progression} % du niveau ${compte.niveau + 1}.`),
      "ok"
    );
  } else if (!avant || etaitEnMemoire) {
    afficherEtat("etatClient", `Client League détecté : niveau ${compte.niveau}, ${compte.progression} % du niveau suivant.`, "ok");
  }
}

/**
 * Bandeau « pas encore prête » en haut de la fenêtre : affiché tant que l'appli se connecte à League
 * (message calculé par main.js, sondage.js), caché dès qu'elle est prête ou que League est fermé.
 */
function afficherEtatAppli(etat) {
  const bandeau = $("bandeauPreparation");
  const message = etat && !etat.pret && etat.message;
  bandeau.textContent = message ? `⏳ ${message}` : "";
  bandeau.hidden = !message;
}

/** Petit indicateur : la page est-elle branchée en direct sur le client ? */
function afficherConnexion(connecte) {
  const bloc = $("suiviDirect");
  bloc.hidden = false;
  bloc.classList.toggle("actif", connecte);
  bloc.textContent = connecte
    ? "● Suivi en direct : mise à jour automatique après chaque partie"
    : "○ En attente du client League : l'appli se connectera dès qu'il sera lancé";
}
