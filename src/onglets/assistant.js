/*
 * Assistant de première ouverture
 * -------------------------------
 * À la première ouverture de l'appli, une fenêtre pose 3 questions simples (une par écran, réponse Oui / Non),
 * puis coche les bonnes cases toute seule : build automatique (onglet Build), chronos des sorts adverses (Build),
 * acceptation automatique (Paramètres). Les réponses proposées au départ sont les réglages actuels :
 * ne rien changer garde tout comme avant.
 * « Passer » (ou Échap) ferme l'assistant sans rien changer. Il ne revient plus ensuite (config.json : assistantVu),
 * sauf avec le bouton « Relancer l'assistant » de l'onglet Paramètres.
 * Utilise afficherReglagesBuild() (onglets/build.js) et afficherReglagesAcceptation() (onglets/parametres.js).
 */

const QUESTIONS_ASSISTANT = [
  {
    cle: "build",
    titre: "Ton build tout prêt ?",
    texte: "Pendant la sélection des champions, l'appli crée ta page de runes et ton set d'objets pour le champion que tu joues.",
    detail: "Les statistiques viennent d'OP.GG et de Lolalytics : seuls le champion, le rôle et le mode leur sont envoyés.",
    oui: "Oui, prépare mon build",
  },
  {
    cle: "sorts",
    titre: "Les chronos des sorts adverses ?",
    texte:
      "En partie sur la Faille, un petit panneau montre les sorts d'invocateur adverses. Clique quand tu vois un Flash partir, " +
      "ou laisse un allié le signaler par un ping : le chrono démarre tout seul.",
    detail: "Il faut mettre le jeu en mode « Sans bordure » pour voir le panneau.",
    oui: "Oui, affiche les chronos",
  },
  {
    cle: "accepter",
    titre: "Accepter les parties tout seul ?",
    texte: "Quand une partie est trouvée, l'appli clique sur « Accepter » à ta place, au bout de 2 secondes.",
    detail: "Pratique si tu t'éloignes de l'écran pendant la file d'attente.",
    oui: "Oui, accepte pour moi",
  },
];

// Pendant l'assistant : réglages lus au départ, réponses données, écran affiché (-1 = accueil).
let assistant = { build: null, acceptation: null, reponses: {}, etape: -1 };

/** Remplit la fenêtre : petit texte d'étape, titre, explication, détail, boutons [[texte, action, principal]]. */
function ecranAssistant({ etape = "", titre, texte, detail = "", boutons, passer = true }) {
  $("assistantEtape").textContent = etape;
  $("assistantTitre").textContent = titre;
  $("assistantTexte").textContent = texte;
  $("assistantDetail").textContent = detail;
  $("assistantDetail").hidden = !detail;
  $("assistantPasser").hidden = !passer;
  $("assistantBoutons").replaceChildren(
    ...boutons.map(([libelle, action, principal]) => {
      const bouton = element("button", principal ? null : "bouton-secondaire", libelle);
      bouton.type = "button";
      bouton.addEventListener("click", action);
      return bouton;
    })
  );
  const premier = $("assistantBoutons").querySelector("button");
  if (premier) premier.focus();
}

function questionAssistant(i) {
  assistant.etape = i;
  if (i >= QUESTIONS_ASSISTANT.length) return terminerAssistant();
  const q = QUESTIONS_ASSISTANT[i];
  const repondre = (oui) => () => {
    assistant.reponses[q.cle] = oui;
    questionAssistant(i + 1);
  };
  ecranAssistant({
    etape: `Question ${i + 1} sur ${QUESTIONS_ASSISTANT.length}`,
    titre: q.titre,
    texte: q.texte,
    detail: q.detail,
    boutons: [
      [q.oui, repondre(true), true],
      ["Non merci", repondre(false), false],
    ],
  });
}

/** Enregistre les réponses (les mêmes réglages que les cases des onglets), puis affiche le bilan. */
async function terminerAssistant() {
  const { build, acceptation, reponses } = assistant;
  const erreurs = [];
  const reponseBuild = await window.appli.enregistrerBuild({
    ...build,
    stats: reponses.build,
    runes: reponses.build,
    rank1: reponses.build && build.rank1, // ces deux cases ont besoin du build : gardées si elles étaient cochées
    sortsAuto: reponses.build && build.sortsAuto,
    sorts: reponses.sorts,
  });
  if (reponseBuild.ok) afficherReglagesBuild(reponseBuild.reglages);
  else erreurs.push(reponseBuild.erreur);
  const reponseAcceptation = await window.appli.enregistrerAcceptation({ ...acceptation, actif: reponses.accepter });
  if (reponseAcceptation.ok) afficherReglagesAcceptation(reponseAcceptation.reglages);
  else erreurs.push(reponseAcceptation.erreur);
  await window.appli.noterAssistantVu();

  const choix = [
    reponses.build ? "build préparé pendant la sélection" : null,
    reponses.sorts ? "chronos des sorts adverses en partie" : null,
    reponses.accepter ? "parties acceptées automatiquement" : null,
  ].filter(Boolean);
  ecranAssistant({
    titre: erreurs.length ? "Presque prêt" : "C'est prêt ✓",
    texte: erreurs.length
      ? `Un réglage n'a pas pu être enregistré : ${erreurs.join(" ")}`
      : choix.length
        ? `Activé : ${choix.join(", ")}.`
        : "Rien d'automatique : l'appli se contente de suivre ton compte et tes parties.",
    detail: "Tout se change quand tu veux dans les onglets Build et Paramètres. Lance League of Legends : l'appli se remplit toute seule.",
    boutons: [["Terminer", () => $("assistant").close(), true]],
    passer: false,
  });
}

/** Ouvre l'assistant (première ouverture, ou bouton « Relancer l'assistant »). */
async function ouvrirAssistant() {
  const [build, acceptation] = await Promise.all([window.appli.lireBuild(), window.appli.lireAcceptation()]);
  assistant = {
    build,
    acceptation,
    // Réponses par défaut = réglages actuels (fermer en cours de route ne change rien : rien n'est enregistré avant la fin).
    reponses: { build: build.stats && build.runes, sorts: build.sorts, accepter: acceptation.actif },
    etape: -1,
  };
  ecranAssistant({
    titre: "Bienvenue sur LoL Companion",
    texte: "3 questions pour régler l'appli à ta façon. Tu pourras tout changer ensuite.",
    boutons: [["C'est parti", () => questionAssistant(0), true]],
  });
  if (!$("assistant").open) $("assistant").showModal();
}

/** « Passer » ou Échap : on ferme sans rien changer, et l'assistant ne revient plus tout seul. */
function passerAssistant() {
  $("assistant").close();
  window.appli.noterAssistantVu();
}

function brancherAssistant() {
  $("assistantPasser").addEventListener("click", passerAssistant);
  $("assistant").addEventListener("cancel", (evenement) => {
    evenement.preventDefault(); // Échap : même chose que « Passer » (sauf sur le bilan, déjà enregistré)
    if (assistant.etape >= QUESTIONS_ASSISTANT.length) $("assistant").close();
    else passerAssistant();
  });
  $("assistantRelancer").addEventListener("click", ouvrirAssistant);
}
