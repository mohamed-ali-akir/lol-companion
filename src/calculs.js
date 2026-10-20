/*
 * LoL Companion : calculs (fonctions "pures")
 * -------------------------------------------
 * Ce fichier ne touche jamais à la page (pas de document, pas de window.appli) :
 * il ne fait que des calculs. Il est utilisé à trois endroits :
 *  - dans la page, chargé par un <script> classique (ses fonctions deviennent globales) ;
 *  - dans main.js (require), pour calculer l'XP totale des points de progression ;
 *  - dans les tests (require), pour vérifier chaque calcul.
 */

// XP nécessaire pour passer du niveau N au niveau N+1
// (source : https://wiki.leagueoflegends.com/en-us/Experience_(summoner)).
const XP_POUR_NIVEAU_SUIVANT = {
  1: 144, 2: 144, 3: 192, 4: 240, 5: 336, 6: 432, 7: 528, 8: 624, 9: 720,
  10: 816, 11: 912, 12: 984, 13: 1056, 14: 1128, 15: 1344, 16: 1440, 17: 1536,
  18: 1680, 19: 1824, 20: 1968, 21: 2112, 22: 2208, 23: 2304, 24: 2304,
  25: 2496, 26: 2496, 27: 2592, 28: 2688, 29: 2688,
  30: 2688, 31: 2688, 32: 2688, 33: 2784, 34: 2784, 35: 2784, 36: 2880,
  37: 2880, 38: 2880, 39: 3072, 40: 3072, 41: 3168, 42: 3168, 43: 3264,
  44: 3264, 45: 3360, 46: 3360, 47: 3456, 48: 3456, 49: 3456,
};

// À partir du niveau 50, les besoins en XP suivent ce cycle de 25 niveaux, qui se répète
// (niveaux 50 à 74, puis 75 à 99, etc.). Même source que ci-dessus.
const CYCLE_APRES_50 = [
  2592, 2688, 2688, 2688, 2688, 2880, 2880, 2880, 3072, 3072, 3072, 3264, 3264,
  3264, 3360, 3360, 3360, 3456, 3456, 3456, 3456, 3552, 3552, 3648, 3648,
];

// Les modes calculés d'office (dans l'ordre d'affichage), avec la durée utilisée quand on n'a pas
// (ou pas assez) de parties récentes du joueur dans ce mode. Mêmes clés que FILES dans lcu.js.
const MODES = {
  mayhem: { nom: "ARAM du Chaos", duree: 18 },
  aram: { nom: "ARAM", duree: 20 },
  swiftplay: { nom: "Swiftplay", duree: 20 },
  draft: { nom: "Draft", precision: "normale", duree: 30 },
};
const TAUX_VICTOIRE_PAR_DEFAUT = 0.5;
const MIN_PARTIES_POUR_STATS = 3; // en dessous, l'historique n'est pas assez fiable

const DUREE_MINIMUM_MIN = 7;   // en dessous de 7 minutes, une partie ne rapporte rien

// Temps "perdu" entre deux parties, en minutes (surtout la file d'attente). Il ne rapporte pas d'XP, mais il compte
// dans les heures et les jours nécessaires (onglet Niveau) et dans le temps passé sur LoL (onglet Stats).
// 2 minutes depuis le 16/10/2026 (avant : 5) : avec ça, le temps passé sur LoL tombe à 2 % de wol.gg.
const ATTENTE_PAR_PARTIE_MIN = 2;
const BONUS_BOOST_VICTOIRE = 216;

/** XP nécessaire pour passer du niveau donné au suivant. */
function xpPourNiveauSuivant(niveau) {
  if (niveau < 50) return XP_POUR_NIVEAU_SUIVANT[niveau];
  return CYCLE_APRES_50[(niveau - 50) % CYCLE_APRES_50.length];
}

/** XP totale accumulée depuis le niveau 1 jusqu'au début d'un niveau donné. */
function xpTotaleAuNiveau(niveau) {
  let total = 0;
  for (let n = 1; n < niveau; n++) total += xpPourNiveauSuivant(n);
  return total;
}

/** Pourcentage d'XP donné par les parties contre des bots selon le niveau. */
function multiplicateurBots(niveau) {
  if (niveau < 10) return 1;
  if (niveau < 20) return 0.9;
  if (niveau < 30) return 0.8;
  return 0.75;
}

/**
 * XP moyenne gagnée sur une partie.
 * Formule du wiki : victoire = 0,11 XP/s + 6,6 ; défaite = 0,09 XP/s + 5,4.
 */
function xpMoyenneParPartie({ dureeMin, tauxVictoire, niveau, bots, boostDuree, boostVictoire }) {
  if (dureeMin < DUREE_MINIMUM_MIN) return 0;

  const secondes = dureeMin * 60;
  const xpVictoire = secondes * 0.11 + 6.6;
  const xpDefaite = secondes * 0.09 + 5.4;

  let xp = tauxVictoire * xpVictoire + (1 - tauxVictoire) * xpDefaite;
  if (bots) xp *= multiplicateurBots(niveau);
  if (boostDuree) xp *= 2;
  if (boostVictoire) xp += tauxVictoire * BONUS_BOOST_VICTOIRE;

  return xp;
}

/**
 * Simule les parties une par une jusqu'au niveau visé.
 * On simule partie par partie car l'XP des bots change selon le niveau.
 */
function calculer(params) {
  const { niveauActuel, progression, niveauCible, dureeMin, attenteMin, heuresParJour } = params;

  let niveau = niveauActuel;
  let xpDansNiveau = xpPourNiveauSuivant(niveau) * (progression / 100);
  const xpDepart = xpTotaleAuNiveau(niveau) + xpDansNiveau;
  const xpCible = xpTotaleAuNiveau(niveauCible);

  let parties = 0;
  while (niveau < niveauCible) {
    const gain = xpMoyenneParPartie({ ...params, niveau });
    if (gain <= 0) return null; // partie trop courte : on n'atteindra jamais le niveau

    xpDansNiveau += gain;
    parties++;

    while (niveau < niveauCible && xpDansNiveau >= xpPourNiveauSuivant(niveau)) {
      xpDansNiveau -= xpPourNiveauSuivant(niveau);
      niveau++;
    }
  }

  const heures = (parties * (dureeMin + attenteMin)) / 60;

  return {
    parties,
    heures,
    jours: Math.ceil(heures / heuresParJour),
    xpRestante: Math.round(xpCible - xpDepart),
    xpParPartie: Math.round(xpMoyenneParPartie({ ...params, niveau: niveauActuel })),
    pourcentageCompte: xpDepart / xpCible,
  };
}

/**
 * Calcule tous les modes d'un coup.
 * statsParMode vient de l'historique du client : { mayhem: {parties, dureeMoyenneMin, tauxVictoire}, draft: ... }.
 * Si un mode n'a pas assez de parties récentes, on utilise les valeurs par défaut.
 */
function calculerModes(communs, statsParMode = {}) {
  const resultats = {};
  for (const [mode, defaut] of Object.entries(MODES)) {
    const stats = statsParMode[mode];
    const perso = Boolean(stats) && stats.parties >= MIN_PARTIES_POUR_STATS;
    const dureeMin = perso ? stats.dureeMoyenneMin : defaut.duree;
    const tauxVictoire = perso ? stats.tauxVictoire : TAUX_VICTOIRE_PAR_DEFAUT;

    resultats[mode] = {
      dureeMin,
      tauxVictoire,
      perso,
      partiesAnalysees: stats ? stats.parties : 0,
      resultat: calculer({ ...communs, dureeMin, tauxVictoire, bots: false }),
    };
  }
  return resultats;
}

/** Niveau visé proposé après la récupération : 30 (classées), sinon le prochain multiple de 25. */
function niveauParDefaut(niveau) {
  if (niveau < 30) return 30;
  return Math.ceil((niveau + 1) / 25) * 25;
}

/**
 * Compare les modes calculés. Renvoie { mode, ecartHeures } : le mode le plus rapide et
 * combien d'heures il fait gagner par rapport au plus lent. null si aucun mode n'est calculable.
 */
function modeLePlusRapide(calculs) {
  const valables = Object.entries(calculs).filter(([, c]) => c && c.resultat);
  if (valables.length === 0) return null;
  valables.sort(([, a], [, b]) => a.resultat.heures - b.resultat.heures);
  const [mode, rapide] = valables[0];
  const lent = valables[valables.length - 1][1];
  return { mode, ecartHeures: lent.resultat.heures - rapide.resultat.heures };
}

/** "Données du 30/09 à 18:05 — lance League pour les mettre à jour" (date au format ISO). */
function texteDonneesDu(dateIso) {
  const date = new Date(dateIso);
  const jour = date.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
  const heure = date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  return `Données du ${jour} à ${heure} — lance League pour les mettre à jour.`;
}

/** "d'ARAM" mais "de Draft" : élision devant une voyelle. */
function de(nom) {
  return /^[aeiouyàâéèêëîïôöûüh]/i.test(nom) ? `d'${nom}` : `de ${nom}`;
}

/** ["a", "b", "c"] -> "a, b et c" */
function joindreListe(elements) {
  if (elements.length <= 1) return elements.join("");
  return `${elements.slice(0, -1).join(", ")} et ${elements[elements.length - 1]}`;
}

/**
 * Assemble les paramètres du calcul :
 *  - compte : niveau et progression, venant UNIQUEMENT du client League ;
 *  - objectif : ce que l'utilisateur choisit (niveau visé, temps de jeu, boosts).
 */
function parametresCalcul(compte, objectif) {
  return {
    niveauActuel: compte.niveau,
    progression: compte.progression,
    attenteMin: ATTENTE_PAR_PARTIE_MIN,
    ...objectif,
  };
}

/** XP totale d'un compte { niveau, progression } depuis le niveau 1 (progression en %). */
function xpDuCompte(c) {
  return xpTotaleAuNiveau(c.niveau) + xpPourNiveauSuivant(c.niveau) * (c.progression / 100);
}

/**
 * XP gagnée entre deux lectures du compte (arrondie). La progression du client est un
 * pourcentage arrondi : le résultat est donc approximatif, à quelques XP près.
 */
function xpGagnee(avant, apres) {
  if (!avant || !apres) return 0;
  return Math.max(0, Math.round(xpDuCompte(apres) - xpDuCompte(avant)));
}

// ---------------------------------------------------------------------------
// Suivi de progression : rythme réel, date estimée, géométrie du graphique
// ---------------------------------------------------------------------------

const JOUR_MS = 24 * 60 * 60 * 1000;

/** Niveau correspondant à une XP totale (inverse de xpTotaleAuNiveau). */
function niveauDepuisXp(xp) {
  let niveau = 1;
  let total = 0;
  while (total + xpPourNiveauSuivant(niveau) <= xp && niveau < 5000) {
    total += xpPourNiveauSuivant(niveau);
    niveau++;
  }
  return niveau;
}

/** Jour local (AAAA-M-J) d'une date, pour compter les jours différents. */
const jourDe = (date) => {
  const d = new Date(date);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};

/**
 * Rythme réel sur les derniers jours : { xpParJour, jours }.
 * On part du dernier point d'avant la fenêtre (sinon du premier point) jusqu'au plus récent.
 * null s'il y a des points sur moins de 2 jours différents (pas assez de recul).
 */
function rythmeRecent(points, maintenant = new Date(), jours = 7) {
  if (!Array.isArray(points) || points.length < 2) return null;
  const tries = [...points].sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  if (new Set(tries.map((p) => jourDe(p.date))).size < 2) return null;

  const limite = maintenant.getTime() - jours * JOUR_MS;
  const avant = tries.filter((p) => Date.parse(p.date) <= limite);
  const debut = avant.length ? avant[avant.length - 1] : tries[0];
  const fin = tries[tries.length - 1];
  const duree = Math.max(1, (Date.parse(fin.date) - Date.parse(debut.date)) / JOUR_MS);
  return { xpParJour: Math.max(0, (fin.xpTotale - debut.xpTotale) / duree), jours: Math.round(duree) };
}

/** Date à laquelle on atteint l'objectif à ce rythme, ou null si le rythme est nul. */
function dateEstimee(xpRestante, xpParJour, maintenant = new Date()) {
  if (!(xpParJour > 0)) return null;
  return new Date(maintenant.getTime() + (Math.max(0, xpRestante) / xpParJour) * JOUR_MS);
}

const formatJourMois = (date) => new Date(date).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });

/** Phrase sous le graphique. */
function texteRythme(points, xpRestante, maintenant = new Date()) {
  const rythme = rythmeRecent(points, maintenant);
  if (!rythme) return "Reviens après quelques parties pour voir ta courbe.";
  const xp = Math.round(rythme.xpParJour).toLocaleString("fr-FR");
  const periode = rythme.jours >= 7 ? "les 7 derniers jours" : `les ${Math.max(2, rythme.jours)} derniers jours`;
  const date = dateEstimee(xpRestante, rythme.xpParJour, maintenant);
  return (
    `Rythme réel : +${xp} XP par jour en moyenne sur ${periode}. ` +
    (date ? `À ce rythme, niveau visé atteint vers le ${formatJourMois(date)}.` : "Joue quelques parties pour avoir une date estimée.")
  );
}

/**
 * Courbe "prévue" : de l'XP actuelle aujourd'hui jusqu'à l'XP visée, au bout de
 * (heures de jeu nécessaires ÷ heures de jeu par jour) jours.
 */
function projectionPrevue({ xpActuelle, xpCible, heures, heuresParJour, maintenant = new Date() }) {
  const jours = heures / heuresParJour;
  return [
    { date: maintenant.toISOString(), xpTotale: xpActuelle },
    { date: new Date(maintenant.getTime() + jours * JOUR_MS).toISOString(), xpTotale: xpCible },
  ];
}

/** Ne garde que quelques graduations régulières (au plus "max"). */
function espacer(valeurs, max) {
  if (valeurs.length <= max) return valeurs;
  const pas = Math.ceil(valeurs.length / max);
  return valeurs.filter((_, i) => i % pas === 0);
}

/**
 * Calcule tout ce qu'il faut pour dessiner le graphique en SVG :
 * chemins des deux courbes, graduations (niveaux entiers à gauche, dates en bas), points survolables.
 * Axe vertical en XP totale (les écarts entre niveaux sont donc à la bonne échelle).
 */
function geometrieGraphique(points, projection, { largeur = 640, hauteur = 240, marge = { haut: 12, droite: 16, bas: 28, gauche: 56 } } = {}) {
  const tous = [...points, ...projection];
  if (tous.length === 0) return null;

  const temps = tous.map((p) => Date.parse(p.date));
  let tMin = Math.min(...temps);
  let tMax = Math.max(...temps);
  if (tMax - tMin < JOUR_MS) tMax = tMin + JOUR_MS; // au moins un jour de large

  const xps = tous.map((p) => p.xpTotale);
  const nivMin = niveauDepuisXp(Math.min(...xps));
  const nivMax = niveauDepuisXp(Math.max(...xps) - 1) + 1;
  const yMin = xpTotaleAuNiveau(nivMin);
  const yMax = Math.max(xpTotaleAuNiveau(nivMax), yMin + 1);

  const zoneL = largeur - marge.gauche - marge.droite;
  const zoneH = hauteur - marge.haut - marge.bas;
  const x = (date) => marge.gauche + ((Date.parse(date) - tMin) / (tMax - tMin)) * zoneL;
  const y = (xp) => marge.haut + (1 - (xp - yMin) / (yMax - yMin)) * zoneH;
  const arrondi = (n) => Math.round(n * 10) / 10;
  const chemin = (liste) =>
    liste.map((p, i) => `${i === 0 ? "M" : "L"}${arrondi(x(p.date))} ${arrondi(y(p.xpTotale))}`).join(" ");

  const niveaux = [];
  for (let n = nivMin; n <= nivMax; n++) niveaux.push(n);
  const graduationsNiveaux = espacer(niveaux, 6).map((n) => ({ niveau: n, y: arrondi(y(xpTotaleAuNiveau(n))) }));

  const graduationsDates = [];
  for (let i = 0; i < 4; i++) {
    const t = tMin + ((tMax - tMin) * i) / 3;
    graduationsDates.push({ x: arrondi(x(new Date(t).toISOString())), texte: formatJourMois(t) });
  }

  return {
    largeur,
    hauteur,
    marge,
    reel: points.length ? chemin(points) : "",
    prevu: projection.length ? chemin(projection) : "",
    graduationsNiveaux,
    graduationsDates,
    pointsReels: points.map((p) => ({ x: arrondi(x(p.date)), y: arrondi(y(p.xpTotale)), point: p })),
  };
}

/** Vérifie les paramètres du calcul. Renvoie un message d'erreur, ou null si tout va bien. */
function verifier(p) {
  if ([p.niveauCible, p.heuresParJour].some(Number.isNaN)) return "Remplis le niveau visé et le temps de jeu par jour.";
  if (p.niveauCible > 5000) return "Le calculateur va jusqu'au niveau 5000.";
  if (p.niveauCible <= p.niveauActuel) return "Le niveau visé doit être plus haut que ton niveau actuel.";
  if (p.heuresParJour <= 0) return "Indique un temps de jeu par jour.";
  return null;
}

/**
 * Résume en une phrase ce qu'on a trouvé dans l'historique du client.
 * Chaque partie du total est expliquée : comptée dans un mode, autre mode, ou ignorée (remake).
 */
function texteHistorique(stats) {
  if (!stats || !stats.total) return "";
  const debut = stats.total > 1 ? `Dans tes ${stats.total} dernières parties` : "Dans ta dernière partie";
  const parMode = Object.entries(MODES)
    .filter(([mode]) => stats[mode] && stats[mode].parties > 0)
    .map(([mode, d]) => `${stats[mode].parties} en ${d.nom}`);
  const comptees = Object.keys(MODES).reduce((n, mode) => n + (stats[mode] ? stats[mode].parties : 0), 0);

  const phrases = [
    parMode.length ? `${debut} : ${joindreListe(parMode)}.` : `${debut} : aucune dans un mode suivi (ARAM du Chaos, ARAM, Swiftplay, Draft).`,
  ];
  const pluriel = (n, un, plusieurs) => `${n} ${n > 1 ? plusieurs : un}`;
  if (stats.autresModes === undefined) {
    // Données enregistrées par une ancienne version : on ne sait pas pourquoi, mais on le dit.
    const reste = stats.total - comptees;
    if (reste > 0) phrases.push(`${pluriel(reste, "autre partie non comptée", "autres parties non comptées")} (autre mode ou remake).`);
  } else {
    if (stats.autresModes > 0) {
      phrases.push(`${pluriel(stats.autresModes, "partie dans un autre mode", "parties dans d'autres modes")} (classée, Arena, partie perso…), non comptée${stats.autresModes > 1 ? "s" : ""}.`);
    }
    if (stats.ignorees > 0) {
      phrases.push(`${pluriel(stats.ignorees, "remake ignoré", "remakes ignorés")} (partie de moins de 5 min).`);
    }
  }
  if (comptees > 0) phrases.push("Les parties comptées donnent ta durée moyenne et ton taux de victoire par mode.");
  return phrases.join(" ");
}

/**
 * Résumé de l'objectif pour l'Accueil : le mode le plus rapide et ce qu'il demande.
 * { mode, nom, parties, heures, jours } ou null si aucun mode n'est calculable.
 */
function resumeObjectif(calculs) {
  const meilleur = modeLePlusRapide(calculs);
  if (!meilleur) return null;
  const r = calculs[meilleur.mode].resultat;
  return { mode: meilleur.mode, nom: MODES[meilleur.mode].nom, parties: r.parties, heures: r.heures, jours: r.jours };
}

// ---------------------------------------------------------------------------
// Onglet "Stats" : agrégations sur l'historique local des parties
// ---------------------------------------------------------------------------

// Noms des files de jeu les plus courantes (liste officielle : queues.json de Riot).
const NOMS_FILES = {
  400: "Draft", 420: "Classée Solo/Duo", 430: "Blind", 440: "Classée Flex", 450: "ARAM", 480: "Swiftplay",
  490: "Quickplay", 700: "Clash", 830: "Coop vs IA", 840: "Coop vs IA", 850: "Coop vs IA", 900: "URF",
  1700: "Arena", 1710: "Arena", 1750: "Arena 3x6", 1900: "URF", 2400: "ARAM du Chaos",
};
const MIN_PARTIES_CHAMPION = 3; // pour les "meilleurs champions"
const MIN_PARTIES_CRENEAUX = 10; // pour afficher les stats par tranche horaire et par jour
const MIN_PARTIES_LIGNE = 3; // en dessous, une tranche ou un jour n'a pas de taux affiché

const nomFile = (file) => NOMS_FILES[file] || (Number.isInteger(file) ? `Autre mode (file ${file})` : "Mode inconnu");

/** KDA = (éliminations + assistances) / morts. Avec 0 mort : "parfait", et on renvoie K + A. */
function kda(kills, deaths, assists) {
  return { valeur: deaths > 0 ? (kills + assists) / deaths : kills + assists, parfait: deaths === 0 };
}

/** Regroupe les parties par clé (champion, file...) : parties, victoires, taux, K/D/A moyens, KDA. */
function agreger(parties, cleDe) {
  const groupes = new Map();
  for (const p of Array.isArray(parties) ? parties : []) {
    const cle = cleDe(p);
    if (!groupes.has(cle)) groupes.set(cle, { cle, parties: 0, victoires: 0, kills: 0, deaths: 0, assists: 0 });
    const g = groupes.get(cle);
    g.parties++;
    if (p.victoire) g.victoires++;
    g.kills += p.kills;
    g.deaths += p.deaths;
    g.assists += p.assists;
  }
  return [...groupes.values()].map((g) => ({
    ...g,
    tauxVictoire: g.victoires / g.parties,
    moyennes: { kills: g.kills / g.parties, deaths: g.deaths / g.parties, assists: g.assists / g.parties },
    kda: kda(g.kills, g.deaths, g.assists),
  }));
}

/** Stats par champion, du plus joué au moins joué. Le nom vient de la partie (championNom). */
function statsParChampion(parties) {
  const noms = new Map();
  for (const p of parties || []) if (p.championNom) noms.set(p.championId, p.championNom);
  return agreger(parties, (p) => p.championId)
    .map((g) => ({ ...g, championId: g.cle, nom: noms.get(g.cle) || (g.cle ? `Champion ${g.cle}` : "Inconnu") }))
    .sort((a, b) => b.parties - a.parties || b.tauxVictoire - a.tauxVictoire);
}

/** Stats par mode (file de jeu), du plus joué au moins joué. */
function statsParMode(parties) {
  return agreger(parties, (p) => p.file)
    .map((g) => ({ ...g, file: g.cle, nom: nomFile(g.cle) }))
    .sort((a, b) => b.parties - a.parties);
}

/** Les meilleurs champions : au moins "min" parties, meilleur taux de victoire, puis meilleur KDA. */
function meilleursChampions(statsChampions, { min = MIN_PARTIES_CHAMPION, nombre = 3 } = {}) {
  return (statsChampions || [])
    .filter((c) => c.parties >= min)
    .sort((a, b) => b.tauxVictoire - a.tauxVictoire || b.kda.valeur - a.kda.valeur || b.parties - a.parties)
    .slice(0, nombre);
}

const TRANCHES = [
  { cle: "matin", nom: "Matin (6 h – 12 h)", de: 6, a: 12 },
  { cle: "apresMidi", nom: "Après-midi (12 h – 18 h)", de: 12, a: 18 },
  { cle: "soir", nom: "Soir (18 h – minuit)", de: 18, a: 24 },
  { cle: "nuit", nom: "Nuit (minuit – 6 h)", de: 0, a: 6 },
];
const JOURS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

/** Tranche horaire (heure locale) d'une date. */
function trancheDe(date) {
  const h = new Date(date).getHours();
  return TRANCHES.find((t) => h >= t.de && h < t.a).cle;
}

/** Jour de la semaine (0 = lundi ... 6 = dimanche, heure locale). */
const indiceJour = (date) => (new Date(date).getDay() + 6) % 7;

/**
 * Taux de victoire par créneau (tranches horaires ou jours) : null s'il y a moins de MIN_PARTIES_CRENEAUX parties.
 * Chaque ligne : { nom, parties, victoires, tauxVictoire (null si moins de MIN_PARTIES_LIGNE parties) }.
 */
function statsParCreneau(parties, type) {
  const liste = Array.isArray(parties) ? parties : [];
  if (liste.length < MIN_PARTIES_CRENEAUX) return null;
  const creneaux = type === "jours" ? JOURS.map((nom, i) => ({ cle: i, nom })) : TRANCHES;
  const cleDe = type === "jours" ? (p) => indiceJour(p.date) : (p) => trancheDe(p.date);
  const groupes = new Map(agreger(liste, cleDe).map((g) => [g.cle, g]));
  return creneaux.map(({ cle, nom }) => {
    const g = groupes.get(cle);
    const nb = g ? g.parties : 0;
    return { nom, parties: nb, victoires: g ? g.victoires : 0, tauxVictoire: nb >= MIN_PARTIES_LIGNE ? g.victoires / nb : null };
  });
}

/** Série en cours : { victoire, longueur } à partir de la partie la plus récente, ou null. */
function serieEnCours(parties) {
  const triees = [...(Array.isArray(parties) ? parties : [])].sort((a, b) => b.date - a.date);
  if (triees.length === 0) return null;
  const victoire = triees[0].victoire;
  let longueur = 0;
  for (const p of triees) {
    if (p.victoire !== victoire) break;
    longueur++;
  }
  return { victoire, longueur };
}

/** Résumé global : { parties, victoires, tauxVictoire, kda, serie, depuis } ou null si aucune partie. */
function resumeStats(parties) {
  const liste = Array.isArray(parties) ? parties : [];
  if (liste.length === 0) return null;
  const [g] = agreger(liste, () => "tout");
  return { parties: g.parties, victoires: g.victoires, tauxVictoire: g.tauxVictoire, kda: g.kda, serie: serieEnCours(liste), depuis: Math.min(...liste.map((p) => p.date)) };
}

/** Parties des "jours" derniers jours (null = toutes), par rapport à "maintenant". */
function filtrerParPeriode(parties, jours, maintenant = Date.now()) {
  const liste = Array.isArray(parties) ? parties : [];
  if (!Number.isFinite(jours)) return liste;
  const limite = maintenant - jours * JOUR_MS;
  return liste.filter((p) => p.date >= limite);
}

/** Parties d'une file ("tous" = toutes). */
function filtrerParFile(parties, file) {
  const liste = Array.isArray(parties) ? parties : [];
  return file === "tous" || file === undefined ? liste : liste.filter((p) => p.file === file);
}

/**
 * Géométrie d'un graphique en barres horizontales "taux de victoire par créneau" (0 à 100 %).
 * lignes : [{ nom, parties, tauxVictoire }] ; les lignes sans taux (trop peu de parties) n'ont pas de barre.
 * Renvoie { largeur, hauteur, x50, barres: [{ y, largeur, nom, texte, parties, vide }] }.
 */
function geometrieBarres(lignes, { largeur = 780, gauche = 190, droite = 120, hauteurLigne = 30, epaisseur = 16 } = {}) {
  const zone = largeur - gauche - droite;
  const barres = (lignes || []).map((l, i) => {
    const vide = l.tauxVictoire === null || l.tauxVictoire === undefined;
    return {
      y: i * hauteurLigne + (hauteurLigne - epaisseur) / 2,
      largeur: vide ? 0 : Math.round(l.tauxVictoire * zone * 10) / 10,
      nom: l.nom,
      parties: l.parties,
      texte: vide ? (l.parties ? "trop peu" : "—") : `${Math.round(l.tauxVictoire * 100)} %`,
      vide,
    };
  });
  return { largeur, hauteur: barres.length * hauteurLigne, gauche, zone, epaisseur, x50: gauche + zone / 2, barres };
}

/** Tri du tableau des champions (colonne + sens), sans modifier la liste reçue. */
function trierChampions(champions, colonne, sens = "desc") {
  const valeur = {
    nom: (c) => c.nom,
    parties: (c) => c.parties,
    tauxVictoire: (c) => c.tauxVictoire,
    kda: (c) => c.kda.valeur,
  }[colonne] || ((c) => c.parties);
  const signe = sens === "asc" ? 1 : -1;
  return [...(champions || [])].sort((a, b) => {
    const va = valeur(a);
    const vb = valeur(b);
    const comparaison = typeof va === "string" ? va.localeCompare(vb, "fr") : va - vb;
    return signe * comparaison || b.parties - a.parties;
  });
}

// --- Maîtrise des champions (onglet Maîtrise) ------------------------------------------------
// Chaque champion vient de maitrise.js (main.js) :
// { championId, nom, niveau, points, restants, marquesRequises, marquesObtenues, marquesManquantes,
//   palier, moyenneParPartie, partiesMesurees, partiesEnregistrees, ... }. Tout champ peut manquer.

/**
 * Nombre de parties estimé pour le niveau suivant, ou null si on ne peut pas l'estimer :
 * points restants inconnus, ou pas encore de moyenne de points par partie mesurée (ou moyenne nulle).
 * Les marques de maîtrise ne s'achètent pas avec des points : elles ne sont pas comptées ici.
 */
function estimerPartiesMaitrise(champion) {
  if (!champion || !Number.isFinite(champion.restants) || champion.restants < 0) return null;
  if (champion.restants === 0) return 0;
  const moyenne = champion.moyenneParPartie;
  if (!Number.isFinite(moyenne) || moyenne <= 0) return null;
  return Math.ceil(champion.restants / moyenne);
}

/** "1 partie notée A- ou mieux", "2 parties notées S- ou mieux" (plusieurs conditions : jointes par "et"). */
function texteNotesRequises(palier) {
  const notes = palier && Array.isArray(palier.notes) ? palier.notes : [];
  return notes
    .map(({ note, nombre }) => `${nombre} partie${nombre > 1 ? "s" : ""} notée${nombre > 1 ? "s" : ""} ${note} ou mieux`)
    .join(" et ");
}

const nombreOu = (n, parDefaut) => (Number.isFinite(n) ? n : parDefaut);

/**
 * Tri des champions :
 *  - "proximite" : les moins de points restants d'abord, puis le moins de marques manquantes
 *    (points restants inconnus : à la fin) ;
 *  - "points" (par défaut) : le plus de points de maîtrise d'abord.
 * À égalité : le plus de points, puis le nom.
 */
function trierMaitrises(champions, tri = "points") {
  const parNom = (a, b) => String(a.nom || "").localeCompare(String(b.nom || ""), "fr");
  const parPoints = (a, b) => nombreOu(b.points, 0) - nombreOu(a.points, 0);
  const comparer =
    tri === "proximite"
      ? (a, b) =>
          nombreOu(a.restants, Infinity) - nombreOu(b.restants, Infinity) ||
          nombreOu(a.marquesManquantes, 0) - nombreOu(b.marquesManquantes, 0) ||
          parPoints(a, b) ||
          parNom(a, b)
      : (a, b) => parPoints(a, b) || parNom(a, b);
  // "Infinity - Infinity" donne NaN : on le remplace par 0 (égalité) pour garder un tri stable.
  return [...(Array.isArray(champions) ? champions : [])].filter(Boolean).sort((a, b) => comparer(a, b) || 0);
}

/** Nom simplifié pour la recherche : sans majuscules, accents, espaces ni ponctuation ("Kai'Sa" -> "kaisa"). */
function simplifierNom(texte) {
  return String(texte || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();
}

/** Recherche par nom, sans tenir compte des majuscules ni des accents ("kaisa" trouve "Kai'Sa"). */
function filtrerMaitrises(champions, recherche) {
  const cherche = simplifierNom(recherche);
  const liste = Array.isArray(champions) ? champions.filter(Boolean) : [];
  return cherche ? liste.filter((c) => simplifierNom(c.nom).includes(cherche)) : liste;
}

/**
 * Champion correspondant au texte tapé dans un champ de recherche (onglets Sélection et Build) :
 *  - { vide: true } si le champ est vide ;
 *  - { champion } si le nom est exact (même simplifié) ou si un seul champion correspond ;
 *  - { erreur } sinon (aucun, ou plusieurs champions possibles).
 */
function trouverChampion(texte, champions) {
  const cherche = simplifierNom(texte);
  if (!cherche) return { vide: true };
  const trouves = filtrerMaitrises(champions, texte);
  const exact = trouves.find((c) => simplifierNom(c.nom) === cherche);
  if (exact) return { champion: exact };
  if (trouves.length === 1) return { champion: trouves[0] };
  if (trouves.length === 0) return { erreur: `« ${texte} » : aucun champion de ce nom.` };
  const exemples = trouves.slice(0, 4).map((c) => c.nom).join(", ");
  return { erreur: `« ${texte} » : plusieurs champions possibles (${exemples}${trouves.length > 4 ? "…" : ""}). Précise le nom.` };
}

/** Les champions déjà joués (au moins 1 point) les plus proches du niveau suivant. */
function plusProchesDuNiveau(champions, nombre = 5) {
  return trierMaitrises(
    (Array.isArray(champions) ? champions : []).filter((c) => c && c.points > 0 && Number.isFinite(c.restants)),
    "proximite"
  ).slice(0, nombre);
}

/** Résumé : { joues, pointsTotal, niveauMax, niveau10EtPlus } ou null si aucun champion joué. */
function resumeMaitrise(champions) {
  const joues = (Array.isArray(champions) ? champions : []).filter((c) => c && c.points > 0);
  if (joues.length === 0) return null;
  const niveaux = joues.map((c) => nombreOu(c.niveau, 0));
  return {
    joues: joues.length,
    pointsTotal: joues.reduce((total, c) => total + c.points, 0),
    niveauMax: Math.max(...niveaux),
    niveau10EtPlus: niveaux.filter((n) => n >= 10).length,
  };
}

// --- Bilan de session (carte principale de l'Accueil) ---------------------------------------------
// Une partie : { id, date (début, en ms), dureeS, file, championId, championNom, victoire, kills, deaths, assists }.

const PAUSE_MAX_SESSION_MS = 45 * 60 * 1000; // au-delà de 45 min sans jouer, une session de nuit est finie
const DUREE_REMAKE_S = 5 * 60; // une partie de moins de 5 min est un remake : elle ne compte pas
const FILES_BOTS = new Set([830, 840, 850, 870, 880, 890]); // parties contre des bots (XP réduite)

const estRemake = (p) => Number.isFinite(p.dureeS) && p.dureeS < DUREE_REMAKE_S;
const finDePartie = (p) => p.date + (Number.isFinite(p.dureeS) && p.dureeS > 0 ? p.dureeS : 0) * 1000;

/** Minuit (heure locale) du jour de "maintenant". */
function debutDuJour(maintenant) {
  const jour = new Date(maintenant);
  jour.setHours(0, 0, 0, 0);
  return jour.getTime();
}

/**
 * Parties de la session, de la plus ancienne à la plus récente.
 *  - mode "ouverture" : parties terminées après l'ouverture de l'appli (lancement) ;
 *  - mode "aujourdhui" : parties commencées depuis minuit. Si tu jouais déjà avant minuit sans
 *    vraie pause (moins de 45 min entre deux parties), ces parties-là font partie de la même session.
 */
function partiesDeSession(parties, { mode = "aujourdhui", lancement = null, maintenant = Date.now() } = {}) {
  const valides = (Array.isArray(parties) ? parties : [])
    .filter((p) => p && Number.isFinite(p.date) && p.date <= maintenant)
    .sort((a, b) => a.date - b.date);
  if (mode === "ouverture") return Number.isFinite(lancement) ? valides.filter((p) => finDePartie(p) >= lancement) : [];

  const minuit = debutDuJour(maintenant);
  let debut = valides.findIndex((p) => p.date >= minuit);
  if (debut === -1) return [];
  while (debut > 0 && valides[debut].date - finDePartie(valides[debut - 1]) <= PAUSE_MAX_SESSION_MS) debut--;
  return valides.slice(debut);
}

/** XP de compte d'une partie (formule du wiki, réduite contre les bots). Moins de 7 minutes : 0. */
function xpDePartie(partie, niveau = 1) {
  const secondes = partie && Number.isFinite(partie.dureeS) ? partie.dureeS : 0;
  if (secondes < DUREE_MINIMUM_MIN * 60) return 0;
  const xp = partie.victoire ? secondes * 0.11 + 6.6 : secondes * 0.09 + 5.4;
  return FILES_BOTS.has(partie.file) ? xp * multiplicateurBots(niveau) : xp;
}

/**
 * Bilan d'une session : { parties, victoires, defaites, xp, dureeS, debut, fin, meilleur }
 * ou null si aucune partie. Les remakes ne comptent pas. Meilleur champion : le plus de victoires,
 * puis le meilleur taux, puis le meilleur KDA.
 */
function bilanSession(parties, { niveau = 1 } = {}) {
  const jouees = (Array.isArray(parties) ? parties : []).filter((p) => p && Number.isFinite(p.date) && !estRemake(p)).sort((a, b) => a.date - b.date);
  if (jouees.length === 0) return null;
  const victoires = jouees.filter((p) => p.victoire).length;
  const [meilleur] = statsParChampion(jouees).sort(
    (a, b) => b.victoires - a.victoires || b.tauxVictoire - a.tauxVictoire || b.kda.valeur - a.kda.valeur || b.parties - a.parties
  );
  return {
    parties: jouees.length,
    victoires,
    defaites: jouees.length - victoires,
    xp: Math.round(jouees.reduce((total, p) => total + xpDePartie(p, niveau), 0)),
    dureeS: jouees.reduce((total, p) => total + (Number.isFinite(p.dureeS) && p.dureeS > 0 ? p.dureeS : 0), 0),
    debut: jouees[0].date,
    fin: finDePartie(jouees[jouees.length - 1]),
    meilleur: meilleur ? { championId: meilleur.championId, nom: meilleur.nom, parties: meilleur.parties, victoires: meilleur.victoires, kda: meilleur.kda } : null,
  };
}

/** "45 min", "1 h", "2 h 05". */
function texteDuree(secondes) {
  const minutes = Math.max(0, Math.round((Number.isFinite(secondes) ? secondes : 0) / 60));
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`;
}

// ---------------------------------------------------------------------------
// Temps passé sur le jeu (comme wol.gg, mais sans clé API) : compté + estimé
// ---------------------------------------------------------------------------

const REMAKE_S = 5 * 60; // moins de 5 minutes : remake, pas compté
const DUREE_PARTIE_PAR_DEFAUT_MIN = 25; // sans parties enregistrées, une partie moyenne

/**
 * Temps passé sur LoL par un compte.
 *  - compté : les parties enregistrées par l'appli (durée exacte + ATTENTE_PAR_PARTIE_MIN d'attente chacune) ;
 *  - estimé : depuis la création du compte, d'après son XP totale (niveau + progression). On divise l'XP par
 *    l'XP d'une partie moyenne (TA durée moyenne et TON taux de victoire, formule du wiki), ce qui donne un
 *    nombre de parties, puis des heures. Ordre de grandeur seulement : l'XP des missions, des boosts et des
 *    événements fait monter l'estimation ; les parties contre des bots (moins d'XP) la font baisser.
 *  - total : le plus grand des deux (l'estimation ne peut pas être plus petite que ce qu'on a compté).
 * parties : [{ date, dureeS, file, championNom, victoire }] ; compte : { niveau, progression } ou null.
 * Renvoie null s'il n'y a ni compte ni partie.
 */
function tempsDeJeu({ parties, compte, maintenant = Date.now() }) {
  const vraies = (Array.isArray(parties) ? parties : []).filter((p) => p && Number.isFinite(p.dureeS) && p.dureeS >= REMAKE_S);
  const niveauValide = compte && Number.isInteger(compte.niveau) && compte.niveau >= 1;
  if (!niveauValide && vraies.length === 0) return null;

  const n = vraies.length;
  const secondes = vraies.reduce((s, p) => s + p.dureeS, 0);
  const dureeMoyMin = n > 0 ? secondes / 60 / n : DUREE_PARTIE_PAR_DEFAUT_MIN;
  const tauxVictoire = n > 0 ? vraies.filter((p) => p.victoire).length / n : TAUX_VICTOIRE_PAR_DEFAUT;
  const heuresAvecAttente = (nb, minutesParPartie) => (nb * (minutesParPartie + ATTENTE_PAR_PARTIE_MIN)) / 60;

  const exact = {
    parties: n,
    heuresEnJeu: secondes / 3600,
    heures: n > 0 ? heuresAvecAttente(n, dureeMoyMin) : 0,
    depuis: n > 0 ? Math.min(...vraies.map((p) => p.date)) : null,
  };

  let estime = null;
  if (niveauValide) {
    const xpTotale = xpDuCompte({ niveau: compte.niveau, progression: Number(compte.progression) || 0 });
    const xpParPartie = xpMoyenneParPartie({ dureeMin: Math.max(dureeMoyMin, DUREE_MINIMUM_MIN), tauxVictoire, niveau: compte.niveau, bots: false });
    const partiesEstimees = xpParPartie > 0 ? xpTotale / xpParPartie : 0;
    estime = { parties: Math.round(partiesEstimees), heures: heuresAvecAttente(partiesEstimees, dureeMoyMin), xpParPartie: Math.round(xpParPartie) };
  }
  const total = Math.max(estime ? estime.heures : 0, exact.heures);

  // Stats amusantes (sur les parties enregistrées)
  const heuresPar = (cle) => {
    const table = new Map();
    for (const p of vraies) table.set(cle(p), (table.get(cle(p)) || 0) + p.dureeS / 3600);
    return [...table].map(([nom, heures]) => ({ nom, heures })).sort((a, b) => b.heures - a.heures).slice(0, 3);
  };
  const trenteJours = vraies.filter((p) => maintenant - p.date < 30 * JOUR_MS);
  const plusLongue = vraies.reduce((m, p) => (!m || p.dureeS > m.dureeS ? p : m), null);
  return {
    compte: exact,
    estime,
    total,
    jours: total / 24,
    films: Math.floor(total / 2), // un film = 2 h
    heuresParSemaine: (trenteJours.reduce((s, p) => s + p.dureeS, 0) / 3600 + (trenteJours.length * ATTENTE_PAR_PARTIE_MIN) / 60) / (30 / 7),
    partiesDeNuit: n > 0 ? vraies.filter((p) => new Date(p.date).getHours() < 6).length / n : 0, // entre minuit et 6 h
    plusLongue: plusLongue ? { minutes: Math.round(plusLongue.dureeS / 60), champion: plusLongue.championNom || null, victoire: Boolean(plusLongue.victoire) } : null,
    modes: heuresPar((p) => NOMS_FILES[p.file] || "Autres modes"), // modes inconnus regroupés
    champions: heuresPar((p) => p.championNom || `Champion ${p.championId}`),
  };
}

// ---------------------------------------------------------------------------
// Résumé d'après-partie (carte de l'Accueil) : ta dernière partie comparée à tes habitudes
// ---------------------------------------------------------------------------
// Comparée à tes PARTIES_COMPARAISON parties précédentes du même genre (Faille, ARAM ou Arena : on ne compare pas
// les CS d'une ARAM à ceux d'une partie sur la Faille). Les détails (cs, or, degats, vision) viennent de
// l'historique du client ; les parties enregistrées par les anciennes versions n'en ont pas : elles ne comptent
// que pour le KDA.

const PARTIES_COMPARAISON = 20;
const MIN_PARTIES_COMPARAISON = 3; // en dessous, pas de moyenne : « joue encore quelques parties »
const MARGE_TENDANCE = 0.05; // à moins de 5 % de ta moyenne : « comme d'habitude »
const FILES_ARAM = new Set([100, 450, 720, 2400]); // Abîme hurlant (ARAM, ARAM du Chaos...)
const FILES_ARENA = new Set([1700, 1710, 1750]); // 1750 : « Arena 3x6 » (vu dans le client le 20/10/2026)

/** "faille", "aram" ou "arena" (une file inconnue compte comme la Faille). */
function genreDePartie(file) {
  if (FILES_ARAM.has(file)) return "aram";
  if (FILES_ARENA.has(file)) return "arena";
  return "faille";
}

/** Valeur par minute de jeu, ou null si le détail manque (ancienne partie) ou si la durée est illisible. */
function parMinute(valeur, partie) {
  const minutes = Number.isFinite(partie.dureeS) && partie.dureeS > 0 ? partie.dureeS / 60 : 0;
  return Number.isFinite(valeur) && valeur >= 0 && minutes > 0 ? valeur / minutes : null;
}

// genres : où la mesure a un sens (pas de CS en Arena, pas de vision hors de la Faille).
const MESURES_PARTIE = [
  { cle: "kda", nom: "KDA", decimales: 2, genres: ["faille", "aram", "arena"], valeur: (p) => kda(p.kills, p.deaths, p.assists).valeur },
  { cle: "cs", nom: "CS / min", decimales: 1, genres: ["faille", "aram"], valeur: (p) => parMinute(p.cs, p) },
  { cle: "or", nom: "Or / min", decimales: 0, genres: ["faille", "aram", "arena"], valeur: (p) => parMinute(p.or, p) },
  { cle: "degats", nom: "Dégâts / min", decimales: 0, genres: ["faille", "aram", "arena"], valeur: (p) => parMinute(p.degats, p) },
  { cle: "vision", nom: "Vision / min", decimales: 2, genres: ["faille"], valeur: (p) => parMinute(p.vision, p) },
];

const entierOuZero = (n) => Number.isInteger(n) && n >= 0;

/** "mieux", "moins" ou "pareil" (à moins de MARGE_TENDANCE de la moyenne). */
function tendance(valeur, moyenne) {
  if (moyenne === 0) return valeur > 0 ? "mieux" : "pareil";
  const ecart = (valeur - moyenne) / moyenne;
  if (ecart > MARGE_TENDANCE) return "mieux";
  if (ecart < -MARGE_TENDANCE) return "moins";
  return "pareil";
}

/**
 * Résumé de la dernière partie : { partie, genre, comparees, mesures: [{ cle, nom, decimales, valeur, moyenne,
 * ecart, tendance }] }, ou null s'il n'y a aucune partie. moyenne / ecart / tendance valent null quand il y a moins
 * de MIN_PARTIES_COMPARAISON parties à comparer pour cette mesure. Les remakes ne comptent pas.
 */
function resumeDernierePartie(parties, { nombre = PARTIES_COMPARAISON, min = MIN_PARTIES_COMPARAISON } = {}) {
  const jouees = (Array.isArray(parties) ? parties : [])
    .filter((p) => p && Number.isFinite(p.date) && !estRemake(p) && entierOuZero(p.kills) && entierOuZero(p.deaths) && entierOuZero(p.assists))
    .sort((a, b) => b.date - a.date);
  if (jouees.length === 0) return null;
  const [derniere] = jouees;
  const genre = genreDePartie(derniere.file);
  const avant = jouees.slice(1).filter((p) => genreDePartie(p.file) === genre).slice(0, nombre);

  const mesures = [];
  for (const m of MESURES_PARTIE) {
    if (!m.genres.includes(genre)) continue;
    const valeur = m.valeur(derniere);
    if (valeur === null) continue; // détail absent de cette partie
    const valeurs = avant.map(m.valeur).filter((v) => v !== null);
    const moyenne = valeurs.length >= min ? valeurs.reduce((s, v) => s + v, 0) / valeurs.length : null;
    mesures.push({
      cle: m.cle,
      nom: m.nom,
      decimales: m.decimales,
      valeur,
      moyenne,
      ecart: moyenne === null ? null : valeur - moyenne,
      tendance: moyenne === null ? null : tendance(valeur, moyenne),
    });
  }
  return { partie: derniere, genre, comparees: avant.length, mesures };
}

/** Une phrase pour le haut de la carte : « Mieux que d'habitude sur 3 points sur 4. » (ou null sans comparaison). */
function phraseDernierePartie(resume) {
  const comparees = resume ? resume.mesures.filter((m) => m.tendance) : [];
  if (comparees.length === 0) return null;
  const mieux = comparees.filter((m) => m.tendance === "mieux").length;
  const moins = comparees.filter((m) => m.tendance === "moins").length;
  const sur = `sur ${comparees.length} point${comparees.length > 1 ? "s" : ""}`;
  if (mieux === comparees.length) return `Au-dessus de tes habitudes partout. Belle partie !`;
  if (moins === comparees.length) return `En dessous de tes habitudes partout : ça arrive, la prochaine sera meilleure.`;
  if (mieux > moins) return `Mieux que d'habitude sur ${mieux} point${mieux > 1 ? "s" : ""} (${sur}).`;
  if (moins > mieux) return `En dessous de tes habitudes sur ${moins} point${moins > 1 ? "s" : ""} (${sur}).`;
  return `Dans tes habitudes (${sur}).`;
}

// Dans Node (tests, main.js), on exporte les fonctions. Dans la page, elles sont déjà globales.
if (typeof module !== "undefined") {
  module.exports = {
    tempsDeJeu,
    partiesDeSession,
    xpDePartie,
    bilanSession,
    texteDuree,
    genreDePartie,
    resumeDernierePartie,
    phraseDernierePartie,
    MESURES_PARTIE,
    estimerPartiesMaitrise,
    texteNotesRequises,
    trierMaitrises,
    filtrerMaitrises,
    simplifierNom,
    trouverChampion,
    plusProchesDuNiveau,
    resumeMaitrise,
    calculer,
    calculerModes,
    modeLePlusRapide,
    resumeObjectif,
    joindreListe,
    de,
    NOMS_FILES,
    nomFile,
    kda,
    statsParChampion,
    statsParMode,
    meilleursChampions,
    trancheDe,
    statsParCreneau,
    serieEnCours,
    resumeStats,
    filtrerParFile,
    filtrerParPeriode,
    trierChampions,
    geometrieBarres,
    MIN_PARTIES_CRENEAUX,
    texteDonneesDu,
    texteHistorique,
    xpDuCompte,
    niveauDepuisXp,
    rythmeRecent,
    dateEstimee,
    texteRythme,
    projectionPrevue,
    geometrieGraphique,
    MODES,
    niveauParDefaut,
    parametresCalcul,
    verifier,
    xpGagnee,
    ATTENTE_PAR_PARTIE_MIN,
    xpMoyenneParPartie,
    xpPourNiveauSuivant,
    xpTotaleAuNiveau,
    multiplicateurBots,
  };
}
