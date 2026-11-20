import type { DeclaredStatuses, MetricsCycleTimeBreakdown } from '../shared/api';
import { resolvePeriod } from './calendar';
import { isWork } from './flow';
import { type Interval, intersect, measure } from './intervals';
import { MIN_TREND_DELIVERIES } from './longTrend';
import { durationStats, type MetricsInput, type MetricsOptions } from './metrics';
import { firstSendBackAt } from './review';
import { isHandoffStatus } from './statuses';
import type { Step, TicketTimeline } from './timeline';

/**
 * Décomposition du Cycle Time et Attente humaine (bdesk-pz0.6, ADR 0007). Le Cycle Time d'une Livraison, réparti en six parts qui s'additionnent
 * (CONTEXT.md) : Relecture, Intégration et Attente humaine (le temps passé dans chaque Statut de relais), Blocage, et le reste du travail, coupé au
 * premier Retour en Développement (avant) et Correction (après). Un temps à la fois de relais et de Blocage compte en Blocage, comme pour l'Efficacité
 * du flux. Tout se lit dans la chronologie déjà analysée (`TicketTimeline` : Transitions et Blocage), sans autre source.
 *
 * Du code pur, comme `computeReview` : composé avec `computeMetrics` par le service de métriques (`MetricsResponse.cycleTimeBreakdown`), il lit les types
 * de `metrics.ts`, qui ne l'importe pas en retour. Une Livraison appartient à la période de sa dernière clôture, comme dans le Débit : ni un Abandon ni un
 * Renoncement n'y entrent, et un ticket rouvert puis refermé compte une fois, avec tout son Cycle Time, celui d'avant la Réouverture compris.
 */

/** Les six parts du Cycle Time d'une Livraison, en ms. */
export interface CycleTimeParts {
  review: number;
  integration: number;
  humanWait: number;
  blocked: number;
  development: number;
  correction: number;
}

const END = Number.POSITIVE_INFINITY;

/**
 * Les six parts du Cycle Time d'une Livraison, d'après sa chronologie (`TrackedTicket.timeline`), qui finit à sa dernière clôture. Chaque période d'un
 * statut de travail court d'une Transition à la suivante (`TicketTimeline.work`) : celles d'un Statut de relais vont, hors Blocage, à sa part ; celles des
 * autres statuts de travail, hors Blocage, au Développement avant le premier Retour (`firstSendBackAt`, la règle des Retours de `reviewOf`) et à la
 * Correction à partir de lui ; tout le Blocage du travail va au Blocage, celui du statut bloqué compris. Les parts sont des mesures exactes, en ms entières,
 * de périodes disjointes qui couvrent le travail : leur somme est le Cycle Time du ticket (`TrackedTicket.cycleTime`), et le Blocage son temps bloqué
 * (`TrackedTicket.blockedTime`), sans arrondi.
 *
 * `declared` : les statuts personnalisés que le Projet déclare, qui disent lesquels de ses autres statuts sont de travail, et vers lesquels un Retour mène.
 */
export function cycleTimePartsOf(timeline: TicketTimeline, declared: DeclaredStatuses): CycleTimeParts {
  const { steps, work, blockages } = timeline;
  /** Le temps des périodes hors Blocage. */
  const unblocked = (periods: Interval[]) => measure(periods) - measure(intersect(periods, blockages));
  const cut = firstSendBackAt(steps, declared) ?? END;
  const development = periodsOf(steps, (status) => isWork(status, declared) && !isHandoffStatus(status));
  return {
    review: unblocked(periodsOf(steps, (status) => status === 'in_review')),
    integration: unblocked(periodsOf(steps, (status) => status === 'in_integration')),
    humanWait: unblocked(periodsOf(steps, (status) => status === 'awaiting_human')),
    blocked: measure(intersect(work, blockages)),
    development: unblocked(intersect(development, [[Number.NEGATIVE_INFINITY, cut]])),
    correction: unblocked(intersect(development, [[cut, END]])),
  };
}

/** La Décomposition du Cycle Time des Livraisons de la période demandée, sur l'union des tickets des Projets (la Vue globale, ou un seul Projet). */
export function computeCycleTimeBreakdown(projects: MetricsInput[], { period, now, timeZone }: MetricsOptions): MetricsCycleTimeBreakdown {
  const resolved = resolvePeriod(period, now.getTime(), timeZone);
  const [start, end] = [resolved.current.start, resolved.asOf];
  const parts: CycleTimeParts = { review: 0, integration: 0, humanWait: 0, blocked: 0, development: 0, correction: 0 };
  const waits: number[] = [];
  let deliveries = 0;
  for (const { analysis } of projects) {
    for (const ticket of analysis.tickets) {
      if (ticket.deliveredAt === null || ticket.deliveredAt < start || ticket.deliveredAt >= end) continue;
      deliveries++;
      const own = cycleTimePartsOf(ticket.timeline, analysis.declaredStatuses);
      for (const part of Object.keys(parts) as (keyof CycleTimeParts)[]) parts[part] += own[part];
      if (own.humanWait > 0) waits.push(own.humanWait);
    }
  }
  const total = parts.review + parts.integration + parts.humanWait + parts.blocked + parts.development + parts.correction;
  return {
    deliveries,
    total,
    ...parts,
    humanWaits: {
      waited: waits.length,
      stats: durationStats(waits),
      reliable: waits.length >= MIN_TREND_DELIVERIES,
      minDeliveries: MIN_TREND_DELIVERIES,
      share: total === 0 ? null : parts.humanWait / total,
    },
  };
}

/** Périodes dont le statut satisfait `matches`, d'une Transition à la suivante ; la dernière court jusqu'à l'infini (celle d'une Livraison est fermée). */
function periodsOf(steps: readonly Step[], matches: (status: string) => boolean): Interval[] {
  return steps.flatMap((step, i): Interval[] => (matches(step.status) ? [[step.at, steps[i + 1]?.at ?? END]] : []));
}
