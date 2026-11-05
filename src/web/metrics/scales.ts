import { startOfDay } from '../../domain/calendar';
import { formatDay } from './format';

/**
 * Les échelles et graduations des graphiques, en fonctions pures : ce que d3 ne sait pas faire pour nous (des durées
 * rondes sur un axe logarithmique, des comptes entiers, une infobulle qui reste dans le cadre).
 */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/**
 * Les graduations d'un axe de durées, d'une minute à un an : des valeurs que l'on dit (« 4 h », « 2 j », « 30 j »),
 * à peu près également espacées sur une échelle logarithmique. L'axe n'en montre que celles qui tiennent.
 */
export const DURATION_STEPS: readonly number[] = [
  MIN,
  5 * MIN,
  15 * MIN,
  30 * MIN,
  HOUR,
  2 * HOUR,
  4 * HOUR,
  8 * HOUR,
  12 * HOUR,
  DAY,
  2 * DAY,
  3 * DAY,
  5 * DAY,
  7 * DAY,
  14 * DAY,
  30 * DAY,
  60 * DAY,
  90 * DAY,
  180 * DAY,
  365 * DAY,
];

/** Pas « ronds » : 1, 2, 5, 10, 20, 50, 100… */
function* roundSteps(): Generator<number> {
  for (let magnitude = 1; ; magnitude *= 10) {
    yield magnitude;
    yield 2 * magnitude;
    yield 5 * magnitude;
  }
}

/**
 * Graduations entières de 0 au premier multiple du pas qui couvre `max`, avec au plus `maxCount` graduations. Un axe de
 * tickets ne porte pas de 2,5. Sans rien à montrer (`max` à 0), l'axe va quand même de 0 à 1.
 */
export function integerTicks(max: number, maxCount: number): number[] {
  const target = Math.max(1, Math.ceil(max));
  for (const step of roundSteps()) {
    const count = Math.ceil(target / step) + 1;
    if (count <= maxCount || step >= target) {
      return Array.from({ length: count }, (_, index) => index * step);
    }
  }
  return [0, 1];
}

/**
 * Le domaine d'un axe logarithmique de durées : de la graduation ronde qui précède la plus petite durée à celle qui suit
 * la plus grande. Jamais sous la minute (le logarithme de 0 n'existe pas) ; élargi d'un cran autour d'une valeur unique.
 */
export function logDomain(values: readonly number[]): [number, number] {
  const first = DURATION_STEPS[0] ?? MIN;
  if (values.length === 0) return [first, DAY];

  const smallest = Math.min(...values);
  const largest = Math.max(...values);
  let low = [...DURATION_STEPS].reverse().find((step) => step <= smallest) ?? first;
  let high = DURATION_STEPS.find((step) => step >= largest) ?? largest;

  if (low === high) {
    const index = DURATION_STEPS.indexOf(low);
    low = DURATION_STEPS[Math.max(0, index - 1)] ?? low;
    high = DURATION_STEPS[Math.min(DURATION_STEPS.length - 1, index + 1)] ?? high;
  }
  return [low, high];
}

/**
 * Parmi `candidates`, celles du domaine, dans l'ordre, séparées d'au moins `gap` pixels selon `position` : l'axe reste
 * lisible quand le graphique est petit. La première graduation du domaine est toujours gardée.
 */
export function pickTicks(
  candidates: readonly number[],
  domain: readonly [number, number],
  position: (value: number) => number,
  gap: number,
): number[] {
  const picked: number[] = [];
  for (const candidate of candidates) {
    if (candidate < domain[0] || candidate > domain[1]) continue;
    const previous = picked.at(-1);
    if (previous === undefined || Math.abs(position(candidate) - position(previous)) >= gap) picked.push(candidate);
  }
  return picked;
}

/** Les indices à étiqueter parmi `count` tranches : une sur n, régulièrement, pour que les étiquettes ne se chevauchent pas. */
export function thinLabels(count: number, maxLabels: number): number[] {
  if (count <= 0 || maxLabels <= 0) return [];
  const step = Math.ceil(count / maxLabels);
  return Array.from({ length: Math.ceil(count / step) }, (_, index) => index * step);
}

const clamp = (value: number, low: number, high: number): number => Math.min(Math.max(value, low), Math.max(low, high));

/**
 * Où poser une infobulle de `tooltip` pixels autour d'un pointeur, dans un cadre de `bounds` pixels : à droite du
 * pointeur, à gauche quand la droite manque de place, centrée sur sa hauteur, sans jamais sortir du cadre.
 */
export function placeTooltip({
  pointer,
  tooltip,
  bounds,
  gap = 12,
}: {
  pointer: { x: number; y: number };
  tooltip: { width: number; height: number };
  bounds: { width: number; height: number };
  gap?: number;
}): { left: number; top: number } {
  const fitsRight = pointer.x + gap + tooltip.width <= bounds.width;
  const left = fitsRight ? pointer.x + gap : pointer.x - gap - tooltip.width;
  return {
    left: clamp(left, 0, bounds.width - tooltip.width),
    top: clamp(pointer.y - tooltip.height / 2, 0, bounds.height - tooltip.height),
  };
}

/** Le jour `count` jours plus tard (ou plus tôt, si `count` est négatif) : de l'arithmétique de calendrier, sans fuseau. */
export function addDays(day: string, count: number): string {
  const [year = 0, month = 1, date = 1] = day.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, date + count));
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

export interface DayTick {
  /** Rang du jour dans la période : 0 pour le premier. */
  index: number;
  /** Le premier instant du jour (ms epoch) dans le fuseau des métriques : un jour de changement d'heure dure 23 ou 25 h. */
  time: number;
  label: string;
}

/**
 * Les graduations de l'axe du temps d'une période : un jour sur n, régulièrement, au plus `maxLabels`, chacune au début de
 * son jour dans le fuseau des métriques (celui de la réponse, que le navigateur a demandé : jamais un fuseau lu ici). Les jours sont
 * ceux du calendrier et non des tranches de 24 h : après un changement d'heure, `début + n × 24 h` tomberait une heure avant ou après
 * le vrai minuit.
 */
export function dayTicks({ from, days, timeZone }: { from: string; days: number; timeZone: string }, maxLabels: number): DayTick[] {
  return thinLabels(days, maxLabels).map((index) => {
    const day = addDays(from, index);
    return { index, time: startOfDay(day, timeZone), label: formatDay(day) };
  });
}

const clampIndex = (index: number, count: number): number => Math.min(Math.max(index, 0), Math.max(0, count - 1));

/** Le point le plus proche du pointeur, quand `count` points se répartissent de bord à bord sur `width` pixels (un jour du CFD). */
export function indexAt(x: number, width: number, count: number): number {
  if (count <= 1 || width <= 0) return 0;
  return clampIndex(Math.round((x / width) * (count - 1)), count);
}

/** La tranche qui contient le pointeur, quand `count` tranches se partagent `width` pixels (une barre de l'histogramme). */
export function bandIndexAt(x: number, width: number, count: number): number {
  if (count <= 1 || width <= 0) return 0;
  return clampIndex(Math.floor((x / width) * count), count);
}

/** Le point le plus proche de `at` s'il est à moins de `radius` pixels (le premier en cas d'égalité) ; -1 sinon. */
export function nearestPoint(points: readonly { x: number; y: number }[], at: { x: number; y: number }, radius: number): number {
  let best = -1;
  let bestDistance = radius * radius;
  points.forEach((point, index) => {
    const distance = (point.x - at.x) ** 2 + (point.y - at.y) ** 2;
    if (distance < bestDistance || (best === -1 && distance <= bestDistance)) {
      best = index;
      bestDistance = distance;
    }
  });
  return best;
}
