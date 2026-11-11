import { existsSync, mkdirSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, dolt, hasBinary, isolatedDoltEnv, type Scratch } from '../testing/dolt-fixture';
import { type SqlServer, startSqlServer } from '../testing/dolt-server';
import { scratchDir } from '../testing/scratch';
import { BEADS_VIEWS, beadsLikeDatabase, CANARY, outfile, ROWS, SCHEMA } from '../testing/stored-sql-fixture';
import { createDoltClient, type DoltDatabase } from './client';
import { readIssueBase, readIssueParts } from './reader';
import { STORED_ROOT_COMMIT, StoredSqlError, withStoredSqlCheck } from './stored-sql';

/**
 * Un premier commit qui porte déjà les tables (bdesk-38k.74, round 4). `dolt_schema_diff` et `dolt_diff_summary` ne rendent que ce qui diffère entre leurs deux racines, et la
 * vérification compare HEAD, le working set et l'ancre d'une époque au premier commit de la lignée (le commit de base, `STORED_ROOT_COMMIT`) : une table que ce commit porte déjà, et que
 * HEAD n'a pas changée depuis, n'est pas dans la comparaison, et son `CREATE TABLE` (un index fonctionnel, évalué à chaque lecture) ne serait jamais jugé.
 *
 * Un collaborateur qui tient le remote le fabrique avec `dolt commit --amend` sur le commit d'`init` : le premier commit devient le seul, et porte `issues` avec un index fonctionnel
 * `((sleep(8)))`. Le working set de la victime, modifié sans commit (un `bd` en cours d'écriture, `batch` ou `off`), a retiré l'index : `information_schema.statistics`, qui ne lit que lui,
 * ne le voit pas, et HEAD, qui l'a, n'a aucune différence avec le commit de base. Mesuré : la lecture dure 8 s de plus par ligne.
 *
 *   amended  le scénario ci-dessus.
 *   hostile  le premier commit, amendé, ne porte que des **vues** nommées comme ce que la vérification et l'app lisent (`dolt_schemas`, `dolt_nonlocal_tables`, `dolt_status`, `issues`, `tables`), dont le corps
 *            écrit un fichier : la liste de sa révision (`show full tables from <base>/<commit>`, la recherche du commit de base) les nomme sans en exécuter aucune (mesuré : aucun fichier). C'est ce qui
 *            justifie que cette instruction, la seule que la vérification envoie à une révision qu'elle n'a pas encore vérifiée, passe par le client brut (relecture finale, round 4).
 *   plain    une base comme celles de bd (commit d'`init` vide, puis un commit de données) : lue sans fausse alerte, ce que les bases de Projets réels vérifient aussi (voir la livraison).
 */
const LONG_SLEEP_INDEX = '((sleep(8)))';
/** Les noms que les vues du premier commit « hostile » portent : chacun est un objet que la vérification ou l'app résout. */
const HOSTILE_NAMES = ['dolt_schemas', 'dolt_nonlocal_tables', 'dolt_status', 'issues', 'tables'] as const;

describe.skipIf(!hasBinary('dolt')).each([['embedded'], ['server']] as const)(
  'un premier commit qui porte déjà des tables, mode %s (bdesk-38k.74, round 4)',
  { timeout: 240_000 },
  (mode) => {
    let env: NodeJS.ProcessEnv;
    let folder: string;
    let server: SqlServer | undefined;
    let outside: string;

    const dbOf = (name: string) => join(folder, name);
    /** Où le corps d'une vue hostile écrit : derrière un serveur, hors de toute base (pas de `secure_file_priv`) ; embedded, dans le dossier de la base, le seul endroit que `dolt sql` y autorise. */
    const outDir = () => (mode === 'server' ? outside : dbOf('hostile'));
    const written = () => (existsSync(outDir()) ? readdirSync(outDir()).filter((file) => file.startsWith('out-')) : []);
    const rows = (name: string, sql: string): string => dolt(env, dbOf(name), 'sql', '-r', 'csv', '-q', sql).trim();

    /** Le commit d'`init` remplacé (`dolt commit --amend`) par un commit qui porte les tables et l'index fonctionnel ; puis un working set modifié, qui retire l'index. */
    const amendedDatabase = (db: Scratch, dir: string) => {
      writeFileSync(join(dir, 'canary.txt'), `${CANARY}\n`);
      db.sql(`${SCHEMA}; ${ROWS}; ${BEADS_VIEWS}`);
      db.sql(`create index fi on issues ${LONG_SLEEP_INDEX}`);
      db.dolt('add', '-A');
      db.dolt('commit', '--amend', '-m', 'le premier commit porte déjà les tables', '--date', '2026-09-30T10:00:00Z');
      db.sql('alter table issues drop index fi');
    };

    /** Le premier commit remplacé (`dolt commit --amend`) par un commit qui ne porte que des vues hostiles. */
    const hostileDatabase = (db: Scratch) => {
      db.sql(HOSTILE_NAMES.map((name) => `create view \`${name}\` as select * from ${outfile(join(outDir(), `out-${name}.txt`))}`).join('; '));
      db.dolt('add', '-A');
      db.dolt('commit', '--amend', '-m', 'un premier commit qui ne porte que des vues hostiles', '--date', '2026-09-30T10:00:00Z');
      for (const file of written()) rmSync(join(outDir(), file), { force: true }); // créer une vue ne lit pas son corps (mesuré), mais on part d'un dossier vide
    };

    beforeAll(async () => {
      env = isolatedDoltEnv();
      const root = realpathSync(scratchDir('bdesk-stored-sql-root-'));
      outside = join(root, 'outside');
      mkdirSync(outside, { recursive: true });
      folder = mode === 'embedded' ? join(root, 'dbs') : join(root, 'srv', '.beads', 'dolt');
      mkdirSync(folder, { recursive: true });
      amendedDatabase(createDatabase(env, dbOf('amended')), dbOf('amended'));
      hostileDatabase(createDatabase(env, dbOf('hostile')));
      beadsLikeDatabase(env, dbOf('plain'));
      if (mode === 'server') server = await startSqlServer(env, folder, { databaseDir: dbOf('amended') });
    }, 600_000);

    afterAll(async () => {
      await server?.stop();
    }, 60_000);

    const checked = (name: string): DoltDatabase => withStoredSqlCheck(createDoltClient({ retries: 0 })).open(dbOf(name));
    const outcome = (read: () => Promise<unknown>): Promise<{ value?: unknown; error?: unknown }> =>
      read().then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      );

    describe('les faits : ce que Dolt fait sans la vérification', () => {
      it('amended : le seul commit porte les tables ; `dolt_schema_diff` contre lui ne rend aucune ligne, et le working set n’a plus l’index', () => {
        const root = rows('amended', STORED_ROOT_COMMIT).split('\n')[1] ?? '';

        expect(rows('amended', 'select count(*) as n from dolt_log')).toBe('n\n1');
        expect(rows('amended', `select to_table_name from dolt_schema_diff('${root}', 'HEAD')`)).toBe('to_table_name');
        expect(rows('amended', "select count(*) as n from information_schema.statistics where table_schema = database() and table_name = 'issues' and expression <> ''")).toBe('n\n0');
        expect(rows('amended', 'select count(*) as n from dolt_status')).not.toBe('n\n0');
      });

      it('amended : une lecture `as of \'HEAD\'` évalue pourtant l’index de HEAD (8 s de plus)', () => {
        const start = Date.now();
        rows('amended', "select id from issues as of 'HEAD'");
        expect(Date.now() - start).toBeGreaterThan(7000);
      });

      it('amended : la révision du premier commit liste ses tables ; celle d’une base de bd est vide', () => {
        const listing = (name: string) => {
          const root = rows(name, STORED_ROOT_COMMIT).split('\n')[1] ?? '';
          const database = rows(name, 'select database() as name').split('\n')[1] ?? '';
          return rows(name, `show full tables from \`${database}/${root}\``);
        };

        expect(listing('amended')).toMatch(/issues,BASE TABLE/);
        expect(listing('plain').split('\n')).toHaveLength(1); // l'en-tête seul
      });
    });

    describe('l’app', () => {
      it('amended : refuse la base avant toute lecture (moins de six secondes, sans les 8 s de l’index), en nommant les tables que le premier commit porte déjà', async () => {
        const start = Date.now();
        const { value, error } = await outcome(() => readIssueParts(checked('amended'), 'a-1'));

        expect(Date.now() - start).toBeLessThan(6000);
        expect(value).toBeUndefined();
        expect(error).toBeInstanceOf(StoredSqlError);
        expect((error as StoredSqlError).objects).toContain('« issues » existe déjà dans le premier commit : sans commit où elle manque, on ne peut pas juger son CREATE TABLE');
        expect((error as Error).message).not.toMatch(/sleep|canary/i);
      });

      it('amended : toutes les lectures, tableau compris, sont refusées de même', async () => {
        const { value, error } = await outcome(() => readIssueBase(checked('amended')));

        expect(value).toBeUndefined();
        expect(error).toBeInstanceOf(StoredSqlError);
      });

      it('hostile : le premier commit ne porte que des vues dont le corps écrit un fichier : la base est refusée, la recherche du commit de base n’en exécute aucune', async () => {
        const { value, error } = await outcome(() => readIssueParts(checked('hostile'), 'a-1'));

        expect(value).toBeUndefined();
        expect(error).toBeInstanceOf(StoredSqlError);
        const objects = (error as StoredSqlError).objects;
        for (const name of HOSTILE_NAMES) expect(objects.some((object) => object.startsWith(`« ${name} » existe déjà dans le premier commit`)), name).toBe(true);
        expect(written()).toEqual([]);
      });

      it('hostile : le fait que ce test garde : lue sans la vérification, la vue `dolt_nonlocal_tables` écrit son fichier ; sa révision listée, non', () => {
        expect(written()).toEqual([]);
        expect(rows('hostile', `show full tables from \`${rows('hostile', 'select database() as name').split('\n')[1] ?? ''}/${rows('hostile', STORED_ROOT_COMMIT).split('\n')[1] ?? ''}\``)).toMatch(/dolt_nonlocal_tables,VIEW/);
        expect(written()).toEqual([]); // la liste de la révision nomme les vues sans les exécuter

        try {
          rows('hostile', 'select * from dolt_nonlocal_tables'); // sans la vérification : le corps s'exécute
        } catch {
          // la vue écrit son fichier puis la lecture échoue (son corps ne rend rien d'utilisable) : seul le fichier compte
        }

        expect(written()).toEqual(['out-dolt_nonlocal_tables.txt']);
        rmSync(join(outDir(), 'out-dolt_nonlocal_tables.txt'), { force: true });
      });

      it('plain : une base de bd (commit d’`init` vide) est lue sans fausse alerte, comme sans la vérification', async () => {
        const plain = createDoltClient({ retries: 0 }).open(dbOf('plain'));
        const [a, b] = await Promise.all([outcome(() => readIssueBase(checked('plain'))), outcome(() => readIssueBase(plain))]);

        expect(a.error).toBeUndefined();
        expect(JSON.stringify(a.value)).toBe(JSON.stringify(b.value));
      });
    });
  },
);
