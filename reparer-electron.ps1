# reparer-electron.ps1
# Contourne le bug de decompression d'Electron avec Node >= 24.16 / 26.1 :
# le zip est bien telecharge, mais extract-zip s'arrete apres le premier fichier.
# Ce script decompresse le zip avec tar (outil de Windows) et ecrit path.txt.
# Il ne touche ni a src/, ni a main.js, ni a test/.

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

Write-Host "1/6 Verification de ELECTRON_SKIP_BINARY_DOWNLOAD (ignoree depuis Electron 42)" -ForegroundColor Cyan
Write-Host "    variable d'environnement : '$env:ELECTRON_SKIP_BINARY_DOWNLOAD'"
Write-Host "    config npm               : $(npm config get electron_skip_binary_download)"

$version = (Get-Content node_modules\electron\package.json -Raw | ConvertFrom-Json).version
$nomZip  = "electron-v$version-win32-x64.zip"

Write-Host "2/6 Recherche de $nomZip dans le cache d'Electron" -ForegroundColor Cyan
$zip = Get-ChildItem "$env:LOCALAPPDATA\electron\Cache" -Recurse -Filter $nomZip -ErrorAction SilentlyContinue |
       Select-Object -First 1 -ExpandProperty FullName
if (-not $zip) {
    $zip = Join-Path $env:TEMP $nomZip
    Write-Host "    Pas dans le cache : telechargement depuis GitHub (~100 Mo)..."
    $ProgressPreference = 'SilentlyContinue'
    Invoke-WebRequest "https://github.com/electron/electron/releases/download/v$version/$nomZip" -OutFile $zip
}
Write-Host "    zip : $zip"

Write-Host "3/6 Suppression du dossier dist a moitie rempli" -ForegroundColor Cyan
$dist = "node_modules\electron\dist"
if (Test-Path $dist) { Remove-Item -Recurse -Force $dist }
New-Item -ItemType Directory $dist | Out-Null

Write-Host "4/6 Decompression avec tar (outil integre a Windows)" -ForegroundColor Cyan
tar -xf $zip -C $dist
if ($LASTEXITCODE -ne 0) { throw "tar a echoue (code $LASTEXITCODE)" }
if (-not (Test-Path "$dist\electron.exe")) { throw "electron.exe introuvable apres decompression" }

Write-Host "5/6 Ecriture de path.txt (indique a Electron le nom de son executable)" -ForegroundColor Cyan
Set-Content -Path node_modules\electron\path.txt -Value "electron.exe" -NoNewline

Write-Host "6/6 Autorisation du script d'installation d'electron-winstaller (pour npm run build)" -ForegroundColor Cyan
npm install-scripts approve electron-winstaller
npm rebuild electron-winstaller

Write-Host ""
Write-Host "Verification : version d'Electron puis tests" -ForegroundColor Green
npx electron --version
npm test
Write-Host ""
Write-Host "Termine. Lance maintenant : npm start" -ForegroundColor Green
