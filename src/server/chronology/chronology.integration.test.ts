import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { analyzeFlow } from '../../domain/flow';
import type { IssueChronology } from '../../shared/api';
import { createProjectService, type ProjectService } from '../projects/service';
import { buildServer } from '../server';
import { createDatabase, hasBinary, isolatedDoltEnv } from '../testing/dolt-fixture';

const DAY = 86_400_000;

const SCHEMA = `
  create table issues (
    id varchar(255) primary key, title varchar(500) not null, description text not null, design text not null,
    acceptance_criteria text not null, notes text not null, status varchar(32) not null default 'open',
    priority int not null default 2, issue_type varchar(32) not null default 'task', assignee varchar(255),
    created_at datetime not null, updated_at datetime not null, closed_at datetime, close_reason text not null);
  create table dependencies (
    id char(36) primary key, issue_id varchar(255) not null, depends_on_issue_id varchar(255) not null,
    type varchar(32) not null default 'blocks', created_at datetime not null, created_by varchar(255) not null);
  create table labels (issue_id varchar(255) not null, label varchar(255) not null, primary key (issue_id, label));
  create table comments (id char(36) primary key, issue_id varchar(255) not null, author varchar(255) not null,
    text text not null, created_at datetime not null);
  create table config (\`key\` varchar(255) primary key, value text not null);`;

const stamp = (day: number) => `2026-10-${String(day).padStart(2, '0')} 10:00:00`;
const iso = (day: number) => `2026-10-${String(day).padStart(2, '0')}T10:00:00.000Z`;

const create = (id: string, type: string, day: number) =>
  `insert into issues (id, title, description, design, acceptance_criteria, notes, issue_type, created_at, updated_at, close_reason)
   values ('${id}', 'Titre ${id}', '', '', '', '', '${type}', '${stamp(day)}', '${stamp(day)}', '')`;

const move = (id: string, status: string, day: number) =>
  `update issues set status = '${status}', updated_at = '${stamp(day)}', closed_at = ${status === 'closed' ? `'${stamp(day)}'` : 'null'} where id = '${id}'`;

const blocks = (id: string, target: string, day: number) =>
  `insert into dependencies (id, issue_id, depends_on_issue_id, type, created_at, created_by) values (uuid(), '${id}', '${target}', 'blocks', '${stamp(day)}', 'tom')`;

/**
 * Projet « gamma », un commit par jour à 10 h UTC :
 *
 *   j1  g-1 et g-2 (tâches), g-3 (epic) créés
 *   j2  g-2 en cours ; g-2 dépend de g-1 (blocks) : g-1 n'est pas fermé, c'est un Blocage
 *   j3  g-1 en cours
 *   j4  g-1 fermé (Lead Time 3 j, Cycle Time 1 j) : fin du Blocage de g-2
 *   j5  g-2 fermé
 *   j6  g-2 rouvert           j7  g-2 en cours       j8  g-2 fermé de nouveau ; g-3 fermé
 *
 * g-2 : Lead Time 7 j (j1 → j8), Cycle Time 4 j (j2 → j5, puis j7 → j8), 2 j de Blocage (j2 → j4), 1 Réouverture.
 * Un ticket g-9 est créé après le dernier commit, sans être commité : ni l'historique ni le tableau, qui lit lui aussi le dernier commit, ne le connaissent.
 */
describe.skipIf(!hasBinary('dolt'))('chronologie sur une vraie base Dolt', () => {
  let projects: ProjectService;
  let get: (id: string) => Promise<{ status: number; body: { chronology: IssueChronology; message?: string } }>;

  beforeAll(() => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'bdesk-chronology-')));
    const beads = join(root, 'gamma', '.beads');
    mkdirSync(beads, { recursive: true });
    writeFileSync(join(beads, 'metadata.json'), JSON.stringify({ backend: 'dolt', database: 'dolt', dolt_mode: 'embedded', dolt_database: 'tdb' }));
    const base = createDatabase(isolatedDoltEnv(), join(beads, 'embeddeddolt', 'tdb'));
    base.sql(`${SCHEMA} insert into config values ('issue_prefix', 'g');`);
    const script: [number, string[]][] = [
      [1, [create('g-1', 'task', 1), create('g-2', 'task', 1), create('g-3', 'epic', 1)]],
      [2, [move('g-2', 'in_progress', 2), blocks('g-2', 'g-1', 2)]],
      [3, [move('g-1', 'in_progress', 3)]],
      [4, [move('g-1', 'closed', 4)]],
      [5, [move('g-2', 'closed', 5)]],
      [6, [move('g-2', 'open', 6)]],
      [7, [move('g-2', 'in_progress', 7)]],
      [8, [move('g-2', 'closed', 8), move('g-3', 'closed', 8)]],
    ];
    for (const [day, statements] of script) {
      base.sql(statements.join(';\n'));
      base.commit(day, `jour ${day}`);
    }
    base.sql(create('g-9', 'task', 9)); // dans le working set de la base, ni dans l'historique ni au dernier commit

    const config = { roots: [root], projects: [], hiddenProjects: [] };
    projects = createProjectService(config);
    const app = buildServer({ config, projects });
    get = async (id) => {
      const res = await app.inject({ method: 'GET', url: `/api/projects/gamma/issues/${id}/chronology` });
      return { status: res.statusCode, body: res.json() };
    };
  }, 120_000);

  it('retrace les Transitions de l’historique Dolt, avec le temps passé dans chaque statut', async () => {
    const { status, body } = await get('g-2');

    expect(status).toBe(200);
    expect(body.chronology.source).toBe('history');
    expect(body.chronology.transitions).toEqual([
      { status: 'open', at: iso(1), duration: DAY },
      { status: 'in_progress', at: iso(2), duration: 3 * DAY },
      { status: 'closed', at: iso(5), duration: DAY },
      { status: 'open', at: iso(6), duration: DAY },
      { status: 'in_progress', at: iso(7), duration: DAY },
      { status: 'closed', at: iso(8), duration: null },
    ]);
  });

  it('mesure Lead Time, Cycle Time et temps bloqué, et compte la Réouverture', async () => {
    const { body } = await get('g-2');

    expect(body.chronology).toMatchObject({
      leadTime: 7 * DAY,
      cycleTime: 4 * DAY,
      blockedTime: 2 * DAY,
      reopenings: 1,
      outcome: { kind: 'delivered', at: iso(8) },
    });
  });

  it('dit le Blocage : du jour où la dépendance est posée à la fermeture du ticket attendu', async () => {
    const { body } = await get('g-2');

    expect(body.chronology.blockages).toEqual([
      { from: iso(2), to: iso(4), blockedBy: ['g-1'], statusBlocked: false, phases: [{ kind: 'work', from: iso(2), to: iso(4) }] },
    ]);
  });

  it('donne les mêmes durées que le module domaine appliqué directement à l’historique', async () => {
    const flows = analyzeFlow(await projects.histories('gamma'));

    for (const id of ['g-1', 'g-2', 'g-3']) {
      const flow = flows.get(id);
      const { body } = await get(id);
      expect(body.chronology).toMatchObject({
        leadTime: flow?.leadTime,
        cycleTime: flow?.cycleTime,
        blockedTime: flow?.blockedTime,
        reopenings: flow?.reopenings,
      });
    }
  });

  it('ne fait pas d’une Epic fermée une Livraison', async () => {
    const { body } = await get('g-3');

    expect(body.chronology).toMatchObject({ outcome: { kind: 'closed', at: iso(8) }, leadTime: 7 * DAY, cycleTime: null });
  });

  it('répond 404 pour un ticket que bd n’a pas commité : le tableau, qui lit le dernier commit comme l’historique, ne le connaît pas non plus (bdesk-38k.36)', async () => {
    const { status, body } = await get('g-9');

    expect(status).toBe(404);
    expect(body.message).toContain('g-9');
  });

  it('répond 404 pour un ticket qui n’est pas dans le Projet', async () => {
    const { status, body } = await get('g-404');

    expect(status).toBe(404);
    expect(body.message).toContain('g-404');
  });
});
