import { MIN_CUSTOM_DAY } from '../../domain/calendar';
import type { MetricsRangePreset } from '../../shared/api';
import { addDays } from './scales';

/**
 * Ce que l'adresse de la page Métriques retient, pour qu'un lien partage la période et le découpage :
 *
 *   ?range=7d|30d|90d          les N derniers jours, aujourd'hui compris (30d par défaut)
 *   ?from=AAAA-MM-JJ&to=…      ou une plage personnalisée, bornes incluses (les mêmes noms que l'API)
 *   ?by=type|priority|project  le découpage : type dans un Projet, Projet en Vue globale par défaut
 *
 * Une valeur que la page ne comprend pas ne bloque rien et ne passe pas en silence : la page retombe sur le réglage
 * par défaut et le dit (`notices`), pour qu'une faute de frappe dans un lien partagé ne donne pas d'autres chiffres
 * sans prévenir.
 */

/** Une page de Projet (`/p/:projet/metrics`) ou la Vue globale (`/`). */
export type Scope = 'project' | 'global';
export type Dimension = 'type' | 'priority' | 'project';
export type PeriodChoice = { kind: 'preset'; range: MetricsRangePreset } | { kind: 'custom'; from: string; to: string };

export const PRESETS: readonly MetricsRangePreset[] = ['7d', '30d', '90d'];
export const DEFAULT_RANGE: MetricsRangePreset = '30d';
export const DEFAULT_PERIOD: PeriodChoice = { kind: 'preset', range: DEFAULT_RANGE };

/** La limite du serveur (`MAX_PERIOD_DAYS`, src/domain/calendar.ts) : au-delà il répond 400. Un test garde les deux alignées. */
export const MAX_CUSTOM_DAYS = 366;

/**
 * Le premier jour d'une plage personnalisée : le 1er janvier 1970, la borne du serveur elle-même (`MIN_CUSTOM_DAY`,
 * src/domain/calendar.ts), partagée plutôt que recopiée. Une plage qui commence plus tôt, le serveur la refuse (400) : la page la
 * refuse sans le lui demander.
 */
export { MIN_CUSTOM_DAY };

const RANGE = 'range';
const FROM = 'from';
const TO = 'to';
const BY = 'by';

const DAY_MS = 86_400_000;
export const PRESET_DAYS: Record<MetricsRangePreset, number> = { '7d': 7, '30d': 30, '90d': 90 };

/** Les découpages proposés : un Projet seul n'aurait qu'une ligne « par Projet », la Vue globale en a une par Projet. */
export function dimensionsOf(scope: Scope): readonly Dimension[] {
  return scope === 'global' ? ['type', 'priority', 'project'] : ['type', 'priority'];
}

export function defaultDimension(scope: Scope): Dimension {
  return scope === 'global' ? 'project' : 'type';
}

/**
 * Minuit UTC de ce jour du calendrier. `Date.UTC(20, …)` lirait l'an 20 comme 1920 (les années 0 à 99 y sont décalées de
 * 1900), alors qu'un champ de date tapé au clavier passe par 0002, 0020 puis 0202 avant 2026 : `setUTCFullYear` les prend telles quelles.
 */
function utcMidnight(year: number, month: number, date: number): Date {
  const day = new Date(0);
  day.setUTCFullYear(year, month - 1, date);
  return day;
}

/**
 * Un vrai jour du calendrier `AAAA-MM-JJ` : refuse `2026-1-5` comme `2026-02-30`. Un mois ou un jour qui déborde fait
 * dériver la date (un 30 février devient un 2 mars, un mois 13 change l'année) : il suffit de relire l'année et le jour.
 */
export function isCivilDay(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [year, month, date] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const check = utcMidnight(year, month, date);
  return check.getUTCFullYear() === year && check.getUTCDate() === date;
}

const utcOf = (day: string): number => {
  const [year = 0, month = 1, date = 1] = day.split('-').map(Number);
  return utcMidnight(year, month, date).getTime();
};

/** Nombre de jours d'une plage, bornes comprises. */
export function spanInDays(from: string, to: string): number {
  return Math.round((utcOf(to) - utcOf(from)) / DAY_MS) + 1;
}

/** Identité d'une période pour le cache des requêtes. */
export function periodKey(period: PeriodChoice): string {
  return period.kind === 'preset' ? period.range : `${period.from}..${period.to}`;
}

/** La requête à `GET /api/metrics` : un Projet (ou la Vue globale sans `project`) et une période. */
export function metricsPath({ project, period }: { project?: string; period: PeriodChoice }): string {
  const query = new URLSearchParams();
  if (project !== undefined) query.set('project', project);
  if (period.kind === 'preset') query.set(RANGE, period.range);
  else {
    query.set(FROM, period.from);
    query.set(TO, period.to);
  }
  return `/api/metrics?${query}`;
}

/** L'adresse avec cette période : le préréglage par défaut n'y est pas écrit, les autres réglages restent. */
export function withPeriod(params: URLSearchParams, period: PeriodChoice): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const name of [RANGE, FROM, TO]) next.delete(name);
  if (period.kind === 'custom') {
    next.set(FROM, period.from);
    next.set(TO, period.to);
  } else if (period.range !== DEFAULT_RANGE) {
    next.set(RANGE, period.range);
  }
  return next;
}

/** L'adresse avec ce découpage : celui par défaut de la page n'y est pas écrit. */
export function withDimension(params: URLSearchParams, by: Dimension, scope: Scope): URLSearchParams {
  const next = new URLSearchParams(params);
  next.delete(BY);
  if (by !== defaultDimension(scope)) next.set(BY, by);
  return next;
}

export interface ParsedMetricsParams {
  period: PeriodChoice;
  by: Dimension;
  /** Ce que l'adresse demandait et que la page ne peut pas servir, en français. Vide quand tout est compris. */
  notices: string[];
}

/**
 * Lit l'adresse. `today` est le jour d'aujourd'hui (AAAA-MM-JJ) dans le fuseau de l'utilisateur : une plage ne peut pas
 * le dépasser, et le serveur la refuserait. Une plage valide l'emporte sur `range` quand l'adresse donne les deux.
 */
export function parseMetricsParams(params: URLSearchParams, scope: Scope, today: string): ParsedMetricsParams {
  const problems: string[] = [];

  const range = params.get(RANGE);
  const preset = range === null ? undefined : PRESETS.find((candidate) => candidate === range);
  if (range !== null && preset === undefined) problems.push(`La période « ${range} » n’existe pas (7d, 30d ou 90d).`);

  let custom: PeriodChoice | undefined;
  if (params.has(FROM) || params.has(TO)) {
    const checked = checkRange(params.get(FROM), params.get(TO), today);
    if (typeof checked === 'string') problems.push(checked);
    else custom = checked;
  }

  const period: PeriodChoice = custom ?? (preset ? { kind: 'preset', range: preset } : DEFAULT_PERIOD);
  const fallback = period.kind === 'custom' ? 'La plage personnalisée est affichée.' : `Les ${PRESET_DAYS[period.range]} derniers jours sont affichés.`;
  const notices = problems.map((problem) => `${problem} ${fallback}`);

  const by = params.get(BY);
  let dimension = defaultDimension(scope);
  if (by !== null) {
    const found = dimensionsOf(scope).find((candidate) => candidate === by);
    const shown = `Découpage par ${LABELS[dimension]} affiché.`;
    if (found) dimension = found;
    else if (by === 'project') notices.push(`Le découpage par Projet n’existe qu’en Vue globale. ${shown}`);
    else notices.push(`Le découpage « ${by} » n’existe pas (${dimensionsOf(scope).join(', ')}). ${shown}`);
  }

  return { period, by: dimension, notices };
}

const LABELS: Record<Dimension, string> = { type: 'type', priority: 'priorité', project: 'Projet' };

/** Les `days` derniers jours jusqu'à `today` compris : la plage d'un préréglage, écrite en jours. */
export function lastDays(today: string, days: number): { from: string; to: string } {
  return { from: addDays(today, 1 - days), to: today };
}

/**
 * Une plage de jours, ou ce qui l'empêche d'être servie : un jour qui n'existe pas, une plage à l'envers, dans le futur,
 * d'avant le 1er janvier 1970, ou trop longue. Les mêmes refus que `resolvePeriod` (le serveur), dans le même ordre : les
 * bornes d'abord, la durée ensuite.
 */
export function checkRange(from: string | null, to: string | null, today: string): PeriodChoice | string {
  if (from === null || to === null) return 'Une plage personnalisée a besoin de « from » et « to » ensemble.';
  for (const value of [from, to]) if (!isCivilDay(value)) return `« ${value} » n’est pas un jour (AAAA-MM-JJ).`;
  if (from > to) return `La plage commence après sa fin (${from} > ${to}).`;
  if (to > today) return `La plage dépasse aujourd’hui (${to} > ${today}).`;
  if (from < MIN_CUSTOM_DAY) return `La plage doit commencer le 1er janvier 1970 ou après : ${from} est trop tôt.`;
  const days = spanInDays(from, to);
  if (days > MAX_CUSTOM_DAYS) return `La plage est trop longue : ${days} jours, au plus ${MAX_CUSTOM_DAYS}.`;
  return { kind: 'custom', from, to };
}
