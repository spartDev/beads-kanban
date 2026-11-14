import type {
  MetricsAbandonment,
  MetricsActivity,
  MetricsFlowEfficiency,
  MetricsHealth,
  MetricsLeadTimeBreakdown,
  MetricsReadyAges,
  MetricsReadyTicket,
  MetricsReopening,
} from '../shared/api';
import { calendarElapsed, resolvePeriod } from './calendar';
import { lruMemo } from './lru';
import { reworkIn } from './rework';
import { durationStats, type MetricsInput, type MetricsOptions, type TrackedTicket, trend } from './metrics';
import { MAX_ZONE_FORMATTERS } from './time-zone';

/**
 * Santé du flux : Efficacité du flux, Taux de Réouverture, Taux d'abandon, décomposition du Lead Time (avec l'Attente de
 * dépendance), âge des Prêts qui stagnent et carte d'activité. Du code pur, comme `computeMetrics` dont il reprend les
 * entrées (les analyses des Projets, la période, l'instant, le fuseau) et les règles de période : la période courante
 * est comptée de son début à `asOf`, la précédente de son début à `previousAsOf`, à durée écoulée égale.
 *
 * Un résultat appartient à la période de sa date, comme une Livraison : un Abandon à sa dernière clôture, une clôture à son
 * instant, une Transition au sien. Un Prêt est celui du ticket à `asOf`. Les Epics ne sont mesurées nulle part.
 *
 * Ce module est composé avec `computeMetrics` par le service de métriques (`MetricsResponse.health`), au lieu d'être appelé
 * par lui : il lit `durationStats`, `trend` et les types de `metrics.ts`, qui ne doit donc pas l'importer en retour.
 */

const DAY = 86_400_000;

/**
 * Un Prêt qui l'est depuis plus longtemps que cela stagne : plus de 14 jours calendaires, pas 14 jours pile. Des jours du
 * calendrier de l'utilisateur, comptés dans son fuseau (`calendarElapsed`) : un changement d'heure n'en fait ni 14 jours moins une
 * heure, ni 14 jours plus une heure.
 */
export const STAGNANT_READY_AFTER = 14 * DAY;

/** Une fenêtre de temps (ms epoch) : son premier instant compris, le premier instant qui suit exclu. */
interface Window {
  start: number;
  end: number;
}

/** Un ticket mesuré, avec le Projet qui le porte. */
interface Entry {
  project: MetricsInput;
  ticket: TrackedTicket;
}

export function computeHealth(projects: MetricsInput[], { period, now, timeZone }: MetricsOptions): MetricsHealth {
  const resolved = resolvePeriod(period, now.getTime(), timeZone);
  const elapsed: Window = { start: resolved.current.start, end: resolved.asOf };
  const compared: Window = { start: resolved.previous.start, end: resolved.previousAsOf };
  const entries: Entry[] = projects.flatMap((project) => project.analysis.tickets.map((ticket) => ({ project, ticket })));

  return {
    efficiency: efficiencyOf(entries, elapsed, compared),
    reopening: reopeningOf(entries, elapsed, compared),
    rework: reworkIn(entries, elapsed),
    abandonment: abandonmentOf(entries, elapsed, compared),
    leadTimeBreakdown: leadTimeBreakdownOf(entries, elapsed),
    readyAges: readyAgesOf(entries, resolved.asOf, resolved.previousAsOf, timeZone),
    activity: activityOf(entries, elapsed, timeZone),
  };
}

/** L'instant est dans la fenêtre : son premier instant compris, le premier instant qui suit exclu. */
const within = (instant: number | null, window: Window): instant is number => instant !== null && instant >= window.start && instant < window.end;

/** Ordre des unités de code, le même sur toutes les machines (contrairement à `localeCompare`). */
const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const iso = (instant: number) => new Date(instant).toISOString();

/* --- Efficacité du flux ------------------------------------------------------------------------------------------- */

interface EfficiencySample {
  n: number;
  cycleTime: number;
  blockedTime: number;
  blockedDeliveries: number;
  ratio: number | null;
}

/**
 * Part du Cycle Time passée hors Blocage, sur les Livraisons de la fenêtre qui ont été démarrées : la somme de leur Cycle
 * Time moins la somme de leur Blocage, sur la somme de leur Cycle Time. Pesée par le temps : une Livraison de dix jours
 * pèse dix fois celle d'un jour, ce que ne ferait pas la moyenne des efficacités.
 */
function efficiencyIn(entries: Entry[], window: Window): EfficiencySample {
  let [n, cycleTime, blockedTime, blockedDeliveries] = [0, 0, 0, 0];
  for (const { ticket } of entries) {
    if (!within(ticket.deliveredAt, window) || ticket.cycleTime === null) continue;
    const blocked = Math.min(ticket.blockedTime ?? 0, ticket.cycleTime); // le Blocage est du Cycle Time : jamais plus que lui
    n++;
    cycleTime += ticket.cycleTime;
    blockedTime += blocked;
    if (blocked > 0) blockedDeliveries++;
  }
  return { n, cycleTime, blockedTime, blockedDeliveries, ratio: cycleTime > 0 ? (cycleTime - blockedTime) / cycleTime : null };
}

function efficiencyOf(entries: Entry[], elapsed: Window, compared: Window): MetricsFlowEfficiency {
  const current = efficiencyIn(entries, elapsed);
  return { ...current, trend: trend(current.ratio, efficiencyIn(entries, compared).ratio) };
}

/* --- Taux de Réouverture ------------------------------------------------------------------------------------------ */

/**
 * Les clôtures de la fenêtre (Transitions vers fermé) et, parmi elles, celles que suit une Réouverture. Les Transitions d'un
 * ticket se suivent sans répéter un statut : après une clôture, la Transition suivante, s'il y en a une, est une Réouverture.
 */
export function closuresIn(entries: ReadonlyArray<Pick<Entry, 'ticket'>>, window: Window): { closures: number; reopened: number } {
  let [closures, reopened] = [0, 0];
  for (const { ticket } of entries) {
    const { steps } = ticket.timeline;
    steps.forEach((step, index) => {
      if (step.status !== 'closed' || !within(step.at, window)) return;
      closures++;
      if (index < steps.length - 1) reopened++;
    });
  }
  return { closures, reopened };
}

const share = (part: number, whole: number): number | null => (whole === 0 ? null : part / whole);

function reopeningOf(entries: Entry[], elapsed: Window, compared: Window): MetricsReopening {
  const current = closuresIn(entries, elapsed);
  const before = closuresIn(entries, compared);
  const rate = share(current.reopened, current.closures);
  return { ...current, rate, trend: trend(rate, share(before.reopened, before.closures)) };
}

/* --- Taux d'abandon ----------------------------------------------------------------------------------------------- */

/** Les tickets fermés de la fenêtre : Livraisons et Abandons, chacun daté de sa dernière clôture. */
function closedIn(entries: Entry[], window: Window) {
  let [delivered, duplicates, superseded] = [0, 0, 0];
  for (const { ticket } of entries) {
    if (within(ticket.deliveredAt, window)) delivered++;
    else if (within(ticket.abandonedAt, window)) {
      if (ticket.abandonCause === 'superseded') superseded++;
      else duplicates++;
    }
  }
  const abandoned = duplicates + superseded;
  return { closed: delivered + abandoned, abandoned, duplicates, superseded };
}

function abandonmentOf(entries: Entry[], elapsed: Window, compared: Window): MetricsAbandonment {
  const current = closedIn(entries, elapsed);
  const before = closedIn(entries, compared);
  const rate = share(current.abandoned, current.closed);
  return { ...current, rate, trend: trend(rate, share(before.abandoned, before.closed)) };
}

/* --- Décomposition du Lead Time ----------------------------------------------------------------------------------- */

/**
 * Le Lead Time cumulé des Livraisons de la fenêtre, en cinq parts qui s'additionnent. Pour chaque Livraison : l'Attente de
 * dépendance (le Backlog avant le premier démarrage), le travail et le Blocage (le Cycle Time, avec et sans Blocage),
 * l'Attente en Prêt (le temps en colonne Prêt, avant le démarrage ou après un retour à ouvert), et le reste, que l'on appelle
 * l'autre attente (Backlog après un premier démarrage, différé, fermé avant une Réouverture). Les trois premières mesures
 * viennent d'`analyzeFlow`, la quatrième de la chronologie du ticket : elles ne se chevauchent pas (l'attente de dépendance
 * est en statut ouvert et en Blocage, le Prêt en statut ouvert hors Blocage, le Cycle Time en statut de travail). Même quand
 * l'horloge d'un commit a reculé, chacune est prise dans les périodes du ticket lui-même, dont les Transitions ne reculent
 * jamais (`TicketFlow.transitions`) : elles tiennent donc dans le Lead Time, quelles que soient les dates des dépendances.
 * Chaque part n'en est pas moins bornée par ce qui reste, par garde : aucune n'est négative et leur somme est toujours le Lead
 * Time, quoi qu'il arrive.
 */
function leadTimeBreakdownOf(entries: Entry[], window: Window): MetricsLeadTimeBreakdown {
  const parts = { deliveries: 0, total: 0, dependencyWait: 0, readyWait: 0, work: 0, blocked: 0, otherWait: 0 };
  const waits: number[] = [];
  for (const { ticket } of entries) {
    if (!within(ticket.deliveredAt, window)) continue;
    const leadTime = Math.max(0, ticket.leadTime ?? 0);
    const dependencyWait = Math.min(Math.max(0, ticket.dependencyWait ?? 0), leadTime);
    const cycleTime = Math.min(Math.max(0, ticket.cycleTime ?? 0), leadTime - dependencyWait);
    const blocked = Math.min(Math.max(0, ticket.blockedTime ?? 0), cycleTime);
    const readyWait = Math.min(readyTimeOf(ticket, ticket.deliveredAt), leadTime - dependencyWait - cycleTime);
    parts.deliveries++;
    parts.total += leadTime;
    parts.dependencyWait += dependencyWait;
    parts.readyWait += readyWait;
    parts.work += cycleTime - blocked;
    parts.blocked += blocked;
    parts.otherWait += leadTime - dependencyWait - cycleTime - readyWait;
    if (dependencyWait > 0) waits.push(dependencyWait);
  }
  return { ...parts, waited: waits.length, waits: durationStats(waits) };
}

/** Le temps que le ticket a passé dans la colonne Prêt, de sa création (le début de sa chronologie) à `end` (sa Livraison) : chaque segment Prêt, borné. */
function readyTimeOf(ticket: TrackedTicket, end: number): number {
  const { segments } = ticket.timeline;
  let time = 0;
  segments.forEach((segment, index) => {
    if (segment.column !== 'ready') return;
    const to = Math.min(segments[index + 1]?.from ?? end, end);
    if (to > segment.from) time += to - segment.from;
  });
  return time;
}

/* --- Âge des Prêts ------------------------------------------------------------------------------------------------ */

/**
 * Les Prêts à l'instant `at`, avec depuis quand ils le sont : le début du segment de la chronologie qui les range dans la
 * colonne Prêt (ouvert, hors Blocage). Un ticket créé après `at` n'existe pas encore. L'âge est un Âge calendaire dans le fuseau
 * (`calendarElapsed`, voir CONTEXT.md) : c'est lui, et non les millisecondes, que l'on compare au seuil de 14 jours.
 */
function readyAt(entries: Entry[], at: number, timeZone: string): MetricsReadyTicket[] {
  return entries
    .flatMap(({ project, ticket }): MetricsReadyTicket[] => {
      const segment = ticket.timeline.segments.findLast((candidate) => candidate.from <= at);
      if (segment?.column !== 'ready') return [];
      const age = calendarElapsed(segment.from, at, timeZone);
      return [
        {
          id: ticket.id,
          title: ticket.title,
          type: ticket.type,
          priority: ticket.priority,
          project: project.id,
          since: iso(segment.from),
          age,
          stagnant: age > STAGNANT_READY_AFTER,
        },
      ];
    })
    .sort((a, b) => b.age - a.age || compareText(a.project, b.project) || compareText(a.id, b.id));
}

function readyAgesOf(entries: Entry[], asOf: number, previousAsOf: number, timeZone: string): MetricsReadyAges {
  const tickets = readyAt(entries, asOf, timeZone);
  const stagnant = tickets.filter((ticket) => ticket.stagnant).length;
  const before = readyAt(entries, previousAsOf, timeZone).filter((ticket) => ticket.stagnant).length;
  return { stagnantAfter: STAGNANT_READY_AFTER, tickets, stagnant, trend: trend(stagnant, before) };
}

/* --- Carte d'activité --------------------------------------------------------------------------------------------- */

const WEEKDAYS: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

/** Le formateur d'un fuseau : un cache borné (le fuseau d'une requête vient du client), voir `lruMemo`. */
const formatterOf = lruMemo(
  MAX_ZONE_FORMATTERS,
  (timeZone: string) => new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: '2-digit', hourCycle: 'h23' }),
);

/** Le jour de la semaine (0 pour le lundi) et l'heure du mur (0 à 23) de l'instant dans le fuseau. */
function slotOf(instant: number, timeZone: string): { weekday: number; hour: number } {
  const formatter = formatterOf(timeZone);
  const parts = Object.fromEntries(formatter.formatToParts(instant).map((part) => [part.type, part.value]));
  return { weekday: WEEKDAYS[parts.weekday ?? ''] ?? 0, hour: Number(parts.hour) % 24 };
}

/**
 * Les Transitions de la fenêtre par jour de la semaine et par heure. La création d'un ticket (son premier statut) n'est pas
 * une Transition : c'est une Arrivée.
 */
function activityOf(entries: Entry[], window: Window, timeZone: string): MetricsActivity {
  const cells = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  let total = 0;
  for (const { ticket } of entries) {
    for (const step of ticket.timeline.steps.slice(1)) {
      if (!within(step.at, window)) continue;
      const { weekday, hour } = slotOf(step.at, timeZone);
      const day = cells[weekday];
      if (day) day[hour] = (day[hour] ?? 0) + 1;
      total++;
    }
  }
  return { cells, total };
}
