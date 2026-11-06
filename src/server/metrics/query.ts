import type { PeriodSpec } from '../../domain/calendar';
import { canonicalTimeZone } from '../../domain/time-zone';
import type { MetricsRangePreset } from '../../shared/api';
import type { MetricsQuery } from './service';

/** La requête n'a pas la forme attendue : l'API répond 400 avec ce message. */
export class InvalidMetricsQueryError extends Error {
  constructor(message: string) {
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
      throw new InvalidMetricsQueryError(`Paramètre inconnu : « ${name} » (attendus : ${PARAMETERS.join(', ')}).`);
    }
  }

  const projects = values(query, 'project');
  if (projects.some((id) => id.trim() === '')) throw new InvalidMetricsQueryError('« project » ne peut pas être vide.');

  const [range, from, to] = [single(query, 'range'), single(query, 'from'), single(query, 'to')];
  if (range !== undefined && (from !== undefined || to !== undefined)) {
    throw new InvalidMetricsQueryError('Choisissez « range » ou « from » et « to », pas les deux.');
  }
  if ((from === undefined) !== (to === undefined)) throw new InvalidMetricsQueryError('« from » et « to » vont ensemble.');

  const requestedZone = single(query, 'timeZone');
  if (requestedZone === '') throw new InvalidMetricsQueryError('« timeZone » ne peut pas être vide.');
  const timeZone = canonicalTimeZone(requestedZone);

  return { projects: [...new Set(projects)], period: periodOf(range, from, to), ...(timeZone === undefined ? {} : { timeZone }) };
}

function periodOf(range: string | undefined, from: string | undefined, to: string | undefined): PeriodSpec {
  if (from !== undefined && to !== undefined) return { from, to };
  if (range === undefined) return { range: DEFAULT_PRESET };
  const preset = PRESETS.find((candidate) => candidate === range);
  if (!preset) {
    throw new InvalidMetricsQueryError(`« range » doit valoir ${PRESETS.slice(0, -1).join(', ')} ou ${PRESETS.at(-1)} : reçu « ${range} ».`);
  }
  return { range: preset };
}

/** Les valeurs d'un paramètre, qu'il soit donné une fois ou répété. */
function values(query: Record<string, unknown>, name: string): string[] {
  const raw = query[name];
  const list = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  if (!list.every((value): value is string => typeof value === 'string')) {
    throw new InvalidMetricsQueryError(`« ${name} » doit être un texte.`);
  }
  return list;
}

/** La valeur d'un paramètre qui ne se répète pas. */
function single(query: Record<string, unknown>, name: string): string | undefined {
  const [value, ...others] = values(query, name);
  if (others.length > 0) throw new InvalidMetricsQueryError(`« ${name} » ne peut être donné qu'une fois.`);
  return value;
}
