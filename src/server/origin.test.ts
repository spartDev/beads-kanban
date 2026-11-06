import { readFileSync } from 'node:fs';
import { type IncomingHttpHeaders, request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import type { Project } from '../shared/api';
import type { MetricsService } from './metrics/service';
import { isOwnRequest } from './origin';
import { IssueNotFoundError, ProjectNotFoundError, type ProjectService } from './projects/service';
import { buildServer, startServer } from './server';
import { openStream } from './testing/sse';

/**
 * bdesk-38k.64 : toute route de l'API refuse les requêtes que fait une page d'un autre site (`<img>`, `fetch` en `no-cors`,
 * formulaire, navigation, autre port), pas seulement l'en-tête Host (DNS rebinding). La page ne lit pas la réponse, mais elle faisait
 * travailler le serveur : lectures Dolt, calcul des métriques, caches.
 */

const config = { roots: [], projects: [], hiddenProjects: [] };

const project: Project = { id: 'beads-desktop', name: 'beads-desktop', path: '/dev/beads-desktop', prefix: 'bdesk', mode: 'embedded', status: 'ok' };

/**
 * Des services qui notent chacun de leurs appels : une requête refusée n'en fait aucun (pas de lecture Dolt, pas de calcul). Un ticket
 * et des métriques qu'ils ne connaissent pas répondent 404 : la requête est passée, ce qu'on vérifie, sans rien avoir à fabriquer.
 */
function services() {
  const calls: string[] = [];
  const projects: ProjectService = {
    list: async () => {
      calls.push('list');
      return { projects: [project], ignored: [] };
    },
    issues: async () => {
      calls.push('issues');
      return [];
    },
    issue: async (projectId, issueId) => {
      calls.push('issue');
      throw new IssueNotFoundError(projectId, issueId);
    },
    histories: async () => {
      calls.push('histories');
      return [];
    },
    head: async () => {
      calls.push('head');
      return 'h1';
    },
  };
  const metrics: MetricsService = {
    compute: async () => {
      calls.push('metrics');
      throw new ProjectNotFoundError('nope');
    },
  };
  return { calls, projects, metrics };
}

/** Un observateur du HEAD qui ne sonde rien : le flux s'ouvre sans lancer le sondage de Dolt. */
const idleWatcher = { subscribe: () => () => undefined, watched: () => [], close: () => undefined };

const apps: FastifyInstance[] = [];

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
});

function serve(options: Partial<Parameters<typeof buildServer>[0]> = {}) {
  const { calls, projects, metrics } = services();
  const app = buildServer({ config, projects, metrics, live: { watcher: idleWatcher }, ...options });
  apps.push(app);
  return { app, calls };
}

async function listen(options: Partial<Parameters<typeof startServer>[0]> = {}) {
  const { calls, projects, metrics } = services();
  const app = await startServer({ config, projects, metrics, live: { watcher: idleWatcher }, ...options, port: 0 });
  apps.push(app);
  return { app, calls, port: (app.server.address() as AddressInfo).port };
}

/** Une requête GET brute : les en-têtes (Host compris) que `fetch` ne laisse pas choisir. */
function rawGet(port: number, path: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, setHost: !('host' in headers), headers }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

/** Chaque route de l'API, et la réponse qu'elle donne à l'application elle-même avec ces services. */
const API_ROUTES: [name: string, url: string, status: number][] = [
  ['la santé', '/api/health', 200],
  ['la liste des Projets', '/api/projects', 200],
  ['les tickets d’un Projet', '/api/projects/beads-desktop/issues', 200],
  ['la fiche d’un ticket', '/api/projects/beads-desktop/issues/bdesk-38k.4', 404],
  ['la chronologie d’un ticket', '/api/projects/beads-desktop/issues/bdesk-38k.4/chronology', 404],
  ['les métriques', '/api/metrics?range=7d', 404],
  ['le flux en direct', '/api/projects/beads-desktop/events', 200],
];

/**
 * Ce qu'une page d'un autre site (ou une autre application locale) fait partir, par le navigateur : chaque ligne est une requête qui doit
 * être refusée. `Sec-Fetch-Site` accompagne toute requête, `no-cors` comprise ; `Origin` seulement les requêtes `cors` d'une autre origine.
 */
const HOSTILE: [name: string, headers: Record<string, string>][] = [
  ['un <img> ou un fetch no-cors d’un autre site', { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'no-cors', 'sec-fetch-dest': 'image' }],
  ['un formulaire GET ou un lien d’un autre site (navigation)', { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document', 'sec-fetch-user': '?1' }],
  ['une <iframe> d’un autre site', { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'iframe' }],
  ['un fetch cors d’un autre site', { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty' }],
  ['une autre application locale, même hôte et autre port', { 'sec-fetch-site': 'same-site', 'sec-fetch-mode': 'no-cors', 'sec-fetch-dest': 'image' }],
  ['un navigateur sans Sec-Fetch-Site, fetch cors d’un autre site', { origin: 'https://evil.example' }],
  ['Origin: null (iframe isolée, redirection entre origines)', { origin: 'null' }],
  // Les règles de spéculation de Chrome (`<script type="speculationrules">`, `eagerness: immediate`) font précharger des adresses de l'API SANS aucun geste
  // de l'utilisateur, et le navigateur les demande comme une navigation qu'il aurait lancée : `Sec-Fetch-Site: none`, celui d'une adresse tapée, et pas
  // d'`Origin`. Seul `Sec-Purpose` les trahit (relecture de bdesk-38k.64 : 20 × 200 et 49 appels à dolt, pour des périodes que la page choisit).
  [
    'un préchargement des règles de spéculation de Chrome (Sec-Fetch-Site: none, comme une adresse tapée)',
    { 'sec-fetch-site': 'none', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document', 'sec-purpose': 'prefetch', referer: 'http://evil.example/' },
  ],
  ['le même préchargement, annoncé par l’ancien en-tête Purpose', { 'sec-fetch-site': 'none', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document', purpose: 'prefetch' }],
];

/** Ce que l'on laisse passer : l'application elle-même, et ce qui n'est pas une page web (curl, un script, les tests). `port` : celui du serveur. */
const OWN: [name: string, headers: (port: number) => Record<string, string>][] = [
  ['curl, un script, un test : ni Origin ni Sec-Fetch-Site', () => ({})],
  ['la page de l’application (fetch ou EventSource de même origine)', () => ({ 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty' })],
  ['une adresse tapée dans la barre d’adresse, un signet', () => ({ 'sec-fetch-site': 'none', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document', 'sec-fetch-user': '?1' })],
  ['un navigateur sans Sec-Fetch-Site, qui envoie l’origine de l’application', (port) => ({ origin: `http://localhost:${port}` })],
  // Chrome peut précharger l'APPLICATION (prerender : omnibox, signets, page d'accueil, règles de même origine) : chaque requête de la page préchargée porte alors
  // `Sec-Purpose: prefetch;prerender`, ses `fetch` vers l'API compris, et elles sont `same-origin`. Les refuser montrait « Projets indisponibles » sans reprise
  // (relecture finale de bdesk-38k.64, BUG A).
  [
    'la page de l’application préchargée par Chrome (prerender : ses fetch de même origine portent Sec-Purpose: prefetch;prerender)',
    () => ({ 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty', 'sec-purpose': 'prefetch;prerender' }),
  ],
];

const REFUSED = API_ROUTES.flatMap(([route, url]) => HOSTILE.map(([hostile, headers]) => [route, url, hostile, headers] as const));

describe('API : refuse les requêtes d’une autre origine (bdesk-38k.64)', () => {
  it.each(REFUSED)('%s : refuse %s avec un 403 en JSON, sans rien lire', async (_route, url, _hostile, headers) => {
    const { app, calls } = serve();

    const res = await app.inject({ method: 'GET', url, headers });

    expect(res.statusCode).toBe(403);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.json()).toMatchObject({ statusCode: 403, error: 'Forbidden', message: expect.stringContaining('Origine') });
    expect(calls).toEqual([]); // aucune lecture Dolt, aucun calcul de métriques
  });

  const ACCEPTED = API_ROUTES.filter(([, url]) => !url.endsWith('/events')).flatMap(([route, url, status]) =>
    OWN.map(([own, headers]) => [route, url, own, headers, status] as const),
  );

  it.each(ACCEPTED)('%s : laisse passer %s', async (_route, url, _own, headers, status) => {
    const { app } = serve(); // sans port d'écoute connu : toute origine locale passe

    const res = await app.inject({ method: 'GET', url, headers: headers(5179) });

    expect(res.statusCode).toBe(status);
  });

  it.each(OWN)('le flux en direct : laisse passer %s', async (_own, headers) => {
    const { port } = await listen();

    const stream = await openStream(port, '/api/projects/beads-desktop/events', headers(port));
    await stream.waitFor('retry:');
    stream.close();

    expect(stream.status).toBe(200);
  });

  it('par une vraie connexion : refuse un préchargement (Sec-Purpose ou Purpose, Sec-Fetch-Site: none), laisse passer celui de l’application elle-même (same-origin)', async () => {
    const { port, calls } = await listen();

    const prefetches: Record<string, string>[] = [{ 'sec-purpose': 'prefetch' }, { purpose: 'prefetch' }, { 'sec-purpose': 'prefetch;prerender' }];
    for (const headers of prefetches) {
      const res = await rawGet(port, '/api/metrics?range=7d', { 'sec-fetch-site': 'none', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document', ...headers });
      expect(res.status, JSON.stringify(headers)).toBe(403);
    }
    expect((await rawGet(port, '/api/metrics?range=7d', { 'sec-fetch-site': 'none', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' })).status).toBe(404); // l'adresse tapée passe : 404 des faux services
    // L'application préchargée par Chrome : ses fetch de même origine portent Sec-Purpose (ou Purpose) et passent.
    const prerendered: Record<string, string> = { 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty' };
    expect((await rawGet(port, '/api/metrics?range=7d', { ...prerendered, 'sec-purpose': 'prefetch;prerender' })).status).toBe(404);
    expect((await rawGet(port, '/api/metrics?range=7d', { ...prerendered, purpose: 'prefetch' })).status).toBe(404);
    expect(calls).toEqual(['metrics', 'metrics', 'metrics']); // l'adresse tapée et les deux requêtes de l'application, pas les préchargements hostiles
  });

  it('refuse HEAD comme GET (Fastify en ajoute un à chaque route GET)', async () => {
    const { app, calls } = serve();

    const res = await app.inject({ method: 'HEAD', url: '/api/projects', headers: { 'sec-fetch-site': 'cross-site' } });

    expect(res.statusCode).toBe(403);
    expect(calls).toEqual([]);
  });

  // Fastify décode le chemin avant de chercher la route : `/%61pi/projects` est la route `/api/projects`. Un contrôle qui lirait le
  // début de l'adresse brute (`/api`) ne la verrait pas, et laisserait la page tierce faire travailler le serveur.
  it.each(['/%61pi/projects', '/api/%70rojects', '/%61%70%69/projects?x=1', '/api/projects/beads-desktop/%69ssues', '/api/metrics?range=7d&%72ange=1d'])(
    'refuse aussi l’adresse écrite autrement : %s',
    async (url) => {
      const { app, calls } = serve();

      const res = await app.inject({ method: 'GET', url, headers: { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'no-cors' } });

      expect(res.statusCode).toBe(403);
      expect(calls).toEqual([]);
    },
  );

  it('une requête que le contrôle de l’en-tête Host refuse reste refusée par lui : un Origin ou un Sec-Fetch-Site locaux ne le rachètent pas', async () => {
    const { app, calls } = serve();

    const res = await app.inject({
      method: 'GET',
      url: '/api/projects',
      headers: { host: 'evil.example.com', origin: 'http://localhost:5179', 'sec-fetch-site': 'same-origin' },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ message: expect.stringContaining('Hôte') });
    expect(calls).toEqual([]);
  });

  it('ne refuse que l’API : l’application elle-même, que l’on ouvre depuis un lien d’une autre page, reste servie', async () => {
    const webRoot = fileURLToPath(new URL('../web', import.meta.url)); // src/web : son index.html
    const { app } = serve({ webRoot });
    const navigation = { accept: 'text/html', 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document', 'sec-fetch-user': '?1' };

    for (const url of ['/', '/p/beads-desktop/kanban', '/index.html']) {
      const res = await app.inject({ method: 'GET', url, headers: navigation });

      expect(res.statusCode, url).toBe(200);
      expect(res.body, url).toContain('<title>beads-desktop</title>');
    }
  });
});

describe('API : l’origine est celle du serveur (bdesk-38k.64)', () => {
  it('accepte l’origine servie, 127.0.0.1 ou localhost sur le port d’écoute, et refuse tout autre port', async () => {
    const { port, calls } = await listen();

    expect((await rawGet(port, '/api/projects', { origin: `http://127.0.0.1:${port}` })).status).toBe(200);
    expect((await rawGet(port, '/api/projects', { origin: `http://localhost:${port}` })).status).toBe(200);
    expect(calls).toEqual(['list', 'list']);
    for (const origin of [`http://localhost:${port + 1}`, 'http://127.0.0.1:3000', 'http://localhost:5173', 'http://localhost']) {
      expect((await rawGet(port, '/api/projects', { origin })).status, origin).toBe(403);
    }
    expect(calls).toEqual(['list', 'list']); // les refus n'ont rien lu
  });

  it('ne laisse pas une origine locale racheter un autre site : same-site et cross-site restent refusés', async () => {
    const { port, calls } = await listen();

    for (const site of ['same-site', 'cross-site']) {
      const res = await rawGet(port, '/api/projects', { origin: `http://localhost:${port}`, 'sec-fetch-site': site });
      expect(res.status, site).toBe(403);
    }
    expect(calls).toEqual([]);
  });

  it('en développement, accepte l’origine de n’importe quel port local (le proxy de Vite), jamais un autre hôte ni un autre site', async () => {
    const { port, calls } = await listen({ allowAnyLocalPort: true });

    // La page de Vite (localhost:5173) : le proxy relaie les en-têtes du navigateur tels quels, Host et Sec-Fetch-Site compris.
    const vite = { host: 'localhost:5173', origin: 'http://localhost:5173', 'sec-fetch-site': 'same-origin' };
    expect((await rawGet(port, '/api/projects', vite)).status).toBe(200);
    expect((await rawGet(port, '/api/projects', { host: 'localhost:5173' })).status).toBe(200);
    expect(calls).toEqual(['list', 'list']);
    expect((await rawGet(port, '/api/projects', { ...vite, origin: 'https://evil.example' })).status).toBe(403);
    expect((await rawGet(port, '/api/projects', { ...vite, origin: 'http://evil.example:5173' })).status).toBe(403);
    // Une autre application locale (localhost:3000 vers l'API) est same-site, pas same-origin.
    expect((await rawGet(port, '/api/projects', { ...vite, 'sec-fetch-site': 'same-site' })).status).toBe(403);
    expect((await rawGet(port, '/api/projects', { ...vite, 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect(calls).toEqual(['list', 'list']);
  });
});

describe('API : le refus ne laisse rien au journal (ADR 0002, bdesk-38k.64)', () => {
  it('ni ligne, ni adresse, ni en-tête : une 4xx n’est pas une panne, et une page tierce ne doit pas pouvoir remplir le journal', async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, done) {
        lines.push(String(chunk));
        done();
      },
    });
    const { app, calls } = serve({ logger: { level: 'warn', stream } });

    for (const [, url] of API_ROUTES) {
      const secret = `${url}${url.includes('?') ? '&' : '?'}token=s3cret`;
      const res = await app.inject({
        method: 'GET',
        url: secret,
        headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site', authorization: 'Bearer s3cret', cookie: 'session=s3cret' },
      });
      expect(res.statusCode, url).toBe(403);
    }

    expect(lines).toEqual([]);
    expect(calls).toEqual([]);
  });
});

// L'exception « same-origin + Sec-Purpose » (l'application préchargée par Chrome, BUG A) suppose deux choses de l'application (relecture finale 2 de bdesk-38k.64, B1 ; ADR 0002,
// « Ce que cette exception suppose de l'application »). Une page tierce ne choisit pas l'adresse d'une requête `same-origin`, mais un `<link rel="prerender">` d'une page de
// l'application fait demander à Chrome (NoState Prefetch, sans script) ce que le HTML de l'application nomme, avec `Sec-Fetch-Site: same-origin` et `Sec-Purpose: prefetch` : des requêtes
// que `isOwnRequest` accepte. Et une page d'une autre origine du même site n'est exécutée par un préchargement que si l'application l'accepte par `Supports-Loading-Mode`.
// Un test garde chacune de ces deux conditions.
describe('l’exception same-origin + Sec-Purpose suppose deux choses de l’application (bdesk-38k.64, B1)', () => {
  const webRoot = fileURLToPath(new URL('../web', import.meta.url)); // src/web : son index.html, celui que servent toutes les adresses qui ne sont pas de l'API

  it('le HTML de l’application ne nomme aucune adresse de l’API : un <link rel="prerender"> d’une page tierce la ferait demander, et elle passerait', () => {
    const html = readFileSync(`${webRoot}/index.html`, 'utf8');

    expect(html).toContain('<div id="root">'); // le bon fichier, pas un fichier vide
    expect(html.split('\n').filter((line) => /\/api(?![\w-])/i.test(line))).toEqual([]); // les lignes qui nomment l'API, s'il y en a
  });

  it('l’application n’envoie jamais Supports-Loading-Mode : ni son HTML, ni ses fichiers, ni son API', async () => {
    const { app } = serve({ webRoot });

    for (const url of ['/', '/p/beads-desktop/kanban', '/index.html', '/api/health', '/api/projects']) {
      const res = await app.inject({ method: 'GET', url, headers: { 'sec-fetch-site': 'same-origin' } });

      expect(res.statusCode, url).toBe(200);
      expect(res.headers['supports-loading-mode'], url).toBeUndefined();
    }
  });
});

describe('isOwnRequest : la requête est-elle celle de l’application elle-même ? (bdesk-38k.64)', () => {
  const served = { port: 5179, anyPort: false };
  const own = (headers: IncomingHttpHeaders, policy: Parameters<typeof isOwnRequest>[1] = served) => isOwnRequest(headers, policy);

  it('oui sans Origin ni Sec-Fetch-Site : curl, un script, les tests ne sont pas une page web', () => {
    expect(own({})).toBe(true);
    expect(own({ host: 'localhost:5179', accept: 'application/json', 'user-agent': 'curl/8.7.1' })).toBe(true);
  });

  it.each(['same-origin', 'none'])('oui pour Sec-Fetch-Site: %s (l’application elle-même, une adresse tapée dans la barre d’adresse)', (site) => {
    expect(own({ 'sec-fetch-site': site })).toBe(true);
  });

  // On ne devine pas : seuls `same-origin` et `none` sont les nôtres. Un en-tête répété arrive joint par une virgule.
  it.each(['cross-site', 'same-site', '', 'autre', 'Same-Origin', 'cross-site, same-origin', 'same-origin, cross-site', 'same-origin, same-origin', 'same-origin;q=1'])(
    'non pour Sec-Fetch-Site: %j',
    (site) => {
      expect(own({ 'sec-fetch-site': site })).toBe(false);
    },
  );

  it.each(['http://127.0.0.1:5179', 'http://localhost:5179', 'HTTP://LOCALHOST:5179', 'http://LocalHost:5179'])('oui pour l’origine servie, Origin: %s', (origin) => {
    expect(own({ origin })).toBe(true);
  });

  // Des écritures que le navigateur n'envoie jamais (il écrit l'origine en minuscules et le port sans zéros initiaux) : acceptées, sans effet (relecture finale de
  // bdesk-38k.64, remarque 3, documentée sur `LOCAL_ORIGIN`). Seul un client qui n'est pas un navigateur les envoie, et il passe déjà en n'envoyant pas `Origin`.
  // Le port reste comparé comme un nombre : des zéros devant n'en font pas passer un autre.
  it('accepte les écritures que seul un client sans navigateur envoie (zéros devant le port), et compare le port comme un nombre', () => {
    expect(own({ origin: 'http://127.0.0.1:05179' })).toBe(true);
    expect(own({ origin: 'HTTP://LOCALHOST:05179' })).toBe(true);
    expect(own({ origin: 'http://localhost:05180' })).toBe(false); // le port 5180, avec un zéro devant
    expect(own({ origin: 'http://localhost:0517' })).toBe(false); // le port 517
    expect(own({ origin: 'http://localhost:005179' })).toBe(false); // six chiffres : pas un port
    expect(own({ origin: 'http://localhost:+5179' })).toBe(false);
  });

  it.each([
    ['un autre port local', 'http://localhost:5173'],
    ['un autre port local, 127.0.0.1', 'http://127.0.0.1:3000'],
    ['le port 80 par défaut', 'http://localhost'],
    ['le port 80 écrit', 'http://localhost:80'],
    ['https : le serveur ne parle pas TLS', 'https://localhost:5179'],
    ['https, 127.0.0.1', 'https://127.0.0.1:5179'],
    ['un autre site', 'https://evil.example'],
    ['un autre site, même port', 'http://evil.example:5179'],
    ['localhost en sous-domaine d’un autre site', 'http://localhost.evil.com:5179'],
    ['127.0.0.1 en sous-domaine d’un autre site', 'http://127.0.0.1.evil.com:5179'],
    ['un nom qui commence par le port', 'http://localhost:5179.evil.com'],
    ['des identifiants devant un autre hôte', 'http://localhost@evil.com:5179'],
    ['des identifiants devant le port', 'http://localhost:5179@evil.com'],
    ['des identifiants devant l’hôte local', 'http://user@localhost:5179'],
    ['une origine opaque (iframe isolée, redirection entre origines)', 'null'],
    ['un en-tête vide', ''],
    ['un texte qui n’est pas une origine', 'pas une origine'],
    ['un autre schéma', 'ftp://localhost:5179'],
    ['une adresse qui n’est pas celle qu’écoute le serveur', 'http://0.0.0.0:5179'],
    ['IPv6', 'http://[::1]:5179'],
    ['une écriture courte de 127.0.0.1', 'http://127.1:5179'],
    ['127.0.0.1 en entier', 'http://2130706433:5179'],
    ['un nom pleinement qualifié', 'http://localhost.:5179'],
    ['un chemin (une origine n’en a pas)', 'http://localhost:5179/'],
    ['des origines jointes (en-tête répété)', 'http://localhost:5179, http://evil.example'],
  ])('non pour Origin: %s (%s)', (_name, origin) => {
    expect(own({ origin })).toBe(false);
  });

  // Un préchargement part avec `Sec-Fetch-Site: none` (comme une adresse tapée) et sans `Origin` : seul `Sec-Purpose` (ou l'ancien `Purpose`) le distingue
  // (bdesk-38k.64, relecture). Refusé, sauf `same-origin` : c'est la page de l'application elle-même, préchargée par Chrome (voir plus bas).
  it.each(['prefetch', 'prerender', 'prefetch;prerender', 'prefetch;anonymous-client-ip', ''])(
    'non pour un préchargement, Sec-Purpose: %j, malgré Sec-Fetch-Site: none',
    (purpose) => {
      expect(own({ 'sec-fetch-site': 'none', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document', 'sec-purpose': purpose })).toBe(false);
    },
  );

  it.each(['prefetch', 'prerender', ''])('non pour l’ancien en-tête Purpose: %j, malgré Sec-Fetch-Site: none', (purpose) => {
    expect(own({ 'sec-fetch-site': 'none', purpose })).toBe(false);
  });

  it('non pour un en-tête de préchargement seul, sans Sec-Fetch-Site ni Origin (un navigateur d’avant 2023, un script qui le recopie)', () => {
    expect(own({ 'sec-purpose': 'prefetch' })).toBe(false);
    expect(own({ purpose: 'prefetch' })).toBe(false);
  });

  it('un préchargement ne se rachète pas par l’origine du serveur : sans same-origin, il est refusé', () => {
    for (const site of ['none', 'same-site', 'cross-site', undefined]) {
      const headers: IncomingHttpHeaders = { origin: 'http://localhost:5179', 'sec-purpose': 'prefetch' };
      if (site !== undefined) headers['sec-fetch-site'] = site;
      expect(own(headers), String(site)).toBe(false);
    }
  });

  // L'application préchargée par Chrome (prerender : omnibox, signets, page d'accueil, règles de même origine) : CHAQUE requête de la page préchargée porte
  // `Sec-Purpose: prefetch;prerender`, ses `fetch` vers l'API compris, et elles sont `same-origin`. Les refuser montrait « Projets indisponibles » sans reprise
  // (relecture finale de bdesk-38k.64, BUG A). Une page tierce ne choisit pas l'adresse d'une requête `same-origin` : un préchargement ne se rachète que par là, sous deux
  // conditions que gardent les tests « suppose deux choses de l'application » (B1).
  it.each(['prefetch', 'prerender', 'prefetch;prerender', ''])('oui pour l’application préchargée par Chrome : Sec-Purpose: %j avec Sec-Fetch-Site: same-origin', (purpose) => {
    expect(own({ 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty', 'sec-purpose': purpose })).toBe(true);
    expect(own({ origin: 'http://localhost:5179', 'sec-fetch-site': 'same-origin', 'sec-purpose': purpose })).toBe(true);
  });

  it('oui pour l’ancien en-tête Purpose, de même origine', () => {
    expect(own({ 'sec-fetch-site': 'same-origin', purpose: 'prefetch' })).toBe(true);
  });

  it('same-origin ne rachète pas une origine étrangère, préchargement ou non', () => {
    expect(own({ origin: 'https://evil.example', 'sec-fetch-site': 'same-origin', 'sec-purpose': 'prefetch;prerender' })).toBe(false);
    expect(own({ origin: 'http://localhost:5173', 'sec-fetch-site': 'same-origin', 'sec-purpose': 'prefetch;prerender' })).toBe(false); // un autre port, hors développement
  });

  it('oui pour la même navigation sans en-tête de préchargement : l’adresse tapée', () => {
    expect(own({ 'sec-fetch-site': 'none', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document', 'sec-fetch-user': '?1' })).toBe(true);
  });

  it('le port 80, quand le serveur y écoute, s’écrit sans port', () => {
    const policy = { port: 80, anyPort: false };

    expect(own({ origin: 'http://localhost' }, policy)).toBe(true);
    expect(own({ origin: 'http://127.0.0.1:80' }, policy)).toBe(true);
    expect(own({ origin: 'http://localhost:5179' }, policy)).toBe(false);
  });

  it('sans port d’écoute connu (app.inject), tout port local passe, comme pour l’en-tête Host', () => {
    const policy = { port: undefined, anyPort: false };

    expect(own({ origin: 'http://localhost:5173' }, policy)).toBe(true);
    expect(own({ origin: 'http://127.0.0.1' }, policy)).toBe(true);
    expect(own({ origin: 'http://evil.example:5173' }, policy)).toBe(false);
  });

  it('en développement, tout port local passe (la page vient du serveur de Vite), jamais un autre hôte', () => {
    const dev = { port: 5179, anyPort: true };

    expect(own({ origin: 'http://localhost:5173' }, dev)).toBe(true);
    expect(own({ origin: 'http://127.0.0.1:5174' }, dev)).toBe(true);
    expect(own({ origin: 'http://evil.example:5173' }, dev)).toBe(false);
    expect(own({ origin: 'https://localhost:5173' }, dev)).toBe(false);
    expect(own({ origin: 'null' }, dev)).toBe(false);
  });

  it('les deux en-têtes doivent passer : une origine locale ne rachète pas un autre site, same-origin ne rachète pas une origine étrangère', () => {
    expect(own({ origin: 'http://localhost:5179', 'sec-fetch-site': 'same-origin' })).toBe(true);
    expect(own({ origin: 'http://localhost:5179', 'sec-fetch-site': 'same-site' })).toBe(false);
    expect(own({ origin: 'http://localhost:5179', 'sec-fetch-site': 'cross-site' })).toBe(false);
    expect(own({ origin: 'https://evil.example', 'sec-fetch-site': 'same-origin' })).toBe(false);
    expect(own({ origin: 'null', 'sec-fetch-site': 'none' })).toBe(false);
  });
});
