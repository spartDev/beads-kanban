import { inspect } from 'node:util';

/**
 * Ce que le gestionnaire d'erreurs de l'API (`registerApi`) lit d'une erreur et en écrit au journal (ADR 0002). Une erreur est un objet
 * quelconque, voire pas un objet : tout ce qu'on en lit est gardé (un accesseur qui lève ne retire que sa propriété) et tout ce qu'on en écrit
 * est plafonné, de sorte qu'une ligne ne grossisse pas avec l'erreur.
 */

/**
 * Le code HTTP de la réponse à une erreur : celui qu'elle porte, `statusCode` (Fastify) d'abord, puis `status` (la convention de
 * `http-errors`), le premier qui est un entier de 400 à 599 ; sinon 500. Une erreur ne rend jamais un 2xx ou un 3xx, ni un code que Node
 * refuse (`'abc'`, `99999`, `503.5`) : `reply.code` lèverait, et Fastify prendrait le relais avec son gestionnaire par défaut, qui journalise
 * l'adresse demandée avec sa requête.
 */
export function statusOf(error: { statusCode?: unknown; status?: unknown }): number {
  const isHttpError = (code: unknown): code is number => typeof code === 'number' && Number.isInteger(code) && code >= 400 && code < 600;
  return [attempt(() => error.statusCode, undefined), attempt(() => error.status, undefined)].find(isHttpError) ?? 500;
}

/** Plafond d'un texte écrit au journal : un message de 200 000 caractères ne fait pas une ligne de 600 000. */
const LOG_TEXT_MAX = 4_000;
/** Combien de `cause` le journal suit, pas plus (chacune a ses textes, plafonnés eux aussi). */
const LOG_CAUSES_MAX = 3;
/** Combien de propriétés d'une erreur le journal écrit : sans cela, la ligne grossirait avec leur nombre. */
const LOG_PROPS_MAX = 10;
/** La longueur des noms que le journal écrit : les clés de ces propriétés, et le nom de la classe d'une erreur (le `type` du filet). */
const LOG_KEY_MAX = 64;
/** Combien d'erreurs d'un `AggregateError` le journal écrit. */
const LOG_AGGREGATED_MAX = 3;
/** Le message d'une réponse que rien n'a prévue : ce que le client lit quand l'erreur n'a pas de message texte, ou que le gestionnaire a échoué. */
export const UNEXPECTED = 'Erreur inattendue.';

/** `read()`, ou `fallback` s'il lève : une erreur est un objet quelconque, dont un accesseur peut lever, et le journal ne doit pas en dépendre. */
export function attempt<T>(read: () => T, fallback: T): T {
  try {
    return read();
  } catch {
    return fallback;
  }
}

/** Les `max` premiers caractères de `text`, sans laisser la première moitié d'une paire de substitution (un emoji coupé en deux s'écrit illisible). */
function head(text: string, max: number): string {
  const splitsPair = max > 0 && (text.charCodeAt(max - 1) & 0xfc00) === 0xd800;
  return text.slice(0, splitsPair ? max - 1 : max);
}

/** `text`, coupé au plafond avec ce qu'il en reste dit. */
export function clip(text: string): string {
  if (text.length <= LOG_TEXT_MAX) return text;
  const kept = head(text, LOG_TEXT_MAX);
  return `${kept}… (+${text.length - kept.length} caractères)`;
}

/** `value` comme `inspect` la montre (un texte entre guillemets), plafonnée. */
export function shown(value: unknown): string {
  return clip(inspect(value, { breakLength: Infinity, maxStringLength: LOG_TEXT_MAX }));
}

/** Une valeur que le journal écrit telle quelle (un texte plafonné, un nombre, un booléen, `null`), ou `undefined` pour tout autre. */
function plain(value: unknown): string | number | boolean | bigint | null | undefined {
  if (typeof value === 'string') return clip(value);
  if (value === null || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return value;
  return undefined;
}

/** Ce que `loggable` écrit lui-même d'une erreur : le reste de ses propriétés est copié par `plain`. */
const LOGGABLE_OWN = new Set(['message', 'stack', 'cause', 'constructor']);

/**
 * Ce que le journal écrit d'une erreur : une copie qui garde son nom de classe (le `type` de la ligne, coupé à `LOG_KEY_MAX`), son message et sa
 * pile (plafonnés), les valeurs simples qu'elle porte (`code`, `errno`, `statusCode`…, les textes plafonnés ; dix au plus), sa `cause` de proche en
 * proche (une `Error`, ou un texte) et les premières erreurs d'un `AggregateError`. Pas ses propriétés qui sont des objets (la réponse et les
 * en-têtes d'un client HTTP, des tampons de sortie…) : ni leur taille ni ce qu'ils portent ne sont connus, et ce n'est pas ce que dit l'erreur. Le
 * sérialiseur de Fastify écrit le reste : `type`, `message`, `stack`, `aggregateErrors`. Rien ne lève ici : un accesseur qui lève ne retire que sa
 * propriété.
 */
export function loggable(error: Error, causes = LOG_CAUSES_MAX): Error {
  // Ni `Object.create(Object.getPrototypeOf(error))`, ni une sous-classe : les accesseurs d'un `DOMException` (`name`, `message`, `code`) lèvent sur
  // autre chose que lui, et le sérialiseur de Fastify les lit. Le `type` de la ligne vient de `constructor.name` : celui de l'erreur, plafonné.
  const copy = Object.create(Error.prototype) as Error;
  // `defineProperty` et non `copy[key] = value` : une propriété nommée `__proto__` changerait le prototype de la copie.
  const put = (key: string, value: unknown, enumerable = true) =>
    Object.defineProperty(copy, key, { value, enumerable, configurable: true, writable: true });
  // La clé sous laquelle une propriété est écrite : coupée à `LOG_KEY_MAX`, et suffixée (`~2`, `~3`…) si une autre clé coupée au même début l'a déjà prise.
  const keyOf = (key: string) => {
    let name = head(key, LOG_KEY_MAX);
    for (let n = 2; Object.hasOwn(copy, name); n++) name = `${head(key, LOG_KEY_MAX - `~${n}`.length)}~${n}`;
    return name;
  };
  // Pas le constructeur de l'erreur lui-même : le sérialiseur de pino en lit le `name` pour écrire le `type` de la ligne (celui de l'erreur et ceux de
  // ses erreurs agrégées), et ce nom peut avoir n'importe quelle longueur, ou lever. Une fonction qui ne porte que le nom, coupé comme celui du filet
  // (`identify`), et `Error` quand il ne se lit pas : pino demande une fonction, sinon il lirait `name`.
  put('constructor', Object.defineProperty(() => {}, 'name', { value: identify(error).type ?? 'Error' }), false);

  // `code` d'abord : celui d'un `DOMException` est un accesseur de son prototype, que `Object.keys` ne voit pas.
  let written = 0;
  for (const key of new Set(['code', ...attempt(() => Object.keys(error), [])])) {
    if (written === LOG_PROPS_MAX) break;
    if (LOGGABLE_OWN.has(key)) continue;
    const value = plain(attempt(() => (error as unknown as Record<string, unknown>)[key], undefined));
    if (value === undefined) continue;
    put(keyOf(key), value);
    written++;
  }

  // Un message écrasé par autre chose qu'un texte ne doit pas faire échouer le gestionnaire (Fastify écrirait alors l'adresse demandée).
  const said = (value: unknown) => attempt(() => shown(value), '(illisible)');
  const text = (value: unknown) => (typeof value === 'string' ? clip(value) : said(value));
  put('message', text(attempt(() => error.message, '(illisible)')), false);
  put('stack', text(attempt(() => error.stack ?? '', '')), false);

  const cause = attempt(() => error.cause, undefined);
  if (typeof cause === 'string') put('cause', clip(cause));
  else if (causes > 0 && cause instanceof Error) put('cause', loggable(cause, causes - 1), false);
  // Les erreurs d'un `AggregateError` : les premières seulement, sans leur propre `cause` ni leurs propres erreurs, et celles qui ne sont pas des
  // `Error`, dites par `inspect`. Seules celles de l'erreur du dessus sont écrites : le sérialiseur de pino n'écrit d'une `cause` que son message
  // et sa pile (ajoutés à ceux de l'erreur), jamais ses propriétés ni ses erreurs. Au plus `LOG_AGGREGATED_MAX` erreurs agrégées, donc, quelle que
  // soit la chaîne des causes.
  const errors = causes > 0 ? attempt(() => (error as { errors?: unknown }).errors, undefined) : undefined;
  if (Array.isArray(errors)) {
    const inner = (value: unknown) => (value instanceof Error ? loggable(value, 0) : said(value));
    put('errors', errors.slice(0, LOG_AGGREGATED_MAX).map(inner), false);
  }
  return copy;
}

/**
 * Ce que l'on sait au mieux d'une erreur quand le gestionnaire lui-même a échoué (le filet de `registerApi`) : le nom de sa classe et son
 * message, s'ils se lisent et sont des textes, plafonnés ; celui qui manque, manque. Ne lève jamais, et ne dit rien de la requête : le filet
 * n'écrit jamais l'adresse demandée.
 */
export function identify(error: unknown): { type?: string; message?: string } {
  const type = attempt(() => (error as { constructor: { name: unknown } }).constructor.name, undefined);
  const message = attempt(() => (error as { message: unknown }).message, undefined);
  return {
    ...(typeof type === 'string' && { type: head(type, LOG_KEY_MAX) }),
    ...(typeof message === 'string' && { message: clip(message) }),
  };
}
