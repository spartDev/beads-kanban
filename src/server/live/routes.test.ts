import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '../../shared/api';
import { type ProjectService, ProjectUnreadableError } from '../projects/service';
import { startServer } from '../server';
import { openStream, type Stream } from '../testing/sse';
import { DEFAULT_HEARTBEAT_MS } from './routes';
import type { HeadChange, HeadWatcher } from './watcher';

const config = { roots: [], projects: [], hiddenProjects: [] };

const project = (id: string): Project => ({ id, name: id, path: `/dev/${id}`, prefix: id.slice(0, 3), mode: 'embedded', status: 'ok' });

/**
 * Un service de Projets qui ne connaît que `list` et `head` : le flux n'a rien d'autre à lire. Toute autre méthode
 * lève, et ferait échouer le test qui l'appellerait.
 */
function fakeProjects(heads: Record<string, string | Error>, ids = Object.keys(heads)) {
  const reads: string[] = [];
  const unexpected = (name: string) => () => {
    throw new Error(`${name} ne sert pas aux mises à jour en direct`);
  };
  const service: ProjectService = {
    list: async () => ({ projects: ids.map(project), ignored: [] }),
    issues: unexpected('issues'),
    issue: unexpected('issue'),
    histories: unexpected('histories'),
    head: async (projectId) => {
      reads.push(projectId);
      const head = heads[projectId];
      if (head === undefined) throw new Error(`Projet inconnu : ${projectId}`);
      if (head instanceof Error) throw head;
      return head;
    },
  };
  return { service, heads, reads };
}

/** Un faux observateur : note les abonnements, et laisse le test annoncer un changement. */
function fakeWatcher() {
  const entries = new Set<{ projectId: string; listener: (change: HeadChange) => void }>();
  const state = { subscribed: [] as string[], closed: 0 };
  const watcher: HeadWatcher = {
    subscribe(projectId, listener) {
      const entry = { projectId, listener };
      entries.add(entry);
      state.subscribed.push(projectId);
      return () => void entries.delete(entry);
    },
    watched: () => [...new Set([...entries].map((entry) => entry.projectId))],
    close: () => void state.closed++,
  };
  return {
    watcher,
    state,
    active: () => entries.size,
    emit(projectId: string, head: string) {
      for (const entry of [...entries]) if (entry.projectId === projectId) entry.listener({ projectId, head });
    },
    /** Les abonnés tels qu'ils étaient : pour en appeler un après son départ. */
    listenersOf: (projectId: string) => [...entries].filter((entry) => entry.projectId === projectId).map((entry) => entry.listener),
  };
}

const streams: Stream[] = [];
const servers: FastifyInstance[] = [];

afterEach(async () => {
  for (const stream of streams.splice(0)) stream.close();
  for (const app of servers.splice(0)) await app.close();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function listen(options: Parameters<typeof startServer>[0]): Promise<{ app: FastifyInstance; port: number }> {
  const app = await startServer({ ...options, port: 0 });
  servers.push(app);
  return { app, port: (app.server.address() as AddressInfo).port };
}

/** Arrête un serveur du test, sans que le nettoyage final ne le referme. */
async function shutdown(app: FastifyInstance): Promise<void> {
  servers.splice(servers.indexOf(app), 1);
  await app.close();
}

const until = async (condition: () => boolean, timeoutMs = 3_000) => {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('condition jamais remplie');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const EVENTS = (id: string) => `/api/projects/${id}/events`;

describe('GET /api/projects/:projectId/events : le flux d’un Projet', () => {
  it('s’ouvre en flux d’événements, sans cache, et dit au navigateur de se reconnecter dans 3 s', async () => {
    const { service } = fakeProjects({ alpha: 'h1' });
    const { port } = await listen({ config, projects: service, live: { watcher: fakeWatcher().watcher } });

    const stream = await openStream(port, EVENTS('alpha'));
    await stream.waitFor('retry: 3000\n\n');

    expect(stream.status).toBe(200);
    expect(stream.headers['content-type']).toBe('text/event-stream; charset=utf-8');
    expect(stream.headers['cache-control']).toBe('no-cache, no-transform');
    expect(stream.headers['x-accel-buffering']).toBe('no');
  });

  it('s’abonne à l’observateur pour le Projet demandé, une fois par flux', async () => {
    const { service } = fakeProjects({ alpha: 'h1', beta: 'h1' });
    const fake = fakeWatcher();
    const { port } = await listen({ config, projects: service, live: { watcher: fake.watcher } });

    await (await openStream(port, EVENTS('alpha'))).waitFor('retry:');
    await (await openStream(port, EVENTS('beta'))).waitFor('retry:');
    await (await openStream(port, EVENTS('alpha'))).waitFor('retry:');

    expect(fake.state.subscribed).toEqual(['alpha', 'beta', 'alpha']);
  });

  it('annonce un changement en événement « changed », dont les données JSON disent le Projet et le HEAD', async () => {
    const { service } = fakeProjects({ alpha: 'h1' });
    const fake = fakeWatcher();
    const { port } = await listen({ config, projects: service, live: { watcher: fake.watcher } });
    const stream = await openStream(port, EVENTS('alpha'));
    await until(() => fake.active() === 1);

    fake.emit('alpha', 'h2');

    await stream.waitFor('event: changed\ndata: {"project":"alpha","head":"h2"}\n\n');
  });

  it('n’envoie à un flux que les changements de son Projet', async () => {
    const { service } = fakeProjects({ alpha: 'h1', beta: 'h1' });
    const fake = fakeWatcher();
    const { port } = await listen({ config, projects: service, live: { watcher: fake.watcher } });
    const alpha = await openStream(port, EVENTS('alpha'));
    const beta = await openStream(port, EVENTS('beta'));
    await until(() => fake.active() === 2);

    fake.emit('beta', 'b2');
    await beta.waitFor('"head":"b2"');
    fake.emit('alpha', 'a2');
    await alpha.waitFor('"head":"a2"');

    expect(alpha.received()).not.toContain('b2');
    expect(beta.received()).not.toContain('a2');
  });

  it('sert chacun des flux ouverts sur un même Projet', async () => {
    const { service } = fakeProjects({ alpha: 'h1' });
    const fake = fakeWatcher();
    const { port } = await listen({ config, projects: service, live: { watcher: fake.watcher } });
    const first = await openStream(port, EVENTS('alpha'));
    const second = await openStream(port, EVENTS('alpha'));
    await until(() => fake.active() === 2);

    fake.emit('alpha', 'h2');

    await first.waitFor('"head":"h2"');
    await second.waitFor('"head":"h2"');
  });

  it('répond 404 en JSON pour un Projet inconnu : ni flux, ni abonnement', async () => {
    const { service } = fakeProjects({ alpha: 'h1' });
    const fake = fakeWatcher();
    const { port } = await listen({ config, projects: service, live: { watcher: fake.watcher } });

    const stream = await openStream(port, EVENTS('nope'));
    await stream.closed;

    expect(stream.status).toBe(404);
    expect(stream.headers['content-type']).toContain('application/json');
    expect(JSON.parse(stream.received())).toEqual({ statusCode: 404, error: 'Not Found', message: 'Projet inconnu : nope' });
    expect(fake.state.subscribed).toEqual([]);
  });

  it('ne sert que GET : un HEAD n’ouvre pas de flux qui ne se terminerait jamais', async () => {
    const { service } = fakeProjects({ alpha: 'h1' });
    const fake = fakeWatcher();
    const { port } = await listen({ config, projects: service, live: { watcher: fake.watcher } });

    const status = await new Promise<number>((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, path: EVENTS('alpha'), method: 'HEAD' }, (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode ?? 0));
      });
      req.on('error', reject);
      req.end();
    });

    expect(status).toBe(404);
    expect(fake.state.subscribed).toEqual([]);
  });
});

describe('fin du flux', () => {
  it('se désabonne quand le client s’en va', async () => {
    const { service } = fakeProjects({ alpha: 'h1' });
    const fake = fakeWatcher();
    const { port } = await listen({ config, projects: service, live: { watcher: fake.watcher } });
    const stream = await openStream(port, EVENTS('alpha'));
    await until(() => fake.active() === 1);

    stream.close();

    await until(() => fake.active() === 0);
  });

  it('ne s’abonne pas pour un client déjà parti pendant la recherche du Projet', async () => {
    let listed = false;
    let release: () => void = () => undefined;
    const { service } = fakeProjects({ alpha: 'h1' });
    const slow: ProjectService = {
      ...service,
      list: () =>
        new Promise((resolve) => {
          listed = true;
          release = () => resolve({ projects: [project('alpha')], ignored: [] });
        }),
    };
    const fake = fakeWatcher();
    const { port } = await listen({ config, projects: slow, live: { watcher: fake.watcher } });

    const req = request({ host: '127.0.0.1', port, path: EVENTS('alpha'), headers: { accept: 'text/event-stream' } });
    req.on('error', () => undefined);
    req.end();
    await until(() => listed);
    req.destroy();
    await sleep(30); // le serveur voit la connexion se fermer
    release();
    await sleep(60);

    expect(fake.state.subscribed).toEqual([]);
  });

  it('survit à un changement annoncé après le départ du client', async () => {
    const { service } = fakeProjects({ alpha: 'h1' });
    const fake = fakeWatcher();
    const { port } = await listen({ config, projects: service, live: { watcher: fake.watcher } });
    const stream = await openStream(port, EVENTS('alpha'));
    await until(() => fake.active() === 1);
    const [listener] = fake.listenersOf('alpha');

    stream.close();
    await until(() => fake.active() === 0);
    expect(() => listener?.({ projectId: 'alpha', head: 'tard' })).not.toThrow();
    await sleep(30);

    const health = await openStream(port, '/api/health', { accept: 'application/json' });
    await health.waitFor('"status":"ok"');
  });

  it('termine les flux ouverts quand le serveur s’arrête : la fermeture n’attend pas les clients', async () => {
    const { service } = fakeProjects({ alpha: 'h1' });
    const fake = fakeWatcher();
    const { app, port } = await listen({ config, projects: service, live: { watcher: fake.watcher } });
    const stream = await openStream(port, EVENTS('alpha'));
    await until(() => fake.active() === 1);

    await Promise.race([app.close(), sleep(3_000).then(() => Promise.reject(new Error('close() attend le flux ouvert')))]);
    await stream.closed;

    expect(fake.active()).toBe(0);
  });

  it('ne ferme pas l’observateur qu’on lui a prêté : il appartient à celui qui l’a créé', async () => {
    const { service } = fakeProjects({ alpha: 'h1' });
    const fake = fakeWatcher();
    const { app } = await listen({ config, projects: service, live: { watcher: fake.watcher } });

    await shutdown(app);

    expect(fake.state.closed).toBe(0);
  });

  it('arrête le sondage qu’il a créé : aucune lecture après la fermeture', async () => {
    const { service, reads } = fakeProjects({ alpha: 'h1' });
    const { app, port } = await listen({ config, projects: service, live: { intervalMs: 10 } });
    await (await openStream(port, EVENTS('alpha'))).waitFor('retry:');
    await until(() => reads.length >= 3);

    await shutdown(app);
    const afterClose = reads.length;
    await sleep(100);

    expect(reads).toHaveLength(afterClose);
  });
});

describe('battement', () => {
  it('envoie un commentaire à intervalle régulier pour garder la connexion ouverte', async () => {
    const { service } = fakeProjects({ alpha: 'h1' });
    const { port } = await listen({ config, projects: service, live: { watcher: fakeWatcher().watcher, heartbeatMs: 25 } });
    const stream = await openStream(port, EVENTS('alpha'));

    await stream.waitFor(/: ping\n\n[\s\S]*: ping\n\n/);

    expect(stream.received()).not.toContain('event:');
  });

  it('ne bat que toutes les 20 s par défaut', async () => {
    expect(DEFAULT_HEARTBEAT_MS).toBe(20_000);
    const { service } = fakeProjects({ alpha: 'h1' });
    const { port } = await listen({ config, projects: service, live: { watcher: fakeWatcher().watcher } });
    const stream = await openStream(port, EVENTS('alpha'));
    await stream.waitFor('retry:');

    await sleep(150);

    expect(stream.received()).not.toContain('ping');
  });
});

describe('contrôle de l’en-tête Host (DNS rebinding)', () => {
  it.each(['evil.example.com', 'evil.example.com:5179', 'localhost.evil.com', '0.0.0.0'])(
    'refuse %s avec un 403 en JSON : pas de flux, pas d’abonnement',
    async (host) => {
      const { service } = fakeProjects({ alpha: 'h1' });
      const fake = fakeWatcher();
      const { port } = await listen({ config, projects: service, live: { watcher: fake.watcher } });

      const stream = await openStream(port, EVENTS('alpha'), { host });
      await stream.closed;

      expect(stream.status).toBe(403);
      expect(stream.headers['content-type']).toContain('application/json');
      expect(JSON.parse(stream.received())).toMatchObject({ statusCode: 403, error: 'Forbidden' });
      expect(fake.state.subscribed).toEqual([]);
    },
  );

  it('exige le port d’écoute dans le Host, comme le reste de l’API', async () => {
    const { service } = fakeProjects({ alpha: 'h1' });
    const fake = fakeWatcher();
    const { port } = await listen({ config, projects: service, live: { watcher: fake.watcher } });

    const wrongPort = await openStream(port, EVENTS('alpha'), { host: `localhost:${port + 1}` });
    const right = await openStream(port, EVENTS('alpha'), { host: `localhost:${port}` });
    await right.waitFor('retry:');

    expect(wrongPort.status).toBe(403);
    expect(right.status).toBe(200);
    expect(fake.state.subscribed).toEqual(['alpha']);
  });
});

describe('contrôle de l’en-tête Origin (relecture bdesk-38k.8)', () => {
  // Un EventSource de l'application elle-même (même origine) n'envoie pas d'Origin ; une page d'une autre origine, si.
  // `http://localhost:5173`, `http://localhost` et `https://localhost:8443` sont locales mais ne sont pas celles du serveur (bdesk-38k.64) :
  // une autre application locale, ou un autre port, n'ouvre pas le flux. Le serveur de ce test écoute sur un port libre quelconque.
  it.each([
    'https://evil.example',
    'http://evil.example:5179',
    'http://localhost.evil.com',
    'http://127.0.0.1.evil.com',
    'null',
    'http://0.0.0.0:5179',
    'http://[::1]:5179',
    'ftp://localhost',
    'pas une origine',
    'http://localhost:5173',
    'http://localhost',
    'https://localhost:8443',
  ])(
    'refuse l’origine %s avec un 403 en JSON : pas de flux, pas d’abonnement',
    async (origin) => {
      const { service } = fakeProjects({ alpha: 'h1' });
      const fake = fakeWatcher();
      const { port } = await listen({ config, projects: service, live: { watcher: fake.watcher } });

      const stream = await openStream(port, EVENTS('alpha'), { origin });
      expect(stream.status).toBe(403); // sans quoi le flux resterait ouvert
      await stream.closed;

      expect(stream.headers['content-type']).toContain('application/json');
      expect(JSON.parse(stream.received())).toMatchObject({ statusCode: 403, error: 'Forbidden', message: expect.stringContaining('Origine') });
      expect(fake.state.subscribed).toEqual([]);
    },
  );

  it.each(['http://127.0.0.1:PORT', 'http://localhost:PORT', 'HTTP://LOCALHOST:PORT'])(
    'laisse passer l’origine du serveur, %s (PORT : son port d’écoute)',
    async (template) => {
      const { service } = fakeProjects({ alpha: 'h1' });
      const fake = fakeWatcher();
      const { port } = await listen({ config, projects: service, live: { watcher: fake.watcher } });

      const stream = await openStream(port, EVENTS('alpha'), { origin: template.replace('PORT', String(port)) });
      await stream.waitFor('retry:');

      expect(stream.status).toBe(200);
      expect(fake.state.subscribed).toEqual(['alpha']);
    },
  );

  it('en développement, laisse passer l’origine du serveur de Vite : n’importe quel port local (allowAnyLocalPort)', async () => {
    const { service } = fakeProjects({ alpha: 'h1' });
    const fake = fakeWatcher();
    const { port } = await listen({ config, projects: service, live: { watcher: fake.watcher }, allowAnyLocalPort: true });

    const stream = await openStream(port, EVENTS('alpha'), { host: 'localhost:5173', origin: 'http://localhost:5173', 'sec-fetch-site': 'same-origin' });
    await stream.waitFor('retry:');

    expect(stream.status).toBe(200);
    expect(fake.state.subscribed).toEqual(['alpha']);
  });

  it('refuse avant de chercher le Projet : un Projet inconnu ne se distingue pas d’un Projet connu pour une autre origine', async () => {
    const { service } = fakeProjects({ alpha: 'h1' });
    const { port } = await listen({ config, projects: service, live: { watcher: fakeWatcher().watcher } });

    const unknown = await openStream(port, EVENTS('nope'), { origin: 'https://evil.example' });
    const known = await openStream(port, EVENTS('alpha'), { origin: 'https://evil.example' });
    expect(unknown.status).toBe(403);
    expect(known.status).toBe(403);
    await Promise.all([unknown.closed, known.closed]);

    expect(unknown.received()).toBe(known.received());
  });

  it('ne change rien au contrôle de l’en-tête Host : une origine locale ne rachète pas un Host étranger', async () => {
    const { service } = fakeProjects({ alpha: 'h1' });
    const fake = fakeWatcher();
    const { port } = await listen({ config, projects: service, live: { watcher: fake.watcher } });

    const stream = await openStream(port, EVENTS('alpha'), { host: 'evil.example.com', origin: 'http://localhost:5179' });
    expect(stream.status).toBe(403);
    await stream.closed;

    expect(fake.state.subscribed).toEqual([]);
  });
});

describe('contrôle de l’en-tête Sec-Fetch-Site (relecture finale bdesk-38k.8, m1)', () => {
  // Une requête d'une page tierce qui n'est pas `cors` (`fetch(url, { mode: 'no-cors' })`, <img>, <script>, <iframe>, navigation)
  // part SANS `Origin` : le contrôle de l'Origin ne la voit pas, et elle faisait sonder un Projet (une <iframe> ou une navigation,
  // tant que la page reste ouverte). Le navigateur, lui, la signale : `Sec-Fetch-Site: cross-site` (autre site), ou `same-site`
  // (même hôte, autre port : une autre application locale). Seuls `same-origin` (l'application elle-même) et `none` (une adresse
  // tapée dans la barre d'adresse) sont les nôtres ; un client qui n'est pas un navigateur (curl, les tests) n'envoie pas l'en-tête.

  it.each(['cross-site', 'same-site'])(
    'refuse Sec-Fetch-Site: %s, même sans Origin, avec un 403 en JSON : pas de flux, pas d’abonnement',
    async (site) => {
      const { service } = fakeProjects({ alpha: 'h1' });
      const fake = fakeWatcher();
      const { port } = await listen({ config, projects: service, live: { watcher: fake.watcher } });

      const stream = await openStream(port, EVENTS('alpha'), { 'sec-fetch-site': site, 'sec-fetch-mode': 'no-cors', 'sec-fetch-dest': 'empty' });
      expect(stream.status).toBe(403); // sans quoi le flux resterait ouvert
      await stream.closed;

      expect(stream.headers['content-type']).toContain('application/json');
      expect(JSON.parse(stream.received())).toMatchObject({ statusCode: 403, error: 'Forbidden', message: expect.stringContaining('Origine') });
      expect(fake.state.subscribed).toEqual([]);
    },
  );

  it('ne fait lire le HEAD d’aucun Projet, ni chercher le Projet, pour une page tierce : le défaut constaté (8 lectures en 4,5 s à 500 ms)', async () => {
    const { service, reads } = fakeProjects({ alpha: 'h1' });
    const list = vi.spyOn(service, 'list');
    const { port } = await listen({ config, projects: service, live: { intervalMs: 15 } });

    // La requête de la page tierce, répétée, de chaque sorte.
    const answers: Stream[] = [];
    for (const site of ['cross-site', 'same-site', 'cross-site', 'same-site']) {
      answers.push(await openStream(port, EVENTS('alpha'), { 'sec-fetch-site': site, 'sec-fetch-mode': 'no-cors' }));
    }
    await sleep(150); // dix intervalles de sondage

    expect(reads).toEqual([]);
    expect(list).not.toHaveBeenCalled();
    expect(answers.map((stream) => stream.status)).toEqual([403, 403, 403, 403]);
  });

  it('refuse avant de chercher le Projet : un Projet inconnu ne se distingue pas d’un Projet connu', async () => {
    const { service } = fakeProjects({ alpha: 'h1' });
    const list = vi.spyOn(service, 'list');
    const { port } = await listen({ config, projects: service, live: { watcher: fakeWatcher().watcher } });

    const unknown = await openStream(port, EVENTS('nope'), { 'sec-fetch-site': 'cross-site' });
    const known = await openStream(port, EVENTS('alpha'), { 'sec-fetch-site': 'cross-site' });
    expect(unknown.status).toBe(403);
    expect(known.status).toBe(403);
    await Promise.all([unknown.closed, known.closed]);

    expect(unknown.received()).toBe(known.received());
    expect(list).not.toHaveBeenCalled();
  });

  it.each(['same-origin', 'none'])(
    'laisse passer Sec-Fetch-Site: %s (l’application elle-même, ou une adresse tapée dans la barre d’adresse)',
    async (site) => {
      const { service } = fakeProjects({ alpha: 'h1' });
      const fake = fakeWatcher();
      const { port } = await listen({ config, projects: service, live: { watcher: fake.watcher } });

      const stream = await openStream(port, EVENTS('alpha'), { 'sec-fetch-site': site, 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty' });
      await stream.waitFor('retry:');

      expect(stream.status).toBe(200);
      expect(fake.state.subscribed).toEqual(['alpha']);
    },
  );

  it('laisse passer une requête sans Sec-Fetch-Site : curl, un script, les clients qui ne sont pas des navigateurs', async () => {
    const { service } = fakeProjects({ alpha: 'h1' });
    const fake = fakeWatcher();
    const { port } = await listen({ config, projects: service, live: { watcher: fake.watcher } });

    const stream = await openStream(port, EVENTS('alpha'));
    await stream.waitFor('retry:');

    expect(stream.status).toBe(200);
    expect(fake.state.subscribed).toEqual(['alpha']);
  });

  // Ce qu'un navigateur ne produit pas, ou plus : on ne devine pas, on refuse. Un en-tête répété arrive joint par une virgule.
  it.each(['', 'autre', 'cross-site, same-origin', 'same-origin, cross-site', 'same-origin;q=1'])(
    'refuse la valeur %j : seuls same-origin et none passent',
    async (site) => {
      const { service } = fakeProjects({ alpha: 'h1' });
      const fake = fakeWatcher();
      const { port } = await listen({ config, projects: service, live: { watcher: fake.watcher } });

      const stream = await openStream(port, EVENTS('alpha'), { 'sec-fetch-site': site });
      expect(stream.status).toBe(403);
      await stream.closed;

      expect(fake.state.subscribed).toEqual([]);
    },
  );

  it('une origine locale ne rachète pas un autre site : une autre application de localhost (autre port) est same-site', async () => {
    const { service } = fakeProjects({ alpha: 'h1' });
    const fake = fakeWatcher();
    const { port } = await listen({ config, projects: service, live: { watcher: fake.watcher } });

    const stream = await openStream(port, EVENTS('alpha'), { origin: 'http://localhost:3000', 'sec-fetch-site': 'same-site', 'sec-fetch-mode': 'cors' });
    expect(stream.status).toBe(403);
    await stream.closed;

    expect(fake.state.subscribed).toEqual([]);
  });

  it('same-origin ne rachète pas une origine étrangère : les deux contrôles doivent passer', async () => {
    const { service } = fakeProjects({ alpha: 'h1' });
    const fake = fakeWatcher();
    const { port } = await listen({ config, projects: service, live: { watcher: fake.watcher } });

    const stream = await openStream(port, EVENTS('alpha'), { origin: 'https://evil.example', 'sec-fetch-site': 'same-origin' });
    expect(stream.status).toBe(403);
    await stream.closed;

    expect(fake.state.subscribed).toEqual([]);
  });

  it('ne change rien au contrôle de l’en-tête Host : same-origin ne rachète pas un Host étranger (DNS rebinding)', async () => {
    // Une page `evil.example.com` dont le nom pointe sur 127.0.0.1 est de même origine qu'elle-même : le navigateur dit « same-origin ».
    const { service } = fakeProjects({ alpha: 'h1' });
    const fake = fakeWatcher();
    const { port } = await listen({ config, projects: service, live: { watcher: fake.watcher } });

    const stream = await openStream(port, EVENTS('alpha'), { host: 'evil.example.com', 'sec-fetch-site': 'same-origin' });
    expect(stream.status).toBe(403);
    await stream.closed;

    expect(fake.state.subscribed).toEqual([]);
  });
});

describe('erreurs du flux : la même forme que les autres routes /api (relecture bdesk-38k.8)', () => {
  /** La réponse JSON d'une route, lue comme le ferait un client. */
  async function answer(port: number, path: string): Promise<{ status: number; body: unknown }> {
    const response = await openStream(port, path, { accept: 'application/json' });
    await response.closed;
    return { status: response.status, body: JSON.parse(response.received()) };
  }

  const failingList = (error: Error): ProjectService => ({
    ...fakeProjects({ alpha: 'h1' }).service,
    list: async () => {
      throw error;
    },
  });

  it.each([
    ['une erreur du système (EACCES)', Object.assign(new Error('EACCES: permission denied, scandir /x'), { code: 'EACCES' })],
    ['une erreur ordinaire', new Error('boum')],
  ])('%s dans la recherche du Projet : la même réponse que GET /api/projects', async (_label, error) => {
    const { port } = await listen({ config, projects: failingList(error), live: { watcher: fakeWatcher().watcher } });

    const list = await answer(port, '/api/projects');
    const events = await answer(port, EVENTS('alpha'));

    expect(events.status).toBe(500);
    expect(events).toEqual(list);
    expect(events.body).toEqual({ statusCode: 500, error: 'Internal Server Error', message: error.message });
  });

  it('un Projet illisible dans la recherche : un 503 avec la raison, comme partout dans l’API', async () => {
    const { port } = await listen({
      config,
      projects: failingList(new ProjectUnreadableError('alpha', 'base verrouillée')),
      live: { watcher: fakeWatcher().watcher },
    });

    const list = await answer(port, '/api/projects');
    const events = await answer(port, EVENTS('alpha'));

    expect(events.status).toBe(503);
    expect(events).toEqual(list);
    expect(events.body).toMatchObject({ statusCode: 503, error: 'Service Unavailable', reason: 'base verrouillée' });
  });

  it('un Projet inconnu garde sa forme (404, message du service)', async () => {
    const { service } = fakeProjects({ alpha: 'h1' });
    const { port } = await listen({ config, projects: service, live: { watcher: fakeWatcher().watcher } });

    const events = await answer(port, EVENTS('nope'));

    expect(events).toEqual({ status: 404, body: { statusCode: 404, error: 'Not Found', message: 'Projet inconnu : nope' } });
  });
});

describe('configuration et nettoyage', () => {
  it('sonde à l’intervalle de la configuration (pollIntervalMs) quand rien d’autre n’est donné', async () => {
    const { service, reads } = fakeProjects({ alpha: 'h1' });
    const { port } = await listen({ config: { ...config, pollIntervalMs: 500 }, projects: service });
    const stream = await openStream(port, EVENTS('alpha'));
    await stream.waitFor('retry:');

    await sleep(1_300);

    // Toutes les 500 ms : au moins quatre lectures en 1,3 s (le défaut, 3 s, n'en ferait qu'une).
    expect(reads.length).toBeGreaterThanOrEqual(3);
    expect(reads.length).toBeLessThanOrEqual(5);
  });

  it('sonde toutes les 3 secondes sans configuration : une seule lecture en 1,3 s', async () => {
    const { service, reads } = fakeProjects({ alpha: 'h1' });
    const { port } = await listen({ config, projects: service });
    const stream = await openStream(port, EVENTS('alpha'));
    await stream.waitFor('retry:');

    await sleep(1_300);

    expect(reads).toHaveLength(1);
  });

  it('l’intervalle donné au serveur l’emporte sur la configuration', async () => {
    const { service, reads } = fakeProjects({ alpha: 'h1' });
    const { port } = await listen({ config: { ...config, pollIntervalMs: 3_000 }, projects: service, live: { intervalMs: 20 } });
    await (await openStream(port, EVENTS('alpha'))).waitFor('retry:');

    await until(() => reads.length >= 5);
  });

  it('arrête le battement de chaque flux quand son client part : aucune minuterie ne survit au flux', async () => {
    const { service } = fakeProjects({ alpha: 'h1' });
    const { port } = await listen({ config, projects: service, live: { watcher: fakeWatcher().watcher, heartbeatMs: 4_321 } });
    const started: unknown[] = [];
    const stopped = new Set<unknown>();
    const setInterval = globalThis.setInterval;
    const clearInterval = globalThis.clearInterval;
    vi.spyOn(globalThis, 'setInterval').mockImplementation(((handler: () => void, delay?: number, ...args: unknown[]) => {
      const timer = setInterval(handler, delay, ...args);
      if (delay === 4_321) started.push(timer);
      return timer;
    }) as typeof globalThis.setInterval);
    vi.spyOn(globalThis, 'clearInterval').mockImplementation(((timer: Parameters<typeof clearInterval>[0]) => {
      stopped.add(timer);
      clearInterval(timer);
    }) as typeof globalThis.clearInterval);

    const opened = await Promise.all(Array.from({ length: 5 }, () => openStream(port, EVENTS('alpha'))));
    await Promise.all(opened.map((stream) => stream.waitFor('retry:')));
    expect(started).toHaveLength(5); // un battement par flux
    for (const stream of opened) stream.close();

    await until(() => started.every((timer) => stopped.has(timer)));
  });
});

describe('avec le vrai sondage du HEAD', () => {
  it('annonce le nouveau HEAD dans les secondes qui suivent un commit, une seule fois', async () => {
    const { service, heads } = fakeProjects({ alpha: 'h1' });
    const { port } = await listen({ config, projects: service, live: { intervalMs: 20 } });
    const stream = await openStream(port, EVENTS('alpha'));
    await stream.waitFor('retry:');
    await sleep(80); // l'état de départ est lu, rien n'est annoncé
    expect(stream.received()).not.toContain('event:');

    heads.alpha = 'h2';
    await stream.waitFor('event: changed\ndata: {"project":"alpha","head":"h2"}\n\n');
    await sleep(150);

    expect(stream.received().match(/event: changed/g)).toHaveLength(1);
  });

  it('ne lit rien avant l’ouverture d’un flux, et plus rien après sa fermeture', async () => {
    const { service, reads } = fakeProjects({ alpha: 'h1' });
    const { port } = await listen({ config, projects: service, live: { intervalMs: 15 } });
    await sleep(100);
    expect(reads).toEqual([]);

    const stream = await openStream(port, EVENTS('alpha'));
    await until(() => reads.length >= 3);
    stream.close();
    await sleep(60); // le serveur voit la connexion se fermer
    const afterClose = reads.length;
    await sleep(150);

    expect(reads.length).toBe(afterClose);
  });

  it('partage un seul sondage entre les flux d’un même Projet', async () => {
    const { service, reads } = fakeProjects({ alpha: 'h1' });
    const { port } = await listen({ config, projects: service, live: { intervalMs: 20 } });
    await openStream(port, EVENTS('alpha'));
    await openStream(port, EVENTS('alpha'));
    await openStream(port, EVENTS('alpha'));

    const start = Date.now();
    await sleep(400);
    const elapsed = Date.now() - start;

    // Trois flux, un sondage : au plus une lecture par intervalle, pas trois.
    expect(reads.length).toBeLessThanOrEqual(Math.ceil(elapsed / 20) + 3);
  });

  it('garde le flux ouvert quand le Projet devient illisible, et reprend à son rétablissement', async () => {
    const { service, heads } = fakeProjects({ alpha: 'h1' });
    const { port } = await listen({ config, projects: service, live: { intervalMs: 15 } });
    const stream = await openStream(port, EVENTS('alpha'));
    await stream.waitFor('retry:');
    await sleep(60);

    heads.alpha = new ProjectUnreadableError('alpha', 'base verrouillée');
    await sleep(120);
    expect(stream.received()).not.toContain('event:');

    heads.alpha = 'h2';
    await stream.waitFor('"head":"h2"', 5_000);
    const health = await openStream(port, '/api/health', { accept: 'application/json' });
    await health.waitFor('"status":"ok"');
  });
});

describe('journal du serveur : le sondage rapporte ses pannes sans bruit (relecture bdesk-38k.8)', () => {
  // Le journal est celui du serveur entier : quand le moteur ne reconnaît pas le fuseau local (TZ vide), le service de métriques par défaut y écrit
  // son avertissement de démarrage (bdesk-38k.38, voir metrics/unknown-time-zone.test.ts). Ces tests jugent le sondage, pas le fuseau : il est fixé,
  // et le journal doit rester exactement ce que le sondage y écrit.
  beforeEach(() => {
    vi.stubEnv('TZ', 'UTC');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  /** Un journal Pino de test : chaque ligne écrite est gardée, lue en JSON. */
  function capture() {
    const lines: { level: number; msg: string }[] = [];
    return { lines, stream: { write: (line: string) => void lines.push(JSON.parse(line) as { level: number; msg: string }) } };
  }
  const WARN = 40;

  it('écrit un avertissement quand la lecture d’un Projet suivi se met à échouer, une seule fois malgré les essais qui suivent', async () => {
    const { service, reads } = fakeProjects({ alpha: new ProjectUnreadableError('alpha', 'base verrouillée') });
    const { lines, stream } = capture();
    const { port } = await listen({ config, projects: service, live: { intervalMs: 5 }, logger: { level: 'warn', stream } });
    await (await openStream(port, EVENTS('alpha'))).waitFor('retry:');

    await until(() => reads.length >= 6, 5_000); // six lectures en échec : le sondage ralentit, il n'abandonne pas

    const about = lines.filter((line) => line.msg.includes('alpha'));
    expect(about).toHaveLength(1);
    expect(about[0]).toMatchObject({ level: WARN });
    expect(about[0]?.msg).toContain('base verrouillée');
  });

  it('dit aussi que le Projet est rétabli, une fois', async () => {
    const { service, heads, reads } = fakeProjects({ alpha: new Error('database is locked') });
    const { lines, stream } = capture();
    const { port } = await listen({ config, projects: service, live: { intervalMs: 5 }, logger: { level: 'warn', stream } });
    await (await openStream(port, EVENTS('alpha'))).waitFor('retry:');
    await until(() => reads.length >= 3, 5_000);

    heads.alpha = 'h1';
    await until(() => lines.some((line) => /rétabli/.test(line.msg)), 5_000);
    const afterRecovery = reads.length;
    await until(() => reads.length >= afterRecovery + 5, 5_000); // et la suite est ordinaire

    expect(lines.map((line) => line.msg)).toHaveLength(2);
    expect(lines[0]?.msg).toContain('database is locked');
  });

  it('ne dit rien tant que tout va bien : ni lecture, ni flux ouvert, ni fermeture', async () => {
    const { service, reads } = fakeProjects({ alpha: 'h1' });
    const { lines, stream } = capture();
    const { app, port } = await listen({ config, projects: service, live: { intervalMs: 5 }, logger: { level: 'warn', stream } });
    const open = await openStream(port, EVENTS('alpha'));
    await open.waitFor('retry:');
    await until(() => reads.length >= 10, 5_000);
    open.close();

    await shutdown(app);

    expect(lines).toEqual([]);
  });

  it('n’écrit rien sans journal configuré (le défaut) : le serveur reste muet', async () => {
    const { service, reads } = fakeProjects({ alpha: new Error('database is locked') });
    const writes = vi.spyOn(process.stdout, 'write');
    const { port } = await listen({ config, projects: service, live: { intervalMs: 5 } });
    await (await openStream(port, EVENTS('alpha'))).waitFor('retry:');

    await until(() => reads.length >= 4, 5_000);

    expect(writes.mock.calls.filter(([chunk]) => String(chunk).includes('database is locked'))).toEqual([]);
  });
});
