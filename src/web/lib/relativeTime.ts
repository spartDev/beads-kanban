import type { Language } from '../i18n/language';
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
 *
 * En anglais (`language` = 'en'), les mêmes seuils, écrits à la main : « just now », « 5 min ago », « 3 hr ago », « today »,
 * « yesterday », « 3 days ago », « 2 wk ago », « Sep 5 » (« Sep 5, 2025 » une autre année).
 */
export function formatAge(iso: string, now: number, language: Language = 'fr'): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  return AGE_WRITERS[language](then, now);
}

function frenchAge(then: number, now: number): string {
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

/**
 * La date complète d'une date ISO (« 5 octobre 2026 à 12:00 », en anglais « October 5, 2026 at 12:00 »), dans le fuseau du
 * navigateur, pour une infobulle ; vide si elle est illisible.
 */
export function formatDateTime(iso: string, language: Language = 'fr'): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : DATE_TIME_WRITERS[language](date);
}

/* --- Anglais : écrit à la main, sans Intl (ADR 0006), avec les champs du calendrier local que `Date` lit à chaque appel ------- */

export const ENGLISH_MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

function englishAge(then: number, now: number): string {
  const age = now - then;
  if (age < MINUTE) return 'just now';
  if (age < HOUR) return `${Math.floor(age / MINUTE)} min ago`;
  if (age < DAY) return `${Math.floor(age / HOUR)} hr ago`;
  const days = calendarDaysAgo(then, now);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} wk ago`;
  const date = new Date(then);
  const day = `${ENGLISH_MONTHS[date.getMonth()]?.slice(0, 3) ?? ''} ${date.getDate()}`;
  return date.getFullYear() === new Date(now).getFullYear() ? day : `${day}, ${date.getFullYear()}`;
}

/** L'heure locale sur 24 h (« 09:05 »). */
export const clockTime = (date: Date): string =>
  `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

/** Un écrivain par langue : une langue ajoutée à `LANGUAGES` sans le sien ne compile pas. */
const AGE_WRITERS: Record<Language, (then: number, now: number) => string> = { fr: frenchAge, en: englishAge };

const DATE_TIME_WRITERS: Record<Language, (date: Date) => string> = {
  fr: (date) => dateTime(date),
  en: (date) => `${ENGLISH_MONTHS[date.getMonth()] ?? ''} ${date.getDate()}, ${date.getFullYear()} at ${clockTime(date)}`,
};
