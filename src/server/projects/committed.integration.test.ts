import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { columnFor } from '../../domain/columns';
import type { Issue } from '../../shared/api';
import { createChronologyService } from '../chronology/service';
import { createDoltClient, type DoltClient, queryAll } from '../dolt/client';
import { createMetricsService } from '../metrics/service';
import { createDatabase, hasBinary, isolatedDoltEnv, type Scratch } from '../testing/dolt-fixture';
import { readsOutsideHead, tablesRead } from '../testing/reads-at-head';
import { scratchDir } from '../testing/scratch';
import { createProjectService, IssueNotFoundError, type ProjectService } from './service';

/**
 * Le tableau et la fiche lisent l'état du dernier commit, comme l'historique d'où viennent les métriques et la Chronologie
 * (bdesk-38k.36, ADR 0001). Ce que bd a écrit sans l'avoir commité (auto-commit `batch` ou `off`) est dans le working set de la
 * base, que `dolt_history_*` ne voit pas : lu par le tableau, un lien `blocks` posé y mettait un ticket en Backlog quand le CFD le
 * disait Prêt, un statut changé le montrait en cours quand le WIP ne le comptait pas, un lien de doublon en faisait un Abandon
 * que la Chronologie ignorait. L'historique, lui, lit aussi une table de la base, la liste des tickets et leur type : s'il la lisait
 * dans le working set, un ticket supprimé ou retypé sans commit ferait de nouveau dire autre chose au tableau.
 * Ici sur de vraies bases Dolt, écrites à la main (sans bd), avec ou sans commit :
 *
 *   alpha  j1  u-1 à u-4 (tâches), u-5 (epic), u-7 et u-8 (tâches) créés
 *          j2  u-3 et u-8 en cours ; u-4 reçoit une description, une étiquette, un commentaire
 *          puis, sans commit : u-1 dépend de u-2 (blocks) ; u-2 en cours ; u-3 fermé, doublon de u-2 ; u-4 change de description et
 *          reçoit une étiquette et un commentaire de plus ; u-6 est créé ; u-7 est supprimé ; u-8 devient un epic
 *   beta   les mêmes écritures, commitées le jour 3
 *   gamma  comme alpha, mais commité en cours de test
 */

/** Lundi 5 octobre 2026, 12:00 UTC : les commits des bases d'essai vont du 1er au 3 octobre, à 10:00 UTC. */
const NOW = new Date('2026-10-05T12:00:00Z');

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

const create = (id: string, type: string, day: number) =>
  `insert into issues (id, title, description, design, acceptance_criteria, notes, issue_type, created_at, updated_at, close_reason)
   values ('${id}', 'Titre ${id}', '', '', '', '', '${type}', '${stamp(day)}', '${stamp(day)}', '')`;
const move = (id: string, status: string, day: number) =>
  `update issues set status = '${status}', updated_at = '${stamp(day)}', closed_at = ${status === 'closed' ? `'${stamp(day)}'` : 'null'} where id = '${id}'`;
const retype = (id: string, type: string, day: number) => `update issues set issue_type = '${type}', updated_at = '${stamp(day)}' where id = '${id}'`;
const remove = (id: string) => `delete from issues where id = '${id}'`;
const describeAs = (id: string, text: string, day: number) =>
  `update issues set description = '${text}', updated_at = '${stamp(day)}' where id = '${id}'`;
const link = (id: string, target: string, type: string, day: number) =>
  `insert into dependencies (id, issue_id, depends_on_issue_id, type, created_at, created_by) values (uuid(), '${id}', '${target}', '${type}', '${stamp(day)}', 'tom')`;
const label = (id: string, text: string) => `insert into labels values ('${id}', '${text}')`;
const comment = (id: string, text: string, day: number) =>
  `insert into comments values (uuid(), '${id}', 'tom', '${text}', '${stamp(day)}')`;

/** Ce que bd écrit le jour 3. */
const DAY_THREE = [
  link('u-1', 'u-2', 'blocks', 3),
  move('u-2', 'in_progress', 3),
  move('u-3', 'closed', 3),
  link('u-3', 'u-2', 'duplicates', 3),
  describeAs('u-4', 'Description du jour 3', 3),
  label('u-4', 'frontend'),
  comment('u-4', 'Second commentaire', 3),
  create('u-6', 'task', 3),
  remove('u-7'),
  retype('u-8', 'epic', 3),
];

/** Le Projet `name` dans `root` : deux jours commités, puis les écritures du jour 3, commitées ou non. */
function buildProject(root: string, name: string, { commitDayThree }: { commitDayThree: boolean }): Scratch {
  const beads = join(root, name, '.beads');
  mkdirSync(beads, { recursive: true });
  writeFileSync(join(beads, 'metadata.json'), JSON.stringify({ backend: 'dolt', database: 'dolt', dolt_mode: 'embedded', dolt_database: 'tdb' }));
  const base = createDatabase(isolatedDoltEnv(), join(beads, 'embeddeddolt', 'tdb'));
  base.sql(`${SCHEMA} insert into config values ('issue_prefix', 'u');`);
  base.sql(
    [
      create('u-1', 'task', 1),
      create('u-2', 'task', 1),
      create('u-3', 'task', 1),
      create('u-4', 'task', 1),
      create('u-5', 'epic', 1),
      create('u-7', 'task', 1),
      create('u-8', 'task', 1),
    ].join(';\n'),
  );
  base.commit(1, 'jour 1');
  base.sql(
    [
      move('u-3', 'in_progress', 2),
      move('u-8', 'in_progress', 2),
      describeAs('u-4', 'Description du jour 2', 2),
      label('u-4', 'backend'),
      comment('u-4', 'Premier commentaire', 2),
    ].join(';\n'),
  );
  base.commit(2, 'jour 2');
  base.sql(DAY_THREE.join(';\n'));
  if (commitDayThree) base.commit(3, 'jour 3');
  return base;
}

type Columns = { backlog: number; ready: number; inProgress: number; blocked: number; done: number };

/** Les tickets du tableau par colonne, comme le CFD les compte : sans les Epics, ni « En pause ». */
function boardCounts(issues: Issue[]): Columns {
  const counts: Columns = { backlog: 0, ready: 0, inProgress: 0, blocked: 0, done: 0 };
  for (const issue of issues) {
    const column = issue.type === 'epic' ? null : columnFor(issue.status, issue.blockedBy.length > 0);
    if (column) counts[column]++;
  }
  return counts;
}

/** Les tickets du tableau qui travaillent (en cours ou bloqués), sans les Epics : ceux que le WIP des métriques compte. */
const boardWorking = (issues: Issue[]) =>
  issues
    .filter((issue) => issue.type !== 'epic' && ['in_progress', 'hooked', 'blocked'].includes(issue.status))
    .map((issue) => issue.id)
    .sort();

/** Un client Dolt qui garde le SQL de chaque lecture envoyée à la vraie base, une lecture groupée comptant pour chacune de ses requêtes. */
function recordingDolt(): DoltClient & { sqls: string[] } {
  const real = createDoltClient();
  const sqls: string[] = [];
  return {
    sqls,
    open: (dir) => {
      const db = real.open(dir);
      return {
        dir,
        query: (sql, options) => {
          sqls.push(sql);
          return db.query(sql, options);
        },
        queryAll: (statements, options) => {
          sqls.push(...statements);
          return queryAll(db, statements, options);
        },
      };
    },
  };
}

describe.skipIf(!hasBinary('dolt'))('le tableau lit l’état du dernier commit, comme les métriques', { timeout: 60_000 }, () => {
  let root: string;
  let projects: ProjectService;
  let metrics: ReturnType<typeof createMetricsService>;
  let gamma: Scratch;
  const config = () => ({ roots: [root], projects: [], hiddenProjects: [] });

  beforeAll(() => {
    root = realpathSync(scratchDir('bdesk-committed-'));
    buildProject(root, 'alpha', { commitDayThree: false });
    buildProject(root, 'beta', { commitDayThree: true });
    gamma = buildProject(root, 'gamma', { commitDayThree: false });
    projects = createProjectService(config());
    metrics = createMetricsService(projects, { now: () => NOW, timeZone: 'UTC' });
  }, 120_000);

  const issuesOf = async (project: string) => new Map((await projects.issues(project)).map((issue) => [issue.id, issue]));
  const cfdOf = async (project: string) => {
    const { cfd, tiles, inProgress } = await metrics.compute({ projects: [project], period: { range: '7d' } });
    const { backlog, ready, inProgress: working, blocked, done } = cfd.at(-1) ?? { backlog: -1, ready: -1, inProgress: -1, blocked: -1, done: -1 };
    return {
      columns: { backlog, ready, inProgress: working, blocked, done },
      wip: tiles.wip.current,
      working: inProgress.map((ticket) => ticket.id).sort(),
    };
  };
  /** Ce que l'historique, d'où viennent les métriques, sait des tickets du Projet : leur identifiant et leur type. */
  const historyOf = async (project: string) => (await projects.histories(project)).map(({ id, type }) => [id, type]).sort();
  const boardOf = async (project: string) => [...(await issuesOf(project)).values()].map(({ id, type }) => [id, type]).sort();

  describe('dont bd n’a pas commité les dernières écritures (auto-commit batch ou off)', () => {
    it('ne montre pas un lien blocks posé sans commit : le ticket reste Prêt, comme dans le CFD', async () => {
      const issues = await issuesOf('alpha');

      expect(issues.get('u-1')).toMatchObject({ status: 'open', blockedBy: [] });
      expect(issues.get('u-2')?.blockedBy).toEqual([]);
    });

    it('ne montre pas un statut changé sans commit', async () => {
      const issues = await issuesOf('alpha');

      expect(issues.get('u-2')?.status).toBe('open');
      expect(issues.get('u-3')?.status).toBe('in_progress');
      expect(issues.get('u-3')?.closedAt).toBeNull();
    });

    it('ne fait pas d’Abandon d’un ticket dont le lien de doublon n’est pas commité', async () => {
      const issues = await issuesOf('alpha');

      expect(issues.get('u-3')).not.toHaveProperty('abandon');
    });

    it('ne connaît pas un ticket créé sans commit : ni dans la liste, ni par sa fiche', async () => {
      const issues = await issuesOf('alpha');

      expect([...issues.keys()].sort()).toEqual(['u-1', 'u-2', 'u-3', 'u-4', 'u-5', 'u-7', 'u-8']);
      await expect(projects.issue('alpha', 'u-6')).rejects.toBeInstanceOf(IssueNotFoundError);
    });

    it('garde un ticket supprimé sans commit, comme l’historique : il est listé, sa fiche s’ouvre, sa Chronologie vient de l’historique', async () => {
      const issues = await issuesOf('alpha');

      expect(issues.get('u-7')).toMatchObject({ status: 'open' });
      await expect(projects.issue('alpha', 'u-7')).resolves.toMatchObject({ id: 'u-7', status: 'open' });
      expect((await createChronologyService(projects).chronology('alpha', 'u-7')).source).toBe('history');
    });

    it('garde le type d’un ticket dont le type a changé sans commit : une tâche pour le tableau, pour l’historique et pour les métriques', async () => {
      expect((await issuesOf('alpha')).get('u-8')).toMatchObject({ type: 'task', status: 'in_progress' });
      expect((await historyOf('alpha')).filter(([id]) => id === 'u-8')).toEqual([['u-8', 'task']]);
      expect((await cfdOf('alpha')).working).toContain('u-8'); // une Epic n'est mesurée nulle part : elle n'y serait pas
    });

    it('donne à la fiche le texte, les étiquettes et les commentaires du dernier commit', async () => {
      const detail = await projects.issue('alpha', 'u-4');

      expect(detail.description).toBe('Description du jour 2');
      expect(detail.labels).toEqual(['backend']);
      expect(detail.comments.map((c) => c.text)).toEqual(['Premier commentaire']);
    });

    it('n’y fait apparaître aucun lien non commité parmi ceux de la fiche', async () => {
      const detail = await projects.issue('alpha', 'u-2');

      expect(detail.dependents).toEqual([]);
      expect(detail.dependencies).toEqual([]);
    });

    it('donne à l’historique la même liste de tickets et les mêmes types que le tableau', async () => {
      expect(await historyOf('alpha')).toEqual(await boardOf('alpha'));
      expect(await historyOf('alpha')).toEqual([
        ['u-1', 'task'],
        ['u-2', 'task'],
        ['u-3', 'task'],
        ['u-4', 'task'],
        ['u-5', 'epic'],
        ['u-7', 'task'],
        ['u-8', 'task'],
      ]);
    });

    it('range les tickets dans les mêmes colonnes que le CFD des métriques, et compte le même WIP', async () => {
      const issues = [...(await issuesOf('alpha')).values()];
      const board = boardCounts(issues);
      const { columns, wip, working } = await cfdOf('alpha');

      expect(columns).toEqual({ backlog: 0, ready: 4, inProgress: 2, blocked: 0, done: 0 });
      expect(board).toEqual(columns);
      expect(wip).toBe(board.inProgress + board.blocked);
      expect(working).toEqual(boardWorking(issues)); // les mêmes tickets, pas seulement le même nombre
      expect(working).toEqual(['u-3', 'u-8']);
    });
  });

  describe('dont bd a commité ces écritures', () => {
    it('les montre : Blocage, statuts, Abandon, nouveau ticket, ticket supprimé, type, fiche', async () => {
      const issues = await issuesOf('beta');

      expect(issues.get('u-1')).toMatchObject({ status: 'open', blockedBy: ['u-2'] });
      expect(issues.get('u-2')?.status).toBe('in_progress');
      expect(issues.get('u-3')).toMatchObject({ status: 'closed', abandon: { cause: 'duplicate', of: 'u-2' } });
      expect(issues.has('u-6')).toBe(true);
      expect(issues.has('u-7')).toBe(false);
      expect(issues.get('u-8')?.type).toBe('epic');
      const detail = await projects.issue('beta', 'u-4');
      expect(detail.description).toBe('Description du jour 3');
      expect([...detail.labels].sort()).toEqual(['backend', 'frontend']);
      expect(detail.comments.map((c) => c.text)).toEqual(['Premier commentaire', 'Second commentaire']);
    });

    it('accorde de nouveau le tableau, l’historique et le CFD', async () => {
      const issues = [...(await issuesOf('beta')).values()];
      const board = boardCounts(issues);
      const { columns, wip, working } = await cfdOf('beta');

      expect(columns).toEqual({ backlog: 1, ready: 2, inProgress: 1, blocked: 0, done: 1 });
      expect(board).toEqual(columns);
      expect(wip).toBe(board.inProgress + board.blocked);
      expect(working).toEqual(boardWorking(issues));
      expect(await historyOf('beta')).toEqual(await boardOf('beta'));
    });
  });

  describe('qu’un commit de bd vient rattraper', () => {
    it('montre alors ce que bd a écrit : le 404 d’un ticket cède, la liste et l’historique le disent, le supprimé disparaît', async () => {
      await expect(projects.issue('gamma', 'u-6')).rejects.toBeInstanceOf(IssueNotFoundError);
      expect((await issuesOf('gamma')).has('u-7')).toBe(true);

      gamma.commit(3, 'jour 3');

      await expect(projects.issue('gamma', 'u-6')).resolves.toMatchObject({ id: 'u-6', status: 'open' });
      const issues = await issuesOf('gamma');
      expect(issues.has('u-6')).toBe(true);
      expect(issues.has('u-7')).toBe(false);
      expect(issues.get('u-1')?.blockedBy).toEqual(['u-2']);
      expect(await historyOf('gamma')).toEqual(await boardOf('gamma'));
      await expect(projects.issue('gamma', 'u-7')).rejects.toBeInstanceOf(IssueNotFoundError);
    });
  });

  describe('toutes les lectures du service', () => {
    it('lisent chaque table de tickets au dernier commit : liste, fiche, historique, métriques et Chronologie', async () => {
      const dolt = recordingDolt();
      const service = createProjectService(config(), { dolt });

      await service.list(); // la découverte : le préfixe des tickets
      await service.issues('alpha');
      await service.issue('alpha', 'u-4');
      await service.histories('alpha');
      await createMetricsService(service, { now: () => NOW, timeZone: 'UTC' }).compute({ projects: ['alpha'], period: { range: '7d' } });
      await createChronologyService(service).chronology('alpha', 'u-7');

      // Le filet a vu toutes les tables que le service lit hors de l'historique de Dolt, et chacune de tickets porte la clause.
      expect(tablesRead(dolt.sqls)).toEqual(new Set(['config', 'issues', 'dependencies', 'labels', 'comments']));
      expect(readsOutsideHead(dolt.sqls)).toEqual([]);
    });
  });
});
