import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DoltClient, Row } from '../dolt/client';
import { createProjectService } from '../projects/service';
import { startServer } from '../server';
import { openStream, type Stream } from '../testing/sse';

/**
 * Le coût du direct (ADR 0002, relecture B1) : un flux ouvert sur un Projet ne fait lire que ce Projet. Le vrai service de
 * Projets (découverte comprise) derrière le vrai serveur, devant un faux client dolt qui note chaque lecture et son dossier.
 */

let root: string;
let app: FastifyInstance | undefined;
const streams: Stream[] = [];

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'bdesk-cost-')));
});

afterEach(async () => {
  vi.useRealTimers();
  for (const stream of streams.splice(0)) stream.close();
  await app?.close();
  app = undefined;
});

function project(name: string): void {
  const beads = join(root, name, '.beads');
  mkdirSync(join(beads, 'embeddeddolt', name, '.dolt'), { recursive: true });
  writeFileSync(join(beads, 'metadata.json'), JSON.stringify({ backend: 'dolt', database: 'dolt', dolt_mode: 'embedded', dolt_database: name }));
}

interface Call {
  /** Le Projet dont la base est lue. */
  project: string;
  kind: 'prefix' | 'head' | 'other';
}

/** Un faux client dolt : chaque lecture est notée avec son Projet ; le HEAD reste le même. */
function countingDolt() {
  const calls: Call[] = [];
  const dolt: DoltClient = {
    open: (dir) => ({
      dir,
      async query(sql: string): Promise<Row[]> {
        const name = dir.slice(root.length + 1).split('/')[0] ?? dir;
        if (sql.includes("'issue_prefix'")) {
          calls.push({ project: name, kind: 'prefix' });
          return [{ value: name.slice(0, 2) }];
        }
        if (sql.includes("hashof('HEAD')")) {
          calls.push({ project: name, kind: 'head' });
          return [{ head: 'h1' }];
        }
        calls.push({ project: name, kind: 'other' });
        return [];
      },
    }),
  };
  return { dolt, calls };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Attend `count` lectures du HEAD de plus (le sondage tourne en temps réel, toutes les 10 ms). */
async function pollsMore(calls: Call[], count: number): Promise<void> {
  const target = calls.filter((call) => call.kind === 'head').length + count;
  for (let waited = 0; calls.filter((call) => call.kind === 'head').length < target; waited++) {
    if (waited > 1_000) throw new Error('le sondage ne lit plus');
    await sleep(5);
  }
}

/** Fait vieillir le dernier scan des Projets de `ms` millisecondes (le service date ses scans avec `Date.now`). */
function elapse(ms: number): void {
  const now = Date.now();
  vi.useFakeTimers({ toFake: ['Date'] }); // les minuteries du sondage restent réelles
  vi.setSystemTime(now + ms);
}

describe('un flux ouvert sur un Projet ne fait lire que ce Projet', () => {
  it('pendant des minutes de sondage : que son HEAD, ni le préfixe d’un autre Projet ni une redécouverte, quel que soit l’âge du scan', async () => {
    for (const name of ['alpha', 'beta', 'gamma']) project(name);
    const { dolt, calls } = countingDolt();
    const config = { roots: [root], projects: [], hiddenProjects: [] };
    app = await startServer({ config, projects: createProjectService(config, { dolt }), port: 0, live: { intervalMs: 10 } });
    const stream = await openStream((app.server.address() as AddressInfo).port, '/api/projects/alpha/events');
    streams.push(stream);
    await stream.waitFor('retry:');
    await pollsMore(calls, 2);
    // L'ouverture du flux a cherché le Projet (un scan, comme toute requête de l'utilisateur) ; le sondage, lui, ne fait que lire le HEAD.
    expect(calls.filter((call) => call.kind === 'prefix').map((call) => call.project).sort()).toEqual(['alpha', 'beta', 'gamma']);
    calls.length = 0;

    for (let minutes = 0; minutes < 6; minutes++) {
      elapse(60_000); // le scan a vieilli : plus de 30 s, la limite au-delà de laquelle une lecture le refaisait
      await pollsMore(calls, 3);
    }

    expect(calls.length).toBeGreaterThanOrEqual(18);
    expect(new Set(calls.map((call) => `${call.project}:${call.kind}`))).toEqual(new Set(['alpha:head']));
  });

  it('deux flux sur deux Projets : chacun lit le sien, rien d’autre', async () => {
    for (const name of ['alpha', 'beta', 'gamma']) project(name);
    const { dolt, calls } = countingDolt();
    const config = { roots: [root], projects: [], hiddenProjects: [] };
    app = await startServer({ config, projects: createProjectService(config, { dolt }), port: 0, live: { intervalMs: 10 } });
    const port = (app.server.address() as AddressInfo).port;
    streams.push(await openStream(port, '/api/projects/alpha/events'), await openStream(port, '/api/projects/beta/events'));
    await pollsMore(calls, 4);
    calls.length = 0;

    elapse(120_000);
    await pollsMore(calls, 6);

    expect(new Set(calls.map((call) => `${call.project}:${call.kind}`))).toEqual(new Set(['alpha:head', 'beta:head']));
  });

  it('sans flux ouvert, rien n’est lu, même après des minutes', async () => {
    for (const name of ['alpha', 'beta']) project(name);
    const { dolt, calls } = countingDolt();
    const config = { roots: [root], projects: [], hiddenProjects: [] };
    app = await startServer({ config, projects: createProjectService(config, { dolt }), port: 0, live: { intervalMs: 10 } });

    elapse(300_000);
    await sleep(100);

    expect(calls).toEqual([]);
  });
});
