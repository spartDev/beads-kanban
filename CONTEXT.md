# Throughline

Interface web locale pour suivre les tickets beads de plusieurs projets et mesurer le flux de livraison.

## Language

**Projet**:
Un dossier contenant un workspace beads stocké en Dolt, identifié par son préfixe de tickets. Les workspaces non-Dolt ne sont pas des Projets.
_English_: Project
_Avoid_: repo, workspace, dépôt

**Vue globale**:
L'agrégation de tous les Projets suivis, utilisée pour les métriques transverses.
_English_: Overview
_Avoid_: dashboard global, multi-repo

**Dernier commit**:
L'état d'un Projet tel que bd l'a enregistré en dernier dans sa base Dolt. C'est le seul état que l'application montre : ce que bd n'a pas encore commité n'en fait pas partie.
_English_: Last commit
_Avoid_: état courant, working set

**Transition**:
Un changement de statut d'un ticket, daté au moment où il a été enregistré dans l'historique du Projet. Les dates suivent l'ordre de cet historique, jamais l'inverse : quand l'horloge d'un enregistrement s'est trompée, en reculant ou en avançant, la Transition prend la date voisine qui respecte cet ordre, et aucune durée n'est négative.
_English_: Transition
_Avoid_: événement, mouvement

**Prêt**:
Un ticket ouvert dont aucune dépendance bloquante n'est en suspens (le « ready » de beads).
_English_: Ready
_Avoid_: à faire, todo

**Blocage**:
Période pendant laquelle un ticket non fermé dépend d'au moins un autre ticket non fermé (dépendance bloquante), ou porte explicitement le statut bloqué. Le Blocage se déduit des dépendances, pas du statut.
_English_: Blockage (l'état d'un ticket : Blocked)
_Avoid_: statut blocked, bloqué (seul)

**Backlog**:
Un ticket ouvert, jamais démarré ou revenu à ouvert, en Blocage.
_English_: Backlog

**Statut de travail**:
Un statut d'un ticket pris en charge et non fermé : en cours, rattaché à un agent, bloqué, un Statut de relais, ou un autre statut que le Projet déclare comme travail.
_English_: Work status
_Avoid_: statut actif

**Statut de relais**:
Un statut qui dit qui a la main sur un ticket une fois le développement passé : En relecture, En intégration ou À valider. Il porte le même nom dans tous les Projets et n'impose aucun ordre.
_English_: Handoff status
_Avoid_: étape, phase (se confond avec la Phase d'un Blocage)

**En relecture**:
Un ticket qu'un agent relecteur examine.
_English_: In review

**En intégration**:
Un ticket dont la demande de fusion est ouverte, le temps de ses vérifications automatiques et de sa revue externe.
_English_: In integration
_Avoid_: en PR, en CI

**À valider**:
Un ticket qui attend l'utilisateur : un test à la main, une décision ou son feu vert pour fusionner.
_English_: Awaiting validation
_Avoid_: en attente

**Epic**:
Un ticket de type epic qui regroupe des Enfants. Son Avancement se mesure en nombre de Livraisons parmi ses Enfants à livrer ; elle n'est jamais elle-même une Livraison.
_English_: Epic
_Avoid_: projet, initiative

**Enfant**:
Un ticket rattaché à un parent par un lien parent-enfant. Ceux d'une Epic le sont à tous les niveaux : l'Enfant d'un Enfant en fait partie.
_English_: Child
_Avoid_: sous-tâche

**Enfant à livrer**:
Un Enfant d'une Epic qu'il reste à livrer, ou qui l'a été : tous ses Enfants, sauf ses Epics imbriquées (elles regroupent des Enfants sans être livrées), ses Abandons et ses Renoncements (fermés sans être livrés, ils n'ont plus rien à livrer).
_English_: Child to deliver

**Avancement**:
Le nombre de Livraisons parmi les Enfants à livrer d'une Epic. Les Abandons et les Renoncements n'y comptent ni comme livrés ni comme à livrer, pour qu'une Epic dont il ne reste rien à livrer atteigne 100 %.
_English_: Progress
_Avoid_: progression

**Livraison**:
Un ticket (hors epic) fermé pour cause de travail terminé — ni doublon, ni remplacé, ni Renoncement. Un ticket compte pour une seule Livraison, datée de sa dernière clôture ; une Réouverture annule rétroactivement la Livraison précédente.
_English_: Delivery
_Avoid_: ticket fermé, done

**Abandon**:
Un ticket fermé parce qu'il est le doublon d'un autre ou qu'un autre ticket l'a remplacé. Il se reconnaît à un lien « doublon de » ou « remplacé par » posé sur lui-même, vers l'autre ticket, jamais au texte de sa raison de fermeture. S'il porte les deux, sa cause est celle du lien posé le premier. Un « won't fix » n'est pas un Abandon : c'est une Livraison, sauf s'il est marqué comme Renoncement.
_English_: Dropped
_Avoid_: annulé, rejeté

**Durée écoulée**:
Le temps qui s'est réellement écoulé entre deux instants, nuits, week-ends et jours fériés compris (jamais en jours ouvrés). Elle ne dépend pas du fuseau, et un changement d'heure y compte pour ce qu'il est : le dimanche où les horloges reculent dure 25 heures. C'est le sens de toutes les durées mesurées, hors l'âge d'un Prêt : Lead Time, Cycle Time, Temps de rétablissement, Attente de dépendance, Attente en Prêt, Attente humaine, âge d'un ticket en cours.
_English_: Elapsed time
_Avoid_: temps calendaire (se confond avec l'Âge calendaire)

**Âge calendaire**:
Le temps passé depuis un instant, compté sur le calendrier de l'utilisateur, dans son fuseau : chaque jour compte pour 24 heures, quelle que soit sa durée réelle, donc un changement d'heure ne l'allonge ni ne le raccourcit. Du mardi 12:00 au mardi 12:00 deux semaines plus tard, il y a 14 jours, que les horloges aient avancé ou reculé entre-temps (la Durée écoulée y compterait 13 jours 23 heures ou 14 jours 1 heure). C'est le sens de l'âge d'un Prêt.
_English_: Calendar age
_Avoid_: temps calendaire (se confond avec la Durée écoulée)

**Fuseau de l'utilisateur**:
Le fuseau horaire du navigateur qui affiche l'application, et non celui du serveur. C'est lui qui découpe le temps en jours, en semaines et en heures : les périodes des métriques, l'Âge calendaire, la Carte d'activité. Les Durées écoulées n'en dépendent pas.
_English_: User's time zone
_Avoid_: fuseau du serveur, fuseau local

**Lead Time**:
Durée écoulée entre la création d'un ticket et sa dernière clôture.
_English_: Lead Time
_Avoid_: time to delivery (ambigu), délai

**Cycle Time**:
Temps cumulé passé par un ticket dans les Statuts de travail, Blocages inclus, toutes périodes confondues. Indéfini si le ticket n'a jamais été démarré.
_English_: Cycle Time
_Avoid_: temps de dev, durée

**Débit**:
Nombre de Livraisons sur une période (équivalent de la Deployment Frequency DORA).
_English_: Throughput
_Avoid_: vélocité, throughput

**Débit récent**:
Le Débit d'une Epic sur ses 28 derniers jours, ou depuis sa création si elle est plus récente, sans jamais descendre sous 7 jours : sur une Epic de moins de 7 jours, la mesure remonte donc avant sa création. Ce sont les Livraisons de ses Enfants, sur une Durée écoulée. Sous 4 Livraisons, il n'y a pas assez de Débit pour en tirer un rythme.
_English_: Recent throughput

**Prévision de fin**:
Fourchette de Durée écoulée que mettraient les Enfants restants d'une Epic à être livrés, au rythme de son Débit récent. Elle est d'autant plus large que les Livraisons sont peu nombreuses (plus ou moins la racine de leur nombre) : une prévision ne prétend pas à plus de précision que son rythme n'en a, et au-delà d'un an elle se contente de le dire, sans date. Elle suppose le rythme constant et aucun Enfant ajouté, n'est pas un engagement, et est masquée sans assez de Débit récent, pour une Epic fermée ou dont tout est livré.
_English_: Completion forecast
_Avoid_: date de fin, échéance

**Bug d'origine**:
Un ticket de type bug, créé à ou après la dernière clôture d'une Livraison à laquelle il est relié par un lien « découvert à partir de » actif. Les deux dates sont celles de l'historique du Projet, dans l'ordre de ses changements : un bug créé après la clôture d'une Livraison, dans cet historique, lui est postérieur, même si une horloge s'est trompée. Le ticket relié est autre que lui-même : un bug n'est jamais son propre Bug d'origine. Un bug créé avant cette clôture, ou relié à un ticket qui n'est pas une Livraison (ouvert, Abandon, Renoncement), a été trouvé en cours de travail : il n'est l'origine d'aucun échec. Un bug relié à une Epic n'est l'origine d'aucun échec et n'est pas compté comme relié. Un bug en Abandon n'est jamais un Bug d'origine : il décrit le même défaut qu'un autre bug. Il transmet ses liens au bug qui le remplace ; pour ces liens, la date qui compte est celle de sa propre création, car c'est lui qui a constaté le défaut.
_English_: Escaped bug

**Taux d'échec**:
Part des Livraisons ayant au moins un Bug d'origine (équivalent du Change Failure Rate DORA). Non significatif tant que la Couverture est faible.
_English_: Change failure rate
_Avoid_: CFR, qualité

**Couverture**:
Part des bugs dont l'origine est renseignée : c'est le cas d'un bug relié par un lien « découvert à partir de » actif à un ticket du Projet hors Epic, autre que lui-même, que ce ticket soit livré ou non. Un bug en Abandon n'est pas compté : il décrit le même défaut qu'un autre bug, et transmet ses liens au bug qui le remplace.
_English_: Coverage

**Temps de rétablissement**:
Lead Time des bugs critiques (P0/P1) (équivalent du MTTR DORA).
_English_: Time to restore
_Avoid_: MTTR

**WIP**:
Nombre de tickets dans un Statut de travail au même moment.
_English_: WIP

**Arrivées**:
Nombre de tickets créés sur une période, à comparer au Débit.
_English_: Arrivals

**Efficacité du flux**:
Part du Cycle Time passée hors Blocage.
_English_: Flow efficiency

**Attente de dépendance**:
Temps passé en Backlog avant le premier démarrage ; composante du Lead Time.
_English_: Dependency wait

**Réouverture**:
Une Transition d'un ticket fermé vers un statut non fermé.
_English_: Reopen
_Avoid_: régression

**Taux d'abandon**:
Part des Abandons parmi les tickets fermés sur une période.
_English_: Drop rate

**Taux de Réouverture**:
Part des clôtures d'une période (Transitions vers fermé) que suit une Réouverture. Un ticket fermé, rouvert puis refermé compte deux clôtures, dont seule la première est suivie d'une Réouverture ; la Livraison, elle, est la dernière.
_English_: Reopen rate
_Avoid_: taux de régression

**Écart Arrivées–Débit**:
Arrivées moins Débit sur une période. Positif, il arrive plus de tickets qu'il n'en est livré.
_English_: Arrivals–throughput gap

**Répartition par type**:
Part de chaque type de ticket (bug, feature, task, chore…) parmi les Arrivées, les Livraisons et le WIP d'une période.
_English_: Type mix

**Attente en Prêt**:
Temps passé dans la colonne Prêt entre la création d'un ticket et sa dernière clôture, avant un premier démarrage comme après un retour à ouvert ; composante du Lead Time. Le ticket pouvait être démarré et ne l'était pas.
_English_: Ready wait

**Décomposition du Lead Time**:
Le Lead Time cumulé des Livraisons d'une période, réparti en cinq parts qui s'additionnent : Attente de dépendance, Attente en Prêt, travail (Cycle Time hors Blocage), Blocage (dans le Cycle Time) et autre attente (le reste : Backlog après un premier démarrage, différé, fermé avant une Réouverture).
_English_: Lead Time breakdown

**Prêt qui stagne**:
Un Prêt dont l'Âge calendaire dépasse 14 jours (14 jours pile ne stagne pas). L'âge d'un Prêt se compte depuis qu'il l'est devenu : création, fin de son Blocage, retour à ouvert ou Réouverture.
_English_: Stale ready
_Avoid_: ticket oublié, ticket périmé

**Carte d'activité**:
Nombre de Transitions d'une période selon le jour de la semaine (du lundi au dimanche) et l'heure, dans le fuseau de l'utilisateur. La création d'un ticket n'en est pas une : c'est une Arrivée.
_English_: Activity map

**Parcours d'un ticket**:
Le dessin, en tête des métriques, de ce qui entre (les Arrivées), des trois états qu'un ticket traverse (Backlog, Prêt, En cours) et de ce qui sort (les Livraisons). C'est un fil : la longueur de chaque tronçon est la part du Lead Time cumulé qui s'y passe (celles de la Décomposition du Lead Time), le tube est vide là où le ticket attend et plein là où l'on y travaille. Le Lead Time y embrasse tout le fil, le Cycle Time le seul tronçon En cours.
_English_: Ticket journey
_Avoid_: pipeline, tunnel, funnel

**Panneau de ticket**:
Le détail d'un ticket, en lecture seule, ouvert depuis le kanban de son Projet. Il réunit les champs du ticket et sa Chronologie.
_English_: Ticket panel
_Avoid_: page de ticket

**Chronologie**:
La vie d'un ticket telle que son Panneau la raconte : ses Transitions avec le temps passé dans chaque statut, ses Blocages avec leurs phases, et ses durées (Lead Time, Cycle Time, temps bloqué en cours de travail), qui sont celles des métriques : le Panneau et la page Métriques disent la même chose. Elle est lue dans l'historique du Projet ; pour un ticket que cet historique ne connaît pas, on ne sait que ses dates de création et de clôture.
_English_: Timeline
_Avoid_: historique (c'est sa source : l'historique Dolt du Projet)

**Phase d'un Blocage**:
Partie d'un Blocage où le ticket reste dans la même situation : _avant le premier démarrage_ (en Backlog : l'Attente de dépendance), _en cours de travail_ (le temps bloqué, seule phase comptée dans le Cycle Time) ou _autre attente_ (tout le reste : revenu à ouvert ou rouvert après un premier démarrage, ou dans un autre statut non fermé, le différé par exemple, même avant tout démarrage). Deux phases voisines de même sorte n'en font qu'une.
_English_: Blockage phase

**Cycle Time de référence**:
Le 85ᵉ centile du Cycle Time des Livraisons des 90 derniers jours du même Projet et du même type qu'un ticket ; sous 10 Livraisons, celles de tous les types du Projet ; sous 10 encore, il n'y en a pas, et on ne prétend pas savoir ce qui est normal.
_English_: Reference cycle time

**Dérive**:
Un ticket en statut de travail dont le Cycle Time en cours dépasse son Cycle Time de référence. Un ticket revenu à ouvert ne dérive plus : il est redevenu Prêt ou Backlog. Sans Cycle Time de référence, aucun ticket ne dérive.
_English_: Drift
_Avoid_: ticket en retard, SLA

**Blocage long**:
Un Blocage dont la phase en cours de travail dure depuis plus de 3 jours de Durée écoulée (3 jours pile ne suffisent pas). Elle court depuis que le ticket est à la fois en statut de travail et en Blocage, sans interruption : passer d'un Statut de travail à un autre ne la recommence pas.
_English_: Long blockage

**WIP inhabituel**:
Un WIP d'un Projet au-dessus du 85ᵉ centile de son WIP quotidien des 90 derniers jours : le WIP relevé toutes les 24 heures, à la même heure que maintenant, les jours où le Projet existait. Sous 14 relevés, on ne sait pas ce qui est habituel.
_English_: Unusual WIP

**Signal**:
Une situation en cours qui mérite d'être regardée maintenant : Dérive, Prêt qui stagne, Blocage long, WIP inhabituel, Validation qui attend, Boucle de Retours ou Porte humaine saturée. Un Signal existe tant que sa condition est vraie dans le Dernier commit ; on ne peut pas l'écarter. Le Retravail n'en est pas un : c'est un constat après coup.
_English_: Signal
_Avoid_: alerte, notification

**Prise rendue**:
Une Transition d'un Statut de travail autre que À valider vers ouvert, sans clôture entre les deux. Remettre à ouvert un ticket À valider est un Report, pas une Prise rendue.
_English_: Handback
_Avoid_: abandon de prise (se confond avec l'Abandon), régression

**Retravail**:
Un ticket qui, sur une période, a subi au moins une Réouverture, une Prise rendue, ou dont une Livraison a reçu un Bug d'origine créé sur cette période. Chaque cause se nomme : c'est la liste des tickets qui reviennent, là où le Taux de Réouverture et le Taux d'échec n'en donnent que la proportion.
_English_: Rework
_Avoid_: rework, régression

**Tendance longue**:
Débit, Débit sain, Lead Time au 85ᵉ centile et Taux de Réouverture semaine par semaine sur les 12 dernières semaines du Fuseau de l'utilisateur, sans lissage. Une semaine de moins de 4 Livraisons ne suffit pas à un centile digne de foi.
_English_: Long trend

**Rapport de rétrospective**:
Un résumé en markdown, à copier, de la période que montre la page Métriques : Débit, Débit sain, Lead Time, Taux de Réouverture et Taux d'échec avec leur évolution par rapport à la période précédente, la Tendance longue, le Retravail de la période et les Signaux en cours ; avec les Statuts de relais, les Décisions tenues et leur répartition par sens, la part des Livraisons prouvées, le Coût d'attention et la liste des Livraisons sans Feu vert. Les Signaux disent le moment du rapport, pas la période.
_English_: Retrospective report
_Avoid_: export, bilan

**Tour de relecture**:
Un passage d'un ticket En relecture : une Transition vers ce statut.
_English_: Review round
_Avoid_: itération

**Retour**:
Une Transition d'un Statut de relais vers en cours ou rattaché à un agent : le ticket repart au développement. Son origine est le statut qu'il quitte (relecture, intégration ou validation). Un Retour n'est pas du Retravail : la chaîne arrête un défaut avant la Livraison.
_English_: Send-back
_Avoid_: rejet, renvoi, rework

**Livraison relue**:
Une Livraison qui a connu au moins un Tour de relecture avant sa dernière clôture.
_English_: Reviewed delivery

**Acceptation au premier passage**:
Part des Livraisons relues d'une période qui n'ont subi aucun Retour avant leur dernière clôture. Non significative sous 10 Livraisons relues.
_English_: First-pass acceptance
_Avoid_: first-pass yield, taux de réussite

**Couverture de relecture**:
Part des Livraisons d'une période qui sont des Livraisons relues. Elle dit si l'Acceptation au premier passage est représentative.
_English_: Review coverage

**Tours par Livraison**:
Répartition des Livraisons relues d'une période selon leur nombre de Tours de relecture : 1, 2, 3, 4 ou plus.
_English_: Review rounds per delivery

**Taux d'échec après relecture**:
Le Taux d'échec des seules Livraisons relues d'une période, à lire à côté de celui des Livraisons qui ne l'ont pas été.
_English_: Change failure rate after review

**Attente humaine**:
Temps cumulé passé À valider par un ticket, toutes périodes confondues ; composante du Cycle Time.
_English_: Human wait
_Avoid_: temps de validation

**Décomposition du Cycle Time**:
Le Cycle Time cumulé des Livraisons d'une période, réparti en six parts qui s'additionnent : Relecture, Intégration et Attente humaine (le temps passé dans chaque Statut de relais), Blocage, et le reste du travail, coupé au premier Retour en Développement (avant) et Correction (après). Un temps à la fois de relais et de Blocage compte en Blocage.
_English_: Cycle Time breakdown

**Validation qui attend**:
Un ticket À valider depuis plus de 24 heures de Durée écoulée (24 heures pile ne suffisent pas).
_English_: Waiting validation

**Boucle de Retours**:
Un ticket non fermé qui a subi au moins 3 Retours.
_English_: Send-back loop
_Avoid_: ping-pong

**Décision**:
Une Transition qui fait sortir un ticket de À valider : la main repasse de l'utilisateur à la chaîne. Son sens se lit au statut d'arrivée : Feu vert, Relance, Refus ou Report. Un ticket qui n'est jamais passé À valider ne porte aucune Décision.
_English_: Decision
_Avoid_: validation, approbation (ce n'est qu'un de ses sens)

**Feu vert**:
Une Décision qui fait avancer le ticket : vers une clôture qui est une Livraison, ou vers En intégration.
_English_: Green light
_Avoid_: approbation, merge

**Relance**:
Une Décision qui remet le ticket dans la chaîne : vers en cours, rattaché à un agent, un statut compté comme en cours, ou En relecture. Vers les trois premiers, c'est aussi un Retour, d'origine validation ; vers En relecture, ce n'en est pas un.
_English_: Rerun
_Avoid_: renvoi, rejet (se confondent avec le Retour)

**Refus**:
Une Décision qui ferme le ticket sans Livraison.
_English_: Rejection
_Avoid_: abandon (l'Abandon est une cause de clôture, le Refus une Décision)

**Report**:
Une Décision qui sort le ticket de la chaîne sans le fermer : vers ouvert, différé, bloqué, ou tout autre statut non fermé que ceux du Feu vert et de la Relance.
_English_: Postponement
_Avoid_: mise en attente

**Livraison sans Feu vert**:
Une Livraison passée par au moins un Statut de relais depuis sa dernière Réouverture (ou sa création), sans avoir reçu de Feu vert entre-temps. Le travail que l'utilisateur fait lui-même, sans passer par la chaîne, n'en produit jamais.
_English_: Delivery without green light

**Livraison saine**:
Une Livraison sans Bug d'origine, qu'aucune Réouverture n'a précédée : livrée du premier coup, et rien n'en est revenu. Sans limite de temps : un Bug d'origine trouvé des mois plus tard la rend malsaine après coup, comme il compte dans le Taux d'échec. Une Prise rendue ne compte pas : elle précède la Livraison, et la chaîne l'a arrêtée.
_English_: Sound delivery
_Avoid_: livraison réussie, bonne livraison

**Débit sain**:
Le nombre de Livraisons saines sur une période, à lire à côté du Débit. Provisoire pour une période récente, dont les Livraisons n'ont pas encore eu le temps de revenir ; non significatif tant que la Couverture est faible, comme le Taux d'échec.
_English_: Sound throughput

**Capacité de décision**:
Le nombre de tickets que l'utilisateur accepte d'avoir À valider en même temps, tous Projets confondus. Il la fixe lui-même (5 par défaut) : elle ne se tire pas de l'historique, car une pile habituelle n'est pas pour autant acceptable.
_English_: Decision capacity

**Porte humaine saturée**:
Plus de tickets À valider, tous Projets confondus, que la Capacité de décision (autant ne suffit pas). C'est un Signal de l'utilisateur, pas d'un Projet : la porte, c'est lui.
_English_: Saturated human gate

**Intention écrite**:
Un ticket dont les critères d'acceptation n'étaient pas vides à son premier démarrage. Des critères écrits ensuite, en cours de travail, n'en font pas une.
_English_: Written intent
_Avoid_: spec, ticket bien rédigé

**Dernière visite**:
Le moment où l'utilisateur a indiqué avoir vu tout ce qui s'est passé. Elle ne bouge que sur ce geste, jamais à l'ouverture ni au rechargement de l'application, et reste propre à un navigateur ; sans geste, on remonte 24 heures.
_English_: Last visit

**Décision tenue**:
Un Feu vert ou un Refus que rien n'a démenti. Un Feu vert est démenti quand la Livraison qui le suit reçoit un Bug d'origine ou est rouverte ; un Refus, quand le ticket est rouvert. Un Feu vert suivi d'un Retour d'intégration n'est pas démenti : la chaîne a fait son travail. Une Relance ou un Report ne sont jamais ni tenus ni démentis. Provisoire pour une période récente. C'est tout ce que l'historique peut dire d'une Décision : pas qu'elle était bonne, seulement que rien ne l'a contredite.
_English_: Held decision
_Avoid_: bonne décision

**Livraison prouvée**:
Une Livraison passée par la chaîne (au moins un Statut de relais depuis sa dernière Réouverture ou sa création), qui est une Intention écrite et a connu sur ce même intervalle au moins un Tour de relecture, au moins un passage En intégration et un Feu vert. Aucune exception selon le type.
_English_: Evidenced delivery
_Avoid_: livraison validée, livraison conforme

**Coût d'attention**:
Le nombre moyen de Décisions qu'ont demandées les Livraisons passées par la chaîne sur une période. Chaque Relance l'augmente : c'est une fois de plus où l'utilisateur a dû juger.
_English_: Attention cost

**File de décisions**:
Les tickets À valider, du plus ancien au plus récent, chacun avec son attente et ses preuves (Intention écrite, Tours de relecture, Retours par origine, passage En intégration), comptés contre la Capacité de décision. Une Validation qui attend s'y marque sur sa ligne.
_English_: Decision queue

**Renoncement**:
Un ticket fermé que l'utilisateur a décidé de ne pas faire, marqué à sa clôture par le label `declined`. Ce n'est ni une Livraison ni un Abandon. Rien n'est rétroactif : un « won't fix » sans ce label reste une Livraison, et la cause ne se devine jamais au texte de la raison de clôture. Un ticket qui porte aussi un lien « doublon de » ou « remplacé par » est un Abandon, pas un Renoncement. Un Bug d'origine le reste s'il devient un Renoncement : il constate un défaut qu'on décide de ne pas corriger, alors qu'un bug en Abandon décrit le même défaut qu'un autre bug.
_English_: Decline
_Avoid_: won't fix, rejet

**Outcome visé**:
Le résultat qu'une Epic doit produire, au-delà de ses Livraisons : « réduire le temps de chargement de la page d'accueil de 3 s à 1 s ». Il s'écrit avant qu'elle démarre, dans la clé `outcome` de ses métadonnées. Ses critères d'acceptation disent quand son travail est fini, son Outcome visé ce que ce travail doit changer. Throughline le montre sans dire s'il est atteint : cela se mesure hors de l'historique des Projets.
_English_: Target outcome
_Avoid_: objectif, output, critères d'acceptation

## Relationships

- Un **Projet** contient zéro ou plusieurs tickets
- Les durées (**Lead Time**, **Cycle Time**, **Temps de rétablissement**, **Attente de dépendance**, **Attente en Prêt**, **Attente humaine**, âge d'un ticket en cours) sont des **Durées écoulées** ; l'âge d'un **Prêt**, lui, est un **Âge calendaire**
- Une **Epic** a des **Enfants** ; son **Avancement** = **Livraisons** parmi ses **Enfants à livrer**
- La **Prévision de fin** d'une **Epic** se tire de son **Débit récent**
- Un **Bug d'origine** est relié à au moins une **Livraison**, qu'il met chacune en échec ; une **Livraison** peut avoir plusieurs Bugs d'origine
- Les jours des périodes, l'**Âge calendaire** et la **Carte d'activité** se comptent dans le **Fuseau de l'utilisateur**, pas dans celui du serveur
- La **Vue globale** agrège tous les **Projets** suivis ; le kanban reste centré sur un **Projet**
- Le kanban, le **Panneau de ticket**, les métriques et la **Chronologie** d'un **Projet** lisent le même **Dernier commit**
- Un **Blocage** se découpe en **phases** : seule celle en cours de travail compte dans le **Cycle Time** ; celle d'avant le premier démarrage est l'**Attente de dépendance**
- Une **Dérive** compare le **Cycle Time** en cours d'un ticket à son **Cycle Time de référence**
- Les **Signaux** sont la **Dérive**, le **Prêt qui stagne**, le **Blocage long**, le **WIP inhabituel**, la **Validation qui attend**, la **Boucle de Retours** et la **Porte humaine saturée** ; le **Retravail** n'en est pas un
- Une **Décision** fait sortir un ticket de À valider ; ses sens sont le **Feu vert**, la **Relance**, le **Refus** et le **Report**. Une **Relance** vers le développement est aussi un **Retour**, d'origine validation
- Le **Débit sain** compte les **Livraisons saines** parmi les **Livraisons** du **Débit**
- Une **Décision tenue** est un **Feu vert** ou un **Refus** que ni **Bug d'origine** ni **Réouverture** n'a démenti
- Une **Livraison prouvée** réunit une **Intention écrite**, un **Tour de relecture**, un passage En intégration et un **Feu vert**
- Un **Renoncement** n'est ni une **Livraison** ni un **Abandon** ; fermé depuis À valider, c'est un **Refus**
- Un **Report** depuis À valider n'est pas une **Prise rendue**, donc pas du **Retravail**
- Une **Epic** peut porter un **Outcome visé** ; ses **Livraisons** et son **Avancement** ne disent pas s'il est atteint
- La **Porte humaine saturée** compare les tickets À valider de tous les **Projets** à la **Capacité de décision**
- Les **Statuts de relais** sont des **Statuts de travail** : leur temps compte dans le **Cycle Time**, et un ticket n'est que dans un statut à la fois
- Un **Retour** n'est pas du **Retravail** : il revient au développement avant la **Livraison**, pas après
- La **Décomposition du Cycle Time** détaille les parts travail et **Blocage** de la **Décomposition du Lead Time**
- L'**Acceptation au premier passage**, les **Tours par Livraison** et le **Taux d'échec après relecture** ne portent que sur les **Livraisons relues** ; la **Couverture de relecture** dit quelle part des Livraisons elles représentent
- Le **Retravail** naît d'une **Réouverture**, d'une **Prise rendue** ou d'un **Bug d'origine**
- Le **Rapport de rétrospective** réunit les indicateurs d'une période, sa **Tendance longue**, son **Retravail** et les **Signaux** en cours
- Le **Panneau de ticket** montre la **Chronologie** du ticket : ses **Transitions**, ses **Blocages** et leurs phases, avec les durées des métriques
- Le **Parcours d'un ticket** dessine la **Décomposition du Lead Time** : l'**Attente de dépendance** est le tronçon Backlog, l'**Attente en Prêt** le tronçon Prêt, le travail et le **Blocage** le tronçon En cours
