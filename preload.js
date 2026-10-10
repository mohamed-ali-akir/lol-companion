// Pont entre la page (src/) et le processus principal (main.js).
// La page n'a pas accès à Node.js : elle ne voit que ces fonctions, via window.appli.
// Les premières fonctions envoient un message à main.js (ipcRenderer.invoke) et attendent sa réponse ;
// les fonctions "sur..." permettent à main.js de prévenir la page (mise à jour après une partie, etc.).
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("appli", {
  lireConfig: () => ipcRenderer.invoke("config:lire"),
  enregistrerDossierJeu: (dossier) => ipcRenderer.invoke("config:enregistrerDossierJeu", dossier),
  enregistrerOnglet: (nom) => ipcRenderer.invoke("config:enregistrerOnglet", nom),
  recupererDepuisClient: () => ipcRenderer.invoke("client:recuperer"),
  etatConnexion: () => ipcRenderer.invoke("client:etatConnexion"),
  lireEtatAppli: () => ipcRenderer.invoke("appli:etat"),
  lireClassee: () => ipcRenderer.invoke("classee:lire"),
  lireMissions: () => ipcRenderer.invoke("missions:lire"),
  lireMaitrise: () => ipcRenderer.invoke("maitrise:lire"),
  lireProgression: (compte) => ipcRenderer.invoke("progression:lire", { nom: compte.nom, tag: compte.tag }),
  effacerProgression: () => ipcRenderer.invoke("progression:effacer"),
  lireStats: (compte) => ipcRenderer.invoke("stats:lire", { nom: compte.nom, tag: compte.tag }),
  effacerStats: () => ipcRenderer.invoke("stats:effacer"),
  importerHistorique: () => ipcRenderer.invoke("stats:importer"),
  lireSession: () => ipcRenderer.invoke("session:lire"),
  enregistrerSession: (reglages) => ipcRenderer.invoke("session:enregistrer", reglages),
  lireArrierePlan: () => ipcRenderer.invoke("arrierePlan:lire"),
  enregistrerArrierePlan: (reglages) => ipcRenderer.invoke("arrierePlan:enregistrer", reglages),
  lireAcceptation: () => ipcRenderer.invoke("acceptation:lire"),
  enregistrerAcceptation: (reglages) => ipcRenderer.invoke("acceptation:enregistrer", reglages),
  lireSelection: () => ipcRenderer.invoke("selection:lire"),
  enregistrerSelection: (reglages) => ipcRenderer.invoke("selection:enregistrer", reglages),
  lireChampionsSelection: () => ipcRenderer.invoke("selection:champions"),
  lireConseilDraft: () => ipcRenderer.invoke("draft:lire"),
  lireBuild: () => ipcRenderer.invoke("build:lire"),
  enregistrerBuild: (reglages) => ipcRenderer.invoke("build:enregistrer", reglages),
  consulterBuild: (demande) => ipcRenderer.invoke("build:consulter", demande),

  // Messages envoyés par main.js sans que la page les demande (surveillance en direct).
  // On ne transmet que les données, jamais l'objet "événement" d'Electron.
  surMiseAJour: (rappel) => ipcRenderer.on("client:miseAJour", (_evenement, reponse) => rappel(reponse)),
  surConnexion: (rappel) => ipcRenderer.on("client:connexion", (_evenement, connecte) => rappel(connecte)),
  // État de l'appli (bandeau « pas encore prête ») : { pret, message }.
  surEtatAppli: (rappel) => ipcRenderer.on("appli:etat", (_evenement, etat) => rappel(etat)),
  surClassee: (rappel) => ipcRenderer.on("classee:miseAJour", (_evenement, reponse) => rappel(reponse)),
  surMissions: (rappel) => ipcRenderer.on("missions:miseAJour", (_evenement, reponse) => rappel(reponse)),
  surMaitrise: (rappel) => ipcRenderer.on("maitrise:miseAJour", (_evenement, reponse) => rappel(reponse)),
  surProgressionImport: (rappel) => ipcRenderer.on("stats:progression", (_evenement, info) => rappel(info)),
  surAcceptation: (rappel) => ipcRenderer.on("acceptation:evenement", (_evenement, info) => rappel(info)),
  surSelection: (rappel) => ipcRenderer.on("selection:evenement", (_evenement, info) => rappel(info)),
  // Conseiller de draft : { etat, role, propositions, message } ou null (sélection finie).
  surConseilDraft: (rappel) => ipcRenderer.on("draft:conseil", (_evenement, conseil) => rappel(conseil)),
  surBuild: (rappel) => ipcRenderer.on("build:evenement", (_evenement, info) => rappel(info)),
  // Acceptation auto cochée / décochée depuis le menu de l'icône (zone de notification).
  surReglagesAcceptation: (rappel) => ipcRenderer.on("acceptation:reglages", (_evenement, reglages) => rappel(reglages)),
});
