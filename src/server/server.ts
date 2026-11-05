import { STATUS_CODES } from 'node:http';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyServerOptions } from 'fastify';
import type { ApiErrorBody } from '../shared/api';
import { registerApi } from './api';
import type { Config } from './config';
import { createWatcherLog } from './live/log';
import { registerLiveRoutes } from './live/routes';
import { createHeadWatcher, type HeadWatcher } from './live/watcher';
import { createMetricsService, type MetricsService } from './metrics/service';
import { createProjectService, type ProjectService } from './projects/service';

export const HOST = '127.0.0.1';
export const DEFAULT_PORT = 5179;

export interface ServerOptions {
  config: Config;
  /** Dossier de l'interface compilée ; absent en développement (Vite la sert). */
  webRoot?: string;
  /** Accès aux Projets ; par défaut, celui de la configuration, lu via le CLI `dolt`. */
  projects?: ProjectService;
  /**
   * Calcul des métriques ; par défaut, celui des `projects`, avec l'horloge et le fuseau du serveur. Ce fuseau ne compte les jours que pour les
   * requêtes qui n'en demandent pas (`timeZone` : la page envoie celui du navigateur, bdesk-38k.48). Quand le moteur ne donne pas de nom IANA
   * au fuseau du serveur (variable TZ vide, invalide ou en notation POSIX sans nom IANA, comme `EST5`), ces jours, ces semaines et ces heures se
   * comptent dans le fuseau du système, à défaut en UTC (les durées n'en dépendent pas), et le journal le dit une fois (voir `resolveMetricsTimeZone`).
   */
  metrics?: MetricsService;
  /**
   * Accepte n'importe quel port dans l'en-tête Host (toujours sur localhost ou 127.0.0.1). Pour le développement :
   * le proxy de Vite relaie les requêtes avec le Host du navigateur (`localhost:5173`), pas celui du serveur.
   */
  allowAnyLocalPort?: boolean;
  /**
   * Journal du serveur (l'option `logger` de Fastify). Absent : le serveur est muet. Le CLI y laisse passer les
   * avertissements, dont ceux du sondage du direct : un Projet dont le HEAD ne se lit plus, puis son rétablissement ; et les pannes de
   * l'API : une erreur imprévue (réponse 500, ou tout autre 5xx qu'elle porte ; `error`, avec sa pile) ou un Projet illisible (503, `warn`,
   * sans pile), voir `registerApi`.
   */
  logger?: FastifyServerOptions['logger'];
  /** Mises à jour en direct : le flux SSE de chaque Projet (`GET /api/projects/:projectId/events`). */
  live?: {
    /** Observateur du HEAD des Projets ; par défaut, un sondage de `projects.head` qui s'arrête avec le serveur. */
    watcher?: HeadWatcher;
    /** Intervalle de ce sondage (défaut : `pollIntervalMs` de la configuration, sinon 3 s). */
    intervalMs?: number;
    /** Délai entre deux battements d'un flux ouvert (défaut : 20 s). */
    heartbeatMs?: number;
  };
}

export function buildServer({
  config,
  webRoot,
  projects = createProjectService(config),
  metrics,
  allowAnyLocalPort = false,
  logger = false,
  live = {},
}: ServerOptions): FastifyInstance {
  const app = Fastify({ logger });
  const metricsService = metrics ?? createMetricsService(projects, { warn: (message) => app.log.warn(message) });

  // Protection contre le DNS rebinding : une page web hostile peut faire pointer son propre nom de domaine sur
  // 127.0.0.1 et lire l'API depuis le navigateur de l'utilisateur. Sa requête porte alors son nom dans Host.
  app.addHook('onRequest', async (req, reply) => {
    if (isLocalHost(req.headers.host, listeningPort(app), allowAnyLocalPort)) return;
    const body: ApiErrorBody = {
      statusCode: 403,
      error: STATUS_CODES[403] ?? 'Forbidden',
      message: "Hôte non autorisé : l'application n'est joignable que par 127.0.0.1 ou localhost.",
    };
    return reply.code(403).send(body);
  });

  app.get('/api/health', async () => ({ status: 'ok' }));

  // Mises à jour en direct : le HEAD Dolt des Projets suivis par un flux ouvert est sondé, jamais celui des autres.
  // Ses pannes vont au journal du serveur, une ligne par changement d'état.
  const watcher =
    live.watcher ??
    createHeadWatcher({
      head: (projectId) => projects.head(projectId),
      intervalMs: live.intervalMs ?? config.pollIntervalMs,
      ...createWatcherLog({ warn: (message) => app.log.warn(message) }),
    });
  if (!live.watcher) app.addHook('onClose', async () => watcher.close());

  // Plugin à part : le gestionnaire d'erreurs de l'API ne s'applique pas aux autres routes. Le flux en direct est une route
  // de l'API (`/api/projects/:projectId/events`) : il y est, et ses erreurs ont la même forme que celles des autres.
  app.register(async (api) => {
    await registerApi(api, projects, metricsService);
    registerLiveRoutes(api, projects, watcher, { heartbeatMs: live.heartbeatMs });
  });

  if (webRoot) {
    app.register(fastifyStatic, { root: webRoot });
    // Ce qui n'est ni un fichier ni une route de l'API : index.html pour les routes de l'app, 404 sinon.
    app.setNotFoundHandler((req, reply) => {
      if (isAppRoute(req)) return reply.sendFile('index.html');
      return reply.code(404).send({ error: 'Not Found' });
    });
  }

  return app;
}

export async function startServer(options: ServerOptions & { port?: number }): Promise<FastifyInstance> {
  const app = buildServer(options);
  await app.listen({ host: HOST, port: options.port ?? DEFAULT_PORT });
  return app;
}

/** Le port sur lequel le serveur écoute, inconnu tant qu'il n'écoute pas (tests avec `app.inject`). */
function listeningPort(app: FastifyInstance): number | undefined {
  const address = app.server.address();
  return typeof address === 'object' && address !== null ? address.port : undefined;
}

const LOCAL_HOST = /^(?:127\.0\.0\.1|localhost)(?::(\d{1,5}))?$/i;

/** `127.0.0.1:<port>` ou `localhost:<port>` ; sans port connu (le serveur n'écoute pas), n'importe lequel. */
function isLocalHost(host: string | undefined, port: number | undefined, anyPort: boolean): boolean {
  const match = host === undefined ? null : LOCAL_HOST.exec(host);
  if (!match) return false;
  return anyPort || port === undefined || Number(match[1] ?? 80) === port;
}

/**
 * Une route de l'app (React Router) : une requête GET ou HEAD qui accepte du HTML, hors de l'API (`/api` et `/api/…`)
 * et sans extension de fichier. `.js`, `.css` ou `.woff2` manquants ne sont pas des routes de l'app. En revanche
 * `.7` n'est pas une extension : `/p/beads-desktop/t/bdesk-38k.7` est le ticket enfant d'un Projet.
 */
function isAppRoute(req: FastifyRequest): boolean {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  const path = pathnameOf(req.url);
  if (path === '/api' || path.startsWith('/api/')) return false;
  return acceptsHtml(req.headers.accept) && !FILE_EXTENSION.test(path.slice(path.lastIndexOf('/') + 1));
}

const FILE_EXTENSION = /\.[a-z][a-z0-9]*$/i;

function pathnameOf(url: string): string {
  const path = url.split('?', 1)[0] ?? '';
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

// Sans en-tête Accept, tout est acceptable ; sinon il faut text/html, text/* ou tout (étoile/étoile), avec un q non nul.
function acceptsHtml(accept: string | undefined): boolean {
  if (accept === undefined || accept.trim() === '') return true;
  return accept.split(',').some((range) => {
    const [type = '', ...params] = range.split(';').map((part) => part.trim().toLowerCase());
    const quality = params.find((param) => param.startsWith('q='));
    if (quality !== undefined && Number(quality.slice(2)) === 0) return false;
    return type === 'text/html' || type === 'text/*' || type === '*/*';
  });
}
