import type { PeriodSpec } from '../../domain/calendar';
import { canonicalTimeZone } from '../../domain/time-zone';
import type { MetricsRangePreset } from '../../shared/api';
import type { ApiErrorDetail } from '../../shared/errors';
import type { MetricsQuery, SignalsQuery, SinceLastVisitQuery } from './service';

/** La requête n'a pas la forme attendue : l'API répond 400 avec ce message, et son code pour l'interface (`detail`). */
export class InvalidMetricsQueryError extends Error {
  constructor(
    message: string,
    readonly detail: Extract<ApiErrorDetail, { code: `query-${string}` }>,
  ) {
    super(message);
    this.name = 'InvalidMetricsQueryError';
  }
}

const PARAMETERS = ['project', 'range', 'from', 'to', 'timeZone'];
const PRESETS: readonly MetricsRangePreset[] = ['7d', '30d', '90d'];
const DEFAULT_PRESET: MetricsRangePreset = '30d';

/**
 * Lit les paramètres de `GET /api/metrics` : `project` (répétable), puis `range` (7d, 30d ou 90d) ou `from` et `to`,
 * jamais les deux. Sans période, les 30 derniers jours. Un paramètre inconnu est refusé : une faute de frappe dans
 * `range` ne doit pas donner en silence la période par défaut. Que `from` et `to` soient de vrais jours, et dans le bon
 * ordre, c'est `resolvePeriod` qui le vérifie.
 *
 * `timeZone` est le fuseau IANA dans lequel compter les jours : celui du navigateur, que la page envoie (bdesk-38k.48). Le domaine refuse un nom que
 * `Intl` ne connaît pas (une `RangeError`, donc une erreur de programmation) : c'est ici, à la frontière, qu'on s'en assure.
 * - Un nom que le serveur connaît sort sous le nom que le moteur lui donne (`eUrOpE/pArIs` devient `Europe/Paris`, `utc` devient `UTC`) : un fuseau,
 *   un seul nom, pour la réponse comme pour les formateurs que le domaine garde par fuseau.
 * - Un nom qu'il ne connaît pas (un fuseau plus récent que l'ICU de Node : Chromium sait `America/Coyhaique`, Node 22.13 non) n'est pas une erreur : la
 *   requête n'a pas de fuseau, le service compte dans le sien, la réponse le nomme et dit qu'elle n'a pas honoré celui qu'on lui demandait
 *   (`timeZoneHonoured`), ce que la page dit à son tour. Refuser mettait la page hors service.
 * - Un fuseau vide, répété ou qui n'est pas un texte reste refusé (400) : la requête est mal faite.
 */
export function parseMetricsQuery(query: Record<string, unknown>): MetricsQuery {
  for (const name of Object.keys(query)) {
    if (!PARAMETERS.includes(name)) {
      throw unknownParameter(name, PARAMETERS);
    }
  }

  const projects = values(query, 'project');
  if (projects.some((id) => id.trim() === '')) throw EMPTY_PROJECT();

  const [range, from, to] = [single(query, 'range'), single(query, 'from'), single(query, 'to')];
  if (range !== undefined && (from !== undefined || to !== undefined)) {
    throw new InvalidMetricsQueryError('Choisissez « range » ou « from » et « to », pas les deux.', { code: 'query-range-and-dates', params: {} });
  }
  if ((from === undefined) !== (to === undefined)) {
    throw new InvalidMetricsQueryError('« from » et « to » vont ensemble.', { code: 'query-dates-together', params: {} });
  }

  const requestedZone = single(query, 'timeZone');
  if (requestedZone === '') throw EMPTY_TIME_ZONE();
  const timeZone = canonicalTimeZone(requestedZone);

  return { projects: [...new Set(projects)], period: periodOf(range, from, to), ...(timeZone === undefined ? {} : { timeZone }) };
}

const SIGNALS_PARAMETERS = ['project', 'timeZone'];

function unknownParameter(name: string, expected: readonly string[]): InvalidMetricsQueryError {
  return new InvalidMetricsQueryError(`Paramètre inconnu : « ${name} » (attendus : ${expected.join(', ')}).`, {
    code: 'query-unknown-parameter',
    params: { parameter: name, expected: [...expected] },
  });
}

const EMPTY_PROJECT = () => new InvalidMetricsQueryError('« project » ne peut pas être vide.', { code: 'query-empty-project', params: {} });
const EMPTY_TIME_ZONE = () =>
  new InvalidMetricsQueryError('« timeZone » ne peut pas être vide.', { code: 'query-empty-time-zone', params: {} });

/** Lit les paramètres de `GET /api/signals` : `project` (répétable ; aucun pour la Vue globale) et `timeZone`, comme `parseMetricsQuery`. */
export function parseSignalsQuery(query: Record<string, unknown>): SignalsQuery {
  for (const name of Object.keys(query)) {
    if (!SIGNALS_PARAMETERS.includes(name)) {
      throw unknownParameter(name, SIGNALS_PARAMETERS);
    }
  }
  const projects = values(query, 'project');
  if (projects.some((id) => id.trim() === '')) throw EMPTY_PROJECT();
  const requestedZone = single(query, 'timeZone');
  if (requestedZone === '') throw EMPTY_TIME_ZONE();
  const timeZone = canonicalTimeZone(requestedZone);
  return { projects: [...new Set(projects)], ...(timeZone === undefined ? {} : { timeZone }) };
}

const SINCE_LAST_VISIT_PARAMETERS = ['since'];

/**
 * Lit les paramètres de `GET /api/since-last-visit` : `since`, la Dernière visite, un instant ISO 8601 complet (date, heure, fuseau : `Z` ou un décalage),
 * celui que l'interface a reçu dans `asOf`. Absent, le service remonte 24 heures. Un instant sans fuseau dépendrait de celui du serveur, un jour qui
 * n'existe pas (le 30 février) glisserait en silence au mois suivant : refusés (400), comme un texte vide, répété ou un paramètre inconnu.
 */
export function parseSinceLastVisitQuery(query: Record<string, unknown>): SinceLastVisitQuery {
  for (const name of Object.keys(query)) {
    if (!SINCE_LAST_VISIT_PARAMETERS.includes(name)) throw unknownParameter(name, SINCE_LAST_VISIT_PARAMETERS);
  }
  const since = single(query, 'since');
  if (since === undefined) return {};
  const instant = instantOf(since);
  if (instant === undefined) {
    throw new InvalidMetricsQueryError(`« since » doit être un instant ISO 8601, avec sa date, son heure et son fuseau : reçu « ${since} ».`, {
      code: 'query-invalid-instant',
      params: { parameter: 'since', received: since },
    });
  }
  return { since: instant };
}

const INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(?:Z|([+-])(\d{2}):(\d{2}))$/;

/** L'instant (ms epoch) qu'un texte ISO 8601 complet désigne ; `undefined` s'il n'en est pas un, ou si sa date ou son heure n'existent pas. */
function instantOf(text: string): number | undefined {
  const match = INSTANT.exec(text);
  if (!match) return undefined;
  const [year, month, day, hours, minutes, seconds] = match.slice(1, 7).map(Number) as [number, number, number, number, number, number];
  const millis = Number((match[7] ?? '').padEnd(3, '0').slice(0, 3));
  const wall = new Date(Date.UTC(year, month - 1, day, hours, minutes, seconds, millis));
  // `Date.UTC` reporte ce qui déborde (le 30 février devient le 2 mars, 24:00 le lendemain) : on refuse ce qui ne revient pas à l'identique.
  const exists =
    wall.getUTCFullYear() === year &&
    wall.getUTCMonth() === month - 1 &&
    wall.getUTCDate() === day &&
    wall.getUTCHours() === hours &&
    wall.getUTCMinutes() === minutes &&
    wall.getUTCSeconds() === seconds;
  const [sign, offsetHours, offsetMinutes] = [match[8], Number(match[9] ?? 0), Number(match[10] ?? 0)];
  if (!exists || offsetHours > 23 || offsetMinutes > 59) return undefined;
  const offset = (sign === '-' ? -1 : 1) * (offsetHours * 60 + offsetMinutes) * 60_000;
  return wall.getTime() - offset;
}

function periodOf(range: string | undefined, from: string | undefined, to: string | undefined): PeriodSpec {
  if (from !== undefined && to !== undefined) return { from, to };
  if (range === undefined) return { range: DEFAULT_PRESET };
  const preset = PRESETS.find((candidate) => candidate === range);
  if (!preset) {
    throw new InvalidMetricsQueryError(`« range » doit valoir ${PRESETS.slice(0, -1).join(', ')} ou ${PRESETS.at(-1)} : reçu « ${range} ».`, {
      code: 'query-invalid-range',
      params: { received: range, expected: [...PRESETS] },
    });
  }
  return { range: preset };
}

/** Les valeurs d'un paramètre, qu'il soit donné une fois ou répété. */
function values(query: Record<string, unknown>, name: string): string[] {
  const raw = query[name];
  const list = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  if (!list.every((value): value is string => typeof value === 'string')) {
    throw new InvalidMetricsQueryError(`« ${name} » doit être un texte.`, { code: 'query-not-text', params: { parameter: name } });
  }
  return list;
}

/** La valeur d'un paramètre qui ne se répète pas. */
function single(query: Record<string, unknown>, name: string): string | undefined {
  const [value, ...others] = values(query, name);
  if (others.length > 0) {
    throw new InvalidMetricsQueryError(`« ${name} » ne peut être donné qu'une fois.`, { code: 'query-repeated', params: { parameter: name } });
  }
  return value;
}
