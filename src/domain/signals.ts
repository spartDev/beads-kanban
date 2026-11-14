import { calendarElapsed } from './calendar';
import { type Drift, driftsOf } from './drift';
import { STAGNANT_READY_AFTER } from './health';
import { type MetricsInput, percentile, type ProjectAnalysis, type TrackedTicket } from './metrics';
import { isWorking } from './timeline';

const DAY = 86_400_000;

/** Un Blocage dont la phase en cours de travail dure plus que cela est long : plus de 3 jours de Durée écoulée, pas 3 jours pile. */
export const LONG_BLOCKAGE_AFTER = 3 * DAY;
/** Le WIP habituel se lit sur les relevés des 90 derniers jours, un toutes les 24 heures, à la même heure que maintenant. */
const WIP_SAMPLES = 90;
/** Sous ce nombre de relevés, on ne sait pas ce qui est habituel. */
const MIN_WIP_SAMPLES = 14;

/** Le ticket qu'un Signal désigne, tel que la page le nomme. */
export interface SignalTicket {
  id: string;
  title: string;
  type: string;
  priority: number;
}

/** Une situation en cours qui mérite d'être regardée maintenant (voir « Signal » dans CONTEXT.md). Instants et durées en ms. */
export type Signal =
  | ({ kind: 'drift'; project: string; ticket: SignalTicket } & Drift)
  | {
      kind: 'longBlockage';
      project: string;
      ticket: SignalTicket;
      /** Le début de la phase en cours de travail du Blocage. */
      since: number;
      duration: number;
    }
  | {
      kind: 'stagnantReady';
      project: string;
      ticket: SignalTicket;
      /** Depuis quand il est Prêt : création, fin de son Blocage, retour à ouvert ou Réouverture. */
      since: number;
      /** Âge calendaire, dans le fuseau de l'utilisateur. */
      age: number;
    }
  | {
      kind: 'unusualWip';
      project: string;
      wip: number;
      /** Le P85 du WIP quotidien des 90 derniers jours, que `wip` dépasse. */
      threshold: number;
    };

export interface SignalsOptions {
  now: number;
  /** Fuseau IANA de l'utilisateur : celui de l'Âge calendaire d'un Prêt. */
  timeZone: string;
}

/** Les Signaux des Projets à l'instant `now`. */
export function signalsOf(projects: MetricsInput[], { now, timeZone }: SignalsOptions): Signal[] {
  const drifts = projects.flatMap((project) => {
    const byId = driftsOf(project.analysis, now);
    return project.analysis.tickets.flatMap((ticket): Signal[] => {
      const drift = byId.get(ticket.id);
      return drift ? [{ kind: 'drift', project: project.id, ticket: named(ticket), ...drift }] : [];
    });
  });
  const longBlockages = projects.flatMap((project) =>
    project.analysis.tickets.flatMap((ticket): Signal[] => {
      const since = workingBlockageSince(ticket, now);
      if (since === null || now - since <= LONG_BLOCKAGE_AFTER) return [];
      return [{ kind: 'longBlockage', project: project.id, ticket: named(ticket), since, duration: now - since }];
    }),
  );
  const stagnantReadies = projects.flatMap((project) =>
    project.analysis.tickets.flatMap((ticket): Signal[] => {
      const segment = currentSegment(ticket, now);
      if (segment?.column !== 'ready') return [];
      const age = calendarElapsed(segment.from, now, timeZone);
      return age > STAGNANT_READY_AFTER ? [{ kind: 'stagnantReady', project: project.id, ticket: named(ticket), since: segment.from, age }] : [];
    }),
  );
  const unusualWips = projects.flatMap((project): Signal[] => {
    const threshold = usualWip(project.analysis, now);
    const wip = wipAt(project.analysis, now);
    return threshold !== null && wip > threshold ? [{ kind: 'unusualWip', project: project.id, wip, threshold }] : [];
  });
  return [...drifts, ...longBlockages, ...stagnantReadies, ...unusualWips].sort(bySeverity);
}

/**
 * Le début de la phase en cours de travail du Blocage où se trouve le ticket à `now`, s'il y en a une. C'est la colonne Bloqué du tableau : un ticket
 * en travail et en Blocage. Les segments de la chronologie sont ceux des colonnes, où deux voisins de même colonne n'en font qu'un.
 */
function workingBlockageSince(ticket: TrackedTicket, now: number): number | null {
  if (!isWorking(ticket.timeline, now)) return null;
  const segment = currentSegment(ticket, now);
  return segment?.column === 'blocked' ? segment.from : null;
}

/** Le segment de colonne où se trouve le ticket à `now` : la même lecture que les Prêts de la page Métriques (`health.ts`). */
const currentSegment = (ticket: TrackedTicket, now: number) => ticket.timeline.segments.findLast((candidate) => candidate.from <= now);

const wipAt = (analysis: ProjectAnalysis, at: number) => analysis.tickets.filter((ticket) => isWorking(ticket.timeline, at)).length;

/**
 * Le WIP habituel d'un Projet : le P85 de son WIP relevé toutes les 24 heures sur les 90 derniers jours, à la même heure que `now`, les jours où il
 * existait (depuis la création de son premier ticket). Null sous 14 relevés.
 */
function usualWip(analysis: ProjectAnalysis, now: number): number | null {
  const born = Math.min(...analysis.tickets.map((ticket) => ticket.createdAt));
  const samples: number[] = [];
  for (let day = 1; day <= WIP_SAMPLES && now - day * DAY >= born; day++) samples.push(wipAt(analysis, now - day * DAY));
  if (samples.length < MIN_WIP_SAMPLES) return null;
  return percentile(samples.sort((a, b) => a - b), 85);
}

/** L'ordre des groupes, de la page « À regarder ». */
const KIND_ORDER: Signal['kind'][] = ['drift', 'longBlockage', 'stagnantReady', 'unusualWip'];

/** Combien un Signal dépasse ce qui est normal : plus c'est grand, plus il vient tôt dans son groupe. */
function excess(signal: Signal): number {
  switch (signal.kind) {
    case 'drift':
      return signal.cycleTime / signal.reference;
    case 'longBlockage':
      return signal.duration;
    case 'stagnantReady':
      return signal.age;
    case 'unusualWip':
      return signal.threshold === 0 ? Number.POSITIVE_INFINITY : signal.wip / signal.threshold;
  }
}

const idOf = (signal: Signal) => ('ticket' in signal ? signal.ticket.id : '');

/** Par sorte, puis du plus en excès au moins en excès ; à égalité, par Projet puis par ticket, pour un ordre stable. */
function bySeverity(a: Signal, b: Signal): number {
  return (
    KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
    excess(b) - excess(a) ||
    (a.project < b.project ? -1 : a.project > b.project ? 1 : 0) ||
    (idOf(a) < idOf(b) ? -1 : idOf(a) > idOf(b) ? 1 : 0)
  );
}

const named = ({ id, title, type, priority }: TrackedTicket): SignalTicket => ({ id, title, type, priority });
