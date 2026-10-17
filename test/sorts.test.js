// Tests des chronos des sorts d'invocateur adverses : sorts reconnus, recharges, adversaires, clics (sans jeu).
const test = require("node:test");
const assert = require("node:assert");
const S = require("../sorts.js");

const sort = (nom) => ({ rawDisplayName: `GeneratedTip_SummonerSpell_${nom}_DisplayName` });
const joueur = (riotId, team, champion, sorts, { position = "", level = 1, items = [] } = {}) => ({
  riotId,
  team,
  rawChampionName: `game_character_displayname_${champion}`,
  level,
  position,
  items,
  summonerSpells: { summonerSpellOne: sort(sorts[0]), summonerSpellTwo: sort(sorts[1]) },
});
const JOUEURS = [
  joueur("Moi#EUW", "ORDER", "Ahri", ["SummonerFlash", "SummonerDot"], { position: "MIDDLE" }),
  joueur("Bot#1", "CHAOS", "Jinx", ["SummonerFlash", "SummonerHeal"], { position: "BOTTOM" }),
  joueur("Top#1", "CHAOS", "MonkeyKing", ["SummonerFlash", "SummonerTeleport"], { position: "TOP", level: 18 }),
  joueur("Mid#1", "CHAOS", "Zed", ["SummonerFlash", "SummonerDot"], { position: "MIDDLE", items: [{ itemID: 3158, displayName: "Bottes ioniennes de lucidité" }] }),
];
const JEU = (tempsS) => ({ tempsS, joueurs: JOUEURS, actif: { riotId: "Moi#EUW" }, evenements: [] });

test("sorts reconnus d'après leur nom interne (TP déchaînée et Châtiment compris), inconnu -> null", () => {
  assert.strictEqual(S.cleSort(sort("SummonerFlash")), "Flash");
  assert.strictEqual(S.cleSort({ rawDisplayName: "S12_SummonerTeleportUpgrade" }), "Teleport");
  assert.strictEqual(S.cleSort({ rawDisplayName: "S5_SummonerSmitePlayerGanker" }), "Smite");
  assert.strictEqual(S.cleSort({ rawDisplayName: "Autre" }), null);
  assert.strictEqual(S.cleSort(null), null);
});

test("recharges vérifiées le 10/10/2026 ; bottes de lucidité visibles comptées ; TP déchaînée après 10:00", () => {
  assert.strictEqual(S.rechargeS("Flash"), 300);
  assert.strictEqual(S.rechargeS("Dot"), 180);
  assert.strictEqual(S.rechargeS("Flash", { hate: 10 }), 300 / 1.1);
  assert.strictEqual(S.rechargeS("Teleport", { tempsS: 500 }), 300);
  assert.strictEqual(S.rechargeS("Teleport", { tempsS: 600, niveau: 1 }), 330);
  assert.strictEqual(S.rechargeS("Teleport", { tempsS: 900, niveau: 18 }), 240);
  assert.strictEqual(S.rechargeS("Inconnu"), null);
  assert.strictEqual(S.hateSorts([{ itemID: 3158 }, { itemID: 1, displayName: "Lucidité pourpre" }, null]), 30);
  assert.strictEqual(S.hateSorts(undefined), 0);
});

test("adversaires : seulement l'autre équipe, dans l'ordre des postes, sans aucun pseudo affiché", () => {
  const a = S.adversaires(JEU(100));
  assert.deepStrictEqual(a.map((x) => x.alias), ["MonkeyKing", "Zed", "Jinx"]);
  assert.deepStrictEqual(a[1].sorts.map((s) => s.nom), ["Flash", "Ignite"]);
  assert.strictEqual(a[1].hate, 10);
  assert.deepStrictEqual(S.adversaires({ ...JEU(100), actif: { riotId: "Inconnu" } }), []); // mon équipe inconnue : rien
  assert.deepStrictEqual(S.adversaires(null), []);
});

// --- Suivi et clics ------------------------------------------------------------------------------

const attendre = (ms) => new Promise((ok) => setTimeout(ok, ms));

function suivi({ temps = 600, actif = true } = {}) {
  const etat = { temps, horloge: 0, actif, vus: [] };
  const s = S.creerSuiviSorts({
    reglages: () => ({ sorts: etat.actif }),
    lire: async () => JEU(etat.temps),
    afficher: (p) => etat.vus.push(p),
    maintenant: () => etat.horloge,
    intervalleMs: 5,
  });
  return { s, etat };
}
const flashDe = (panneau, alias) => panneau.find((a) => a.alias === alias).sorts[0];

test("clic : le Flash de Zed (bottes ioniennes) démarre à 273 s ; 2e clic : annulé", async (t) => {
  const { s, etat } = suivi();
  t.after(() => s.arreter()); // même si le test échoue : pas de minuterie oubliée
  s.demarrer();
  await attendre(15);
  const id = flashDe(etat.vus.at(-1), "Zed").id;
  assert.strictEqual(flashDe(etat.vus.at(-1), "Zed").restantS, 0);
  s.clic(id);
  assert.strictEqual(flashDe(etat.vus.at(-1), "Zed").restantS, Math.ceil(300 / 1.1)); // 273 (272,7 arrondi au-dessus)
  etat.horloge = 100000; // 100 s plus tard, avant la lecture suivante : le temps est estimé
  s.clic(id);
  assert.strictEqual(flashDe(etat.vus.at(-1), "Zed").restantS, 0);
  s.arreter();
  assert.strictEqual(etat.vus.at(-1), null);
});

test("clic : le chrono suit le temps de jeu, se termine tout seul, et repart de zéro à la partie suivante", async (t) => {
  const { s, etat } = suivi({ temps: 600 });
  t.after(() => s.arreter()); // même si le test échoue : pas de minuterie oubliée
  s.demarrer();
  await attendre(15);
  const id = flashDe(etat.vus.at(-1), "Jinx").id;
  s.clic(id);
  etat.temps = 750;
  await attendre(15);
  assert.strictEqual(flashDe(etat.vus.at(-1), "Jinx").restantS, 150);
  etat.temps = 901;
  await attendre(15);
  assert.strictEqual(flashDe(etat.vus.at(-1), "Jinx").restantS, 0);
  s.clic(id);
  etat.temps = 10; // nouvelle partie
  await attendre(15);
  assert.strictEqual(flashDe(etat.vus.at(-1), "Jinx").restantS, 0);
  s.arreter();
});

test("case décochée : rien n'est affiché, et un clic ne fait rien", async (t) => {
  const { s, etat } = suivi({ actif: false });
  t.after(() => s.arreter()); // même si le test échoue : pas de minuterie oubliée
  s.demarrer();
  await attendre(15);
  s.clic("Bot#1|0");
  s.arreter();
  assert.deepStrictEqual(etat.vus.filter(Boolean), []);
});

// --- Pings du chat (exception du 16/10/2026) : faux chat, rien n'est lu à l'écran -----------------

test("cibles des pings : nom du champion et des sorts dans la langue du jeu, plus l'anglais et le français", () => {
  const avecNoms = JOUEURS.map((j) =>
    j.rawChampionName.endsWith("MonkeyKing")
      ? { ...j, championName: "Wukong", summonerSpells: { summonerSpellOne: { ...sort("SummonerFlash"), displayName: "Saut éclair" }, summonerSpellTwo: sort("SummonerTeleport") } }
      : j
  );
  const cibles = S.ciblesPings({ ...JEU(100), joueurs: avecNoms });
  assert.deepStrictEqual(cibles[0].noms, ["Wukong", "MonkeyKing"]);
  assert.ok(cibles[0].sorts[0].noms.includes("Saut éclair") && cibles[0].sorts[0].noms.includes("Flash"));
  assert.ok(cibles[0].sorts[1].noms.includes("Unleashed Teleport"));
  assert.deepStrictEqual(cibles[2].noms, ["Jinx"], "sans championName : l'alias");
  assert.deepStrictEqual(S.ciblesPings(null), []);
});

function suiviPings({ pings = true, lignes = [] } = {}) {
  const etat = { temps: 600, horloge: 0, pings, lignes, vus: [], journal: [], erreur: null };
  const s = S.creerSuiviSorts({
    reglages: () => ({ sorts: true, sortsPings: etat.pings }),
    lire: async () => JEU(etat.temps),
    afficher: (p) => etat.vus.push(p),
    maintenant: () => etat.horloge,
    intervalleMs: 5,
    intervalleChatMs: 60000, // les tests lisent le chat à la main (lireChatMaintenant)
    lireChat: async () => {
      if (etat.erreur) throw new Error(etat.erreur);
      return etat.lignes;
    },
    journal: (...m) => etat.journal.push(m.join(" ")),
  });
  return { s, etat };
}

test("ping « Zed Flash » lu dans le chat : le chrono démarre (bottes ioniennes comptées), une seule fois", async (t) => {
  const { s, etat } = suiviPings({ lignes: ["Type /help for a list of commands", "wDark (Ahri): Zed Flash"] });
  t.after(() => s.arreter());
  s.demarrer();
  await attendre(15);
  await s.lireChatMaintenant();
  assert.strictEqual(flashDe(etat.vus.at(-1), "Zed").restantS, Math.ceil(300 / 1.1));
  assert.ok(etat.journal.some((l) => /Ping lu dans le chat : Zed Flash/.test(l)));
  assert.ok(!etat.journal.some((l) => /wDark/.test(l)), "jamais de pseudo dans le journal");
  // Le message reste à l'écran : relu 10 s plus tard, il ne relance rien (le chrono continue)
  etat.horloge = 10000;
  etat.temps = 610; // 10 s de jeu plus tard
  await s.lireChatMaintenant();
  await attendre(15);
  assert.strictEqual(flashDe(etat.vus.at(-1), "Zed").restantS, Math.ceil(300 / 1.1) - 10);
});

test("ping après un clic d'annulation : pas relancé tant que le même message reste à l'écran, même après 30 s", async (t) => {
  const { s, etat } = suiviPings({ lignes: ["wDark (Ahri): Jinx Flash"] });
  t.after(() => s.arreter());
  s.demarrer();
  await attendre(15);
  await s.lireChatMaintenant();
  const id = flashDe(etat.vus.at(-1), "Jinx").id;
  assert.ok(flashDe(etat.vus.at(-1), "Jinx").restantS > 0);
  s.clic(id); // le joueur annule (faux ping)
  assert.strictEqual(flashDe(etat.vus.at(-1), "Jinx").restantS, 0);
  etat.horloge = 5000;
  await s.lireChatMaintenant();
  assert.strictEqual(flashDe(etat.vus.at(-1), "Jinx").restantS, 0, "pas relancé");
  etat.horloge = 35000; // vu en partie le 17/10/2026 : le message était encore là après 30 s, et le chrono repartait
  await s.lireChatMaintenant();
  assert.strictEqual(flashDe(etat.vus.at(-1), "Jinx").restantS, 0, "toujours pas relancé");
  etat.lignes = ["wDark (Ahri): Jinx Flash", "wDark (Ahri): Jinx Flash"]; // un allié pingue de nouveau
  await s.lireChatMaintenant();
  assert.ok(flashDe(etat.vus.at(-1), "Jinx").restantS > 0, "nouveau ping : relancé");
});

test("case des pings décochée, ou rien de reconnu : aucun chrono ne démarre", async (t) => {
  const { s, etat } = suiviPings({ pings: false, lignes: ["wDark (Ahri): Zed Flash"] });
  t.after(() => s.arreter());
  s.demarrer();
  await attendre(15);
  await s.lireChatMaintenant();
  assert.strictEqual(flashDe(etat.vus.at(-1), "Zed").restantS, 0);
  etat.pings = true;
  etat.lignes = ["wDark (Ahri): Wait For Ahri Flash - 200s", "wDark (Ahri): Zed Arcane Comet"];
  await s.lireChatMaintenant();
  assert.strictEqual(flashDe(etat.vus.at(-1), "Zed").restantS, 0);
});

test("erreur de lecture du chat : notée une fois par minute, le panneau continue", async (t) => {
  const { s, etat } = suiviPings();
  t.after(() => s.arreter());
  s.demarrer();
  await attendre(15);
  etat.erreur = "pas d'autorisation";
  await s.lireChatMaintenant();
  await s.lireChatMaintenant();
  assert.strictEqual(etat.journal.filter((l) => /pas d'autorisation/.test(l)).length, 1);
  etat.horloge = 61000;
  await s.lireChatMaintenant();
  assert.strictEqual(etat.journal.filter((l) => /pas d'autorisation/.test(l)).length, 2);
  assert.ok(etat.vus.at(-1), "le panneau est toujours là");
});
