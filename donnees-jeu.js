/*
 * Données du jeu qui changent avec les patchs : UNE seule source (processus principal)
 * ------------------------------------------------------------------------------------
 * Pourquoi (20/10/2026) : ces chiffres étaient recopiés dans plusieurs fichiers (les files Arena dans 3, l'ARAM Mayhem
 * dans 2). Au prochain changement de Riot, il aurait fallu penser à tous. Ici, chaque valeur est écrite une fois, avec
 * la date et la source de sa vérification. À REVÉRIFIER à chaque grosse mise à jour du jeu.
 * La page (src/calculs.js) ne peut pas charger ce fichier : elle garde sa copie des files, et un test
 * (test/donnees-jeu.test.js) vérifie que les deux restent identiques.
 */

const VERIFIE_LE = "20/10/2026";

// Files de jeu (numéros du client ; liste officielle : https://static.developer.riotgames.com/docs/lol/queues.json).
const FILES = {
  // 2400 « ARAM: Mayhem » (vérifié le 30/09/2026)
  mayhem: 2400,
  // Arena : 1700, 1710, et 1750 « Arena 3x6 » (6 équipes de 3, vu dans le client le 20/10/2026)
  arena: [1700, 1710, 1750],
  // Faille de l'invocateur, parties normales et classées : 400 Draft, 420 classée solo, 430 aveugle, 440 flexible,
  // 480 Swiftplay, 490 partie rapide
  faille: [400, 420, 430, 440, 480, 490],
};

// Temps de recharge des sorts d'invocateur, en secondes (vérifiés le 10/10/2026 sur le wiki).
// Téléportation : 300 s, puis « déchaînée » après 10:00 (330 s au niveau 1 -> 240 s au niveau 18 : sorts.js).
const RECHARGES_SORTS = {
  Flash: { nom: "Flash", rechargeS: 300 },
  Dot: { nom: "Ignite", rechargeS: 180 },
  Teleport: { nom: "TP", rechargeS: 300 },
  Heal: { nom: "Heal", rechargeS: 240 },
  Barrier: { nom: "Barrière", rechargeS: 180 },
  Exhaust: { nom: "Exhaust", rechargeS: 240 },
  Haste: { nom: "Ghost", rechargeS: 240 },
  Boost: { nom: "Cleanse", rechargeS: 240 },
  Smite: { nom: "Smite", rechargeS: 90 },
};
const TP_DECHAINEE_DES_S = 10 * 60;

// Accélération des sorts d'invocateur visible par l'adversaire : Bottes ioniennes de lucidité (objet 3158) +10,
// Lucidité pourpre (évolution des bottes) +20. La rune Perspicacité cosmique (+18) est invisible : pas comptée.
const HATE_SORTS = { bottesIoniennes: 3158, hateIoniennes: 10, hateLuciditePourpre: 20 };

// Arena : chaque objet de la Faille existe en version Arena sous le numéro 220000 + son numéro (vérifié le
// 20/10/2026 dans items.json du client : Dent de Nashor 3115 -> 223115). Objets prismatiques : 44xxxx.
const DECALAGE_ARENA = 220000;

module.exports = { VERIFIE_LE, FILES, RECHARGES_SORTS, TP_DECHAINEE_DES_S, HATE_SORTS, DECALAGE_ARENA };
