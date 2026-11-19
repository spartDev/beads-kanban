# Des statuts de relais disent qui a la main après le développement, et comptent comme statuts de travail

L'auteur fait développer, relire et intégrer ses tickets par une chaîne d'agents. Un orchestrateur lance un agent développeur, puis un agent relecteur qui le renvoie au développeur tant qu'il trouve des défauts. Une demande de fusion (PR) passe ensuite la CI et une revue externe, et l'auteur teste à la main avant de donner son feu vert. Dans beads, tout cela tient dans un seul statut : le ticket passe en cours au `--claim` et y reste jusqu'au `bd close`. Sur les 20 sessions Claude Code relues le 16 novembre 2026 (quatre Projets), 444 sous-agents ont tourné, dont environ 300 relectures, pour 84 `--claim` et seulement 10 `--status`. Le Cycle Time additionne donc sans les distinguer le développement, les relectures, les corrections, la PR et l'attente de l'auteur.

Nous ajoutons à chaque Projet trois statuts personnalisés de beads, de catégorie `wip` et de mêmes noms partout :

- `in_review` (En relecture) : un agent relecteur a la main ;
- `in_integration` (En intégration) : la PR est ouverte, le temps de sa CI et de sa revue externe ;
- `awaiting_human` (À valider) : le ticket attend l'auteur.

L'orchestrateur les pose à chaque passage de relais. L'app les compte comme statuts de travail, aux côtés d'en cours, rattaché à un agent et bloqué. Le statut dit qui a la main, sans imposer d'ordre : une relecture faite sur une PR déjà ouverte passe le ticket en `in_review`, puis il revient en `in_integration`.

Mise en œuvre : epic bdesk-pz0. Vocabulaire : CONTEXT.md (Statut de travail, Statut de relais, Tour de relecture, Retour…).

## Règle de passage de relais

Configuration, une fois par Projet :

```bash
bd config set status.custom "in_review:wip,in_integration:wip,awaiting_human:wip"
```

C'est l'orchestrateur qui lance ces commandes : les sous-agents qui travaillent en bac à sable n'ont pas `bd`.

| Moment | Commande |
|---|---|
| lancement du développeur | `bd update <id> --claim` |
| lancement d'un relecteur | `bd update <id> --status in_review` |
| défauts trouvés (relecture, CI, revue externe ou test de l'auteur) | `bd update <id> --status in_progress` |
| PR ouverte, ou relecture acceptée sur une PR ouverte | `bd update <id> --status in_integration` |
| une question, un test ou un feu vert attendu de l'auteur | `bd update <id> --status awaiting_human` |
| fusion | `bd close <id> --reason …` |

## Considered Options

- **Des labels** (un `needs-review` a déjà été improvisé sur un epic d'un autre Projet) : rejeté. L'app ne lit dans l'historique que les changements de statut, les Transitions (ADR 0001). Un label demanderait une nouvelle lecture (`dolt_history_labels`), et plusieurs labels peuvent coexister, ce qui rend ambigu le temps passé « en relecture ».
- **Les transcripts de Claude Code**, dont les descriptions de sous-agents portent le rôle et l'identifiant du ticket (`Review <id>`, `Fix review <id>`) : rejetés comme source. Ils seraient rétroactifs, mais leurs conventions de nommage varient (une relecture de PR ne nomme pas toujours son ticket), ils n'existent que sur la machine qui a lancé les agents, leurs verdicts se devinent dans du texte libre, et ils sortiraient l'app de l'historique Dolt, sa source unique (ADR 0001).
- **`bd human`** : rejeté. Il crée un ticket à part, étiqueté `human`, qui se ferme quand l'auteur répond ; le ticket qui attend, lui, ne change pas de statut, et son attente ne se mesure pas.
- **Laisser ces statuts hors des statuts de travail**, comme tout statut inconnu aujourd'hui (« En pause », temps compté en autre attente) : rejeté. Le Cycle Time chuterait le jour de l'adoption sans que le travail ait changé, et ne serait plus comparable à l'historique, où tout était en cours.
- **Un statut par passe** (relecture, relecture finale) **ou par relecteur** : rejeté. Le nombre de Tours de relecture suffit à distinguer les passes, et un statut par étape figerait un circuit qui varie d'un Projet à l'autre.

## Consequences

- **Les métriques actuelles gardent leur définition.** Lead Time, Débit, Arrivées, Taux d'échec, Couverture, Réouvertures, Abandons, Avancement et Prévision de fin ne dépendent pas des statuts de travail. Cycle Time, Cycle Time de référence, WIP, Dérive, Blocage long, Prise rendue et Efficacité du flux s'appliquent avec trois statuts de travail de plus. Un ticket dans un de ces statuts sort de « En pause ». Un Retour n'est pas du Retravail : la chaîne arrête un défaut avant la Livraison.
- **Les nouvelles mesures se lisent dans les Transitions déjà lues**, sans nouvelle source : Acceptation au premier passage (l'indicateur principal), Couverture de relecture, Tours par Livraison, Taux d'échec après relecture, Décomposition du Cycle Time, Attente humaine, et deux Signaux, Validation qui attend et Boucle de Retours. Mesures indicatives tirées des sessions relues : sur 86 tickets relus de beads-desktop, 34 (40 %) sont revenus au moins une fois au développeur ; en médiane, un développement a duré 2 h 34, une relecture 18 min et une correction 1 h 13 (durées des agents).
- **Rien n'est rétroactif.** Avant l'adoption, tout le travail est resté en cours et compte en Développement. La Couverture de relecture dit quand les nouvelles mesures deviennent représentatives, et l'Acceptation au premier passage n'est pas significative sous 10 Livraisons relues.
- **Mieux vaut poser les statuts avant que l'app les connaisse.** Entre-temps, les métriques sont faussées : le temps de relais compte en autre attente, hors du Cycle Time. Mais l'historique garde tout, et l'app ne stocke aucun résultat (ADR 0001) : tout se recalcule juste dès qu'elle compte les statuts de relais.
- **Les noms sont un contrat.** L'app reconnaît `in_review`, `in_integration` et `awaiting_human` par leur nom, lu dans `status.custom` (table `config`, au Dernier commit). Un autre statut personnalisé de catégorie `wip` compte comme en cours ; les autres catégories restent « En pause ». Un Projet qui ne déclare aucun statut de relais garde son kanban à cinq colonnes.
- **La déclaration n'est pas la liste que bd applique** (bdesk-pz0.2). bd 1.3.1 valide les statuts contre sa table `custom_statuses`, que `bd config set status.custom` synchronise, et ne relit la clé que si cette table est vide : après un `bd config unset status.custom`, des tickets peuvent encore porter `in_review` alors que l'app ne voit plus aucun statut déclaré. L'app lit pourtant la clé, l'interface documentée de bd (lire `custom_statuses` exigerait une table de plus dans HEAD et rendrait illisibles les bases d'un bd qui ne l'a pas) : les Statuts de relais se reconnaissent donc à leur nom, qu'ils soient déclarés ou non, et la déclaration ne compte que pour la catégorie des autres statuts personnalisés (règle appliquée par bdesk-pz0.3).
- **La qualité des mesures dépend de l'orchestrateur.** Un passage oublié laisse le temps de relecture en Développement. Si cela arrive, un hook `PreToolUse` sur l'outil `Agent` pourra poser le statut d'après la description de l'agent (`Review <id>` donne `in_review`).
- **Vérifié avec bd 1.3.1 et Dolt** sur un Projet jetable, le 16 novembre 2026. bd refuse un statut non déclaré (« invalid status ») et stocke `status.custom` dans la table `config`. Chaque passage fait un commit Dolt : les huit états successifs d'un ticket (création, en cours, relecture, retour en cours, relecture, intégration, validation, clôture) apparaissent dans `dolt_history_issues`. `bd ready` exclut les statuts `wip`, et `bd close` accepte un ticket en `awaiting_human`.
