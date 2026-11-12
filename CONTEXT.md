# beads-desktop

Interface web locale pour suivre les tickets beads de plusieurs projets et mesurer le flux de livraison.

## Language

**Projet**:
Un dossier contenant un workspace beads stocké en Dolt, identifié par son préfixe de tickets. Les workspaces non-Dolt ne sont pas des Projets.
_Avoid_: repo, workspace, dépôt

**Vue globale**:
L'agrégation de tous les Projets suivis, utilisée pour les métriques transverses.
_Avoid_: dashboard global, multi-repo

**Dernier commit**:
L'état d'un Projet tel que bd l'a enregistré en dernier dans sa base Dolt. C'est le seul état que l'application montre : ce que bd n'a pas encore commité n'en fait pas partie.
_Avoid_: état courant, working set

**Transition**:
Un changement de statut d'un ticket, daté au moment où il a été enregistré dans l'historique du Projet. Les dates suivent l'ordre de cet historique, jamais l'inverse : quand l'horloge d'un enregistrement s'est trompée, en reculant ou en avançant, la Transition prend la date voisine qui respecte cet ordre, et aucune durée n'est négative.
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
Un ticket de type epic qui regroupe des Enfants. Son Avancement se mesure en nombre de Livraisons parmi ses Enfants à livrer ; elle n'est jamais elle-même une Livraison.
_Avoid_: projet, initiative

**Enfant**:
Un ticket rattaché à un parent par un lien parent-enfant. Ceux d'une Epic le sont à tous les niveaux : l'Enfant d'un Enfant en fait partie.
_Avoid_: sous-tâche

**Enfant à livrer**:
Un Enfant d'une Epic qu'il reste à livrer, ou qui l'a été : tous ses Enfants, sauf ses Epics imbriquées (elles regroupent des Enfants sans être livrées) et ses Abandons (fermés sans être livrés, ils n'ont plus rien à livrer).

**Avancement**:
Le nombre de Livraisons parmi les Enfants à livrer d'une Epic. Les Abandons n'y comptent ni comme livrés ni comme à livrer, pour qu'une Epic dont il ne reste rien à livrer atteigne 100 %.
_Avoid_: progression

**Livraison**:
Un ticket (hors epic) fermé pour cause de travail terminé — ni doublon, ni remplacé. Un ticket compte pour une seule Livraison, datée de sa dernière clôture ; une Réouverture annule rétroactivement la Livraison précédente.
_Avoid_: ticket fermé, done

**Abandon**:
Un ticket fermé parce qu'il est le doublon d'un autre ou qu'un autre ticket l'a remplacé. Il se reconnaît à un lien « doublon de » ou « remplacé par » posé sur lui-même, vers l'autre ticket, jamais au texte de sa raison de fermeture. S'il porte les deux, sa cause est celle du lien posé le premier. Un « won't fix » n'est pas un Abandon.
_Avoid_: annulé, rejeté

**Durée écoulée**:
Le temps qui s'est réellement écoulé entre deux instants, nuits, week-ends et jours fériés compris (jamais en jours ouvrés). Elle ne dépend pas du fuseau, et un changement d'heure y compte pour ce qu'il est : le dimanche où les horloges reculent dure 25 heures. C'est le sens de toutes les durées mesurées, hors l'âge d'un Prêt : Lead Time, Cycle Time, Temps de rétablissement, Attente de dépendance, Attente en Prêt, âge d'un ticket en cours.
_Avoid_: temps calendaire (se confond avec l'Âge calendaire)

**Âge calendaire**:
Le temps passé depuis un instant, compté sur le calendrier de l'utilisateur, dans son fuseau : chaque jour compte pour 24 heures, quelle que soit sa durée réelle, donc un changement d'heure ne l'allonge ni ne le raccourcit. Du mardi 12:00 au mardi 12:00 deux semaines plus tard, il y a 14 jours, que les horloges aient avancé ou reculé entre-temps (la Durée écoulée y compterait 13 jours 23 heures ou 14 jours 1 heure). C'est le sens de l'âge d'un Prêt.
_Avoid_: temps calendaire (se confond avec la Durée écoulée)

**Fuseau de l'utilisateur**:
Le fuseau horaire du navigateur qui affiche l'application, et non celui du serveur. C'est lui qui découpe le temps en jours, en semaines et en heures : les périodes des métriques, l'Âge calendaire, la Carte d'activité. Les Durées écoulées n'en dépendent pas.
_Avoid_: fuseau du serveur, fuseau local

**Lead Time**:
Durée écoulée entre la création d'un ticket et sa dernière clôture.
_Avoid_: time to delivery (ambigu), délai

**Cycle Time**:
Temps cumulé passé par un ticket dans les statuts de travail (en cours, rattaché à un agent, bloqué), Blocages inclus, toutes périodes confondues. Indéfini si le ticket n'a jamais été démarré.
_Avoid_: temps de dev, durée

**Débit**:
Nombre de Livraisons sur une période (équivalent de la Deployment Frequency DORA).
_Avoid_: vélocité, throughput

**Débit récent**:
Le Débit d'une Epic sur ses 28 derniers jours, ou depuis sa création si elle est plus récente, sans jamais descendre sous 7 jours : sur une Epic de moins de 7 jours, la mesure remonte donc avant sa création. Ce sont les Livraisons de ses Enfants, sur une Durée écoulée. Sous 4 Livraisons, il n'y a pas assez de Débit pour en tirer un rythme.

**Prévision de fin**:
Fourchette de Durée écoulée que mettraient les Enfants restants d'une Epic à être livrés, au rythme de son Débit récent. Elle est d'autant plus large que les Livraisons sont peu nombreuses (plus ou moins la racine de leur nombre) : une prévision ne prétend pas à plus de précision que son rythme n'en a, et au-delà d'un an elle se contente de le dire, sans date. Elle suppose le rythme constant et aucun Enfant ajouté, n'est pas un engagement, et est masquée sans assez de Débit récent, pour une Epic fermée ou dont tout est livré.
_Avoid_: date de fin, échéance

**Bug d'origine**:
Un ticket de type bug, créé à ou après la dernière clôture d'une Livraison à laquelle il est relié par un lien « découvert à partir de » actif. Les deux dates sont celles de l'historique du Projet, dans l'ordre de ses changements : un bug créé après la clôture d'une Livraison, dans cet historique, lui est postérieur, même si une horloge s'est trompée. Le ticket relié est autre que lui-même : un bug n'est jamais son propre Bug d'origine. Un bug créé avant cette clôture, ou relié à un ticket qui n'est pas une Livraison (ouvert, Abandon), a été trouvé en cours de travail : il n'est l'origine d'aucun échec. Un bug relié à une Epic n'est l'origine d'aucun échec et n'est pas compté comme relié. Un bug en Abandon n'est jamais un Bug d'origine : il décrit le même défaut qu'un autre bug. Il transmet ses liens au bug qui le remplace ; pour ces liens, la date qui compte est celle de sa propre création, car c'est lui qui a constaté le défaut.

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
Un Prêt dont l'Âge calendaire dépasse 14 jours (14 jours pile ne stagne pas). L'âge d'un Prêt se compte depuis qu'il l'est devenu : création, fin de son Blocage, retour à ouvert ou Réouverture.
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
Partie d'un Blocage où le ticket reste dans la même situation : _avant le premier démarrage_ (en Backlog : l'Attente de dépendance), _en cours de travail_ (le temps bloqué, seule phase comptée dans le Cycle Time) ou _autre attente_ (tout le reste : revenu à ouvert ou rouvert après un premier démarrage, ou dans un autre statut non fermé, le différé par exemple, même avant tout démarrage). Deux phases voisines de même sorte n'en font qu'une.

**Cycle Time de référence**:
Le 85ᵉ centile du Cycle Time des Livraisons des 90 derniers jours du même Projet et du même type qu'un ticket ; sous 10 Livraisons, celles de tous les types du Projet ; sous 10 encore, il n'y en a pas, et on ne prétend pas savoir ce qui est normal.

**Dérive**:
Un ticket en statut de travail dont le Cycle Time en cours dépasse son Cycle Time de référence. Un ticket revenu à ouvert ne dérive plus : il est redevenu Prêt ou Backlog. Sans Cycle Time de référence, aucun ticket ne dérive.
_Avoid_: ticket en retard, SLA

**Blocage long**:
Un Blocage dont la phase en cours de travail dure depuis plus de 3 jours de Durée écoulée.

**WIP inhabituel**:
Un WIP d'un Projet au-dessus du 85ᵉ centile de son WIP quotidien des 90 derniers jours.

**Signal**:
Une situation en cours qui mérite d'être regardée maintenant : Dérive, Prêt qui stagne, Blocage long ou WIP inhabituel. Un Signal existe tant que sa condition est vraie dans le Dernier commit ; on ne peut pas l'écarter. Le Retravail n'en est pas un : c'est un constat après coup.
_Avoid_: alerte, notification

**Prise rendue**:
Une Transition d'un statut de travail (en cours, rattaché à un agent, bloqué) vers ouvert, sans clôture entre les deux.
_Avoid_: abandon de prise (se confond avec l'Abandon), régression

**Retravail**:
Un ticket qui, sur une période, a subi au moins une Réouverture, une Prise rendue, ou dont une Livraison a reçu un Bug d'origine créé sur cette période. Chaque cause se nomme : c'est la liste des tickets qui reviennent, là où le Taux de Réouverture et le Taux d'échec n'en donnent que la proportion.
_Avoid_: rework, régression

**Tendance longue**:
Débit, Lead Time au 85ᵉ centile et Taux de Réouverture semaine par semaine sur les 12 dernières semaines du Fuseau de l'utilisateur, sans lissage. Une semaine de moins de 4 Livraisons ne suffit pas à un centile digne de foi.

## Relationships

- Un **Projet** contient zéro ou plusieurs tickets
- Les durées (**Lead Time**, **Cycle Time**, **Temps de rétablissement**, **Attente de dépendance**, **Attente en Prêt**, âge d'un ticket en cours) sont des **Durées écoulées** ; l'âge d'un **Prêt**, lui, est un **Âge calendaire**
- Une **Epic** a des **Enfants** ; son **Avancement** = **Livraisons** parmi ses **Enfants à livrer**
- La **Prévision de fin** d'une **Epic** se tire de son **Débit récent**
- Un **Bug d'origine** est relié à au moins une **Livraison**, qu'il met chacune en échec ; une **Livraison** peut avoir plusieurs Bugs d'origine
- Les jours des périodes, l'**Âge calendaire** et la **Carte d'activité** se comptent dans le **Fuseau de l'utilisateur**, pas dans celui du serveur
- La **Vue globale** agrège tous les **Projets** suivis ; le kanban reste centré sur un **Projet**
- Le kanban, le **Panneau de ticket**, les métriques et la **Chronologie** d'un **Projet** lisent le même **Dernier commit**
- Un **Blocage** se découpe en **phases** : seule celle en cours de travail compte dans le **Cycle Time** ; celle d'avant le premier démarrage est l'**Attente de dépendance**
- Une **Dérive** compare le **Cycle Time** en cours d'un ticket à son **Cycle Time de référence**
- Les **Signaux** sont la **Dérive**, le **Prêt qui stagne**, le **Blocage long** et le **WIP inhabituel** ; le **Retravail** n'en est pas un
- Le **Retravail** naît d'une **Réouverture**, d'une **Prise rendue** ou d'un **Bug d'origine**
- Le **Panneau de ticket** montre la **Chronologie** du ticket : ses **Transitions**, ses **Blocages** et leurs phases, avec les durées des métriques
