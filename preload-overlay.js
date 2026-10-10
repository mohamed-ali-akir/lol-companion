// Pont de la fenêtre transparente par-dessus le jeu (src/overlay.html) : augments ARAM Mayhem, alerte des objectifs
// et panneau des sorts adverses. Elle reçoit ce que main.js lui envoie ; les seuls messages qu'elle peut renvoyer
// sont « la souris est sur le panneau » et « clic sur tel sort ».
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("overlay", {
  surEtiquettes: (rappel) => ipcRenderer.on("augments:etiquettes", (_evenement, info) => rappel(info)),
  // Bandeau des objectifs : [{ texte, restantS }] ou null (objectifs.js).
  surObjectif: (rappel) => ipcRenderer.on("objectifs:alerte", (_evenement, lignes) => rappel(lignes)),
  // Panneau des sorts adverses : [{ alias, championId, sorts: [{ id, nom, restantS, cliquable }] }] ou null (sorts.js).
  surSorts: (rappel) => ipcRenderer.on("sorts:etat", (_evenement, panneau) => rappel(panneau)),
  souris: (dessus) => ipcRenderer.send("overlay:souris", dessus === true),
  cliquerSort: (id) => ipcRenderer.send("sorts:clic", String(id)),
});
