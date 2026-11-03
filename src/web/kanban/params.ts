import { COLUMN_IDS, DEFAULT_DONE_DAYS, type ColumnId } from './columns';

/**
 * Ce que l'adresse du kanban retient, pour qu'un lien le partage :
 *
 *   ?epic=<id>    limite le tableau aux Enfants de l'Epic
 *   ?done=<jours> Terminé : les <jours> derniers jours calendaires, aujourd'hui compris (14 par défaut)
 *   ?col=<id>     colonne affichée sur mobile (backlog, ready, inProgress, blocked, done) ; sans lui, celle que le
 *                 tableau a choisie à l'ouverture
 */
export const EPIC_PARAM = 'epic';
export const DONE_PARAM = 'done';
export const COLUMN_PARAM = 'col';

/** Au-delà d'un an, Terminé n'a plus de sens : autant retirer le filtre de durée. */
export const MAX_DONE_DAYS = 365;

/** Durées proposées par le réglage de Terminé. */
const DONE_DAY_PRESETS: readonly number[] = [7, 14, 30, 90];

/** La durée de `?done=` : un entier de 1 à 365 jours ; sinon la durée par défaut. */
export function parseDoneDays(value: string | null): number {
  if (value === null || !/^\d{1,4}$/.test(value)) return DEFAULT_DONE_DAYS;
  const days = Number(value);
  return days >= 1 && days <= MAX_DONE_DAYS ? days : DEFAULT_DONE_DAYS;
}

/** Les durées du réglage, plus celle de l'adresse si elle n'en fait pas partie : le réglage la montre toujours. */
export function doneDayChoices(current: number): number[] {
  return [...new Set([...DONE_DAY_PRESETS, current])].sort((a, b) => a - b);
}

/** La colonne de `?col=` ; null si absente ou inconnue. */
export function parseColumn(value: string | null): ColumnId | null {
  return COLUMN_IDS.find((id) => id === value) ?? null;
}
