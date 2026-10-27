/*
 * Onglet "Sélection" : conseiller de draft, pick et ban automatiques
 * -----------------------------------------------------------------
 * Conseiller : la case (clé conseilActif) et les propositions envoyées par main.js (draft.js), en direct.
 * Réglages (cases, délais) et listes de champions : 3 choix dans l'ordre par rôle (+ "Par défaut"),
 * et 3 bans dans l'ordre par rôle (+ "Par défaut"). Tout est enregistré par main.js (selection.js, clé "selectionAuto" de config.json).
 * Affiche aussi le dernier événement (ton tour, champion choisi ou banni, action annulée).
 * (Les runes sont dans l'onglet Build : onglets/build.js.)
 */

const LISTES_SELECTION = [
  { nom: "defaut", libelle: "Par défaut" },
  { nom: "top", libelle: "Haut" },
  { nom: "jungle", libelle: "Jungle" },
  { nom: "middle", libelle: "Milieu" },
  { nom: "bottom", libelle: "Bas" },
  { nom: "utility", libelle: "Support" },
];
const CHOIX_PAR_LISTE = 3;

let reglagesSelection = null; // { pickActif, banActif, delaiPickSecondes, delaiBanSecondes, picks, bans }
let championsSelection = []; // [{ id, nom }] triés par nom, lus dans le client

const libelleRole = (role) => (LISTES_SELECTION.find((l) => l.nom === role) || {}).libelle || role;

// --- Recherche de champion (aussi utilisée par l'onglet Build) ---------------------------------
// Chaque choix est un champ de recherche avec suggestions (une seule <datalist> partagée). La recherche est
// tolérante comme dans l'onglet Maîtrise (trouverChampion et filtrerMaitrises, calculs.js) : "kaisa" trouve "Kai'Sa".

const ID_SUGGESTIONS = "suggestionsChampions";

/** Remplit la liste de suggestions partagée avec les noms des champions. */
function remplirSuggestionsChampions(champions) {
  let suggestions = $(ID_SUGGESTIONS);
  if (!suggestions) {
    suggestions = document.createElement("datalist");
    suggestions.id = ID_SUGGESTIONS;
    document.body.append(suggestions);
  }
  suggestions.replaceChildren(...champions.map((c) => new Option(c.nom)));
}

/**
 * Champ de recherche de champion. id : champion déjà choisi (ou 0). Le numéro du champion retenu est gardé dans
 * data-id ; quand on tape un nom valide, aQuandChoisi() est appelée. idEtat : bloc où afficher les erreurs.
 */
function champRechercheChampion({ id = 0, libelle, champions, idEtat, aQuandChoisi }) {
  const champ = document.createElement("input");
  champ.type = "search";
  champ.setAttribute("list", ID_SUGGESTIONS);
  champ.setAttribute("aria-label", libelle);
  champ.placeholder = "—";
  champ.autocomplete = "off";
  champ.spellcheck = false;
  const connu = champions.find((c) => c.id === id);
  // Champion enregistré mais liste pas encore chargée (client fermé) : on le garde quand même.
  champ.value = id ? (connu ? connu.nom : `Champion n° ${id}`) : "";
  champ.dataset.id = id ? String(id) : "";
  champ.addEventListener("change", () => {
    const resultat = trouverChampion(champ.value, champions);
    if (resultat.erreur) {
      afficherEtat(idEtat, resultat.erreur, "erreur");
      const avant = champions.find((c) => String(c.id) === champ.dataset.id);
      champ.value = avant ? avant.nom : champ.dataset.id ? `Champion n° ${champ.dataset.id}` : ""; // on remet l'ancien choix
      return;
    }
    champ.dataset.id = resultat.vide ? "" : String(resultat.champion.id);
    champ.value = resultat.vide ? "" : resultat.champion.nom;
    aQuandChoisi();
  });
  return champ;
}

/** Une ligne "libellé + 3 champs de recherche" ; data-liste dit à quelle liste elle appartient ("middle", "ban-middle"...). */
function ligneSelection(libelle, liste, ids) {
  const ligne = document.createElement("div");
  ligne.className = "ligne-selection";
  const titre = document.createElement("span");
  titre.textContent = libelle;
  ligne.append(titre);
  for (let i = 0; i < CHOIX_PAR_LISTE; i++) {
    const champ = champRechercheChampion({
      id: ids[i] || 0,
      libelle: `${liste.startsWith("ban-") ? "Ban" : "Pick"} ${libelle} : choix n° ${i + 1}`,
      champions: championsSelection,
      idEtat: "etatSelection",
      aQuandChoisi: enregistrerSelection,
    });
    champ.dataset.liste = liste;
    ligne.append(champ);
  }
  return ligne;
}

function afficherReglagesSelection(r) {
  reglagesSelection = r;
  $("conseilDraft").checked = r.conseilActif;
  $("pickAuto").checked = r.pickActif;
  $("banAuto").checked = r.banActif;
  $("delaiPick").value = r.delaiPickSecondes;
  $("delaiBan").value = r.delaiBanSecondes;
  $("delaiPick").disabled = !r.pickActif;
  $("delaiBan").disabled = !r.banActif;
  $("listesPicks").replaceChildren(...LISTES_SELECTION.map((l) => ligneSelection(l.libelle, l.nom, r.picks[l.nom] || [])));
  $("listesBans").replaceChildren(...LISTES_SELECTION.map((l) => ligneSelection(l.libelle, `ban-${l.nom}`, r.bans[l.nom] || [])));
}

/** Les 3 champs d'une liste, dans l'ordre (cases vides ignorées : main.js les retire). */
function idsDeLaListe(liste) {
  return [...document.querySelectorAll(`#formSelection input[data-liste="${liste}"]`)].map((c) => Number(c.dataset.id) || 0);
}

async function enregistrerSelection() {
  const picks = {};
  const bans = {};
  for (const l of LISTES_SELECTION) {
    picks[l.nom] = idsDeLaListe(l.nom);
    bans[l.nom] = idsDeLaListe(`ban-${l.nom}`);
  }
  const reponse = await window.appli.enregistrerSelection({
    pickActif: $("pickAuto").checked,
    banActif: $("banAuto").checked,
    conseilActif: $("conseilDraft").checked,
    delaiPickSecondes: Number($("delaiPick").value),
    delaiBanSecondes: Number($("delaiBan").value),
    picks,
    bans,
  });
  if (!reponse.ok) {
    afficherEtat("etatSelection", reponse.erreur, "erreur");
    return;
  }
  afficherReglagesSelection(reponse.reglages); // valeurs nettoyées (doublons retirés, délais bornés)
  const r = reponse.reglages;
  const etats = [
    r.pickActif ? `pick auto après ${r.delaiPickSecondes} s` : "pick manuel",
    r.banActif ? `ban auto après ${r.delaiBanSecondes} s` : "ban manuel",
  ];
  if (r.conseilActif) etats.push("conseiller de draft activé");
  afficherEtat("etatSelection", `Enregistré ✓ (${etats.join(", ")})`, "ok");
}

/** Messages de main.js pendant la sélection. */
function surEvenementSelection(info) {
  const verbe = info.type === "pick" ? "choisir" : "bannir";
  const fait = info.type === "pick" ? "choisi" : "banni";
  let texte;
  if (info.prevu) {
    texte = `Ton tour de ${verbe}${info.role ? ` (rôle : ${libelleRole(info.role)})` : ""} : l'appli agit dans ${info.delaiSecondes} s…`;
  } else if (info.fait) {
    texte = `${info.nom || "Champion"} ${fait} automatiquement à ${heure()} ✓`;
  } else if (info.annule === "repondu") {
    texte = `Tu as choisi toi-même : l'appli n'a rien fait (${heure()}).`;
  } else if (info.annule === "fini") {
    texte = `Tour terminé avant l'action de l'appli (${heure()}).`;
  } else if (info.annule === "desactive") {
    texte = `Option désactivée entre-temps : l'appli n'a rien fait (${heure()}).`;
  } else if (info.raison === "liste-vide") {
    texte = `Ta liste pour ${verbe} est vide : à toi de jouer (${heure()}).`;
  } else if (info.raison === "indisponibles") {
    texte = `Aucun champion de ta liste n'est disponible : à toi de jouer (${heure()}).`;
  } else {
    texte = `Impossible de ${verbe} à ${heure()} : ${info.erreur}`;
  }
  afficherEtat("evenementSelection", texte, info.erreur ? "erreur" : info.fait ? "ok" : "info");
}

// --- Conseiller de draft ---------------------------------------------------------------------------

/** Effet en points, signé, à la française : 0.0234 -> "+2,3". */
const pointsSignes = (fraction) => `${fraction >= 0 ? "+" : "−"}${Math.abs(fraction * 100).toFixed(1).replace(".", ",")}`;
const pourcentageFr = (fraction) => `${(fraction * 100).toFixed(1).replace(".", ",")} %`;

function texteRaison(r) {
  if (r.type === "contre") return `${pointsSignes(r.effet)} contre ${r.nom}`;
  if (r.type === "avec") return `${pointsSignes(r.effet)} avec ${r.nom}`;
  return `${pointsSignes(r.effet)} tes parties`;
}

/** Affiche le conseil reçu de main.js (draft.js), ou le cache (null : pas de sélection). */
function afficherConseilDraft(conseil) {
  const bloc = $("conseilDraftResultat");
  if (!conseil) {
    bloc.hidden = true;
    bloc.replaceChildren();
    return;
  }
  bloc.hidden = false;
  const titre = document.createElement("p");
  titre.className = "conseil-titre";
  const poste = conseil.role ? ` (${libelleRole(conseil.role)})` : "";
  if (conseil.etat === "calcul") titre.textContent = `Calcul des meilleurs champions${poste}…`;
  else if (conseil.etat === "pret") titre.textContent = `Meilleurs choix pour cette draft${poste}${conseil.patch ? ` · patch ${conseil.patch}` : ""}`;
  else titre.textContent = conseil.message || "Conseil indisponible.";
  const elements = [titre];

  if (conseil.etat === "pret") {
    if (conseil.propositions.length === 0 && conseil.message) {
      const vide = document.createElement("p");
      vide.className = "texte-vide";
      vide.textContent = conseil.message;
      elements.push(vide);
    }
    const liste = document.createElement("ol");
    liste.className = "conseil-liste";
    for (const p of conseil.propositions) {
      const ligne = document.createElement("li");
      const nom = document.createElement("strong");
      nom.textContent = p.nom;
      const score = document.createElement("span");
      score.className = "conseil-score";
      score.textContent = pourcentageFr(p.score);
      score.title = `Taux de victoire à ce poste : ${pourcentageFr(p.base)}, corrigé par la draft`;
      const raisons = document.createElement("span");
      raisons.className = "conseil-raisons";
      raisons.textContent = p.raisons.length ? p.raisons.map(texteRaison).join(" · ") : "aucun effet notable de la draft";
      ligne.append(nom, score, raisons);
      liste.append(ligne);
    }
    elements.push(liste);
    if (conseil.manquants && conseil.manquants.length) {
      const note = document.createElement("p");
      note.className = "texte-vide";
      note.textContent = `Pas de données pour : ${conseil.manquants.join(", ")} (non comptés).`;
      elements.push(note);
    }
  }
  bloc.className = `conseil-draft${conseil.etat === "erreur" ? " conseil-erreur" : ""}`;
  bloc.replaceChildren(...elements);
}

/** Charge les noms des champions (client lancé) puis redessine les listes. */
async function chargerChampionsSelection() {
  const reponse = await window.appli.lireChampionsSelection();
  if (!reponse.ok) {
    afficherEtat("etatSelection", reponse.erreur, "info");
    return;
  }
  championsSelection = reponse.champions;
  remplirSuggestionsChampions(championsSelection);
  if ($("etatSelection").classList.contains("etat-info")) afficherEtat("etatSelection", "");
  if (reglagesSelection) afficherReglagesSelection(reglagesSelection);
}

function brancherSelection() {
  window.appli.lireSelection().then(afficherReglagesSelection);
  chargerChampionsSelection();
  window.appli.surConnexion((connecte) => {
    if (connecte && championsSelection.length === 0) chargerChampionsSelection(); // client lancé après l'appli
  });
  window.appli.surSelection(surEvenementSelection);
  window.appli.lireConseilDraft().then(afficherConseilDraft);
  window.appli.surConseilDraft(afficherConseilDraft);
  for (const id of ["conseilDraft", "pickAuto", "banAuto", "delaiPick", "delaiBan"]) $(id).addEventListener("change", enregistrerSelection);
  // Entrée dans un champ de recherche : valide le champ (événement "change"), sans envoyer le formulaire.
  $("formSelection").addEventListener("submit", (e) => e.preventDefault());
  $("formConseil").addEventListener("submit", (e) => e.preventDefault());
}
