// Pont de la fenêtre transparente des augments (src/overlay.html).
// Elle ne fait qu'afficher : une seule fonction, recevoir les étiquettes envoyées par main.js.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("overlay", {
  surEtiquettes: (rappel) => ipcRenderer.on("augments:etiquettes", (_evenement, info) => rappel(info)),
});
