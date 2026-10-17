# LoL Companion : règles du projet

Appli de bureau Electron qui lit le client League of Legends via son API locale (LCU), sans clé API.
Ces règles s'appliquent à **toutes** les modifications du projet.

## Sécurité et architecture
- Toute lecture/écriture de fichiers et tout appel au client League se font dans le **processus principal**
  (`main.js` et les modules Node à la racine), jamais dans la page.
- La page (`src/`) passe **uniquement** par `preload.js` (`contextBridge`, objet `window.appli`).
- Garder `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` et la Content-Security-Policy de `src/index.html`.
- L'appli ne se connecte **jamais à Internet** : uniquement l'API locale du client (`127.0.0.1`).
  Le certificat auto-signé du client n'est accepté que pour ces appels (agent HTTPS / option WebSocket dédiés),
  jamais globalement (`NODE_TLS_REJECT_UNAUTHORIZED` interdit).
- **Seules exceptions (décidées par le propriétaire le 02/10/2026)** : les statistiques de builds, parce que le client
  ne fournit aucune statistique d'objets.
  - OP.GG : serveur public prévu pour les applis (`https://mcp-api.op.gg/mcp`, `opgg.js`) : runes, sorts, objets en secours ;
  - Lolalytics : page publique du build (`https://lolalytics.com/lol/<champion>/build/`, `lolalytics.js`) : objets
    emplacement par emplacement. Pas d'accès prévu pour les applis (aucune autre source trouvée) : identification
    honnête (User-Agent), une page par champion / voie / mode toutes les 3 h au plus, et retour à OP.GG si la page change.
  - arammayhem.com : taux de victoire des augments ARAM Mayhem (`arammayhem.js`, pages publiques, robots.txt
    « Allow: / »), avec les mêmes règles que Lolalytics (User-Agent honnête, cache 3 h, seul le nom du champion dans
    l'adresse). La lecture des cartes à l'écran (`ocr.js`, OCR de Windows, ou Vision sur Mac) reste 100 % locale, et
    seulement pendant une ARAM Mayhem ; l'overlay n'affiche que des stats, il ne choisit jamais.
    **Activé d'office, sans case** (décision du propriétaire, 17/10/2026, pour alléger l'onglet Build).
  - Conseiller de draft (`draft.js`, décidé le 04/10/2026) : Lolalytics encore (tier list du poste, page de chaque
    adversaire verrouillé pour ses matchups, API `a1.lolalytics.com/mega/?ep=build-team` pour les synergies des
    alliés), mêmes règles. Case de l'onglet Sélection ; il propose seulement, ne choisit jamais.
  - Mise à jour automatique (`mise-a-jour.js`, electron-updater, décidé le 11/10/2026) : lecture de la dernière Release
    de github.com/mohamed-ali-akir/lol-companion (latest.yml + installateur, empreinte sha512 vérifiée). Seule
    exception **activée par défaut** (désactivable : Paramètres → Mises à jour) ; n'envoie rien de personnel ;
    jamais de redémarrage forcé (bandeau, ou installation en quittant). Publication : étiquette `vX.Y.Z` →
    `.github/workflows/publier.yml`. Sur Mac (16/10/2026, appli non signée) : vérification seulement, même adresse
    (latest.yml de la dernière Release, via `internet.js`), et le bandeau ouvre la page des Releases (adresse fixe).
  - Set « Champion Rank 1 » (`rank1.js`, décidé le 17/10/2026) : OP.GG encore (outils lol_list_champions,
    lol_list_champion_leaderboard, lol_list_summoner_matches). En plus du champion, on envoie le SERVEUR du compte
    (EUW...) et le Riot ID PUBLIC des meilleurs joueurs du classement (jamais celui du joueur) ; leur Riot ID n'est ni
    affiché, ni gardé (seul leur rang l'est). Case séparée de l'onglet Build, désactivée par défaut.
  Règles communes (User-Agent honnête, cache 3 h, délai maximal, erreurs claires) : écrites une seule fois dans
  `internet.js` (14/10/2026). Tout nouvel appel à Internet doit passer par ce module.
  Conditions à garder : désactivé par défaut (case de l'onglet Build, ou Sélection pour le conseiller ; sauf les
  augments, voir plus haut), lecture seule, appels uniquement depuis le
  processus principal, certificats vérifiés normalement, et on n'envoie QUE champion / rôle / mode / langue
  (jamais Riot ID, puuid, ni aucune donnée personnelle). Aucune autre adresse Internet.

## Client League (LCU)
- Avant de coder sur un endpoint que l'appli n'utilise pas encore, vérifier son existence et le format de sa
  réponse (sur le client lancé si possible, sinon dans la documentation de la communauté).
- Lectures **tolérantes** : un champ manquant ou inattendu ne doit jamais faire planter l'appli
  (valeur ignorée, message clair, ou valeur par défaut).
- Toute action qui **modifie** quelque chose dans le client (accepter une partie, créer une page de runes...) :
  désactivée par défaut, activable dans l'onglet Paramètres ou Build, et appliquée uniquement au compte connecté.
  Seule exception (décision du propriétaire, 17/10/2026) : le set d'objets « LoL Companion » n'a plus de case ; il est
  créé dès que « Récupérer le build de mon champion » est coché (case désactivée par défaut).
- **Interdit** (règles de Riot) : révéler les pseudos en sélection des champions, donner une information en jeu
  que les joueurs n'ont pas normalement.
- **Exception décidée par le propriétaire (02/10/2026)** : pick et ban automatiques (`selection.js`), contraires aux
  règles de Riot, acceptés en connaissance du risque pour son compte. Garde-fous à conserver : désactivés par défaut,
  délai avant d'agir, uniquement l'action du joueur connecté, rien si le joueur survole ou choisit lui-même,
  jamais un champion survolé ou déclaré par un coéquipier.
- **Alerte des objectifs et chrono des réapparitions** : supprimés le 17/10/2026 (choix du propriétaire). La lecture
  de l'API officielle Live Client Data (`127.0.0.1:2999`, lecture seule) reste dans `jeu.js`, pour les chronos des sorts.
- **Exception décidée par le propriétaire (10/10/2026)** : chronos des sorts d'invocateur adverses (`sorts.js`),
  comme Porofessor ou Blitz. Garde-fous : case désactivée par défaut, le joueur CLIQUE lui-même quand il voit un sort
  utilisé (l'appli ne le devine jamais), seuls les objets visibles comptent (bottes de lucidité), aucun pseudo affiché.
- **Exception décidée par le propriétaire (16/10/2026)** : démarrage AUTOMATIQUE d'un chrono de sort adverse quand un
  joueur de ton équipe (ou toi) le signale par un ping, lu dans le chat du jeu (`pings.js`, OCR local de l'écran ;
  message « Pseudo (Champion): ChampionEnnemi Sort »). Garde-fous : désactivé par défaut, avec la MÊME case que les
  chronos (une seule case depuis le 17/10/2026, choix du propriétaire), seulement les pings visibles par l'équipe, seulement les 5 adversaires et LEURS sorts
  d'invocateur, jamais un ultime ni une rune ; un chrono déjà lancé n'est pas relancé ; un clic l'annule comme
  avant ; rien d'autre du chat n'est lu, gardé ou affiché (aucun pseudo).
- **Toujours interdit** : chronos des ULTIMES adverses (interdits par Riot depuis le 13/03/2025, même manuels),
  camps de la jungle adverse, et tout ce qui n'est pas annoncé ou visible dans le jeu.

## Code de la page
- `src/calculs.js` : fonctions pures uniquement (aucun accès à `document` ni à `window.appli`),
  importables dans Node (`module.exports` en bas du fichier) et chargées dans la page par un `<script>` classique.
- Un fichier par onglet dans `src/onglets/`, chargés dans l'ordre par `src/index.html`,
  puis `src/app.js` qui démarre l'appli. Voir le commentaire en haut de `src/app.js`.

## Tests
- Les calculs sont des fonctions pures exportées et testées avec `node:test`, cas limites compris
  (liste vide, données abîmées, valeurs manquantes).
- Les appels au client sont testés avec un **faux client** HTTPS/WebSocket sur 127.0.0.1
  (voir `test/lcu.test.js` et `test/surveillance.test.js`, certificat dans `test/fixtures/`).
- `npm test` doit passer à la fin de chaque changement. Lancer l'appli (`npm start`) pour vérifier le résultat.

## Dépendances et documentation
- **Aucune nouvelle dépendance** sans l'accord explicite du propriétaire du projet.
- Mettre à jour le `README.md` à chaque fonctionnalité (fonctionnalités, structure, données enregistrées).
- Expliquer chaque changement simplement, **en français** : le propriétaire doit pouvoir l'expliquer en entretien.
