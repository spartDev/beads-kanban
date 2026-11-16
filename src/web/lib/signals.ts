import type { TicketSignals } from '../data/hooks';
import type { ApiSignal } from '../data/types';
import { CATALOGS } from '../i18n/catalog';
import type { Language } from '../i18n/language';
import { FORMATS } from '../metrics/format';

/** Statuts de travail : en cours, rattaché à un agent, bloqué. Seul un ticket en travail peut dériver ou être en Blocage long. */
const WORK_STATUSES = new Set(['in_progress', 'hooked', 'blocked']);

/** Les sortes de Signal, dans l'ordre de la page « À regarder ». */
const KINDS: readonly ApiSignal['kind'][] = ['drift', 'longBlockage', 'stagnantReady', 'unusualWip'];

/** Le nom de chaque sorte de Signal, dans l'ordre de la page « À regarder », dans une langue (`t.shell.signals.kinds`). */
export const signalKinds = (language: Language): ReadonlyArray<{ kind: ApiSignal['kind']; label: string }> =>
  KINDS.map((kind) => ({ kind, label: CATALOGS[language].shell.signals.kinds[kind] }));

/** Le nom de chaque sorte de Signal, en français : pour les zones pas encore traduites (les autres prennent `signalKinds(language)`). */
export const SIGNAL_KINDS = signalKinds('fr');

/**
 * Les Signaux d'un ticket tels que l'écran les montre. La réponse des Signaux peut être en retard sur celle des tickets (deux requêtes, l'une plus
 * lente) : un ticket qui n'est plus en travail ne dérive plus et n'est plus en Blocage long, quoi qu'elle dise.
 */
export function shownSignals(status: string, signals: TicketSignals | undefined): TicketSignals {
  return signals !== undefined && WORK_STATUSES.has(status) ? signals : {};
}

/** Ce que dit un Signal, sans le nom de sa sorte ni celui de son ticket : de combien il dépasse la normale. Dans la langue de l'interface. */
export function signalSentence(signal: ApiSignal, language: Language = 'fr'): string {
  const t = CATALOGS[language].shell.signals;
  const { formatDuration, formatDecimal, formatCount } = FORMATS[language];
  switch (signal.kind) {
    case 'drift':
      return t.drift(formatDuration(signal.cycleTime), formatDuration(signal.reference), t.scopes[signal.scope]);
    case 'longBlockage':
      return t.longBlockage(formatDuration(signal.duration));
    case 'stagnantReady':
      return t.stagnantReady(formatDuration(signal.age));
    case 'unusualWip':
      return t.unusualWip(
        formatCount(signal.wip),
        Number.isInteger(signal.threshold) ? formatCount(signal.threshold) : formatDecimal(signal.threshold, 1),
        signal.wip,
      );
  }
}
