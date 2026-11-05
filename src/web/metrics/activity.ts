import type { MetricsActivity } from '../../shared/api';

/**
 * Carte d'activité : l'API donne les Transitions de la période par jour de la semaine (le lundi d'abord, comme les tranches
 * hebdomadaires) et par heure du fuseau de la réponse (celui que la page a demandé : le sien). La page en tire le niveau de couleur
 * de chaque case, le pic, et les totaux du tableau.
 */

const NBSP = '\u00a0';

export const WEEKDAYS = [
  { name: 'lundi', short: 'lun.' },
  { name: 'mardi', short: 'mar.' },
  { name: 'mercredi', short: 'mer.' },
  { name: 'jeudi', short: 'jeu.' },
  { name: 'vendredi', short: 'ven.' },
  { name: 'samedi', short: 'sam.' },
  { name: 'dimanche', short: 'dim.' },
] as const;

/** « de 14 h à 15 h » : l'heure entière d'une case, avec des espaces insécables pour que « 14 h » ne se coupe pas. */
export const hourSpan = (hour: number): string => `de ${hour}${NBSP}h à ${hour + 1}${NBSP}h`;

/** « jeudi, de 14 h à 15 h » : le créneau d'une case. */
export const slotLabel = (weekday: number, hour: number): string => `${WEEKDAYS[weekday]?.name ?? ''}, ${hourSpan(hour)}`;

/** Niveau d'une case : 0 sans Transition, de 1 à 4 selon sa part du maximum, par quarts. */
export type ActivityLevel = 0 | 1 | 2 | 3 | 4;

export interface ActivityCell {
  weekday: number;
  hour: number;
  count: number;
  level: ActivityLevel;
}

export interface ActivityView {
  /** Les 168 cases, du lundi 0 h au dimanche 23 h. */
  cells: ActivityCell[];
  /** Le plus grand compte d'une case. */
  max: number;
  total: number;
  /** La première case au maximum, du lundi au dimanche et de 0 h à 23 h ; null sans Transition. */
  peak: { weekday: number; hour: number; count: number } | null;
  byWeekday: number[];
  byHour: number[];
  empty: boolean;
}

export function describeActivity({ cells: grid, total }: MetricsActivity): ActivityView {
  const max = Math.max(0, ...grid.flat());
  const cells: ActivityCell[] = [];
  const byWeekday = new Array<number>(7).fill(0);
  const byHour = new Array<number>(24).fill(0);
  let peak: ActivityView['peak'] = null;

  for (let weekday = 0; weekday < 7; weekday++) {
    for (let hour = 0; hour < 24; hour++) {
      const count = grid[weekday]?.[hour] ?? 0;
      // Arithmétique entière : le quart exact du maximum est le haut du niveau 1, sans erreur d'arrondi.
      const level = (count === 0 ? 0 : Math.min(4, Math.ceil((count * 4) / max))) as ActivityLevel;
      cells.push({ weekday, hour, count, level });
      byWeekday[weekday] = (byWeekday[weekday] ?? 0) + count;
      byHour[hour] = (byHour[hour] ?? 0) + count;
      if (count > 0 && count === max && peak === null) peak = { weekday, hour, count };
    }
  }

  return { cells, max, total, peak, byWeekday, byHour, empty: total === 0 };
}
