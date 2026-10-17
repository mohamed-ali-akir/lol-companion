/*
 * Statistiques de builds : serveur officiel d'OP.GG
 * -------------------------------------------------
 * Tourne dans le processus principal (Node).
 *
 * SEULE connexion à Internet de l'appli (décision du propriétaire, 02/10/2026) : le client League ne fournit
 * aucune statistique d'objets. On utilise le serveur public d'OP.GG prévu pour les applis ("OP.GG MCP Server",
 * https://github.com/opgginc/opgg-mcp), en lecture seule :
 *   POST https://mcp-api.op.gg/mcp  (JSON-RPC 2.0, méthode "tools/call", outil "lol_get_champion_analysis")
 *   arguments : { champion: "AHRI", position: "mid", game_mode: "ranked" | "flex" | "aram" | "urf", lang, desired_output_fields }
 * On n'envoie QUE le champion, le rôle, le mode et la langue : jamais ton Riot ID ni aucune donnée personnelle.
 * Set « Rank 1 » (case séparée, exception du 17/10/2026) : en plus, ton serveur et le Riot ID public des meilleurs
 * joueurs du classement du champion (rank1 ci-dessous ; jamais le tien).
 * Le certificat d'OP.GG est vérifié normalement (fetch de Node, aucune option de sécurité désactivée).
 *
 * Vérifié le 02/10/2026 :
 *  - la réponse n'est pas du JSON mais un texte propre à OP.GG : des lignes "class Nom: champ1,champ2"
 *    puis une expression "Nom(valeur1, valeur2, ...)" (listes [..], textes "..", nombres) -> analyserTexteOpgg ;
 *  - "position" est obligatoire, et "all" / "none" sont refusés malgré la documentation : en ARAM on envoie "mid"
 *    (les stats ARAM ne dépendent pas du rôle) ;
 *  - les noms sont tolérants : MONKEYKING, MONKEY_KING et WUKONG marchent tous (on envoie l'alias du client en majuscules) ;
 *  - un appel prend environ 2 à 6 secondes : on garde les réponses en mémoire quelques heures.
 */

const { creerCache, telecharger } = require("./internet.js"); // cache 3 h, User-Agent, délai maximal

const URL_OPGG = "https://mcp-api.op.gg/mcp";
const LANGUE = "fr_FR"; // noms des objets et des runes en français

const CHAMPS_DEMANDES = [
  "data.summary.average_stats.{play,win_rate,pick_rate}",
  "data.starter_items.{ids[],ids_names[],pick_rate,play,win}",
  "data.boots.{ids[],ids_names[],pick_rate,play,win}",
  "data.core_items.{ids[],ids_names[],pick_rate,play,win}",
  "data.fourth_items[].{ids[],ids_names[],pick_rate,play,win}",
  "data.fifth_items[].{ids[],ids_names[],pick_rate,play,win}",
  "data.sixth_items[].{ids[],ids_names[],pick_rate,play,win}",
  "data.summoner_spells.{ids[],ids_names[],pick_rate,play,win}",
  "data.runes.{primary_page_id,primary_page_name,primary_rune_ids[],primary_rune_names[],secondary_page_id,secondary_page_name,secondary_rune_ids[],secondary_rune_names[],stat_mod_ids[],pick_rate,play,win}",
];

// Rôles du client -> positions d'OP.GG.
const POSITIONS = { top: "top", jungle: "jungle", middle: "mid", bottom: "adc", utility: "support" };

class ErreurOpgg extends Error {}

// --- Lecture du format texte d'OP.GG (fonctions pures, testées) -------------------------------

/**
 * Transforme la réponse texte d'OP.GG en objets JavaScript.
 * Exemple : "class Stats: play,win\n\nResultat(Stats(10,6))" -> { stats: ... } selon les lignes "class".
 * Les champs de chaque "Nom(...)" sont nommés grâce à la ligne "class Nom: ...". Renvoie null si illisible.
 */
function analyserTexteOpgg(texte) {
  if (typeof texte !== "string") return null;
  const classes = new Map();
  const lignes = texte.split(/\r?\n/);
  const expression = [];
  for (const ligne of lignes) {
    const def = /^class\s+(\w+)\s*:\s*(.*)$/.exec(ligne.trim());
    if (def) classes.set(def[1], def[2].split(",").map((c) => c.trim()).filter(Boolean));
    else if (ligne.trim()) expression.push(ligne);
  }
  const source = expression.join("\n");
  let i = 0;

  const espaces = () => {
    while (i < source.length && /\s/.test(source[i])) i++;
  };
  const erreur = () => {
    throw new SyntaxError(`format OP.GG inattendu (position ${i})`);
  };

  function valeur() {
    espaces();
    const c = source[i];
    if (c === "[") {
      i++;
      const liste = [];
      espaces();
      if (source[i] === "]") return i++, liste;
      for (;;) {
        liste.push(valeur());
        espaces();
        if (source[i] === ",") i++;
        else if (source[i] === "]") return i++, liste;
        else erreur();
      }
    }
    if (c === '"' || c === "'") {
      let texteLu = "";
      i++;
      while (i < source.length && source[i] !== c) {
        if (source[i] === "\\" && i + 1 < source.length) i++;
        texteLu += source[i++];
      }
      if (source[i] !== c) erreur();
      i++;
      return texteLu;
    }
    const nombre = /^-?\d+(\.\d+)?([eE][-+]?\d+)?/.exec(source.slice(i));
    if (nombre) {
      i += nombre[0].length;
      return Number(nombre[0]);
    }
    const nom = /^[A-Za-z_]\w*/.exec(source.slice(i));
    if (!nom) erreur();
    i += nom[0].length;
    if (["None", "null"].includes(nom[0])) return null;
    if (["True", "true"].includes(nom[0])) return true;
    if (["False", "false"].includes(nom[0])) return false;
    espaces();
    if (source[i] !== "(") erreur();
    i++;
    const args = [];
    espaces();
    if (source[i] !== ")") {
      for (;;) {
        args.push(valeur());
        espaces();
        if (source[i] === ",") i++;
        else if (source[i] === ")") break;
        else erreur();
      }
    }
    i++;
    const champs = classes.get(nom[0]);
    if (!champs) return args.length === 1 ? args[0] : args; // classe inconnue : valeurs brutes
    const objet = {};
    champs.forEach((champ, n) => {
      if (n < args.length) objet[champ] = args[n];
    });
    return objet;
  }

  try {
    const resultat = valeur();
    return resultat && typeof resultat === "object" ? resultat : null;
  } catch {
    return null;
  }
}

const nombre = (n) => (Number.isFinite(n) && n >= 0 ? n : 0);

/** Une option de build : { ids, noms, parties, victoires, selection }, ou null. */
function optionDepuis(brut) {
  if (!brut || typeof brut !== "object" || !Array.isArray(brut.ids)) return null;
  const ids = brut.ids.filter((id) => Number.isInteger(id) && id > 0);
  if (ids.length === 0) return null;
  const noms = Array.isArray(brut.ids_names) ? brut.ids_names.map((n) => String(n)) : [];
  return { ids, noms, parties: nombre(brut.play), victoires: nombre(brut.win), selection: nombre(brut.pick_rate) };
}

const listeOptions = (brut) => (Array.isArray(brut) ? brut : [brut]).map(optionDepuis).filter(Boolean);

/** Runes d'OP.GG : { stylePrincipal, runesPrincipales, styleSecondaire, runesSecondaires, fragments, noms, ... }, ou null. */
function runesDepuis(brut) {
  if (!brut || typeof brut !== "object") return null;
  const ids = (l) => (Array.isArray(l) ? l.filter((id) => Number.isInteger(id) && id > 0) : []);
  const noms = (l) => (Array.isArray(l) ? l.map(String) : []);
  return {
    stylePrincipal: brut.primary_page_id,
    styleSecondaire: brut.secondary_page_id,
    nomStylePrincipal: typeof brut.primary_page_name === "string" ? brut.primary_page_name : null,
    nomStyleSecondaire: typeof brut.secondary_page_name === "string" ? brut.secondary_page_name : null,
    runesPrincipales: ids(brut.primary_rune_ids),
    runesSecondaires: ids(brut.secondary_rune_ids),
    fragments: ids(brut.stat_mod_ids),
    noms: [...noms(brut.primary_rune_names), ...noms(brut.secondary_rune_names)],
    parties: nombre(brut.play),
    victoires: nombre(brut.win),
    selection: nombre(brut.pick_rate),
  };
}

/** Analyse d'OP.GG (objet lu par analyserTexteOpgg) -> données propres et tolérantes. */
function analyseDepuis(brut) {
  const d = brut && brut.data && typeof brut.data === "object" ? brut.data : {};
  const moyenne = d.summary && d.summary.average_stats ? d.summary.average_stats : {};
  return {
    stats: { parties: nombre(moyenne.play), tauxVictoire: nombre(moyenne.win_rate), tauxSelection: nombre(moyenne.pick_rate) },
    depart: optionDepuis(d.starter_items),
    bottes: optionDepuis(d.boots),
    principaux: optionDepuis(d.core_items),
    quatrieme: listeOptions(d.fourth_items),
    cinquieme: listeOptions(d.fifth_items),
    sixieme: listeOptions(d.sixth_items),
    sorts: optionDepuis(d.summoner_spells),
    runes: runesDepuis(d.runes),
  };
}

/** Nom attendu par OP.GG à partir de l'alias du client ("MonkeyKing" -> "MONKEYKING"). */
const nomOpgg = (alias) => String(alias || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();

/** Position OP.GG : rôle du client, "mid" en ARAM, null si inconnue. */
function positionOpgg(role, mode) {
  if (mode === "aram") return "mid";
  return POSITIONS[role] || null;
}

/**
 * Mode OP.GG d'après la partie (session du "gameflow" du client) : "ranked", "flex", "aram", "urf",
 * ou null si OP.GG n'a pas de stats pour ce mode (Arena...). Les parties normales et l'outil d'entraînement
 * utilisent les stats classées.
 */
function modeOpgg(partie) {
  const donnees = partie && partie.gameData && partie.gameData.queue ? partie.gameData.queue : {};
  const modeJeu = String(donnees.gameMode || (partie && partie.map && partie.map.gameMode) || "").toUpperCase();
  const carte = (partie && partie.map && partie.map.id) || donnees.mapId;
  if (modeJeu === "ARAM" || carte === 12) return "aram";
  if (modeJeu === "URF") return "urf";
  // Outil d'entraînement : la Faille de l'invocateur, donc les mêmes stats qu'en classée.
  if (modeJeu && modeJeu !== "CLASSIC" && modeJeu !== "PRACTICETOOL") return null;
  return donnees.id === 440 ? "flex" : "ranked";
}

// --- Appel à OP.GG ------------------------------------------------------------------------

/**
 * Crée le lecteur OP.GG, avec un cache en mémoire.
 * url et appeler (fetch) sont modifiables pour les tests (faux serveur local).
 */
function creerLecteurOpgg({ url = URL_OPGG, appeler = (...a) => fetch(...a), maintenant = Date.now } = {}) {
  const { avecCache } = creerCache({ maintenant }); // "analyse|champion|position|mode" -> analyse, gardée 3 h

  /** Appelle un outil d'OP.GG et renvoie sa réponse lue (analyserTexteOpgg). Erreurs claires (ErreurOpgg). */
  async function appelerOutil(nomOutil, args) {
    const texte = await telecharger({
      appeler,
      adresse: url,
      options: {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: nomOutil, arguments: args } }),
      },
      site: "OP.GG",
      Erreur: ErreurOpgg,
    });
    // Réponse JSON, ou flux "data: {...}" selon le serveur.
    const ligne = texte.split("\n").find((l) => l.startsWith("data:"));
    let json;
    try {
      json = JSON.parse(ligne ? ligne.slice(5) : texte);
    } catch {
      throw new ErreurOpgg("Réponse illisible d'OP.GG.");
    }
    if (json.error) throw new ErreurOpgg(`OP.GG ne connaît pas ce champion ou ce rôle (${json.error.message || "erreur"}).`);
    const contenu = json.result && Array.isArray(json.result.content) ? json.result.content.map((c) => c && c.text).join("\n") : "";
    const brut = analyserTexteOpgg(contenu);
    if (!brut) throw new ErreurOpgg("Format de réponse d'OP.GG inattendu.");
    return brut;
  }

  async function analyser({ alias, position, mode }) {
    const champion = nomOpgg(alias);
    if (!champion || !position || !mode) throw new ErreurOpgg("Champion, rôle ou mode de jeu inconnu.");
    return avecCache(`analyse|${champion}|${position}|${mode}`, async () => {
      const brut = await appelerOutil("lol_get_champion_analysis", {
        champion, position, game_mode: mode, lang: LANGUE, desired_output_fields: CHAMPS_DEMANDES,
      });
      const analyse = analyseDepuis(brut);
      if (!analyse.principaux && analyse.quatrieme.length === 0) throw new ErreurOpgg("Pas assez de parties sur OP.GG pour ce champion et ce rôle.");
      return analyse;
    });
  }

  // (Les augments ARAM viennent d'arammayhem.js : l'outil lol_list_aram_augments d'OP.GG ne donne qu'une
  //  « popularité » sans taux de victoire, aux chiffres douteux ; abandonné le 02/10/2026.)

  return { analyser };
}

module.exports = {
  URL_OPGG,
  POSITIONS,
  ErreurOpgg,
  analyserTexteOpgg,
  analyseDepuis,
  nomOpgg,
  positionOpgg,
  modeOpgg,
  creerLecteurOpgg,
};
