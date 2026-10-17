/*
 * Set d'objets « Champion Rank 1 » : le build du meilleur joueur du champion sur ton serveur (17/10/2026)
 * -----------------------------------------------------------------------------------------------------
 * Tourne dans le processus principal (Node). Fonctions pures : les appels à OP.GG sont dans opgg.js (rank1).
 * Exception décidée par le propriétaire le 17/10/2026 (CLAUDE.md) : en plus du champion, on envoie à OP.GG ton
 * SERVEUR (EUW...) et le Riot ID PUBLIC du joueur du classement (jamais le tien). Case séparée, désactivée par défaut.
 *
 * Comme les « builds des meilleurs joueurs » de Blitz, Mobalytics ou U.GG, mais sans clé d'API de Riot :
 *  1. classement OP.GG du champion sur ton serveur. OP.GG le trie par NOMBRE DE PARTIES jouées (vu le 17/10/2026 :
 *     le n° 1 d'Ahri était Maître, le n° 5 Grand Maître) : on lit les 10 premiers et on les retrie par vrai rang ;
 *  2. les 20 dernières parties du meilleur ; on garde celles sur CE champion (au moins 3, sinon le joueur suivant) ;
 *  3. OP.GG ne donne que l'inventaire de FIN de partie (pas l'ordre d'achat) : on compte, pour chaque objet fini et
 *     chaque paire de bottes, la part des parties où il l'avait, et on les range du plus pris au moins pris.
 *     Le départ n'est plus dans l'inventaire en fin de partie : il est repris du build général (Lolalytics / OP.GG).
 */

// Rangs du plus bas au plus haut (OP.GG), et leur nom en français.
const TIERS = ["IRON", "BRONZE", "SILVER", "GOLD", "PLATINUM", "EMERALD", "DIAMOND", "MASTER", "GRANDMASTER", "CHALLENGER"];
const NOMS_TIERS = {
  IRON: "Fer", BRONZE: "Bronze", SILVER: "Argent", GOLD: "Or", PLATINUM: "Platine", EMERALD: "Émeraude",
  DIAMOND: "Diamant", MASTER: "Maître", GRANDMASTER: "Grand Maître", CHALLENGER: "Challenger",
};
const CLASSEMENT_LU = 10; // joueurs du classement OP.GG retriés par rang
const JOUEURS_ESSAYES = 3; // au plus 3 historiques demandés (si le meilleur ne joue plus le champion)
const MIN_PARTIES = 3; // parties récentes sur le champion pour qu'un joueur soit retenu
const PART_COEUR = 0.5; // objet pris dans au moins la moitié des parties : « cœur » du build
const PART_MIN = 0.2; // en dessous : « parfois »
const PARFOIS_MAX = 6;
const PREFIXE_UID = "1c0a9a10-0000-4000-9000-"; // identifiant du set Rank 1 (les autres sets de l'appli : ...-8000-)

// Postes d'OP.GG dans l'historique -> rôles du client.
const ROLES_OPGG = { TOP: "top", JUNGLE: "jungle", MID: "middle", ADC: "bottom", SUPPORT: "utility" };

const nombre = (n) => (Number.isFinite(Number(n)) ? Number(n) : 0);
const liste = (x) => (Array.isArray(x) ? x : []);

/**
 * Nom attendu par le classement d'OP.GG : le nom ANGLAIS en majuscules, mots séparés par « _ », sans apostrophe ni
 * point (« Dr. Mundo » -> DR_MUNDO, « K'Sante » -> KSANTE, « Nunu & Willump » -> NUNU_WILLUMP). Plus strict que
 * l'analyse des stats : le nom interne (« MonkeyKing », « LeeSin ») y est refusé. Vérifié le 17/10/2026 sur les 250
 * champions de lol_list_champions.
 */
const nomClassement = (nom) => String(nom || "").toUpperCase().replace(/['’.]/g, "").replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");

/** Liste des champions d'OP.GG lue (lol_list_champions, en anglais) -> Map numéro -> nom anglais. */
function nomsAnglais(brut) {
  const champions = brut && brut.data && Array.isArray(brut.data.champions) ? brut.data.champions : [];
  return new Map(champions.filter((c) => c && Number.isInteger(c.champion_id) && typeof c.name === "string").map((c) => [c.champion_id, c.name]));
}

/** Rang lisible : « Grand Maître 2145 LP ». */
const libelleRang = ({ tier, lp }) => `${NOMS_TIERS[tier] || "Rang inconnu"}${tier in NOMS_TIERS ? ` ${nombre(lp)} LP` : ""}`;

/**
 * Classement OP.GG lu (analyserTexteOpgg) -> joueurs triés par VRAI rang (tier, puis LP), les mieux classés d'abord.
 * Seulement les CLASSEMENT_LU premiers d'OP.GG, et ceux dont on connaît le Riot ID. Rang de la file solo de préférence.
 * -> [{ nom, tag, tier, lp, parties, victoires }]
 */
function joueursParRang(brut) {
  const lignes = liste(brut && brut.leaderboard).slice(0, CLASSEMENT_LU);
  const joueurs = [];
  for (const l of lignes) {
    const s = l && l.summoner;
    if (!s || typeof s.game_name !== "string" || !s.game_name || typeof s.tagline !== "string" || !s.tagline) continue;
    const ligues = liste(s.league_stats).filter((x) => x && x.tier_info);
    const ligue = ligues.find((x) => x.game_type === "SOLORANKED") || ligues[0];
    const tier = ligue ? String(ligue.tier_info.tier || "").toUpperCase() : "";
    const stat = (l && l.most_champion_stat) || {};
    joueurs.push({ nom: s.game_name, tag: s.tagline, tier, lp: nombre(ligue && ligue.tier_info.lp), parties: nombre(stat.play), victoires: nombre(stat.win) });
  }
  const score = (j) => TIERS.indexOf(j.tier) * 100000 + j.lp;
  return joueurs.sort((a, b) => score(b) - score(a));
}

/**
 * Historique OP.GG lu (analyserTexteOpgg) -> parties jouées avec CE champion : [{ ids, role, victoire }].
 * On compare le numéro du champion (les noms diffèrent : « Wukong » / « MonkeyKing »).
 */
function partiesDuChampion(brut, championId) {
  const historique = liste(brut && brut.data && brut.data.game_history);
  const parties = [];
  for (const partie of historique) {
    const p = liste(partie && partie.participants)[0]; // le joueur demandé (OP.GG n'envoie que lui)
    if (!p || Number(p.champion_id) !== championId) continue;
    parties.push({
      ids: liste(p.items).filter((id) => Number.isInteger(id) && id > 0),
      role: ROLES_OPGG[String(p.position || "").toUpperCase()] || null,
      victoire: Boolean(p.stats && p.stats.result === "WIN"),
    });
  }
  return parties;
}

/**
 * Sorte d'objet, d'après les données d'objets du client ({ categories, prix, vers, de }) :
 * "bottes", "fini" (objet complet, au moins 1 500 or), ou null (départ, composant, consommable : ignorés).
 */
function sorteObjet(id, objet) {
  if (!objet) return null;
  const categories = liste(objet.categories);
  if (categories.includes("Boots")) return id === 1001 ? null : "bottes"; // 1001 : simples bottes (composant)
  if (categories.includes("Consumable") || categories.includes("Trinket")) return null;
  if (liste(objet.vers).length === 0 && nombre(objet.prix) >= 1500) return "fini";
  return null;
}

/**
 * Ce que le meilleur joueur achète, d'après ses parties sur le champion :
 *  parties : de partiesDuChampion ; objets : Map id -> { categories, prix, vers, de } (client) ;
 *  role : ton rôle — on garde ses parties à ce poste s'il y en a assez (sinon toutes).
 * -> { n, victoires, bottes: [{ id, part }], coeur, souvent, parfois } (parts entre 0 et 1, du plus pris au moins pris),
 *    ou null s'il y a moins de MIN_PARTIES parties.
 */
function composerRank1({ parties, objets, role = null }) {
  let retenues = liste(parties);
  const auPoste = retenues.filter((p) => role && p.role === role);
  if (auPoste.length >= MIN_PARTIES) retenues = auPoste;
  const n = retenues.length;
  if (n < MIN_PARTIES) return null;
  const comptes = { bottes: new Map(), fini: new Map() };
  for (const p of retenues) {
    for (const id of new Set(p.ids)) {
      const sorte = sorteObjet(id, objets && objets.get(id));
      if (sorte) comptes[sorte].set(id, (comptes[sorte].get(id) || 0) + 1);
    }
  }
  const tries = (m) => [...m].map(([id, k]) => ({ id, part: k / n })).sort((a, b) => b.part - a.part || a.id - b.id);
  const finis = tries(comptes.fini);
  return {
    n,
    victoires: retenues.filter((p) => p.victoire).length,
    bottes: tries(comptes.bottes),
    coeur: finis.filter((o) => o.part >= PART_COEUR),
    souvent: finis.filter((o) => o.part >= PART_MIN && o.part < PART_COEUR),
    parfois: finis.filter((o) => o.part < PART_MIN).slice(0, PARFOIS_MAX),
  };
}

const pourcent = (x) => `${Math.round(x * 100)} %`;
const bloc = (type, ids) => ({ type, items: ids.map(([id, count]) => ({ id: String(id), count })), hideIfSummonerSpell: "", showIfSummonerSpell: "" });

/**
 * Set d'objets « Ahri Rank 1 » (format du client).
 *  composition : de composerRank1 ; joueur : { tier, lp } (son Riot ID n'est jamais affiché) ;
 *  depart : ids du départ du build général (2 potions = 2 fois l'id), ou [] ; region : « EUW »...
 * Blocs : départ (build général), bottes, puis les objets du joueur, du plus pris au moins pris.
 */
function setRank1({ composition, joueur, depart = [], championId, nomChampion, carte = 11, region = "" }) {
  const c = composition;
  const blocs = [];
  const compteDepart = new Map();
  for (const id of liste(depart)) compteDepart.set(id, (compteDepart.get(id) || 0) + 1);
  if (compteDepart.size > 0) blocs.push(bloc("Départ (build général)", [...compteDepart]));
  const qui = `${libelleRang(joueur)}${region ? ` ${region}` : ""}, ${c.n} parties récentes, ${pourcent(c.victoires / c.n)} V`;
  if (c.bottes.length > 0) blocs.push(bloc(`Bottes du Rank 1 · ${pourcent(c.bottes[0].part)} des parties`, c.bottes.map((o) => [o.id, 1])));
  const groupes = [
    [c.coeur, "Rank 1 · cœur du build (la moitié des parties ou plus)"],
    [c.souvent, "Rank 1 · souvent (20 à 50 % des parties)"],
    [c.parfois, "Rank 1 · parfois (selon la partie)"],
  ];
  for (const [objets, titre] of groupes) if (objets.length > 0) blocs.push(bloc(titre, objets.map((o) => [o.id, 1])));
  // Le rang du joueur, en tête du premier bloc d'objets : on sait d'où vient le build.
  const premier = blocs.find((b) => b.type.startsWith("Rank 1 ·"));
  if (premier) premier.type = `${premier.type} · ${qui}`;
  return {
    title: `${nomChampion} Rank 1`,
    type: "custom",
    map: "any",
    mode: "any",
    associatedChampions: [championId],
    associatedMaps: [carte],
    blocks: blocs,
    preferredItemSlots: [],
    sortrank: 0,
    startedFrom: "blank",
    uid: `${PREFIXE_UID}${String(championId).padStart(12, "0")}`,
  };
}

module.exports = {
  TIERS,
  NOMS_TIERS,
  MIN_PARTIES,
  JOUEURS_ESSAYES,
  PREFIXE_UID,
  libelleRang,
  nomClassement,
  nomsAnglais,
  joueursParRang,
  partiesDuChampion,
  sorteObjet,
  composerRank1,
  setRank1,
};
