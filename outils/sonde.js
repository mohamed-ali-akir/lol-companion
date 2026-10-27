/*
 * Sonde des sites lus par l'appli (Lolalytics, OP.GG, arammayhem.com, deadlock-api.com) : node outils/sonde.js
 * -----------------------------------------------------------------------------------------
 * Pourquoi (17/10/2026) : les tests utilisent des copies enregistrées des pages ; ils restent verts même quand le vrai
 * site change. C'est arrivé deux fois en une semaine (arammayhem.com a changé de format, puis retiré ses taux de
 * victoire) et on ne l'a vu qu'en jeu. Cette sonde lit les VRAIS sites avec le code de l'appli et vérifie que les
 * données sont toujours là et plausibles. Lancée chaque jour par GitHub Actions (.github/workflows/sonde.yml), qui
 * ouvre une issue si quelque chose ne va plus.
 * Mêmes règles que l'appli (internet.js : User-Agent honnête) ; seulement des noms de champions publics (Deadlock :
 * l'historique d'un joueur PUBLIC du classement européen, lu puis oublié, jamais celui du propriétaire).
 * Pas livrée dans l'appli (absente de build.files). Code de sortie : 0 si tout va bien, 1 sinon.
 */
const { creerLecteurLolalytics } = require("../lolalytics.js");
const { creerLecteurOpgg } = require("../opgg.js");
const { creerLecteurArammayhem } = require("../arammayhem.js");
const { creerLecteurDeadlock } = require("../deadlock-api.js");
const DS = require("../deadlock-stats.js");

const lolalytics = creerLecteurLolalytics();
const opgg = creerLecteurOpgg();
const arammayhem = creerLecteurArammayhem();
const deadlock = creerLecteurDeadlock();

/** Échoue avec un message clair si la condition est fausse. */
function exiger(condition, message) {
  if (!condition) throw new Error(message);
}

const emplacementsRemplis = (a) => a.emplacements.filter((e) => e.length > 0).length;

const VERIFICATIONS = [
  ["Lolalytics : build Ahri Milieu (objets emplacement par emplacement)", async () => {
    const a = await lolalytics.analyser({ alias: "Ahri", role: "middle", mode: "ranked" });
    exiger(a.stats.parties > 10000, `trop peu de parties : ${a.stats.parties}`);
    exiger(a.depart.length > 0 && a.bottes.length > 0, "départ ou bottes vides");
    exiger(emplacementsRemplis(a) === 5, `${emplacementsRemplis(a)} emplacements d'objets remplis sur 5`);
    return `${a.stats.parties} parties, objet 1 : ${a.emplacements[0][0].ids.join("+")}`;
  }],
  ["Lolalytics : meilleurs joueurs Kayle Haut (set Rank 1, filtre 1trick)", async () => {
    const a = await lolalytics.analyser({ alias: "Kayle", role: "top", mode: "ranked", tier: "1trick" });
    exiger(a.stats.parties > 300, `trop peu de parties : ${a.stats.parties}`);
    exiger(emplacementsRemplis(a) >= 4, `${emplacementsRemplis(a)} emplacements remplis`);
    return `${a.stats.parties} parties`;
  }],
  ["Lolalytics : familles de builds (itemSets) de Kai'Sa", async () => {
    const a = await lolalytics.analyser({ alias: "Kaisa", role: "bottom", mode: "ranked", categoriesObjet: () => ["AttackSpeed"] });
    exiger(Array.isArray(a.familles), "champ itemSets illisible");
    return "itemSets lisibles";
  }],
  ["Lolalytics : build ARAM de Hwei (consultation de l'onglet Build)", async () => {
    const a = await lolalytics.analyser({ alias: "Hwei", role: null, mode: "aram" });
    exiger(a.stats.parties > 1000, `trop peu de parties : ${a.stats.parties}`);
    return `${a.stats.parties} parties`;
  }],
  ["Lolalytics : tier list Milieu (conseiller de draft)", async () => {
    const tl = await lolalytics.tierlist("middle");
    exiger(tl.lignes.size > 50, `${tl.lignes.size} champions seulement`);
    exiger(/^\d+\.\d+$/.test(String(tl.patch)), `patch illisible : ${tl.patch}`);
    return `${tl.lignes.size} champions, patch ${tl.patch}`;
  }],
  ["Lolalytics : matchups de Zed (conseiller de draft)", async () => {
    const m = await lolalytics.matchups({ alias: "Zed", role: "middle" });
    exiger(m.size > 20, `${m.size} matchups seulement`);
    return `${m.size} matchups`;
  }],
  ["Lolalytics : page Arena d'Ahri (augments, objets prismatiques, build)", async () => {
    const r = await lolalytics.arena({ alias: "Ahri" });
    exiger(r.augments.size > 100, `${r.augments.size} augments seulement (format changé ?)`);
    exiger(r.prismatiques.size > 10, `${r.prismatiques.size} objets prismatiques seulement`);
    exiger(Number.isFinite(r.victoireChampion), "taux de victoire moyen du champion absent");
    const b = await lolalytics.analyserArena({ alias: "Ahri" });
    exiger(b.depart.length > 0 && b.prismatique.length > 0 && b.emplacements.every((e) => e.length > 0), "build Arena incomplet");
    return `${r.augments.size} augments, ${r.prismatiques.size} prismatiques, ${b.stats.parties} parties`;
  }],
  ["OP.GG : analyse Ahri Milieu (runes, sorts, objets de secours)", async () => {
    const a = await opgg.analyser({ alias: "Ahri", position: "mid", mode: "ranked" });
    exiger(a.runes && a.sorts, "runes ou sorts absents");
    exiger(a.principaux || a.quatrieme.length > 0, "objets absents");
    return `${a.stats.parties} parties`;
  }],
  ["arammayhem.com : augments d'Ahri et de tous les champions", async () => {
    const r = await arammayhem.augments({ alias: "Ahri" });
    exiger(r.global.length > 100, `${r.global.length} augments seulement (format changé ?)`);
    exiger(r.champion.length >= 6, `${r.champion.length} augments pour Ahri seulement`);
    const sansChoix = r.global.filter((a) => !Number.isFinite(a.apparition)).length;
    exiger(sansChoix === 0, `${sansChoix} augments sans taux de choix`);
    return `${r.champion.length} augments d'Ahri, ${r.global.length} au total`;
  }],
  ["deadlock-api.com : héros, objets et tier list (mode Deadlock, onglet Héros)", async () => {
    const heros = await deadlock.heros();
    exiger(heros.size >= 30, `${heros.size} héros jouables seulement (format changé ?)`);
    exiger([...heros.values()].some((h) => h.nom === "Infernus"), "Infernus absent de la liste des héros");
    const objets = await deadlock.objets();
    exiger(objets.size >= 100 && [...objets.values()].every((o) => o.emplacement), `${objets.size} objets, ou emplacements illisibles`);
    const tl = DS.tierListe(await deadlock.statsHeros(), heros);
    exiger(tl.length >= 30, `${tl.length} héros dans la tier list`);
    return `${heros.size} héros, ${objets.size} objets, meilleur du moment : ${tl[0].nom}`;
  }],
  ["deadlock-api.com : build et contres d'Infernus (onglet Build)", async () => {
    const heros = await deadlock.heros();
    const infernus = [...heros.values()].find((h) => h.nom === "Infernus");
    const b = DS.buildDuHeros(await deadlock.statsObjets(infernus.id), await deadlock.objets());
    exiger(b.phases.every((p) => p.objets.length >= 2), `phases : ${b.phases.map((p) => p.objets.length).join(", ")} objets`);
    const c = DS.contresDuHeros(await deadlock.duels(), infernus.id, heros);
    exiger(c.difficiles.length > 0 && c.faciles.length > 0, "contres vides");
    return `${b.parties} parties, ${b.phases.map((p) => p.objets.length).join("/")} objets par période`;
  }],
  ["deadlock-api.com : historique d'un joueur public du classement (onglet Accueil)", async () => {
    const reponse = await fetch("https://api.deadlock-api.com/v1/leaderboard/Europe", { headers: { "User-Agent": require("../internet.js").IDENTITE } });
    exiger(reponse.ok, `classement : code ${reponse.status}`);
    const comptes = ((await reponse.json()).entries || []).slice(0, 5).flatMap((e) => e.possible_account_ids || []).slice(0, 6);
    for (const id of comptes) {
      const parties = await deadlock.historique(id);
      if (parties.length === 0) continue;
      const r = DS.resumeParties(parties);
      exiger(r.tauxVictoire !== null && r.kda !== null, "victoires ou KDA illisibles");
      return `${r.nombre} parties lues pour un joueur du classement`;
    }
    throw new Error("aucun historique lisible chez les 5 premiers du classement");
  }],
];

(async () => {
  let echecs = 0;
  for (const [nom, verifier] of VERIFICATIONS) {
    try {
      console.log(`OK     ${nom} : ${await verifier()}`);
    } catch (erreur) {
      echecs++;
      console.log(`ÉCHEC  ${nom} : ${erreur.message}`);
    }
  }
  console.log(echecs === 0 ? "\nToutes les sources répondent comme prévu." : `\n${echecs} source(s) à vérifier : l'appli risque d'afficher « indisponible ».`);
  process.exitCode = echecs === 0 ? 0 : 1;
})();
