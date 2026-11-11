import { mkdirSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createProjectService, ProjectUnreadableError, type ProjectService } from '../projects/service';
import { dolt, hasBinary, isolatedDoltEnv, type Scratch } from '../testing/dolt-fixture';
import { scratchDir } from '../testing/scratch';
import { beadsLikeDatabase, outfile } from '../testing/stored-sql-fixture';
import { createDoltClient, DoltQueryError, queryAll, type DoltClient, type Row } from './client';
import { StoredSqlError, storedSqlEvidence, withStoredSqlCheck } from './stored-sql';

/**
 * Le refus d'une base qui porte du SQL (bdesk-38k.69), sur de vraies bases Dolt, pour trois cas que `stored-sql.integration.test.ts` ne montre pas (bdesk-38k.74) :
 *
 *   toggle      une vue qui va et vient : là quand une lecture part, partie quand le diagnostic passe, à chaque essai. Le diagnostic, dans un autre processus, ne la voit
 *               plus : sans relevé dans le groupe du dernier essai, la lecture finissait sur « La base change plus vite… (3 essais) » au lieu de nommer la vue. Le
 *               client qui la fait aller et venir (celui de Dolt, enveloppé) reconnaît un groupe de lecture à sa seconde assertion (`as stored_sql`) et tout autre groupe à un diagnostic.
 *   many-cols   une table `issues` qui porte 300 colonnes générées : la raison du refus (le 503 de l'API) en nomme cinq, puis dit combien d'autres.
 *   head-view   une vue `dolt_log` commitée, que le working set a retirée sans commit : c'est HEAD qui la porte (la seconde assertion la compte, la première non).
 *
 * Le diagnostic « aveugle » des tests de `many-cols` et de `head-view` rend à chaque fois « rien » (un objet qui n'est plus là quand il passe) : seul le dernier essai peut nommer ce
 * que l'assertion a vu.
 */
/** Le nombre de colonnes générées de `many-cols` : des centaines, comme le dit la remarque de la relecture de bdesk-38k.69. */
const GENERATED_COLUMNS = 300;

describe.skipIf(!hasBinary('dolt'))('le refus d’une base qui porte du SQL (bdesk-38k.74)', { timeout: 120_000 }, () => {
  let env: NodeJS.ProcessEnv;
  let root: string;
  let toggle: Scratch;
  let projects: ProjectService;

  const dbOf = (name: string) => join(root, name, '.beads', 'embeddeddolt', 'tdb');
  const outFiles = (name: string) => readdirSync(dbOf(name)).filter((file) => file.startsWith('out-'));

  function build(name: string): Scratch {
    const beads = join(root, name, '.beads');
    mkdirSync(beads, { recursive: true });
    writeFileSync(join(beads, 'metadata.json'), JSON.stringify({ backend: 'dolt', database: 'dolt', dolt_mode: 'embedded', dolt_database: 'tdb' }));
    return beadsLikeDatabase(env, dbOf(name));
  }

  /**
   * Les trois groupes qui cherchent le commit de base d'une base, une fois par base : le premier commit de la lignée et le nom de la base, la sonde qui dit s'il porte
   * `dolt_nonlocal_tables`, puis la liste des tables de sa révision, qui doit être vide (bdesk-38k.74, round 4). Les fonctions de table `dolt_log` et `dolt_diff_stat` et `show full tables`,
   * que les clients ci-dessous laissent passer sans les compter parmi les groupes de la lecture ni du diagnostic.
   */
  const isLearning = (sqls: readonly string[]) =>
    sqls[0]?.startsWith("select commit_hash from dolt_log('HEAD')") === true ||
    (sqls.length === 1 && (sqls[0]?.includes('from dolt_diff_stat(') === true || sqls[0]?.startsWith('show full tables from ') === true));

  /** La vue hostile : `dolt_log` (une table système que l'historique lit) sur une fonction qui écrit un fichier à la lecture. Elle est dans le working set seulement. */
  const hostileView = () => `create view dolt_log as select 'x' as commit_hash, cast('2026-10-01 10:00:00' as datetime) as date from ${outfile(join(dbOf('toggle'), 'out-toggle.txt'))}`;
  /** Ce qui va et vient : le SQL qui le pose (calculé à l'usage : le dossier des essais n'existe qu'à `beforeAll`), celui qui le retire, celui qui remet la base dans l'état d'avant. */
  interface Change {
    on: () => string;
    off: string;
    reset: string;
  }
  const VIEW: Change = { on: hostileView, off: 'drop view dolt_log', reset: 'drop view if exists dolt_log' };
  /** Une table nouvelle (`wisps`, que l'app ne lit pas) : le working set est sale, sans rien de stocké. */
  const DIRTY: Change = { on: () => 'create table wisps (id varchar(10) primary key)', off: 'drop table wisps', reset: 'drop table if exists wisps' };

  /**
   * Le client de Dolt dont la vue va et vient : pour un groupe de lecture (une lecture, ou le dernier essai : ils portent la seconde assertion), elle est là ou non selon
   * `shownFor(n)`, n étant le rang de la lecture (la 1re, la 2e…) ; pour tout autre groupe (les temps du diagnostic), elle est partie. Les groupes vus sont gardés, dans l'ordre.
   */
  function togglingClient(shownFor: (read: number) => boolean, change: Change = VIEW) {
    const inner = createDoltClient();
    const seen: ('lecture' | 'relevés' | 'diagnostic')[] = [];
    toggle.sql(change.reset); // la base est dans l'état où la dernière lecture l'a laissée : sans la vue
    let shown = false;
    let reads = 0;
    const show = (wanted: boolean) => {
      if (wanted === shown) return;
      toggle.sql(wanted ? change.on() : change.off);
      shown = wanted;
    };
    const client: DoltClient = {
      open(dir) {
        const db = inner.open(dir);
        return {
          dir,
          query: (sql, options) => db.query(sql, options),
          queryAll: (sqls, options) => {
            if (isLearning(sqls)) return queryAll(db, sqls, options);
            const isRead = sqls.some((sql) => sql.includes('as stored_sql'));
            if (isRead) {
              show(shownFor(++reads));
              seen.push(sqls[0]?.startsWith('select table_name as view_name') ? 'relevés' : 'lecture');
            } else {
              show(false);
              seen.push('diagnostic');
            }
            return queryAll(db, sqls, options);
          },
        };
      },
    };
    return { client: withStoredSqlCheck(client), seen };
  }

  beforeAll(async () => {
    env = isolatedDoltEnv();
    root = realpathSync(scratchDir('bdesk-stored-sql-refusals-'));

    toggle = build('toggle');
    await new Promise((resolve) => setImmediate(resolve)); // rendre la main entre deux constructions de bases (voir `stored-sql.integration.test.ts`)

    const columns = build('many-cols');
    const alters = Array.from({ length: GENERATED_COLUMNS }, (_, i) => `alter table issues add column g${i} varchar(10) generated always as ('x') virtual`);
    columns.sql(alters.join(';\n'));
    columns.commit(2, 'des centaines de colonnes générées');

    const head = build('head-view');
    head.sql(`create view dolt_log as select 'x' as commit_hash, cast('2026-10-01 10:00:00' as datetime) as date from ${outfile(join(dbOf('head-view'), 'out-head.txt'))}`);
    head.commit(2, 'une vue dolt_log dans HEAD');
    head.sql('drop view dolt_log'); // le working set l'a retirée, sans commit

    projects = createProjectService({ roots: [root], projects: [], hiddenProjects: [] }, { rescanIntervalMs: 0 });
  }, 600_000);

  // Chaque test laisse `toggle` sans vue hostile ni table nouvelle : le suivant (les relevés lancés pour de bon, par exemple) part d'un working set propre.
  afterEach(() => {
    toggle.sql('drop view if exists dolt_log; drop table if exists wisps');
  });

  describe('une vue qui va et vient', () => {
    it('est refusée en nommant la vue, même si le diagnostic ne la voit à aucun de ses deux passages : le dernier essai a relevé ce que son assertion a vu', async () => {
      const { client, seen } = togglingClient(() => true);

      const error = await client.open(dbOf('toggle')).query('select commit_hash from dolt_log').catch((err: unknown) => err);

      expect(error).toBeInstanceOf(StoredSqlError);
      expect((error as Error).message).toContain('« dolt_log » est une vue');
      expect((error as Error).message).not.toMatch(/plus vite que la vérification/);
      // Trois lectures, dont la dernière porte ses relevés ; entre elles, un diagnostic (deux groupes) qui ne trouve rien.
      expect(seen.filter((kind) => kind !== 'diagnostic')).toEqual(['lecture', 'lecture', 'relevés']);
      expect(seen.filter((kind) => kind === 'diagnostic').length).toBeGreaterThanOrEqual(4);
      expect(outFiles('toggle')).toEqual([]); // la vue n'a jamais été lue
    });

    it('lit quand la vue est partie au moment du dernier essai, et rend les lignes de la lecture, non celles des relevés', async () => {
      const { client, seen } = togglingClient((read) => read < 3);

      const rows = await client.open(dbOf('toggle')).query("select id from issues as of 'HEAD' order by id");

      expect(rows).toEqual([{ id: 'a-1' }, { id: 'a-2' }]);
      expect(seen.filter((kind) => kind !== 'diagnostic')).toEqual(['lecture', 'lecture', 'relevés']);
      expect(outFiles('toggle')).toEqual([]);
    });

    it('lit sans fausse alerte quand la vue n’est jamais là : un seul groupe, les deux assertions seules', async () => {
      const { client, seen } = togglingClient(() => false);

      const rows = await client.open(dbOf('toggle')).query("select id from issues as of 'HEAD' order by id");

      expect(rows).toEqual([{ id: 'a-1' }, { id: 'a-2' }]);
      expect(seen).toEqual(['lecture']);
    });
  });

  // Le working set qui passe de sale à propre entre la lecture et le diagnostic (la course de la relecture de .74 : un écrivain renomme une table, puis la rétablit). Le diagnostic, propre,
  // oubliait le HEAD, et la lecture suivante, sale de nouveau, échouait de nouveau : trois essais, « La base change plus vite… », alors que HEAD n'avait pas bougé. Il retient maintenant le
  // HEAD qu'il lit dans l'instantané propre (ni vue, ni colonne générée, ni vue de HEAD) : la lecture sale suivante passe.
  describe('un working set sale à chaque lecture et propre à chaque diagnostic', () => {
    it('est lu : HEAD ne change pas, et le diagnostic propre l’a retenu', async () => {
      const { client, seen } = togglingClient(() => true, DIRTY);

      const rows = await client.open(dbOf('toggle')).query("select id from issues as of 'HEAD' order by id");

      expect(rows).toEqual([{ id: 'a-1' }, { id: 'a-2' }]);
      expect(seen).toEqual(['lecture', 'diagnostic', 'diagnostic', 'lecture']); // sale, un diagnostic (deux groupes) propre, puis sale de nouveau : passe
    });

    it('est lu à chaque fois, sans un diagnostic de plus : le HEAD vérifié reste retenu tant qu’il ne change pas', async () => {
      const { client, seen } = togglingClient(() => true, DIRTY);
      const db = client.open(dbOf('toggle'));

      await db.query("select id from issues as of 'HEAD' order by id");
      const again = await db.query("select id from issues as of 'HEAD' order by id");

      expect(again).toEqual([{ id: 'a-1' }, { id: 'a-2' }]);
      expect(seen).toEqual(['lecture', 'diagnostic', 'diagnostic', 'lecture', 'lecture']);
    });

    it('refuse toujours une vue qui arrive dans ce working set sale : le HEAD retenu ne dispense pas de l’assertion des vues', async () => {
      const { client } = togglingClient(() => true, DIRTY);
      const db = client.open(dbOf('toggle'));
      await db.query("select id from issues as of 'HEAD' order by id"); // HEAD retenu
      toggle.sql(hostileView());
      try {
        const error = await db.query('select commit_hash from dolt_log').catch((err: unknown) => err);

        expect(error).toBeInstanceOf(StoredSqlError);
        expect((error as Error).message).toContain('« dolt_log » est une vue');
        expect(outFiles('toggle')).toEqual([]);
      } finally {
        toggle.sql('drop view if exists dolt_log');
        toggle.sql('drop table if exists wisps');
      }
    });
  });

  describe('un diagnostic aveugle (l’objet n’est plus là quand il passe) : le dernier essai nomme ce que son assertion a vu', () => {
    /** Le client de Dolt dont le diagnostic ne trouve rien (son premier temps rend « rien », le deuxième dit le working set propre, le troisième n'a pas lieu). */
    function blindDiagnosis() {
      const inner = createDoltClient();
      const client: DoltClient = {
        open(dir) {
          const db = inner.open(dir);
          return {
            dir,
            query: (sql, options) => db.query(sql, options),
            queryAll: async (sqls, options) => {
              if (isLearning(sqls) || sqls.some((sql) => sql.includes('as stored_sql'))) return queryAll(db, sqls, options);
              return sqls[0]?.startsWith('select table_name as view_name') ? [[], [], [], [{ working: 0, head: 0 }]] : [[{}], [], [{ n: '0' }]];
            },
          };
        },
      };
      return withStoredSqlCheck(client);
    }

    it('nomme les colonnes générées d’une table : cinq, puis les autres', async () => {
      const error = await blindDiagnosis().open(dbOf('many-cols')).query("select id from issues as of 'HEAD'").catch((err: unknown) => err);

      expect(error).toBeInstanceOf(StoredSqlError);
      expect((error as Error).message).toMatch(/colonne générée « g\d+ » de « issues »/);
      expect((error as Error).message).toContain(`et ${GENERATED_COLUMNS - 5} autres`);
      expect((error as StoredSqlError).objects).toHaveLength(GENERATED_COLUMNS);
    });

    it('nomme une vue de HEAD, que le working set a retirée : la première assertion ne la voit pas, la seconde si', async () => {
      const error = await blindDiagnosis().open(dbOf('head-view')).query('select commit_hash from dolt_log').catch((err: unknown) => err);

      expect(error).toBeInstanceOf(StoredSqlError);
      expect((error as Error).message).toContain('« dolt_log » est une vue, que l\'app pourrait lire à la place d\'une table (dans HEAD)');
      expect(outFiles('head-view')).toEqual([]);
    });
  });

  describe('les relevés du dernier essai, lancés pour de bon', () => {
    const READ = "select id from issues as of 'HEAD' order by id";
    /** Le commit de base que la vérification retient (le premier commit) : sans lui, la première assertion échoue toujours. */
    const baseOf = (name: string): string => dolt(env, dbOf(name), 'sql', '-r', 'csv', '-q', "select commit_hash from dolt_log('HEAD') order by commit_order asc limit 1").trim().split('\n')[1] ?? '';

    it('s’exécutent sur une base saine : cinq documents, puis ceux de la lecture', async () => {
      const raw = createDoltClient().open(dbOf('toggle'));

      const results = await queryAll(raw, [...storedSqlEvidence('', baseOf('toggle')), READ]);

      expect(results).toHaveLength(9);
      // ni vue, ni colonne générée, ni index fonctionnel, ni vue de HEAD ; les deux assertions rendent une ligne ; les deux `CREATE TABLE` en rendent cinq chacun (B-FI, bdesk-38k.74 round 3) :
      // une par table lue, toutes « ajoutées » par rapport au commit de base (`schemaCreateSql`, comme `nonlocalCount`).
      expect(results.slice(0, 8).map((rows) => rows.length)).toEqual([0, 0, 0, 1, 0, 1, 5, 5]);
      expect(results[8]).toEqual([{ id: 'a-1' }, { id: 'a-2' }]);
    });

    it('échouent, sur une base qui porte une vue, avec les lignes des relevés d’avant l’assertion qui a échoué : c’est ce qui nomme la vue', async () => {
      toggle.sql(`create view dolt_log as select 'x' as commit_hash, cast('2026-10-01 10:00:00' as datetime) as date from ${outfile(join(dbOf('toggle'), 'out-evidence.txt'))}`);
      try {
        const raw = createDoltClient().open(dbOf('toggle'));

        const error = await queryAll(raw, [...storedSqlEvidence('', baseOf('toggle')), READ]).catch((err: unknown) => err);

        expect(error).toBeInstanceOf(DoltQueryError);
        expect((error as Error).message).toMatch(/subquery returned more than 1 row/);
        const completed = (error as DoltQueryError).completed as Row[][];
        expect(completed[0]).toEqual([{ view_name: 'dolt_log' }]); // le relevé des vues, lu dans la transaction de l'assertion qui a échoué
        expect(completed[1]).toEqual([]); // aucune colonne générée
        expect(completed[2]).toEqual([]); // aucun index fonctionnel (bdesk-38k.74, round 3, B-FI)
        expect(completed).toHaveLength(3); // l'assertion des vues a arrêté le groupe : rien d'après
        expect(outFiles('toggle')).toEqual([]);
      } finally {
        toggle.sql('drop view dolt_log');
      }
    });
  });

  describe('une table qui porte des centaines de colonnes générées', () => {
    it('est refusée par une raison qui nomme cinq colonnes et compte les autres : la réponse ne grandit pas avec la base', async () => {
      const error = await projects.issues('many-cols').then(
        () => undefined,
        (err: unknown) => err,
      );

      expect(error).toBeInstanceOf(ProjectUnreadableError);
      const { reason } = error as ProjectUnreadableError;
      expect(reason).toMatch(/^SQL stocké dans la base, que Dolt exécuterait à la lecture : colonne générée « g\d+ » de « issues »/);
      expect(reason.match(/colonne générée/g)).toHaveLength(5);
      expect(reason).toContain(`et ${GENERATED_COLUMNS - 5} autres`);
      expect(reason.length).toBeLessThan(600);
    });

    it('l’est de même au scan des Projets, qui dit le Projet illisible avec la même raison bornée', async () => {
      const { projects: list } = await projects.list();

      const project = list.find((p) => p.id === 'many-cols');
      expect(project?.status).toBe('unreadable');
      expect(project?.reason).toContain(`et ${GENERATED_COLUMNS - 5} autres`);
      expect(project?.reason?.length).toBeLessThan(600);
    });
  });
});
