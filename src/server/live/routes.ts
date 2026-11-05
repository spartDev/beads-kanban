import type { FastifyInstance } from 'fastify';
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
 * La route passe, comme toutes celles de l'API, par les hooks `onRequest` du serveur : le contrôle de l'en-tête Host, puis le refus de
 * ce qui ne vient pas de l'application elle-même (une autre origine, ou une requête d'un autre site, `no-cors` comprise : voir
 * `isOwnRequest`). Ils répondent avant la route, donc avant de chercher le Projet : le refus ne dit pas quels Projets existent, et ne lance
 * ni découverte ni sondage. Ses autres erreurs (Projet inconnu, lecture des Projets qui échoue) sont celles de l'API : l'appelant
 * l'enregistre dans le même plugin que `registerApi`, dont le gestionnaire d'erreurs leur donne la même forme JSON.
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
    { exposeHeadRoute: false },
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
