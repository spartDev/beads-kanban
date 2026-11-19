# L'Outcome visé d'une Epic s'écrit dans la clé `outcome` de ses métadonnées

Une Epic livrée n'est pas forcément une bonne décision : elle l'est si elle change ce qu'elle devait changer, comme réduire un temps de chargement ou augmenter un trafic. Aujourd'hui, rien ne l'écrit. Les critères d'acceptation des Epics disent quand leur travail est fini (« les enfants sont livrés, les tests passent »), c'est-à-dire leur output, pas leur outcome. Écrire le résultat visé avant de démarrer est la part humaine du travail que la chaîne d'agents ne peut pas faire : définir l'intention.

Nous ajoutons l'**Outcome visé** (CONTEXT.md) : une phrase dans la clé `outcome` des métadonnées de l'Epic, écrite avant qu'elle démarre.

```bash
bd update <epic> --set-metadata outcome="Réduire le temps de chargement de la page d'accueil de 3 s à 1 s"
```

Throughline la lit au Dernier commit, l'affiche en tête de la page de l'Epic et compte, dans l'onglet Décisions, la part des Epics démarrées qui en ont une. Il ne dit pas si elle est atteinte : cela se mesure hors de l'historique des Projets, sa seule source (ADR 0001). Mise en œuvre : bdesk-3e9.9 (epic bdesk-3e9) ; vérification de l'atteinte, différée : bdesk-pm8.

## Considered Options

- **Les critères d'acceptation de l'Epic** : rejetés. Ils disent déjà quand le travail est fini ; y mêler le résultat attendu rendrait les deux illisibles, et un futur vérificateur ne saurait pas lequel mesurer.
- **Une section de la description** (« Outcome : … ») : rejetée. L'app ne lit jamais une information dans un texte libre (la règle de l'Abandon et du Renoncement).
- **Un ticket enfant « outcome »** : rejeté. Il ne serait jamais livré comme les autres, et fausserait l'Avancement et la Prévision de fin.
- **Un lien vers un document** (`--spec-id`, `--external-ref`) : rejeté. L'app devrait sortir de l'historique Dolt pour le lire.
- **Les métadonnées** : retenues. C'est du JSON au Dernier commit, lisible par l'app comme par un agent, et on pourra y ajouter plus tard une mesure, une valeur de départ ou une cible sans rien casser.

## Consequences

- **Rien n'est rétroactif.** Les Epics existantes n'ont pas d'Outcome visé, et la part de celles qui en ont un part de zéro.
- **Un Outcome visé vide, ou une clé absente, vaut absence.** Une base dont les tickets n'ont pas de colonne de métadonnées (ancienne version) aussi.
- **Throughline ne juge pas l'Outcome.** Il ne vérifie ni qu'il est mesurable, ni qu'il est atteint ; il le rend visible là où l'on décide de faire l'Epic.
- **Cette epic montre l'exemple** : bdesk-3e9 porte son propre Outcome visé.
