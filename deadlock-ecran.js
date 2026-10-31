/*
 * Mode Deadlock : héros de la partie repérés sur l'écran (31/10/2026, accord du propriétaire)
 * ------------------------------------------------------------------------------------------------
 * Tourne dans le processus principal (Node). Le site ne voit que les parties de l'onglet « Regarder » du jeu
 * (deadlock-api.js : partieEnCours) : pour toutes les autres, l'appli reconnaît les portraits de la barre du haut.
 *
 * Comment : main.js capture la BANDE DU HAUT de l'écran principal (11 % de la hauteur, comme un partage d'écran ou OBS :
 * rien n'est lu dans le jeu, rien n'est écrit, anti-triche respecté). Chaque emplacement de portrait est comparé aux
 * petites icônes des héros de deadlock-api.com (« icon_image_small », la même tête que dans le jeu), à plusieurs tailles
 * et autour de la place attendue (donnees-jeu.js : DEADLOCK.barreHaut). La capture n'est jamais enregistrée ni envoyée :
 * elle est oubliée dès que les héros sont trouvés.
 *
 * Mesure : corrélation des couleurs (formes et contrastes, de -1 à 1) moins l'écart moyen des couleurs divisé par 250
 * (la corrélation seule se trompe sur les héros sombres, l'écart seul aussi : Seven pris pour Yamato), puis « ajustée » :
 * moins le score médian du même héros sur toute la barre. Décision en deux temps (voir reconnaitreBarre) : la barre
 * n'est « vue » que si 4 portraits sont reconnus sans aucun doute ; alors chaque portrait dont le meilleur héros devance
 * assez le 2e est gardé, les autres restent vides (héros mort, en gris ; sous « CRITICAL » : trouvés plus tard, ou à
 * choisir à la main). Essayé le 31/10/2026 sur de vraies captures : aucune erreur.
 *
 * Le calcul (quelques secondes) est découpé : la boucle rend la main (ceder) après chaque héros essayé, pour que
 * l'appli ne se fige jamais. Fonctions pures, testées dans test/deadlock-ecran.test.js avec des images fabriquées.
 * Images : { width, height, data } avec data en BGRA (format de nativeImage.toBitmap d'Electron), 4 octets par pixel.
 */
const { DEADLOCK } = require("./donnees-jeu.js");

const B = DEADLOCK.barreHaut;
const PAS_POINTS = 3; // un point de l'icône sur 3 (en largeur et en hauteur) : assez précis, 9 fois moins de calcul
const PAS_POSITION = 2; // positions essayées de 2 en 2 pixels
const OPAQUE = 220; // seuls les pixels opaques de l'icône comptent (le fond du portrait change : bleu, orange...)
// Réglés le 31/10/2026 sur 4 vraies captures en 2560×1440 (2 parties, 1 menu ; scores « ajustés », voir reconnaitreBarre) :
//  - menu : avance de 0,13 au plus, sur un seul emplacement -> barre jamais vue ;
//  - en partie : 5 à 10 emplacements à 0,15 ou plus ; les erreurs (héros mort en gris, sous « CRITICAL ») sont toutes
//    sous 0,08 d'avance, les bonnes réponses gardées au-dessus : 0 erreur, 4 à 6 ennemis trouvés par capture (les
//    autres restent vides et sont souvent trouvés à la capture suivante, deadlock.js cumule).
const SCORE_MIN = 0.05; // en dessous, ce n'est pas un portrait
const MARGE_SURE = 0.15; // avance d'un portrait reconnu sans aucun doute
const SURS_MIN = 4; // portraits sûrs (des deux équipes) pour dire que la barre est à l'écran
const MARGE_MIN = 0.08; // avance suffisante une fois la barre trouvée
const ENNEMIS_MIN = 3;

/** Les 12 emplacements de la barre : [{ equipe: "allie" | "ennemi", rang (0 à 5), cx (pixels) }]. */
function emplacements(largeur, hauteur) {
  const liste = [];
  for (let i = 0; i < 6; i++) liste.push({ equipe: "allie", rang: i, cx: largeur / 2 + (B.premierAllie + i * B.pas) * hauteur });
  for (let i = 0; i < 6; i++) liste.push({ equipe: "ennemi", rang: i, cx: largeur / 2 + (B.premierEnnemi + i * B.pas) * hauteur });
  return liste;
}

/** Redimensionne une image (moyenne des pixels couverts) : { width, height, data } BGRA -> carré de côté `cote`. */
function redimensionner(image, cote) {
  const data = Buffer.alloc(cote * cote * 4);
  const fx = image.width / cote, fy = image.height / cote;
  for (let y = 0; y < cote; y++) {
    for (let x = 0; x < cote; x++) {
      const x0 = Math.floor(x * fx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * fx));
      const y0 = Math.floor(y * fy), y1 = Math.max(y0 + 1, Math.floor((y + 1) * fy));
      const somme = [0, 0, 0, 0];
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const k = (yy * image.width + xx) * 4;
          for (let c = 0; c < 4; c++) somme[c] += image.data[k + c];
        }
      }
      const n = (x1 - x0) * (y1 - y0);
      for (let c = 0; c < 4; c++) data[(y * cote + x) * 4 + c] = Math.round(somme[c] / n);
    }
  }
  return { width: cote, height: cote, data };
}

/**
 * Prépare l'icône d'un héros pour un écran de hauteur `hauteurEcran` : { id, tailles: [{ cote, points }] }, points =
 * [x, y, b, g, r] des pixels opaques (1 sur PAS_POINTS). Fait une fois par héros et par hauteur d'écran.
 */
function preparerIcone(id, image, hauteurEcran) {
  return {
    id,
    tailles: B.tailles.map((f) => {
      const cote = Math.round(f * hauteurEcran);
      const petite = redimensionner(image, cote);
      const points = [];
      for (let y = 0; y < cote; y += PAS_POINTS) {
        for (let x = 0; x < cote; x += PAS_POINTS) {
          const k = (y * cote + x) * 4;
          if (petite.data[k + 3] >= OPAQUE) points.push([x, y, petite.data[k], petite.data[k + 1], petite.data[k + 2]]);
        }
      }
      return { cote, points };
    }),
  };
}

/** Ressemblance d'une icône posée en (ox, oy) sur la bande : corrélation - écart / 250 (plus c'est haut, mieux c'est). */
function ressemblance(bande, points, ox, oy) {
  const n = points.length;
  if (n < 20) return -Infinity;
  const moyA = [0, 0, 0], moyB = [0, 0, 0];
  let ecart = 0, vus = 0;
  for (const [x, y, ...couleur] of points) {
    const xx = x + ox, yy = y + oy;
    if (xx < 0 || yy < 0 || xx >= bande.width || yy >= bande.height) continue;
    const k = (yy * bande.width + xx) * 4;
    for (let c = 0; c < 3; c++) {
      moyA[c] += couleur[c];
      moyB[c] += bande.data[k + c];
      ecart += Math.abs(couleur[c] - bande.data[k + c]);
    }
    vus++;
  }
  if (vus < n * 0.8) return -Infinity; // l'icône sort trop de la bande
  for (let c = 0; c < 3; c++) {
    moyA[c] /= vus;
    moyB[c] /= vus;
  }
  let cov = 0, varA = 0, varB = 0;
  for (const [x, y, ...couleur] of points) {
    const xx = x + ox, yy = y + oy;
    if (xx < 0 || yy < 0 || xx >= bande.width || yy >= bande.height) continue;
    const k = (yy * bande.width + xx) * 4;
    for (let c = 0; c < 3; c++) {
      const a = couleur[c] - moyA[c], b = bande.data[k + c] - moyB[c];
      cov += a * b;
      varA += a * a;
      varB += b * b;
    }
  }
  const correlation = varA > 0 && varB > 0 ? cov / Math.sqrt(varA * varB) : 0;
  return correlation - ecart / (vus * 3) / 250;
}

/** Meilleure ressemblance d'un héros dans un emplacement (tailles et positions autour de la place attendue). */
function meilleurePlace(bande, hauteurEcran, cx, icone) {
  let meilleur = -Infinity;
  const marge = Math.round(B.margeX * hauteurEcran);
  const descente = Math.round(B.descenteMax * hauteurEcran);
  for (const { cote, points } of icone.tailles) {
    const xAttendu = Math.round(cx + B.decalageIcone * hauteurEcran - cote / 2);
    for (let oy = 0; oy <= descente; oy += PAS_POSITION) {
      for (let ox = xAttendu - marge; ox <= xAttendu + marge; ox += PAS_POSITION) {
        const r = ressemblance(bande, points, ox, oy);
        if (r > meilleur) meilleur = r;
      }
    }
  }
  return meilleur;
}

const cederParDefaut = () => new Promise((ok) => setImmediate(ok));

/**
 * Reconnaît les portraits de la bande du haut (capture de l'écran : largeur réelle de l'écran, hauteur = la bande).
 *  - hauteurEcran : hauteur de l'écran entier (la géométrie en dépend) ; icones : [preparerIcone(...)] ;
 *  - equipes : ["ennemi"] pour ne chercher que l'équipe adverse (moitié moins de calcul), ou ["allie", "ennemi"].
 * Renvoie { allies: [ids], ennemis: [ids], details } : seuls les portraits reconnus sans doute (score et marge
 * suffisants) ; details : pour chaque emplacement, { equipe, rang, premier, second } ({ id, score }), pour les réglages.
 */
async function reconnaitreBarre({ bande, hauteurEcran, icones, equipes = ["allie", "ennemi"], ceder = cederParDefaut }) {
  const resultat = { allies: [], ennemis: [], details: [] };
  if (!bande || !Array.isArray(icones) || icones.length < 2) return resultat;
  const places = emplacements(bande.width, hauteurEcran).filter((p) => equipes.includes(p.equipe));
  const bruts = []; // bruts[emplacement][icône]
  for (const place of places) {
    const ligne = [];
    for (const icone of icones) {
      ligne.push(meilleurePlace(bande, hauteurEcran, place.cx, icone));
      await ceder(); // l'appli reste fluide pendant le calcul
    }
    bruts.push(ligne);
  }
  // Chaque héros est mesuré contre lui-même : on retire son score médian sur toute la barre. Une icône neutre (Sinclair,
  // sombre et blanche) ressemble un peu à tout et passait 2e partout, ce qui écrasait les marges (vérifié en partie le
  // 31/10/2026) ; un héros n'étant qu'à une place, sa médiane mesure ce qu'il obtient « par hasard ».
  const medianes = icones.map((_, j) => {
    const valeurs = bruts.map((l) => l[j]).filter(Number.isFinite).sort((a, b) => a - b);
    return valeurs.length > 0 ? valeurs[Math.floor(valeurs.length / 2)] : 0;
  });
  places.forEach((place, i) => {
    const scores = icones
      .map((icone, j) => ({ id: icone.id, brut: bruts[i][j], score: Number.isFinite(bruts[i][j]) ? bruts[i][j] - medianes[j] : -Infinity }))
      .sort((a, b) => b.score - a.score);
    const [premier, second] = scores;
    resultat.details.push({ equipe: place.equipe, rang: place.rang, premier, second, marge: premier.score - second.score });
  });
  // 1. La barre est-elle là ? Au moins SURS_MIN portraits reconnus sans aucun doute (sur un menu ou un écran de
  //    chargement, aucun emplacement n'a une telle avance : vérifié sur une capture du menu le 31/10/2026).
  const surs = resultat.details.filter((d) => d.premier.score >= SCORE_MIN && d.marge >= MARGE_SURE);
  if (surs.length < SURS_MIN) return resultat;
  // 2. Barre présente : chaque emplacement est gardé avec une marge plus petite (MARGE_MIN). Un héros
  //    n'est qu'une fois dans une partie : s'il sort deux fois, seul l'emplacement le plus sûr le garde.
  const gardes = resultat.details
    .filter((d) => d.premier.score >= SCORE_MIN && d.marge >= MARGE_MIN)
    .sort((a, b) => b.marge - a.marge);
  const vus = new Set();
  for (const d of gardes) {
    if (vus.has(d.premier.id)) continue;
    vus.add(d.premier.id);
    d.garde = true;
  }
  for (const d of resultat.details) {
    if (d.garde) (d.equipe === "allie" ? resultat.allies : resultat.ennemis).push(d.premier.id);
  }
  return resultat;
}

/**
 * Lecteur de l'écran pour le service (deadlock.js) : analyser() -> { allies, ennemis } (3 ennemis reconnus au moins),
 * ou null (pas en partie, ou rien d'assez sûr).
 *  - capturer() : { bande, hauteurEcran } (main.js : desktopCapturer d'Electron), ou null si la capture est impossible ;
 *  - icones(hauteurEcran) : [preparerIcone(...)] (main.js : icônes de deadlock-api.com, décodées par nativeImage).
 * Une seule analyse à la fois.
 */
function creerLecteurEcran({ capturer, icones, ceder = cederParDefaut }) {
  let enCours = null;
  async function analyser() {
    const capture = await capturer();
    if (!capture || !capture.bande) return null;
    const liste = await icones(capture.hauteurEcran);
    const r = await reconnaitreBarre({ bande: capture.bande, hauteurEcran: capture.hauteurEcran, icones: liste, ceder });
    return r.ennemis.length >= ENNEMIS_MIN ? r : null;
  }
  return {
    analyser: () => {
      if (!enCours) enCours = analyser().finally(() => (enCours = null));
      return enCours;
    },
  };
}

module.exports = { MARGE_MIN, MARGE_SURE, SURS_MIN, SCORE_MIN, ENNEMIS_MIN, emplacements, redimensionner, preparerIcone, ressemblance, reconnaitreBarre, creerLecteurEcran };
