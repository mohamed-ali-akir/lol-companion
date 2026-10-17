/*
 * Bilan de session (carte principale de l'Accueil)
 * -----------------------------------------------
 * Session = tes parties depuis ta première partie du jour (une soirée sans vraie pause continue après minuit).
 * Affiche : parties, victoires / défaites, XP gagnée (estimée), temps de jeu, meilleur champion.
 * Les parties viennent de l'onglet Stats (partiesStats, relues après chaque partie) ;
 * les calculs sont dans calculs.js. Utilise iconeChampion() et texteKda() de onglets/stats.js.
 */

const heureDe = (date) => new Date(date).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

function texteDebutSession(bilan) {
  if (!bilan) return "Aujourd'hui.";
  const minuit = new Date();
  minuit.setHours(0, 0, 0, 0);
  return bilan.debut < minuit.getTime()
    ? `Depuis hier soir, ${heureDe(bilan.debut)} (tu n'as pas fait de vraie pause depuis).`
    : `Aujourd'hui, depuis ${heureDe(bilan.debut)}.`;
}

/** Redessine la carte de session (appelée par mettreAJour, et chaque minute pour passer à une nouvelle journée). */
function renduSession() {
  const maintenant = Date.now();
  const parties = partiesDeSession(partiesStats, { maintenant });
  const bilan = bilanSession(parties, { niveau: compte ? compte.niveau : 1 });

  $("sessionDepuis").textContent = texteDebutSession(bilan);
  $("sessionContenu").hidden = !bilan;
  $("sessionVide").hidden = Boolean(bilan);
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

function brancherSession() {
  surRendu(renduSession);
  setInterval(renduSession, 60 * 1000);
}
