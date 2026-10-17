/*
 * Résumé d'après-partie (carte « Ta dernière partie » de l'Accueil)
 * -----------------------------------------------------------------
 * Ta dernière partie comparée à tes 20 parties précédentes du même genre (Faille, ARAM, Arena) :
 * KDA, CS, or, dégâts et vision par minute, avec une flèche verte (mieux) ou rouge (moins bien).
 * Redessinée après chaque partie, comme le bilan de session : les parties viennent de l'onglet Stats
 * (partiesStats), les calculs de calculs.js (resumeDernierePartie). Tout est local : rien n'est envoyé.
 * Utilise iconeChampion() de onglets/stats.js.
 */

const FLECHES_TENDANCE = { mieux: "▲", moins: "▼", pareil: "=" };

/** 6,3 / 512 / 0,85 selon la mesure. */
const nombreMesure = (n, decimales) => n.toLocaleString("fr-FR", { minimumFractionDigits: decimales, maximumFractionDigits: decimales });

/** Une tuile : nom de la mesure, valeur de la partie, écart avec ta moyenne. */
function tuileMesure(m) {
  const tuile = element("div", "tuile");
  tuile.append(element("span", "tuile-titre", m.nom), element("span", "tuile-valeur", nombreMesure(m.valeur, m.decimales)));
  if (m.tendance) {
    const signe = m.ecart > 0 ? "+" : m.ecart < 0 ? "−" : "";
    const ecart =
      m.tendance === "pareil"
        ? `${FLECHES_TENDANCE.pareil} comme d'habitude`
        : `${FLECHES_TENDANCE[m.tendance]} ${signe}${nombreMesure(Math.abs(m.ecart), m.decimales)}`;
    const detail = element("span", `tuile-detail tendance-${m.tendance}`, ecart);
    detail.append(element("span", "tendance-moyenne", ` · ta moyenne ${nombreMesure(m.moyenne, m.decimales)}`));
    tuile.append(detail);
  } else {
    tuile.append(element("span", "tuile-detail", "moyenne après quelques parties"));
  }
  return tuile;
}

/** Redessine la carte (appelée par mettreAJour : après chaque partie, partiesStats est relu). */
function renduDernierePartie({ compte }) {
  const resume = compte ? resumeDernierePartie(partiesStats) : null;
  $("carteDernierePartie").hidden = !resume;
  if (!resume) return;

  const p = resume.partie;
  $("dernierePartieQuand").textContent = `${nomFile(p.file)} · ${formatDateHeure(p.date)} · ${texteDuree(p.dureeS)}`;

  const nom = element("strong", null, p.championNom || "Champion");
  const resultat = element("span", p.victoire ? "resultat-victoire" : "resultat-defaite", p.victoire ? "Victoire" : "Défaite");
  $("dernierePartieChampion").replaceChildren(iconeChampion(p.championId), nom, resultat, element("span", null, `${p.kills} / ${p.deaths} / ${p.assists}`));

  $("dernierePartiePhrase").textContent =
    phraseDernierePartie(resume) ||
    (resume.comparees === 0
      ? "Ta première partie de ce genre ici : la comparaison arrive après quelques parties."
      : "Joue encore quelques parties de ce genre : la comparaison avec tes habitudes arrive.");
  $("dernierePartieMesures").replaceChildren(...resume.mesures.map(tuileMesure));
}

function brancherDernierePartie() {
  surRendu(renduDernierePartie);
}
