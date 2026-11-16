import { formatInstant } from '../lib/instant';
import { formatAge, formatDateTime } from '../lib/relativeTime';
import { FORMATS, type Format } from '../metrics/format';
import type { Language } from './language';

/** Tous les formateurs d'une langue, liés à elle : ceux de `metrics/format.ts`, de `lib/relativeTime.ts` et de `lib/instant.ts`. */
export interface DisplayFormat extends Format {
  /** L'âge d'une date ISO (« il y a 3 h », « 3 hr ago ») ; voir `formatAge`. */
  formatAge: (iso: string, now: number) => string;
  /** La date complète d'une date ISO, pour une infobulle ; voir `formatDateTime`. */
  formatDateTime: (iso: string) => string;
  /** Un instant dans le fuseau du navigateur (« 5 oct. 2026, 12:00 », « Oct 5, 2026, 12:00 ») ; voir `formatInstant`. */
  formatInstant: (iso: string) => string;
}

const displayFormat = (language: Language): DisplayFormat => ({
  ...FORMATS[language],
  formatAge: (iso, now) => formatAge(iso, now, language),
  formatDateTime: (iso) => formatDateTime(iso, language),
  formatInstant: (iso) => formatInstant(iso, language),
});

/** Un objet par langue, créé une fois : `useFormat()` rend toujours le même tant que la langue ne change pas. */
export const FORMATS_BY_LANGUAGE: Record<Language, DisplayFormat> = { fr: displayFormat('fr'), en: displayFormat('en') };
