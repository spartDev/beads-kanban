import type { MetricsCfdPoint } from '../../shared/api';
import { formatCount, formatDay } from './format';

/**
 * Le CFD (diagramme de flux cumulé) empile les cinq colonnes du kanban, dont les noms sont repris tels quels. Terminé
 * est en bas : c'est lui qui monte sans cesse, et la hauteur des bandes qui le surplombent est le travail en cours
 * (En cours et Bloqué), puis ce qui attend (Prêt), puis le reste (Backlog).
 */
export type FlowKey = 'done' | 'inProgress' | 'blocked' | 'ready' | 'backlog';

export interface FlowSeries {
  key: FlowKey;
  label: string;
  /** Jeton de couleur (metrics.css), décliné en clair et en sombre. */
  color: string;
}

/** De bas en haut de la pile. */
export const FLOW_SERIES: readonly FlowSeries[] = [
  { key: 'done', label: 'Terminé', color: 'var(--flow-done)' },
  { key: 'inProgress', label: 'En cours', color: 'var(--flow-progress)' },
  { key: 'blocked', label: 'Bloqué', color: 'var(--flow-blocked)' },
  { key: 'ready', label: 'Prêt', color: 'var(--flow-ready)' },
  { key: 'backlog', label: 'Backlog', color: 'var(--flow-backlog)' },
];

export interface CfdRow extends MetricsCfdPoint {
  /** Minuit UTC du jour (ms) : un jour civil se place sur l'axe sans dépendre du fuseau du navigateur. */
  time: number;
  total: number;
}

export function cfdTotal(point: MetricsCfdPoint): number {
  return FLOW_SERIES.reduce((total, { key }) => total + point[key], 0);
}

const utcMidnight = (day: string): number => {
  const [year = 0, month = 1, date = 1] = day.split('-').map(Number);
  return Date.UTC(year, month - 1, date);
};

export function toCfdRows(points: readonly MetricsCfdPoint[]): CfdRow[] {
  return points.map((point) => ({ ...point, time: utcMidnight(point.date), total: cfdTotal(point) }));
}

/** Les colonnes empilées, de bas en haut ; Terminé peut être masqué pour agrandir les bandes du travail en cours. */
export function stackKeys(hideDone: boolean): FlowKey[] {
  return FLOW_SERIES.map(({ key }) => key).filter((key) => !(hideDone && key === 'done'));
}

/** Hauteur de la plus haute pile. */
export function cfdMax(points: readonly MetricsCfdPoint[], keys: readonly FlowKey[]): number {
  return points.reduce((max, point) => Math.max(max, keys.reduce((total, key) => total + point[key], 0)), 0);
}

/** Le texte qui tient lieu de dessin pour un lecteur d'écran : la période, et l'état du dernier jour. */
export function cfdSummary(points: readonly MetricsCfdPoint[]): string {
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last) return 'Flux cumulé : aucun jour à montrer.';
  const sameYear = first.date.slice(0, 4) === last.date.slice(0, 4);
  const span =
    first.date === last.date
      ? `le ${formatDay(last.date, { year: true })}`
      : `du ${formatDay(first.date, { year: !sameYear })} au ${formatDay(last.date, { year: true })}`;
  const state = FLOW_SERIES.map(({ key, label }) => `${formatCount(last[key])} ${label}`).join(', ');
  return `Flux cumulé ${span}. Dernier jour : ${state}.`;
}
