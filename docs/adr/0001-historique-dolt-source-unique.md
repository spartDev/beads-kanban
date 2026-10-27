# L'historique Dolt est la seule source des Transitions

Les métriques de flux (temps bloqué, CFD, WIP historique) exigent l'historique des changements de statut, que beads n'expose qu'à travers trois dates (`created_at`, `started_at`, `closed_at`) et un `bd history` inexploitable. Nous lisons directement l'historique Dolt de chaque Projet (`dolt_history_issues` × `dolt_log`) en lecture seule via le CLI `dolt` — y compris en mode embedded où `bd sql` n'est pas supporté — et l'app ne tient aucun journal propre. Seuls les Projets en Dolt (embedded ou server) sont suivis ; les autres (SQLite historique, JSONL seul) sont ignorés.

## Considered Options

- **Trois dates seulement** — rejeté : pas de temps bloqué, pas de CFD réel.
- **Journal propre à l'app (observation des `.beads/`)** — rejeté : exige que l'app tourne en permanence, historique qui ne commence qu'au premier lancement, alors que Dolt commit déjà chaque écriture (auto-commit `on`).
- **Cascade de sources (journal, git de `issues.jsonl`, Dolt, 3 dates)** — rejeté : complexité injustifiée une fois les Projets non-Dolt écartés.

## Consequences

- Dépendance au schéma interne de beads (tables `issues`, `dolt_log`) et au CLI `dolt` installé localement ; un changement de schéma bd peut casser la lecture.
- `bd compact` / `bd flatten` / `bd gc` détruisent l'historique ; l'utilisateur n'en fait pas usage. Si un trou est détecté, repli sur les trois dates pour les tickets concernés.
- En auto-commit `batch`, plusieurs Transitions peuvent être fusionnées en un commit (précision dégradée).
- Les Transitions se reconstruisent en compressant les statuts successifs de `dolt_history_issues` joint à `dolt_log` (dates UTC). La table `events` de beads n'est pas utilisée pour les durées : sur 157 tickets elle donne les mêmes séquences, mais ses horodatages n'ont pas de fuseau et ont basculé de l'heure locale à l'UTC lors d'une mise à jour de bd (écarts de 0 ou 7200 s selon la période). Spike bdesk-38k.2.
- Les colonnes `started_at` ne sont pas fiables (vides sur tout un Projet créé avec une ancienne version de bd) ; l'historique Dolt retrouve ces passages en cours.
- La lecture via le CLI `dolt` en mode embedded est sûre en concurrence avec `bd` (30 écritures / 60 lectures simultanées : zéro erreur, aucune Transition fusionnée, base inchangée). Un retry reste prévu par prudence.
- Un Projet en mode server dont la base n'est pas présente localement est illisible : il est signalé, pas suivi.
- Seule la lignée du premier parent est suivie : suivre toute l'ascendance mélangerait les états de branches parallèles et fabriquerait des Transitions fantômes. Les changements faits sur une branche fusionnée sont donc datés de la fusion (précision dégradée, comme en auto-commit `batch`).
- La transaction en lecture seule qui ouvre chaque requête ne bloque que les écritures de données (`insert`, `update`, `delete`) : Dolt 2.5 y laisse passer le DDL, `call dolt_*` et `select … into outfile`. La vraie barrière est le garde-fou lexical (`src/server/dolt/read-only.ts`), qui n'admet qu'une seule instruction de lecture.
- Dolt 2.5 plafonne les CTE récursives à 10 001 itérations, même avec `cte_max_recursion_depth` : la lignée se lit par une CTE récursive, donc au-delà d'environ 10 000 commits l'historique d'un Projet est illisible (503).
