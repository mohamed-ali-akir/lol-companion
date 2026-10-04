# Prompt : pick et ban automatiques (onglet « Sélection »)

Tu travailles sur LoL Companion (Electron, Windows), qui lit le client League via son API locale (LCU).
Respecte CLAUDE.md, sauf la règle « choisir ou bannir à la place du joueur », que le propriétaire a levée
le 02/10/2026 en connaissance du risque (règles de Riot, risque de sanction du compte faible mais non nul).

## Ce que veut le propriétaire
- Un **onglet « Sélection »** dans l'appli.
- **Pick auto** après **10 s** (réglable) quand c'est son tour de choisir.
  - Il range **3 champions dans l'ordre** : si le 1er est banni ou déjà pris, l'appli prend le 2e, puis le 3e.
  - **3 champions par rôle** (Haut, Jungle, Milieu, Bas, Support) : l'appli lit le rôle attribué en sélection
    et prend la liste de ce rôle. Liste « Par défaut » quand il n'y a pas de rôle (partie sans rôles) ou si
    la liste du rôle est vide / entièrement indisponible.
- **Ban auto** après **5 s** (réglable) quand c'est son tour de bannir : 3 champions dans l'ordre, même principe.

## Garde-fous (obligatoires)
- Pick auto et ban auto **désactivés par défaut**, chacun avec sa case dans l'onglet, et un texte qui explique le risque.
- L'appli n'agit que sur **l'action du joueur connecté** (`actorCellId === localPlayerCellId`), en cours
  (`isInProgress: true`, `completed: false`), une seule fois par action.
- **Le joueur garde la main** : si pendant le délai il survole ou verrouille lui-même un champion
  (`championId` de l'action différent de 0), l'appli ne fait rien. Si le tour se termine ou si la sélection
  est annulée (esquive), l'acceptation prévue est annulée.
- Juste avant d'agir, **tout revérifier** sur le dernier état reçu (même action, toujours en cours, toujours à 0,
  réglage toujours actif).
- Si le délai réglé dépasse le temps restant du tour (`timer.adjustedTimeLeftInPhase`, en ms), agir 2 s avant la fin.
- Ne jamais bannir un champion qu'un coéquipier a survolé ou déclaré (`championPickIntent`).
- Rien d'autre : pas de pseudos, pas d'info en jeu (ces règles de CLAUDE.md restent).

## Données du client (format communautaire, à confirmer en direct avec des logs DIAG-TEMP)
- Événement WebSocket : `OnJsonApiEvent_lol-champ-select_v1_session` (`eventType` Create / Update / Delete).
- `GET /lol-champ-select/v1/session` →
  `{ gameId, localPlayerCellId, actions: [[{ id, actorCellId, championId, completed, isInProgress, type: "ban"|"pick" }]],
     myTeam: [{ cellId, assignedPosition, championId, championPickIntent }], theirTeam: [...],
     bans: { myTeamBans: [ids], theirTeamBans: [ids] }, timer: { phase, adjustedTimeLeftInPhase } }`
- Rôles (`assignedPosition`) : `top`, `jungle`, `middle`, `bottom`, `utility` ; vide sans rôles.
- `GET /lol-champ-select/v1/pickable-champion-ids` et `.../bannable-champion-ids` → `[ids]`.
- Agir : `PATCH /lol-champ-select/v1/session/actions/{id}` corps `{ "championId": N }` (survol),
  puis `POST /lol-champ-select/v1/session/actions/{id}/complete` (verrouiller).
- Indisponibles : bans des deux équipes, champions des actions terminées, champions des deux équipes,
  et ce que le client ne propose pas (listes pickable / bannable ; si leur lecture échoue, on ne filtre pas).

## Découpage du travail
1. `selection.js` (racine, processus principal) : réglages normalisés, fonctions pures (monRole,
   monActionEnCours, championsIndisponibles, listePourPick, choisirChampion), logique
   `creerSelectionAuto({ reglages, champsAutorises, agir, resultat, journal })` → `{ surSession, arreter }`
   sur le modèle de `acceptation.js`, et `effectuerAction(dossierJeu, actionId, championId)`.
2. `lcu.js` : `appelerClient` accepte un corps JSON (`{ methode, corps }`) pour le PATCH.
3. `surveillance.js` : abonnement à l'événement de sélection, transmis tout de suite à `aSelection(session)`,
   `null` sur Delete ou socket fermée.
4. `stockage.js` : clé `selectionAuto` de config.json.
5. `main.js` + `preload.js` : `selection:lire`, `selection:enregistrer`, `selection:champions` (noms pour les listes),
   événement `selection:evenement` vers la page ; logs DIAG-TEMP.
6. Page : `src/onglets/selection.js` + panneau dans `index.html` (cases, délais, 6 lignes de 3 listes pour les picks,
   1 ligne de 3 pour les bans, dernier événement).
7. Tests `test/selection.test.js` (fonctions pures, logique avec délais courts, faux client HTTPS pour PATCH + POST).
8. README (fonctionnalités, routes, config.json, structure) et CLAUDE.md (règle levée + garde-fous).
9. `npm test` doit passer. Aucune nouvelle dépendance.
