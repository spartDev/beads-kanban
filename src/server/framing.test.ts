import { request } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import viteConfig from '../../vite.config';
import { FRAME_ANCESTORS, frameAncestorsPlugin, refuseFraming, refuseFramingInDev } from './framing';
import { buildServer, startServer } from './server';
import { scratchDir } from './testing/scratch';

/**
 * bdesk-38k.67 : l'application refuse d'être encadrée (`<iframe>`, `<frame>`, `<object>`, `<embed>`) par une page d'un autre site. Le garde de
 * bdesk-38k.64 ferme l'API aux pages tierces, mais une page tierce qui met l'application elle-même dans une `<iframe>` cachée la fait appeler
 * SON API, en `same-origin` : le garde les laisse passer, comme il le doit. C'est le document HTML qu'il faut protéger : `Content-Security-Policy:
 * frame-ancestors 'self' vscode-webview: vscode-file:` (décision de l'utilisateur, option C ; ADR 0002), sur ce document seulement.
 */

const config = { roots: [], projects: [], hiddenProjects: [] };

/** La valeur décidée, écrite en toutes lettres : un test qui la lirait dans le code ne verrait pas qu'on l'a changée. */
const POLICY = "frame-ancestors 'self' vscode-webview: vscode-file:";

let close: (() => Promise<void>) | undefined;

afterEach(async () => {
  await close?.();
  close = undefined;
});

/** Une interface compilée minimale : index.html, un fichier JavaScript dans assets/ et une icône. */
function webRootWithAssets(): string {
  const webRoot = scratchDir('bdesk-web-');
  writeFileSync(join(webRoot, 'index.html'), '<!doctype html><title>beads-desktop</title>');
  writeFileSync(join(webRoot, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  mkdirSync(join(webRoot, 'assets'));
  writeFileSync(join(webRoot, 'assets', 'app.js'), 'console.log("app");');
  return webRoot;
}

/** Ce que le navigateur envoie pour le document qu'une page d'un autre site met dans une `<iframe>`. */
const FRAMED = { accept: 'text/html', 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'iframe' };

const get = (url: string, headers: Record<string, string> = FRAMED, method: 'GET' | 'HEAD' = 'GET') =>
  buildServer({ config, webRoot: webRootWithAssets() }).inject({ method, url, headers });

describe('le document HTML refuse d’être encadré par une page d’un autre site (bdesk-38k.67)', () => {
  it.each([
    '/',
    '/index.html',
    '/p/x/kanban',
    '/p/beads-desktop/t/bdesk-38k.7', // l'identifiant d'un ticket enfant contient un point
    '/p/beads-desktop/epics?epic=bdesk-38k',
    '/?id=1&vscodeBrowserReqId=2', // ce que le Simple Browser de VS Code ajoute à l'adresse qu'il encadre
  ])('pose frame-ancestors sur le document %s', async (url) => {
    const res = await get(url);

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<title>beads-desktop</title>');
    expect(res.headers['content-security-policy']).toBe(POLICY);
  });

  it.each(['/', '/p/x/kanban'])('le pose aussi sans en-tête Accept ni Sec-Fetch-*, et sur HEAD : %s', async (url) => {
    for (const method of ['GET', 'HEAD'] as const) {
      const res = await get(url, {}, method);

      expect(res.statusCode, `${method} ${url}`).toBe(200);
      expect(res.headers['content-security-policy'], `${method} ${url}`).toBe(POLICY);
    }
  });

  it('le pose aussi sur la réponse 304 d’une revalidation : un document déjà en cache, d’avant le correctif, le reçoit', async () => {
    const app = buildServer({ config, webRoot: webRootWithAssets() });
    const first = await app.inject({ method: 'GET', url: '/', headers: FRAMED });
    const etag = first.headers.etag;
    expect(typeof etag).toBe('string');

    const res = await app.inject({ method: 'GET', url: '/', headers: { ...FRAMED, 'if-none-match': String(etag) } });

    expect(res.statusCode).toBe(304);
    expect(res.headers['content-security-policy']).toBe(POLICY);
  });

  it.each([
    ['/api/health', 200],
    ['/api/projects', 200],
    ['/api/nope', 404],
  ])('ne le pose pas sur l’API : %s', async (url, status) => {
    const res = await get(url, { 'sec-fetch-site': 'same-origin' });

    expect(res.statusCode).toBe(status);
    expect(res.headers['content-security-policy']).toBeUndefined();
  });

  it.each(['/assets/app.js', '/favicon.svg'])('ne le pose pas sur un fichier de l’interface : %s', async (url) => {
    const res = await get(url, { 'sec-fetch-site': 'same-origin' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-security-policy']).toBeUndefined();
  });

  it.each([
    ['/assets/missing.js', FRAMED],
    ['/p/x/kanban', { accept: 'application/json' }], // une route de l'app qui n'accepte pas du HTML : 404 JSON, pas index.html
    ['/api', FRAMED],
  ])('ne le pose pas sur un 404 : %s', async (url, headers) => {
    const res = await get(url, headers);

    expect(res.statusCode).toBe(404);
    expect(res.headers['content-security-policy']).toBeUndefined();
  });

  it('n’envoie jamais X-Frame-Options : il ne sait pas nommer les éditeurs (vscode-webview:), et refuserait leur Simple Browser', async () => {
    for (const url of ['/', '/p/x/kanban', '/assets/app.js', '/api/health', '/assets/missing.js']) {
      const res = await get(url);

      expect(res.headers['x-frame-options'], url).toBeUndefined();
    }
  });

  it('sans interface servie (développement : c’est Vite qui sert la page), aucune réponse ne le porte', async () => {
    for (const url of ['/', '/p/x/kanban', '/api/health']) {
      const res = await buildServer({ config }).inject({ method: 'GET', url, headers: FRAMED });

      expect(res.headers['content-security-policy'], url).toBeUndefined();
    }
  });

  it('par une vraie connexion : le document le porte, ni l’API ni les fichiers', async () => {
    const app = await startServer({ config, webRoot: webRootWithAssets(), port: 0 });
    close = () => app.close();
    const port = (app.server.address() as AddressInfo).port;

    const seen = async (path: string) => (await rawGet(port, path)).policy;

    expect(await seen('/')).toBe(POLICY);
    expect(await seen('/p/x/kanban')).toBe(POLICY);
    expect(await seen('/index.html')).toBe(POLICY);
    expect(await seen('/api/health')).toBeUndefined();
    expect(await seen('/assets/app.js')).toBeUndefined();
    expect(await seen('/favicon.svg')).toBeUndefined();
  });
});

describe('la valeur de l’en-tête, et où elle est posée (bdesk-38k.67)', () => {
  it('est celle que l’utilisateur a décidée (option C) : l’application, les éditeurs bâtis sur VS Code, aucune page web', () => {
    expect(FRAME_ANCESTORS).toBe(POLICY);
  });

  it.each(['index.html', 'docs.html', 'ancien.htm', 'MAJUSCULES.HTML', 'assets/sous/index.html'])('refuseFraming pose l’en-tête sur le document %s', (name) => {
    const set: [string, string][] = [];

    refuseFraming({ setHeader: (key, value) => set.push([key, value]) }, `/dist/web/${name}`);

    expect(set).toEqual([['Content-Security-Policy', POLICY]]);
  });

  it.each(['assets/index-abc123.js', 'assets/index-abc123.css', 'favicon.svg', 'assets/geist.woff2', 'assets/index.js.map', 'assets/html', 'page.html.js'])(
    'refuseFraming ne pose rien sur le fichier %s',
    (name) => {
      const set: [string, string][] = [];

      refuseFraming({ setHeader: (key, value) => set.push([key, value]) }, `/dist/web/${name}`);

      expect(set).toEqual([]);
    },
  );

  it('un autre document HTML ajouté au dossier de l’interface est refusé aussi, sans rien déclarer (le défaut est de refuser)', async () => {
    const webRoot = webRootWithAssets();
    writeFileSync(join(webRoot, 'aide.html'), '<!doctype html><title>aide</title>');

    const res = await buildServer({ config, webRoot }).inject({ method: 'GET', url: '/aide.html', headers: FRAMED });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-security-policy']).toBe(POLICY);
  });

  it.each(['//', '/INDEX.HTML', '/index.html?x=1', '/p/x/kanban/', '/./', '/%2e/', '/assets/../index.html', '/assets/%2e%2e/index.html'])(
    'le pose aussi sur le document servi par une adresse écrite autrement : %s (relecture de bdesk-38k.67, R5)',
    async (url) => {
      const res = await get(url);

      expect(res.statusCode, url).toBe(200);
      expect(res.body, url).toContain('<title>beads-desktop</title>');
      expect(res.headers['content-security-policy'], url).toBe(POLICY);
    },
  );
});

// En développement (`pnpm dev`), Vite sert la page (le serveur de `--dev` n'a pas d'interface). Son `server.headers` n'est pas appliqué à la 304 d'une page revalidée (relecture de
// bdesk-38k.67, B1) : c'est un intergiciel de greffon, le premier de la pile, qui pose l'en-tête. `framing.vite.test.ts` le fait tourner dans la vraie pile de Vite ; ici, sa logique
// et son enregistrement.
describe('en développement : l’intergiciel du greffon de Vite (bdesk-38k.67, B1)', () => {
  const run = (url: string | undefined) => {
    const events: string[] = [];
    refuseFramingInDev(
      { url },
      { setHeader: (key, value) => events.push(`${key}: ${value}`) },
      () => events.push('next'),
    );
    return events;
  };

  it.each(['/', '/index.html', '/p/x/kanban', '/p/beads-desktop/t/bdesk-38k.7', '/src/main.tsx', '/@vite/client', '/node_modules/.vite/deps/react.js?v=abc', '//', '/API/projects', '/p/api/x', '/favicon.svg'])(
    'pose l’en-tête AVANT de passer la main, pour %s',
    (url) => {
      expect(run(url)).toEqual([`Content-Security-Policy: ${POLICY}`, 'next']);
    },
  );

  it.each(['/api', '/api/', '/api/projects', '/api/projects/beads-desktop/events', '/api?x=1', '/api/metrics?range=7d'])('ne touche pas à l’API, que le proxy de Vite relaie : %s', (url) => {
    expect(run(url)).toEqual(['next']);
  });

  it('passe la main aussi quand l’adresse manque', () => {
    expect(run(undefined)).toEqual([`Content-Security-Policy: ${POLICY}`, 'next']);
  });

  it('le greffon enregistre l’intergiciel pendant `configureServer` même (un intergiciel posé dans la fonction qu’il renverrait passerait APRÈS ceux de Vite, dont celui qui répond la 304)', () => {
    const used: unknown[] = [];
    const plugin = frameAncestorsPlugin();
    const configureServer = plugin.configureServer as (server: unknown) => unknown;

    const returned = configureServer({ middlewares: { use: (fn: unknown) => used.push(fn) } });

    expect(used).toEqual([refuseFramingInDev]);
    expect(returned).toBeUndefined();
    expect(plugin.enforce).toBe('pre');
  });

  it('vite.config.ts enregistre le greffon, en premier, et ne compte plus sur server.headers (qui ne couvre pas la 304)', () => {
    const plugins = (viteConfig.plugins ?? []) as unknown[];
    const first = plugins[0] as { name?: string; enforce?: string } | undefined;

    expect(first?.name).toBe('frame-ancestors');
    expect(first?.enforce).toBe('pre');
    expect(viteConfig.server?.headers).toBeUndefined();
  });
});

/** Une requête GET par une vraie connexion, et l'en-tête `Content-Security-Policy` de la réponse. */
function rawGet(port: number, path: string): Promise<{ status: number; policy: string | undefined }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, headers: FRAMED }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode ?? 0, policy: res.headers['content-security-policy'] as string | undefined }));
    });
    req.on('error', reject);
    req.end();
  });
}
