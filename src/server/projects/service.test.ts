import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DoltClient, Row } from '../dolt/client';
import { buildServer } from '../server';
import { createProjectService, ProjectNotFoundError, ProjectUnreadableError } from './service';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

let root: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'bdesk-service-')));
});

afterEach(() => {
  vi.useRealTimers();
});

/** Fait passer `ms` millisecondes pour le service : l'horloge saute, puis reste figée. */
function elapse(ms: number): void {
  const now = Date.now();
  vi.useFakeTimers({ toFake: ['Date'] }); // les vrais délais (sleep) restent réels
  vi.setSystemTime(now + ms);
}

/** Un Projet Dolt embedded dans `root`, avec ou sans le dossier de sa base. */
function project(name: string, { database = true } = {}): void {
  const beads = join(root, name, '.beads');
  mkdirSync(beads, { recursive: true });
  writeFileSync(
    join(beads, 'metadata.json'),
    JSON.stringify({ backend: 'dolt', database: 'dolt', dolt_mode: 'embedded', dolt_database: name }),
  );
  if (database) mkdirSync(join(beads, 'embeddeddolt', name, '.dolt'), { recursive: true });
}

/** Un faux client dolt qui compte les requêtes reçues : un scan en envoie une par Projet lisible. */
function fakeDolt(rows: (sql: string) => Row[] = () => []): DoltClient & { queries: number } {
  const dolt = {
    queries: 0,
    open: (dir: string) => ({
      dir,
      async query(sql: string) {
        dolt.queries++;
        await sleep(5);
        return sql.includes("'issue_prefix'") ? [{ value: 'x' }] : rows(sql);
      },
    }),
  };
  return dolt;
}

const serviceFor = (dolt: DoltClient, rescanIntervalMs?: number) =>
  createProjectService({ roots: [root], projects: [], hiddenProjects: [] }, { dolt, rescanIntervalMs });

describe('rescans provoqués par un Projet inconnu ou illisible', () => {
  beforeEach(() => {
    for (const name of ['a', 'b', 'c']) project(name);
  });

  it('ne relance pas un scan complet à chaque requête vers un Projet inconnu', async () => {
    const dolt = fakeDolt();
    const service = serviceFor(dolt);

    for (let i = 0; i < 10; i++) {
      await expect(service.issues('inconnu')).rejects.toBeInstanceOf(ProjectNotFoundError);
    }

    expect(dolt.queries).toBe(3); // un seul scan, un processus dolt par Projet
  });

  it('partage le scan en cours entre des requêtes simultanées', async () => {
    const dolt = fakeDolt();
    const service = serviceFor(dolt);

    const results = await Promise.allSettled(Array.from({ length: 10 }, () => service.issues('inconnu')));

    expect(results.every((r) => r.status === 'rejected')).toBe(true);
    expect(dolt.queries).toBe(3);
  });

  it('impose environ 5 s entre deux rescans forcés, avec un seul scan pour les requêtes simultanées qui suivent', async () => {
    const dolt = fakeDolt();
    const service = serviceFor(dolt);
    await service.issues('inconnu').catch(() => undefined);
    expect(dolt.queries).toBe(3);

    elapse(4_000);
    await service.issues('inconnu').catch(() => undefined);
    expect(dolt.queries).toBe(3); // trop tôt

    elapse(1_500);
    await Promise.all(Array.from({ length: 5 }, () => service.issues('inconnu').catch(() => undefined)));
    expect(dolt.queries).toBe(6);
  });

  it('prend le délai minimal en option', async () => {
    const dolt = fakeDolt();
    const service = serviceFor(dolt, 10_000);
    await service.issues('inconnu').catch(() => undefined);

    elapse(9_000);
    await service.issues('inconnu').catch(() => undefined);
    expect(dolt.queries).toBe(3);

    elapse(2_000);
    await service.issues('inconnu').catch(() => undefined);
    expect(dolt.queries).toBe(6);
  });

  it('trouve un Projet ajouté depuis le dernier scan, une fois le délai écoulé', async () => {
    const service = serviceFor(fakeDolt(), 1_000);
    await expect(service.issues('d')).rejects.toBeInstanceOf(ProjectNotFoundError);

    project('d');
    await expect(service.issues('d')).rejects.toBeInstanceOf(ProjectNotFoundError); // trop tôt : pas de nouveau scan
    elapse(1_100);

    await expect(service.issues('d')).resolves.toEqual([]);
  });

  it('relit un Projet illisible réparé depuis, une fois le délai écoulé', async () => {
    project('casse', { database: false });
    const service = serviceFor(fakeDolt(), 1_000);
    await expect(service.issues('casse')).rejects.toBeInstanceOf(ProjectUnreadableError);

    mkdirSync(join(root, 'casse', '.beads', 'embeddeddolt', 'casse', '.dolt'), { recursive: true });
    await expect(service.issues('casse')).rejects.toBeInstanceOf(ProjectUnreadableError); // trop tôt
    elapse(1_100);

    await expect(service.issues('casse')).resolves.toEqual([]);
  });
});

describe('erreurs de lecture', () => {
  it('signale un Projet illisible, avec la raison, quand une date de la base est invalide', async () => {
    project('a');
    const dolt = fakeDolt((sql) =>
      sql.includes('from issues')
        ? [{ id: 'x-1', title: 'T', issue_type: 'task', status: 'open', priority: 2, created_at: 'pas une date', updated_at: '2026-10-19 16:46:38' }]
        : [],
    );

    const error = await serviceFor(dolt).issues('a').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ProjectUnreadableError);
    expect((error as ProjectUnreadableError).reason).toContain('Date Dolt invalide');
  });

  it('répond 503 avec la raison, et non 500, quand une date de la base est invalide', async () => {
    project('a');
    const dolt = fakeDolt((sql) =>
      sql.includes('from issues')
        ? [{ id: 'x-1', title: 'T', issue_type: 'task', status: 'open', priority: 2, created_at: 'pas une date', updated_at: '2026-10-19 16:46:38' }]
        : [],
    );
    const app = buildServer({ config: { roots: [root], projects: [], hiddenProjects: [] }, projects: serviceFor(dolt) });

    const res = await app.inject({ url: '/api/projects/a/issues' });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ statusCode: 503, error: 'Service Unavailable', reason: 'Date Dolt invalide : pas une date' });
  });
});
