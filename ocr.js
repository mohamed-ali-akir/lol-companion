/*
 * Lecture de texte à l'écran (OCR intégré à Windows, ou à macOS)
 * --------------------------------------------------
 * Tourne dans le processus principal (Node). Sert à reconnaître les augments proposés en ARAM Mayhem
 * (augments.js) : Riot ne dit pas quels augments te sont proposés, il faut lire leurs noms à l'écran.
 *
 * Aucune dépendance : on utilise PowerShell (fourni avec Windows), qui sait
 *  - capturer une zone de l'écran (System.Drawing, CopyFromScreen) ;
 *  - lire le texte d'une image (Windows.Media.Ocr, le moteur OCR de Windows 10/11).
 * Un seul processus PowerShell est lancé et reste ouvert (le démarrer prend environ 1 s, une lecture 10 à 50 ms,
 * vérifié le 02/10/2026 sur des captures en 2560x1440) ; on lui envoie une demande par ligne, il répond par une ligne JSON.
 * Le script est passé en "-EncodedCommand" : aucun fichier .ps1 à installer.
 * Rien ne quitte le PC : la capture est lue puis effacée (fichier temporaire).
 */
const { spawn, execFile } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const DELAI_MAX_MS = 8000;

// Script PowerShell. %LANGUE% est remplacé par la langue du jeu (ex. "en-US"), vérifiée avant.
const SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
[Console]::InputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Runtime.WindowsRuntime
Add-Type -Namespace LoLCompanion -Name Ecran -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();'
[void][LoLCompanion.Ecran]::SetProcessDPIAware()
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
$null = [Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation` + "`" + String.raw`1' })[0]
function Attendre($op, [Type]$type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $t.Wait(-1) | Out-Null; $t.Result }
$moteur = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage((New-Object Windows.Globalization.Language '%LANGUE%'))
if ($moteur -eq $null) { $moteur = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages() }
$temp = Join-Path $env:TEMP ('lol-companion-ocr-' + $PID + '.png')
function Lire($chemin, $dx, $dy) {
  $fichier = Attendre ([Windows.Storage.StorageFile]::GetFileFromPathAsync($chemin)) ([Windows.Storage.StorageFile])
  $flux = Attendre ($fichier.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
  $decodeur = Attendre ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($flux)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $bitmap = Attendre ($decodeur.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
  $resultat = Attendre ($moteur.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
  $flux.Dispose()
  $lignes = @()
  foreach ($ligne in $resultat.Lines) {
    $mots = @($ligne.Words | ForEach-Object { $_ })
    if ($mots.Count -eq 0) { continue }
    $x1 = ($mots | ForEach-Object { $_.BoundingRect.X } | Measure-Object -Minimum).Minimum
    $y1 = ($mots | ForEach-Object { $_.BoundingRect.Y } | Measure-Object -Minimum).Minimum
    $x2 = ($mots | ForEach-Object { $_.BoundingRect.X + $_.BoundingRect.Width } | Measure-Object -Maximum).Maximum
    $y2 = ($mots | ForEach-Object { $_.BoundingRect.Y + $_.BoundingRect.Height } | Measure-Object -Maximum).Maximum
    $lignes += @{ texte = $ligne.Text; x = [int]($x1 + $dx); y = [int]($y1 + $dy); largeur = [int]($x2 - $x1); hauteur = [int]($y2 - $y1) }
  }
  return ,$lignes
}
[Console]::Out.WriteLine((ConvertTo-Json -Compress -InputObject @{ pret = $true; langue = $moteur.RecognizerLanguage.LanguageTag }))
while ($true) {
  $demande = [Console]::In.ReadLine()
  if ($demande -eq $null) { break }
  try {
    $d = $demande | ConvertFrom-Json
    $chrono = [Diagnostics.Stopwatch]::StartNew()
    if ($d.capture) {
      # Capture seule, enregistrée dans un fichier PNG (zone du chat : nettoyée par image.js avant l'OCR).
      $bmp = New-Object System.Drawing.Bitmap $d.largeur, $d.hauteur
      $g = [System.Drawing.Graphics]::FromImage($bmp)
      $g.CopyFromScreen($d.x, $d.y, 0, 0, $bmp.Size)
      $g.Dispose()
      $bmp.Save($d.capture, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
      [Console]::Out.WriteLine((ConvertTo-Json -Compress -InputObject @{ capture = $true; ms = $chrono.ElapsedMilliseconds }))
      continue
    }
    if ($d.fichier) {
      # Essais : lire une image (bande de $d.haut à $d.bas), au lieu de l'écran.
      $img = [System.Drawing.Image]::FromFile($d.fichier)
      $zone = New-Object System.Drawing.Rectangle 0, $d.haut, $img.Width, ($d.bas - $d.haut)
      $bmp = New-Object System.Drawing.Bitmap $zone.Width, $zone.Height
      $g = [System.Drawing.Graphics]::FromImage($bmp)
      $g.DrawImage($img, (New-Object System.Drawing.Rectangle 0, 0, $zone.Width, $zone.Height), $zone, [System.Drawing.GraphicsUnit]::Pixel)
      $g.Dispose(); $img.Dispose(); $dx = 0; $dy = $d.haut
    } else {
      $bmp = New-Object System.Drawing.Bitmap $d.largeur, $d.hauteur
      $g = [System.Drawing.Graphics]::FromImage($bmp)
      $g.CopyFromScreen($d.x, $d.y, 0, 0, $bmp.Size)
      $g.Dispose(); $dx = $d.x; $dy = $d.y
    }
    $bmp.Save($temp, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
    $lignes = Lire $temp $dx $dy
    Remove-Item $temp -ErrorAction SilentlyContinue
    [Console]::Out.WriteLine((ConvertTo-Json -Compress -Depth 4 -InputObject @{ lignes = $lignes; ms = $chrono.ElapsedMilliseconds }))
  } catch {
    [Console]::Out.WriteLine((ConvertTo-Json -Compress -InputObject @{ erreur = $_.Exception.Message }))
  }
}
`;

/** Langue de l'OCR à partir de la langue du jeu ("en_US" -> "en-US"), "en-US" si elle est bizarre. */
function langueOcr(locale) {
  const m = /^([a-z]{2})[_-]([A-Z]{2})$/.exec(String(locale || ""));
  return m ? `${m[1]}-${m[2]}` : "en-US";
}

/** Commande PowerShell encodée (UTF-16 en base 64, format attendu par -EncodedCommand). */
function commandeEncodee(langue) {
  return Buffer.from(SCRIPT.replace("%LANGUE%", langueOcr(langue.replace("-", "_"))), "utf16le").toString("base64");
}

/** Une ligne de réponse du script -> objet, ou null si illisible. Les lignes de texte sont toujours un tableau. */
function lireReponse(ligne) {
  let r;
  try {
    r = JSON.parse(ligne);
  } catch {
    return null;
  }
  if (!r || typeof r !== "object") return null;
  if ("lignes" in r) {
    const brutes = Array.isArray(r.lignes) ? r.lignes : r.lignes ? [r.lignes] : []; // PowerShell : 1 élément = pas de tableau
    r.lignes = brutes.filter((l) => l && typeof l.texte === "string" && [l.x, l.y, l.largeur, l.hauteur].every(Number.isFinite));
  }
  return r;
}

/**
 * Lecteur d'écran : { lire(zone), lireFichier(chemin, haut, bas), arreter() }.
 * zone : { x, y, largeur, hauteur } en pixels réels de l'écran. Renvoie [{ texte, x, y, largeur, hauteur }].
 * lancer : spawn (modifiable pour les tests).
 */
function creerLecteurEcran({ langue = "en-US", lancer = spawn, plateforme = process.platform, echelle = () => 1 } = {}) {
  if (plateforme === "darwin") return creerLecteurEcranMac({ langue, echelle }); // Mac : screencapture + Vision
  let processus = null;
  let tampon = "";
  let pret = null; // promesse : le script a fini de démarrer
  const enAttente = []; // { resoudre, rejeter, minuterie }

  function demarrer() {
    if (plateforme !== "win32") throw new Error("La lecture d'écran ne marche que sous Windows et sur Mac.");
    processus = lancer("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", commandeEncodee(langue)], {
      windowsHide: true,
      stdio: ["pipe", "pipe", "ignore"],
    });
    tampon = "";
    pret = new Promise((resoudre, rejeter) => {
      const minuterie = setTimeout(() => {
        rejeter(new Error("La lecture d'écran n'a pas pu démarrer."));
        arreter();
      }, 15000);
      enAttente.push({ resoudre, rejeter, demarrage: true, minuterie });
    });
    processus.stdout.on("data", (morceau) => {
      tampon += morceau.toString("utf8");
      let fin;
      while ((fin = tampon.indexOf("\n")) >= 0) {
        const ligne = tampon.slice(0, fin).trim();
        tampon = tampon.slice(fin + 1);
        if (!ligne) continue;
        const attente = enAttente.shift();
        if (!attente) continue;
        clearTimeout(attente.minuterie);
        const reponse = lireReponse(ligne);
        if (!reponse) attente.rejeter(new Error("Réponse illisible de la lecture d'écran."));
        else if (reponse.erreur) attente.rejeter(new Error(`Lecture d'écran impossible : ${reponse.erreur}`));
        else attente.resoudre(attente.demarrage || !("lignes" in reponse) ? reponse : reponse.lignes); // capture : { capture: true }
      }
    });
    const fini = () => {
      processus = null;
      while (enAttente.length) {
        const a = enAttente.shift();
        clearTimeout(a.minuterie);
        a.rejeter(new Error("La lecture d'écran s'est arrêtée."));
      }
    };
    processus.on("exit", fini);
    processus.on("error", fini);
  }

  async function demander(demande) {
    if (!processus) demarrer();
    await pret;
    return new Promise((resoudre, rejeter) => {
      const minuterie = setTimeout(() => {
        rejeter(new Error("La lecture d'écran ne répond pas."));
        arreter(); // on repartira de zéro à la prochaine demande
      }, DELAI_MAX_MS);
      enAttente.push({ resoudre, rejeter, minuterie });
      processus.stdin.write(`${JSON.stringify(demande)}\n`);
    });
  }

  function arreter() {
    if (processus) {
      try {
        processus.stdin.end();
        processus.kill();
      } catch {
        // déjà arrêté
      }
    }
    processus = null;
  }

  const zoneEntiere = (zone) => ({ x: Math.round(zone.x), y: Math.round(zone.y), largeur: Math.round(zone.largeur), hauteur: Math.round(zone.hauteur) });
  return {
    lire: (zone) => demander(zoneEntiere(zone)),
    lireFichier: (chemin, haut, bas) => demander({ fichier: chemin, haut, bas }),
    /** Capture la zone dans un fichier PNG (pixels réels de l'écran), sans OCR. */
    capturer: (zone, chemin) => demander({ capture: chemin, ...zoneEntiere(zone) }).then(() => chemin),
    /** OCR d'une image entière (ex. la zone du chat nettoyée) : lignes en pixels de l'image. */
    lireImage: (chemin, { hauteur }) => demander({ fichier: chemin, haut: 0, bas: Math.round(hauteur) }),
    arreter,
  };
}

// --- Mac : capture + OCR de macOS (Vision), sans rien installer (16/10/2026) ------------------------
// Pour chaque lecture :
//  1. « screencapture » (fourni avec macOS) capture la zone dans un fichier temporaire. Il travaille en « points »
//     (l'échelle Retina, ex. 2), alors que l'appli parle en pixels réels : on divise par l'échelle ;
//  2. « osascript -l JavaScript » (JavaScript pour macOS, fourni aussi) appelle Vision, l'OCR d'Apple ;
//  3. Vision donne la place de chaque ligne en FRACTIONS de l'image, en partant du BAS : on la ramène en pixels
//     de l'écran, en partant du haut, comme sous Windows.
// macOS demande l'autorisation « Enregistrement de l'écran » une fois (sans elle, la capture ne montre que le bureau).
// Rien ne quitte le Mac : la capture est lue puis effacée.

const SCRIPT_VISION = String.raw`
ObjC.import("Foundation");
ObjC.import("Vision");
function run(argv) {
  const requete = $.VNRecognizeTextRequest.alloc.init;
  requete.setRecognitionLevel(0); // 0 = précis
  requete.setUsesLanguageCorrection(false); // des noms d'augments, pas des phrases
  try {
    if (argv[1]) requete.setRecognitionLanguages($([argv[1]]));
  } catch (e) {} // langue inconnue de Vision : sa langue par défaut
  const image = $.NSURL.fileURLWithPath(argv[0]);
  const lecteur = $.VNImageRequestHandler.alloc.initWithURLOptions(image, $.NSDictionary.dictionary);
  if (!lecteur.performRequestsError($.NSArray.arrayWithObject(requete), null)) return JSON.stringify({ erreur: "Vision n'a pas pu lire l'image" });
  const resultats = requete.results;
  const lignes = [];
  for (let i = 0; i < resultats.count; i++) {
    const observation = resultats.objectAtIndex(i);
    const candidats = observation.topCandidates(1);
    if (!candidats || candidats.count < 1) continue;
    const b = observation.boundingBox;
    lignes.push({ texte: candidats.objectAtIndex(0).string.js, x: b.origin.x, y: b.origin.y, largeur: b.size.width, hauteur: b.size.height });
  }
  return JSON.stringify({ lignes: lignes });
}`;

/**
 * Réponse du script Vision -> [{ texte, x, y, largeur, hauteur }] en pixels de l'écran (comme sous Windows).
 * Vision : fractions de l'image (0 à 1), origine en BAS à gauche. zone : la zone capturée, en pixels réels.
 * Lignes abîmées ignorées ; null si la réponse est illisible ; lance une erreur si Vision en signale une.
 */
function lignesDepuisVision(sortie, zone) {
  let r;
  try {
    r = JSON.parse(String(sortie || "").trim());
  } catch {
    return null;
  }
  if (!r || typeof r !== "object") return null;
  if (r.erreur) throw new Error(`Lecture d'écran impossible : ${r.erreur}`);
  if (!Array.isArray(r.lignes)) return null;
  return r.lignes
    .filter((l) => l && typeof l.texte === "string" && [l.x, l.y, l.largeur, l.hauteur].every(Number.isFinite))
    .map((l) => ({
      texte: l.texte,
      x: Math.round(zone.x + l.x * zone.largeur),
      y: Math.round(zone.y + (1 - l.y - l.hauteur) * zone.hauteur), // Vision compte depuis le bas
      largeur: Math.round(l.largeur * zone.largeur),
      hauteur: Math.round(l.hauteur * zone.hauteur),
    }));
}

/**
 * Lecteur d'écran du Mac : mêmes fonctions que celui de Windows ({ lire(zone), lireFichier, arreter }).
 *  executer : execFile (modifiable pour les tests) ; echelle() : échelle de l'écran (2 sur un écran Retina).
 */
function creerLecteurEcranMac({ langue = "en-US", executer = execFile, echelle = () => 1, dossierTemp = os.tmpdir() } = {}) {
  const fichier = path.join(dossierTemp, `lol-companion-ocr-${process.pid}.png`);
  let enCours = null; // une seule lecture à la fois (le même fichier temporaire)

  const lancer = (programme, args) =>
    new Promise((resoudre, rejeter) => {
      executer(programme, args, { timeout: DELAI_MAX_MS, maxBuffer: 4 * 1024 * 1024 }, (erreur, sortie) =>
        erreur ? rejeter(new Error(`Lecture d'écran impossible (${programme}) : ${erreur.message}`)) : resoudre(String(sortie || ""))
      );
    });

  /** Zone en pixels réels -> { z (entiers, vérifiée), points ("x,y,l,h" pour screencapture, échelle Retina) }. */
  function preparerZone(zone) {
    const z = { x: Math.round(zone.x), y: Math.round(zone.y), largeur: Math.round(zone.largeur), hauteur: Math.round(zone.hauteur) };
    if (![z.x, z.y, z.largeur, z.hauteur].every(Number.isFinite) || z.largeur <= 0 || z.hauteur <= 0) throw new Error("Zone de lecture invalide.");
    const e = Number(echelle()) > 0 ? Number(echelle()) : 1;
    return { z, points: [z.x / e, z.y / e, z.largeur / e, z.hauteur / e].map((n) => Math.round(n)).join(",") };
  }

  /** Vision sur une image : lignes en pixels de `cadre` (la zone de l'écran, ou l'image entière). */
  async function vision(chemin, cadre) {
    const lignes = lignesDepuisVision(await lancer("osascript", ["-l", "JavaScript", "-e", SCRIPT_VISION, chemin, langueOcr(String(langue).replace("-", "_"))]), cadre);
    if (!lignes) throw new Error("Réponse illisible de la lecture d'écran.");
    return lignes;
  }

  async function lire(zone) {
    const { z, points } = preparerZone(zone);
    try {
      await lancer("screencapture", ["-x", "-t", "png", "-R", points, fichier]); // -x : sans bruit d'appareil photo
      return await vision(fichier, z);
    } finally {
      fs.rm(fichier, { force: true }, () => {}); // la capture ne reste jamais sur le disque
    }
  }

  /** Une seule commande à la fois (même fichier temporaire, et le Mac n'est pas surchargé). */
  const uneAUne = (action) => {
    const suivante = (enCours || Promise.resolve()).catch(() => {}).then(action);
    enCours = suivante;
    return suivante;
  };

  return {
    lire: (zone) => uneAUne(() => lire(zone)),
    lireFichier: () => Promise.reject(new Error("La lecture d'une image enregistrée n'existe que sous Windows.")),
    /** Capture la zone dans un fichier PNG, sans OCR (le fichier est à effacer par l'appelant). */
    capturer: (zone, chemin) =>
      uneAUne(async () => {
        const { points } = preparerZone(zone);
        await lancer("screencapture", ["-x", "-t", "png", "-R", points, chemin]);
        return chemin;
      }),
    /** OCR d'une image entière (ex. la zone du chat nettoyée) : lignes en pixels de l'image. */
    lireImage: (chemin, { largeur, hauteur }) => uneAUne(() => vision(chemin, { x: 0, y: 0, largeur, hauteur })),
    arreter: () => {}, // rien ne reste ouvert entre deux lectures
  };
}

module.exports = { langueOcr, commandeEncodee, lireReponse, creerLecteurEcran, lignesDepuisVision, creerLecteurEcranMac, SCRIPT_VISION };
