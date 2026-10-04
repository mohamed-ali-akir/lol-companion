/*
 * Journal de l'appli sur le disque
 * --------------------------------
 * Tourne dans le processus principal (Node).
 *
 * L'appli installée n'a pas de terminal : sans journal, impossible de savoir pourquoi, par exemple, l'acceptation
 * automatique n'a pas marché après un redémarrage du PC. On écrit donc l'essentiel (connexion au client, partie
 * trouvée, acceptation, erreurs rattrapées) dans <userData>/journal.txt, par exemple
 * %APPDATA%\lol-level-calculator\journal.txt.
 * Taille limitée : au-delà de 200 Ko, le fichier devient journal.ancien.txt (on garde donc au plus ~400 Ko).
 * Rien de personnel n'y est écrit (pas de mot de passe du client, pas de Riot ID).
 */
const fs = require("fs");
const path = require("path");

const TAILLE_MAX = 200 * 1024;

/** Une ligne du journal : "2026-10-02 20:13:32  message". */
function ligneJournal(date, morceaux) {
  const d = new Date(date);
  const deux = (n) => String(n).padStart(2, "0");
  const horodatage = `${d.getFullYear()}-${deux(d.getMonth() + 1)}-${deux(d.getDate())} ${deux(d.getHours())}:${deux(d.getMinutes())}:${deux(d.getSeconds())}`;
  const texte = morceaux
    .map((m) => (m instanceof Error ? m.stack || m.message : typeof m === "string" ? m : JSON.stringify(m)))
    .join(" ")
    .replace(/\r?\n/g, " ⏎ ");
  return `${horodatage}  ${texte}\n`;
}

/** Journal : { ecrire(...morceaux) }. N'échoue jamais (un journal ne doit rien casser). */
function creerJournal({ fichier, tailleMax = TAILLE_MAX, maintenant = Date.now }) {
  const ancien = path.join(path.dirname(fichier), `${path.basename(fichier, ".txt")}.ancien.txt`);
  return {
    ecrire(...morceaux) {
      try {
        fs.mkdirSync(path.dirname(fichier), { recursive: true });
        if (fs.existsSync(fichier) && fs.statSync(fichier).size > tailleMax) fs.renameSync(fichier, ancien);
        fs.appendFileSync(fichier, ligneJournal(maintenant(), morceaux));
      } catch {
        // disque plein, droits... : tant pis pour le journal, l'appli continue
      }
    },
  };
}

module.exports = { ligneJournal, creerJournal, TAILLE_MAX };
