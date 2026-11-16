/**
 * Les nombres, durées et dates de l'interface, écrits pour un lecteur français ou anglais (ADR 0006), une notation par langue.
 *
 * En français : virgule décimale, espace insécable pour grouper les milliers et entre un nombre et son unité (« 3,4 j » ne se
 * coupe pas en fin de ligne), moins typographique. En anglais, conventions américaines : point décimal, virgule des milliers,
 * « 19% » collé, mois devant le jour (« Oct 4, 2026 ») ; les heures restent sur 24 h. Les unités gardent l'espace insécable.
 *
 * Les mois et les jours de la semaine sont écrits ici plutôt que lus d'Intl : le texte affiché, et donc les tests,
 * ne changent pas d'une version d'ICU à l'autre. Seuls les fuseaux horaires passent par Intl.
 *
 * `FORMATS[langue]` donne les formateurs d'une langue (dans un composant : `useFormat()` de `i18n`) ; les exports nommés
 * (`formatDuration`…) sont ceux du français, en attendant que chaque zone passe par `useFormat()`.
 */
import type { Language } from '../i18n/language';

const NBSP = '\u00a0';
const MINUS = '\u2212';
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const DASH = '\u2014';

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function splitDay(day: string): { year: number; month: number; date: number } {
  const match = DAY_PATTERN.exec(day);
  if (!match) throw new RangeError(`Jour AAAA-MM-JJ attendu, reçu « ${day} »`);
  return { year: Number(match[1]), month: Number(match[2]), date: Number(match[3]) };
}

type SpokenUnit = 'minute' | 'hour' | 'day' | 'point';

/** Ce qui change d'une langue à l'autre ; les règles d'arrondi et le choix des unités sont communs. */
interface Notation {
  decimal: string;
  group: string;
  /** Entre un pourcentage et « % » : insécable en français, rien en anglais. */
  percentGap: string;
  /** Heures et minutes restantes, sous un jour (les minutes ne sont jamais 0). */
  hoursAndMinutes: (hours: number, minutes: number) => string;
  /** Unité des jours (« j », « d »). */
  dayUnit: string;
  /** L'unité en toutes lettres, accordée au nombre (déjà arrondi) qu'elle suit. */
  spokenUnit: (count: number, unit: SpokenUnit) => string;
  unknownDuration: string;
  lessThanAMinute: string;
  /** Un jour du calendrier : nom du jour de la semaine, quantième, mois et année, chacun facultatif sauf le quantième et le mois. */
  day: (parts: { weekday?: string; date: number; month: string; year?: number }) => string;
  months: readonly string[];
  weekdays: readonly string[];
}

const FRENCH_UNITS: Record<SpokenUnit, string> = { minute: 'minute', hour: 'heure', day: 'jour', point: 'point' };
const ENGLISH_UNITS: Record<SpokenUnit, string> = { minute: 'minute', hour: 'hour', day: 'day', point: 'point' };

const FRENCH: Notation = {
  decimal: ',',
  group: NBSP,
  percentGap: NBSP,
  hoursAndMinutes: (hours, minutes) => `${hours}${NBSP}h${NBSP}${String(minutes).padStart(2, '0')}`,
  dayUnit: 'j',
  // Singulier sous 2 (« 1,5 jour »), comme le français.
  spokenUnit: (count, unit) => `${FRENCH_UNITS[unit]}${count >= 2 ? 's' : ''}`,
  unknownDuration: 'durée inconnue',
  lessThanAMinute: 'moins d\u2019une minute',
  day: ({ weekday, date, month, year }) => [weekday ?? '', String(date), month, year === undefined ? '' : String(year)].filter(Boolean).join(' '),
  months: ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'],
  weekdays: ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'],
};

const ENGLISH: Notation = {
  decimal: '.',
  group: ',',
  percentGap: '',
  hoursAndMinutes: (hours, minutes) => `${hours}${NBSP}h${NBSP}${minutes}${NBSP}min`,
  dayUnit: 'd',
  // Singulier pour 1 exactement (« 1 day », « 1.5 days »), comme l'anglais.
  spokenUnit: (count, unit) => `${ENGLISH_UNITS[unit]}${count === 1 ? '' : 's'}`,
  unknownDuration: 'unknown duration',
  lessThanAMinute: 'less than a minute',
  day: ({ weekday, date, month, year }) => `${weekday ? `${weekday}, ` : ''}${month} ${date}${year === undefined ? '' : `, ${year}`}`,
  months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  weekdays: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
};

/** Les formateurs d'une langue. */
export interface Format {
  /** Nombre arrondi à `digits` décimales, sans zéro inutile (« 10 », pas « 10,0 »). */
  formatDecimal: (value: number, digits?: number) => string;
  /** Entier groupé par milliers. */
  formatCount: (value: number) => string;
  /** Écart signé : « +55 », « −3 », « 0 » quand l'arrondi l'efface. */
  formatSigned: (value: number, digits?: number) => string;
  /**
   * Durée arrondie à la minute avant de choisir l'unité : minutes sous une heure, heures et minutes sous un jour, jours
   * au-delà (une décimale sous 10 jours). 59 min 40 s font « 1 h », pas « 60 min ». Sous 30 s, « < 1 min » : un lecteur d'écran
   * le lirait tel quel, la version dite est `spokenDuration` (« moins d'une minute »). Dans une page, une durée mesurée que les
   * lecteurs d'écran lisent s'écrit avec `DurationText` (ou `SpokenText`) : le chevron leur est caché, les mots leur sont dits. Seul un
   * texte déjà caché aux lecteurs d'écran (`aria-hidden` : l'infobulle d'un graphique, les étiquettes d'un dessin) peut l'écrire seule.
   */
  formatDuration: (ms: number | null | undefined) => string;
  /** Écart de durées, signé ; sous la minute, l'arrondi l'efface. */
  formatSignedDuration: (ms: number) => string;
  /** Durée telle qu'on la dit : unités en toutes lettres, accordées au nombre. */
  spokenDuration: (ms: number) => string;
  /**
   * Part de 0 à 1 écrite en pourcentage : « 19 % », « 1,6 % » (une décimale sous 10 %, aucune au-delà). Avec `precise`,
   * une décimale partout, car 12,5 % et 13 % ne se valent pas quand on suit un taux de période en période.
   */
  formatPercent: (ratio: number | null | undefined, options?: { precise?: boolean }) => string;
  /** Différence de deux parts de 0 à 1, en points de pourcentage, signée (« −9,5 pts »). */
  formatPoints: (delta: number) => string;
  /** Écart de deux parts de 0 à 1, tel qu'on le dit : « 9,5 points », « 1 point ». */
  spokenPoints: (magnitude: number) => string;
  /** Un jour du calendrier, « 4 oct. » ; avec l'année (« 4 oct. 2026 ») ou le jour de la semaine (« dim. 4 oct. »). */
  formatDay: (day: string, options?: { year?: boolean; weekday?: boolean }) => string;
  /** Une plage de jours, l'année une fois à la fin (« 4 oct. – 2 nov. 2026 »), aux deux bouts quand elle change. */
  formatDayRange: (from: string, to: string) => string;
}

function makeFormat(notation: Notation): Format {
  /** Groupe par trois chiffres la partie entière d'un nombre écrit (« 1234,5 » donne « 1 234,5 »). */
  const groupDigits = (text: string): string => {
    const [integer = '', fraction] = text.split(notation.decimal);
    const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, notation.group);
    return fraction === undefined ? grouped : `${grouped}${notation.decimal}${fraction}`;
  };

  const formatDecimal = (value: number, digits = 1): string => {
    if (!isNumber(value)) return DASH;
    const fixed = value.toFixed(digits);
    if (Number(fixed) === 0) return '0';
    const trimmed = fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed;
    return trimmed.replace('.', notation.decimal).replace('-', MINUS);
  };

  const formatCount = (value: number): string => {
    if (!isNumber(value)) return DASH;
    const rounded = Math.round(value);
    return `${rounded < 0 ? MINUS : ''}${groupDigits(String(Math.abs(rounded)))}`;
  };

  /** Le nombre qu'un texte écrit par `formatDecimal` représente, pour accorder l'unité qui le suit. */
  const valueOf = (text: string): number => Number(text.replace(notation.decimal, '.'));

  /** Jours : une décimale sous 10, entiers au-delà. 9,96 jours font « 10 », jamais « 10,0 ». */
  const days = (value: number): string => {
    const tenths = Math.round(value * 10) / 10;
    return tenths < 10 ? formatDecimal(tenths, 1) : String(Math.round(value));
  };

  const formatDuration = (ms: number | null | undefined): string => {
    if (!isNumber(ms)) return DASH;
    const value = Math.max(0, ms);
    const minutes = Math.round(value / MIN);
    if (minutes < 1) return `< 1${NBSP}min`;
    if (minutes < 60) return `${minutes}${NBSP}min`;
    if (minutes < 24 * 60) {
      const [hours, rest] = [Math.floor(minutes / 60), minutes % 60];
      return rest === 0 ? `${hours}${NBSP}h` : notation.hoursAndMinutes(hours, rest);
    }
    return `${days(value / DAY)}${NBSP}${notation.dayUnit}`;
  };

  /** Pourcentage lisible d'un nombre de 0 à 100 : une décimale sous 10, aucune au-delà. */
  const percentNumber = (percent: number): string => {
    const rounded = Math.round(percent * 10) / 10;
    return rounded < 10 ? formatDecimal(rounded, 1) : String(Math.round(percent));
  };

  const formatDay = (day: string, { year = false, weekday = false }: { year?: boolean; weekday?: boolean } = {}): string => {
    const parts = splitDay(day);
    const name = notation.weekdays[new Date(Date.UTC(parts.year, parts.month - 1, parts.date)).getUTCDay()] ?? '';
    return notation.day({
      weekday: weekday ? name : undefined,
      date: parts.date,
      month: notation.months[parts.month - 1] ?? '',
      year: year ? parts.year : undefined,
    });
  };

  return {
    formatDecimal,
    formatCount,
    formatSigned(value, digits = 0) {
      if (!isNumber(value)) return DASH;
      const rounded = Number(value.toFixed(digits));
      if (rounded === 0) return '0';
      const magnitude = digits === 0 ? formatCount(Math.abs(rounded)) : groupDigits(formatDecimal(Math.abs(rounded), digits));
      return `${rounded > 0 ? '+' : MINUS}${magnitude}`;
    },
    formatDuration,
    formatSignedDuration(ms) {
      if (!isNumber(ms)) return DASH;
      if (Math.round(Math.abs(ms) / MIN) < 1) return `0${NBSP}min`;
      return `${ms > 0 ? '+' : MINUS}${formatDuration(Math.abs(ms))}`;
    },
    spokenDuration(ms) {
      if (!isNumber(ms)) return notation.unknownDuration;
      const value = Math.max(0, ms);
      const minutes = Math.round(value / MIN);
      const said = (count: number, unit: SpokenUnit) => `${count} ${notation.spokenUnit(count, unit)}`;
      if (minutes < 1) return notation.lessThanAMinute;
      if (minutes < 60) return said(minutes, 'minute');
      if (minutes < 24 * 60) {
        const [hours, rest] = [Math.floor(minutes / 60), minutes % 60];
        return `${said(hours, 'hour')}${rest === 0 ? '' : ` ${said(rest, 'minute')}`}`;
      }
      const text = days(value / DAY);
      return `${text} ${notation.spokenUnit(valueOf(text), 'day')}`;
    },
    formatPercent(ratio, { precise = false } = {}) {
      if (!isNumber(ratio)) return DASH;
      const text = precise ? formatDecimal(Math.round(ratio * 1000) / 10, 1) : percentNumber(ratio * 100);
      return `${text}${notation.percentGap}%`;
    },
    formatPoints(delta) {
      if (!isNumber(delta)) return DASH;
      const points = delta * 100;
      if (Math.round(Math.abs(points) * 10) === 0) return `0${NBSP}pts`;
      return `${points > 0 ? '+' : MINUS}${percentNumber(Math.abs(points))}${NBSP}pts`;
    },
    spokenPoints(magnitude) {
      const text = percentNumber(Math.abs(magnitude) * 100);
      return `${text} ${notation.spokenUnit(valueOf(text), 'point')}`;
    },
    formatDay,
    formatDayRange(from, to) {
      if (from === to) return formatDay(from, { year: true });
      const crossesYears = splitDay(from).year !== splitDay(to).year;
      return `${formatDay(from, { year: crossesYears })} – ${formatDay(to, { year: true })}`;
    },
  };
}

/** Les formateurs de chaque langue. */
export const FORMATS: Record<Language, Format> = { fr: makeFormat(FRENCH), en: makeFormat(ENGLISH) };

/** Les formateurs français, sous leurs noms d'avant le catalogue : les zones pas encore traduites les importent ainsi. */
export const {
  formatDecimal,
  formatCount,
  formatSigned,
  formatDuration,
  formatSignedDuration,
  spokenDuration,
  formatPercent,
  formatPoints,
  spokenPoints,
  formatDay,
  formatDayRange,
} = FORMATS.fr;

/* --- Heures (indépendantes de la langue : 24 h partout) ---------------------------------------------------------- */

const formatters = new Map<string, Intl.DateTimeFormat>();

function zoneFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** Les champs de la date et de l'heure d'un instant, lus dans le fuseau (jamais celui du navigateur). */
function wallClock(instant: string, timeZone: string): Record<'year' | 'month' | 'day' | 'hour' | 'minute', string> {
  const fields = { year: '', month: '', day: '', hour: '', minute: '' };
  for (const part of zoneFormatter(timeZone).formatToParts(new Date(instant))) {
    if (part.type in fields) fields[part.type as keyof typeof fields] = part.value;
  }
  return fields;
}

/** Le jour (AAAA-MM-JJ) auquel appartient l'instant dans le fuseau. */
export function dayInZone(instant: string, timeZone: string): string {
  const { year, month, day } = wallClock(instant, timeZone);
  return `${year}-${month}-${day}`;
}

/** L'heure d'un instant dans le fuseau, sur 24 heures (« 20:00 »). */
export function formatTime(instant: string, timeZone: string): string {
  const { hour, minute } = wallClock(instant, timeZone);
  return `${hour}:${minute}`;
}

/**
 * Typographie d'une phrase écrite par le serveur (« 19 % des bugs… ») : une espace insécable entre le nombre et « % »,
 * pour qu'une fin de ligne ne les sépare pas. Le sens du texte n'est pas touché.
 */
export function tidy(sentence: string): string {
  return sentence.replace(/(\d) %/g, `$1${NBSP}%`);
}
