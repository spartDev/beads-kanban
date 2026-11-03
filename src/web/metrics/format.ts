/**
 * Les nombres, durées et dates de la page Métriques, écrits pour un lecteur français : virgule décimale, espace
 * insécable entre un nombre et son unité (« 3,4 j » ne se coupe pas en fin de ligne), moins typographique.
 *
 * Les mois et les jours de la semaine sont écrits ici plutôt que lus d'Intl : le texte affiché, et donc les tests,
 * ne changent pas d'une version d'ICU à l'autre. Seuls les fuseaux horaires passent par Intl.
 */

const NBSP = ' ';
const MINUS = '−';
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const DASH = '—';

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** Groupe par trois chiffres, avec une espace insécable, la partie entière d'un nombre écrit (« 1234,5 » donne « 1 234,5 »). */
function groupDigits(text: string): string {
  const [integer = '', fraction] = text.split(',');
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return fraction === undefined ? grouped : `${grouped},${fraction}`;
}

/** Nombre à la française, arrondi à `digits` décimales, sans zéro inutile (« 10 », pas « 10,0 »). */
export function formatDecimal(value: number, digits = 1): string {
  if (!isNumber(value)) return DASH;
  const fixed = value.toFixed(digits);
  if (Number(fixed) === 0) return '0';
  const trimmed = fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed;
  return trimmed.replace('.', ',').replace('-', MINUS);
}

/** Entier groupé par milliers. */
export function formatCount(value: number): string {
  if (!isNumber(value)) return DASH;
  const rounded = Math.round(value);
  return `${rounded < 0 ? MINUS : ''}${groupDigits(String(Math.abs(rounded)))}`;
}

/** Écart signé : « +55 », « −3 », « 0 » quand l'arrondi l'efface. */
export function formatSigned(value: number, digits = 0): string {
  if (!isNumber(value)) return DASH;
  const rounded = Number(value.toFixed(digits));
  if (rounded === 0) return '0';
  const magnitude = digits === 0 ? formatCount(Math.abs(rounded)) : groupDigits(formatDecimal(Math.abs(rounded), digits));
  return `${rounded > 0 ? '+' : MINUS}${magnitude}`;
}

/**
 * Durée en temps calendaire, arrondie à la minute avant de choisir l'unité : minutes sous une heure, heures et
 * minutes sous un jour, jours au-delà (une décimale sous 10 jours). 59 min 40 s font « 1 h », pas « 60 min ».
 */
export function formatDuration(ms: number | null | undefined): string {
  if (!isNumber(ms)) return DASH;
  const value = Math.max(0, ms);
  const minutes = Math.round(value / MIN);
  if (minutes < 1) return `< 1${NBSP}min`;
  if (minutes < 60) return `${minutes}${NBSP}min`;
  if (minutes < 24 * 60) {
    const [hours, rest] = [Math.floor(minutes / 60), minutes % 60];
    return rest === 0 ? `${hours}${NBSP}h` : `${hours}${NBSP}h${NBSP}${String(rest).padStart(2, '0')}`;
  }
  return `${days(value / DAY)}${NBSP}j`;
}

/** Jours : une décimale sous 10, entiers au-delà. 9,96 jours font « 10 », jamais « 10,0 ». */
function days(value: number): string {
  const tenths = Math.round(value * 10) / 10;
  return tenths < 10 ? formatDecimal(tenths, 1) : String(Math.round(value));
}

/** Écart de durées, signé ; sous la minute, l'arrondi l'efface. */
export function formatSignedDuration(ms: number): string {
  if (!isNumber(ms)) return DASH;
  if (Math.round(Math.abs(ms) / MIN) < 1) return `0${NBSP}min`;
  return `${ms > 0 ? '+' : MINUS}${formatDuration(Math.abs(ms))}`;
}

/** Durée telle qu'on la dit : unités en toutes lettres, singulier sous 2 (« 1,5 jour »), pluriel au-delà. */
export function spokenDuration(ms: number): string {
  if (!isNumber(ms)) return 'durée inconnue';
  const value = Math.max(0, ms);
  const minutes = Math.round(value / MIN);
  const unit = (count: number, singular: string) => `${singular}${count >= 2 ? 's' : ''}`;
  if (minutes < 1) return 'moins d’une minute';
  if (minutes < 60) return `${minutes} ${unit(minutes, 'minute')}`;
  if (minutes < 24 * 60) {
    const [hours, rest] = [Math.floor(minutes / 60), minutes % 60];
    return `${hours} ${unit(hours, 'heure')}${rest === 0 ? '' : ` ${rest} ${unit(rest, 'minute')}`}`;
  }
  const text = days(value / DAY);
  return `${text} ${unit(Number(text.replace(',', '.')), 'jour')}`;
}

/** Pourcentage lisible d'un nombre de 0 à 100 : une décimale sous 10, aucune au-delà. */
function percentNumber(percent: number): string {
  const rounded = Math.round(percent * 10) / 10;
  return rounded < 10 ? formatDecimal(rounded, 1) : String(Math.round(percent));
}

/**
 * Part de 0 à 1 écrite en pourcentage : « 19 % », « 1,6 % » (une décimale sous 10 %, aucune au-delà). Avec `precise`,
 * une décimale partout, car 12,5 % et 13 % ne se valent pas quand on suit un taux de période en période.
 */
export function formatPercent(ratio: number | null | undefined, { precise = false }: { precise?: boolean } = {}): string {
  if (!isNumber(ratio)) return DASH;
  const text = precise ? formatDecimal(Math.round(ratio * 1000) / 10, 1) : percentNumber(ratio * 100);
  return `${text}${NBSP}%`;
}

/** Différence de deux parts de 0 à 1, en points de pourcentage, signée (« −9,5 pts »). */
export function formatPoints(delta: number): string {
  if (!isNumber(delta)) return DASH;
  const points = delta * 100;
  if (Math.round(Math.abs(points) * 10) === 0) return `0${NBSP}pts`;
  return `${points > 0 ? '+' : MINUS}${percentNumber(Math.abs(points))}${NBSP}pts`;
}

/** Écart de deux parts de 0 à 1, tel qu'on le dit : « 9,5 points », « 1 point » (singulier sous 2, comme le français). */
export function spokenPoints(magnitude: number): string {
  const text = percentNumber(Math.abs(magnitude) * 100);
  return `${text} ${Number(text.replace(',', '.')) >= 2 ? 'points' : 'point'}`;
}

/* --- Jours et heures ---------------------------------------------------------------------------------------------- */

const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'] as const;
const WEEKDAYS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'] as const;

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function splitDay(day: string): { year: number; month: number; date: number } {
  const match = DAY_PATTERN.exec(day);
  if (!match) throw new RangeError(`Jour AAAA-MM-JJ attendu, reçu « ${day} »`);
  return { year: Number(match[1]), month: Number(match[2]), date: Number(match[3]) };
}

/** Un jour du calendrier, « 4 oct. » ; avec l'année (« 4 oct. 2026 ») ou le jour de la semaine (« dim. 4 oct. »). */
export function formatDay(day: string, { year = false, weekday = false }: { year?: boolean; weekday?: boolean } = {}): string {
  const parts = splitDay(day);
  const name = WEEKDAYS[new Date(Date.UTC(parts.year, parts.month - 1, parts.date)).getUTCDay()] ?? '';
  const month = MONTHS[parts.month - 1] ?? '';
  return [weekday ? name : '', String(parts.date), month, year ? String(parts.year) : ''].filter(Boolean).join(' ');
}

/** Une plage de jours, l'année une fois à la fin (« 4 oct. – 2 nov. 2026 »), aux deux bouts quand elle change. */
export function formatDayRange(from: string, to: string): string {
  if (from === to) return formatDay(from, { year: true });
  const crossesYears = splitDay(from).year !== splitDay(to).year;
  return `${formatDay(from, { year: crossesYears })} – ${formatDay(to, { year: true })}`;
}

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
