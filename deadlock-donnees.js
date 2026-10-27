/*
 * Mode Deadlock : données gardées sur ce PC (27/10/2026)
 * -------------------------------------------------------
 * Tourne dans le processus principal (Node). Fichier : <userData>/deadlock.json, écrit de façon sûre (fichiers.js :
 * copie .bak, jamais de fichier à moitié écrit). Il ne quitte jamais le PC.
 *
 * Contenu : { sessions: [{ debut, fin }], partiesEnvoyees: [numéro de partie] }
 *  - sessions : chaque fois que Deadlock a été lancé puis fermé (temps de jeu, onglet Accueil Deadlock). Une session de
 *    moins de 30 s est ignorée (jeu qui plante au lancement) ; 5 000 au plus (les plus anciennes partent d'abord) ;
 *  - partiesEnvoyees : parties du cache de Steam déjà envoyées à deadlock-api.com, pour ne jamais les renvoyer ;
 *    20 000 au plus.
 * Lecture tolérante : une valeur abîmée est ignorée, un fichier illisible repart de zéro (et le journal le dit).
 */
const path = require("path");
const { lireJson, ecrireJson } = require("./fichiers.js");

const SESSION_MIN_MS = 30 * 1000;
const SESSIONS_MAX = 5000;
const PARTIES_ENVOYEES_MAX = 20000;

/** Contenu lu (même abîmé) -> { sessions, partiesEnvoyees } propres (fonction pure, testée). */
function normaliserDonnees(brut) {
  const d = brut && typeof brut === "object" ? brut : {};
  const sessions = (Array.isArray(d.sessions) ? d.sessions : [])
    .filter((s) => s && Number.isFinite(s.debut) && Number.isFinite(s.fin) && s.fin - s.debut >= SESSION_MIN_MS)
    .map((s) => ({ debut: s.debut, fin: s.fin }))
    .sort((a, b) => a.debut - b.debut)
    .slice(-SESSIONS_MAX);
  const partiesEnvoyees = [...new Set((Array.isArray(d.partiesEnvoyees) ? d.partiesEnvoyees : []).filter(Number.isSafeInteger))].slice(-PARTIES_ENVOYEES_MAX);
  return { sessions, partiesEnvoyees };
}

function creerDonneesDeadlock({ dossier }) {
  const fichier = path.join(dossier, "deadlock.json");

  function lire() {
    try {
      return normaliserDonnees(lireJson(fichier));
    } catch {
      return normaliserDonnees(null); // pas encore de fichier (premier lancement de Deadlock)
    }
  }

  const ecrire = (donnees) => ecrireJson(fichier, normaliserDonnees(donnees));

  /** Ajoute une session de jeu (ignorée si elle dure moins de 30 s). */
  function ajouterSession({ debut, fin }) {
    if (!Number.isFinite(debut) || !Number.isFinite(fin) || fin - debut < SESSION_MIN_MS) return false;
    const d = lire();
    d.sessions.push({ debut, fin });
    ecrire(d);
    return true;
  }

  /** Note des parties comme envoyées à deadlock-api.com. */
  function noterEnvoyees(numeros) {
    const nouveaux = (Array.isArray(numeros) ? numeros : []).filter(Number.isSafeInteger);
    if (nouveaux.length === 0) return;
    const d = lire();
    d.partiesEnvoyees.push(...nouveaux);
    ecrire(d);
  }

  return {
    fichier,
    sessions: () => lire().sessions,
    partiesEnvoyees: () => new Set(lire().partiesEnvoyees),
    ajouterSession,
    noterEnvoyees,
  };
}

module.exports = { SESSION_MIN_MS, SESSIONS_MAX, PARTIES_ENVOYEES_MAX, normaliserDonnees, creerDonneesDeadlock };
