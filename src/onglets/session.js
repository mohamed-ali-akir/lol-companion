/*
 * Bilan de session (carte principale de l'Accueil) et ses réglages (onglet Paramètres)
 * ----------------------------------------------------------------------------------
 * Session = tes parties depuis ta première partie du jour (ou depuis l'ouverture de l'appli, au choix).
 * Affiche : parties, victoires / défaites, XP gagnée (estimée), temps de jeu, meilleur champion.
 * Alertes douces : pause proposée après plusieurs défaites d'affilée, rappel du temps de jeu
 * (désactivé par défaut), et la notif « diable » après une série de victoires (désactivée par défaut). Jamais de blocage. La notification Windows est envoyée par main.js
 * (session.js), seulement si l'option est cochée.
 * Les parties viennent de l'onglet Stats (partiesStats, relues après chaque partie) ;
 * les calculs sont dans calculs.js. Utilise iconeChampion() et texteKda() de onglets/stats.js.
 */

let reglagesSession = normaliserReglagesSession({}); // remplacés par ceux de main.js au démarrage
let lancementAppli = Date.now(); // remplacé par l'heure d'ouverture donnée par main.js
const alertesFermees = new Set(); // alertes que tu as fermées (bouton "OK")

const heureDe = (date) => new Date(date).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

function texteDebutSession(bilan) {
  if (reglagesSession.mode === "ouverture") return `Depuis l'ouverture de l'appli, à ${heureDe(lancementAppli)}.`;
  if (!bilan) return "Aujourd'hui.";
  const minuit = new Date();
  minuit.setHours(0, 0, 0, 0);
  return bilan.debut < minuit.getTime()
    ? `Depuis hier soir, ${heureDe(bilan.debut)} (tu n'as pas fait de vraie pause depuis).`
    : `Aujourd'hui, depuis ${heureDe(bilan.debut)}.`;
}

function creerAlerte(alerte) {
  const bloc = document.createElement("div");
  bloc.className = `session-alerte alerte-${alerte.type}`;
  bloc.setAttribute("role", "status");
  const texte = document.createElement("div");
  const titre = document.createElement("strong");
  titre.textContent = alerte.titre;
  const message = document.createElement("p");
  message.textContent = alerte.message;
  texte.append(titre, message);
  const fermer = document.createElement("button");
  fermer.type = "button";
  fermer.className = "bouton-secondaire";
  fermer.textContent = "OK";
  fermer.setAttribute("aria-label", "Fermer ce conseil");
  fermer.addEventListener("click", () => {
    alertesFermees.add(alerte.cle);
    renduSession();
  });
  bloc.append(texte, fermer);
  return bloc;
}

/** Redessine la carte de session (appelée par mettreAJour, et chaque minute pour le rappel de temps). */
function renduSession() {
  const maintenant = Date.now();
  const parties = partiesDeSession(partiesStats, { mode: reglagesSession.mode, lancement: lancementAppli, maintenant });
  const bilan = bilanSession(parties, { niveau: compte ? compte.niveau : 1 });

  $("sessionDepuis").textContent = texteDebutSession(bilan);
  $("sessionContenu").hidden = !bilan;
  $("sessionVide").hidden = Boolean(bilan);
  const alertes = alertesSession(bilan, reglagesSession, maintenant).filter((a) => !alertesFermees.has(a.cle));
  $("sessionAlertes").replaceChildren(...alertes.map(creerAlerte));
  if (!bilan) {
    $("sessionVide").textContent = "Pas encore de partie dans cette session. Bon jeu !";
    return;
  }

  $("sessionParties").textContent = formatNombre(bilan.parties);
  $("sessionPartiesDetail").textContent = `dernière finie à ${heureDe(bilan.fin)}`;
  $("sessionResultats").textContent = `${bilan.victoires} V – ${bilan.defaites} D`;
  $("sessionResultatsDetail").textContent = `${Math.round((bilan.victoires / bilan.parties) * 100)} % de victoires`;
  $("sessionXp").textContent = `+${formatNombre(bilan.xp)} XP`; // "estimée" est écrit dessous
  $("sessionTemps").textContent = texteDuree(bilan.dureeS);

  const m = bilan.meilleur;
  const nom = document.createElement("strong");
  nom.textContent = m.nom;
  $("sessionMeilleur").replaceChildren(iconeChampion(m.championId), nom);
  $("sessionMeilleurDetail").textContent =
    `${m.victoires} victoire${m.victoires > 1 ? "s" : ""} sur ${m.parties} · KDA ${texteKda(m.kda)}`;
}

// --- Réglages (onglet Paramètres) ---------------------------------------------------------

function afficherReglagesSession(r) {
  reglagesSession = r;
  $("modeSession").value = r.mode;
  // Les nombres restent toujours modifiables : en changer un coche sa case (voir brancherSession).
  $("alerteDefaites").checked = r.alerteDefaites;
  $("seuilDefaites").value = r.seuilDefaites;
  $("rappelDuree").checked = r.rappelDuree;
  $("heuresRappel").value = r.heuresRappel;
  $("alerteVictoires").checked = r.alerteVictoires;
  $("seuilVictoires").value = r.seuilVictoires;
  $("notifierSession").checked = r.notifier;
  renduSession();
}

async function enregistrerReglagesSession() {
  const reponse = await window.appli.enregistrerSession({
    mode: $("modeSession").value,
    alerteDefaites: $("alerteDefaites").checked,
    seuilDefaites: Number($("seuilDefaites").value),
    rappelDuree: $("rappelDuree").checked,
    heuresRappel: Number($("heuresRappel").value),
    alerteVictoires: $("alerteVictoires").checked,
    seuilVictoires: Number($("seuilVictoires").value),
    notifier: $("notifierSession").checked,
  });
  if (!reponse.ok) {
    afficherEtat("etatSession", reponse.erreur, "erreur");
    return;
  }
  afficherReglagesSession(reponse.reglages); // valeurs nettoyées (bornées)
  afficherEtat("etatSession", "Réglages de session enregistrés ✓", "ok");
}

function brancherSession() {
  surRendu(renduSession);
  setInterval(renduSession, 60 * 1000); // le rappel "Tu joues depuis 2 h" arrive même sans nouvelle partie
  if (!window.appli) {
    for (const element of $("formSession").elements) element.disabled = true;
    return;
  }
  window.appli.lireConfig().then((config) => {
    if (Number.isFinite(config.lancement)) lancementAppli = config.lancement;
    renduSession();
  });
  window.appli.lireSession().then(afficherReglagesSession);
  // Changer un nombre active son option (branché avant l'enregistrement, qui part donc avec la case cochée).
  for (const [nombre, option] of [["seuilDefaites", "alerteDefaites"], ["heuresRappel", "rappelDuree"], ["seuilVictoires", "alerteVictoires"]]) {
    $(nombre).addEventListener("change", () => {
      $(option).checked = true;
    });
  }
  for (const id of ["modeSession", "alerteDefaites", "seuilDefaites", "rappelDuree", "heuresRappel", "alerteVictoires", "seuilVictoires", "notifierSession"]) {
    $(id).addEventListener("change", enregistrerReglagesSession);
  }
}
