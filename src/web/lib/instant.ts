import { FALLBACK_TIME_ZONE, isKnownTimeZone } from '../../domain/time-zone';
import { localDateFormat } from './localDay';

// Une date et une heure du fuseau du navigateur, recalculées à chaque appel (voir `localDateFormat`).
const medium = localDateFormat({ dateStyle: 'medium', timeStyle: 'short' });

/** Un instant ISO 8601 écrit dans le fuseau du navigateur : « 5 oct. 2026, 12:00 » ; vide s'il est illisible. */
export function formatInstant(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : medium(date);
}

/**
 * Le fuseau IANA du navigateur (« Europe/Paris »), celui dans lequel `formatInstant` écrit les heures et celui des jours que la page
 * demande au serveur de compter : toujours un nom qu'`Intl` construit, que le domaine peut donc recevoir sans lever de `RangeError`.
 * Le moteur n'en rend pas toujours un pour son fuseau local : `Etc/Unknown` quand TZ est vide (un navigateur lancé ainsi), `undefined` quand
 * il ne sait pas le nommer (`Invalid/Zone`). Alors UTC, ce que `Date` applique aussi quand TZ est vide ou invalide. Un TZ en notation
 * POSIX (`EST5`) garde, pour `Date`, son décalage : le kanban compte dedans, et la page Métriques en UTC.
 */
export const browserTimeZone = (): string => {
  const name: unknown = new Intl.DateTimeFormat().resolvedOptions().timeZone; // typé `string`, mais `undefined` quand le moteur ne le nomme pas
  return isKnownTimeZone(name) ? name : FALLBACK_TIME_ZONE;
};
