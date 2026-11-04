import { formatDuration, spokenDuration } from './format';

/**
 * L'âge d'un Prêt dans la liste « Prêts qui stagnent », écrit pour qu'on lise de quel côté du seuil de stagnation il tombe.
 *
 * `formatDuration` arrondit au jour dès 10 jours : 13 j 14 h et 14 j 10 h s'y écrivent tous deux « 14 j », et à côté d'un repère
 * « stagne » qui ne concerne que le second, la liste se contredit. Ici, au-delà d'un jour, l'âge est dit en jours et en heures
 * entières, arrondies vers le bas, sauf pour un Prêt qui stagne : s'il n'a dépassé le seuil que de quelques minutes, l'arrondi
 * vers le bas l'écrirait « 14 j », comme un Prêt de 14 jours pile qui, lui, ne stagne pas. On l'arrondit alors à l'heure
 * suivante (« 14 j 1 h »). Un âge s'écrit donc au-dessus du seuil si et seulement si le Prêt stagne, à n'importe quelle minute.
 * Sous un jour, les durées restent celles de `formatDuration` et de `spokenDuration` (heures et minutes).
 */

const NBSP = ' ';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Les jours et les heures entières de l'âge, du bon côté du seuil. */
function split(age: number, threshold: number): { days: number; hours: number } {
  const whole = Math.floor(Math.max(0, age) / HOUR);
  const hours = age > threshold ? Math.max(whole, Math.floor(threshold / HOUR) + 1) : whole;
  return { days: Math.floor(hours / 24), hours: hours % 24 };
}

/** « 14 j 10 h », « 14 j », « 5 h », « 12 min » : l'âge d'un Prêt, `threshold` étant l'âge au-delà duquel il stagne (ms). */
export function formatReadyAge(age: number, threshold: number): string {
  if (!(age >= DAY)) return formatDuration(age);
  const { days, hours } = split(age, threshold);
  return hours === 0 ? `${days}${NBSP}j` : `${days}${NBSP}j${NBSP}${hours}${NBSP}h`;
}

/** L'âge tel qu'on le dit, pour les lecteurs d'écran : « 14 jours 10 heures », « 1 jour », « 5 heures ». */
export function spokenReadyAge(age: number, threshold: number): string {
  if (!(age >= DAY)) return spokenDuration(age);
  const { days, hours } = split(age, threshold);
  const unit = (count: number, singular: string) => `${count} ${singular}${count >= 2 ? 's' : ''}`;
  return hours === 0 ? unit(days, 'jour') : `${unit(days, 'jour')} ${unit(hours, 'heure')}`;
}
