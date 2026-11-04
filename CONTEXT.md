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
Un changement de statut d'un ticket, daté au moment où il a été enregistré dans l'historique du Projet, mais jamais avant la Transition précédente du ticket : quand l'horloge a reculé, elle prend la date de la précédente, et le statut d'avant dure 0, jamais moins.
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
Un ticket de type bug, créé à ou après la date d'une Livraison à laquelle il est relié par un lien « découvert à partir de » actif. Le ticket relié est autre que lui-même : un bug n'est jamais son propre Bug d'origine. Un bug créé avant cette Livraison, ou relié à un ticket qui n'est pas une Livraison (ouvert, Abandon), a été trouvé en cours de travail : il n'est l'origine d'aucun échec. Un bug relié à une Epic n'est l'origine d'aucun échec et n'est pas compté comme relié. Un bug en Abandon n'est jamais un Bug d'origine : il décrit le même défaut qu'un autre bug. Il transmet ses liens au bug qui le remplace ; pour ces liens, la date qui compte est celle de sa propre création, car c'est lui qui a constaté le défaut.

**Taux d'échec**:
Part des Livraisons ayant au moins un Bug d'origine (équivalent du Change Failure Rate DORA). Non significatif tant que la Couverture est faible.
_Avoid_: CFR, qualité

**Couverture**:
Part des bugs dont l'origine est renseignée : c'est le cas d'un bug relié par un lien « découvert à partir de » actif à un ticket du Projet hors Epic, autre que lui-même, que ce ticket soit livré ou non. Un bug en Abandon n'est pas compté : il décrit le même défaut qu'un autre bug, et transmet ses liens au bug qui le remplace.

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

**Taux de Réouverture**:
Part des clôtures d'une période (Transitions vers fermé) que suit une Réouverture. Un ticket fermé, rouvert puis refermé compte deux clôtures, dont seule la première est suivie d'une Réouverture ; la Livraison, elle, est la dernière.
_Avoid_: taux de régression

**Écart Arrivées–Débit**:
Arrivées moins Débit sur une période. Positif, il arrive plus de tickets qu'il n'en est livré.

**Répartition par type**:
Part de chaque type de ticket (bug, feature, task, chore…) parmi les Arrivées, les Livraisons et le WIP d'une période.

**Attente en Prêt**:
Temps passé dans la colonne Prêt entre la création d'un ticket et sa dernière clôture, avant un premier démarrage comme après un retour à ouvert ; composante du Lead Time. Le ticket pouvait être démarré et ne l'était pas.

**Décomposition du Lead Time**:
Le Lead Time cumulé des Livraisons d'une période, réparti en cinq parts qui s'additionnent : Attente de dépendance, Attente en Prêt, travail (Cycle Time hors Blocage), Blocage (dans le Cycle Time) et autre attente (le reste : Backlog après un premier démarrage, différé, fermé avant une Réouverture).

**Prêt qui stagne**:
Un Prêt qui l'est depuis plus de 14 jours calendaires (14 jours pile ne stagne pas). L'âge d'un Prêt est le temps calendaire écoulé depuis qu'il l'est devenu : création, fin de son Blocage, retour à ouvert ou Réouverture. Il se compte sur le calendrier de l'utilisateur, dans son fuseau : un changement d'heure ne l'allonge ni ne le raccourcit.
_Avoid_: ticket oublié, ticket périmé

**Carte d'activité**:
Nombre de Transitions d'une période selon le jour de la semaine (du lundi au dimanche) et l'heure, dans le fuseau de l'utilisateur. La création d'un ticket n'en est pas une : c'est une Arrivée.

**Panneau de ticket**:
Le détail d'un ticket, en lecture seule, ouvert depuis le kanban de son Projet. Il réunit les champs du ticket et sa Chronologie.
_Avoid_: page de ticket

**Chronologie**:
La vie d'un ticket telle que son Panneau la raconte : ses Transitions avec le temps passé dans chaque statut, ses Blocages avec leurs phases, et ses durées (Lead Time, Cycle Time, temps bloqué en cours de travail), qui sont celles des métriques : le Panneau et la page Métriques disent la même chose. Elle est lue dans l'historique du Projet ; pour un ticket que cet historique ne connaît pas, on ne sait que ses dates de création et de clôture.
_Avoid_: historique (c'est sa source : l'historique Dolt du Projet)

**Phase d'un Blocage**:
Partie d'un Blocage où le ticket reste dans la même situation : _avant le premier démarrage_ (l'Attente de dépendance), _en cours de travail_ (le temps bloqué, seule phase comptée dans le Cycle Time) ou _autre attente_ (tout autre statut non fermé). Deux phases voisines de même sorte n'en font qu'une.

## Relationships

- Un **Projet** contient zéro ou plusieurs tickets
- Toutes les durées (**Lead Time**, **Cycle Time**, **Temps de rétablissement**, **Attente de dépendance**, **Attente en Prêt**, âge d'un **Prêt**) sont mesurées en temps calendaire, dans le fuseau de l'utilisateur
- Une **Epic** a des **Enfants** ; son avancement = **Livraisons** parmi ses Enfants
- Un **Bug d'origine** est relié à au moins une **Livraison**, qu'il met chacune en échec ; une **Livraison** peut avoir plusieurs Bugs d'origine
- La **Vue globale** agrège tous les **Projets** suivis ; le kanban reste centré sur un **Projet**
- Un **Blocage** se découpe en **phases** : seule celle en cours de travail compte dans le **Cycle Time** ; celle d'avant le premier démarrage est l'**Attente de dépendance**
- Le **Panneau de ticket** montre la **Chronologie** du ticket : ses **Transitions**, ses **Blocages** et leurs phases, avec les durées des métriques
