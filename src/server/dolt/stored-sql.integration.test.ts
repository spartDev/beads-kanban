import { mkdirSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { createProjectService, ProjectUnreadableError, type ProjectService } from '../projects/service';
import { createDatabase, dolt, hasBinary, isolatedDoltEnv, type Scratch } from '../testing/dolt-fixture';
import { scratchDir } from '../testing/scratch';
import { createDoltClient } from './client';
import { readIssueBase } from './reader';
import { READ_ONLY_PREFIX } from './read-only';

/**
 * Le garde de lecture seule ne lit que le texte de la requête (bdesk-38k.56, 38k.63). Mais une base peut porter du SQL, que Dolt exécute quand l'app lit : une
 * vue (`create view issues as select … load_file('<base>/…')`), une colonne générée (`title varchar(500) generated always as (load_file(…)) virtual`). Le contenu
 * d'une base beads vient d'un remote partagé : un collaborateur peut y commiter l'un ou l'autre, et la lecture ordinaire de l'app (`select id, title from issues
 * as of 'HEAD'`) rend alors le contenu d'un fichier de la machine, ou, par une vue sur `dolt_query_diff('select … into outfile …')`, crée un fichier à la
 * lecture (bdesk-38k.69, N1 de la relecture finale de .63). Ici sur de vraies bases Dolt, avec un fichier témoin inoffensif dans le dossier de la base (le
 * `secure_file_priv` de `dolt sql`), et par le service des Projets tel que l'app le construit, client par défaut compris :
 *
 *   ok-beads                 les vues que bd crée lui-même (`ready_issues`, `blocked_issues`), des valeurs par défaut : rien à signaler
 *   view-issues-committed    `issues` est une vue commitée qui lit le témoin
 *   view-issues-working      la même, dans le working set seulement (HEAD a la table : Dolt exécute quand même la vue du working set)
 *   view-labels-outfile      `labels` est une vue sur `dolt_query_diff('… into outfile …')` : la lire crée un fichier
 *   view-config              `config` est une vue : le scan des Projets la lit (le préfixe)
 *   view-dolt-log            une vue nommée `dolt_log` masque la table système que l'historique lit
 *   view-dolt-status         une vue nommée `dolt_status` : la vérification lit cette table système, et la vue la masquerait (elle n'est pas lue : l'assertion des vues passe d'abord)
 *   view-dolt-schemas        de même pour `dolt_schemas`, dont la vérification lit la version de HEAD
 *   view-fold-s, view-fold-i  la vue de `issues` s'écrit `issueſ` (U+017F, « s long ») ou `İssues` (U+0130) : Dolt la lit comme `issues` (il replie la casse à l'unicode)
 *   case-clean, case-dirty   la table s'écrit `Issues` : HEAD a la colonne générée ; le working set l'a retirée sans commit (case-dirty), ou rien n'a changé (case-clean)
 *   dirty-other              un working set modifié sans commit dans une table que l'app ne lit pas : aucune fausse alerte
 *   virtual-title            `issues.title` est une colonne générée virtuelle qui lit le témoin
 *   virtual-deps             `dependencies.type` aussi (l'app y lit `select *`)
 *   virtual-config           `config.value` aussi
 *   era-shadow               une vue `dolt_history_dependencies` dans le commit d'ancre d'une époque du schéma (la base `<base>/<commit>` qu'`readTicketHistories` relit)
 *   era-fold-s, era-fold-i   l'ancre porte une vue `dolt_history_dependencieſ` ou `dolt_hİstory_dependencies` : Dolt la lit comme `dolt_history_dependencies`
 *   era-schemas              l'ancre porte une vue `dolt_schemas` : lire la table `dolt_schemas` de la base de révision l'exécuterait ; l'époque est refusée sans la lire
 *   era-unknown              l'ancre porte une vue qui n'est pas de bd : refusée aussi (seules `ready_issues` et `blocked_issues` sont admises dans une base de révision)
 *   era-clean                la même histoire, sans la vue : l'époque est relue, sans fausse alerte
 *   head-hostile-dirty       HEAD a une colonne générée, le working set l'a retirée sans commit : c'est HEAD que l'app lit
 *   dirty-ok                 un working set modifié sans commit, sans rien de stocké : aucune fausse alerte
 *   later                    sain, lu, puis une vue arrive par un commit : la lecture suivante la refuse
 */
const CANARY = 'CANARY-SQL-STOCKE';

const SCHEMA = `
  create table issues (
    id varchar(255) primary key, title varchar(500) not null, description text not null, design text not null,
    acceptance_criteria text not null, notes text not null, status varchar(32) not null default 'open',
    priority int not null default 2, issue_type varchar(32) not null default 'task', assignee varchar(255),
    created_at datetime not null default current_timestamp, updated_at datetime not null default current_timestamp, closed_at datetime, close_reason text not null);
  create table dependencies (
    id char(36) primary key, issue_id varchar(255) not null, depends_on_issue_id varchar(255) not null,
    type varchar(32) not null default 'blocks', created_at datetime not null default current_timestamp, created_by varchar(255) not null);
  create table labels (issue_id varchar(255) not null, label varchar(255) not null, primary key (issue_id, label));
  create table comments (id char(36) primary key, issue_id varchar(255) not null, author varchar(255) not null,
    text text not null, created_at datetime not null default current_timestamp);
  create table config (\`key\` varchar(255) primary key, value text not null);`;

/** Ce que bd crée de lui-même dans ses bases (relevé sur des copies de bases réelles) : deux vues, qui ne sont jamais lues par l'app. */
const BEADS_VIEWS = `
  create view ready_issues as select id, title from issues where status = 'open';
  create view blocked_issues as select i.id, i.title from issues i join dependencies d on d.issue_id = i.id where i.status <> 'closed'`;

const ROWS = `
  insert into config values ('issue_prefix', 'a');
  insert into issues (id, title, description, design, acceptance_criteria, notes, close_reason) values
    ('a-1', 'Premier', '', '', '', '', ''), ('a-2', 'Second', '', '', '', '', '');
  insert into dependencies (id, issue_id, depends_on_issue_id, created_by) values (uuid(), 'a-2', 'a-1', 'tom');
  insert into labels values ('a-1', 'backend');
  insert into comments (id, issue_id, author, text) values (uuid(), 'a-1', 'tom', 'Un commentaire')`;

/** Une vue `issues` qui a toutes les colonnes que l'app lit, et la valeur de `title` donnée. */
const issuesView = (title: string, name = 'issues') =>
  `create view \`${name}\` as select 'a-1' as id, ${title} as title, '' as description, '' as design, '' as acceptance_criteria, '' as notes, 'open' as status,
     2 as priority, 'task' as issue_type, cast(null as char) as assignee, cast('2026-10-01 10:00:00' as datetime) as created_at,
     cast('2026-10-01 10:00:00' as datetime) as updated_at, cast(null as datetime) as closed_at, '' as close_reason`;

/** Une table `issues` dont `title` est une colonne générée virtuelle qui lit le témoin. */
const virtualIssues = (db: string) =>
  `create table issues (
     id varchar(255) primary key, title varchar(500) generated always as (load_file('${db}/canary.txt')) virtual, description text, design text,
     acceptance_criteria text, notes text, status varchar(32) default 'open', priority int default 2, issue_type varchar(32) default 'task',
     assignee varchar(255), created_at datetime, updated_at datetime, closed_at datetime, close_reason text);
   insert into issues (id, description, design, acceptance_criteria, notes, created_at, updated_at, close_reason)
     values ('a-1', '', '', '', '', '2026-10-01 10:00:00', '2026-10-01 10:00:00', '')`;

/** Une vue sur la fonction de table qui exécute le SQL de ses arguments : la lire écrit `<base>/<file>`. */
const outfile = (db: string, file: string) => `dolt_query_diff('select ''x'' as v into outfile ''${db}/${file}''', 'select 1 as v')`;

describe.skipIf(!hasBinary('dolt'))('une base qui porte du SQL (vue, colonne générée) n’est pas lue par l’app (bdesk-38k.69)', { timeout: 120_000 }, () => {
  let env: NodeJS.ProcessEnv;
  let root: string;
  let projects: ProjectService;
  const scratches = new Map<string, Scratch>();
  /** Ce que Dolt fait des mêmes lectures sans que rien ne les arrête : lancées directement, hors de l'app. */
  const premise = new Map<string, { csv: string; files: string[] }>();

  const dbOf = (name: string) => join(root, name, '.beads', 'embeddeddolt', 'tdb');
  const outFiles = (name: string) => readdirSync(dbOf(name)).filter((file) => file.startsWith('out-'));
  /** Une lecture lancée directement par `dolt sql`, sans le garde ni la vérification : le fait que l'app doit arrêter. */
  const direct = (name: string, sql: string): string => dolt(env, dbOf(name), 'sql', '-r', 'csv', '-q', READ_ONLY_PREFIX + sql);

  /** Le Projet `name` : le schéma de bd, ses deux vues, des tickets, un fichier témoin dans le dossier de la base, puis `hazard`. */
  async function build(name: string, hazard: (scratch: Scratch, db: string) => void = () => undefined): Promise<Scratch> {
    const beads = join(root, name, '.beads');
    mkdirSync(beads, { recursive: true });
    writeFileSync(join(beads, 'metadata.json'), JSON.stringify({ backend: 'dolt', database: 'dolt', dolt_mode: 'embedded', dolt_database: 'tdb' }));
    const db = dbOf(name);
    const scratch = createDatabase(env, db);
    writeFileSync(join(db, 'canary.txt'), `${CANARY}\n`);
    scratch.sql(`${SCHEMA}; ${ROWS}; ${BEADS_VIEWS}`);
    scratch.commit(1, 'base');
    hazard(scratch, db);
    scratches.set(name, scratch);
    // Chaque Projet se bâtit par une dizaine de commandes `dolt` synchrones : rendre la main entre deux laisse le processus de vitest répondre à son parent (sous charge, sans cela,
    // ses messages de suivi expirent : « Timeout calling onTaskUpdate »).
    await new Promise((resolve) => setImmediate(resolve));
    return scratch;
  }

  /** La lecture, rejetée en Projet illisible, dont la raison dit ce que la base porte. */
  const unreadable = async (read: Promise<unknown>): Promise<ProjectUnreadableError> => {
    const error = await read.then(
      () => undefined,
      (err: unknown) => err,
    );
    expect(error).toBeInstanceOf(ProjectUnreadableError);
    expect(JSON.stringify(error, Object.getOwnPropertyNames(error))).not.toContain(CANARY);
    return error as ProjectUnreadableError;
  };

  beforeAll(async () => {
    env = isolatedDoltEnv();
    root = realpathSync(scratchDir('bdesk-stored-sql-'));

    await build('ok-beads');
    await build('view-issues-committed', (s, db) => {
      s.sql(`drop table issues; ${issuesView(`load_file('${db}/canary.txt')`)}`);
      s.commit(2, 'vue issues');
    });
    await build('view-issues-working', (s, db) => {
      s.sql(`drop table issues; ${issuesView(`load_file('${db}/canary.txt')`)}`);
    });
    await build('view-labels-outfile', (s, db) => {
      s.sql(`drop table labels; create view labels as select 'a-1' as issue_id, diff_type as label from ${outfile(db, 'out-labels.txt')}`);
      s.commit(2, 'vue labels');
    });
    await build('view-config', (s, db) => {
      s.sql(`drop table config; create view config as select 'issue_prefix' as \`key\`, load_file('${db}/canary.txt') as value`);
      s.commit(2, 'vue config');
    });
    await build('view-dolt-log', (s, db) => {
      s.sql(`create view dolt_log as select 'x' as commit_hash, cast('2026-10-01 10:00:00' as datetime) as date from ${outfile(db, 'out-log.txt')}`);
      s.commit(2, 'vue dolt_log');
    });
    await build('view-dolt-status', (s, db) => {
      s.sql(`create view dolt_status as select 'issues' as table_name, 0 as staged, 'modified' as status from ${outfile(db, 'out-status.txt')}`);
      s.commit(2, 'vue dolt_status');
    });
    await build('view-dolt-schemas', (s, db) => {
      s.sql(`create view dolt_schemas as select 'view' as type, 'x' as name from ${outfile(db, 'out-schemas.txt')}`);
      s.commit(2, 'vue dolt_schemas');
    });
    await build('view-fold-s', (s, db) => {
      s.sql(`drop table issues; ${issuesView(`load_file('${db}/canary.txt')`, 'issueſ')}`);
      s.commit(2, 'vue issueſ');
    });
    await build('view-fold-i', (s, db) => {
      s.sql(`drop table issues; ${issuesView(`load_file('${db}/canary.txt')`, 'İssues')}`);
      s.commit(2, 'vue İssues');
    });
    // HEAD a `Issues` (renommée : `rename table issues to tmpx; rename table tmpx to Issues`) avec une colonne générée ; `dolt_status` la nomme `Issues`.
    const capitalized = (db: string) => `rename table issues to tmpx; rename table tmpx to Issues; alter table Issues drop column title;
      alter table Issues add column title varchar(500) generated always as (load_file('${db}/canary.txt')) virtual`;
    await build('case-clean', (s, db) => {
      s.sql(capitalized(db));
      s.commit(2, 'Issues, colonne générée');
    });
    await build('case-dirty', (s, db) => {
      s.sql(capitalized(db));
      s.commit(2, 'Issues, colonne générée');
      s.sql(`alter table Issues drop column title; alter table Issues add column title varchar(500) not null default 'x'`); // le working set l'a retirée, sans commit
    });
    await build('dirty-other', (s) => {
      s.sql('create table wisps (id varchar(10) primary key)');
      s.commit(2, 'une table que l’app ne lit pas');
      s.sql("insert into wisps values ('w-1')");
    });
    await build('virtual-title', (s, db) => {
      s.sql(`drop table issues; ${virtualIssues(db)}`);
      s.commit(2, 'colonne virtuelle');
    });
    await build('virtual-deps', (s, db) => {
      s.sql(`drop table dependencies;
        create table dependencies (id char(36) primary key, issue_id varchar(255), depends_on_issue_id varchar(255),
          type varchar(32) generated always as (load_file('${db}/canary.txt')) virtual, created_at datetime, created_by varchar(255));
        insert into dependencies (id, issue_id, depends_on_issue_id, created_at, created_by) values (uuid(), 'a-2', 'a-1', '2026-10-01 10:00:00', 'tom')`);
      s.commit(2, 'colonne virtuelle');
    });
    await build('virtual-config', (s, db) => {
      s.sql(`drop table config;
        create table config (\`key\` varchar(255) primary key, value text generated always as (load_file('${db}/canary.txt')) virtual);
        insert into config (\`key\`) values ('issue_prefix')`);
      s.commit(2, 'colonne virtuelle');
    });
    await build('head-hostile-dirty', (s, db) => {
      s.sql(`drop table issues; ${virtualIssues(db)}`);
      s.commit(2, 'colonne virtuelle');
      s.sql(`alter table issues drop column title; alter table issues add column title varchar(500) default 'sain'`); // le working set l'a retirée, sans commit
    });
    await build('dirty-ok', (s) => {
      s.sql(`update issues set title = 'Modifié sans commit' where id = 'a-1'; insert into issues (id, title, description, design, acceptance_criteria, notes, close_reason) values ('a-3', 'Nouveau', '', '', '', '', '')`);
    });
    await build('later');

    // L'époque : `dependencies` a d'abord une colonne `depends_on_id`, puis `depends_on_issue_id` (comme bd, à une montée de version) ; le commit d'ancre
    // (le dernier d'avant la migration) porte, ou non, une vue `dolt_history_dependencies`, retirée ensuite : HEAD n'en a plus, la base de révision de l'ancre l'a.
    const era = (shadow: 'history' | 'schemas' | 'fold-s' | 'fold-i' | 'unknown' | undefined) => (s: Scratch, db: string) => {
      /** Le nom de la vue de l'ancre, et le fichier que sa lecture crée. */
      const shadowView = (name: string, file: string) =>
        `create view \`${name}\` as select 'x' as commit_hash, 'a-1' as issue_id, 'a-2' as depends_on_id, 'blocks' as type, cast(null as datetime) as created_at from ${outfile(db, file)}`;
      s.sql(`drop table dependencies;
        create table dependencies (issue_id varchar(255) not null, depends_on_id varchar(255) not null, type varchar(32) not null default 'blocks',
          created_at datetime not null default current_timestamp, created_by varchar(255) not null, primary key (issue_id, depends_on_id));
        insert into dependencies (issue_id, depends_on_id, created_by) values ('a-2', 'a-1', 'tom')`);
      s.commit(2, 'ancien schéma');
      const ANCHOR_VIEWS = { history: 'dolt_history_dependencies', 'fold-s': 'dolt_history_dependencieſ', 'fold-i': 'dolt_hİstory_dependencies', schemas: 'dolt_schemas', unknown: 'rapport_perso' } as const;
      const view = shadow === undefined ? undefined : ANCHOR_VIEWS[shadow];
      const FILES = { history: 'out-era.txt', 'fold-s': 'out-era-s.txt', 'fold-i': 'out-era-i.txt', schemas: 'out-era-schemas.txt', unknown: 'out-era-unknown.txt' } as const;
      if (view !== undefined && shadow !== undefined) s.sql(shadow === 'schemas' ? `create view dolt_schemas as select 'view' as type, 'x' as name from ${outfile(db, FILES.schemas)}` : shadowView(view, FILES[shadow]));
      s.commit(3, 'ancre');
      if (view !== undefined) s.sql(`drop view \`${view}\``);
      s.sql(`alter table dependencies add column depends_on_issue_id varchar(255);
        update dependencies set depends_on_issue_id = depends_on_id;
        alter table dependencies drop primary key;
        alter table dependencies drop column depends_on_id;
        alter table dependencies add column id char(36);
        update dependencies set id = uuid();
        alter table dependencies add primary key (id)`);
      s.commit(4, 'migration');
    };
    await build('era-shadow', era('history'));
    await build('era-schemas', era('schemas'));
    await build('era-fold-s', era('fold-s'));
    await build('era-fold-i', era('fold-i'));
    await build('era-unknown', era('unknown'));
    await build('era-clean', era(undefined));

    /** La base de révision de l'ancre d'époque (le commit d'avant la migration, HEAD~1), citée comme identifiant. */
    const anchorOf = (name: string) => `\`tdb/${dolt(env, dbOf(name), 'sql', '-r', 'csv', '-q', "select hashof('HEAD~1') as h").split('\n')[1]}\``;

    // Ce que Dolt fait de ces lectures quand rien ne les arrête, avant que l'app ne les fasse : les faits que la vérification doit empêcher.
    const reads: [string, string][] = [
      ['view-issues-committed', "select id, title from issues as of 'HEAD'"],
      ['view-issues-working', "select id, title from issues as of 'HEAD'"],
      ['view-labels-outfile', "select label from labels as of 'HEAD'"],
      ['view-config', "select `value` from config where `key` = 'issue_prefix'"],
      ['view-dolt-log', 'select commit_hash from dolt_log'],
      ['view-dolt-status', 'select table_name from dolt_status'],
      ['view-dolt-schemas', "select name from dolt_schemas as of 'HEAD'"],
      ['view-fold-s', "select id, title from issues as of 'HEAD'"],
      ['view-fold-i', "select id, title from issues as of 'HEAD'"],
      ['case-clean', "select id, title from issues as of 'HEAD'"],
      ['case-dirty', "select id, title from issues as of 'HEAD'"],
      ['virtual-title', "select id, title from issues as of 'HEAD'"],
      ['virtual-deps', "select * from dependencies as of 'HEAD'"],
      ['virtual-config', "select `value` from config where `key` = 'issue_prefix'"],
      ['head-hostile-dirty', "select id, title from issues as of 'HEAD'"],
      ['era-shadow', `select commit_hash, type from ${anchorOf('era-shadow')}.dolt_history_dependencies`],
      ['era-schemas', `select name from ${anchorOf('era-schemas')}.dolt_schemas`],
      ['era-fold-s', `select commit_hash, type from ${anchorOf('era-fold-s')}.dolt_history_dependencies`],
      ['era-fold-i', `select commit_hash, type from ${anchorOf('era-fold-i')}.dolt_history_dependencies`],
    ];
    for (const [name, sql] of reads) {
      await new Promise((resolve) => setImmediate(resolve));
      const before = new Set(outFiles(name));
      const csv = direct(name, sql);
      const files = outFiles(name).filter((file) => !before.has(file));
      premise.set(name, { csv, files });
      for (const file of files) rmSync(join(dbOf(name), file));
    }
    projects = createProjectService({ roots: [root], projects: [], hiddenProjects: [] }, { rescanIntervalMs: 0 });
  }, 600_000);

  describe('les faits : sans rien qui l’arrête, Dolt exécute le SQL de la base à la lecture', () => {
    it.each(['view-issues-committed', 'view-issues-working', 'view-fold-s', 'view-fold-i', 'case-clean', 'case-dirty', 'virtual-title', 'head-hostile-dirty'])('%s : le contenu du témoin est dans la réponse', (name) => {
      expect(premise.get(name)?.csv).toContain(CANARY);
    });

    it.each(['virtual-deps', 'virtual-config', 'view-config'])('%s : la lecture ordinaire de l’app rend le contenu du témoin', (name) => {
      expect(premise.get(name)?.csv).toContain(CANARY);
    });

    it.each([
      ['view-labels-outfile', 'out-labels.txt'],
      ['view-dolt-log', 'out-log.txt'],
      ['view-dolt-status', 'out-status.txt'],
      ['view-dolt-schemas', 'out-schemas.txt'],
      ['era-shadow', 'out-era.txt'],
      ['era-schemas', 'out-era-schemas.txt'],
      ['era-fold-s', 'out-era-s.txt'],
      ['era-fold-i', 'out-era-i.txt'],
    ])('%s : la lecture crée le fichier %s (une vue masque aussi les tables système que la vérification lit)', (name, file) => {
      expect(premise.get(name)?.files).toContain(file);
    });

    it('le client de l’app, sans la vérification, rend le contenu du témoin comme titre d’un ticket', async () => {
      const unchecked = createDoltClient({ retries: 0 });

      const { summaries } = await readIssueBase(unchecked.open(dbOf('view-issues-committed')));

      expect(summaries.map((issue) => issue.title)).toEqual([`${CANARY}\n`]);
    });
  });

  describe('le service des Projets, tel que l’app le construit, refuse de les lire', () => {
    it('une vue `issues` commitée : le tableau est refusé, et la raison dit quelle table', async () => {
      const error = await unreadable(projects.issues('view-issues-committed'));

      expect(error.reason).toMatch(/SQL stocké/);
      expect(error.reason).toContain('« issues »');
    });

    it('la vue du working set l’est aussi, bien que HEAD ait la table (c’est la vue que Dolt exécute)', async () => {
      const error = await unreadable(projects.issues('view-issues-working'));

      expect(error.reason).toMatch(/SQL stocké/);
      expect(error.reason).toContain('« issues »');
    });

    it('une vue `labels` sur dolt_query_diff : la fiche d’un ticket est refusée, et aucun fichier n’est créé', async () => {
      const error = await unreadable(projects.issue('view-labels-outfile', 'a-1'));

      expect(error.reason).toContain('« labels »');
      expect(outFiles('view-labels-outfile')).toEqual([]);
    });

    it('une vue `config` : le scan des Projets le dit illisible au lieu de prendre le texte du fichier pour le préfixe', async () => {
      const { projects: list } = await projects.list();

      const project = list.find((p) => p.id === 'view-config');
      expect(project?.status).toBe('unreadable');
      expect(project?.reason).toContain('« config »');
      expect(JSON.stringify(list)).not.toContain(CANARY);
    });

    it('une vue `dolt_log` masque la table système de l’historique : l’historique est refusé, et aucun fichier n’est créé', async () => {
      const error = await unreadable(projects.histories('view-dolt-log'));

      expect(error.reason).toContain('« dolt_log »');
      expect(outFiles('view-dolt-log')).toEqual([]);
    });

    it.each([
      ['view-dolt-status', 'dolt_status'],
      ['view-dolt-schemas', 'dolt_schemas'],
    ])('%s : la vue qui masquerait une table que la vérification lit est refusée avant que celle-ci ne la lise, et aucun fichier n’est créé', async (name, view) => {
      const error = await unreadable(projects.issues(name));

      expect(error.reason).toContain(`« ${view} »`);
      expect(outFiles(name)).toEqual([]);
    });

    it.each([
      ['virtual-title', 'issues', 'title'],
      ['virtual-deps', 'dependencies', 'type'],
    ])('%s : la colonne générée « %s.%s » refuse le tableau', async (name, table, column) => {
      const error = await unreadable(projects.issues(name));

      expect(error.reason).toMatch(/colonne générée/);
      expect(error.reason).toContain(`« ${table} »`);
      expect(error.reason).toContain(`« ${column} »`);
    });

    it('une colonne générée de `config` : le scan dit le Projet illisible', async () => {
      const { projects: list } = await projects.list();

      const project = list.find((p) => p.id === 'virtual-config');
      expect(project?.status).toBe('unreadable');
      expect(project?.reason).toContain('« config »');
      expect(JSON.stringify(list)).not.toContain(CANARY);
    });

    it('la colonne générée est celle de HEAD, que le working set ait retiré la sienne ou non', async () => {
      const error = await unreadable(projects.issues('head-hostile-dirty'));

      expect(error.reason).toMatch(/colonne générée/);
      expect(error.reason).toContain('« issues »');
    });

    it.each(['view-fold-s', 'view-fold-i'])('%s : la vue que Dolt lit comme `issues` sans que le nom soit le même (repli de casse unicode) est refusée, sans fichier', async (name) => {
      const error = await unreadable(projects.issues(name));

      expect(error.reason).toMatch(/SQL stocké/);
      expect(error.reason).toMatch(/est une vue/);
    });

    it.each(['case-clean', 'case-dirty'])('%s : `Issues` est lue comme `issues` : sa colonne générée est refusée, que le working set l\'ait retirée sans commit ou non', async (name) => {
      const error = await unreadable(projects.issues(name));

      expect(error.reason).toMatch(/colonne générée « title »/);
      expect(error.reason).toMatch(/« issues »/i); // la table de l'app (case-dirty), ou celle de Dolt, `Issues` (case-clean)
    });

    it.each([
      ['era-fold-s', 'out-era-s.txt'],
      ['era-fold-i', 'out-era-i.txt'],
    ])('%s : la vue de l\'ancre que Dolt lit comme `dolt_history_dependencies` (repli de casse unicode) est refusée, et %s n\'est pas créé', async (name, file) => {
      const error = await unreadable(projects.histories(name));

      expect(error.reason).toMatch(/est une vue/);
      expect(outFiles(name)).not.toContain(file);
      expect(outFiles(name)).toEqual([]);
    });

    it('une vue dans le commit d’ancre d’une époque du schéma : l’historique est refusé, et aucun fichier n’est créé', async () => {
      const error = await unreadable(projects.histories('era-shadow'));

      expect(error.reason).toContain('« dolt_history_dependencies »');
      expect(outFiles('era-shadow')).toEqual([]);
    });

    it('le refus d’une époque dit laquelle, lisiblement : le commit de l’ancre, non le nom de la base de révision', async () => {
      const error = await unreadable(projects.histories('era-shadow'));

      expect(error.reason).toMatch(/époque du commit [0-9a-v]{8}\b/);
      expect(error.reason).not.toContain('tdb/');
      expect(error.reason).not.toMatch(/[0-9a-v]{32}/);
    });

    it('une vue de l’ancre qui n’est pas l’une des deux de bd est refusée, quel que soit son nom : une base de révision ne lit rien d’autre', async () => {
      const unknown = await unreadable(projects.histories('era-unknown'));
      const schemas = await unreadable(projects.histories('era-schemas'));

      expect(unknown.reason).toContain('« rapport_perso »');
      expect(schemas.reason).toContain('« dolt_schemas »');
      expect(outFiles('era-schemas')).toEqual([]);
    });

    it('aucune de ces lectures n’a créé de fichier, nulle part', () => {
      const created = [
        'view-issues-committed',
        'view-issues-working',
        'view-labels-outfile',
        'view-config',
        'view-dolt-log',
        'view-dolt-status',
        'view-dolt-schemas',
        'virtual-title',
        'virtual-deps',
        'virtual-config',
        'head-hostile-dirty',
        'view-fold-s',
        'view-fold-i',
        'case-clean',
        'case-dirty',
        'era-shadow',
        'era-schemas',
        'era-fold-s',
        'era-fold-i',
        'era-unknown',
      ].flatMap((name) =>
        outFiles(name).map((file) => `${name}/${file}`),
      );

      expect(created).toEqual([]);
    });
  });

  describe('sans fausse alerte', () => {
    it('une base comme celles de bd (ses deux vues `ready_issues` et `blocked_issues`, des valeurs par défaut) se lit en entier', async () => {
      const issues = await projects.issues('ok-beads');
      const detail = await projects.issue('ok-beads', 'a-1');
      const histories = await projects.histories('ok-beads');
      const { projects: list } = await projects.list();

      expect(issues.map((issue) => issue.id).sort()).toEqual(['a-1', 'a-2']);
      expect(detail.labels).toEqual(['backend']);
      expect(detail.comments.map((c) => c.text)).toEqual(['Un commentaire']);
      expect(histories.map((history) => history.id).sort()).toEqual(['a-1', 'a-2']);
      expect(list.find((p) => p.id === 'ok-beads')).toMatchObject({ status: 'ok', prefix: 'a' });
    });

    it('un working set modifié sans commit (bd en auto-commit `batch` ou `off`) se lit, et se relit après un commit', async () => {
      // L'app lit l'état du dernier commit (ADR 0001) : le working set modifié n'y est pas.
      expect((await projects.issues('dirty-ok')).map((issue) => issue.title).sort()).toEqual(['Premier', 'Second']);

      scratches.get('dirty-ok')?.commit(3, 'commit en cours de test');
      scratches.get('dirty-ok')?.sql("update issues set title = 'Encore modifié' where id = 'a-2'");

      expect((await projects.issues('dirty-ok')).map((issue) => issue.title).sort()).toEqual(['Modifié sans commit', 'Nouveau', 'Second']);
    });

    it('un working set modifié dans une table que l’app ne lit pas (comme `wisps`) se lit : le HEAD de la base est vérifié, puis retenu', async () => {
      expect((await projects.issues('dirty-other')).map((issue) => issue.id).sort()).toEqual(['a-1', 'a-2']);
      expect((await projects.issue('dirty-other', 'a-1')).labels).toEqual(['backend']);

      scratches.get('dirty-other')?.commit(3, 'commit en cours de test');
      scratches.get('dirty-other')?.sql("insert into wisps values ('w-2')");

      expect((await projects.issues('dirty-other')).length).toBe(2);
    });

    it('l’historique d’une base dont le schéma a migré (une époque relue par la base de révision de son ancre), sans rien de stocké, se lit', async () => {
      const histories = await projects.histories('era-clean');

      expect(histories.map((history) => history.id).sort()).toEqual(['a-1', 'a-2']);
      expect(histories.find((history) => history.id === 'a-2')?.dependencies).toHaveLength(1);
    });
  });

  describe('la vérification est faite à chaque lecture, dans le même processus (aucun délai entre elle et la lecture)', () => {
    it('une vue qui arrive par un commit après des lectures réussies est refusée à la lecture suivante, et une vue du working set aussi', async () => {
      const later = scratches.get('later');
      expect((await projects.issues('later')).length).toBe(2);

      later?.sql(`drop table issues; ${issuesView(`load_file('${dbOf('later')}/canary.txt')`)}`);
      const uncommitted = await unreadable(projects.issues('later'));
      expect(uncommitted.reason).toContain('« issues »');

      later?.commit(2, 'la vue arrive');
      const committed = await unreadable(projects.issues('later'));
      expect(committed.reason).toContain('« issues »');
    });
  });
});
