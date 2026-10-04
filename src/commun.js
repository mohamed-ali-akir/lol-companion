/*
 * Outils et état partagés par tous les onglets de la page
 * -------------------------------------------------------
 * Chargé juste après calculs.js. Les fichiers de src/onglets/ s'en servent.
 *
 * Fonctionnement de l'affichage : chaque onglet déclare une fonction de rendu avec
 * surRendu(fonction). Quand quelque chose change (compte relu, objectif modifié...),
 * mettreAJour() calcule UNE fois la "vue" (niveau, objectif, calculs des modes) et
 * la donne à toutes ces fonctions. Ajouter un onglet = ajouter un surRendu, sans
 * toucher aux autres.
 */

// --- État de la page -------------------------------------------------------------

// Compte récupéré depuis le client : { niveau, progression } (null tant qu'on n'a rien récupéré).
// C'est la seule source du niveau : il n'y a pas de saisie manuelle.
let compte = null;
// Date du compte affiché s'il vient de la mémoire (client fermé), sinon null (données fraîches).
let compteMemoriseDu = null;
// Riot ID du compte affiché, et ses points de progression (lus par main.js dans progression.json).
let identite = null;
let pointsProgression = [];
// Statistiques des dernières parties du compte, par mode.
let statsCompte = {};
// Missions lues dans le client (onglets/missions.js) : { missions, xpDisponible, ... } ou null.
let resumeMissions = null;

// --- Petits outils ---------------------------------------------------------------

const $ = (id) => document.getElementById(id);
const formatNombre = (n) => n.toLocaleString("fr-FR", { maximumFractionDigits: 1 });
const heure = () => new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
const formatDateHeure = (date) =>
  new Date(date).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/** Affiche un message d'état ("info", "ok" ou "erreur") dans un bloc .etat. */
/**
 * Largeur utile à l'intérieur d'une carte, en pixels (même quand l'onglet est caché) :
 * les graphiques SVG sont dessinés à cette taille, pour que leurs textes gardent une taille lisible
 * sur une petite fenêtre au lieu d'être réduits avec le reste du dessin.
 */
function largeurDansCarte() {
  const barre = document.querySelector(".onglets");
  const carte = document.querySelector(".card");
  if (!barre || !carte || barre.clientWidth === 0) return 640;
  const style = getComputedStyle(carte);
  const bords = ["paddingLeft", "paddingRight", "borderLeftWidth", "borderRightWidth"].reduce((total, cle) => total + parseFloat(style[cle] || 0), 0);
  return Math.round(barre.clientWidth - bords);
}

function afficherEtat(id, message, type = "info") {
  const bloc = $(id);
  bloc.textContent = message;
  bloc.className = `etat etat-${type}`;
  bloc.hidden = !message;
}

// --- Objectif et calcul commun -----------------------------------------------------

/** Lit ce que l'utilisateur a choisi (onglet Niveau) : niveau visé, temps de jeu par jour et boosts. */
function lireObjectif() {
  const valeur = (id) => parseFloat($(id).value);
  return {
    niveauCible: Math.floor(valeur("niveauCible")),
    heuresParJour: valeur("heuresParJour"),
    boostDuree: $("boostDuree").checked,
    boostVictoire: $("boostVictoire").checked,
  };
}

/** XP des missions à compter dans le calcul (0 si l'option est décochée ou s'il n'y en a pas). */
function xpMissionsComptee() {
  return $("compterMissions").checked && resumeMissions ? resumeMissions.xpDisponible : 0;
}

/**
 * Calcule ce dont les onglets ont besoin :
 * { compte, params, erreur, calculs, sansMissions, xpMissions }.
 * calculs compte l'XP des missions si l'option est cochée ; sansMissions = le même calcul sans elle
 * (pour afficher la différence). params/calculs sont null s'il n'y a pas de compte ou une erreur.
 */
function calculerVue() {
  const vide = { compte: null, params: null, erreur: null, calculs: null, sansMissions: null, xpMissions: 0 };
  if (!compte) return vide;
  const params = parametresCalcul(compte, lireObjectif());
  const erreur = verifier(params);
  if (erreur) return { ...vide, compte, params, erreur };
  return { compte, params, erreur: null, ...calculerModesAvecMissions(params, statsCompte, xpMissionsComptee()) };
}

// --- Rendu de tous les onglets -------------------------------------------------------

const fonctionsDeRendu = [];

/** Un onglet s'inscrit ici pour être redessiné à chaque changement. */
function surRendu(fonction) {
  fonctionsDeRendu.push(fonction);
}

/** Recalcule une fois, puis redessine tous les onglets. */
function mettreAJour() {
  const vue = calculerVue();
  for (const rendu of fonctionsDeRendu) rendu(vue);
}
