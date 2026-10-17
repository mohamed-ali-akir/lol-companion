/*
 * Familles de builds : plusieurs sets d'objets pour les champions qui se jouent de plusieurs façons
 * -------------------------------------------------------------------------------------------------
 * Tourne dans le processus principal (Node). Fonctions pures, testées (test/familles.test.js).
 *
 * Exemples : Vi combattant (Force Trinité) ou létalité / critique (Collecteur) ; Kai'Sa à l'impact ou AP ;
 * Kayn rouge (Rhaast) ou bleu (Assassin de l'ombre).
 *
 * D'où viennent les données (décidé le 14/10/2026) : la page Lolalytics du champion contient « itemSets » :
 * les combinaisons des premiers objets réellement construits, avec leur nombre de parties
 * (itemBootSet3 : { "6699_3047_3071": [parties, ...] } ; bottes comprises, dans l'ordre d'achat).
 *
 * Méthode :
 *  1. on enlève les bottes de chaque combinaison ;
 *  2. chaque combinaison est rangée dans une famille d'après son PREMIER objet, celui qui décide du style
 *     (catégories de l'objet dans le client : Santé, Coup critique...). Si ce premier objet est neutre
 *     (ex. Sabre-éclipse), on regarde la famille la plus fréquente parmi ses objets ;
 *     Létalité et Critique ne font qu'une famille (mêmes objets : Collecteur, Cyclosabre...) ;
 *     Kayn est un cas à part : bleu = aucun objet avec de la Santé, rouge = au moins un ;
 *  3. on garde les familles qui pèsent au moins 10 % des builds et 300 parties (3 au plus) ;
 *  4. pour chaque famille, les 3 meilleurs choix de chacun des 3 premiers emplacements, mais seulement
 *     les objets construits dans au moins 200 parties ET 10 % des achats de cet emplacement (comme le reste
 *     de l'onglet Build), classés par nombre de parties.
 *  5. le reste du set vient du build général, sans les objets d'une AUTRE famille du champion (ajouterExclus).
 * S'il ne reste qu'une famille, il n'y a rien à séparer : un seul set, comme avant.
 * Le second nombre de Lolalytics (victoires ?) n'est pas utilisé : il ne correspond pas aux taux de victoire
 * habituels (autour de 40 % pour tous les champions), on ne sait pas encore ce qu'il compte.
 */

const PART_FAMILLE_MIN = 0.1; // une famille doit peser au moins 10 % des builds...
const PARTIES_FAMILLE_MIN = 300; // ... et au moins 300 parties
const FAMILLES_MAX = 3;
const PARTIES_OBJET_MIN = 200; // un objet n'est proposé que s'il a été construit dans au moins 200 parties...
const SELECTION_OBJET_MIN = 0.1; // ... et 10 % des achats de son emplacement
const EMPLACEMENTS = 3; // itemBootSet3 : les 3 premiers objets
const CHOIX_MAX = 3;

const KAYN = { rouge: "Rouge (Rhaast)", bleu: "Bleu (Assassin de l'ombre)" };

/** Famille d'UN objet d'après ses catégories (liste du client), ou null pour un objet neutre ou des bottes. */
function familleObjet(categories) {
  const c = new Set(Array.isArray(categories) ? categories : []);
  if (c.size === 0 || c.has("Boots")) return null;
  // Objets hybrides AD + AP à l'impact (Guinsoo, Statikk) : ce sont des objets à l'impact, pas des objets AP
  // (vu le 17/10/2026 : Kalista « AP » à cause du Poignard de Statikk, Kayle AP mélangé avec Guinsoo).
  if (c.has("SpellDamage")) return c.has("Damage") && c.has("OnHit") ? "À l'impact" : "AP";
  if (c.has("CriticalStrike")) return "Létalité / Critique";
  if (c.has("Health") && !c.has("Damage")) return "Tank";
  if (c.has("Health")) return "Combattant";
  if (c.has("OnHit")) return "À l'impact"; // avant la pénétration : Terminus est un objet à l'impact
  if (c.has("ArmorPenetration")) return "Létalité / Critique";
  if (c.has("AttackSpeed")) return "À l'impact";
  return null;
}

/** Famille d'une combinaison (ids sans bottes) : celle du premier objet, sinon la plus fréquente, sinon "Mixte". */
function familleCombinaison(ids, categoriesObjet) {
  const premiere = familleObjet(categoriesObjet(ids[0]));
  if (premiere) return premiere;
  const familles = ids.map((id) => familleObjet(categoriesObjet(id))).filter(Boolean);
  if (familles.length === 0) return "Mixte";
  const compte = new Map();
  for (const f of familles) compte.set(f, (compte.get(f) || 0) + 1);
  const max = Math.max(...compte.values());
  return familles.find((f) => compte.get(f) === max);
}

/** Kayn : rouge (Rhaast) dès qu'un objet a de la Santé, sinon bleu (Assassin de l'ombre). */
function formeKayn(ids, categoriesObjet) {
  const sante = ids.some((id) => (categoriesObjet(id) || []).includes("Health"));
  return sante ? KAYN.rouge : KAYN.bleu;
}

/**
 * itemSets de Lolalytics -> [{ ids, parties }] : combinaisons sans les bottes, celles qui deviennent identiques
 * une fois les bottes retirées sont additionnées. Lecture tolérante : tout ce qui est abîmé est ignoré.
 */
function combinaisons(itemSets, estBottes) {
  const brutes = itemSets && typeof itemSets === "object" ? itemSets.itemBootSet3 : null;
  if (!brutes || typeof brutes !== "object") return [];
  const parCle = new Map();
  for (const [cle, valeur] of Object.entries(brutes)) {
    const parties = Array.isArray(valeur) ? valeur[0] : null;
    if (!Number.isFinite(parties) || parties <= 0) continue;
    const ids = String(cle).split("_").map(Number).filter((id) => Number.isInteger(id) && id > 0 && !estBottes(id));
    if (ids.length < 2) continue;
    const k = ids.join("_");
    const avant = parCle.get(k);
    if (avant) avant.parties += parties;
    else parCle.set(k, { ids, parties });
  }
  return [...parCle.values()];
}

/**
 * Les choix d'un emplacement pour une famille : [{ ids: [id], parties, selection }], 3 au plus,
 * seulement les objets assez construits (PARTIES_OBJET_MIN et SELECTION_OBJET_MIN), du plus au moins construit.
 */
function choixEmplacement(liste, position) {
  const compte = new Map();
  for (const c of liste) {
    const id = c.ids[position];
    if (id) compte.set(id, (compte.get(id) || 0) + c.parties);
  }
  const total = [...compte.values()].reduce((s, n) => s + n, 0);
  return [...compte]
    .map(([id, parties]) => ({ ids: [id], parties, selection: total > 0 ? parties / total : 0 }))
    .filter((o) => o.parties >= PARTIES_OBJET_MIN && o.selection >= SELECTION_OBJET_MIN)
    .sort((a, b) => b.parties - a.parties)
    .slice(0, CHOIX_MAX);
}

/**
 * Familles de builds d'un champion : [{ nom, part, parties, emplacements: [choix objet 1, 2, 3] }],
 * de la plus à la moins jouée. [] s'il n'y en a qu'une (ou aucune) : rien à séparer.
 *  itemSets       : champ « itemSets » de la page Lolalytics
 *  categoriesObjet: id -> catégories de l'objet dans le client (["Health", "Damage"...]) ou []
 *  alias          : alias du client ("Kayn"...), pour le cas spécial de Kayn
 */
function detecterFamilles({ itemSets, categoriesObjet, alias = "" }) {
  const categories = (id) => categoriesObjet(id) || [];
  const estBottes = (id) => categories(id).includes("Boots");
  const liste = combinaisons(itemSets, estBottes);
  const total = liste.reduce((s, c) => s + c.parties, 0);
  if (total === 0) return [];

  const estKayn = String(alias).toLowerCase() === "kayn";
  const groupes = new Map(); // nom de famille -> combinaisons
  for (const c of liste) {
    const nom = estKayn ? formeKayn(c.ids, categories) : familleCombinaison(c.ids, categories);
    if (!groupes.has(nom)) groupes.set(nom, []);
    groupes.get(nom).push(c);
  }

  const familles = [...groupes]
    .map(([nom, combis]) => {
      const parties = combis.reduce((s, c) => s + c.parties, 0);
      const emplacements = Array.from({ length: EMPLACEMENTS }, (_, i) => choixEmplacement(combis, i));
      return { nom, part: parties / total, parties, emplacements };
    })
    .filter((f) => f.part >= PART_FAMILLE_MIN && f.parties >= PARTIES_FAMILLE_MIN && f.emplacements[0].length > 0)
    .sort((a, b) => b.parties - a.parties)
    .slice(0, FAMILLES_MAX);
  return familles.length >= 2 ? familles : [];
}

/**
 * Objets à NE PAS proposer dans le set d'une famille, parmi ids (les objets du build général : départ, objets 4
 * et 5...) : ceux qui appartiennent à une AUTRE famille de ce champion (ex. Lame d'infini dans le set
 * « Combattant » de Vi). Pour Kayn : pas d'objet avec de la Santé dans le set bleu.
 * Renvoie les familles avec un champ exclus : [id, ...].
 */
function ajouterExclus({ familles, ids, categoriesObjet, alias = "" }) {
  const categories = (id) => categoriesObjet(id) || [];
  const estKayn = String(alias).toLowerCase() === "kayn";
  const noms = new Set(familles.map((f) => f.nom));
  return familles.map((f) => {
    const exclus = [...new Set(ids)].filter((id) => {
      if (estKayn) return f.nom === KAYN.bleu && categories(id).includes("Health");
      const famille = familleObjet(categories(id));
      return famille !== null && famille !== f.nom && noms.has(famille);
    });
    return { ...f, exclus };
  });
}

module.exports = {
  KAYN,
  PART_FAMILLE_MIN,
  PARTIES_FAMILLE_MIN,
  PARTIES_OBJET_MIN,
  SELECTION_OBJET_MIN,
  familleObjet,
  familleCombinaison,
  formeKayn,
  combinaisons,
  choixEmplacement,
  detecterFamilles,
  ajouterExclus,
};
