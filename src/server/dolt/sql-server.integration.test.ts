import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { IssueChronologyResponse, IssueResponse, IssuesResponse, ProjectsResponse } from '../../shared/api';
import { buildServer } from '../server';
import { buildLegacyDatabase, createDatabase, day, hasBinary, isolatedDoltEnv } from '../testing/dolt-fixture';
import { type SqlServer, startSqlServer } from '../testing/dolt-server';
import { scratchDir } from '../testing/scratch';
import { createDoltClient } from './client';
import { readTicketHistories } from './history';
import { readDependencies, readIssueSummaries } from './reader';

/**
 * Derrière un `dolt sql-server`, `dolt sql -r json` rend les entiers en chaînes (`"priority":"0"`), là où la lecture directe des fichiers
 * les rend en nombres (bdesk-38k.44). C'est ce que fait le CLI de lui-même quand un serveur tourne pour la base : un Projet en mode server
 * dont la base est locale, ou un Projet embedded dont quelqu'un a lancé un serveur. Le lecteur ne lisait la priorité que si c'était un
 * nombre (toutes les priorités valaient 2, au tableau comme à la fiche) et la recréation d'un ticket que si `restart` valait le nombre 1
 * (jamais détectée : la vie précédente d'un ticket supprimé puis recréé comptait dans sa Chronologie et dans les métriques).
 *
 * Ici sur de vraies bases Dolt (sans bd) et un vrai `dolt sql-server` jetable, sur un port libre, arrêté à la fin : la même base est lue
 * directement puis derrière le serveur, par l'API de l'app, et les deux lectures doivent dire la même chose.
 *
 *   s-1 (P0), s-2 (P1), s-3 (P2, epic), s-4 (P3), s-5 (P4), s-6 (P1), s-7 (P3) créés le jour 1
 *   jour 2  s-5 fermé ; s-6 en cours et dépend de s-7 (blocks)
 *   jour 3  s-6 supprimé, avec sa dépendance
 *   jour 4  s-1 en cours
 *   jour 5  s-6 recréé (P4, ouvert)
 *   jour 6  s-6 en cours
 */

/** Les métriques de la période close du 1er au 7 octobre 2026 : les commits des bases d'essai vont du 1er au 6, à 10:00 UTC. */
const PERIOD = 'from=2026-10-01&to=2026-10-07';

const SCHEMA = `
  create table issues (
    id varchar(255) primary key, title varchar(500) not null, description text not null, design text not null,
    acceptance_criteria text not null, notes text not null, status varchar(32) not null default 'open',
    priority int not null default 2, issue_type varchar(32) not null default 'task', assignee varchar(255),
    estimated_minutes int, pinned tinyint(1) default 0, row_lock bigint not null default 0,
    created_at datetime not null, updated_at datetime not null, closed_at datetime, close_reason text not null);
  create table dependencies (
    id char(36) primary key, issue_id varchar(255) not null, depends_on_issue_id varchar(255) not null,
    type varchar(32) not null default 'blocks', created_at datetime not null, created_by varchar(255) not null, metadata json);
  create table labels (issue_id varchar(255) not null, label varchar(255) not null, primary key (issue_id, label));
  create table comments (id char(36) primary key, issue_id varchar(255) not null, author varchar(255) not null,
    text text not null, created_at datetime not null);
  create table config (\`key\` varchar(255) primary key, value text not null);`;

const stamp = (n: number) => `2026-10-${String(n).padStart(2, '0')} 10:00:00`;
const create = (id: string, type: string, priority: number, n: number) =>
  `insert into issues (id, title, description, design, acceptance_criteria, notes, issue_type, priority, created_at, updated_at, close_reason)
   values ('${id}', 'Titre ${id}', '', '', '', '', '${type}', ${priority}, '${stamp(n)}', '${stamp(n)}', '')`;
const move = (id: string, status: string, n: number) =>
  `update issues set status = '${status}', updated_at = '${stamp(n)}', closed_at = ${status === 'closed' ? `'${stamp(n)}'` : 'null'} where id = '${id}'`;

/** Les priorités des tickets de la base : une seule vaut 2, la valeur par défaut que le lecteur donnait à tort à toutes derrière un serveur. */
const PRIORITIES = { 's-1': 0, 's-2': 1, 's-3': 2, 's-4': 3, 's-5': 4, 's-6': 4, 's-7': 3 };

/** Le Projet `name` dans `root`, `embedded` (la base dans `.beads/embeddeddolt/tdb`) ou `server` (dans `.beads/dolt/tdb`). */
function buildProject(root: string, name: string, mode: 'embedded' | 'server') {
  const beads = join(root, name, '.beads');
  mkdirSync(beads, { recursive: true });
  writeFileSync(join(beads, 'metadata.json'), JSON.stringify({ backend: 'dolt', database: 'dolt', dolt_mode: mode, dolt_database: 'tdb' }));
  const env = isolatedDoltEnv();
  const folder = join(beads, mode === 'embedded' ? 'embeddeddolt' : 'dolt');
  const database = join(folder, 'tdb');
  const base = createDatabase(env, database);
  base.sql(`${SCHEMA} insert into config values ('issue_prefix', 's');`);
  base.sql(
    [
      create('s-1', 'task', 0, 1),
      create('s-2', 'bug', 1, 1),
      create('s-3', 'epic', 2, 1),
      create('s-4', 'task', 3, 1),
      create('s-5', 'chore', 4, 1),
      create('s-6', 'task', 1, 1),
      create('s-7', 'task', 3, 1),
    ].join(';\n'),
  );
  base.commit(1, 'jour 1');
  base.sql(
    [
      move('s-5', 'closed', 2),
      move('s-6', 'in_progress', 2),
      `insert into dependencies values (uuid(), 's-6', 's-7', 'blocks', '${stamp(2)}', 'tom', '{"k": 1}')`,
    ].join(';\n'),
  );
  base.commit(2, 'jour 2');
  base.sql(`delete from dependencies where issue_id = 's-6'; delete from issues where id = 's-6'`);
  base.commit(3, 'jour 3 : s-6 supprimé');
  base.sql(move('s-1', 'in_progress', 4));
  base.commit(4, 'jour 4');
  base.sql(create('s-6', 'task', 4, 5));
  base.commit(5, 'jour 5 : s-6 recréé');
  base.sql(move('s-6', 'in_progress', 6));
  base.commit(6, 'jour 6');
  return { env, database, folder };
}

type Dump = Record<string, { status: number; body: unknown }>;

/** Ce que l'API de l'app répond sur le Projet `project` : la liste, les fiches et Chronologies de quelques tickets, les métriques. */
async function dump(app: FastifyInstance, project: string): Promise<Dump> {
  const get = async (url: string) => {
    const res = await app.inject({ url });
    return { status: res.statusCode, body: res.json() as unknown };
  };
  const out: Dump = {
    projects: await get('/api/projects'),
    issues: await get(`/api/projects/${project}/issues`),
  };
  for (const id of ['s-1', 's-4', 's-6']) {
    out[`issue ${id}`] = await get(`/api/projects/${project}/issues/${id}`);
    out[`chronology ${id}`] = await get(`/api/projects/${project}/issues/${id}/chronology`);
  }
  const metrics = await get(`/api/metrics?project=${project}&${PERIOD}`);
  delete (metrics.body as { generatedAt?: string }).generatedAt; // l'heure de la réponse, seule valeur qui change d'une lecture à l'autre
  out.metrics = metrics;
  return out;
}

const body = <T>(dumped: Dump, key: string) => {
  const answer = dumped[key];
  expect(answer?.status, key).toBe(200);
  return answer?.body as T;
};

/** Le Projet, lu par l'API : une seule fois sans serveur, une seule fois derrière un `dolt sql-server`, chaque lecture sur un service neuf (aucun cache). */
describe.skipIf(!hasBinary('dolt')).each([['embedded'], ['server']] as const)(
  'Projet %s dont un dolt sql-server tourne (bdesk-38k.44)',
  { timeout: 120_000 },
  (mode) => {
    let root: string;
    let database: string;
    let server: SqlServer;
    let direct: Dump;
    let served: Dump;
    let directHistories: Awaited<ReturnType<typeof readTicketHistories>>;
    let servedHistories: Awaited<ReturnType<typeof readTicketHistories>>;
    let portSeenWithoutServer: string;
    let portSeenWithServer: string;
    let rawPriority: unknown;

    const readEverything = async () => {
      // Une application neuve à chaque fois : son service et ses caches (par HEAD) ne gardent rien de la lecture précédente.
      const app = buildServer({ config: { roots: [root], projects: [], hiddenProjects: [] }, live: { intervalMs: 3_600_000 } });
      try {
        return await dump(app, 'projet');
      } finally {
        await app.close();
      }
    };
    const client = createDoltClient();
    const portOf = async () => String((await client.open(database).query('select @@port as port'))[0]?.port);

    beforeAll(async () => {
      root = realpathSync(scratchDir('bdesk-sql-server-'));
      const project = buildProject(root, 'projet', mode);
      database = project.database;
      direct = await readEverything();
      directHistories = await readTicketHistories(client.open(database));
      portSeenWithoutServer = await portOf();

      // `embedded` : le serveur est lancé dans le dossier de la base. `server` : dans `.beads/dolt`, le dossier qui contient la base `tdb` et qu'il sert.
      server = await startSqlServer(project.env, mode === 'embedded' ? database : project.folder, { databaseDir: database });
      portSeenWithServer = await portOf();
      rawPriority = (await client.open(database).query('select priority from issues order by id limit 1'))[0]?.priority;
      served = await readEverything();
      servedHistories = await readTicketHistories(client.open(database));
    }, 180_000);

    afterAll(() => server?.stop(), 60_000);

    it('est lu par le serveur : le moteur annonce son port, et les entiers y arrivent en chaînes (la prémisse du bogue)', () => {
      expect(portSeenWithoutServer).toBe('3306'); // le moteur de dolt, sans serveur : son port par défaut
      expect(portSeenWithServer).toBe(String(server.port));
      expect(rawPriority).toBe('0'); // « 0 » et non 0 : s'il arrive un jour en nombre, le décodage des entiers n'a plus d'objet
    });

    it('lit les priorités du tableau, pas la valeur par défaut', () => {
      const { issues } = body<IssuesResponse>(served, 'issues');

      expect(Object.fromEntries(issues.map((issue) => [issue.id, issue.priority]))).toEqual(PRIORITIES);
    });

    it('lit la priorité de la fiche : le ticket recréé a celle de sa seconde vie', () => {
      expect(body<IssueResponse>(served, 'issue s-1').issue.priority).toBe(0);
      expect(body<IssueResponse>(served, 'issue s-4').issue.priority).toBe(3);
      expect(body<IssueResponse>(served, 'issue s-6').issue.priority).toBe(4);
    });

    it('détecte la recréation d’un ticket : seule sa dernière vie compte, sans sa dépendance de la première', () => {
      const byId = new Map(servedHistories.map((history) => [history.id, history]));

      expect(byId.get('s-6')?.statusSnapshots).toEqual([
        { status: 'open', at: new Date(day(5)) },
        { status: 'in_progress', at: new Date(day(6)) },
      ]);
      expect(byId.get('s-6')?.dependencies).toEqual([]);
      // s-1, qui n'a pas de trou, garde tout son historique.
      expect(byId.get('s-1')?.statusSnapshots).toEqual([
        { status: 'open', at: new Date(day(1)) },
        { status: 'in_progress', at: new Date(day(4)) },
      ]);
    });

    it('donne à la Chronologie du ticket recréé sa seconde vie seule', () => {
      const { chronology } = body<IssueChronologyResponse>(served, 'chronology s-6');

      expect(chronology.source).toBe('history');
      expect(chronology.transitions.map(({ status, at }) => [status, at])).toEqual([
        ['open', new Date(day(5)).toISOString()],
        ['in_progress', new Date(day(6)).toISOString()],
      ]);
      expect(chronology.blockages).toEqual([]); // la dépendance de la première vie ne le bloque pas
    });

    it('répond partout comme sans serveur : liste des Projets, tableau, fiches, Chronologies, métriques, historique', () => {
      expect(Object.keys(served)).toEqual(Object.keys(direct));
      for (const key of Object.keys(direct)) expect(served[key], key).toEqual(direct[key]);
      expect(servedHistories).toEqual(directHistories);
      expect(body<ProjectsResponse>(served, 'projects').projects).toMatchObject([{ id: 'projet', mode, status: 'ok', prefix: 's' }]);
    });
  },
);

/**
 * L'historique d'une base dont le schéma des dépendances a migré en cours d'histoire relit les commits d'avant la migration dans une base de
 * révision (`<base>/<commit>.dolt_history_dependencies`, après `select database()`) : une forme de lecture que les autres tests ne montrent pas
 * derrière un serveur. Elle rend les mêmes dépendances, avec ou sans serveur (`buildLegacyDatabase`, comme `dolt.test.ts` sans serveur).
 */
describe.skipIf(!hasBinary('dolt'))('Base au schéma des dépendances migré, dont un dolt sql-server tourne (bdesk-38k.44)', { timeout: 120_000 }, () => {
  let server: SqlServer;
  let direct: Reading;
  let served: Reading;
  let portSeen: string;

  type Reading = { histories: Awaited<ReturnType<typeof readTicketHistories>>; dependencies: unknown; issues: unknown };

  beforeAll(async () => {
    const env = isolatedDoltEnv();
    const dir = join(realpathSync(scratchDir('bdesk-sql-server-legacy-')), 'db');
    buildLegacyDatabase(env, dir);
    const db = createDoltClient().open(dir);
    const read = async (): Promise<Reading> => ({
      histories: await readTicketHistories(db),
      dependencies: await readDependencies(db),
      issues: await readIssueSummaries(db),
    });
    direct = await read();
    server = await startSqlServer(env, dir);
    portSeen = String((await db.query('select @@port as port'))[0]?.port);
    served = await read();
  }, 180_000);

  afterAll(() => server?.stop(), 60_000);

  it('relit les dépendances d’avant la migration, et les dates de tous les tickets, comme sans serveur', () => {
    expect(portSeen).toBe(String(server.port));
    expect(served).toEqual(direct);
    const byId = new Map(served.histories.map((history) => [history.id, history]));
    expect(byId.get('t-2')?.dependencies).toEqual([
      { type: 'blocks', target: 't-1', addedAt: new Date(day(2)), removedAt: new Date(day(7)) },
      { type: 'parent-child', target: 't-3', addedAt: new Date(day(2)) },
    ]);
    expect(byId.get('t-1')?.statusSnapshots.map((snapshot) => snapshot.status)).toEqual(['open', 'in_progress', 'closed']);
  });
});
