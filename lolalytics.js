/*
 * Objets emplacement par emplacement : Lolalytics
 * ------------------------------------------------
 * Tourne dans le processus principal (Node).
 *
 * OP.GG (opgg.js) ne donne qu'UNE combinaison pour les objets 1 à 3 et une seule paire de bottes. Lolalytics donne,
 * pour chaque emplacement (objet 1 à 5, bottes, départ), toutes les options avec leur taux de victoire, leur nombre
 * de parties et la minute d'achat. Décision du propriétaire (02/10/2026) après recherche : aucune source officielle
 * ne fournit ces données (u.gg et dpm.lol n'ont pas d'accès prévu pour les applis non plus).
 *
 * Lolalytics n'a PAS d'accès prévu pour les applis : on lit la page publique du build, comme un navigateur.
 *   GET https://lolalytics.com/lol/<champion>/build/?lane=<voie>    (ARAM : /lol/<champion>/aram/build/)
 * Vérifié le 02/10/2026 :
 *  - la page (≈ 600 Ko) contient ses données dans un bloc <script type="qwik/json"> : un tableau "objs" où les
 *    valeurs renvoient à d'autres cases par un numéro en base 36 ("4c6" -> objs[5622]) ;
 *  - un objet contient item1..item5, boots, startSet ; chaque option d'objet vaut
 *    [numéro de l'objet, % de victoire, % de sélection sur toutes les parties, parties, minute d'achat],
 *    et chaque départ ["1056_2003_2003", % de victoire, % de sélection, parties] ;
 *  - l'API interne (a1.lolalytics.com/mega/) ne sert que des morceaux secondaires, pas ces emplacements ;
 *  - noms : l'alias du client en minuscules, sauf MonkeyKing -> "wukong" ; voies : top, jungle, middle, bottom, support ;
 *  - robots.txt n'interdit rien, aucune condition d'utilisation trouvée sur l'accès automatique.
 * Bonne conduite : l'appli se présente honnêtement (User-Agent), n'envoie rien de personnel, et lit au plus une page
 * par champion / voie / mode toutes les 3 heures. Si la page change de format, on revient au build d'OP.GG.
 */

const URL_LOLALYTICS = "https://lolalytics.com";
const DELAI_MAX_MS = 20000;
const DUREE_CACHE_MS = 3 * 60 * 60 * 1000;
const IDENTITE = "LoLCompanion/1.0 (appli de bureau personnelle ; une page par champion toutes les 3 h)";

const EXCEPTIONS_NOMS = { monkeyking: "wukong" };
const VOIES = { top: "top", jungle: "jungle", middle: "middle", bottom: "bottom", utility: "support" };
const PAS_DE_BOTTES = 9999; // option "No Boots" de Lolalytics

class ErreurLolalytics extends Error {}

// --- Fonctions pures (testées) --------------------------------------------------------------

/** Nom du champion dans les adresses de Lolalytics, à partir de l'alias du client ("MonkeyKing" -> "wukong"). */
function nomLolalytics(alias) {
  const nom = String(alias || "").replace(/[^A-Za-z0-9]/g, "").toLowerCase();
  return EXCEPTIONS_NOMS[nom] || nom;
}

/**
 * Adresse de la page du build. mode : "ranked" (et assimilés), "aram" ou "urf".
 * Faille : rangs Émeraude et plus (réglage par défaut de Lolalytics), voie du joueur.
 * ARAM / URF : tous les rangs (le rang compte peu, et Émeraude+ donnait 14 fois moins de parties : 3 460 contre 48 019 pour Hwei).
 */
function adresseBuild({ alias, role, mode }) {
  const nom = nomLolalytics(alias);
  if (!nom) return null;
  const sousMode = mode === "aram" ? "aram/" : mode === "urf" ? "urf/" : "";
  const voie = VOIES[role];
  const parametres = sousMode ? "?tier=all" : voie ? `?lane=${voie}` : "";
  return `${URL_LOLALYTICS}/lol/${nom}/${sousMode}build/${parametres}`;
}

/**
 * Lit l'état Qwik de la page : renvoie l'objet qui contient item1..item5, boots, startSet, avec ses valeurs
 * résolues (les numéros de cases remplacés par les vraies valeurs), ou null si introuvable.
 */
function extraireDonnees(html) {
  if (typeof html !== "string") return null;
  const bloc = /<script type="qwik\/json">([\s\S]*?)<\/script>/.exec(html);
  if (!bloc) return null;
  let objs;
  try {
    objs = JSON.parse(bloc[1]).objs;
  } catch {
    return null;
  }
  if (!Array.isArray(objs)) return null;
  const page = objs.find((o) => o && typeof o === "object" && !Array.isArray(o) && "item1" in o && "boots" in o);
  if (!page) return null;

  const valeur = (ref) => (typeof ref === "string" && /^[0-9a-z]+$/.test(ref) ? objs[parseInt(ref, 36)] : undefined);
  const resoudre = (ref, profondeur = 0) => {
    const v = valeur(ref);
    if (profondeur > 4) return v;
    if (Array.isArray(v)) return v.map((r) => resoudre(r, profondeur + 1));
    return v;
  };
  const donnees = {};
  for (const cle of ["n", "avgWr", "boots", "startSet", "item1", "item2", "item3", "item4", "item5"]) donnees[cle] = resoudre(page[cle]);
  return donnees;
}

const nombre = (n) => (Number.isFinite(n) && n >= 0 ? n : 0);

/**
 * Liste d'options d'un emplacement -> [{ ids, parties, victoires, selection, minute }].
 * selection = part de cet objet parmi les achats de CET emplacement (Lolalytics donne un % de toutes les parties,
 * qui baisse forcément pour les derniers objets : on le ramène à l'emplacement pour comparer les options entre elles).
 */
function optionsEmplacement(liste, { combinaison = false } = {}) {
  if (!Array.isArray(liste)) return [];
  const options = [];
  for (const brut of liste) {
    if (!Array.isArray(brut)) continue;
    const [objet, tauxV, , parties, minute] = brut;
    const ids = (combinaison ? String(objet).split("_") : [objet]).map(Number).filter((id) => Number.isInteger(id) && id > 0 && id !== PAS_DE_BOTTES);
    if (ids.length === 0 || !(nombre(parties) > 0)) continue;
    options.push({
      ids,
      parties: nombre(parties),
      victoires: Math.round((nombre(tauxV) / 100) * nombre(parties)),
      minute: Number.isFinite(minute) && minute > 0 ? minute : null,
    });
  }
  const total = options.reduce((s, o) => s + o.parties, 0);
  return options.map((o) => ({ ...o, selection: total > 0 ? o.parties / total : 0 }));
}

/** Données de la page -> { stats, depart, bottes, emplacements: [objet1..objet5] }, ou null si inutilisables. */
function analyseDepuisDonnees(d, nomObjet = (id) => `Objet ${id}`) {
  if (!d) return null;
  const nommer = (options) => options.map((o) => ({ ...o, noms: o.ids.map(nomObjet) }));
  const emplacements = ["item1", "item2", "item3", "item4", "item5"].map((cle) => nommer(optionsEmplacement(d[cle])));
  if (emplacements[0].length === 0) return null;
  return {
    stats: { parties: nombre(d.n), tauxVictoire: nombre(d.avgWr) / 100 },
    depart: nommer(optionsEmplacement(d.startSet, { combinaison: true })),
    bottes: nommer(optionsEmplacement(d.boots)),
    emplacements,
  };
}

// --- Appel -------------------------------------------------------------------------------------

/** Lecteur Lolalytics avec cache. appeler (fetch) et maintenant sont modifiables pour les tests. */
function creerLecteurLolalytics({ appeler = (...a) => fetch(...a), maintenant = Date.now } = {}) {
  const cache = new Map();

  async function analyser({ alias, role, mode, nomObjet }) {
    const adresse = adresseBuild({ alias, role, mode });
    if (!adresse) throw new ErreurLolalytics("Champion inconnu.");
    const garde = cache.get(adresse);
    if (garde && maintenant() - garde.date < DUREE_CACHE_MS) return garde.analyse;

    let reponse;
    try {
      reponse = await appeler(adresse, { headers: { "User-Agent": IDENTITE, Accept: "text/html" }, signal: AbortSignal.timeout(DELAI_MAX_MS) });
    } catch {
      throw new ErreurLolalytics("Lolalytics ne répond pas (pas d'Internet ?).");
    }
    if (reponse.status === 404) throw new ErreurLolalytics("Lolalytics ne connaît pas ce champion.");
    if (!reponse.ok) throw new ErreurLolalytics(`Lolalytics a répondu une erreur (code ${reponse.status}).`);
    const analyse = analyseDepuisDonnees(extraireDonnees(await reponse.text()), nomObjet);
    if (!analyse) throw new ErreurLolalytics("La page de Lolalytics a changé de format : build d'OP.GG utilisé à la place.");
    cache.set(adresse, { date: maintenant(), analyse });
    return analyse;
  }

  return { analyser };
}

module.exports = {
  URL_LOLALYTICS,
  IDENTITE,
  ErreurLolalytics,
  nomLolalytics,
  adresseBuild,
  extraireDonnees,
  optionsEmplacement,
  analyseDepuisDonnees,
  creerLecteurLolalytics,
};
