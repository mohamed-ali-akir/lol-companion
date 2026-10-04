/*
 * Stats des augments ARAM Mayhem : arammayhem.com
 * -----------------------------------------------
 * Tourne dans le processus principal (Node). Utilisé par augments.js (stats sous chaque carte, en jeu).
 *
 * Pourquoi ce site (décision du propriétaire, 02/10/2026) : les bons outils (Porofessor, Blitz) recommandent les
 * augments selon leur TAUX DE VICTOIRE avec ton champion. OP.GG ne donne qu'une « popularité » sans taux de victoire
 * (et dont le total dépasse 360 % pour Hwei : pas un vrai taux de sélection) ; League of Graphs (source de
 * Porofessor) refuse les accès automatiques. arammayhem.com donne, mis à jour à chaque patch :
 *  - page d'un champion  https://arammayhem.com/build/<champion>/ : les 6 meilleurs augments par rareté
 *    (prismatique, or, argent) avec « Appearance rate » et « Win rate » pour CE champion ;
 *  - page des augments   https://arammayhem.com/augments/ : TOUS les augments, taux de victoire tous champions
 *    (nom | rareté | % sélection | % victoire | ... | rang).
 * Pas d'API : on lit les pages publiques (site statique). robots.txt : "User-agent: * Allow: /".
 * Bonne conduite : identification honnête (User-Agent), une page par champion toutes les 3 h au plus, rien de personnel
 * envoyé (seulement le nom du champion dans l'adresse). Si les pages changent, l'appli le dit (« Stats indisponibles »).
 * Noms en anglais : ils correspondent aux cartes quand le jeu est en anglais.
 */

const URL_ARAMMAYHEM = "https://arammayhem.com";
const DELAI_MAX_MS = 20000;
const DUREE_CACHE_MS = 3 * 60 * 60 * 1000;
const IDENTITE = "LoLCompanion/1.0 (appli de bureau personnelle ; une page par champion toutes les 3 h)";
const RARETES = ["Prismatic", "Gold", "Silver"];
const EXCEPTIONS_NOMS = { monkeyking: "wukong" };

class ErreurArammayhem extends Error {}

// --- Fonctions pures (testées) --------------------------------------------------------------

/** Nom du champion dans les adresses du site, à partir de l'alias du client ("MonkeyKing" -> "wukong"). */
function nomArammayhem(alias) {
  const nom = String(alias || "").replace(/[^A-Za-z0-9]/g, "").toLowerCase();
  return EXCEPTIONS_NOMS[nom] || nom;
}

const ENTITES = { "&amp;": "&", "&#39;": "'", "&quot;": '"', "&lt;": "<", "&gt;": ">", "&nbsp;": " ", "&#x27;": "'" };

/** Page HTML -> lignes de texte visibles (sans scripts, styles ni balises), entités décodées. */
function texteVisible(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&(?:amp|#39|quot|lt|gt|nbsp|#x27);/g, (e) => ENTITES[e])
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/** "57.76%" -> 0.5776, sinon null. */
function pourcentage(texte) {
  const m = /^(\d{1,3}(?:\.\d+)?)%$/.exec(String(texte || "").trim());
  return m ? Number((Number(m[1]) / 100).toFixed(6)) : null; // toFixed : 23.19 % -> 0.2319 (pas 0.23190000000000002)
}

/**
 * Page d'un champion -> [{ nom, rarete, apparition, tauxVictoire }] (ses meilleurs augments par rareté).
 * Format vérifié : <rareté> puis, pour chaque augment : nom | "Appearance rate:" | x% | "Win rate:" | y%.
 */
function augmentsDuChampion(lignes) {
  const resultat = [];
  let rarete = null;
  for (let i = 0; i < lignes.length; i++) {
    if (RARETES.includes(lignes[i])) rarete = lignes[i];
    if (lignes[i] !== "Appearance rate:" || lignes[i + 2] !== "Win rate:") continue;
    const apparition = pourcentage(lignes[i + 1]);
    const tauxVictoire = pourcentage(lignes[i + 3]);
    const nom = lignes[i - 1];
    if (nom && apparition !== null && tauxVictoire !== null) resultat.push({ nom, rarete, apparition, tauxVictoire });
  }
  return resultat;
}

/**
 * Page de tous les augments -> [{ nom, rarete, apparition, tauxVictoire }] (tous champions confondus).
 * Format vérifié : nom | rareté | x% (sélection) | y% (victoire) | ... ; on garde la première ligne de chaque nom.
 */
function augmentsGlobaux(lignes) {
  const resultat = new Map();
  for (let i = 0; i + 3 < lignes.length; i++) {
    if (!RARETES.includes(lignes[i + 1])) continue;
    const apparition = pourcentage(lignes[i + 2]);
    const tauxVictoire = pourcentage(lignes[i + 3]);
    const nom = lignes[i];
    if (apparition === null || tauxVictoire === null || RARETES.includes(nom) || pourcentage(nom) !== null) continue;
    if (!resultat.has(nom)) resultat.set(nom, { nom, rarete: lignes[i + 1], apparition, tauxVictoire });
  }
  return [...resultat.values()];
}

// --- Appel -------------------------------------------------------------------------------------

/** Lecteur arammayhem.com avec cache. appeler (fetch) et maintenant sont modifiables pour les tests. */
function creerLecteurArammayhem({ appeler = (...a) => fetch(...a), maintenant = Date.now } = {}) {
  const cache = new Map();

  async function lirePage(adresse) {
    const garde = cache.get(adresse);
    if (garde && maintenant() - garde.date < DUREE_CACHE_MS) return garde.lignes;
    let reponse;
    try {
      reponse = await appeler(adresse, { headers: { "User-Agent": IDENTITE, Accept: "text/html" }, signal: AbortSignal.timeout(DELAI_MAX_MS) });
    } catch {
      throw new ErreurArammayhem("arammayhem.com ne répond pas (pas d'Internet ?).");
    }
    if (reponse.status === 404) throw new ErreurArammayhem("arammayhem.com ne connaît pas ce champion.");
    if (!reponse.ok) throw new ErreurArammayhem(`arammayhem.com a répondu une erreur (code ${reponse.status}).`);
    const lignes = texteVisible(await reponse.text());
    cache.set(adresse, { date: maintenant(), lignes });
    return lignes;
  }

  /**
   * Stats pour un champion : { champion: [...], global: [...] }.
   * La page globale est indispensable ; celle du champion est un plus (si elle échoue, on garde le global).
   */
  async function augments({ alias }) {
    const nom = nomArammayhem(alias);
    if (!nom) throw new ErreurArammayhem("Champion inconnu.");
    const [pageChampion, pageGlobale] = await Promise.allSettled([
      lirePage(`${URL_ARAMMAYHEM}/build/${nom}/`),
      lirePage(`${URL_ARAMMAYHEM}/augments/`),
    ]);
    if (pageGlobale.status === "rejected") throw pageGlobale.reason;
    const global = augmentsGlobaux(pageGlobale.value);
    if (global.length === 0) throw new ErreurArammayhem("La page d'arammayhem.com a changé de format.");
    const champion = pageChampion.status === "fulfilled" ? augmentsDuChampion(pageChampion.value) : [];
    return { champion, global };
  }

  return { augments };
}

module.exports = {
  URL_ARAMMAYHEM,
  IDENTITE,
  ErreurArammayhem,
  nomArammayhem,
  texteVisible,
  pourcentage,
  augmentsDuChampion,
  augmentsGlobaux,
  creerLecteurArammayhem,
};
