import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type DoltClient, DoltQueryError, type Row } from '../dolt/client';
import { createProjectService, ProjectNotFoundError, ProjectUnreadableError } from './service';

let root: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'bdesk-head-')));
});

afterEach(() => {
  vi.useRealTimers();
});

/** Fait passer `ms` millisecondes pour le service (qui date ses scans avec `Date.now`) : l'horloge saute, puis reste figée. */
function elapse(ms: number): void {
  const now = Date.now();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(now + ms);
}

/** Un Projet Dolt embedded dans `root`, avec ou sans le dossier de sa base. */
function project(name: string, { database = true } = {}): void {
  const beads = join(root, name, '.beads');
  mkdirSync(beads, { recursive: true });
  writeFileSync(join(beads, 'metadata.json'), JSON.stringify({ backend: 'dolt', database: 'dolt', dolt_mode: 'embedded', dolt_database: name }));
  if (database) mkdirSync(join(beads, 'embeddeddolt', name, '.dolt'), { recursive: true });
}

/** Un faux client dolt : le préfixe pour la découverte, `answer` pour le reste. Garde chaque requête, avec le dossier de la base qu'elle lit. */
function fakeDolt(answer: (sql: string) => Row[]): DoltClient & { queries: string[]; calls: { dir: string; sql: string }[] } {
  const dolt = {
    queries: [] as string[],
    calls: [] as { dir: string; sql: string }[],
    open: (dir: string) => ({
      dir,
      async query(sql: string) {
        dolt.queries.push(sql);
        dolt.calls.push({ dir, sql });
        return sql.includes("'issue_prefix'") ? [{ value: 'x' }] : answer(sql);
      },
    }),
  };
  return dolt;
}

const serviceFor = (dolt: DoltClient) => createProjectService({ roots: [root], projects: [], hiddenProjects: [] }, { dolt });

describe('ProjectService.head', () => {
  it('lit le hash du dernier commit dans la base du Projet', async () => {
    project('a');
    const dolt = fakeDolt((sql) => (sql.includes("hashof('HEAD')") ? [{ head: 'abc123' }] : []));

    expect(await serviceFor(dolt).head('a')).toBe('abc123');
  });

  it('suit les commits : un nouveau HEAD change la réponse, sans cache', async () => {
    project('a');
    let head = 'premier';
    const service = serviceFor(fakeDolt(() => [{ head }]));

    expect(await service.head('a')).toBe('premier');
    head = 'second';
    expect(await service.head('a')).toBe('second');
  });

  it('refuse un Projet inconnu', async () => {
    project('a');

    await expect(serviceFor(fakeDolt(() => [])).head('inconnu')).rejects.toBeInstanceOf(ProjectNotFoundError);
  });

  it('signale un Projet dont la base est absente comme illisible', async () => {
    project('casse', { database: false });

    await expect(serviceFor(fakeDolt(() => [])).head('casse')).rejects.toBeInstanceOf(ProjectUnreadableError);
  });

  it('signale un Projet dont dolt échoue à répondre comme illisible, avec le message de dolt', async () => {
    project('a');
    const dolt = fakeDolt(() => {
      throw new DoltQueryError('database is corrupted', 'dir');
    });

    const error = await serviceFor(dolt).head('a').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ProjectUnreadableError);
    expect((error as ProjectUnreadableError).reason).toBe('database is corrupted');
  });
});

/** Ce que lit chaque requête : `prefix` (la découverte lit le préfixe de chaque Projet), `head` (le sondage), le reste. */
const kind = (sql: string) => (sql.includes("'issue_prefix'") ? 'prefix' : sql.includes("hashof('HEAD')") ? 'head' : 'other');
const base = (dir: string) => dir.slice(root.length + 1).split('/')[0];

describe('ProjectService.head : le sondage ne lance aucune découverte (bdesk-38k.8, relecture B1)', () => {
  const heads = (sql: string) => (sql.includes("hashof('HEAD')") ? [{ head: 'h1' }] : []);

  it('ne relit ni les autres Projets ni le sien quand le Projet est connu et lisible, quel que soit l’âge du dernier scan (vingt sondages à 31 s d’écart)', async () => {
    for (const name of ['a', 'b', 'c']) project(name);
    const dolt = fakeDolt(heads);
    const service = serviceFor(dolt);
    await service.list(); // le scan : un préfixe lu par Projet
    expect(dolt.calls.map((call) => kind(call.sql))).toEqual(['prefix', 'prefix', 'prefix']);
    dolt.calls.length = 0;

    for (let i = 0; i < 20; i++) {
      elapse(31_000); // plus que l'âge au-delà duquel une lecture d'un Projet relançait le scan
      expect(await service.head('a')).toBe('h1');
    }

    // Vingt sondages = vingt lectures du HEAD de `a`, rien d'autre : ni préfixe, ni dossier d'un autre Projet.
    expect(dolt.calls.map((call) => [base(call.dir), kind(call.sql)])).toEqual(Array.from({ length: 20 }, () => ['a', 'head']));
  });

  it('un Projet qui n’a jamais été découvert déclenche le premier scan, une fois : les sondages suivants n’en lancent plus', async () => {
    for (const name of ['a', 'b']) project(name);
    const dolt = fakeDolt(heads);
    const service = serviceFor(dolt);

    await service.head('a');
    elapse(120_000);
    await service.head('a');
    elapse(120_000);
    await service.head('a');

    expect(dolt.calls.filter((call) => kind(call.sql) === 'prefix')).toHaveLength(2); // a et b, au premier scan seulement
    expect(dolt.calls.filter((call) => kind(call.sql) === 'head').map((call) => base(call.dir))).toEqual(['a', 'a', 'a']);
  });

  it('partage le scan déjà en cours plutôt que d’en lancer un autre', async () => {
    for (const name of ['a', 'b', 'c']) project(name);
    const dolt = fakeDolt(heads);
    const service = serviceFor(dolt);

    await Promise.all([service.list(), service.head('a'), service.head('b'), service.head('c')]);

    expect(dolt.calls.filter((call) => kind(call.sql) === 'prefix')).toHaveLength(3);
  });

  it('une lecture qui échoue ne relance pas de découverte : le Projet est illisible, la découverte n’y changerait rien', async () => {
    for (const name of ['a', 'b']) project(name);
    let failing = true;
    const dolt = fakeDolt((sql) => {
      if (failing && sql.includes("hashof('HEAD')")) throw new DoltQueryError('database is locked', 'dir');
      return heads(sql);
    });
    const service = serviceFor(dolt);
    await service.list();
    dolt.calls.length = 0;

    for (let i = 0; i < 5; i++) {
      elapse(31_000);
      await expect(service.head('a')).rejects.toBeInstanceOf(ProjectUnreadableError);
    }
    failing = false;
    elapse(31_000);

    expect(await service.head('a')).toBe('h1'); // il reprend dès que la base répond
    expect(dolt.calls.filter((call) => kind(call.sql) === 'prefix')).toEqual([]);
  });

  it('cherche encore un Projet inconnu, au plus une fois par 5 s : un Projet ajouté depuis le scan finit par être sondé', async () => {
    project('a');
    const dolt = fakeDolt(heads);
    const service = serviceFor(dolt);
    await service.list();

    project('b'); // ajouté après le scan
    await expect(service.head('b')).rejects.toBeInstanceOf(ProjectNotFoundError); // le scan est trop récent pour être refait
    elapse(5_100);

    expect(await service.head('b')).toBe('h1');
  });

  it('relit un Projet resté illisible au dernier scan une fois réparé, au plus une fois par 5 s', async () => {
    project('casse', { database: false });
    const dolt = fakeDolt(heads);
    const service = serviceFor(dolt);
    await service.list();

    mkdirSync(join(root, 'casse', '.beads', 'embeddeddolt', 'casse', '.dolt'), { recursive: true }); // réparé depuis
    await expect(service.head('casse')).rejects.toBeInstanceOf(ProjectUnreadableError); // trop tôt
    elapse(5_100);

    expect(await service.head('casse')).toBe('h1');
  });

  it('ne change rien aux autres lectures : la lecture des tickets garde son scan toutes les 30 s (les actions de l’utilisateur tiennent la liste des Projets à jour)', async () => {
    project('a');
    const dolt = fakeDolt(heads);
    const service = serviceFor(dolt);
    await service.issues('a');
    dolt.calls.length = 0;

    elapse(31_000);
    await service.issues('a');

    expect(dolt.calls.filter((call) => kind(call.sql) === 'prefix')).toHaveLength(1);
  });
});
