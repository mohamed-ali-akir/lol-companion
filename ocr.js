/*
 * Lecture de texte à l'écran (OCR intégré à Windows)
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
const { spawn } = require("child_process");

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
function creerLecteurEcran({ langue = "en-US", lancer = spawn, plateforme = process.platform } = {}) {
  let processus = null;
  let tampon = "";
  let pret = null; // promesse : le script a fini de démarrer
  const enAttente = []; // { resoudre, rejeter, minuterie }

  function demarrer() {
    if (plateforme !== "win32") throw new Error("La lecture d'écran ne marche que sous Windows.");
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
        else attente.resoudre(attente.demarrage ? reponse : reponse.lignes);
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

  return {
    lire: (zone) => demander({ x: Math.round(zone.x), y: Math.round(zone.y), largeur: Math.round(zone.largeur), hauteur: Math.round(zone.hauteur) }),
    lireFichier: (chemin, haut, bas) => demander({ fichier: chemin, haut, bas }),
    arreter,
  };
}

module.exports = { langueOcr, commandeEncodee, lireReponse, creerLecteurEcran };
