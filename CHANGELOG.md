# Journal des versions

Ce qui change d'une version à l'autre, du plus récent au plus ancien. Le détail technique de chaque choix est dans
le [README](README.md) et dans l'historique Git.

## 1.5.0 (27/10/2026)
- **Mode Deadlock** : quand Deadlock est lancé, l'appli passe toute seule en mode Deadlock et s'appelle alors
  **Deadlock Companion** (boutons « League of
  Legends / Deadlock » en haut pour changer à la main).
  - **Accueil** : ton compte Steam, ton temps de jeu, tes dernières parties.
  - **Héros** : les meilleurs héros du moment, avec un filtre de niveau, et tes stats par héros.
  - **Build** : les objets les plus achetés d'un héros, par moment de la partie, et les héros qui le contrent.
  - Les stats viennent de deadlock-api.com (communauté). Case « Envoyer mes parties » (désactivée par défaut) pour
    que le site connaisse tes parties.
  - L'appli ne touche jamais au jeu (anti-triche).
- Site surchargé (codes 429 ou 503) : message clair « réessaie dans quelques minutes » pour tous les sites.
- **Build adapté à l'équipe adverse** : dès 3 ennemis verrouillés, Sandales de Mercure contre les magiques ou les
  contrôles, Coques en acier contre les physiques, objet anti-tank contre 2 tanks ou plus. Chaque changement est
  expliqué dans l'onglet Build et dans la boutique ; le set suit les nouveaux ennemis verrouillés.
- **Augments ARAM Mayhem** : lecture du nouveau format d'arammayhem.com (le site ne note plus les augments par
  champion depuis le 25/10/2026) : classement tous champions, et les augments les plus pris avec ton champion.

## 1.4.1 (20/10/2026)
- **Runes** : une seule page de l'appli à la fois. La page de la partie d'avant (Hwei) est retrouvée par son nom
  **ou par son identifiant** (même renommée) et remplacée par celle du nouveau champion (Akshan). Tes pages ne sont
  jamais touchées.
- **Arena** : si Lolalytics n'a pas de build Arena pour un champion, l'appli prend le build de la **Faille** et le
  convertit en objets Arena. Plus de faux messages d'erreur en Arena (pas de runes, d'OP.GG ni de set Rank 1 dans ce
  mode : ce n'est pas une erreur).
- **Challenge Arena** : compteur de parties pour chaque champion avant de réussir (« en 3 parties », « 2 parties
  sans top 3 »), et la moyenne de parties par réussite. Plus de champions en double dans la liste (173 au lieu de 250).
- Données du jeu (files, recharges des sorts, objets Arena) regroupées dans `donnees-jeu.js`.
- `npm run build:local` : les installateurs de test portent un numéro à part (`1.4.1-local.N`).

## 1.4.0 (20/10/2026)
- **Onglet Challenge** : faire un top 3 en Arena avec tous les champions, pick automatique du prochain.
- **Arena** : build de la page Arena de Lolalytics (avec l'objet prismatique), taux de victoire des augments et des
  objets prismatiques sous chaque carte.
- Assistant de première ouverture et résumé d'après-partie.
- Build : vrai rôle du champion en ARAM ; seuls les sets de LoL Companion restent dans le client.
- Licence MIT. Robustesse : messages de la page et affichage en jeu sortis de `main.js` et testés, version du format
  des fichiers de données, version de Node fixée, Dependabot.

## 1.3.3 (17/10/2026)
- **Electron 44** (la 38 n'était plus maintenue et avait des failles graves connues).
- **Fichiers de données écrits de façon sûre** : plus d'historique perdu si le PC s'éteint pendant une écriture
  (copie `.bak` relue, fichier abîmé gardé à part et signalé dans le journal).
- `--quitter` : fermeture propre de l'appli depuis l'extérieur (une mise à jour prête s'installe).
- Sonde quotidienne des sites lus (Lolalytics, OP.GG, arammayhem) ; tests et essai de bout en bout à chaque envoi.

## 1.3.2 (17/10/2026)
- **Mise à jour installée au lancement**, avant d'ouvrir l'appli.
- **Set Rank 1** : build des meilleurs joueurs du champion (Lolalytics), rangé comme le build classique.
- **Build** : objet recommandé = le plus acheté (comme Lolalytics) ; toujours le build de la Faille, même en ARAM ;
  « · Recommandé » à la fin du meilleur set ; sets par famille complétés.
- Augments : classement et taux de choix d'arammayhem.com (le site ne publie plus les taux de victoire).

## 1.3.1 (17/10/2026)
- Le bouton « Vérifier maintenant » devient « Redémarrer l'appli » quand une mise à jour est prête.

## 1.3.0 (17/10/2026)
- Paramètres et onglet Build allégés ; démarrage avec Windows imposé.
- Onglets Classée, Missions et Butin retirés.
- Chronos des sorts : panneau déplaçable, lancement automatique par les pings du chat.
- Set d'objets « Champion Rank 1 » ; set principal sélectionné d'office dans la boutique.

## 1.2.0 (16/10/2026)
- **Version Mac (bêta)**.
- Temps passé sur LoL (onglet Stats et Accueil).
- Plusieurs sets d'objets pour les champions qui se jouent de plusieurs façons.

## 1.1.1 (14/10/2026)
- Correction du set d'objets refusé par le client (trop gros) ; optimisations.

## 1.1.0 (11/10/2026)
- **Mise à jour automatique** depuis les Releases GitHub.
- Conseiller de draft, bans par rôle, chronos des sorts adverses, page de runes et sorts d'invocateur automatiques.
