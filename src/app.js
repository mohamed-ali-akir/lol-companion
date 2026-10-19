/*
 * Démarrage de la page
 * --------------------
 * Organisation du code de la page (chargé dans cet ordre par index.html, en <script> classiques :
 * les fonctions d'un fichier sont utilisables dans les fichiers chargés après lui) :
 *   1. calculs.js           : calculs purs, aussi utilisés par les tests et par main.js
 *   2. commun.js            : état partagé, petits outils, mettreAJour() qui redessine tous les onglets
 *   3. onglets/onglets.js   : la barre d'onglets
 *   4. onglets/compte.js    : la carte "Ton compte" (lecture du client)
 *   5. onglets/accueil.js, niveau.js, stats.js, maitrise.js, session.js (bilan de session),
 *      derniere-partie.js (résumé d'après-partie), parametres.js, selection.js (pick et ban automatiques),
 *      build.js (objets et runes) : un fichier par onglet ou par carte de l'Accueil
 *      assistant.js : les 3 questions de la première ouverture
 *   6. app.js (ce fichier)  : branche tout et démarre
 *
 * Pourquoi des scripts classiques et pas des modules ES ? Les deux marchent dans Electron,
 * mais calculs.js doit aussi être chargé par Node (tests, main.js) avec require() :
 * en script classique, le même fichier sert partout sans conversion.
 */

async function initialiser() {
  brancherOnglets();
  brancherAccueil();
  brancherNiveau();
  brancherStats();
  brancherMaitrise();
  brancherSession();
  brancherDernierePartie();

  // Fenêtre redimensionnée : on redessine (les graphiques suivent la largeur de la fenêtre).
  let minuterieTaille = null;
  window.addEventListener("resize", () => {
    clearTimeout(minuterieTaille);
    minuterieTaille = setTimeout(mettreAJour, 150);
  });

  // Page ouverte hors de l'appli (dans un navigateur) : pas de client, donc pas d'estimation.
  if (!window.appli) {
    activerOnglet(ONGLET_PAR_DEFAUT, { memoriser: false });
    ["boutonImport", "remettreSets"].forEach((id) => ($(id).disabled = true));
    for (const id of ["formAcceptation", "formMaj", "formSelection", "formBuild", "formConsulterBuild"]) {
      for (const element of $(id).elements) element.disabled = true;
    }
    afficherEtat("etatClient", "Lance l'appli avec npm start : le niveau est lu dans le client League.", "info");
    mettreAJour();
    return;
  }

  brancherParametres();
  brancherSelection();
  brancherBuild();
  brancherAssistant();

  // Surveillance en direct : main.js prévient la page après chaque partie.
  window.appli.surMiseAJour(miseAJourAutomatique);
  window.appli.surConnexion(afficherConnexion);
  afficherConnexion(await window.appli.etatConnexion());
  window.appli.surEtatAppli(afficherEtatAppli); // bandeau « pas encore prête »
  afficherEtatAppli(await window.appli.lireEtatAppli());

  const config = await afficherParametres();
  activerOnglet(config.ongletActif || ONGLET_PAR_DEFAUT, { memoriser: false }); // onglet du dernier lancement
  if (!config.assistantVu) ouvrirAssistant(); // première ouverture : 3 questions pour tout régler
  mettreAJour(); // affiche « Lance League of Legends… » en attendant le client

  // Dernier compte enregistré : affiché tout de suite, remplacé dès que le client répond.
  if (config.dernierCompte) {
    appliquerCompte(config.dernierCompte, config.dernierCompte.date);
    afficherEtat("etatClient", texteDonneesDu(config.dernierCompte.date), "info");
  }

  await recupererDepuisClient(true); // si le client est ouvert, tout se remplit tout seul
}

document.addEventListener("DOMContentLoaded", initialiser);
