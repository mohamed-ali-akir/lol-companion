/*
 * Acceptation automatique de la partie trouvée (et notification)
 * --------------------------------------------------------------
 * Tourne dans le processus principal (Node).
 *
 * Quand une partie est trouvée, le client ouvre un "ready check" (la fenêtre "Accepter / Refuser").
 * Format vérifié dans le schéma du client (lcu-schema, LolMatchmakingMatchmakingReadyCheckResource) :
 *   GET  /lol-matchmaking/v1/ready-check        -> { state, playerResponse, timer, declinerIds, ... }
 *        state          : "InProgress" pendant le ready check (sinon "Invalid", "EveryoneReady", ...)
 *        playerResponse : "None" (pas encore répondu), "Accepted" ou "Declined"
 *   POST /lol-matchmaking/v1/ready-check/accept -> accepte
 * Le WebSocket envoie "OnJsonApiEvent_lol-matchmaking_v1_ready-check" à chaque changement
 * (surveillance.js le transmet ici).
 *
 * Règles de sécurité :
 *  - DÉSACTIVÉ par défaut (réglage dans l'onglet Paramètres) ;
 *  - on attend un court délai (2 s par défaut) pour te laisser refuser toi-même ;
 *  - jamais si tu as déjà répondu (accepté ou REFUSÉ), jamais si le ready check est fini ou annulé,
 *    jamais deux fois pour le même ready check.
 * Le ready check n'a pas d'identifiant : un NOUVEAU ready check commence quand l'état passe à
 * "InProgress + None" (en attente de ta réponse) depuis N'IMPORTE QUEL autre état, y compris
 * "InProgress + Accepted" (quelqu'un a refusé et une nouvelle partie est trouvée sans état intermédiaire).
 */
const { execFile } = require("child_process");
const { lireLockfile, appelerClient, ErreurClient } = require("./lcu.js");

const ROUTE_ACCEPTER = "/lol-matchmaking/v1/ready-check/accept";

const REGLAGES_PAR_DEFAUT = { actif: false, delaiSecondes: 2, notifier: true };
const DELAI_MAX_SECONDES = 8; // un ready check dure une dizaine de secondes : il faut accepter avant la fin

/** Réglages lisibles et bornés, quoi qu'il y ait dans le fichier. */
function normaliserReglages(brut) {
  const r = brut && typeof brut === "object" ? brut : {};
  const delai = Number(r.delaiSecondes);
  return {
    actif: r.actif === true,
    // Arrondi au dixième de seconde (l'appli propose des secondes entières, les tests des délais courts).
    delaiSecondes: Number.isFinite(delai)
      ? Math.min(DELAI_MAX_SECONDES, Math.max(0, Math.round(delai * 10) / 10))
      : REGLAGES_PAR_DEFAUT.delaiSecondes,
    notifier: r.notifier !== false,
  };
}

const enCours = (etat) => Boolean(etat) && etat.state === "InProgress";
const sansReponse = (etat) => enCours(etat) && etat.playerResponse === "None";

/**
 * Crée la logique d'acceptation. Tout ce qui touche au monde extérieur est passé en paramètre,
 * pour pouvoir la tester sans client ni Electron :
 *  - reglages()         : réglages actuels (relus à chaque ready check et au moment d'accepter) ;
 *  - accepter()         : envoie l'acceptation au client (promesse) ;
 *  - partieTrouvee(info): prévient l'appli qu'une partie est trouvée ({ autoActif, delaiSecondes }) ;
 *  - resultat(info)     : prévient du résultat : { accepte: true }, { accepte: false, erreur },
 *                         ou { accepte: false, annule: "repondu" | "fini" } si l'attente a été annulée ;
 *  - journal(...)       : (facultatif) écrit les décisions dans le terminal, pour le diagnostic.
 * Renvoie { surReadyCheck(etat), arreter() }.
 */
function creerAcceptation({ reglages, accepter, partieTrouvee = () => {}, resultat = () => {}, journal = () => {} }) {
  let dernier = null; // dernier état reçu du client
  let numero = 0; // numéro du ready check en cours (un nouveau à chaque passage à "InProgress")
  let dejaAccepte = false; // pour ce ready check
  let minuterie = null;

  function annuler() {
    clearTimeout(minuterie);
    minuterie = null;
  }

  /** Annule une acceptation prévue (et le signale), par exemple si tu as refusé pendant le délai. */
  function annulerAttente(raison) {
    if (minuterie === null) return;
    annuler();
    resultat({ accepte: false, annule: raison });
  }

  async function essayerDAccepter(numeroPrevu) {
    minuterie = null;
    // On revérifie TOUT au dernier moment : même ready check, toujours en cours, pas de réponse, réglage actif.
    if (numeroPrevu !== numero || dejaAccepte || !sansReponse(dernier) || !normaliserReglages(reglages()).actif) {
      journal(`acceptation n°${numeroPrevu} abandonnée au dernier moment`, {
        autreReadyCheck: numeroPrevu !== numero, dejaAccepte, etat: dernier, actif: normaliserReglages(reglages()).actif,
      });
      return;
    }
    dejaAccepte = true;
    journal(`envoi de l'acceptation n°${numeroPrevu}...`);
    try {
      await accepter();
      journal(`acceptation n°${numeroPrevu} OK`);
      resultat({ accepte: true });
    } catch (erreur) {
      journal(`acceptation n°${numeroPrevu} en ERREUR :`, erreur.message);
      resultat({ accepte: false, erreur: erreur.message });
    }
  }

  function surReadyCheck(etat) {
    const nouveau = etat && typeof etat === "object" ? etat : null;
    // Deux canaux (connexion en direct + sondage, sondage.js) : une réponse EN RETARD peut arriver après « Accepted »
    // et montrer encore « None ». Une vraie nouvelle partie fait repartir le timer du client à 0 : si on repasse de
    // « répondu » à « None » SANS que le timer ait reculé, c'est une vieille réponse, on l'ignore.
    if (enCours(dernier) && !sansReponse(dernier) && sansReponse(nouveau)) {
      const avant = Number(dernier.timer);
      const apres = Number(nouveau.timer);
      if (Number.isFinite(avant) && Number.isFinite(apres) && apres >= avant) {
        journal("réponse en retard ignorée (timer", apres, ">=", avant, ")");
        return;
      }
    }
    // On compare avec l'état PRÉCÉDENT "en attente de ta réponse" (et pas seulement "InProgress") :
    // le client peut passer de "InProgress + Accepted" directement à "InProgress + None"
    // (quelqu'un a refusé, tu es remis en file et une nouvelle partie est trouvée aussitôt).
    const attendaitDejaReponse = sansReponse(dernier);
    dernier = nouveau;

    if (!enCours(dernier)) {
      journal("ready check fini ou absent", dernier && dernier.state);
      annulerAttente("fini"); // ready check fini, annulé, ou client fermé
      return;
    }
    if (!sansReponse(dernier)) {
      journal("déjà répondu :", dernier.playerResponse, minuterie !== null ? "-> acceptation prévue ANNULÉE" : "");
      annulerAttente("repondu"); // tu as déjà répondu (accepté ou refusé) : on ne touche à rien
      return;
    }
    if (attendaitDejaReponse) return; // même ready check (le timer avance), déjà pris en charge

    // Nouveau ready check.
    numero++;
    dejaAccepte = false;
    const r = normaliserReglages(reglages());
    journal(`NOUVEAU ready check n°${numero}, auto ${r.actif ? `actif, acceptation prévue dans ${r.delaiSecondes} s` : "désactivé"}`);
    partieTrouvee({ autoActif: r.actif, delaiSecondes: r.delaiSecondes });
    if (r.actif) {
      const numeroPrevu = numero;
      annuler();
      minuterie = setTimeout(() => essayerDAccepter(numeroPrevu), r.delaiSecondes * 1000);
    }
  }

  return { surReadyCheck, arreter: annuler };
}

/** Envoie l'acceptation au client. */
async function accepterReadyCheck(dossierJeu) {
  const connexion = lireLockfile(dossierJeu);
  const { status } = await appelerClient(connexion, ROUTE_ACCEPTER, { methode: "POST" });
  if (status < 200 || status >= 300) throw new ErreurClient(`Le client a refusé l'acceptation (code ${status}).`);
}

// --- La fenêtre de League est-elle au premier plan ? (pour la notification) ---------------

// Programmes de League : le client (LeagueClientUx) et le jeu lui-même (Mac : « LeagueofLegends » sans espaces).
const PROGRAMMES_LEAGUE = ["leagueclientux", "leagueclient", "league of legends", "leagueoflegends"];

/** Le nom du programme au premier plan est-il League ? (fonction pure, testée) */
function estProgrammeLeague(nom) {
  return typeof nom === "string" && PROGRAMMES_LEAGUE.includes(nom.trim().toLowerCase());
}

// Petite commande PowerShell (fournie avec Windows) : nom du programme de la fenêtre au premier plan.
// Electron ne sait pas le dire tout seul pour une autre appli, et on évite un module natif.
const SCRIPT_PREMIER_PLAN = `
Add-Type -Namespace LoLCompanion -Name Fenetre -MemberDefinition @'
[DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(System.IntPtr h, out int p);
'@
$id = 0
[void][LoLCompanion.Fenetre]::GetWindowThreadProcessId([LoLCompanion.Fenetre]::GetForegroundWindow(), [ref]$id)
(Get-Process -Id $id).ProcessName`;

/**
 * Mac : nom de l'appli dans la réponse de « lsappinfo info -only name <appli> », par exemple
 * "LSDisplayName"="League of Legends" -> "League of Legends". null si la réponse est inattendue.
 */
function nomDepuisLsappinfo(sortie) {
  const m = /"(?:LSDisplayName|name)"\s*=\s*"([^"]*)"/i.exec(String(sortie || ""));
  return m ? m[1] : null;
}

/**
 * Mac : League est-il l'appli au premier plan ? lsappinfo est fourni avec macOS et ne demande aucune autorisation
 * (contrairement à AppleScript / System Events). Deux étapes : « lsappinfo front » donne l'appli au premier plan
 * (ex. "ASN:0x0-0x1a01a:"), puis « lsappinfo info -only name » donne son nom.
 */
function leagueAuPremierPlanMac(executer) {
  const lancer = (args) =>
    new Promise((resoudre) => {
      executer("lsappinfo", args, { timeout: 3000 }, (erreur, sortie) => resoudre(erreur ? null : String(sortie || "").trim()));
    });
  return lancer(["front"]).then((appli) => {
    if (!appli || !/^ASN:/i.test(appli)) return false;
    return lancer(["info", "-only", "name", appli]).then((sortie) => estProgrammeLeague(nomDepuisLsappinfo(sortie)));
  });
}

/**
 * true si League est au premier plan (Windows : PowerShell ; Mac : lsappinfo). En cas de doute (autre système,
 * erreur, délai dépassé), renvoie false : mieux vaut une notification de trop qu'une partie ratée.
 */
function leagueAuPremierPlan({ executer = execFile, plateforme = process.platform } = {}) {
  if (plateforme === "darwin") return leagueAuPremierPlanMac(executer).catch(() => false);
  if (plateforme !== "win32") return Promise.resolve(false);
  return new Promise((resoudre) => {
    executer(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", SCRIPT_PREMIER_PLAN],
      { timeout: 3000, windowsHide: true },
      (erreur, sortie) => resoudre(!erreur && estProgrammeLeague(String(sortie)))
    );
  });
}

module.exports = {
  ROUTE_ACCEPTER,
  REGLAGES_PAR_DEFAUT,
  DELAI_MAX_SECONDES,
  normaliserReglages,
  creerAcceptation,
  accepterReadyCheck,
  estProgrammeLeague,
  nomDepuisLsappinfo,
  leagueAuPremierPlan,
};
