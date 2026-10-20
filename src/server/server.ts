import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Config } from './config';

export const HOST = '127.0.0.1';
export const DEFAULT_PORT = 5179;

export interface ServerOptions {
  config: Config;
  /** Dossier de l'interface compilée ; absent en développement (Vite la sert). */
  webRoot?: string;
}

export function buildServer({ webRoot }: ServerOptions): FastifyInstance {
  const app = Fastify({ logger: false });

  app.get('/api/health', async () => ({ status: 'ok' }));

  if (webRoot) {
    app.register(fastifyStatic, { root: webRoot });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'Not Found' });
      return reply.sendFile('index.html');
    });
  }

  return app;
}

export async function startServer(options: ServerOptions & { port?: number }): Promise<FastifyInstance> {
  const app = buildServer(options);
  await app.listen({ host: HOST, port: options.port ?? DEFAULT_PORT });
  return app;
}
