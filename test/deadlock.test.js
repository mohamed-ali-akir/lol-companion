// Mode Deadlock : lecteur de deadlock-api.com (faux Internet), fichier deadlock.json, et le service (deadlock.js)
// avec un faux jeu, un faux lecteur et un faux disque : sans Deadlock, sans Steam et sans Internet.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const A = require("../deadlock-api.js");
const D = require("../deadlock-donnees.js");
const { creerDeadlock, normaliserReglagesDeadlock, MESSAGE_AUCUNE_PARTIE } = require("../deadlock.js");
const { IDENTITE } = require("../internet.js");

// --- Lecteur de deadlock-api.com -----------------------------------------------------------------------

/** Faux Internet : répond selon le chemin de l'adresse, et garde chaque demande. */
function fauxInternet(reponses) {
  const demandes = [];
  const appeler = async (adresse, options) => {
    const url = new URL(adresse);
    demandes.push({ url, options });
    const r = reponses[url.pathname];
    if (r instanceof Error) throw r;
    if (typeof r === "number") return { ok: false, status: r, text: async () => "" };
    return { ok: true, status: 200, text: async () => (typeof r === "string" ? r : JSON.stringify(r === undefined ? [] : r)) };
  };
  return { demandes, appeler };
}

const MAINTENANT = Date.UTC(2026, 9, 27, 15, 30); // 27/10/2026 15:30 UTC

test("lecteur : bonnes adresses, User-Agent honnête, période arrondie au jour, rien de personnel en trop", async () => {
  const net = fauxInternet({ "/v1/assets/heroes": [{ id: 1, name: "Infernus" }], "/v1/players/123/match-history": [{ match_id: 9, hero_id: 1, start_time: 100 }] });
  const l = A.creerLecteurDeadlock({ appeler: net.appeler, maintenant: () => MAINTENANT });
  assert.deepStrictEqual([...(await l.heros()).values()], [{ id: 1, nom: "Infernus" }]);
  assert.deepStrictEqual((await l.historique(123)).map((p) => p.id), [9]);
  await l.statsHeros({ rang: 8 });
  await l.statsObjets(1);
  await l.mesStatsHeros(123);
  const [heros, historique, stats, objets, mes] = net.demandes;
  assert.strictEqual(heros.url.origin, "https://api.deadlock-api.com");
  assert.strictEqual(heros.options.headers["User-Agent"], IDENTITE);
  assert.ok(heros.options.signal, "délai maximal");
  assert.strictEqual(historique.url.pathname, "/v1/players/123/match-history");
  const minuitUtc = Date.UTC(2026, 9, 27) / 1000;
  assert.strictEqual(stats.url.searchParams.get("min_unix_timestamp"), String(minuitUtc - 14 * 86400), "14 jours, depuis minuit : le cache sert toute la journée");
  assert.strictEqual(stats.url.searchParams.get("min_average_badge"), "80");
  assert.strictEqual(objets.url.searchParams.get("hero_id"), "1");
  assert.strictEqual(objets.url.searchParams.get("min_unix_timestamp"), String(minuitUtc - 30 * 86400));
  assert.strictEqual(objets.url.searchParams.has("min_average_badge"), false, "tous les niveaux : pas de paramètre");
  assert.strictEqual(mes.url.searchParams.get("account_ids"), "123");
});

test("lecteur : cache de 3 h pour les stats, 5 min pour ton historique", async () => {
  let heure = MAINTENANT;
  const net = fauxInternet({});
  const l = A.creerLecteurDeadlock({ appeler: net.appeler, maintenant: () => heure });
  await l.heros();
  await l.historique(123);
  heure += 4 * 60 * 1000;
  await l.heros();
  await l.historique(123);
  assert.strictEqual(net.demandes.length, 2, "rien de relu après 4 min");
  heure += 2 * 60 * 1000;
  await l.heros();
  await l.historique(123);
  assert.deepStrictEqual(net.demandes.map((d) => d.url.pathname), ["/v1/assets/heroes", "/v1/players/123/match-history", "/v1/players/123/match-history"]);
});

test("lecteur : erreurs claires (pas d'Internet, site surchargé, réponse illisible, compte ou héros invalide)", async () => {
  const l = (r) => A.creerLecteurDeadlock({ appeler: fauxInternet({ "/v1/assets/heroes": r }).appeler, maintenant: () => MAINTENANT });
  const cas = [[new TypeError("fetch failed"), /ne répond pas/], [503, /surchargé/], [500, /code 500/], ["<html>", /illisible/]];
  for (const [reponse, attendu] of cas) {
    await assert.rejects(l(reponse).heros(), (e) => e instanceof A.ErreurDeadlockApi && attendu.test(e.message), String(attendu));
  }
  await assert.rejects(l([]).historique(0), /Compte Steam introuvable/);
  await assert.rejects(l([]).historique("123"), /Compte Steam introuvable/);
  await assert.rejects(l([]).statsObjets(-1), /Héros inconnu/);
  // Un échec n'est pas gardé : la demande suivante réessaie
  let fois = 0;
  const lecteur = A.creerLecteurDeadlock({ appeler: async () => (++fois === 1 ? { ok: false, status: 503, text: async () => "" } : { ok: true, status: 200, text: async () => "[]" }), maintenant: () => MAINTENANT });
  await assert.rejects(lecteur.heros());
  assert.strictEqual((await lecteur.heros()).size, 0);
});

test("envoi des parties : POST JSON au format de l'outil du site, par paquets de 1 000, jamais en cache", async () => {
  const net = fauxInternet({ "/v1/matches/salts": {} });
  const l = A.creerLecteurDeadlock({ appeler: net.appeler, maintenant: () => MAINTENANT });
  const cles = Array.from({ length: 1500 }, (_, i) => ({ match_id: i + 1, cluster_id: 404, metadata_salt: 7 }));
  assert.strictEqual(await l.envoyerParties([...cles, { match_id: "x" }, null]), 1500);
  assert.strictEqual(net.demandes.length, 2);
  const [premier] = net.demandes;
  assert.strictEqual(premier.options.method, "POST");
  assert.strictEqual(premier.options.headers["Content-Type"], "application/json");
  const corps = JSON.parse(premier.options.body);
  assert.strictEqual(corps.length, 1000);
  assert.deepStrictEqual(corps[0], { match_id: 1, cluster_id: 404, metadata_salt: 7, replay_salt: null }, "ni pseudo ni compte : seulement la partie");
  assert.strictEqual(await l.envoyerParties([]), 0);
  assert.strictEqual(net.demandes.length, 2, "rien à envoyer : aucune demande");
});

// --- deadlock.json ---------------------------------------------------------------------------------

test("deadlock.json : sessions et parties envoyées, lecture tolérante, sessions trop courtes ignorées", () => {
  assert.deepStrictEqual(D.normaliserDonnees({ sessions: [{ debut: 100000, fin: 200000 }, { debut: 0, fin: 1000 }, "x", { debut: 5 }], partiesEnvoyees: [1, 1, "2", 3] }), {
    sessions: [{ debut: 100000, fin: 200000 }],
    partiesEnvoyees: [1, 3],
  });
  assert.deepStrictEqual(D.normaliserDonnees("abîmé"), { sessions: [], partiesEnvoyees: [] });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "lol-deadlock-"));
  try {
    const donnees = D.creerDonneesDeadlock({ dossier });
    assert.deepStrictEqual(donnees.sessions(), [], "pas encore de fichier");
    assert.strictEqual(donnees.ajouterSession({ debut: 0, fin: 10000 }), false, "10 s : ignorée");
    assert.strictEqual(donnees.ajouterSession({ debut: 0, fin: 3600000 }), true);
    donnees.noterEnvoyees([5, 6, "x"]);
    const relu = D.creerDonneesDeadlock({ dossier });
    assert.deepStrictEqual(relu.sessions(), [{ debut: 0, fin: 3600000 }]);
    assert.deepStrictEqual([...relu.partiesEnvoyees()], [5, 6]);
    fs.writeFileSync(path.join(dossier, "deadlock.json"), "{ abîmé");
    fs.rmSync(path.join(dossier, "deadlock.json.bak"), { force: true });
    assert.deepStrictEqual(D.creerDonneesDeadlock({ dossier }).sessions(), [], "fichier illisible : repart de zéro sans planter");
  } finally {
    fs.rmSync(dossier, { recursive: true, force: true });
  }
});

test("réglages : envoi désactivé par défaut, niveau entre 1 et 11 ou tous", () => {
  assert.deepStrictEqual(normaliserReglagesDeadlock(undefined), { envoyerParties: false, rang: null });
  assert.deepStrictEqual(normaliserReglagesDeadlock({ envoyerParties: "oui", rang: 0 }), { envoyerParties: false, rang: null });
  assert.deepStrictEqual(normaliserReglagesDeadlock({ envoyerParties: true, rang: 8 }), { envoyerParties: true, rang: 8 });
  assert.deepStrictEqual(normaliserReglagesDeadlock({ rang: 12 }), { envoyerParties: false, rang: null });
});

// --- Le service ------------------------------------------------------------------------------------------

const HEROS = new Map([[1, { id: 1, nom: "Infernus" }], [2, { id: 2, nom: "Seven" }]]);

function service({ lance = false, compte = { accountId: 123, pseudo: "Joueur" }, cache = [], historique = [], echecEnvoi = null } = {}) {
  const trace = { envoyees: [], etats: [], journal: [], sessions: [], notees: [], reglages: { envoyerParties: false, rang: null } };
  const etatJeu = { lance };
  let heure = 1_000_000;
  const jeu = {
    deadlockLance: async () => etatJeu.lance,
    compteSteam: async () => compte,
    dossierSteam: async () => "C:\\Steam",
    dossierCacheSteam: (s) => `${s}\\appcache\\httpcache`,
    partiesDuCache: async () => cache,
  };
  const lecteur = {
    heros: async () => HEROS,
    objets: async () => new Map([[11, { id: 11, nom: "Extended Magazine", emplacement: "arme", prix: 800 }]]),
    rangs: async () => [{ rang: 8, nom: "Oracle" }],
    historique: async () => historique,
    mesStatsHeros: async () => [{ hero_id: 1, matches_played: 2, wins: 1 }],
    statsHeros: async () => [{ hero_id: 1, wins: 600, matches: 1000 }, { hero_id: 2, wins: 500, matches: 1000 }],
    statsHerosBuild: async () => [{ hero_id: 1, wins: 600, matches: 1000 }],
    statsObjets: async () => [{ item_id: 11, wins: 500, matches: 900, avg_buy_time_s: 300 }],
    duels: async () => [{ hero_id: 1, enemy_hero_id: 2, wins: 300, matches_played: 1000 }],
    envoyerParties: async (cles) => {
      if (echecEnvoi) throw new Error(echecEnvoi);
      trace.envoyees.push(...cles.map((c) => c.match_id));
      return cles.length;
    },
  };
  const envoyees = new Set();
  const donnees = {
    sessions: () => trace.sessions,
    ajouterSession: (s) => trace.sessions.push(s),
    partiesEnvoyees: () => new Set(envoyees),
    noterEnvoyees: (ids) => ids.forEach((id) => {
      envoyees.add(id);
      trace.notees.push(id);
    }),
  };
  const dl = creerDeadlock({
    lecteur,
    donnees,
    jeu,
    reglages: () => trace.reglages,
    enregistrerReglages: (r) => (trace.reglages = r),
    maintenant: () => heure,
    intervalleMs: 60 * 60 * 1000, // les tests vérifient eux-mêmes (verifier), la minuterie ne sonne jamais
    journal: (...m) => trace.journal.push(m.join(" ")),
    surEtat: (e) => trace.etats.push(e),
  });
  return { dl, trace, etatJeu, avancer: (ms) => (heure += ms) };
}

test("service : état (jeu, compte, temps de jeu), lancement puis fermeture enregistrée", async () => {
  const { dl, trace, etatJeu, avancer } = service();
  dl.demarrer();
  await dl.verifier();
  assert.deepStrictEqual(await dl.etat(), {
    lance: false, compte: { accountId: 123, pseudo: "Joueur" }, temps: { aujourdhui: 0, septJours: 0, total: 0 }, reglages: { envoyerParties: false, rang: null }, dernierEnvoi: null,
  });
  etatJeu.lance = true;
  await dl.verifier();
  assert.strictEqual(trace.etats.at(-1).lance, true, "la page est prévenue du lancement");
  avancer(40 * 60 * 1000);
  assert.strictEqual((await dl.etat()).temps.total, 40 * 60 * 1000, "la session en cours compte");
  etatJeu.lance = false;
  await dl.verifier();
  assert.deepStrictEqual(trace.sessions, [{ debut: 1_000_000, fin: 1_000_000 + 40 * 60 * 1000 }]);
  assert.strictEqual(trace.etats.at(-1).lance, false);
  assert.deepStrictEqual(trace.envoyees, [], "case décochée : rien n'est envoyé");
  dl.arreter();
});

test("service : envoi des parties du cache seulement avec la case, jamais deux fois la même, erreur dite", async () => {
  const cache = [{ match_id: 1, cluster_id: 4, metadata_salt: 5 }, { match_id: 2, cluster_id: 4, replay_salt: 6 }];
  const { dl, trace } = service({ cache });
  assert.strictEqual(await dl.envoyerNouvellesParties(), null, "case décochée");
  dl.enregistrer({ envoyerParties: true });
  await new Promise((ok) => setTimeout(ok, 10)); // cocher la case envoie tout de suite ce qui est déjà dans le cache
  assert.deepStrictEqual(trace.envoyees, [1, 2]);
  assert.deepStrictEqual((await dl.envoyerNouvellesParties()).envoyees, 0, "déjà envoyées : rien de plus");
  assert.deepStrictEqual(trace.envoyees, [1, 2]);
  assert.ok(trace.journal.some((ligne) => ligne.includes("parties du cache de Steam")));
  const panne = service({ cache, echecEnvoi: "deadlock-api.com est surchargé" });
  panne.trace.reglages = { envoyerParties: true, rang: null };
  const r = await panne.dl.envoyerNouvellesParties();
  assert.deepStrictEqual([r.envoyees, r.erreur], [0, "deadlock-api.com est surchargé"]);
  assert.deepStrictEqual(panne.trace.notees, [], "échec : rien n'est noté comme envoyé (réessayé la prochaine fois)");
});

test("service : Accueil (tes parties, message si aucune), Héros et Build calculés pour la page", async () => {
  const vide = service();
  assert.deepStrictEqual((await vide.dl.accueil()).message, MESSAGE_AUCUNE_PARTIE);
  const sansCompte = service({ compte: null });
  assert.match((await sansCompte.dl.accueil()).message, /Aucun compte Steam/);
  assert.deepStrictEqual((await sansCompte.dl.heros()).mesHeros, [], "sans compte : la tier list s'affiche quand même");

  const { dl } = service({ historique: [{ id: 7, heroId: 1, debut: 5, victoire: true, eliminations: 3, morts: 1, assistances: 2 }] });
  const accueil = await dl.accueil();
  assert.strictEqual(accueil.message, null);
  assert.strictEqual(accueil.resume.dernieres[0].nomHeros, "Infernus");
  const heros = await dl.heros();
  assert.deepStrictEqual(heros.tierListe.map((h) => h.nom), ["Infernus", "Seven"]);
  assert.strictEqual(heros.mesHeros[0].nom, "Infernus");
  assert.strictEqual(heros.periodeJours, A.JOURS_TIER_LISTE);
  assert.deepStrictEqual((await dl.listeHeros()).map((h) => h.nom), ["Infernus", "Seven"]);
  const build = await dl.build(1);
  assert.strictEqual(build.heros.nom, "Infernus");
  assert.strictEqual(build.build.parties, 1000, "part des achats calculée sur les parties du héros");
  assert.deepStrictEqual(build.build.phases[0].objets.map((o) => o.nom), ["Extended Magazine"]);
  assert.deepStrictEqual(build.contres.difficiles.map((c) => c.nom), ["Seven"]);
  assert.strictEqual((await dl.build(77)).heros.nom, "Héros n° 77");
});
