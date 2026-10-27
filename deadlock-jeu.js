/*
 * Deadlock sur ce PC : jeu lancé ?, compte Steam, parties dans le cache de Steam (27/10/2026)
 * --------------------------------------------------------------------------------------------
 * Tourne dans le processus principal (Node). Lecture seule, rien d'Internet ici (l'envoi est dans deadlock-api.js).
 *
 * Ce que l'appli ne fait JAMAIS avec Deadlock (anti-triche de Valve) : lire la mémoire du jeu, s'afficher par-dessus,
 * modifier un fichier du jeu. Deadlock n'a pas d'API locale (pas de « Game State Integration » comme CS2 ou Dota 2 :
 * vérifié le 27/10/2026 dans les fichiers du jeu). On regarde seulement :
 *  - la liste des programmes de Windows (tasklist) : deadlock.exe tourne-t-il ?
 *  - le compte Steam connecté : registre de Windows (HKCU\Software\Valve\Steam\ActiveProcess, ActiveUser), sinon
 *    Steam\config\loginusers.vdf (le compte utilisé en dernier). Il sert à demander TON historique à deadlock-api.com
 *    (accord du propriétaire, 27/10/2026) ; le pseudo reste sur le PC ;
 *  - le cache web de Steam (Steam\appcache\httpcache) : quand tu ouvres une partie dans l'historique du jeu, Steam y
 *    garde l'adresse de son résumé, http://replay<serveur>.valve.net/1422450/<partie>_<clé>.meta.bz2. Ces numéros
 *    permettent à deadlock-api.com de connaître la partie (même méthode que l'outil officiel du site, deadlock-api-ingest,
 *    licence MIT, src/scan_cache.rs : les 200 premiers octets de chaque fichier). Envoi seulement si la case est cochée.
 */
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { DEADLOCK } = require("./donnees-jeu.js");

const CHEMIN_STEAM_PAR_DEFAUT = "C:\\Program Files (x86)\\Steam";
const BASE_STEAMID64 = 76561197960265728n; // SteamID64 = cette base + numéro du compte (account_id de l'API)
const OCTETS_LUS = 200; // comme l'outil du site : l'adresse est au début du fichier du cache
const FICHIERS_MAX = 100000; // garde-fou : on ne parcourt jamais un cache démesuré en entier
const DELAI_COMMANDE_MS = 5000;

/** Lance une commande de Windows et renvoie sa sortie (texte). Rejetée si elle échoue ou dépasse 5 s. */
function executer(commande, args) {
  return new Promise((ok, echec) => {
    execFile(commande, args, { timeout: DELAI_COMMANDE_MS, windowsHide: true, encoding: "utf8" }, (erreur, sortie) => (erreur ? echec(erreur) : ok(String(sortie || ""))));
  });
}

// --- Le jeu est-il lancé ? ------------------------------------------------------------------------------------

/** Sortie de `tasklist /FO CSV /NH` -> le programme nom est-il dans la liste ? (« Image Name » = 1re colonne) */
function programmeDansListe(sortie, nom = DEADLOCK.processus) {
  const cible = String(nom).toLowerCase();
  return String(sortie || "")
    .split(/\r?\n/)
    .some((ligne) => {
      const m = /^"([^"]+)"/.exec(ligne.trim());
      return Boolean(m) && m[1].toLowerCase() === cible;
    });
}

/** Deadlock tourne-t-il sur ce PC ? (Windows seulement : le jeu n'existe que sur Windows, 27/10/2026) */
async function deadlockLance({ plateforme = process.platform, lancer = executer } = {}) {
  if (plateforme !== "win32") return false;
  try {
    return programmeDansListe(await lancer("tasklist", ["/FO", "CSV", "/NH", "/FI", `IMAGENAME eq ${DEADLOCK.processus}`]));
  } catch {
    return false; // tasklist indisponible : on ne conclut pas que le jeu tourne
  }
}

// --- Le compte Steam ------------------------------------------------------------------------------------------

/** Sortie de `reg query <clé> /v <nom>` -> la valeur (texte, ou nombre pour un REG_DWORD), ou null. */
function valeurRegistre(sortie, nom) {
  for (const ligne of String(sortie || "").split(/\r?\n/)) {
    const m = /^\s*(\S+)\s+(REG_SZ|REG_EXPAND_SZ|REG_DWORD)\s+(.*?)\s*$/.exec(ligne);
    if (!m || m[1].toLowerCase() !== String(nom).toLowerCase()) continue;
    if (m[2] === "REG_DWORD") {
      const n = Number.parseInt(m[3], 16);
      return Number.isFinite(n) ? n : null;
    }
    return m[3] || null;
  }
  return null;
}

async function lireRegistre(cle, nom, lancer) {
  try {
    return valeurRegistre(await lancer("reg", ["query", cle, "/v", nom]), nom);
  } catch {
    return null; // clé absente (Steam jamais installé) : pas une erreur
  }
}

/** Dossier de Steam (registre, sinon le dossier par défaut). */
async function dossierSteam({ plateforme = process.platform, lancer = executer } = {}) {
  if (plateforme !== "win32") return null;
  const lu = await lireRegistre("HKCU\\Software\\Valve\\Steam", "SteamPath", lancer);
  return lu ? path.normalize(lu) : CHEMIN_STEAM_PAR_DEFAUT;
}

/** SteamID64 (texte de 17 chiffres) -> numéro du compte (account_id), ou null. */
function numeroDuCompte(steamId64) {
  if (!/^\d{17}$/.test(String(steamId64 || ""))) return null;
  const n = BigInt(steamId64) - BASE_STEAMID64;
  return n > 0n && n < 2n ** 32n ? Number(n) : null;
}

/**
 * loginusers.vdf (comptes déjà connectés sur ce PC) -> [{ accountId, pseudo, recent, horodatage }].
 * Format texte de Valve : "users" { "<SteamID64>" { "AccountName" "..." "PersonaName" "..." "MostRecent" "1"
 * "Timestamp" "..." } }. Lecture simple et tolérante (un bloc abîmé est ignoré).
 */
function comptesDepuisLoginusers(texte) {
  const comptes = [];
  for (const bloc of String(texte || "").matchAll(/"(\d{17})"\s*\{([^{}]*)\}/g)) {
    const valeurs = {};
    for (const kv of bloc[2].matchAll(/"([^"]+)"\s+"([^"]*)"/g)) valeurs[kv[1].toLowerCase()] = kv[2];
    const accountId = numeroDuCompte(bloc[1]);
    if (!accountId) continue;
    comptes.push({
      accountId,
      pseudo: valeurs.personaname || null,
      recent: valeurs.mostrecent === "1",
      horodatage: Number(valeurs.timestamp) || 0,
    });
  }
  return comptes;
}

/**
 * Compte Steam de ce PC : { accountId, pseudo } ou null.
 * D'abord le compte CONNECTÉ (registre, Steam ouvert), sinon le compte utilisé en dernier (loginusers.vdf).
 */
async function compteSteam({ plateforme = process.platform, lancer = executer, lireFichier = (f) => fs.promises.readFile(f, "utf8") } = {}) {
  if (plateforme !== "win32") return null;
  const steam = await dossierSteam({ plateforme, lancer });
  let comptes = [];
  try {
    comptes = comptesDepuisLoginusers(await lireFichier(path.join(steam, "config", "loginusers.vdf")));
  } catch {
    comptes = []; // fichier absent : Steam jamais connecté sur ce PC
  }
  const connecte = await lireRegistre("HKCU\\Software\\Valve\\Steam\\ActiveProcess", "ActiveUser", lancer);
  if (Number.isInteger(connecte) && connecte > 0) {
    const fiche = comptes.find((c) => c.accountId === connecte);
    return { accountId: connecte, pseudo: fiche ? fiche.pseudo : null };
  }
  const dernier = comptes.find((c) => c.recent) || [...comptes].sort((a, b) => b.horodatage - a.horodatage)[0];
  return dernier ? { accountId: dernier.accountId, pseudo: dernier.pseudo } : null;
}

// --- Parties dans le cache de Steam --------------------------------------------------------------------------

/**
 * Adresses des parties de Deadlock dans un morceau de fichier du cache (texte latin1), comme l'outil du site :
 * hôte « replay....valve.net » et chemin contenant le numéro du jeu (1422450), jusqu'à une espace, ', ", \0 ou fin de ligne.
 */
function adressesDeParties(texte) {
  const adresses = [];
  for (const m of String(texte || "").matchAll(/(?<![A-Za-z0-9.])(replay[A-Za-z0-9.]*\.valve\.net)(\/[^ '"\0\r\n]{1,256})/g)) {
    if (m[2].includes(`/${DEADLOCK.appIdSteam}/`)) adresses.push(`http://${m[1]}${m[2]}`);
  }
  return adresses;
}

/**
 * Adresse d'une partie -> { match_id, cluster_id, metadata_salt } (.meta.bz2) ou { ..., replay_salt } (.dem.bz2),
 * au format attendu par POST /v1/matches/salts ; null si l'adresse ne correspond pas.
 */
function clesDepuisAdresse(adresse) {
  const sansQuestion = String(adresse || "").split("?")[0];
  const m = /^http:\/\/replay(\d+)\.valve\.net\/(\d+)\/(\d+)_(\d+)\.(meta|dem)\.bz2$/.exec(sansQuestion);
  if (!m || Number(m[2]) !== DEADLOCK.appIdSteam) return null;
  const [cluster, match, cle] = [m[1], m[3], m[4]].map(Number);
  if (![cluster, match, cle].every(Number.isSafeInteger)) return null;
  return { match_id: match, cluster_id: cluster, [m[5] === "meta" ? "metadata_salt" : "replay_salt"]: cle };
}

/** Regroupe les clés d'une même partie (résumé .meta et replay .dem trouvés séparément). */
function regrouperCles(cles) {
  const parPartie = new Map();
  for (const c of Array.isArray(cles) ? cles : []) {
    if (!c || !Number.isSafeInteger(c.match_id)) continue;
    parPartie.set(c.match_id, { ...(parPartie.get(c.match_id) || {}), ...c });
  }
  return [...parPartie.values()];
}

/** Lit les premiers octets d'un fichier (null s'il est illisible : fichier en cours d'écriture par Steam...). */
async function debutDuFichier(fichier) {
  let poignee = null;
  try {
    poignee = await fs.promises.open(fichier, "r");
    const tampon = Buffer.alloc(OCTETS_LUS);
    const { bytesRead } = await poignee.read(tampon, 0, OCTETS_LUS, 0);
    return tampon.subarray(0, bytesRead).toString("latin1");
  } catch {
    return null;
  } finally {
    if (poignee) await poignee.close().catch(() => {});
  }
}

/**
 * Toutes les parties de Deadlock trouvées dans le cache de Steam : [{ match_id, cluster_id, metadata_salt?, replay_salt? }].
 * Parcourt le dossier (et ses sous-dossiers) sans jamais rien modifier ; au plus FICHIERS_MAX fichiers.
 */
async function partiesDuCache(dossierCache, { lireDebut = debutDuFichier } = {}) {
  const cles = [];
  const aVisiter = [dossierCache];
  let fichiers = 0;
  while (aVisiter.length > 0 && fichiers < FICHIERS_MAX) {
    const dossier = aVisiter.pop();
    let entrees = [];
    try {
      entrees = await fs.promises.readdir(dossier, { withFileTypes: true });
    } catch {
      continue; // dossier absent ou illisible
    }
    for (const e of entrees) {
      const chemin = path.join(dossier, e.name);
      if (e.isDirectory()) aVisiter.push(chemin);
      else if (e.isFile() && fichiers++ < FICHIERS_MAX) {
        for (const adresse of adressesDeParties(await lireDebut(chemin))) {
          const c = clesDepuisAdresse(adresse);
          if (c) cles.push(c);
        }
      }
    }
  }
  return regrouperCles(cles);
}

/** Dossier du cache web de Steam (où Steam garde les adresses des parties ouvertes dans le jeu). */
const dossierCacheSteam = (steam) => path.join(steam || CHEMIN_STEAM_PAR_DEFAUT, "appcache", "httpcache");

// --- Surveillance : lancement et fermeture du jeu ----------------------------------------------------------

/**
 * Regarde toutes les intervalleMs si Deadlock tourne, et prévient quand il démarre ou s'arrête.
 *  - surLancement(debut) : le jeu vient de démarrer (ou tournait déjà à la première vérification) ;
 *  - surFermeture({ debut, fin }) : le jeu vient de s'arrêter ;
 *  - aErreur(erreur) : erreur dans un rappel (la surveillance continue).
 * estLance et maintenant sont modifiables pour les tests. Renvoie { demarrer, arreter, verifier, etat }.
 */
function creerSuiviDeadlock({ estLance = deadlockLance, intervalleMs = 5000, maintenant = Date.now, surLancement = () => {}, surFermeture = () => {}, aErreur = () => {} }) {
  let debut = null; // début de la session en cours, ou null si le jeu est fermé
  let minuterie = null;
  let enCours = false;

  const appeler = async (rappel, ...args) => {
    try {
      await rappel(...args);
    } catch (erreur) {
      aErreur(erreur);
    }
  };

  async function verifier() {
    if (enCours) return; // une vérification à la fois (tasklist peut être lent)
    enCours = true;
    try {
      let lance;
      try {
        lance = await estLance();
      } catch (erreur) {
        aErreur(erreur); // on ne conclut rien : on réessaie à la prochaine vérification
        return;
      }
      if (lance && debut === null) {
        debut = maintenant();
        await appeler(surLancement, debut);
      } else if (!lance && debut !== null) {
        const session = { debut, fin: maintenant() };
        debut = null;
        await appeler(surFermeture, session);
      }
    } finally {
      enCours = false;
    }
  }

  return {
    demarrer() {
      if (minuterie) return;
      verifier();
      minuterie = setInterval(verifier, intervalleMs);
      if (minuterie.unref) minuterie.unref(); // ne garde pas l'appli ouverte à lui seul
    },
    arreter() {
      clearInterval(minuterie);
      minuterie = null;
    },
    verifier,
    etat: () => ({ lance: debut !== null, debut }),
  };
}

module.exports = {
  CHEMIN_STEAM_PAR_DEFAUT,
  programmeDansListe,
  deadlockLance,
  valeurRegistre,
  dossierSteam,
  numeroDuCompte,
  comptesDepuisLoginusers,
  compteSteam,
  adressesDeParties,
  clesDepuisAdresse,
  regrouperCles,
  partiesDuCache,
  dossierCacheSteam,
  creerSuiviDeadlock,
};
