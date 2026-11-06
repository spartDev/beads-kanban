import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer as createHttpServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { createServer, type Plugin, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import viteConfig from '../../vite.config';
import { scratchDir } from './testing/scratch';

/**
 * bdesk-38k.67, relecture B1 : en développement (`pnpm dev`), c'est Vite qui sert la page. Vite 6.4.4 répond la 304 d'une page revalidée (`If-None-Match`) AVANT d'appliquer
 * `server.headers` (`send`, dep-3O3b9SCF.js) : une page encadrée par un site tiers AVANT le correctif, que le navigateur a gardée en cache, resterait sans l'en-tête, et
 * continuerait de s'afficher dans le cadre. Ce fichier pilote la vraie pile d'intergiciels de Vite (`createServer` en mode intergiciel : ni port à lui, ni WebSocket, ni surveillance
 * de fichiers, ni cache de dépendances hors du dossier de test), par une vraie connexion, avec le greffon d'encadrement tel que `vite.config.ts` l'enregistre. Il ne lance pas
 * `pnpm dev` et ne touche ni au port 5173 ni au 5179 : le serveur HTTP est lié à un port éphémère, et aucune adresse `/api` n'est demandée à la configuration réelle (son proxy
 * vise le 5179) ; l'instance n'a que le greffon.
 */

const POLICY = "frame-ancestors 'self' vscode-webview: vscode-file:";

/** Le greffon d'encadrement, tel que `vite.config.ts` l'enregistre : s'il en est retiré, le test s'arrête ici. */
function registeredFramingPlugin(): Plugin {
  const plugin = ((viteConfig.plugins ?? []) as unknown[]).find((p) => typeof p === 'object' && p !== null && (p as Plugin).name === 'frame-ancestors');
  if (!plugin) throw new Error('vite.config.ts n’enregistre pas le greffon « frame-ancestors » : la page servie par Vite en développement peut être encadrée par un site tiers');
  return plugin as Plugin;
}

let vite: ViteDevServer | undefined;
let http: Server | undefined;
let port = 0;

beforeAll(async () => {
  const root = scratchDir('bdesk-vite-');
  writeFileSync(join(root, 'index.html'), '<!doctype html><html><head><title>beads-desktop</title></head><body><div id="root"></div><script type="module" src="/main.js"></script></body></html>');
  writeFileSync(join(root, 'main.js'), 'export const app = 1;\n');
  mkdirSync(join(root, '.cache'));
  vite = await createServer({
    configFile: false,
    root,
    cacheDir: join(root, '.cache'),
    logLevel: 'silent',
    appType: 'spa',
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    plugins: [registeredFramingPlugin()],
  });
  http = createHttpServer(vite.middlewares);
  await new Promise<void>((resolve) => http?.listen(0, '127.0.0.1', resolve));
  port = (http.address() as AddressInfo).port;
}, 60_000);

afterAll(async () => {
  await new Promise<void>((resolve) => (http ? http.close(() => resolve()) : resolve()));
  await vite?.close();
});

function get(path: string, headers: Record<string, string> = {}): Promise<{ status: number; headers: Record<string, string | string[] | undefined> }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, headers }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}

/** Ce que le navigateur envoie pour le document qu'une page d'un autre site met dans une `<iframe>`. */
const FRAMED = { accept: 'text/html', 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'iframe' };

describe('en développement, la page servie par Vite refuse d’être encadrée, la 304 d’une revalidation comprise (bdesk-38k.67, B1)', () => {
  it.each(['/', '/index.html', '/p/x/kanban', '/p/beads-desktop/t/bdesk-38k.7', '/p/beads-desktop/epics?epic=bdesk-38k'])('le document %s porte l’en-tête au 200 et à la 304', async (url) => {
    const first = await get(url, FRAMED);
    const etag = first.headers.etag;

    expect(first.status).toBe(200);
    expect(first.headers['content-security-policy']).toBe(POLICY);
    expect(typeof etag).toBe('string');

    const revalidated = await get(url, { ...FRAMED, 'if-none-match': String(etag) });

    expect(revalidated.status).toBe(304);
    expect(revalidated.headers['content-security-policy']).toBe(POLICY);
  });

  it('un module le porte aussi, à la 304 comme au 200 (sans effet : seul un document s’encadre) : l’intergiciel passe avant ceux de Vite', async () => {
    const first = await get('/main.js', { accept: '*/*', 'sec-fetch-dest': 'script' });

    expect(first.status).toBe(200);
    expect(first.headers['content-security-policy']).toBe(POLICY);

    const revalidated = await get('/main.js', { accept: '*/*', 'sec-fetch-dest': 'script', 'if-none-match': String(first.headers.etag) });

    expect(revalidated.status).toBe(304);
    expect(revalidated.headers['content-security-policy']).toBe(POLICY);
  });

  it('le client de Vite le porte', async () => {
    const res = await get('/@vite/client', { accept: '*/*', 'sec-fetch-dest': 'script' });

    expect(res.status).toBe(200);
    expect(res.headers['content-security-policy']).toBe(POLICY);
  });

  it.each(['/api/health', '/api', '/api/projects?x=1', '/api/projects/beads-desktop/events'])('ne touche pas à ce que le proxy de Vite relaie à l’API : %s', async (url) => {
    // Cette instance n'a pas de proxy : la requête retombe sur Vite (404 pour du JSON). Ce qui compte : aucun en-tête posé avant elle.
    const res = await get(url, { accept: 'application/json' });

    expect(res.headers['content-security-policy']).toBeUndefined();
  });
});
