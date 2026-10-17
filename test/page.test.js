// Cohérence de la page (src/) et de ses ponts (preload.js, preload-overlay.js) avec le processus principal.
// -------------------------------------------------------------------------------------------------------
// Pourquoi (17/10/2026) : la page n'a pas de tests unitaires et ses fichiers sont des <script> classiques qui partagent
// les mêmes noms globaux. Une suppression ou un renommage peut casser la page sans qu'aucun test ne le voie (bouton qui
// pointe vers un élément disparu, fonction appelée dans un autre fichier qui n'existe plus, canal sans récepteur...).
// Ces tests lisent les fichiers tels quels, sans lancer Electron, et vérifient que tout s'emboîte.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const RACINE = path.join(__dirname, "..");
const SRC = path.join(RACINE, "src");
const lire = (fichier) => fs.readFileSync(path.join(RACINE, fichier), "utf8");

/** Les pages, chacune avec ses scripts (dans l'ordre de chargement), ses styles et son pont vers main.js. */
function lirePage(html) {
  const texte = lire(`src/${html}`);
  const scripts = [...texte.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => `src/${m[1]}`);
  const styles = [...texte.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map((m) => `src/${m[1]}`);
  const ids = [...texte.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  return { html: `src/${html}`, texte, scripts, styles, ids };
}
const PAGES = {
  principale: { ...lirePage("index.html"), pont: "appli", preload: "preload.js" },
  overlay: { ...lirePage("overlay.html"), pont: "overlay", preload: "preload-overlay.js" },
  majDemarrage: { ...lirePage("maj-demarrage.html"), pont: null, preload: null },
};

// --- Fichiers chargés ------------------------------------------------------------------------------

test("page : chaque script et feuille de style chargés existent", () => {
  for (const page of Object.values(PAGES)) {
    for (const f of [...page.scripts, ...page.styles]) assert.ok(fs.existsSync(path.join(RACINE, f)), `${page.html} charge ${f}, introuvable`);
  }
});

test("page principale : calculs.js et commun.js d'abord, app.js en dernier, et aucun onglet oublié", () => {
  const { scripts } = PAGES.principale;
  assert.deepStrictEqual(scripts.slice(0, 2), ["src/calculs.js", "src/commun.js"], "calculs.js puis commun.js (utilisés par tous les autres)");
  assert.strictEqual(scripts.at(-1), "src/app.js", "app.js démarre la page : il doit être chargé en dernier");
  const onglets = fs.readdirSync(path.join(SRC, "onglets")).filter((f) => f.endsWith(".js")).map((f) => `src/onglets/${f}`);
  const oublies = onglets.filter((f) => !scripts.includes(f));
  assert.deepStrictEqual(oublies, [], "fichiers d'onglets jamais chargés par index.html");
  assert.strictEqual(new Set(scripts).size, scripts.length, "un script chargé deux fois");
});

// --- Identifiants HTML ----------------------------------------------------------------------------

test("page : chaque identifiant (id) est unique dans sa page", () => {
  for (const page of Object.values(PAGES)) {
    const doublons = page.ids.filter((id, i) => page.ids.indexOf(id) !== i);
    assert.deepStrictEqual(doublons, [], `identifiants en double dans ${page.html}`);
  }
});

/** Identifiants écrits en dur dans le code : $("x"), getElementById("x"), querySelector("#x"). */
function idsUtilises(code) {
  const ids = new Set();
  for (const m of code.matchAll(/(?:\$|getElementById)\(\s*["']([\w-]+)["']\s*\)/g)) ids.add(m[1]);
  for (const m of code.matchAll(/querySelector(?:All)?\(\s*["']#([\w-]+)[^"']*["']\s*\)/g)) ids.add(m[1]);
  return ids;
}

test("page : chaque élément cherché par le code existe dans la page qui charge ce code", () => {
  for (const page of Object.values(PAGES)) {
    const existants = new Set(page.ids);
    for (const script of page.scripts) {
      const manquants = [...idsUtilises(lire(script))].filter((id) => !existants.has(id));
      assert.deepStrictEqual(manquants, [], `${script} cherche des éléments absents de ${page.html}`);
    }
  }
});

/**
 * Identifiants donnés par le code à des éléments qu'il crée : { id: "x" }, element.id = "x", ou une constante
 * const ID_... = "x" (ex. la liste de suggestions des champions, créée par selection.js).
 */
function idsCrees(code) {
  const motif = /(?:\bid:\s*|\.id\s*=\s*|\bconst\s+ID_\w+\s*=\s*)["']([\w-]+)["']/g;
  return [...code.matchAll(motif)].map((m) => m[1]);
}

test("page principale : onglets, liens entre éléments et cartes de l'accueil pointent vers des éléments qui existent", () => {
  const { texte, ids, scripts } = PAGES.principale;
  const existants = new Set([...ids, ...scripts.flatMap((s) => idsCrees(lire(s)))]); // ex. le titre de la courbe (niveau.js)
  const attributs = (nom) => [...texte.matchAll(new RegExp(`\\s${nom}="([^"]+)"`, "g"))].map((m) => m[1]);
  for (const nom of ["aria-controls", "aria-labelledby", "for", "list"]) {
    const manquants = attributs(nom).filter((id) => !existants.has(id));
    assert.deepStrictEqual(manquants, [], `${nom}="..." vers des éléments absents`);
  }
  // Chaque bouton d'onglet a son panneau, et chaque carte « data-vers » mène à un onglet qui existe.
  const onglets = attributs("data-onglet");
  for (const nom of onglets) assert.ok(existants.has(`panneau-${nom}`), `onglet « ${nom} » sans panneau`);
  const cibles = attributs("data-vers").filter((nom) => !onglets.includes(nom));
  assert.deepStrictEqual(cibles, [], "data-vers vers des onglets qui n'existent pas");
});

// --- Les scripts de la page, chargés ensemble -------------------------------------------------------

/**
 * Faux navigateur minimal : de quoi charger les scripts (déclarations, écouteurs) sans les démarrer.
 * Tout élément demandé est un objet « fourre-tout » qui accepte n'importe quelle propriété ou appel.
 */
function fourreTout() {
  const cible = function () {};
  return new Proxy(cible, {
    get: (_c, cle) => (cle === Symbol.toPrimitive ? () => "" : cle === Symbol.iterator ? [][Symbol.iterator] : cle === "then" ? undefined : fourreTout()),
    apply: () => fourreTout(),
    construct: () => fourreTout(),
    set: () => true,
  });
}
function chargerScripts(page) {
  const contexte = {
    console,
    setTimeout: () => 0,
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    requestAnimationFrame: () => 0,
    document: fourreTout(),
    navigator: { platform: "Win32", language: "fr-FR" },
    location: { href: "file:///index.html" },
    localStorage: fourreTout(),
    matchMedia: () => fourreTout(),
    ResizeObserver: function () {
      return fourreTout();
    },
    getComputedStyle: () => fourreTout(),
  };
  if (page.pont) contexte[page.pont] = fourreTout();
  contexte.window = contexte;
  vm.createContext(contexte);
  // Chargés dans l'ordre, dans le MÊME contexte (comme dans la page) : un nom global déclaré deux fois avec
  // const / let, ou une erreur au chargement, ferait planter ce test comme il ferait planter la page.
  for (const script of page.scripts) vm.runInContext(lire(script), contexte, { filename: script });
  return contexte;
}

test("page : les scripts se chargent ensemble, dans l'ordre, sans erreur (aucun nom global déclaré deux fois)", () => {
  for (const page of Object.values(PAGES)) if (page.scripts.length) assert.doesNotThrow(() => chargerScripts(page), `${page.html}`);
});

// Noms appelables sans être déclarés dans la page : ceux du navigateur et de JavaScript.
const GLOBAUX_NAVIGATEUR = new Set([
  "setTimeout", "clearTimeout", "setInterval", "clearInterval", "requestAnimationFrame", "getComputedStyle",
  "Number", "String", "Boolean", "Array", "Object", "Math", "JSON", "Date", "Promise", "Map", "Set", "RegExp", "Error",
  "Symbol", "Intl", "parseInt", "parseFloat", "isNaN", "isFinite", "encodeURIComponent", "decodeURIComponent",
  "Proxy", "Reflect", "BigInt", "structuredClone", "fetch", "alert", "confirm", "Option", "Image",
]);
const MOTS_DU_LANGAGE = new Set(["if", "for", "while", "switch", "catch", "function", "return", "typeof", "await", "new", "super", "import", "of", "in"]);

/** Noms déclarés dans un fichier (fonctions, variables, paramètres) : ses noms à lui, pas ceux des autres fichiers. */
function nomsDeclares(code) {
  const noms = new Set();
  const ajouterListe = (liste) => {
    for (const morceau of liste.replace(/[{}[\]]/g, ",").split(",")) {
      const nom = morceau.replace(/=.*$/s, "").replace(/^\s*\.\.\./, "").split(":").pop().trim();
      if (/^[A-Za-z_$][\w$]*$/.test(nom)) noms.add(nom);
    }
  };
  for (const m of code.matchAll(/function\s*\*?\s*([\w$]*)\s*\(([^)]*)\)/g)) {
    if (m[1]) noms.add(m[1]);
    ajouterListe(m[2]);
  }
  for (const m of code.matchAll(/\b(?:const|let|var)\s+([^=;]+?)\s*(?:=|;|\bof\b|\bin\b)/g)) ajouterListe(m[1]);
  for (const m of code.matchAll(/\(([^()]*)\)\s*=>/g)) ajouterListe(m[1]);
  for (const m of code.matchAll(/([\w$]+)\s*=>/g)) noms.add(m[1]);
  for (const m of code.matchAll(/catch\s*\(\s*([\w$]+)/g)) noms.add(m[1]);
  return noms;
}

/**
 * Code sans ses commentaires ni le contenu de ses textes ("...", '...', `...`), pour ne chercher les appels de
 * fonctions que dans le vrai code. Lu caractère par caractère : une adresse « lcu-image://... » dans un texte n'est
 * pas un commentaire, et le code entre ${ } d'un texte `...` est gardé (il peut appeler des fonctions).
 */
function sansTextesNiCommentaires(code) {
  let sortie = "";
  const pile = []; // textes `...` ouverts, avec la profondeur d'accolades de leur ${ } en cours
  let i = 0;
  while (i < code.length) {
    const c = code[i];
    const suivant = code[i + 1];
    const dansTexte = pile.length > 0 && pile[pile.length - 1].accolades === null;
    if (dansTexte) {
      if (c === "\\") i += 2;
      else if (c === "`") {
        pile.pop();
        sortie += '""';
        i++;
      } else if (c === "$" && suivant === "{") {
        pile[pile.length - 1].accolades = 0;
        sortie += " ";
        i += 2;
      } else i++;
      continue;
    }
    if (c === "/" && suivant === "/") {
      while (i < code.length && code[i] !== "\n") i++;
    } else if (c === "/" && suivant === "*") {
      const fin = code.indexOf("*/", i + 2);
      i = fin < 0 ? code.length : fin + 2;
    } else if (c === '"' || c === "'") {
      i++;
      while (i < code.length && code[i] !== c && code[i] !== "\n") i += code[i] === "\\" ? 2 : 1;
      i++;
      sortie += '""';
    } else if (c === "`") {
      pile.push({ accolades: null });
      i++;
    } else {
      const haut = pile[pile.length - 1];
      if (haut && c === "{") haut.accolades++;
      if (haut && c === "}") {
        if (haut.accolades === 0) {
          haut.accolades = null; // fin du ${ } : retour dans le texte
          i++;
          continue;
        }
        haut.accolades--;
      }
      sortie += c;
      i++;
    }
  }
  return sortie;
}

/**
 * Le nom est-il une fonction globale de la page ? On le demande au contexte lui-même : un « const $ = ... » au
 * niveau d'un script n'est pas une propriété de window, mais il est bien visible des autres scripts.
 */
function estFonctionGlobale(contexte, nom) {
  try {
    return vm.runInContext(`typeof ${nom} === "function"`, contexte);
  } catch {
    return false;
  }
}

test("page : chaque fonction appelée existe (dans le fichier, dans un script chargé avant ou après, ou dans le navigateur)", () => {
  for (const page of Object.values(PAGES)) {
    if (!page.scripts.length) continue;
    const contexte = chargerScripts(page);
    for (const script of page.scripts) {
      const code = sansTextesNiCommentaires(lire(script));
      const locaux = nomsDeclares(code);
      const appels = [...code.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]);
      const inconnus = [...new Set(appels)].filter(
        (nom) => !locaux.has(nom) && !MOTS_DU_LANGAGE.has(nom) && !GLOBAUX_NAVIGATEUR.has(nom) && !estFonctionGlobale(contexte, nom)
      );
      assert.deepStrictEqual(inconnus, [], `${script} appelle des fonctions qui n'existent nulle part`);
    }
  }
});

// --- Ponts vers le processus principal (preload) -------------------------------------------------------

/** Fonctions exposées par un preload : { nom: { type: "invoke" | "send" | "on", canal } }. */
function fonctionsDuPont(preload) {
  const code = lire(preload);
  const fonctions = {};
  for (const m of code.matchAll(/^\s*([\w$]+):\s*\([^)]*\)\s*=>\s*ipcRenderer\.(invoke|send|on)\(\s*"([^"]+)"/gm)) fonctions[m[1]] = { type: m[2], canal: m[3] };
  return fonctions;
}

test("ponts : la page n'utilise que des fonctions qui existent dans son preload, et le preload n'expose rien d'inutile", () => {
  for (const page of Object.values(PAGES)) {
    if (!page.pont) continue;
    const pont = fonctionsDuPont(page.preload);
    assert.ok(Object.keys(pont).length > 0, `aucune fonction lue dans ${page.preload}`);
    const code = page.scripts.map(lire).join("\n");
    const utilisees = new Set([...code.matchAll(new RegExp(`window\\.${page.pont}\\.([\\w$]+)`, "g"))].map((m) => m[1]));
    const absentes = [...utilisees].filter((nom) => !(nom in pont));
    assert.deepStrictEqual(absentes, [], `fonctions de window.${page.pont} appelées par la page mais absentes de ${page.preload}`);
    // Moins le pont en expose, moins une page détournée pourrait en faire : pas de fonction exposée pour rien.
    const inutiles = Object.keys(pont).filter((nom) => !utilisees.has(nom));
    assert.deepStrictEqual(inutiles, [], `fonctions de ${page.preload} que la page n'utilise jamais`);
  }
});

/** Code du processus principal : tous les modules à la racine (main.js et ce qu'il délègue). */
const CODE_PRINCIPAL = fs
  .readdirSync(RACINE)
  .filter((f) => f.endsWith(".js") && !f.startsWith("preload"))
  .map((f) => lire(f))
  .join("\n");

test("ponts : chaque canal a son récepteur dans le processus principal, et chaque message envoyé à une page est écouté", () => {
  // Récepteurs : ipcMain.handle / ipcMain.on, ou leurs enveloppes de messages.js (repondre / ecouterOverlay).
  const recus = { invoke: /(?:ipcMain\.handle|\brepondre)\(\s*"([^"]+)"/g, send: /(?:ipcMain\.on|\becouterOverlay)\(\s*"([^"]+)"/g };
  const ecoutes = new Set();
  for (const page of Object.values(PAGES)) {
    if (!page.preload) continue;
    for (const [nom, { type, canal }] of Object.entries(fonctionsDuPont(page.preload))) {
      if (type === "on") {
        ecoutes.add(canal);
        continue;
      }
      const canaux = new Set([...CODE_PRINCIPAL.matchAll(recus[type])].map((m) => m[1]));
      assert.ok(canaux.has(canal), `${page.preload} : ${nom}() utilise « ${canal} », que main.js ne reçoit pas (ipcMain.${type === "invoke" ? "handle" : "on"})`);
    }
  }
  const envoyes = new Set([...CODE_PRINCIPAL.matchAll(/(?:envoyerALaPage|webContents\.send)\(\s*"([^"]+)"/g)].map((m) => m[1]));
  assert.ok(envoyes.size > 0, "aucun message envoyé trouvé dans le processus principal");
  assert.deepStrictEqual([...envoyes].filter((c) => !ecoutes.has(c)), [], "messages envoyés par main.js que personne n'écoute");
  assert.deepStrictEqual([...ecoutes].filter((c) => !envoyes.has(c)), [], "messages écoutés par la page que main.js n'envoie jamais");
});
