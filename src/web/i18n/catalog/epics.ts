import type { Zone } from './zone';

/** Zone « epics » (bdesk-ewr.4) : `epics/` et la page des Epics. */

const NBSP = ' ';

/**
 * Un nom compté : « 1 Livraison », « 2 Livraisons ». `n` choisit l'accord, `count` est `n` déjà écrit (`format.formatCount(n)`).
 * Singulier sous 2 en français, au seul 1 en anglais.
 */
type Counted = (n: number, count: string) => string;
const frCounted =
  (singular: string, plural: string): Counted =>
  (n, count) =>
    `${count} ${n >= 2 ? plural : singular}`;
const enCounted =
  (singular: string, plural: string): Counted =>
  (n, count) =>
    `${count} ${n === 1 ? singular : plural}`;

const fr = {
  /** Les noms comptés des phrases de la zone. */
  counted: {
    deliveries: frCounted('Livraison', 'Livraisons'),
    children: frCounted('Enfant', 'Enfants'),
    dropped: frCounted('Abandon', 'Abandons'),
    epics: frCounted('Epic', 'Epics'),
  },
  /** La page des Epics (`pages/EpicsPage.tsx`) : sa liste, ses états de chargement et d'erreur, ses pages d'adresse fausse. */
  page: {
    /** Titre de la page, de l'onglet, et lien de retour en tête d'une page Epic. */
    title: 'Epics',
    /** `project` : le Projet dans une phrase (`projectInSentence`). */
    description: (project: string) => `L’avancement de chaque Epic de ${project} : les Livraisons parmi ses Enfants.`,
    loadFailed: 'Impossible de charger les tickets',
    loadingList: 'Chargement des Epics',
    loadingEpic: 'Chargement de l’Epic',
    unavailable: 'Epic indisponible',
    notFound: 'Epic introuvable',
    notFoundTitle: (id: string, project: string) => `Aucune Epic « ${id} » dans ${project}`,
    notFoundHint: 'L’Epic a peut-être été supprimée, ou le lien vient d’un autre Projet.',
    seeProjectEpics: 'Voir les Epics du Projet',
    notAnEpic: 'Ce n’est pas une Epic',
    /** `type` : le nom du type du ticket (`typeMeta`). */
    notAnEpicTitle: (id: string, type: string) => `« ${id} » est de type ${type}`,
    notAnEpicHint: 'Seul un ticket de type epic regroupe des Enfants et a une page d’avancement.',
  },
  /** La liste des Epics du Projet (`EpicList.tsx`). */
  list: {
    /** Dit aux lecteurs d'écran devant l'identifiant, à la place du pictogramme. */
    epic: 'Epic',
    closed: 'fermée',
    empty: 'Aucune Epic dans ce Projet',
    emptyHint: 'Une Epic est un ticket de type epic ; celles de ce Projet apparaîtront ici dès leur création.',
    /** `epics`, `children` : des noms comptés (`counted`). */
    summary: (epics: string, children: string) => `${epics} regroupant ${children}`,
    open: 'Epics ouvertes',
    closedEpics: 'Epics fermées',
    /** `dropped` : les Abandons comptés. */
    nothingToDeliver: (dropped: string) => `Aucun Enfant à livrer (${dropped})`,
    /** Nom de la barre d'avancement d'une Epic de la liste ; `epic` : son nom (`epicName`). */
    progressOf: (epic: string) => `Avancement de ${epic}`,
  },
  /** L'avancement d'une Epic (`ProgressSection.tsx`), et ce que la liste et les lignes en reprennent. */
  progress: {
    title: 'Avancement',
    /** « 2 Livraisons sur 5 Enfants » ; `deliveries` et `children` : des noms comptés. */
    sentence: (deliveries: string, children: string) => `${deliveries} sur ${children}`,
    /** « 2 sur 5 », suivi pour les lecteurs d'écran de `deliveriesSpoken`. */
    deliveredOf: (delivered: string, total: string) => `${delivered} sur ${total}`,
    deliveriesSpoken: 'Livraisons',
    noChildren: 'Aucun Enfant',
    noChildrenSentence: 'Aucun Enfant : cette Epic ne regroupe encore aucun ticket.',
    /** `n` : les Abandons, `children` : eux comptés en Enfants. */
    nothingToDeliver: (n: number, children: string) =>
      `Aucun Enfant à livrer : ${children} ${n >= 2 ? 'sont des Abandons' : 'est un Abandon'}.`,
    bar: 'Avancement de l’Epic',
    byColumn: 'Enfants par colonne',
    /** « dont 2 Abandons » ; `dropped` : les Abandons comptés. */
    including: (dropped: string) => `dont ${dropped}`,
    droppedNote: (n: number, count: string) =>
      n >= 2
        ? `${count} Abandons (doublons ou remplacés) ne sont comptés ni parmi les Livraisons ni parmi les Enfants à livrer.`
        : `${count} Abandon (doublon ou remplacé) n’est compté ni parmi les Livraisons ni parmi les Enfants à livrer.`,
  },
  /** La page d'une Epic (`EpicView.tsx`) : son en-tête et la section de ses Enfants. */
  epic: {
    type: 'Type',
    id: 'Identifiant',
    priority: 'Priorité',
    status: 'Statut',
    openTicket: 'Ouvrir le ticket',
    seeOnKanban: 'Voir au kanban',
    children: 'Enfants',
  },
  /** Les Enfants : leurs groupes (`ByColumn.tsx`), leurs lignes (`ChildRow.tsx`), l'arbre et le choix de l'affichage. */
  children: {
    /** Le groupe des Enfants qui ne sont dans aucune colonne du kanban. */
    paused: 'En pause',
    nestedEpics: 'Epics imbriquées',
    statusBlocked: 'Statut bloqué',
    /** `ids` : les premiers identifiants bloquants, séparés par une virgule ; le reste est compté après (« +2 »). */
    waitingFor: (ids: string) => `Attend ${ids}`,
    /** Dit aux lecteurs d'écran devant l'âge de clôture d'un Enfant. */
    closed: 'Fermé',
    viewGroup: 'Affichage des Enfants',
    byColumn: 'Par colonne',
    tree: 'Arbre',
    treeList: 'Arborescence',
  },
  /** Le Lead Time et la Prévision de fin d'une Epic (`TimeSection.tsx`). */
  time: {
    title: 'Lead Time et prévision',
    leadTime: 'Lead Time',
    /** Suivi de la date de création, puis de « fermée le » et de la date de clôture. */
    createdOn: 'créée le',
    closedOn: 'fermée le',
    undefined: 'Indéfini',
    noCloseDate: 'sans date de clôture',
    /** Suivi de la durée depuis la création, ou de `unknownDate`. */
    openSince: 'pas encore fermée · ouverte depuis',
    unknownDate: 'une date inconnue',
    forecast: 'Prévision de fin',
    hidden: 'Masquée',
    epicClosed: 'Epic fermée : il n’y a plus de fin à prévoir.',
    noChildren: 'Aucun Enfant à livrer.',
    allDelivered: 'Tous les Enfants sont livrés ou abandonnés : l’Epic peut être fermée.',
    /** `deliveries` : les Livraisons comptées ; `days` : la fenêtre du Débit, en jours (7 au moins). Suivi de `youngEpic…` puis de `lowThroughputEnd`. */
    lowThroughput: (deliveries: string, days: string) => `Pas assez de Débit : ${deliveries} sur les ${days} derniers jours`,
    lowThroughputEnd: (needed: string) => `, il en faut au moins ${needed}.`,
    /** Une Epic de moins de 7 jours : `youngEpicStart`, son âge, `youngEpicEnd`. */
    youngEpicStart: ' (l’Epic n’a que ',
    youngEpicEnd: ' : la mesure remonte avant sa création)',
    /** `window` : `span.on` ou `span.between`. */
    estimatedEnd: (window: string) => `Fin estimée ${window}`,
    /** Suivi de `youngEpic…` puis de `paceEnd`. */
    pace: (deliveries: string, days: string) => `Au rythme de ${deliveries} en ${days} jours`,
    /** `n` : les Enfants restants, `children` : eux comptés. */
    paceEnd: (n: number, children: string) => `, pour ${children} ${n >= 2 ? 'restants' : 'restant'}.`,
    methodTitle: 'Méthode.',
    /** Suit le titre `methodTitle`. Les nombres : les jours du Débit récent, sa fenêtre minimale, les Livraisons qu'il faut au moins. */
    method: (recentDays: string, minWindowDays: string, minDeliveries: string) =>
      `Le Débit récent de l’Epic (ses Livraisons des ${recentDays} derniers jours, ou depuis sa création si elle est plus récente, mais jamais sur moins de ${minWindowDays} jours : la mesure d’une Epic de moins de ${minWindowDays} jours remonte donc avant sa création) donne un rythme, appliqué aux Enfants qui restent à livrer : ceux en pause comptent, les Abandons non. La fourchette tient compte du hasard d’un petit nombre de Livraisons (plus ou moins la racine de leur nombre). Elle suppose que le rythme se maintient et qu’aucun Enfant n’est ajouté ; ce n’est pas un engagement. Sous ${minDeliveries} Livraisons récentes, elle est masquée.`,
  },
  /**
   * La fourchette de la Prévision de fin (`forecastText.ts`), écrite pour les yeux (espace insécable avant l'unité) et dite pour
   * les lecteurs d'écran. Les nombres sont déjà écrits ; les unités sont au pluriel (une fourchette va toujours jusqu'à 2 au moins).
   */
  span: {
    days: 'jours',
    weeks: 'semaines',
    months: 'mois',
    about: (count: string, unit: string) => `environ ${count}${NBSP}${unit}`,
    aboutSpoken: (count: string, unit: string) => `environ ${count} ${unit}`,
    range: (from: string, to: string, unit: string) => `${from} à ${to}${NBSP}${unit}`,
    rangeSpoken: (from: string, to: string, unit: string) => `entre ${from} et ${to} ${unit}`,
    /** Toujours en jours. */
    lessThan: (count: string) => `moins de ${count}${NBSP}jours`,
    lessThanSpoken: (count: string) => `moins de ${count} jours`,
    lessThanADay: 'moins d’un jour',
    moreThanAYear: 'plus d’un an',
    /** Les jours où la fin tombe, écrits par `formatDay`. */
    on: (day: string) => `le ${day}`,
    between: (from: string, to: string) => `entre le ${from} et le ${to}`,
  },
};

const en: typeof fr = {
  counted: {
    deliveries: enCounted('Delivery', 'Deliveries'),
    children: enCounted('Child', 'Children'),
    dropped: enCounted('Dropped', 'Dropped'),
    epics: enCounted('Epic', 'Epics'),
  },
  page: {
    title: 'Epics',
    description: (project: string) => `The Progress of each Epic in ${project}: the Deliveries among its Children.`,
    loadFailed: 'Couldn’t load the tickets',
    loadingList: 'Loading Epics',
    loadingEpic: 'Loading Epic',
    unavailable: 'Epic unavailable',
    notFound: 'Epic not found',
    notFoundTitle: (id: string, project: string) => `No Epic “${id}” in ${project}`,
    notFoundHint: 'The Epic may have been deleted, or the link comes from another Project.',
    seeProjectEpics: 'See the Project’s Epics',
    notAnEpic: 'This isn’t an Epic',
    notAnEpicTitle: (id: string, type: string) => `“${id}” is of type ${type}`,
    notAnEpicHint: 'Only a ticket of type epic groups Children and has a Progress page.',
  },
  list: {
    epic: 'Epic',
    closed: 'closed',
    empty: 'No Epics in this Project',
    emptyHint: 'An Epic is a ticket of type epic; this Project’s Epics will show up here as soon as they are created.',
    summary: (epics: string, children: string) => `${epics} grouping ${children}`,
    open: 'Open Epics',
    closedEpics: 'Closed Epics',
    nothingToDeliver: (dropped: string) => `No Children to deliver (${dropped})`,
    progressOf: (epic: string) => `Progress of ${epic}`,
  },
  progress: {
    title: 'Progress',
    sentence: (deliveries: string, children: string) => `${deliveries} out of ${children}`,
    deliveredOf: (delivered: string, total: string) => `${delivered} of ${total}`,
    deliveriesSpoken: 'delivered',
    noChildren: 'No Children',
    noChildrenSentence: 'No Children: this Epic doesn’t group any tickets yet.',
    nothingToDeliver: (n: number, children: string) => `No Children to deliver: ${children} ${n === 1 ? 'is Dropped' : 'are Dropped'}.`,
    bar: 'Progress of the Epic',
    byColumn: 'Children by column',
    including: (dropped: string) => `including ${dropped}`,
    droppedNote: (n: number, count: string) =>
      n === 1
        ? `${count} Dropped ticket (duplicate or superseded) counts neither as a Delivery nor as a Child to deliver.`
        : `${count} Dropped tickets (duplicates or superseded) count neither as Deliveries nor as Children to deliver.`,
  },
  epic: {
    type: 'Type',
    id: 'ID',
    priority: 'Priority',
    status: 'Status',
    openTicket: 'Open the ticket',
    seeOnKanban: 'See on the kanban',
    children: 'Children',
  },
  children: {
    paused: 'Paused',
    nestedEpics: 'Nested Epics',
    statusBlocked: 'Blocked status',
    waitingFor: (ids: string) => `Waiting on ${ids}`,
    closed: 'Closed',
    viewGroup: 'Children display',
    byColumn: 'By column',
    tree: 'Tree',
    treeList: 'Tree',
  },
  time: {
    title: 'Lead Time and forecast',
    leadTime: 'Lead Time',
    createdOn: 'created',
    closedOn: 'closed',
    undefined: 'Undefined',
    noCloseDate: 'no close date',
    openSince: 'not closed yet · open for',
    unknownDate: 'an unknown time',
    forecast: 'Completion forecast',
    hidden: 'Hidden',
    epicClosed: 'Epic closed: there is no end left to forecast.',
    noChildren: 'No Children to deliver.',
    allDelivered: 'All Children are Delivered or Dropped: the Epic can be closed.',
    lowThroughput: (deliveries: string, days: string) => `Not enough Throughput: ${deliveries} over the last ${days} days`,
    lowThroughputEnd: (needed: string) => `; at least ${needed} are needed.`,
    youngEpicStart: ' (the Epic is only ',
    youngEpicEnd: ' old: the measurement reaches back before its creation)',
    estimatedEnd: (window: string) => `Estimated end ${window}`,
    pace: (deliveries: string, days: string) => `At a pace of ${deliveries} in ${days} days`,
    paceEnd: (_n: number, children: string) => `, for ${children} remaining.`,
    methodTitle: 'Method.',
    method: (recentDays: string, minWindowDays: string, minDeliveries: string) =>
      `The Epic’s Recent throughput (its Deliveries over the last ${recentDays} days, or since its creation if it is more recent, but never over fewer than ${minWindowDays} days: for an Epic under ${minWindowDays} days old, the measurement therefore reaches back before its creation) gives a pace, applied to the Children left to deliver: paused ones count, Dropped ones don’t. The range accounts for the randomness of a small number of Deliveries (plus or minus the square root of their number). It assumes the pace holds and no Child is added; it isn’t a commitment. Below ${minDeliveries} recent Deliveries, it is hidden.`,
  },
  span: {
    days: 'days',
    weeks: 'weeks',
    months: 'months',
    about: (count: string, unit: string) => `about ${count}${NBSP}${unit}`,
    aboutSpoken: (count: string, unit: string) => `about ${count} ${unit}`,
    range: (from: string, to: string, unit: string) => `${from} to ${to}${NBSP}${unit}`,
    rangeSpoken: (from: string, to: string, unit: string) => `between ${from} and ${to} ${unit}`,
    lessThan: (count: string) => `less than ${count}${NBSP}days`,
    lessThanSpoken: (count: string) => `less than ${count} days`,
    lessThanADay: 'less than a day',
    moreThanAYear: 'more than a year',
    on: (day: string) => `on ${day}`,
    between: (from: string, to: string) => `between ${from} and ${to}`,
  },
};

export const epics: Zone<typeof fr> = { fr, en };
