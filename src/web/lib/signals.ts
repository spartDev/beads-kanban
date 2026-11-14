import type { TicketSignals } from '../data/hooks';
import type { ApiSignal } from '../data/types';
import { formatDecimal, formatDuration } from '../metrics/format';

/** Statuts de travail : en cours, rattaché à un agent, bloqué. Seul un ticket en travail peut dériver ou être en Blocage long. */
const WORK_STATUSES = new Set(['in_progress', 'hooked', 'blocked']);

/** D'où vient le Cycle Time de référence, dans une phrase. */
const REFERENCE_SCOPE = { type: 'des Livraisons du même type', project: 'des Livraisons du Projet' } as const;

/** Le nom de chaque sorte de Signal, dans l'ordre de la page « À regarder ». */
export const SIGNAL_KINDS: ReadonlyArray<{ kind: ApiSignal['kind']; label: string }> = [
  { kind: 'drift', label: 'Dérive' },
  { kind: 'longBlockage', label: 'Blocage long' },
  { kind: 'stagnantReady', label: 'Prêt qui stagne' },
  { kind: 'unusualWip', label: 'WIP inhabituel' },
];

/**
 * Les Signaux d'un ticket tels que l'écran les montre. La réponse des Signaux peut être en retard sur celle des tickets (deux requêtes, l'une plus
 * lente) : un ticket qui n'est plus en travail ne dérive plus et n'est plus en Blocage long, quoi qu'elle dise.
 */
export function shownSignals(status: string, signals: TicketSignals | undefined): TicketSignals {
  return signals !== undefined && WORK_STATUSES.has(status) ? signals : {};
}

/** Ce que dit un Signal, sans le nom de sa sorte ni celui de son ticket : de combien il dépasse la normale. */
export function signalSentence(signal: ApiSignal): string {
  switch (signal.kind) {
    case 'drift':
      return `${formatDuration(signal.cycleTime)} de Cycle Time en cours, au-delà de ${formatDuration(signal.reference)}, le P85 ${REFERENCE_SCOPE[signal.scope]}`;
    case 'longBlockage':
      return `bloqué en cours de travail depuis ${formatDuration(signal.duration)}`;
    case 'stagnantReady':
      return `Prêt depuis ${formatDuration(signal.age)}`;
    case 'unusualWip':
      return `${signal.wip} tickets en cours, au-delà de ${Number.isInteger(signal.threshold) ? signal.threshold : formatDecimal(signal.threshold, 1)}, le P85 du WIP quotidien des 90 derniers jours`;
  }
}
