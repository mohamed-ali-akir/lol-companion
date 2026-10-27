/*
 * Règles communes des appels à Internet
 * -------------------------------------
 * Tourne dans le processus principal (Node). Utilisé par opgg.js, lolalytics.js, arammayhem.js et deadlock-api.js.
 *
 * Tous ces sites suivent les mêmes règles (CLAUDE.md, exceptions décidées par le propriétaire) :
 *  - l'appli se présente honnêtement (User-Agent IDENTITE) ;
 *  - une même adresse est lue au plus une fois toutes les 3 heures (cache en mémoire ; 5 minutes pour l'historique
 *    d'un joueur Deadlock, qui change après chaque partie) ;
 *  - on n'attend jamais plus de 20 secondes ;
 *  - site surchargé (429, 503) : message clair, pas de nouvelle tentative en boucle ;
 *  - certificats vérifiés normalement (fetch de Node, aucune option de sécurité désactivée).
 * Ces règles sont écrites UNE seule fois ici, pour qu'aucun site ne les oublie.
 */

const DELAI_MAX_MS = 20000;
const DUREE_CACHE_MS = 3 * 60 * 60 * 1000; // les stats changent peu en quelques heures
const IDENTITE = "LoLCompanion/1.0 (appli de bureau personnelle ; une page par champion toutes les 3 h)";

/**
 * Cache en mémoire : avecCache(cle, lire) renvoie le résultat de lire(), gardé DUREE_CACHE_MS.
 *  - si deux demandes de la même clé arrivent en même temps, une seule lecture est faite (la promesse est partagée) ;
 *  - un échec n'est pas gardé : la demande suivante réessaie ;
 *  - les entrées périmées sont supprimées, pour que la mémoire ne grossisse pas si l'appli tourne plusieurs jours.
 * maintenant est modifiable pour les tests.
 */
function creerCache({ dureeMs = DUREE_CACHE_MS, maintenant = Date.now } = {}) {
  const cache = new Map(); // cle -> { date, promesse }

  function avecCache(cle, lire) {
    for (const [c, garde] of cache) {
      if (maintenant() - garde.date >= dureeMs) cache.delete(c);
    }
    const garde = cache.get(cle);
    if (garde) return garde.promesse;
    const promesse = Promise.resolve().then(lire);
    cache.set(cle, { date: maintenant(), promesse });
    promesse.catch(() => {
      if (cache.get(cle) && cache.get(cle).promesse === promesse) cache.delete(cle);
    });
    return promesse;
  }

  return { avecCache, taille: () => cache.size };
}

/**
 * Télécharge une adresse et renvoie le texte de la réponse, avec des erreurs claires.
 *  appeler     : fetch (modifiable pour les tests)
 *  options     : options de fetch (method, body, headers...) ; User-Agent et délai sont ajoutés ici
 *  site        : nom affiché dans les messages ("OP.GG"...)
 *  Erreur      : classe d'erreur du site (ErreurOpgg...)
 *  introuvable : message si le site répond 404 (sinon : message « code 404 »)
 */
async function telecharger({ appeler, adresse, options = {}, site, Erreur, introuvable = null }) {
  let reponse;
  try {
    reponse = await appeler(adresse, {
      ...options,
      headers: { "User-Agent": IDENTITE, ...options.headers },
      signal: AbortSignal.timeout(DELAI_MAX_MS),
    });
  } catch {
    throw new Erreur(`${site} ne répond pas (pas d'Internet ?).`);
  }
  if (reponse.status === 404 && introuvable) throw new Erreur(introuvable);
  // 429 (trop de demandes) et 503 (site surchargé ; deadlock-api.com le dit avec Retry-After) : pas une panne.
  if (reponse.status === 429 || reponse.status === 503) throw new Erreur(`${site} est surchargé pour le moment : réessaie dans quelques minutes.`);
  if (!reponse.ok) throw new Erreur(`${site} a répondu une erreur (code ${reponse.status}).`);
  return reponse.text();
}

module.exports = { DELAI_MAX_MS, DUREE_CACHE_MS, IDENTITE, creerCache, telecharger };
