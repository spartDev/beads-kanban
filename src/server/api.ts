import { STATUS_CODES } from 'node:http';
import { inspect } from 'node:util';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { InvalidPeriodError } from '../domain/calendar';
import type {
  ApiErrorBody,
  IssueChronologyResponse,
  IssueResponse,
  IssuesResponse,
  MetricsResponse,
  ProjectsResponse,
} from '../shared/api';
import { isAbortError } from './abort';
import { type ChronologyService, createChronologyService } from './chronology/service';
import { InvalidMetricsQueryError, parseMetricsQuery } from './metrics/query';
import type { MetricsService } from './metrics/service';
import {
  IssueNotFoundError,
  ProjectNotFoundError,
  type ProjectService,
  ProjectUnreadableError,
} from './projects/service';

/**
 * Routes `/api/projects…` et `/api/metrics` ; les erreurs des services deviennent des réponses JSON (400, 404, 503). Chaque lecture
 * reçoit le signal de sa requête (`req.signal`, abandonné quand le client ferme la connexion avant la réponse, par exemple quand
 * l'interface annule un `fetch`) : les lectures Dolt qu'il attendait seules sont retirées de la file ; celles dont le processus est
 * lancé vont au bout, sans être tuées, et leur résultat est jeté (ADR 0003).
 *
 * Journal du serveur (bdesk-38k.49, bdesk-38k.52) : une ligne par réponse qui est une panne, rien pour les autres.
 * - Une erreur que rien n'avait prévue (500, ou tout autre code 5xx qu'elle porte : `statusCode`, sinon `status`) : niveau `error`, `msg` fixe
 *   (« Erreur inattendue ») et l'erreur dans `err`, avec son message et sa pile. Un code qui n'est pas un entier de 400 à 599 est ignoré : 500.
 *   Rien n'oblige le code à lever une `Error` (`throw 'x'`, `throw null`) : la valeur levée est alors dans le message, sans pile, et la réponse
 *   est un 500.
 * - Un Projet illisible (503 : base verrouillée, Dolt absent…) : niveau `warn`, la raison seule. C'est une panne de lecture, pas un bogue,
 *   que l'interface montre déjà avec sa raison ; sa pile partirait du service et n'apprendrait rien. L'interface ne le réessaie pas
 *   (`shouldRetry`) : une ligne par demande, sans rafale.
 * - Rien pour ce qui n'est pas une panne du serveur : une requête refusée (400, 404, toute 4xx), ni pour un abandon du client (499) : une
 *   lecture abandonnée alors que le client a fermé sa connexion. Un abandon alors qu'il attend toujours est une panne, un 500.
 * Chaque ligne dit la méthode, le modèle de la route (`/api/projects/:projectId/issues`) et l'erreur, jamais l'URL demandée, sa requête, ses
 * en-têtes ni son corps ; son `reqId` la retrouve parmi les lignes d'accès de Fastify (niveau `info`), qui écrivent l'adresse. L'erreur est
 * écrite telle qu'elle se dit : le message d'un 500, quel qu'il soit, et pour un 503 la raison de la lecture, qui nomme le Projet et peut citer
 * le chemin de sa base. Chaque texte est plafonné (`LOG_TEXT_MAX`), comme le nombre des propriétés, des causes et des erreurs d'un `AggregateError`
 * écrites : une ligne ne grossit pas avec l'erreur.
 *
 * Le gestionnaire ne lève jamais (bdesk-38k.52) : si une erreur le faisait lever, Fastify la passerait à son gestionnaire par défaut, qui journalise
 * la requête avec son adresse (`?token=…`). Ce que l'on lit de l'erreur (un accesseur peut lever) est gardé ; le message du corps n'est celui de
 * l'erreur que s'il est un texte ; et un filet autour de tout écrit une ligne fixe, sans adresse, et répond un 500.
 */
export async function registerApi(
  app: FastifyInstance,
  projects: ProjectService,
  metrics: MetricsService,
  chronology: ChronologyService = createChronologyService(projects),
): Promise<void> {
  app.setErrorHandler((error: FastifyError, req, reply) => {
    // Le gestionnaire ne lève jamais : s'il levait, Fastify passerait l'erreur à son gestionnaire par défaut, qui journalise la requête avec son
    // adresse (`?token=…`). Ce que l'on lit de l'erreur est gardé (`attempt`, le message du corps) ; ce filet est pour tout le reste.
    try {
      return handleError(error, req, reply);
    } catch {
      attempt(() => req.log.error(whereOf(req), "Erreur inattendue (le gestionnaire d'erreurs a échoué)"), undefined);
      return send(reply, 500, UNEXPECTED);
    }
  });

  app.get('/api/projects', (): Promise<ProjectsResponse> => projects.list());

  app.get<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/issues',
    async (req): Promise<IssuesResponse> => ({ issues: await projects.issues(req.params.projectId, { signal: req.signal }) }),
  );

  app.get<{ Querystring: Record<string, unknown> }>(
    '/api/metrics',
    (req): Promise<MetricsResponse> => metrics.compute(parseMetricsQuery(req.query), { signal: req.signal }),
  );

  app.get<{ Params: { projectId: string; issueId: string } }>(
    '/api/projects/:projectId/issues/:issueId',
    async (req): Promise<IssueResponse> => ({
      issue: await projects.issue(req.params.projectId, req.params.issueId, { signal: req.signal }),
    }),
  );

  app.get<{ Params: { projectId: string; issueId: string } }>(
    '/api/projects/:projectId/issues/:issueId/chronology',
    async (req): Promise<IssueChronologyResponse> => ({
      chronology: await chronology.chronology(req.params.projectId, req.params.issueId, { signal: req.signal }),
    }),
  );
}

/** La réponse à une erreur de l'API, et ce qu'il en reste au journal (voir `registerApi`). */
function handleError(error: FastifyError, req: FastifyRequest, reply: FastifyReply): FastifyReply {
  // Le client est parti (sa connexion s'est fermée avant la réponse) et la lecture s'est arrêtée en abandon : personne n'attend la réponse, et ce
  // n'est pas une panne : rien au journal. Le nom de l'erreur ne suffit pas : un abandon alors que le client attend toujours (une lecture
  // partagée annulée par d'autres, un délai) est une panne comme une autre, un 500 que le journal dit.
  if (isAbortError(error) && clientLeft(reply)) return send(reply, 499, 'Requête abandonnée par le client.');
  if (error instanceof InvalidMetricsQueryError || error instanceof InvalidPeriodError) {
    return send(reply, 400, error.message);
  }
  if (error instanceof ProjectNotFoundError || error instanceof IssueNotFoundError) {
    return send(reply, 404, error.message);
  }
  if (error instanceof ProjectUnreadableError) {
    req.log.warn(whereOf(req), clip(error.message));
    return send(reply, 503, `Projet illisible : ${error.reason}`, error.reason);
  }
  if (!(error instanceof Error)) {
    // Fastify type l'erreur en `FastifyError`, mais le code peut lever n'importe quoi (`throw 'x'`, `throw null`) : ni message, ni code, ni pile
    // à lire, la valeur elle-même dit ce qu'on en sait. Elle ne part pas au client.
    req.log.error(whereOf(req), `Erreur inattendue (valeur levée qui n'est pas une Error) : ${shown(error)}`);
    return send(reply, 500, UNEXPECTED);
  }
  const statusCode = statusOf(error);
  // Journalisée ici, une seule fois : la réponse part par `send`, jamais par `reply.send(error)`, que Fastify journaliserait à son tour.
  if (statusCode >= 500) req.log.error({ err: loggable(error), ...whereOf(req) }, 'Erreur inattendue');
  // Le corps ne reçoit que le message qui est un texte : un `BigInt` ou un objet circulaire fait échouer `JSON.stringify`, et l'objet d'une 4xx
  // partirait au client tel quel.
  const message = attempt(() => error.message, undefined);
  return send(reply, statusCode, typeof message === 'string' ? message : UNEXPECTED);
}

/** D'où vient l'erreur, pour le journal : la méthode et le modèle de la route, jamais l'adresse demandée avec sa requête. */
function whereOf(req: FastifyRequest): { method: string; route: string | undefined } {
  return { method: req.method, route: req.routeOptions.url };
}

/**
 * Le client a-t-il fermé sa connexion avant la réponse ? La réponse brute le dit : Node la détruit à la fermeture de la connexion. `req.signal`
 * ne suffirait pas : Fastify ne l'écoute qu'à sa première lecture, et une route qui ne le lit pas (la liste des Projets) ne le verrait jamais
 * abandonné, même la connexion fermée (mesuré).
 */
function clientLeft(reply: FastifyReply): boolean {
  return reply.raw.destroyed;
}

/**
 * Le code HTTP de la réponse à une erreur : celui qu'elle porte, `statusCode` (Fastify) d'abord, puis `status` (la convention de
 * `http-errors`), le premier qui est un entier de 400 à 599 ; sinon 500. Une erreur ne rend jamais un 2xx ou un 3xx, ni un code que Node
 * refuse (`'abc'`, `99999`, `503.5`) : `reply.code` lèverait, et Fastify prendrait le relais avec son gestionnaire par défaut, qui journalise
 * l'adresse demandée avec sa requête.
 */
function statusOf(error: { statusCode?: unknown; status?: unknown }): number {
  const isHttpError = (code: unknown): code is number => typeof code === 'number' && Number.isInteger(code) && code >= 400 && code < 600;
  return [attempt(() => error.statusCode, undefined), attempt(() => error.status, undefined)].find(isHttpError) ?? 500;
}

/** Plafond d'un texte écrit au journal : un message de 200 000 caractères ne fait pas une ligne de 600 000. */
const LOG_TEXT_MAX = 4_000;
/** Combien de `cause` le journal suit, pas plus (chacune a ses textes, plafonnés eux aussi). */
const LOG_CAUSES_MAX = 3;
/** Combien de propriétés d'une erreur le journal écrit, et la longueur de leurs clés : sans cela, la ligne grossirait avec leur nombre. */
const LOG_PROPS_MAX = 10;
const LOG_KEY_MAX = 64;
/** Combien d'erreurs d'un `AggregateError` le journal écrit. */
const LOG_AGGREGATED_MAX = 3;
/** Le message d'une réponse que rien n'a prévue : ce que le client lit quand l'erreur n'a pas de message texte, ou que le gestionnaire a échoué. */
const UNEXPECTED = 'Erreur inattendue.';

/** `read()`, ou `fallback` s'il lève : une erreur est un objet quelconque, dont un accesseur peut lever, et le journal ne doit pas en dépendre. */
function attempt<T>(read: () => T, fallback: T): T {
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
function clip(text: string): string {
  if (text.length <= LOG_TEXT_MAX) return text;
  const kept = head(text, LOG_TEXT_MAX);
  return `${kept}… (+${text.length - kept.length} caractères)`;
}

/** `value` comme `inspect` la montre (un texte entre guillemets), plafonnée. */
function shown(value: unknown): string {
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
 * Ce que le journal écrit d'une erreur : une copie qui garde son nom de classe (le `type` de la ligne), son message et sa pile (plafonnés), les
 * valeurs simples qu'elle porte (`code`, `errno`, `statusCode`…, les textes plafonnés ; dix au plus), sa `cause` de proche en proche (une `Error`,
 * ou un texte) et les premières erreurs d'un `AggregateError`. Pas ses propriétés qui sont des objets (la réponse et les en-têtes d'un client
 * HTTP, des tampons de sortie…) : ni leur taille ni ce qu'ils portent ne sont connus, et ce n'est pas ce que dit l'erreur. Le sérialiseur de
 * Fastify écrit le reste : `type`, `message`, `stack`, `aggregateErrors`. Rien ne lève ici : un accesseur qui lève ne retire que sa propriété.
 */
function loggable(error: Error, causes = LOG_CAUSES_MAX): Error {
  // Ni `Object.create(Object.getPrototypeOf(error))`, ni une sous-classe : les accesseurs d'un `DOMException` (`name`, `message`, `code`) lèvent sur
  // autre chose que lui, et le sérialiseur de Fastify les lit. Le `type` de la ligne vient de `constructor.name` : celui de l'erreur.
  const copy = Object.create(Error.prototype) as Error;
  // `defineProperty` et non `copy[key] = value` : une propriété nommée `__proto__` changerait le prototype de la copie.
  const put = (key: string, value: unknown, enumerable = true) =>
    Object.defineProperty(copy, key, { value, enumerable, configurable: true, writable: true });
  const constructor = attempt(() => error.constructor, Error);
  put('constructor', typeof constructor === 'function' ? constructor : Error, false);

  // `code` d'abord : celui d'un `DOMException` est un accesseur de son prototype, que `Object.keys` ne voit pas.
  let written = 0;
  for (const key of new Set(['code', ...attempt(() => Object.keys(error), [])])) {
    if (written === LOG_PROPS_MAX) break;
    if (LOGGABLE_OWN.has(key)) continue;
    const value = plain(attempt(() => (error as unknown as Record<string, unknown>)[key], undefined));
    if (value === undefined) continue;
    put(key.length > LOG_KEY_MAX ? head(key, LOG_KEY_MAX) : key, value);
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
  // Les erreurs d'un `AggregateError` : les premières seulement, sans leur propre `cause` ni leurs propres erreurs (une chaîne de causes de trois
  // niveaux en a déjà au plus trois fois trois), et celles qui ne sont pas des `Error`, dites par `inspect`.
  const errors = causes > 0 ? attempt(() => (error as { errors?: unknown }).errors, undefined) : undefined;
  if (Array.isArray(errors)) {
    const inner = (value: unknown) => (value instanceof Error ? loggable(value, 0) : said(value));
    put('errors', errors.slice(0, LOG_AGGREGATED_MAX).map(inner), false);
  }
  return copy;
}

function send(reply: FastifyReply, statusCode: number, message: string, reason?: string): FastifyReply {
  const error = STATUS_CODES[statusCode] ?? 'Error';
  const body: ApiErrorBody = reason === undefined ? { statusCode, error, message } : { statusCode, error, message, reason };
  return reply.code(statusCode).send(body);
}
