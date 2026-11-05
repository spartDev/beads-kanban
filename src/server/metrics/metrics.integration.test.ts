import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { analyzeFlow } from '../../domain/flow';
import { durationStats } from '../../domain/metrics';
import type { MetricsResponse } from '../../shared/api';
import { createDoltClient, type DoltClient } from '../dolt/client';
import { createProjectService, type ProjectService } from '../projects/service';
import { buildServer } from '../server';
import { createDatabase, hasBinary, isolatedDoltEnv, type Scratch } from '../testing/dolt-fixture';
import { scratchDir } from '../testing/scratch';
import { createMetricsService } from './service';

const DAY = 86_400_000;
/** Lundi 12 octobre 2026, 12:00 UTC : les commits des bases d'essai vont du 1er au 10 octobre, à 10:00 UTC. */
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

/** Crée un ticket ouvert le jour `day`. */
const create = (id: string, type: string, priority: number, day: number) =>
  `insert into issues (id, title, description, design, acceptance_criteria, notes, issue_type, priority, created_at, updated_at, close_reason)
   values ('${id}', 'Titre ${id}', '', '', '', '', '${type}', ${priority}, '${stamp(day)}', '${stamp(day)}', '')`;

/** Change le statut du ticket le jour `day`. */
const move = (id: string, status: string, day: number) =>
  `update issues set status = '${status}', updated_at = '${stamp(day)}', closed_at = ${status === 'closed' ? `'${stamp(day)}'` : 'null'} where id = '${id}'`;

const discoveredFrom = (id: string, origin: string, day: number) =>
  `insert into dependencies (id, issue_id, depends_on_issue_id, type, created_at, created_by) values (uuid(), '${id}', '${origin}', 'discovered-from', '${stamp(day)}', 'tom')`;

/** Une étape de l'histoire d'un Projet : le jour du commit, et ce qui s'y passe. */
type Script = [day: number, statements: string[]][];

/** Crée le Projet `name` dans `root` : une base Dolt dont l'historique rejoue `script`, un commit par jour. */
function buildProject(root: string, name: string, script: Script): Scratch {
  const env = isolatedDoltEnv();
  const beads = join(root, name, '.beads');
  mkdirSync(beads, { recursive: true });
  writeFileSync(join(beads, 'metadata.json'), JSON.stringify({ backend: 'dolt', database: 'dolt', dolt_mode: 'embedded', dolt_database: 'tdb' }));
  const base = createDatabase(env, join(beads, 'embeddeddolt', 'tdb'));
  base.sql(`${SCHEMA} insert into config values ('issue_prefix', '${name}');`);
  for (const [day, statements] of script) {
    base.sql(statements.join(';\n'));
    base.commit(day, `jour ${day}`);
  }
  return base;
}

/**
 * Projet « alpha » : quatre Livraisons, un bug critique, un Bug d'origine.
 *
 *   j1  a-1 (tâche), a-2 (bug P1), a-3 (feature) et a-4 (epic) créés
 *   j2  a-1 en cours             j3  a-1 fermé (Lead Time 2 j, Cycle Time 1 j) ; a-2 en cours
 *   j5  a-2 fermé (4 j, Cycle Time 2 j) ; a-5 (bug P2) créé, découvert à partir de a-1 : a-1 est en échec
 *   j6  a-3 en cours             j8  a-3 fermé (7 j, Cycle Time 2 j) ; a-6 (tâche) créé
 *   j9  a-6 fermé (1 j, jamais démarré)
 */
const ALPHA: Script = [
  [1, [create('a-1', 'task', 2, 1), create('a-2', 'bug', 1, 1), create('a-3', 'feature', 2, 1), create('a-4', 'epic', 2, 1)]],
  [2, [move('a-1', 'in_progress', 2)]],
  [3, [move('a-1', 'closed', 3), move('a-2', 'in_progress', 3)]],
  [5, [move('a-2', 'closed', 5), create('a-5', 'bug', 2, 5), discoveredFrom('a-5', 'a-1', 5)]],
  [6, [move('a-3', 'in_progress', 6)]],
  [8, [move('a-3', 'closed', 8), create('a-6', 'task', 2, 8)]],
  [9, [move('a-6', 'closed', 9)]],
];

/** Projet « beta » : deux Livraisons. j2 : b-1 et b-2 créés ; j4 : b-1 en cours ; j6 : b-1 fermé (4 j, Cycle Time 2 j) ; j9 : b-2 fermé (7 j, jamais démarré). */
const BETA: Script = [
  [2, [create('b-1', 'task', 2, 2), create('b-2', 'feature', 2, 2)]],
  [4, [move('b-1', 'in_progress', 4)]],
  [6, [move('b-1', 'closed', 6)]],
  [9, [move('b-2', 'closed', 9)]],
];

/** Un client dolt qui compte les requêtes lancées. */
function countingDolt(): DoltClient & { queries: string[] } {
  const real = createDoltClient();
  const dolt = {
    queries: [] as string[],
    open: (dir: string) => {
      const db = real.open(dir);
      return {
        dir,
        query: (sql: string) => {
          dolt.queries.push(sql);
          return db.query(sql);
        },
      };
    },
  };
  return dolt;
}

describe.skipIf(!hasBinary('dolt'))('métriques sur de vraies bases Dolt', () => {
  let root: string;
  let alpha: Scratch;
  let dolt: ReturnType<typeof countingDolt>;
  let projects: ProjectService;
  let get: (query: string) => Promise<{ status: number; body: MetricsResponse & { message?: string } }>;

  beforeAll(() => {
    root = realpathSync(scratchDir('bdesk-metrics-'));
    alpha = buildProject(root, 'alpha', ALPHA);
    buildProject(root, 'beta', BETA);
    // Un Projet dont la base n'est pas sur ce poste : illisible, mais sans incidence sur les autres.
    const absent = join(root, 'absent', '.beads');
    mkdirSync(absent, { recursive: true });
    writeFileSync(join(absent, 'metadata.json'), JSON.stringify({ backend: 'dolt', database: 'dolt', dolt_mode: 'server', dolt_database: 'tdb' }));

    dolt = countingDolt();
    const config = { roots: [root], projects: [], hiddenProjects: [] };
    projects = createProjectService(config, { dolt });
    const metrics = createMetricsService(projects, { now: () => NOW, timeZone: 'UTC' });
    const app = buildServer({ config, projects, metrics });
    get = async (query) => {
      const res = await app.inject({ method: 'GET', url: `/api/metrics${query}` });
      return { status: res.statusCode, body: res.json() };
    };
  }, 120_000);

  it('mesure un Projet : Débit, Lead Time, Cycle Time, Taux d’échec, Temps de rétablissement, WIP et Arrivées', async () => {
    const { status, body } = await get(`${PERIOD}&project=alpha`);

    expect(status).toBe(200);
    expect(body.projects).toEqual([{ id: 'alpha', name: 'alpha' }]);
    expect(body.tiles.throughput.total).toBe(4); // a-1, a-2, a-3, a-6 : ni l'Epic a-4, ni le bug a-5 encore ouvert
    // Lead Time : 1 j (a-6), 2 j (a-1), 4 j (a-2), 7 j (a-3) → médiane entre 2 j et 4 j (3 j), P85 aux 55 % du chemin de 4 j à 7 j (5,65 j)
    expect(body.tiles.leadTime).toMatchObject({ median: 3 * DAY, p85: expect.closeTo(5.65 * DAY, 3), n: 4 });
    // Cycle Time : 1 j (a-1), 2 j (a-2), 2 j (a-3) ; a-6 n'a jamais été démarré
    expect(body.tiles.cycleTime).toMatchObject({ median: 2 * DAY, p85: 2 * DAY, n: 3 });
    expect(body.tiles.failureRate).toMatchObject({ deliveries: 4, failed: 1, rate: 0.25, significant: false, reasons: ['few-bugs'] });
    expect(body.tiles.failureRate.coverage).toEqual({ bugs: 2, linked: 1, ratio: 0.5 });
    expect(body.tiles.recoveryTime).toMatchObject({ median: 4 * DAY, p85: 4 * DAY, n: 1 }); // a-2, bug P1
    expect(body.tiles.arrivals.total).toBe(5); // a-1, a-2, a-3, a-5, a-6
    // Travail en cours : a-1 (1 j), a-2 (2 j), a-3 (2 j) sur la durée écoulée, du 1er à 00:00 au 12 à 12:00 : 11,5 jours
    expect(body.tiles.wip.current).toBe(0);
    expect(body.tiles.wip.average).toBeCloseTo(5 / 11.5, 10);
  });

  it('place chaque Livraison dans le jour de sa dernière clôture, et dessine le CFD de ces jours', async () => {
    const { body } = await get(`${PERIOD}&project=alpha`);

    expect(body.buckets.filter((b) => b.deliveries > 0).map((b) => [b.from, b.deliveries])).toEqual([
      ['2026-10-03', 1],
      ['2026-10-05', 1],
      ['2026-10-08', 1],
      ['2026-10-09', 1],
    ]);
    expect(body.cycleTimeScatter.map((p) => [p.id, p.cycleTime / DAY])).toEqual([
      ['a-1', 1],
      ['a-2', 2],
      ['a-3', 2],
    ]);
    // Fin du 5 octobre : a-1 et a-2 terminés ; a-3 prêt ; a-5 prêt (créé le jour même) ; l'Epic n'est dans aucune colonne
    expect(body.cfd.find((p) => p.date === '2026-10-05')).toMatchObject({ backlog: 0, ready: 2, inProgress: 0, blocked: 0, done: 2 });
    expect(body.cfd.at(-1)).toMatchObject({ date: '2026-10-12', ready: 1, done: 4 }); // a-5 reste ouvert, tout le reste est livré
  });

  it('donne les mêmes durées que le module domaine appliqué directement à l’historique lu dans Dolt', async () => {
    const flows = analyzeFlow(await projects.histories('alpha'));
    const delivered = [...flows.values()].filter((f) => f.outcome.kind === 'delivered');
    const { body } = await get(`${PERIOD}&project=alpha`);

    expect(body.tiles.leadTime).toMatchObject(durationStats(delivered.flatMap((f) => (f.leadTime === null ? [] : [f.leadTime]))));
    expect(body.tiles.cycleTime).toMatchObject(durationStats(delivered.flatMap((f) => (f.cycleTime === null ? [] : [f.cycleTime]))));
  });

  it('ne compte pas ce qu’un commit daté après maintenant a fait : a-6, fermé le 9 à 10:00 UTC, n’est pas encore livré le 9 à 08:00 UTC', async () => {
    // L'horloge de ce commit avance de deux heures sur celle du serveur. Le 9 octobre est le jour en cours : la période
    // n'est pas finie, et ce qui arrive avant minuit mais après maintenant n'est pas encore arrivé.
    const early = createMetricsService(projects, { now: () => new Date('2026-10-09T08:00:00Z'), timeZone: 'UTC' });

    const { asOf, tiles, buckets, cfd } = await early.compute({ projects: ['alpha'], period: { from: '2026-10-01', to: '2026-10-09' } });

    expect(asOf).toBe('2026-10-09T08:00:00.000Z');
    expect(tiles.throughput.total).toBe(3); // a-1, a-2 et a-3 ; pas a-6, qui sera fermé à 10:00
    expect(tiles.leadTime.n).toBe(3);
    expect(tiles.arrivals.total).toBe(5); // a-1, a-2, a-3, a-5 et a-6, créé le 8
    expect(buckets.at(-1)).toMatchObject({ from: '2026-10-09', deliveries: 0 });
    expect(buckets.reduce((total, b) => total + b.deliveries, 0)).toBe(tiles.throughput.total);
    expect(cfd.at(-1)).toMatchObject({ date: '2026-10-09', ready: 2, done: 3 }); // a-5 et a-6 sont encore prêts
  });

  it('agrège la Vue globale sur l’union des Livraisons des Projets, et liste le Projet illisible', async () => {
    const { status, body } = await get(PERIOD);

    expect(status).toBe(200);
    expect(body.projects.map((p) => p.id)).toEqual(['alpha', 'beta']);
    expect(body.unreadable).toEqual([
      { id: 'absent', name: 'absent', reason: expect.stringContaining('mode server') },
    ]);
    expect(body.tiles.throughput.total).toBe(6); // 4 chez alpha, 2 chez beta
    // Union : 1 2 4 4 7 7 jours → médiane entre les deux 4 j, P85 entre deux 7 j ; la moyenne des médianes des Projets (3 j et 5,5 j) ferait 4,25 j
    expect(body.tiles.leadTime).toMatchObject({ median: 4 * DAY, p85: 7 * DAY, n: 6 });
    expect(body.slices.project.map((s) => [s.key, s.throughput])).toEqual([
      ['alpha', 4],
      ['beta', 2],
    ]);
    expect(body.tiles.failureRate.coverage).toEqual({ bugs: 2, linked: 1, ratio: 0.5 }); // beta n'a aucun bug
  });

  it('ne relit que HEAD tant que rien n’est commité, puis relit l’historique du Projet dont HEAD a changé', async () => {
    await get(`${PERIOD}&project=alpha`); // le cache est chaud
    const before = dolt.queries.length;
    await get(`${PERIOD}&project=alpha`);
    const warm = dolt.queries.slice(before);

    expect(warm.filter((sql) => sql.includes('hashof(')).length).toBe(1);
    expect(warm.every((sql) => !sql.includes('dolt_history_issues'))).toBe(true); // aucune relecture de l'historique

    // Un commit de plus : a-7 est créé et fermé le 10 octobre.
    alpha.sql(`${create('a-7', 'task', 2, 10)}; ${move('a-7', 'closed', 10)}`);
    alpha.commit(10, 'jour 10');
    const afterCommit = await get(`${PERIOD}&project=alpha`);

    expect(afterCommit.body.tiles.throughput.total).toBe(5);
    expect(dolt.queries.slice(before).some((sql) => sql.includes('dolt_history_issues'))).toBe(true);
  });
});
