/**
 * Ce que mesure chaque tuile de la page Métriques, et à quoi elle sert : le texte de l'infobulle de son icône info. Les mots
 * sont ceux de CONTEXT.md (Livraison, Blocage, Prêt…), pour que l'infobulle dise la même chose que le reste de l'application.
 */
export const METRIC_HELP = {
  throughput:
    'Nombre de Livraisons sur la période : tickets fermés pour travail terminé, hors doublons et remplacés. Il mesure le rythme de livraison (l’équivalent de la Deployment Frequency DORA).',
  leadTime:
    'Durée écoulée entre la création d’un ticket et sa dernière clôture, attentes comprises. C’est le délai que voit le demandeur : en combien de temps une demande est livrée.',
  cycleTime:
    'Temps cumulé passé en travail (en cours, rattaché à un agent, bloqué), du premier démarrage à la clôture. Il mesure la durée du travail lui-même : l’écart avec le Lead Time montre combien les tickets attendent avant d’être pris.',
  failureRate:
    'Part des Livraisons dont découle au moins un bug, relié par un lien « découvert à partir de ». Il mesure la qualité de ce qui est livré (l’équivalent du Change Failure Rate DORA). Non significatif tant que peu de bugs ont leur origine renseignée (Couverture).',
  recoveryTime:
    'Lead Time des bugs critiques (P0 et P1) livrés sur la période. Il mesure la vitesse de réaction face à un incident (l’équivalent du MTTR DORA).',
  wip:
    'Nombre de tickets en cours de travail en même temps. Trop de travail en parallèle allonge le Cycle Time : un WIP bas et stable signe un flux maîtrisé.',
  balance:
    'Tickets créés (Arrivées) moins tickets livrés sur la période. Positif, le stock de travail grossit ; négatif, il se résorbe. Il dit si l’équipe absorbe la demande.',
  efficiency:
    'Part du Cycle Time passée à travailler plutôt qu’en Blocage, à attendre un autre ticket non fermé. Plus elle est haute, moins le travail démarré reste coincé derrière ses dépendances.',
  reopening:
    'Part des clôtures de la période suivies d’une Réouverture. Un ticket rouvert n’était pas vraiment fini : un taux élevé signale du travail clos trop tôt ou mal défini.',
  abandonment:
    'Part des tickets fermés comme doublon d’un autre ou remplacés par un autre (Abandons). Ni bonne ni mauvaise en soi, elle renseigne sur l’hygiène du backlog et le travail en double.',
  ready:
    'Tickets Prêts (sans dépendance bloquante, démarrables) qui attendent depuis plus de 14 jours sans être démarrés. Ils signalent du travail oublié ou peu prioritaire, à trier ou à fermer.',
} as const;
