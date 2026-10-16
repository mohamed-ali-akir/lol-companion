/*
 * Images PNG et nettoyage de la zone du chat (pings des sorts, pings.js)
 * ---------------------------------------------------------------------
 * Tourne dans le processus principal (Node). Fonctions pures, testées (test/image.test.js). Aucune dépendance :
 * zlib est fourni avec Node. Le même code sert sous Windows et sur Mac.
 *
 * Pourquoi nettoyer (essais du 16/10/2026 sur de vraies captures) : le texte du chat est petit, en couleur et posé
 * sur le décor du jeu ; l'OCR le lit très mal tel quel (« V c y Rash » pour « Vex Flash »). On agrandit donc la zone
 * (3 fois) et on ne garde que les pixels VIFS et SATURÉS (bleu des pseudos, rouge des ennemis, orange des sorts), en
 * noir sur fond blanc : le décor, sombre ou terne, disparaît, et l'OCR relit « Vex Flash », « Karma Flash »...
 */
const zlib = require("zlib");

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CANAUX = { 0: 1, 2: 3, 4: 2, 6: 4 }; // type de couleur PNG -> nombre de canaux (gris, RVB, gris+alpha, RVBA)

class ErreurImage extends Error {}

/** Prédicteur « Paeth » du format PNG. */
function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/**
 * PNG -> { largeur, hauteur, canaux, pixels } (pixels : octets bruts, ligne par ligne).
 * Formats lus : 8 bits par canal, gris / RVB / gris+alpha / RVBA, non entrelacé (ce que font les captures d'écran
 * de Windows et de macOS). Tout le reste : ErreurImage (message clair, jamais de plantage).
 */
function lirePng(donnees) {
  const buf = Buffer.isBuffer(donnees) ? donnees : Buffer.from(donnees || []);
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SIGNATURE)) throw new ErreurImage("Ce n'est pas une image PNG.");
  let entete = null;
  const morceaux = [];
  let pos = 8;
  while (pos + 8 <= buf.length) {
    const taille = buf.readUInt32BE(pos);
    const type = buf.toString("latin1", pos + 4, pos + 8);
    const contenu = buf.subarray(pos + 8, pos + 8 + taille);
    if (contenu.length < taille) throw new ErreurImage("Image PNG coupée.");
    if (type === "IHDR") {
      entete = { largeur: contenu.readUInt32BE(0), hauteur: contenu.readUInt32BE(4), profondeur: contenu[8], couleur: contenu[9], entrelace: contenu[12] };
    } else if (type === "IDAT") {
      morceaux.push(contenu);
    } else if (type === "IEND") {
      break;
    }
    pos += 12 + taille; // longueur + type + contenu + CRC
  }
  if (!entete) throw new ErreurImage("Image PNG sans en-tête.");
  const canaux = CANAUX[entete.couleur];
  if (entete.profondeur !== 8 || !canaux || entete.entrelace !== 0) throw new ErreurImage("Format d'image PNG non pris en charge.");
  const { largeur, hauteur } = entete;
  let brut;
  try {
    brut = zlib.inflateSync(Buffer.concat(morceaux));
  } catch {
    throw new ErreurImage("Image PNG abîmée.");
  }
  const ligne = largeur * canaux;
  if (brut.length < hauteur * (ligne + 1)) throw new ErreurImage("Image PNG incomplète.");
  const pixels = Buffer.alloc(hauteur * ligne);
  for (let y = 0; y < hauteur; y++) {
    const filtre = brut[y * (ligne + 1)];
    const source = y * (ligne + 1) + 1;
    const dest = y * ligne;
    for (let i = 0; i < ligne; i++) {
      const x = brut[source + i];
      const a = i >= canaux ? pixels[dest + i - canaux] : 0; // à gauche
      const b = y > 0 ? pixels[dest - ligne + i] : 0; // au-dessus
      const c = y > 0 && i >= canaux ? pixels[dest - ligne + i - canaux] : 0; // en haut à gauche
      let v;
      if (filtre === 0) v = x;
      else if (filtre === 1) v = x + a;
      else if (filtre === 2) v = x + b;
      else if (filtre === 3) v = x + ((a + b) >> 1);
      else if (filtre === 4) v = x + paeth(a, b, c);
      else throw new ErreurImage("Image PNG abîmée (filtre inconnu).");
      pixels[dest + i] = v & 0xff;
    }
  }
  return { largeur, hauteur, canaux, pixels };
}

// CRC32 du format PNG (calculé une fois).
const TABLE_CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const octet of buf) c = TABLE_CRC[(c ^ octet) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function morceauPng(type, contenu) {
  const longueur = Buffer.alloc(4);
  longueur.writeUInt32BE(contenu.length);
  const typeEtContenu = Buffer.concat([Buffer.from(type, "latin1"), contenu]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeEtContenu));
  return Buffer.concat([longueur, typeEtContenu, crc]);
}

/** Image en niveaux de gris (1 octet par pixel) -> fichier PNG. */
function ecrirePngGris({ largeur, hauteur, pixels }) {
  const entete = Buffer.alloc(13);
  entete.writeUInt32BE(largeur, 0);
  entete.writeUInt32BE(hauteur, 4);
  entete[8] = 8; // 8 bits
  entete[9] = 0; // gris
  const brut = Buffer.alloc(hauteur * (largeur + 1)); // chaque ligne : filtre 0, puis les pixels
  for (let y = 0; y < hauteur; y++) pixels.copy(brut, y * (largeur + 1) + 1, y * largeur, (y + 1) * largeur);
  return Buffer.concat([SIGNATURE, morceauPng("IHDR", entete), morceauPng("IDAT", zlib.deflateSync(brut, { level: 1 })), morceauPng("IEND", Buffer.alloc(0))]);
}

/** Un pixel ressemble-t-il au texte du chat ? Vif (canal le plus fort assez haut) ET saturé (couleurs bien distinctes). */
const estTexteChat = (r, v, b, { saturation, luminosite }) => {
  const max = Math.max(r, v, b);
  return max >= luminosite && max - Math.min(r, v, b) >= saturation;
};

/**
 * Zone du chat (lirePng) -> image en gris agrandie `facteur` fois : texte du chat en noir, tout le reste en blanc.
 * Agrandissement « bilinéaire » (on mélange les 4 pixels voisins) AVANT le tri des couleurs : les lettres restent
 * lisses. Réglages vérifiés sur de vraies captures : saturation 110, luminosité 160.
 */
function nettoyerChat(image, { facteur = 3, saturation = 110, luminosite = 160 } = {}) {
  const { largeur, hauteur, canaux, pixels } = image;
  if (!(largeur > 0 && hauteur > 0) || !pixels || pixels.length < largeur * hauteur * canaux) throw new ErreurImage("Image vide.");
  const f = Math.max(1, Math.min(4, Math.round(facteur)));
  const L = largeur * f;
  const H = hauteur * f;
  const sortie = Buffer.alloc(L * H, 255);
  const reglages = { saturation, luminosite };
  const canal = (x, y, c) => pixels[(y * largeur + x) * canaux + (canaux >= 3 ? c : 0)];
  for (let oy = 0; oy < H; oy++) {
    const sy = Math.min(hauteur - 1, Math.max(0, (oy + 0.5) / f - 0.5));
    const y0 = Math.floor(sy);
    const y1 = Math.min(hauteur - 1, y0 + 1);
    const dy = sy - y0;
    for (let ox = 0; ox < L; ox++) {
      const sx = Math.min(largeur - 1, Math.max(0, (ox + 0.5) / f - 0.5));
      const x0 = Math.floor(sx);
      const x1 = Math.min(largeur - 1, x0 + 1);
      const dx = sx - x0;
      const melange = (c) =>
        (canal(x0, y0, c) * (1 - dx) + canal(x1, y0, c) * dx) * (1 - dy) + (canal(x0, y1, c) * (1 - dx) + canal(x1, y1, c) * dx) * dy;
      if (estTexteChat(melange(0), melange(1), melange(2), reglages)) sortie[oy * L + ox] = 0;
    }
  }
  return { largeur: L, hauteur: H, pixels: sortie };
}

module.exports = { ErreurImage, lirePng, ecrirePngGris, nettoyerChat, estTexteChat, crc32 };
