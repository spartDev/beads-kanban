import { localDateFormat } from './localDay';

// Une date et une heure du fuseau du navigateur, recalculées à chaque appel (voir `localDateFormat`).
const medium = localDateFormat({ dateStyle: 'medium', timeStyle: 'short' });

/** Un instant ISO 8601 écrit dans le fuseau du navigateur : « 5 oct. 2026, 12:00 » ; vide s'il est illisible. */
export function formatInstant(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : medium(date);
}

/** Le fuseau IANA du navigateur (« Europe/Paris »), celui dans lequel `formatInstant` écrit les heures. */
export const browserTimeZone = (): string => new Intl.DateTimeFormat().resolvedOptions().timeZone;
