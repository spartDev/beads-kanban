import type { EpicProgress } from '../../domain/epics';
import type { DisplayFormat, Messages } from '../i18n';
import type { ClosedUndelivered } from '../i18n/catalog/epics';

/** Ce que sont les Enfants fermés sans Livraison : des Abandons, des Renoncements, les deux, ou rien (aucun). */
export function closedUndeliveredKind({ abandoned, declined }: Pick<EpicProgress, 'abandoned' | 'declined'>): ClosedUndelivered | null {
  if (abandoned > 0 && declined > 0) return 'both';
  if (declined > 0) return 'declined';
  return abandoned > 0 ? 'dropped' : null;
}

/**
 * « 2 Abandons », « 1 Renoncement », « 2 Abandons et 1 Renoncement » : les Enfants fermés sans Livraison, comptés, les Abandons d'abord ;
 * vide quand il n'y en a aucun.
 */
export function closedUndelivered(
  { abandoned, declined }: Pick<EpicProgress, 'abandoned' | 'declined'>,
  t: Messages,
  { formatCount }: Pick<DisplayFormat, 'formatCount'>,
): string {
  const { counted, progress } = t.epics;
  const parts = [
    abandoned > 0 ? counted.dropped(abandoned, formatCount(abandoned)) : null,
    declined > 0 ? counted.declined(declined, formatCount(declined)) : null,
  ].filter((part) => part !== null);
  const [first = '', second] = parts;
  return second === undefined ? first : progress.and(first, second);
}
