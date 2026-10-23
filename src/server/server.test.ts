import { request } from 'node:http';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { buildServer, startServer } from './server';

const config = { roots: ['/tmp/roots'], projects: [], hiddenProjects: [] };
let close: (() => Promise<void>) | undefined;

afterEach(async () => {
  await close?.();
  close = undefined;
});

describe('serveur', () => {
  it('répond sur /api/health', async () => {
    const app = buildServer({ config });

    const res = await app.inject({ method: 'GET', url: '/api/health' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('sert l’interface compilée et renvoie index.html pour les routes de l’app', async () => {
    const webRoot = mkdtempSync(join(tmpdir(), 'bdesk-web-'));
    writeFileSync(join(webRoot, 'index.html'), '<!doctype html><title>beads-desktop</title>');
    const app = buildServer({ config, webRoot });

    const res = await app.inject({ method: 'GET', url: '/p/sais/t/beads_sais-udw' });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<title>beads-desktop</title>');
  });

  it('renvoie 404 en JSON pour une route API inconnue, même avec l’interface servie', async () => {
    const webRoot = mkdtempSync(join(tmpdir(), 'bdesk-web-'));
    writeFileSync(join(webRoot, 'index.html'), '<!doctype html>');
    const app = buildServer({ config, webRoot });

    const res = await app.inject({ method: 'GET', url: '/api/nope' });

    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/json');
  });

  it('n’écoute que sur la boucle locale', async () => {
    const app = await startServer({ config, port: 0 });
    close = () => app.close();

    expect((app.server.address() as AddressInfo).address).toBe('127.0.0.1');
  });
});

/** Une interface compilée minimale : index.html et un fichier dans assets/. */
function webRootWithAssets(): string {
  const webRoot = mkdtempSync(join(tmpdir(), 'bdesk-web-'));
  writeFileSync(join(webRoot, 'index.html'), '<!doctype html><title>beads-desktop</title>');
  mkdirSync(join(webRoot, 'assets'));
  writeFileSync(join(webRoot, 'assets', 'app.js'), 'console.log("app");');
  return webRoot;
}

describe('fallback de l’interface (routes de l’app)', () => {
  const get = (url: string, headers: Record<string, string> = {}, method: 'GET' | 'HEAD' | 'POST' = 'GET') =>
    buildServer({ config, webRoot: webRootWithAssets() }).inject({ method, url, headers });

  it('sert les fichiers qui existent', async () => {
    const res = await get('/assets/app.js');

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('console.log("app");');
  });

  it.each([
    '/assets/missing.js',
    '/missing.css',
    '/favicon.png',
    '/assets/index-abc123.js.map',
    '/fonts/geist-mono.woff2',
    '/.env',
    '/robots.txt',
  ])('renvoie 404, et non index.html, pour le fichier manquant %s', async (url) => {
    const res = await get(url);

    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain('<title>');
    expect(res.headers['content-type']).not.toContain('text/html');
  });

  it.each([
    '/',
    '/p/sais',
    '/p/sais/kanban',
    '/p/sais/t/beads_sais-udw',
    '/p/beads-desktop/t/bdesk-38k.7', // l'identifiant d'un ticket enfant contient un point
    '/p/beads-desktop/t/bdesk-38k.7.2',
    '/p/beads-desktop/epics?epic=bdesk-38k',
  ])('renvoie index.html pour la route de l’app %s', async (url) => {
    const res = await get(url);

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<title>beads-desktop</title>');
  });

  it.each([
    ['text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 200],
    ['*/*', 200],
    ['text/*', 200],
    ['application/json, text/plain, */*', 200],
    ['application/json', 404],
    ['image/png', 404],
    ['text/html;q=0', 404],
  ])('avec Accept « %s », répond %i pour une route de l’app', async (accept, status) => {
    expect((await get('/p/sais', { accept })).statusCode).toBe(status);
  });

  it('ne renvoie index.html qu’aux requêtes GET et HEAD', async () => {
    expect((await get('/p/sais', {}, 'HEAD')).statusCode).toBe(200);
    expect((await get('/p/sais', {}, 'POST')).statusCode).toBe(404);
  });

  it.each(['/api', '/api/', '/api?x=1', '/api/nope', '/api/projects/x/nope'])(
    'renvoie 404 en JSON pour %s, comme toute route de l’API, jamais index.html',
    async (url) => {
      const res = await get(url);

      expect(res.statusCode).toBe(404);
      expect(res.headers['content-type']).toContain('application/json');
      expect(res.body).not.toContain('<title>');
    },
  );
});

describe('protection contre le DNS rebinding (en-tête Host)', () => {
  const inject = (host: string, url = '/api/health', webRoot?: string) =>
    buildServer({ config, webRoot }).inject({ method: 'GET', url, headers: { host } });

  it.each(['localhost', 'localhost:80', 'localhost:5179', '127.0.0.1:5179', '127.0.0.1', 'LOCALHOST:8080'])(
    'accepte %s tant que le port d’écoute n’est pas connu (app.inject)',
    async (host) => {
      expect((await inject(host)).statusCode).toBe(200);
    },
  );

  it.each([
    'evil.example.com',
    'evil.example.com:5179',
    'localhost.evil.com:5179',
    '127.0.0.1.evil.com:5179',
    'localhost:5179.evil.com',
    'localhost@evil.com',
    'evil.com/localhost',
    '0.0.0.0:5179',
    '[::1]:5179',
    '192.168.1.10:5179',
    ' localhost',
  ])('refuse %s avec un 403 en JSON', async (host) => {
    const res = await inject(host);

    expect(res.statusCode).toBe(403);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.json()).toMatchObject({ statusCode: 403, error: 'Forbidden' });
  });

  it('refuse une requête sans en-tête Host', async () => {
    const port = await listen({ config });

    expect((await rawGet(port, undefined)).status).toBeGreaterThanOrEqual(400); // Node ou le serveur : jamais 200
  });

  it.each(['/api/projects', '/api/nope', '/', '/p/sais', '/assets/app.js'])('protège toutes les routes, %s compris, et l’interface servie', async (url) => {
    const res = await inject('evil.example.com', url, webRootWithAssets());

    expect(res.statusCode).toBe(403);
    expect(res.body).not.toContain('<title>');
  });

  describe('quand le serveur écoute', () => {
    it('exige le port d’écoute dans le Host, sur localhost comme sur 127.0.0.1', async () => {
      const port = await listen({ config });

      expect((await rawGet(port, `127.0.0.1:${port}`)).status).toBe(200);
      expect((await rawGet(port, `localhost:${port}`)).status).toBe(200);
      expect((await rawGet(port, `localhost:${port + 1}`)).status).toBe(403);
      expect((await rawGet(port, 'localhost')).status).toBe(403); // sans port : le 80 par défaut
      expect((await rawGet(port, `evil.example.com:${port}`)).status).toBe(403);
    });

    it('accepte tout port local en développement, où le proxy de Vite transmet le Host du navigateur', async () => {
      const port = await listen({ config, allowAnyLocalPort: true });

      expect((await rawGet(port, 'localhost:5173')).status).toBe(200);
      expect((await rawGet(port, '127.0.0.1:5173')).status).toBe(200);
      expect((await rawGet(port, 'evil.example.com:5173')).status).toBe(403);
    });
  });
});

async function listen(options: Parameters<typeof startServer>[0]): Promise<number> {
  const app = await startServer({ ...options, port: 0 });
  close = () => app.close();
  return (app.server.address() as AddressInfo).port;
}

/** Une requête GET brute, pour fixer l'en-tête Host que `fetch` ne laisse pas choisir. */
function rawGet(port: number, host: string | undefined, path = '/api/health'): Promise<{ status: number }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, setHost: false, headers: host === undefined ? {} : { host } }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode ?? 0 }));
    });
    req.on('error', reject);
    req.end();
  });
}
