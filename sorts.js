/*
 * Chronos des sorts d'invocateur adverses, en jeu (Faille de l'invocateur)
 * ------------------------------------------------------------------------
 * Tourne dans le processus principal (Node). Désactivé par défaut (case de l'onglet Build).
 *
 * Comme Porofessor ou Blitz : un petit panneau en haut à gauche du jeu montre les 5 adversaires (icône du champion)
 * et leurs 2 sorts. Quand tu VOIS un adversaire utiliser un sort, tu cliques dessus : le compte à rebours démarre
 * (temps de recharge du sort, réduit par ses bottes de lucidité visibles). Un 2e clic l'annule (erreur de clic).
 * L'appli ne devine jamais seule qu'un sort a été utilisé : c'est toi qui le dis, elle fait juste le calcul.
 *
 * Règles de Riot (vérifié le 10/10/2026) : les chronos des ULTIMES adverses sont interdits depuis le 13/03/2025,
 * même manuels ; ils ne sont donc pas proposés. Les chronos de sorts d'invocateur restent tolérés (applis connues),
 * et reposent sur ce que tu vois toi-même. Exception décidée par le propriétaire, en connaissance du risque.
 *
 * Données : API officielle « Live Client Data » (voir objectifs.js) :
 *   allPlayers: [{ rawChampionName: "game_character_displayname_Ahri", team, level, position: "TOP"...,
 *                  items: [{ itemID, displayName }],
 *                  summonerSpells: { summonerSpellOne: { rawDisplayName: "GeneratedTip_SummonerSpell_SummonerFlash_DisplayName" }, summonerSpellTwo } }]
 * Aucun pseudo n'est affiché : seulement les champions.
 */
const { lireJeu, monEquipe } = require("./objectifs.js");
const { NOMS_SORTS, pingDepuisLigne, creerCompteurPings } = require("./pings.js"); // pings des sorts lus dans le chat

/**
 * Temps de recharge de base (secondes) sur la Faille. Vérifié le 10/10/2026 sur le wiki officiel
 * (wiki.leagueoflegends.com/en-us/Summoner_spell et /Teleport) :
 *  Flash 300, Ignite 180, Téléportation 300 (après 10:00 : Téléportation déchaînée, de 330 au niveau 1 à 240 au
 *  niveau 18), Heal 240, Barrière 180, Exhaust 240, Ghost 240, Cleanse 240, Smite 90.
 * Accélération des sorts d'invocateur : Bottes ioniennes de lucidité +10, Lucidité pourpre +20,
 * Perspicacité cosmique (rune) +18 mais invisible pour l'adversaire, donc pas comptée.
 * Temps réel = base / (1 + accélération / 100).
 */
const SORTS = {
  Flash: { nom: "Flash", rechargeS: 300 },
  Dot: { nom: "Ignite", rechargeS: 180 },
  Teleport: { nom: "TP", rechargeS: 300 },
  Heal: { nom: "Heal", rechargeS: 240 },
  Barrier: { nom: "Barrière", rechargeS: 180 },
  Exhaust: { nom: "Exhaust", rechargeS: 240 },
  Haste: { nom: "Ghost", rechargeS: 240 },
  Boost: { nom: "Cleanse", rechargeS: 240 },
  Smite: { nom: "Smite", rechargeS: 90 },
};
const TP_DECHAINEE_DES_S = 10 * 60;
const BOTTES_IONIENNES = 3158;
const HATE_IONIENNES = 10;
const HATE_LUCIDITE_POURPRE = 20;
const ORDRE_POSTES = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"];

// --- Fonctions pures (testées) ---------------------------------------------------------------

/** Sort d'invocateur de l'API -> clé ("Flash", "Dot"...) d'après son nom interne, ou null s'il est inconnu. */
function cleSort(sort) {
  const brut = sort && typeof sort.rawDisplayName === "string" ? sort.rawDisplayName : "";
  const m = /Summoner(Flash|Dot|Teleport|Heal|Barrier|Exhaust|Haste|Boost|Smite)/.exec(brut);
  return m ? m[1] : null;
}

/** Accélération des sorts d'invocateur d'après les objets VISIBLES du joueur (bottes de lucidité). */
function hateSorts(objets) {
  let hate = 0;
  for (const o of Array.isArray(objets) ? objets : []) {
    if (!o) continue;
    if (o.itemID === BOTTES_IONIENNES) hate += HATE_IONIENNES;
    else if (/lucidit/i.test(String(o.displayName || ""))) hate += HATE_LUCIDITE_POURPRE; // Lucidité pourpre (évolution des bottes)
  }
  return hate;
}

/** Temps de recharge (secondes) d'un sort utilisé au temps tempsS, pour un champion de ce niveau et cette accélération. */
function rechargeS(cle, { tempsS = 0, niveau = 1, hate = 0 } = {}) {
  const sort = SORTS[cle];
  if (!sort) return null;
  let base = sort.rechargeS;
  if (cle === "Teleport" && tempsS >= TP_DECHAINEE_DES_S) {
    const n = Math.min(18, Math.max(1, Math.round(Number(niveau) || 1)));
    base = 330 - (90 * (n - 1)) / 17;
  }
  return base / (1 + Math.max(0, Number(hate) || 0) / 100);
}

/** "MonkeyKing" depuis "game_character_displayname_MonkeyKing". */
const aliasChampion = (joueur) => String(joueur.rawChampionName || "").replace(/^game_character_displayname_/, "");

/**
 * Les 5 adversaires, dans l'ordre des postes : [{ cle, alias, niveau, hate, sorts: [{ id, cle, nom }] }].
 * cle : identifiant stable du joueur dans la partie (jamais affiché).
 */
function adversaires(jeu) {
  if (!jeu || !Array.isArray(jeu.joueurs)) return [];
  const equipe = monEquipe(jeu.actif, jeu.joueurs);
  if (!equipe) return [];
  return jeu.joueurs
    .filter((j) => j && (j.team === "ORDER" || j.team === "CHAOS") && j.team !== equipe)
    .map((j, i) => {
      const cle = String(j.riotId || j.summonerName || `${aliasChampion(j)}-${i}`);
      const brut = j.summonerSpells && typeof j.summonerSpells === "object" ? j.summonerSpells : {};
      const sorts = [brut.summonerSpellOne, brut.summonerSpellTwo].map((s, n) => {
        const cs = cleSort(s);
        // nomJeu : le nom du sort dans la langue du jeu (pour reconnaître les pings du chat, pings.js)
        return { id: `${cle}|${n}`, cle: cs, nom: cs ? SORTS[cs].nom : "?", nomJeu: s && typeof s.displayName === "string" ? s.displayName : null };
      });
      return {
        cle,
        alias: aliasChampion(j),
        nomChampion: typeof j.championName === "string" && j.championName ? j.championName : aliasChampion(j), // langue du jeu
        niveau: Number(j.level) || 1,
        hate: hateSorts(j.items),
        sorts,
        poste: ORDRE_POSTES.indexOf(String(j.position || "").toUpperCase()),
      };
    })
    .sort((a, b) => (a.poste < 0 ? 9 : a.poste) - (b.poste < 0 ? 9 : b.poste))
    .map(({ poste, ...reste }) => reste);
}

/**
 * Ce que les pings du chat peuvent viser (pings.js) : les 5 adversaires et LEURS sorts d'invocateur connus, avec
 * tous les noms sous lesquels le chat peut les écrire (langue du jeu, anglais, français, variantes).
 * [{ noms: ["Wukong", "MonkeyKing"], sorts: [{ id, noms: ["Saut éclair", "Flash", ...] }] }]
 */
function ciblesPings(jeu) {
  return adversaires(jeu).map((a) => ({
    noms: [...new Set([a.nomChampion, a.alias].filter(Boolean))],
    sorts: a.sorts.filter((s) => s.cle).map((s) => ({ id: s.id, noms: [...new Set([s.nomJeu, ...NOMS_SORTS[s.cle]].filter(Boolean))] })),
  }));
}

// --- Suivi pendant la partie ----------------------------------------------------------------------

/**
 * Panneau des sorts adverses : relu toutes les secondes, et mis à jour à chaque clic.
 *  reglages()        : { sorts } (case de l'onglet Build)
 *  lire()            : { tempsS, joueurs, actif } ou null (objectifs.js : lireJeu)
 *  afficher(panneau) : [{ alias, sorts: [{ id, nom, restantS (0 = disponible), cliquable }] }] ou null (cacher)
 *  maintenant()      : horloge en ms (pour estimer le temps de jeu entre deux lectures)
 *  lireChat()        : (facultatif) lignes du chat lues à l'écran (pings.js : creerLecteurChat) ; utilisé seulement
 *                      si les cases « sorts » ET « sortsPings » sont cochées. Lu dans sa propre boucle : une lecture
 *                      lente (Mac) ne retarde jamais le panneau.
 */
function creerSuiviSorts({ reglages, lire = lireJeu, afficher, intervalleMs = 1000, maintenant = Date.now, journal = () => {}, lireChat = null, intervalleChatMs = 1000 }) {
  const fins = new Map(); // id du sort -> temps de jeu (s) où il sera de nouveau disponible
  let dernier = null; // { jeu, lu (ms) }
  let minuterie = null;
  let minuterieChat = null;
  let enCours = false;
  let chatEnCours = false;
  let dernierEnvoi = null;
  let derniereErreurChat = { texte: null, quand: 0 }; // une erreur répétée n'est notée qu'une fois par minute
  const compteur = creerCompteurPings(); // un ping n'est nouveau que si une ligne de plus apparaît dans le chat

  /** Temps de jeu estimé maintenant (la dernière lecture + le temps écoulé depuis). */
  const tempsActuel = () => (dernier ? dernier.jeu.tempsS + (maintenant() - dernier.lu) / 1000 : null);

  function panneau() {
    if (!dernier) return null;
    const t = tempsActuel();
    const liste = adversaires(dernier.jeu).map((a) => ({
      alias: a.alias,
      sorts: a.sorts.map((s) => {
        const fin = fins.get(s.id);
        return { id: s.id, nom: s.nom, restantS: fin > t ? Math.ceil(fin - t) : 0, cliquable: Boolean(s.cle) };
      }),
    }));
    return liste.length ? liste : null;
  }

  function envoyer(contenu) {
    const texte = JSON.stringify(contenu);
    if (texte === dernierEnvoi) return;
    dernierEnvoi = texte;
    afficher(contenu);
  }

  async function tour() {
    if (enCours) return;
    enCours = true;
    try {
      if (!(reglages() || {}).sorts) {
        dernier = null;
        return envoyer(null);
      }
      const jeu = await lire();
      if (!jeu) return envoyer(null);
      if (dernier && jeu.tempsS < dernier.jeu.tempsS - 5) {
        fins.clear(); // nouvelle partie
        compteur.vider();
      }
      dernier = { jeu, lu: maintenant() };
      envoyer(panneau());
    } catch (erreur) {
      journal("Chronos des sorts :", erreur.message);
    } finally {
      enCours = false;
    }
  }

  /**
   * Démarre le chrono d'un sort. basculer : un clic sur un chrono qui tourne l'annule ; un ping, lui, ne relance
   * jamais un chrono déjà lancé. Renvoie { a, sort } si un chrono a démarré, sinon null.
   */
  function lancer(id, { basculer }) {
    if (!dernier) return null;
    const t = tempsActuel();
    const a = adversaires(dernier.jeu).find((x) => x.sorts.some((s) => s.id === id));
    const sort = a && a.sorts.find((s) => s.id === id);
    if (!sort || !sort.cle) return null;
    if (fins.get(id) > t) {
      if (basculer) fins.delete(id);
      return null;
    }
    fins.set(id, t + rechargeS(sort.cle, { tempsS: t, niveau: a.niveau, hate: a.hate }));
    return { a, sort };
  }

  /** Clic sur un sort : démarre son chrono, ou l'annule s'il tournait déjà. */
  function clic(id) {
    lancer(id, { basculer: true });
    envoyer(panneau());
  }

  /** Lit le chat ; chaque ping « ChampionEnnemi Sort » nouveau démarre le chrono du sort (exception du 16/10/2026). */
  async function tourChat() {
    if (chatEnCours) return; // une lecture lente ne doit pas s'empiler
    chatEnCours = true;
    try {
      const r = reglages() || {};
      if (!r.sorts || !r.sortsPings || !lireChat || !dernier) return;
      const cibles = ciblesPings(dernier.jeu);
      if (cibles.length === 0) return;
      let change = false;
      const ids = ((await lireChat()) || []).map((ligne) => pingDepuisLigne(ligne, cibles)).filter(Boolean);
      for (const id of compteur.nouveaux(ids)) {
        const lance = lancer(id, { basculer: false });
        if (lance) {
          change = true;
          journal("Ping lu dans le chat :", lance.a.nomChampion, lance.sort.nom, "-> chrono lancé"); // jamais de pseudo
        }
      }
      if (change) envoyer(panneau());
    } catch (erreur) {
      const t = maintenant();
      if (erreur.message !== derniereErreurChat.texte || t - derniereErreurChat.quand > 60000) {
        journal("Pings du chat :", erreur.message);
        derniereErreurChat = { texte: erreur.message, quand: t };
      }
    } finally {
      chatEnCours = false;
    }
  }

  function demarrer() {
    if (minuterie) return;
    minuterie = setInterval(tour, intervalleMs);
    if (lireChat) minuterieChat = setInterval(tourChat, intervalleChatMs);
    tour();
  }

  function arreter() {
    if (minuterie) clearInterval(minuterie);
    if (minuterieChat) clearInterval(minuterieChat);
    minuterie = null;
    minuterieChat = null;
    fins.clear();
    compteur.vider();
    dernier = null;
    envoyer(null);
  }

  return { demarrer, arreter, clic, lireChatMaintenant: tourChat, estDemarre: () => minuterie !== null };
}

module.exports = { SORTS, cleSort, hateSorts, rechargeS, adversaires, ciblesPings, creerSuiviSorts };
