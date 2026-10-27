// Mode Deadlock sur ce PC (deadlock-jeu.js) : jeu lancé, compte Steam, parties du cache de Steam, surveillance.
// Sans Windows ni Steam : les commandes (tasklist, reg) et les fichiers sont remplacés par des faux.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const J = require("../deadlock-jeu.js");

// Vraie sortie de `tasklist /FO CSV /NH /FI "IMAGENAME eq deadlock.exe"` (27/10/2026), et celle quand il est fermé.
const TASKLIST_LANCE = '"deadlock.exe","24680","Console","1","2 145 320 K"\r\n';
const TASKLIST_FERME = "INFORMATION : aucune tâche en service ne correspond aux critères spécifiés.\r\n";

test("jeu lancé : lu dans la liste des programmes de Windows (et jamais ailleurs)", async () => {
  assert.strictEqual(J.programmeDansListe(TASKLIST_LANCE), true);
  assert.strictEqual(J.programmeDansListe('"DEADLOCK.EXE","1"'), true, "majuscules");
  assert.strictEqual(J.programmeDansListe(TASKLIST_FERME), false);
  assert.strictEqual(J.programmeDansListe('"deadlock.exe.bak","1"'), false);
  assert.strictEqual(J.programmeDansListe(""), false);
  const demandes = [];
  const lancer = async (commande, args) => {
    demandes.push([commande, ...args]);
    return TASKLIST_LANCE;
  };
  assert.strictEqual(await J.deadlockLance({ plateforme: "win32", lancer }), true);
  assert.deepStrictEqual(demandes, [["tasklist", "/FO", "CSV", "/NH", "/FI", "IMAGENAME eq deadlock.exe"]]);
  assert.strictEqual(await J.deadlockLance({ plateforme: "darwin", lancer }), false, "Deadlock n'existe que sur Windows");
  assert.strictEqual(await J.deadlockLance({ plateforme: "win32", lancer: async () => Promise.reject(new Error("tasklist absent")) }), false);
});

test("registre : valeur texte ou nombre (REG_DWORD en hexadécimal)", () => {
  const sortie = "\r\nHKEY_CURRENT_USER\\Software\\Valve\\Steam\\ActiveProcess\r\n    ActiveUser    REG_DWORD    0x4b02f37d\r\n\r\n";
  assert.strictEqual(J.valeurRegistre(sortie, "ActiveUser"), 0x4b02f37d);
  assert.strictEqual(J.valeurRegistre("    SteamPath    REG_SZ    c:/program files (x86)/steam\r\n", "steampath"), "c:/program files (x86)/steam");
  assert.strictEqual(J.valeurRegistre(sortie, "Autre"), null);
  assert.strictEqual(J.valeurRegistre(null, "ActiveUser"), null);
});

test("compte Steam : SteamID64 -> numéro du compte de l'API", () => {
  assert.strictEqual(J.numeroDuCompte("76561198003040237"), 42774509);
  assert.strictEqual(J.numeroDuCompte("76561197960265728"), null, "numéro 0 : pas un compte");
  assert.strictEqual(J.numeroDuCompte("123"), null);
  assert.strictEqual(J.numeroDuCompte(undefined), null);
});

// loginusers.vdf (format de Valve), deux comptes sur ce PC
const LOGINUSERS = `"users"
{
	"76561198003040237"
	{
		"AccountName"		"compte1"
		"PersonaName"		"Ancien"
		"MostRecent"		"0"
		"Timestamp"		"1700000000"
	}
	"76561198100000000"
	{
		"AccountName"		"compte2"
		"PersonaName"		"Joueur"
		"MostRecent"		"1"
		"Timestamp"		"1790000000"
	}
	"pas-un-numero" { "PersonaName" "?" }
}`;

test("loginusers.vdf : comptes de ce PC, le plus récent repéré, bloc abîmé ignoré", () => {
  const comptes = J.comptesDepuisLoginusers(LOGINUSERS);
  assert.deepStrictEqual(comptes, [
    { accountId: 42774509, pseudo: "Ancien", recent: false, horodatage: 1700000000 },
    { accountId: 139734272, pseudo: "Joueur", recent: true, horodatage: 1790000000 },
  ]);
  assert.deepStrictEqual(J.comptesDepuisLoginusers("abîmé"), []);
});

test("compte Steam du PC : le compte connecté d'abord (registre), sinon le dernier utilisé", async () => {
  const lancer = (activeUser) => async (commande, args) => {
    if (args.includes("SteamPath")) return "    SteamPath    REG_SZ    D:/Steam\r\n";
    if (args.includes("ActiveUser")) return `    ActiveUser    REG_DWORD    0x${activeUser.toString(16)}\r\n`;
    throw new Error(`commande inattendue ${commande}`);
  };
  const fichiers = [];
  const lireFichier = async (f) => {
    fichiers.push(f);
    return LOGINUSERS;
  };
  assert.deepStrictEqual(await J.compteSteam({ plateforme: "win32", lancer: lancer(42774509), lireFichier }), { accountId: 42774509, pseudo: "Ancien" });
  assert.strictEqual(fichiers[0], path.normalize("D:/Steam/config/loginusers.vdf"));
  assert.deepStrictEqual(await J.compteSteam({ plateforme: "win32", lancer: lancer(0), lireFichier }), { accountId: 139734272, pseudo: "Joueur" }, "Steam fermé : le dernier compte");
  assert.deepStrictEqual(await J.compteSteam({ plateforme: "win32", lancer: lancer(7), lireFichier }), { accountId: 7, pseudo: null }, "connecté mais absent du fichier");
  const sansSteam = async () => Promise.reject(new Error("clé absente"));
  assert.strictEqual(await J.compteSteam({ plateforme: "win32", lancer: sansSteam, lireFichier: async () => Promise.reject(new Error("ENOENT")) }), null);
  assert.strictEqual(await J.compteSteam({ plateforme: "darwin" }), null);
});

test("cache de Steam : adresses des parties de Deadlock (même règle que l'outil du site)", () => {
  // Cas du test de l'outil officiel (deadlock-api-ingest, src/scan_cache.rs)
  const texte = "\0\0http://replay404.valve.net/1422450/37959196_937530290.meta.bz2\0junk"
    + " replay183.valve.net/1422450/42476710_428480166.dem.bz2\n"
    + " cdn.valve.net/1422450/1_2.meta.bz2\0"
    + " http://replay9.valve.net/570/1_2.dem.bz2\0"; // Dota 2 (570) : ignoré
  assert.deepStrictEqual(J.adressesDeParties(texte), [
    "http://replay404.valve.net/1422450/37959196_937530290.meta.bz2",
    "http://replay183.valve.net/1422450/42476710_428480166.dem.bz2",
  ]);
  assert.deepStrictEqual(J.clesDepuisAdresse("http://replay404.valve.net/1422450/37959196_937530290.meta.bz2"), { match_id: 37959196, cluster_id: 404, metadata_salt: 937530290 });
  assert.deepStrictEqual(J.clesDepuisAdresse("http://replay183.valve.net/1422450/42476710_428480166.dem.bz2?v=2"), { match_id: 42476710, cluster_id: 183, replay_salt: 428480166 });
  for (const autre of ["http://replay1.valve.net/570/1_2.dem.bz2", "http://replay1.valve.net/1422450/1_2.txt", "https://exemple.test", null]) {
    assert.strictEqual(J.clesDepuisAdresse(autre), null, String(autre));
  }
  assert.deepStrictEqual(J.regrouperCles([
    { match_id: 1, cluster_id: 4, metadata_salt: 10 },
    { match_id: 1, cluster_id: 4, replay_salt: 20 },
    { match_id: 2, cluster_id: 5, metadata_salt: 30 },
    null,
  ]), [{ match_id: 1, cluster_id: 4, metadata_salt: 10, replay_salt: 20 }, { match_id: 2, cluster_id: 5, metadata_salt: 30 }]);
});

test("cache de Steam : dossiers parcourus, début des fichiers lu, rien n'est modifié", async () => {
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), "lol-cache-steam-"));
  try {
    fs.mkdirSync(path.join(cache, "0a"));
    fs.writeFileSync(path.join(cache, "0a", "f1"), "GET http://replay404.valve.net/1422450/37959196_937530290.meta.bz2 HTTP/1.1");
    fs.writeFileSync(path.join(cache, "f2"), Buffer.concat([Buffer.from("replay183.valve.net/1422450/37959196_428480166.dem.bz2\0"), Buffer.alloc(500, 1)]));
    fs.writeFileSync(path.join(cache, "f3"), `${"x".repeat(300)} http://replay1.valve.net/1422450/5_6.meta.bz2`); // après les 200 premiers octets
    fs.writeFileSync(path.join(cache, "f4"), "rien");
    const avant = fs.readdirSync(cache, { recursive: true }).sort();
    assert.deepStrictEqual(await J.partiesDuCache(cache), [{ match_id: 37959196, cluster_id: 404, replay_salt: 428480166, metadata_salt: 937530290 }]);
    assert.deepStrictEqual(fs.readdirSync(cache, { recursive: true }).sort(), avant);
    assert.deepStrictEqual(await J.partiesDuCache(path.join(cache, "absent")), [], "pas de cache : aucune partie, pas d'erreur");
  } finally {
    fs.rmSync(cache, { recursive: true, force: true });
  }
  assert.strictEqual(J.dossierCacheSteam("D:\\Steam"), path.join("D:\\Steam", "appcache", "httpcache"));
});

test("surveillance : lancement, fermeture (session), une vérification à la fois, erreurs gardées pour soi", async () => {
  let lance = false;
  let heure = 1000;
  const evenements = [];
  const erreurs = [];
  const suivi = J.creerSuiviDeadlock({
    estLance: async () => {
      if (lance === "panne") throw new Error("tasklist en panne");
      return lance;
    },
    maintenant: () => heure,
    surLancement: (debut) => evenements.push(["lancé", debut]),
    surFermeture: (session) => {
      evenements.push(["fermé", session]);
      throw new Error("rappel en panne");
    },
    aErreur: (e) => erreurs.push(e.message),
  });
  await suivi.verifier();
  assert.deepStrictEqual(evenements, [], "fermé au départ : rien");
  lance = true;
  await suivi.verifier();
  heure = 5000;
  await suivi.verifier(); // toujours lancé : rien de plus
  assert.deepStrictEqual(suivi.etat(), { lance: true, debut: 1000 });
  lance = "panne";
  await suivi.verifier(); // on ne conclut rien
  assert.strictEqual(suivi.etat().lance, true);
  lance = false;
  heure = 9000;
  await Promise.all([suivi.verifier(), suivi.verifier()]); // la deuxième attend son tour : une seule fermeture
  assert.deepStrictEqual(evenements, [["lancé", 1000], ["fermé", { debut: 1000, fin: 9000 }]]);
  assert.deepStrictEqual(erreurs, ["tasklist en panne", "rappel en panne"]);
  assert.deepStrictEqual(suivi.etat(), { lance: false, debut: null });
});
