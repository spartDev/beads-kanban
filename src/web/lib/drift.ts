import type { IssueDrift } from '../data/types';
import { formatDuration } from '../metrics/format';

/** Statuts de travail : en cours, rattaché à un agent, bloqué. Seul un ticket en travail peut dériver. */
const WORK_STATUSES = new Set(['in_progress', 'hooked', 'blocked']);

/** D'où vient le Cycle Time de référence, dans une phrase. */
const REFERENCE_SCOPE = { type: 'des Livraisons du même type', project: 'des Livraisons du Projet' } as const;

/**
 * La Dérive d'un ticket telle que l'écran la montre. La réponse des Dérives peut être en retard sur celle des tickets (deux requêtes, l'une plus
 * lente) : un ticket qui n'est plus en travail ne dérive plus, quoi qu'elle dise.
 */
export function shownDrift(status: string, drift: IssueDrift | undefined): IssueDrift | null {
  return drift !== undefined && WORK_STATUSES.has(status) ? drift : null;
}

/** La phrase d'une Dérive : le Cycle Time en cours, la référence qu'il dépasse, et d'où elle vient. */
export function driftSentence(drift: IssueDrift): string {
  return `${formatDuration(drift.cycleTime)} de Cycle Time en cours, au-delà de ${formatDuration(drift.reference)}, le P85 ${REFERENCE_SCOPE[drift.scope]}`;
}
