/*
 * Fenêtre transparente des augments (ARAM Mayhem)
 * -----------------------------------------------
 * Reçoit de main.js les étiquettes à afficher sous chaque carte : { echelle, liste: [{ x, y, texte, detail, source, meilleur }] }.
 * x et y sont en pixels réels de l'écran ; on les divise par l'échelle de Windows (125 %, 150 %...) pour la page.
 * Cette fenêtre laisse passer les clics : on ne peut pas cliquer dessus, elle ne fait qu'afficher.
 */

function afficherEtiquettes(info) {
  const conteneur = document.getElementById("etiquettes");
  conteneur.replaceChildren();
  if (!info || !Array.isArray(info.liste)) return;
  const echelle = info.echelle > 0 ? info.echelle : 1;
  for (const e of info.liste) {
    const bloc = document.createElement("div");
    // champion : taux avec ton champion ; global : tous champions (plus discret) ; sinon : pas de données.
    const style = e.source === "champion" ? "" : e.source === "global" ? " global" : " inconnu";
    bloc.className = `etiquette${style}${e.meilleur ? " meilleur" : ""}`;
    bloc.style.left = `${e.x / echelle}px`;
    bloc.style.top = `${e.y / echelle}px`;
    const texte = document.createElement("strong");
    texte.textContent = e.texte;
    bloc.append(texte);
    if (e.detail) {
      const detail = document.createElement("small");
      detail.textContent = e.detail;
      bloc.append(detail);
    }
    conteneur.append(bloc);
  }
}

if (window.overlay) window.overlay.surEtiquettes(afficherEtiquettes);
