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
