import { STATUS_CODES } from 'node:http';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest, type FastifyServerOptions } from 'fastify';
import type { ApiErrorBody } from '../shared/api';
import { registerApi } from './api';
import type { Config } from './config';
import { refuseFraming } from './framing';
import { createWatcherLog } from './live/log';
import { registerLiveRoutes } from './live/routes';
import { createHeadWatcher, type HeadWatcher } from './live/watcher';
import { createMetricsService, type MetricsService } from './metrics/service';
import { isOwnRequest } from './origin';
import { createProjectService, type ProjectService } from './projects/service';

export const HOST = '127.0.0.1';
export const DEFAULT_PORT = 5179;

/**
 * Longueur maximale d'un paramètre d'adresse (`:projectId`, `:issueId`). Fastify en refuse plus de 100 par défaut (`maxParamLength`), et ce qu'il compte est le texte décodé, en unités UTF-16,
 * non l'adresse écrite : 255 caractères non ASCII en font plus de 1 500 une fois encodés, et passent. Au-delà, le routeur ne trouve pas la route : 414 (`FST_ERR_MAX_PARAM_LENGTH`) quand l'API
 * est seule (`pnpm dev`), 404 quand l'interface est servie (`pnpm start`), la route `/*` des fichiers prenant alors l'adresse. Un Projet dont le dossier avait plus de 100 caractères était donc
 * listé, mais ni son kanban, ni ses tickets, ni ses Epics, ni son flux en direct ne se chargeaient ; un ticket dont l'identifiant dépasse 100 caractères (le préfixe des tickets est celui de la
 * base, que rien ne borne à 100) ne s'ouvrait pas non plus (bdesk-38k.88).
 *
 * 512 couvre tout ce que l'application met dans ces paramètres :
 * - l'identifiant d'un Projet est le slug du nom de son dossier (`slugify` : des lettres ASCII, des chiffres et des tirets, jamais plus de caractères que le nom, soit 255 au plus : la limite d'un
 *   nom de fichier, en octets sous Linux, en unités UTF-16 sous macOS et Windows), suivi de `-2`, `-3`… quand un autre dossier a le même slug ;
 * - celui d'un ticket tient dans `varchar(255)` : 255 caractères d'au plus deux unités UTF-16 chacun (une paire de substitution), soit 510.
 * Ce qui est plus long n'est ni l'un ni l'autre : le routeur le refuse comme avant. Ce plafond n'est pas une protection : les identifiants ne servent qu'à chercher parmi les Projets découverts
 * et leurs tickets, jamais à composer un chemin ni une requête sans échappement, et les contrôles de `onRequest` (en-tête Host, origine) s'appliquent à ces adresses comme aux autres (avant, celles
 * de plus de 100 caractères n'atteignaient pas la route de l'API : le routeur y répondait lui-même, ou la route des fichiers les prenait). Il n'a d'effet que sur les paramètres de route : la requête
 * (`?project=` des métriques) et le chemin d'un fichier (`/*`) n'en dépendent pas. `param-length.test.ts` et `projects/long-names.integration.test.ts` en fixent les bornes.
 */
export const MAX_PARAM_LENGTH = 512;

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
   * Accepte n'importe quel port dans l'en-tête Host, et dans l'en-tête Origin quand la requête en a un (toujours sur localhost ou
   * 127.0.0.1). Pour le développement : le proxy de Vite relaie les requêtes avec les en-têtes du navigateur, le Host (`localhost:5173`)
   * comme `Origin` et `Sec-Fetch-Site`, pas ceux du serveur.
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
  // `routerOptions` : le `maxParamLength` de premier niveau est obsolète (avertissement FSTDEP022 au démarrage) ; c'est la place que Fastify donne aux réglages du routeur.
  const app = Fastify({ logger, routerOptions: { maxParamLength: MAX_PARAM_LENGTH } });
  const metricsService = metrics ?? createMetricsService(projects, { warn: (message) => app.log.warn(message) });

  // Protection contre le DNS rebinding : une page web hostile peut faire pointer son propre nom de domaine sur
  // 127.0.0.1 et lire l'API depuis le navigateur de l'utilisateur. Sa requête porte alors son nom dans Host.
  app.addHook('onRequest', async (req, reply) => {
    if (isLocalHost(req.headers.host, listeningPort(app), allowAnyLocalPort)) return;
    return forbid(reply, "Hôte non autorisé : l'application n'est joignable que par 127.0.0.1 ou localhost.");
  });

  // Protection contre les pages d'un autre site (bdesk-38k.64) : sans lire la réponse, une page ouverte dans le navigateur de l'utilisateur
  // fait quand même travailler l'API (`<img>`, `fetch` en `no-cors`, formulaire, navigation : lectures Dolt, calcul des métriques, caches). Toute
  // route de l'API refuse ce que n'a pas fait partir l'application elle-même : voir `isOwnRequest` pour `Origin`, `Sec-Fetch-Site` et `Sec-Purpose`. Après le contrôle
  // de l'en-tête Host, qu'une origine locale ne rachète pas. Pas de ligne au journal : une requête refusée (4xx) n'est pas une panne (ADR 0002).
  app.addHook('onRequest', async (req, reply) => {
    if (!isApiRoute(req)) return;
    if (isOwnRequest(req.headers, { port: listeningPort(app), anyPort: allowAnyLocalPort })) return;
    return forbid(reply, "Origine non autorisée : l'API n'est jointe que par l'application elle-même (127.0.0.1 ou localhost).");
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
    // Le document HTML (`/`, `/index.html`, et le repli ci-dessous) refuse d'être encadré par une page d'un autre site (bdesk-38k.67) : voir `framing.ts`. Pas l'API, pas
    // les fichiers, pas les 404 : seul un document se charge dans un cadre, et celui-là appelle l'API en `same-origin`, ce que le contrôle ci-dessus laisse passer.
    app.register(fastifyStatic, { root: webRoot, setHeaders: refuseFraming });
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

/** Un 403 en JSON, de la forme des autres erreurs de l'API. */
function forbid(reply: FastifyReply, message: string): FastifyReply {
  const body: ApiErrorBody = { statusCode: 403, error: STATUS_CODES[403] ?? 'Forbidden', message };
  return reply.code(403).send(body);
}

/**
 * Une route de l'API, telle que le routeur l'a trouvée : `req.routeOptions.url` est son modèle (`/api/projects/:projectId/issues`), jamais
 * l'adresse demandée. Fastify décode l'adresse avant de chercher la route (`/%61pi/projects` est la route `/api/projects`) : lire le début de
 * l'adresse brute laisserait passer ce que le routeur sert quand même. Une adresse sans route (404) ne fait aucun travail : rien à refuser.
 */
function isApiRoute(req: FastifyRequest): boolean {
  const url = req.routeOptions.url;
  return url !== undefined && (url === '/api' || url.startsWith('/api/'));
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
