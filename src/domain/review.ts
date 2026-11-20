import type { DeclaredStatuses, HandoffStatus, MetricsReview, MetricsReviewFailureRate, MetricsSendBackOrigin } from '../shared/api';
import { resolvePeriod } from './calendar';
import { type MetricsInput, type MetricsOptions, significanceOf, type TrackedTicket } from './metrics';
import { isDeclaredWip, isHandoffStatus } from './statuses';
import type { Step } from './timeline';

/**
 * Mesures de relecture (bdesk-pz0.5, ADR 0007) : Tours de relecture, Retours, Acceptation au premier passage, Couverture de relecture, Tours par
 * Livraison, Taux d'échec après relecture et Retours par origine. Tout se lit dans les Transitions déjà analysées (`TicketTimeline.steps`), sans autre
 * source. Du code pur, comme `computeHealth` : composé avec `computeMetrics` par le service de métriques (`MetricsResponse.review`), il lit les types et
 * la règle de signification de `metrics.ts`, qui ne l'importe pas en retour.
 *
 * Une mesure appartient à la période de la Livraison qu'elle décrit, datée de sa dernière clôture comme le Débit : ni un Abandon ni un Renoncement n'y
 * entrent, et un ticket rouvert puis refermé compte une fois, à sa dernière clôture, avec tous ses Tours et Retours d'avant, ceux d'avant la Réouverture
 * compris.
 */

/** L'Acceptation au premier passage n'est pas significative sous ce nombre de Livraisons relues (CONTEXT.md). */
export const MIN_REVIEWED_DELIVERIES = 10;

/** L'origine d'un Retour, selon le Statut de relais qu'il quitte. */
const ORIGINS: Record<HandoffStatus, MetricsSendBackOrigin> = {
  in_review: 'review',
  in_integration: 'integration',
  awaiting_human: 'validation',
};

/** Ce que les Transitions d'un ticket disent de sa relecture. */
export interface TicketReview {
  /** Tours de relecture : les Transitions vers En relecture. */
  rounds: number;
  /** Retours, par origine. */
  sendBacks: Record<MetricsSendBackOrigin, number>;
}

/**
 * Le statut vers lequel un Retour mène : en cours, rattaché à un agent, ou un autre statut que le Projet déclare de catégorie `wip` (il compte comme en
 * cours, ADR 0007). Un Statut de relais n'en est pas un : passer d'En intégration à En relecture n'est pas un Retour, mais un nouveau Tour. Ni bloqué, ni
 * ouvert (une Prise rendue ou un Report), ni fermé.
 */
const isDevelopment = (status: string, declared: DeclaredStatuses): boolean =>
  status === 'in_progress' || status === 'hooked' || isDeclaredWip(status, declared);

/**
 * Les Tours de relecture et les Retours d'une suite de Transitions, dans l'ordre de l'historique : toutes celles qu'on lui donne. Les métriques lui donnent
 * celles d'une Livraison, qui finissent à sa dernière clôture. Un Tour est une Transition vers En relecture, la première du ticket comprise (un ticket créé
 * En relecture) ; un Retour, une Transition d'un Statut de relais vers en cours, rattaché à un agent ou un statut déclaré `wip` (`isDevelopment`), dont
 * l'origine est le statut qu'il quitte. Deux Transitions qui se suivent ne répètent jamais un statut (`recordedTransitions`).
 *
 * `declared` : les statuts personnalisés que le Projet déclare, qui disent lesquels de ses autres statuts comptent comme en cours.
 */
export function reviewOf(steps: readonly Pick<Step, 'status'>[], declared: DeclaredStatuses): TicketReview {
  const sendBacks: Record<MetricsSendBackOrigin, number> = { review: 0, integration: 0, validation: 0 };
  let rounds = 0;
  steps.forEach(({ status }, index) => {
    if (status === 'in_review') rounds++;
    const from = steps[index - 1]?.status;
    if (from !== undefined && isHandoffStatus(from) && isDevelopment(status, declared)) sendBacks[ORIGINS[from]]++;
  });
  return { rounds, sendBacks };
}

/** Une Livraison de la période, avec sa relecture. */
interface Delivered {
  ticket: TrackedTicket;
  review: TicketReview;
}

/** Les mesures de relecture de la période demandée, sur l'union des tickets des Projets (la Vue globale, ou un seul Projet). */
export function computeReview(projects: MetricsInput[], { period, now, timeZone }: MetricsOptions): MetricsReview {
  const resolved = resolvePeriod(period, now.getTime(), timeZone);
  const [start, end] = [resolved.current.start, resolved.asOf];
  const delivered: Delivered[] = projects.flatMap(({ analysis }) =>
    analysis.tickets
      .filter(({ deliveredAt }) => deliveredAt !== null && deliveredAt >= start && deliveredAt < end)
      .map((ticket) => ({ ticket, review: reviewOf(ticket.timeline.steps, analysis.declaredStatuses) })),
  );

  const reviewed = delivered.filter(({ review }) => review.rounds > 0);
  const accepted = reviewed.filter(({ review }) => totalOf(review.sendBacks) === 0).length;
  const rounds = (min: number, max = Number.POSITIVE_INFINITY) =>
    reviewed.filter(({ review }) => review.rounds >= min && review.rounds <= max).length;
  const sendBacks: Record<MetricsSendBackOrigin, number> = { review: 0, integration: 0, validation: 0 };
  for (const { review } of delivered) {
    for (const origin of Object.keys(sendBacks) as MetricsSendBackOrigin[]) sendBacks[origin] += review.sendBacks[origin];
  }

  return {
    deliveries: delivered.length,
    reviewed: reviewed.length,
    coverage: ratio(reviewed.length, delivered.length),
    firstPassAcceptance: {
      accepted,
      reviewed: reviewed.length,
      rate: ratio(accepted, reviewed.length),
      significant: reviewed.length >= MIN_REVIEWED_DELIVERIES,
      minReviewed: MIN_REVIEWED_DELIVERIES,
    },
    roundsPerDelivery: { one: rounds(1, 1), two: rounds(2, 2), three: rounds(3, 3), fourOrMore: rounds(4) },
    failureRate: {
      ...significanceOf(projects),
      reviewed: failureRateOf(reviewed),
      unreviewed: failureRateOf(delivered.filter(({ review }) => review.rounds === 0)),
    },
    sendBacks,
  };
}

/** Le Taux d'échec d'une partie des Livraisons : celles qui ont au moins un Bug d'origine (`TrackedTicket.failed`), comme la tuile. */
function failureRateOf(deliveries: Delivered[]): MetricsReviewFailureRate {
  const failed = deliveries.filter(({ ticket }) => ticket.failed).length;
  return { deliveries: deliveries.length, failed, rate: ratio(failed, deliveries.length) };
}

const ratio = (part: number, whole: number): number | null => (whole === 0 ? null : part / whole);

const totalOf = (counts: Record<MetricsSendBackOrigin, number>) => counts.review + counts.integration + counts.validation;
