import type { Messages } from '../i18n';
import type { Format } from '../metrics/format';

/**
 * La prévision de fin d'une Epic, écrite sans fausse précision : une fourchette arrondie dans une unité qui lui convient
 * (jours, semaines, mois), jamais un nombre à décimale ni une heure. Le domaine (`forecastEnd`) donne des millisecondes ; ce
 * qu'une prévision à quelques Livraisons près peut dire de sûr tient en une fourchette et deux chiffres.
 */

const DAY = 86_400_000;
/** Au-delà, une prévision ne dit plus rien de précis. */
const YEAR_DAYS = 365;

/** Les mots de la fourchette (`t.epics.span`) et les formateurs de la langue (`useFormat()`). */
type Words = Messages['epics']['span'];
type Formats = Pick<Format, 'formatCount' | 'formatDay'>;

/** Une durée écrite pour les yeux (« 5 à 8 jours ») et dite pour les lecteurs d'écran (« entre 5 et 8 jours »). */
export interface SpanText {
  text: string;
  spoken: string;
}

const same = (text: string): SpanText => ({ text, spoken: text });

/** « 5 à 8 jours », « environ 4 jours » ; `from` et `to` sont déjà arrondis, `from` ≤ `to`. */
function range(from: number, to: number, unit: string, words: Words, { formatCount }: Formats): SpanText {
  const [low, high] = [formatCount(from), formatCount(to)];
  if (from === to) return { text: words.about(low, unit), spoken: words.aboutSpoken(low, unit) };
  return { text: words.range(low, high, unit), spoken: words.rangeSpoken(low, high, unit) };
}

/**
 * La fin la plus proche est à un an ou plus : la fourchette s'écrit « plus d'un an » et rien d'autre. La page n'écrit alors pas
 * non plus les jours où la fin tomberait : ils diraient, au jour près, ce que la prévision refuse de dire.
 */
export const beyondAYear = (fastest: number): boolean => fastest / DAY >= YEAR_DAYS;

/**
 * Une fourchette de durée (ms), du plus proche au plus lointain, dans la langue de `words` et `format`. Le début est arrondi vers le bas, la fin vers le haut : la
 * fourchette écrite contient toujours celle qui est calculée.
 *
 *   moins de 14 jours     des jours (« 5 à 8 jours », « moins de 3 jours », « moins d'un jour »)
 *   de 14 à 83 jours      des semaines, d'une au moins (« 2 à 5 semaines »)
 *   à partir de 84 jours  des mois de 30 jours, d'un au moins (« 2 à 4 mois »)
 *   un an et plus         « plus d'un an » : au-delà, une prévision ne dit plus rien de précis (`beyondAYear`)
 *
 * L'unité se choisit sur la fin la plus lointaine : c'est elle qui dit la grandeur.
 */
export function describeSpan(fastest: number, slowest: number, words: Words, format: Formats): SpanText {
  const [lo, hi] = [fastest / DAY, slowest / DAY];
  if (beyondAYear(fastest)) return same(words.moreThanAYear);
  if (hi <= 1) return same(words.lessThanADay);
  if (hi < 14) {
    const [from, to] = [Math.floor(lo), Math.ceil(hi)];
    if (from >= 1) return range(from, to, words.days, words, format);
    const count = format.formatCount(to);
    return { text: words.lessThan(count), spoken: words.lessThanSpoken(count) };
  }
  if (hi < 84) return range(Math.max(1, Math.floor(lo / 7)), Math.ceil(hi / 7), words.weeks, words, format);
  return range(Math.max(1, Math.floor(lo / 30)), Math.ceil(hi / 30), words.months, words, format);
}

const pad = (value: number): string => String(value).padStart(2, '0');

/** Le jour (AAAA-MM-JJ) d'un instant, au calendrier du fuseau du navigateur. */
function localDay(ms: number): string {
  const date = new Date(ms);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Les jours où la fin tombe, dans le fuseau du navigateur : « entre le 9 nov. et le 12 nov. 2026 », ou « le 9 nov. 2026 »
 * quand les deux bouts sont le même jour. L'année se met aux deux bouts quand elle change d'un bout à l'autre.
 */
export function finishWindow(from: number, to: number, words: Words, { formatDay }: Formats): string {
  const [first, last] = [localDay(from), localDay(to)];
  if (first === last) return words.on(formatDay(first, { year: true }));
  const crossesYears = first.slice(0, 4) !== last.slice(0, 4);
  return words.between(formatDay(first, { year: crossesYears }), formatDay(last, { year: true }));
}
