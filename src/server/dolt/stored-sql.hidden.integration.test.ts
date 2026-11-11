import { existsSync, mkdirSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createProjectService, ProjectUnreadableError } from '../projects/service';
import { dolt, hasBinary, isolatedDoltEnv, type Scratch } from '../testing/dolt-fixture';
import { type SqlServer, startSqlServer } from '../testing/dolt-server';
import { scratchDir } from '../testing/scratch';
import { beadsLikeDatabase, CANARY, outfile } from '../testing/stored-sql-fixture';
import { createDoltClient, type DoltClient, type DoltDatabase, DoltQueryError, queryAll } from './client';
import { readTicketHistories } from './history';
import { READ_ONLY_PREFIX } from './read-only';
import { readIssueBase, readIssueParts, readIssuePrefix } from './reader';
import { StoredSqlError, storedSqlPrelude, withStoredSqlCheck } from './stored-sql';

/**
 * Les vues que `information_schema.views` ne liste pas (B1 de la relecture de bdesk-38k.74). Une vue du working set dont le corps nomme une table que HEAD a et que le working set n'a
 * plus ne s'analyse pas contre le working set : `information_schema.views` l'omet, `information_schema.tables` la liste (`VIEW`). Mais `… as of 'HEAD'` résout cette même vue et
 * l'analyse contre HEAD, où la table existe : elle s'exécute. C'est la forme de toutes les lectures de l'app, et celle de la seconde assertion de la vérification, sur `dolt_schemas`.
 * L'assertion qui liait les vues par `information_schema.views` laissait passer :
 *
 *   hs   une vue `dolt_schemas` sur `zz` (dans HEAD seulement) : la vérification elle-même l'exécute, à chaque lecture et à chaque scan des Projets (B1a)
 *   hsl  la même, dont le corps fait échouer la vérification par une erreur de Dolt qui cite le contenu du fichier témoin : ce contenu devenait la raison du Projet illisible
 *   hv   une vue `labels` sur `lr` (dans HEAD seulement), working set sale : le diagnostic épinglait HEAD, puis la lecture exécutait la vue (B1b)
 *   hc   une vue `labels` sur une colonne d'`issues` que HEAD seul a
 *   hf   une vue `dolt_ſchemas` (U+017F, que Dolt lit comme `dolt_schemas`), cachée de même
 *
 * Embedded, `dolt sql` borne les fichiers au dossier de la base (`secure_file_priv`) : les vues écrivent dans ce dossier. Derrière un `dolt sql-server` (bd en mode server), rien ne borne
 * le fichier : elles écrivent HORS du dossier de la base, ce que les tests vérifient aussi. Les deux modes, sur de vraies bases Dolt, et par le service des Projets pour la raison du refus.
 */
const OUT = {
  hs: 'out-sch.txt',
  hsl: 'out-schl.txt',
  hv: 'out-hv.txt',
  hc: 'out-hc.txt',
  hf: 'out-fold.txt',
} as const;
type Scenario = keyof typeof OUT;
const SCENARIOS = Object.keys(OUT) as Scenario[];

/** Ce que chaque scénario cache : le nom de la vue, tel que la raison du refus le dit. */
const HIDDEN_NAME: Record<Scenario, string> = { hs: 'dolt_schemas', hsl: 'dolt_schemas', hv: 'labels', hc: 'labels', hf: 'dolt_ſchemas' };

describe.skipIf(!hasBinary('dolt')).each([['embedded'], ['server']] as const)('vues que information_schema.views ne liste pas, mode %s (bdesk-38k.74)', { timeout: 180_000 }, (mode) => {
  let env: NodeJS.ProcessEnv;
  let root: string;
  let outside: string;
  let folder: string;
  let server: SqlServer | undefined;
  let leakServer: SqlServer | undefined;
  let leakProject: string;

  /** La base du scénario : un dossier de `folder` (le dossier de données du serveur, en mode server). */
  const dbOf = (name: string) => join(folder, name);
  /** Où la vue écrit : le dossier de la base, que borne `secure_file_priv` sans serveur ; hors de la base derrière un serveur, que rien ne borne. */
  const outDir = (name: string) => (mode === 'embedded' ? dbOf(name) : outside);
  const target = (name: Scenario) => join(outDir(name), OUT[name]);
  const made = (name: Scenario) => readdirSync(outDir(name)).filter((file) => file.startsWith('out-'));
  /** Une lecture lancée directement par `dolt sql`, sans le garde ni la vérification : celle de l'app, telle que Dolt la reçoit (derrière le serveur s'il y en a un). */
  const direct = (name: Scenario, sql: string): string => dolt(env, dbOf(name), 'sql', '-r', 'json', '-q', READ_ONLY_PREFIX + sql);
  const rows = (name: Scenario, sql: string): string => dolt(env, dbOf(name), 'sql', '-r', 'csv', '-q', sql).trim();

  /**
   * Les scénarios, dans la base `dir` : HEAD porte la table ou la colonne que le corps de la vue nomme, le working set l'a retirée sans commit. `out` : le fichier que la vue écrit
   * quand elle s'exécute ; le témoin qu'elle lit est celui de `dir`.
   */
  const hostile: Record<Scenario, (db: Scratch, dir: string, out: string) => void> = {
    hs: (db, _dir, out) => {
      db.sql("create table zz (type varchar(64), name varchar(64)); insert into zz values ('x', 'y')");
      db.commit(2, 'zz dans HEAD');
      db.sql(`create view dolt_schemas as select z.type, z.name from zz z, (select count(*) as n from ${outfile(out)}) q; drop table zz`);
    },
    hsl: (db, dir) => {
      db.sql("create table zz (type varchar(64), name varchar(64)); insert into zz values ('view', 'x')");
      db.commit(2, 'zz dans HEAD');
      // Le corps rend un nom qu'`json_extract` refuse (le texte du fichier n'est pas du JSON) : l'erreur de Dolt le cite, entre guillemets.
      db.sql(`create view dolt_schemas as select z.type, json_unquote(json_extract(concat(z.name, load_file('${join(dir, 'canary.txt')}')), '$')) as name from zz z; drop table zz`);
    },
    hv: (db, dir, out) => {
      db.sql('create table lr (issue_id varchar(255) not null, label varchar(255) not null, primary key (issue_id, label)); insert into lr select issue_id, label from labels');
      db.commit(2, 'lr dans HEAD');
      db.sql(
        `drop table labels; create view labels as select l.issue_id, concat(l.label, ':', load_file('${join(dir, 'canary.txt')}')) as label from lr l, (select count(*) as n from ${outfile(out)}) q; drop table lr`,
      );
    },
    hc: (db, dir, out) => {
      db.sql('alter table issues add column title2 varchar(50)');
      db.commit(2, 'issues.title2 dans HEAD');
      db.sql(
        `rename table labels to labels_old; create view labels as select i.id as issue_id, concat(coalesce(i.title2, ''), load_file('${join(dir, 'canary.txt')}')) as label from issues i, (select count(*) as n from ${outfile(out)}) q; alter table issues drop column title2`,
      );
    },
    hf: (db, _dir, out) => {
      db.sql("create table zz (type varchar(64), name varchar(64)); insert into zz values ('x', 'y')");
      db.commit(2, 'zz dans HEAD');
      db.sql(`create view \`dolt_ſchemas\` as select z.type, z.name from zz z, (select count(*) as n from ${outfile(out)}) q; drop table zz`);
    },
  };
  /** La lecture de l'app qui exécute la vue (hors vérification) : `… as of 'HEAD'`. */
  const unchecked: Record<Scenario, string> = {
    hs: "select count(*) as n from dolt_schemas as of 'HEAD'",
    hsl: "select count(*) as n from dolt_schemas as of 'HEAD'",
    hv: "select issue_id, label from labels as of 'HEAD'",
    hc: "select issue_id, label from labels as of 'HEAD'",
    hf: "select count(*) as n from dolt_schemas as of 'HEAD'",
  };

  beforeAll(async () => {
    env = isolatedDoltEnv();
    root = realpathSync(scratchDir('bdesk-stored-sql-hidden-'));
    outside = join(root, 'outside');
    mkdirSync(outside, { recursive: true });
    // Embedded : une base par dossier, sans serveur. Server : toutes les bases sous un dossier de données, que sert un seul `dolt sql-server` (le `.beads/dolt` d'un Projet de bd).
    folder = mode === 'embedded' ? join(root, 'dbs') : join(root, 'srv', '.beads', 'dolt');
    mkdirSync(folder, { recursive: true });
    for (const name of SCENARIOS) {
      hostile[name](beadsLikeDatabase(env, dbOf(name)), dbOf(name), target(name));
      await new Promise((resolve) => setImmediate(resolve)); // rendre la main entre deux bases (voir `stored-sql.integration.test.ts`)
    }
    // Le Projet du service des Projets : `hsl`, dont l'erreur de Dolt cite le contenu du fichier témoin.
    const beads = join(root, 'projets', 'cache', '.beads');
    leakProject = join(beads, mode === 'embedded' ? 'embeddeddolt' : 'dolt');
    mkdirSync(beads, { recursive: true });
    writeFileSync(join(beads, 'metadata.json'), JSON.stringify({ backend: 'dolt', database: 'dolt', dolt_mode: mode, dolt_database: 'tdb' }));
    hostile.hsl(beadsLikeDatabase(env, join(leakProject, 'tdb')), join(leakProject, 'tdb'), join(mode === 'embedded' ? join(leakProject, 'tdb') : outside, OUT.hsl));
    if (mode === 'server') {
      server = await startSqlServer(env, folder, { databaseDir: dbOf('hs') });
      leakServer = await startSqlServer(env, leakProject, { databaseDir: join(leakProject, 'tdb') });
    }
  }, 600_000);

  afterAll(async () => {
    await server?.stop();
    await leakServer?.stop();
  }, 60_000);

  const checked = (name: Scenario): DoltDatabase => withStoredSqlCheck(createDoltClient({ retries: 0 })).open(dbOf(name));
  /** Toutes les lectures de l'app : le préfixe (le scan des Projets), le tableau, la fiche et l'historique (les métriques, la Chronologie). */
  const reads = (db: DoltDatabase): Record<string, () => Promise<unknown>> => ({
    préfixe: () => readIssuePrefix(db),
    tableau: () => readIssueBase(db),
    fiche: () => readIssueParts(db, 'a-1'),
    historique: () => readTicketHistories(db),
  });

  describe('les faits : ce que Dolt fait sans la vérification', () => {
    it.each(SCENARIOS)('%s : information_schema.views ne liste pas la vue cachée ; information_schema.tables la liste, comme une vue', (name) => {
      const hidden = HIDDEN_NAME[name];
      const inViews = rows(name, `select count(*) as n from information_schema.views where table_schema = database() and table_name = '${hidden}'`);
      const inTables = rows(name, `select table_type as type from information_schema.tables where table_schema = database() and table_name = '${hidden}'`);

      expect(inViews).toBe('n\n0');
      expect(inTables).toBe('type\nVIEW');
    });

    it.each(['hs', 'hv', 'hc', 'hf'] as const)('%s : la lecture de l’app, `… as of \'HEAD\'`, exécute la vue cachée et crée le fichier', (name) => {
      const answer = direct(name, unchecked[name]);

      expect(made(name)).toContain(OUT[name]);
      if (name === 'hv' || name === 'hc') expect(answer).toContain(CANARY); // le contenu du fichier témoin devient la valeur lue
      for (const file of made(name)) rmSync(join(outDir(name), file));
    });

    it('hsl : la vérification, si la vue lui échappait, citerait le contenu du fichier dans l’erreur de Dolt', () => {
      let message = '';
      try {
        direct('hsl', unchecked.hsl);
      } catch (err) {
        message = String((err as { stderr?: unknown }).stderr);
      }

      expect(message).toContain(CANARY);
    });
  });

  describe('l’app refuse la base, quelle que soit la lecture', () => {
    it.each(SCENARIOS)('%s : le préfixe, le tableau, la fiche et l’historique sont refusés en nommant la vue, sans fichier créé ni contenu cité', async (name) => {
      for (const [label, read] of Object.entries(reads(checked(name)))) {
        const error = await read().then(
          () => undefined,
          (err: unknown) => err,
        );

        expect(error, `${name} / ${label}`).toBeInstanceOf(StoredSqlError);
        const message = (error as Error).message;
        expect(message, `${name} / ${label}`).toContain(`« ${HIDDEN_NAME[name]} » est une vue`);
        expect(message).not.toContain(CANARY);
        expect(message).not.toContain(OUT[name]);
        expect(message).not.toContain(outDir(name));
      }
      expect(made(name), `${name} : fichiers créés par les lectures de l'app`).toEqual([]);
      if (mode === 'server') expect(readdirSync(outside).filter((file) => file.startsWith('out-'))).toEqual([]); // hors de la base non plus
    });
  });

  // Défense en profondeur. Si une vue échappait de nouveau à l'assertion des vues, elle s'exécuterait dans une instruction de la vérification, et l'erreur de Dolt, qui cite le contenu du fichier,
  // deviendrait la raison du Projet illisible (B1a, `hsl`). Le client ci-dessous laisse passer la première assertion, comme le faisait l'ancienne : la seconde exécute la vue cachée.
  describe('une vue qui échapperait à l’assertion des vues', () => {
    /** Le début de la première assertion, avec ou sans commit de base : la seconde (`a.c + b.c + d.c`) en diffère. */
    const FIRST_ASSERTION = 'select (select 1 union all select 1 from dual where t.c';
    const blind = (): DoltClient => {
      const inner = createDoltClient({ retries: 0 });
      return {
        open(dir) {
          const db = inner.open(dir);
          // La première assertion, avec ou sans commit de base (`storedViewsAssertion`), est remplacée par une instruction qui ne regarde rien : celle de l'ancien code.
          const blindFirst = (sql: string) => (sql.startsWith(FIRST_ASSERTION) ? 'select 1 as stored_views' : sql);
          return { dir, query: (sql, options) => db.query(sql, options), queryAll: (sqls, options) => queryAll(db, sqls.map(blindFirst), options) };
        },
      };
    };

    it('hsl : sans la vérification, l’erreur de Dolt cite le contenu du fichier (le fait que la parade doit neutraliser)', async () => {
      const raw = blind().open(dbOf('hsl'));

      const error = await queryAll(raw, [...storedSqlPrelude(''), "select id from issues as of 'HEAD'"]).catch((err: unknown) => err);

      expect(error).toBeInstanceOf(DoltQueryError);
      expect((error as Error).message).toContain(CANARY);
    });

    it('hsl : le client vérifié ne reprend pas le texte de Dolt : un message fixe, et le préfixe, le tableau, la fiche, l’historique le disent tous', async () => {
      const db = withStoredSqlCheck(blind()).open(dbOf('hsl'));

      for (const [label, read] of Object.entries(reads(db))) {
        const error = await read().then(
          () => undefined,
          (err: unknown) => err,
        );

        expect(error, label).toBeInstanceOf(DoltQueryError);
        const message = (error as Error).message;
        expect(message, label).toMatch(/^La vérification du SQL stocké n'a pas pu s'achever/);
        expect(message).not.toContain(CANARY);
        expect(message).not.toMatch(/json_extract|Invalid JSON/);
      }
    });
  });

  describe('le service des Projets, tel que l’app le construit', () => {
    it('hsl : le Projet est illisible au scan et à la lecture, et sa raison ne cite pas le contenu du fichier', async () => {
      const projects = createProjectService({ roots: [join(root, 'projets')], projects: [], hiddenProjects: [] }, { rescanIntervalMs: 0 });

      const { projects: list } = await projects.list();
      const project = list.find((p) => p.id === 'cache');
      const error = await projects.issues('cache').then(
        () => undefined,
        (err: unknown) => err,
      );

      expect(project?.status).toBe('unreadable');
      expect(project?.reason).toContain('« dolt_schemas » est une vue');
      expect(error).toBeInstanceOf(ProjectUnreadableError);
      for (const reason of [project?.reason ?? '', (error as ProjectUnreadableError).reason]) {
        expect(reason).not.toContain(CANARY);
        expect(reason).not.toMatch(/Invalid JSON|json_extract/);
      }
      expect(JSON.stringify(list)).not.toContain(CANARY);
      expect(existsSync(join(leakProject, 'tdb', OUT.hs))).toBe(false);
    });
  });
});
