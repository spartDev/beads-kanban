# Un ticket fermé avec le label `declined` est un Renoncement : ni Livraison ni Abandon

Une Livraison est un ticket fermé qui n'est pas un Abandon. Un « won't fix » est donc compté comme une Livraison (`src/domain/health.test.ts`) : le Débit monte quand l'utilisateur décide de ne pas faire quelque chose. Quand des agents produisent plus d'idées et de tickets qu'un humain ne peut en juger, savoir ce qu'on ne livre pas est une décision qui a autant de valeur qu'une Livraison. La compter comme du travail fait la rend invisible, et gonfle le Débit.

Nous ajoutons le **Renoncement** (CONTEXT.md) : un ticket fermé qui porte le label `declined` au Dernier commit. Ce n'est ni une Livraison ni un Abandon. Le label se pose à la clôture, par l'orchestrateur ou par l'utilisateur :

```bash
bd close <id> --reason "…"
bd label add <id> declined
```

Fermé depuis À valider, un Renoncement est un Refus. Mise en œuvre : bdesk-3e9.10 (epic bdesk-3e9).

## Considered Options

- **La raison de clôture** (« won't fix », « hors périmètre »…) : rejetée, pour la même raison que l'Abandon ne s'y lit pas. C'est un texte libre, dans la langue de qui ferme, et l'app ne devine jamais une cause au texte.
- **Un statut personnalisé de catégorie fermée** (`declined`) : rejeté. Toutes les règles qui lisent une clôture (Livraison datée de sa dernière clôture, Réouverture, Taux de Réouverture, Retravail) reconnaissent un seul statut fermé ; un second les obligerait toutes à l'apprendre, ainsi que tout ce qui, hors de l'app, attend `closed`. Le label laisse le ticket fermé comme un autre.
- **Un lien vers un autre ticket**, comme l'Abandon : rejeté. Un Renoncement n'a pas d'autre ticket qui le porte : personne ne fera ce travail.
- **Élargir l'Abandon** : rejeté. Un Abandon dit que le travail existe ailleurs (doublon, remplacé) ; un Renoncement, qu'il n'existera pas. Les mêler fausserait le Taux d'abandon.

## Consequences

- **Le Débit des Projets qui adoptent le label baisse**, et c'est le but : il ne compte plus ce qui n'a pas été fait. Le Lead Time et le Taux d'échec, mesurés sur les Livraisons, l'excluent aussi.
- **Un Renoncement n'est pas un Enfant à livrer** d'une Epic, comme l'Abandon : une Epic dont il ne reste que des Renoncements à livrer atteint 100 % d'Avancement.
- **Sa clôture reste une clôture** : elle compte dans le Taux de Réouverture. Fermé depuis À valider, c'est un Refus, qu'une Réouverture dément.
- **Rien n'est rétroactif.** Un « won't fix » fermé avant l'adoption, ou sans le label, reste une Livraison.
- **Le label se lit au Dernier commit, pas dans l'historique.** Le Renoncement prend la date de la dernière clôture du ticket ; un label posé ou retiré plus tard change le passé, ce qu'autorise une app qui ne stocke aucun résultat et recalcule tout (ADR 0001). Les métriques doivent lire les labels de tous les tickets fermés, une lecture de plus au Dernier commit.
