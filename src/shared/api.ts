/**
 * Contrat de l'API HTTP (`src/server`), partagé avec l'interface.
 * Types seulement : aucun code d'exécution, importable des deux côtés.
 */

export type ProjectMode = 'embedded' | 'server';
export type ProjectStatus = 'ok' | 'unreadable';

export interface Project {
  /** Identifiant d'URL : slug du nom de dossier, unique entre Projets. */
  id: string;
  /** Nom du dossier du Projet. */
  name: string;
  /** Chemin absolu du dossier contenant `.beads/`. */
  path: string;
  /** Préfixe des tickets du Projet (`bdesk` pour `bdesk-38k.6`). */
  prefix: string;
  mode: ProjectMode;
  status: ProjectStatus;
  /** Présent quand le Projet est illisible. */
  reason?: string;
}

/** Dossier contenant `.beads/` mais qui n'est pas un Projet suivi (workspace non-Dolt, par exemple). */
export interface IgnoredFolder {
  path: string;
  reason: string;
}

/** `GET /api/projects` */
export interface ProjectsResponse {
  projects: Project[];
  ignored: IgnoredFolder[];
}

export interface Issue {
  id: string;
  title: string;
  /** bug, feature, task, chore, epic, decision, spike… (beads accepte des types personnalisés). */
  type: string;
  status: string;
  /** 0 (critique) à 4 (minimale). */
  priority: number;
  assignee: string | null;
  /** Ticket parent (lien parent-enfant), s'il existe. */
  parentId: string | null;
  /** Dates ISO 8601, en UTC. */
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  /** Cibles des dépendances `blocks` non fermées ; toujours vide pour un ticket fermé. */
  blockedBy: string[];
  /**
   * Présent sur un ticket fermé qui est un Abandon : le doublon d'un autre ticket, ou un ticket qu'un autre a remplacé.
   * Il est fermé sans être une Livraison. La règle est celle d'`analyzeFlow`, d'où viennent les métriques (`abandonOf`,
   * src/domain/abandon.ts : une seule fonction pour les deux) : un lien `duplicates` ou `supersedes` actif posé sur le
   * ticket lui-même, jamais le texte de sa raison de fermeture. Absent d'une Livraison, d'un ticket qui n'est pas fermé et
   * d'une Epic.
   */
  abandon?: IssueAbandon;
}

/** Pourquoi un ticket fermé est un Abandon : il double un autre ticket (`duplicate`), ou un autre le remplace (`superseded`). */
export type IssueAbandonCause = 'duplicate' | 'superseded';

export interface IssueAbandon {
  cause: IssueAbandonCause;
  /**
   * Le ticket dont celui-ci est le doublon, ou qui le remplace : la cible du lien d'Abandon, posé sur le ticket abandonné.
   * Un ticket du Projet, ou une référence qui n'en est pas un (ticket d'un autre Projet, supprimé) : il n'y a alors rien à ouvrir.
   * Quand un ticket porte plusieurs liens d'Abandon, c'est le premier posé qui compte (à instants égaux, la date de pose de la
   * ligne du lien, puis la plus petite cible) : la cause que les métriques lui donnent aussi.
   */
  of: string;
}

/** `GET /api/projects/:projectId/issues` */
export interface IssuesResponse {
  issues: Issue[];
}

export interface IssueDependency {
  to: string;
  type: string;
}

export interface IssueDependent {
  from: string;
  type: string;
}

export interface IssueComment {
  author: string;
  text: string;
  createdAt: string;
}

/** Un ticket du Projet vu depuis un autre : de quoi le nommer et l'ouvrir sans autre requête. */
export interface IssueRef {
  id: string;
  title: string;
  type: string;
  status: string;
  /** 0 (critique) à 4 (minimale). */
  priority: number;
}

/** L'Epic d'un ticket, de quoi la nommer et ouvrir sa page sans autre requête. */
export interface IssueEpic {
  id: string;
  title: string;
}

export interface IssueDetail extends Issue {
  /** Champs texte : chaîne vide quand ils ne sont pas renseignés. */
  description: string;
  design: string;
  acceptanceCriteria: string;
  notes: string;
  closeReason: string;
  labels: string[];
  /** Dépendances sortantes (ce ticket dépend de `to`), tous types confondus, `parent-child` compris. */
  dependencies: IssueDependency[];
  /** Dépendances entrantes (`from` dépend de ce ticket). */
  dependents: IssueDependent[];
  /**
   * Les tickets du Projet que celui-ci nomme (son parent, les cibles et les sources de ses dépendances), par
   * identifiant : de quoi écrire les relations avec le titre et le statut de chacun, dans la même réponse que la fiche
   * (pas de requête qui en dépende, donc pas de page qui se recompose après coup). Un identifiant absent est hors du
   * Projet (référence externe) : il n'y a rien à ouvrir.
   */
  linked: Record<string, IssueRef>;
  /**
   * L'Epic du ticket (`epicOf`, src/domain/epics.ts : la règle de la pastille des cartes du kanban) : son parent quand il est de type epic,
   * sinon l'Epic la plus proche parmi ses ancêtres, à tous les niveaux. `null` hors de toute Epic. Ce n'est jamais le ticket lui-même : celle
   * d'une Epic imbriquée est l'Epic qui la contient, et une Epic qui n'en a pas au-dessus d'elle n'en a pas. Tirée des tickets du Projet que la
   * fiche lit déjà, elle ne coûte aucune lecture de plus et vient avec la fiche : de quoi nommer l'Epic et ouvrir sa page sans autre requête.
   */
  epic: IssueEpic | null;
  comments: IssueComment[];
}

/** `GET /api/projects/:projectId/issues/:issueId` */
export interface IssueResponse {
  issue: IssueDetail;
}

/* -------------------------------------------------------------------------------------------------------------------
 * Chronologie d'un ticket : `GET /api/projects/:projectId/issues/:issueId/chronology`
 *
 * Les Transitions du ticket, lues dans l'historique Dolt du Projet (voir docs/adr/0001), avec les mêmes durées que les
 * métriques : celles de `analyzeFlow`, des Durées écoulées (ms), sur la même horloge que le Lead Time. Une requête à part
 * de la fiche : lire l'historique du Projet est plus long (jusqu'à quelques secondes à froid) que lire un ticket, et sa
 * panne (historique trop long, 503) ne doit pas priver de la fiche. Les instants sont des chaînes ISO 8601 en UTC.
 * ---------------------------------------------------------------------------------------------------------------- */

/**
 * Comment le ticket s'est terminé. `delivered` (Livraison), `abandoned` (Abandon : doublon ou remplacé) et `closed` (fermé
 * sans être une Livraison : une Epic, ou un ticket que l'historique ne documente pas) portent la date de la dernière clôture.
 */
export type IssueOutcome =
  | { kind: 'open' }
  | { kind: 'delivered'; at: string }
  | { kind: 'abandoned'; at: string; cause: 'duplicate' | 'superseded' }
  | { kind: 'closed'; at: string };

/** Une Transition : le ticket prend ce statut à cet instant et le garde jusqu'à la suivante. */
export interface IssueTransition {
  status: string;
  at: string;
  /**
   * Temps passé dans ce statut, jusqu'à la Transition suivante (ms). Nul pour la dernière : le ticket y est encore, ou y
   * reste fermé. C'est l'interface qui compte le temps écoulé depuis, avec son horloge.
   */
  duration: number | null;
}

/**
 * Où en est le ticket pendant une partie d'un Blocage, ce qui décide si elle compte dans le temps bloqué des métriques :
 *   `work`            en statut de travail (en cours, rattaché à un agent, bloqué) : la part du Cycle Time passée en Blocage,
 *                     celle que `IssueChronology.blockedTime` totalise ;
 *   `dependencyWait`  ticket ouvert, jamais démarré : l'Attente de dépendance, hors du Cycle Time ;
 *   `otherWait`       tout autre statut non fermé (revenu à ouvert après un démarrage, différé…) : hors du Cycle Time aussi.
 */
export type IssueBlockagePhaseKind = 'work' | 'dependencyWait' | 'otherWait';

/** Une partie d'un Blocage pendant laquelle le ticket est dans la même phase. */
export interface IssueBlockagePhase {
  kind: IssueBlockagePhaseKind;
  from: string;
  /** Nul quand la phase dure encore. */
  to: string | null;
}

/**
 * Une période de Blocage : le ticket, non fermé, dépend d'au moins un ticket non fermé (dépendance `blocks` active), ou
 * porte le statut bloqué. Les périodes qui se chevauchent n'en font qu'une. Un Blocage dure tant que le ticket attend, quel
 * que soit son statut : celui d'un ticket encore ouvert est listé aussi, mais le temps bloqué ne compte que la part passée
 * en travail (voir `phases`).
 */
export interface IssueBlockage {
  from: string;
  /** Nul quand le Blocage dure encore. */
  to: string | null;
  /** Les tickets non fermés dont il dépend pendant cette période, triés ; vide si seul le statut bloqué la cause. */
  blockedBy: string[];
  statusBlocked: boolean;
  /**
   * Les phases que le ticket traverse pendant ce Blocage, dans l'ordre, sans trou ni recouvrement : la première commence avec
   * le Blocage et la dernière finit avec lui. Pour un ticket fermé, la somme des phases `work` de tous ses Blocages vaut
   * `blockedTime`, et celle des phases `dependencyWait` l'Attente de dépendance des métriques.
   */
  phases: IssueBlockagePhase[];
}

export interface IssueChronology {
  /**
   * `history` : l'historique Dolt du Projet. `dates` : le ticket n'y figure pas (commité depuis qu'il a été lu, ou historique perdu) ; seules
   * ses dates de création et de clôture sont connues (repli de l'ADR 0001), sans Cycle Time ni Blocage.
   */
  source: 'history' | 'dates';
  /** Du premier statut (la création) au statut actuel. */
  transitions: IssueTransition[];
  blockages: IssueBlockage[];
  outcome: IssueOutcome;
  /** Création jusqu'à la dernière clôture (ms) ; nul tant que le ticket n'est pas fermé. */
  leadTime: number | null;
  /** Temps cumulé en statut de travail (ms) ; nul si le ticket n'est pas fermé ou n'a jamais été démarré. */
  cycleTime: number | null;
  /**
   * Part du Cycle Time passée en Blocage (ms) ; nul si le ticket n'est pas fermé. Elle ne compte que le Blocage pendant le
   * travail : les phases `work` des Blocages listés, pas leur durée entière (un ticket peut attendre avant d'être démarré).
   */
  blockedTime: number | null;
  /** Nombre de Réouvertures. */
  reopenings: number;
}

/** `GET /api/projects/:projectId/issues/:issueId/chronology` */
export interface IssueChronologyResponse {
  chronology: IssueChronology;
}

/** Corps des réponses d'erreur (même forme que celles de Fastify). */
export interface ApiErrorBody {
  statusCode: number;
  error: string;
  message: string;
  /** Présent sur les 503 : pourquoi le Projet est illisible. */
  reason?: string;
}

/* -------------------------------------------------------------------------------------------------------------------
 * Mises à jour en direct : `GET /api/projects/:projectId/events`
 *
 * Un flux d'événements serveur (SSE, `text/event-stream`) qui reste ouvert. Tant qu'il l'est, le serveur sonde le hash du
 * HEAD Dolt du Projet (toutes les 3 s par défaut, `pollIntervalMs` dans la configuration) : chaque nouveau HEAD, donc
 * chaque commit d'une écriture de bd, donne un événement `changed`. Plusieurs commits entre deux sondages n'en font qu'un.
 * Aucune donnée de ticket ne transite : l'interface relit ce qu'elle affiche. Le flux envoie aussi un commentaire
 * `: ping` toutes les 20 s pour rester ouvert. Un Projet inconnu est une 404 JSON, sans flux.
 * ---------------------------------------------------------------------------------------------------------------- */

/** Données de l'événement `changed`. */
export interface LiveChangeEvent {
  /** Identifiant du Projet. */
  project: string;
  /** Hash du nouveau HEAD Dolt. */
  head: string;
}

/* -------------------------------------------------------------------------------------------------------------------
 * Métriques de flux : `GET /api/metrics`
 *
 *   ?project=<id>   Projet à mesurer ; répétable, absent pour la Vue globale (tous les Projets lisibles)
 *   &range=7d|30d|90d        les N derniers jours, aujourd'hui compris (défaut : 30d)
 *   &from=YYYY-MM-DD&to=YYYY-MM-DD   ou une plage personnalisée, bornes incluses (jamais avec `range`)
 *
 * Les durées sont des nombres de millisecondes : des Durées écoulées, sauf l'âge d'un Prêt, qui est un Âge calendaire (voir
 * CONTEXT.md). Les instants sont des chaînes ISO 8601 en UTC ;
 * les jours (`YYYY-MM-DD`) sont ceux du fuseau local du serveur, qui est celui de l'utilisateur : c'est lui qui découpe
 * les périodes et les buckets. Une semaine commence le lundi. Une Livraison, un Abandon ou un échec appartient à la
 * période de sa date de Livraison, c'est-à-dire de sa dernière clôture. Les Epics ne sont mesurées nulle part : ce ne
 * sont pas des Livraisons, et elles resteraient ouvertes dans le WIP et le CFD.
 *
 * Une période qui court jusqu'à aujourd'hui n'est pas finie : tout ce qui s'y compte (Livraisons, Arrivées, buckets, nuage
 * de points, découpages, tendances) l'est de son début à `asOf` (maintenant), fin exclue, et non jusqu'à minuit. Un
 * événement daté à `asOf` ou après (création, démarrage ou Livraison d'un ticket, l'horloge d'un commit en avance sur
 * celle du serveur) n'est pas encore arrivé : il n'est compté nulle part, et son équivalent n'est pas compté non plus
 * dans la période précédente ; le WIP, les âges et le CFD voient le ticket tel qu'il est à `asOf`. Une période finie est
 * comptée en entier (`asOf` est sa fin).
 *
 * Pas de niveaux DORA : chaque valeur se compare à celle de la période précédente à durée écoulée égale (`MetricsTrend`).
 * La Vue globale recalcule tout sur l'union des tickets des Projets : jamais une moyenne de médianes.
 * ---------------------------------------------------------------------------------------------------------------- */

/** Préréglages de période : les N derniers jours. */
export type MetricsRangePreset = '7d' | '30d' | '90d';

/** `custom` quand la période est donnée par `from` et `to`. */
export type MetricsRange = MetricsRangePreset | 'custom';

/** Plage de jours calendaires du fuseau local du serveur. */
export interface MetricsDateRange {
  /** Premier jour, inclus. */
  from: string;
  /** Dernier jour, inclus. */
  to: string;
  days: number;
  /** Minuit local de `from`. */
  start: string;
  /** Minuit local qui suit `to` (exclu) : la fin d'un jour de 23 ou 25 h est bien celle du jour. */
  end: string;
}

/** Regroupement des buckets : par jour jusqu'à 31 jours, par semaine au-delà. */
export type MetricsBucketUnit = 'day' | 'week';

/** Évolution d'une valeur par rapport à la période précédente, à durée écoulée égale (voir `MetricsReport.previousAsOf`). */
export interface MetricsTrend {
  /** Valeur de la période précédente, jusqu'à `previousAsOf` ; null quand elle n'est pas définie (aucune Livraison, par exemple). */
  previous: number | null;
  /** Valeur courante moins `previous` ; null si l'une des deux n'est pas définie. */
  delta: number | null;
  /** `delta / previous` ; null si `delta` l'est ou si `previous` vaut 0. */
  ratio: number | null;
}

/** Une valeur comptée (Débit, Arrivées) et sa tendance. */
export interface MetricsCountTile {
  total: number;
  trend: MetricsTrend;
}

/**
 * Médiane et P85 d'une durée (ms), par interpolation linéaire entre les deux valeurs voisines (méthode 7 : celle d'Excel
 * PERCENTILE.INC et du numpy par défaut). La médiane d'un `n` pair est la moyenne des deux valeurs centrales ; le P85
 * n'est pas forcément une durée observée. Les valeurs peuvent donc avoir une partie décimale.
 */
export interface MetricsDurationStats {
  /** null sans échantillon. */
  median: number | null;
  /** null sans échantillon. */
  p85: number | null;
  /** Taille de l'échantillon : Livraisons mesurées. */
  n: number;
}

/** Une durée (Lead Time, Cycle Time, Temps de rétablissement) et ses tendances. */
export interface MetricsDurationTile extends MetricsDurationStats {
  trend: { median: MetricsTrend; p85: MetricsTrend };
}

/** Part des bugs dont l'origine est renseignée (Couverture), toutes dates confondues. */
export interface MetricsCoverage {
  /** Bugs hors Abandon. */
  bugs: number;
  /** Parmi eux, ceux reliés à un ticket du Projet hors Epic. */
  linked: number;
  /** `linked / bugs`, de 0 à 1 ; null sans bug. */
  ratio: number | null;
}

/** Pourquoi le Taux d'échec n'est pas significatif. */
export type MetricsFailureRateReason = 'low-coverage' | 'few-bugs';

export interface MetricsFailureRateTile {
  /** Livraisons de la période. */
  deliveries: number;
  /** Parmi elles, celles qui ont au moins un Bug d'origine. */
  failed: number;
  /** `failed / deliveries`, de 0 à 1 ; null sans Livraison. */
  rate: number | null;
  coverage: MetricsCoverage;
  /** Faux si la Couverture est sous `thresholds.minCoverage` ou s'il y a moins de `thresholds.minBugs` bugs. */
  significant: boolean;
  /** Vide quand le taux est significatif. */
  reasons: MetricsFailureRateReason[];
  /** Le motif, en français, prêt à afficher ; null quand le taux est significatif. */
  reason: string | null;
  thresholds: { minCoverage: number; minBugs: number };
  /** Tendance du taux ; la différence est en points de proportion (0,05 = 5 points). */
  trend: MetricsTrend;
}

export interface MetricsWipTile {
  /** Tickets en statut de travail (en cours, rattaché à un agent, bloqué) à `asOf` : maintenant si la période court jusqu'à aujourd'hui. */
  current: number;
  /** Moyenne du WIP de `period.start` à `asOf`, pondérée par le temps. */
  average: number;
  /** Tendance de la moyenne. */
  trend: MetricsTrend;
}

export interface MetricsTiles {
  /** Débit : Livraisons de la période. */
  throughput: MetricsCountTile;
  /** Lead Time des Livraisons de la période. */
  leadTime: MetricsDurationTile;
  /** Cycle Time des Livraisons de la période ; les tickets jamais démarrés n'y sont pas. */
  cycleTime: MetricsDurationTile;
  failureRate: MetricsFailureRateTile;
  /** Temps de rétablissement : Lead Time des bugs P0 et P1 livrés pendant la période. */
  recoveryTime: MetricsDurationTile;
  wip: MetricsWipTile;
  /** Arrivées : tickets créés pendant la période. */
  arrivals: MetricsCountTile;
}

/**
 * Un bucket de l'histogramme du Débit, avec les Arrivées. Les buckets couvrent la période sans trou. Le dernier, quand la
 * période court jusqu'à aujourd'hui, n'est compté que jusqu'à `asOf` : la somme des Livraisons (et des Arrivées) des
 * buckets est celle des tuiles.
 */
export interface MetricsBucket {
  /** Premier jour, inclus. Un bucket hebdomadaire au bord de la période a moins de 7 jours. */
  from: string;
  /** Dernier jour, inclus. */
  to: string;
  /**
   * Nombre de jours couverts : 1 pour un bucket quotidien, 7 pour une semaine pleine, moins pour une semaine tronquée
   * aux bords de la période (son début précède la période, ou sa fin la suit). L'interface divise par `days` pour
   * comparer ces semaines aux autres. La somme des `days` des buckets est `period.days`.
   */
  days: number;
  deliveries: number;
  arrivals: number;
}

/** Un point du nuage de points du Cycle Time : une Livraison de la période. */
export interface MetricsCycleTimePoint {
  id: string;
  title: string;
  type: string;
  /** 0 (critique) à 4 (minimale). */
  priority: number;
  /** Identifiant du Projet. */
  project: string;
  /** Date de la Livraison : sa dernière clôture. */
  deliveredAt: string;
  cycleTime: number;
}

/**
 * Nombre de tickets par colonne du kanban à la fin d'un jour (ou à `asOf` pour le jour en cours).
 * Backlog : ouvert en Blocage ; Prêt : ouvert hors Blocage ; En cours : statut de travail hors Blocage ;
 * Bloqué : statut de travail en Blocage, ou statut bloqué ; Terminé : fermé (Abandons compris, Epics exclues).
 * Les tickets différés, épinglés ou d'un statut inconnu (« En pause ») ne sont dans aucune colonne.
 */
export interface MetricsCfdPoint {
  date: string;
  backlog: number;
  ready: number;
  inProgress: number;
  blocked: number;
  done: number;
}

/** Un ticket en cours à `asOf`, pour le graphique des âges. */
export interface MetricsInProgressTicket {
  id: string;
  title: string;
  type: string;
  priority: number;
  /** Identifiant du Projet. */
  project: string;
  /** in_progress, hooked ou blocked. */
  status: string;
  /** Dans la colonne Bloqué du kanban. */
  blocked: boolean;
  /** Premier passage en statut de travail. */
  startedAt: string;
  /** `asOf` moins `startedAt`. */
  age: number;
}

/**
 * Les métriques d'un sous-ensemble de tickets (un type, une priorité, un Projet), sur la période courante, comptée comme
 * les tuiles : de `period.start` à `asOf`.
 */
export interface MetricsSlice {
  /** Le type, la priorité (`0` à `4`) ou l'identifiant du Projet. */
  key: string;
  /** Le type, `P<priorité>` ou le nom du Projet. */
  label: string;
  throughput: number;
  arrivals: number;
  leadTime: MetricsDurationStats;
  cycleTime: MetricsDurationStats;
  /** Livraisons ayant au moins un Bug d'origine. */
  failedDeliveries: number;
  /** `failedDeliveries / throughput` ; null sans Livraison. */
  failureRate: number | null;
  /**
   * La Couverture sur laquelle repose `failureRate`, toutes dates confondues comme `tiles.failureRate.coverage` : celle
   * des bugs du Projet pour un découpage par Projet ; celle des bugs de tous les Projets mesurés pour un découpage par
   * type ou par priorité (le bug qui met une Livraison en échec n'a ni son type ni sa priorité).
   */
  coverage: MetricsCoverage;
  /**
   * `failureRate` est-il significatif ? Même règle que `tiles.failureRate.significant` : faux si `coverage` est sous
   * `tiles.failureRate.thresholds.minCoverage` ou compte moins de `thresholds.minBugs` bugs. À afficher comme tel.
   */
  significant: boolean;
  /** WIP à `asOf`. */
  wip: number;
}

/**
 * Découpages. Par type et par priorité, seuls figurent les groupes qui ont une Livraison, une Arrivée ou du WIP
 * (types par Débit décroissant, priorités de P0 à P4). Par Projet, tous les Projets mesurés, dans l'ordre de `projects`.
 */
export interface MetricsSlices {
  type: MetricsSlice[];
  priority: MetricsSlice[];
  project: MetricsSlice[];
}

/* -------------------------------------------------------------------------------------------------------------------
 * Santé du flux (bdesk-38k.13) : `MetricsResponse.health`
 *
 * Les métriques de flux additionnelles, calculées avec les mêmes règles que les précédentes : sur la période courante
 * de `period.start` à `asOf`, comparée à la précédente de `previousPeriod.start` à `previousAsOf` (même durée écoulée),
 * en Durée écoulée (CONTEXT.md), Epics exclues, sur l'union des tickets des Projets mesurés. Sept métriques, dont deux déjà servies
 * par l'API : « Arrivées vs Débit » (`tiles.arrivals`, `tiles.throughput` et les `buckets`) et « Répartition par type »
 * (`slices.type`). Les cinq autres sont ici, avec la décomposition du Lead Time qui porte l'Attente de dépendance :
 *
 *   efficiency          Efficacité du flux : part du Cycle Time des Livraisons passée hors Blocage
 *   reopening           Taux de Réouverture : part des clôtures suivies d'une Réouverture
 *   abandonment         Taux d'abandon : part des Abandons parmi les tickets fermés
 *   leadTimeBreakdown   Décomposition du Lead Time : Attente de dépendance, Attente en Prêt, travail, Blocage, autre attente
 *   readyAges           âge des Prêts (en jours calendaires du fuseau), et ceux qui stagnent
 *   activity            Carte d'activité : Transitions par jour de la semaine et heure
 *
 * Comme le Taux d'échec, un résultat appartient à la période de sa date : une Livraison, un Abandon ou une clôture à celle
 * de son instant ; un Prêt, à l'état du ticket à `asOf`. Une Réouverture est rattachée à la clôture qu'elle suit, donc à la
 * période de cette clôture, même si elle a lieu plus tard (comme un Bug d'origine, trouvé après la Livraison).
 * ---------------------------------------------------------------------------------------------------------------- */

/** Efficacité du flux : la part du Cycle Time des Livraisons de la période passée hors Blocage. */
export interface MetricsFlowEfficiency {
  /** Livraisons mesurées : celles de la période qui ont été démarrées au moins une fois (comme le Cycle Time). */
  n: number;
  /** Cycle Time cumulé de ces Livraisons (ms). */
  cycleTime: number;
  /** Part de ce Cycle Time passée en Blocage (ms), au plus `cycleTime`. */
  blockedTime: number;
  /** `(cycleTime − blockedTime) / cycleTime`, de 0 à 1 ; null sans Cycle Time cumulé. */
  ratio: number | null;
  /** Parmi les `n` Livraisons, celles dont le Cycle Time compte du Blocage. */
  blockedDeliveries: number;
  /** Tendance du `ratio` ; la différence est en points de proportion (0,05 = 5 points). */
  trend: MetricsTrend;
}

/** Taux de Réouverture : la part des clôtures de la période que suit une Réouverture. */
export interface MetricsReopening {
  /** Clôtures de la période : les Transitions vers fermé, datées de leur instant. */
  closures: number;
  /** Parmi elles, celles qu'une Réouverture suit, même après la période (la dernière clôture d'un ticket fermé n'en a jamais). */
  reopened: number;
  /** `reopened / closures`, de 0 à 1 ; null sans clôture. */
  rate: number | null;
  /** Tendance du `rate` ; la différence est en points de proportion. */
  trend: MetricsTrend;
}

/** Taux d'abandon : la part des Abandons parmi les tickets fermés de la période. */
export interface MetricsAbandonment {
  /** Tickets fermés de la période : Livraisons et Abandons, datés de leur dernière clôture. */
  closed: number;
  /** Parmi eux, les Abandons : `duplicates` + `superseded`. */
  abandoned: number;
  /** Abandons dont la cause est un doublon (lien `duplicates`). */
  duplicates: number;
  /** Abandons dont la cause est un remplacement (lien `supersedes`). */
  superseded: number;
  /** `abandoned / closed`, de 0 à 1 ; null sans ticket fermé. */
  rate: number | null;
  /** Tendance du `rate` ; la différence est en points de proportion. */
  trend: MetricsTrend;
}

/**
 * Décomposition du Lead Time des Livraisons de la période. Les cinq parts s'additionnent : `total` est la somme des
 * Lead Times (celui de la tuile en est la médiane), et chaque part est la somme de celles des Livraisons, en ms.
 */
export interface MetricsLeadTimeBreakdown {
  /** Livraisons de la période. */
  deliveries: number;
  /** Lead Time cumulé de ces Livraisons ; vaut `dependencyWait + readyWait + work + blocked + otherWait`. */
  total: number;
  /** Attente de dépendance : le temps en Backlog avant le premier démarrage. */
  dependencyWait: number;
  /** Attente en Prêt : le temps passé dans la colonne Prêt (ouvert, sans dépendance bloquante en suspens), avant ou après un démarrage. */
  readyWait: number;
  /** Travail : le Cycle Time hors Blocage. */
  work: number;
  /** Blocage dans le Cycle Time (statut bloqué, ou dépendance non fermée pendant le travail). */
  blocked: number;
  /** Autre attente : le reste, c'est-à-dire un ticket en Backlog après un premier démarrage, différé, ou fermé avant une Réouverture. */
  otherWait: number;
  /** Livraisons qui ont attendu une dépendance avant leur premier démarrage. */
  waited: number;
  /** Médiane et P85 de l'Attente de dépendance de ces Livraisons seulement (`n` vaut `waited`). */
  waits: MetricsDurationStats;
}

/** Un ticket Prêt à `asOf` : ouvert, et sans dépendance bloquante en suspens. */
export interface MetricsReadyTicket {
  id: string;
  title: string;
  type: string;
  /** 0 (critique) à 4 (minimale). */
  priority: number;
  /** Identifiant du Projet. */
  project: string;
  /** L'instant où le ticket est devenu Prêt : sa création, la fin de son Blocage, son retour à ouvert ou sa Réouverture. */
  since: string;
  /**
   * L'Âge calendaire (CONTEXT.md) entre `since` et `asOf` (ms) : l'écart de leurs heures du mur dans le fuseau de la réponse, un jour
   * de 23 h ou de 25 h (changement d'heure) comptant pour 24 h. Hors changement d'heure, c'est `asOf` moins `since`.
   */
  age: number;
  /** Prêt depuis plus longtemps que `readyAges.stagnantAfter` : `age` > `stagnantAfter`, strictement. */
  stagnant: boolean;
}

/** Âge des Prêts à `asOf`, et ceux qui stagnent. */
export interface MetricsReadyAges {
  /** Un Prêt stagne au-delà de cet âge : 14 jours calendaires (ms), comptés comme `age`. */
  stagnantAfter: number;
  /** Les Prêts à `asOf`, du plus ancien au plus récent. */
  tickets: MetricsReadyTicket[];
  /** Combien d'entre eux stagnent. */
  stagnant: number;
  /** Tendance du nombre de Prêts qui stagnent : à `asOf` contre à `previousAsOf`. */
  trend: MetricsTrend;
}

/**
 * Carte d'activité : les Transitions de la période (la création d'un ticket n'en est pas une), rangées par jour de la semaine
 * et par heure du jour dans le fuseau `timeZone` de la réponse.
 */
export interface MetricsActivity {
  /** `cells[jour][heure]` : 7 jours, du lundi (0) au dimanche (6), de 24 heures chacun (0 pour 00:00–00:59). */
  cells: number[][];
  /** Somme des `cells`. */
  total: number;
}

export interface MetricsHealth {
  efficiency: MetricsFlowEfficiency;
  reopening: MetricsReopening;
  abandonment: MetricsAbandonment;
  leadTimeBreakdown: MetricsLeadTimeBreakdown;
  readyAges: MetricsReadyAges;
  activity: MetricsActivity;
}

/** Ce que le domaine calcule : tout ce qu'affiche la page Métriques, hors Projets. */
export interface MetricsReport {
  range: MetricsRange;
  /** Les jours de la période. Quand elle court jusqu'à aujourd'hui, elle n'est comptée que jusqu'à `asOf`, non jusqu'à `period.end`. */
  period: MetricsDateRange;
  /** La période qui précède immédiatement `period`, de même durée. Les tendances ne la comptent que jusqu'à `previousAsOf`. */
  previousPeriod: MetricsDateRange;
  bucket: MetricsBucketUnit;
  /**
   * Instant où la période est mesurée : maintenant tant qu'elle court jusqu'à aujourd'hui, sinon sa fin (`period.end`).
   * Tout ce qui se compte dans `period` l'est de `period.start` à `asOf`, fin exclue : un événement (création, démarrage
   * ou Livraison d'un ticket) daté à `asOf` ou après n'est pas encore arrivé (voir l'en-tête). C'est aussi l'instant du
   * WIP actuel, du dernier point du CFD et des âges.
   */
  asOf: string;
  /**
   * L'instant de `previousPeriod` qui correspond à `asOf` : `previousPeriod.start` plus la durée écoulée de `period`
   * (`asOf` moins `period.start`), sans dépasser `previousPeriod.end`. Toutes les tendances comparent
   * [`period.start`, `asOf`) à [`previousPeriod.start`, `previousAsOf`), deux fenêtres de même durée aux bornes
   * symétriques (début compris, fin exclue), pour que la période en cours, pas finie, ne soit pas mise en face d'une
   * précédente entière, ni qu'un événement daté après maintenant n'ait pas d'équivalent dans la précédente : Débit,
   * Arrivées, Taux d'échec, durées et WIP moyen. Égal à `previousPeriod.end` quand la période est terminée (plage
   * personnalisée dont `to` est passé), où `asOf` est `period.end`.
   */
  previousAsOf: string;
  tiles: MetricsTiles;
  /** Histogramme du Débit avec les Arrivées. */
  buckets: MetricsBucket[];
  /** Nuage de points du Cycle Time, par date de Livraison croissante. */
  cycleTimeScatter: MetricsCycleTimePoint[];
  /** Un point par jour de la période. */
  cfd: MetricsCfdPoint[];
  /** Tickets en cours à `asOf`, du plus ancien au plus récent. */
  inProgress: MetricsInProgressTicket[];
  slices: MetricsSlices;
}

export interface MetricsProject {
  id: string;
  name: string;
}

/** Un Projet demandé (ou suivi) dont la base n'a pas pu être lue : il n'entre pas dans les chiffres. */
export interface MetricsUnreadableProject extends MetricsProject {
  reason: string;
}

/** `GET /api/metrics` */
export interface MetricsResponse extends MetricsReport {
  generatedAt: string;
  /** Fuseau IANA du serveur, celui des jours et des buckets. */
  timeZone: string;
  /** Les Projets mesurés, dans l'ordre de `GET /api/projects`. */
  projects: MetricsProject[];
  /** Les Projets lisibles en moins : ils sont listés ici sans faire échouer le reste. */
  unreadable: MetricsUnreadableProject[];
  /** Santé du flux (bdesk-38k.13) : calculée par `computeHealth`, à côté de `computeMetrics`, sur la même période. */
  health: MetricsHealth;
}
