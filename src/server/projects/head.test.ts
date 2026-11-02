import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { type DoltClient, DoltQueryError, type Row } from '../dolt/client';
import { createProjectService, ProjectNotFoundError, ProjectUnreadableError } from './service';

let root: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'bdesk-head-')));
});

/** Un Projet Dolt embedded dans `root`, avec ou sans le dossier de sa base. */
function project(name: string, { database = true } = {}): void {
  const beads = join(root, name, '.beads');
  mkdirSync(beads, { recursive: true });
  writeFileSync(join(beads, 'metadata.json'), JSON.stringify({ backend: 'dolt', database: 'dolt', dolt_mode: 'embedded', dolt_database: name }));
  if (database) mkdirSync(join(beads, 'embeddeddolt', name, '.dolt'), { recursive: true });
}

/** Un faux client dolt : le préfixe pour la découverte, `answer` pour le reste. */
function fakeDolt(answer: (sql: string) => Row[]): DoltClient & { queries: string[] } {
  const dolt = {
    queries: [] as string[],
    open: (dir: string) => ({
      dir,
      async query(sql: string) {
        dolt.queries.push(sql);
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
