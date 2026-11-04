import type { FastifyInstance, onRequestAsyncHookHandler } from 'fastify';
import type { LiveChangeEvent } from '../../shared/api';
import { ProjectNotFoundError, type ProjectService } from '../projects/service';
import type { HeadChange, HeadWatcher } from './watcher';

export interface LiveRoutesOptions {
  /**
   * Délai entre deux commentaires `: ping` envoyés sur un flux ouvert (défaut : 20 s). Ils gardent la connexion
   * vivante à travers un proxy (celui de Vite en développement) et révèlent un client parti sans prévenir.
   */
  heartbeatMs?: number;
}

export const DEFAULT_HEARTBEAT_MS = 20_000;
/** Attente avant que le navigateur rouvre un flux coupé (champ `retry:` du protocole). */
const RETRY_MS = 3_000;

/**
 * `GET /api/projects/:projectId/events` : le flux d'événements serveur (SSE) d'un Projet. Il reste ouvert ; chaque
 * changement de HEAD signalé par l'observateur y est écrit en événement `changed` (voir `LiveChangeEvent`). Le Projet
 * est suivi tant que le flux dure : le sondage s'arrête avec le dernier flux, que le client parte ou que le serveur
 * s'arrête (les flux ouverts sont alors terminés, sinon `close()` attendrait des clients qui ne partent pas).
 *
 * La route passe, comme toutes les autres, par le contrôle de l'en-tête Host (hook `onRequest` du serveur), et refuse en
 * plus ce qui ne vient pas de l'application elle-même : une origine qui n'est pas locale (`Origin`) et une requête d'un
 * autre site (`Sec-Fetch-Site`, `no-cors` compris : voir `refuseForeignOrigin`). Ses erreurs (Projet inconnu, requête
 * refusée, lecture des Projets qui échoue) sont celles de l'API : l'appelant l'enregistre dans le même plugin que
 * `registerApi`, dont le gestionnaire d'erreurs leur donne la même forme JSON.
 */
export function registerLiveRoutes(
  app: FastifyInstance,
  projects: Pick<ProjectService, 'list'>,
  watcher: Pick<HeadWatcher, 'subscribe'>,
  { heartbeatMs = DEFAULT_HEARTBEAT_MS }: LiveRoutesOptions = {},
): void {
  /** Les flux ouverts, chacun avec de quoi le terminer. */
  const open = new Set<() => void>();

  // Pas de route HEAD : un HEAD ouvrirait un flux sans corps qui ne se terminerait jamais.
  app.get<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/events',
    { exposeHeadRoute: false, onRequest: refuseForeignOrigin },
    async (req, reply) => {
      const { projectId } = req.params;
      const { projects: known } = await projects.list();
      if (!known.some((project) => project.id === projectId)) throw new ProjectNotFoundError(projectId);
      // Parti pendant la recherche du Projet : personne n'écoute plus, inutile de suivre le Projet.
      if (req.raw.destroyed) return reply.hijack();

      reply.hijack();
      const res = reply.raw;
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
      });
      res.write(`retry: ${RETRY_MS}\n\n`);

      const write = (chunk: string) => {
        if (!res.destroyed && !res.writableEnded) res.write(chunk);
      };
      const unsubscribe = watcher.subscribe(projectId, ({ head }: HeadChange) => {
        const data: LiveChangeEvent = { project: projectId, head };
        write(`event: changed\ndata: ${JSON.stringify(data)}\n\n`);
      });
      const heartbeat = setInterval(() => write(': ping\n\n'), heartbeatMs);
      heartbeat.unref();

      // Une seule fois, quelle que soit la cause : client parti, erreur d'écriture, arrêt du serveur.
      const finish = () => {
        if (!open.delete(finish)) return;
        clearInterval(heartbeat);
        unsubscribe();
        if (!res.writableEnded && !res.destroyed) res.end();
      };
      open.add(finish);
      // 'close' de la réponse : la connexion s'est fermée, ou la réponse est finie. On n'écoute pas celui de la requête :
      // depuis Node 16 il survient dès que le flux de la requête a été lu (un corps consommé), bien avant que le client ne
      // parte. Pour un GET que Fastify ne lit pas, les deux se confondent ; celui de la réponse vaut dans tous les cas.
      res.on('close', finish);
      res.on('error', finish);
    },
  );

  // Avant que le serveur ne ferme ses connexions : un flux ouvert n'est jamais inactif, close() l'attendrait indéfiniment.
  app.addHook('preClose', async () => {
    for (const finish of [...open]) finish();
  });
}

/** Les pages de l'application viennent du serveur (127.0.0.1) ou de son serveur de développement (localhost). */
const LOCAL_ORIGIN_HOSTS = new Set(['127.0.0.1', 'localhost']);

function isLocalOrigin(origin: string): boolean {
  try {
    const { protocol, hostname } = new URL(origin);
    return (protocol === 'http:' || protocol === 'https:') && LOCAL_ORIGIN_HOSTS.has(hostname);
  } catch {
    return false; // « null » (origine opaque : iframe isolée, fichier local…) ou un texte qui n'est pas une origine
  }
}

/**
 * Les seules valeurs de `Sec-Fetch-Site` qui sont les nôtres : `same-origin` (la page de l'application, qui ouvre son
 * flux) et `none` (une adresse tapée dans la barre d'adresse, un signet : l'utilisateur lui-même). `same-site` (même hôte,
 * autre port : une autre application locale) et `cross-site` ne le sont pas, ni rien de ce qu'un navigateur n'envoie pas.
 */
const OWN_FETCH_SITES = new Set(['same-origin', 'none']);

/** Le gestionnaire d'erreurs de l'API en fait un 403 JSON, de la même forme que celui du contrôle de l'en-tête Host. */
class ForeignOriginError extends Error {
  readonly statusCode = 403;

  constructor() {
    super("Origine non autorisée : le flux n'est ouvert que par l'application elle-même (127.0.0.1 ou localhost).");
    this.name = 'ForeignOriginError';
  }
}

/**
 * Le flux n'est ouvert que par l'application elle-même, ce que disent deux en-têtes que le navigateur pose et qu'une page ne
 * peut pas écrire, chacun pour une sorte de requête :
 *
 * - `Origin` accompagne une requête `cors` d'une autre origine. L'EventSource de l'application est de même origine que le
 *   serveur : le navigateur n'y met pas d'`Origin` (il le réserve aux requêtes d'une autre origine). Un `Origin` qui n'est pas
 *   local est donc une autre page, qui ne pourrait pas lire le flux (aucun en-tête CORS) mais le ferait sonder ;
 * - `Sec-Fetch-Site` accompagne toute requête, `no-cors` comprise. Or `fetch(url, { mode: 'no-cors' })`, `<img>`, `<script>`,
 *   `<iframe>` ou une navigation d'une page tierce partent SANS `Origin` : sans lui, elles faisaient ouvrir le flux, chercher le
 *   Projet et le sonder, et une `<iframe>` ou une navigation l'entretenait tant que la page restait ouverte (relecture finale,
 *   m1). On n'accepte que `same-origin` et `none` ; une valeur inconnue est refusée, on ne devine pas. L'absence de l'en-tête
 *   est un client qui n'est pas un navigateur (curl, les tests) : il passe, comme pour `Origin`.
 *
 * Refusé avant de chercher le Projet, pour que la réponse ne dise pas quels Projets existent.
 */
const refuseForeignOrigin: onRequestAsyncHookHandler = async (req) => {
  const { origin } = req.headers;
  if (origin !== undefined && !isLocalOrigin(origin)) throw new ForeignOriginError();
  const site = req.headers['sec-fetch-site'];
  if (site !== undefined && !(typeof site === 'string' && OWN_FETCH_SITES.has(site))) throw new ForeignOriginError();
};
