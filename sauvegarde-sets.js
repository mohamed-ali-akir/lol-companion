/*
 * Sauvegarde de tes sets d'objets (ceux qui ne viennent pas de LoL Companion)
 * --------------------------------------------------------------------------
 * Tourne dans le processus principal (Node). Fichier : <userData>/sets-sauvegarde.json
 *   { "<summonerId>": [ set, set, ... ] }   (un compte = une liste : on ne remet jamais les sets d'un autre compte)
 *
 * Pourquoi (19/10/2026, choix du propriétaire) : quand l'appli crée ses sets, elle retire tous les autres du client,
 * pour que la boutique ne propose que les siens. Un set retiré du client n'existe plus nulle part : on le copie donc
 * ici AVANT de le retirer (build.js, appliquerSet), et le bouton « Remettre mes anciens sets » le renvoie au client.
 * Rien n'est jamais oublié : un set déjà sauvegardé est remplacé par sa version la plus récente (même identifiant,
 * ou même titre s'il n'en a pas), les autres restent.
 * Écriture sûre (copie .bak) par fichiers.js. Fonctions pures exportées pour les tests.
 */
const path = require("path");
const { lireJson, ecrireJson } = require("./fichiers.js");

const cleSet = (s) => (typeof s.uid === "string" && s.uid ? `uid:${s.uid}` : typeof s.title === "string" ? `titre:${s.title}` : JSON.stringify(s));
const estSet = (s) => Boolean(s) && typeof s === "object" && !Array.isArray(s);

/** Sauvegarde lue sur le disque, nettoyée (fichier abîmé ou modifié à la main : on garde ce qui est lisible). */
function sauvegardeValide(donnees) {
  const propre = {};
  if (!donnees || typeof donnees !== "object" || Array.isArray(donnees)) return propre;
  for (const [compte, sets] of Object.entries(donnees)) {
    if (Array.isArray(sets)) propre[compte] = sets.filter(estSet);
  }
  return propre;
}

/** Ajoute des sets à ceux déjà sauvegardés (la version la plus récente d'un même set remplace l'ancienne). */
function ajouterSets(anciens, nouveaux) {
  const parCle = new Map((Array.isArray(anciens) ? anciens : []).filter(estSet).map((s) => [cleSet(s), s]));
  for (const s of (Array.isArray(nouveaux) ? nouveaux : []).filter(estSet)) parCle.set(cleSet(s), s);
  return [...parCle.values()];
}

function creerSauvegardeSets({ dossier }) {
  const fichier = path.join(dossier, "sets-sauvegarde.json");

  function lire() {
    try {
      return sauvegardeValide(lireJson(fichier));
    } catch {
      return {}; // pas encore de sauvegarde
    }
  }

  /** Copie tes sets avant qu'ils soient retirés du client. Une erreur d'écriture empêche le retrait (voir build.js). */
  function ajouter(compte, sets) {
    const tout = lire();
    tout[String(compte)] = ajouterSets(tout[String(compte)], sets);
    ecrireJson(fichier, tout);
  }

  /** Sets sauvegardés pour ce compte (liste vide s'il n'y en a pas). */
  function setsDu(compte) {
    return lire()[String(compte)] || [];
  }

  return { ajouter, setsDu };
}

module.exports = { creerSauvegardeSets, sauvegardeValide, ajouterSets };
