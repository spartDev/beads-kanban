import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { epicChildren, epicProgress } from '../../domain/epics';
import type { Issue, IssueChronology, MetricsResponse } from '../../shared/api';
import { yieldToEventLoop } from '../../testing/event-loop';
import { createDoltClient } from '../dolt/client';
import { createMetricsService } from '../metrics/service';
import { buildServer } from '../server';
import { createDatabase, hasBinary, isolatedDoltEnv } from '../testing/dolt-fixture';
import { scratchDir } from '../testing/scratch';
import { createProjectService } from './service';

/**
 * Le Renoncement (ADR 0008) sur une vraie base Dolt, de bout en bout : le label `declined` que l'on pose à la clôture, lu au dernier commit
 * par le tableau (`/api/projects/…/issues`), par les métriques (`/api/metrics`) et par la Chronologie, qui disent tous la même chose. Le
 * label ne se lit jamais dans l'historique : posé après la clôture, il fait un Renoncement ; retiré, il n'en fait plus un, et la Livraison
 * revient, datée de sa clôture. La raison de clôture n'y est pour rien.
 */

/** Lundi 12 octobre 2026, 12:00 UTC : les commits vont du 1er au 5 octobre, à 10:00 UTC. */
const NOW = new Date('2026-10-12T12:00:00Z');
const PERIOD = '?from=2026-10-01&to=2026-10-12&project=rho';

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
  `insert into issues (id, title, description, design, acceptance_criteria, notes, issue_type, priority, created_at, updated_at, close_reason)
   values ('${id}', 'Titre ${id}', '', '', '', '', '${type}', 2, '${stamp(day)}', '${stamp(day)}', '')`;

const close = (id: string, day: number, reason = '') =>
  `update issues set status = 'closed', updated_at = '${stamp(day)}', closed_at = '${stamp(day)}', close_reason = '${reason.replaceAll("'", "''")}' where id = '${id}'`;

const link = (id: string, target: string, type: string, day: number) =>
  `insert into dependencies (id, issue_id, depends_on_issue_id, type, created_at, created_by) values (uuid(), '${id}', '${target}', '${type}', '${stamp(day)}', 'tom')`;

const label = (id: string, name: string) => `insert into labels values ('${id}', '${name}')`;
const unlabel = (id: string, name: string) => `delete from labels where issue_id = '${id}' and label = '${name}'`;

/**
 * Projet « rho », un commit par jour à 10:00 UTC :
 *
 *   j1  r-e (epic), r-1 à r-6 (tâches) créés ; r-1 et r-2 sont des Enfants de r-e
 *   j2  r-1 fermé (Livraison) ; r-2 fermé avec le label declined (Renoncement) ; r-3 fermé « won't fix », sans label (Livraison)
 *   j3  r-4 fermé avec le label declined ; r-5 fermé, sans label ; r-6 fermé, doublon de r-1, avec le label (Abandon) ;
 *       r-b (bug) créé, découvert à partir du Renoncement r-2
 *   j4  le label de r-4 retiré : Livraison, datée du j3
 *   j5  le label posé sur r-5, fermé depuis le j3 : Renoncement, daté du j3
 */
const RHO: [day: number, statements: string[]][] = [
  [
    1,
    [
      create('r-e', 'epic', 1),
      ...['r-1', 'r-2', 'r-3', 'r-4', 'r-5', 'r-6'].map((id) => create(id, 'task', 1)),
      link('r-1', 'r-e', 'parent-child', 1),
      link('r-2', 'r-e', 'parent-child', 1),
    ],
  ],
  [2, [close('r-1', 2), close('r-2', 2), label('r-2', 'declined'), label('r-2', 'ui'), close('r-3', 2, "won't fix")]],
  [
    3,
    [
      close('r-4', 3),
      label('r-4', 'declined'),
      close('r-5', 3),
      close('r-6', 3),
      link('r-6', 'r-1', 'duplicates', 3),
      label('r-6', 'declined'),
      create('r-b', 'bug', 3),
      link('r-b', 'r-2', 'discovered-from', 3),
    ],
  ],
  [4, [unlabel('r-4', 'declined')]],
  [5, [label('r-5', 'declined')]],
];

describe.skipIf(!hasBinary('dolt'))('le Renoncement sur une vraie base Dolt', () => {
  let issues: Map<string, Issue>;
  let metrics: MetricsResponse;
  let chronologyOf: (id: string) => Promise<IssueChronology>;

  beforeAll(async () => {
    const root = realpathSync(scratchDir('bdesk-decline-'));
    const beads = join(root, 'rho', '.beads');
    mkdirSync(beads, { recursive: true });
    writeFileSync(join(beads, 'metadata.json'), JSON.stringify({ backend: 'dolt', database: 'dolt', dolt_mode: 'embedded', dolt_database: 'tdb' }));
    const base = createDatabase(isolatedDoltEnv(), join(beads, 'embeddeddolt', 'tdb'));
    base.sql(`${SCHEMA} insert into config values ('issue_prefix', 'r');`);
    for (const [day, statements] of RHO) {
      base.sql(statements.join(';\n'));
      base.commit(day, `jour ${day}`);
      await yieldToEventLoop(); // rendre la main entre deux jours : des commandes `dolt` synchrones (bdesk-8g5, voir src/testing/event-loop.ts)
    }

    const config = { roots: [root], projects: [], hiddenProjects: [] };
    const projects = createProjectService(config, { dolt: createDoltClient() });
    const app = buildServer({ config, projects, metrics: createMetricsService(projects, { now: () => NOW, timeZone: 'UTC' }) });
    const get = async <T>(url: string): Promise<T> => {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(200);
      return res.json<T>();
    };
    issues = new Map((await get<{ issues: Issue[] }>('/api/projects/rho/issues')).issues.map((issue) => [issue.id, issue]));
    metrics = await get<MetricsResponse>(`/api/metrics${PERIOD}`);
    chronologyOf = async (id) => (await get<{ chronology: IssueChronology }>(`/api/projects/rho/issues/${id}/chronology`)).chronology;
  }, 120_000);

  it('le tableau marque les tickets fermés qui portent le label au dernier commit, et eux seuls', () => {
    const declined = [...issues.values()].filter((issue) => issue.declined).map((issue) => issue.id);

    expect(declined).toEqual(['r-2', 'r-5']);
    // Un Abandon qui porte aussi le label reste un Abandon.
    expect(issues.get('r-6')).toMatchObject({ abandon: { cause: 'duplicate', of: 'r-1' } });
    expect(issues.get('r-6')).not.toHaveProperty('declined');
  });

  it('les métriques sortent les Renoncements du Débit et du Lead Time, et en comptent deux dans la période', () => {
    // Livraisons : r-1, r-3 (« won't fix » sans label) et r-4 (label retiré).
    expect(metrics.tiles.throughput.total).toBe(3);
    expect(metrics.tiles.leadTime).toMatchObject({ n: 3 });
    expect(metrics.health.declines.total).toBe(2);
  });

  it('les métriques gardent le Taux d’abandon : les Renoncements sont des tickets fermés comme les autres', () => {
    expect(metrics.health.abandonment).toMatchObject({ closed: 6, abandoned: 1, rate: 1 / 6 });
    expect(metrics.health.reopening).toMatchObject({ closures: 6, reopened: 0 });
  });

  it('un bug découvert à partir d’un Renoncement n’en fait pas une Livraison en échec', () => {
    expect(metrics.tiles.failureRate).toMatchObject({ deliveries: 3, failed: 0 });
  });

  it('la Chronologie dit le Renoncement, daté de sa clôture, et la Livraison d’un ticket dont le label a été retiré', async () => {
    expect((await chronologyOf('r-2')).outcome).toEqual({ kind: 'declined', at: iso(2) });
    expect((await chronologyOf('r-5')).outcome).toEqual({ kind: 'declined', at: iso(3) });
    expect((await chronologyOf('r-4')).outcome).toEqual({ kind: 'delivered', at: iso(3) });
    expect((await chronologyOf('r-3')).outcome).toEqual({ kind: 'delivered', at: iso(2) });
  });

  it('l’Epic atteint 100 % : son Enfant en Renoncement n’est pas à livrer', () => {
    expect(epicProgress(epicChildren('r-e', [...issues.values()]).children)).toMatchObject({ delivered: 1, declined: 1, remaining: 0, ratio: 1 });
  });
});
