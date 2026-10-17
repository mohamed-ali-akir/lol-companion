/*
 * Mise à jour de l'appli, côté Electron : au lancement, puis en arrière-plan (Windows) ; vérification seule (Mac)
 * ---------------------------------------------------------------------------------------------------------------
 * Tourne dans le processus principal. Sorti de main.js le 17/10/2026 (main.js devenait trop gros) ; la logique,
 * elle, est dans mise-a-jour.js (testée avec un faux electron-updater). Seulement pour l'appli installée : lancée
 * depuis le projet (npm start), il n'y a rien à mettre à jour (et pas de fichier app-update.yml).
 *
 *  - installerAuDemarrage() : s'il existe une nouvelle version, elle est installée AVANT d'ouvrir l'appli (choix du
 *    propriétaire, 17/10/2026), avec une petite fenêtre « Mise à jour… » (rien au démarrage de Windows en réduit).
 *    Renvoie true si l'appli va se fermer pour s'installer (il ne faut alors rien démarrer d'autre) ;
 *  - fermerEcran() : ferme cette petite fenêtre, APRÈS l'ouverture de la fenêtre principale (la fermer avant, alors
 *    qu'aucune autre fenêtre n'existe, déclencherait « window-all-closed » et l'appli quitterait) ;
 *  - demarrer() : vérifications en arrière-plan (bandeau « Redémarrer et mettre à jour », Paramètres) ;
 *  - suivi() : l'objet de mise-a-jour.js (lire, verifierMaintenant, installer, arreter), ou null.
 */
const path = require("path");
const { creerMiseAJour, creerVerificationMac, majAuDemarrage, ADRESSE_LATEST_YML } = require("./mise-a-jour.js");
const { telecharger } = require("./internet.js"); // règles communes des appels à Internet (User-Agent, délai)

/**
 * electron : { app, BrowserWindow, shell } ; actif() : case « Chercher les mises à jour » cochée ? ;
 * envoyer(etat) : prévient la page ; journal(...) ; lanceeReduite() : démarrage de Windows en réduit ? ;
 * icone : chemin de l'icône de la petite fenêtre.
 */
function creerMajAppli({ electron, actif, envoyer, journal, lanceeReduite, icone }) {
  const { app, BrowserWindow, shell } = electron;
  let miseAJour = null;
  let ecran = null; // petite fenêtre « Mise à jour… » du lancement

  /** Petite fenêtre « Mise à jour de LoL Companion… » (src/maj-demarrage.html : texte seul, aucun script). */
  function ouvrirEcran() {
    const fenetre = new BrowserWindow({
      width: 420,
      height: 120,
      frame: false,
      resizable: false,
      alwaysOnTop: true,
      show: false,
      backgroundColor: "#0a1428",
      icon: icone,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    fenetre.loadFile(path.join(__dirname, "src", "maj-demarrage.html"));
    fenetre.once("ready-to-show", () => fenetre.show());
    return fenetre;
  }

  async function installerAuDemarrage() {
    if (!app.isPackaged || process.platform !== "win32" || !actif()) return false;
    try {
      const { autoUpdater } = require("electron-updater");
      const resultat = await majAuDemarrage({
        updater: autoUpdater,
        journal,
        trouvee: () => {
          if (!lanceeReduite()) ecran = ouvrirEcran();
        },
      });
      return resultat === "installation";
    } catch (erreur) {
      console.error("Mise à jour au lancement impossible :", erreur); // pas grave : l'appli démarre normalement
      return false;
    }
  }

  function fermerEcran() {
    if (ecran && !ecran.isDestroyed()) ecran.destroy(); // mise à jour du lancement abandonnée (trop longue...)
    ecran = null;
  }

  function demarrer() {
    if (!app.isPackaged) return;
    // Mac : installer exige une appli signée par Apple (99 $/an) ; on vérifie seulement, et le bandeau ouvre la page
    // de téléchargement (mise-a-jour.js, creerVerificationMac).
    if (process.platform === "darwin") {
      miseAJour = creerVerificationMac({
        lireLatestYml: () => telecharger({ appeler: (...a) => fetch(...a), adresse: ADRESSE_LATEST_YML, site: "GitHub", Erreur: Error }),
        ouvrir: (adresse) => shell.openExternal(adresse),
        version: app.getVersion(),
        actif,
        envoyer,
        journal,
      });
      miseAJour.demarrer();
      return;
    }
    if (process.platform !== "win32") return;
    try {
      const { autoUpdater } = require("electron-updater"); // chargé seulement ici : inutile pendant le développement
      miseAJour = creerMiseAJour({ updater: autoUpdater, version: app.getVersion(), actif, envoyer, journal });
      miseAJour.demarrer();
    } catch (erreur) {
      console.error("Mise à jour automatique impossible :", erreur); // pas grave : l'appli marche sans
    }
  }

  return { installerAuDemarrage, fermerEcran, demarrer, suivi: () => miseAJour };
}

module.exports = { creerMajAppli };
