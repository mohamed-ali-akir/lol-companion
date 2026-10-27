/*
 * Mode Deadlock : calculs (fonctions pures, testées dans test/deadlock-stats.test.js)
 * -----------------------------------------------------------------------------------
 * Tourne dans le processus principal (Node). Aucun accès au réseau ni aux fichiers ici : les réponses de
 * deadlock-api.com (deadlock-api.js) et les sessions de jeu (deadlock-donnees.js) arrivent déjà lues.
 *
 * Règle pour toutes les lectures : TOLÉRANTES. L'API est faite par la communauté et Deadlock est en bêta (héros, objets
 * et champs changent souvent) : une ligne abîmée ou un champ manquant est ignoré, jamais une erreur qui casse l'onglet.
 *
 * Formats vérifiés le 27/10/2026 (api.deadlock-api.com) :
 *  - /v1/assets/heroes : [{ id, name, player_selectable, disabled, in_development, ... }] ;
 *  - /v1/assets/items : [{ id, name, type: "upgrade" | "weapon" | "ability", item_slot_type: "weapon" | "vitality" |
 *    "spirit", item_tier, cost, shopable, disabled }] ;
 *  - /v1/assets/ranks : [{ tier, name }] (0 Obscurus ... 11 Eternus) ; « badge » = rang * 10 + sous-rang ;
 *  - /v1/players/{id}/match-history : [{ match_id, hero_id, start_time (s), match_duration_s, player_team,
 *    match_result (équipe gagnante), player_kills, player_deaths, player_assists, net_worth, last_hits, game_mode,
 *    match_mode, abandoned_time_s }] ;
 *  - /v1/players/hero-stats : [{ hero_id, matches_played, wins, kills, deaths, assists, time_played (s),
 *    last_played (s), networth_per_min, accuracy }] ;
 *  - /v1/analytics/hero-stats : [{ hero_id, wins, losses, matches }] ;
 *  - /v1/analytics/item-stats : [{ item_id, wins, losses, matches, players, avg_buy_time_s }] ;
 *  - /v1/analytics/hero-counter-stats : [{ hero_id, enemy_hero_id, wins, matches_played }].
 */
const { DEADLOCK } = require("./donnees-jeu.js");
const { scorePrudent } = require("./statistiques.js");

const entier = (n) => (Number.isFinite(n) ? Math.round(n) : null);
const positif = (n) => (Number.isFinite(n) && n >= 0 ? n : null);
const liste = (brut) => (Array.isArray(brut) ? brut.filter((x) => x && typeof x === "object") : []);
const texte = (s) => (typeof s === "string" && s.trim() ? s.trim() : null);

// --- Référentiels (héros, objets, rangs) -----------------------------------------------------------------------

/** Héros jouables : Map id -> { id, nom } (les héros en développement ou désactivés sont écartés). */
function normaliserHeros(brut) {
  const heros = new Map();
  for (const h of liste(brut)) {
    const nom = texte(h.name);
    if (!Number.isInteger(h.id) || h.id <= 0 || !nom) continue;
    if (h.player_selectable === false || h.disabled === true || h.in_development === true) continue;
    heros.set(h.id, { id: h.id, nom });
  }
  return heros;
}

const EMPLACEMENTS = { weapon: "arme", vitality: "vitalite", spirit: "esprit" };

/** Objets de la boutique : Map id -> { id, nom, emplacement ("arme" | "vitalite" | "esprit"), palier, prix }. */
function normaliserObjets(brut) {
  const objets = new Map();
  for (const o of liste(brut)) {
    const nom = texte(o.name);
    if (o.type !== "upgrade" || !Number.isInteger(o.id) || !nom || o.disabled === true || o.shopable === false) continue;
    objets.set(o.id, {
      id: o.id,
      nom,
      emplacement: EMPLACEMENTS[o.item_slot_type] || null,
      palier: Number.isInteger(o.item_tier) ? o.item_tier : null,
      prix: positif(o.cost),
    });
  }
  return objets;
}

/** Rangs : [{ rang, nom }] du plus bas au plus haut (pour le filtre de niveau). */
function normaliserRangs(brut) {
  return liste(brut)
    .filter((r) => Number.isInteger(r.tier) && r.tier >= 0 && texte(r.name))
    .map((r) => ({ rang: r.tier, nom: texte(r.name) }))
    .sort((a, b) => a.rang - b.rang);
}

/** Rang choisi dans l'onglet (0 à 11) -> « badge » minimal de l'API (rang * 10), ou null pour tous les niveaux. */
const badgeMinimal = (rang) => (Number.isInteger(rang) && rang > 0 && rang <= 11 ? rang * 10 : null);

// --- Tes parties --------------------------------------------------------------------------------------------------

/** Type de partie lisible : « Street Brawl », « Classée », « Normale »... */
function typePartie(gameMode, matchMode) {
  if (DEADLOCK.modesJeu[gameMode] === "street_brawl") return "Street Brawl";
  return DEADLOCK.typesPartie[matchMode] || "Autre";
}

/** Une ligne de l'historique de l'API -> partie, ou null si elle est inutilisable. */
function partieDepuisApi(e) {
  if (!e || typeof e !== "object") return null;
  if (!Number.isFinite(e.match_id) || !Number.isInteger(e.hero_id) || !Number.isFinite(e.start_time)) return null;
  const equipe = entier(e.player_team);
  const gagnante = entier(e.match_result);
  return {
    id: e.match_id,
    heroId: e.hero_id,
    debut: e.start_time * 1000, // millisecondes, comme les dates de l'appli
    dureeS: positif(e.match_duration_s),
    victoire: equipe !== null && gagnante !== null ? equipe === gagnante : null,
    eliminations: positif(e.player_kills),
    morts: positif(e.player_deaths),
    assistances: positif(e.player_assists),
    ames: positif(e.net_worth), // « âmes » : l'argent de Deadlock
    derniersCoups: positif(e.last_hits),
    type: typePartie(e.game_mode, e.match_mode),
    abandon: Number.isFinite(e.abandoned_time_s) && e.abandoned_time_s > 0,
  };
}

/** Historique de l'API -> parties lisibles, de la plus récente à la plus ancienne, sans doublons. */
function partiesDepuisApi(brut) {
  const vues = new Set();
  const parties = [];
  for (const p of liste(brut).map(partieDepuisApi)) {
    if (!p || vues.has(p.id)) continue;
    vues.add(p.id);
    parties.push(p);
  }
  return parties.sort((a, b) => b.debut - a.debut);
}

const ratio = (a, b) => (b > 0 ? a / b : null);

/**
 * Résumé pour l'Accueil Deadlock : { nombre, victoires, tauxVictoire, kda, dernieres, parHeros }.
 *  - kda : (éliminations + assistances) / morts, sur les parties où ces chiffres sont connus (morts 0 -> compté 1) ;
 *  - parHeros : [{ heroId, nom, parties, victoires, tauxVictoire }] du plus joué au moins joué ;
 *  - dernieres : les `combien` dernières parties, avec le nom du héros.
 */
function resumeParties(parties, heros = new Map(), { combien = 20 } = {}) {
  const toutes = Array.isArray(parties) ? parties.filter(Boolean) : [];
  const nom = (id) => (heros.get(id) || {}).nom || `Héros n° ${id}`;
  const connues = toutes.filter((p) => p.victoire !== null);
  const victoires = connues.filter((p) => p.victoire).length;
  const avecKda = toutes.filter((p) => p.eliminations !== null && p.morts !== null && p.assistances !== null);
  const somme = (cle) => avecKda.reduce((s, p) => s + p[cle], 0);
  const morts = avecKda.reduce((s, p) => s + Math.max(1, p.morts), 0);
  const parHeros = new Map();
  for (const p of connues) {
    const h = parHeros.get(p.heroId) || { heroId: p.heroId, nom: nom(p.heroId), parties: 0, victoires: 0 };
    h.parties++;
    if (p.victoire) h.victoires++;
    parHeros.set(p.heroId, h);
  }
  return {
    nombre: toutes.length,
    victoires,
    tauxVictoire: ratio(victoires, connues.length),
    kda: avecKda.length > 0 ? (somme("eliminations") + somme("assistances")) / morts : null,
    dernieres: toutes.slice(0, combien).map((p) => ({ ...p, nomHeros: nom(p.heroId) })),
    parHeros: [...parHeros.values()]
      .map((h) => ({ ...h, tauxVictoire: ratio(h.victoires, h.parties) }))
      .sort((a, b) => b.parties - a.parties || a.nom.localeCompare(b.nom, "fr")),
  };
}

/** Tes stats par héros (/v1/players/hero-stats) -> [{ heroId, nom, parties, victoires, tauxVictoire, kda, tempsS, derniere }]. */
function mesStatsParHeros(brut, heros = new Map()) {
  return liste(brut)
    .filter((h) => Number.isInteger(h.hero_id) && Number.isFinite(h.matches_played) && h.matches_played > 0)
    .map((h) => {
      const parties = h.matches_played;
      const victoires = Number.isFinite(h.wins) ? Math.min(h.wins, parties) : 0;
      const morts = Number.isFinite(h.deaths) ? Math.max(1, h.deaths) : null;
      return {
        heroId: h.hero_id,
        nom: (heros.get(h.hero_id) || {}).nom || `Héros n° ${h.hero_id}`,
        parties,
        victoires,
        tauxVictoire: victoires / parties,
        kda: morts !== null && Number.isFinite(h.kills) && Number.isFinite(h.assists) ? (h.kills + h.assists) / morts : null,
        tempsS: positif(h.time_played),
        derniere: Number.isFinite(h.last_played) ? h.last_played * 1000 : null,
      };
    })
    .sort((a, b) => b.parties - a.parties || a.nom.localeCompare(b.nom, "fr"));
}

// --- Héros du moment -----------------------------------------------------------------------------------------

const PARTIES_MIN_HEROS = 500; // en dessous, le taux de victoire d'un héros n'est pas assez sûr pour le classer

/**
 * Tier list (/v1/analytics/hero-stats) -> [{ heroId, nom, parties, victoires, tauxVictoire, popularite, prudent }],
 * du meilleur au moins bon au taux de victoire PRUDENT (statistiques.js : un héros peu joué est tiré vers le bas).
 * popularite : part des parties où le héros est joué (12 héros par partie : la somme fait 12, pas 1 ; vérifié le
 * 27/10/2026 : somme des parties des héros / 12 = 1 956 768, total de /v1/analytics/game-stats = 1 964 735). Bornée à 100 %.
 * Seuls les héros jouables (heros) avec au moins partiesMin parties.
 */
function tierListe(brut, heros = new Map(), { partiesMin = PARTIES_MIN_HEROS } = {}) {
  const lignes = liste(brut).filter((h) => Number.isInteger(h.hero_id) && Number.isFinite(h.matches) && h.matches > 0);
  const totalParties = lignes.reduce((s, h) => s + h.matches, 0) / 12; // chaque partie compte 12 héros
  return lignes
    .filter((h) => (heros.size === 0 || heros.has(h.hero_id)) && h.matches >= partiesMin)
    .map((h) => {
      const victoires = Number.isFinite(h.wins) ? Math.min(h.wins, h.matches) : 0;
      return {
        heroId: h.hero_id,
        nom: (heros.get(h.hero_id) || {}).nom || `Héros n° ${h.hero_id}`,
        parties: h.matches,
        victoires,
        tauxVictoire: victoires / h.matches,
        popularite: totalParties > 0 ? Math.min(1, h.matches / totalParties) : null,
        prudent: scorePrudent(victoires, h.matches),
      };
    })
    .sort((a, b) => b.prudent - a.prudent);
}

// --- Build d'un héros ----------------------------------------------------------------------------------------

// Moments de la partie, d'après le temps d'achat MOYEN de l'objet (avg_buy_time_s).
const PHASES = [
  { cle: "debut", titre: "Début de partie", quand: "avant 10 min", jusquA: 10 * 60 },
  { cle: "milieu", titre: "Milieu de partie", quand: "10 à 20 min", jusquA: 20 * 60 },
  { cle: "fin", titre: "Fin de partie", quand: "après 20 min", jusquA: Infinity },
];
const ACHAT_MIN = 0.05; // un objet acheté dans moins de 5 % des parties du héros n'est pas proposé
const PARTIES_MIN_OBJET = 200; // ni sur moins de 200 parties (taux de victoire trop incertain)
const OBJETS_PAR_PHASE = 6;
// « Presque toujours » (27/10/2026) : acheté dans au moins 60 % des parties du héros. Les autres sont « selon la partie ».
const ACHAT_ESSENTIEL = 0.6;

/**
 * Build d'un héros (/v1/analytics/item-stats?hero_id=) -> { parties, phases: [{ cle, titre, objets }] }.
 *  - partiesHeros : parties du héros sur la même période (tier list), pour la part des achats ; sinon le plus grand
 *    nombre de parties d'un objet sert d'estimation ;
 *  - chaque phase garde les OBJETS_PAR_PHASE objets LES PLUS ACHETÉS (comme le build classique de LoL : le chemin de
 *    la majorité des joueurs reste cohérent), chacun avec { id, nom, emplacement, prix, parties, achat, tauxVictoire,
 *    minute, essentiel } ; « conseille » marque le meilleur au taux de victoire prudent de la phase ; « essentiel » : acheté
 *    dans au moins 60 % des parties du héros (à prendre presque toujours), sinon objet de situation ;
 *  - attention, et l'onglet le dit : un objet de fin de partie a souvent un meilleur taux, parce que les gagnants
 *    ont plus d'âmes pour l'acheter. On compare donc les objets d'une même phase, jamais entre phases.
 */
function buildDuHeros(brut, objets = new Map(), { partiesHeros = null } = {}) {
  const lignes = liste(brut).filter((o) => Number.isInteger(o.item_id) && Number.isFinite(o.matches) && o.matches > 0 && objets.has(o.item_id));
  const parties = Number.isFinite(partiesHeros) && partiesHeros > 0 ? partiesHeros : Math.max(0, ...lignes.map((o) => o.matches));
  const candidats = lignes
    .map((o) => {
      const victoires = Number.isFinite(o.wins) ? Math.min(o.wins, o.matches) : 0;
      const fiche = objets.get(o.item_id);
      return {
        id: o.item_id,
        nom: fiche.nom,
        emplacement: fiche.emplacement,
        prix: fiche.prix,
        parties: o.matches,
        achat: parties > 0 ? Math.min(1, o.matches / parties) : null,
        tauxVictoire: victoires / o.matches,
        prudent: scorePrudent(victoires, o.matches),
        minute: Number.isFinite(o.avg_buy_time_s) && o.avg_buy_time_s >= 0 ? o.avg_buy_time_s / 60 : null,
      };
    })
    .filter((o) => o.minute !== null && o.parties >= PARTIES_MIN_OBJET && (o.achat === null || o.achat >= ACHAT_MIN));
  const phases = PHASES.map((phase, i) => {
    const debut = i === 0 ? 0 : PHASES[i - 1].jusquA;
    const dansPhase = candidats
      .filter((o) => o.minute * 60 >= debut && o.minute * 60 < phase.jusquA)
      .sort((a, b) => b.parties - a.parties)
      .slice(0, OBJETS_PAR_PHASE);
    const meilleur = dansPhase.length > 1 ? [...dansPhase].sort((a, b) => b.prudent - a.prudent)[0] : null;
    return {
      cle: phase.cle,
      titre: phase.titre,
      quand: phase.quand,
      // prudent ne sert qu'au classement : il n'est pas envoyé à la page
      objets: dansPhase.sort((a, b) => a.minute - b.minute).map(({ prudent, ...o }) => ({
        ...o,
        conseille: Boolean(meilleur) && o.id === meilleur.id,
        essentiel: Number.isFinite(o.achat) && o.achat >= ACHAT_ESSENTIEL,
      })),
    };
  });
  return { parties, phases };
}

const PARTIES_MIN_CONTRE = 300; // un duel joué moins souvent n'est pas assez sûr
const CONTRES_AFFICHES = 5;

/**
 * Contres d'un héros (/v1/analytics/hero-counter-stats) -> { difficiles, faciles } : les héros contre lesquels il gagne
 * le moins / le plus (taux prudent), [{ heroId, nom, parties, tauxVictoire }]. Un « difficile » est sous 50 % de
 * victoires, un « facile » au-dessus : un même héros n'est jamais dans les deux listes.
 */
function contresDuHeros(brut, heroId, heros = new Map(), { partiesMin = PARTIES_MIN_CONTRE } = {}) {
  const duels = liste(brut)
    .filter((d) => d.hero_id === heroId && Number.isInteger(d.enemy_hero_id) && d.enemy_hero_id !== heroId)
    .filter((d) => (heros.size === 0 || heros.has(d.enemy_hero_id)) && Number.isFinite(d.matches_played) && d.matches_played >= partiesMin)
    .map((d) => {
      const victoires = Number.isFinite(d.wins) ? Math.min(d.wins, d.matches_played) : 0;
      return {
        heroId: d.enemy_hero_id,
        nom: (heros.get(d.enemy_hero_id) || {}).nom || `Héros n° ${d.enemy_hero_id}`,
        parties: d.matches_played,
        tauxVictoire: victoires / d.matches_played,
        prudentPour: scorePrudent(victoires, d.matches_played), // ce héros gagne contre lui
        prudentContre: scorePrudent(d.matches_played - victoires, d.matches_played), // ce héros perd contre lui
      };
    });
  const sans = ({ prudentPour, prudentContre, ...d }) => d;
  return {
    difficiles: duels.filter((d) => d.tauxVictoire < 0.5).sort((a, b) => b.prudentContre - a.prudentContre).slice(0, CONTRES_AFFICHES).map(sans),
    faciles: duels.filter((d) => d.tauxVictoire > 0.5).sort((a, b) => b.prudentPour - a.prudentPour).slice(0, CONTRES_AFFICHES).map(sans),
  };
}

// --- Temps de jeu (sessions mesurées par l'appli) -----------------------------------------------------------

const JOUR_MS = 24 * 60 * 60 * 1000;

/**
 * Temps passé sur Deadlock : { aujourdhui, septJours, total } en millisecondes.
 * sessions : [{ debut, fin }] (ms) ; enCours : début de la session en cours (jeu lancé) ou null.
 * « Aujourd'hui » commence à minuit (heure du PC) ; une session à cheval sur minuit est coupée.
 */
function tempsDeJeu(sessions, enCours = null, maintenant = Date.now()) {
  const toutes = (Array.isArray(sessions) ? sessions : [])
    .filter((s) => s && Number.isFinite(s.debut) && Number.isFinite(s.fin) && s.fin > s.debut)
    .map((s) => ({ debut: s.debut, fin: Math.min(s.fin, maintenant) }));
  if (Number.isFinite(enCours) && enCours < maintenant) toutes.push({ debut: enCours, fin: maintenant });
  const minuit = new Date(maintenant);
  minuit.setHours(0, 0, 0, 0);
  const depuis = (limite) => toutes.reduce((s, x) => s + Math.max(0, x.fin - Math.max(x.debut, limite)), 0);
  return {
    aujourdhui: depuis(minuit.getTime()),
    septJours: depuis(maintenant - 7 * JOUR_MS),
    total: depuis(-Infinity),
  };
}

module.exports = {
  PHASES,
  PARTIES_MIN_HEROS,
  PARTIES_MIN_OBJET,
  ACHAT_MIN,
  ACHAT_ESSENTIEL,
  normaliserHeros,
  normaliserObjets,
  normaliserRangs,
  badgeMinimal,
  typePartie,
  partieDepuisApi,
  partiesDepuisApi,
  resumeParties,
  mesStatsParHeros,
  tierListe,
  buildDuHeros,
  contresDuHeros,
  tempsDeJeu,
};
