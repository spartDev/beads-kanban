import { mkdirSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createProjectService, ProjectUnreadableError } from '../projects/service';
import { dolt, hasBinary, isolatedDoltEnv, type Scratch } from '../testing/dolt-fixture';
import { type SqlServer, startSqlServer } from '../testing/dolt-server';
import { scratchDir } from '../testing/scratch';
import { beadsLikeDatabase, CANARY } from '../testing/stored-sql-fixture';
import { createDoltClient, type DoltDatabase } from './client';
import { DoltQueryError } from './errors';
import { readTicketHistories } from './history';
import { READ_ONLY_PREFIX } from './read-only';
import { readIssueBase, readIssueParts, readIssuePrefix } from './reader';
import { StoredSqlError, withStoredSqlCheck } from './stored-sql';

/**
 * `dolt_nonlocal_tables` (B-NL de la relecture finale de bdesk-38k.74). Dolt 2.5.0 a une table système `(table_name, target_ref, ref_table, options)` : une ligne fait résoudre
 * `table_name` (un motif, `*`, `?` et `%` compris) vers la table `ref_table` de la référence `target_ref` (une branche, un tag, un commit), avant toute autre résolution. Un collaborateur
 * qui commite une ligne mène donc un nom que l'app lit (`dolt_history_issues`, que `history.ts` lit sans `as of`, ou `issues`, lue `as of 'HEAD'`) vers une table ordinaire dont une
 * colonne est `generated always as (load_file(…)) virtual`. Les deux assertions ne le voyaient pas : `information_schema` ne parle que des tables physiques, la colonne générée est sur
 * un nom que personne ne surveille, et le working set est propre. Embedded, le fichier est celui du dossier de la base (`secure_file_priv`) ; derrière un `dolt sql-server` (bd en mode
 * server), n'importe quel fichier que l'utilisateur peut lire, ici un fichier hors de la base.
 *
 *   nh  `dolt_history_issues` menée vers `zz_hist` (une colonne `status` générée), commitée : la lecture de l'historique rend le contenu du fichier
 *   nb  `issues` menée vers `zz_issues` (le schéma complet d'`issues`, dont `title` générée) : le tableau, lu `as of 'HEAD'`, rend le contenu du fichier
 *   ns  `nh` plus une ligne qui mène `dolt_nonlocal_tables` vers une table vide : lue par son nom, la table se cache d'elle-même (`select count(*)` rend 0)
 *   nw  une ligne dont le nom est un motif (`dolt_history_%`)
 *   nd  `nh`, non commitée : le working set seul
 *   ni  `nh`, et `dolt_ignore` couvrant `dolt_nonlocal%` : `dolt_diff_summary` ne la montre plus, `dolt_schema_diff` si
 *   nx  `dolt_history_issues` menée vers `zz_hist` d'une AUTRE branche (`evil`)
 *   nr  des lignes dans HEAD, retirées du working set sans commit : la table est vide dans le working set, pas dans HEAD
 *
 *   nv  des lignes qui mènent les noms que la vérification lit elle-même (`dolt_schemas`, `dolt_log`, et les fonctions de table `dolt_diff_summary`, `dolt_schema_diff`, `dolt_diff_stat`) : Dolt
 *       ne sait plus résoudre une vue (« expected a SchemaTable »), toute instruction qui nomme une table échoue, la base est refusée par le message fixe de la vérification, sans que le texte
 *       de Dolt soit repris. Derrière un serveur, `information_schema.tables` parcourt toutes les bases qu'il sert : `nv` ne partage donc son serveur qu'avec `nvb`, une base saine, que
 *       cette échéance atteint aussi (refusée de même, jamais lue de travers)
 *   ne  une époque du schéma des dépendances (le commit d'ancre `<base>/<commit>`, où Dolt résout les noms avec la table de ce commit-là) dont l'ancre mène `dolt_history_dependencies` vers `zz_dep` ;
 *       les lignes sont retirées depuis : HEAD et le working set ont une table vide, seule l'époque est en cause
 *
 * Et trois bases que la vérification doit laisser lire :
 *   ve  la table `dolt_nonlocal_tables` vide, comme dans les bases que bd crée (présente dans les cinq copies de Projets réels examinées, sans une ligne)
 *   vc  la table qui n'a jamais eu de ligne, puis en reçoit une qu'on retire : vide de nouveau, commitée
 *   nc  l'époque du schéma des dépendances, dont l'ancre a la table, vide
 */
const REFUSED = ['nh', 'nb', 'ns', 'nw', 'nd', 'ni', 'nx', 'nr'] as const;
const READABLE = ['ve', 'vc'] as const;
type Scenario = (typeof REFUSED)[number] | (typeof READABLE)[number] | 'ne' | 'nc' | 'nv' | 'nvb';
const SCENARIOS: readonly Scenario[] = [...REFUSED, ...READABLE, 'ne', 'nc'];
/** `nv` a son propre dossier (et, derrière un serveur, son propre serveur), avec `nvb`, une base saine : voir « une base dont la vérification ne peut pas lire ses propres tables ». */
const ALONE: readonly Scenario[] = ['nv', 'nvb'];

/** Une table d'historique de remplacement : `status` est lu dans un fichier à chaque lecture, pour le commit de HEAD et le ticket `a-1` (les lignes que l'historique de l'app joint à sa lignée). */
const histTable = (secret: string): string =>
  `create table zz_hist (commit_hash varchar(64) not null, id varchar(255) not null, status varchar(500) generated always as (load_file('${secret}')) virtual, primary key (commit_hash, id)); ` +
  "insert into zz_hist (commit_hash, id) select hashof('HEAD'), 'a-1'";
/** Le schéma complet d'`issues`, dont `title` est lu dans un fichier : un attaquant le fournit, la lecture de l'app n'y voit rien d'anormal. */
const issuesTable = (secret: string): string =>
  `create table zz_issues (id varchar(255) primary key, title varchar(500) generated always as (load_file('${secret}')) virtual, description text not null, design text not null, ` +
  "acceptance_criteria text not null, notes text not null, status varchar(32) not null default 'open', priority int not null default 2, issue_type varchar(32) not null default 'task', " +
  'assignee varchar(255), created_at datetime not null default current_timestamp, updated_at datetime not null default current_timestamp, closed_at datetime, close_reason text not null); ' +
  "insert into zz_issues (id, description, design, acceptance_criteria, notes, close_reason) values ('a-1', '', '', '', '', ''), ('a-2', '', '', '', '', '')";
const EMPTY_NONLOCAL = 'create table zz_empty (table_name varchar(255) not null, target_ref varchar(255), ref_table varchar(255), options varchar(255), primary key (table_name))';
const redirect = (name: string, ref: string, table: string): string => `('${name}', '${ref}', '${table}', 'immediate')`;

describe.skipIf(!hasBinary('dolt')).each([['embedded'], ['server']] as const)('dolt_nonlocal_tables, mode %s (bdesk-38k.74, B-NL)', { timeout: 240_000 }, (mode) => {
  let env: NodeJS.ProcessEnv;
  let root: string;
  let outside: string;
  let folder: string;
  let aloneFolder: string;
  let server: SqlServer | undefined;
  let aloneServer: SqlServer | undefined;
  let leakServer: SqlServer | undefined;
  let leakProject: string;

  const dbOf = (name: string) => join(ALONE.includes(name as Scenario) ? aloneFolder : folder, name);
  /** Le fichier que la colonne générée lit : celui de la base embedded (que borne `secure_file_priv`), un fichier hors de la base derrière un serveur, que rien ne borne. */
  const secretOf = (name: string) => (mode === 'embedded' ? join(dbOf(name), 'canary.txt') : join(outside, 'secret.txt'));
  /** Une lecture lancée directement par `dolt sql`, sans le garde ni la vérification : celle de l'app, telle que Dolt la reçoit (derrière le serveur s'il y en a un). */
  const direct = (name: string, sql: string): string => dolt(env, dbOf(name), 'sql', '-r', 'json', '-q', READ_ONLY_PREFIX + sql);
  const rows = (name: string, sql: string): string => dolt(env, dbOf(name), 'sql', '-r', 'csv', '-q', sql).trim();

  /**
   * L'époque : `dependencies` a d'abord une colonne `depends_on_id`, puis `depends_on_issue_id` (comme bd à une montée de version). Le commit d'ancre, le dernier d'avant la migration, a
   * la table `dolt_nonlocal_tables`, qui mène `dolt_history_dependencies` vers `zz_dep` (une colonne `type` générée par `load_file`) si `rows`, vide sinon ; la migration la vide. `zz_dep` reste : la ligne de
   * l'ancre la mène vers le working set de `main`, où elle doit exister pour que la lecture sans vérification la suive.
   */
  const eraBase = (db: Scratch, secret: string, rows: boolean): void => {
    db.sql(`drop table dependencies;
      create table dependencies (issue_id varchar(255) not null, depends_on_id varchar(255) not null, type varchar(32) not null default 'blocks',
        created_at datetime not null default current_timestamp, created_by varchar(255) not null, primary key (issue_id, depends_on_id));
      insert into dependencies (issue_id, depends_on_id, created_by) values ('a-2', 'a-1', 'tom')`);
    db.commit(2, 'ancien schéma');
    db.sql(
      `create table zz_dep (commit_hash varchar(64) not null, issue_id varchar(255) not null, depends_on_id varchar(255) not null, type varchar(500) generated always as (load_file('${secret}')) virtual, primary key (commit_hash, issue_id)); ` +
        "insert into zz_dep (commit_hash, issue_id, depends_on_id) select hashof('HEAD'), 'a-2', 'a-1'; " +
        `insert into dolt_nonlocal_tables values ${redirect('dolt_history_dependencies', 'main', 'zz_dep')}` +
        (rows ? '' : '; delete from dolt_nonlocal_tables'),
    );
    db.commit(3, 'ancre');
    db.sql(`delete from dolt_nonlocal_tables;
      alter table dependencies add column depends_on_issue_id varchar(255);
      update dependencies set depends_on_issue_id = depends_on_id;
      alter table dependencies drop primary key;
      alter table dependencies drop column depends_on_id;
      alter table dependencies add column id char(36);
      update dependencies set id = uuid();
      alter table dependencies add primary key (id)`);
    db.commit(4, 'migration');
  };

  const setup: Record<Scenario, (db: Scratch, secret: string) => void> = {
    nh: (db, secret) => {
      db.sql(`${histTable(secret)}; insert into dolt_nonlocal_tables values ${redirect('dolt_history_issues', 'main', 'zz_hist')}`);
      db.commit(2, 'dolt_history_issues menée vers zz_hist');
    },
    nb: (db, secret) => {
      db.sql(`${issuesTable(secret)}; insert into dolt_nonlocal_tables values ${redirect('issues', 'main', 'zz_issues')}`);
      db.commit(2, 'issues menée vers zz_issues');
    },
    ns: (db, secret) => {
      db.sql(`${histTable(secret)}; ${EMPTY_NONLOCAL}; insert into dolt_nonlocal_tables values ${redirect('dolt_history_issues', 'main', 'zz_hist')}, ${redirect('dolt_nonlocal_tables', 'main', 'zz_empty')}`);
      db.commit(2, 'dolt_nonlocal_tables se cache');
    },
    nw: (db, secret) => {
      db.sql(`${histTable(secret)}; insert into dolt_nonlocal_tables values ${redirect('dolt_history_%', 'main', 'zz_hist')}`);
      db.commit(2, 'un motif');
    },
    nd: (db, secret) => {
      db.sql(`${histTable(secret)}; insert into dolt_nonlocal_tables values ${redirect('dolt_history_issues', 'main', 'zz_hist')}`); // jamais commité
    },
    ni: (db, secret) => {
      db.sql(`${histTable(secret)}; insert into dolt_nonlocal_tables values ${redirect('dolt_history_issues', 'main', 'zz_hist')}`);
      db.commit(2, 'dolt_history_issues menée vers zz_hist');
      // Les motifs d'ignorance ne retirent rien de ce qui est déjà suivi, mais `dolt_diff_summary` ne montre plus une table ajoutée ou supprimée qu'ils couvrent.
      db.sql("insert into dolt_ignore values ('dolt_nonlocal%', true), ('%', true)");
      db.commit(3, 'dolt_ignore couvre dolt_nonlocal_tables');
    },
    nx: (db, secret) => {
      db.dolt('checkout', '-b', 'evil');
      db.sql(histTable(secret));
      db.commit(2, 'zz_hist sur evil');
      db.dolt('checkout', 'main');
      db.sql(`insert into dolt_nonlocal_tables values ${redirect('dolt_history_issues', 'evil', 'zz_hist')}`);
      db.commit(3, 'dolt_history_issues menée vers evil');
    },
    nr: (db, secret) => {
      db.sql(`${histTable(secret)}; insert into dolt_nonlocal_tables values ${redirect('dolt_history_issues', 'main', 'zz_hist')}`);
      db.commit(2, 'des lignes dans HEAD');
      db.sql('delete from dolt_nonlocal_tables'); // la table est vide dans le working set, pas dans HEAD
    },
    nv: (db, secret) => {
      const names = ['dolt_schemas', 'dolt_log', 'dolt_diff_summary', 'dolt_schema_diff', 'dolt_diff_stat'];
      db.sql(`${histTable(secret)}; insert into dolt_nonlocal_tables values ${names.map((name) => redirect(name, 'main', 'zz_hist')).join(', ')}`);
      db.commit(2, 'les noms de la vérification menés vers zz_hist');
    },
    ne: (db, secret) => eraBase(db, secret, true),
    nc: (db, secret) => eraBase(db, secret, false),
    nvb: () => undefined,
    ve: (db) => {
      db.sql("insert into dolt_nonlocal_tables values ('zz', 'main', 'zz', 'immediate'); delete from dolt_nonlocal_tables");
      db.commit(2, 'dolt_nonlocal_tables vide, comme celle de bd');
    },
    vc: (db) => {
      db.sql("insert into dolt_nonlocal_tables values ('zz', 'main', 'zz', 'immediate')");
      db.commit(2, 'une ligne');
      db.sql('delete from dolt_nonlocal_tables');
      db.commit(3, 'plus aucune');
    },
  };

  beforeAll(async () => {
    env = isolatedDoltEnv();
    root = realpathSync(scratchDir('bdesk-stored-sql-nonlocal-'));
    outside = join(root, 'outside');
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, 'secret.txt'), `${CANARY}\n`);
    folder = mode === 'embedded' ? join(root, 'dbs') : join(root, 'srv', '.beads', 'dolt');
    aloneFolder = mode === 'embedded' ? folder : join(root, 'srv-alone', '.beads', 'dolt');
    mkdirSync(folder, { recursive: true });
    mkdirSync(aloneFolder, { recursive: true });
    for (const name of [...SCENARIOS, ...ALONE]) {
      setup[name](beadsLikeDatabase(env, dbOf(name)), secretOf(name));
      await new Promise((resolve) => setImmediate(resolve)); // rendre la main entre deux bases (voir `stored-sql.integration.test.ts`)
    }
    // Le Projet du service des Projets : `nh`.
    const beads = join(root, 'projets', 'cache', '.beads');
    leakProject = join(beads, mode === 'embedded' ? 'embeddeddolt' : 'dolt');
    mkdirSync(beads, { recursive: true });
    writeFileSync(join(beads, 'metadata.json'), JSON.stringify({ backend: 'dolt', database: 'dolt', dolt_mode: mode, dolt_database: 'tdb' }));
    setup.nh(beadsLikeDatabase(env, join(leakProject, 'tdb')), mode === 'embedded' ? join(leakProject, 'tdb', 'canary.txt') : join(outside, 'secret.txt'));
    if (mode === 'server') {
      server = await startSqlServer(env, folder, { databaseDir: dbOf('nh') });
      aloneServer = await startSqlServer(env, aloneFolder, { databaseDir: dbOf('nv') });
      leakServer = await startSqlServer(env, leakProject, { databaseDir: join(leakProject, 'tdb') });
    }
  }, 600_000);

  afterAll(async () => {
    await server?.stop();
    await aloneServer?.stop();
    await leakServer?.stop();
  }, 60_000);

  const checked = (name: string): DoltDatabase => withStoredSqlCheck(createDoltClient({ retries: 0 })).open(dbOf(name));
  const plain = (name: string): DoltDatabase => createDoltClient({ retries: 0 }).open(dbOf(name));
  /** Toutes les lectures de l'app : le préfixe (le scan des Projets), le tableau, la fiche et l'historique (les métriques, la Chronologie). */
  const reads = (db: DoltDatabase): Record<string, () => Promise<unknown>> => ({
    préfixe: () => readIssuePrefix(db),
    tableau: () => readIssueBase(db),
    fiche: () => readIssueParts(db, 'a-1'),
    historique: () => readTicketHistories(db),
  });
  const outcome = (read: () => Promise<unknown>): Promise<{ value?: unknown; error?: unknown }> =>
    read().then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );

  describe('les faits : ce que Dolt fait sans la vérification', () => {
    it('nh : la lecture de l’historique rend le contenu du fichier, sans qu’aucune vue ni colonne générée ne soit nommée comme une table lue', () => {
      expect(direct('nh', 'select status from dolt_history_issues')).toContain(CANARY);
      // Ce que les assertions sur les noms lus voyaient : rien.
      expect(rows('nh', "select count(*) as n from information_schema.tables where table_schema = database() and table_name = 'dolt_history_issues'")).toBe('n\n0');
      expect(rows('nh', "select count(*) as n from information_schema.columns where table_schema = database() and generation_expression <> '' and table_name in ('issues', 'dependencies', 'labels', 'comments', 'config')")).toBe('n\n0');
      expect(rows('nh', 'select count(*) as n from dolt_status')).toBe('n\n0'); // tout est commité : l'attaque voyage par le remote
    });

    it('nb : le tableau, lu `as of \'HEAD\'`, rend le contenu du fichier comme titre des tickets', () => {
      expect(direct('nb', "select id, title from issues as of 'HEAD' order by id")).toContain(CANARY);
    });

    it('ns : lue par son nom, la table se cache d’elle-même : Dolt lit la table vers laquelle une de ses lignes la mène', () => {
      expect(rows('ns', 'select count(*) as n from dolt_nonlocal_tables')).toBe('n\n0'); // Dolt lit zz_empty
      expect(rows('ns', "select dolt_hashof_table('dolt_nonlocal_tables') is not null as physical")).toMatch(/^physical\n(1|true)$/); // la table physique est bien là
    });

    it('ni : quand `dolt_ignore` couvre la table, `dolt_diff_summary` ne la montre plus (une table ajoutée ou supprimée dont le nom est couvert), `dolt_schema_diff` et `dolt_diff_stat` la montrent', () => {
      const root = rows('ni', "select commit_hash from dolt_log('HEAD') order by commit_order asc limit 1").split('\n')[1] ?? '';

      expect(rows('ni', `select count(*) as n from dolt_diff_summary('${root}', 'WORKING') where to_table_name = 'dolt_nonlocal_tables'`)).toBe('n\n0');
      expect(rows('ni', `select count(*) as n from dolt_schema_diff('${root}', 'WORKING') where to_table_name = 'dolt_nonlocal_tables'`)).toBe('n\n1');
      expect(rows('ni', `select rows_added from dolt_diff_stat('${root}', 'WORKING', 'dolt_nonlocal_tables')`)).toBe('rows_added\n1');
    });

    it('nx : la ligne mène aussi vers une autre branche', () => {
      expect(direct('nx', 'select status from dolt_history_issues')).toContain(CANARY);
    });

    it('ve et vc : la table existe, vide, et les lectures de l’app n’en sont pas changées', () => {
      for (const name of ['ve', 'vc']) {
        expect(rows(name, 'select count(*) as n from dolt_nonlocal_tables'), name).toBe('n\n0');
        expect(rows(name, "select dolt_hashof_table('dolt_nonlocal_tables') is not null as physical"), name).toMatch(/^physical\n(1|true)$/);
      }
    });
  });

  describe('l’app refuse la base, quelle que soit la lecture', () => {
    it.each(REFUSED)('%s : le préfixe, le tableau, la fiche et l’historique sont refusés en nommant `dolt_nonlocal_tables`, sans en citer le contenu', async (name) => {
      for (const [label, read] of Object.entries(reads(checked(name)))) {
        const { value, error } = await outcome(read);

        expect(value, `${name} / ${label}`).toBeUndefined();
        expect(error, `${name} / ${label}`).toBeInstanceOf(StoredSqlError);
        const message = (error as Error).message;
        expect(message, `${name} / ${label}`).toContain('« dolt_nonlocal_tables » n\'est pas vide');
        expect(message).not.toContain(CANARY);
        expect(message).not.toContain('zz_hist');
        expect(message).not.toContain('zz_issues');
        expect(JSON.stringify(value ?? null)).not.toContain(CANARY);
      }
    });

    // R3 (relecture finale, round 3) : une seule phrase, qui dit la migration de bd, que la table soit non vide dans le working set, dans HEAD, ou les deux — jamais « (dans HEAD) ».
    it('nr : la table est vide dans le working set et pleine dans HEAD ; refusée tout de même, d’une seule phrase', async () => {
      const { error } = await outcome(() => readIssueBase(checked('nr')));

      expect((error as Error).message).toContain("« dolt_nonlocal_tables » n'est pas vide : bd semble être en train de migrer cette base");
      expect((error as Error).message).not.toContain('(dans HEAD)');
    });

    it('nh : sans la vérification, le même client rend le contenu du fichier à l’historique (le trou)', async () => {
      const histories = await readTicketHistories(plain('nh'));

      expect(JSON.stringify(histories)).toContain(CANARY);
    });
  });

  describe('une base dont la vérification ne peut pas lire ses propres tables', () => {
    it('nv : Dolt ne sait plus résoudre une vue, et toute instruction qui nomme une table échoue', () => {
      expect(() => rows('nv', 'select count(*) as n from information_schema.tables'), 'nv').toThrow(/SchemaTable/);
      expect(() => rows('nv', 'select count(*) as n from issues'), 'nv').toThrow(/SchemaTable/);
    });

    it('nv : le préfixe, le tableau, la fiche et l’historique sont refusés par le message fixe de la vérification, sans rien citer de la base', async () => {
      for (const [label, read] of Object.entries(reads(checked('nv')))) {
        const { value, error } = await outcome(read);

        expect(value, `nv / ${label}`).toBeUndefined();
        expect(error, `nv / ${label}`).toBeInstanceOf(DoltQueryError);
        const message = (error as Error).message;
        expect(message, `nv / ${label}`).toContain("La vérification du SQL stocké n'a pas pu s'achever");
        expect(message).not.toContain(CANARY);
        expect(message).not.toContain('zz_hist');
        expect(message).not.toContain('SchemaTable');
      }
    });

    it('nvb : une base saine se lit comme une autre, sauf derrière le serveur de nv (information_schema.tables parcourt toutes les bases du serveur) : refusée de même, jamais lue de travers', async () => {
      const withCheck = reads(checked('nvb'));
      const without = reads(plain('nvb'));

      for (const label of Object.keys(withCheck)) {
        const a = await outcome(withCheck[label] ?? (() => Promise.reject(new Error('manque'))));
        const b = await outcome(without[label] ?? (() => Promise.reject(new Error('manque'))));

        expect(b.error, `nvb / ${label} sans vérification`).toBeUndefined();
        if (mode === 'embedded') {
          expect(a.error, `nvb / ${label}`).toBeUndefined();
          expect(JSON.stringify(a.value), `nvb / ${label}`).toBe(JSON.stringify(b.value));
        } else {
          expect(a.value, `nvb / ${label}`).toBeUndefined();
          expect(a.error, `nvb / ${label}`).toBeInstanceOf(DoltQueryError);
          expect((a.error as Error).message).toContain("La vérification du SQL stocké n'a pas pu s'achever");
        }
      }
    });
  });

  describe('une époque du schéma dont l’ancre mène des noms ailleurs', () => {
    it('ne : HEAD et le working set ont une table vide, mais l’historique est refusé : l’époque est comptée dans son commit, avant que son nom soit lu', async () => {
      const db = checked('ne');
      expect(await readIssuePrefix(db)).toBe('a'); // l'état courant est sain
      expect(await readIssueBase(db)).toBeDefined();

      const { value, error } = await outcome(() => readTicketHistories(db));

      expect(value).toBeUndefined();
      expect(error).toBeInstanceOf(StoredSqlError);
      expect((error as Error).message).toMatch(/« dolt_nonlocal_tables » n'est pas vide \(époque du commit [0-9a-v]{8}\)/);
      expect((error as Error).message).not.toContain(CANARY);

      // Sans le client vérifié, la lecture de l'époque ne livre rien non plus : la vérification propre à `history.ts` voit, par `show columns`, la colonne générée de la table vers laquelle
      // la ligne mène le nom. Le compte de l'ancre n'ajoute que ceci : il ne résout aucun nom (la ligne vise une référence qui peut bouger, alors que le commit d'ancre ne bouge pas) et dit sa raison avant.
      const plainOutcome = await outcome(() => readTicketHistories(plain('ne')));
      expect(plainOutcome.value).toBeUndefined();
      expect(plainOutcome.error).toBeInstanceOf(StoredSqlError);
      expect((plainOutcome.error as Error).message).toContain('colonne générée');
      expect(JSON.stringify(plainOutcome)).not.toContain(CANARY);
    });

    it('nc : l’ancre a la table, vide : l’historique se lit, et rend ce que le client sans vérification rend', async () => {
      const [withCheck, without] = await Promise.all([outcome(() => readTicketHistories(checked('nc'))), outcome(() => readTicketHistories(plain('nc')))]);

      expect(withCheck.error).toBeUndefined();
      expect(JSON.stringify(withCheck.value)).toBe(JSON.stringify(without.value));
      expect(JSON.stringify(withCheck.value)).not.toContain(CANARY);
    });
  });

  describe('l’app lit les bases dont la table est vide, comme celles de bd', () => {
    it.each(READABLE)('%s : toutes les lectures réussissent et rendent ce que le client sans vérification rend', async (name) => {
      const withCheck = reads(checked(name));
      const without = reads(plain(name));

      for (const label of Object.keys(withCheck)) {
        const a = await outcome(withCheck[label] ?? (() => Promise.reject(new Error('manque'))));
        const b = await outcome(without[label] ?? (() => Promise.reject(new Error('manque'))));

        expect(a.error, `${name} / ${label}`).toBeUndefined();
        expect(JSON.stringify(a.value), `${name} / ${label}`).toBe(JSON.stringify(b.value));
      }
    });

    it('une base qui reçoit des lignes après avoir été lue est refusée dès la lecture suivante, sans que le commit de base retenu la cache', async () => {
      const db = checked('vc');
      expect(await readIssuePrefix(db)).toBe('a');

      // Par SQL : avec un serveur qui tourne pour la base, c'est lui qui écrit (`call dolt_add`, `call dolt_commit`).
      dolt(
        env,
        dbOf('vc'),
        'sql',
        '-q',
        `${histTable(secretOf('vc'))}; insert into dolt_nonlocal_tables values ${redirect('dolt_history_issues', 'main', 'zz_hist')}; call dolt_add('-A'); call dolt_commit('-m', 'des lignes, enfin', '--date', '2026-10-04T10:00:00Z')`,
      );

      const { error } = await outcome(() => readTicketHistories(db));
      expect(error).toBeInstanceOf(StoredSqlError);
      expect((error as Error).message).toContain('« dolt_nonlocal_tables » n\'est pas vide');
    });
  });

  describe('le service des Projets, tel que l’app le construit', () => {
    it('nh : le Projet est illisible au scan et à la lecture, et sa raison ne cite rien de la base', async () => {
      const projects = createProjectService({ roots: [join(root, 'projets')], projects: [], hiddenProjects: [] }, { rescanIntervalMs: 0 });

      const { projects: list } = await projects.list();
      const project = list.find((p) => p.id === 'cache');
      const error = await projects.histories('cache').then(
        () => undefined,
        (err: unknown) => err,
      );

      expect(project?.status).toBe('unreadable');
      expect(project?.reason).toContain('« dolt_nonlocal_tables » n\'est pas vide');
      expect(error).toBeInstanceOf(ProjectUnreadableError);
      for (const reason of [project?.reason ?? '', (error as ProjectUnreadableError).reason]) {
        expect(reason).not.toContain(CANARY);
        expect(reason).not.toContain('zz_hist');
      }
      expect(JSON.stringify(list)).not.toContain(CANARY);
      if (mode === 'server') expect(readdirSync(outside).filter((file) => file !== 'secret.txt')).toEqual([]);
    });
  });
});
