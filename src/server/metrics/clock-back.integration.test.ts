import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { IssueChronology, MetricsResponse } from '../../shared/api';
import { createProjectService } from '../projects/service';
import { buildServer } from '../server';
import { createDatabase, hasBinary, isolatedDoltEnv } from '../testing/dolt-fixture';
import { createMetricsService } from './service';

// La première lecture d'un Projet lance le CLI `dolt` et relit toute sa lignée : plusieurs secondes sur une machine chargée.
vi.setConfig({ testTimeout: 60_000 });

const DAY = 86_400_000;
/** Lundi 12 octobre 2026, 12:00 UTC : les commits des bases d'essai sont datés du 2 au 7 octobre, à 10:00 UTC. */
const NOW = new Date('2026-10-12T12:00:00Z');
const PERIOD = '?from=2026-10-01&to=2026-10-12';

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

const create = (id: string, day: number, type = 'task') =>
  `insert into issues (id, title, description, design, acceptance_criteria, notes, issue_type, created_at, updated_at, close_reason)
   values ('${id}', 'Titre ${id}', '', '', '', '', '${type}', '${stamp(day)}', '${stamp(day)}', '')`;

const discoveredFrom = (id: string, origin: string, day: number) =>
  `insert into dependencies (id, issue_id, depends_on_issue_id, type, created_at, created_by) values (uuid(), '${id}', '${origin}', 'discovered-from', '${stamp(day)}', 'tom')`;

const move = (id: string, status: string, day: number) =>
  `update issues set status = '${status}', updated_at = '${stamp(day)}', closed_at = ${status === 'closed' ? `'${stamp(day)}'` : 'null'} where id = '${id}'`;

/** Une étape de l'histoire d'un Projet : le jour du commit (daté à 10 h UTC), et ce qui s'y passe. */
type Script = [day: number, statements: string[]][];

/**
 * Projet « epsilon » : l'horloge d'un commit recule. Les trois commits se suivent dans cet ordre, qui est celui de la lignée du
 * premier parent, mais le deuxième est daté deux jours avant le premier. Dolt ne s'y oppose pas.
 *
 *   commit 1, daté j5  e-1 et e-2 créés
 *   commit 2, daté j3  e-1 en cours ; e-2 fermé : l'horloge de ce commit est en retard de deux jours
 *   commit 3, daté j7  e-1 fermé
 *
 * Ce que dit la règle (ADR 0001) : une Transition n'est jamais datée avant la précédente du ticket. e-1 est créé le 5, démarré le 5 (et non
 * le 3), fermé le 7 : Lead Time 2 j, Cycle Time 2 j (4 j, du 3 au 7, sans cela : plus que le Lead Time). e-2 est créé et fermé le 5
 * (et non fermé le 3, deux jours avant d'exister : un Lead Time de −2 j sans cela) : Lead Time 0, jamais démarré.
 */
const EPSILON: Script = [
  [5, [create('e-1', 5), create('e-2', 5)]],
  [3, [move('e-1', 'in_progress', 3), move('e-2', 'closed', 3)]],
  [7, [move('e-1', 'closed', 7)]],
];

/**
 * Projet « zeta » : le Bug d'origine d'une Livraison dont l'horloge de clôture a reculé. Les quatre commits se suivent dans cet
 * ordre, celui de la lignée du premier parent.
 *
 *   commit 1, daté j2  z-1 créé
 *   commit 2, daté j6  z-1 en cours
 *   commit 3, daté j3  z-1 fermé : l'horloge de ce commit est en retard de trois jours sur le précédent
 *   commit 4, daté j4  z-2 (un bug) créé, découvert à partir de z-1
 *
 * Dans la lignée, le bug est créé après la clôture de z-1 : c'est son Bug d'origine, et z-1 est une Livraison en échec. La règle
 * (ADR 0001) date cette Livraison du j6, puisqu'un ticket n'est pas fermé avant d'avoir été démarré : la Livraison compte ce jour-là,
 * après la création du bug (j4). Le Taux d'échec, lui, compare les dates enregistrées des deux tickets : clôture j3, création j4.
 */
const ZETA: Script = [
  [2, [create('z-1', 2)]],
  [6, [move('z-1', 'in_progress', 6)]],
  [3, [move('z-1', 'closed', 3)]],
  [4, [create('z-2', 4, 'bug'), discoveredFrom('z-2', 'z-1', 4)]],
];

/** Crée le Projet `name`, de préfixe `prefix`, dans `root` : une base Dolt dont l'historique rejoue `script`, un commit par étape. */
function buildProject(root: string, name: string, prefix: string, script: Script): void {
  const beads = join(root, name, '.beads');
  mkdirSync(beads, { recursive: true });
  writeFileSync(join(beads, 'metadata.json'), JSON.stringify({ backend: 'dolt', database: 'dolt', dolt_mode: 'embedded', dolt_database: 'tdb' }));
  const base = createDatabase(isolatedDoltEnv(), join(beads, 'embeddeddolt', 'tdb'));
  base.sql(`${SCHEMA} insert into config values ('issue_prefix', '${prefix}');`);
  for (const [day, statements] of script) {
    base.sql(statements.join(';\n'));
    base.commit(day, `commit daté du jour ${day}`);
  }
}

describe.skipIf(!hasBinary('dolt'))('horloge de commit qui recule, sur une vraie base Dolt', () => {
  let chronology: (id: string, project?: string) => Promise<IssueChronology>;
  let metrics: (query: string) => Promise<MetricsResponse>;

  beforeAll(() => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'bdesk-clock-back-')));
    buildProject(root, 'epsilon', 'e', EPSILON);
    buildProject(root, 'zeta', 'z', ZETA);

    const config = { roots: [root], projects: [], hiddenProjects: [] };
    const projects = createProjectService(config);
    const app = buildServer({ config, projects, metrics: createMetricsService(projects, { now: () => NOW, timeZone: 'UTC' }) });
    chronology = async (id, project = 'epsilon') =>
      (await app.inject({ method: 'GET', url: `/api/projects/${project}/issues/${id}/chronology` })).json().chronology;
    metrics = async (query) => (await app.inject({ method: 'GET', url: `/api/metrics${query}` })).json();
  }, 240_000);

  it('date la Transition dont l’horloge a reculé de la précédente : la durée du statut d’avant est nulle, jamais négative', async () => {
    const { transitions } = await chronology('e-1');

    expect(transitions).toEqual([
      { status: 'open', at: iso(5), duration: 0 },
      { status: 'in_progress', at: iso(5), duration: 2 * DAY },
      { status: 'closed', at: iso(7), duration: null },
    ]);
  });

  it('tient le Cycle Time dans le Lead Time, et les temps passés dans les statuts font le Lead Time', async () => {
    const { leadTime, cycleTime, transitions } = await chronology('e-1');

    expect(leadTime).toBe(2 * DAY);
    expect(cycleTime).toBe(2 * DAY); // 4 j sans la borne : du 3 au 7
    expect(transitions.reduce((total, t) => total + (t.duration ?? 0), 0)).toBe(leadTime);
  });

  it('ne ferme pas un ticket avant sa création : la clôture dont l’horloge a reculé tombe à la création, Lead Time 0', async () => {
    const { transitions, leadTime, cycleTime, outcome } = await chronology('e-2');

    expect(transitions).toEqual([
      { status: 'open', at: iso(5), duration: 0 },
      { status: 'closed', at: iso(5), duration: null },
    ]);
    expect(leadTime).toBe(0); // −2 j sans la borne
    expect(cycleTime).toBeNull();
    expect(outcome).toEqual({ kind: 'delivered', at: iso(5) });
  });

  it('mesure les mêmes durées dans les métriques : Lead Time, Cycle Time et nuage de points', async () => {
    const report = await metrics(`${PERIOD}&project=epsilon`);

    expect(report.tiles.throughput.total).toBe(2);
    expect(report.tiles.leadTime).toMatchObject({ median: DAY, n: 2 }); // 0 (e-2) et 2 j (e-1)
    expect(report.tiles.cycleTime).toMatchObject({ median: 2 * DAY, n: 1 }); // e-1 seul : e-2 n'a jamais été démarré
    expect(report.cycleTimeScatter.map((point) => [point.id, point.deliveredAt, point.cycleTime])).toEqual([['e-1', iso(7), 2 * DAY]]);
  });

  it('range chaque Livraison le jour où le CFD la met en Terminé', async () => {
    const report = await metrics(`${PERIOD}&project=epsilon`);

    expect(report.buckets.filter((bucket) => bucket.deliveries > 0).map((bucket) => [bucket.from, bucket.deliveries])).toEqual([
      ['2026-10-05', 1], // e-2, créé et fermé le 5
      ['2026-10-07', 1], // e-1
    ]);
    const done = (date: string) => report.cfd.find((point) => point.date === date)?.done;
    expect([done('2026-10-04'), done('2026-10-05'), done('2026-10-06'), done('2026-10-07')]).toEqual([0, 1, 1, 2]);
  });

  it('compte le bug créé après la clôture, dans la lignée, comme Bug d’origine de la Livraison, bien que la règle date celle-ci après lui', async () => {
    const delivery = await chronology('z-1', 'zeta');
    const report = await metrics(`${PERIOD}&project=zeta`);

    expect(delivery.outcome).toEqual({ kind: 'delivered', at: iso(6) }); // la clôture datée du j3 tombe au j6, après la création du bug (j4)
    expect(report.tiles.failureRate).toMatchObject({ deliveries: 1, failed: 1, rate: 1 });
    expect(report.tiles.failureRate.coverage).toEqual({ bugs: 1, linked: 1, ratio: 1 });
  });
});
