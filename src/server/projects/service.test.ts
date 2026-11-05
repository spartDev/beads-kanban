import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReadAborted } from '../abort';
import type { DoltClient, QueryOptions, Row } from '../dolt/client';
import { assertReadOnly } from '../dolt/read-only';
import { buildServer } from '../server';
import { scratchDir } from '../testing/scratch';
import { createProjectService, IssueNotFoundError, ProjectNotFoundError, ProjectUnreadableError } from './service';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Attend que `condition` soit vraie (3 s au plus) : la condition, jamais un délai fixe, dit que le test peut continuer (bdesk-38k.45).
 * Le plafond reste sous le délai de 5 s des tests du projet `node` (`vite.config.ts`) : au-delà, c'est vitest qui coupe le test, sans
 * dire quelle condition n'est jamais venue.
 */
async function until(condition: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`jamais vrai : ${what}`);
    await sleep(2);
  }
}

let root: string;

beforeEach(() => {
  root = realpathSync(scratchDir('bdesk-service-'));
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

/** Un faux client dolt qui compte (et garde) les requêtes reçues : un scan en envoie une par Projet lisible. */
function fakeDolt(rows: (sql: string) => Row[] = () => []): DoltClient & { queries: number; sqls: string[] } {
  const dolt = {
    queries: 0,
    sqls: [] as string[],
    open: (dir: string) => ({
      dir,
      async query(sql: string) {
        dolt.queries++;
        dolt.sqls.push(sql);
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

  it('répond 503 avec la raison, sans la requête, quand le garde-fou du client refuse une lecture fautive', async () => {
    project('a');
    // Un lecteur fautif qui construirait une écriture : le client la refuse (avec le vrai garde-fou) avant de lancer dolt.
    const dolt = fakeDolt((sql) => {
      if (sql.includes('from issues')) assertReadOnly("delete from issues where id = 'SECRET-ID'");
      return [];
    });
    const app = buildServer({ config: { roots: [root], projects: [], hiddenProjects: [] }, projects: serviceFor(dolt) });

    const res = await app.inject({ url: '/api/projects/a/issues' });

    expect(res.statusCode).toBe(503);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.json()).toMatchObject({ statusCode: 503, error: 'Service Unavailable', reason: expect.stringContaining('lecture seule') });
    expect(res.body).not.toMatch(/SECRET-ID|delete|from issues/i);
  });
});

describe('identifiant de ticket', () => {
  it('un octet nul désigne un ticket inconnu : la base n’est pas interrogée avec lui (dolt ne pourrait pas le recevoir)', async () => {
    project('a');
    const dolt = fakeDolt();
    const service = serviceFor(dolt);
    await service.list(); // le scan lit le préfixe de chaque Projet
    const scanned = dolt.sqls.length;

    const error = await service.issue('a', 'x\u0000y').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(IssueNotFoundError);
    expect(dolt.sqls).toHaveLength(scanned);
  });

  it('un Projet inconnu reste un Projet inconnu, même avec un octet nul dans l’identifiant du ticket', async () => {
    project('a');

    await expect(serviceFor(fakeDolt()).issue('inconnu', 'x\u0000y')).rejects.toBeInstanceOf(ProjectNotFoundError);
  });

  it('GET /api/projects/:p/issues/x%00y répond 404 en JSON, sans SQL', async () => {
    project('a');
    const app = buildServer({ config: { roots: [root], projects: [], hiddenProjects: [] }, projects: serviceFor(fakeDolt()) });

    const res = await app.inject({ url: '/api/projects/a/issues/x%00y' });

    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.json()).toMatchObject({ statusCode: 404, error: 'Not Found' });
    expect(res.body).not.toMatch(/select|from issues|read only/i);
  });
});

describe('lectures regroupées et abandonnables (bdesk-38k.20)', () => {
  beforeEach(() => project('a'));

  const SUMMARY = { id: 'x-1', title: 'T', issue_type: 'task', status: 'open', priority: 2, created_at: '2026-10-19 16:46:38', updated_at: '2026-10-19 16:46:38' };
  const answer = (sql: string): Row[] => {
    if (sql.includes("hashof('HEAD')")) return [{ head: 'h1' }];
    if (sql.includes('from labels') || sql.includes('from comments') || sql.includes('from dependencies')) return [];
    return [SUMMARY];
  };

  /**
   * Un faux client dolt qui groupe comme le vrai : chaque appel à `query` ou à `queryAll` est UN processus. Il garde les
   * groupes et les options reçues, et — pour les lectures qui ne finissent pas — rejette par une `ReadAborted` quand
   * le signal est abandonné, comme le fait le vrai client en tuant le processus.
   */
  function groupingDolt(reply: (sql: string) => Row[] = answer, hang = false) {
    const seen = { processes: 0, groups: [] as string[][], singles: [] as string[], signals: [] as (AbortSignal | undefined)[], lanes: [] as string[] };
    const respond = <T>(value: T, options?: QueryOptions): Promise<T> => {
      seen.processes++;
      seen.signals.push(options?.signal);
      seen.lanes.push(options?.lane ?? 'normal');
      if (!hang) return Promise.resolve(value);
      return new Promise<T>((_resolve, reject) => options?.signal?.addEventListener('abort', () => reject(new ReadAborted())));
    };
    const dolt: DoltClient = {
      open: (dir) => ({
        dir,
        async query(sql, options) {
          if (sql.includes("'issue_prefix'")) return [{ value: 'x' }]; // la découverte : ce n'est pas la lecture que l'on compte
          seen.singles.push(sql);
          return respond(reply(sql), options);
        },
        async queryAll(sqls, options) {
          seen.groups.push([...sqls]);
          return respond(sqls.map(reply), options);
        },
      }),
    };
    return { dolt, seen };
  }

  it('lit une fiche en deux processus : le ticket avec ses étiquettes et ses commentaires, et ce que tout le Projet partage', async () => {
    const { dolt, seen } = groupingDolt();

    const detail = await serviceFor(dolt).issue('a', 'x-1');

    expect(detail).toMatchObject({ id: 'x-1', labels: [], comments: [] });
    expect(seen.processes).toBe(2);
    expect(seen.singles).toEqual([]);
    expect(seen.groups.map((group) => group.length).sort()).toEqual([2, 3]);
  });

  it('nomme l’Epic de la fiche sans un processus de plus : elle se tire des tickets que la fiche lit déjà (bdesk-38k.29)', async () => {
    const tickets = [
      { ...SUMMARY, id: 'x-1', title: 'L’Epic', issue_type: 'epic' },
      { ...SUMMARY, id: 'x-2', title: 'L’Enfant' },
      { ...SUMMARY, id: 'x-3', title: 'Le petit-enfant' },
    ];
    const parentChild = [
      { issue_id: 'x-2', depends_on_issue_id: 'x-1', type: 'parent-child' },
      { issue_id: 'x-3', depends_on_issue_id: 'x-2', type: 'parent-child' },
    ];
    const projectWith = (links: Row[]) => (sql: string): Row[] => {
      if (sql.includes("hashof('HEAD')")) return [{ head: 'h1' }];
      if (sql.includes('from labels') || sql.includes('from comments')) return [];
      if (sql.includes('from dependencies')) return links;
      if (sql.includes('where id =')) return tickets.filter((ticket) => sql.includes(`'${ticket.id}'`));
      return tickets;
    };
    const withoutEpic = groupingDolt(projectWith([]));
    const withEpic = groupingDolt(projectWith(parentChild));

    const bare = await serviceFor(withoutEpic.dolt).issue('a', 'x-3');
    const detail = await serviceFor(withEpic.dolt).issue('a', 'x-3');

    expect(bare.epic).toBeNull();
    expect(detail.epic).toEqual({ id: 'x-1', title: 'L’Epic' });
    // Les mêmes deux processus que pour une fiche sans Epic, et les mêmes requêtes, mot pour mot : l'Epic ne coûte aucune lecture.
    expect(withEpic.seen.processes).toBe(2);
    expect(withEpic.seen.singles).toEqual([]);
    expect(withEpic.seen.groups.map((group) => group.length).sort()).toEqual([2, 3]);
    expect(withEpic.seen.groups).toEqual(withoutEpic.seen.groups);
  });

  it('lit la liste des tickets en un seul processus', async () => {
    const { dolt, seen } = groupingDolt();

    expect(await serviceFor(dolt).issues('a')).toHaveLength(1);

    expect(seen.processes).toBe(1);
  });

  it('lit le HEAD par la voie `light`, sans signal quand le demandeur n’en a pas (le sondage du direct)', async () => {
    const { dolt, seen } = groupingDolt();

    expect(await serviceFor(dolt).head('a')).toBe('h1');

    expect(seen.lanes).toEqual(['light']);
    expect(seen.signals).toEqual([undefined]);
  });

  it('donne le signal du demandeur à la lecture du HEAD : encore en file dans la voie `light`, elle en sort (bdesk-38k.42)', async () => {
    const { dolt, seen } = groupingDolt();
    const controller = new AbortController();
    const { signal } = controller;

    expect(await serviceFor(dolt).head('a', { signal })).toBe('h1');

    expect(seen.lanes).toEqual(['light']);
    expect(seen.signals).toEqual([signal]);
  });

  it('un abandon pendant la lecture du HEAD est une ReadAborted, pas un Projet illisible ; un signal déjà abandonné ne lit rien', async () => {
    const hanging = groupingDolt(answer, true);
    const service = serviceFor(hanging.dolt);
    const controller = new AbortController();
    const reading = service.head('a', { signal: controller.signal }).catch((e: unknown) => e);
    await until(() => hanging.seen.processes === 1, 'la lecture du HEAD est partie'); // elle est lancée, et ne finit pas : l'abandon tombe bien en cours de lecture

    controller.abort();
    const error = await reading;

    expect(error).toBeInstanceOf(ReadAborted);
    expect(error).not.toBeInstanceOf(ProjectUnreadableError);
    const before = hanging.seen.processes;
    await expect(service.head('a', { signal: controller.signal })).rejects.toBeInstanceOf(ReadAborted);
    expect(hanging.seen.processes).toBe(before);
  });

  it('lit l’historique par la voie des analyses, mais pas le préfixe, le HEAD ni les fiches', async () => {
    const { dolt, seen } = groupingDolt((sql) => (sql.includes('lineage') ? [] : answer(sql)));
    const service = serviceFor(dolt);

    await service.histories('a').catch(() => undefined); // le faux client ne connaît pas toutes les tables : seules les voies comptent
    const historyLanes = new Set(seen.lanes);
    seen.lanes.length = 0;
    await service.issue('a', 'x-1');

    expect([...historyLanes]).toEqual(['analysis']);
    expect(new Set(seen.lanes)).toEqual(new Set(['normal']));
  });

  it('donne le signal du demandeur à chaque lecture de la fiche, de la liste et de l’historique', async () => {
    const { dolt, seen } = groupingDolt();
    const service = serviceFor(dolt);
    const controller = new AbortController();
    const { signal } = controller;

    await service.issue('a', 'x-1', { signal });
    await service.issues('a', { signal });
    await service.histories('a', { signal }).catch(() => undefined); // le faux client ne connaît pas l'historique : seul le signal compte ici

    expect(seen.signals.length).toBeGreaterThanOrEqual(4);
    expect(seen.signals.every((seenSignal) => seenSignal === signal)).toBe(true);
  });

  it('un abandon en cours de lecture est une ReadAborted, pas un Projet illisible (503)', async () => {
    const { dolt, seen } = groupingDolt(answer, true);
    const controller = new AbortController();
    const reading = serviceFor(dolt).issue('a', 'x-1', { signal: controller.signal }).catch((e: unknown) => e);
    await until(() => seen.processes === 2, 'les deux lectures de la fiche sont parties'); // elles sont lancées, et ne finissent pas : l'abandon tombe bien en cours de lecture

    controller.abort();
    const error = await reading;

    expect(error).toBeInstanceOf(ReadAborted);
    expect(error).not.toBeInstanceOf(ProjectUnreadableError);
  });

  it('un signal déjà abandonné ne lit rien : ni la fiche, ni la liste, ni l’historique', async () => {
    const { dolt, seen } = groupingDolt();
    const service = serviceFor(dolt);
    const controller = new AbortController();
    controller.abort();
    const { signal } = controller;

    await expect(service.issue('a', 'x-1', { signal })).rejects.toBeInstanceOf(ReadAborted);
    await expect(service.issues('a', { signal })).rejects.toBeInstanceOf(ReadAborted);
    await expect(service.histories('a', { signal })).rejects.toBeInstanceOf(ReadAborted);

    expect(seen.processes).toBe(0);
  });

  it('un octet nul dans l’identifiant ne lance toujours aucune lecture, signal ou non', async () => {
    const { dolt, seen } = groupingDolt();

    await expect(serviceFor(dolt).issue('a', 'x\u0000y', { signal: new AbortController().signal })).rejects.toBeInstanceOf(IssueNotFoundError);

    expect(seen.processes).toBe(0);
  });

  it('un ticket inconnu reste un ticket inconnu (404), pas un Projet illisible', async () => {
    const { dolt } = groupingDolt((sql) => (sql.includes('where id =') ? [] : answer(sql)));

    await expect(serviceFor(dolt).issue('a', 'x-9')).rejects.toBeInstanceOf(IssueNotFoundError);
  });
});
