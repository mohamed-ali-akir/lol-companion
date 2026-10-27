/*
 * Mode Deadlock : le service du processus principal (27/10/2026)
 * ----------------------------------------------------------------
 * Tourne dans le processus principal (Node). Relie les morceaux, chacun testé à part :
 *   deadlock-jeu.js     sur ce PC : jeu lancé ?, compte Steam, parties du cache de Steam (aucun Internet) ;
 *   deadlock-donnees.js deadlock.json : tes sessions de jeu, les parties déjà envoyées ;
 *   deadlock-api.js     deadlock-api.com : ton historique, les stats des héros et des objets ;
 *   deadlock-stats.js   les calculs (fonctions pures).
 * main.js ne fait que le brancher (messages de la page, prévenir la page quand le jeu démarre ou s'arrête).
 * Testé sans Deadlock ni Internet (test/deadlock.test.js) : tout ce qui touche au PC ou au réseau est donné en paramètre.
 *
 * Ce que le mode Deadlock ne fait jamais (CLAUDE.md) : lire la mémoire du jeu, s'afficher par-dessus, modifier un
 * fichier du jeu, envoyer quoi que ce soit sans la case (sauf ton numéro de compte, pour lire TON historique).
 */
const J = require("./deadlock-jeu.js");
const S = require("./deadlock-stats.js");
const { JOURS_TIER_LISTE, JOURS_BUILD } = require("./deadlock-api.js");

/**
 * Réglages du mode Deadlock (config.json, clé « deadlock »), toujours valides :
 *  - envoyerParties : envoyer à deadlock-api.com les parties trouvées dans le cache de Steam (désactivé par défaut) ;
 *  - rang : niveau minimal des parties pour les stats des héros et le build (0 à 11 ; null = tous les niveaux).
 */
function normaliserReglagesDeadlock(brut) {
  const r = brut && typeof brut === "object" ? brut : {};
  return {
    envoyerParties: r.envoyerParties === true,
    rang: Number.isInteger(r.rang) && r.rang >= 1 && r.rang <= 11 ? r.rang : null,
  };
}

const MESSAGE_AUCUNE_PARTIE =
  "deadlock-api.com ne connaît encore aucune de tes parties. Coche « Envoyer mes parties » ci-dessous, puis ouvre tes " +
  "parties dans l'historique du jeu (Profil → Historique) : Steam garde leur adresse, et l'appli les envoie quand tu " +
  "fermes Deadlock. Les parties jouées avec des joueurs qui utilisent l'outil du site apparaissent aussi toutes seules.";

/**
 * lecteur : creerLecteurDeadlock (deadlock-api.js) ; donnees : creerDonneesDeadlock (deadlock-donnees.js) ;
 * reglages() / enregistrerReglages(r) : config.json ; jeu : fonctions de deadlock-jeu.js (modifiables pour les tests) ;
 * surEtat(etat) : appelé quand l'état change (jeu lancé ou fermé, parties envoyées) ; journal(...) : journal.txt.
 */
function creerDeadlock({ lecteur, donnees, reglages, enregistrerReglages, jeu = J, maintenant = Date.now, intervalleMs = 5000, journal = () => {}, surEtat = () => {} }) {
  let compte; // compte Steam de ce PC (undefined : pas encore lu ; null : aucun)
  let suivi = null;
  let dernierEnvoi = null; // { date, envoyees, erreur } du dernier envoi des parties du cache
  let envoiEnCours = null;

  const reglagesPropres = () => normaliserReglagesDeadlock(reglages());

  async function compteDuPc({ relire = false } = {}) {
    if (relire || compte === undefined) {
      try {
        compte = await jeu.compteSteam();
      } catch (erreur) {
        journal("Deadlock : compte Steam illisible", erreur.message);
        compte = null;
      }
    }
    return compte;
  }

  /** État pour la page : { lance, compte, temps, reglages, dernierEnvoi }. */
  async function etat() {
    const s = suivi ? suivi.etat() : { lance: false, debut: null };
    const c = await compteDuPc();
    return {
      lance: s.lance,
      compte: c ? { accountId: c.accountId, pseudo: c.pseudo || null } : null,
      temps: S.tempsDeJeu(donnees.sessions(), s.debut, maintenant()),
      reglages: reglagesPropres(),
      dernierEnvoi,
    };
  }

  const publier = async () => surEtat(await etat());

  /** Accueil Deadlock : { compte, resume, message } (resume : resumeParties de deadlock-stats.js). */
  async function accueil() {
    const c = await compteDuPc();
    if (!c) return { compte: null, resume: null, message: "Aucun compte Steam trouvé sur ce PC : lance Steam et connecte-toi une fois." };
    const [heros, parties] = await Promise.all([lecteur.heros(), lecteur.historique(c.accountId)]);
    const resume = S.resumeParties(parties, heros);
    return { compte: { accountId: c.accountId, pseudo: c.pseudo || null }, resume, message: resume.nombre === 0 ? MESSAGE_AUCUNE_PARTIE : null };
  }

  /** Héros : { tierListe, mesHeros, rangs, rang, periodeJours }. Tes stats manquantes ne bloquent pas la tier list. */
  async function heros() {
    const { rang } = reglagesPropres();
    const c = await compteDuPc();
    const [liste, stats, rangs, mes] = await Promise.all([
      lecteur.heros(),
      lecteur.statsHeros({ rang }),
      lecteur.rangs(),
      c ? lecteur.mesStatsHeros(c.accountId).catch(() => null) : Promise.resolve(null),
    ]);
    return { tierListe: S.tierListe(stats, liste), mesHeros: mes ? S.mesStatsParHeros(mes, liste) : [], rangs, rang, periodeJours: JOURS_TIER_LISTE };
  }

  /** Liste des héros jouables pour le choix de l'onglet Build : [{ id, nom }] par ordre alphabétique. */
  async function listeHeros() {
    return [...(await lecteur.heros()).values()].sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
  }

  /** Build d'un héros : { heros, build, contres, periodeJours, rang }. */
  async function build(heroId) {
    const id = Number(heroId);
    const { rang } = reglagesPropres();
    const [liste, objets, items, herosStats, duels] = await Promise.all([
      lecteur.heros(),
      lecteur.objets(),
      lecteur.statsObjets(id, { rang }),
      lecteur.statsHerosBuild({ rang }),
      lecteur.duels({ rang }),
    ]);
    const fiche = liste.get(id) || { id, nom: `Héros n° ${id}` };
    const total = S.tierListe(herosStats, liste, { partiesMin: 1 }).find((h) => h.heroId === id);
    return {
      heros: fiche,
      build: S.buildDuHeros(items, objets, { partiesHeros: total ? total.parties : null }),
      contres: S.contresDuHeros(duels, id, liste),
      periodeJours: JOURS_BUILD,
      rang,
    };
  }

  /**
   * Envoie à deadlock-api.com les parties du cache de Steam pas encore envoyées (case cochée seulement).
   * Un seul envoi à la fois ; le résultat est gardé dans dernierEnvoi et écrit dans le journal.
   */
  function envoyerNouvellesParties() {
    if (!reglagesPropres().envoyerParties) return Promise.resolve(null);
    if (envoiEnCours) return envoiEnCours;
    envoiEnCours = (async () => {
      try {
        const trouvees = await jeu.partiesDuCache(jeu.dossierCacheSteam(await jeu.dossierSteam()));
        const deja = donnees.partiesEnvoyees();
        const nouvelles = trouvees.filter((c) => !deja.has(c.match_id));
        if (nouvelles.length > 0) {
          await lecteur.envoyerParties(nouvelles);
          donnees.noterEnvoyees(nouvelles.map((c) => c.match_id));
        }
        dernierEnvoi = { date: maintenant(), envoyees: nouvelles.length, erreur: null };
      } catch (erreur) {
        dernierEnvoi = { date: maintenant(), envoyees: 0, erreur: erreur.message };
      }
      journal("Deadlock : parties du cache de Steam", dernierEnvoi);
      return dernierEnvoi;
    })().finally(() => {
      envoiEnCours = null;
    });
    return envoiEnCours;
  }

  /** Enregistre les réglages ; la case « Envoyer mes parties » cochée envoie tout de suite ce qui est déjà dans le cache. */
  function enregistrer(brut) {
    const avant = reglagesPropres();
    const propres = normaliserReglagesDeadlock(brut);
    enregistrerReglages(propres);
    if (propres.envoyerParties && !avant.envoyerParties) envoyerNouvellesParties().then(publier, () => {});
    return propres;
  }

  /** Surveille le lancement et la fermeture du jeu (toutes les 5 s). */
  function demarrer() {
    if (suivi) return;
    suivi = J.creerSuiviDeadlock({
      estLance: () => jeu.deadlockLance(),
      intervalleMs,
      maintenant,
      surLancement: async () => {
        journal("Deadlock lancé");
        await compteDuPc({ relire: true }); // un autre compte Steam a pu se connecter
        await publier();
      },
      surFermeture: async (session) => {
        journal("Deadlock fermé", `${Math.round((session.fin - session.debut) / 60000)} min`);
        donnees.ajouterSession(session);
        await publier();
        if (await envoyerNouvellesParties()) await publier();
      },
      aErreur: (erreur) => journal("Deadlock : erreur de la surveillance", erreur.message),
    });
    suivi.demarrer();
  }

  function arreter() {
    if (suivi) suivi.arreter();
  }

  /** Pour les tests : une vérification tout de suite (sinon toutes les intervalleMs). */
  const verifier = () => (suivi ? suivi.verifier() : Promise.resolve());

  return { demarrer, arreter, verifier, etat, accueil, heros, listeHeros, build, enregistrer, envoyerNouvellesParties };
}

module.exports = { MESSAGE_AUCUNE_PARTIE, normaliserReglagesDeadlock, creerDeadlock };
