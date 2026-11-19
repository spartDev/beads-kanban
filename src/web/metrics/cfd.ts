import type { MetricsCfdPoint } from '../../shared/api';
import { CATALOGS } from '../i18n/catalog';
import type { Language } from '../i18n/language';
import { FORMATS } from './format';

/**
 * Le CFD (diagramme de flux cumulé) empile les cinq colonnes du kanban, dont les noms sont repris tels quels. Terminé
 * est en bas : c'est lui qui monte sans cesse, et la hauteur des bandes qui le surplombent est le travail en cours
 * (En cours et Bloqué), puis ce qui attend (Prêt), puis le reste (Backlog).
 */
export type FlowKey = 'done' | 'inProgress' | 'blocked' | 'ready' | 'backlog';

export interface FlowSeries {
  key: FlowKey;
  /** Jeton de couleur (metrics.css), décliné en clair et en sombre. */
  color: string;
}

/** De bas en haut de la pile. Les noms des colonnes sont dans la langue de l'interface : `flowSeries`. */
export const FLOW_SERIES: readonly FlowSeries[] = [
  { key: 'done', color: 'var(--flow-done)' },
  { key: 'inProgress', color: 'var(--flow-progress)' },
  { key: 'blocked', color: 'var(--flow-blocked)' },
  { key: 'ready', color: 'var(--flow-ready)' },
  { key: 'backlog', color: 'var(--flow-backlog)' },
];

/** Les colonnes de la pile, de bas en haut, nommées dans `language`. */
export function flowSeries(language: Language): readonly (FlowSeries & { label: string })[] {
  const labels = CATALOGS[language].metrics.cfd.columns;
  return FLOW_SERIES.map((series) => ({ ...series, label: labels[series.key] }));
}

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

/**
 * PROVISOIRE (bdesk-pz0.4 donnera leurs bandes aux colonnes des Statuts de relais) : le point tel que la pile le dessine, les tickets En relecture,
 * En intégration et À valider comptés dans En cours, faute de bande à eux (avant, le CFD les laissait hors de ses colonnes, « En pause »). Aucun ne disparaît de la pile, du total
 * ni du tableau des valeurs.
 */
export function withHandoffInProgress({ inReview = 0, inIntegration = 0, awaitingHuman = 0, ...point }: MetricsCfdPoint): MetricsCfdPoint {
  return { ...point, inProgress: point.inProgress + inReview + inIntegration + awaitingHuman };
}

export function toCfdRows(points: readonly MetricsCfdPoint[]): CfdRow[] {
  return points.map(withHandoffInProgress).map((point) => ({ ...point, time: utcMidnight(point.date), total: cfdTotal(point) }));
}

/** Les colonnes empilées, de bas en haut ; Terminé peut être masqué pour agrandir les bandes du travail en cours. */
export function stackKeys(hideDone: boolean): FlowKey[] {
  return FLOW_SERIES.map(({ key }) => key).filter((key) => !(hideDone && key === 'done'));
}

/** Hauteur de la plus haute pile. */
export function cfdMax(points: readonly MetricsCfdPoint[], keys: readonly FlowKey[]): number {
  return points.reduce((max, point) => Math.max(max, keys.reduce((total, key) => total + point[key], 0)), 0);
}

/** Le texte qui tient lieu de dessin pour un lecteur d'écran : la période, et l'état du dernier jour, dans `language`. */
export function cfdSummary(points: readonly MetricsCfdPoint[], language: Language): string {
  const text = CATALOGS[language].metrics.cfd;
  const { formatCount, formatDay } = FORMATS[language];
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last) return text.summaryEmpty;
  const sameYear = first.date.slice(0, 4) === last.date.slice(0, 4);
  const span =
    first.date === last.date
      ? text.spanOne(formatDay(last.date, { year: true }))
      : text.spanRange(formatDay(first.date, { year: !sameYear }), formatDay(last.date, { year: true }));
  const state = flowSeries(language)
    .map(({ key, label }) => `${formatCount(last[key])} ${label}`)
    .join(', ');
  return text.summary(span, state);
}
