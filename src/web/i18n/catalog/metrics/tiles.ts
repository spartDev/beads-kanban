/**
 * Zone « metrics », groupes des tuiles et des panneaux qui les entourent (voir `../metrics.ts`) : les tuiles des indicateurs
 * (`metrics/Tiles.tsx`) et de la santé du flux (`HealthTiles.tsx`), leurs infobulles, le Parcours d'un ticket (`JourneyPanel.tsx`,
 * `journey.ts`), le Retravail (`ReworkPanel.tsx`), la Tendance longue (`LongTrendPanel.tsx`) et les avis de la page (`Notices.tsx`).
 * Les nombres, durées et pourcentages arrivent déjà écrits ; le nombre brut ne sert qu'au pluriel.
 */
const fr = {
  /**
   * Ce que mesure chaque tuile, et à quoi elle sert : le texte de l'infobulle de son icône info. Les mots sont ceux de CONTEXT.md
   * (Livraison, Blocage, Prêt…), pour que l'infobulle dise la même chose que le reste de l'application.
   */
  metricHelp: {
    throughput:
      'Nombre de Livraisons sur la période : tickets fermés pour travail terminé, hors doublons, remplacés et Renoncements. Il mesure le rythme de livraison (l’équivalent de la Deployment Frequency DORA).',
    soundThroughput:
      'Nombre de Livraisons saines sur la période : livrées du premier coup, sans Réouverture avant leur clôture ni Bug d’origine depuis, même trouvé des mois plus tard (une Prise rendue en cours de travail ne compte pas). À lire à côté du Débit : l’écart, ce sont les Livraisons revenues. Provisoire tant que la période court ; non significatif tant que peu de bugs ont leur origine renseignée (Couverture), comme le Taux d’échec.',
    leadTime:
      'Durée écoulée entre la création d’un ticket et sa dernière clôture, attentes comprises. C’est le délai que voit le demandeur : en combien de temps une demande est livrée.',
    cycleTime:
      'Temps cumulé passé en travail (en cours, rattaché à un agent, bloqué), du premier démarrage à la clôture. Il mesure la durée du travail lui-même : l’écart avec le Lead Time montre combien les tickets attendent avant d’être pris.',
    failureRate:
      'Part des Livraisons dont découle au moins un bug, relié par un lien « découvert à partir de ». Il mesure la qualité de ce qui est livré (l’équivalent du Change Failure Rate DORA). Non significatif tant que peu de bugs ont leur origine renseignée (Couverture).',
    recoveryTime:
      'Lead Time des bugs critiques (P0 et P1) livrés sur la période. Il mesure la vitesse de réaction face à un incident (l’équivalent du MTTR DORA).',
    wip: 'Nombre de tickets en cours de travail en même temps. Trop de travail en parallèle allonge le Cycle Time : un WIP bas et stable signe un flux maîtrisé.',
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
  },
  /** Le cadre d'une tuile et sa tendance (`Tile`, `Trend` de `metrics/Tiles.tsx`), partagés par toutes les tuiles. */
  tileFrame: {
    about: (title: string) => `À propos de ${title}`,
    /** « Avant : » suivi de la valeur de la période précédente, quand la courante n'en a pas. */
    before: 'Avant : ',
    noPrevious: 'Pas de période précédente à comparer.',
    flat: 'stable',
    previous: (value: string) => `avant ${value}`,
    /** La phrase de la tendance pour les lecteurs d'écran, précédée de ce qu'elle mesure ; `sentence` commence par une minuscule. */
    labelled: (label: string, sentence: string) => `${label} : ${sentence}`,
  },
  /** Les sept tuiles des indicateurs (`MetricTiles`). */
  tiles: {
    heading: 'Indicateurs',
    throughput: 'Débit',
    soundThroughput: 'Débit sain',
    leadTime: 'Lead Time',
    cycleTime: 'Cycle Time',
    failureRate: 'Taux d’échec',
    recoveryTime: 'Temps de rétablissement',
    wip: 'WIP',
    deliveries: (n: number, count: string) => `${count} ${n >= 2 ? 'Livraisons' : 'Livraison'}`,
    criticalBugs: (n: number, count: string) => `${count} ${n >= 2 ? 'bugs critiques' : 'bug critique'}`,
    noDeliveries: 'Aucune Livraison sur la période.',
    noStartedDeliveries: 'Aucune Livraison démarrée sur la période.',
    noCriticalBugs: 'Aucun bug critique (P0 ou P1) livré sur la période.',
    deliveriesInPeriod: 'Livraisons sur la période',
    soundDeliveriesInPeriod: 'Livraisons saines sur la période',
    /** L'écart du Débit sain avec le Débit : les Livraisons revenues (`n`, déjà écrit dans `count`), puis le Débit. */
    belowThroughput: (_n: number, count: string, throughput: string) => `${count} de moins que le Débit (${throughput})`,
    allSound: 'Autant que le Débit : aucune Livraison n’est revenue.',
    /** Le Débit sain non significatif, en retrait : les Livraisons saines sur celles du Débit (`n`). */
    observedSound: (sound: string, n: number, deliveries: string) => `Observé : ${sound} sur ${deliveries} ${n >= 2 ? 'Livraisons' : 'Livraison'}`,
    provisional: 'Provisoire : des Livraisons peuvent encore revenir.',
    median: 'médiane',
    medianLabel: 'Médiane',
    p85: 'P85',
    notSignificant: 'Non significatif',
    observed: (percent: string, failed: string, deliveries: string) => `Observé : ${percent} (${failed} sur ${deliveries})`,
    failedOf: (failed: string, deliveries: string) => `${failed} sur ${deliveries} en échec`,
    coverage: (percent: string) => `Couverture ${percent}`,
    wipAt: (time: string) => `en cours à ${time}`,
    wipAtEnd: 'en cours à la fin de la période',
    average: 'moyenne',
    averageLabel: 'Moyenne',
  },
  /** Les cinq tuiles de la santé du flux (`HealthTiles`). */
  healthTiles: {
    heading: 'Santé du flux',
    balance: 'Arrivées vs Débit',
    balanceCaption: 'Arrivées moins Débit',
    arrivals: (n: number, count: string) => `${count} ${n >= 2 ? 'Arrivées' : 'Arrivée'}`,
    efficiency: 'Efficacité du flux',
    efficiencyCaption: 'du Cycle Time hors Blocage',
    /** « Blocage : 2 j sur 30 j de Cycle Time » : les deux durées s'insèrent entre ces trois morceaux. */
    blockedLead: 'Blocage : ',
    blockedOf: ' sur ',
    blockedTail: ' de Cycle Time',
    deliveriesWithBlockage: (deliveries: string) => `${deliveries} avec du Blocage`,
    noBlockage: 'Aucun Blocage pendant le travail.',
    efficiencyNote:
      'Souvent proche de 100\u00a0% : un ticket est démarré une fois débloqué. L’attente d’une dépendance se lit dans la Décomposition du Lead Time (Attente de dépendance).',
    reopening: 'Taux de Réouverture',
    closures: (n: number, count: string) => `${count} ${n >= 2 ? 'clôtures' : 'clôture'}`,
    /** L'accord se fait avec les clôtures : « 0 sur 1 clôture suivie ». */
    reopenedOf: (reopened: string, n: number, closures: string) =>
      `${reopened} sur ${closures} ${n >= 2 ? 'suivies' : 'suivie'} d’une Réouverture`,
    noClosures: 'Aucune clôture sur la période.',
    abandonment: 'Taux d’abandon',
    closedTickets: (n: number, count: string) => `${count} ${n >= 2 ? 'tickets fermés' : 'ticket fermé'}`,
    droppedOf: (dropped: string, closed: string) => `${dropped} sur ${closed}`,
    noClosedTickets: 'Aucun ticket fermé sur la période.',
    duplicates: (n: number, count: string) => `${count} ${n >= 2 ? 'doublons' : 'doublon'}`,
    superseded: (n: number, count: string) => `${count} ${n >= 2 ? 'remplacés' : 'remplacé'}`,
    causesSeparator: ', ',
    abandonmentNote:
      'Seuls les liens duplicates et supersedes sont reconnus : un ticket fermé «\u00a0Duplicate: …\u00a0» sans lien compte comme une Livraison.',
    ready: 'Prêts qui stagnent',
    readyTickets: (n: number, count: string) => `${count} ${n >= 2 ? 'Prêts' : 'Prêt'}`,
    staleOf: (ready: string, duration: string) => `sur ${ready}, depuis plus de ${duration}`,
    noReady: 'Aucun ticket Prêt.',
  },
  /** Les trois états du Parcours d'un ticket (`metrics/journey.ts`) : le nom de la colonne au kanban, et ce que le ticket y fait. */
  journeyStages: {
    backlog: 'Backlog',
    ready: 'Prêt',
    work: 'En cours',
    /** À lire après « du temps » : « 18 % du temps, à attendre une dépendance ». */
    backlogDoing: 'à attendre une dépendance',
    readyDoing: 'à attendre d’être démarré',
    workDoing: 'au travail',
  },
  /** Le Parcours d'un ticket (`JourneyPanel`). */
  journeyPanel: {
    heading: 'Le parcours d’un ticket',
    intro: 'Ce qui entre, ce qui attend, ce qui sort. Le tube est vide quand le ticket attend, plein quand on y travaille.',
    leadTimeNote: 'de la création à la Livraison, en médiane',
    cycleTimeNote: 'de travail, en médiane',
    medianOf: (title: string) => `${title}, médiane`,
    now: 'en ce moment',
    atEnd: 'à la fin de la période',
    arrivals: 'Arrivées',
    created: (n: number): string => (n >= 2 ? 'tickets créés' : 'ticket créé'),
    deliveries: 'Livraisons',
    /** « , dont 3 stagnent depuis plus de 14 j » : le nombre est un lien vers « À regarder ». */
    ofWhich: ', dont',
    stagnant: (n: number, count: string) => `${count} ${n >= 2 ? 'stagnent' : 'stagne'}`,
    staleFor: (duration: string) => `depuis plus de ${duration}`,
    blockedAmong: (n: number, count: string) => `, dont ${count} en Blocage`,
    shareOfTime: (doing: string) => `du temps, ${doing}`,
    tickets: (n: number, moment: string) => `${n >= 2 ? 'tickets' : 'ticket'} ${moment}`,
    empty: 'Aucune Livraison sur la période : le fil est dessiné sans proportions.',
    waiting: (percent: string) => `Un ticket livré a passé ${percent} de sa vie à attendre`,
    inBacklog: 'en Backlog',
    inReady: 'en Prêt',
    /** Suivi de la durée du Lead Time cumulé, puis de `end`. */
    where: (where: string, deliveries: string) =>
      `, surtout ${where}. Les parts sont celles du Lead Time cumulé des ${deliveries} de la période, soit `,
    end: '.',
    otherWait: (percent: string) =>
      ` Le reste, ${percent}, est une autre attente : ticket différé, ou revenu en Backlog après un premier démarrage.`,
    blockedShare: (percent: string) => ` Le Blocage compte pour ${percent}, dans le tronçon En cours.`,
  },
  /** Le Retravail (`ReworkPanel`). */
  rework: {
    title: 'Retravail',
    description:
      'Les tickets revenus sur la période : rouverts, rendus en cours de travail ou mis en échec par un Bug d’origine. Du plus d’événements au moins.',
    empty: 'Aucun ticket n’est revenu sur la période : ni Réouverture, ni Prise rendue, ni Bug d’origine.',
    list: 'Tickets en Retravail',
    reopens: (n: number, count: string) => `${count} ${n >= 2 ? 'Réouvertures' : 'Réouverture'}`,
    handbacks: (n: number, count: string) => `${count} ${n >= 2 ? 'Prises rendues' : 'Prise rendue'}`,
    /** `ids` : les identifiants des bugs, déjà joints. */
    escapedBugs: (n: number, ids: string) => `${n >= 2 ? 'Bugs d’origine' : 'Bug d’origine'} ${ids}`,
    separator: ', ',
  },
  /** La Tendance longue (`LongTrendPanel`). */
  longTrend: {
    title: 'Tendance longue',
    description:
      'Les 12 dernières semaines, du lundi au dimanche, quelle que soit la période choisie : le flux s’améliore-t-il ? Chaque semaine est comptée seule, sans lissage.',
    legend: 'Légende de la Tendance longue',
    throughput: 'Débit',
    soundThroughput: 'Débit sain',
    leadTime: 'Lead Time au P85',
    reopening: 'Taux de Réouverture',
    unreliable: (minimum: string) => `Moins de ${minimum} Livraisons`,
    partial: 'Semaine en cours',
    empty: 'Aucune Livraison ni clôture sur les 12 dernières semaines.',
    leadTimeSubject: 'Lead Time au P85 par semaine',
    reopeningSubject: 'Taux de Réouverture par semaine',
    deliveries: (n: number, count: string) => (n === 0 ? 'aucune Livraison' : `${count} ${n >= 2 ? 'Livraisons' : 'Livraison'}`),
    throughputLabel: (deliveries: string, weeks: string) => `Débit par semaine : ${deliveries} sur ${weeks} semaines.`,
    soundDeliveries: (n: number, count: string) => (n === 0 ? 'aucune Livraison saine' : `${count} ${n >= 2 ? 'Livraisons saines' : 'Livraison saine'}`),
    soundThroughputLabel: (deliveries: string, weeks: string) => `Débit sain par semaine : ${deliveries} sur ${weeks} semaines.`,
    /** Sous le titre du Débit sain, et à la suite de son nom pour les lecteurs d'écran : `reason` est le motif écrit (`failureRateReason`). */
    notSignificant: (reason: string) => `Non significatif. ${reason}`,
    /** Le Débit sain de la semaine en cours, dans l'infobulle de sa barre : `value` est déjà écrit (« 1 Livraison saine »). */
    provisionalPoint: (value: string) => `${value}, provisoire : des Livraisons peuvent encore revenir`,
    lineLabel: (subject: string, n: number, measured: string, weeks: string) =>
      `${subject} : ${measured} ${n >= 2 ? 'semaines mesurées' : 'semaine mesurée'} sur ${weeks}.`,
    week: (range: string) => `Semaine du ${range}`,
    point: (week: string, value: string) => `${week} : ${value}`,
    caption: 'Débit, Débit sain, Lead Time au P85 et Taux de Réouverture de chacune des 12 dernières semaines',
    /** La légende du tableau (`caption`), quand le Débit sain n'est pas significatif. */
    captionNotSignificant: (caption: string, reason: string) => `${caption}. Débit sain non significatif. ${reason}`,
    weekColumn: 'Semaine',
    deliveriesColumn: 'Livraisons',
    soundColumn: 'Livraisons saines',
    leadTimeColumn: 'Lead Time P85',
    reopeningColumn: 'Réouverture',
    remarkColumn: 'Remarque',
    reopeningCell: (percent: string, reopened: string, closures: string) => `${percent} (${reopened} sur ${closures})`,
    inProgress: 'En cours',
    /** La remarque de la semaine en cours, dès qu'elle a une Livraison : son Débit sain peut encore baisser. */
    soundProvisional: 'Débit sain provisoire',
    remarkSeparator: ', ',
  },
  /** Les avis de la page (`Notices.tsx`). Le motif d'un Projet illisible vient du serveur, tel quel. */
  notices: {
    ignoredSettings: (n: number): string => (n >= 2 ? 'Réglages de l’adresse ignorés' : 'Réglage de l’adresse ignoré'),
    zoneTitle: (asked: string) => `Le serveur ne connaît pas votre fuseau, ${asked}`,
    zoneBody: (counted: string) => `Les jours, les semaines et les heures des métriques sont comptés en ${counted}, le fuseau du serveur.`,
    unreadable: (n: number, count: string) =>
      n >= 2 ? `${count} Projets illisibles, absents de ces chiffres` : 'Un Projet illisible, absent de ces chiffres',
    /** Entre le nom du Projet et son motif. */
    reasonSeparator: ' : ',
  },
};

const en: typeof fr = {
  metricHelp: {
    throughput:
      'Number of Deliveries in the period: tickets closed because the work is done, excluding duplicates, superseded ones and Declines. It measures the delivery pace (the equivalent of DORA Deployment Frequency).',
    soundThroughput:
      'Number of Sound deliveries in the period: delivered first time, with no Reopen before their closure and no Escaped bug since, even one found months later (a Handback during work does not count). Read it next to Throughput: the gap is the Deliveries that came back. Provisional while the period is running; not significant while few bugs have a recorded origin (Coverage), like the Change failure rate.',
    leadTime:
      'Elapsed time between a ticket’s creation and its last closure, waits included. It is the delay the requester sees: how long it takes for a request to be delivered.',
    cycleTime:
      'Cumulative time spent in work (in progress, assigned to an agent, blocked), from the first start to closure. It measures how long the work itself takes: the gap with Lead Time shows how long tickets wait before being picked up.',
    failureRate:
      'Share of Deliveries that led to at least one bug, linked by a “discovered from” link. It measures the quality of what is delivered (the equivalent of DORA Change Failure Rate). Not significant while few bugs have a recorded origin (Coverage).',
    recoveryTime:
      'Lead Time of critical bugs (P0 and P1) delivered in the period. It measures how fast the team reacts to an incident (the equivalent of DORA MTTR).',
    wip: 'Number of tickets being worked on at the same time. Too much parallel work stretches Cycle Time: a low, steady WIP is the sign of a flow under control.',
    balance:
      'Tickets created (Arrivals) minus tickets delivered in the period. Positive, the work stock grows; negative, it shrinks. It tells whether the team keeps up with demand.',
    efficiency:
      'Share of Cycle Time spent working rather than in Blockage, waiting for another ticket that is not closed. The higher it is, the less started work stays stuck behind its dependencies.',
    reopening:
      'Share of the period’s closures followed by a Reopen. A reopened ticket was not really finished: a high rate points to work closed too early or poorly defined.',
    abandonment:
      'Share of closed tickets closed as a duplicate of another or superseded by another (Dropped). Neither good nor bad in itself, it tells about backlog hygiene and duplicated work.',
    ready:
      'Ready tickets (no blocking dependency, can be started) waiting for more than 14 days without being started. They point to forgotten or low-priority work, to triage or close.',
  },
  tileFrame: {
    about: (title) => `About ${title}`,
    before: 'Previously: ',
    noPrevious: 'No previous period to compare with.',
    flat: 'steady',
    previous: (value) => `previously ${value}`,
    labelled: (label, sentence) => `${label}: ${sentence}`,
  },
  tiles: {
    heading: 'Key metrics',
    throughput: 'Throughput',
    soundThroughput: 'Sound throughput',
    leadTime: 'Lead Time',
    cycleTime: 'Cycle Time',
    failureRate: 'Change failure rate',
    recoveryTime: 'Time to restore',
    wip: 'WIP',
    deliveries: (n, count) => `${count} ${n === 1 ? 'Delivery' : 'Deliveries'}`,
    criticalBugs: (n, count) => `${count} ${n === 1 ? 'critical bug' : 'critical bugs'}`,
    noDeliveries: 'No Deliveries in the period.',
    noStartedDeliveries: 'No started Deliveries in the period.',
    noCriticalBugs: 'No critical bugs (P0 or P1) delivered in the period.',
    deliveriesInPeriod: 'Deliveries in the period',
    soundDeliveriesInPeriod: 'Sound deliveries in the period',
    belowThroughput: (_n, count, throughput) => `${count} fewer than Throughput (${throughput})`,
    allSound: 'Same as Throughput: no Delivery came back.',
    observedSound: (sound, n, deliveries) => `Observed: ${sound} of ${deliveries} ${n === 1 ? 'Delivery' : 'Deliveries'}`,
    provisional: 'Provisional: Deliveries may still come back.',
    median: 'median',
    medianLabel: 'Median',
    p85: 'P85',
    notSignificant: 'Not significant',
    observed: (percent, failed, deliveries) => `Observed: ${percent} (${failed} of ${deliveries})`,
    failedOf: (failed, deliveries) => `${failed} of ${deliveries} failed`,
    coverage: (percent) => `Coverage ${percent}`,
    wipAt: (time) => `in progress at ${time}`,
    wipAtEnd: 'in progress at the end of the period',
    average: 'average',
    averageLabel: 'Average',
  },
  healthTiles: {
    heading: 'Flow health',
    balance: 'Arrivals vs Throughput',
    balanceCaption: 'Arrivals minus Throughput',
    arrivals: (n, count) => `${count} ${n === 1 ? 'Arrival' : 'Arrivals'}`,
    efficiency: 'Flow efficiency',
    efficiencyCaption: 'of Cycle Time outside Blockage',
    blockedLead: 'Blockage: ',
    blockedOf: ' out of ',
    blockedTail: ' of Cycle Time',
    deliveriesWithBlockage: (deliveries) => `${deliveries} with Blockage`,
    noBlockage: 'No Blockage during work.',
    efficiencyNote:
      'Often close to 100%: a ticket is started once unblocked. Waiting for a dependency shows in the Lead Time breakdown (Dependency wait).',
    reopening: 'Reopen rate',
    closures: (n, count) => `${count} ${n === 1 ? 'closure' : 'closures'}`,
    reopenedOf: (reopened, _n, closures) => `${reopened} of ${closures} followed by a Reopen`,
    noClosures: 'No closures in the period.',
    abandonment: 'Drop rate',
    closedTickets: (n, count) => `${count} ${n === 1 ? 'closed ticket' : 'closed tickets'}`,
    droppedOf: (dropped, closed) => `${dropped} of ${closed}`,
    noClosedTickets: 'No closed tickets in the period.',
    duplicates: (n, count) => `${count} ${n === 1 ? 'duplicate' : 'duplicates'}`,
    superseded: (_n, count) => `${count} superseded`,
    causesSeparator: ', ',
    abandonmentNote:
      'Only duplicates and supersedes links are recognized: a ticket closed as “Duplicate: …” without a link counts as a Delivery.',
    ready: 'Stale ready',
    readyTickets: (n, count) => `${count} ${n === 1 ? 'Ready ticket' : 'Ready tickets'}`,
    staleOf: (ready, duration) => `of ${ready}, for more than ${duration}`,
    noReady: 'No Ready tickets.',
  },
  journeyStages: {
    backlog: 'Backlog',
    ready: 'Ready',
    work: 'In progress',
    backlogDoing: 'waiting for a dependency',
    readyDoing: 'waiting to be started',
    workDoing: 'being worked on',
  },
  journeyPanel: {
    heading: 'Ticket journey',
    intro: 'What comes in, what waits, what goes out. The tube is empty while the ticket waits, full while it is being worked on.',
    leadTimeNote: 'from creation to Delivery, median',
    cycleTimeNote: 'of work, median',
    medianOf: (title) => `${title}, median`,
    now: 'right now',
    atEnd: 'at the end of the period',
    arrivals: 'Arrivals',
    created: (n) => (n === 1 ? 'ticket created' : 'tickets created'),
    deliveries: 'Deliveries',
    ofWhich: ', of which',
    stagnant: (n, count) => `${count} ${n === 1 ? 'has' : 'have'} been stale`,
    staleFor: (duration) => `for more than ${duration}`,
    blockedAmong: (n, count) => `, of which ${count} ${n === 1 ? 'is' : 'are'} Blocked`,
    shareOfTime: (doing) => `of the time, ${doing}`,
    tickets: (n, moment) => `${n === 1 ? 'ticket' : 'tickets'} ${moment}`,
    empty: 'No Deliveries in the period: the thread is drawn without proportions.',
    waiting: (percent) => `A delivered ticket spent ${percent} of its life waiting`,
    inBacklog: 'in Backlog',
    inReady: 'in Ready',
    where: (where, deliveries) => `, mostly ${where}. Shares are those of the cumulative Lead Time of the period’s ${deliveries}, that is `,
    end: '.',
    otherWait: (percent) => ` The rest, ${percent}, is another kind of wait: a deferred ticket, or one sent back to Backlog after a first start.`,
    blockedShare: (percent) => ` Blockage accounts for ${percent}, within the In progress section.`,
  },
  rework: {
    title: 'Rework',
    description: 'Tickets that came back in the period: reopened, handed back mid-work or failed by an Escaped bug. Most events first.',
    empty: 'No ticket came back in the period: no Reopen, no Handback, no Escaped bug.',
    list: 'Tickets in Rework',
    reopens: (n, count) => `${count} ${n === 1 ? 'Reopen' : 'Reopens'}`,
    handbacks: (n, count) => `${count} ${n === 1 ? 'Handback' : 'Handbacks'}`,
    escapedBugs: (n, ids) => `${n === 1 ? 'Escaped bug' : 'Escaped bugs'} ${ids}`,
    separator: ', ',
  },
  longTrend: {
    title: 'Long trend',
    description:
      'The last 12 weeks, Monday to Sunday, whatever the chosen period: is the flow improving? Each week is counted on its own, without smoothing.',
    legend: 'Long trend legend',
    throughput: 'Throughput',
    soundThroughput: 'Sound throughput',
    leadTime: 'Lead Time at P85',
    reopening: 'Reopen rate',
    unreliable: (minimum) => `Fewer than ${minimum} Deliveries`,
    partial: 'Current week',
    empty: 'No Deliveries or closures in the last 12 weeks.',
    leadTimeSubject: 'Lead Time at P85 per week',
    reopeningSubject: 'Reopen rate per week',
    deliveries: (n, count) => (n === 0 ? 'no Deliveries' : `${count} ${n === 1 ? 'Delivery' : 'Deliveries'}`),
    throughputLabel: (deliveries, weeks) => `Throughput per week: ${deliveries} over ${weeks} weeks.`,
    soundDeliveries: (n, count) => (n === 0 ? 'no Sound deliveries' : `${count} ${n === 1 ? 'Sound delivery' : 'Sound deliveries'}`),
    soundThroughputLabel: (deliveries, weeks) => `Sound throughput per week: ${deliveries} over ${weeks} weeks.`,
    notSignificant: (reason) => `Not significant. ${reason}`,
    provisionalPoint: (value) => `${value}, provisional: Deliveries may still come back`,
    lineLabel: (subject, n, measured, weeks) => `${subject}: ${measured} ${n === 1 ? 'week' : 'weeks'} measured out of ${weeks}.`,
    week: (range) => `Week of ${range}`,
    point: (week, value) => `${week}: ${value}`,
    caption: 'Throughput, Sound throughput, Lead Time at P85 and Reopen rate for each of the last 12 weeks',
    captionNotSignificant: (caption, reason) => `${caption}. Sound throughput not significant. ${reason}`,
    weekColumn: 'Week',
    deliveriesColumn: 'Deliveries',
    soundColumn: 'Sound deliveries',
    leadTimeColumn: 'Lead Time P85',
    reopeningColumn: 'Reopens',
    remarkColumn: 'Note',
    reopeningCell: (percent, reopened, closures) => `${percent} (${reopened} of ${closures})`,
    inProgress: 'In progress',
    soundProvisional: 'Sound throughput provisional',
    remarkSeparator: ', ',
  },
  notices: {
    ignoredSettings: (n) => (n === 1 ? 'URL setting ignored' : 'URL settings ignored'),
    zoneTitle: (asked) => `The server does not know your time zone, ${asked}`,
    zoneBody: (counted) => `Days, weeks and hours in the metrics are counted in ${counted}, the server’s time zone.`,
    unreadable: (n, count) => (n === 1 ? 'One unreadable Project, left out of these figures' : `${count} unreadable Projects, left out of these figures`),
    reasonSeparator: ': ',
  },
};

export const tiles = { fr, en };
