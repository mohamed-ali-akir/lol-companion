/*
 * Onglet "Classée" (et sa carte sur l'Accueil)
 * ------------------------------------------
 * Checklist "Prêt pour la classée ?" (niveau 30 + 20 champions possédés), Essence bleue,
 * et champions achetables tout de suite. Lecture seule : l'appli n'achète rien.
 * Les données viennent de main.js (classee.js) ; les calculs sont dans calculs.js.
 */

// Réponse du client : { champions, possedes, essenceBleue, prixDisponibles } (null tant qu'on n'a rien lu).
let donneesClassee = null;
let erreurClassee = null;
let voirTousLesAchetables = false;
const NB_ACHETABLES_AFFICHES = 24;

/** Demande les données à main.js (au démarrage, et quand on relit le compte). */
async function chargerClassee() {
  if (!window.appli) return;
  appliquerClassee(await window.appli.lireClassee());
}

/** Réponse de main.js (demandée, ou envoyée toute seule après un changement dans le client). */
function appliquerClassee(reponse) {
  if (reponse.ok) {
    donneesClassee = reponse;
    erreurClassee = null;
  } else if (!donneesClassee) {
    erreurClassee = reponse; // on garde les dernières données lues si le client vient de se fermer
  }
  mettreAJour();
}

/** Une ligne de la checklist : coche + titre + détail. Jamais la couleur seule : ✓/✗ et un mot. */
function remplirCoche(id, ok, detail) {
  const ligne = $(id);
  ligne.classList.toggle("fait", ok);
  ligne.querySelector(".coche").textContent = ok ? "✓" : "✗";
  ligne.querySelector(".coche-etat").textContent = ok ? "Fait" : "À faire";
  ligne.querySelector(".coche-detail").replaceChildren(...detail);
}

/** Petit lien interne vers un autre onglet. */
function lienOnglet(texte, onglet) {
  const lien = document.createElement("button");
  lien.type = "button";
  lien.className = "lien";
  lien.dataset.vers = onglet;
  lien.textContent = texte;
  return lien;
}

/** Estimation des parties pour le niveau 30 (mode le plus rapide), ou null. */
function partiesPourNiveau30() {
  const objectif = { ...lireObjectif(), niveauCible: NIVEAU_CLASSEE };
  const params = parametresCalcul(compte, objectif);
  if (verifier(params)) return null;
  return resumeObjectif(calculerModesAvecMissions(params, statsCompte, xpMissionsComptee()).calculs);
}

function creerTuileChampion(champion) {
  const li = document.createElement("li");
  li.className = "champion";
  const image = document.createElement("img");
  image.src = `lcu-image://champion/${champion.id}`;
  image.alt = "";
  image.width = 48;
  image.height = 48;
  image.loading = "lazy";
  image.addEventListener("error", () => image.classList.add("sans-image")); // client fermé : case vide
  const nom = document.createElement("span");
  nom.className = "champion-nom";
  nom.textContent = champion.nom;
  const prix = document.createElement("span");
  prix.className = "champion-prix";
  prix.textContent = `${formatNombre(champion.prix)} EB`;
  li.append(image, nom, prix);
  return li;
}

/** Redessine l'onglet Classée et sa carte sur l'Accueil (appelée par mettreAJour). */
function renduClassee(vue) {
  const d = donneesClassee;
  $("classeeContenu").hidden = !d;
  $("classeeSansDonnees").hidden = Boolean(d);
  renduCarteAccueilClassee(vue);
  if (!d) {
    $("classeeSansDonnees").textContent =
      erreurClassee && erreurClassee.probleme !== "pas-lance"
        ? erreurClassee.erreur
        : "Lance League of Legends pour voir si ton compte est prêt pour la classée.";
    return;
  }

  // --- Checklist ---
  const niveau = vue.compte ? vue.compte.niveau : null;
  const check = checklistClassee({ niveau, possedes: d.possedes });
  $("classeeVerdict").textContent = check.pret
    ? "Tu es prêt pour la classée ! 🎉"
    : `Pas encore : ${check.niveauOk ? "" : "le niveau"}${!check.niveauOk && !check.championsOk ? " et " : ""}${check.championsOk ? "" : "les champions"}.`;
  $("classeeVerdict").classList.toggle("pret", check.pret);

  if (niveau === null) {
    remplirCoche("checkNiveau", false, ["Niveau inconnu pour l'instant."]);
  } else if (check.niveauOk) {
    remplirCoche("checkNiveau", true, [`Niveau ${niveau} atteint.`]);
  } else {
    const estimation = partiesPourNiveau30();
    remplirCoche("checkNiveau", false, [
      `Niveau ${niveau} : il te manque ${check.niveauxManquants} niveau${check.niveauxManquants > 1 ? "x" : ""}` +
        (estimation ? ` (≈ ${formatNombre(estimation.parties)} parties ${de(estimation.nom)}). ` : ". "),
      lienOnglet("Voir l'onglet Niveau", "niveau"),
    ]);
  }
  remplirCoche("checkChampions", check.championsOk, [
    check.championsOk
      ? `${d.possedes} champions possédés.`
      : `${d.possedes} / ${CHAMPIONS_CLASSEE} : il t'en manque ${check.championsManquants}.`,
  ]);

  // --- Essence bleue ---
  const eb = d.essenceBleue;
  $("ebValeur").textContent = eb === null ? "—" : `${formatNombre(eb)} EB`;
  const phrases = [];
  if (eb === null) {
    phrases.push("Essence bleue introuvable dans le client.");
  } else if (!d.prixDisponibles) {
    phrases.push("Prix des champions indisponibles pour l'instant : ouvre la boutique du client, puis relis ton compte.");
  } else {
    const total = d.possedes + nombreAchetablesEnTout(d.champions, eb);
    phrases.push(`Avec tes ${formatNombre(eb)} EB, tu peux atteindre ${total} champions (en achetant les moins chers d'abord).`);
    if (!check.championsOk && total < CHAMPIONS_CLASSEE) {
      const cout = coutDesMoinsChers(d.champions, check.championsManquants);
      if (cout !== null) {
        phrases.push(
          `Pour atteindre ${CHAMPIONS_CLASSEE}, il te faut ≈ ${formatNombre(cout)} EB au total ` +
            `(il te manque ${formatNombre(Math.max(0, cout - eb))} EB).`
        );
      }
    }
  }
  $("ebResume").textContent = phrases.join(" ");

  // --- Champions achetables ---
  const achetables = championsAchetables(d.champions, eb);
  const liste = $("achetables");
  const affiches = voirTousLesAchetables ? achetables : achetables.slice(0, NB_ACHETABLES_AFFICHES);
  liste.replaceChildren(...affiches.map(creerTuileChampion));
  const bouton = $("voirTousAchetables");
  bouton.hidden = achetables.length <= NB_ACHETABLES_AFFICHES;
  bouton.textContent = voirTousLesAchetables ? "Voir moins" : `Voir les ${achetables.length} champions`;

  const vide = $("achetablesVide");
  vide.hidden = achetables.length > 0;
  if (achetables.length === 0) {
    const moinsCher = championsEnVente(d.champions)[0];
    vide.textContent = !d.prixDisponibles
      ? "Prix indisponibles pour l'instant."
      : moinsCher
        ? `Rien à ta portée pour l'instant : le moins cher (${moinsCher.nom}) coûte ${formatNombre(moinsCher.prix)} EB` +
          (eb !== null ? `, il te manque ${formatNombre(moinsCher.prix - eb)} EB.` : ".")
        : "Tu possèdes déjà tous les champions en vente. 👏";
  }
}

/** Carte "Prêt pour la classée ?" sur l'Accueil. */
function renduCarteAccueilClassee(vue) {
  const carte = $("carteClassee");
  const d = donneesClassee;
  carte.classList.toggle("bientot", !d);
  if (!d) {
    carte.querySelector(".carte-valeur").textContent = "";
    carte.querySelector(".carte-detail").textContent = "Lance League of Legends pour vérifier.";
    return;
  }
  const niveau = vue.compte ? vue.compte.niveau : null;
  const check = checklistClassee({ niveau, possedes: d.possedes });
  carte.querySelector(".carte-valeur").textContent = check.pret ? "Prêt ✓" : "Pas encore";
  const morceaux = [
    niveau === null ? null : `Niveau ${Math.min(niveau, NIVEAU_CLASSEE)}/${NIVEAU_CLASSEE}`,
    `${Math.min(d.possedes, CHAMPIONS_CLASSEE)}/${CHAMPIONS_CLASSEE} champions`,
    d.essenceBleue === null ? null : `${formatNombre(d.essenceBleue)} EB`,
  ].filter(Boolean);
  carte.querySelector(".carte-detail").textContent = morceaux.join(" · ");
}

function brancherClassee() {
  $("voirTousAchetables").addEventListener("click", () => {
    voirTousLesAchetables = !voirTousLesAchetables;
    mettreAJour();
  });
  surRendu(renduClassee);
  if (window.appli) window.appli.surClassee(appliquerClassee); // nouveau champion, EB gagnée...
}
