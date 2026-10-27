import { cpSync, existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { analyzeFlow } from '../../domain/flow';
import type { IssueDetail } from '../../shared/api';
import { buildLegacyDatabase, createDatabase, day, hasBinary, isolatedDoltEnv, type Scratch } from '../testing/dolt-fixture';
import { discoverProjects } from '../projects/discovery';
import { createProjectService } from '../projects/service';
import { buildServer } from '../server';
import { createDoltClient, type DoltDatabase, DoltQueryError } from './client';
import { readTicketHistories } from './history';
import { readComments, readDependencies, readIssue, readIssuePrefix, readIssueSummaries, readLabels } from './reader';

const at = (iso: string) => new Date(iso);
const DAY = 24 * 3_600_000;

/**
 * Lecteur et API sur une vraie base Dolt (sans bd) dont le schéma des dépendances a migré en cours d'histoire.
 * Dates, durées et dépendances attendues sont celles de `buildLegacyDatabase`.
 */
describe.skipIf(!hasBinary('dolt'))('lecteur Dolt sur une base dont le schéma a migré', () => {
  const client = createDoltClient();
  let base: string;
  let db: ReturnType<typeof client.open>;

  beforeAll(() => {
    base = realpathSync(mkdtempSync(join(tmpdir(), 'bdesk-legacy-')));
    buildLegacyDatabase(isolatedDoltEnv(), join(base, 'db'));
    db = client.open(join(base, 'db'));
  }, 60_000);

  it('lit l’état courant : préfixe, tickets, dépendances normalisées, étiquettes, commentaires', async () => {
    expect(await readIssuePrefix(db)).toBe('t');

    const issues = await readIssueSummaries(db);
    expect(issues.map((i) => [i.id, i.status, i.type, i.assignee])).toEqual([
      ['t-1', 'closed', 'task', 'tom'],
      ['t-2', 'closed', 'task', null],
      ['t-3', 'open', 'epic', null],
      ['t-4', 'open', 'bug', null],
    ]);
    expect(issues[0]).toMatchObject({ createdAt: at('2026-10-01T10:00:00Z'), closedAt: at('2026-10-03T10:00:00Z') });

    expect(await readIssue(db, 't-1')).toMatchObject({ title: 'Premier', closeReason: 'fait', description: '' });
    expect(await readIssue(db, 't-inconnu')).toBeNull();
    expect(await readIssue(db, "t-1' or '1'='1")).toBeNull();

    const dependencies = await readDependencies(db);
    expect(dependencies).toEqual(
      expect.arrayContaining([
        { from: 't-2', to: 't-3', type: 'parent-child' },
        { from: 't-3', to: 't-1', type: 'blocks' },
        { from: 't-3', to: 't-4', type: 'blocks' },
      ]),
    );
    expect(dependencies).toHaveLength(3);

    expect(await readLabels(db, 't-1')).toEqual(['backend']);
    expect(await readComments(db, 't-1')).toEqual([
      { author: 'tom', text: 'Terminé, merci', createdAt: at('2026-10-03T09:59:00Z') },
    ]);
  });

  it('reconstitue statuts et dépendances de tout l’historique, migration comprise', async () => {
    const histories = await readTicketHistories(db);
    const byId = new Map(histories.map((h) => [h.id, h]));

    expect(byId.get('t-1')?.statusSnapshots).toEqual([
      { status: 'open', at: at(day(1)) },
      { status: 'in_progress', at: at(day(2)) },
      { status: 'closed', at: at(day(3)) },
    ]);
    expect(byId.get('t-2')?.statusSnapshots.map((s) => s.status)).toEqual(['open', 'in_progress', 'closed']);
    expect(byId.get('t-3')?.type).toBe('epic');

    // Les dépendances d'avant la migration (cible dans depends_on_id) gardent leurs dates.
    expect(byId.get('t-2')?.dependencies).toEqual([
      { type: 'blocks', target: 't-1', addedAt: at(day(2)), removedAt: at(day(7)) },
      { type: 'parent-child', target: 't-3', addedAt: at(day(2)) },
    ]);
    expect(byId.get('t-3')?.dependencies).toEqual([
      { type: 'blocks', target: 't-2', addedAt: at(day(3)), removedAt: at(day(4)) },
      { type: 'blocks', target: 't-1', addedAt: at(day(6)) },
      { type: 'blocks', target: 't-4', addedAt: at(day(8)) },
    ]);
  });

  it('alimente analyzeFlow : Lead Time, Cycle Time et temps d’attente de dépendance', async () => {
    const flows = analyzeFlow(await readTicketHistories(db));

    expect(flows.get('t-1')).toMatchObject({ leadTime: 2 * DAY, cycleTime: 1 * DAY, outcome: { kind: 'delivered' } });
    // t-2 attend t-1 (ouvert jusqu'au 3 octobre) avant de démarrer le 6 : une journée d'attente de dépendance.
    expect(flows.get('t-2')).toMatchObject({ leadTime: 6 * DAY, cycleTime: 1 * DAY, dependencyWait: 1 * DAY, blockedTime: 0 });
    expect(flows.get('t-3')).toMatchObject({ outcome: { kind: 'open' }, leadTime: null });
    expect(flows.get('t-4')).toMatchObject({ outcome: { kind: 'open' }, leadTime: null });
  });
});

describe.skipIf(!hasBinary('dolt'))('Projets sur une vraie base Dolt', () => {
  let root: string;

  beforeAll(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'bdesk-projects-')));
    const source = join(root, 'source-db');
    buildLegacyDatabase(isolatedDoltEnv(), source);
    const metadata = (mode: string) => JSON.stringify({ database: 'dolt', backend: 'dolt', dolt_mode: mode, dolt_database: 'tdb' });
    for (const [name, mode, folder] of [
      ['projet-embedded', 'embedded', 'embeddeddolt'],
      ['projet-server', 'server', 'dolt'],
    ] as const) {
      mkdirSync(join(root, 'projets', name, '.beads', folder), { recursive: true });
      writeFileSync(join(root, 'projets', name, '.beads', 'metadata.json'), metadata(mode));
      cpSync(source, join(root, 'projets', name, '.beads', folder, 'tdb'), { recursive: true });
    }
  }, 60_000);

  const config = () => ({ roots: [join(root, 'projets')], projects: [], hiddenProjects: [] });

  it('découvre les Projets embedded et server avec le préfixe lu dans la base', async () => {
    const { projects, ignored } = await discoverProjects(config());

    expect(ignored).toEqual([]);
    expect(projects.map((p) => [p.id, p.mode, p.status, p.prefix])).toEqual([
      ['projet-embedded', 'embedded', 'ok', 't'],
      ['projet-server', 'server', 'ok', 't'],
    ]);
  });

  it('sert tickets et détail par l’API, avec blockedBy, parentId et textes', async () => {
    const app = buildServer({ config: config() });

    const projects = (await app.inject({ url: '/api/projects' })).json<{ projects: Record<string, unknown>[] }>();
    const issues = (await app.inject({ url: '/api/projects/projet-embedded/issues' })).json<{
      issues: { id: string; blockedBy: string[]; parentId: string | null }[];
    }>();
    const detail = (await app.inject({ url: '/api/projects/projet-server/issues/t-1' })).json<{ issue: IssueDetail }>();

    expect(projects.projects.map((p) => Object.keys(p).sort())).toEqual(
      Array(2).fill(['id', 'mode', 'name', 'path', 'prefix', 'status']),
    );
    // t-3 dépend de t-1 (fermé : ne bloque plus) et de t-4 (ouvert : bloque).
    expect(issues.issues.map((i) => [i.id, i.parentId, i.blockedBy])).toEqual([
      ['t-1', null, []],
      ['t-2', 't-3', []],
      ['t-3', null, ['t-4']],
      ['t-4', null, []],
    ]);
    expect(detail.issue).toMatchObject({
      id: 't-1',
      status: 'closed',
      closedAt: '2026-10-03T10:00:00.000Z',
      closeReason: 'fait',
      labels: ['backend'],
      dependents: [{ from: 't-3', type: 'blocks' }],
      comments: [{ author: 'tom', text: 'Terminé, merci', createdAt: '2026-10-03T09:59:00.000Z' }],
    });
  });

  it('renvoie les TicketHistory d’un Projet par le service', async () => {
    const histories = await createProjectService(config()).histories('projet-embedded');

    expect(histories.map((h) => h.id)).toEqual(['t-1', 't-2', 't-3', 't-4']);
  });

  it('répond 404 en JSON, sans SQL, à un identifiant de ticket qui contient un octet nul', async () => {
    const app = buildServer({ config: config() });

    const res = await app.inject({ url: '/api/projects/projet-embedded/issues/t-1%00x' });

    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.json()).toMatchObject({ statusCode: 404, error: 'Not Found' });
    expect(res.body).not.toMatch(/select|from issues|read only/i);
  });
});

/** Le garde-fou et la transaction en lecture seule, sur une vraie base Dolt jetable (jamais celle d'un vrai Projet). */
describe.skipIf(!hasBinary('dolt'))('lecture seule sur une vraie base Dolt', () => {
  let dir: string;
  let scratch: Scratch;
  let db: DoltDatabase;
  const count = () => Number(scratch.rows('select count(*) as c from t')[0]?.c);

  beforeAll(() => {
    dir = join(realpathSync(mkdtempSync(join(tmpdir(), 'bdesk-readonly-'))), 'db');
    scratch = createDatabase(isolatedDoltEnv(), dir);
    scratch.sql('create table t (a int primary key); insert into t values (1)');
    scratch.commit(1, 'init');
    db = createDoltClient().open(dir);
  }, 60_000);

  it('refuse WITH … DELETE, que Dolt exécute sinon', async () => {
    await expect(db.query('with x as (select 1) delete from t')).rejects.toThrow('lecture seule');

    expect(count()).toBe(1);
  });

  it('refuse une écriture cachée derrière un commentaire contenant une apostrophe', async () => {
    await expect(db.query("select 1 -- '\n; insert into t values (2) -- '")).rejects.toThrow('lecture seule');

    expect(count()).toBe(1);
  });

  it.each(['dumpfile', 'outfile'])('refuse SELECT … INTO %s : aucun fichier n’est écrit sur le disque', async (kind) => {
    const target = join(dir, `pwn-${kind}.txt`); // secure_file_priv de Dolt = dossier de la base

    await expect(db.query(`select 'pwn' into ${kind} '${target}'`)).rejects.toThrow('lecture seule');

    expect(existsSync(target)).toBe(false);
  });

  it('lit toujours : commentaires, WITH RECURSIVE, SHOW, DESCRIBE, EXPLAIN', async () => {
    expect(await db.query('select a from t -- un commentaire')).toEqual([{ a: 1 }]);
    expect(await db.query("select a /* l'apostrophe */ from t # et un autre")).toEqual([{ a: 1 }]);
    expect(
      await db.query('with recursive l (n) as (select 1 union all select n + 1 from l where n < 3) select n from l'),
    ).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
    expect(await db.query('show tables')).toHaveLength(1);
    expect((await db.query('describe t')).map((row) => row.Field)).toEqual(['a']);
    expect((await db.query('explain select * from t')).length).toBeGreaterThan(0);
    expect(count()).toBe(1);
  });

  it('s’appuie sur une transaction en lecture seule dans laquelle Dolt refuse lui-même les écritures de données', () => {
    // Seconde ligne de défense : ce que Dolt garantit pour ce qui passerait entre les mailles du garde-fou.
    for (const write of ['insert into t values (2)', 'update t set a = 5', 'delete from t', 'with x as (select 1) delete from t']) {
      expect(() => scratch.dolt('sql', '-q', `start transaction read only; ${write}`)).toThrow('READ ONLY transaction');
    }

    expect(count()).toBe(1);
  });

  it('signale une requête en échec par sa cause, sans la requête que Dolt cite avant elle', async () => {
    const error = await db.query('select colonne_inconnue\n  from t').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DoltQueryError);
    expect((error as Error).message).toContain('could not be found');
    expect((error as Error).message).not.toMatch(/select|from t/);
  });

  // Dolt cite l'instruction sans son `;` final (et sans ce qui le suit) : la requête citée n'est plus celle que l'on a envoyée.
  it.each([
    ['un point-virgule', 'select colonne_inconnue from t;'],
    ['un point-virgule précédé d’un blanc', 'select colonne_inconnue from t ;'],
    ['un point-virgule suivi d’un saut de ligne', 'select colonne_inconnue\n  from t;\n'],
    ['des points-virgules en série', 'select colonne_inconnue from t;;'],
    ['des points-virgules et des blancs en série', 'select colonne_inconnue from t ; ;  \n'],
  ])('signale par sa cause une requête terminée par %s, sans la requête que Dolt cite', async (_label, sql) => {
    const error = await db.query(sql).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DoltQueryError);
    expect((error as Error).message).toContain('could not be found');
    expect((error as Error).message).not.toMatch(/select|from t/);
  });

  // ADR 0001 : la lignée se lit par une CTE récursive, donc un Projet de plus de ~10 000 commits est illisible (503).
  it('plafonne les CTE récursives à 10 001 lignes, et l’échec au-delà dit pourquoi', async () => {
    const cte = (n: number) => `with recursive r (n) as (select 1 union all select n + 1 from r where n < ${n}) select count(*) as c from r`;

    expect(await db.query(cte(10_001))).toEqual([{ c: 10_001 }]);
    const error = await db.query(cte(10_002)).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DoltQueryError);
    expect((error as Error).message).toContain('iteration limit exceeded');
    expect((error as Error).message).not.toContain('select');
  });
});

const ISSUES_AND_DEPENDENCIES = `
  create table issues (id varchar(64) primary key, status varchar(32), issue_type varchar(32));
  create table dependencies (issue_id varchar(64), depends_on_issue_id varchar(64), type varchar(32), primary key (issue_id, depends_on_issue_id));`;

/** Historiques tordus, sur de vraies bases Dolt jetables : fusion de branches, horloge qui recule, ticket recréé. */
describe.skipIf(!hasBinary('dolt'))('historique d’une base Dolt aux commits tordus', () => {
  const env = isolatedDoltEnv();
  const client = createDoltClient();
  const newDatabase = () => {
    const dir = join(realpathSync(mkdtempSync(join(tmpdir(), 'bdesk-history-'))), 'db');
    return { dir, ...createDatabase(env, dir) };
  };
  const dateOf = (date: unknown) => new Date(`${String(date).replace(' ', 'T')}Z`);

  it('fusion de branches : suit la lignée du premier parent, sans Transitions fantômes ni dépendance retirée à tort', async () => {
    const db = newDatabase();
    db.sql(`${ISSUES_AND_DEPENDENCIES} insert into issues values ('t-1','open','task'), ('t-2','open','task')`);
    db.commit(1, 'create');
    // Trois paires de commits parallèles : à hauteur égale dans le graphe, Dolt leur donne le même commit_order.
    db.dolt('checkout', '-b', 'feat');
    db.sql(`update issues set status = 'in_progress' where id = 't-1'`);
    db.commit(2, 'feat: t-1 démarre');
    db.sql(`insert into dependencies values ('t-1','t-2','blocks')`);
    db.commit(3, 'feat: t-1 dépend de t-2');
    db.sql(`update issues set status = 'closed' where id = 't-1'`);
    db.commit(4, 'feat: t-1 fermé');
    db.dolt('checkout', 'main');
    for (const [n, id] of [[5, 't-3'], [6, 't-4'], [7, 't-5']] as const) {
      db.sql(`insert into issues values ('${id}','open','task')`);
      db.commit(n, `main: ${id} créé`);
    }
    db.dolt('merge', '--no-ff', '-m', 'merge', 'feat');
    expect(db.rows('select commit_order from dolt_log group by commit_order having count(*) > 1').length).toBeGreaterThanOrEqual(3);
    const mergedAt = dateOf(db.rows("select date from dolt_log where message = 'merge'")[0]?.date);

    const histories = await readTicketHistories(client.open(db.dir));
    const byId = new Map(histories.map((h) => [h.id, h]));

    // La lignée de main est c1 → m1 → m2 → m3 → merge : t-1 passe d'ouvert à fermé à la fusion, sans passages fantômes.
    expect(byId.get('t-1')?.statusSnapshots).toEqual([
      { status: 'open', at: at(day(1)) },
      { status: 'closed', at: mergedAt },
    ]);
    // La dépendance arrive avec la fusion et n'est jamais retirée.
    expect(byId.get('t-1')?.dependencies).toEqual([{ type: 'blocks', target: 't-2', addedAt: mergedAt }]);
    expect(byId.get('t-3')?.statusSnapshots).toEqual([{ status: 'open', at: at(day(5)) }]);
    expect(await readTicketHistories(client.open(db.dir))).toEqual(histories);
  }, 60_000);

  it('horloge qui recule : retrouve les dépendances d’avant une migration sans perdre le moindre commit', async () => {
    const db = newDatabase();
    db.sql(`
      create table issues (id varchar(64) primary key, status varchar(32), issue_type varchar(32));
      create table dependencies (issue_id varchar(64), depends_on_id varchar(64), type varchar(32), primary key (issue_id, depends_on_id));
      insert into issues values ('t-1','open','task'), ('t-2','open','task'), ('t-3','open','task');
      insert into dependencies values ('t-1','t-2','blocks')`);
    db.commit(5, 'c1 : dépendance ajoutée, horloge en avance');
    db.sql(`update issues set status = 'in_progress' where id = 't-3'`);
    db.commit(3, 'c2 : l’horloge est revenue en arrière');
    db.sql(`
      alter table dependencies add column depends_on_issue_id varchar(64);
      update dependencies set depends_on_issue_id = depends_on_id;
      alter table dependencies drop primary key;
      alter table dependencies drop column depends_on_id;
      alter table dependencies add primary key (issue_id, depends_on_issue_id)`);
    db.commit(6, 'c3 : migration du schéma');

    const histories = await readTicketHistories(client.open(db.dir));

    // La dépendance n'a jamais été retirée : une seule durée de vie, du premier commit jusqu'à aujourd'hui.
    expect(histories.find((h) => h.id === 't-1')?.dependencies).toEqual([{ type: 'blocks', target: 't-2', addedAt: at(day(5)) }]);
    for (const { dependencies } of histories) {
      for (const { addedAt, removedAt } of dependencies) {
        expect(removedAt === undefined || removedAt.getTime() >= addedAt.getTime()).toBe(true);
      }
    }
  }, 60_000);

  it('ticket supprimé puis recréé : repart de zéro à la recréation, sans hériter de sa vie précédente', async () => {
    const db = newDatabase();
    db.sql(`${ISSUES_AND_DEPENDENCIES} insert into issues values ('t-1','open','task'), ('t-2','open','task'), ('t-3','open','task')`);
    db.commit(1, 'create');
    db.sql(`update issues set status = 'in_progress' where id = 't-2'`);
    db.commit(2, 'start t-2');
    db.sql(`delete from issues where id in ('t-1', 't-2')`);
    db.commit(3, 'delete t-1 et t-2');
    db.sql(`update issues set status = 'closed' where id = 't-3'`);
    db.commit(4, 'close t-3');
    db.sql(`insert into issues values ('t-1','open','task'), ('t-2','open','task')`);
    db.commit(5, 'recreate t-1 et t-2');
    db.sql(`update issues set status = 'in_progress' where id = 't-2'`);
    db.commit(6, 'start t-2 again');

    const byId = new Map((await readTicketHistories(client.open(db.dir))).map((h) => [h.id, h]));

    // t-1 avait le même statut avant et après le trou : sa recréation compte quand même, datée du 5.
    expect(byId.get('t-1')?.statusSnapshots).toEqual([{ status: 'open', at: at(day(5)) }]);
    // t-2 : la vie précédente (ouverte puis en cours) est oubliée.
    expect(byId.get('t-2')?.statusSnapshots).toEqual([
      { status: 'open', at: at(day(5)) },
      { status: 'in_progress', at: at(day(6)) },
    ]);
    // t-3 n'a pas de trou : son historique est intact.
    expect(byId.get('t-3')?.statusSnapshots).toEqual([
      { status: 'open', at: at(day(1)) },
      { status: 'closed', at: at(day(4)) },
    ]);
  }, 60_000);

  it('ticket supprimé puis recréé : les dépendances de sa vie précédente ne subsistent pas, seules celles observées depuis la recréation restent', async () => {
    const db = newDatabase();
    db.sql(`${ISSUES_AND_DEPENDENCIES} insert into issues values ('t-1','open','task'), ('t-2','open','task'), ('t-3','open','task'), ('t-4','open','task')`);
    db.commit(1, 'create');
    db.sql(`insert into dependencies values ('t-1','t-2','blocks'), ('t-3','t-2','blocks'), ('t-4','t-2','blocks')`);
    db.commit(2, 't-1, t-3 et t-4 dépendent de t-2');
    // Supprimer un ticket supprime ses dépendances (t-1) ; la base d'essai n'a pas de clé étrangère : celle de t-4 reste, orpheline.
    db.sql(`delete from dependencies where issue_id = 't-1'; delete from issues where id in ('t-1', 't-4')`);
    db.commit(3, 'delete t-1 et t-4');
    db.sql(`insert into issues values ('t-1','open','task'), ('t-4','open','task'); insert into dependencies values ('t-1','t-3','blocks')`);
    db.commit(4, 'recreate t-1 (avec une dépendance) et t-4');
    db.sql(`insert into dependencies values ('t-1','t-2','blocks')`);
    db.commit(5, 't-1 dépend de nouveau de t-2');

    const byId = new Map((await readTicketHistories(client.open(db.dir))).map((h) => [h.id, h]));

    // t-1 : la dépendance vers t-2 de sa vie précédente (du 2 au 3) est oubliée ; celle posée à la recréation et celle
    // rétablie ensuite (même cible qu'avant : une durée de vie, pas deux) restent.
    expect(byId.get('t-1')?.dependencies).toEqual([
      { type: 'blocks', target: 't-3', addedAt: at(day(4)) },
      { type: 'blocks', target: 't-2', addedAt: at(day(5)) },
    ]);
    // t-4 : sa dépendance a survécu à son absence, mais n'est observée comme sienne que depuis la recréation.
    expect(byId.get('t-4')?.dependencies).toEqual([{ type: 'blocks', target: 't-2', addedAt: at(day(4)) }]);
    // t-3 n'a pas de trou : sa dépendance garde sa date.
    expect(byId.get('t-3')?.dependencies).toEqual([{ type: 'blocks', target: 't-2', addedAt: at(day(2)) }]);
    expect(byId.get('t-2')?.dependencies).toEqual([]);
  }, 60_000);
});
