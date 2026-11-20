/**
 * Zone « metrics », groupes des graphiques : pièces communes (`ChartParts.tsx`), séries et découpages (`series.ts`), tranches
 * (`buckets.ts`), Débit, Cycle Time, Flux cumulé, Âge des tickets en cours, Prêts qui stagnent, Arrivées et Débit cumulés. Voir
 * `../metrics.ts`. Les nombres, durées et dates arrivent écrits ; le nombre brut ne sert qu'au pluriel.
 */
const NBSP = '\u00a0';

const fr = {
  /** Les pièces communes des cartes de graphique (`metrics/ChartParts.tsx`). */
  chartParts: {
    dataToggle: 'Données du graphique',
    dataRegion: (title: string) => `Données : ${title}`,
    /** Colonnes que plusieurs tableaux de données partagent. */
    bucketColumn: 'Tranche',
    noteColumn: 'Remarque',
    ticketColumn: 'Ticket',
    projectColumn: 'Projet',
    deliveriesColumn: 'Livraisons',
    /** Ce qui compte une tranche, dans une description (« comptées par jour »). */
    unit: { day: 'jour', week: 'semaine (du lundi au dimanche)' },
    /** « 3 Livraisons » ; `count` est déjà écrit, `n` choisit le pluriel. */
    deliveries: (count: string, n: number) => `${count} ${n >= 2 ? 'Livraisons' : 'Livraison'}`,
    buckets: (count: string, n: number) => `${count} ${n >= 2 ? 'tranches' : 'tranche'}`,
    /** Masquer les tickets au-delà des premiers, puis les montrer tous. */
    collapse: 'Réduire la liste',
    showMore: (hidden: string) => `Afficher les ${hidden} autres`,
  },
  /** Les découpages qui colorent les points et les barres (`metrics/series.ts`). */
  chartSeries: {
    dimensions: { type: 'Type', priority: 'Priorité', project: 'Projet' },
    /** Le nom de la légende ; `dimension` est le découpage en minuscules (« priorité »). */
    colors: (dimension: string) => `Couleurs : ${dimension}`,
  },
  /** Pourquoi une tranche du Débit est partielle (`metrics/buckets.ts`) ; `time` est l'heure de la mesure (« 20:00 »). */
  buckets: {
    dayRunning: (time: string) => `Jour en cours, jusqu’à ${time}.`,
    covered: (days: string, n: number) => `${days} ${n >= 2 ? 'jours' : 'jour'} sur 7`,
    weekRunningTruncated: (covered: string, time: string) => `Semaine en cours : ${covered}, jusqu’à ${time}.`,
    weekTruncated: (covered: string) => `Semaine incomplète : ${covered} dans la période.`,
    weekRunning: (time: string) => `Semaine en cours, jusqu’à ${time}.`,
  },
  /** L'âge d'un Prêt (`metrics/readyAge.ts`) : jours et heures entières. */
  readyAge: {
    written: (days: string, hours: string | null) => (hours === null ? `${days}${NBSP}j` : `${days}${NBSP}j${NBSP}${hours}${NBSP}h`),
    spokenDays: (days: string, n: number) => `${days} ${n >= 2 ? 'jours' : 'jour'}`,
    spokenHours: (hours: string, n: number) => `${hours} ${n >= 2 ? 'heures' : 'heure'}`,
  },
  /** Le Flux cumulé (`metrics/cfd.ts`, `metrics/CfdChart.tsx`) ; les colonnes sont celles du kanban. */
  cfd: {
    columns: {
      done: 'Terminé',
      inProgress: 'En cours',
      inReview: 'En relecture',
      inIntegration: 'En intégration',
      awaitingHuman: 'À valider',
      blocked: 'Bloqué',
      ready: 'Prêt',
      backlog: 'Backlog',
    },
    summaryEmpty: 'Flux cumulé : aucun jour à montrer.',
    spanOne: (day: string) => `le ${day}`,
    spanRange: (from: string, to: string) => `du ${from} au ${to}`,
    /** `state` : « 12 Terminé, 3 En cours… », l'état du dernier jour. */
    summary: (span: string, state: string) => `Flux cumulé ${span}. Dernier jour : ${state}.`,
    title: 'Flux cumulé',
    description: 'Tickets dans chaque colonne du kanban à la fin de chaque jour. L’épaisseur des bandes En cours et Bloqué est le travail en cours.',
    /** La même, quand le CFD a des colonnes de Statuts de relais : elles sont du travail en cours. */
    descriptionWithHandoff:
      'Tickets dans chaque colonne du kanban à la fin de chaque jour. L’épaisseur des bandes En cours et Bloqué, et entre elles des Statuts de relais, est le travail en cours.',
    hideDone: 'Masquer Terminé',
    legend: 'Colonnes du flux',
    empty: 'Aucun ticket sur cette période.',
    caption: 'Tickets par colonne du kanban à la fin de chaque jour',
    dayColumn: 'Jour',
    totalColumn: 'Total',
  },
  /** L'histogramme du Débit (`metrics/ThroughputChart.tsx`). */
  throughputChart: {
    none: 'Aucune Livraison',
    ariaLabel: (deliveries: string, buckets: string) => `Débit : ${deliveries} sur ${buckets}.`,
    perDay: (rate: string, days: string) => `${rate} par jour sur ${days} jours`,
    title: 'Débit',
    description: (deliveries: string, unit: string) => `${deliveries} sur la période, comptées par ${unit}.`,
    legend: 'Légende du Débit',
    full: 'Livraisons',
    partialDay: 'Jour en cours',
    partialWeek: 'Semaine incomplète ou en cours',
    empty: 'Aucune Livraison sur cette période.',
    caption: 'Livraisons de chaque tranche de la période',
    daysColumn: 'Jours',
    perDayColumn: 'Par jour',
  },
  /** Le nuage de points du Cycle Time (`metrics/CycleTimeChart.tsx`) ; les durées arrivent écrites, ou dites pour le nom du dessin. */
  cycleTimeChart: {
    ariaLabel: (deliveries: string, median: string | null, p85: string | null) =>
      `Nuage de points du Cycle Time : ${deliveries}${median !== null ? `, médiane ${median}` : ''}${p85 !== null ? `, P85 ${p85}` : ''}, échelle logarithmique.`,
    median: (duration: string) => `Médiane ${duration}`,
    p85: (duration: string) => `P85 ${duration}`,
    cycleTime: 'Cycle Time',
    delivered: (when: string) => `Livré ${when}`,
    /** « lun. 2 nov. à 11:00 ». */
    at: (day: string, time: string) => `${day} à ${time}`,
    title: 'Cycle Time',
    description: (dimension: string) =>
      `Une Livraison par point : sa date de Livraison, et le temps passé en travail. Échelle logarithmique, colorée par ${dimension}.`,
    empty: 'Aucune Livraison démarrée sur cette période : le Cycle Time n’est défini que pour un ticket qui a été démarré.',
    caption: 'Livraisons de la période et leur Cycle Time',
    typeColumn: 'Type',
    priorityColumn: 'Priorité',
    deliveredColumn: 'Livré',
  },
  /** L'âge des tickets en cours (`metrics/AgeChart.tsx`). */
  ageChart: {
    title: 'Âge des tickets en cours',
    description: (count: string, n: number) =>
      `Depuis leur premier passage en statut de travail, du plus ancien au plus récent. ${count} ${n >= 2 ? 'tickets' : 'ticket'} en cours.`,
    markers: 'Repères',
    median: (duration: string) => `Médiane du Cycle Time ${duration}`,
    p85: (duration: string) => `P85 ${duration}`,
    empty: 'Aucun ticket en cours.',
    list: 'Tickets en cours, du plus ancien au plus récent',
    blocked: 'Bloqué',
    agent: 'Agent',
    beyondP85: 'au-delà du P85',
  },
  /** Les Prêts qui stagnent (`metrics/ReadyAgeChart.tsx`) ; `threshold` est le seuil écrit (« 14 j »), `moment` l'instant de la mesure. */
  readyAgeChart: {
    noneStale: (threshold: string) => `Aucun ne l’est depuis plus de ${threshold}.`,
    onlyOneStale: (threshold: string) => `Il l’est depuis plus de ${threshold}.`,
    allStale: (threshold: string) => `Tous le sont depuis plus de ${threshold}.`,
    oneStale: (total: string, threshold: string) => `1 des ${total} l’est depuis plus de ${threshold}.`,
    someStale: (stale: string, total: string, threshold: string) => `${stale} des ${total} le sont depuis plus de ${threshold}.`,
    description: (moment: string) => `Les tickets ouverts sans dépendance bloquante en suspens ${moment}, du plus ancien au plus récent.`,
    title: 'Prêts qui stagnent',
    marker: 'Repère',
    threshold: (threshold: string) => `Seuil de stagnation ${threshold}`,
    empty: 'Aucun ticket Prêt.',
    list: 'Prêts, du plus ancien au plus récent',
    stale: 'stagne',
    caption: (moment: string) => `Prêts ${moment}`,
    sinceColumn: 'Prêt depuis',
    ageColumn: 'Âge',
    staleColumn: 'Stagne',
    yes: 'Oui',
    no: 'Non',
  },
  /** Arrivées et Débit cumulés (`metrics/BalanceChart.tsx`) ; `net` est l'écart signé, déjà écrit (« +3 »). */
  balanceChart: {
    arrivals: (count: string, n: number) => `${count} ${n >= 2 ? 'Arrivées' : 'Arrivée'}`,
    ariaLabel: (arrivals: string, deliveries: string, buckets: string, net: string) =>
      `Arrivées et Débit cumulés : ${arrivals} et ${deliveries} sur ${buckets}, écart ${net}.`,
    counts: (arrivals: string, deliveries: string) => `Arrivées ${arrivals} · Livraisons ${deliveries}`,
    cumulative: (arrivals: string, deliveries: string) => `Cumul : ${arrivals}, ${deliveries}`,
    title: 'Arrivées et Débit cumulés',
    description: (arrivals: string, deliveries: string, unit: string, net: string) =>
      `${arrivals} et ${deliveries} sur la période, cumulées par ${unit}. L’écart est de ${net}.`,
    legend: 'Légende des Arrivées et du Débit',
    arrivalsLabel: 'Arrivées',
    deliveriesLabel: 'Livraisons',
    empty: 'Aucune Arrivée ni Livraison sur cette période.',
    caption: 'Arrivées et Livraisons de chaque tranche, et leur cumul',
    arrivalsColumn: 'Arrivées',
    netColumn: 'Écart',
    cumulativeArrivalsColumn: 'Arrivées cumulées',
    cumulativeDeliveriesColumn: 'Livraisons cumulées',
    cumulativeNetColumn: 'Écart cumulé',
  },
};

const en: typeof fr = {
  chartParts: {
    dataToggle: 'Chart data',
    dataRegion: (title) => `Data: ${title}`,
    bucketColumn: 'Bucket',
    noteColumn: 'Note',
    ticketColumn: 'Ticket',
    projectColumn: 'Project',
    deliveriesColumn: 'Deliveries',
    unit: { day: 'day', week: 'week (Monday to Sunday)' },
    deliveries: (count, n) => `${count} ${n === 1 ? 'Delivery' : 'Deliveries'}`,
    buckets: (count, n) => `${count} ${n === 1 ? 'bucket' : 'buckets'}`,
    collapse: 'Show fewer',
    showMore: (hidden) => `Show ${hidden} more`,
  },
  chartSeries: {
    dimensions: { type: 'Type', priority: 'Priority', project: 'Project' },
    colors: (dimension) => `Colors: ${dimension}`,
  },
  buckets: {
    dayRunning: (time) => `Current day, up to ${time}.`,
    covered: (days, n) => `${days} ${n === 1 ? 'day' : 'days'} of 7`,
    weekRunningTruncated: (covered, time) => `Current week: ${covered}, up to ${time}.`,
    weekTruncated: (covered) => `Incomplete week: ${covered} in the period.`,
    weekRunning: (time) => `Current week, up to ${time}.`,
  },
  readyAge: {
    written: (days, hours) => (hours === null ? `${days}${NBSP}d` : `${days}${NBSP}d${NBSP}${hours}${NBSP}h`),
    spokenDays: (days, n) => `${days} ${n === 1 ? 'day' : 'days'}`,
    spokenHours: (hours, n) => `${hours} ${n === 1 ? 'hour' : 'hours'}`,
  },
  cfd: {
    columns: {
      done: 'Done',
      inProgress: 'In progress',
      inReview: 'In review',
      inIntegration: 'In integration',
      awaitingHuman: 'Awaiting validation',
      blocked: 'Blocked',
      ready: 'Ready',
      backlog: 'Backlog',
    },
    summaryEmpty: 'Cumulative flow: no days to show.',
    spanOne: (day) => `on ${day}`,
    spanRange: (from, to) => `from ${from} to ${to}`,
    summary: (span, state) => `Cumulative flow ${span}. Last day: ${state}.`,
    title: 'Cumulative flow',
    description: 'Tickets in each kanban column at the end of each day. The thickness of the In progress and Blocked bands is the work in progress.',
    descriptionWithHandoff:
      'Tickets in each kanban column at the end of each day. The thickness of the In progress and Blocked bands, and of the Handoff status bands between them, is the work in progress.',
    hideDone: 'Hide Done',
    legend: 'Flow columns',
    empty: 'No tickets in this period.',
    caption: 'Tickets per kanban column at the end of each day',
    dayColumn: 'Day',
    totalColumn: 'Total',
  },
  throughputChart: {
    none: 'No Deliveries',
    ariaLabel: (deliveries, buckets) => `Throughput: ${deliveries} over ${buckets}.`,
    perDay: (rate, days) => `${rate} per day over ${days} days`,
    title: 'Throughput',
    description: (deliveries, unit) => `${deliveries} in the period, counted by ${unit}.`,
    legend: 'Throughput legend',
    full: 'Deliveries',
    partialDay: 'Current day',
    partialWeek: 'Incomplete or current week',
    empty: 'No Deliveries in this period.',
    caption: 'Deliveries in each bucket of the period',
    daysColumn: 'Days',
    perDayColumn: 'Per day',
  },
  cycleTimeChart: {
    ariaLabel: (deliveries, median, p85) =>
      `Cycle Time scatter plot: ${deliveries}${median !== null ? `, median ${median}` : ''}${p85 !== null ? `, P85 ${p85}` : ''}, logarithmic scale.`,
    median: (duration) => `Median ${duration}`,
    p85: (duration) => `P85 ${duration}`,
    cycleTime: 'Cycle Time',
    delivered: (when) => `Delivered ${when}`,
    at: (day, time) => `${day} at ${time}`,
    title: 'Cycle Time',
    description: (dimension) => `One Delivery per dot: its Delivery date and the time spent in progress. Logarithmic scale, colored by ${dimension}.`,
    empty: 'No started Deliveries in this period: Cycle Time is only defined for a ticket that was started.',
    caption: 'Deliveries in the period and their Cycle Time',
    typeColumn: 'Type',
    priorityColumn: 'Priority',
    deliveredColumn: 'Delivered',
  },
  ageChart: {
    title: 'Age of tickets in progress',
    description: (count, n) => `Since they first entered a work status, oldest first. ${count} ${n === 1 ? 'ticket' : 'tickets'} in progress.`,
    markers: 'Reference lines',
    median: (duration) => `Cycle Time median ${duration}`,
    p85: (duration) => `P85 ${duration}`,
    empty: 'No tickets in progress.',
    list: 'Tickets in progress, oldest first',
    blocked: 'Blocked',
    agent: 'Agent',
    beyondP85: 'beyond P85',
  },
  readyAgeChart: {
    noneStale: (threshold) => `None has been Ready for more than ${threshold}.`,
    onlyOneStale: (threshold) => `It has been Ready for more than ${threshold}.`,
    allStale: (threshold) => `All have been Ready for more than ${threshold}.`,
    oneStale: (total, threshold) => `1 of ${total} has been Ready for more than ${threshold}.`,
    someStale: (stale, total, threshold) => `${stale} of ${total} have been Ready for more than ${threshold}.`,
    description: (moment) => `Open tickets with no pending blocking dependency ${moment}, oldest first.`,
    title: 'Stale ready',
    marker: 'Reference line',
    threshold: (threshold) => `Stale threshold ${threshold}`,
    empty: 'No Ready tickets.',
    list: 'Ready tickets, oldest first',
    stale: 'stale',
    caption: (moment) => `Ready tickets ${moment}`,
    sinceColumn: 'Ready since',
    ageColumn: 'Age',
    staleColumn: 'Stale',
    yes: 'Yes',
    no: 'No',
  },
  balanceChart: {
    arrivals: (count, n) => `${count} ${n === 1 ? 'Arrival' : 'Arrivals'}`,
    ariaLabel: (arrivals, deliveries, buckets, net) => `Cumulative Arrivals and Throughput: ${arrivals} and ${deliveries} over ${buckets}, gap ${net}.`,
    counts: (arrivals, deliveries) => `Arrivals ${arrivals} · Deliveries ${deliveries}`,
    cumulative: (arrivals, deliveries) => `Cumulative: ${arrivals}, ${deliveries}`,
    title: 'Cumulative Arrivals and Throughput',
    description: (arrivals, deliveries, unit, net) => `${arrivals} and ${deliveries} in the period, cumulated by ${unit}. The gap is ${net}.`,
    legend: 'Arrivals and Throughput legend',
    arrivalsLabel: 'Arrivals',
    deliveriesLabel: 'Deliveries',
    empty: 'No Arrivals or Deliveries in this period.',
    caption: 'Arrivals and Deliveries in each bucket, and their cumulative totals',
    arrivalsColumn: 'Arrivals',
    netColumn: 'Gap',
    cumulativeArrivalsColumn: 'Cumulative Arrivals',
    cumulativeDeliveriesColumn: 'Cumulative Deliveries',
    cumulativeNetColumn: 'Cumulative gap',
  },
};

export const charts = { fr, en };
