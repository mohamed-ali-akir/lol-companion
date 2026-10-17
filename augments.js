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
 */
const { lireLockfile, lireJsonOuNull } = require("./lcu.js");
const { simplifierNom } = require("./src/calculs.js");

const FILE_MAYHEM = 2400; // "ARAM: Mayhem" (même numéro que dans lcu.js)
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
  for (const [liste, source] of [[global, "global"], [champion, "champion"]]) {
    for (const a of Array.isArray(liste) ? liste : []) {
      if (a && a.nom && NOTES.includes(a.note)) index.set(simplifierNom(a.nom), { note: a.note, rang: a.rang, apparition: a.apparition, source });
    }
  }
  return index;
}

const pourcent = (x) => `${Math.round(x * 100)} %`;

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
      texte = `Note ${stat.note} · n° ${stat.rang}`;
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
 *  - afficher(liste)    : affiche les étiquettes, ou les cache (null) ;
 *  - arreterLecture()   : arrête la lecture d'écran (fin de partie) ;
 *  - journal(...)       : (facultatif) erreurs.
 * Renvoie { demarrer(), arreter() }.
 */
function creerSuiviAugments({ actif, ecran, lireEcran, nomsAugments, statsAugments, afficher, arreterLecture = () => {}, intervalleMs = 1000, journal = () => {} }) {
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
          const stats = await statsAugments().catch(() => null);
          const liste = etiquettes(cartes, stats, taille.hauteur);
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

/** Noms de tous les augments (langue du client), depuis cherry-augments.json (Arena et Mayhem). */
async function lireNomsAugments(dossierJeu) {
  const liste = await lireJsonOuNull(lireLockfile(dossierJeu), "/lol-game-data/assets/v1/cherry-augments.json");
  return Array.isArray(liste) ? liste.map((a) => a && (a.nameTRA || a.name)).filter((n) => typeof n === "string" && n) : [];
}

/** Langue du jeu ("en_US"...), pour que l'OCR lise les noms dans la bonne langue. */
async function lireLangueJeu(dossierJeu) {
  const r = await lireJsonOuNull(lireLockfile(dossierJeu), "/riotclient/region-locale");
  return r && typeof r.locale === "string" && /^[a-z]{2}_[A-Z]{2}$/.test(r.locale) ? r.locale : "en_US";
}

module.exports = {
  FILE_MAYHEM,
  DECALAGE_ETIQUETTE,
  APPARITION_MIN,
  estMayhem,
  zoneTitres,
  distance,
  indexNoms,
  reconnaitre,
  trouverCartes,
  indexStats,
  etiquettes,
  creerSuiviAugments,
  lireNomsAugments,
  lireLangueJeu,
};
