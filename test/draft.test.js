// Tests du conseiller de draft : picks verrouillés visibles, confort, classement, suivi de la sélection (sans Internet).
const test = require("node:test");
const assert = require("node:assert");
const D = require("../draft.js");

const proche = (a, b) => Math.abs(a - b) < 1e-6; // 1e9 parties : atténuation quasi nulle, mais pas exactement

/** Session de sélection minimale : moi (cellule 2, milieu), 2 alliés, 2 adversaires. */
function session({ actions = [], role = "middle", bans = [] } = {}) {
  return {
    gameId: 1,
    localPlayerCellId: 2,
    myTeam: [
      { cellId: 0, assignedPosition: "top", championId: 0 },
      { cellId: 1, assignedPosition: "utility", championId: 0 },
      { cellId: 2, assignedPosition: role, championId: 0 },
    ],
    theirTeam: [{ cellId: 5, championId: 0 }, { cellId: 6, championId: 0 }],
    actions: [actions],
    bans: { myTeamBans: bans, theirTeamBans: [] },
    timer: { phase: "BAN_PICK" },
  };
}
const pick = (actorCellId, championId, completed = true) => ({ id: actorCellId + 100, actorCellId, championId, type: "pick", completed });

test("picks visibles : seulement les picks verrouillés, alliés avec leur poste, sans moi", () => {
  const s = session({
    actions: [pick(1, 89), pick(0, 24, false), pick(5, 238), pick(6, 157), pick(2, 103), { type: "ban", completed: true, championId: 7, actorCellId: 5 }],
  });
  assert.deepStrictEqual(D.picksVerrouilles(s), { allies: [{ id: 89, role: "utility" }], adversaires: [238, 157] });
  assert.deepStrictEqual(D.picksVerrouilles(null), { allies: [], adversaires: [] });
  assert.deepStrictEqual(D.picksVerrouilles({ actions: "?" }), { allies: [], adversaires: [] });
});

test("confort : borné à ± 2 points, lissé (une partie compte peu), parties ARAM ignorées", () => {
  const parties = [
    ...Array.from({ length: 30 }, () => ({ championId: 1, victoire: true, file: 420 })),
    { championId: 2, victoire: false, file: 420 },
    ...Array.from({ length: 30 }, () => ({ championId: 3, victoire: false, file: 420 })),
    ...Array.from({ length: 10 }, () => ({ championId: 4, victoire: true, file: 450 })), // ARAM
    { championId: "x", victoire: true },
  ];
  const c = D.confortParChampion(parties);
  assert.strictEqual(c.get(1), D.CONFORT_MAX);
  assert.strictEqual(c.get(3), -D.CONFORT_MAX);
  assert.ok(Math.abs(c.get(2)) < 0.005); // une seule défaite : presque rien
  assert.strictEqual(c.has(4), false);
  assert.strictEqual(D.confortParChampion(undefined).size, 0);
});

test("classement : base + matchups (vus de l'adversaire, donc inversés) + synergies, atténués selon les parties", () => {
  const base = new Map([
    [10, { tauxVictoire: 0.52, parties: 1e12 }], // 1e12 : taux de base gardé tel quel
    [20, { tauxVictoire: 0.51, parties: 1e12 }],
    [30, { tauxVictoire: 0.6, parties: 200 }], // trop peu de parties à ce poste : jamais proposé
  ]);
  const adversaires = [{ id: 238, table: new Map([[10, { delta: 0.03, parties: 1000 }], [20, { delta: -0.02, parties: 1e9 }]]) }];
  const allies = [{ id: 89, table: new Map([[20, { delta: 0.005, parties: 1e9 }]]) }];
  const p = D.conseillerDraft({ base, candidats: [10, 20, 30, 99], adversaires, allies });
  assert.deepStrictEqual(p.map((x) => x.id), [20, 10]);
  // 20 : 51 % + 2 (Zed perd contre lui) + 0,5 (synergie) ≈ 53,5 %
  assert.ok(Math.abs(p[0].score - 0.535) < 1e-6);
  assert.deepStrictEqual(p[0].raisons.map((r) => [r.type, r.id]), [["contre", 238], ["avec", 89]]);
  // 10 : 52 % − 3 × 1000 / 2000 = 50,5 %
  assert.ok(proche(p[1].score, 0.505));
  assert.ok(proche(p[1].raisons[0].effet, -0.015));
});

test("classement : un champion peu joué à ce poste est ramené vers 50 % (vrais chiffres du 04/10/2026)", () => {
  const base = new Map([
    [9, { tauxVictoire: 0.5407, parties: 1670 }], // Fiddlesticks milieu, surtout des spécialistes
    [103, { tauxVictoire: 0.5245, parties: 199182 }], // Ahri
  ]);
  const p = D.conseillerDraft({ base, candidats: [9, 103] });
  assert.deepStrictEqual(p.map((x) => x.id), [103, 9]);
  assert.ok(Math.abs(p[1].score - 0.5102) < 0.0005);
  assert.strictEqual(p[1].base, 0.5407); // le vrai taux reste affiché dans l'infobulle
});

test("classement : confort pris en compte, effets minuscules non affichés, 5 propositions au plus", () => {
  const base = new Map(Array.from({ length: 8 }, (_, i) => [i + 1, { tauxVictoire: 0.5 + i / 1000, parties: 5000 }]));
  const p = D.conseillerDraft({ base, candidats: [...base.keys()], confort: new Map([[1, 0.02]]) });
  assert.strictEqual(p.length, 5);
  assert.strictEqual(p[0].id, 1);
  assert.deepStrictEqual(p[0].raisons, [{ type: "confort", id: 1, effet: 0.02 }]);
  const tiny = D.conseillerDraft({ base, candidats: [8], adversaires: [{ id: 5, table: new Map([[8, { delta: 0.0005, parties: 1e6 }]]) }] });
  assert.deepStrictEqual(tiny[0].raisons, []);
  assert.deepStrictEqual(D.conseillerDraft({ base: null, candidats: [1] }), []);
});

// --- Suivi de la sélection (faux lecteur Lolalytics) ----------------------------------------------

function fauxConseiller({ actif = true, echecs = new Set(), jouables = new Set([10, 20]) } = {}) {
  const envois = [];
  const demandes = [];
  const lecteur = {
    tierlist: async (role) => {
      demandes.push(["tierlist", role]);
      if (echecs.has("tierlist")) throw new Error("Lolalytics ne répond pas (pas d'Internet ?).");
      return { patch: "16.19", lignes: new Map([[10, { tauxVictoire: 0.52, parties: 1e12 }], [20, { tauxVictoire: 0.51, parties: 1e12 }], [238, { tauxVictoire: 0.5, parties: 1e12 }]]) };
    },
    matchups: async ({ alias, role }) => {
      demandes.push(["matchups", alias, role]);
      if (echecs.has(alias)) throw new Error("page changée");
      return new Map([[20, { delta: -0.05, parties: 1e9 }]]);
    },
    synergies: async ({ alias, roleAllie, role, patch }) => {
      demandes.push(["synergies", alias, roleAllie, role, patch]);
      return new Map();
    },
  };
  const conseiller = D.creerConseillerDraft({
    actif: () => actif,
    lecteur,
    alias: async () => new Map([[238, "Zed"], [89, "Leona"], [157, "Yasuo"]]),
    jouables: async () => jouables,
    envoyer: (e) => envois.push(e),
  });
  return { conseiller, envois, demandes };
}

test("suivi : calcul à chaque nouveau pick verrouillé, pas de recalcul si rien ne change, effacé à la fin", async () => {
  const { conseiller, envois, demandes } = fauxConseiller();
  await conseiller.surSession(session());
  assert.deepStrictEqual(envois.map((e) => e.etat), ["calcul", "pret"]);
  assert.deepStrictEqual(envois[1].propositions.map((p) => p.id), [10, 20]); // 238 : pas jouable
  await conseiller.surSession(session()); // même draft : rien
  assert.strictEqual(envois.length, 2);
  await conseiller.surSession(session({ actions: [pick(5, 238), pick(1, 89)] }));
  assert.deepStrictEqual(envois.at(-1).propositions.map((p) => p.id), [20, 10]); // Zed verrouillé : 20 passe devant
  assert.ok(proche(envois.at(-1).propositions[0].score, 0.56)); // 51 % + 5 points contre Zed
  assert.deepStrictEqual(demandes.filter((d) => d[0] !== "tierlist"), [["matchups", "Zed", "middle"], ["synergies", "Leona", "utility", "middle", "16.19"]]);
  conseiller.surSession(null);
  assert.strictEqual(envois.at(-1), null);
});

test("suivi : champion banni ou pris jamais proposé ; adversaire sans données signalé ; erreur claire", async () => {
  const a = fauxConseiller({ echecs: new Set(["Yasuo"]) });
  await a.conseiller.surSession(session({ actions: [pick(6, 157)], bans: [10] }));
  const pret = a.envois.at(-1);
  assert.deepStrictEqual(pret.propositions.map((p) => p.id), [20]);
  assert.deepStrictEqual(pret.manquants, [157]);

  const b = fauxConseiller({ echecs: new Set(["tierlist"]) });
  await b.conseiller.surSession(session());
  assert.strictEqual(b.envois.at(-1).etat, "erreur");
  assert.match(b.envois.at(-1).message, /Internet/);
});

test("suivi : désactivé -> rien ; mode sans poste -> message ; jamais d'appel à Lolalytics sans poste", async () => {
  const off = fauxConseiller({ actif: false });
  await off.conseiller.surSession(session());
  assert.deepStrictEqual(off.envois, []);
  const aram = fauxConseiller();
  await aram.conseiller.surSession(session({ role: "" }));
  assert.strictEqual(aram.envois.at(-1).etat, "indisponible");
  assert.deepStrictEqual(aram.demandes, []);
});

test("suivi : un ancien calcul plus lent n'écrase pas le nouveau", async () => {
  const { conseiller, envois } = fauxConseiller();
  const lent = conseiller.surSession(session());
  const rapide = conseiller.surSession(session({ bans: [20] }));
  await Promise.all([lent, rapide]);
  const prets = envois.filter((e) => e && e.etat === "pret");
  assert.strictEqual(prets.length, 1);
  assert.deepStrictEqual(prets[0].propositions.map((p) => p.id), [10]);
});
