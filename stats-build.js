/*
 * Stats de build d'un champion : de « champion n° 103, rôle Milieu » aux analyses d'OP.GG et de Lolalytics
 * --------------------------------------------------------------------------------------------------------
 * Tourne dans le processus principal (Node). Sorti de main.js le 17/10/2026 pour pouvoir être testé
 * (test/stats-build.test.js) : main.js n'a pas de tests, et ces règles (toujours la Faille, rôle principal en ARAM,
 * set Rank 1) n'étaient vérifiées qu'en jeu.
 *
 * Ce que le module garde en mémoire (lu une seule fois dans le client, puis réutilisé) : noms des champions, noms
 * internes (alias, pour les adresses d'OP.GG et de Lolalytics), noms et catégories des objets.
 * Ce qu'il calcule :
 *  - contexteBuild : alias, rôle et mode à demander. Build automatique : TOUJOURS les stats de la Faille, même en
 *    ARAM (choix du propriétaire, 17/10/2026) ; sans rôle, le rôle principal du champion (Riot, sinon Lolalytics) ;
 *  - analyserOpgg : runes, sorts, objets de secours (OP.GG) ; en ARAM ou en URF, les sorts de CE mode ;
 *  - analyserLolalytics : objets emplacement par emplacement (Lolalytics) ;
 *  - analyserRank1 : build des meilleurs joueurs (Lolalytics, filtre « 1trick », sinon Maître et plus).
 * ARENA (19/10/2026) : les objets de la Faille n'existent pas en Arena (versions 22xxxx, objets prismatiques 44xxxx) :
 * en Arena, le build vient de la page Arena de Lolalytics. OP.GG n'a pas l'Arena : ni runes ni sorts de sa part.
 */
const { modeOpgg, positionOpgg, ErreurOpgg } = require("./opgg.js");
const { estArena } = require("./augments.js");
const { ErreurLolalytics } = require("./lolalytics.js");

// Positions des pages recommandées par Riot ("MIDDLE"...) -> rôles du client ("middle"...).
const ROLE_DEPUIS_POSITION = { TOP: "top", JUNGLE: "jungle", MIDDLE: "middle", BOTTOM: "bottom", UTILITY: "utility" };

// Filtres de Lolalytics essayés pour le set Rank 1, dans l'ordre (vérifiés le 17/10/2026 sur Kayle Haut :
// 1trick 2 774 parties, challenger 97 seulement, master_plus 6 708).
const TIERS_RANK1 = [
  { tier: "1trick", libelle: "Meilleurs joueurs" },
  { tier: "master_plus", libelle: "Maître et plus" },
];
const PARTIES_MIN_RANK1 = 300;

// Arena : chaque objet de la Faille existe en version Arena sous le numéro 220000 + son numéro (vérifié le
// 20/10/2026 dans items.json du client : Dent de Nashor 3115 -> 223115, Jambières du berserker 3006 -> 223006...).
// Les objets de départ de la Faille (Anneau de Doran, potions, bottes de base) n'existent pas en Arena.
const DECALAGE_ARENA = 220000;

/**
 * Erreur « pas pour ce mode » : rien n'est cassé, la donnée n'existe simplement pas (Arena : ni runes, ni stats
 * d'OP.GG, ni set Rank 1). build.js ne l'affiche pas (avant le 20/10/2026, elle s'affichait comme une erreur).
 */
const pasPourCeMode = (Erreur, message) => Object.assign(new Erreur(message), { pasPourCeMode: true });

/**
 * Build de la Faille (analyse de lolalytics.js) -> build Arena : chaque objet remplacé par sa version Arena
 * (numéro + 220000) quand elle existe dans le client (existe(id)), les autres options retirées. Le départ de la Faille
 * n'a pas d'équivalent en Arena (on y commence par des bottes) : retiré. Pas de familles (sets à part) ici.
 */
function enObjetsArena(analyse, existe, nomObjet = (id) => `Objet ${id}`) {
  const versArena = (id) => (id >= DECALAGE_ARENA ? id : existe(DECALAGE_ARENA + id) ? DECALAGE_ARENA + id : null);
  const convertir = (options) =>
    (Array.isArray(options) ? options : [])
      .map((o) => ({ ...o, ids: o.ids.map(versArena) }))
      .filter((o) => o.ids.length > 0 && o.ids.every((id) => id !== null))
      .map((o) => ({ ...o, noms: o.ids.map(nomObjet) }));
  return {
    ...analyse,
    depart: [],
    bottes: convertir(analyse.bottes),
    emplacements: analyse.emplacements.map(convertir),
    familles: [],
    depuisFaille: true, // l'onglet Build le dit
  };
}

/** Lectures du client par défaut (remplacées par des fausses dans les tests). */
function lecturesClient() {
  const { lireNomsChampions } = require("./champions.js");
  const { lireAliasChampions, lireObjets, lirePartie } = require("./build.js");
  const { lireRecommandations } = require("./runes.js");
  return { lireNomsChampions, lireAliasChampions, lireObjets, lirePartie, lireRecommandations };
}

/**
 * dossierJeu() : dossier du jeu (relu à chaque fois : il peut changer dans Paramètres) ;
 * lecteurOpgg, lecteurLolalytics : lecteurs d'opgg.js et de lolalytics.js ; client : lectures du client (lecturesClient).
 */
function creerStatsBuild({ dossierJeu, lecteurOpgg, lecteurLolalytics, client = lecturesClient() }) {
  let nomsChampions = new Map(); // id -> nom, lu une fois dans le client
  let aliasChampions = new Map(); // id -> nom interne ("MonkeyKing"), pour OP.GG et Lolalytics
  let objetsClient = { noms: new Map(), categories: new Map() }; // noms et catégories des objets

  /** Noms des champions, lus une seule fois dans le client (puis gardés en mémoire). */
  async function obtenirNomsChampions() {
    if (nomsChampions.size === 0) {
      try {
        nomsChampions = await client.lireNomsChampions(dossierJeu());
      } catch {
        // client fermé : on réessaiera à la prochaine lecture
      }
    }
    return nomsChampions;
  }

  /** Noms internes des champions (pour OP.GG), lus une seule fois dans le client. */
  async function obtenirAliasChampions() {
    if (aliasChampions.size === 0) {
      try {
        aliasChampions = await client.lireAliasChampions(dossierJeu());
      } catch {
        // client fermé : on réessaiera
      }
    }
    return aliasChampions;
  }

  /** Noms et catégories des objets (langue du client), lus une seule fois dans le client. */
  async function obtenirObjets() {
    if (objetsClient.noms.size === 0) {
      try {
        objetsClient = await client.lireObjets(dossierJeu());
      } catch {
        // client fermé : on réessaiera
      }
    }
    return objetsClient;
  }

  /**
   * Ce qu'il faut pour lire les stats d'un champion : { alias, role, mode, modeJeu }.
   * mode : "ranked" / "aram" imposé (consultation de l'onglet Build). Sinon (build automatique), TOUJOURS les stats
   * de la Faille, quel que soit le mode de la partie. modeJeu : le vrai mode de la partie (« aram »...), pour les sorts.
   * Sans rôle (partie sans rôles, ARAM), on prend le rôle principal du champion : celui des recommandations de Riot,
   * sinon celui de Lolalytics (19/10/2026 : Riot répond « NONE » pour tous les champions), sinon le Milieu.
   */
  /** Rôle principal d'un champion : recommandations de Riot, sinon Lolalytics, sinon le Milieu. */
  async function rolePrincipal(dossier, championId, alias) {
    const pages = await client.lireRecommandations(dossier, championId, null).catch(() => []);
    let role = ROLE_DEPUIS_POSITION[String((pages[0] && pages[0].position) || "").toUpperCase()] || null;
    if (!role && lecteurLolalytics.roleHabituel) role = await lecteurLolalytics.roleHabituel({ alias }).catch(() => null);
    return role || "middle";
  }

  async function contexteBuild({ championId, role, mode }) {
    const dossier = dossierJeu();
    const partie = mode ? null : await client.lirePartie(dossier).catch(() => null);
    if (mode === "arena" || (!mode && estArena(partie))) {
      // Arena : pas de rôle, et ses propres stats (jamais celles de la Faille).
      const alias = (await obtenirAliasChampions()).get(championId);
      if (!alias) throw new ErreurOpgg("Champion inconnu : lance le client League.");
      return { alias, role: null, mode: "arena", modeJeu: "arena" };
    }
    const modeJeu = mode || modeOpgg(partie) || "ranked";
    const modeUtilise = mode || (modeJeu === "flex" ? "flex" : "ranked");
    const alias = (await obtenirAliasChampions()).get(championId);
    if (!alias) throw new ErreurOpgg("Champion inconnu : lance le client League.");
    let roleUtilise = role;
    if (!roleUtilise && modeUtilise !== "aram") roleUtilise = await rolePrincipal(dossier, championId, alias);
    return { alias, role: roleUtilise, mode: modeUtilise, modeJeu };
  }

  /**
   * Stats OP.GG d'un champion (runes, sorts, objets en secours) : celles de la Faille. En ARAM ou en URF, les sorts
   * d'invocateur viennent quand même des stats de CE mode : ceux de la Faille (Téléportation, Châtiment) n'y existent pas.
   */
  async function analyserOpgg(demande) {
    const { alias, role, mode, modeJeu } = await contexteBuild(demande);
    if (mode === "arena") throw pasPourCeMode(ErreurOpgg, "Arena : OP.GG n'a pas de stats pour ce mode (ni runes ni sorts en Arena).");
    const analyse = await lecteurOpgg.analyser({ alias, position: positionOpgg(role, mode), mode });
    if (modeJeu === "aram" || modeJeu === "urf") {
      const duMode = await lecteurOpgg.analyser({ alias, position: positionOpgg(null, modeJeu), mode: modeJeu }).catch(() => null);
      return { ...analyse, sorts: duMode ? duMode.sorts : null };
    }
    return analyse;
  }

  /** Options de lecture des objets : noms et catégories du client. */
  async function objetsPourLolalytics() {
    const { noms, categories } = await obtenirObjets();
    return {
      nomObjet: (id) => noms.get(id) || `Objet n° ${id}`,
      categoriesObjet: (id) => categories.get(id) || [], // familles de builds (plusieurs sets)
    };
  }

  /**
   * Objets emplacement par emplacement (Lolalytics), avec les noms des objets du client.
   * Arena : la page Arena de Lolalytics ; si elle n'a rien d'utilisable pour ce champion, le build de la Faille
   * (à son rôle principal), converti en objets Arena (choix du propriétaire, 20/10/2026).
   */
  async function analyserLolalytics(demande) {
    const { alias, role, mode } = await contexteBuild(demande);
    if (mode === "arena") {
      const objets = await objetsPourLolalytics();
      const arena = await lecteurLolalytics.analyserArena({ alias, ...objets }).catch(() => null);
      if (arena && Array.isArray(arena.emplacements) && arena.emplacements.some((e) => e.length > 0)) return arena;
      const roleFaille = await rolePrincipal(dossierJeu(), demande.championId, alias);
      const faille = await lecteurLolalytics.analyser({ alias, role: roleFaille, mode: "ranked", ...objets });
      const { noms } = await obtenirObjets();
      return enObjetsArena(faille, (id) => noms.has(id), objets.nomObjet);
    }
    return lecteurLolalytics.analyser({ alias, role, mode: mode === "flex" ? "ranked" : mode, ...(await objetsPourLolalytics()) });
  }

  /**
   * Set « Rank 1 » : le build des MEILLEURS JOUEURS du champion, emplacement par emplacement comme le build classique.
   * Lolalytics, filtre « 1trick » (jusqu'à 50 des meilleurs joueurs du champion par région, Diamant IV et plus,
   * 50 parties au moins sur lui) ; si trop peu de parties, Maître et plus. -> { emplacements, libelle, parties }.
   */
  async function analyserRank1(demande) {
    const { alias, role, mode } = await contexteBuild(demande);
    if (mode === "arena") throw pasPourCeMode(ErreurLolalytics, "Pas de set Rank 1 en Arena.");
    const objets = await objetsPourLolalytics();
    let derniere = null;
    for (const { tier, libelle } of TIERS_RANK1) {
      try {
        const analyse = await lecteurLolalytics.analyser({ alias, role, mode: "ranked", tier, ...objets });
        if (analyse.stats.parties >= PARTIES_MIN_RANK1) return { emplacements: analyse, libelle, parties: analyse.stats.parties };
        derniere = new ErreurLolalytics("Pas assez de parties des meilleurs joueurs sur ce champion.");
      } catch (erreur) {
        derniere = erreur;
      }
    }
    throw derniere || new ErreurLolalytics("Build des meilleurs joueurs indisponible.");
  }

  return { obtenirNomsChampions, obtenirAliasChampions, obtenirObjets, contexteBuild, analyserOpgg, analyserLolalytics, analyserRank1 };
}

module.exports = { creerStatsBuild, enObjetsArena, DECALAGE_ARENA, ROLE_DEPUIS_POSITION, TIERS_RANK1, PARTIES_MIN_RANK1 };
