/*
 * Stats des augments ARAM Mayhem : arammayhem.com
 * -----------------------------------------------
 * Tourne dans le processus principal (Node). Utilisé par augments.js (stats sous chaque carte, en jeu).
 *
 * Pourquoi ce site (décision du propriétaire, 02/10/2026) : OP.GG ne donne qu'une « popularité » ; League of Graphs
 * (source de Porofessor) refuse les accès automatiques. arammayhem.com donne, mis à jour à chaque patch :
 *  - page d'un champion  https://arammayhem.com/build/<champion>/ : les 6 meilleurs augments par rareté pour CE
 *    champion, avec leur NOTE et leur rang (« S · #3 »), la note tous champions et le taux d'apparition ;
 *  - page des augments   https://arammayhem.com/augments/ : TOUS les augments, tous champions
 *    (rang | nom | rareté | % sélection | note).
 * Depuis le 17/10/2026, le site n'affiche plus de taux de victoire par augment : seulement ces notes (S+ à D),
 * calculées par le site. L'appli s'en sert donc pour comparer les cartes.
 * Pas d'API : on lit les pages publiques (site statique). robots.txt : "User-agent: * Allow: /".
 * Bonne conduite : identification honnête (User-Agent), une page par champion toutes les 3 h au plus, rien de personnel
 * envoyé (seulement le nom du champion dans l'adresse). Si les pages changent, l'appli le dit (« Stats indisponibles »).
 * Noms en anglais : ils correspondent aux cartes quand le jeu est en anglais.
 */

const { IDENTITE, creerCache, telecharger } = require("./internet.js"); // cache 3 h, User-Agent, délai maximal

const URL_ARAMMAYHEM = "https://arammayhem.com";
const RARETES = ["Prismatic", "Gold", "Silver"];
// Notes du site, de la meilleure à la moins bonne (vues le 17/10/2026 : S+ S S- A+ A A- B+ B B- C D).
const NOTES = ["S+", "S", "S-", "A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D+", "D", "D-"];
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

/** "S · #3" -> { note: "S", rang: 3 }, sinon null. */
function noteEtRang(texte) {
  const m = /^([SABCD][+-]?) · #(\d+)$/.exec(String(texte || "").trim());
  return m && NOTES.includes(m[1]) ? { note: m[1], rang: Number(m[2]) } : null;
}

/**
 * Page d'un champion -> [{ nom, rarete, note, rang, apparition }] (ses meilleurs augments par rareté, pour CE champion).
 * Format vérifié le 17/10/2026 : « Prismatic Augments », puis pour chaque augment :
 * nom | « S · #3 » (avec ce champion) | « Overall S · #9 » | « Appearance rate: » | x%.
 * Format vu le 26/10/2026 (la sonde échouait depuis le 25/10) : plus de note par champion, seulement les augments
 * les plus pris avec lui (« popularity is not strength ») : nom | « Appearance rate: » | x%. note et rang : null.
 * Les deux formats sont lus.
 */
function augmentsDuChampion(lignes) {
  const resultat = [];
  let rarete = null;
  for (let i = 0; i < lignes.length; i++) {
    const titre = /^(Prismatic|Gold|Silver) Augments$/.exec(lignes[i]);
    if (titre) rarete = titre[1];
    if (lignes[i] !== "Appearance rate:" || i < 1 || !rarete) continue;
    const apparition = pourcentage(lignes[i + 1]);
    if (apparition === null) continue;
    if (/^Overall /.test(lignes[i - 1])) {
      const notation = noteEtRang(lignes[i - 2]);
      const nom = lignes[i - 3];
      if (nom && notation) resultat.push({ nom, rarete, ...notation, apparition });
    } else if (!/ Augments$/.test(lignes[i - 1])) {
      resultat.push({ nom: lignes[i - 1], rarete, note: null, rang: null, apparition });
    }
  }
  return resultat;
}

/**
 * Page de tous les augments -> [{ nom, rarete, note, rang, apparition }] (tous champions confondus).
 * Format vérifié le 17/10/2026, après l'en-tête « Rank | Augment | Tier | Pick Rate | Top Champions » :
 * rang | nom | (« Deleted » : augment retiré, ignoré) | rareté | x% (sélection) | note | x%.
 */
function augmentsGlobaux(lignes) {
  const resultat = new Map();
  const debut = lignes.indexOf("Top Champions");
  for (let i = Math.max(0, debut); i + 4 < lignes.length; i++) {
    if (!/^\d+$/.test(lignes[i])) continue;
    const nom = lignes[i + 1];
    if (lignes[i + 2] === "Deleted") continue;
    const rarete = lignes[i + 2];
    const apparition = pourcentage(lignes[i + 3]);
    const note = lignes[i + 4];
    if (!RARETES.includes(rarete) || apparition === null || !NOTES.includes(note)) continue;
    if (!resultat.has(nom)) resultat.set(nom, { nom, rarete, note, rang: Number(lignes[i]), apparition });
  }
  return [...resultat.values()];
}

// --- Appel -------------------------------------------------------------------------------------

/** Lecteur arammayhem.com avec cache. appeler (fetch) et maintenant sont modifiables pour les tests. */
function creerLecteurArammayhem({ appeler = (...a) => fetch(...a), maintenant = Date.now } = {}) {
  const { avecCache } = creerCache({ maintenant }); // adresse -> lignes de la page, gardées 3 h (internet.js)

  function lirePage(adresse) {
    return avecCache(adresse, async () => {
      const html = await telecharger({
        appeler,
        adresse,
        options: { headers: { Accept: "text/html" } },
        site: "arammayhem.com",
        Erreur: ErreurArammayhem,
        introuvable: "arammayhem.com ne connaît pas ce champion.",
      });
      return texteVisible(html);
    });
  }

  /**
   * Stats pour un champion : { champion: [...], global: [...] }.
   * La page globale est indispensable ; celle du champion est un plus (si elle échoue, on garde le global).
   * Champion inconnu (alias absent) : seulement les stats tous champions (champion: []).
   */
  async function augments({ alias } = {}) {
    const nom = alias ? nomArammayhem(alias) : null;
    const [pageChampion, pageGlobale] = await Promise.allSettled([
      nom ? lirePage(`${URL_ARAMMAYHEM}/build/${nom}/`) : Promise.reject(new ErreurArammayhem("Champion inconnu.")),
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
  NOTES,
  noteEtRang,
  IDENTITE,
  ErreurArammayhem,
  nomArammayhem,
  texteVisible,
  pourcentage,
  augmentsDuChampion,
  augmentsGlobaux,
  creerLecteurArammayhem,
};
