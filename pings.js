/*
 * Pings des sorts d'invocateur adverses, lus dans le chat du jeu (Windows et Mac)
 * -------------------------------------------------------------------------------
 * Tourne dans le processus principal (Node). Exception décidée par le propriétaire le 16/10/2026 (CLAUDE.md) :
 * case séparée, désactivée par défaut, en plus de celle des chronos des sorts (sorts.js).
 *
 * Quand un joueur de ton équipe (ou toi) clique sur le sort d'un adversaire dans le tableau des scores (Tab), le jeu
 * écrit dans le chat : « Pseudo (Champion): ChampionEnnemi Sort », par exemple « wDark (Ashe): Vex Flash »
 * (vérifié le 16/10/2026 sur des captures). Le jeu ne donne ni l'heure ni le temps restant : le chrono démarre au
 * moment où le message apparaît. Aucune API ne donne le chat (ni celle du jeu, ni ses journaux) : on le LIT à l'écran.
 *
 * Chaque seconde (pendant une partie, case cochée) :
 *  1. capture de la zone du chat (en bas à gauche) dans un fichier temporaire (ocr.js : capturer) ;
 *  2. nettoyage (image.js) : agrandie, seul le texte coloré du chat reste, en noir sur blanc ;
 *  3. OCR de l'image nettoyée (ocr.js : lireImage), puis regroupement des morceaux d'une même ligne ;
 *  4. reconnaissance : la ligne FINIT-elle par « ChampionEnnemi Sort » ? On compare avec les 5 adversaires de la
 *     partie et LEURS sorts (API officielle du jeu), en tolérant les petites erreurs de lecture (« Karnia » pour
 *     « Karma ») : c'est sûr, car on ne compare qu'à une dizaine de noms possibles.
 * Rien d'autre n'est gardé : les captures sont effacées, et seuls les pings reconnus sont notés dans le journal.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { lirePng, ecrirePngGris, nettoyerChat } = require("./image.js");

// Noms des sorts dans le chat, en plus de celui donné par le jeu dans sa langue (API officielle) : anglais et
// français, avec leurs variantes (Téléportation déchaînée après 10 min, Châtiments améliorés).
const NOMS_SORTS = {
  Flash: ["Flash", "Saut éclair"],
  Dot: ["Ignite", "Embrasement"],
  Teleport: ["Teleport", "Unleashed Teleport", "Téléportation", "Téléportation déchaînée"],
  Heal: ["Heal", "Soins"],
  Barrier: ["Barrier", "Barrière"],
  Exhaust: ["Exhaust", "Fatigue"],
  Haste: ["Ghost", "Fantôme"],
  Boost: ["Cleanse", "Purge"],
  Smite: ["Smite", "Unleashed Smite", "Primal Smite", "Châtiment", "Châtiment déchaîné", "Châtiment primordial"],
};

/** Texte comparable : minuscules, sans accents, sans espaces ni ponctuation (« K arnia » -> « karnia »). */
function normaliser(texte) {
  return String(texte || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Confusions classiques de l'OCR, « repliées » des DEUX côtés de la comparaison (texte lu et nom attendu) :
 * « rn » et « nn » pour « m » (« Karnna », « K a I-nn a » pour « Karma », vu sur de vraies captures), « l », « 1 »
 * et « | » pour « i », « 0 » pour « o ». Les deux côtés étant repliés pareil, un vrai nom reste toujours reconnu.
 */
function plier(texte) {
  return texte.replace(/rn|nn/g, "m").replace(/[l1|]/g, "i").replace(/0/g, "o");
}

/** Distance d'édition : nombre de lettres à ajouter, enlever ou changer pour passer de a à b. */
function distance(a, b) {
  let precedente = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const ligne = [i];
    for (let j = 1; j <= b.length; j++) ligne[j] = Math.min(precedente[j] + 1, ligne[j - 1] + 1, precedente[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    precedente = ligne;
  }
  return precedente[b.length];
}

/** Erreurs de lecture tolérées pour un nom : 0 sous 4 lettres, 1 jusqu'à 4, 2 au-delà (« Karnia » pour « Karma »). */
const tolerance = (nom) => (nom.length < 4 ? 0 : nom.length <= 4 ? 1 : 2);

/**
 * Une ligne du chat est-elle un ping « ChampionEnnemi Sort » ? -> l'id du sort visé, ou null.
 *  cibles : [{ noms: ["Karma"...], sorts: [{ id, noms: ["Flash", "Saut éclair"...] }] }] (sorts.js : ciblesPings)
 * La ligne doit FINIR par le champion puis le sort (le début, « Pseudo (Champion): », est souvent mal lu).
 * Jamais les lignes « Wait For … » (le temps restant de ses PROPRES sorts) ni « … - Ready ».
 */
function pingDepuisLigne(texte, cibles) {
  const brute = normaliser(texte);
  if (!brute || /waitfor|ready$|pret$/.test(brute)) return null;
  const ligne = plier(brute);
  let meilleur = null;
  for (const cible of Array.isArray(cibles) ? cibles : []) {
    for (const nomChampion of cible.noms || []) {
      const champion = plier(normaliser(nomChampion));
      if (!champion) continue;
      for (const sort of cible.sorts || []) {
        for (const nomSort of sort.noms || []) {
          const s = plier(normaliser(nomSort));
          if (!s) continue;
          // Le sort à la toute fin de la ligne, puis le champion juste avant. Chacun avec SA tolérance (sinon « Ashe
          // Flash » passerait pour « Vex Flash » en perdant presque tout le nom) ; quelques lettres de plus ou de moins
          // sont permises (lettres ajoutées ou perdues par l'OCR).
          const ts = tolerance(s);
          const tc = tolerance(champion);
          for (let j = Math.max(1, s.length - ts); j <= Math.min(ligne.length, s.length + ts); j++) {
            const ds = distance(ligne.slice(-j), s);
            if (ds > ts) continue;
            for (let i = Math.max(1, champion.length - tc); i <= Math.min(ligne.length - j, champion.length + tc); i++) {
              const dc = distance(ligne.slice(-(i + j), -j), champion);
              if (dc <= tc && (!meilleur || ds + dc < meilleur.d)) meilleur = { id: sort.id, d: ds + dc };
            }
          }
        }
      }
    }
  }
  return meilleur ? meilleur.id : null;
}

/** L'OCR coupe parfois une ligne en morceaux : on regroupe ceux qui sont à la même hauteur, de gauche à droite. */
function regrouperLignes(morceaux) {
  const lignes = [];
  for (const m of [...(Array.isArray(morceaux) ? morceaux : [])].filter((x) => x && typeof x.texte === "string").sort((a, b) => a.y - b.y || a.x - b.x)) {
    const ligne = lignes.find((l) => Math.abs(l.y - m.y) <= Math.max(4, (m.hauteur || 0) / 2));
    if (ligne) ligne.morceaux.push(m);
    else lignes.push({ y: m.y, morceaux: [m] });
  }
  return lignes.map((l) => l.morceaux.sort((a, b) => a.x - b.x).map((m) => m.texte).join(" "));
}

/**
 * Zone du chat sur l'écran (pixels réels) : en bas à gauche, à la place par défaut du chat. Mesurée sur des captures
 * en 2560 x 1440 (x 40 à 600, y 760 à 1010), gardée en proportion de l'écran.
 */
function zoneChat({ largeur, hauteur }) {
  return { x: Math.round(largeur * 0.015), y: Math.round(hauteur * 0.528), largeur: Math.round(largeur * 0.22), hauteur: Math.round(hauteur * 0.175) };
}

/** Agrandissement de la zone avant l'OCR : 3 en 1440p (vérifié), plus sur un petit écran (texte plus petit), 2 à 4. */
function facteurChat(hauteurEcran) {
  return Math.max(2, Math.min(4, Math.round((3 * 1440) / (Number(hauteurEcran) || 1440))));
}

/**
 * Lecteur du chat : lire() -> lignes de texte du chat (capture, nettoyage, OCR, regroupement).
 *  lecteur : lecteur d'écran d'ocr.js (capturer, lireImage) ; ecran() : { largeur, hauteur } en pixels réels.
 */
function creerLecteurChat({ lecteur, ecran, dossierTemp = os.tmpdir(), systemeFichiers = fs }) {
  const capture = path.join(dossierTemp, `lol-companion-chat-${process.pid}.png`);
  const propre = path.join(dossierTemp, `lol-companion-chat-propre-${process.pid}.png`);
  return {
    async lire() {
      const e = ecran();
      try {
        await lecteur.capturer(zoneChat(e), capture);
        const image = nettoyerChat(lirePng(systemeFichiers.readFileSync(capture)), { facteur: facteurChat(e.hauteur) });
        systemeFichiers.writeFileSync(propre, ecrirePngGris(image));
        return regrouperLignes(await lecteur.lireImage(propre, { largeur: image.largeur, hauteur: image.hauteur }));
      } finally {
        for (const f of [capture, propre]) systemeFichiers.rmSync(f, { force: true }); // rien ne reste sur le disque
      }
    },
  };
}

/**
 * Mémoire courte : un même sort signalé plusieurs fois (le message reste quelques secondes à l'écran, et on spamme
 * souvent le ping) ne compte qu'une fois par dureeMs. nouveau(id) : true la première fois.
 */
function creerMemoirePings({ dureeMs = 30000, maintenant = Date.now } = {}) {
  const vus = new Map(); // id du sort -> quand on l'a vu
  return {
    nouveau(id) {
      const t = maintenant();
      for (const [cle, quand] of vus) if (t - quand >= dureeMs) vus.delete(cle);
      if (vus.has(id)) return false;
      vus.set(id, t);
      return true;
    },
    vider: () => vus.clear(),
  };
}

module.exports = {
  NOMS_SORTS,
  normaliser,
  plier,
  distance,
  pingDepuisLigne,
  regrouperLignes,
  zoneChat,
  facteurChat,
  creerLecteurChat,
  creerMemoirePings,
};
