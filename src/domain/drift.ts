import { intersect, measure } from './intervals';
import { percentile, type ProjectAnalysis, type TrackedTicket } from './metrics';
import { isWorking } from './timeline';

/** Une Dérive : le Cycle Time en cours d'un ticket, au-dessus de son Cycle Time de référence. Durées en ms. */
export interface Drift {
  cycleTime: number;
  reference: number;
  /** D'où vient la référence : les Livraisons du même type, ou, faute d'assez, de tout le Projet. */
  scope: 'type' | 'project';
}

/**
 * Les Dérives d'un Projet à l'instant `now`, par ticket. Le Cycle Time de référence d'un ticket est le P85 du Cycle Time des
 * Livraisons du même Projet et du même type, livrées dans les 90 derniers jours (Durée écoulée) ; sous 10, celles de tous les
 * types ; sous 10 encore, il n'y a pas de référence et rien ne dérive.
 */
export function driftsOf(analysis: ProjectAnalysis, now: number): Map<string, Drift> {
  const drifts = new Map<string, Drift>();
  for (const ticket of analysis.tickets) {
    if (!isWorking(ticket.timeline, now)) continue;
    const reference = referenceOf(analysis.tickets, ticket.type, now);
    if (!reference) continue;
    const cycleTime = measure(intersect(ticket.timeline.work, [[Number.NEGATIVE_INFINITY, now]]));
    if (cycleTime > reference.value) drifts.set(ticket.id, { cycleTime, reference: reference.value, scope: reference.scope });
  }
  return drifts;
}

/** La fenêtre des Livraisons de référence : 90 jours de Durée écoulée, jusqu'à `now` exclu (ce qui est daté après n'est pas encore arrivé). */
const REFERENCE_WINDOW = 90 * 24 * 3_600_000;
/** Sous ce nombre de Livraisons démarrées, un P85 ne dit pas ce qui est normal. */
const MIN_REFERENCE = 10;

function referenceOf(tickets: TrackedTicket[], type: string, now: number) {
  const recent = tickets.filter((t) => t.deliveredAt !== null && t.deliveredAt >= now - REFERENCE_WINDOW && t.deliveredAt < now);
  const cycleTimes = (keep: (t: TrackedTicket) => boolean) =>
    recent
      .filter(keep)
      .flatMap((t) => (t.cycleTime === null ? [] : [t.cycleTime]))
      .sort((a, b) => a - b);
  const sameType = cycleTimes((t) => t.type === type);
  if (sameType.length >= MIN_REFERENCE) return { value: percentile(sameType, 85) as number, scope: 'type' as const };
  const project = cycleTimes(() => true);
  if (project.length >= MIN_REFERENCE) return { value: percentile(project, 85) as number, scope: 'project' as const };
  return null;
}
