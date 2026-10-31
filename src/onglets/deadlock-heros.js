/*
 * Mode Deadlock, onglet Héros (27/10/2026)
 * ----------------------------------------
 * Les meilleurs héros du moment (tous les joueurs, 2 dernières semaines, filtre de niveau) et tes stats par héros.
 * Données de deadlock-api.com, déjà calculées par main.js (deadlock-stats.js : tierListe, mesStatsParHeros).
 * Le niveau choisi est enregistré (config.json) et sert aussi à l'onglet Build.
 * « Depuis la mise à jour » (31/10/2026, idée reprise de Statlocker) : les héros et objets qui ont le plus gagné ou perdu
 * en taux de victoire depuis la dernière grosse mise à jour (deadlock-stats.js : evolution). Lu APRÈS la tier list et à
 * part : ces stats sont parfois lentes à venir du site, la tier list s'affiche sans les attendre.
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

/** Ligne « Infernus  +2,1 points » ; au survol : le taux avant et après. */
function ligneEvolution(c) {
  const ligne = element("div", "dl-contre");
  ligne.title = `${formatPourcent(c.avant)} de victoires avant, ${formatPourcent(c.apres)} depuis`;
  const points = Math.round(c.ecart * 1000) / 10;
  ligne.append(element("strong", null, c.nom), puce(`${points > 0 ? "+" : ""}${formatNombre(points)} points`, points > 0 ? "puce-bon" : "puce-mauvais"));
  return ligne;
}

/** Colonne « Héros en hausse »... (vide : rien d'assez joué n'a bougé dans ce sens). */
function colonneEvolution(titre, changements) {
  const colonne = element("div", "dl-contres-colonne");
  colonne.append(element("h3", null, titre));
  if (changements.length === 0) colonne.append(element("p", "texte-vide", "Rien de notable."));
  colonne.append(...changements.map(ligneEvolution));
  return colonne;
}

/** Lit et affiche les gagnants et perdants de la dernière mise à jour. */
async function chargerPatchDeadlock() {
  afficherEtat("etatDeadlockPatch", "Chargement…", "info");
  const r = await window.appli.lirePatchDeadlock();
  if (!r.ok) {
    afficherEtat("etatDeadlockPatch", r.erreur, "erreur");
    $("deadlockPatch").hidden = true;
    return;
  }
  if (r.date === null) {
    $("deadlockPatchTitre").textContent = "Depuis la dernière mise à jour";
    afficherEtat("etatDeadlockPatch", "Date de la dernière mise à jour inconnue pour l'instant.", "info");
    $("deadlockPatch").hidden = true;
    return;
  }
  $("deadlockPatchTitre").textContent = `Depuis la mise à jour du ${formatJourMois(r.date)}`;
  $("deadlockPatch").replaceChildren(
    colonneEvolution("Héros en hausse", r.heros.montent),
    colonneEvolution("Héros en baisse", r.heros.baissent),
    colonneEvolution("Objets en hausse", r.objets.montent),
    colonneEvolution("Objets en baisse", r.objets.baissent),
  );
  $("deadlockPatch").hidden = false;
  afficherEtat("etatDeadlockPatch", "");
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

  await chargerPatchDeadlock();
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
