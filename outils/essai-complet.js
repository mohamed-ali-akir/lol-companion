/*
 * Essai de bout en bout : la VRAIE appli, branchée sur un FAUX client League (compte fictif)
 * ------------------------------------------------------------------------------------------
 *   npm run essai                     (ou : electron outils/essai-complet.js)
 *   CAPTURES=docs/captures npm run essai   -> refait aussi les captures du README
 *   ESSAI_INTERNET=1 npm run essai         -> consulte aussi un vrai build (Lolalytics, OP.GG) dans l'onglet Build
 *
 * Pourquoi (17/10/2026) : la page (src/onglets/) et main.js n'ont pas de tests unitaires ; ils n'étaient vérifiés
 * qu'à la main. Cet essai lance l'appli complète avec des réglages TEMPORAIRES (jamais ceux du joueur), un faux client
 * HTTPS + WebSocket sur 127.0.0.1 (certificat de test/fixtures), ouvre chaque onglet et vérifie :
 *   - qu'il n'y a aucune erreur, ni dans la page (console) ni dans le processus principal ;
 *   - que le compte fictif est bien lu (niveau, session, stats, maîtrise).
 * Code de sortie : 0 si tout va bien, 1 sinon. Lancé aussi sur GitHub à chaque envoi (tests.yml).
 */
const { app, BrowserWindow } = require("electron");
const fs = require("fs");
const os = require("os");
const path = require("path");
const https = require("https");

const PROJET = path.join(__dirname, "..");
const { WebSocketServer } = require(path.join(PROJET, "node_modules", "ws"));
const certificat = require(path.join(PROJET, "test", "fixtures", "certificat-test.js"));
const { xpDuCompte } = require(path.join(PROJET, "src", "calculs.js"));

const SORTIE = process.env.CAPTURES ? path.resolve(PROJET, process.env.CAPTURES) : null;
const AVEC_INTERNET = process.env.ESSAI_INTERNET === "1";
const attendre = (ms) => new Promise((ok) => setTimeout(ok, ms));
const JOUR = 24 * 3600 * 1000;
const maintenant = Date.now();
const problemes = [];

// Toute erreur du processus principal (signalerErreur, filets globaux...) passe par console.error : on la relève.
const consoleErreurOrigine = console.error;
console.error = (...morceaux) => {
  problemes.push(`processus principal : ${morceaux.map(String).join(" ")}`);
  consoleErreurOrigine(...morceaux);
};

// --- Compte fictif ------------------------------------------------------------------------------
const CHAMPIONS = [
  [103, "Ahri", "Ahri"], [1, "Annie", "Annie"], [22, "Ashe", "Ashe"], [86, "Garen", "Garen"], [222, "Jinx", "Jinx"],
  [99, "Lux", "Lux"], [25, "Morgana", "Morgana"], [412, "Thresh", "Thresh"], [64, "Lee Sin", "LeeSin"], [157, "Yasuo", "Yasuo"],
  [238, "Zed", "Zed"], [910, "Hwei", "Hwei"], [145, "Kai'Sa", "Kaisa"], [62, "Wukong", "MonkeyKing"], [10, "Kayle", "Kayle"],
];
let graine = 7;
const hasard = () => ((graine = (graine * 16807) % 2147483647) / 2147483647); // toujours les mêmes « hasards »
const FILES = [2400, 2400, 2400, 450, 480, 400];
const JOUES = [103, 910, 222, 99, 86, 145, 62, 412, 157, 25];
const parties = [];
for (let i = 0; i < 50; i++) {
  const date = i < 6 ? maintenant - (i + 1) * 40 * 60 * 1000 : maintenant - (1 + Math.floor(hasard() * 25)) * JOUR - Math.floor(hasard() * 10) * 3600 * 1000;
  const file = FILES[Math.floor(hasard() * FILES.length)];
  const minutes = file === 400 ? 26 + hasard() * 10 : file === 480 ? 18 + hasard() * 6 : 14 + hasard() * 8;
  const victoire = hasard() < (i < 6 ? 0.5 : 0.56);
  parties.push({
    gameId: 7000000 + i, queueId: file, gameDuration: Math.round(minutes * 60), gameCreation: date,
    participants: [{ participantId: 1, championId: JOUES[Math.floor(hasard() * JOUES.length)],
      stats: { win: victoire, kills: Math.floor(hasard() * 12), deaths: 1 + Math.floor(hasard() * 8), assists: Math.floor(hasard() * 18),
        totalMinionsKilled: Math.round(minutes * (file === 400 ? 5 + hasard() * 3 : 2 + hasard() * 2)), neutralMinionsKilled: Math.floor(hasard() * 10),
        goldEarned: Math.round(minutes * (330 + hasard() * 120)), totalDamageDealtToChampions: Math.round(minutes * (500 + hasard() * 900)),
        visionScore: Math.round(minutes * hasard() * 1.2) } }],
    participantIdentities: [{ participantId: 1, player: { puuid: "puuid-demo" } }],
  });
}
const maitrise = (championId, niveau, points, avant, apres, grades) => ({
  championId, championLevel: niveau, championPoints: points, championPointsSinceLastLevel: avant, championPointsUntilNextLevel: apres,
  markRequiredForNextLevel: niveau >= 4 ? 1 : 0, tokensEarned: 0, championSeasonMilestone: 0, milestoneGrades: grades,
  nextSeasonMilestone: { requireGradeCounts: { "A-": 1 }, rewardMarks: 1, bonus: false, rewardConfig: { rewardValue: "", maximumReward: 0 } },
  highestGrade: grades[0] || "B", lastPlayTime: maintenant - 2 * JOUR, puuid: "puuid-demo",
});
const OBJETS = { 1056: "Anneau de Doran", 2003: "Potion de soin", 3020: "Chaussures de sorcier", 3158: "Bottes de lucidité ionienne",
  2503: "Torche noire", 6655: "Écho de Luden", 4645: "Flamme-ombre", 3089: "Coiffe de Rabadon", 3157: "Sablier de Zhonya",
  3135: "Bâton du vide", 3115: "Dent de Nashor", 3118: "Malfaisance" };

const ROUTES = {
  "/lol-summoner/v1/current-summoner": { gameName: "Joueur", tagLine: "EUW", summonerLevel: 27, percentCompleteForNextLevel: 46, puuid: "puuid-demo", summonerId: 1 },
  "/lol-gameflow/v1/gameflow-phase": "Lobby",
  "/lol-game-data/assets/v1/champion-summary.json": [{ id: -1, name: "None", alias: "None" }, ...CHAMPIONS.map(([id, name, alias]) => ({ id, name, alias }))],
  "/lol-game-data/assets/v1/items.json": Object.entries(OBJETS).map(([id, name]) => ({ id: Number(id), name, categories: [] })),
  "/lol-champion-mastery/v1/local-player/champion-mastery": [
    maitrise(103, 7, 61200, 8000, 3800, ["S", "A"]), maitrise(910, 5, 30100, 4300, 2900, ["A"]), maitrise(222, 4, 18400, 5800, 4200, ["B"]),
    maitrise(99, 3, 9800, 1200, 2700, []), maitrise(86, 6, 44100, 9000, 2100, ["A-"]), maitrise(145, 2, 4200, 2400, 1600, []),
  ],
  "/riotclient/region-locale": { locale: "fr_FR", region: "EUW" },
};

function demarrerFauxClient() {
  return new Promise((ok) => {
    const serveur = https.createServer(certificat, (req, res) => {
      const url = req.url.split("?")[0];
      const corps = url === "/lol-match-history/v1/products/lol/current-summoner/matches"
        ? { games: { games: req.url.includes("begIndex=0") ? parties : [] } }
        : ROUTES[url];
      res.writeHead(corps === undefined ? 404 : 200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(corps === undefined ? {} : corps));
    });
    new WebSocketServer({ server: serveur }); // connexion en direct : abonnements acceptés, rien envoyé
    serveur.listen(0, "127.0.0.1", () => ok(serveur.address().port));
  });
}

// --- Réglages temporaires (jamais ceux du joueur) -------------------------------------------------------
const base = fs.mkdtempSync(path.join(os.tmpdir(), "lol-essai-"));
const jeu = path.join(base, "jeu");
function preparer() {
  const userData = path.join(base, "reglages");
  fs.mkdirSync(jeu);
  fs.mkdirSync(userData);
  fs.writeFileSync(path.join(userData, "config.json"), JSON.stringify({
    dossierJeu: jeu,
    ongletActif: "accueil",
    acceptationAuto: { actif: true, delaiSecondes: 2, notifier: true },
    arrierePlan: { majAuto: true },
    selectionAuto: { pickActif: true, banActif: true, delaiPickSecondes: 10, delaiBanSecondes: 5,
      picks: { defaut: [99], top: [86], jungle: [62], middle: [103, 910], bottom: [222, 145], utility: [412] }, bans: [157, 238] },
    buildAuto: { stats: true, runes: true },
  }));
  const points = [];
  for (let j = 21; j >= 1; j--) {
    const niveau = 24 + Math.floor((21 - j) / 7);
    const progression = Math.min(99, ((21 - j) % 7) * 14);
    points.push({ date: new Date(maintenant - j * JOUR).toISOString(), riotId: "Joueur#EUW", niveau, progression, xpTotale: Math.round(xpDuCompte({ niveau, progression })) });
  }
  fs.writeFileSync(path.join(userData, "progression.json"), JSON.stringify(points));
  return userData;
}

/** Photographie la page entière (des onglets au bas du panneau visible), seulement si CAPTURES est donné. */
async function photographier(fenetre, nom) {
  if (!SORTIE) return;
  fs.mkdirSync(SORTIE, { recursive: true });
  const zone = await fenetre.webContents.executeJavaScript(`(() => {
    const g = document.querySelector('.onglets').getBoundingClientRect();
    const panneau = [...document.querySelectorAll('.panneau')].find((p) => !p.hidden);
    const haut = g.top + window.scrollY, bas = panneau.getBoundingClientRect().bottom + window.scrollY;
    return { x: Math.max(0, g.left - 16), y: Math.max(0, haut - 16), width: g.width + 32, height: bas - haut + 32 };
  })()`);
  const dbg = fenetre.webContents.debugger;
  if (!dbg.isAttached()) dbg.attach("1.3");
  const { data } = await dbg.sendCommand("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { ...zone, scale: 1 } });
  fs.writeFileSync(path.join(SORTIE, `${nom}.png`), Buffer.from(data, "base64"));
  console.log("capture :", nom);
}

// Ce que chaque onglet doit montrer avec le compte fictif (texte cherché dans le panneau).
const ATTENDU = {
  accueil: ["Niveau 27", "Ta session", "Ta dernière partie", "ta moyenne"],
  niveau: ["parties"],
  stats: ["Par champion", "Ahri"],
  maitrise: ["Ahri"],
  selection: ["Conseiller de draft"],
  build: ["Consulter un build"],
  parametres: ["Accepter automatiquement", "Dossier du jeu"],
};

app.setPath("userData", preparer());
app.setVersion(require(path.join(PROJET, "package.json")).version); // sinon Electron lancé sur ce script donne SA version
require(path.join(PROJET, "main.js"));

(async () => {
  const port = await demarrerFauxClient();
  fs.writeFileSync(path.join(jeu, "lockfile"), `LeagueClient:${process.pid}:${port}:mdp:https`); // le client « démarre »
  await app.whenReady();
  await attendre(9000); // lecture du faux client, rendu
  const fenetre = BrowserWindow.getAllWindows().find((w) => w.getTitle() === "LoL Companion" && w.isVisible());
  if (!fenetre) throw new Error("fenêtre principale introuvable");
  fenetre.webContents.on("console-message", (...args) => {
    const details = args[1] && typeof args[1] === "object" ? args[1] : { level: args[1], message: args[2] };
    if (details.level === "error" || details.level === 3) problemes.push(`page : ${details.message}`);
  });
  fenetre.setSize(900, 950);
  // Première ouverture : l'assistant pose ses 3 questions et règle les cases ; il ne revient plus ensuite.
  const page = (code) => fenetre.webContents.executeJavaScript(code);
  const config = () => JSON.parse(fs.readFileSync(path.join(app.getPath("userData"), "config.json"), "utf8"));
  const assistant = await page(`({ ouvert: $("assistant").open, titre: $("assistantTitre").textContent })`);
  if (!assistant.ouvert || !assistant.titre.includes("Bienvenue")) problemes.push("assistant de première ouverture : pas affiché");
  const repondre = async (bouton, etape) => {
    await page(`$("assistantBoutons").querySelectorAll("button")[${bouton}].click(); true`);
    await attendre(400);
    if (SORTIE && etape) {
      // La fenêtre de l'assistant est par-dessus la page : on photographie ce qui est à l'écran.
      fs.mkdirSync(SORTIE, { recursive: true });
      fs.writeFileSync(path.join(SORTIE, `assistant-${etape}.png`), (await fenetre.webContents.capturePage()).toPNG());
    }
  };
  await repondre(0, "question"); // « C'est parti »
  await repondre(1); // build : non
  await repondre(0); // chronos : oui
  await repondre(1, "fin"); // accepter : non
  const reglages = config();
  if (reglages.buildAuto.stats !== false || reglages.buildAuto.sorts !== true || reglages.acceptationAuto.actif !== false || reglages.assistantVu !== true) {
    problemes.push(`assistant : réponses mal enregistrées (${JSON.stringify({ build: reglages.buildAuto, acceptation: reglages.acceptationAuto })})`);
  }
  if (!(await page(`$("buildSorts").checked && !$("buildStats").checked && !$("autoAccepter").checked`))) problemes.push("assistant : cases des onglets pas mises à jour");
  await repondre(0); // « Terminer »
  // Relancé depuis Paramètres, puis « Passer » : fermé sans rien changer.
  await page(`$("assistantRelancer").click(); true`);
  await attendre(400);
  await page(`$("assistantPasser").click(); true`);
  await attendre(400);
  if (await page(`$("assistant").open`)) problemes.push("assistant : « Passer » ne le ferme pas");
  if (JSON.stringify(config().buildAuto) !== JSON.stringify(reglages.buildAuto)) problemes.push("assistant : « Passer » a changé des réglages");
  const aller = (onglet) => fenetre.webContents.executeJavaScript(`activerOnglet(${JSON.stringify(onglet)}, { memoriser: false }); window.scrollTo(0, 0); true`);
  const texteDuPanneau = (onglet) => fenetre.webContents.executeJavaScript(`document.getElementById(${JSON.stringify(`panneau-${onglet}`)}).innerText`);
  for (const [onglet, mots] of Object.entries(ATTENDU)) {
    await aller(onglet);
    await attendre(1200);
    const texte = await texteDuPanneau(onglet);
    for (const mot of mots) if (!texte.includes(mot)) problemes.push(`onglet ${onglet} : « ${mot} » introuvable`);
    if (onglet === "parametres") {
      // Comme dans l'appli installée (à jour, dossier du jeu par défaut), pas le dossier temporaire de l'essai.
      await fenetre.webContents.executeJavaScript(`$("dossierJeu").value = "C:\\\\Riot Games\\\\League of Legends";
        $("majVersion").textContent = "Version ${app.getVersion()} · à jour ✓"; $("majVerifier").disabled = false; true`);
    }
    if (onglet === "build" && AVEC_INTERNET) {
      await fenetre.webContents.executeJavaScript(`$("buildChampion").value = "Ahri"; $("buildRole").value = "middle"; $("formConsulterBuild").requestSubmit(); true`);
      await attendre(15000);
      if (!(await texteDuPanneau("build")).includes("Objet 1")) problemes.push("onglet build : le build consulté d'Ahri ne s'affiche pas");
    }
    await photographier(fenetre, onglet);
    console.log(`onglet ${onglet} : vu`);
  }
  fenetre.setSize(420, 900); // petite fenêtre
  await aller("accueil");
  await attendre(1500);
  await photographier(fenetre, "petite-fenetre");
})()
  .catch((erreur) => problemes.push(`essai interrompu : ${erreur.message}`))
  .finally(() => {
    console.log(problemes.length === 0 ? "\nEssai réussi : aucun problème." : `\n${problemes.length} problème(s) :\n- ${problemes.join("\n- ")}`);
    process.exitCode = problemes.length === 0 ? 0 : 1;
    app.exit(process.exitCode);
  });
