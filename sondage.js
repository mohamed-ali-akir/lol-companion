/*
 * Deuxième canal : l'appli interroge elle-même le client toutes les secondes
 * --------------------------------------------------------------------------
 * Tourne dans le processus principal (Node).
 *
 * Pourquoi : jusqu'ici, l'acceptation automatique et le pick/ban dépendaient d'UN SEUL canal, la connexion en direct
 * (WebSocket, surveillance.js) par laquelle le client prévient l'appli. Après un redémarrage du PC, cette connexion
 * s'établissait parfois très tard (vu le 02/10/2026 : appli lancée à 20:12, League à 20:13, connexion en direct
 * plusieurs minutes après) : l'appli restait sourde et la partie trouvée n'était pas acceptée.
 * Maintenant, en plus, toutes les secondes, l'appli demande au client (sur ce PC, 127.0.0.1) :
 *   GET /lol-gameflow/v1/gameflow-phase       -> la phase de jeu (et : le client répond-il ?) ;
 *   GET /lol-matchmaking/v1/ready-check       -> seulement en file (Matchmaking / ReadyCheck) ;
 *   GET /lol-champ-select/v1/session          -> seulement en sélection des champions (ChampSelect).
 * Les réponses alimentent la MÊME logique que la connexion en direct (acceptation.js, selection.js, build.js),
 * qui sait déjà ignorer les doublons. Coût : une petite requête locale par seconde.
 * Le sondage donne aussi l'état de l'appli pour le bandeau « pas encore prête » (etatPreparation).
 */
const { lireLockfile, appelerClient } = require("./lcu.js");

const PHASES_FILE = ["Matchmaking", "ReadyCheck"];

/**
 * Le processus de League dont le numéro est écrit dans le lockfile existe-t-il encore ?
 * Vu le 04/10/2026 : après un plantage ou un arrêt du PC, League peut laisser son lockfile ; l'appli croyait alors
 * « League démarre… » indéfiniment alors qu'il était fermé. process.kill(pid, 0) n'arrête rien : il vérifie
 * seulement que le processus existe (EPERM = il existe mais appartient à un autre utilisateur).
 * Numéro absent ou illisible : on ne conclut pas (considéré vivant).
 */
function processusVivantParDefaut(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (erreur) {
    return erreur.code === "EPERM";
  }
}

/**
 * État de l'appli pour le bandeau de la page : { pret, message }.
 *  - League fermé : pas de bandeau (la carte « Ton compte » dit déjà « Lance League of Legends… ») ;
 *  - League lancé mais qui ne répond pas encore : il démarre ;
 *  - League répond mais la connexion en direct n'est pas encore établie : l'acceptation marche déjà (sondage) ;
 *  - tout est prêt : pas de bandeau.
 */
function etatPreparation({ clientLance, clientRepond, directConnecte }) {
  if (!clientLance) return { pret: false, message: null };
  if (!clientRepond) return { pret: false, message: "League démarre… LoL Companion attend qu'il soit prêt." };
  if (!directConnecte) {
    return { pret: false, message: "Connexion à League en cours… (l'acceptation automatique fonctionne déjà)" };
  }
  return { pret: true, message: null };
}

/**
 * Sondage du client. Les rappels sont appelés dans une bulle (une erreur ne casse pas le sondage) :
 *  - aEtat({ clientLance, clientRepond, phase }) : quand l'état change ;
 *  - aPhase(phase)                               : quand la phase change ;
 *  - aReadyCheck(etat | null)                    : en file, toutes les secondes ; null en sortant de la file ;
 *  - aSelection(session | null)                  : en sélection, toutes les secondes ; null en sortant ;
 *  - aErreur(nom, erreur)                        : erreur dans un rappel.
 * appeler et lire (lcu.js) sont modifiables pour les tests. Renvoie { demarrer(), arreter(), etat() }.
 */
function creerSondage({
  dossierJeu,
  aEtat = () => {},
  aPhase = () => {},
  aReadyCheck = () => {},
  aSelection = () => {},
  aErreur = () => {},
  intervalleMs = 1000,
  appeler = appelerClient,
  lire = lireLockfile,
  processusVivant = processusVivantParDefaut,
}) {
  let minuterie = null;
  let enMarche = false;
  let dernier = { clientLance: false, clientRepond: false, phase: null };
  let etaitEnFile = false;
  let etaitEnSelection = false;

  const rappel = (nom, fonction, valeur) => {
    try {
      const r = fonction(valeur);
      if (r && typeof r.catch === "function") r.catch((e) => aErreur(nom, e));
    } catch (erreur) {
      aErreur(nom, erreur);
    }
  };

  async function lireJson(connexion, route) {
    const { status, corps } = await appeler(connexion, route);
    if (status !== 200) return null;
    try {
      return JSON.parse(corps);
    } catch {
      return null;
    }
  }

  async function tour() {
    if (!enMarche) return;
    const etat = { clientLance: false, clientRepond: false, phase: null };
    let readyCheck;
    let session;
    try {
      const connexion = lire(dossierJeu());
      if (!processusVivant(connexion.pid)) throw new Error("vieux lockfile : League est fermé");
      etat.clientLance = true;
      const phase = await lireJson(connexion, "/lol-gameflow/v1/gameflow-phase");
      if (typeof phase === "string") {
        etat.clientRepond = true;
        etat.phase = phase;
        if (PHASES_FILE.includes(phase)) readyCheck = await lireJson(connexion, "/lol-matchmaking/v1/ready-check");
        if (phase === "ChampSelect") session = await lireJson(connexion, "/lol-champ-select/v1/session");
      }
    } catch {
      // client fermé, ou qui ne répond pas encore
    }
    if (!enMarche) return;

    const enFile = etat.clientRepond && PHASES_FILE.includes(etat.phase);
    if (enFile) rappel("acceptation automatique", aReadyCheck, readyCheck ?? null);
    else if (etaitEnFile) rappel("acceptation automatique", aReadyCheck, null);
    etaitEnFile = enFile;

    const enSelection = etat.clientRepond && etat.phase === "ChampSelect";
    if (enSelection) rappel("sélection des champions", aSelection, session ?? null);
    else if (etaitEnSelection) rappel("sélection des champions", aSelection, null);
    etaitEnSelection = enSelection;

    if (etat.clientRepond && etat.phase !== dernier.phase) rappel("phase de jeu", aPhase, etat.phase);
    if (etat.clientLance !== dernier.clientLance || etat.clientRepond !== dernier.clientRepond || etat.phase !== dernier.phase) {
      rappel("état du client", aEtat, etat);
    }
    dernier = etat;
    minuterie = setTimeout(tour, intervalleMs);
  }

  return {
    demarrer() {
      if (enMarche) return;
      enMarche = true;
      tour();
    },
    arreter() {
      enMarche = false;
      clearTimeout(minuterie);
    },
    etat: () => dernier,
  };
}

module.exports = { PHASES_FILE, processusVivantParDefaut, etatPreparation, creerSondage };
