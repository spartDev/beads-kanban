/**
 * Zone « metrics », groupes des répartitions (voir `../metrics.ts`) : la Répartition par type (`metrics/TypeMixChart.tsx`,
 * `metrics/mix.ts`), la Décomposition du Lead Time (`metrics/BreakdownChart.tsx`, `metrics/breakdown.ts`), la Carte d'activité
 * (`metrics/ActivityMap.tsx`, `metrics/activity.ts`) et le tableau des découpages (`metrics/SliceTable.tsx`, `metrics/slices.ts`).
 * Les nombres, pourcentages et durées arrivent écrits par les formateurs ; un nombre brut ne sert qu'au pluriel.
 */
const NBSP = '\u00a0';

const fr = {
  typeMix: {
    title: 'Répartition par type',
    description: 'Part de chaque type de ticket parmi les Arrivées, les Livraisons et les tickets en cours.',
    legend: 'Légende des types',
    empty: 'Aucune Arrivée, Livraison ni ticket en cours sur cette période.',
    rows: { arrivals: 'Arrivées', deliveries: 'Livraisons', wip: 'En cours' },
    /** « 7 Bugs », « 1 Fonctionnalité » : le libellé du type (celui du code couleur, `design/issue-palette.ts`) accordé au compte. */
    typeCount: (count: string, n: number, label: string) => `${count} ${n >= 2 ? `${label}s` : label}`,
    /** Ce que dit une barre aux lecteurs d'écran : « Livraisons : 10 Bugs (71 %), 3 Tâches (21 %) ». */
    spoken: (row: string, segments: string) => `${row} : ${segments}`,
    spokenEmpty: (row: string) => `${row} : aucun ticket`,
    caption: 'Tickets par type : Arrivées, Livraisons et en cours',
    typeHeader: 'Type',
    total: 'Total',
  },
  leadTimeBreakdown: {
    title: 'Décomposition du Lead Time',
    descriptionEmpty: 'Le Lead Time cumulé des Livraisons de la période, réparti en cinq parts qui s’additionnent.',
    description: (deliveries: string, n: number, total: string) =>
      `Le Lead Time cumulé de ${deliveries} ${n >= 2 ? 'Livraisons' : 'Livraison'} (${total}), réparti en cinq parts qui s’additionnent.`,
    noDeliveries: 'Aucune Livraison sur la période.',
    zeroLeadTime: 'Aucun Lead Time à décomposer : les Livraisons de la période ont toutes un Lead Time nul.',
    /** `parts` : « Attente de dépendance 12,5 %, Travail 40,0 %… ». */
    bar: (parts: string) => `Décomposition du Lead Time : ${parts}.`,
    partsList: 'Parts du Lead Time',
    noneWaited: 'Aucune Livraison n’a attendu une dépendance avant de démarrer.',
    waited: (waited: string, waitedN: number, deliveries: string, _deliveriesN: number, median: string, p85: string) =>
      `${waited} ${waitedN >= 2 ? 'Livraisons' : 'Livraison'} sur ${deliveries} ${waitedN >= 2 ? 'ont' : 'a'} attendu une dépendance avant de démarrer : ` +
      `médiane ${median}, P85 ${p85}.`,
    caption: 'Parts du Lead Time cumulé des Livraisons de la période',
    partHeader: 'Part',
    durationHeader: 'Durée cumulée',
    shareHeader: 'Part du Lead Time',
    total: 'Lead Time cumulé',
    /** Les cinq parts ; `none` est ce qu'on écrit d'une durée exactement nulle, accordé au libellé. */
    parts: {
      dependencyWait: {
        label: 'Attente de dépendance',
        description: 'Le temps en Backlog avant le premier démarrage : le ticket dépendait d’un ticket non fermé.',
        none: 'Aucune',
      },
      readyWait: { label: 'Attente en Prêt', description: 'Le temps passé Prêt : le ticket pouvait être démarré et ne l’était pas.', none: 'Aucune' },
      otherWait: {
        label: 'Autre attente',
        description: 'Le reste : Backlog après un premier démarrage, différé, ou fermé avant une Réouverture.',
        none: 'Aucune',
      },
      work: { label: 'Travail', description: 'Le Cycle Time hors Blocage.', none: 'Aucun' },
      blocked: {
        label: 'Blocage',
        description: 'Le Cycle Time passé en Blocage : statut bloqué, ou dépendance non fermée pendant le travail.',
        none: 'Aucun',
      },
    },
  },
  activityMap: {
    title: 'Carte d’activité',
    /** Du lundi au dimanche, comme l'API : le nom en toutes lettres (lecteurs d'écran, infobulle) et l'abréviation (axe, tableau). */
    weekdays: [
      { name: 'lundi', short: 'lun.' },
      { name: 'mardi', short: 'mar.' },
      { name: 'mercredi', short: 'mer.' },
      { name: 'jeudi', short: 'jeu.' },
      { name: 'vendredi', short: 'ven.' },
      { name: 'samedi', short: 'sam.' },
      { name: 'dimanche', short: 'dim.' },
    ],
    /** « de 14 h à 15 h », avec des espaces insécables pour que « 14 h » ne se coupe pas. */
    hourSpan: (from: number, to: number) => `de ${from}${NBSP}h à ${to}${NBSP}h`,
    /** L'en-tête d'une ligne du tableau : « 14 h ». */
    hour: (hour: number) => `${hour}${NBSP}h`,
    transitions: (count: string, n: number) => `${count} ${n >= 2 ? 'Transitions' : 'Transition'}`,
    noTransition: 'Aucune Transition',
    /** `peak` : « jeudi de 14 h à 15 h », ou null sans Transition. */
    plot: (transitions: string, peak: string | null, peakTransitions: string) =>
      `Carte d’activité : ${transitions}${peak ? `, pic le ${peak} (${peakTransitions})` : ''}.`,
    descriptionEmpty: (timeZone: string) => `Les Transitions par jour de la semaine et par heure, dans le fuseau ${timeZone}.`,
    description: (transitions: string, timeZone: string) => `${transitions} par jour de la semaine et par heure, dans le fuseau ${timeZone}.`,
    /** `slot` : « jeudi, de 14 h à 15 h ». */
    peak: (slot: string, count: string) => ` Pic : ${slot} (${count}).`,
    rawCounts: ' Comptes bruts, non rapportés au nombre de chaque jour de la semaine dans la période.',
    legend: 'Légende de la carte d’activité',
    less: 'Moins',
    more: 'Plus',
    empty: 'Aucune Transition sur cette période.',
    caption: 'Transitions par jour de la semaine et par heure',
    hourHeader: 'Heure',
    total: 'Total',
  },
  sliceTable: {
    heading: { type: 'Découpage par type', priority: 'Découpage par priorité', project: 'Découpage par projet' },
    caption: { type: 'Métriques de la période par type', priority: 'Métriques de la période par priorité', project: 'Métriques de la période par projet' },
    columns: { throughput: 'Débit', leadTime: 'Lead Time', cycleTime: 'Cycle Time', failure: 'Taux d’échec', wip: 'WIP' },
    overall: 'Ensemble',
    failedOf: (failed: string, deliveries: string) => `${failed} sur ${deliveries}`,
    notSignificant: 'n. s.',
    notSignificantSpoken: (reason: string) => ` : non significatif (${reason})`,
    /** Pourquoi un taux ne dit rien (`explainInsignificance`) : les pourcentages et comptes arrivent écrits. */
    coverageBelow: (percent: string, minimum: string) => `Couverture ${percent} (minimum ${minimum})`,
    bugsBelow: (bugs: string, n: number, minimum: string) => `${bugs} ${n >= 2 ? 'bugs' : 'bug'} (minimum ${minimum})`,
    separator: ' ; ',
    /** La légende des cellules « n. s. », par Projet. */
    notSignificantLegend: (minCoverage: string, minBugs: string) =>
      'n. s. : Taux d’échec non significatif, faute de Couverture ou de bugs ' +
      `(moins de ${minCoverage} des bugs avec une origine, ou moins de ${minBugs} bugs).`,
    required: (minCoverage: string, minBugs: string) => `(au moins ${minCoverage} des bugs avec une origine, et ${minBugs} bugs)`,
    noneCoveredWithDeliveries: (required: string) =>
      `Taux d’échec non affiché : aucun Projet n’a à la fois assez de Couverture ${required} et des Livraisons sur la période.`,
    noneCovered: (required: string) => `Taux d’échec non affiché : aucun Projet n’a assez de Couverture ${required}.`,
    /** Par type ou par priorité : la Couverture est celle de tous les Projets mesurés. */
    sharedCoverage: (percent: string) =>
      `Taux d’échec : Couverture de ${percent} des bugs, celle de tous les Projets mesurés ` +
      '(un bug n’a ni le type ni la priorité de la Livraison qu’il met en échec).',
    /** `reason` : la phrase qui dit pourquoi, déjà terminée par un point. */
    sharedNotShown: (reason: string) =>
      `Taux d’échec non affiché, car non significatif. ${reason} ` +
      'Cette Couverture est celle de tous les Projets mesurés : un bug n’a ni le type ni la priorité de la Livraison qu’il met en échec.',
  },
};

const en: typeof fr = {
  typeMix: {
    title: 'Type mix',
    description: 'Share of each ticket type among Arrivals, Deliveries and tickets in progress.',
    legend: 'Ticket type legend',
    empty: 'No Arrivals, Deliveries or tickets in progress in this period.',
    rows: { arrivals: 'Arrivals', deliveries: 'Deliveries', wip: 'In progress' },
    typeCount: (count, _n, label) => `${label} ${count}`,
    spoken: (row, segments) => `${row}: ${segments}`,
    spokenEmpty: (row) => `${row}: no tickets`,
    caption: 'Tickets by type: Arrivals, Deliveries and in progress',
    typeHeader: 'Type',
    total: 'Total',
  },
  leadTimeBreakdown: {
    title: 'Lead Time breakdown',
    descriptionEmpty: 'The cumulative Lead Time of the period’s Deliveries, split into five parts that add up.',
    description: (deliveries, n, total) =>
      `The cumulative Lead Time of ${deliveries} ${n === 1 ? 'Delivery' : 'Deliveries'} (${total}), split into five parts that add up.`,
    noDeliveries: 'No Deliveries in the period.',
    zeroLeadTime: 'No Lead Time to break down: every Delivery in the period has a zero Lead Time.',
    bar: (parts) => `Lead Time breakdown: ${parts}.`,
    partsList: 'Lead Time parts',
    noneWaited: 'No Delivery waited for a dependency before starting.',
    waited: (waited, _waitedN, deliveries, deliveriesN, median, p85) =>
      `${waited} of ${deliveries} ${deliveriesN === 1 ? 'Delivery' : 'Deliveries'} waited for a dependency before starting: median ${median}, P85 ${p85}.`,
    caption: 'Parts of the cumulative Lead Time of the period’s Deliveries',
    partHeader: 'Part',
    durationHeader: 'Cumulative duration',
    shareHeader: 'Share of Lead Time',
    total: 'Cumulative Lead Time',
    parts: {
      dependencyWait: {
        label: 'Dependency wait',
        description: 'Time in Backlog before the first start: the ticket depended on a ticket that was not closed.',
        none: 'None',
      },
      readyWait: { label: 'Ready wait', description: 'Time spent Ready: the ticket could have been started and was not.', none: 'None' },
      otherWait: {
        label: 'Other wait',
        description: 'The rest: Backlog after a first start, deferred, or closed before a Reopen.',
        none: 'None',
      },
      work: { label: 'Work', description: 'Cycle Time excluding Blockage.', none: 'None' },
      blocked: {
        label: 'Blockage',
        description: 'Cycle Time spent in Blockage: blocked status, or a dependency not closed during the work.',
        none: 'None',
      },
    },
  },
  activityMap: {
    title: 'Activity map',
    weekdays: [
      { name: 'Monday', short: 'Mon' },
      { name: 'Tuesday', short: 'Tue' },
      { name: 'Wednesday', short: 'Wed' },
      { name: 'Thursday', short: 'Thu' },
      { name: 'Friday', short: 'Fri' },
      { name: 'Saturday', short: 'Sat' },
      { name: 'Sunday', short: 'Sun' },
    ],
    hourSpan: (from, to) => `from ${String(from).padStart(2, '0')}:00 to ${String(to).padStart(2, '0')}:00`,
    hour: (hour) => `${String(hour).padStart(2, '0')}:00`,
    transitions: (count, n) => `${count} ${n === 1 ? 'Transition' : 'Transitions'}`,
    noTransition: 'No Transitions',
    plot: (transitions, peak, peakTransitions) => `Activity map: ${transitions}${peak ? `, peak on ${peak} (${peakTransitions})` : ''}.`,
    descriptionEmpty: (timeZone) => `Transitions by day of the week and hour, in the ${timeZone} time zone.`,
    description: (transitions, timeZone) => `${transitions} by day of the week and hour, in the ${timeZone} time zone.`,
    peak: (slot, count) => ` Peak: ${slot} (${count}).`,
    rawCounts: ' Raw counts, not adjusted for how many times each day of the week occurs in the period.',
    legend: 'Activity map legend',
    less: 'Less',
    more: 'More',
    empty: 'No Transitions in this period.',
    caption: 'Transitions by day of the week and hour',
    hourHeader: 'Hour',
    total: 'Total',
  },
  sliceTable: {
    heading: { type: 'Breakdown by type', priority: 'Breakdown by priority', project: 'Breakdown by project' },
    caption: { type: 'Metrics for the period by type', priority: 'Metrics for the period by priority', project: 'Metrics for the period by project' },
    columns: { throughput: 'Throughput', leadTime: 'Lead Time', cycleTime: 'Cycle Time', failure: 'Change failure rate', wip: 'WIP' },
    overall: 'Overall',
    failedOf: (failed, deliveries) => `${failed} of ${deliveries}`,
    notSignificant: 'n.s.',
    notSignificantSpoken: (reason) => `: not significant (${reason})`,
    coverageBelow: (percent, minimum) => `Coverage ${percent} (minimum ${minimum})`,
    bugsBelow: (bugs, n, minimum) => `${bugs} ${n === 1 ? 'bug' : 'bugs'} (minimum ${minimum})`,
    separator: '; ',
    notSignificantLegend: (minCoverage, minBugs) =>
      'n.s.: Change failure rate not significant, for lack of Coverage or bugs ' +
      `(less than ${minCoverage} of bugs with a recorded origin, or fewer than ${minBugs} bugs).`,
    required: (minCoverage, minBugs) => `(at least ${minCoverage} of bugs with a recorded origin, and ${minBugs} bugs)`,
    noneCoveredWithDeliveries: (required) =>
      `Change failure rate not shown: no Project has both enough Coverage ${required} and Deliveries in the period.`,
    noneCovered: (required) => `Change failure rate not shown: no Project has enough Coverage ${required}.`,
    sharedCoverage: (percent) =>
      `Change failure rate: Coverage of ${percent} of bugs, that of all measured Projects ` +
      '(a bug has neither the type nor the priority of the Delivery it fails).',
    sharedNotShown: (reason) =>
      `Change failure rate not shown, as it is not significant. ${reason} ` +
      'This Coverage is that of all measured Projects: a bug has neither the type nor the priority of the Delivery it fails.',
  },
};

export const breakdowns = { fr, en };
