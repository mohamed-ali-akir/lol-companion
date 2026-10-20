/*
 * Augments ARAM Mayhem : stats affichées sous chaque carte, directement sur l'écran du jeu
 * ---------------------------------------------------------------------------------------
 * Tourne dans le processus principal (Node). Désactivé par défaut (case de l'onglet Build).
 *
 * Riot ne dit pas quels augments te sont proposés (ni le client, ni l'API du jeu) : comme ezlol ou
 * aram-mayhem-tracker, on LIT leurs noms à l'écran (ocr.js), seulement pendant une partie ARAM Mayhem.
 *  1. une fois par seconde, on capture la bande de l'écran où sont les titres des cartes (36 % à 47 % de la hauteur) ;
 *  2. on garde les textes qui sont de vrais noms d'augments (liste complète du client : cherry-augments.json,
 *     554 augments, dans la langue du jeu) ;
 *  3. si 2 ou 3 cartes sont reconnues, une fenêtre transparente (qui laisse passer les clics) affiche sous chacune
 *     son TAUX DE VICTOIRE (arammayhem.js) : avec TON champion si l'augment est dans ses meilleurs, sinon tous
 *     champions ; la meilleure carte est mise en avant (selon le taux de victoire, comme Porofessor ou Blitz).
 *     (Avant : la popularité d'OP.GG, abandonnée le 02/10/2026 : pas de taux de victoire, chiffres douteux.) ;
 *  4. dès que les cartes disparaissent (tu as choisi), on cache tout.
 * L'appli ne choisit JAMAIS à ta place : elle affiche des statistiques publiques (autorisé par Riot, comme Blitz).
 * Vérifié le 02/10/2026 sur des captures en 2560x1440 : titres à y = 581, lus en 10 à 65 ms.
 * Le jeu doit être en mode « Sans bordure » : en plein écran exclusif, rien ne peut s'afficher par-dessus.
 *
 * ARENA (19/10/2026, même système) : mêmes cartes (« cherry » est le nom interne de l'Arena, Mayhem reprend ses
 * cartes), même lecture d'écran, mais les stats viennent de Lolalytics (lolalytics.js, page Arena de TON champion) :
 * le vrai TAUX DE VICTOIRE de chaque augment avec ce champion. Les cartes sont reliées aux stats par le NUMÉRO de
 * l'augment (le même chez Lolalytics et dans le client), donc ça marche aussi avec le jeu en français.
 * OBJETS PRISMATIQUES (19/10/2026) : en Arena, l'objet « Objet prismatique » de la boutique ouvre un choix entre
 * plusieurs objets prismatiques, sur les mêmes cartes que les augments. On reconnaît donc aussi leurs noms
 * (objets 44xxxx du client) et on affiche leur taux de victoire avec ton champion (Lolalytics, même page).
 */
const { lireLockfile, lireJsonOuNull } = require("./lcu.js");
const { simplifierNom } = require("./src/calculs.js");

const { FILES } = require("./donnees-jeu.js"); // numéros des files : une seule source
const FILE_MAYHEM = FILES.mayhem; // "ARAM: Mayhem"
const FILES_ARENA = FILES.arena; // Arena, dont « Arena 3x6 »
// Bande de capture, en proportion de la hauteur de l'écran (titres à 581 / 1440 = 40 %).
const BANDE_HAUT = 0.36;
const BANDE_BAS = 0.47;
// Étiquette placée dans le bas de la carte (zone vide sous la description) : 19 % de la hauteur sous le titre.
const DECALAGE_ETIQUETTE = 0.19;
const ECART_MAX_TITRES = 15; // les titres des 3 cartes sont à la même hauteur (à quelques pixels près)

// --- Fonctions pures (testées) --------------------------------------------------------------

/** La partie en cours est-elle une ARAM Mayhem ? (session du "gameflow" du client) */
function estMayhem(partie) {
  const file = partie && partie.gameData && partie.gameData.queue ? partie.gameData.queue : {};
  return file.id === FILE_MAYHEM || String(file.gameMode || "").toUpperCase() === "KIWI";
}

/** La partie en cours est-elle une Arena ? (file 1700 / 1710 / 1750, ou mode CHERRY) */
function estArena(partie) {
  const file = partie && partie.gameData && partie.gameData.queue ? partie.gameData.queue : {};
  return FILES_ARENA.includes(file.id) || String(file.gameMode || "").toUpperCase() === "CHERRY";
}

/** Zone de l'écran à capturer (pixels réels) pour un écran de largeur x hauteur. */
function zoneTitres({ largeur, hauteur }) {
  const haut = Math.round(hauteur * BANDE_HAUT);
  return { x: 0, y: haut, largeur, hauteur: Math.round(hauteur * BANDE_BAS) - haut };
}

/** Distance d'édition (nombre de lettres à changer) : tolère une petite erreur de lecture de l'OCR. */
function distance(a, b) {
  const ligne = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diagonale = ligne[0];
    ligne[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const avant = ligne[j];
      ligne[j] = Math.min(ligne[j] + 1, ligne[j - 1] + 1, diagonale + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonale = avant;
    }
  }
  return ligne[b.length];
}

/** Liste des noms d'augments du client -> Map nom simplifié -> nom affiché. */
function indexNoms(noms) {
  const index = new Map();
  for (const nom of Array.isArray(noms) ? noms : []) {
    const cle = simplifierNom(nom);
    if (cle.length >= 3 && !index.has(cle)) index.set(cle, nom);
  }
  return index;
}

/** Nom d'augment correspondant à un texte lu (exact, ou 1 erreur sur 8 lettres), ou null. */
function reconnaitre(texte, index) {
  const cle = simplifierNom(texte);
  if (cle.length < 3) return null;
  if (index.has(cle)) return index.get(cle);
  const tolerance = Math.floor(cle.length / 8);
  if (tolerance === 0) return null;
  let meilleur = null;
  for (const [autre, nom] of index) {
    if (Math.abs(autre.length - cle.length) > tolerance) continue;
    const d = distance(cle, autre);
    if (d <= tolerance && (!meilleur || d < meilleur.d)) meilleur = { d, nom };
  }
  return meilleur ? meilleur.nom : null;
}

/**
 * Les cartes à l'écran : textes lus par l'OCR -> [{ nom, x, y, largeur, hauteur }] triées de gauche à droite (3 au plus).
 * Seuls les vrais noms d'augments comptent (pas « Utility », ni le pseudo d'un joueur), et ils doivent être
 * alignés à la même hauteur, comme les titres des cartes.
 */
function trouverCartes(lignes, index) {
  const reconnues = (Array.isArray(lignes) ? lignes : [])
    .map((l) => ({ ...l, nom: l && reconnaitre(l.texte, index) }))
    .filter((l) => l.nom);
  if (reconnues.length === 0) return [];
  // La hauteur où il y a le plus de titres alignés.
  let meilleur = [];
  for (const repere of reconnues) {
    const alignees = reconnues.filter((l) => Math.abs(l.y - repere.y) <= ECART_MAX_TITRES);
    if (alignees.length > meilleur.length) meilleur = alignees;
  }
  const vues = new Set();
  return meilleur
    .sort((a, b) => a.x - b.x)
    .filter((l) => !vues.has(l.nom) && vues.add(l.nom))
    .slice(0, 3)
    .map(({ nom, x, y, largeur, hauteur }) => ({ nom, x, y, largeur, hauteur }));
}

const APPARITION_MIN = 0.03; // un augment pris dans moins de 3 % des parties n'est pas mis en avant (trop peu sûr)
const { NOTES } = require("./arammayhem.js"); // S+, S, S-... de la meilleure à la moins bonne

/**
 * Stats d'arammayhem.com -> Map nom simplifié -> { note, rang, apparition, source }.
 * source "champion" : note avec TON champion (ses meilleurs augments) ; "global" : tous champions.
 * Les stats du champion passent avant les stats globales.
 */
function indexStats({ champion = [], global = [] } = {}) {
  const index = new Map();
  // choix : taux de choix tous champions (« Pick Rate » de la page des augments : pris quand il est proposé).
  const choix = new Map();
  for (const a of Array.isArray(global) ? global : []) if (a && a.nom && Number.isFinite(a.apparition)) choix.set(simplifierNom(a.nom), a.apparition);
  for (const [liste, source] of [[global, "global"], [champion, "champion"]]) {
    for (const a of Array.isArray(liste) ? liste : []) {
      if (!a || !a.nom || !NOTES.includes(a.note)) continue;
      const cle = simplifierNom(a.nom);
      index.set(cle, { note: a.note, rang: a.rang, apparition: a.apparition, choix: choix.has(cle) ? choix.get(cle) : null, source });
    }
  }
  return index;
}

const pourcent = (x) => `${Math.round(x * 100)} %`;

// --- Arena : stats de Lolalytics ------------------------------------------------------------------

const PARTIES_MIN_ARENA = 100; // en dessous, le taux de victoire d'un augment est trop incertain pour être mis en avant
const ECART_MIN_ARENA = 0.01; // 1 point d'écart au moins entre les 2 meilleures cartes, sinon pas de mise en avant

/**
 * Objets du client (Map numéro -> nom, langue du client) -> objets prismatiques de l'Arena [{ id, nom }].
 * Vérifié le 19/10/2026 (items.json) : les 49 objets numérotés 440000 à 449999 sont les prismatiques
 * (443056 Couronne du Roi-démon, 447108 Sculpteur de rune...).
 */
function objetsPrismatiques(noms) {
  const liste = [];
  for (const [id, nom] of noms instanceof Map ? noms : []) {
    if (Number.isInteger(id) && id >= 440000 && id < 450000 && typeof nom === "string" && nom) liste.push({ id, nom });
  }
  return liste;
}

/**
 * Stats Arena de Lolalytics (numéro -> stats) -> Map nom simplifié (langue du jeu) -> { victoire, choix, parties,
 * ecart, source }. augmentsClient : [{ id, nom }] (cherry-augments.json). Un même nom peut exister deux fois dans le
 * client (version Arena et version Mayhem d'un augment) : on garde celui qui a des stats.
 * ecart : différence avec le taux de victoire moyen du champion (+0,03 = 3 points de mieux), ou null.
 * prismatiquesClient : [{ id, nom }] (objetsPrismatiques) : leurs stats viennent de arena.prismatiques.
 */
function indexStatsArena(augmentsClient, arena, prismatiquesClient = []) {
  const index = new Map();
  const moyenne = arena && Number.isFinite(arena.victoireChampion) ? arena.victoireChampion : null;
  const ajouter = (liste, stats) => {
    if (!(stats instanceof Map)) return;
    for (const a of Array.isArray(liste) ? liste : []) {
      const s = a && stats.get(a.id);
      const cle = a && simplifierNom(a.nom);
      if (!s || !cle || index.has(cle)) continue;
      index.set(cle, { ...s, ecart: moyenne === null ? null : s.victoire - moyenne, source: "champion" });
    }
  };
  ajouter(augmentsClient, arena && arena.augments);
  ajouter(prismatiquesClient, arena && arena.prismatiques);
  return index;
}

const points = (x) => {
  const n = Math.round(x * 100);
  return `${n >= 0 ? "+" : "−"}${Math.abs(n)} pts`; // arrondi d'abord : −0,4 point s'affiche « +0 pts », pas « −0 pts »
};

/**
 * Étiquettes Arena : « 62 % de victoires » sous chaque carte, avec ton champion (Lolalytics).
 * Mise en avant : la carte au meilleur taux de victoire, seulement parmi celles jouées dans au moins 100 parties,
 * et seulement si elle a au moins 1 point d'avance sur la deuxième (sinon ce serait trompeur).
 */
function etiquettesArena(cartes, stats, hauteurEcran) {
  const avecStats = cartes.map((c) => ({ carte: c, stat: stats ? stats.get(simplifierNom(c.nom)) || null : null }));
  const classees = avecStats.filter((a) => a.stat && a.stat.parties >= PARTIES_MIN_ARENA).sort((a, b) => b.stat.victoire - a.stat.victoire);
  // Une seule carte assez jouée : mise en avant seulement si les autres n'ont aucune stat (pas un petit échantillon
  // qui ferait peut-être mieux).
  const seule = classees.length === 1 && avecStats.filter((a) => a.stat).length === 1;
  const nette = seule || (classees.length > 1 && classees[0].stat.victoire - classees[1].stat.victoire >= ECART_MIN_ARENA);
  const meilleure = nette ? classees[0] : null;
  return avecStats.map((a) => {
    const { carte, stat } = a;
    let texte = stats ? "Pas de données" : "Stats indisponibles";
    let detail = "";
    if (stat) {
      texte = `${pourcent(stat.victoire)} de victoires`;
      const ecart = Number.isFinite(stat.ecart) ? ` · ${points(stat.ecart)}` : "";
      detail = `avec ton champion${ecart} · pris ${pourcent(stat.choix)}`;
    }
    return {
      nom: carte.nom,
      x: Math.round(carte.x + carte.largeur / 2),
      y: Math.round(carte.y + hauteurEcran * DECALAGE_ETIQUETTE),
      texte,
      detail,
      source: stat ? stat.source : null,
      meilleur: a === meilleure,
    };
  });
}

/**
 * Étiquettes à afficher sous les cartes : [{ nom, x, y, texte, detail, source, meilleur }] (pixels réels de l'écran).
 * stats : Map (indexStats) ou null si indisponibles (site en panne, pas d'Internet...).
 * Mise en avant : parmi les cartes qui sont dans les meilleurs augments de ton champion, celle à la meilleure note ;
 * sinon, parmi les autres, celle à la meilleure note tous champions. Jamais un augment pris dans moins de 3 % des
 * parties, et rien si les 2 meilleures ont la même note (presque à égalité : ce serait trompeur).
 */
function etiquettes(cartes, stats, hauteurEcran) {
  const avecStats = cartes.map((c) => ({ carte: c, stat: stats ? stats.get(simplifierNom(c.nom)) || null : null }));
  const candidates = (source) => avecStats.filter((a) => a.stat && a.stat.source === source && a.stat.apparition >= APPARITION_MIN);
  const groupe = candidates("champion").length > 0 ? candidates("champion") : candidates("global").length >= 2 ? candidates("global") : [];
  const rangNote = (a) => NOTES.indexOf(a.stat.note);
  const classees = [...groupe].sort((a, b) => rangNote(a) - rangNote(b) || a.stat.rang - b.stat.rang);
  const nette = classees.length === 1 || (classees.length > 1 && rangNote(classees[0]) < rangNote(classees[1]));
  const meilleure = nette ? classees[0] : null;
  return avecStats.map((a) => {
    const { carte, stat } = a;
    let texte = "Stats indisponibles";
    let detail = "";
    if (stats && !stat) texte = "Pas de données";
    if (stat) {
      // 17/10/2026 : le site ne publie plus de taux de victoire. On affiche son classement (« Top 3 », avec ton champion
      // ou tous champions) et le taux de choix tous champions ; la note (S+, S...) n'est pas affichée, elle ne sert
      // qu'à choisir la carte mise en avant.
      const choisi = Number.isFinite(stat.choix) ? ` · choisi ${pourcent(stat.choix)}` : "";
      texte = Number.isFinite(stat.rang) ? `Top ${stat.rang}${choisi}` : choisi ? `Choisi ${pourcent(stat.choix)}` : "Pas de données";
      detail = stat.source === "champion" ? `avec ton champion · pris ${pourcent(stat.apparition)}` : "tous champions";
    }
    return {
      nom: carte.nom,
      x: Math.round(carte.x + carte.largeur / 2),
      y: Math.round(carte.y + hauteurEcran * DECALAGE_ETIQUETTE),
      texte,
      detail,
      source: stat ? stat.source : null,
      meilleur: a === meilleure,
    };
  });
}

// --- Surveillance de l'écran pendant une ARAM Mayhem (testée avec de fausses lectures) ---------------

/**
 *  - actif()            : l'option est-elle cochée ? (relu à chaque tour : on peut la changer en pleine partie) ;
 *  - ecran()            : { largeur, hauteur } de l'écran du jeu, en pixels réels ;
 *  - lireEcran(zone)    : textes lus dans cette zone (promesse, ocr.js) ;
 *  - nomsAugments()     : index des noms (indexNoms), promesse ;
 *  - statsAugments()    : index des stats du champion (indexStats) ou null, promesse ;
 *  - calculerEtiquettes : (facultatif) etiquettes (ARAM Mayhem, par défaut) ou etiquettesArena ;
 *  - afficher(liste)    : affiche les étiquettes, ou les cache (null) ;
 *  - arreterLecture()   : arrête la lecture d'écran (fin de partie) ;
 *  - journal(...)       : (facultatif) erreurs.
 * Renvoie { demarrer(), arreter() }.
 */
function creerSuiviAugments({ actif, ecran, lireEcran, nomsAugments, statsAugments, calculerEtiquettes = etiquettes, afficher, arreterLecture = () => {}, intervalleMs = 1000, journal = () => {} }) {
  let derniereRaison = null; // dernière raison des stats indisponibles notée dans le journal
  let enMarche = false;
  let minuterie = null;
  let affiche = false;
  let absences = 0;
  let dernier = "";

  function cacher() {
    if (affiche) afficher(null);
    affiche = false;
    dernier = "";
    absences = 0;
  }

  async function tour() {
    if (!enMarche) return;
    try {
      if (!actif()) {
        cacher();
      } else {
        const taille = ecran();
        const [lignes, index] = await Promise.all([lireEcran(zoneTitres(taille)), nomsAugments()]);
        const cartes = trouverCartes(lignes, index);
        if (cartes.length >= 2) {
          absences = 0;
          // Stats indisponibles : notées dans le journal, une fois par raison (avant le 17/10/2026, rien n'était noté :
          // le changement de format d'arammayhem.com n'a été vu qu'en jeu, avec « Stats indisponibles »).
          const stats = await statsAugments().catch((erreur) => {
            const raison = (erreur && erreur.message) || String(erreur);
            if (raison !== derniereRaison) journal("augments : stats indisponibles :", raison);
            derniereRaison = raison;
            return null;
          });
          const liste = calculerEtiquettes(cartes, stats, taille.hauteur);
          const cle = JSON.stringify(liste);
          if (enMarche && cle !== dernier) {
            afficher(liste);
            affiche = true;
            dernier = cle;
          }
        } else if (affiche && ++absences >= 2) {
          cacher(); // les cartes ont disparu (tu as choisi) : 2 lectures d'affilée pour éviter les clignotements
        }
      }
    } catch (erreur) {
      journal("augments :", erreur.message);
    }
    if (enMarche) minuterie = setTimeout(tour, intervalleMs);
  }

  return {
    demarrer() {
      if (enMarche) return;
      enMarche = true;
      tour();
    },
    arreter() {
      enMarche = false;
      clearTimeout(minuterie);
      cacher();
      arreterLecture();
    },
  };
}

// --- Appels au client ------------------------------------------------------------------------

/** Tous les augments du client : [{ id, nom }] (nom dans la langue du client), depuis cherry-augments.json (Arena et Mayhem). */
async function lireAugmentsClient(dossierJeu) {
  const liste = await lireJsonOuNull(lireLockfile(dossierJeu), "/lol-game-data/assets/v1/cherry-augments.json");
  return augmentsDuClient(liste);
}

/** Réponse de cherry-augments.json -> [{ id, nom }], en ignorant les entrées abîmées. */
function augmentsDuClient(liste) {
  return (Array.isArray(liste) ? liste : [])
    .map((a) => a && { id: a.id, nom: a.nameTRA || a.name })
    .filter((a) => a && Number.isInteger(a.id) && typeof a.nom === "string" && a.nom);
}

/** Langue du jeu ("en_US"...), pour que l'OCR lise les noms dans la bonne langue. */
async function lireLangueJeu(dossierJeu) {
  const r = await lireJsonOuNull(lireLockfile(dossierJeu), "/riotclient/region-locale");
  return r && typeof r.locale === "string" && /^[a-z]{2}_[A-Z]{2}$/.test(r.locale) ? r.locale : "en_US";
}

module.exports = {
  FILE_MAYHEM,
  FILES_ARENA,
  DECALAGE_ETIQUETTE,
  APPARITION_MIN,
  PARTIES_MIN_ARENA,
  estMayhem,
  estArena,
  zoneTitres,
  distance,
  indexNoms,
  reconnaitre,
  trouverCartes,
  indexStats,
  etiquettes,
  objetsPrismatiques,
  indexStatsArena,
  etiquettesArena,
  creerSuiviAugments,
  augmentsDuClient,
  lireAugmentsClient,
  lireLangueJeu,
};
