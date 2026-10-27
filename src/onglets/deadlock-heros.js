/*
 * Mode Deadlock, onglet Héros (27/10/2026)
 * ----------------------------------------
 * Les meilleurs héros du moment (tous les joueurs, 2 dernières semaines, filtre de niveau) et tes stats par héros.
 * Données de deadlock-api.com, déjà calculées par main.js (deadlock-stats.js : tierListe, mesStatsParHeros).
 * Le niveau choisi est enregistré (config.json) et sert aussi à l'onglet Build.
 */

let herosDeadlockLu = 0; // heure de la dernière lecture réussie (0 : à relire)

/** Remplit le choix du niveau (rangs de l'API, du plus bas au plus haut), une seule fois. */
function remplirRangsDeadlock(rangs, rang) {
  const choix = $("deadlockRang");
  if (choix.options.length <= 1 && Array.isArray(rangs)) {
    for (const r of rangs.filter((x) => x.rang >= 1)) {
      const option = element("option", null, `${r.nom} et plus`);
      option.value = String(r.rang);
      choix.append(option);
    }
  }
  choix.value = Number.isInteger(rang) ? String(rang) : "";
}

function ligneHerosDeadlock(h, i) {
  const ligne = element("tr");
  ligne.append(
    element("td", "nombre", String(i + 1)),
    element("td", "col-nom", h.nom),
    element("td", "nombre", formatPourcent(h.tauxVictoire)),
    element("td", "nombre", Number.isFinite(h.popularite) ? `${formatPourcent(h.popularite)} des parties` : "–"),
    element("td", "nombre", formatNombre(h.parties)),
  );
  return ligne;
}

function ligneMesHerosDeadlock(h) {
  const ligne = element("tr");
  ligne.append(
    element("td", "col-nom", h.nom),
    element("td", "nombre", formatNombre(h.parties)),
    element("td", "nombre", formatPourcent(h.tauxVictoire)),
    element("td", "nombre", Number.isFinite(h.kda) ? formatNombre(Math.round(h.kda * 100) / 100) : "–"),
    element("td", "nombre", Number.isFinite(h.tempsS) ? texteDuree(h.tempsS) : "–"),
  );
  return ligne;
}

/** Lit et affiche la tier list et tes héros (au plus une fois toutes les 5 min, sauf forcer). */
async function chargerHerosDeadlock({ forcer = false } = {}) {
  if (!forcer && Date.now() - herosDeadlockLu < RELECTURE_DEADLOCK_MS) return;
  herosDeadlockLu = Date.now();
  afficherEtat("etatDeadlockHeros", "Chargement…", "info");
  const r = await window.appli.lireHerosDeadlock();
  if (!r.ok) {
    herosDeadlockLu = 0;
    afficherEtat("etatDeadlockHeros", r.erreur, "erreur");
    return;
  }
  remplirRangsDeadlock(r.rangs, r.rang);
  const lignes = r.tierListe.map(ligneHerosDeadlock);
  $("corpsDeadlockHeros").replaceChildren(...lignes);
  $("tableDeadlockHeros").hidden = lignes.length === 0;
  afficherEtat("etatDeadlockHeros", lignes.length ? "" : "Pas assez de parties à ce niveau.", "info");

  const mes = r.mesHeros.map(ligneMesHerosDeadlock);
  $("corpsDeadlockMesHeros").replaceChildren(...mes);
  $("tableDeadlockMesHeros").hidden = mes.length === 0;
  $("deadlockMesHerosVide").hidden = mes.length > 0;
  $("deadlockMesHerosVide").textContent = "Aucune partie connue pour l'instant.";
}

function brancherDeadlockHeros() {
  document.addEventListener("onglet", (evenement) => {
    if (evenement.detail === "deadlockheros") chargerHerosDeadlock();
  });
  $("deadlockRang").addEventListener("change", async () => {
    const valeur = $("deadlockRang").value;
    const reglages = await enregistrerReglagesDeadlock({ rang: valeur ? Number(valeur) : null }, "etatDeadlockHeros");
    if (!reglages) return;
    buildDeadlockAffiche = null; // le build affiché était calculé pour l'ancien niveau
    await chargerHerosDeadlock({ forcer: true });
  });
}
