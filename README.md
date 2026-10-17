# LoL Companion

**Compagnon de bureau pour League of Legends** (Windows, Mac en bêta). Il lit ton compte directement dans le client
lancé sur ton PC, sans clé API ni compte à créer : niveau et progression, session du jour, stats par champion,
maîtrise, conseiller de draft, build automatique (runes, set d'objets, sorts) et aides en jeu.

**[⬇ Télécharger la dernière version](https://github.com/mohamed-ali-akir/lol-companion/releases/latest)**
(`LoL-Companion-Setup-x.y.z.exe`) · les versions suivantes s'installent toutes seules.

![Accueil : bilan de session et résumé](docs/captures/accueil.png)

*Captures faites avec un compte fictif et un faux client League (les icônes des champions n'y apparaissent pas ;
avec le vrai client, ce sont celles du jeu). Le build de l'onglet Build vient des vraies statistiques publiques
(Lolalytics, OP.GG).*

## En bref

- **Rien à taper** : dès que League est ouvert, l'appli lit ton Riot ID, ton niveau et tes parties, puis se met à jour
  toute seule après chaque partie. Client fermé, elle affiche tes dernières données.
- **Toujours là** : l'appli installée se lance avec Windows, réduite près de l'horloge, et te prévient quand League
  est détecté. La croix cache la fenêtre ; pour quitter : clic droit sur l'icône → Quitter.
- **Rien d'imposé** : tout ce qui agit sur le client (acceptation, pick/ban, runes, sorts) est **désactivé par
  défaut** et s'active d'une case.
- **Respect de ta vie privée** : tes données restent sur ton PC ; les seuls appels à Internet envoient des noms de
  champions, de postes et de modes, jamais ton Riot ID (voir [Sécurité](#sécurité)).

## Les onglets

| Onglet | Ce qu'il montre |
|---|---|
| **Accueil** | Le bilan de ta session (parties, V/D, XP gagnée, temps de jeu, meilleur champion), puis une carte par sujet : niveau, objectif, rythme, acceptation auto, stats, temps passé sur LoL, maîtrise. Chaque carte ouvre l'onglet détaillé |
| **Niveau** | Le calculateur : parties, heures et jours restants avant ton niveau visé, pour 4 modes, et ta courbe de progression |
| **Stats** | Taux de victoire et KDA par champion et par mode, meilleurs champions, moments où tu gagnes le plus (30 jours ou tout), import de tout ton historique, temps passé sur LoL depuis la création du compte |
| **Maîtrise** | Les champions les plus proches du niveau suivant (points et marques manquants, ≈ parties restantes), tes plus joués, la liste complète |
| **Sélection** | Conseiller de draft (les 5 meilleurs champions pour la draft en cours, avec la raison) et pick/ban automatiques par rôle |
| **Build** | Build de ton champion (Lolalytics + OP.GG) : page de runes, set d'objets et sorts créés pour toi, set « Champion Rank 1 », chronos des sorts adverses, consultation du build de n'importe quel champion |
| **Paramètres** | Accepter automatiquement les parties, mises à jour, dossier du jeu |

<details>
<summary><strong>Voir une capture de chaque onglet</strong></summary>

### Niveau
![Onglet Niveau](docs/captures/niveau.png)

### Stats
![Onglet Stats](docs/captures/stats.png)

### Maîtrise
![Onglet Maîtrise](docs/captures/maitrise.png)

### Sélection
![Onglet Sélection](docs/captures/selection.png)

### Build
![Onglet Build](docs/captures/build.png)

### Augments en jeu (ARAM Mayhem)
![Stats des augments sous chaque carte, en jeu](docs/captures/apercu-augments.png)

### Paramètres
![Onglet Paramètres](docs/captures/parametres.png)

### Petite fenêtre (420 px de large)
![Accueil dans une petite fenêtre](docs/captures/petite-fenetre.png)

</details>

## Fonctionnalités en détail

### Suivi du compte
- **Bilan de session** (Accueil) : parties, victoires / défaites, XP gagnée (estimée, hors missions), temps de jeu et
  meilleur champion. La session commence à ta première partie du jour ; une soirée sans vraie pause (moins de
  45 min entre deux parties) continue après minuit.
- **Niveau** : niveau visé (30 proposé pour la classée, sinon le prochain palier de 25) et temps de jeu par jour.
  Calcul pour ARAM du Chaos, ARAM, Swiftplay et Draft avec **ta** durée moyenne et **ton** taux de victoire (valeurs
  moyennes si tu n'as pas assez de parties), le mode le plus rapide mis en avant, 2 min d'attente comptées par partie,
  boosts d'XP (l'XP des missions n'est pas comptée). Courbe de ton XP dans le temps, rythme réel sur 7 jours et date
  estimée. Fonctionne au-delà du niveau 50.
- **Stats** : par champion (tableau triable) et par mode, 3 meilleurs champions, taux de victoire selon le moment de
  la journée et le jour de la semaine, série en cours. Périodes **30 derniers jours** et **Tout**. Les parties sont
  gardées sur ton PC, et **« Importer tout mon historique »** remonte l'historique du client aussi loin qu'il le permet.
- **Temps passé sur LoL** (Stats et Accueil, comme wol.gg mais sans clé API ni site extérieur) : le client ne garde
  qu'une vingtaine de parties et n'a plus de statistiques de carrière. Le temps est donc **compté** sur les parties
  enregistrées par l'appli (durée exacte + 2 min d'attente par partie) et **estimé** depuis la création du compte
  (XP totale divisée par l'XP d'une partie moyenne pour toi : un ordre de grandeur). On affiche le plus grand des
  deux, avec quelques stats amusantes (films de 2 h, heures par semaine, plus longue partie, modes et champions où tu
  as passé le plus de temps). Fonction `tempsDeJeu` de `src/calculs.js`.
- **Maîtrise** : points restants et **marques de maîtrise** manquantes (système de 2024), avec la note à obtenir pour
  en gagner. Estimation « ≈ N parties » à partir de ta moyenne de points par partie sur ce champion, mesurée par
  l'appli après tes parties. Recherche et tri (par points ou par proximité du niveau suivant).

### Sélection des champions
- **Acceptation automatique** (Paramètres, une seule case, désactivée par défaut) : accepte la partie trouvée après
  2 s, jamais si tu as déjà répondu, jamais deux fois la même. Notification « Partie trouvée ! » si League n'est pas au
  premier plan.
- **Conseiller de draft** (Sélection, désactivé par défaut, comme iTero.gg en plus simple) : l'appli classe **les
  champions que tu peux jouer** à ton poste et affiche les 5 meilleurs, mis à jour à chaque champion verrouillé :
  « Nasus 57,6 % · +3,1 contre Zed · +2,1 contre Yasuo · +0,7 avec Lee Sin ». Le score part du taux de victoire du
  champion à ton poste (Lolalytics, Émeraude et plus), corrigé par chaque **adversaire** (matchup) et chaque **allié**
  (synergie) verrouillés, plus un petit bonus selon **tes** parties sur ce champion (± 2 points au plus). Jamais un
  champion banni ou déjà pris. Il ne fait que proposer.
- **Pick et ban automatiques** (Sélection, désactivés par défaut, ⚠ contraires aux règles de Riot : voir
  [Sécurité](#sécurité)) : quand c'est **ton** tour, l'appli verrouille ton champion après **10 s** (ban : **5 s**),
  réglables. 3 choix dans l'ordre (si le 1er est banni ou déjà pris, le 2e, puis le 3e), une liste par rôle (Haut,
  Jungle, Milieu, Bas, Support) **pour les picks comme pour les bans**, plus une liste « Par défaut ». Jamais un
  champion banni, déjà pris, survolé ou déclaré par un coéquipier ; rien si tu choisis toi-même pendant le délai.

### Build automatique (onglet Build)
Chaque option est désactivée par défaut ; c'est autorisé par Riot, comme Blitz ou Porofessor. Quand ton champion est
verrouillé (ou attribué en ARAM), l'appli lit les **vraies statistiques** de **Lolalytics** (objets emplacement par
emplacement) et d'**OP.GG** (runes, sorts) pour ce champion et ton rôle, **toujours celles de la Faille**, même en
ARAM (choix du 17/10/2026 ; en ARAM, le rôle est le rôle principal du champion, et seuls les sorts d'invocateur
viennent des stats ARAM, puisque Téléportation ou Châtiment n'y existent pas), puis :
- compose le build comme Lolalytics : **Départ, Objet 1, Bottes, Objets 2 à 5**, chacun avec **3 choix** (le
  recommandé + 2 pour t'adapter), avec taux de victoire, part des achats, nombre de parties et minute d'achat
  (« ⚠ peu de données » sous 200 parties). Si Lolalytics ne répond pas, le build d'OP.GG prend le relais ;
- crée la **page de runes** « Hwei · Mid · LoL Companion » (runes d'OP.GG, ou celles recommandées par Riot en secours) ;
- crée le **set d'objets** « LoL Companion - Champion (Rôle) », visible et sélectionné d'office dans la boutique en
  jeu ; un champion qui se joue de plusieurs façons (Vi combattant ou létalité, Kayn rouge ou bleu...) a un set par
  façon (`familles.js`). Le meilleur set (le build général, ou la façon la plus jouée) finit par **« · Recommandé »** ;
- choisit tes **sorts d'invocateur** (sa case) : les plus joués d'après OP.GG, chaque sort gardé sur ta touche
  habituelle (si Flash est sur F, il y reste) ;
- ajoute le **set « Champion Rank 1 »** (sa case) : le build des **meilleurs joueurs** du champion, rangé comme le
  build classique (Départ, Objet 1, Bottes, Objets 2 à 5, 3 choix chacun avec taux de victoire et part des achats).
  Il vient de Lolalytics, filtre « 1trick » (jusqu'à 50 des meilleurs joueurs du champion par région, Diamant IV et
  plus, 50 parties au moins dessus), ou Maître et plus s'il y a moins de 300 parties. Avant le 17/10/2026, il venait
  du n° 1 du classement d'OP.GG, qui ne donne que l'inventaire de fin de partie : pas d'ordre d'achat, donc pas
  d'Objet 1, 2, 3.

Tes autres pages de runes et sets (Porofessor...) ne sont jamais modifiés. Tu peux aussi **consulter le build** de
n'importe quel champion, rôle et mode, sans rien appliquer.

### En jeu
Le jeu doit être en mode **« Sans bordure »** (Échap → Vidéo → Mode de la fenêtre) : en plein écran, Windows ne
peut rien afficher par-dessus. L'onglet Build le rappelle.
- **Augments ARAM Mayhem** (toujours actif) : quand les 3 augments sont proposés, l'appli affiche **sous chaque carte**
  son **classement** et son **taux de choix** d'arammayhem.com (« Top 3 · choisi 64 % »), avec **ton champion** si l'augment est dans
  ses meilleurs, et met en avant la meilleure carte (cadre doré), d'après la note du site (S+, S, A...). Le site ne
  publie plus de taux de victoire par augment depuis octobre 2026 (ni sur ses pages, ni dans son serveur MCP).
  Appli lancée en pleine partie : le champion est lu dans la partie en cours. Elle ne choisit jamais à ta place ([aperçu](docs/captures/apercu-augments.png)).
- **Chronos des sorts d'invocateur adverses** (Build, désactivé par défaut, ⚠ voir [Sécurité](#sécurité)) : un petit
  panneau avec les 5 adversaires et leurs 2 sorts. Quand tu vois un sort utilisé, **tu cliques dessus** : le compte à
  rebours démarre (bottes de lucidité comptées, TP déchaînée après 10:00) ; un 2e clic l'annule. Le chrono démarre
  aussi tout seul quand un allié (ou toi) **pingue** le sort dans le chat. Le panneau se déplace en le glissant par sa
  poignée (« ⠿ ⠿ ⠿ ») ; sa place est gardée ; double-clic sur la poignée pour le remettre en haut à gauche.
  Jamais les ultimes : Riot les interdit.

### Arrière-plan et mises à jour
- **Icône près de l'horloge** (Ouvrir, Acceptation auto à cocher, Quitter). L'appli installée **se lance avec
  Windows**, réduite, et se connecte toute seule dès que League s'ouvre ; notification **« LoL Companion est prêt »**
  quand League est détecté et que la fenêtre est cachée. Une seule copie tourne à la fois.
  `"LoL Companion.exe" --quitter` ferme l'appli déjà ouverte **proprement**, comme « Quitter » (une mise à jour prête
  s'installe alors), au lieu de la tuer.
- **Mises à jour automatiques** depuis les Releases GitHub (voir [Mises à jour](#mises-à-jour)) : la nouvelle version
  se télécharge en arrière-plan, puis le bouton « Vérifier maintenant » devient **« Redémarrer l'appli »**.

## Installation

**Pour simplement utiliser l'appli** : télécharge `LoL-Companion-Setup-x.y.z.exe` sur la page
[Releases](https://github.com/mohamed-ali-akir/lol-companion/releases/latest) et lance-le. Windows affiche « Windows a
protégé votre ordinateur » (l'appli n'est pas signée) : « Informations complémentaires » puis « Exécuter quand même ».
Ensuite, les nouvelles versions arrivent toutes seules (voir « Mises à jour » plus bas).

**Pour travailler sur le code**, il faut [Node.js](https://nodejs.org) (version 24 ou plus : c'est celle de `.nvmrc`, utilisée aussi
par GitHub et annoncée dans `engines` de `package.json`) et League of Legends installé sur le même PC.

```bash
git clone https://github.com/mohamed-ali-akir/lol-companion.git
cd lol-companion
npm install
npm start
```

Lance le client League et connecte-toi : l'appli récupère tout automatiquement. La toute première fois, le client doit
être lancé (l'appli ne devine pas ton niveau). Le jeu est installé ailleurs que `C:\Riot Games\League of Legends` ?
Change le dossier dans **Paramètres**.

**Au quotidien, utilise l'appli installée** : `npm run build` crée `dist\LoL Companion Setup <version>.exe` ; une fois
installée (dans `%LOCALAPPDATA%\Programs\lol-level-calculator`), c'est **elle seule** qui se lance au démarrage de
Windows. Lancée depuis le projet (`npm start`, VS Code), l'appli ne s'inscrit jamais au démarrage de Windows (sinon
deux versions se lançaient en même temps, et une ancienne pouvait prendre la place de la nouvelle) ; et si Windows la
relance quand même toute seule (`--reduit`, par exemple en rouvrant les applis après un redémarrage), elle s'arrête
aussitôt pour laisser la place à l'appli installée. Pour tester une
modification avec `npm start`, quitte d'abord l'appli installée (clic droit sur l'icône → Quitter) : une seule copie
tourne à la fois. Les deux partagent les mêmes réglages (`%APPDATA%\lol-level-calculator`).

Depuis Electron 42, `npm install` ne télécharge plus Electron : il se télécharge tout seul au premier `npm start`
(environ 100 Mo, une seule fois).

**Dépannage (Windows)** : si `npm start` dit qu'Electron n'est pas installé correctement, lance
`.\reparer-electron.ps1` dans PowerShell. Il décompresse Electron avec l'outil `tar` de Windows (contourne un bug de
décompression rencontré avec certaines versions récentes de Node.js), puis relance les tests.

| Commande | Rôle |
|---|---|
| `npm start` | Lance l'appli |
| `npm test` | Lance les tests (413, dont 2 seulement sur Mac) |
| `npm run build` | Crée l'installateur dans `dist/` (sans le publier) |
| `npm run essai` | Essai de bout en bout : la vraie appli sur un faux client League (compte fictif), chaque onglet ouvert, aucune erreur tolérée. `CAPTURES=docs/captures npm run essai` refait aussi les captures du README |
| `npm run sonde` | Vérifie que Lolalytics, OP.GG et arammayhem.com répondent toujours comme prévu (lancée aussi chaque jour par GitHub : `sonde.yml`, qui ouvre une issue si un site a changé) |

Les tests et l'essai de bout en bout tournent aussi sur GitHub à **chaque envoi** sur `main` (`.github/workflows/tests.yml`).
**Dependabot** (`.github/dependabot.yml`) propose chaque lundi les mises à jour des paquets npm (Electron compris) et
des actions GitHub, sous forme de pull requests testées comme le reste : rien ne change sans qu'on les fusionne.
Une version majeure (ex. Electron 45) arrive seule : lire ses changements cassants avant de l'accepter.

### Mises à jour

L'appli installée regarde sur GitHub (dernière Release du dépôt public) s'il existe une version plus récente :
15 s après le démarrage, puis toutes les 6 h (`mise-a-jour.js`, avec **electron-updater**). Si oui, elle la télécharge en
arrière-plan, vérifie son empreinte (sha512 du fichier `latest.yml`), puis affiche le bandeau **« Redémarrer et mettre
à jour »**. Si tu l'ignores, elle s'installe quand tu quittes l'appli : jamais de redémarrage forcé. Désactivable dans
**Paramètres → Mises à jour** (bouton « Vérifier maintenant » à côté de la version ; il devient « Redémarrer l'appli » quand une version est prête).

**Au lancement** (Windows, depuis la 1.3.2) : l'appli regarde d'abord s'il existe une nouvelle version ; si oui, elle
l'installe **avant de s'ouvrir** (petite fenêtre « Mise à jour de LoL Companion… », rien au démarrage de Windows en
réduit), puis se relance dedans (`majAuDemarrage` de `mise-a-jour.js`). Jamais bloquant : sans réponse de GitHub en
10 s, sans Internet, ou si le téléchargement dépasse 3 min, l'appli s'ouvre normalement et finit en arrière-plan.

**Publier une nouvelle version** :
1. changer `"version"` dans `package.json` (ex. `1.1.0` → `1.2.0`), puis `npm install --package-lock-only` ;
2. commit et push, puis envoyer l'étiquette : `git tag v1.2.0` et `git push origin v1.2.0` ;
3. GitHub Actions (`.github/workflows/publier.yml`) lance les tests sur un PC Windows, fabrique l'installateur et le
   publie dans les Releases avec `latest.yml`. Aucun secret à créer : GitHub fournit un jeton pour cette exécution.

Les applis déjà installées voient la nouvelle version au plus tard 6 h après (ou tout de suite avec « Vérifier
maintenant »). Une version 1.0.0 (sans mise à jour automatique) doit être remplacée une fois à la main.

### Sur Mac (bêta, pas encore testée)

Une version Mac existe, mais elle n'a pas encore été essayée sur un vrai Mac.
- **Fabrication** : un `.dmg` ne se fabrique que sur un Mac (un Mac de GitHub, gratuit pour un dépôt public) :
  - à chaque version publiée (étiquette `vX.Y.Z`), le job `mac` de `publier.yml` dépose
    `LoL-Companion-X.Y.Z-mac.dmg` (Intel et Apple Silicon) dans la même Release, APRÈS le job Windows qui l'a créée ;
  - pour un essai sans rien publier : onglet **Actions** → **Construire pour Mac** → *Run workflow*
    (`mac.yml`) ; le `.dmg` est à télécharger en bas de la page de l'exécution (*Artifacts*, gardé 14 jours).
- **Installation** : ouvrir le `.dmg` et glisser LoL Companion dans *Applications*. L'appli n'est pas signée par
  Apple (compte développeur à 99 $ par an) : macOS la dit « endommagée » ou « d'un développeur non identifié ».
  Pour la débloquer une fois, dans le Terminal :
  ```bash
  xattr -cr "/Applications/LoL Companion.app"
  ```
- **macOS 13 (Ventura) ou plus récent** : Electron 44 ne fonctionne plus sur macOS 12.
- **Différences avec Windows** :
  - **notifications** (« Partie trouvée ! »...) : depuis Electron 42, macOS refuse les notifications d'une appli qui
    n'est pas signée par un développeur Apple. La nôtre ne l'est pas : la notification n'apparaît pas, et l'échec est
    noté dans le journal (`montrerNotification` dans `main.js`). Le reste de l'appli fonctionne ;
  - dossier du jeu par défaut : `/Applications/League of Legends.app/Contents/LoL` (là où le client écrit son lockfile) ;
  - menu de l'appli en haut de l'écran (LoL Companion, Édition, Fenêtre) : c'est lui qui fait marcher Cmd+C, Cmd+V,
    Cmd+A, Cmd+Z dans les champs de texte, et Cmd+Q / Cmd+H (`modeleMenuMac` dans `arriere-plan.js`) ;
  - overlay en jeu (augments, chronos des sorts) : affiché sur tous les bureaux, y compris celui d'un jeu en plein
    écran (`setVisibleOnAllWorkspaces`, sinon il resterait sur le bureau normal) ;
  - notification « Partie trouvée » seulement si League n'est pas au premier plan : sur Mac, l'appli au premier plan
    est lue avec `lsappinfo` (fourni avec macOS, aucune autorisation à donner) ;
  - « Démarrer réduit » : macOS ne passe pas d'argument aux applis lancées à l'ouverture de session ; l'appli se fie à
    ce que dit macOS, ou à un Mac allumé depuis moins de 3 minutes (sinon la fenêtre s'ouvre normalement) ;
  - textes adaptés : « notification macOS », « au démarrage du Mac » (attribut `data-mac` dans `src/index.html`) ;
  - **stats des augments** : la carte est capturée avec `screencapture` puis lue par **Vision**, l'OCR de macOS,
    appelé avec `osascript -l JavaScript` (tous deux fournis avec macOS : rien à installer). `screencapture` compte
    en points (écran Retina : pixels ÷ 2) et Vision donne des fractions de l'image depuis le BAS : `ocr.js` remet tout
    en pixels depuis le haut, comme sous Windows. macOS demande l'autorisation **« Enregistrement de l'écran »**
    (Réglages Système → Confidentialité et sécurité) ; tant qu'elle manque, l'onglet Build l'explique ;
  - **mise à jour** : sans signature Apple, electron-updater ne peut rien installer. L'appli Mac vérifie donc
    seulement (15 s après le démarrage puis toutes les 6 h, même case « Mises à jour ») : elle lit `latest.yml` de
    la dernière Release et, si la version est plus récente, un bandeau propose **« Télécharger la nouvelle
    version »**, qui ouvre la page des Releases (adresse fixe dans le code). Il reste à installer le `.dmg` à la main.
  Tout cela est testé sous Windows avec de faux résultats Mac. Seul le vrai OCR Vision est testé sur un Mac de
  GitHub (`test/ocr-mac.test.js`, sauté sous Windows) ; rien n'a encore été essayé sur un vrai Mac.

## Technologies

- **Electron 44** : l'interface web devient une appli de bureau (passé de la 38, plus maintenue, à la 44.9 le
  17/10/2026 ; aucune fonction supprimée entre-temps n'était utilisée par l'appli)
- **HTML / CSS / JavaScript** sans framework ; graphiques en **SVG dessinés à la main**
- **ws** : connexion WebSocket au client League
- **electron-updater** : mise à jour automatique depuis les Releases GitHub (ajoutée le 11/10/2026 avec l'accord du propriétaire)
- **node:test** : tests intégrés à Node.js, avec un faux client League (HTTPS + WebSocket) sur `127.0.0.1` ; la page
  (scripts classiques qui partagent leurs noms) est vérifiée par `test/page.test.js` : fichiers chargés, identifiants,
  fonctions appelées, ponts `preload.js` et canaux vers `main.js`, sans lancer Electron
- **electron-builder** : installateur ; **GitHub Actions** : publication des versions

## Comment l'appli parle au client League

Quand il est lancé, le client League ouvre une API sur ton propre PC (le « LCU »). Il écrit le port et un mot de passe
temporaire dans le fichier `lockfile` de son dossier d'installation. L'appli lit ce fichier, puis appelle
`https://127.0.0.1:<port>` avec l'utilisateur `riot` et ce mot de passe. C'est la même technique que Blitz ou Porofessor.

| Route | Utilisée pour |
|---|---|
| `GET /lol-summoner/v1/current-summoner` | Riot ID, niveau, progression |
| `GET /lol-match-history/v1/products/lol/current-summoner/matches?begIndex&endIndex` | Parties : durée, victoire, mode, champion, K/D/A (pages de 50 pour l'import) |
| `GET /lol-game-data/assets/v1/champion-summary.json` | Noms des champions |
| `GET /lol-game-data/assets/v1/champion-icons/<id>.png` | Icônes des champions |
| `GET /lol-champion-mastery/v1/local-player/champion-mastery` (secours : `/lol-champion-mastery/v1/<puuid>/champion-mastery`) | Maîtrise |
| `POST /lol-matchmaking/v1/ready-check/accept` | Accepter la partie (modifie le client, désactivé par défaut) |
| `GET /lol-champ-select/v1/pickable-champion-ids`, `.../bannable-champion-ids` | Champions que le client te laisse choisir / bannir |
| `PATCH /lol-champ-select/v1/session/actions/<id>` `{ championId, completed: true }` (secours : `POST .../actions/<id>/complete`) | Choisir et verrouiller (pick et ban auto : modifie le client, désactivé par défaut), puis relecture de `GET /lol-champ-select/v1/session` pour vérifier le verrouillage |
| `GET /lol-perks/v1/recommended-pages/champion/<id>/position/<rôle ou none>/map/<11 ou 12>` | Runes recommandées par Riot (3 pages ; vérifié sur le client) |
| `GET /lol-gameflow/v1/session` | Carte et mode de la partie (Faille / Abîme hurlant, classée / ARAM / URF) pour le build |
| `GET /lol-perks/v1/pages`, `GET /lol-perks/v1/inventory` | Tes pages de runes, place disponible |
| `POST /lol-perks/v1/pages`, `DELETE /lol-perks/v1/pages/<id>` | Créer / remplacer la page « LoL Companion » (modifie le client, désactivé par défaut ; jamais tes autres pages) |
| `GET` / `PUT /lol-item-sets/v1/item-sets/<summonerId>/sets` | Sets d'objets : on garde seulement les sets « LoL Companion - Champion » du champion actuel (un par façon de le jouer) et son set « Champion Rank 1 » (reconnu par son identifiant), tes autres sets sont renvoyés tels quels (modifie le client, désactivé par défaut) |

**Seules connexions à Internet : les statistiques de builds (OP.GG et Lolalytics).** Le client ne fournit aucune
statistique d'objets (`recommendedItemDefaults` est vide). Si tu coches « Récupérer le build de mon champion »
(onglet Build), l'appli envoie **seulement** le champion, le rôle et le mode (jamais ton Riot ID), avec les
certificats vérifiés normalement et les réponses gardées 3 h en mémoire. Ces règles communes (User-Agent honnête,
cache de 3 h, 20 s d'attente au plus, messages d'erreur) sont écrites une seule fois, dans `internet.js`, et
utilisées par OP.GG, Lolalytics et arammayhem.com :
- `opgg.js` interroge le serveur public qu'OP.GG met à disposition des applis
  ([OP.GG MCP Server](https://github.com/opgginc/opgg-mcp)) : `POST https://mcp-api.op.gg/mcp`, outil
  `lol_get_champion_analysis` (runes, sorts, et objets si Lolalytics ne répond pas). Il ne donne qu'une combinaison
  pour les objets 1 à 3 et une paire de bottes. (Le set Rank 1 ne passe plus par OP.GG depuis le 17/10/2026 : il
  lit la page Lolalytics du champion avec le filtre `tier=1trick`, même format que le build classique.) ;
- `lolalytics.js` lit la page publique du build : `GET https://lolalytics.com/lol/<champion>/build/?lane=<voie>`
  (ARAM / URF : `/aram/build/?tier=all`). C'est la seule source trouvée avec les objets **emplacement par emplacement**
  (recherche du 02/10/2026 : u.gg et dpm.lol n'ont pas d'accès prévu pour les applis non plus). Lolalytics n'a pas
  d'API pour ces données : l'appli lit la page comme un navigateur, en se présentant honnêtement
  (`User-Agent: LoLCompanion/1.0`), et au plus une fois par champion / voie / mode toutes les 3 h. Son `robots.txt`
  n'interdit rien et aucune condition d'utilisation trouvée ne vise l'accès automatique. Si le site change, l'appli
  revient au build d'OP.GG et le signale.
- le **conseiller de draft** (case de l'onglet Sélection) lit aussi Lolalytics, avec les mêmes règles :
  la tier list de ton poste (`/lol/tierlist/?lane=<voie>` : taux de victoire et parties de chaque champion), la page
  de chaque adversaire verrouillé (son tableau `enemy` : ses matchups par voie) et, pour chaque allié verrouillé,
  `GET https://a1.lolalytics.com/mega/?ep=build-team&patch=<patch>&c=<champion>&lane=<voie>…` (ses synergies).
  Seuls des noms de champions, de postes et le patch sont envoyés ; aucun pseudo n'est lu.

En plus, l'appli s'abonne en **WebSocket** (`wss://127.0.0.1:<port>/`, protocole WAMP) aux événements du client :
phase de jeu (`EndOfGame` = une partie vient de finir), compte,
« partie trouvée » (ready-check) et sélection des champions (`lol-champ-select/v1/session` : actions, rôle attribué,
bans, temps restant du tour). Plusieurs événements rapprochés ne déclenchent qu'une relecture ; client fermé,
l'appli réessaie toutes les 5 secondes et se reconnecte toute seule.

Les formats ont été vérifiés dans le schéma publié par la communauté
([lcu-schema](https://github.com/MingweiSamuel/lcu-schema)) et, pour la maîtrise (refonte de 2024), dans les types du
projet LeagueAkari et la doc `champion-mastery-v4` de Riot. Chaque lecture est **tolérante** : un champ manquant ou
inattendu n'est jamais une raison de planter, l'appli affiche ce qu'elle a.

### Quelques choix techniques

- **Icônes** : le client demande son mot de passe même pour les images. La page affiche `<img src="lcu-image://champion/266">`,
  un protocole maison géré par `main.js` qui va chercher l'image et la garde en cache. Seules les icônes de champions
  passent : la page ne peut pas s'en servir pour appeler une autre route.
- **Import de l'historique** : pages de 50 parties ; arrêt quand la page est vide, quand elle ne contient que des
  parties déjà vues (certains clients renvoient toujours la dernière page) ou après 400 pages. Enregistrement toutes
  les 10 pages : rien n'est perdu si le client se ferme pendant l'import.
- **Estimation de maîtrise** : le client ne dit pas combien de points chaque partie a rapportés. À chaque lecture,
  l'appli compare les points d'un champion avec la lecture précédente et compte les nouvelles parties jouées avec lui
  (« +1 800 points en 2 parties »). Si le client a mis à jour l'un mais pas encore l'autre, elle attend la lecture suivante.
- **Session** : « aujourd'hui » = parties depuis minuit, plus celles de la veille si tu jouais sans pause de plus de
  45 min au moment de minuit.
- **Acceptation automatique** : le ready-check n'a pas d'identifiant, un nouveau commence quand l'état passe à
  « `InProgress` + `playerResponse: None` » (en attente de ta réponse) depuis **n'importe quel** autre état, y compris
  « `InProgress` + `Accepted` » : quand un autre joueur refuse, le client peut enchaîner directement sur la partie
  suivante sans état intermédiaire (auparavant cette nouvelle partie était prise pour l'ancienne et jamais acceptée).
  Les mises à jour du même ready-check (le timer avance) ne déclenchent rien de plus ; `Accepted` ou `Declined`
  annule toujours une acceptation prévue. Juste avant d'accepter, l'appli revérifie tout (même partie, toujours en cours, pas encore de réponse,
  réglage toujours activé). Pour savoir si League est au premier plan, une petite commande PowerShell lit la fenêtre
  active ; en cas de doute, la notification est affichée.
- **Pick et ban automatiques** (`selection.js`) : à chaque changement de la sélection, l'appli cherche **ton** action
  en cours (`actorCellId` = `localPlayerCellId`, `isInProgress`, pas `completed`) et la prend en charge une seule fois
  (oubli à la fin de la sélection ou quand `gameId` change). Si le délai dépasse le temps restant du tour
  (`timer.adjustedTimeLeftInPhase`), elle agit 2 s avant la fin. Juste avant d'agir, elle revérifie tout (même action,
  toujours en cours, pas de champion survolé par toi, option toujours activée), avant ET après avoir lu les champions
  autorisés par le client. Vu sur le vrai client : pendant la phase de préparation (`PLANNING`), ton ban est déjà
  marqué « en cours » mais le client ignore un ban envoyé à ce moment-là, donc l'appli attend la phase `BAN_PICK`.
  Le client a aussi répondu « OK » à un verrouillage sans verrouiller : l'appli relit donc la session pour vérifier,
  essaie l'autre méthode si besoin, et sinon affiche une erreur au lieu d'un faux « OK ».
- **Conseiller de draft** (`draft.js`) : pour chaque champion C que tu peux choisir (`pickable-champion-ids` :
  possédés + rotation gratuite), score = taux de victoire de C à ton poste + Σ effets des champions **verrouillés**
  (un survol ne compte pas, il peut changer) + confort. L'effet d'un duo est le « delta 2 » de Lolalytics : l'écart
  du duo par rapport à ce qu'on attendrait des deux champions seuls (contre un adversaire, on prend l'opposé de son
  delta, puisqu'il est vu de son côté). Prudence : chaque effet est multiplié par n / (n + 1 000) (n = parties du
  duo), et le taux de base est ramené vers 50 % par n / (n + 5 000), sinon un champion joué par quelques spécialistes
  passe devant (Fiddlesticks milieu : 1 670 parties à 54 %, devant Ahri à 52,5 % sur 199 182 parties). Les champions
  à moins de 1 000 parties à ce poste ne sont pas proposés. Confort : ton taux de victoire sur le champion, lissé
  par 5 victoires + 5 défaites fictives, + 0,05 point par partie jouée (20 au plus), borné à ± 2 points. Recalcul
  seulement quand la draft change (nouveau pick, ban) ; un calcul plus ancien et plus lent n'écrase jamais le
  nouveau. Si les données d'un adversaire manquent, il n'est pas compté et l'appli le dit.
- **Lecture de la partie** (`jeu.js`) : pendant une partie sur la Faille (carte 11 dans `/lol-gameflow/v1/session`),
  les chronos des sorts lisent le jeu toutes les secondes avec l'API officielle « Live Client Data » que le jeu ouvre
  sur ton PC (`GET https://127.0.0.1:2999/liveclientdata/allgamedata` → `gameData.gameTime`, `allPlayers`, sans mot de
  passe ; certificat de Riot accepté seulement pour cet appel, comme pour le client). La lecture est **partagée**
  (`creerLectureJeuPartagee`) : plusieurs lectures dans la même seconde n'interrogent le jeu qu'une fois.
  L'**alerte des objectifs** (bandeau avant le dragon, le Baron... et leurs réapparitions) a été supprimée le
  17/10/2026.
- **Chronos des sorts** (`sorts.js`) : temps de recharge vérifiés le 10/10/2026 (Flash 300 s, Ignite 180, TP 300 puis
  330 → 240 selon le niveau après 10:00, Heal/Exhaust/Ghost/Cleanse 240, Barrière 180) ; accélération : Bottes
  ioniennes de lucidité +10, Lucidité pourpre +20 (la rune Perspicacité cosmique est invisible pour l'adversaire,
  donc pas comptée) ; temps = base / (1 + accélération / 100). Le temps de jeu entre deux lectures est estimé avec
  l'horloge du PC, pour qu'un clic tombe à la bonne seconde. La fenêtre transparente laisse passer les clics
  (`setIgnoreMouseEvents(true, { forward: true })`) et ne les prend que quand la souris est sur le panneau ; elle ne
  prend jamais le clavier au jeu (`focusable: false`). Le panneau partage la fenêtre transparente des augments,
  cachée quand il n'y a rien.
- **Pings des sorts lus dans le chat** (`pings.js`, `image.js` ; même case que les chronos, désactivée par défaut, exception
  décidée le 16/10/2026) : quand un allié (ou toi) clique sur le sort d'un adversaire dans le tableau des scores, le
  jeu écrit « Pseudo (Champion): ChampionEnnemi Sort » (ex. « wDark (Ashe): Vex Flash »), sans heure ni temps
  restant. Aucune API ne donne le chat : chaque seconde, l'appli capture la zone du chat (en bas à gauche, à sa place
  par défaut), la **nettoie** (agrandie 3 fois, seuls les pixels du texte gardés, en noir sur blanc : sans ça, l'OCR
  lisait « V c y Rash » pour « Vex Flash »). Un pixel est gardé s'il a une **teinte du chat** (rouge, orange, jaune ou bleu :
  le vert de l'herbe ne passe jamais ; le nom du sort est parfois jaune pur) et s'il est assez vif par rapport aux pixels les plus vifs de la
  zone : ce **seuil adaptatif** suit la lumière du décor (le texte paraît terne sur un fond sombre ; avec un seuil
  fixe, plus aucun ping n'était retrouvé une fois les captures assombries). Puis l'appli la lit avec l'OCR du système et cherche à la FIN de
  chaque ligne un des 5 adversaires suivi d'un de SES sorts. Les erreurs de lecture courantes sont tolérées
  (« Karnna », « K a I-nn a » pour « Karma ») ; jamais les lignes « Wait For… » (ses propres sorts), les runes ni les
  alliés. Le chrono démarre au moment du ping, jamais relancé s'il tourne déjà ; un clic l'annule. Un message pouvant
  rester plus de 30 s à l'écran, l'appli **compte** les lignes de chaque sort : un ping n'est nouveau que si une ligne
  de plus apparaît (un chrono annulé n'est donc jamais relancé par un vieux message). Essai sur 7 vraies captures,
  normales et assombries jusqu'à 30 % : 5 pings retrouvés sur 5, aucune fausse détection, environ 100 ms par lecture
  sous Windows. Les captures
  sont effacées aussitôt ; seuls les pings reconnus (champion + sort, jamais de pseudo) vont dans le journal.
- **Build** (`build.js`, `lolalytics.js`, `opgg.js`, `runes.js`) : l'appli attend que ton pick soit verrouillé
  (`completed`) ; en ARAM, où il n'y a pas d'action « pick », le champion attribué suffit, et une relance de champion
  refait tout. Une seule fois par champion et par sélection. Sans rôle attribué, elle prend le rôle principal du
  champion d'après les runes recommandées par Riot. Lolalytics et OP.GG sont lus en parallèle (quelques secondes).
  - **3 choix par emplacement (Lolalytics)** : le choix **recommandé** est l'option **fiable** (au moins 10 % des
    achats de cet emplacement **et** 200 parties) la **plus achetée**, comme le build affiché par Lolalytics : il suit
    le chemin de la majorité des joueurs, donc reste cohérent d'un emplacement à l'autre. Les 2 autres choix (pour
    t'adapter) : les options fiables, puis celles à au moins 2 % et 200 parties, puis le reste ; dans chaque groupe,
    classement par **borne basse de Wilson** à 95 % (voir ci-dessous). Jusqu'au 17/10/2026, le recommandé était lui
    aussi classé à la borne de Wilson : un objet un peu moins acheté mais avec 1 point de victoire en plus passait
    devant, et le build changeait de style (Kayle en ARAM : Dent de Nashor puis Terminus et Tueur de krakens, au lieu
    de Lame du roi déchu, Guinsoo, Fin de l'esprit). Un objet recommandé à un emplacement n'est plus proposé ensuite. Lolalytics donne un % de sélection sur TOUTES les parties, qui
    baisse forcément pour les derniers objets : l'appli le ramène à la part des achats de l'emplacement. L'avertissement
    « peu de données » ne dépend que du nombre de parties (aux derniers emplacements, les achats sont trop variés
    pour qu'un objet atteigne 10 %). En ARAM/URF, tous les rangs sont pris (Hwei : 48 019 parties au lieu de 3 460
    en Émeraude+). Attention aux objets « boule de neige » comme le Voleur d'âmes de Mejai : achetés quand on gagne
    déjà, leur taux de victoire est gonflé.
  - **Familles de builds** (`familles.js`) : la page Lolalytics donne les combinaisons des 3 premiers achats
    (`itemBootSet3`, bottes comprises). Chaque combinaison est rangée d'après son premier objet et ses catégories dans
    le client : AP, À l'impact, Létalité / Critique, Combattant, Tank. Les objets hybrides AD + AP à l'impact (Guinsoo,
    Statikk) et Terminus comptent « À l'impact » (avant le 17/10/2026 : Kalista avait un faux set « AP » à cause de
    Statikk). Une famille doit peser 10 % des builds et 300 parties (3 au plus). Bottes retirées, il reste souvent
    2 objets : l'objet 3 (et les suivants) du set d'une famille est pris dans **toutes** les options de l'emplacement,
    celles du style de la famille d'abord, sans les objets d'une autre famille (il manquait souvent avant).
  - **Format de Lolalytics** : la page contient ses données dans un bloc `<script type="qwik/json">` ; les valeurs
    renvoient à d'autres cases par un numéro en base 36 (`"4c6"` → case 5622). Chaque option d'objet vaut
    `[objet, % victoire, % sélection, parties, minute]`, chaque départ `["1056_2003_2003", % victoire, % sélection, parties]`.
    Noms : alias du client en minuscules, sauf `MonkeyKing` → `wukong`. Testé avec une fausse page au même format.
  - **Classement « taux de victoire + taux de sélection » (OP.GG, en secours)** : pour le 4e, 5e et 6e objet, OP.GG propose 3 options
    (pour les objets 1 à 3, il ne donne qu'une combinaison : vérifié). Une option n'est retenue que si elle est
    **fiable** : prise dans au moins **10 %** des parties **et** sur au moins **200** parties. On classe ensuite par
    **borne basse de Wilson** à 95 % (un taux de victoire « prudent » : marge d'autant plus grande qu'il y a peu de
    parties). Exemple : 59 % sur 9 000 parties passe devant 62 % sur 24 parties. Si aucune option d'un emplacement
    n'est fiable (souvent le 6e : pour Hwei, 5, 4 et 4 parties), on prend le meilleur objet fiable restant parmi les
    options des emplacements précédents. Un objet déjà dans le build n'est jamais reproposé. Les 2 autres choix de
    chaque emplacement sont affichés (« Pour t'adapter ») et regroupés dans un bloc du set d'objets en jeu.
  - **Format d'OP.GG** : la réponse n'est pas du JSON mais un texte (`class Nom: champ1,champ2` puis
    `Nom(valeur1, valeur2)`), lu par un petit analyseur testé (`analyserTexteOpgg`). Vérifié en direct : `position`
    est obligatoire et `all` / `none` sont refusés, donc en ARAM on envoie `mid` (les stats ARAM ne dépendent pas
    du rôle) ; les noms sont tolérants (`MONKEYKING`, `MONKEY_KING` et `WUKONG` marchent).
  - **Runes** : la page « LoL Companion » est supprimée puis recréée (plus simple et plus fiable qu'une
    modification) ; les pages qui ont un autre nom ne sont jamais touchées.
  - **Set d'objets** : le `PUT` du client remplace TOUTE la liste des sets ; l'appli renvoie donc tes sets exactement
    comme elle les a lus (les nôtres sont placés après) et ne remplace que le set
    « LoL Companion » du même champion.
- **Augments ARAM Mayhem** (`augments.js`, `ocr.js`, fenêtre `src/overlay.html`) : Riot ne dit pas quels augments te
  sont proposés (ni le client, ni l'API du jeu ; seul Overwolf le fournit). Comme ezlol ou aram-mayhem-tracker, l'appli
  lit donc leurs noms à l'écran, seulement pendant une partie ARAM Mayhem (file 2400, détectée par la phase
  `InProgress` du client) et si la case est cochée :
  - une fois par seconde, capture de la **bande des titres** (36 % à 47 % de la hauteur de l'écran), lue par l'**OCR
    de Windows** (`Windows.Media.Ocr`) via un seul processus PowerShell resté ouvert (script passé en `-EncodedCommand`,
    aucun fichier à installer, aucune dépendance) : 10 à 95 ms par lecture, mesuré sur des captures en 2560x1440 ;
  - on ne garde que les textes qui sont de **vrais noms d'augments** (liste complète du client :
    `/lol-game-data/assets/v1/cherry-augments.json`, dans la langue du jeu), alignés à la même hauteur ; une erreur
    d'une lettre sur huit est tolérée (distance d'édition) ; il faut au moins 2 cartes reconnues ;
  - stats : **arammayhem.com** (`arammayhem.js`) : page de ton champion (retenu pendant la sélection ; appli lancée en
    pleine partie : lu dans l'API « Live Client Data », `monAlias` de `jeu.js`) avec ses 6 meilleurs augments par
    rareté (**note** S+ à D et rang avec lui, taux d'apparition), et page de tous les augments (notes tous champions) en
    secours. Vu le 17/10/2026 : le site n'affiche plus de taux de victoire par augment, seulement ces notes. Mise en
    avant : meilleure note parmi les augments du top de ton champion, sinon parmi les notes tous champions ; jamais
    sous 3 % d'apparition ni si les deux meilleures ont la même note. Choix fait le
    02/10/2026 après comparaison : l'outil d'OP.GG (`lol_list_aram_augments`) ne donnait qu'une « popularité » sans taux
    de victoire (total de plus de 360 % pour Hwei : pas un vrai taux de sélection), et la carte « la plus prise » était
    rarement la bonne ; League of Graphs (source de Porofessor) refuse les accès automatiques. Pas d'API : pages
    publiques (robots.txt « Allow: / »), User-Agent honnête, cache 3 h. Noms en anglais : jeu en anglais requis ;
  - affichage : fenêtre transparente toujours au premier plan, qui **laisse passer les clics** (`setIgnoreMouseEvents`)
    et ne prend jamais la main au jeu (`focusable: false`, `showInactive`), avec son propre pont (`preload-overlay.js`,
    une seule fonction) ; étiquette à 19 % de la hauteur de l'écran sous le titre, dans le bas vide de la carte.
    Elle se cache après 2 lectures sans cartes (tu as choisi). En plein écran exclusif, Windows ne peut rien afficher
    par-dessus le jeu : mode « Sans bordure » obligatoire.
- **Deux canaux vers le client** (`sondage.js`) : la connexion en direct (WebSocket, `surveillance.js`) s'établissait
  parfois très tard après un redémarrage du PC (vu le 02/10/2026 : appli lancée à 20:12, League à 20:13, connexion
  plusieurs minutes après), et l'acceptation automatique ne voyait pas la partie trouvée. Maintenant, en plus,
  l'appli **interroge elle-même le client toutes les secondes** (phase de jeu ; ready-check en file ; session en
  sélection des champions) et donne les réponses à la même logique (acceptation, pick/ban, build). Une réponse en
  retard d'un canal (« None » juste après « Accepted ») est reconnue grâce au timer du client, qui repart de 0 à
  chaque nouvelle partie trouvée : jamais de double acceptation ni de double notification (testé).
  **Chien de garde** : si le client répond mais que la connexion en direct est absente, ou n'a pas transmis le dernier
  changement de phase, depuis plus de 15 s, elle est refaite (`reconnecter()`). La vérification « client prêt » a un
  temps limite (8 s) pour ne jamais bloquer les tentatives.
  **Vieux lockfile** : après un plantage ou un arrêt du PC, League peut laisser son `lockfile` ; l'appli vérifie que le
  processus dont le numéro y est écrit existe encore (`process.kill(pid, 0)`, qui n'arrête rien), sinon League est
  considéré comme fermé (vu le 04/10/2026 : « League démarre… » restait affiché alors que League était fermé).
  **Bandeau** en haut de la fenêtre tant que l'appli n'est pas prête (« League démarre… », « Connexion à League en
  cours… (l'acceptation automatique fonctionne déjà) ») ; il disparaît tout seul dès qu'elle est prête.
  **Journal** (`journal.js`) : `%APPDATA%\lol-level-calculator\journal.txt` (200 Ko au plus, puis `journal.ancien.txt`)
  note les connexions, l'état du client, les parties trouvées, les acceptations et les erreurs rattrapées. Rien de
  personnel (ni mot de passe du client, ni Riot ID).
- **Cloisons de sécurité** : chaque fonctionnalité qui réagit au client (acceptation, pick/ban, build, relectures du
  compte) est appelée dans sa propre bulle (`proteger` dans `surveillance.js` et `main.js`). Si
  l'une plante, l'erreur est écrite dans le terminal (« Erreur dans « pick et ban automatiques » ... ») et les autres
  continuent : une erreur ailleurs ne peut plus empêcher l'acceptation de recevoir « partie trouvée ». Un filet global
  (`uncaughtException`, `unhandledRejection`) écrit aussi dans le terminal les erreurs qui passeraient entre les mailles.
  (Vu le 02/10/2026 : l'appli restait connectée au client mais ne réagissait plus, alors que le même code, lancé hors
  de l'appli, aurait accepté.)
- **Client lancé après l'appli** : abonnée pendant que le client démarrait encore, l'appli ne recevait plus aucun
  événement (ni partie trouvée, ni sélection). Elle attend donc que le client réponde normalement
  (`GET /lol-gameflow/v1/gameflow-phase` en 200) avant d'ouvrir le WebSocket et de s'abonner, et réessaie toutes les
  5 s sinon.
- **Arrière-plan** : les décisions (que fait la croix, quoi donner à `app.setLoginItemSettings`, contenu du menu de
  l'icône) sont des fonctions pures testées (`arriere-plan.js`) ; `main.js` ne fait que les appliquer avec Electron
  (`Tray`, `requestSingleInstanceLock`, `setLoginItemSettings`). « Quitter » arrête la surveillance (WebSocket et
  minuteries), l'acceptation et l'icône : rien ne garde l'appli en mémoire. La croix ne cache la fenêtre que si
  l'icône existe (sinon on ne pourrait plus la rouvrir), et jamais pendant l'arrêt de Windows.
- **Graphiques** : SVG dessinés à la largeur réelle de la fenêtre (les textes restent lisibles sur une petite fenêtre),
  couleurs vérifiées pour être lisibles sur le fond sombre, y compris par les personnes daltoniennes. La courbe a un
  tableau « Voir les données » qui donne les mêmes valeurs en texte.

## Sécurité

- La page n'a pas accès à Node.js (`contextIsolation`, `sandbox`, pas de `nodeIntegration`) : elle passe uniquement
  par les fonctions exposées dans `preload.js`. Une Content-Security-Policy bloque tout script ou contenu extérieur.
- **Origine des messages vérifiée** (`messages.js`, 17/10/2026) : le processus principal n'accepte une question que de
  la page de l'appli, et les clics du panneau des sorts que de la fenêtre transparente du jeu (recommandation de
  sécurité d'Electron). Une erreur inattendue dans un message est écrite dans `journal.txt` au lieu de passer inaperçue.
- L'appli parle au client League sur `127.0.0.1`. Le certificat auto-signé du client est accepté **seulement** pour
  ces appels (agent HTTPS dédié), jamais pour le reste.
- **Seules connexions à Internet** (décision du propriétaire, 02/10/2026) : les statistiques de builds d'OP.GG et de
  Lolalytics et celles du conseiller de draft (Lolalytics), seulement si tu les actives (désactivé par défaut), et
  celles des augments (arammayhem.com), actives d'office pendant une ARAM Mayhem (décision du 17/10/2026). Lecture seule, depuis le processus principal, certificats vérifiés
  normalement, et seuls le champion, le rôle, le mode et la langue sont envoyés : jamais ton Riot ID ni rien de
  personnel (le set « Champion Rank 1 » n'envoie plus ni ton serveur ni le Riot ID des meilleurs joueurs depuis le
  17/10/2026 : il lit Lolalytics comme le reste du build). La page web de l'appli, elle, ne se connecte
  à rien (Content-Security-Policy inchangée).
- **Mise à jour automatique** (décision du propriétaire, 11/10/2026) : l'appli installée lit la dernière Release de
  github.com/mohamed-ali-akir/lol-companion (activé par défaut, désactivable). Elle ne fait que télécharger des fichiers
  publics, et refuse un fichier dont l'empreinte sha512 ne correspond pas à `latest.yml`. La sécurité repose sur le
  compte GitHub du propriétaire : double authentification (2FA) indispensable.
- Ce qui modifie le client (accepter une partie, pick et ban automatiques, page de runes, set d'objets, sorts
  d'invocateur) est désactivé par défaut et ne s'applique qu'au compte connecté. Le set d'objets n'a plus de case : il
  suit « Récupérer le build de mon champion » (désactivé par défaut).
- Interdit par les règles de Riot, donc absent : révéler les pseudos en sélection des champions, donner une info en
  jeu que les joueurs n'ont pas normalement.
- **Chronos des sorts adverses** : exception décidée par le propriétaire (10/10/2026), comme Porofessor ou Blitz. C'est
  le joueur qui clique quand il voit un sort utilisé ; l'appli ne fait que compter. Les chronos des **ultimes**
  adverses sont absents : Riot les interdit depuis le 13/03/2025, même manuels.
- **Pick et ban automatiques** : les règles de Riot interdisent aussi de choisir ou bannir à la place du joueur. Le
  propriétaire du projet a choisi de l'ajouter quand même (02/10/2026), en connaissance du risque pour son compte
  (faible mais pas nul). Garde-fous : désactivé par défaut, délai avant d'agir, seulement ton action, et rien si tu
  choisis toi-même.

## Données enregistrées sur ton PC

Tout reste dans `%APPDATA%\lol-level-calculator\` (jamais dans le projet ni dans Git) :

| Fichier | Contenu |
|---|---|
| `journal.txt` | Journal de l'appli : connexions au client, parties trouvées, acceptations, erreurs (200 Ko au plus, puis `journal.ancien.txt`) |
| `config.json` | Dossier du jeu, dernier compte lu, dernier onglet ouvert, réglages de l'acceptation automatique, du conseiller de draft, du pick et du ban automatiques (`selectionAuto` : cases, délais, listes de picks et de bans par rôle), du build (`buildAuto` : stats Lolalytics/OP.GG, runes, set Rank 1, sorts d'invocateur, chronos des sorts), place du panneau des sorts en jeu (`positionSorts`), case des mises à jour (`arrierePlan.majAuto`) |
| `parties.json` | Tes parties (Stats, session, maîtrise) : `{ riotId, id, date, dureeS, file, championId, championNom, victoire, kills, deaths, assists }`, sans doublons, 25 000 au maximum par compte |
| `progression.json` | Les points de ta courbe : `{ date, riotId, niveau, progression, xpTotale }`, 1 000 au maximum par compte |
| `maitrise.json` | Dernière lecture des points de maîtrise de chaque champion et échantillons « N points en M parties » (30 au maximum par champion) |

Chaque fichier est écrit de façon **sûre** (`fichiers.js`, depuis le 17/10/2026) : d'abord dans `fichier.tmp`, puis l'ancien
devient `fichier.bak` et le nouveau prend sa place. Si le PC s'éteint pendant une écriture, l'appli relit la copie `.bak`
au lieu de repartir de zéro (avant, tout l'historique pouvait être perdu sans un mot). Un fichier abîmé est signalé dans `journal.txt` et gardé à part (`fichier.abime`) pour pouvoir récupérer ses données.

**Version du format** (`migrations.js`, depuis le 17/10/2026) : `config.json` note `versionDonnees` (1 aujourd'hui).
Le jour où un format change, une migration le convertit une seule fois au démarrage, après une copie de sécurité
des fichiers dans `sauvegarde-avant-vN`. Des fichiers écrits par une version plus récente (retour à une ancienne
appli) sont copiés dans `sauvegarde-donnees-vN` avant d'être réécrits. Une migration qui échoue est notée dans le
journal, l'appli continue, et l'étape est refaite au lancement suivant.

Pour effacer la courbe ou les parties, supprime ce dossier (appli quittée).

## Comment fonctionne le calcul d'XP

L'XP d'une partie dépend de sa durée et du résultat (formules du
[wiki League of Legends](https://leagueoflegends.fandom.com/wiki/Experience_(summoner))) : victoire
`0,11 × secondes + 6,6`, défaite `0,09 × secondes + 5,4`, réduite contre les bots selon le niveau, rien sous 7 minutes.
Il faut **39 936 XP** du niveau 1 au niveau 30. L'appli simule les parties une par une, car l'XP contre les bots change
selon le niveau atteint.

## Structure du projet

```
lol-level-calculator/
├── CLAUDE.md          # Règles du projet (sécurité, tests, pas d'Internet...), relues par Claude Code
├── main.js            # Processus principal : fenêtre, surveillance, notifications ; branche les autres modules
├── messages.js        # Messages de la page et de la fenêtre du jeu (ipcMain) : origine vérifiée, erreurs notées
├── en-jeu.js          # Par-dessus le jeu : fenêtre transparente, stats des augments, chronos des sorts (branchement)
├── preload.js         # Pont sécurisé entre la page et main.js (contextBridge)
├── lcu.js             # Lecture du client League (lockfile, API locale, historique, import)
├── surveillance.js    # Écoute du client en direct (WebSocket)
├── stockage.js        # Réglages (config.json)
├── progression.js     # Courbe de progression (progression.json)
├── parties.js         # Historique local des parties (parties.json)
├── champions.js       # Noms et icônes des champions (protocole lcu-image), pour plusieurs onglets et l'overlay
├── maitrise.js        # Maîtrise : lecture tolérante, mesure des points par partie (maitrise.json)
├── acceptation.js     # Acceptation automatique + détection du premier plan
├── selection.js       # Pick et ban automatiques (rôle, listes, champions disponibles, délais)
├── draft.js           # Conseiller de draft : picks verrouillés, score (matchups, synergies, confort), suivi
├── build.js           # Build : classement des objets, page de runes, set d'objets, logique automatique
├── stats-build.js     # Stats de build d'un champion : mode (toujours la Faille), rôle, OP.GG, Lolalytics, set Rank 1 (testé)
├── internet.js        # Règles communes des appels à Internet : User-Agent honnête, cache de 3 h, délai, erreurs
├── opgg.js            # Statistiques d'OP.GG (Internet) : runes, sorts, objets en secours ; lecture du format, cache
├── familles.js        # Familles de builds d'un champion (combattant, létalité...) : un set d'objets chacune ; Kayn rouge / bleu
├── lolalytics.js      # Lolalytics (Internet) : objets emplacement par emplacement, tier list, matchups, synergies ; cache
├── sorts.js           # Chronos des sorts d'invocateur adverses : recharges, accélération, clics du panneau en jeu
├── pings.js           # Pings des sorts lus dans le chat : capture, OCR, reconnaissance « ChampionEnnemi Sort »
├── image.js           # Images PNG (lecture, écriture) et nettoyage de la zone du chat avant l'OCR
├── jeu.js             # Lecture de la partie en cours (API locale « Live Client Data ») : temps de jeu, joueurs
├── augments.js        # Augments ARAM Mayhem : reconnaissance des cartes, étiquettes, surveillance pendant la partie
├── ocr.js             # Lecture de texte à l'écran : OCR de Windows (PowerShell) ou de macOS (screencapture + Vision)
├── arammayhem.js      # Notes des augments ARAM Mayhem (arammayhem.com, Internet) : lecture des pages, cache
├── sondage.js         # Deuxième canal : interroge le client toutes les secondes ; état « prête / pas prête »
├── fichiers.js        # Écriture sûre des fichiers de données (temporaire + renommage, copie .bak relue si abîmé)
├── migrations.js      # Version du format des fichiers de données, migrations au démarrage (copie de sécurité avant)
├── journal.js         # Journal sur le disque (journal.txt), taille limitée
├── mise-a-jour.js     # Mise à jour automatique (electron-updater, Releases GitHub) : vérification, bandeau, installation
├── maj-appli.js       # Mise à jour côté Electron : au lancement (petite fenêtre), puis en arrière-plan ; Mac : vérification
├── preload-overlay.js # Pont de la fenêtre transparente par-dessus le jeu : augments, chronos des sorts (src/overlay.html)
├── runes.js           # Runes : page « LoL Companion », runes recommandées par Riot (secours)
├── arriere-plan.js    # Arrière-plan : la croix, le démarrage de Windows, le menu de l'icône (fonctions pures)
├── assets/            # Icône de l'appli (icon.ico, icon.png, tray.png) : fenêtre, zone de notification, installateur
├── reparer-electron.ps1 # Dépannage de l'installation d'Electron sous Windows (voir Installation)
├── outils/essai-complet.js # Essai de bout en bout sur un faux client (npm run essai) ; refait aussi les captures du README
├── outils/sonde.js    # Sonde des sites lus par l'appli (npm run sonde, et chaque jour sur GitHub)
├── docs/captures/     # Captures du README
├── docs/prompt-selection-auto.md # Cahier des charges du pick et ban automatiques
├── src/
│   ├── index.html     # Interface : carte "Ton compte", barre d'onglets, un panneau par onglet
│   ├── style.css      # Design
│   ├── calculs.js     # Calculs purs (XP, modes, stats, maîtrise, session) : page, main.js et tests
│   ├── commun.js      # État partagé, petits outils, mettreAJour() qui redessine tous les onglets
│   ├── onglets/       # Un fichier par onglet (+ compte.js pour la carte du compte, session.js pour la session)
│   └── app.js         # Démarrage : branche tout (explique l'ordre de chargement)
└── test/              # Un fichier de tests par module, faux client dans chaque test réseau, certificat de test
```

Les calculs sont des fonctions pures (`src/calculs.js`) séparées du code qui manipule la page : on les teste sans
ouvrir l'appli. Les fichiers de la page sont des scripts classiques chargés dans l'ordre par `index.html`, pour que
`calculs.js` puisse aussi être chargé tel quel par Node (`require`) dans les tests et dans `main.js`. Chaque onglet
s'inscrit avec `surRendu()` et est redessiné par `mettreAJour()`.

## Limites connues

- L'API du client League n'est **pas officielle** : une mise à jour du jeu peut changer une route ou un champ. Les
  routes de maîtrise n'ont été vérifiées que dans la documentation de la communauté, pas sur toutes les versions du client.
- L'import de l'historique ne remonte que ce que le client accepte de donner : pas forcément jusqu'à la création
  du compte.
- L'XP de session et les estimations utilisent les formules du wiki : ce sont des estimations.
- Les données sont rangées par Riot ID (`pseudo#tag`) : si tu changes de Riot ID, l'historique repart de zéro.
- Le code de la page (`src/onglets/`) et la partie Electron de l'arrière-plan (icône, fenêtre cachée, démarrage de
  Windows) n'ont pas de tests automatiques : ils sont vérifiés en lançant l'appli.

## Onglets retirés

- **Classée**, **Missions** et **Butin** (17/10/2026) : supprimés par choix du propriétaire, avec tout leur code
  (lecture de l'Essence bleue, des prix, des champions possédés et des missions ; événements du client associés).

---

*Projet non officiel, non affilié à Riot Games.*
