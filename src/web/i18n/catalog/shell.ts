import type { Zone } from './zone';

/**
 * Zone « shell » (bdesk-ewr.2) : `shell/`, `palette/`, `shortcuts/`, `live/`, `ui/`, `data/`, `lib/` (dont `signals.ts`), `theme/`, titres d'onglet, et les pages
 * qui n'appartiennent à aucune autre zone (Vue globale, À regarder, page introuvable, erreur de route). Le sélecteur de langue
 * (`LanguageToggle`, entrées de la palette) y a ses textes.
 *
 * Textes partagés que les autres zones lisent ici : `common` (Réessayer, Sans titre…), `sections` (noms des onglets d'un Projet),
 * `signals` (sortes et phrases des Signaux), `badges` (Priorité, Abandon), `projectNames` (le nom d'un Projet sans nom), `loadErrors`.
 */
const fr = {
  language: {
    /** Nom du groupe de boutons du sélecteur. */
    group: 'Langue',
    /** La position « suivre le navigateur ». Les autres portent le nom de la langue écrit dans cette langue (`LANGUAGE_NAMES`). */
    system: 'Langue du navigateur',
    /** Mots qui trouvent les entrées de langue dans la palette, en plus de leur libellé. */
    keywords: ['langue', 'language', 'traduction', 'français', 'anglais', 'english', 'french'],
  },
  /** Mots que toute l'interface emploie. */
  common: {
    retry: 'Réessayer',
    close: 'Fermer',
    /** Ce qui s'écrit à la place d'un titre (ticket, page, Projet) qu'on ne verrait pas. */
    untitled: 'Sans titre',
    loading: 'Chargement…',
    /** Un Projet que le serveur n'arrive pas à lire. */
    unreadable: 'Illisible',
    /** Devant la raison d'un Projet illisible, pour les lecteurs d'écran (« Illisible : base verrouillée »). */
    unreadableBecause: 'Illisible : ',
  },
  /** Les onglets d'un Projet (barre latérale, barre d'onglets, fil d'Ariane, palette, raccourcis). */
  sections: {
    kanban: 'Kanban',
    signals: 'À regarder',
    epics: 'Epics',
    metrics: 'Métriques',
  },
  layout: {
    skipToContent: 'Aller au contenu',
    /** Nom du contenu principal (`<main>`), que le lecteur d'écran dit quand il prend le focus. */
    main: 'Contenu',
    search: 'Rechercher',
    primaryNavigation: 'Navigation principale',
    /** La barre d'onglets du mobile. */
    tabs: 'Onglets',
    breadcrumb: "Fil d'Ariane",
    /** Suite du nom du bouton du Projet sur mobile, pour les lecteurs d'écran : « bdesk, changer de Projet ». */
    switchProject: ', changer de Projet',
    shortcuts: 'Raccourcis clavier',
    showShortcuts: 'Afficher les raccourcis clavier',
    projects: 'Projets',
    noProjects: 'Aucun Projet trouvé.',
    projectsUnavailable: 'Projets indisponibles : le serveur ne répond pas.',
    loadingProjects: 'Chargement des Projets',
  },
  theme: {
    group: 'Thème',
    system: 'Thème du système',
    light: 'Thème clair',
    dark: 'Thème sombre',
    /** Mots qui trouvent les thèmes dans la palette, en plus de leur libellé. */
    keywords: ['apparence', 'mode', 'couleurs', 'clair', 'sombre', 'thème', 'dark', 'light'],
  },
  /** Les raccourcis de l'application et leur aide. Les touches ne changent pas d'une langue à l'autre, seuls les libellés. */
  shortcuts: {
    groups: { general: 'Général', navigation: 'Navigation' },
    togglePalette: 'Ouvrir la palette de commandes',
    showHelp: 'Afficher les raccourcis clavier',
    goToOverview: 'Aller à la Vue globale',
    switchProject: 'Changer de Projet',
    /** « Aller à Métriques » : le nom d'un onglet (`sections`). */
    goTo: (place: string) => `Aller à ${place}`,
    helpTitle: 'Raccourcis clavier',
    helpDescription:
      'Ils sont ignorés quand le curseur est dans un champ de saisie. Entrée et les flèches restent au bouton, au lien ou à la liste qui les utilise.',
    list: 'Liste des raccourcis',
    /** Entre deux touches d'une même action : « H ou ← ». */
    or: 'ou',
    /** Entre deux étapes d'une séquence : « G puis K ». */
    then: 'puis',
  },
  /** Le nom écrit des touches qui ne sont pas un signe (`keyCaps`). */
  keys: {
    escape: 'Échap',
    space: 'Espace',
    tab: 'Tab',
    shift: 'Maj',
  },
  live: {
    lost: 'Mises à jour en direct interrompues : reconnexion en cours. Ce qui est affiché peut ne plus être à jour.',
    reconnect: 'Reconnecter',
    refreshFailed: 'Actualisation impossible : les données affichées ne sont peut-être plus à jour.',
  },
  /** Titres et détails d'une erreur de chargement (`describeError`). */
  loadErrors: {
    unreachable: 'Le serveur Throughline est injoignable',
    unreachableDetail: 'Vérifiez que la commande throughline tourne toujours, puis réessayez.',
    unreadableProject: 'Projet illisible',
    serverError: 'Le serveur a rencontré une erreur',
    notFound: 'Ressource introuvable',
    failed: 'Chargement impossible',
    /** Le détail d'une réponse d'erreur sans message. */
    http: (status: number) => `Erreur HTTP ${status}`,
  },
  /** Le nom d'un Projet dont le dossier n'a pas de nom qu'on voie, et les Projets dans une phrase (`data/projectNames.ts`). */
  projectNames: {
    /** Après « de » ou « dans » : « Les tickets de ce Projet ». */
    thisProject: 'ce Projet',
    /** Un nom entre guillemets : ce qui est entre guillemets est un nom, quoi qu'il dise. */
    quoted: (name: string) => `« ${name} »`,
    /** Les Projets sans nom d'une liste, ensemble, après les autres. `count` : leur nombre écrit. */
    unnamedInList: (count: string, n: number) => (n >= 2 ? `${count} Projets sans nom` : 'un Projet sans nom'),
    /** Un Projet sans nom, en tête de sa ligne. */
    unnamedLabel: 'Un Projet sans nom',
  },
  /** Les Signaux (`lib/signals.ts`) : le nom de chaque sorte, et ce qu'il dit. Les durées et les nombres arrivent écrits. */
  signals: {
    kinds: {
      drift: 'Dérive',
      longBlockage: 'Blocage long',
      stagnantReady: 'Prêt qui stagne',
      unusualWip: 'WIP inhabituel',
    },
    /** D'où vient le Cycle Time de référence. */
    scopes: { type: 'des Livraisons du même type', project: 'des Livraisons du Projet' },
    drift: (cycleTime: string, reference: string, scope: string) =>
      `${cycleTime} de Cycle Time en cours, au-delà de ${reference}, le P85 ${scope}`,
    longBlockage: (duration: string) => `bloqué en cours de travail depuis ${duration}`,
    stagnantReady: (age: string) => `Prêt depuis ${age}`,
    /** `wip` et `threshold` : les nombres écrits ; `n` : le WIP, pour l'accord. */
    unusualWip: (wip: string, threshold: string, n: number) =>
      `${wip} ${n >= 2 ? 'tickets' : 'ticket'} en cours, au-delà de ${threshold}, le P85 du WIP quotidien des 90 derniers jours`,
  },
  badges: {
    /** Infobulle d'une priorité : « Priorité Haute » (`label` : le nom de la priorité). */
    priority: (label: string) => `Priorité ${label}`,
    abandon: 'Abandon',
    /** Infobulle de la pastille, avec son motif. */
    abandonTitle: (reason: string) => `Abandon : ${reason}`,
    /** Le motif, dit après la pastille aux lecteurs d'écran. */
    abandonSpoken: (reason: string) => ` : ${reason}`,
    duplicateOf: (id: string) => `doublon de ${id}`,
    supersededBy: (id: string) => `remplacé par ${id}`,
  },
  palette: {
    title: 'Palette de commandes',
    description:
      'Cherchez un Projet, une Epic ou un ticket, ou lancez une commande. Flèches pour choisir, Entrée pour ouvrir.',
    /** Noms des régions de statut, qui n'ont pas de titre à l'écran. */
    searchState: 'État de la recherche',
    resultCountLabel: 'Nombre de résultats',
    /** Verbe du pied de la palette, selon la ligne sélectionnée. */
    verbs: {
      goTo: 'Aller à',
      switchProject: 'Changer de Projet',
      openEpic: 'Ouvrir l’Epic',
      openIssue: 'Ouvrir le ticket',
      widen: 'Élargir la recherche',
      retry: 'Réessayer',
      run: 'Exécuter',
      open: 'Ouvrir',
    },
    placeholder: 'Chercher un ticket, une Epic, un Projet ou une commande',
    placeholderProjects: 'Changer de Projet',
    loadingTickets: 'Chargement des tickets…',
    /** `projects` : la liste écrite par `projectList`. */
    ticketsUnavailable: (projects: string) => `Tickets indisponibles : ${projects}.`,
    noResults: (search: string) => `Aucun résultat pour « ${search} ».`,
    nothingYet: 'Rien à afficher pour le moment.',
    projectsFailed: 'Impossible de charger les Projets : le serveur ne répond pas.',
    widenHeading: 'Élargir',
    widen: (search: string) => `Chercher « ${search} » dans tous les Projets`,
    navigate: 'naviguer',
    close: 'fermer',
    /** Décompte que seuls les lecteurs d'écran lisent. `count` : le nombre écrit. */
    results: (count: string, n: number) => (n >= 2 ? `${count} résultats` : `${count} résultat`),
    /** Sous les tickets, au-delà de la limite d'affichage. */
    more: (count: string, n: number) =>
      n >= 2 ? `${count} autres correspondances : affinez la recherche.` : `${count} autre correspondance : affinez la recherche.`,
    headings: {
      switchProject: 'Changer de Projet',
      navigation: 'Navigation',
      projects: 'Projets',
      epics: 'Epics',
      issues: 'Tickets',
      recentIssues: 'Tickets récents',
      actions: 'Actions',
    },
    currentProject: 'Projet courant',
    active: 'Actif',
    allProjects: 'Tous les Projets',
    /** Mots qui trouvent la Vue globale, en plus de son nom. */
    overviewKeywords: ['accueil', 'tous les projets'],
    /** Mots qui trouvent l'aide des raccourcis, en plus de son nom. */
    shortcutsKeywords: ['aide', 'touches', 'clavier'],
  },
  pages: {
    /** Le nom du titre d'une page qui charge. */
    loadingTitle: 'Chargement…',
    comingSoon: 'À venir',
  },
  /** La Vue globale : son titre est aussi son nom partout (barre latérale, onglets, palette, fil d'Ariane). */
  overview: {
    title: 'Vue globale',
    description:
      'Les métriques de flux de tous les Projets suivis, recalculées sur l’ensemble de leurs tickets, puis la liste des Projets.',
    projects: 'Projets suivis',
    none: 'Aucun Projet trouvé',
    /** « Throughline scanne `~/Developer` à la recherche… » : le texte autour du dossier. */
    scanBefore: 'Throughline scanne ',
    scanAfter: ' à la recherche de Projets stockés en Dolt.',
    /** « Pour scanner d’autres dossiers, listez-les dans la clé `roots` de `config.json`, puis relancez la commande. » */
    configBefore: 'Pour scanner d’autres dossiers, listez-les dans la clé ',
    configBetween: ' de ',
    configAfter: ', puis relancez la commande.',
    loadFailed: 'Impossible de charger les Projets',
    loading: 'Chargement des Projets',
    ignored: (count: string, n: number) => (n >= 2 ? `${count} dossiers ignorés` : `${count} dossier ignoré`),
    modes: { embedded: 'Dolt embarqué', server: 'Dolt serveur' },
  },
  /** La page « À regarder » : son titre est le nom de son onglet (`sections.signals`). */
  signalsPage: {
    globalDescription:
      'Ce qui mérite d’être regardé maintenant, dans tous les Projets : Dérives, Blocages longs, Prêts qui stagnent, WIP inhabituel.',
    /** `project` : le Projet comme une phrase le nomme (`projectInSentence`). */
    projectDescription: (project: string) =>
      `Ce qui mérite d’être regardé maintenant dans ${project} : Dérives, Blocages longs, Prêts qui stagnent, WIP inhabituel.`,
    loadFailed: 'Impossible de lire les Signaux',
    loading: 'Chargement des Signaux',
    nothingTitle: 'Rien à regarder',
    nothing: 'Aucune Dérive, aucun Blocage long, aucun Prêt qui stagne ni aucun WIP inhabituel en ce moment.',
    /** Entre le Projet d'un WIP inhabituel et ce qu'il dit : « bdesk : 7 tickets en cours… ». */
    separator: ' : ',
  },
  notFound: {
    title: 'Page introuvable',
    notice: 'Cette adresse ne correspond à aucune page',
    back: 'Aller à la Vue globale',
    /** « Les pages d’un Projet sont de la forme `/p/identifiant/kanban`. » */
    hintBefore: 'Les pages d’un Projet sont de la forme ',
    hintPath: '/p/identifiant/kanban',
    hintAfter: '.',
  },
  routeError: {
    title: 'Une erreur a interrompu l’affichage de cette page',
    reload: 'Recharger la Vue globale',
  },
  projectGate: {
    unavailable: 'Projets indisponibles',
    loading: 'Chargement du Projet',
    notFound: 'Projet introuvable',
    unknown: (id: string) => `Aucun Projet n’a l’identifiant « ${id} »`,
    back: 'Voir les Projets suivis',
    unknownHint: 'Il a peut-être été masqué dans la configuration, ou son dossier a été déplacé.',
    unreadable: 'Ce Projet est illisible',
    unreadableDetail: 'Le serveur n’a pas pu lire sa base.',
  },
};

const en: typeof fr = {
  language: {
    group: 'Language',
    system: 'Browser language',
    keywords: ['language', 'langue', 'translation', 'english', 'french', 'français'],
  },
  common: {
    retry: 'Retry',
    close: 'Close',
    untitled: 'Untitled',
    loading: 'Loading…',
    unreadable: 'Unreadable',
    unreadableBecause: 'Unreadable: ',
  },
  sections: {
    kanban: 'Kanban',
    signals: 'Watch list',
    epics: 'Epics',
    metrics: 'Metrics',
  },
  layout: {
    skipToContent: 'Skip to content',
    main: 'Content',
    search: 'Search',
    primaryNavigation: 'Main navigation',
    tabs: 'Tabs',
    breadcrumb: 'Breadcrumb',
    switchProject: ', switch project',
    shortcuts: 'Keyboard shortcuts',
    showShortcuts: 'Show keyboard shortcuts',
    projects: 'Projects',
    noProjects: 'No projects found.',
    projectsUnavailable: 'Projects unavailable: the server is not responding.',
    loadingProjects: 'Loading projects',
  },
  theme: {
    group: 'Theme',
    system: 'System theme',
    light: 'Light theme',
    dark: 'Dark theme',
    keywords: ['appearance', 'mode', 'colors', 'light', 'dark', 'theme'],
  },
  shortcuts: {
    groups: { general: 'General', navigation: 'Navigation' },
    togglePalette: 'Open the command palette',
    showHelp: 'Show keyboard shortcuts',
    goToOverview: 'Go to the Overview',
    switchProject: 'Switch project',
    goTo: (place: string) => `Go to ${place}`,
    helpTitle: 'Keyboard shortcuts',
    helpDescription:
      'They are ignored while the cursor is in a text field. Enter and the arrow keys stay with the button, link or list that uses them.',
    list: 'Shortcut list',
    or: 'or',
    then: 'then',
  },
  keys: {
    escape: 'Esc',
    space: 'Space',
    tab: 'Tab',
    shift: 'Shift',
  },
  live: {
    lost: 'Live updates interrupted: reconnecting. What is shown may be out of date.',
    reconnect: 'Reconnect',
    refreshFailed: 'Refresh failed: the data shown may be out of date.',
  },
  loadErrors: {
    unreachable: 'The Throughline server is unreachable',
    unreachableDetail: 'Check that the throughline command is still running, then try again.',
    unreadableProject: 'Unreadable project',
    serverError: 'The server ran into an error',
    notFound: 'Resource not found',
    failed: 'Loading failed',
    http: (status: number) => `HTTP error ${status}`,
  },
  projectNames: {
    thisProject: 'this project',
    quoted: (name: string) => `“${name}”`,
    unnamedInList: (count: string, n: number) => (n === 1 ? 'an unnamed project' : `${count} unnamed projects`),
    unnamedLabel: 'An unnamed project',
  },
  signals: {
    kinds: {
      drift: 'Drift',
      longBlockage: 'Long blockage',
      stagnantReady: 'Stale ready',
      unusualWip: 'Unusual WIP',
    },
    scopes: { type: 'of deliveries of the same type', project: 'of the project’s deliveries' },
    drift: (cycleTime: string, reference: string, scope: string) =>
      `${cycleTime} of Cycle Time so far, above ${reference}, the P85 ${scope}`,
    longBlockage: (duration: string) => `blocked while in progress for ${duration}`,
    stagnantReady: (age: string) => `Ready for ${age}`,
    unusualWip: (wip: string, threshold: string, n: number) =>
      `${wip} ${n === 1 ? 'ticket' : 'tickets'} in progress, above ${threshold}, the P85 of daily WIP over the last 90 days`,
  },
  badges: {
    priority: (label: string) => `Priority: ${label}`,
    abandon: 'Dropped',
    abandonTitle: (reason: string) => `Dropped: ${reason}`,
    abandonSpoken: (reason: string) => `: ${reason}`,
    duplicateOf: (id: string) => `duplicate of ${id}`,
    supersededBy: (id: string) => `superseded by ${id}`,
  },
  palette: {
    title: 'Command palette',
    description: 'Search for a project, an epic or a ticket, or run a command. Arrow keys to choose, Enter to open.',
    searchState: 'Search status',
    resultCountLabel: 'Result count',
    verbs: {
      goTo: 'Go to',
      switchProject: 'Switch project',
      openEpic: 'Open epic',
      openIssue: 'Open ticket',
      widen: 'Widen the search',
      retry: 'Retry',
      run: 'Run',
      open: 'Open',
    },
    placeholder: 'Search for a ticket, an epic, a project or a command',
    placeholderProjects: 'Switch project',
    loadingTickets: 'Loading tickets…',
    ticketsUnavailable: (projects: string) => `Tickets unavailable: ${projects}.`,
    noResults: (search: string) => `No results for “${search}”.`,
    nothingYet: 'Nothing to show yet.',
    projectsFailed: 'Could not load projects: the server is not responding.',
    widenHeading: 'Widen',
    widen: (search: string) => `Search for “${search}” in all projects`,
    navigate: 'navigate',
    close: 'close',
    results: (count: string, n: number) => (n === 1 ? `${count} result` : `${count} results`),
    more: (count: string, n: number) =>
      n === 1 ? `${count} more match: refine your search.` : `${count} more matches: refine your search.`,
    headings: {
      switchProject: 'Switch project',
      navigation: 'Navigation',
      projects: 'Projects',
      epics: 'Epics',
      issues: 'Tickets',
      recentIssues: 'Recent tickets',
      actions: 'Actions',
    },
    currentProject: 'Current project',
    active: 'Active',
    allProjects: 'All projects',
    overviewKeywords: ['home', 'all projects'],
    shortcutsKeywords: ['help', 'keys', 'keyboard'],
  },
  pages: {
    loadingTitle: 'Loading…',
    comingSoon: 'Coming soon',
  },
  overview: {
    title: 'Overview',
    description: 'Flow metrics for all tracked projects, computed over all their tickets, then the list of projects.',
    projects: 'Tracked projects',
    none: 'No projects found',
    scanBefore: 'Throughline scans ',
    scanAfter: ' for projects stored in Dolt.',
    configBefore: 'To scan other folders, list them under the ',
    configBetween: ' key of ',
    configAfter: ', then run the command again.',
    loadFailed: 'Could not load projects',
    loading: 'Loading projects',
    ignored: (count: string, n: number) => (n === 1 ? `${count} ignored folder` : `${count} ignored folders`),
    modes: { embedded: 'Embedded Dolt', server: 'Dolt server' },
  },
  signalsPage: {
    globalDescription:
      'What deserves a look right now, across all projects: drifts, long blockages, stale ready tickets, unusual WIP.',
    projectDescription: (project: string) =>
      `What deserves a look right now in ${project}: drifts, long blockages, stale ready tickets, unusual WIP.`,
    loadFailed: 'Could not read signals',
    loading: 'Loading signals',
    nothingTitle: 'Nothing to watch',
    nothing: 'No drift, long blockage, stale ready ticket or unusual WIP right now.',
    separator: ': ',
  },
  notFound: {
    title: 'Page not found',
    notice: 'This address does not match any page',
    back: 'Go to the Overview',
    hintBefore: 'Project pages look like ',
    hintPath: '/p/identifier/kanban',
    hintAfter: '.',
  },
  routeError: {
    title: 'An error interrupted the display of this page',
    reload: 'Reload the Overview',
  },
  projectGate: {
    unavailable: 'Projects unavailable',
    loading: 'Loading project',
    notFound: 'Project not found',
    unknown: (id: string) => `No project has the identifier “${id}”`,
    back: 'See tracked projects',
    unknownHint: 'It may have been hidden in the configuration, or its folder may have moved.',
    unreadable: 'This project is unreadable',
    unreadableDetail: 'The server could not read its database.',
  },
};

export const shell: Zone<typeof fr> = { fr, en };
