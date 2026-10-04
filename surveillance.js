/*
 * Surveillance du client League en direct
 * ----------------------------------------
 * En plus de son API "classique" (une question, une réponse : voir lcu.js), le client League
 * ouvre un canal d'événements en WebSocket, à la même adresse (wss://127.0.0.1:<port>/).
 * Une fois abonnée, l'appli est PRÉVENUE dès que quelque chose change, sans avoir à redemander
 * en boucle. C'est la même technique que Blitz ou Porofessor.
 *
 * Le client utilise le protocole WAMP (version 1) : chaque message est un tableau JSON.
 *   - on s'abonne à un événement :   [5, "OnJsonApiEvent_lol-gameflow_v1_gameflow-phase"]
 *   - le client envoie ensuite :     [8, "OnJsonApiEvent_...", { uri, eventType, data }]
 *
 * On écoute :
 *   - la phase de jeu (gameflow-phase) : quand elle passe à "EndOfGame", une partie vient de finir ;
 *   - le compte (current-summoner) : il change quand l'XP ou le niveau sont mis à jour ;
 *     -> dans ces deux cas, l'appli relit le compte (niveau, progression, historique) ;
 *   - les champions possédés et le portefeuille (Essence bleue) : nouveau champion, EB gagnée
 *     -> l'appli relit l'onglet Classée (raison "classee") ;
 *   - les missions : progression ou mission terminée -> l'appli relit l'onglet Missions (raison "missions") ;
 *   - le "ready check" (partie trouvée) : transmis TOUT DE SUITE, sans anti-rebond, à aReadyCheck
 *     (acceptation automatique, notification) ;
 *   - la sélection des champions : transmise TOUT DE SUITE à aSelection (pick et ban automatiques).
 * Chaque groupe (compte / classée / missions) a son propre anti-rebond : ils ne s'annulent pas entre eux.
 *
 * Si le client n'est pas lancé, ou s'il est fermé pendant que l'appli tourne, on réessaie
 * toutes les quelques secondes : l'appli se reconnecte toute seule quand il revient.
 * Avant de s'abonner, on attend que le client soit complètement démarré (il répond à
 * /lol-gameflow/v1/gameflow-phase) : abonné trop tôt, l'appli ne recevait plus aucun événement.
 */
const WebSocket = require("ws");
const { lireLockfile, appelerClient, HOTE_LOCAL } = require("./lcu.js");

const ABONNEMENT = 5;
const EVENEMENT = 8;
const EVENEMENT_PHASE = "OnJsonApiEvent_lol-gameflow_v1_gameflow-phase";
const EVENEMENT_COMPTE = "OnJsonApiEvent_lol-summoner_v1_current-summoner";
const EVENEMENT_CHAMPIONS = "OnJsonApiEvent_lol-champions_v1_owned-champions-minimal";
const EVENEMENT_PORTEFEUILLE = "OnJsonApiEvent_lol-inventory_v1_wallet";
const EVENEMENT_MISSIONS = "OnJsonApiEvent_lol-missions_v1_missions";
const EVENEMENT_READY_CHECK = "OnJsonApiEvent_lol-matchmaking_v1_ready-check";
const EVENEMENT_SELECTION = "OnJsonApiEvent_lol-champ-select_v1_session";
const ABONNEMENTS = [
  EVENEMENT_PHASE,
  EVENEMENT_COMPTE,
  EVENEMENT_CHAMPIONS,
  EVENEMENT_PORTEFEUILLE,
  EVENEMENT_MISSIONS,
  EVENEMENT_READY_CHECK,
  EVENEMENT_SELECTION,
];

/** Les raisons de relecture sont rangées par groupe : un groupe = un anti-rebond. */
const groupeDe = (raison) => (raison === "classee" || raison === "missions" ? raison : "compte");

const DELAIS_PAR_DEFAUT = {
  reconnexionMs: 5000, // entre deux tentatives quand le client est fermé
  apresPartieMs: 4000, // le client met quelques secondes à enregistrer l'XP de la partie
  antiRebondMs: 1500, // plusieurs événements d'affilée = une seule relecture
  delaiPretMs: 8000, // temps maximum pour savoir si le client est prêt (sinon on réessaie plus tard)
};

// Route qui ne répond (200) qu'une fois le client complètement démarré.
const ROUTE_PRET = "/lol-gameflow/v1/gameflow-phase";

/**
 * Le client est-il prêt ? Vu le 02/10/2026 : quand l'appli s'abonnait pendant que le client démarrait
 * encore (client lancé APRÈS l'appli), elle ne recevait plus aucun événement (ni partie trouvée, ni sélection).
 * On attend donc que le client réponde normalement avant d'ouvrir le WebSocket et de s'abonner.
 */
async function clientPretParDefaut(connexion) {
  const { status } = await appelerClient(connexion, ROUTE_PRET);
  return status === 200;
}

/** Transforme un message du client en { evenement, donnees }, ou null s'il ne nous intéresse pas. */
function lireMessage(texte) {
  let message;
  try {
    message = JSON.parse(texte);
  } catch {
    return null;
  }
  if (!Array.isArray(message) || message[0] !== EVENEMENT) return null;
  const contenu = message[2] || {};
  return { evenement: message[1], donnees: contenu.data, type: contenu.eventType };
}

/**
 * Lance la surveillance.
 *  - dossierJeu() : renvoie le dossier du jeu (relu à chaque tentative, il peut changer dans les Paramètres) ;
 *  - aRafraichir(raison) : appelée quand il faut relire le compte ("client-lance" ou "fin-de-partie") ;
 *  - aChangementConnexion(connecte) : appelée quand le client apparaît ou disparaît ;
 *  - aReadyCheck(etat) : appelée à chaque changement du ready check ({ state, playerResponse, ... },
 *    ou null quand il n'y en a plus) ;
 *  - aSelection(session) : appelée à chaque changement de la sélection des champions (ou null quand elle est finie) ;
 *  - aPhase(phase) : appelée à chaque changement de phase ("Lobby", "ChampSelect", "InProgress", "EndOfGame"...) ;
 *  - aErreur(nom, erreur) : appelée si une de ces fonctions plante (par défaut : écrite dans le terminal).
 * Renvoie { arreter() }.
 *
 * CLOISONS DE SÉCURITÉ : chaque fonction ci-dessus est appelée dans sa propre bulle (proteger). Si l'une plante
 * (pick/ban, build, stats...), l'erreur est écrite dans le terminal et la lecture des messages continue : les autres
 * fonctionnalités, dont l'acceptation automatique, continuent de marcher. (Vu le 02/10/2026 : l'appli restait
 * connectée au client mais ne réagissait plus à "partie trouvée", alors que le même code marchait hors de l'appli.)
 */
function surveillerClient({
  dossierJeu,
  aRafraichir,
  aChangementConnexion = () => {},
  aReadyCheck = () => {},
  aSelection = () => {},
  aPhase = () => {},
  aErreur = (nom, erreur) => console.error(`[LoL Companion] Erreur dans « ${nom} » (le reste de l'appli continue) :`, erreur),
  clientPret = clientPretParDefaut,
  delais = {},
}) {
  const d = { ...DELAIS_PAR_DEFAUT, ...delais };

  /** Appelle fonction(...valeurs) dans sa bulle : une erreur (même dans une promesse) est signalée, jamais propagée. */
  function proteger(nom, fonction, ...valeurs) {
    const signaler = (erreur) => {
      try {
        aErreur(nom, erreur);
      } catch {
        // même le signalement ne doit rien casser
      }
    };
    try {
      const resultat = fonction(...valeurs);
      if (resultat && typeof resultat.catch === "function") resultat.catch(signaler);
    } catch (erreur) {
      signaler(erreur);
    }
  }
  let socket = null;
  let minuterieReconnexion = null;
  const enAttente = new Map(); // groupe -> { minuterie, raison }
  let connecte = false;
  let arrete = false;
  let tentativeEnCours = false;

  function changerConnexion(etat) {
    if (etat === connecte) return;
    connecte = etat;
    proteger("connexion au client", aChangementConnexion, etat);
  }

  /** Regroupe les événements rapprochés en une seule relecture. */
  function demanderRafraichissement(raison, delai) {
    const groupe = groupeDe(raison);
    const avant = enAttente.get(groupe);
    if (avant) clearTimeout(avant.minuterie);
    // Dans le groupe "compte", "fin-de-partie" est la raison la plus parlante : on la garde.
    const retenue = avant && avant.raison === "fin-de-partie" ? "fin-de-partie" : raison;
    const minuterie = setTimeout(() => {
      enAttente.delete(groupe);
      if (!arrete) proteger(`relecture (${retenue})`, aRafraichir, retenue);
    }, delai);
    enAttente.set(groupe, { minuterie, raison: retenue });
  }

  function programmerReconnexion() {
    clearTimeout(minuterieReconnexion);
    if (!arrete) minuterieReconnexion = setTimeout(connecter, d.reconnexionMs);
  }

  async function connecter() {
    if (arrete || tentativeEnCours) return; // jamais deux tentatives en même temps (chien de garde + minuterie)
    let connexion;
    try {
      connexion = lireLockfile(dossierJeu()); // nouveau port et mot de passe à chaque lancement du client
    } catch {
      changerConnexion(false);
      return programmerReconnexion();
    }

    // Client encore en train de démarrer : on attend qu'il soit prêt avant de s'abonner (voir clientPretParDefaut).
    // Avec un temps limite : une vérification qui ne répond jamais ne doit pas bloquer les tentatives suivantes.
    let pret = false;
    let limite = null;
    tentativeEnCours = true;
    try {
      pret = await Promise.race([
        clientPret(connexion),
        new Promise((resoudre) => {
          limite = setTimeout(() => resoudre(false), d.delaiPretMs);
        }),
      ]);
    } catch {
      // client fermé ou qui ne répond pas encore
    } finally {
      clearTimeout(limite);
      tentativeEnCours = false;
    }
    if (arrete) return;
    if (!pret) {
      changerConnexion(false);
      return programmerReconnexion();
    }

    const identifiants = Buffer.from(`riot:${connexion.motDePasse}`).toString("base64");
    socket = new WebSocket(`wss://${HOTE_LOCAL}:${connexion.port}/`, "wamp", {
      headers: { Authorization: `Basic ${identifiants}` },
      // Certificat auto-signé du client : accepté UNIQUEMENT pour cette connexion vers 127.0.0.1.
      rejectUnauthorized: false,
      handshakeTimeout: 5000,
    });

    socket.on("open", () => {
      for (const evenement of ABONNEMENTS) socket.send(JSON.stringify([ABONNEMENT, evenement]));
      changerConnexion(true);
      // Le client vient d'être lancé (ou l'appli vient de démarrer) : on relit le compte.
      demanderRafraichissement("client-lance", d.antiRebondMs);
    });

    // Tout le traitement d'un message est lui-même dans une bulle : un message bizarre ne bouche jamais la lecture.
    socket.on("message", (texte) => proteger("lecture d'un message du client", traiterMessage, texte));

    function traiterMessage(texte) {
      const message = lireMessage(texte.toString());
      if (!message) return;
      const donnees = message.type === "Delete" ? null : message.donnees ?? null;
      if (message.evenement === EVENEMENT_PHASE) {
        proteger("phase de jeu", aPhase, typeof donnees === "string" ? donnees : null);
        if (donnees === "EndOfGame") demanderRafraichissement("fin-de-partie", d.apresPartieMs);
      } else if (message.evenement === EVENEMENT_COMPTE) {
        demanderRafraichissement("fin-de-partie", d.antiRebondMs);
      } else if (message.evenement === EVENEMENT_CHAMPIONS || message.evenement === EVENEMENT_PORTEFEUILLE) {
        demanderRafraichissement("classee", d.antiRebondMs);
      } else if (message.evenement === EVENEMENT_MISSIONS) {
        demanderRafraichissement("missions", d.antiRebondMs);
      } else if (message.evenement === EVENEMENT_READY_CHECK) {
        proteger("acceptation automatique", aReadyCheck, donnees);
      } else if (message.evenement === EVENEMENT_SELECTION) {
        proteger("sélection des champions", aSelection, donnees);
      }
    }

    // Client fermé, refus de connexion, mauvais mot de passe... : on réessaie plus tard.
    socket.on("error", () => {});
    socket.on("close", () => {
      socket = null;
      proteger("acceptation automatique", aReadyCheck, null); // client fermé : plus de ready check en cours
      proteger("sélection des champions", aSelection, null); // ni de sélection des champions
      proteger("phase de jeu", aPhase, null); // ni de partie en cours
      changerConnexion(false);
      programmerReconnexion();
    });
  }

  connecter();

  return {
    /**
     * Refait la connexion en direct tout de suite (chien de garde de main.js : le client répond mais la connexion
     * n'arrive pas, ou reste muette). La fermeture de l'ancienne déclenche une nouvelle tentative.
     */
    reconnecter() {
      if (arrete) return;
      if (socket) {
        socket.terminate(); // -> "close" -> nouvelle tentative
      } else {
        clearTimeout(minuterieReconnexion);
        connecter();
      }
    },
    arreter() {
      arrete = true;
      clearTimeout(minuterieReconnexion);
      for (const { minuterie } of enAttente.values()) clearTimeout(minuterie);
      if (socket) socket.terminate();
    },
  };
}

module.exports = {
  surveillerClient,
  lireMessage,
  EVENEMENT_PHASE,
  EVENEMENT_COMPTE,
  EVENEMENT_CHAMPIONS,
  EVENEMENT_PORTEFEUILLE,
  EVENEMENT_MISSIONS,
  EVENEMENT_READY_CHECK,
  EVENEMENT_SELECTION,
};
