// Pont entre la page (src/) et le processus principal (main.js).
// La page n'a pas accès à Node.js : elle ne voit que ces fonctions, via window.appli.
// Les premières fonctions envoient un message à main.js (ipcRenderer.invoke) et attendent sa réponse ;
// les fonctions "sur..." permettent à main.js de prévenir la page (mise à jour après une partie, etc.).
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("appli", {
  lireConfig: () => ipcRenderer.invoke("config:lire"),
  enregistrerDossierJeu: (dossier) => ipcRenderer.invoke("config:enregistrerDossierJeu", dossier),
  enregistrerOnglet: (nom) => ipcRenderer.invoke("config:enregistrerOnglet", nom),
  noterAssistantVu: () => ipcRenderer.invoke("config:assistantVu"), // assistant de première ouverture fini ou passé
  recupererDepuisClient: () => ipcRenderer.invoke("client:recuperer"),
  etatConnexion: () => ipcRenderer.invoke("client:etatConnexion"),
  lireEtatAppli: () => ipcRenderer.invoke("appli:etat"),
  lireMaitrise: () => ipcRenderer.invoke("maitrise:lire"),
  lireProgression: (compte) => ipcRenderer.invoke("progression:lire", { nom: compte.nom, tag: compte.tag }),
  lireStats: (compte) => ipcRenderer.invoke("stats:lire", { nom: compte.nom, tag: compte.tag }),
  importerHistorique: () => ipcRenderer.invoke("stats:importer"),
  lireArrierePlan: () => ipcRenderer.invoke("arrierePlan:lire"),
  enregistrerArrierePlan: (reglages) => ipcRenderer.invoke("arrierePlan:enregistrer", reglages),
  lireAcceptation: () => ipcRenderer.invoke("acceptation:lire"),
  enregistrerAcceptation: (reglages) => ipcRenderer.invoke("acceptation:enregistrer", reglages),
  lireSelection: () => ipcRenderer.invoke("selection:lire"),
  enregistrerSelection: (reglages) => ipcRenderer.invoke("selection:enregistrer", reglages),
  lireChampionsSelection: () => ipcRenderer.invoke("selection:champions"),
  lireConseilDraft: () => ipcRenderer.invoke("draft:lire"),
  lireChallenge: () => ipcRenderer.invoke("challenge:lire"),
  enregistrerChallenge: (reglages) => ipcRenderer.invoke("challenge:enregistrer", reglages),
  lireBuild: () => ipcRenderer.invoke("build:lire"),
  enregistrerBuild: (reglages) => ipcRenderer.invoke("build:enregistrer", reglages),
  consulterBuild: (demande) => ipcRenderer.invoke("build:consulter", demande),
  remettreSets: () => ipcRenderer.invoke("build:remettreSets"), // tes anciens sets d'objets renvoyés au client
  lireMaj: () => ipcRenderer.invoke("maj:lire"),
  verifierMaj: () => ipcRenderer.invoke("maj:verifier"),
  installerMaj: () => ipcRenderer.invoke("maj:installer"),
  // Mode Deadlock (deadlock.js) : état, Accueil, Héros, Build, réglages.
  lireDeadlock: () => ipcRenderer.invoke("deadlock:etat"),
  lireAccueilDeadlock: () => ipcRenderer.invoke("deadlock:accueil"),
  lireHerosDeadlock: () => ipcRenderer.invoke("deadlock:heros"),
  listeHerosDeadlock: () => ipcRenderer.invoke("deadlock:listeHeros"),
  consulterBuildDeadlock: (heroId) => ipcRenderer.invoke("deadlock:build", heroId),
  enregistrerDeadlock: (reglages) => ipcRenderer.invoke("deadlock:enregistrer", reglages),

  // Messages envoyés par main.js sans que la page les demande (surveillance en direct).
  // On ne transmet que les données, jamais l'objet "événement" d'Electron.
  surMiseAJour: (rappel) => ipcRenderer.on("client:miseAJour", (_evenement, reponse) => rappel(reponse)),
  surConnexion: (rappel) => ipcRenderer.on("client:connexion", (_evenement, connecte) => rappel(connecte)),
  // État de l'appli (bandeau « pas encore prête ») : { pret, message }.
  surEtatAppli: (rappel) => ipcRenderer.on("appli:etat", (_evenement, etat) => rappel(etat)),
  surMaitrise: (rappel) => ipcRenderer.on("maitrise:miseAJour", (_evenement, reponse) => rappel(reponse)),
  surProgressionImport: (rappel) => ipcRenderer.on("stats:progression", (_evenement, info) => rappel(info)),
  surAcceptation: (rappel) => ipcRenderer.on("acceptation:evenement", (_evenement, info) => rappel(info)),
  surSelection: (rappel) => ipcRenderer.on("selection:evenement", (_evenement, info) => rappel(info)),
  // Conseiller de draft : { etat, role, propositions, message } ou null (sélection finie).
  surConseilDraft: (rappel) => ipcRenderer.on("draft:conseil", (_evenement, conseil) => rappel(conseil)),
  // Mise à jour de l'appli : { etape, version, nouvelle, pourcentage, message } (mise-a-jour.js).
  surMaj: (rappel) => ipcRenderer.on("maj:etat", (_evenement, etat) => rappel(etat)),
  surBuild: (rappel) => ipcRenderer.on("build:evenement", (_evenement, info) => rappel(info)),
  // Mode Deadlock : jeu lancé ou fermé, temps de jeu, parties envoyées (deadlock.js).
  surDeadlock: (rappel) => ipcRenderer.on("deadlock:etat", (_evenement, etat) => rappel(etat)),
  // Acceptation auto cochée / décochée depuis le menu de l'icône (zone de notification).
  surReglagesAcceptation: (rappel) => ipcRenderer.on("acceptation:reglages", (_evenement, reglages) => rappel(reglages)),
});
