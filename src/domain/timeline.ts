import { isWork, type TicketHistory, type TicketId, type Transition } from './flow';
import { type Interval, intersect, union } from './intervals';

/**
 * La vie d'un ticket, jour après jour : dans quelle colonne du kanban il était, et quand il était en statut de travail.
 * C'est ce qu'il faut au CFD et au WIP. `analyzeFlow` ne rend que des totaux (temps bloqué, Cycle Time) et ne garde
 * le Blocage que des tickets fermés : ici il court sur toute la vie du ticket, jusqu'à aujourd'hui s'il est ouvert.
 */

/** Les colonnes du kanban (bdesk-38k.7), moins « En pause ». */
export type Column = 'backlog' | 'ready' | 'inProgress' | 'blocked' | 'done';

export const COLUMNS: readonly Column[] = ['backlog', 'ready', 'inProgress', 'blocked', 'done'];

/** Un statut daté (ms epoch). */
export interface Step {
  status: string;
  at: number;
}

/** La colonne du ticket à partir de `from`, jusqu'au segment suivant ; null : hors des colonnes (« En pause »). */
export interface ColumnSegment {
  from: number;
  column: Column | null;
}

export interface TicketTimeline {
  /** Les statuts successifs, de la création au présent. */
  steps: Step[];
  /** Colonnes successives, de la création au présent ; vide pour un ticket sans historique. */
  segments: ColumnSegment[];
  /** Périodes en statut de travail ; la dernière court jusqu'à l'infini si le ticket l'est encore. */
  work: Interval[];
}

const END = Number.POSITIVE_INFINITY;

/**
 * Les Transitions en statuts datés, dont les dates ne reculent jamais : quand l'horloge d'un commit a reculé, le
 * changement a lieu au même instant que le précédent, et le dernier gagne.
 */
export function stepsOf(transitions: Transition[]): Step[] {
  let previous = Number.NEGATIVE_INFINITY;
  return transitions.map(({ status, at }) => {
    previous = Math.max(previous, at.getTime());
    return { status, at: previous };
  });
}

/**
 * La chronologie d'un ticket. `stepsById` donne les statuts de tous les tickets du Projet : une dépendance bloque tant
 * que sa cible n'est pas fermée, et une cible inconnue (hors Projet) ne bloque pas. Même Blocage que `analyzeFlow` :
 * statut bloqué, ou dépendance `blocks` active vers une cible non fermée.
 */
export function buildTimeline(ticket: TicketHistory, steps: Step[], stepsById: Map<TicketId, Step[]>): TicketTimeline {
  const first = steps[0];
  if (!first) return { steps, segments: [], work: [] };

  const blockage = union([...periodsOf(steps, (status) => status === 'blocked'), ...dependencyBlockage(ticket, stepsById)]);
  // Tout ce qui change la colonne change à l'un de ces instants : un statut, ou le début ou la fin d'un Blocage.
  const changes = [...new Set([...steps.map((s) => s.at), ...blockage.flat()])]
    .filter((instant) => Number.isFinite(instant) && instant >= first.at)
    .sort((a, b) => a - b);

  const segments: ColumnSegment[] = [];
  for (const from of changes) {
    const column = columnFor(statusIn(steps, from), blockage.some(([start, end]) => start <= from && from < end));
    if (segments.at(-1)?.column !== column || segments.length === 0) segments.push({ from, column });
  }
  return { steps, segments, work: periodsOf(steps, isWork) };
}

/** La colonne du ticket à cet instant ; null avant sa création ou en « En pause ». */
export function columnAt(timeline: TicketTimeline, at: number): Column | null {
  let column: Column | null = null;
  for (const segment of timeline.segments) {
    if (segment.from > at) break;
    column = segment.column;
  }
  return column;
}

/** Le ticket est en statut de travail à cet instant. */
export function isWorking(timeline: TicketTimeline, at: number): boolean {
  return timeline.work.some(([start, end]) => start <= at && at < end);
}

/** Le statut du ticket à cet instant : celui du dernier changement à cet instant ou avant ; indéfini avant sa création. */
export function statusAt(timeline: TicketTimeline, at: number): string | undefined {
  return statusIn(timeline.steps, at);
}

function statusIn(steps: Step[], at: number): string | undefined {
  return steps.findLast((step) => step.at <= at)?.status;
}

/**
 * Colonne selon le statut et le Blocage : le statut bloqué est en Bloqué ; un statut de travail est en cours, ou bloqué
 * s'il dépend d'un ticket non fermé ; un ticket ouvert est Prêt, ou en Backlog s'il en dépend. Différé, épinglé ou
 * inconnu : « En pause », hors des colonnes.
 */
function columnFor(status: string | undefined, blocked: boolean): Column | null {
  switch (status) {
    case 'closed':
      return 'done';
    case 'blocked':
      return 'blocked';
    case 'in_progress':
    case 'hooked':
      return blocked ? 'blocked' : 'inProgress';
    case 'open':
      return blocked ? 'backlog' : 'ready';
    default:
      return null;
  }
}

/** Périodes dont le statut satisfait `matches` ; la dernière court jusqu'à l'infini. */
function periodsOf(steps: Step[], matches: (status: string) => boolean): Interval[] {
  return steps.flatMap((step, i): Interval[] => (matches(step.status) ? [[step.at, steps[i + 1]?.at ?? END]] : []));
}

/** Blocage par dépendance : `blocks` actif, vers une cible connue, pendant que la cible n'est pas fermée. */
function dependencyBlockage(ticket: TicketHistory, stepsById: Map<TicketId, Step[]>): Interval[] {
  return ticket.dependencies
    .filter((d) => d.type === 'blocks')
    .flatMap((d) => {
      const target = stepsById.get(d.target);
      if (!target) return [];
      const active: Interval = [d.addedAt.getTime(), d.removedAt?.getTime() ?? END];
      return intersect([active], periodsOf(target, (status) => status !== 'closed'));
    });
}
