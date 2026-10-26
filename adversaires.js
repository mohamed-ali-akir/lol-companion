/*
 * Build adapté à l'équipe adverse (demandé le 26/10/2026)
 * --------------------------------------------------------
 * Tourne dans le processus principal (Node). Fonctions pures, testées (test/adversaires.test.js).
 * Idée reprise du « Build Picker » de Mino (its-mino.com) : il note chaque ennemi (tank ou fragile) et choisit le
 * build en fonction. Ici, sans rien demander à Internet : le profil de chaque champion est dans le client
 * (/lol-game-data/assets/v1/champions/<id>.json, vu le 26/10/2026) :
 *   playstyleInfo.durability (résistance, 1 à 3), playstyleInfo.crowdControl (contrôles, 1 à 3),
 *   tacticalInfo.damageType (« kPhysical », « kMagic » ou « kMixed »).
 *
 * Règles (seulement avec au moins 3 ennemis verrouillés, sinon on ne sait pas assez) :
 *  - bottes : 3 ennemis à dégâts magiques ou plus, ou 3 gros contrôles ou plus -> Sandales de Mercure ;
 *    sinon 3 ennemis physiques ou plus (et au plus 1 magique) -> Coques en acier ;
 *  - 2 tanks ou plus (résistance 3) -> un objet anti-tank remonte en objet 3, 4 ou 5 (deux objets s'il y a 3 tanks) ;
 *    si le build en a déjà assez, rien ne change.
 * Garde-fou : on ne prend QUE des objets que les joueurs de ce champion achètent vraiment à cet emplacement
 * (options de Lolalytics, au moins PARTIES_MIN parties) : jamais un objet qui n'irait pas au champion.
 * Chaque changement a sa raison, écrite dans l'onglet Build et dans le titre du bloc de la boutique.
 */
const { OBJETS_CONTRE, DECALAGE_ARENA } = require("./donnees-jeu.js");

const ENNEMIS_MIN = 3; // en dessous, l'équipe adverse est trop peu connue pour adapter le build
const PARTIES_MIN = 200; // même seuil que build.js : un objet acheté sur moins de parties n'est pas proposé
const TANKS_POUR_UN = 2; // 2 tanks : un objet anti-tank ; 3 tanks ou plus : deux
const DEGATS_MIN = 3; // 3 ennemis du même type de dégâts (ou 3 gros contrôles) : bottes adaptées
const EMPLACEMENTS_ANTI_TANK = ["objet3", "objet4", "objet5"]; // le 1er et le 2e objet restent ceux du build

const antiTank = new Set(OBJETS_CONTRE.antiTank);
// Les objets d'Arena ont le numéro 220000 + celui de la Faille (donnees-jeu.js) : on compare les numéros de la Faille.
const idFaille = (id) => (id >= DECALAGE_ARENA && id < DECALAGE_ARENA + 10000 ? id - DECALAGE_ARENA : id);
const estDans = (liste) => (o) => Boolean(o) && Array.isArray(o.ids) && o.ids.length > 0 && o.ids.every((id) => liste.has(idFaille(id)));
const nomOption = (o) => (Array.isArray(o.noms) && o.noms.length > 0 ? o.noms.join(" + ") : `objet ${o.ids.join(" + ")}`);

/** Fiche d'un champion du client -> { id, nom, resistance, controle, degats } (degats : "physiques", "magiques", "mixtes"), ou null. */
function profilChampion(fiche) {
  if (!fiche || !Number.isInteger(fiche.id) || fiche.id <= 0) return null;
  const style = fiche.playstyleInfo || {};
  const type = (fiche.tacticalInfo || {}).damageType;
  const entre1et3 = (n) => (Number.isInteger(n) && n >= 1 && n <= 3 ? n : null);
  return {
    id: fiche.id,
    nom: typeof fiche.name === "string" && fiche.name ? fiche.name : `Champion n° ${fiche.id}`,
    resistance: entre1et3(style.durability),
    controle: entre1et3(style.crowdControl),
    degats: type === "kPhysical" ? "physiques" : type === "kMagic" ? "magiques" : type === "kMixed" ? "mixtes" : null,
  };
}

/** Profils des ennemis -> { nombre, tanks, controles, physiques, magiques } (listes de noms). */
function profilEquipe(profils) {
  const liste = (Array.isArray(profils) ? profils : []).filter(Boolean);
  const noms = (garder) => liste.filter(garder).map((p) => p.nom);
  return {
    nombre: liste.length,
    tanks: noms((p) => p.resistance === 3),
    controles: noms((p) => p.controle === 3),
    physiques: noms((p) => p.degats === "physiques"),
    magiques: noms((p) => p.degats === "magiques"),
  };
}

/** Remplace l'option retenue d'une étape : l'ancienne passe en tête des autres choix. */
function remplacer(etape, option, adaptation, raison) {
  const autres = [etape.option, ...etape.autres.filter((o) => o !== option)].slice(0, 2); // 3 choix par emplacement, comme build.js
  return { ...etape, option, autres, fiable: true, adaptation, note: `Adapté à l'équipe adverse : ${raison}, au lieu de ${nomOption(etape.option)}.` };
}

/** Options d'une étape qu'on peut retenir : achetées sur assez de parties, de la plus à la moins achetée. */
function possibles(etape) {
  const toutes = [etape.option, ...etape.autres, ...(Array.isArray(etape.candidats) ? etape.candidats : [])].filter(Boolean);
  return [...new Set(toutes)].filter((o) => o.parties >= PARTIES_MIN).sort((a, b) => b.parties - a.parties);
}

/**
 * Étapes du build (composerParEmplacement de build.js) + équipe adverse (profilEquipe) ->
 * { etapes, raisons } : les étapes adaptées (champ adaptation et note sur celles qui changent) et la liste des
 * changements expliqués. Rien ne change (raisons vide) si l'équipe est trop peu connue ou si le build convient déjà.
 */
function adapterEtapes(etapes, equipe) {
  const liste = Array.isArray(etapes) ? etapes : [];
  if (!equipe || equipe.nombre < ENNEMIS_MIN || liste.length === 0) return { etapes: liste, raisons: [] };
  let resultat = [...liste];
  const raisons = [];

  // Bottes
  const iBottes = resultat.findIndex((e) => e.cle === "bottes");
  if (iBottes >= 0) {
    let voulues = null;
    let raison = null;
    let court = null;
    if (equipe.magiques.length >= DEGATS_MIN) {
      voulues = new Set(OBJETS_CONTRE.bottesMagie);
      raison = `${equipe.magiques.length} ennemis à dégâts magiques (${equipe.magiques.join(", ")})`;
      court = `contre ${equipe.magiques.length} magiques`;
    } else if (equipe.controles.length >= DEGATS_MIN) {
      voulues = new Set(OBJETS_CONTRE.bottesMagie);
      raison = `${equipe.controles.length} ennemis à gros contrôles (${equipe.controles.join(", ")})`;
      court = `contre ${equipe.controles.length} gros contrôles`;
    } else if (equipe.physiques.length >= DEGATS_MIN && equipe.magiques.length <= 1) {
      voulues = new Set(OBJETS_CONTRE.bottesPhysique);
      raison = `${equipe.physiques.length} ennemis à dégâts physiques (${equipe.physiques.join(", ")})`;
      court = `contre ${equipe.physiques.length} physiques`;
    }
    const etape = resultat[iBottes];
    if (voulues && !estDans(voulues)(etape.option)) {
      const choix = possibles(etape).find(estDans(voulues));
      if (choix) {
        resultat[iBottes] = remplacer(etape, choix, court, raison);
        raisons.push(`Bottes : ${nomOption(choix)}, contre ${raison}`);
      }
    }
  }

  // Objets anti-tank
  if (equipe.tanks.length >= TANKS_POUR_UN) {
    const voulus = equipe.tanks.length > TANKS_POUR_UN ? 2 : 1;
    const dansLeBuild = () => new Set(resultat.flatMap((e) => (e.cle === "depart" ? [] : e.option.ids)));
    let deja = resultat.filter((e) => /^objet\d$/.test(e.cle) && estDans(antiTank)(e.option)).length;
    for (const cle of EMPLACEMENTS_ANTI_TANK) {
      if (deja >= voulus) break;
      const i = resultat.findIndex((e) => e.cle === cle);
      if (i < 0 || estDans(antiTank)(resultat[i].option)) continue;
      const pris = dansLeBuild();
      const choix = possibles(resultat[i]).find((o) => estDans(antiTank)(o) && !o.ids.some((id) => pris.has(id)));
      if (!choix) continue;
      const raison = `${equipe.tanks.length} tanks en face (${equipe.tanks.join(", ")})`;
      raisons.push(`${resultat[i].titre} : ${nomOption(choix)}, contre ${raison}`);
      resultat[i] = remplacer(resultat[i], choix, `contre ${equipe.tanks.length} tanks`, raison);
      deja++;
    }
  }
  return { etapes: resultat, raisons };
}

module.exports = { ENNEMIS_MIN, PARTIES_MIN, profilChampion, profilEquipe, adapterEtapes };
