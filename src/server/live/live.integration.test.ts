import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { promisify } from 'node:util';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer } from '../server';
import { hasBinary, isolatedDoltEnv } from '../testing/dolt-fixture';
import { scratchDir } from '../testing/scratch';
import { openStream, type Stream } from '../testing/sse';

const run = promisify(execFile);
const SECOND = 1000;

/**
 * Mises à jour en direct sur un vrai workspace beads : un workspace temporaire est créé avec `bd`, le vrai serveur le
 * suit, et chaque écriture de bd doit arriver sur le flux, sans que le sondage n'écrive quoi que ce soit dans la base.
 * Sauté si `dolt` ou `bd` ne sont pas installés.
 */
describe.skipIf(!hasBinary('dolt') || !hasBinary('bd'))('flux SSE sur un workspace créé par bd', () => {
  const INTERVAL = 250;
  let roots: string;
  let workspace: string;
  let database: string;
  let env: NodeJS.ProcessEnv;
  let doltEnv: NodeJS.ProcessEnv;
  let app: FastifyInstance;
  let port: number;
  let issueId: string;
  const streams: Stream[] = [];

  const bd = (...args: string[]) => execFileSync('bd', args, { cwd: workspace, env, encoding: 'utf8' }).trim();
  /** Une lecture directe de la base par `dolt`, hors du serveur testé ; première ligne (l'en-tête du CSV) retirée. */
  const dolt = (query: string) =>
    execFileSync('dolt', ['sql', '-r', 'csv', '-q', query], { cwd: database, env: doltEnv, encoding: 'utf8' }).trim().split('\n').slice(1).join('\n');
  const open = async () => {
    const stream = await openStream(port, '/api/projects/xx-live/events');
    streams.push(stream);
    await stream.waitFor('retry: 3000');
    return stream;
  };
  const changes = (stream: Stream) => stream.received().match(/event: changed/g)?.length ?? 0;
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  /** Empreinte du contenu des fichiers de données de la base (pas leurs dates : une lecture les met à jour). */
  function contentHash(): string {
    const hash = createHash('sha256');
    const walk = (dir: string) => {
      for (const name of readdirSync(dir).sort()) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else hash.update(path.slice(database.length)).update(readFileSync(path));
      }
    };
    walk(join(database, '.dolt'));
    return hash.digest('hex');
  }

  beforeAll(async () => {
    roots = realpathSync(scratchDir('bdesk-live-'));
    workspace = join(roots, 'xx-live');
    database = join(workspace, '.beads', 'embeddeddolt', 'xx');
    // Aucune variable BEADS_* / BD_* de l'environnement ne doit rediriger bd vers un vrai Projet ; pas de métriques d'usage de bd.
    env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(BEADS_|BD_)/.test(key)));
    env.BEADS_ACTOR = 'testeur';
    env.DO_NOT_TRACK = '1';
    doltEnv = isolatedDoltEnv(); // ni ~/.dolt ni les métriques de dolt pour les lectures du test
    mkdirSync(workspace);
    execFileSync('git', ['init', '-q', '.'], { cwd: workspace });
    bd('init', '--prefix', 'xx', '--non-interactive', '--skip-hooks', '--skip-agents', '-q');
    issueId = bd('q', 'Ticket suivi en direct');

    app = await startServer({ config: { roots: [roots], projects: [], hiddenProjects: [] }, port: 0, live: { intervalMs: INTERVAL } });
    port = (app.server.address() as AddressInfo).port;
  }, 120 * SECOND);

  afterAll(async () => {
    for (const stream of streams) stream.close();
    await app?.close();
  });

  it('annonce une écriture de bd dans les secondes qui suivent, avec le HEAD de la base', async () => {
    const stream = await open();
    await sleep(INTERVAL * 4); // l'état de départ est lu
    expect(changes(stream)).toBe(0);

    const startedAt = Date.now();
    bd('update', issueId, '--status', 'in_progress');
    await stream.waitFor('event: changed', 10 * SECOND);
    const delay = Date.now() - startedAt;

    expect(delay).toBeLessThan(5 * SECOND);
    const head = dolt("select hashof('HEAD') as head");
    expect(stream.received()).toContain(`data: {"project":"xx-live","head":"${head}"}`);
  }, 60 * SECOND);

  it('annonce chaque écriture : création, fermeture, commentaire', async () => {
    const stream = await open();
    await sleep(INTERVAL * 4);
    const heads = new Set<string>();

    for (const write of [
      () => bd('q', 'Un second ticket'),
      () => bd('close', issueId, '--reason', 'fait'),
      () => bd('comments', 'add', issueId, 'un commentaire'),
    ]) {
      const before = changes(stream);
      write();
      await until(() => changes(stream) > before, 10 * SECOND);
      heads.add(dolt("select hashof('HEAD') as head"));
    }

    expect(heads.size).toBe(3);
    expect(changes(stream)).toBeGreaterThanOrEqual(3);
  }, 60 * SECOND);

  it('ne dit rien quand rien ne change, et ne laisse rien dans la base : ni commit, ni changement, ni octet', async () => {
    const stream = await open();
    await sleep(INTERVAL * 4);
    const before = { head: dolt("select hashof('HEAD')"), commits: dolt('select count(*) from dolt_log'), content: contentHash() };
    const events = changes(stream);

    await sleep(INTERVAL * 12); // une douzaine de sondages à vide

    expect(changes(stream)).toBe(events);
    expect(dolt("select hashof('HEAD')")).toBe(before.head);
    expect(dolt('select count(*) from dolt_log')).toBe(before.commits);
    expect(dolt('select count(*) from dolt_status')).toBe('0');
    expect(contentHash()).toBe(before.content);
  }, 60 * SECOND);

  it('ne fait échouer aucune écriture de bd pendant que le sondage lit', async () => {
    const stream = await open();
    await sleep(INTERVAL * 4);
    const before = changes(stream);

    // Les unes après les autres : deux bd simultanés se gênent entre eux, ce qui n'est pas ce que l'on éprouve ici.
    const failures: unknown[] = [];
    for (let i = 0; i < 12; i++) {
      await run('bd', ['update', issueId, '--priority', String(i % 5)], { cwd: workspace, env }).catch((error: unknown) => failures.push(error));
    }

    expect(failures).toEqual([]);
    await until(() => changes(stream) > before, 10 * SECOND);
    expect(execFileSync('dolt', ['fsck'], { cwd: database, encoding: 'utf8', env: doltEnv })).toBeTypeOf('string');
  }, 120 * SECOND);

  async function until(condition: () => boolean, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!condition()) {
      if (Date.now() > deadline) throw new Error('condition jamais remplie');
      await sleep(25);
    }
  }
});
