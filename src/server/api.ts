import { STATUS_CODES } from 'node:http';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { InvalidPeriodError } from '../domain/calendar';
import type {
  ApiErrorBody,
  IssueChronologyResponse,
  IssueResponse,
  IssuesResponse,
  MetricsResponse,
  ProjectsResponse,
  SignalsResponse,
} from '../shared/api';
import { isAbortError } from './abort';
import { type ChronologyService, createChronologyService } from './chronology/service';
import { attempt, clip, identify, loggable, shown, statusOf, UNEXPECTED } from './errorLog';
import { InvalidMetricsQueryError, parseMetricsQuery, parseSignalsQuery } from './metrics/query';
import type { MetricsService } from './metrics/service';
import {
  IssueNotFoundError,
  ProjectNotFoundError,
  type ProjectService,
  ProjectUnreadableError,
} from './projects/service';

/**
 * Routes `/api/projects…`, `/api/metrics` et `/api/signals` ; les erreurs des services deviennent des réponses JSON (400, 404, 503). Chaque lecture
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
 * l'erreur que s'il est un texte ; et un filet autour de tout écrit une ligne fixe, sans adresse (avec, au mieux, le type et le message de
 * l'erreur d'origine), et répond un 500. Ce que l'on lit d'une erreur et ce qu'on en écrit est dans `errorLog.ts`.
 */
export async function registerApi(
  app: FastifyInstance,
  projects: ProjectService,
  metrics: MetricsService,
  chronology: ChronologyService = createChronologyService(projects),
): Promise<void> {
  app.setErrorHandler((error: FastifyError, req, reply) => {
    // Le gestionnaire ne lève jamais : s'il levait, Fastify passerait l'erreur à son gestionnaire par défaut, qui journalise la requête avec son
    // adresse (`?token=…`). Ce que l'on lit de l'erreur est gardé (`attempt`, le message du corps) ; ce filet est pour tout le reste. Sa ligne est
    // fixe, avec au mieux le type et le message de l'erreur d'origine (`original`, plafonnés), jamais l'adresse.
    try {
      return handleError(error, req, reply);
    } catch {
      // `original` est lu avant la ligne, sous garde : la ligne fixe ne dépend pas de ce que `identify` ferait, il ne lève pas aujourd'hui, mais
      // rien ne le promet pour demain.
      const original = attempt(() => identify(error), {});
      attempt(() => req.log.error({ ...whereOf(req), original }, "Erreur inattendue (le gestionnaire d'erreurs a échoué)"), undefined);
      return send(reply, 500, UNEXPECTED);
    }
  });

  app.get('/api/projects', (): Promise<ProjectsResponse> => projects.list());

  app.get<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/issues',
    async (req): Promise<IssuesResponse> => ({ issues: await projects.issues(req.params.projectId, { signal: req.signal }) }),
  );

  app.get<{ Querystring: Record<string, unknown> }>(
    '/api/signals',
    (req): Promise<SignalsResponse> => metrics.signals(parseSignalsQuery(req.query), { signal: req.signal }),
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

function send(reply: FastifyReply, statusCode: number, message: string, reason?: string): FastifyReply {
  const error = STATUS_CODES[statusCode] ?? 'Error';
  const body: ApiErrorBody = reason === undefined ? { statusCode, error, message } : { statusCode, error, message, reason };
  return reply.code(statusCode).send(body);
}
