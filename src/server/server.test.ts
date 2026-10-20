import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { buildServer, startServer } from './server';

const config = { roots: ['/tmp/roots'], hiddenProjects: [] };
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
