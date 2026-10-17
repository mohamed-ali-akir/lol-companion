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
 * Conseiller de draft (draft.js, 04/10/2026) : la même page contient "enemy" (matchups du champion, par voie :
 * [id, % victoire, delta 1, delta 2, % sélection, parties]) ; la tier list (/lol/tierlist/?lane=<voie>) contient un
 * objet { cid, row: { wr, games, ... } } par champion et le patch ; les synergies viennent de l'API
 * a1.lolalytics.com/mega/?ep=build-team (JSON { team: { <voie>: [lignes au même format] } }).
 * Bonne conduite : l'appli se présente honnêtement (User-Agent), n'envoie rien de personnel, et lit au plus une page
 * par champion / voie / mode toutes les 3 heures. Si la page change de format, on revient au build d'OP.GG.
 */

const { IDENTITE, creerCache, telecharger } = require("./internet.js"); // cache 3 h, User-Agent, délai maximal
const { detecterFamilles, ajouterExclus, familleObjet } = require("./familles.js"); // plusieurs sets pour les champions à plusieurs builds

const URL_LOLALYTICS = "https://lolalytics.com";
const URL_API = "https://a1.lolalytics.com"; // synergies (conseiller de draft)

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
function adresseBuild({ alias, role, mode, tier = null }) {
  const nom = nomLolalytics(alias);
  if (!nom) return null;
  const sousMode = mode === "aram" ? "aram/" : mode === "urf" ? "urf/" : "";
  const voie = VOIES[role];
  // tier : filtre de rang de Lolalytics (« 1trick » : les meilleurs joueurs du champion, voir TIERS_RANK1), Faille seulement.
  const filtre = !sousMode && /^[a-z0-9_]+$/.test(String(tier || "")) ? tier : null;
  const morceaux = sousMode ? ["tier=all"] : [voie ? `lane=${voie}` : null, filtre ? `tier=${filtre}` : null].filter(Boolean);
  const parametres = morceaux.length > 0 ? `?${morceaux.join("&")}` : "";
  return `${URL_LOLALYTICS}/lol/${nom}/${sousMode}build/${parametres}`;
}

/**
 * État Qwik d'une page : { objs, resoudre(ref) } ou null. resoudre remplace les numéros de cases (base 36) par les
 * vraies valeurs, dans les tableaux et les objets.
 */
function etatQwik(html) {
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
  const valeur = (ref) => (typeof ref === "string" && /^[0-9a-z]+$/.test(ref) ? objs[parseInt(ref, 36)] : undefined);
  const resoudre = (ref, profondeur = 0) => {
    if (typeof ref !== "string") return ref; // valeur déjà directe (nombre dans un tableau)
    const v = valeur(ref);
    if (profondeur > 5) return v;
    if (Array.isArray(v)) return v.map((r) => resoudre(r, profondeur + 1));
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, r]) => [k, resoudre(r, profondeur + 1)]));
    return v;
  };
  return { objs, resoudre };
}

/**
 * Lit l'état Qwik de la page d'un champion : renvoie l'objet qui contient item1..item5, boots, startSet (et enemy :
 * ses matchups par voie, pour le conseiller de draft), avec ses valeurs résolues, ou null si introuvable.
 */
function extraireDonnees(html) {
  const etat = etatQwik(html);
  if (!etat) return null;
  const page = etat.objs.find((o) => o && typeof o === "object" && !Array.isArray(o) && "item1" in o && "boots" in o);
  if (!page) return null;
  const donnees = {};
  for (const cle of ["n", "avgWr", "boots", "startSet", "item1", "item2", "item3", "item4", "item5", "enemy", "itemSets"]) {
    donnees[cle] = etat.resoudre(page[cle]);
  }
  return donnees;
}

// --- Conseiller de draft : tier list, matchups, synergies (vérifié le 04/10/2026) ---------------------------

/**
 * Page tier list d'une voie (https://lolalytics.com/lol/tierlist/?lane=middle) -> { patch, lignes: Map id -> stats }.
 * Chaque ligne : { cid, row: { wr, games, pr, lane, defaultLane, pctLane, ... } }.
 */
function lignesTierlist(html) {
  const etat = etatQwik(html);
  if (!etat) return null;
  const lignes = new Map();
  for (const o of etat.objs) {
    if (!o || typeof o !== "object" || Array.isArray(o) || !("row" in o) || !("cid" in o)) continue;
    const id = etat.resoudre(o.cid);
    const row = etat.resoudre(o.row);
    if (!Number.isInteger(id) || !row || !Number.isFinite(row.wr) || !Number.isFinite(row.games)) continue;
    lignes.set(id, { tauxVictoire: row.wr / 100, parties: row.games, selection: nombre(row.pr) / 100, voieHabituelle: row.defaultLane || null });
  }
  const nav = etat.objs.find((o) => o && typeof o === "object" && !Array.isArray(o) && "patch" in o && "lane" in o && "page" in o);
  const patch = nav ? etat.resoudre(nav.patch) : null;
  return lignes.size > 0 ? { patch: typeof patch === "string" ? patch : null, lignes } : null;
}

/**
 * Lignes de matchups ou de synergies [id, % victoire, delta 1, delta 2, % sélection, parties] -> Map id -> { delta, parties }.
 * delta = « delta 2 » de Lolalytics : l'effet du duo, corrigé du niveau général des deux champions (en fraction).
 */
function tableDuels(lignes) {
  const table = new Map();
  for (const l of Array.isArray(lignes) ? lignes : []) {
    if (!Array.isArray(l)) continue;
    const [id, , , delta2, , parties] = l;
    if (Number.isInteger(id) && Number.isFinite(delta2) && Number.isFinite(parties) && parties > 0) table.set(id, { delta: delta2 / 100, parties });
  }
  return table;
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

/**
 * Données de la page -> { stats, depart, bottes, emplacements: [objet1..objet5], familles }, ou null si inutilisables.
 * familles : builds séparés du champion (familles.js), [] s'il n'y en a qu'un ; il faut les catégories des objets.
 */
function analyseDepuisDonnees(d, nomObjet = (id) => `Objet ${id}`, { categoriesObjet = () => [], alias = "" } = {}) {
  if (!d) return null;
  // style : AP, À l'impact... (familles.js), pour garder un build cohérent d'un emplacement à l'autre (build.js)
  const style = (ids) => (ids.length === 1 ? familleObjet(categoriesObjet(ids[0])) : null);
  const nommer = (options) => options.map((o) => ({ ...o, noms: o.ids.map(nomObjet), style: style(o.ids) }));
  const emplacements = ["item1", "item2", "item3", "item4", "item5"].map((cle) => nommer(optionsEmplacement(d[cle])));
  if (emplacements[0].length === 0) return null;
  return {
    stats: { parties: nombre(d.n), tauxVictoire: nombre(d.avgWr) / 100 },
    depart: nommer(optionsEmplacement(d.startSet, { combinaison: true })),
    bottes: nommer(optionsEmplacement(d.boots)),
    emplacements,
    familles: ajouterExclus({
      familles: detecterFamilles({ itemSets: d.itemSets, categoriesObjet, alias }),
      ids: emplacements.flat().flatMap((o) => o.ids), // objets du build général, pour le reste de chaque set
      categoriesObjet,
      alias,
    }).map((f) => ({ ...f, emplacements: f.emplacements.map(nommer) })),
  };
}

// --- Appel -------------------------------------------------------------------------------------

/** Lecteur Lolalytics avec cache. appeler (fetch) et maintenant sont modifiables pour les tests. */
function creerLecteurLolalytics({ appeler = (...a) => fetch(...a), maintenant = Date.now } = {}) {
  const cache = creerCache({ maintenant }); // adresse -> données lues, gardées 3 h (internet.js)

  /** Lit une adresse au plus une fois toutes les 3 h, et la transforme avec lire(texte). Un échec n'est pas gardé. */
  function avecCache(adresse, accept, lire) {
    return cache.avecCache(adresse, async () => {
      const texte = await telecharger({
        appeler,
        adresse,
        options: { headers: { Accept: accept } },
        site: "Lolalytics",
        Erreur: ErreurLolalytics,
        introuvable: "Lolalytics ne connaît pas ce champion.",
      });
      return lire(texte);
    });
  }

  /** Données brutes de la page d'un champion (objets + matchups). */
  function donneesChampion({ alias, role, mode, tier }) {
    const adresse = adresseBuild({ alias, role, mode, tier });
    if (!adresse) return Promise.reject(new ErreurLolalytics("Champion inconnu."));
    return avecCache(adresse, "text/html", (html) => {
      const donnees = extraireDonnees(html);
      if (!donnees) throw new ErreurLolalytics("La page de Lolalytics a changé de format.");
      return donnees;
    });
  }

  async function analyser({ alias, role, mode, tier = null, nomObjet, categoriesObjet }) {
    let donnees;
    try {
      donnees = await donneesChampion({ alias, role, mode, tier });
    } catch (erreur) {
      if (/format/.test(erreur.message)) throw new ErreurLolalytics("La page de Lolalytics a changé de format : build d'OP.GG utilisé à la place.");
      throw erreur;
    }
    const analyse = analyseDepuisDonnees(donnees, nomObjet, { categoriesObjet, alias });
    if (!analyse) throw new ErreurLolalytics("La page de Lolalytics a changé de format : build d'OP.GG utilisé à la place.");
    return analyse;
  }

  /** Tier list d'une voie (rôle du client : top, jungle, middle, bottom, utility) -> { patch, lignes }. */
  function tierlist(role) {
    const voie = VOIES[role];
    if (!voie) return Promise.reject(new ErreurLolalytics("Rôle inconnu."));
    return avecCache(`${URL_LOLALYTICS}/lol/tierlist/?lane=${voie}`, "text/html", (html) => {
      const tl = lignesTierlist(html);
      if (!tl) throw new ErreurLolalytics("La tier list de Lolalytics a changé de format.");
      return tl;
    });
  }

  /**
   * Matchups d'un champion adverse (sur sa voie habituelle) contre les champions de la voie `role`.
   * Map id -> { delta, parties } du point de vue de CET adversaire.
   */
  async function matchups({ alias, role }) {
    const voie = VOIES[role];
    const donnees = await donneesChampion({ alias, role: null, mode: "ranked" });
    const enemy = donnees.enemy;
    if (!enemy || typeof enemy !== "object" || !Array.isArray(enemy[voie])) throw new ErreurLolalytics("Matchups introuvables sur Lolalytics.");
    return tableDuels(enemy[voie]);
  }

  /** Synergies d'un allié (sur son rôle roleAllie) avec les champions de la voie `role` : Map id -> { delta, parties }. */
  function synergies({ alias, roleAllie, role, patch }) {
    const nom = nomLolalytics(alias);
    const voieAllie = VOIES[roleAllie];
    const voie = VOIES[role];
    if (!nom || !voieAllie || !voie || !/^\d+\.\d+$/.test(String(patch || ""))) return Promise.reject(new ErreurLolalytics("Synergie impossible à demander."));
    const adresse = `${URL_API}/mega/?ep=build-team&v=1&patch=${patch}&c=${nom}&lane=${voieAllie}&tier=emerald_plus&queue=ranked&region=all`;
    return avecCache(adresse, "application/json", (texte) => {
      let json;
      try {
        json = JSON.parse(texte);
      } catch {
        throw new ErreurLolalytics("Les synergies de Lolalytics ont changé de format.");
      }
      return json && json.team && typeof json.team === "object" ? json.team : {};
    }).then((equipe) => tableDuels(equipe[voie]));
  }

  return { analyser, tierlist, matchups, synergies };
}

module.exports = {
  URL_LOLALYTICS,
  IDENTITE,
  ErreurLolalytics,
  nomLolalytics,
  adresseBuild,
  extraireDonnees,
  lignesTierlist,
  tableDuels,
  optionsEmplacement,
  analyseDepuisDonnees,
  creerLecteurLolalytics,
};
