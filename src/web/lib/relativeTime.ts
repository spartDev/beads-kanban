import { calendarDaysAgo, localDateFormat } from './localDay';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Une durée (« il y a 3 h ») ne dépend d'aucun fuseau. */
const relative = new Intl.RelativeTimeFormat('fr', { numeric: 'auto', style: 'short' });
// Les dates en toutes lettres suivent le fuseau courant à chaque appel, comme les jours calendaires : voir `localDateFormat`.
const sameYear = localDateFormat({ day: 'numeric', month: 'short' });
const otherYear = localDateFormat({ day: 'numeric', month: 'short', year: 'numeric' });

/**
 * L'âge d'une date ISO, court et en français.
 *
 * - Sous 24 h, une durée écoulée : « à l'instant », « il y a 5 min », « il y a 3 h ». Elle ne nomme aucun jour : « il y a 23 h »
 *   vaut pour hier comme pour aujourd'hui.
 * - Ensuite, des jours calendaires du fuseau du navigateur (`localDay`), les mêmes que la fenêtre de Terminé : « aujourd'hui »
 *   (un jour de changement d'heure dure 25 h, donc plus de 24 h), « hier », « avant-hier », « il y a 3 j » ; à partir de
 *   14 jours, « il y a 2 sem. » ; à partir de 30, la date (« 5 sept. », avec l'année si ce n'est pas celle de `now`). Le jour
 *   est celui du calendrier, pas le nombre de tranches de 24 h écoulées : « hier » n'est jamais dit d'un événement d'aujourd'hui.
 *
 * Une date qui devance l'horloge compte comme « à l'instant » ; une date illisible ne donne rien.
 */
export function formatAge(iso: string, now: number): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const age = now - then;
  if (age < MINUTE) return 'à l’instant';
  if (age < HOUR) return relative.format(-Math.floor(age / MINUTE), 'minute');
  if (age < DAY) return relative.format(-Math.floor(age / HOUR), 'hour');
  const days = calendarDaysAgo(then, now);
  if (days < 14) return relative.format(-days, 'day');
  if (days < 30) return relative.format(-Math.floor(days / 7), 'week');
  const date = new Date(then);
  return (date.getFullYear() === new Date(now).getFullYear() ? sameYear : otherYear)(date);
}

const dateTime = localDateFormat({ dateStyle: 'long', timeStyle: 'short' });

/** La date complète d'une date ISO (« 5 octobre 2026 à 12:00 »), pour une infobulle ; vide si elle est illisible. */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : dateTime(date);
}
