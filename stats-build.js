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
 *    ARAM (choix du propriétaire, 17/10/2026) ; sans rôle, le rôle principal du champion d'après Riot ;
 *  - analyserOpgg : runes, sorts, objets de secours (OP.GG) ; en ARAM ou en URF, les sorts de CE mode ;
 *  - analyserLolalytics : objets emplacement par emplacement (Lolalytics) ;
 *  - analyserRank1 : build des meilleurs joueurs (Lolalytics, filtre « 1trick », sinon Maître et plus).
 */
const { modeOpgg, positionOpgg, ErreurOpgg } = require("./opgg.js");
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
  let objetsClient = { noms: new Map(), categories: new Map(), details: new Map() }; // noms, catégories et prix des objets

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
   * Sans rôle (partie sans rôles, ARAM), on prend le rôle principal du champion d'après les recommandations de Riot.
   */
  async function contexteBuild({ championId, role, mode }) {
    const dossier = dossierJeu();
    const modeJeu = mode || modeOpgg(await client.lirePartie(dossier).catch(() => null)) || "ranked";
    const modeUtilise = mode || (modeJeu === "flex" ? "flex" : "ranked");
    let roleUtilise = role;
    if (!roleUtilise && modeUtilise !== "aram") {
      const pages = await client.lireRecommandations(dossier, championId, null).catch(() => []);
      roleUtilise = ROLE_DEPUIS_POSITION[String((pages[0] && pages[0].position) || "").toUpperCase()] || "middle";
    }
    const alias = (await obtenirAliasChampions()).get(championId);
    if (!alias) throw new ErreurOpgg("Champion inconnu : lance le client League.");
    return { alias, role: roleUtilise, mode: modeUtilise, modeJeu };
  }

  /**
   * Stats OP.GG d'un champion (runes, sorts, objets en secours) : celles de la Faille. En ARAM ou en URF, les sorts
   * d'invocateur viennent quand même des stats de CE mode : ceux de la Faille (Téléportation, Châtiment) n'y existent pas.
   */
  async function analyserOpgg(demande) {
    const { alias, role, mode, modeJeu } = await contexteBuild(demande);
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

  /** Objets emplacement par emplacement (Lolalytics), avec les noms des objets du client. */
  async function analyserLolalytics(demande) {
    const { alias, role, mode } = await contexteBuild(demande);
    return lecteurLolalytics.analyser({ alias, role, mode: mode === "flex" ? "ranked" : mode, ...(await objetsPourLolalytics()) });
  }

  /**
   * Set « Rank 1 » : le build des MEILLEURS JOUEURS du champion, emplacement par emplacement comme le build classique.
   * Lolalytics, filtre « 1trick » (jusqu'à 50 des meilleurs joueurs du champion par région, Diamant IV et plus,
   * 50 parties au moins sur lui) ; si trop peu de parties, Maître et plus. -> { emplacements, libelle, parties }.
   */
  async function analyserRank1(demande) {
    const { alias, role } = await contexteBuild(demande);
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

module.exports = { creerStatsBuild, ROLE_DEPUIS_POSITION, TIERS_RANK1, PARTIES_MIN_RANK1 };
