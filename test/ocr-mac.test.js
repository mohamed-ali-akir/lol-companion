// Test du VRAI OCR du Mac (Vision), lancé seulement sur un Mac (par exemple le Mac de GitHub, workflow mac.yml).
// Sous Windows il est sauté : le reste de la lecture d'écran du Mac est testé avec de faux programmes (augments.test.js).
// On fabrique une image avec un texte connu (AppKit, via osascript), puis notre script Vision doit le relire.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const O = require("../ocr.js");

const SCRIPT_IMAGE = String.raw`
ObjC.import("AppKit");
function run(argv) {
  const image = $.NSImage.alloc.initWithSize($.NSMakeSize(900, 160));
  image.lockFocus;
  $.NSColor.whiteColor.setFill;
  $.NSRectFill($.NSMakeRect(0, 0, 900, 160));
  const attributs = $.NSDictionary.dictionaryWithObjectForKey($.NSFont.boldSystemFontOfSize(64), $.NSFontAttributeName);
  $("Goliath Slayer").drawAtPointWithAttributes($.NSMakePoint(40, 40), attributs);
  image.unlockFocus;
  const bitmap = $.NSBitmapImageRep.imageRepWithData(image.TIFFRepresentation);
  const png = bitmap.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $.NSDictionary.dictionary);
  png.writeToFileAtomically(argv[0], true);
  return "ok";
}`;

test("Mac : le script Vision relit un texte connu", { skip: process.platform !== "darwin" && "seulement sur Mac" }, () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "lol-vision-"));
  const image = path.join(dossier, "texte.png");
  try {
    execFileSync("osascript", ["-l", "JavaScript", "-e", SCRIPT_IMAGE, image], { timeout: 30000 });
    assert.ok(fs.existsSync(image), "image de test créée");
    const sortie = execFileSync("osascript", ["-l", "JavaScript", "-e", O.SCRIPT_VISION, image, "en-US"], { timeout: 30000 }).toString();
    const lignes = O.lignesDepuisVision(sortie, { x: 0, y: 0, largeur: 900, hauteur: 160 });
    console.log("Vision a lu :", JSON.stringify(lignes));
    assert.ok(Array.isArray(lignes) && lignes.length > 0, "au moins une ligne lue");
    const ligne = lignes.find((l) => /goliath/i.test(l.texte));
    assert.ok(ligne, "le texte « Goliath Slayer » est relu");
    // Le texte est en haut de l'image (dessiné à 40 px du BAS sur 160) : sa ligne doit être dans la moitié haute.
    assert.ok(ligne.y < 80, `position depuis le haut : ${ligne.y}`);
  } finally {
    fs.rmSync(dossier, { recursive: true, force: true });
  }
});

// Un faux chat aux couleurs du jeu (pseudo bleu, ennemi rouge, sort orange), petit texte sur un fond sombre :
// toute la chaîne de l'appli (image.js puis Vision) doit y reconnaître le ping « Vex Flash ».
const SCRIPT_CHAT = String.raw`
ObjC.import("AppKit");
function run(argv) {
  const image = $.NSImage.alloc.initWithSize($.NSMakeSize(563, 252));
  image.lockFocus;
  $.NSColor.colorWithSRGBRedGreenBlueAlpha(0.13, 0.17, 0.10, 1).setFill;
  $.NSRectFill($.NSMakeRect(0, 0, 563, 252));
  const police = $.NSFont.systemFontOfSize(17);
  const couleur = (r, v, b) => $.NSColor.colorWithSRGBRedGreenBlueAlpha(r / 255, v / 255, b / 255, 1);
  let x = 30;
  for (const [texte, c] of [["wDark (Ashe): ", couleur(70, 170, 235)], ["Vex ", couleur(230, 60, 60)], ["Flash", couleur(250, 170, 40)]]) {
    const attributs = $.NSDictionary.dictionaryWithObjectsForKeys($([police, c]), $([$.NSFontAttributeName, $.NSForegroundColorAttributeName]));
    const t = $(texte);
    t.drawAtPointWithAttributes($.NSMakePoint(x, 60), attributs);
    x += t.sizeWithAttributes(attributs).width;
  }
  image.unlockFocus;
  const bitmap = $.NSBitmapImageRep.imageRepWithData(image.TIFFRepresentation);
  bitmap.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $.NSDictionary.dictionary).writeToFileAtomically(argv[0], true);
  return "ok";
}`;

test("Mac : chaîne complète des pings (image.js + Vision) sur un faux chat aux couleurs du jeu", { skip: process.platform !== "darwin" && "seulement sur Mac" }, async () => {
  const I = require("../image.js");
  const P = require("../pings.js");
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "lol-chat-mac-"));
  const capture = path.join(dossier, "chat.png");
  const propre = path.join(dossier, "propre.png");
  try {
    execFileSync("osascript", ["-l", "JavaScript", "-e", SCRIPT_CHAT, capture], { timeout: 30000 });
    const image = I.nettoyerChat(I.lirePng(fs.readFileSync(capture)), { facteur: 3 });
    fs.writeFileSync(propre, I.ecrirePngGris(image));
    const lecteur = O.creerLecteurEcranMac({ langue: "en-US", dossierTemp: dossier });
    const lignes = P.regrouperLignes(await lecteur.lireImage(propre, { largeur: image.largeur, hauteur: image.hauteur }));
    console.log("Chat lu :", JSON.stringify(lignes));
    const cibles = [{ noms: ["Vex"], sorts: [{ id: "vex|0", noms: P.NOMS_SORTS.Flash }] }];
    assert.ok(lignes.some((l) => P.pingDepuisLigne(l, cibles) === "vex|0"), "ping « Vex Flash » reconnu");
  } finally {
    fs.rmSync(dossier, { recursive: true, force: true });
  }
});
