/*
 * Mode Deadlock, onglet Accueil (27/10/2026)
 * ------------------------------------------
 * Ton compte Steam (trouvé sur ce PC), ton temps de jeu (mesuré par l'appli), tes dernières parties (deadlock-api.com)
 (envoyées automatiquement au site par main.js). Tout vient de main.js (deadlock.js) par window.appli : la page ne lit rien
 * elle-même. Ce fichier tient aussi l'état du jeu (lancé ou fermé), dont dépend le passage automatique en mode Deadlock.
 */

const RELECTURE_DEADLOCK_MS = 5 * 60 * 1000; // un onglet Deadlock rouvert dans les 5 min ne redemande rien
let etatDeadlock = { lance: false, compte: null, temps: null, reglages: { rang: null }, dernierEnvoi: null };
let accueilDeadlockLu = 0; // heure de la dernière lecture réussie de tes parties (0 : à relire)
let herosLePlusJoue = null; // ton héros le plus joué : choisi d'office dans l'onglet Build
let buildDeadlockAffiche = null; // héros dont le build est affiché (onglet Build) ; null : rien, ou niveau changé (onglet Héros)

/** Durée en millisecondes -> « 45 min », « 2 h 05 » (texteDuree de calculs.js, qui prend des secondes). */
const texteDureeMs = (ms) => texteDuree(Math.round((Number.isFinite(ms) ? ms : 0) / 1000));

/** Message de main.js (ou réponse de lireDeadlock) : jeu lancé ou fermé, compte, temps de jeu, réglages. */
function afficherEtatDeadlock(etat) {
  if (!etat || typeof etat !== "object") return;
  const avant = etatDeadlock;
  etatDeadlock = etat;

  const c = etat.compte;
  $("deadlockCompte").textContent = c ? `${c.pseudo ? `${c.pseudo} · ` : ""}compte Steam n° ${c.accountId}` : "Aucun compte Steam trouvé sur ce PC : lance Steam et connecte-toi une fois.";
  $("deadlockJeu").textContent = etat.lance ? "● Deadlock est lancé" : "Deadlock est fermé";
  $("deadlockJeu").classList.toggle("actif", etat.lance === true);
  const t = etat.temps || {};
  $("deadlockTempsJour").textContent = texteDureeMs(t.aujourdhui);
  $("deadlockTempsSemaine").textContent = texteDureeMs(t.septJours);
  $("deadlockTempsTotal").textContent = texteDureeMs(t.total);


  if (etat.lance && !avant.lance) changerDeJeu("deadlock"); // le jeu vient d'être lancé : l'appli passe en mode Deadlock
  if (!etat.lance && avant.lance) {
    accueilDeadlockLu = 0; // partie finie : ton historique a pu changer
    if (!$("panneau-deadlock").hidden) chargerAccueilDeadlock();
  }
}

/** Ligne du tableau de tes parties. */
function lignePartieDeadlock(p) {
  const ligne = element("tr");
  const resultat = element("td", p.victoire === null ? null : p.victoire ? "resultat-victoire" : "resultat-defaite", p.victoire === null ? "–" : p.victoire ? "Victoire" : "Défaite");
  const kda = [p.eliminations, p.morts, p.assistances].map((n) => (Number.isFinite(n) ? n : "?")).join(" / ");
  ligne.append(
    element("td", "col-nom", p.nomHeros),
    resultat,
    element("td", "nombre", kda),
    element("td", "nombre", Number.isFinite(p.ames) ? formatNombre(p.ames) : "–"),
    element("td", "nombre", Number.isFinite(p.dureeS) ? texteDuree(p.dureeS) : "–"),
    element("td", null, p.abandon ? `${p.type} (abandon)` : p.type),
    element("td", "nombre", formatDateHeure(p.debut)),
  );
  return ligne;
}

/** Lit et affiche tes parties (au plus une fois toutes les 5 min, sauf forcer). */
async function chargerAccueilDeadlock({ forcer = false } = {}) {
  if (!forcer && Date.now() - accueilDeadlockLu < RELECTURE_DEADLOCK_MS) return;
  accueilDeadlockLu = Date.now();
  afficherEtat("etatDeadlockAccueil", "Chargement…", "info");
  const reponse = await window.appli.lireAccueilDeadlock();
  if (!reponse.ok) {
    accueilDeadlockLu = 0; // on réessaiera à la prochaine ouverture
    afficherEtat("etatDeadlockAccueil", reponse.erreur, "erreur");
    return;
  }
  const r = reponse.resume;
  $("deadlockParties").textContent = r ? formatNombre(r.nombre) : "–";
  $("deadlockVictoires").textContent = r ? formatPourcent(r.tauxVictoire) : "–";
  $("deadlockKda").textContent = r && Number.isFinite(r.kda) ? formatNombre(Math.round(r.kda * 100) / 100) : "–";
  herosLePlusJoue = r && r.parHeros.length > 0 ? r.parHeros[0].heroId : null;
  const lignes = r ? r.dernieres.map(lignePartieDeadlock) : [];
  $("corpsDeadlockParties").replaceChildren(...lignes);
  $("tableDeadlockParties").hidden = lignes.length === 0;
  afficherEtat("etatDeadlockAccueil", reponse.message || "", "info"); // seulement quand il n'y a encore aucune partie
}

/** Enregistre les réglages Deadlock (niveau de l'onglet Héros) -> réglages propres, ou null. */
async function enregistrerReglagesDeadlock(changements, idEtat) {
  const reponse = await window.appli.enregistrerDeadlock({ ...etatDeadlock.reglages, ...changements });
  if (!reponse.ok) {
    afficherEtat(idEtat, reponse.erreur, "erreur");
    return null;
  }
  etatDeadlock = { ...etatDeadlock, reglages: reponse.reglages };
  return reponse.reglages;
}

function brancherDeadlockAccueil() {
  window.appli.surDeadlock(afficherEtatDeadlock);
  document.addEventListener("onglet", (evenement) => {
    if (evenement.detail === "deadlock") chargerAccueilDeadlock();
  });
  $("deadlockActualiser").addEventListener("click", async () => {
    afficherEtatDeadlock(await window.appli.lireDeadlock());
    await chargerAccueilDeadlock({ forcer: true });
  });
}

/** Au démarrage, APRÈS l'ouverture de l'onglet mémorisé : si Deadlock est déjà lancé, l'appli passe en mode Deadlock. */
async function lireEtatDeadlockAuDemarrage() {
  try {
    afficherEtatDeadlock(await window.appli.lireDeadlock());
  } catch {
    // erreur déjà écrite dans le journal par main.js : le reste de l'appli (LoL) démarre quand même
  }
}
