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

/**
 * Bandeau des objectifs, en haut à droite sous le chrono du jeu : [{ texte, restantS }] ou null (caché).
 * Une ligne par objectif ; plus visible dans les 10 dernières secondes.
 */
function afficherObjectif(lignes) {
  const bandeau = document.getElementById("alerteObjectif");
  const liste = Array.isArray(lignes) ? lignes : [];
  bandeau.hidden = liste.length === 0;
  bandeau.replaceChildren(
    ...liste.map((l) => {
      const ligne = document.createElement("div");
      ligne.className = `ligne-objectif${l.restantS <= 10 ? " imminent" : ""}`;
      ligne.textContent = l.texte;
      return ligne;
    })
  );
}

/** "4:05" à partir de 245 secondes. */
const minutesSecondes = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/**
 * Panneau des sorts adverses, en haut à gauche : une ligne par adversaire (icône du champion + 2 sorts).
 * Clic sur un sort = l'adversaire vient de l'utiliser (le chrono démarre) ; 2e clic = annuler.
 */
function afficherSorts(panneau) {
  const bloc = document.getElementById("sorts");
  const liste = Array.isArray(panneau) ? panneau : [];
  bloc.hidden = liste.length === 0;
  bloc.replaceChildren(
    ...liste.map((a) => {
      const ligne = document.createElement("div");
      ligne.className = "ligne-sorts";
      const icone = document.createElement("img");
      icone.className = "champion";
      icone.alt = a.alias || "";
      icone.title = a.alias || "";
      if (a.championId) icone.src = `lcu-image://champion/${a.championId}`;
      ligne.append(icone);
      for (const s of a.sorts || []) {
        const bouton = document.createElement("button");
        bouton.type = "button";
        const enRecharge = s.restantS > 0;
        bouton.className = `sort${enRecharge ? " recharge" : ""}`;
        bouton.textContent = enRecharge ? minutesSecondes(s.restantS) : s.nom;
        bouton.title = enRecharge ? `${s.nom} : clic pour annuler` : `${s.nom} : clic quand il est utilisé`;
        bouton.disabled = !s.cliquable;
        bouton.addEventListener("click", () => window.overlay.cliquerSort(s.id));
        ligne.append(bouton);
      }
      return ligne;
    })
  );
}

if (window.overlay) {
  window.overlay.surEtiquettes(afficherEtiquettes);
  if (window.overlay.surObjectif) window.overlay.surObjectif(afficherObjectif);
  if (window.overlay.surSorts) window.overlay.surSorts(afficherSorts);
  // La fenêtre laisse passer les clics au jeu, sauf quand la souris est sur le panneau des sorts.
  const panneau = document.getElementById("sorts");
  panneau.addEventListener("mouseenter", () => window.overlay.souris(true));
  panneau.addEventListener("mouseleave", () => window.overlay.souris(false));
}
