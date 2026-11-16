import type { IssueType, Priority } from '../../design/issue-palette';
import type { Zone } from './zone';

/**
 * Zone « kanban » (bdesk-ewr.3) : `kanban/`, `issue/` (Panneau de ticket), `markdown/`, `design/` (types, statuts, priorités), pages du kanban.
 *
 * Les noms des types, des priorités, des statuts et des colonnes servent aussi aux autres zones (Epics, Métriques, palette) : elles les lisent ici
 * (`t.kanban.types`, `t.kanban.columns`…) ou par les fonctions de `design/issue-palette.ts` et de `kanban/meta.ts`, qui prennent la langue.
 */
const fr = {
  /** Les types de tickets beads ; un type personnalisé garde son nom brut. */
  types: {
    bug: 'Bug',
    feature: 'Fonctionnalité',
    task: 'Tâche',
    chore: 'Maintenance',
    epic: 'Epic',
    decision: 'Décision',
    spike: 'Spike',
    story: 'Story',
    milestone: 'Jalon',
  } satisfies Record<IssueType, string>,
  /** Les priorités, de P0 à P4. */
  priorities: {
    0: 'Critique',
    1: 'Haute',
    2: 'Moyenne',
    3: 'Basse',
    4: 'Minimale',
  } satisfies Record<Priority, string>,
  /** Les statuts beads, en minuscules : ils se lisent dans une phrase ou à côté d'un titre. Un statut personnalisé garde son nom brut. */
  statuses: {
    open: 'ouvert',
    in_progress: 'en cours',
    hooked: 'rattaché à un agent',
    blocked: 'statut bloqué',
    deferred: 'reporté',
    pinned: 'épinglé',
    closed: 'fermé',
    /** Un statut vide. */
    unknown: 'inconnu',
  },
  /** Les colonnes du kanban et le tiroir « En pause » (`kanban/meta.ts`). */
  columns: {
    backlog: {
      label: 'Backlog',
      hint: 'Ouvert, en Blocage',
      rule: 'Ticket ouvert en Blocage : il dépend d’au moins un ticket qui n’est pas fermé.',
    },
    ready: {
      label: 'Prêt',
      hint: 'Ouvert, hors Blocage',
      rule: 'Ticket ouvert dont aucune dépendance n’est en suspens (le « ready » de beads).',
    },
    inProgress: {
      label: 'En cours',
      hint: 'En cours, hors Blocage',
      rule: 'Ticket en cours ou rattaché à un agent, sans dépendance en suspens.',
    },
    blocked: {
      label: 'Bloqué',
      hint: 'Blocage ou statut bloqué',
      rule: 'Ticket au statut bloqué, ou en cours (ou rattaché à un agent) mais en Blocage : il dépend d’un ticket qui n’est pas fermé.',
    },
    done: {
      label: 'Terminé',
      // Des jours calendaires, aujourd'hui compris (voir `doneSince`) : une seule journée se dit « aujourd'hui ».
      hint: (days: number) => (days === 1 ? 'Fermé aujourd’hui' : `Fermé ces ${days} derniers jours`),
      /** `since` : le premier jour de la fenêtre, déjà écrit (« mardi 13 octobre »), quand on le connaît. */
      rule: (days: number, since: string | undefined) => {
        const window = days === 1 ? 'aujourd’hui' : `ces ${days} derniers jours, aujourd’hui compris`;
        const from = since === undefined ? '' : `, soit depuis le ${since} à minuit`;
        return `Ticket fermé ${window}${from} (jours calendaires, heure de votre navigateur).`;
      },
      empty: (days: number) => (days === 1 ? 'Aucun ticket fermé aujourd’hui' : `Aucun ticket fermé ces ${days} derniers jours`),
    },
    /** Ce que dit une colonne autre que Terminé quand elle n'a aucune carte. */
    empty: 'Aucun ticket',
    /** Le tiroir des tickets reportés, épinglés ou d'un statut inconnu. */
    paused: 'En pause',
  },
  board: {
    /** « ticket » ou « tickets » : zéro est singulier en français. */
    ticketNoun: (n: number) => (n >= 2 ? 'tickets' : 'ticket'),
    /** Le nombre de cartes du tableau. */
    count: (count: string, n: number) => `${count} ${n >= 2 ? 'tickets' : 'ticket'}`,
    /** Après le nombre de cartes, tant que le tableau n'est pas filtré : les Epics ne sont pas des cartes, on dit où les trouver. */
    epicsInFilter: (count: string, n: number) => `· ${count} ${n >= 2 ? 'Epics' : 'Epic'} dans le filtre`,
    unknownEpic: {
      title: (id: string) => `Aucune Epic « ${id} » dans ce Projet`,
      detail: 'Le tableau montre tous les tickets. L’Epic a peut-être été supprimée, ou le lien vient d’un autre Projet.',
      clear: 'Retirer le filtre',
    },
    onlyPaused: {
      title: (count: string, n: number) => (n >= 2 ? `Les ${count} tickets du tableau sont tous en pause` : 'Le seul ticket du tableau est en pause'),
      detail: (n: number): string =>
        n >= 2
          ? 'Reportés, épinglés ou d’un statut inconnu, ils ne sont dans aucune colonne : ils attendent dans le tiroir « En pause ».'
          : 'Reporté, épinglé ou d’un statut inconnu, il n’est dans aucune colonne : il attend dans le tiroir « En pause ».',
      open: 'Ouvrir « En pause »',
    },
    /** Sous Terminé : les tickets fermés avant la fenêtre, dont la date de clôture est connue. */
    closedEarlier: (count: string, n: number) => `${count} ${n >= 2 ? 'autres fermés' : 'autre fermé'} plus tôt`,
    /** Sous Terminé : les tickets fermés sans date de clôture. */
    closedUndated: (count: string, n: number) => `${count} ${n >= 2 ? 'fermés' : 'fermé'} sans date de clôture`,
    /** Le réglage de Terminé. */
    doneWindow: 'Durée de Terminé',
    /** « 1 jour », « 14 jours ». */
    days: (n: number) => `${n} ${n >= 2 ? 'jours' : 'jour'}`,
    /** Le sélecteur de colonne du mobile. */
    columnSelector: 'Colonne affichée',
    loading: 'Chargement des tickets',
    paused: {
      hint: 'Reportés, épinglés ou d’un statut inconnu',
      empty: 'Aucun ticket en pause',
    },
  },
  epicFilter: {
    label: 'Epic',
    /** L'option qui retire le filtre : aucune Epic ne doit se lire comme elle (`epicLabels`). */
    all: 'Toutes les Epics',
    open: 'Epics ouvertes',
    closed: 'Epics fermées',
  },
  card: {
    /** Devant l'âge de la carte, pour les lecteurs d'écran. */
    closed: 'Fermé',
    updated: 'Mis à jour',
    /** La pastille d'un ticket rattaché à un agent. */
    agent: 'agent',
    agentTitle: 'Rattaché à un agent',
    /** Devant le nom de l'Epic de la pastille, pour les lecteurs d'écran. */
    epic: 'Epic :',
    blockedStatus: 'Statut bloqué',
    /** Devant les identifiants des tickets attendus. */
    waitingOn: 'Attend',
    /** Après le nom d'un Signal, pour les lecteurs d'écran : de combien il dépasse la normale (`signalSentence`). */
    signalDetail: (sentence: string) => ` : ${sentence}`,
  },
  shortcuts: {
    group: 'Kanban',
    next: 'Ticket suivant',
    previous: 'Ticket précédent',
    previousColumn: 'Colonne précédente',
    nextColumn: 'Colonne suivante',
    open: 'Ouvrir le ticket sélectionné',
    deselect: 'Désélectionner le ticket',
  },
  page: {
    title: 'Kanban',
    /** `project` : le Projet dans une phrase (`projectInSentence`). */
    description: (project: string) => `Les tickets de ${project}, en colonnes, en lecture seule.`,
    empty: {
      title: 'Aucun ticket dans ce Projet',
      /** Autour de `bd create`. */
      before: 'Créez-en un avec',
      after: ' : il apparaîtra ici dans quelques secondes.',
    },
    gone: {
      title: 'Ce Projet n’est plus disponible',
      detail: 'Il a peut-être été masqué dans la configuration, ou son dossier a été déplacé.',
      link: 'Voir les Projets suivis',
    },
    loadError: 'Impossible de charger les tickets',
  },
  panel: {
    notFound: 'Ticket introuvable',
    unavailable: 'Ticket indisponible',
    close: 'Fermer le panneau',
    /** Le corps du panneau, quand il défile. */
    content: 'Contenu du ticket',
    loading: 'Chargement du ticket',
    loadError: 'Impossible de charger le ticket',
    gone: {
      /** `project` : le Projet dans une phrase (`projectInSentence`). */
      title: (id: string, project: string) => `Aucun ticket « ${id} » dans ${project}`,
      otherProject: 'L’identifiant est peut-être celui d’un autre Projet : la palette (⌘K) peut chercher dans tous les Projets.',
      notRecorded: 'Le ticket n’est peut-être pas encore enregistré par bd ; dans ce cas, il s’affichera ici dès qu’il le sera.',
    },
    /** Le bouton de retour, vers la page d'où l'on vient (`useClosePanel`). */
    back: {
      kanban: 'Retour au kanban',
      overview: 'Retour à la Vue globale',
      epics: 'Retour aux Epics',
      metrics: 'Retour aux Métriques',
      previous: 'Retour à la page précédente',
    },
    shortcuts: {
      group: 'Ticket',
      close: 'Fermer le ticket',
    },
  },
  header: {
    type: 'Type',
    priority: 'Priorité',
    status: 'Statut',
    assignee: 'Assigné à',
    parent: 'Parent',
    progress: 'Avancement',
    /** Devant le nom de l'Epic parente, pour les lecteurs d'écran. */
    epic: 'Epic :',
    /** L'infobulle du lien vers la page de l'Epic. */
    epicPageTitle: (name: string) => `Avancement, Enfants, Lead Time et prévision de l’Epic «\u00a0${name}\u00a0»`,
    epicPage: (name: string) => `Page Epic : ${name}`,
    labels: 'Étiquettes',
    duplicateOf: 'Doublon de',
    supersededBy: 'Remplacé par',
    /** Le titre d'un ticket cité, entre guillemets. */
    quoted: (title: string) => `«\u00a0${title}\u00a0»`,
    untitled: '(sans titre)',
    outsideProject: '(hors du Projet)',
    notDelivered: '. Fermé sans être une Livraison.',
    blockedStatusOnly: 'Statut bloqué, sans dépendance en suspens',
    blockedWaitingOn: 'Bloqué : attend',
  },
  relations: {
    title: 'Relations',
    stillBlocking: 'Bloque encore',
    outsideProject: 'hors du Projet',
    kinds: {
      parent: 'Parent',
      children: 'Enfants',
      blockedBy: 'Bloqué par',
      blocks: 'Bloque',
      related: 'Lié à',
      discoveredFrom: 'Découvert à partir de',
      originOf: 'À l’origine de',
      duplicateOf: 'Doublon de',
      duplicates: 'A pour doublons',
      supersededBy: 'Remplacé par',
      supersedes: 'Remplace',
      /** Une relation que beads connaît et pas nous, par son nom de type. */
      dependsOn: (type: string) => `Dépend de (${type})`,
      dependedOnBy: (type: string) => `Dont dépendent (${type})`,
    },
  },
  texts: {
    description: 'Description',
    design: 'Conception',
    acceptanceCriteria: 'Critères d’acceptation',
    notes: 'Notes',
    closeReason: 'Raison de fermeture',
    empty: 'Aucun texte n’est renseigné pour ce ticket.',
    comments: 'Commentaires',
  },
  chronology: {
    title: 'Chronologie',
    leadTime: 'Lead Time',
    cycleTime: 'Cycle Time',
    blockedTime: 'Temps bloqué en cours de travail',
    loading: 'Chargement de la chronologie',
    unavailable: 'Chronologie indisponible',
    retry: 'Réessayer',
    datesOnly:
      'Historique indisponible pour ce ticket : seules ses dates de création et de clôture sont connues, sans Cycle Time ni Blocage.',
    /** Pourquoi une durée manque. */
    missing: {
      noHistory: 'sans historique',
      notClosed: 'ticket non fermé',
      neverStarted: 'jamais démarré',
    },
    /** Un temps bloqué nul. */
    none: 'Aucun',
    /** Une durée qui manque, pour les lecteurs d'écran. */
    unknownValue: 'Indéfini',
    timeZone: (zone: string) => `Heures du fuseau ${zone}`,
    transitions: 'Transitions',
    blockages: 'Blocages',
    blockagesNote: 'Seul le Blocage en cours de travail compte dans le temps bloqué.',
    /** Ce qu'est devenu le ticket ; `at` est un instant déjà écrit. */
    outcome: {
      open: 'Pas encore fermé',
      delivered: (at: string) => `Livraison le ${at}`,
      abandoned: (duplicate: boolean, at: string) => `Abandon (${duplicate ? 'doublon' : 'remplacé'}) le ${at}`,
      closed: (at: string) => `Fermé le ${at}`,
      /** `count` : le nombre de Réouvertures, déjà écrit ; « 1 » suffit à choisir la forme. */
      reopened: (count: string) => ` · Rouvert ${count} fois`,
    },
    /** Ce que la Transition fait au ticket ; `status` est déjà écrit (`statusLabel`). */
    transition: {
      created: 'Créé',
      createdAs: (status: string) => `Créé · ${status}`,
      closed: 'Fermé',
      reopened: 'Rouvert',
      reopenedAs: (status: string) => `Rouvert · ${status}`,
    },
    /** Devant la durée d'un statut : qui dure encore, ou qui a duré. */
    ongoingFor: 'depuis ',
    lastedFor: 'pendant ',
    /** Devant le début d'un Blocage qui dure encore. */
    blockageOngoingSince: 'En cours depuis le ',
    waitingOn: 'attend',
    statusBlocked: 'statut bloqué',
    /** Après le nom d'un Signal du ticket : de combien il dépasse la normale (`signalSentence`). */
    signalDetail: (sentence: string) => ` : ${sentence}.`,
    phases: {
      dependencyWait: 'avant le premier démarrage',
      work: 'en cours de travail',
      otherWait: 'hors du travail',
      then: ', puis ',
    },
  },
  markdown: {
    /** Devant une case cochée ou non d'une liste de tâches, pour les lecteurs d'écran. */
    done: 'Fait :',
    todo: 'À faire :',
    /** L'infobulle d'une image, jamais chargée, devenue lien. */
    remoteImage: 'Image distante, non chargée',
  },
};

const en: typeof fr = {
  types: {
    bug: 'Bug',
    feature: 'Feature',
    task: 'Task',
    chore: 'Chore',
    epic: 'Epic',
    decision: 'Decision',
    spike: 'Spike',
    story: 'Story',
    milestone: 'Milestone',
  },
  priorities: {
    0: 'Critical',
    1: 'High',
    2: 'Medium',
    3: 'Low',
    4: 'Minimal',
  },
  statuses: {
    open: 'open',
    in_progress: 'in progress',
    hooked: 'hooked to an agent',
    blocked: 'blocked status',
    deferred: 'deferred',
    pinned: 'pinned',
    closed: 'closed',
    unknown: 'unknown',
  },
  columns: {
    backlog: {
      label: 'Backlog',
      hint: 'Open, Blocked',
      rule: 'Open ticket that is Blocked: it depends on at least one ticket that isn’t closed.',
    },
    ready: {
      label: 'Ready',
      hint: 'Open, not Blocked',
      rule: 'Open ticket with no pending dependency (beads’ “ready”).',
    },
    inProgress: {
      label: 'In progress',
      hint: 'In progress, not Blocked',
      rule: 'Ticket in progress or hooked to an agent, with no pending dependency.',
    },
    blocked: {
      label: 'Blocked',
      hint: 'Blockage or blocked status',
      rule: 'Ticket with the blocked status, or in progress (or hooked to an agent) but Blocked: it depends on a ticket that isn’t closed.',
    },
    done: {
      label: 'Done',
      hint: (days: number) => (days === 1 ? 'Closed today' : `Closed in the last ${days} days`),
      rule: (days: number, since: string | undefined) => {
        const window = days === 1 ? 'today' : `in the last ${days} days, today included`;
        const from = since === undefined ? '' : `, that is since midnight on ${since}`;
        return `Ticket closed ${window}${from} (calendar days, your browser’s time).`;
      },
      empty: (days: number) => (days === 1 ? 'No tickets closed today' : `No tickets closed in the last ${days} days`),
    },
    empty: 'No tickets',
    paused: 'Paused',
  },
  board: {
    ticketNoun: (n: number) => (n === 1 ? 'ticket' : 'tickets'),
    count: (count: string, n: number) => `${count} ${n === 1 ? 'ticket' : 'tickets'}`,
    epicsInFilter: (count: string, n: number) => `· ${count} ${n === 1 ? 'Epic' : 'Epics'} in the filter`,
    unknownEpic: {
      title: (id: string) => `No Epic “${id}” in this Project`,
      detail: 'The board shows all tickets. The Epic may have been deleted, or the link comes from another Project.',
      clear: 'Clear the filter',
    },
    onlyPaused: {
      title: (count: string, n: number) => (n === 1 ? 'The only ticket on the board is paused' : `All ${count} tickets on the board are paused`),
      detail: (n: number): string =>
        n === 1
          ? 'Deferred, pinned or of an unknown status, it isn’t in any column: it waits in the “Paused” drawer.'
          : 'Deferred, pinned or of an unknown status, they aren’t in any column: they wait in the “Paused” drawer.',
      open: 'Open “Paused”',
    },
    closedEarlier: (count: string, n: number) => (n === 1 ? `${count} other closed earlier` : `${count} others closed earlier`),
    closedUndated: (count: string, n: number) => (n === 1 ? `${count} closed ticket with no close date` : `${count} closed tickets with no close date`),
    doneWindow: 'Done window',
    days: (n: number) => (n === 1 ? '1 day' : `${n} days`),
    columnSelector: 'Column shown',
    loading: 'Loading the tickets',
    paused: {
      hint: 'Deferred, pinned or of an unknown status',
      empty: 'No paused tickets',
    },
  },
  epicFilter: {
    label: 'Epic',
    all: 'All Epics',
    open: 'Open Epics',
    closed: 'Closed Epics',
  },
  card: {
    closed: 'Closed',
    updated: 'Updated',
    agent: 'agent',
    agentTitle: 'Hooked to an agent',
    epic: 'Epic:',
    blockedStatus: 'Blocked status',
    waitingOn: 'Waiting on',
    signalDetail: (sentence: string) => `: ${sentence}`,
  },
  shortcuts: {
    group: 'Kanban',
    next: 'Next ticket',
    previous: 'Previous ticket',
    previousColumn: 'Previous column',
    nextColumn: 'Next column',
    open: 'Open the selected ticket',
    deselect: 'Deselect the ticket',
  },
  page: {
    title: 'Kanban',
    description: (project: string) => `The tickets of ${project}, in columns, read-only.`,
    empty: {
      title: 'No tickets in this Project',
      before: 'Create one with',
      after: ': it will show up here within a few seconds.',
    },
    gone: {
      title: 'This Project is no longer available',
      detail: 'It may have been hidden in the configuration, or its folder may have been moved.',
      link: 'See the tracked Projects',
    },
    loadError: 'Couldn’t load the tickets',
  },
  panel: {
    notFound: 'Ticket not found',
    unavailable: 'Ticket unavailable',
    close: 'Close the panel',
    content: 'Ticket content',
    loading: 'Loading the ticket',
    loadError: 'Couldn’t load the ticket',
    gone: {
      title: (id: string, project: string) => `No ticket “${id}” in ${project}`,
      otherProject: 'The identifier may belong to another Project: the palette (⌘K) can search every Project.',
      notRecorded: 'Or bd may not have recorded the ticket yet; if so, it will show up here as soon as it does.',
    },
    back: {
      kanban: 'Back to the kanban',
      overview: 'Back to the Overview',
      epics: 'Back to Epics',
      metrics: 'Back to Metrics',
      previous: 'Back to the previous page',
    },
    shortcuts: {
      group: 'Ticket',
      close: 'Close the ticket',
    },
  },
  header: {
    type: 'Type',
    priority: 'Priority',
    status: 'Status',
    assignee: 'Assigned to',
    parent: 'Parent',
    progress: 'Progress',
    epic: 'Epic:',
    epicPageTitle: (name: string) => `Progress, Children, Lead Time and forecast of the Epic “${name}”`,
    epicPage: (name: string) => `Epic page: ${name}`,
    labels: 'Labels',
    duplicateOf: 'Duplicate of',
    supersededBy: 'Superseded by',
    quoted: (title: string) => `“${title}”`,
    untitled: '(untitled)',
    outsideProject: '(outside the Project)',
    notDelivered: '. Closed without being a Delivery.',
    blockedStatusOnly: 'Blocked status, with no pending dependency',
    blockedWaitingOn: 'Blocked: waiting on',
  },
  relations: {
    title: 'Relations',
    stillBlocking: 'Still blocking',
    outsideProject: 'outside the Project',
    kinds: {
      parent: 'Parent',
      children: 'Children',
      blockedBy: 'Blocked by',
      blocks: 'Blocks',
      related: 'Related to',
      discoveredFrom: 'Discovered from',
      originOf: 'Origin of',
      duplicateOf: 'Duplicate of',
      duplicates: 'Duplicated by',
      supersededBy: 'Superseded by',
      supersedes: 'Supersedes',
      dependsOn: (type: string) => `Depends on (${type})`,
      dependedOnBy: (type: string) => `Depended on by (${type})`,
    },
  },
  texts: {
    description: 'Description',
    design: 'Design',
    acceptanceCriteria: 'Acceptance criteria',
    notes: 'Notes',
    closeReason: 'Close reason',
    empty: 'This ticket has no text.',
    comments: 'Comments',
  },
  chronology: {
    title: 'Timeline',
    leadTime: 'Lead Time',
    cycleTime: 'Cycle Time',
    blockedTime: 'Blocked time during work',
    loading: 'Loading the timeline',
    unavailable: 'Timeline unavailable',
    retry: 'Retry',
    datesOnly: 'History unavailable for this ticket: only its creation and close dates are known, with no Cycle Time or Blockage.',
    missing: {
      noHistory: 'no history',
      notClosed: 'ticket not closed',
      neverStarted: 'never started',
    },
    none: 'None',
    unknownValue: 'Not available',
    timeZone: (zone: string) => `Times in the ${zone} time zone`,
    transitions: 'Transitions',
    blockages: 'Blockages',
    blockagesNote: 'Only the Blockage during work counts toward blocked time.',
    outcome: {
      open: 'Not closed yet',
      delivered: (at: string) => `Delivery on ${at}`,
      abandoned: (duplicate: boolean, at: string) => `Dropped (${duplicate ? 'duplicate' : 'superseded'}) on ${at}`,
      closed: (at: string) => `Closed on ${at}`,
      reopened: (count: string) => (count === '1' ? ' · Reopened once' : ` · Reopened ${count} times`),
    },
    transition: {
      created: 'Created',
      createdAs: (status: string) => `Created · ${status}`,
      closed: 'Closed',
      reopened: 'Reopened',
      reopenedAs: (status: string) => `Reopened · ${status}`,
    },
    ongoingFor: 'ongoing for ',
    lastedFor: 'for ',
    blockageOngoingSince: 'Ongoing since ',
    waitingOn: 'waiting on',
    statusBlocked: 'blocked status',
    signalDetail: (sentence: string) => `: ${sentence}.`,
    phases: {
      dependencyWait: 'before the first start',
      work: 'during work',
      otherWait: 'outside work',
      then: ', then ',
    },
  },
  markdown: {
    done: 'Done:',
    todo: 'To do:',
    remoteImage: 'Remote image, not loaded',
  },
};

export const kanban: Zone<typeof fr> = { fr, en };
