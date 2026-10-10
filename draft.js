/*
 * Conseiller de draft (onglet "Sélection")
 * -----------------------------------------
 * Tourne dans le processus principal (Node). Lecture seule : il PROPOSE des champions, il ne choisit jamais.
 *
 * Idée (comme iTero.gg, en plus simple) : pour chaque champion que tu peux jouer, on part de son taux de victoire
 * à ton poste, puis on ajoute l'effet de chaque champion déjà VERROUILLÉ :
 *   - adversaire E : « delta 2 » de Lolalytics de E contre ton champion (vu de E, donc on prend l'opposé) ;
 *   - allié A      : « delta 2 » de la synergie de A avec ton champion.
 * Le « delta 2 » de Lolalytics, c'est l'écart du duo par rapport à ce qu'on attendrait des deux champions seuls :
 * il ne compte que l'effet du duo. Chaque effet est atténué quand il repose sur peu de parties (n / (n + 1 000)),
 * et le taux de base aussi (ramené vers 50 % pour un champion peu joué à ce poste, n / (n + 5 000)).
 * Enfin, un petit bonus « confort » selon tes propres parties sur ce champion (borné à ± 2 points).
 *
 * Sources (lolalytics.js, Émeraude et plus, patch en cours) : tier list de ton poste (1 page), page de chaque
 * adversaire verrouillé (ses matchups), synergies de chaque allié verrouillé (API build-team). Cache de 3 h.
 * Ce qui est envoyé : seulement des noms de champions et de postes. Aucun pseudo n'est lu ni affiché.
 */
const { monRole, championsIndisponibles } = require("./selection.js");

const PARTIES_MIN_BASE = 1000; // un champion rarement joué à ce poste n'est pas proposé (taux trop incertain)
const ATTENUATION = 1000; // effet × n / (n + 1000) : 1 000 parties -> moitié de l'effet
// Taux de base ramené vers 50 % quand le champion est peu joué à ce poste : 50 % + écart × n / (n + 5 000).
// Vu sur les vraies stats (04/10/2026) : Fiddlesticks milieu, 1 670 parties à 54 % (surtout des spécialistes),
// passait devant Ahri (199 182 parties à 52,5 %). Après correction : 51 % contre 52,4 %.
const PRUDENCE_BASE = 5000;
const CONFORT_MAX = 0.02; // ± 2 points au plus pour tes propres résultats
const NB_PROPOSITIONS = 5;
const NB_RAISONS = 3;
const FILES_FAILLE = new Set([400, 420, 430, 440, 480, 490]); // parties normales et classées de la Faille

// --- Lecture de la session (fonctions pures, testées) --------------------------------------------

const roleClient = (brut) => {
  const r = typeof brut === "string" ? brut.trim().toLowerCase() : "";
  return ["top", "jungle", "middle", "bottom", "utility"].includes(r) ? r : null;
};

/**
 * Champions VERROUILLÉS visibles : { allies: [{ id, role }], adversaires: [id] }, sans toi.
 * On se fie aux actions "pick" terminées (un survol ne compte pas : il peut encore changer).
 */
function picksVerrouilles(session) {
  const vide = { allies: [], adversaires: [] };
  if (!session || typeof session !== "object" || !Array.isArray(session.actions)) return vide;
  const cellules = (liste) => new Map((Array.isArray(liste) ? liste : []).filter((j) => j && Number.isInteger(j.cellId)).map((j) => [j.cellId, j]));
  const miens = cellules(session.myTeam);
  const leurs = cellules(session.theirTeam);
  const allies = [];
  const adversaires = [];
  for (const a of session.actions.flat()) {
    if (!a || a.type !== "pick" || a.completed !== true || !Number.isInteger(a.championId) || a.championId <= 0) continue;
    if (a.actorCellId === session.localPlayerCellId) continue;
    if (miens.has(a.actorCellId)) {
      if (!allies.some((x) => x.id === a.championId)) allies.push({ id: a.championId, role: roleClient(miens.get(a.actorCellId).assignedPosition) });
    } else if (leurs.has(a.actorCellId) && !adversaires.includes(a.championId)) {
      adversaires.push(a.championId);
    }
  }
  return { allies, adversaires };
}

/**
 * Bonus « confort » par champion (fraction, ± 2 points au plus), d'après tes parties de la Faille :
 * ton taux de victoire lissé (5 victoires + 5 défaites fictives, pour qu'une partie ne compte pas trop),
 * plus un petit bonus d'expérience (jusqu'à + 1 point à 20 parties).
 */
function confortParChampion(parties) {
  const comptes = new Map();
  for (const p of Array.isArray(parties) ? parties : []) {
    if (!p || !Number.isInteger(p.championId) || typeof p.victoire !== "boolean") continue;
    if (Number.isInteger(p.file) && !FILES_FAILLE.has(p.file)) continue;
    const c = comptes.get(p.championId) || { n: 0, v: 0 };
    c.n += 1;
    if (p.victoire) c.v += 1;
    comptes.set(p.championId, c);
  }
  const confort = new Map();
  for (const [id, { n, v }] of comptes) {
    const resultat = ((v + 5) / (n + 10) - 0.5) * 0.1;
    const experience = Math.min(n, 20) * 0.0005;
    confort.set(id, Math.max(-CONFORT_MAX, Math.min(CONFORT_MAX, resultat + experience)));
  }
  return confort;
}

/** Effet atténué d'un duo : delta × n / (n + 1 000). */
const effetAttenue = ({ delta, parties }) => delta * (parties / (parties + ATTENUATION));

/** Taux de base prudent : ramené vers 50 % selon le nombre de parties à ce poste. */
const basePrudente = ({ tauxVictoire, parties }) => 0.5 + (tauxVictoire - 0.5) * (parties / (parties + PRUDENCE_BASE));

/**
 * Classe les candidats.
 *  base       : Map id -> { tauxVictoire, parties } (tier list de ton poste)
 *  candidats  : ids que tu peux jouer (déjà sans les champions indisponibles)
 *  adversaires: [{ id, table }] table = Map candidat -> { delta, parties } vue de l'ADVERSAIRE
 *  allies     : [{ id, table }] table = Map candidat -> { delta, parties } (synergie)
 *  confort    : Map id -> bonus
 * -> [{ id, score, base, raisons: [{ type: "contre" | "avec" | "confort", id, effet }] }], meilleur d'abord.
 */
function conseillerDraft({ base, candidats, adversaires = [], allies = [], confort = new Map(), max = NB_PROPOSITIONS }) {
  const propositions = [];
  for (const id of new Set(candidats || [])) {
    const ligne = base && base.get(id);
    if (!ligne || !Number.isFinite(ligne.tauxVictoire) || !(ligne.parties >= PARTIES_MIN_BASE)) continue;
    const raisons = [];
    for (const { id: ennemi, table } of adversaires) {
      const duel = table && table.get(id);
      if (duel) raisons.push({ type: "contre", id: ennemi, effet: -effetAttenue(duel) });
    }
    for (const { id: allie, table } of allies) {
      const duo = table && table.get(id);
      if (duo) raisons.push({ type: "avec", id: allie, effet: effetAttenue(duo) });
    }
    const bonus = confort.get(id);
    if (Number.isFinite(bonus) && bonus !== 0) raisons.push({ type: "confort", id, effet: bonus });
    const score = basePrudente(ligne) + raisons.reduce((somme, r) => somme + r.effet, 0);
    raisons.sort((a, b) => Math.abs(b.effet) - Math.abs(a.effet));
    propositions.push({ id, score, base: ligne.tauxVictoire, raisons: raisons.filter((r) => Math.abs(r.effet) >= 0.001).slice(0, NB_RAISONS) });
  }
  propositions.sort((a, b) => b.score - a.score || a.id - b.id);
  return propositions.slice(0, max);
}

// --- Suivi de la sélection ---------------------------------------------------------------------------

/**
 * Recalcule les propositions quand la draft change (nouveau pick verrouillé, ban...), et les envoie à la page.
 *  actif()                 : la case « Conseiller de draft » est-elle cochée ?
 *  lecteur                 : lolalytics.js (tierlist, matchups, synergies)
 *  alias()                 : Map id -> nom interne ("MonkeyKing")
 *  jouables()              : Set des champions que tu peux choisir (possédés + gratuits), ou null
 *  parties()               : tes parties enregistrées (pour le confort)
 *  envoyer(etat | null)    : { etat: "calcul" | "pret" | "erreur" | "indisponible", role, propositions, message }
 */
function creerConseillerDraft({ actif, lecteur, alias, jouables, parties = () => [], envoyer, journal = () => {} }) {
  let derniereCle = null;
  let generation = 0;

  function effacer() {
    if (derniereCle === null) return;
    derniereCle = null;
    generation += 1;
    envoyer(null);
  }

  function surSession(session) {
    if (!session || !actif()) return effacer();
    const role = monRole(session);
    const { allies, adversaires } = picksVerrouilles(session);
    const indisponibles = [...championsIndisponibles(session)].sort((a, b) => a - b);
    const cle = JSON.stringify([session.gameId, role, allies, adversaires, indisponibles]);
    if (cle === derniereCle) return;
    derniereCle = cle;
    const numero = ++generation;
    if (!role) {
      envoyer({ etat: "indisponible", role: null, propositions: [], message: "Pas de poste attribué dans ce mode : le conseiller sert aux parties avec postes." });
      return;
    }
    envoyer({ etat: "calcul", role, propositions: [], message: null });
    return calculer({ role, allies, adversaires, indisponibles: new Set(indisponibles) }).then(
      (resultat) => numero === generation && envoyer({ etat: "pret", role, ...resultat }),
      (erreur) => {
        journal("Conseiller de draft :", erreur.message);
        if (numero === generation) envoyer({ etat: "erreur", role, propositions: [], message: erreur.message });
      }
    );
  }

  async function calculer({ role, allies, adversaires, indisponibles }) {
    const [tierlist, noms, possibles] = await Promise.all([lecteur.tierlist(role), alias(), jouables()]);
    const manquants = [];
    const lire = async (id, demander) => {
      const nom = noms.get(id);
      try {
        if (!nom) throw new Error("nom inconnu");
        return { id, table: await demander(nom) };
      } catch {
        manquants.push(id);
        return null;
      }
    };
    const [tablesAdversaires, tablesAllies] = await Promise.all([
      Promise.all(adversaires.map((id) => lire(id, (nom) => lecteur.matchups({ alias: nom, role })))),
      Promise.all(
        allies.filter((a) => a.role).map((a) => lire(a.id, (nom) => lecteur.synergies({ alias: nom, roleAllie: a.role, role, patch: tierlist.patch })))
      ),
    ]);
    const candidats = [...tierlist.lignes.keys()].filter((id) => !indisponibles.has(id) && (!possibles || possibles.has(id)));
    const propositions = conseillerDraft({
      base: tierlist.lignes,
      candidats,
      adversaires: tablesAdversaires.filter(Boolean),
      allies: tablesAllies.filter(Boolean),
      confort: confortParChampion(parties()),
    });
    return { propositions, manquants, patch: tierlist.patch, message: propositions.length ? null : "Aucun de tes champions n'a assez de parties à ce poste." };
  }

  return { surSession, effacer };
}

module.exports = {
  PARTIES_MIN_BASE,
  ATTENUATION,
  PRUDENCE_BASE,
  CONFORT_MAX,
  picksVerrouilles,
  confortParChampion,
  conseillerDraft,
  creerConseillerDraft,
};
