// Tests de la lecture du client League (LCU), sans le vrai jeu :
//  - on écrit un FAUX lockfile dans un dossier temporaire ;
//  - on lance un FAUX client : un petit serveur HTTPS sur 127.0.0.1 avec un certificat auto-signé.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const https = require("https");
const os = require("os");
const path = require("path");
const certificat = require("./fixtures/certificat-test.js");
const {
  analyserLockfile,
  cheminLockfile,
  lireLockfile,
  extraireInvocateur,
  resumerHistorique,
  recupererCompteClient,
  ErreurClient,
} = require("../lcu.js");

/** Crée un dossier temporaire qui joue le rôle du dossier du jeu. */
function fauxDossierJeu(contenuLockfile) {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "faux-lol-"));
  if (contenuLockfile !== undefined) fs.writeFileSync(path.join(dossier, "lockfile"), contenuLockfile);
  return dossier;
}

/** Lance un faux client League. repondre(requete) renvoie { status, body }. */
async function fauxClient(repondre) {
  const requetes = [];
  const serveur = https.createServer(certificat, (requete, reponse) => {
    requetes.push({ url: requete.url, auth: requete.headers.authorization });
    const { status, body } = repondre(requete);
    reponse.writeHead(status, { "Content-Type": "application/json" });
    reponse.end(JSON.stringify(body));
  });
  await new Promise((ok) => serveur.listen(0, "127.0.0.1", ok));
  return { port: serveur.address().port, requetes, fermer: () => new Promise((ok) => serveur.close(ok)) };
}

const MOT_DE_PASSE = "motDePasseDeTest";
const AUTH_ATTENDUE = "Basic " + Buffer.from(`riot:${MOT_DE_PASSE}`).toString("base64");

// Répond comme le vrai client : 200 si le mot de passe est bon, 401 sinon.
function commeLeVraiClient(requete) {
  if (requete.headers.authorization !== AUTH_ATTENDUE) return { status: 401, body: {} };
  if (requete.url !== "/lol-summoner/v1/current-summoner") return { status: 404, body: {} };
  return {
    status: 200,
    body: { gameName: "Joueur Test", tagLine: "EUW", summonerLevel: 87, percentCompleteForNextLevel: 42 },
  };
}

// --- Lecture du lockfile -----------------------------------------------------

test("lockfile : on récupère le port et le mot de passe", () => {
  const infos = analyserLockfile("LeagueClient:12345:54321:AbCd-Ef_12:https\n");
  assert.deepStrictEqual(infos, { nom: "LeagueClient", pid: 12345, port: 54321, motDePasse: "AbCd-Ef_12", protocole: "https" });
});

test("lockfile mal formé -> erreur claire", () => {
  assert.throws(() => analyserLockfile("n'importe quoi"), ErreurClient);
  assert.throws(() => analyserLockfile("LeagueClient:1:pasUnPort:mdp:https"), ErreurClient);
  assert.throws(() => analyserLockfile("LeagueClient:1:99999:mdp:https"), ErreurClient);
});

test("le réglage accepte le dossier du jeu ou le chemin du lockfile", () => {
  const dossier = path.join("D:", "Jeux", "League of Legends");
  assert.strictEqual(cheminLockfile(dossier), path.join(dossier, "lockfile"));
  assert.strictEqual(cheminLockfile(path.join(dossier, "lockfile")), path.join(dossier, "lockfile"));
});

test("faux lockfile lu depuis un dossier", () => {
  const dossier = fauxDossierJeu("LeagueClient:4242:50000:secret:https");
  assert.strictEqual(lireLockfile(dossier).port, 50000);
  assert.strictEqual(lireLockfile(dossier).motDePasse, "secret");
});

test("pas de lockfile -> « le client n'est pas lancé »", () => {
  const dossier = fauxDossierJeu(); // dossier sans lockfile
  assert.throws(() => lireLockfile(dossier), (e) => e instanceof ErreurClient && e.message.includes("pas lancé"));
});

test("dossier du jeu inexistant -> on demande de le changer dans les Paramètres", () => {
  const dossier = path.join(os.tmpdir(), "ce-dossier-n-existe-pas-" + Date.now());
  assert.throws(() => lireLockfile(dossier), (e) => e instanceof ErreurClient && e.message.includes("Paramètres"));
});

test("réponse du client : progression bornée entre 0 et 99 %", () => {
  assert.strictEqual(extraireInvocateur({ summonerLevel: 30, percentCompleteForNextLevel: 100 }).progression, 99);
  assert.strictEqual(extraireInvocateur({ summonerLevel: 30 }).progression, 0);
  assert.throws(() => extraireInvocateur({}), ErreurClient);
});

// --- Connexion au faux client ------------------------------------------------

test("client lancé : niveau et progression récupérés (Basic riot:motDePasse)", async () => {
  const client = await fauxClient(commeLeVraiClient);
  try {
    const dossier = fauxDossierJeu(`LeagueClient:1:${client.port}:${MOT_DE_PASSE}:https`);
    const r = await recupererCompteClient(dossier);
    assert.deepStrictEqual(
      { niveau: r.niveau, progression: r.progression, nom: r.nom, tag: r.tag },
      { niveau: 87, progression: 42, nom: "Joueur Test", tag: "EUW" }
    );
    assert.strictEqual(client.requetes[0].url, "/lol-summoner/v1/current-summoner");
    assert.strictEqual(client.requetes[0].auth, AUTH_ATTENDUE);
  } finally {
    await client.fermer();
  }
});

test("le certificat auto-signé n'est accepté QUE pour le client (pas pour le reste de l'appli)", async () => {
  const client = await fauxClient(commeLeVraiClient);
  try {
    // Une requête HTTPS normale vers ce même serveur doit être refusée : la vérification TLS est intacte.
    await assert.rejects(
      new Promise((ok, ko) => https.get(`https://127.0.0.1:${client.port}/`, ok).on("error", ko)),
      (e) => /self[- ]signed|certificate/i.test(e.code + " " + e.message)
    );
    assert.strictEqual(process.env.NODE_TLS_REJECT_UNAUTHORIZED, undefined);
  } finally {
    await client.fermer();
  }
});

test("client lancé mais pas connecté (404) -> message clair", async () => {
  const client = await fauxClient(() => ({ status: 404, body: {} }));
  try {
    const dossier = fauxDossierJeu(`LeagueClient:1:${client.port}:${MOT_DE_PASSE}:https`);
    await assert.rejects(recupererCompteClient(dossier), (e) => e.message.includes("pas encore connecté"));
  } finally {
    await client.fermer();
  }
});

test("mauvais mot de passe (vieux lockfile) -> on conseille de redémarrer le client", async () => {
  const client = await fauxClient(commeLeVraiClient);
  try {
    const dossier = fauxDossierJeu(`LeagueClient:1:${client.port}:ancienMotDePasse:https`);
    await assert.rejects(recupererCompteClient(dossier), (e) => e.message.includes("Redémarre"));
  } finally {
    await client.fermer();
  }
});

test("lockfile resté après fermeture du client -> « pas lancé »", async () => {
  const client = await fauxClient(commeLeVraiClient);
  const port = client.port;
  await client.fermer(); // plus personne n'écoute sur ce port
  const dossier = fauxDossierJeu(`LeagueClient:1:${port}:${MOT_DE_PASSE}:https`);
  await assert.rejects(recupererCompteClient(dossier), (e) => e.message.includes("pas lancé"));
});

// --- Historique de parties -------------------------------------------------

const PUUID = "puuid-du-joueur";

/** Fabrique une partie au format de l'historique du client. */
function partie({ file, minutes, victoire, remake = false, seul = false }) {
  const moi = { participantId: 3, stats: { win: victoire, gameEndedInEarlySurrender: remake } };
  const autre = { participantId: 7, stats: { win: !victoire } };
  return {
    queueId: file,
    gameDuration: minutes * 60,
    participants: seul ? [moi] : [autre, moi],
    participantIdentities: seul
      ? []
      : [
          { participantId: 7, player: { puuid: "quelqu-un-d-autre" } },
          { participantId: 3, player: { puuid: PUUID } },
        ],
  };
}

const HISTORIQUE = {
  games: {
    games: [
      partie({ file: 2400, minutes: 20, victoire: true }),
      partie({ file: 2400, minutes: 16, victoire: false }),
      partie({ file: 2400, minutes: 18, victoire: true, seul: true }), // format "une seule ligne"
      partie({ file: 2400, minutes: 4, victoire: false }), // remake : ignoré
      partie({ file: 400, minutes: 30, victoire: false, remake: true }), // abandon précoce : ignoré
      partie({ file: 400, minutes: 32, victoire: true }),
      partie({ file: 450, minutes: 22, victoire: true }), // ARAM classique
      partie({ file: 480, minutes: 17, victoire: false }), // Swiftplay
      partie({ file: 480, minutes: 19, victoire: true }), // Swiftplay
      partie({ file: 420, minutes: 28, victoire: true }), // classée : pas suivie
    ],
  },
};

test("historique : durée moyenne et taux de victoire par mode", () => {
  const r = resumerHistorique(HISTORIQUE, PUUID);
  assert.strictEqual(r.total, 10);
  // 10 = 7 comptées + 1 classée (autre mode) + 1 remake + 1 abandon précoce
  assert.strictEqual(r.autresModes, 1);
  assert.strictEqual(r.ignorees, 2);
  assert.strictEqual(r.mayhem.parties, 3);
  assert.strictEqual(r.mayhem.dureeMoyenneMin, 18);
  assert.strictEqual(Math.round(r.mayhem.tauxVictoire * 100), 67);
  assert.deepStrictEqual(r.draft, { parties: 1, dureeMoyenneMin: 32, tauxVictoire: 1 });
  assert.deepStrictEqual(r.aram, { parties: 1, dureeMoyenneMin: 22, tauxVictoire: 1 });
  assert.deepStrictEqual(r.swiftplay, { parties: 2, dureeMoyenneMin: 18, tauxVictoire: 0.5 });
});

test("historique vide ou bizarre -> aucune stat, pas de plantage", () => {
  const vide = { total: 0, autresModes: 0, ignorees: 0, mayhem: null, aram: null, swiftplay: null, draft: null };
  assert.deepStrictEqual(resumerHistorique({}, PUUID), vide);
  assert.deepStrictEqual(resumerHistorique(null, PUUID), vide);
  const bizarre = { games: [null, { queueId: 2400 }, { queueId: 2400, gameDuration: 900, participants: "?" }] };
  const r = resumerHistorique(bizarre, PUUID);
  assert.strictEqual(r.mayhem, null);
  assert.strictEqual(r.ignorees, 3);
});

test("client lancé : compte + historique récupérés ensemble", async () => {
  const client = await fauxClient((requete) => {
    if (requete.headers.authorization !== AUTH_ATTENDUE) return { status: 401, body: {} };
    if (requete.url === "/lol-summoner/v1/current-summoner") {
      return { status: 200, body: { gameName: "Joueur Test", tagLine: "EUW", summonerLevel: 24, percentCompleteForNextLevel: 50, puuid: PUUID } };
    }
    if (requete.url.startsWith("/lol-match-history/v1/products/lol/current-summoner/matches")) {
      return { status: 200, body: HISTORIQUE };
    }
    return { status: 404, body: {} };
  });
  try {
    const dossier = fauxDossierJeu(`LeagueClient:1:${client.port}:${MOT_DE_PASSE}:https`);
    const r = await recupererCompteClient(dossier);
    assert.strictEqual(r.niveau, 24);
    assert.strictEqual(r.progression, 50);
    assert.strictEqual(r.nom, "Joueur Test");
    assert.strictEqual(r.stats.mayhem.parties, 3);
    assert.strictEqual(r.avertissement, null);
    assert.ok(client.requetes[1].url.includes("begIndex=0&endIndex=49"));
  } finally {
    await client.fermer();
  }
});

test("historique indisponible -> on garde le niveau, avec un avertissement", async () => {
  const client = await fauxClient(commeLeVraiClient); // ne connaît pas la route de l'historique (404)
  try {
    const dossier = fauxDossierJeu(`LeagueClient:1:${client.port}:${MOT_DE_PASSE}:https`);
    const r = await recupererCompteClient(dossier);
    assert.strictEqual(r.niveau, 87);
    assert.deepStrictEqual(r.stats, { total: 0, autresModes: 0, ignorees: 0, mayhem: null, aram: null, swiftplay: null, draft: null });
    assert.ok(r.avertissement.includes("historique"));
  } finally {
    await client.fermer();
  }
});

test("client pas lancé -> l'erreur porte le code « pas-lance » (utilisé par la page)", () => {
  const dossier = fauxDossierJeu();
  assert.throws(() => lireLockfile(dossier), (e) => e.probleme === "pas-lance");
});
