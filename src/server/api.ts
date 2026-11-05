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
 * Journal du serveur (bdesk-38k.49) : une ligne par réponse qui est une panne, rien pour les autres.
 * - Une erreur que rien n'avait prévue (500, ou tout autre code 5xx qu'elle porte) : niveau `error`, avec son message et sa pile. Rien
 *   n'oblige le code à lever une `Error` (`throw 'x'`, `throw null`) : la valeur levée est alors dans le message, sans pile, et la réponse
 *   est un 500.
 * - Un Projet illisible (503 : base verrouillée, Dolt absent…) : niveau `warn`, la raison seule. C'est une panne de lecture, pas un bogue,
 *   que l'interface montre déjà avec sa raison ; sa pile partirait du service et n'apprendrait rien. L'interface ne le réessaie pas
 *   (`shouldRetry`) : une ligne par demande, sans rafale.
 * - Rien pour ce qui n'est pas une panne du serveur : une requête refusée (400, 404, toute 4xx), ni pour un abandon du client (499).
 * Chaque ligne dit la méthode et le modèle de la route (`/api/projects/:projectId/issues`), jamais l'adresse demandée, ses paramètres, ses
 * en-têtes ni son corps ; son `reqId` la retrouve parmi les lignes d'accès de Fastify (niveau `info`), qui écrivent l'adresse.
 */
export async function registerApi(
  app: FastifyInstance,
  projects: ProjectService,
  metrics: MetricsService,
  chronology: ChronologyService = createChronologyService(projects),
): Promise<void> {
  app.setErrorHandler((error: FastifyError, req, reply) => {
    // Le client est parti (sa requête a été abandonnée) : personne n'attend la réponse, et ce n'est pas une panne : rien au journal.
    if (isAbortError(error)) return send(reply, 499, 'Requête abandonnée par le client.');
    if (error instanceof InvalidMetricsQueryError || error instanceof InvalidPeriodError) {
      return send(reply, 400, error.message);
    }
    if (error instanceof ProjectNotFoundError || error instanceof IssueNotFoundError) {
      return send(reply, 404, error.message);
    }
    if (error instanceof ProjectUnreadableError) {
      req.log.warn(whereOf(req), error.message);
      return send(reply, 503, `Projet illisible : ${error.reason}`, error.reason);
    }
    if (!(error instanceof Error)) {
      // Fastify type l'erreur en `FastifyError`, mais le code peut lever n'importe quoi (`throw 'x'`, `throw null`) : ni message, ni code, ni pile
      // à lire, la valeur elle-même dit ce qu'on en sait. Elle ne part pas au client.
      req.log.error(whereOf(req), `Erreur inattendue (valeur levée qui n'est pas une Error) : ${inspect(error, { breakLength: Infinity })}`);
      return send(reply, 500, 'Erreur inattendue.');
    }
    const statusCode = error.statusCode ?? 500;
    // Journalisée ici, une seule fois : la réponse part par `send`, jamais par `reply.send(error)`, que Fastify journaliserait à son tour.
    if (statusCode >= 500) req.log.error({ err: error, ...whereOf(req) }, `Erreur inattendue : ${error.message}`);
    return send(reply, statusCode, error.message);
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

/** D'où vient l'erreur, pour le journal : la méthode et le modèle de la route, jamais l'adresse demandée avec sa requête. */
function whereOf(req: FastifyRequest): { method: string; route: string | undefined } {
  return { method: req.method, route: req.routeOptions.url };
}

function send(reply: FastifyReply, statusCode: number, message: string, reason?: string): FastifyReply {
  const error = STATUS_CODES[statusCode] ?? 'Error';
  const body: ApiErrorBody = reason === undefined ? { statusCode, error, message } : { statusCode, error, message, reason };
  return reply.code(statusCode).send(body);
}
