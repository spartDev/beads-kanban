# beads-desktop

Interface web locale pour suivre les tickets beads de plusieurs projets et mesurer le flux de livraison.

## Language

**Projet**:
Un dossier contenant un workspace beads stocké en Dolt, identifié par son préfixe de tickets. Les workspaces non-Dolt ne sont pas des Projets.
_Avoid_: repo, workspace, dépôt

**Vue globale**:
L'agrégation de tous les Projets suivis, utilisée pour les métriques transverses.
_Avoid_: dashboard global, multi-repo

**Transition**:
Un changement de statut d'un ticket, daté au moment où il a été enregistré dans l'historique du Projet.
_Avoid_: événement, mouvement

**Prêt**:
Un ticket ouvert dont aucune dépendance bloquante n'est en suspens (le « ready » de beads).
_Avoid_: à faire, todo

**Blocage**:
Période pendant laquelle un ticket non fermé dépend d'au moins un autre ticket non fermé (dépendance bloquante), ou porte explicitement le statut bloqué. Le Blocage se déduit des dépendances, pas du statut.
_Avoid_: statut blocked, bloqué (seul)

**Backlog**:
Un ticket ouvert, jamais démarré ou revenu à ouvert, en Blocage.

**Epic**:
Un ticket de type epic qui regroupe des Enfants. Son avancement se mesure en nombre de Livraisons parmi ses Enfants ; elle n'est jamais elle-même une Livraison.
_Avoid_: projet, initiative

**Enfant**:
Un ticket rattaché à un parent par un lien parent-enfant.
_Avoid_: sous-tâche

**Livraison**:
Un ticket (hors epic) fermé pour cause de travail terminé — ni doublon, ni remplacé. Un ticket compte pour une seule Livraison, datée de sa dernière clôture ; une Réouverture annule rétroactivement la Livraison précédente.
_Avoid_: ticket fermé, done

**Abandon**:
Un ticket fermé parce qu'il est le doublon d'un autre ou qu'un autre ticket l'a remplacé. Un « won't fix » n'est pas un Abandon.
_Avoid_: annulé, rejeté

**Lead Time**:
Durée entre la création d'un ticket et sa dernière clôture.
_Avoid_: time to delivery (ambigu), délai

**Cycle Time**:
Temps cumulé passé par un ticket dans les statuts de travail (en cours, rattaché à un agent, bloqué), Blocages inclus, toutes périodes confondues. Indéfini si le ticket n'a jamais été démarré.
_Avoid_: temps de dev, durée

**Débit**:
Nombre de Livraisons sur une période (équivalent de la Deployment Frequency DORA).
_Avoid_: vélocité, throughput

**Bug d'origine**:
Un bug relié à la Livraison qui l'a introduit.

**Taux d'échec**:
Part des Livraisons ayant au moins un Bug d'origine (équivalent du Change Failure Rate DORA). Non significatif tant que peu de bugs sont reliés.
_Avoid_: CFR, qualité

**Temps de rétablissement**:
Lead Time des bugs critiques (P0/P1) (équivalent du MTTR DORA).
_Avoid_: MTTR

**WIP**:
Nombre de tickets en cours simultanément.

**Arrivées**:
Nombre de tickets créés sur une période, à comparer au Débit.

**Efficacité du flux**:
Part du Cycle Time passée hors Blocage.

**Attente de dépendance**:
Temps passé en Backlog avant le premier démarrage ; composante du Lead Time.

**Réouverture**:
Une Transition d'un ticket fermé vers un statut non fermé.
_Avoid_: régression

**Taux d'abandon**:
Part des Abandons parmi les tickets fermés sur une période.

## Relationships

- Un **Projet** contient zéro ou plusieurs tickets
- Toutes les durées (**Lead Time**, **Cycle Time**, **Temps de rétablissement**) sont mesurées en temps calendaire, dans le fuseau de l'utilisateur
- Une **Epic** a des **Enfants** ; son avancement = **Livraisons** parmi ses Enfants
- Un **Bug d'origine** est relié à exactement une **Livraison** ; une **Livraison** peut avoir plusieurs Bugs d'origine
- La **Vue globale** agrège tous les **Projets** suivis ; le kanban reste centré sur un **Projet**
