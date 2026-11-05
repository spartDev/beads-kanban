import type { MetricsBucketUnit, MetricsRange, MetricsRangePreset } from '../shared/api';
import { lruMemo } from './lru';
import { MAX_ZONE_FORMATTERS } from './time-zone';

/**
 * Jours et périodes d'un fuseau horaire. Les métriques découpent le temps en jours du fuseau local de l'utilisateur :
 * une Livraison à 00:30 heure de Paris appartient au jour qui commence, pas à celui que UTC croit encore en cours.
 * Le fuseau est un paramètre (nom IANA), jamais l'environnement : le domaine reste pur et se teste sous n'importe quel fuseau.
 */

/** Un jour du calendrier civil, `AAAA-MM-JJ` : se compare et se trie comme du texte. */
export type CivilDay = string;

/** Une période choisie par l'utilisateur : les N derniers jours, ou une plage de jours à bornes incluses. */
export type PeriodSpec = { range: MetricsRangePreset } | { from: string; to: string };

/** Période de jours entiers : de `start` (minuit local de `from`, inclus) à `end` (minuit local suivant `to`, exclu). */
export interface Period {
  from: CivilDay;
  to: CivilDay;
  days: number;
  /** ms epoch */
  start: number;
  /** ms epoch */
  end: number;
}

/** Une tranche de la période : un jour, ou une semaine commençant le lundi, tronquée aux bords de la période. */
export type BucketSpan = Period;

export interface ResolvedPeriod {
  range: MetricsRange;
  current: Period;
  /** Les mêmes nombres de jours, juste avant `current`. */
  previous: Period;
  unit: MetricsBucketUnit;
  /**
   * L'instant où la période est mesurée : maintenant tant qu'elle court (elle va jusqu'à aujourd'hui), sinon sa fin.
   * La période n'est comptée que de `current.start` à `asOf`, fin exclue : ce qui est daté plus tard, jusqu'à minuit
   * (l'horloge d'un commit en avance), n'est pas encore arrivé. Pour une période finie, `asOf` est `current.end` : rien
   * n'est écarté.
   */
  asOf: number;
  /**
   * L'instant de `previous` qui correspond à `asOf` : la même durée écoulée depuis le début de la période. Une période
   * qui court encore n'est pas finie, et la comparer à la précédente entière la ferait paraître en recul d'autant : la
   * comparaison met [`current.start`, `asOf`) en face de [`previous.start`, `previousAsOf`), deux fenêtres de même durée
   * aux bornes symétriques. Pour une période finie, c'est `previous.end`.
   */
  previousAsOf: number;
}

/** Une période d'au plus `MAX_DAILY_BUCKET_DAYS` jours se découpe par jour ; au-delà, par semaine. */
export const MAX_DAILY_BUCKET_DAYS = 31;
/** Au-delà d'un an, une plage personnalisée est refusée : le CFD a un point par jour. */
export const MAX_PERIOD_DAYS = 366;
/**
 * Le premier jour qu'une plage personnalisée peut contenir. Aucun historique Dolt n'est plus ancien, et plus tôt les dates ne se
 * calculent plus juste : `Date.UTC(20, …)` lit l'an 20 comme 1920 (les années 0 à 99 y sont décalées de 1900), et `offsetAt` se
 * trompe de 1900 ans pour les instants de ces années-là, donc pour le début d'une période qui commence le 1er janvier de l'an 100.
 * `resolvePeriod` refuse une plage qui commence avant ce jour, sans rien compter dessus ; la page importe la même borne
 * (src/web/metrics/params.ts) et refuse la même plage avant de la demander. Un préréglage part d'aujourd'hui : il n'est pas concerné.
 */
export const MIN_CUSTOM_DAY: CivilDay = '1970-01-01';

const PRESET_DAYS: Record<MetricsRangePreset, number> = { '7d': 7, '30d': 30, '90d': 90 };
const DAY_MS = 86_400_000;

/** Période ou plage refusée : l'appelant la rend à l'utilisateur telle quelle (400). */
export class InvalidPeriodError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidPeriodError';
  }
}

/** Le jour du fuseau auquel appartient l'instant (ms epoch). */
export function dayOf(instant: number, timeZone: string): CivilDay {
  const { year, month, day } = wallClock(instant, timeZone);
  return formatDay(year, month, day);
}

/**
 * Selon le fuseau, minuit local d'un jour tombe de 14 h avant à 12 h après minuit UTC de ce jour (de UTC+14 à UTC−12).
 * `startOfDay` lit le décalage du fuseau 16 h avant et 16 h après : s'il y est le même, aucun changement d'heure ne
 * touche ce minuit-là ; sinon il y en a un entre les deux.
 */
const MIDNIGHT_WINDOW = 16 * 3_600_000;

/**
 * Le premier instant (ms epoch) du jour dans le fuseau, c'est-à-dire le plus petit instant qui tombe dans ce jour.
 * D'ordinaire son minuit local. Quand les horloges changent d'heure autour de minuit, il y a deux cas :
 * - minuit se répète (l'horloge recule de 01:00 à 00:00) : le jour commence au premier minuit ;
 * - minuit n'existe pas (l'horloge saute de 00:00 à 01:00) : le jour commence à l'instant du saut.
 * Un jour dure donc 23, 24 ou 25 heures. Si un saut efface le jour entier (Samoa, 30 décembre 2011), il commence là où
 * le suivant commence, et dure 0 ms.
 */
export function startOfDay(day: CivilDay, timeZone: string): number {
  const { year, month, date } = parseDay(day);
  const wall = Date.UTC(year, month - 1, date); // l'heure locale cherchée, lue comme si c'était de l'UTC
  const [from, to] = [wall - MIDNIGHT_WINDOW, wall + MIDNIGHT_WINDOW];
  const [early, late] = [offsetAt(from, timeZone), offsetAt(to, timeZone)];
  if (early === late) return wall - early; // pas de changement d'heure autour de minuit : un seul minuit

  const jump = firstInstantWithOffset(late, from, to, timeZone); // là où le décalage passe de `early` à `late`
  const firstMidnight = wall - early; // minuit au décalage d'avant le saut : il existe s'il le précède
  const secondMidnight = wall - late; // minuit au décalage d'après : il existe s'il le suit
  if (firstMidnight < jump) return firstMidnight; // y compris quand minuit se répète : le premier des deux
  return Math.max(secondMidnight, jump); // minuit n'existe plus qu'après le saut, ou pas du tout : le jour commence au saut
}

/**
 * Le premier instant de ]`from`, `to`] où le décalage du fuseau vaut `offset`, à la seconde près (les changements d'heure
 * tombent sur une seconde entière). Le décalage change une seule fois dans l'intervalle : il ne vaut pas `offset` en
 * `from`, et le vaut en `to`.
 */
function firstInstantWithOffset(offset: number, from: number, to: number, timeZone: string): number {
  let [low, high] = [from, to];
  while (high - low > 1000) {
    const middle = low + Math.floor((high - low) / 2000) * 1000;
    if (offsetAt(middle, timeZone) === offset) high = middle;
    else low = middle;
  }
  return high;
}

/** Le jour `n` jours plus tard (ou plus tôt, si `n` est négatif) : de l'arithmétique de calendrier, sans fuseau. */
export function addDays(day: CivilDay, n: number): CivilDay {
  const { year, month, date } = parseDay(day);
  const shifted = new Date(Date.UTC(year, month - 1, date + n));
  return formatDay(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

/**
 * Les bornes de la période demandée, et de la période précédente de même durée. Un préréglage couvre les N derniers
 * jours, aujourd'hui compris ; une plage personnalisée a ses deux bornes incluses, et commence au plus tôt le
 * `MIN_CUSTOM_DAY`. Elle est comptée jusqu'à `asOf` (maintenant tant qu'elle court, sa fin sinon), et la précédente jusqu'à
 * `previousAsOf`, à la même durée écoulée.
 */
export function resolvePeriod(spec: PeriodSpec, now: number, timeZone: string): ResolvedPeriod {
  const today = dayOf(now, timeZone);
  const [range, from, to] =
    'range' in spec
      ? ([spec.range, addDays(today, 1 - PRESET_DAYS[spec.range]), today] as const)
      : (['custom', checkedDay(spec.from, 'from'), checkedDay(spec.to, 'to')] as const);

  if (from > to) throw new InvalidPeriodError(`La plage commence après sa fin : « from » (${from}) doit être avant « to » (${to}).`);
  if (to > today) throw new InvalidPeriodError(`« to » (${to}) est dans le futur : la plage ne peut pas dépasser aujourd'hui (${today}).`);
  // Avant de compter quoi que ce soit : `daysBetween` et `periodOf` se trompent sur les premières années (voir `MIN_CUSTOM_DAY`).
  if (range === 'custom' && from < MIN_CUSTOM_DAY) {
    throw new InvalidPeriodError(`La plage doit commencer le 1er janvier 1970 ou après : « from » (${from}) est trop tôt.`);
  }
  const days = daysBetween(from, to) + 1;
  if (days > MAX_PERIOD_DAYS) {
    throw new InvalidPeriodError(`La plage est trop longue : ${days} jours, au plus ${MAX_PERIOD_DAYS}.`);
  }

  const previousTo = addDays(from, -1);
  const current = periodOf(from, to, timeZone);
  const previous = periodOf(addDays(previousTo, 1 - days), previousTo, timeZone);
  const asOf = Math.min(current.end, now);
  // Les jours de 23 ou 25 h font varier la durée d'une période d'une heure : jamais au-delà de la fin de la précédente.
  const previousAsOf = asOf >= current.end ? previous.end : Math.min(previous.end, previous.start + (asOf - current.start));
  return { range, current, previous, unit: days <= MAX_DAILY_BUCKET_DAYS ? 'day' : 'week', asOf, previousAsOf };
}

/** Les jours de la période, du premier au dernier. */
export function daysOf(period: Period): CivilDay[] {
  return Array.from({ length: period.days }, (_, i) => addDays(period.from, i));
}

/**
 * Les tranches de la période, sans trou : un jour chacune, ou une semaine (du lundi au dimanche) tronquée aux bords de
 * la période, de sorte qu'une semaine commencée avant `from` ou finie après `to` compte moins de 7 jours.
 */
export function bucketsOf(period: Period, unit: MetricsBucketUnit, timeZone: string): BucketSpan[] {
  const buckets: BucketSpan[] = [];
  for (let from = period.from; from <= period.to; ) {
    const lastDay = unit === 'day' ? from : addDays(from, 6 - weekdayIndex(from)); // dimanche
    const to = lastDay < period.to ? lastDay : period.to;
    buckets.push(periodOf(from, to, timeZone));
    from = addDays(to, 1);
  }
  return buckets;
}

function periodOf(from: CivilDay, to: CivilDay, timeZone: string): Period {
  return {
    from,
    to,
    days: daysBetween(from, to) + 1,
    start: startOfDay(from, timeZone),
    end: startOfDay(addDays(to, 1), timeZone),
  };
}

/** 0 pour le lundi, 6 pour le dimanche. */
function weekdayIndex(day: CivilDay): number {
  const { year, month, date } = parseDay(day);
  return (new Date(Date.UTC(year, month - 1, date)).getUTCDay() + 6) % 7;
}

function daysBetween(from: CivilDay, to: CivilDay): number {
  const a = parseDay(from);
  const b = parseDay(to);
  return (Date.UTC(b.year, b.month - 1, b.date) - Date.UTC(a.year, a.month - 1, a.date)) / DAY_MS;
}

const DAY_FORMAT = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Un jour `AAAA-MM-JJ` qui existe au calendrier, quelle que soit l'année ; refuse `2026-1-5` comme `2026-02-30`. */
function checkedDay(value: string, name: string): CivilDay {
  const match = DAY_FORMAT.exec(value);
  if (match) {
    const [year, month, date] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const real = utcMidnight(year, month, date);
    if (real.getUTCFullYear() === year && real.getUTCMonth() === month - 1 && real.getUTCDate() === date) return value;
  }
  throw new InvalidPeriodError(`« ${name} » doit être un jour qui existe, au format AAAA-MM-JJ : reçu « ${value} ».`);
}

/**
 * Minuit UTC de ce jour du calendrier. `Date.UTC(20, …)` lirait l'an 20 comme 1920 : `setUTCFullYear` prend l'année telle
 * quelle, pour que « 0020-01-01 » soit reconnu pour ce qu'il est, un jour qui existe mais d'avant `MIN_CUSTOM_DAY`.
 */
function utcMidnight(year: number, month: number, date: number): Date {
  const day = new Date(0);
  day.setUTCFullYear(year, month - 1, date);
  return day;
}

function parseDay(day: CivilDay): { year: number; month: number; date: number } {
  const [year = 0, month = 0, date = 0] = day.split('-').map(Number);
  return { year, month, date };
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');
const formatDay = (year: number, month: number, day: number): CivilDay => `${pad(year, 4)}-${pad(month)}-${pad(day)}`;

/** Le formateur d'un fuseau : un cache borné (le fuseau d'une requête vient du client), voir `lruMemo`. */
const formatterOf = lruMemo(
  MAX_ZONE_FORMATTERS,
  (timeZone: string) =>
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }),
);

/** L'heure du mur dans le fuseau à cet instant. */
function wallClock(instant: number, timeZone: string) {
  const formatter = formatterOf(timeZone);
  const parts = Object.fromEntries(formatter.formatToParts(instant).map((part) => [part.type, part.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/** Décalage du fuseau par rapport à UTC à cet instant, en ms (positif à l'est de Greenwich). */
function offsetAt(instant: number, timeZone: string): number {
  const { year, month, day, hour, minute, second } = wallClock(instant, timeZone);
  return Date.UTC(year, month - 1, day, hour, minute, second) - Math.floor(instant / 1000) * 1000;
}

/**
 * L'Âge calendaire du glossaire (CONTEXT.md) entre deux instants (ms) : l'écart de leurs heures du mur dans le fuseau, où chaque
 * jour compte 24 h. Un changement d'heure ne s'y voit pas : du mardi 12:00 au mardi 12:00 deux semaines plus tard, c'est 14 jours,
 * que les horloges aient avancé ou reculé d'une heure entre-temps (l'horloge réelle en compterait 13 j 23 h ou 14 j 1 h). C'est
 * ainsi que l'utilisateur compte « 14 jours » sur son calendrier.
 *
 * Limite assumée, une heure de nuit par an : quand les horloges reculent, une heure du mur se répète (à Paris, 02:00 à 03:00 en
 * heure d'été, puis de nouveau 02:00 à 03:00 en heure d'hiver), et l'écart cesse de croître avec l'horloge réelle.
 * - Il perd une heure d'un coup au retour de l'horloge, puis remonte normalement : il ne retrouve son niveau d'avant qu'une heure
 *   réelle plus tard. Un Prêt dont les 14 jours s'achèvent dans l'heure répétée cesse donc de stagner, puis stagne de nouveau :
 *   devenu Prêt le dimanche 11 octobre à 02:30 (été), il a 14 j 20 min le 25 à 02:50 (été), 13 j 23 h 40 à 02:10 (hiver), puis
 *   14 j 10 min à 02:40 (hiver).
 * - Il n'est jamais négatif : de 02:45 (été) à 02:15 (hiver), une demi-heure réelle plus tard, l'heure du mur a reculé de 30 min, et
 *   l'écart vaut 0.
 * Compter l'horloge réelle supprimerait ces effets, mais déplacerait d'une heure le seuil de tout Prêt qui a traversé un changement
 * d'heure, et pas seulement une nuit par an. On les accepte donc.
 */
export function calendarElapsed(from: number, to: number, timeZone: string): number {
  return Math.max(0, to + offsetAt(to, timeZone) - (from + offsetAt(from, timeZone)));
}
