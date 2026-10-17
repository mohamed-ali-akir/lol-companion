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
  document.getElementById("panneauSorts").hidden = liste.length === 0;
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

/**
 * Place du panneau des sorts : { x, y } en part de l'écran (choisie en le glissant, gardée par main.js), ou null pour
 * sa place par défaut (en haut à gauche, voir overlay.css).
 */
function placerSorts(position) {
  const panneau = document.getElementById("panneauSorts");
  panneau.style.left = position ? `${position.x * 100}%` : "";
  panneau.style.top = position ? `${position.y * 100}%` : "";
}

/**
 * Glisser le panneau par sa poignée (17/10/2026) : il suit la souris, reste dans l'écran, et sa nouvelle place est
 * envoyée à main.js au lâcher (en part de l'écran : même endroit à une autre résolution). Double-clic : place par défaut.
 */
function rendreDeplacable() {
  const panneau = document.getElementById("panneauSorts");
  const poignee = document.getElementById("poigneeSorts");
  let depart = null; // { souris: {x, y}, panneau: {x, y} } pendant un glissement
  const dansEcran = (x, y) => ({
    x: Math.min(Math.max(0, x), window.innerWidth - panneau.offsetWidth),
    y: Math.min(Math.max(0, y), window.innerHeight - panneau.offsetHeight),
  });
  poignee.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    depart = { souris: { x: e.clientX, y: e.clientY }, panneau: { x: panneau.offsetLeft, y: panneau.offsetTop } };
    poignee.setPointerCapture(e.pointerId); // la souris peut aller plus vite que le panneau
    panneau.classList.add("glisse");
  });
  poignee.addEventListener("pointermove", (e) => {
    if (!depart) return;
    const p = dansEcran(depart.panneau.x + e.clientX - depart.souris.x, depart.panneau.y + e.clientY - depart.souris.y);
    panneau.style.left = `${p.x}px`;
    panneau.style.top = `${p.y}px`;
  });
  const lacher = () => {
    if (!depart) return;
    const bouge = panneau.offsetLeft !== depart.panneau.x || panneau.offsetTop !== depart.panneau.y;
    depart = null;
    panneau.classList.remove("glisse");
    if (!bouge) return; // simple clic (ou double-clic) sur la poignée : rien à enregistrer
    const position = { x: panneau.offsetLeft / window.innerWidth, y: panneau.offsetTop / window.innerHeight };
    placerSorts(position);
    window.overlay.deplacerSorts(position);
  };
  poignee.addEventListener("pointerup", lacher);
  poignee.addEventListener("pointercancel", lacher);
  poignee.addEventListener("dblclick", () => {
    placerSorts(null);
    window.overlay.deplacerSorts(null);
  });
}

if (window.overlay) {
  window.overlay.surEtiquettes(afficherEtiquettes);
  if (window.overlay.surObjectif) window.overlay.surObjectif(afficherObjectif);
  if (window.overlay.surSorts) window.overlay.surSorts(afficherSorts);
  if (window.overlay.surPositionSorts) window.overlay.surPositionSorts(placerSorts);
  // La fenêtre laisse passer les clics au jeu, sauf quand la souris est sur le panneau des sorts (poignée comprise).
  const panneau = document.getElementById("panneauSorts");
  panneau.addEventListener("mouseenter", () => window.overlay.souris(true));
  panneau.addEventListener("mouseleave", () => {
    if (!panneau.classList.contains("glisse")) window.overlay.souris(false); // pendant un glissement, on garde la souris
  });
  if (window.overlay.deplacerSorts) rendreDeplacable();
}
