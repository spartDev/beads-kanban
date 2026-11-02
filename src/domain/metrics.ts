import type {
  MetricsBucket,
  MetricsCfdPoint,
  MetricsCountTile,
  MetricsCoverage,
  MetricsCycleTimePoint,
  MetricsDateRange,
  MetricsDurationStats,
  MetricsDurationTile,
  MetricsFailureRateReason,
  MetricsFailureRateTile,
  MetricsInProgressTicket,
  MetricsReport,
  MetricsSlice,
  MetricsSlices,
  MetricsTrend,
  MetricsWipTile,
} from '../shared/api';
import { addDays, type BucketSpan, bucketsOf, daysOf, type Period, type PeriodSpec, resolvePeriod, startOfDay } from './calendar';
import { analyzeFailures } from './failures';
import { analyzeFlow, isWork, type TicketHistory } from './flow';
import { buildTimeline, type Column, COLUMNS, columnAt, isWorking, statusAt, stepsOf, type TicketTimeline } from './timeline';

/**
 * Métriques de flux, DORA transposées : Débit, Lead Time, Cycle Time, Taux d'échec, Temps de rétablissement, WIP,
 * Arrivées. Du code pur : l'historique des tickets entre, un rapport sérialisable sort (durées en ms, dates ISO).
 *
 * Deux temps. `analyzeProject` fait le travail lourd, indépendant de la période et de l'heure qu'il est : un Projet par
 * ses historiques, à refaire seulement quand l'historique change. `computeMetrics` agrège ces analyses sur une période,
 * à l'instant demandé : un seul calcul sur l'union des tickets des Projets, jamais une moyenne de leurs médianes.
 *
 * Les Epics ne sont mesurées nulle part : ce ne sont pas des Livraisons, et elles resteraient ouvertes dans le WIP et
 * le CFD. Une Livraison, un Abandon ou un échec appartient à la période de sa date de Livraison (dernière clôture).
 * Une période en cours n'est comptée que jusqu'à `asOf` (maintenant), comme la précédente jusqu'à `previousAsOf`.
 */

/** Un ticket tel que les métriques le lisent : son historique, plus ce que l'historique ne dit pas. */
export interface MetricsTicket extends TicketHistory {
  title: string;
  /** Priorité courante, de 0 (critique) à 4 (minimale). */
  priority: number;
}

/** Un ticket mesuré (hors Epic, avec un historique) et tout ce qu'il faut pour l'agréger. Dates en ms epoch. */
export interface TrackedTicket {
  id: string;
  title: string;
  type: string;
  priority: number;
  /** Premier statut de l'historique : la création, sur la même horloge que le Lead Time. */
  createdAt: number;
  /** Date de la Livraison (dernière clôture) ; null si le ticket n'en est pas une. */
  deliveredAt: number | null;
  /** Lead Time, pour une Livraison seulement. */
  leadTime: number | null;
  /** Cycle Time, pour une Livraison démarrée au moins une fois. */
  cycleTime: number | null;
  /** Livraison ayant au moins un Bug d'origine. */
  failed: boolean;
  /** Premier passage en statut de travail. */
  startedAt: number | null;
  timeline: TicketTimeline;
}

/** Ce que l'historique d'un Projet donne, une fois pour toutes : indépendant de la période et de l'heure. */
export interface ProjectAnalysis {
  tickets: TrackedTicket[];
  /** Les bugs hors Abandon, et ceux dont l'origine est renseignée (Couverture), toutes dates confondues. */
  coverage: { bugs: number; linked: number };
}

export interface MetricsInput {
  id: string;
  name: string;
  analysis: ProjectAnalysis;
}

export interface MetricsOptions {
  period: PeriodSpec;
  now: Date;
  /** Fuseau IANA qui découpe les jours : celui de l'utilisateur. */
  timeZone: string;
}

/** Le Taux d'échec n'est pas significatif sous cette Couverture : trop peu de bugs ont une origine renseignée. */
export const MIN_FAILURE_COVERAGE = 0.5;
/** ... ni avec moins de bugs que cela : un taux sur quelques bugs ne dit rien. */
export const MIN_FAILURE_BUGS = 5;
/** Un bug est critique de P0 à P1 : c'est le Lead Time de ceux-là, une fois livrés, qui donne le Temps de rétablissement. */
export const CRITICAL_PRIORITY_MAX = 1;
const CRITICAL_TYPE = 'bug';

/**
 * Percentile par interpolation linéaire (méthode 7 de Hyndman et Fan : celle d'Excel PERCENTILE.INC et du numpy par
 * défaut). Le rang, de 1 à n, est 1 + p·(n − 1) ; quand il tombe entre deux valeurs de l'échantillon trié, le résultat
 * est interpolé entre elles. La médiane d'un échantillon pair est donc la moyenne de ses deux valeurs centrales, et le
 * P85 n'est pas forcément une valeur observée. `percent` va de 0 à 100 ; pour un entier, le calcul est exact (une seule
 * division, d'entiers) : pas de rang à 17,000…1 près. `sorted` est trié par ordre croissant. Indéfini (null) sans échantillon.
 */
export function percentile(sorted: readonly number[], percent: number): number | null {
  const last = sorted.length - 1;
  if (last < 0) return null;
  const position = last * Math.min(100, Math.max(0, percent)); // en centièmes de rang, à partir de la plus petite valeur
  const weight = position % 100; // la part du chemin, en %, de la valeur d'en dessous à celle d'au-dessus
  const below = (position - weight) / 100;
  const low = sorted[below] as number;
  const high = sorted[below + 1] ?? low;
  return weight === 0 ? low : (low * (100 - weight) + high * weight) / 100;
}

/** Médiane et P85 d'un échantillon de durées (ms), avec sa taille ; null sans échantillon. */
export function durationStats(values: readonly number[]): MetricsDurationStats {
  const sorted = [...values].sort((a, b) => a - b);
  return { median: percentile(sorted, 50), p85: percentile(sorted, 85), n: sorted.length };
}

/** Analyse les tickets d'un Projet : Transitions, Livraisons, Bugs d'origine, Blocage dans le temps. */
export function analyzeProject(tickets: MetricsTicket[]): ProjectAnalysis {
  const flows = analyzeFlow(tickets);
  const failures = analyzeFailures(tickets, flows);
  const stepsById = new Map([...flows].map(([id, flow]) => [id, stepsOf(flow.transitions)]));

  const tracked = tickets.flatMap((ticket): TrackedTicket[] => {
    const flow = flows.get(ticket.id);
    const steps = stepsById.get(ticket.id) ?? [];
    const created = steps[0];
    if (!flow || !created || ticket.type === 'epic') return [];
    const deliveredAt = flow.outcome.kind === 'delivered' ? flow.outcome.at.getTime() : null;
    return [
      {
        id: ticket.id,
        title: ticket.title,
        type: ticket.type,
        priority: ticket.priority,
        createdAt: created.at,
        deliveredAt,
        leadTime: deliveredAt === null ? null : flow.leadTime,
        cycleTime: deliveredAt === null ? null : flow.cycleTime,
        failed: (failures.originBugs.get(ticket.id)?.length ?? 0) > 0,
        startedAt: steps.find((step) => isWork(step.status))?.at ?? null,
        timeline: buildTimeline(ticket, steps, stepsById),
      },
    ];
  });

  return { tickets: tracked, coverage: { bugs: failures.coverage.bugs, linked: failures.coverage.linked } };
}

/** Un ticket mesuré, avec le Projet qui le porte. */
interface Entry {
  project: MetricsInput;
  ticket: TrackedTicket;
}

/**
 * Agrège les analyses des Projets sur la période demandée, évaluée à l'instant `now`.
 *
 * Une période qui court jusqu'à aujourd'hui n'est pas finie. Elle est comptée de son début à `asOf` (maintenant), et
 * comparée à la période précédente sur la même durée écoulée, de son début à `previousAsOf` : deux fenêtres de même
 * durée, aux bornes symétriques (début compris, fin exclue). Ce qui est daté à `asOf` ou après, jusqu'à minuit (l'horloge
 * d'un commit en avance), n'est pas encore arrivé : ni Livraison, ni Arrivée, ni bucket, ni point du nuage, ni
 * découpage ne le comptent, et son équivalent de la précédente ne l'est pas non plus. Une période finie est comptée
 * en entier, et comparée à la précédente entière : `asOf` est sa fin.
 */
export function computeMetrics(projects: MetricsInput[], { period: spec, now, timeZone }: MetricsOptions): MetricsReport {
  const resolved = resolvePeriod(spec, now.getTime(), timeZone);
  const { current, asOf, previousAsOf } = resolved;
  // Les deux fenêtres où l'on compte. Toute mesure de la période courante passe par `elapsed`, jamais par `current.end`.
  const elapsed: Span = { start: current.start, end: asOf };
  const compared: Span = { start: resolved.previous.start, end: previousAsOf };
  const entries: Entry[] = projects.flatMap((project) => project.analysis.tickets.map((ticket) => ({ project, ticket })));

  const delivered = deliveriesIn(entries, elapsed);
  const deliveredBefore = deliveriesIn(entries, compared);
  const arrived = arrivalsIn(entries, elapsed);
  const arrivedBefore = arrivalsIn(entries, compared);

  return {
    range: resolved.range,
    period: toDateRange(current),
    previousPeriod: toDateRange(resolved.previous),
    bucket: resolved.unit,
    asOf: iso(asOf),
    previousAsOf: iso(previousAsOf),
    tiles: {
      throughput: countTile(delivered.length, deliveredBefore.length),
      leadTime: durationTile(leadTimesOf(delivered), leadTimesOf(deliveredBefore)),
      cycleTime: durationTile(cycleTimesOf(delivered), cycleTimesOf(deliveredBefore)),
      failureRate: failureRateTile(delivered, deliveredBefore, coverageOf(projects)),
      recoveryTime: durationTile(recoveryTimesOf(delivered), recoveryTimesOf(deliveredBefore)),
      wip: wipTile(entries, elapsed, compared),
      arrivals: countTile(arrived.length, arrivedBefore.length),
    },
    buckets: throughputBuckets(bucketsOf(current, resolved.unit, timeZone), delivered, arrived),
    cycleTimeScatter: cycleTimeScatter(delivered),
    cfd: cumulativeFlow(entries, current, timeZone, asOf),
    inProgress: inProgress(entries, asOf),
    slices: slicesOf(entries, projects, elapsed),
  };
}

/* --- Les échantillons : ce que chaque métrique mesure ------------------------------------------------------------- */

/**
 * Une fenêtre de temps (ms epoch) : son premier instant compris, le premier instant qui suit exclu. Les métriques en
 * comptent deux, de même durée : la période courante de son début à `asOf`, la précédente de son début à `previousAsOf`.
 */
type Span = Pick<Period, 'start' | 'end'>;

/** Les Livraisons de la fenêtre : datées de leur dernière clôture. */
const deliveriesIn = (entries: Entry[], span: Span) => entries.filter(({ ticket }) => within(ticket.deliveredAt, span));

/** Les Arrivées de la fenêtre : les tickets créés. */
const arrivalsIn = (entries: Entry[], span: Span) => entries.filter(({ ticket }) => within(ticket.createdAt, span));

/** Lead Time de chaque Livraison. */
const leadTimesOf = (deliveries: Entry[]) => deliveries.flatMap(({ ticket }) => numbers(ticket.leadTime));

/** Cycle Time de chaque Livraison démarrée. */
const cycleTimesOf = (deliveries: Entry[]) => deliveries.flatMap(({ ticket }) => numbers(ticket.cycleTime));

/** Temps de rétablissement : Lead Time des bugs P0 et P1 livrés. */
const recoveryTimesOf = (deliveries: Entry[]) =>
  leadTimesOf(deliveries.filter(({ ticket }) => ticket.type === CRITICAL_TYPE && ticket.priority <= CRITICAL_PRIORITY_MAX));

/** L'instant est dans la fenêtre : son premier instant compris, le premier instant qui suit exclu. */
function within(instant: number | null, span: Span): boolean {
  return instant !== null && instant >= span.start && instant < span.end;
}

const numbers = (value: number | null): number[] => (value === null ? [] : [value]);

/* --- Les tuiles --------------------------------------------------------------------------------------------------- */

function countTile(current: number, previous: number): MetricsCountTile {
  return { total: current, trend: trend(current, previous) };
}

function durationTile(current: readonly number[], previous: readonly number[]): MetricsDurationTile {
  const now = durationStats(current);
  const before = durationStats(previous);
  return { ...now, trend: { median: trend(now.median, before.median), p85: trend(now.p85, before.p85) } };
}

/**
 * Taux d'échec : part des Livraisons de la période qui ont au moins un Bug d'origine, trouvé quand que ce soit : un
 * échec appartient à la période de sa Livraison. La Couverture, elle, porte sur tous les bugs.
 */
function failureRateTile(current: Entry[], previous: Entry[], coverage: MetricsCoverage): MetricsFailureRateTile {
  const failed = (deliveries: Entry[]) => deliveries.filter(({ ticket }) => ticket.failed).length;
  const rate = (deliveries: Entry[]) => (deliveries.length === 0 ? null : failed(deliveries) / deliveries.length);
  const reasons = insignificance(coverage);
  return {
    deliveries: current.length,
    failed: failed(current),
    rate: rate(current),
    coverage,
    significant: reasons.length === 0,
    reasons,
    reason: reasons.length === 0 ? null : describeInsignificance(reasons, coverage),
    thresholds: { minCoverage: MIN_FAILURE_COVERAGE, minBugs: MIN_FAILURE_BUGS },
    trend: trend(rate(current), rate(previous)),
  };
}

/** La Couverture de tous les bugs des Projets mesurés : une somme, pas une moyenne de ratios. */
function coverageOf(projects: MetricsInput[]): MetricsCoverage {
  const bugs = projects.reduce((total, p) => total + p.analysis.coverage.bugs, 0);
  const linked = projects.reduce((total, p) => total + p.analysis.coverage.linked, 0);
  return { bugs, linked, ratio: bugs === 0 ? null : linked / bugs };
}

/** Pourquoi le Taux d'échec ne dit rien : sous les seuils, la Couverture ou le nombre de bugs. */
function insignificance(coverage: MetricsCoverage): MetricsFailureRateReason[] {
  const reasons: MetricsFailureRateReason[] = [];
  if (coverage.ratio !== null && coverage.ratio < MIN_FAILURE_COVERAGE) reasons.push('low-coverage');
  if (coverage.bugs < MIN_FAILURE_BUGS) reasons.push('few-bugs');
  return reasons;
}

function describeInsignificance(reasons: MetricsFailureRateReason[], coverage: MetricsCoverage): string {
  const percent = (ratio: number) => Math.round(ratio * 100);
  const parts = reasons.map((reason) =>
    reason === 'low-coverage'
      ? `couverture insuffisante : ${percent(coverage.ratio ?? 0)} % des bugs ont une origine renseignée (minimum ${percent(MIN_FAILURE_COVERAGE)} %)`
      : `trop peu de bugs pour conclure : ${coverage.bugs} (minimum ${MIN_FAILURE_BUGS})`,
  );
  const text = parts.join(' ; ');
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

/**
 * WIP : tickets en statut de travail. `current` à la fin de la fenêtre écoulée, c'est-à-dire à `asOf` (maintenant si la
 * période court jusqu'à aujourd'hui), `average` sur cette fenêtre, pondérée par le temps ; la tendance compare les
 * moyennes, celle de la période précédente étant prise sur la fenêtre comparée (même durée écoulée), pas sur ses heures
 * à venir.
 */
function wipTile(entries: Entry[], elapsed: Span, compared: Span): MetricsWipTile {
  const average = wipAverage(entries, elapsed.start, elapsed.end);
  return { current: wipAt(entries, elapsed.end), average, trend: trend(average, wipAverage(entries, compared.start, compared.end)) };
}

function wipAt(entries: Entry[], at: number): number {
  return entries.filter(({ ticket }) => isWorking(ticket.timeline, at)).length;
}

/** Nombre moyen de tickets en statut de travail entre `from` et `to` : le temps de travail cumulé, sur la durée. */
function wipAverage(entries: Entry[], from: number, to: number): number {
  if (to <= from) return wipAt(entries, to);
  let worked = 0;
  for (const { ticket } of entries) {
    for (const [start, end] of ticket.timeline.work) worked += Math.max(0, Math.min(end, to) - Math.max(start, from));
  }
  return worked / (to - from);
}

/** Évolution par rapport à la période précédente. */
function trend(current: number | null, previous: number | null): MetricsTrend {
  if (current === null || previous === null) return { previous, delta: null, ratio: null };
  const delta = current - previous;
  return { previous, delta, ratio: previous === 0 ? null : delta / previous };
}

/* --- Les graphiques ----------------------------------------------------------------------------------------------- */

/**
 * Débit et Arrivées de chaque tranche de la période : les Livraisons et les Arrivées déjà retenues pour les tuiles
 * (jusqu'à `asOf`), rangées par date. Les tranches et les tuiles comptent ainsi les mêmes tickets ; la dernière tranche,
 * si la période court jusqu'à aujourd'hui, n'en est qu'à son début.
 */
function throughputBuckets(spans: BucketSpan[], delivered: Entry[], arrived: Entry[]): MetricsBucket[] {
  const buckets = spans.map((span): MetricsBucket => ({ from: span.from, to: span.to, days: span.days, deliveries: 0, arrivals: 0 }));
  for (const { ticket } of delivered) {
    const bucket = buckets[spanIndex(spans, ticket.deliveredAt)];
    if (bucket) bucket.deliveries++;
  }
  for (const { ticket } of arrived) {
    const bucket = buckets[spanIndex(spans, ticket.createdAt)];
    if (bucket) bucket.arrivals++;
  }
  return buckets;
}

/** L'indice de la tranche qui contient l'instant ; -1 hors de la période. Les tranches se suivent sans trou. */
function spanIndex(spans: readonly Period[], instant: number | null): number {
  const first = spans[0];
  const last = spans.at(-1);
  if (instant === null || !first || !last || instant < first.start || instant >= last.end) return -1;
  return firstIndexWhere(spans.length, (i) => (spans[i] as Period).end > instant);
}

/** Un point par Livraison démarrée, par date de Livraison croissante puis par identifiant. */
function cycleTimeScatter(deliveries: Entry[]): MetricsCycleTimePoint[] {
  return deliveries
    .flatMap(({ project, ticket }): MetricsCycleTimePoint[] =>
      ticket.deliveredAt === null || ticket.cycleTime === null
        ? []
        : [
            {
              id: ticket.id,
              title: ticket.title,
              type: ticket.type,
              priority: ticket.priority,
              project: project.id,
              deliveredAt: iso(ticket.deliveredAt),
              cycleTime: ticket.cycleTime,
            },
          ],
    )
    .sort((a, b) => compareText(a.deliveredAt, b.deliveredAt) || compareText(a.project, b.project) || compareText(a.id, b.id));
}

/**
 * CFD : le nombre de tickets de chaque colonne à la fin de chaque jour de la période, à `asOf` pour le jour en cours.
 * Chaque ticket reste dans sa colonne d'un changement au suivant : pour chaque segment, on retient les jours dont
 * l'instant d'échantillonnage tombe dedans (différences successives, puis cumul), sans repasser sur chaque ticket
 * à chaque jour.
 */
function cumulativeFlow(entries: Entry[], period: Period, timeZone: string, asOf: number): MetricsCfdPoint[] {
  const days = daysOf(period);
  const samples = days.map((day) => Math.min(startOfDay(addDays(day, 1), timeZone), asOf));
  const zeros = () => new Array<number>(days.length + 1).fill(0);
  const changes: Record<Column, number[]> = { backlog: zeros(), ready: zeros(), inProgress: zeros(), blocked: zeros(), done: zeros() };
  const bump = (series: number[], index: number, by: number) => {
    series[index] = (series[index] ?? 0) + by;
  };

  for (const { ticket } of entries) {
    const { segments } = ticket.timeline;
    segments.forEach((segment, i) => {
      if (segment.column === null) return;
      const first = firstIndexWhere(samples.length, (s) => (samples[s] as number) >= segment.from);
      const end = firstIndexWhere(samples.length, (s) => (samples[s] as number) >= (segments[i + 1]?.from ?? Number.POSITIVE_INFINITY));
      if (first < end) {
        bump(changes[segment.column], first, +1);
        bump(changes[segment.column], end, -1);
      }
    });
  }

  const running: Record<Column, number> = { backlog: 0, ready: 0, inProgress: 0, blocked: 0, done: 0 };
  return days.map((date, i) => {
    for (const column of COLUMNS) running[column] += changes[column][i] ?? 0;
    return { date, ...running };
  });
}

/** Les tickets en statut de travail à `asOf`, du plus ancien au plus récent (âge depuis leur premier passage en statut de travail). */
function inProgress(entries: Entry[], asOf: number): MetricsInProgressTicket[] {
  return entries
    .flatMap(({ project, ticket }): MetricsInProgressTicket[] => {
      const status = statusAt(ticket.timeline, asOf);
      if (!isWorking(ticket.timeline, asOf) || status === undefined || ticket.startedAt === null) return [];
      return [
        {
          id: ticket.id,
          title: ticket.title,
          type: ticket.type,
          priority: ticket.priority,
          project: project.id,
          status,
          blocked: columnAt(ticket.timeline, asOf) === 'blocked',
          startedAt: iso(ticket.startedAt),
          age: asOf - ticket.startedAt,
        },
      ];
    })
    .sort((a, b) => b.age - a.age || compareText(a.project, b.project) || compareText(a.id, b.id));
}

/* --- Les découpages ----------------------------------------------------------------------------------------------- */

/**
 * Découpages de la période courante, comptée comme les tuiles : de son début à `asOf` (`elapsed`). Par type et par
 * priorité, seuls les groupes qui ont une Livraison, une Arrivée ou du WIP ; par Projet, tous les Projets mesurés, dans
 * l'ordre reçu.
 *
 * Chaque découpage dit si son Taux d'échec est significatif, par la même règle que la tuile, sur la Couverture qui le
 * sous-tend : celle des bugs du Projet pour un découpage par Projet ; celle de tous les Projets mesurés pour un découpage
 * par type ou par priorité, car le bug qui met une Livraison en échec n'a ni son type ni sa priorité.
 */
function slicesOf(entries: Entry[], projects: MetricsInput[], elapsed: Span): MetricsSlices {
  const active = (slice: MetricsSlice) => slice.throughput > 0 || slice.arrivals > 0 || slice.wip > 0;
  const overall = coverageOf(projects);

  const type = [...groupBy(entries, ({ ticket }) => ticket.type)]
    .map(([key, group]) => sliceOf(key, key, group, elapsed, overall))
    .filter(active)
    .sort((a, b) => b.throughput - a.throughput || compareText(a.key, b.key));
  const priority = [...groupBy(entries, ({ ticket }) => String(ticket.priority))]
    .map(([key, group]) => sliceOf(key, `P${key}`, group, elapsed, overall))
    .filter(active)
    .sort((a, b) => Number(a.key) - Number(b.key));
  const byProject = groupBy(entries, ({ project }) => project.id);
  const project = projects.map((p) => sliceOf(p.id, p.name, byProject.get(p.id) ?? [], elapsed, coverageOf([p])));
  return { type, priority, project };
}

/**
 * Les métriques de la période pour un sous-ensemble de tickets, dont le Taux d'échec repose sur `coverage`. Comptées dans
 * `elapsed`, le WIP l'est à sa fin, `asOf`.
 */
function sliceOf(key: string, label: string, entries: Entry[], elapsed: Span, coverage: MetricsCoverage): MetricsSlice {
  const delivered = deliveriesIn(entries, elapsed);
  const failed = delivered.filter(({ ticket }) => ticket.failed).length;
  return {
    key,
    label,
    throughput: delivered.length,
    arrivals: arrivalsIn(entries, elapsed).length,
    leadTime: durationStats(leadTimesOf(delivered)),
    cycleTime: durationStats(cycleTimesOf(delivered)),
    failedDeliveries: failed,
    failureRate: delivered.length === 0 ? null : failed / delivered.length,
    coverage,
    significant: insignificance(coverage).length === 0,
    wip: wipAt(entries, elapsed.end),
  };
}

function groupBy(entries: Entry[], keyOf: (entry: Entry) => string): Map<string, Entry[]> {
  const groups = new Map<string, Entry[]>();
  for (const entry of entries) {
    const key = keyOf(entry);
    const group = groups.get(key);
    if (group) group.push(entry);
    else groups.set(key, [entry]);
  }
  return groups;
}

/* --- Outils ------------------------------------------------------------------------------------------------------- */

/** Le premier indice de 0 à `length - 1` pour lequel `holds` est vrai (`holds` est faux puis vrai) ; `length` si aucun. */
function firstIndexWhere(length: number, holds: (index: number) => boolean): number {
  let low = 0;
  let high = length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (holds(middle)) high = middle;
    else low = middle + 1;
  }
  return low;
}

/** Ordre des unités de code, le même sur toutes les machines (contrairement à `localeCompare`). */
const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const iso = (instant: number) => new Date(instant).toISOString();

function toDateRange(period: Period): MetricsDateRange {
  return { from: period.from, to: period.to, days: period.days, start: iso(period.start), end: iso(period.end) };
}
