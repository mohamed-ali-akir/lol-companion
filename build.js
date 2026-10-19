/*
 * Build automatique : objets et runes d'après les vraies statistiques (onglet "Build")
 * ------------------------------------------------------------------------------------
 * Tourne dans le processus principal (Node).
 *
 * Quand ton champion est verrouillé (ou attribué en ARAM), l'appli :
 * (En Arena, depuis le 19/10/2026 : objets de la page Arena de Lolalytics, avec l'objet prismatique ; pas d'OP.GG.)
 *  1. lit en parallèle les statistiques de Lolalytics (lolalytics.js : objets emplacement par emplacement)
 *     et d'OP.GG (opgg.js : runes, sorts, et objets en secours) pour ce champion, ton rôle et le mode ;
 *  2. compose le build : avec Lolalytics, Départ, Objet 1, Bottes, Objet 2 à 5, chacun avec 3 choix
 *     (composerParEmplacement) ; sinon, avec OP.GG, départ, objets principaux, bottes, 4e, 5e et 6e objet ;
 *  3. crée la page de runes "LoL Companion" (runes d'OP.GG, ou celles recommandées par Riot si OP.GG ne répond pas) ;
 *  4. crée le set d'objets "LoL Companion - Champion (Rôle)", visible dans la boutique en jeu. Pour un champion qui se
 *     joue de plusieurs façons (Vi combattant ou létalité, Kayn rouge ou bleu...), un set par façon de jouer
 *     (familles.js) : ses 3 premiers objets lui sont propres, le reste vient du build général.
 * Chaque étape a sa case dans l'onglet Build, toutes désactivées par défaut. Autorisé par Riot
 * (comme Blitz, Porofessor ou u.gg) : ce sont des infos publiques, et rien n'est choisi à ta place en jeu.
 *
 * Classement "taux de victoire + taux de sélection" (pour le 4e, 5e et 6e objet, où OP.GG propose 3 options ;
 * pour les objets 1 à 3, OP.GG ne donne qu'une combinaison, vérifié le 02/10/2026) :
 *  - une option n'est retenue que si elle est FIABLE : prise dans au moins 10 % des parties ET sur 200 parties ;
 *  - on classe par taux de victoire PRUDENT (borne basse de Wilson, à 95 %) : on retire une marge
 *    d'autant plus grande qu'il y a peu de parties. Un objet à 59 % sur 9 000 parties passe devant un objet
 *    à 60 % sur 24 parties ;
 *  - si aucune option d'un emplacement n'est fiable (souvent le 6e), on prend le meilleur objet fiable restant
 *    parmi les options des emplacements précédents ;
 *  - on ne propose jamais un objet déjà dans le build ; 3 choix par emplacement sont affichés pour s'adapter.
 *
 * Sets d'objets (vérifié sur le client le 02/10/2026) :
 *   GET/PUT /lol-item-sets/v1/item-sets/{summonerId}/sets -> { accountId, itemSets: [...], timestamp }
 *   Le PUT remplace TOUTE la liste : on renvoie tes sets (Porofessor...) exactement comme on les a lus,
 *   et on remplace tous les anciens sets "LoL Companion" par ceux du champion actuel.
 */
const { lireLockfile, lireJson, lireJsonOuNull, appelerClient, ErreurClient } = require("./lcu.js");
const { monChampion, pageDepuisRecommandation, nomsPage } = require("./runes.js");
const PREFIXE_UID_RANK1 = "1c0a9a10-0000-4000-9000-"; // identifiant du set « Champion Rank 1 » (les autres sets : ...-8000-)

const PREFIXE_SET = "LoL Companion";
const PREFIXE_UID_APPLI = "1c0a9a10-0000-4000-"; // identifiants des sets de l'appli (uidSet : ...-8000-, set Rank 1 : ...-9000-)
// Une option est FIABLE si elle est prise dans au moins 10 % des parties ET sur au moins 200 parties.
// (Avec 5 % seulement, le 6e objet de Hwei était une Ceinture-roquette sur... 4 parties.)
const SELECTION_MIN = 0.1;
const PARTIES_MIN = 200;
const Z_95 = 1.96;

const LIBELLES_ROLES = { top: "Haut", jungle: "Jungle", middle: "Milieu", bottom: "Bas", utility: "Support" };

// Sorts d'invocateur (OP.GG ne donne que leurs numéros).
const SORTS = {
  1: "Purge", 3: "Fatigue", 4: "Saut éclair", 6: "Fantôme", 7: "Soins", 11: "Châtiment",
  12: "Téléportation", 13: "Clarté", 14: "Embrasement", 21: "Barrière", 32: "Marque",
};

/**
 * Réglages lisibles, désactivés par défaut, sauf le set d'objets et les augments (toujours actifs, décision du
 * 17/10/2026 ; le set d'objets ne se fait que si « Récupérer le build » est coché). ancienRunes : ancien réglage
 * "runesAuto" (migration).
 */
function normaliserReglagesBuild(brut, ancienRunes) {
  const r = brut && typeof brut === "object" ? brut : {};
  const runesAvant = Boolean(ancienRunes && ancienRunes.actif === true);
  return {
    stats: r.stats === true,
    runes: brut && typeof brut === "object" ? r.runes === true : runesAvant,
    objets: true, // set d'objets : toujours, dès que le build est récupéré (décision du 17/10/2026, plus de case)
    rank1: r.rank1 === true, // + set « Champion Rank 1 » : build des meilleurs joueurs (Lolalytics, stats-build.js)
    augments: true, // stats des augments ARAM Mayhem en jeu (augments.js) : toujours (décision du 17/10/2026, plus de case)
    sorts: r.sorts === true, // chronos des sorts d'invocateur adverses, cliquables en jeu (sorts.js)
    sortsPings: r.sorts === true, // + lancés par les pings lus dans le chat (pings.js) : même case depuis le 17/10/2026
    sortsAuto: r.sortsAuto === true, // choisir mes sorts d'invocateur (les plus joués d'après OP.GG ; nécessite les stats)
  };
}

/**
 * Ordre des sorts d'invocateur à mettre : on garde chaque sort recommandé sur la touche où tu l'as déjà
 * (Flash reste sur D ou sur F comme tu en as l'habitude), puis on complète avec les autres dans l'ordre d'OP.GG.
 * recommandes : [id, id] d'OP.GG ; actuels : [spell1Id, spell2Id] de ta sélection. -> [id, id] ou null.
 */
function ordreSorts(recommandes, actuels) {
  const reco = (Array.isArray(recommandes) ? recommandes : []).filter((id) => Number.isInteger(id) && id > 0);
  if (reco.length !== 2 || reco[0] === reco[1]) return null;
  const places = [null, null];
  (Array.isArray(actuels) ? actuels : []).slice(0, 2).forEach((id, i) => {
    if (reco.includes(id) && !places.includes(id)) places[i] = id;
  });
  const restants = reco.filter((id) => !places.includes(id));
  return places.map((id) => id || restants.shift());
}

// --- Classement et composition (fonctions pures, testées) ----------------------------------

/** Taux de victoire prudent : borne basse de l'intervalle de Wilson à 95 %. 0 sans parties. */
function scorePrudent(victoires, parties) {
  if (!(parties > 0)) return 0;
  const p = Math.min(1, Math.max(0, victoires / parties));
  const z2 = Z_95 * Z_95;
  const centre = p + z2 / (2 * parties);
  const marge = Z_95 * Math.sqrt((p * (1 - p)) / parties + z2 / (4 * parties * parties));
  return (centre - marge) / (1 + z2 / parties);
}

const tauxVictoire = (o) => (o && o.parties > 0 ? o.victoires / o.parties : 0);

/** Option assez jouée pour qu'on s'y fie (voir SELECTION_MIN et PARTIES_MIN). */
const estFiable = (o) => Boolean(o) && o.selection >= SELECTION_MIN && o.parties >= PARTIES_MIN;

/**
 * Options classées, de la meilleure à la moins bonne, sans celles déjà dans le build.
 * Les options fiables d'abord (par score prudent), puis les autres (gardées seulement s'il n'y a rien d'autre).
 */
function classerOptions(options, dejaPris = new Set()) {
  const nouvelles = (Array.isArray(options) ? options : []).filter((o) => o && o.ids.some((id) => !dejaPris.has(id)));
  const parScore = (a, b) => scorePrudent(b.victoires, b.parties) - scorePrudent(a.victoires, a.parties);
  return [...nouvelles.filter(estFiable).sort(parScore), ...nouvelles.filter((o) => !estFiable(o)).sort(parScore)];
}

/** Une seule option par objet (la mieux notée), pour la réserve des emplacements précédents. */
function sansDoublons(options) {
  const parObjet = new Map();
  for (const o of options) {
    const cle = o.ids.join("+");
    const avant = parObjet.get(cle);
    if (!avant || scorePrudent(o.victoires, o.parties) > scorePrudent(avant.victoires, avant.parties)) parObjet.set(cle, o);
  }
  return [...parObjet.values()];
}

const NB_CHOIX = 3; // choix affichés par emplacement (le retenu + 2 autres) pour s'adapter en partie

/**
 * Le build complet : [{ cle, titre, option, autres, fiable, note }] dans l'ordre d'achat.
 *  - autres : les 2 autres meilleurs choix pour cet emplacement (pour s'adapter en partie) ;
 *  - si aucune option d'un emplacement n'est fiable (souvent le 6e objet), on prend le meilleur objet fiable qui
 *    reste parmi les options des emplacements précédents (note l'explique) ;
 *  - fiable : false si même ça n'a rien donné (l'appli affiche « peu de données »).
 */
function composerBuild(analyse) {
  if (!analyse) return [];
  const etapes = [];
  const pris = new Set();
  const ajouter = (cle, titre, option, autres = [], note = null) => {
    if (!option) return;
    option.ids.forEach((id) => pris.add(id));
    etapes.push({ cle, titre, option, autres, fiable: estFiable(option), note });
  };
  ajouter("depart", "Départ", analyse.depart);
  ajouter("principaux", "Objets principaux", analyse.principaux);
  ajouter("bottes", "Bottes", analyse.bottes);
  const precedentes = []; // options des emplacements déjà traités (réserve)
  for (const [cle, titre] of [["quatrieme", "4e objet"], ["cinquieme", "5e objet"], ["sixieme", "6e objet"]]) {
    const classees = classerOptions(analyse[cle], pris);
    let choix = classees;
    let note = null;
    if (classees.length > 0 && !estFiable(classees[0])) {
      const reserve = classerOptions(sansDoublons(precedentes), pris).filter(estFiable);
      if (reserve.length > 0) {
        choix = [...reserve, ...classees];
        note = `Pas assez de parties pour le ${titre} : meilleur objet fiable restant des emplacements précédents.`;
      }
    }
    if (choix.length > 0) ajouter(cle, titre, choix[0], choix.slice(1, NB_CHOIX), note);
    precedentes.push(...(Array.isArray(analyse[cle]) ? analyse[cle] : []));
  }
  return etapes;
}

const SELECTION_PROPOSABLE = 0.02; // en dessous de 2 % des achats d'un emplacement, une option passe en dernier

/**
 * Les 3 meilleurs choix d'un emplacement (Lolalytics), sans les objets déjà retenus avant (exclus).
 * Le 1er, le choix RECOMMANDÉ, est l'option fiable (≥ 10 % des achats et ≥ 200 parties) la PLUS ACHETÉE, comme le
 * build affiché par Lolalytics. Avant le 17/10/2026, c'était la meilleure au taux de victoire prudent : un objet un peu moins acheté
 * mais avec 1 point de victoire en plus passait devant, et le build changeait de style d'un emplacement à l'autre
 * (Kayle en ARAM : Dent de Nashor, puis Terminus et Tueur de krakens, alors que les joueurs font Lame du roi déchu,
 * Guinsoo, Fin de l'esprit). Le plus acheté suit le chemin de la majorité des joueurs, donc reste cohérent ; une
 * préférence de « style » a été essayée puis retirée (elle écartait l'Ouragan de Runaan, 1er achat de Kalista, parce
 * qu'il est classé « critique »). Sans option fiable, on garde l'ancien ordre.
 * Les 2 autres, pour s'adapter : d'abord les options fiables, puis celles jouées sur au moins 200 parties et 2 % des
 * achats, puis le reste ; chaque groupe classé par taux de victoire prudent.
 */
function troisChoix(options, exclus = new Set()) {
  const candidates = (Array.isArray(options) ? options : []).filter((o) => o && o.ids.some((id) => !exclus.has(id)));
  const parScore = (a, b) => scorePrudent(b.victoires, b.parties) - scorePrudent(a.victoires, a.parties);
  const parAchats = (a, b) => b.parties - a.parties;
  const proposable = (o) => o.parties >= PARTIES_MIN && o.selection >= SELECTION_PROPOSABLE;
  const fiables = candidates.filter(estFiable);
  const recommande = [...fiables].sort(parAchats)[0] || null;
  const autres = (liste) => liste.filter((o) => o !== recommande).sort(parScore);
  const proposables = candidates.filter((o) => !estFiable(o) && proposable(o));
  const reste = candidates.filter((o) => !estFiable(o) && !proposable(o));
  const ordre = [...autres(fiables), ...autres(proposables), ...autres(reste)];
  return (recommande ? [recommande, ...ordre] : ordre).slice(0, NB_CHOIX);
}

/**
 * Build emplacement par emplacement (données de Lolalytics) : Départ, Objet 1, Bottes, Objet 2 à 5,
 * chacun avec son choix recommandé et 2 autres choix. En Arena (analyse.prismatique, lolalytics.js) : Départ (les
 * bottes), Objet prismatique, Objets 1 à 5. Un objet recommandé à un emplacement n'est plus proposé ensuite.
 */
function composerParEmplacement(analyse) {
  if (!analyse || !Array.isArray(analyse.emplacements)) return [];
  const etapes = [];
  const pris = new Set();
  // candidats : toutes les options de l'emplacement, du plus au moins acheté (pour compléter le set d'une famille).
  const ajouter = (cle, titre, choix, toutes, { retenir = true } = {}) => {
    if (choix.length === 0) return;
    const [option, ...autres] = choix;
    if (retenir) option.ids.forEach((id) => pris.add(id));
    // « Fiable » = assez de parties. (Aux derniers emplacements, les achats sont si variés qu'aucun objet n'atteint
    // 10 % : ce n'est pas un manque de données, donc pas d'avertissement pour ça.)
    const candidats = (Array.isArray(toutes) ? toutes : []).filter(Boolean).sort((a, b) => b.parties - a.parties);
    etapes.push({ cle, titre, option, autres, fiable: option.parties >= PARTIES_MIN, note: null, candidats });
  };
  ajouter("depart", "Départ", troisChoix(analyse.depart), analyse.depart, { retenir: false });
  if (Array.isArray(analyse.prismatique)) ajouter("prismatique", "Objet prismatique", troisChoix(analyse.prismatique, pris), analyse.prismatique);
  analyse.emplacements.forEach((options, i) => {
    ajouter(`objet${i + 1}`, `Objet ${i + 1}`, troisChoix(options, pris), options);
    if (i === 0) ajouter("bottes", "Bottes", troisChoix(analyse.bottes, pris), analyse.bottes); // achetées en général après le 1er objet
  });
  return etapes;
}

/** Page de runes "LoL Companion" à partir des runes d'OP.GG, ou null si elles sont incomplètes. */
function pageDepuisOpgg(runes) {
  if (!runes) return null;
  const ids = [...runes.runesPrincipales, ...runes.runesSecondaires, ...runes.fragments];
  if (ids.length !== 9 || !Number.isInteger(runes.stylePrincipal) || !Number.isInteger(runes.styleSecondaire)) return null;
  return { name: PREFIXE_SET, primaryStyleId: runes.stylePrincipal, subStyleId: runes.styleSecondaire, selectedPerkIds: ids, current: true };
}

const pourcent = (x) => `${Math.round(x * 100)} %`;
const nomsOption = (o) => (Array.isArray(o.noms) ? o.noms.join(" + ") : o.ids.join(" + "));

/**
 * Identifiant stable du set d'un champion et d'un rôle (même forme que ceux de Porofessor).
 * indice : numéro de la famille de build (0 = le premier set, identifiant inchangé).
 */
function uidSet(championId, role, indice = 0) {
  const n = indice * 1e8 + championId * 10 + Math.max(0, Object.keys(LIBELLES_ROLES).indexOf(role) + 1);
  return `1c0a9a10-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

/**
 * Set d'objets pour la boutique en jeu (format du client).
 * troisParBloc : chaque emplacement montre ses 3 choix (le recommandé d'abord) — build de Lolalytics ;
 * sinon (build d'OP.GG), un objet par emplacement et un bloc « Pour t'adapter » avec les autres choix.
 * famille, indice : nom et numéro de la famille de build (plusieurs sets pour un champion), sinon null et 0.
 * recommande : ajoute « · Recommandé » à la fin du titre (le set principal, sélectionné d'office dans la boutique).
 */
function setObjets({ etapes, championId, nomChampion, role, carte = 11, troisParBloc = false, famille = null, indice = 0, recommande = false }) {
  const blocs = etapes.map(({ cle, titre, option, autres }) => {
    const compte = new Map();
    for (const id of option.ids) compte.set(id, (compte.get(id) || 0) + 1); // ex. 2 potions
    // Les autres choix d'un objet ou des bottes (pas du départ, où chaque choix est une combinaison).
    if (troisParBloc && cle !== "depart") for (const o of autres) for (const id of o.ids) if (!compte.has(id)) compte.set(id, 1);
    return {
      // Objets d'une famille : pas de taux de victoire connu (voir familles.js), seulement la part des achats.
      type: Number.isFinite(option.victoires)
        ? `${titre} · ${pourcent(tauxVictoire(option))} V · ${pourcent(option.selection)} choix`
        : `${titre} · ${pourcent(option.selection)} choix`,
      items: [...compte].map(([id, count]) => ({ id: String(id), count })),
      hideIfSummonerSpell: "",
      showIfSummonerSpell: "",
    };
  });
  // Les autres choix des emplacements 4 à 6, dans un bloc à part : pour s'adapter en pleine partie.
  const dejaDansLeBuild = new Set(etapes.flatMap((e) => e.option.ids));
  const autres = [...new Set(etapes.flatMap((e) => e.autres.flatMap((o) => o.ids)))].filter((id) => !dejaDansLeBuild.has(id));
  if (!troisParBloc && autres.length > 0) {
    blocs.push({
      type: "Pour t'adapter (autres choix)",
      items: autres.map((id) => ({ id: String(id), count: 1 })),
      hideIfSummonerSpell: "",
      showIfSummonerSpell: "",
    });
  }
  return {
    title: `${PREFIXE_SET} - ${nomChampion}${role ? ` (${LIBELLES_ROLES[role] || role})` : ""}${famille ? ` · ${famille}` : ""}${recommande ? " · Recommandé" : ""}`,
    type: "custom",
    map: "any",
    mode: "any",
    associatedChampions: [championId],
    associatedMaps: [carte],
    blocks: blocs,
    preferredItemSlots: [],
    sortrank: 0,
    startedFrom: "blank",
    uid: uidSet(championId, role, indice),
  };
}

/**
 * Tes sets inchangés (Porofessor, les tiens...) + les nouveaux sets. TOUS les anciens sets "LoL Companion" sont retirés :
 * on ne garde que ceux du champion actuel (1 à 3, recréés à chaque champion verrouillé).
 * Pourquoi (14/10/2026) : le client reçoit tous les sets d'un coup et refuse au-delà d'environ 64 Ko (code 413) ;
 * avec un set par champion joué, 40 sets "LoL Companion" s'étaient accumulés et bloquaient tout nouveau set.
 * Le PREMIER des nouveaux sets (la famille la plus jouée) doit être sélectionné d'office dans la boutique.
 * Vu en jeu le 17/10/2026 (capture) : avec Tank 10188 / AP 10187 / Rank 1 10186, dans cet ordre, la boutique a pris
 * « Rank 1 », c'est-à-dire le plus PETIT sortrank, qui était aussi le DERNIER de la liste (l'idée inverse, « le plus
 * grand d'abord », était fausse). On satisfait donc les deux : nos sets vont en fin de liste, dans l'ordre inverse
 * (le premier tout à la fin), avec les sortrank les plus petits (0 pour le premier, 1, 2... pour les suivants).
 */
function fusionnerSets(existants, nouveaux) {
  // Les nôtres : titre « LoL Companion - ... », ou identifiant de l'appli (le set « Ahri Rank 1 » n'a pas le préfixe).
  const estLeNotre = (s) =>
    Boolean(s) && ((typeof s.title === "string" && s.title.startsWith(`${PREFIXE_SET} - `)) || (typeof s.uid === "string" && s.uid.startsWith(PREFIXE_UID_APPLI)));
  const autres = Array.isArray(existants) ? existants.filter((s) => !estLeNotre(s)) : [];
  const ajouts = Array.isArray(nouveaux) ? nouveaux : [nouveaux]; // un set, ou un par famille de build
  const derriere = ajouts.map((s, i) => ({ ...s, sortrank: i })).reverse(); // le premier : sortrank 0, tout à la fin
  return [...autres, ...derriere];
}

/**
 * Étapes du set d'une famille de build (familles.js) : les Objets 1 à 3 prennent les choix propres à la famille,
 * tout le reste (départ, bottes, objets 4 et 5, et un emplacement où la famille n'a rien d'assez joué) vient du
 * build général, sans les objets d'une autre famille du champion (famille.exclus, de familles.js).
 * Pour ce reste, on cherche dans TOUTES les options de l'emplacement (candidats), du plus au moins acheté, en
 * préférant celles du style de la famille : avant le 17/10/2026, seuls les 3 choix du build général étaient
 * regardés, et l'objet 3 disparaissait souvent (Lolalytics ne donne que les 3 premiers achats, bottes comprises).
 * Un objet déjà retenu plus tôt dans le set n'est jamais reproposé.
 */
function etapesFamille(etapes, famille) {
  const pris = new Set();
  const exclus = new Set(Array.isArray(famille.exclus) ? famille.exclus : []);
  const resultat = [];
  for (const e of etapes) {
    const numero = /^objet([123])$/.exec(e.cle);
    const propres = numero ? famille.emplacements[Number(numero[1]) - 1] || [] : [];
    const general = [e.option, ...e.autres];
    let choix = propres;
    if (propres.length === 0) {
      const reserve = Array.isArray(e.candidats) && e.candidats.length > 0 ? e.candidats : general;
      const assezJoues = reserve.filter((o) => o.parties >= PARTIES_MIN);
      const triees = [...assezJoues.filter((o) => o.style === famille.nom), ...assezJoues.filter((o) => o.style !== famille.nom)];
      choix = e.cle === "depart" || e.cle === "bottes" ? general : triees.length > 0 ? triees : general;
    }
    if (e.cle !== "depart") choix = choix.filter((o) => o.ids.some((id) => !pris.has(id)) && !o.ids.some((id) => exclus.has(id)));
    if (choix.length === 0) continue;
    const [option, ...autres] = choix;
    if (e.cle !== "depart") option.ids.forEach((id) => pris.add(id));
    resultat.push({ ...e, option, autres: autres.slice(0, NB_CHOIX - 1), fiable: propres.length > 0 ? true : e.fiable });
  }
  return resultat;
}

/**
 * Set « Champion Rank 1 » au format du build classique : mêmes blocs (3 choix par emplacement, taux de victoire et
 * part des achats), avec son propre titre et son propre identifiant (PREFIXE_UID_RANK1 : reconnu et remplacé
 * à chaque fois, jamais en double).
 */
function setRank1Classique({ etapes, championId, nomChampion, role, carte = 11 }) {
  const set = setObjets({ etapes, championId, nomChampion, role, carte, troisParBloc: true });
  return { ...set, title: `${nomChampion} Rank 1`, uid: `${PREFIXE_UID_RANK1}${String(championId).padStart(12, "0")}` };
}

/**
 * Les sets à créer pour ce champion : un par famille de build s'il y en a au moins 2 (build de Lolalytics),
 * sinon un seul set, comme avant. Mêmes paramètres que setObjets, plus familles (de lolalytics.js).
 */
function setsObjets({ etapes, familles = [], ...reste }) {
  // Le meilleur set (le build général, ou la famille la plus jouée) porte « · Recommandé » à la fin (17/10/2026).
  if (!reste.troisParBloc || !Array.isArray(familles) || familles.length < 2) return [setObjets({ etapes, ...reste, recommande: true })];
  return familles.map((f, indice) => setObjets({ etapes: etapesFamille(etapes, f), ...reste, famille: f.nom, indice, recommande: indice === 0 }));
}

/**
 * Ce que la page affiche : étapes avec taux, runes, sorts.
 * analyse : celle d'OP.GG (runes, sorts) ou null ; stats : statistiques générales à afficher ; source : d'où viennent les objets.
 */
function resumeBuild({ analyse, etapes, stats = analyse ? analyse.stats : null, source = "OP.GG", familles = [] }) {
  const option = (o) => ({ noms: o.noms, parties: o.parties, tauxVictoire: tauxVictoire(o), selection: o.selection, minute: o.minute || null });
  const r = analyse && analyse.runes;
  return {
    source,
    stats,
    etapes: etapes.map((e) => ({ titre: e.titre, ...option(e.option), fiable: e.fiable, note: e.note, autres: e.autres.map(option) })),
    runes: r ? { styles: [r.nomStylePrincipal, r.nomStyleSecondaire].filter(Boolean), noms: r.noms, parties: r.parties, tauxVictoire: tauxVictoire(r) } : null,
    sorts: analyse && analyse.sorts ? { noms: analyse.sorts.ids.map((id) => SORTS[id] || `Sort n° ${id}`), tauxVictoire: tauxVictoire(analyse.sorts) } : null,
    // Familles de build (un set chacune) : nom, part des builds, et noms des choix des Objets 1 à 3.
    familles: (Array.isArray(familles) ? familles : []).map((f) => ({
      nom: f.nom,
      part: f.part,
      objets: f.emplacements.map((choix) => choix.map((o) => nomsOption(o)).join(" / ")),
    })),
  };
}

/**
 * Le build à appliquer et à afficher : objets de Lolalytics (3 choix par emplacement) si disponibles,
 * sinon ceux d'OP.GG ; runes et sorts d'OP.GG. Renvoie { etapes, troisParBloc, resume } (resume null si rien).
 */
function assemblerBuild({ opgg = null, emplacements = null }) {
  let etapes = emplacements ? composerParEmplacement(emplacements) : [];
  const parEmplacement = etapes.length > 0;
  if (!parEmplacement) etapes = composerBuild(opgg);
  if (etapes.length === 0) return { etapes, troisParBloc: false, resume: null };
  const resume = resumeBuild({
    analyse: opgg,
    etapes,
    stats: parEmplacement ? emplacements.stats : opgg.stats,
    source: parEmplacement ? "Lolalytics" : "OP.GG",
    familles: parEmplacement ? emplacements.familles : [],
  });
  return { etapes, troisParBloc: parEmplacement, resume };
}

// --- Logique automatique (testée sans client ni Internet) ------------------------------------

/**
 *  - reglages()                             : { stats, runes, objets } ;
 *  - analyser({ championId, role })         : analyse OP.GG (promesse) ; rejetée si indisponible ;
 *  - analyserEmplacements({ championId, role }) : (facultatif) objets par emplacement de Lolalytics (promesse) ;
 *                                             s'il échoue, les objets viennent d'OP.GG ;
 *  - runesRiot({ championId, role })        : pages recommandées par Riot (promesse, secours) ;
 *  - appliquerRunes(page, noms), appliquerObjets(set) : écrivent dans le client (promesses) ;
 *  - appliquerSorts([id, id])               : (facultatif) choisit tes sorts d'invocateur (promesse) ;
 *  - analyserRank1({ championId, role })    : (facultatif) set « Rank 1 » : { emplacements, libelle, parties }
 *                                             (Lolalytics, meilleurs joueurs du champion) ; seulement si la case est cochée ;
 *  - nomChampion(championId)                : nom affiché (promesse) ;
 *  - carte()                                : carte de la partie (promesse, 11 ou 12) ;
 *  - resultat(info)                         : { championId, role, build, runes, objets, erreurs } ;
 *  - journal(...)                           : (facultatif) diagnostic.
 * Une seule fois par champion et par sélection (en ARAM, une relance de champion refait tout).
 */
function creerBuildAuto({
  reglages,
  analyser,
  analyserEmplacements = null,
  runesRiot,
  appliquerRunes,
  appliquerObjets,
  appliquerSorts = null,
  analyserRank1 = null,
  nomChampion,
  carte,
  resultat = () => {},
  journal = () => {},
}) {
  let deja = null;
  let enCours = false;

  async function surSession(session) {
    if (!session) {
      deja = null;
      return;
    }
    const champion = monChampion(session);
    if (!champion) return;
    const r = reglages();
    if (!r.stats && !r.runes) return; // rien à faire (le set d'objets a besoin des stats)
    const cle = `${session.gameId}:${champion.championId}`;
    if (cle === deja || enCours) return;
    deja = cle;
    enCours = true;
    // Tes sorts actuels : pour garder Flash sur la même touche.
    const moi = (Array.isArray(session.myTeam) ? session.myTeam : []).find((j) => j && j.cellId === session.localPlayerCellId);
    const sortsActuels = moi ? [moi.spell1Id, moi.spell2Id] : [];
    try {
      await traiter({ ...champion, sortsActuels }, r);
    } finally {
      enCours = false;
    }
  }

  async function traiter({ championId, role, sortsActuels = [] }, r) {
    const erreurs = {};
    let analyse = null; // OP.GG : runes, sorts, et objets en secours
    let emplacements = null; // Lolalytics : objets emplacement par emplacement
    let rank1 = null; // set « Rank 1 » : build des meilleurs joueurs du champion (Lolalytics)
    if (r.stats) {
      const [opgg, lolalytics, meilleur] = await Promise.allSettled([
        analyser({ championId, role }),
        analyserEmplacements ? analyserEmplacements({ championId, role }) : Promise.resolve(null),
        r.objets && r.rank1 && analyserRank1 ? analyserRank1({ championId, role }) : Promise.resolve(null),
      ]);
      if (meilleur.status === "fulfilled") rank1 = meilleur.value;
      else erreurs.rank1 = meilleur.reason.message;
      if (opgg.status === "fulfilled") analyse = opgg.value;
      else erreurs.stats = opgg.reason.message;
      if (lolalytics.status === "fulfilled") emplacements = lolalytics.value;
      else erreurs.emplacements = lolalytics.reason.message;
    }
    const { etapes, troisParBloc, resume } = assemblerBuild({ opgg: analyse, emplacements });

    let runes = null;
    if (r.runes) {
      try {
        let page = analyse ? pageDepuisOpgg(analyse.runes) : null;
        let source = "OP.GG";
        if (!page) {
          const pages = await runesRiot({ championId, role });
          const reco = Array.isArray(pages) ? pages.find((p) => pageDepuisRecommandation(p)) : null;
          page = reco ? pageDepuisRecommandation(reco) : null;
          source = "Riot";
          if (page) runes = { source, noms: (reco.perks || []).slice(0, 6).map((p) => (p && p.name) || "?") };
        } else {
          runes = { source, noms: analyse.runes.noms };
        }
        if (!page) throw new ErreurClient("Pas de runes disponibles pour ce champion.");
        const nom = await appliquerRunes(page, nomsPage(await nomChampion(championId), role));
        if (typeof nom === "string") runes.nomPage = nom;
      } catch (erreur) {
        runes = null;
        erreurs.runes = erreur.message;
      }
    }

    let objets = false;
    let setsCrees = []; // titres des sets créés (plusieurs pour un champion à plusieurs builds)
    let infoRank1 = null; // { titre, rang, parties } du set « Rank 1 » créé
    if (r.objets && (etapes.length > 0 || rank1)) {
      try {
        const nom = await nomChampion(championId);
        const carteJeu = await carte();
        const sets = etapes.length > 0 ? setsObjets({ etapes, familles: emplacements ? emplacements.familles : [], championId, nomChampion: nom, role, carte: carteJeu, troisParBloc }) : [];
        // Set « Rank 1 », après les autres (le set principal reste sélectionné d'office) : le build des meilleurs
        // joueurs, emplacement par emplacement comme le build classique (Départ, Objet 1, Bottes, Objets 2 à 5).
        const etapesRank1 = rank1 ? composerParEmplacement(rank1.emplacements) : [];
        if (rank1 && etapesRank1.length === 0) erreurs.rank1 = "Pas assez de parties des meilleurs joueurs sur ce champion.";
        if (etapesRank1.length > 0) {
          const set = setRank1Classique({ etapes: etapesRank1, championId, nomChampion: nom, role, carte: carteJeu });
          sets.push(set);
          infoRank1 = { titre: set.title, rang: rank1.libelle, parties: rank1.parties };
        }
        await appliquerObjets(sets);
        objets = true;
        setsCrees = sets.filter((s) => !infoRank1 || s.title !== infoRank1.titre).map((s) => s.title); // sans le set Rank 1 (affiché à part)
      } catch (erreur) {
        erreurs.objets = erreur.message;
      }
    }

    let sortsChoisis = null; // noms des 2 sorts mis, ou null
    if (r.sortsAuto && appliquerSorts) {
      try {
        const ids = analyse && analyse.sorts ? ordreSorts(analyse.sorts.ids, sortsActuels) : null;
        if (!ids) throw new ErreurClient("Pas de sorts d'invocateur dans les stats d'OP.GG pour ce champion.");
        await appliquerSorts(ids);
        sortsChoisis = ids.map((id) => SORTS[id] || `Sort n° ${id}`);
      } catch (erreur) {
        erreurs.sortsAuto = erreur.message;
      }
    }

    journal("build", championId, role, { runes: Boolean(runes), objets, rank1: Boolean(infoRank1), sorts: sortsChoisis, erreurs });
    resultat({ championId, role, build: resume, runes, objets, setsCrees, rank1: objets ? infoRank1 : null, sortsChoisis, erreurs });
  }

  return { surSession };
}

// --- Appels au client ------------------------------------------------------------------------

/** Carte et mode de la partie en cours (session du "gameflow"), ou null hors partie. */
async function lirePartie(dossierJeu) {
  return lireJsonOuNull(lireLockfile(dossierJeu), "/lol-gameflow/v1/session");
}

/**
 * Objets du client, lus en une fois : { noms: Map id -> nom (langue du client, pour Lolalytics qui n'a que les numéros),
 * categories: Map id -> ["Health", "Damage"...] (pour repérer les familles de builds, familles.js) }.
 */
async function lireObjets(dossierJeu) {
  const objets = await lireJsonOuNull(lireLockfile(dossierJeu), "/lol-game-data/assets/v1/items.json");
  const noms = new Map();
  const categories = new Map();
  for (const o of Array.isArray(objets) ? objets : []) {
    if (!o || !Number.isInteger(o.id)) continue;
    if (typeof o.name === "string") noms.set(o.id, o.name);
    if (Array.isArray(o.categories)) categories.set(o.id, o.categories.filter((c) => typeof c === "string"));
  }
  return { noms, categories };
}

/** Alias des champions (nom interne, ex. "MonkeyKing"), pour OP.GG : Map id -> alias. */
async function lireAliasChampions(dossierJeu) {
  const resume = await lireJsonOuNull(lireLockfile(dossierJeu), "/lol-game-data/assets/v1/champion-summary.json");
  const alias = new Map();
  if (Array.isArray(resume)) for (const c of resume) if (c && Number.isInteger(c.id) && typeof c.alias === "string") alias.set(c.id, c.alias);
  return alias;
}

/**
 * Choisit tes 2 sorts d'invocateur pendant la sélection des champions (route vérifiée dans lcu-schema) :
 *   PATCH /lol-champ-select/v1/session/my-selection { spell1Id, spell2Id } -> 204
 */
async function appliquerSorts(dossierJeu, [spell1Id, spell2Id]) {
  const { status } = await appelerClient(lireLockfile(dossierJeu), "/lol-champ-select/v1/session/my-selection", {
    methode: "PATCH",
    corps: { spell1Id, spell2Id },
  });
  if (status < 200 || status >= 300) throw new ErreurClient(`Le client a refusé les sorts d'invocateur (code ${status}).`);
}

/** Écrit le ou les sets "LoL Companion" du champion (un par famille de build) sans toucher à tes autres sets. */
async function appliquerSet(dossierJeu, sets) {
  const connexion = lireLockfile(dossierJeu);
  const moi = await lireJson(connexion, "/lol-summoner/v1/current-summoner");
  const route = `/lol-item-sets/v1/item-sets/${moi.summonerId}/sets`;
  const actuels = await lireJson(connexion, route);
  if (!actuels || !Array.isArray(actuels.itemSets)) throw new ErreurClient("Sets d'objets illisibles dans le client.");
  const corps = { ...actuels, itemSets: fusionnerSets(actuels.itemSets, sets), timestamp: Date.now() };
  const { status } = await appelerClient(connexion, route, { methode: "PUT", corps });
  if (status < 200 || status >= 300) throw new ErreurClient(`Le client a refusé le set d'objets (code ${status}).`);
}

module.exports = {
  PREFIXE_SET,
  SELECTION_MIN,
  PARTIES_MIN,
  LIBELLES_ROLES,
  normaliserReglagesBuild,
  scorePrudent,
  classerOptions,
  composerBuild,
  troisChoix,
  setRank1Classique,
  composerParEmplacement,
  assemblerBuild,
  pageDepuisOpgg,
  setObjets,
  etapesFamille,
  setsObjets,
  fusionnerSets,
  resumeBuild,
  creerBuildAuto,
  lirePartie,
  lireObjets,
  lireAliasChampions,
  appliquerSet,
  appliquerSorts,
  ordreSorts,
};
