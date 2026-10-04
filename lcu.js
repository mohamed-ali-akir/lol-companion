/*
 * Lecture du niveau depuis le client League of Legends (API locale "LCU")
 * -----------------------------------------------------------------------
 * Quand le client League est lancé, il ouvre une petite API sur ton propre PC
 * (adresse 127.0.0.1, donc rien ne passe par Internet). Pour s'y connecter, il faut :
 *  - le port et le mot de passe, que le client écrit dans le fichier "lockfile" de son dossier ;
 *  - une authentification "Basic" avec l'utilisateur "riot" et ce mot de passe.
 *
 * Aucune clé API n'est nécessaire. On en tire :
 *  - le compte connecté (Riot ID, niveau, progression dans le niveau) ;
 *  - ses dernières parties, pour calculer sa durée moyenne et son taux de victoire par mode.
 * Ce fichier tourne dans le processus principal d'Electron (Node.js), jamais dans la page.
 *
 * L'API du client n'est pas documentée officiellement par Riot : les fonctions qui lisent
 * ses réponses sont volontairement tolérantes (champ manquant = partie ignorée, pas de plantage).
 */
const fs = require("fs");
const https = require("https");
const path = require("path");

// Adresse fixe : on ne se connecte JAMAIS ailleurs qu'à son propre ordinateur.
const HOTE_LOCAL = "127.0.0.1";
const DELAI_MAX_MS = 5000;

// Routes de l'API locale du client.
const ROUTE_COMPTE = "/lol-summoner/v1/current-summoner";
const ROUTE_HISTORIQUE = "/lol-match-history/v1/products/lol/current-summoner/matches";
const NB_PARTIES_HISTORIQUE = 50; // le client ne garde de toute façon que les parties récentes

// Numéros des files de jeu (liste officielle : https://static.developer.riotgames.com/docs/lol/queues.json).
// Vérifié le 30/09/2026 : 2400 "ARAM: Mayhem", 450 "5v5 ARAM games", 480 "Swiftplay Games", 400 "5v5 Draft Pick games".
const FILES = {
  mayhem: 2400, // ARAM du Chaos (ARAM: Mayhem)
  aram: 450, // ARAM classique (Abîme hurlant)
  swiftplay: 480, // Swiftplay (Faille de l'invocateur, parties courtes)
  draft: 400, // Faille de l'invocateur, partie normale en Draft
};

/** Résumé vide : un "null" par mode suivi (utilisé quand l'historique est indisponible). */
function resumeVide() {
  const resume = { total: 0, autresModes: 0, ignorees: 0 };
  for (const mode of Object.keys(FILES)) resume[mode] = null;
  return resume;
}

// Une partie de moins de 5 minutes est un "remake" : on ne la compte pas dans les statistiques.
const DUREE_MIN_PARTIE_S = 5 * 60;

/**
 * Erreur "prévue" : son message peut être affiché tel quel à l'utilisateur.
 * probleme dit à la page de quel genre d'erreur il s'agit ("pas-lance", "dossier"...).
 */
class ErreurClient extends Error {
  constructor(message, probleme = null) {
    super(message);
    this.probleme = probleme;
  }
}

const MESSAGE_PAS_LANCE = "Le client League n'est pas lancé. Ouvre-le, connecte-toi à ton compte, puis réessaie.";

/** Le réglage peut être le dossier du jeu ou directement le chemin du lockfile. */
function cheminLockfile(dossierJeu) {
  return path.basename(dossierJeu).toLowerCase() === "lockfile" ? dossierJeu : path.join(dossierJeu, "lockfile");
}

/**
 * Découpe le contenu du lockfile.
 * Format : nom:pid:port:motDePasse:protocole, par exemple "LeagueClient:12345:54321:AbCdEf:https".
 */
function analyserLockfile(texte) {
  const morceaux = String(texte).trim().split(":");
  if (morceaux.length < 5) throw new ErreurClient("Le fichier lockfile du client a un format inattendu.");

  const [nom, pid, port] = morceaux;
  const protocole = morceaux[morceaux.length - 1];
  const motDePasse = morceaux.slice(3, -1).join(":"); // au cas où le mot de passe contiendrait un ":"
  const numeroPort = Number(port);

  if (!Number.isInteger(numeroPort) || numeroPort < 1 || numeroPort > 65535 || !motDePasse) {
    throw new ErreurClient("Le fichier lockfile du client a un format inattendu.");
  }
  return { nom, pid: Number(pid), port: numeroPort, motDePasse, protocole };
}

/** Lit le lockfile, avec un message clair pour chaque problème possible. */
function lireLockfile(dossierJeu) {
  const chemin = cheminLockfile(dossierJeu);
  let texte;
  try {
    texte = fs.readFileSync(chemin, "utf-8");
  } catch (erreur) {
    if (erreur.code === "ENOENT" && !fs.existsSync(path.dirname(chemin))) {
      throw new ErreurClient(
        `Dossier du jeu introuvable : ${path.dirname(chemin)}. Indique le bon dossier dans les Paramètres.`,
        "dossier"
      );
    }
    if (erreur.code === "ENOENT") {
      throw new ErreurClient(MESSAGE_PAS_LANCE, "pas-lance");
    }
    throw new ErreurClient(`Impossible de lire le fichier ${chemin} (${erreur.code || erreur.message}).`);
  }
  return analyserLockfile(texte);
}

/**
 * Fait une requête (GET par défaut, ou POST/PATCH pour une action comme accepter une partie)
 * à l'API locale du client et renvoie { status, corps, brut, type } :
 * corps = texte (pour le JSON), brut = octets (pour les images), type = Content-Type.
 * Option corps : objet envoyé en JSON (par exemple { championId } pour la sélection des champions).
 */
function appelerClient({ port, motDePasse }, route, { methode = "GET", corps } = {}) {
  const contenu = corps === undefined ? null : Buffer.from(JSON.stringify(corps));
  // Le client utilise un certificat "auto-signé", que Node refuse par défaut.
  // On l'accepte UNIQUEMENT dans cet agent, utilisé UNIQUEMENT pour 127.0.0.1 :
  // le reste de l'appli (dont les appels à Riot sur Internet) garde la vérification normale.
  const agentLocal = new https.Agent({ rejectUnauthorized: false });
  const identifiants = Buffer.from(`riot:${motDePasse}`).toString("base64");

  return new Promise((resoudre, rejeter) => {
    const requete = https.request(
      {
        host: HOTE_LOCAL,
        port,
        path: route,
        method: methode,
        agent: agentLocal,
        timeout: DELAI_MAX_MS,
        headers: {
          Authorization: `Basic ${identifiants}`,
          Accept: "application/json",
          ...(contenu ? { "Content-Type": "application/json", "Content-Length": contenu.length } : {}),
        },
      },
      (reponse) => {
        const morceaux = [];
        reponse.on("data", (morceau) => morceaux.push(morceau));
        reponse.on("end", () => {
          const brut = Buffer.concat(morceaux);
          resoudre({ status: reponse.statusCode, corps: brut.toString("utf8"), brut, type: reponse.headers["content-type"] || "" });
        });
      }
    );

    requete.on("timeout", () => requete.destroy(new ErreurClient("Le client League ne répond pas. Réessaie dans un instant.")));
    requete.on("error", (erreur) => {
      if (erreur instanceof ErreurClient) return rejeter(erreur);
      if (erreur.code === "ECONNREFUSED") {
        // Le lockfile existe encore mais le client a été fermé (ou plante).
        return rejeter(new ErreurClient(MESSAGE_PAS_LANCE, "pas-lance"));
      }
      rejeter(new ErreurClient(`Connexion au client League impossible (${erreur.code || erreur.message}).`));
    });
    requete.end(contenu || undefined);
  });
}

/**
 * Appelle une route du client et renvoie le JSON de la réponse.
 * Traduit les erreurs HTTP en messages clairs.
 */
async function lireJson(connexion, route) {
  const { status, corps } = await appelerClient(connexion, route);

  if (status === 404) {
    throw new ErreurClient("Le client est lancé, mais tu n'es pas encore connecté à ton compte. Connecte-toi puis réessaie.");
  }
  if (status === 401 || status === 403) {
    throw new ErreurClient("Le client League a refusé la connexion. Redémarre le client, puis réessaie.");
  }
  if (status !== 200) {
    throw new ErreurClient(`Le client League a répondu une erreur (code ${status}). Réessaie dans un instant.`);
  }

  try {
    return JSON.parse(corps);
  } catch {
    throw new ErreurClient("Réponse illisible du client League.");
  }
}

/**
 * Comme lireJson, mais pour une donnée facultative : renvoie null au lieu d'une erreur
 * si la route n'existe pas ou répond mal (utile pour essayer plusieurs routes l'une après l'autre).
 * Une vraie coupure (client fermé) remonte quand même en erreur.
 */
async function lireJsonOuNull(connexion, route) {
  const { status, corps } = await appelerClient(connexion, route);
  if (status !== 200) return null;
  try {
    return JSON.parse(corps);
  } catch {
    return null;
  }
}

/** Garde uniquement ce dont l'appli a besoin dans la réponse du client. */
function extraireInvocateur(donnees) {
  const niveau = Number(donnees && donnees.summonerLevel);
  if (!Number.isInteger(niveau) || niveau < 1) {
    throw new ErreurClient("Réponse inattendue du client League (niveau manquant).");
  }
  const pourcentage = Number(donnees.percentCompleteForNextLevel);
  return {
    niveau,
    // Le champ "Progression" de l'appli va de 0 à 99 %.
    progression: Number.isFinite(pourcentage) ? Math.min(99, Math.max(0, Math.floor(pourcentage))) : 0,
    nom: donnees.gameName || "",
    tag: donnees.tagLine || "",
  };
}

/**
 * Dans une partie de l'historique, retrouve la ligne du joueur.
 * Le client relie les deux listes par "participantId" :
 *  - participantIdentities : qui est qui (puuid) ;
 *  - participants : les stats de la partie (dont la victoire).
 * Pour le compte connecté, le client ne renvoie souvent que sa propre ligne : on la prend alors directement.
 */
function trouverJoueur(partie, joueur) {
  // joueur = puuid (texte) ou { puuid, summonerId } : les anciennes versions du client
  // n'indiquent pas le puuid dans l'historique, seulement le summonerId.
  const { puuid, summonerId } = typeof joueur === "object" && joueur ? joueur : { puuid: joueur };
  const participants = Array.isArray(partie.participants) ? partie.participants : [];
  const identites = Array.isArray(partie.participantIdentities) ? partie.participantIdentities : [];

  const correspond = (i) =>
    i && i.player && ((puuid && i.player.puuid === puuid) || (Number.isInteger(summonerId) && i.player.summonerId === summonerId));
  const identite = identites.find(correspond);
  if (identite) return participants.find((p) => p && p.participantId === identite.participantId) || null;
  return participants.length === 1 ? participants[0] : null;
}

/** La liste des parties est rangée dans { games: { games: [...] } } (parfois directement dans games). */
function listeDesParties(historique) {
  const games = historique && historique.games;
  if (Array.isArray(games)) return games;
  if (games && Array.isArray(games.games)) return games.games;
  return [];
}

/**
 * Résume l'historique du client pour chaque mode suivi :
 * { mayhem: { parties, dureeMoyenneMin, tauxVictoire } | null, ..., total, autresModes, ignorees }
 *  - autresModes : parties dans un mode que l'appli ne suit pas (classée, Arena, partie perso...) ;
 *  - ignorees : parties d'un mode suivi mais pas comptées (remake, abandon précoce, partie illisible).
 * total = parties comptées + autresModes + ignorees.
 */
function resumerHistorique(historique, puuid) {
  const parMode = {};
  for (const mode of Object.keys(FILES)) parMode[mode] = [];
  const toutes = listeDesParties(historique);
  let autresModes = 0;
  let ignorees = 0;

  for (const partie of toutes) {
    const mode = partie && Object.keys(FILES).find((m) => FILES[m] === partie.queueId);
    if (!mode) {
      if (partie && partie.queueId !== undefined) autresModes++;
      else ignorees++; // partie illisible
      continue;
    }

    const secondes = Number(partie.gameDuration);
    const joueur = trouverJoueur(partie, puuid);
    const lisible = Number.isFinite(secondes) && joueur && joueur.stats && typeof joueur.stats.win === "boolean";
    if (!lisible || secondes < DUREE_MIN_PARTIE_S || joueur.stats.gameEndedInEarlySurrender) {
      ignorees++;
      continue;
    }

    parMode[mode].push({ secondes, victoire: joueur.stats.win });
  }

  const resume = { total: toutes.length, autresModes, ignorees };
  for (const [mode, parties] of Object.entries(parMode)) {
    if (parties.length === 0) {
      resume[mode] = null;
      continue;
    }
    const duree = parties.reduce((somme, p) => somme + p.secondes, 0);
    resume[mode] = {
      parties: parties.length,
      dureeMoyenneMin: duree / parties.length / 60,
      tauxVictoire: parties.filter((p) => p.victoire).length / parties.length,
    };
  }
  return resume;
}

/**
 * Parties de l'historique, dans un format simple pour les stats et l'historique local (parties.js) :
 * [{ id, date, dureeS, file, championId, victoire, kills, deaths, assists }].
 * Les remakes (moins de 5 min, ou abandon précoce) et les parties illisibles sont écartés.
 */
function extraireParties(historique, joueur) {
  const parties = [];
  for (const partie of listeDesParties(historique)) {
    if (!partie || !Number.isFinite(partie.gameId)) continue;
    const secondes = Number(partie.gameDuration);
    const date = Number(partie.gameCreation);
    const j = trouverJoueur(partie, joueur);
    const s = j && j.stats;
    if (!s || typeof s.win !== "boolean" || !Number.isFinite(date) || !Number.isFinite(secondes)) continue;
    if (secondes < DUREE_MIN_PARTIE_S || s.gameEndedInEarlySurrender) continue;
    const nombre = (n) => (Number.isFinite(n) && n >= 0 ? n : 0);
    parties.push({
      id: partie.gameId,
      date,
      dureeS: secondes,
      file: Number.isInteger(partie.queueId) ? partie.queueId : null,
      championId: Number.isInteger(j.championId) ? j.championId : null,
      victoire: s.win,
      kills: nombre(s.kills),
      deaths: nombre(s.deaths),
      assists: nombre(s.assists),
    });
  }
  return parties;
}

/**
 * Lit TOUT l'historique que le client accepte de donner, page par page (begIndex / endIndex),
 * en remontant dans le temps. On s'arrête quand :
 *  - "fin"        : le client renvoie une page vide (plus rien de plus ancien) ;
 *  - "repetition" : le client renvoie une page sans aucune partie nouvelle (il ignore la pagination
 *                   ou tourne en rond) ;
 *  - "limite"     : on a atteint maxPages (sécurité, pour ne jamais tourner indéfiniment).
 * surPage({ page, parties, total, compte }) est appelée après chaque page (pour enregistrer et afficher la progression).
 * Renvoie { compte: { nom, tag }, total, pages, arret, plusAncienne }.
 */
async function lireToutHistorique(dossierJeu, { taillePage = 50, maxPages = 400, surPage = () => {} } = {}) {
  const connexion = lireLockfile(dossierJeu);
  const donnees = await lireJson(connexion, ROUTE_COMPTE);
  const compte = extraireInvocateur(donnees);
  const joueur = { puuid: donnees.puuid, summonerId: donnees.summonerId };

  const vues = new Set();
  let total = 0;
  let plusAncienne = null;
  let arret = "limite";
  let pages = 0;
  for (let page = 0; page < maxPages; page++) {
    const debut = page * taillePage;
    const historique = await lireJson(connexion, `${ROUTE_HISTORIQUE}?begIndex=${debut}&endIndex=${debut + taillePage - 1}`);
    pages++;
    if (listeDesParties(historique).length === 0) {
      arret = "fin";
      break;
    }
    const nouvelles = extraireParties(historique, joueur).filter((p) => !vues.has(p.id));
    const idsDeLaPage = listeDesParties(historique).map((g) => g && g.gameId);
    if (idsDeLaPage.every((id) => vues.has(id))) {
      arret = "repetition";
      break;
    }
    for (const id of idsDeLaPage) vues.add(id);
    for (const p of nouvelles) plusAncienne = plusAncienne === null ? p.date : Math.min(plusAncienne, p.date);
    total += nouvelles.length;
    await surPage({ page, parties: nouvelles, total, compte: { nom: compte.nom, tag: compte.tag } });
  }
  return { compte: { nom: compte.nom, tag: compte.tag }, total, pages, arret, plusAncienne };
}

/**
 * Point d'entrée utilisé par l'appli : compte connecté + statistiques de ses dernières parties.
 * Si seul l'historique échoue, on renvoie quand même le niveau, avec un avertissement.
 */
async function recupererCompteClient(dossierJeu) {
  const connexion = lireLockfile(dossierJeu);
  const donnees = await lireJson(connexion, ROUTE_COMPTE);
  const compte = extraireInvocateur(donnees);

  let stats = resumeVide();
  let parties = [];
  let avertissement = null;
  try {
    const historique = await lireJson(connexion, `${ROUTE_HISTORIQUE}?begIndex=0&endIndex=${NB_PARTIES_HISTORIQUE - 1}`);
    const joueur = { puuid: donnees.puuid, summonerId: donnees.summonerId };
    stats = resumerHistorique(historique, joueur);
    parties = extraireParties(historique, joueur); // pour l'onglet Stats (gardées dans parties.json)
  } catch (erreur) {
    if (!(erreur instanceof ErreurClient)) throw erreur;
    avertissement = "Niveau récupéré, mais pas l'historique de parties : valeurs moyennes utilisées.";
  }

  return { ...compte, stats, parties, avertissement };
}

module.exports = {
  HOTE_LOCAL,
  FILES,
  ROUTE_COMPTE,
  ROUTE_HISTORIQUE,
  ErreurClient,
  appelerClient,
  lireJson,
  lireJsonOuNull,
  cheminLockfile,
  analyserLockfile,
  lireLockfile,
  extraireInvocateur,
  resumerHistorique,
  extraireParties,
  resumeVide,
  recupererCompteClient,
  lireToutHistorique,
};
