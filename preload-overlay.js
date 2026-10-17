// Pont de la fenêtre transparente par-dessus le jeu (src/overlay.html) : augments ARAM Mayhem et panneau des sorts
// adverses. Elle reçoit ce que main.js lui envoie ; les seuls messages qu'elle peut renvoyer
// sont « la souris est sur le panneau », « clic sur tel sort » et « le panneau a été déplacé ici ».
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("overlay", {
  surEtiquettes: (rappel) => ipcRenderer.on("augments:etiquettes", (_evenement, info) => rappel(info)),
  // Panneau des sorts adverses : [{ alias, championId, sorts: [{ id, nom, restantS, cliquable }] }] ou null (sorts.js).
  surSorts: (rappel) => ipcRenderer.on("sorts:etat", (_evenement, panneau) => rappel(panneau)),
  souris: (dessus) => ipcRenderer.send("overlay:souris", dessus === true),
  cliquerSort: (id) => ipcRenderer.send("sorts:clic", String(id)),
  // Place du panneau des sorts : { x, y } en part de l'écran, ou null (place par défaut).
  surPositionSorts: (rappel) => ipcRenderer.on("sorts:position", (_evenement, position) => rappel(position)),
  deplacerSorts: (position) => ipcRenderer.send("sorts:position", position && { x: Number(position.x), y: Number(position.y) }),
});
