import type { MetricsCfdPoint } from '../../shared/api';
import { CATALOGS } from '../i18n/catalog';
import type { Language } from '../i18n/language';
import { FORMATS } from './format';

/**
 * Le CFD (diagramme de flux cumulé) empile les colonnes du kanban, dont les noms sont repris tels quels : les cinq de tout Projet, et celles des
 * Statuts de relais (En relecture, En intégration, À valider) quand l'un des Projets mesurés les a, ce que dit leur présence dans les points
 * (`MetricsCfdPoint`). Terminé est en bas : c'est lui qui monte sans cesse, et la hauteur des bandes qui le surplombent est le travail en cours
 * (En cours, les relais, Bloqué), puis ce qui attend (Prêt), puis le reste (Backlog).
 */
export type FlowKey = Exclude<keyof MetricsCfdPoint, 'date'>;

export interface FlowSeries {
  key: FlowKey;
  /** Jeton de couleur (metrics.css), décliné en clair et en sombre. */
  color: string;
}

/**
 * De bas en haut de la pile. Le travail en cours s'y lit de bas en haut dans l'ordre du kanban, de gauche à droite : En cours, les relais, Bloqué.
 * Les noms des colonnes sont dans la langue de l'interface : `flowSeries`.
 */
export const FLOW_SERIES: readonly FlowSeries[] = [
  { key: 'done', color: 'var(--flow-done)' },
  { key: 'inProgress', color: 'var(--flow-progress)' },
  { key: 'inReview', color: 'var(--flow-review)' },
  { key: 'inIntegration', color: 'var(--flow-integration)' },
  { key: 'awaitingHuman', color: 'var(--flow-awaiting)' },
  { key: 'blocked', color: 'var(--flow-blocked)' },
  { key: 'ready', color: 'var(--flow-ready)' },
  { key: 'backlog', color: 'var(--flow-backlog)' },
];

/** Les colonnes du tableau des valeurs : celles du kanban, de gauche à droite. */
export const TABLE_COLUMNS: readonly FlowKey[] = ['backlog', 'ready', 'inProgress', 'inReview', 'inIntegration', 'awaitingHuman', 'blocked', 'done'];

/** Les colonnes des Statuts de relais : le serveur ne les écrit que pour des Projets qui les ont. */
const HANDOFF_KEYS: readonly FlowKey[] = ['inReview', 'inIntegration', 'awaitingHuman'];

/** Une colonne d'un Statut de relais (En relecture, En intégration, À valider). */
export const isHandoffKey = (key: FlowKey): boolean => HANDOFF_KEYS.includes(key);

/**
 * Les colonnes qu'a le CFD, de bas en haut de la pile : les cinq de tout Projet, et celles des Statuts de relais que les points portent. Le serveur
 * les écrit sur chaque point ou sur aucun (`cumulativeFlow`) : le premier suffit à le dire. Sans point, les cinq.
 */
export function flowColumns(points: readonly MetricsCfdPoint[]): FlowKey[] {
  const first = points[0];
  return FLOW_SERIES.map(({ key }) => key).filter((key) => !isHandoffKey(key) || (first !== undefined && first[key] !== undefined));
}

/** Toutes les colonnes que peut avoir la pile, de bas en haut, nommées dans `language` ; celles d'un CFD sont `flowColumns`. */
export function flowSeries(language: Language): readonly (FlowSeries & { label: string })[] {
  const labels = CATALOGS[language].metrics.cfd.columns;
  return FLOW_SERIES.map((series) => ({ ...series, label: labels[series.key] }));
}

export interface CfdRow extends MetricsCfdPoint {
  /** Minuit UTC du jour (ms) : un jour civil se place sur l'axe sans dépendre du fuseau du navigateur. */
  time: number;
  total: number;
}

/** Les tickets de toutes les colonnes du point, celles des Statuts de relais comprises. */
export function cfdTotal(point: MetricsCfdPoint): number {
  return FLOW_SERIES.reduce((total, { key }) => total + (point[key] ?? 0), 0);
}

const utcMidnight = (day: string): number => {
  const [year = 0, month = 1, date = 1] = day.split('-').map(Number);
  return Date.UTC(year, month - 1, date);
};

export function toCfdRows(points: readonly MetricsCfdPoint[]): CfdRow[] {
  return points.map((point) => ({ ...point, time: utcMidnight(point.date), total: cfdTotal(point) }));
}

/** Les colonnes empilées, de bas en haut, parmi celles du CFD (`flowColumns`) ; Terminé peut être masqué pour agrandir les bandes du travail en cours. */
export function stackKeys(columns: readonly FlowKey[], hideDone: boolean): FlowKey[] {
  return columns.filter((key) => !(hideDone && key === 'done'));
}

/** Hauteur de la plus haute pile. */
export function cfdMax(points: readonly MetricsCfdPoint[], keys: readonly FlowKey[]): number {
  return points.reduce((max, point) => Math.max(max, keys.reduce((total, key) => total + (point[key] ?? 0), 0)), 0);
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
  const columns = flowColumns(points);
  const state = flowSeries(language)
    .filter(({ key }) => columns.includes(key))
    .map(({ key, label }) => `${formatCount(last[key] ?? 0)} ${label}`)
    .join(', ');
  return text.summary(span, state);
}
