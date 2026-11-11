import { existsSync, mkdirSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dolt, hasBinary, isolatedDoltEnv, type Scratch } from '../testing/dolt-fixture';
import { type SqlServer, startSqlServer } from '../testing/dolt-server';
import { scratchDir } from '../testing/scratch';
import { beadsLikeDatabase, CANARY, outfile } from '../testing/stored-sql-fixture';
import { createDoltClient, type DoltDatabase } from './client';
import { readTicketHistories } from './history';
import { readIssueBase, readIssueParts, readIssuePrefix } from './reader';
import { withStoredSqlCheck } from './stored-sql';

/**
 * Les mécanismes de Dolt 2.5.0 qui rangent du SQL dans une base sans changer ce qu'une lecture évalue (bdesk-38k.74, revue des mécanismes qui changent la résolution d'un nom de table
 * ou ce qu'une lecture évalue). Les vues, les colonnes générées et `dolt_nonlocal_tables` sont refusées (`stored-sql.integration.test.ts`, `stored-sql.hidden.integration.test.ts`,
 * `stored-sql.nonlocal.integration.test.ts`). Ceux-ci ne s'exécutent pas aux lectures de l'app : une charge qui crée un fichier, ou qui fait échouer toute évaluation, est rangée dans
 * chacun, commitée, et l'app lit la base comme une autre. Chaque charge est d'abord lancée comme Dolt la lance (le fait : elle est vivante), puis les lectures de l'app ne la
 * lancent pas.
 *
 *   ig  `dolt_ignore` : des motifs qui couvrent tout (`%`, `dolt\\_%`) ; bd en pose neuf, pour ses tables locales ; ils ne règlent que ce que `dolt add` suit
 *   qc  `dolt_query_catalog` : une requête enregistrée, que seul `dolt sql -x <nom>` lance
 *   pr  une procédure stockée, que seul `call` lance (et le garde de lecture seule refuse `call`)
 *   tg  un déclencheur, qui ne part que d'une écriture
 *   ev  un événement, que le planificateur lance : la lecture de l'app ne l'a pas vu partir (voir plus bas)
 *   ts  `dolt_tests` : une requête de test, que seule `dolt_test_run` lance
 *   df  une valeur par défaut calculée, évaluée à l'écriture : pas exécutée à la lecture, mais refusée quand même depuis la liste fermée du round 3 (B-FI) — `(json_extract(…))` n'est
 *       pas la forme exacte, `(json_object())`, qu'elle admet pour un défaut entre parenthèses
 *   ck  une contrainte `check`, évaluée à l'écriture : refusée de même, `label <> 'POISON' or json_extract(…) is null` n'étant pas dans la grammaire fermée des `check` (aucun appel de fonction)
 *   cf  les réglages locaux de Dolt (variables de session persistées, dont `init_connect` qui s'exécute à chaque connexion ; contrôle des branches) : deux fichiers locaux, que `push` et `clone` ne
 *       transmettent pas (le dernier `describe` de ce fichier)
 *
 * Derrière un `dolt sql-server` (bd en mode server), le fichier est créé hors du dossier de la base si la charge s'exécute : rien ne borne `secure_file_priv`.
 */
const SCENARIOS = ['ba', 'ig', 'qc', 'pr', 'tg', 'ev', 'ts', 'df', 'ck'] as const;
type Scenario = (typeof SCENARIOS)[number];
/** Celles que la liste fermée du round 3 (B-FI, `create-table.ts`) laisse lire : `df` et `ck` ne sont pas sur la liste, même si rien en elles ne s'exécute à la lecture (voir plus bas). */
const READS_IDENTICALLY = ['ba', 'ig', 'qc', 'pr', 'tg', 'ev', 'ts'] as const satisfies readonly Scenario[];
const OUT = (name: Scenario) => `out-${name}.txt`;
/** Une charge vivante : l'exécuter crée le fichier. */
const writes = (file: string) => `select count(*) from ${outfile(file)}`;
/** Une charge qui fait échouer toute évaluation : le texte JSON est illisible. */
const FAILS = "json_extract('{', '$')";

describe.skipIf(!hasBinary('dolt')).each([['embedded'], ['server']] as const)('mécanismes de Dolt qui portent du SQL sans que les lectures l’évaluent, mode %s (bdesk-38k.74)', { timeout: 240_000 }, (mode) => {
  let env: NodeJS.ProcessEnv;
  let root: string;
  let outside: string;
  let folder: string;
  let server: SqlServer | undefined;

  const dbOf = (name: string) => join(folder, name);
  /** Où une charge qui s'exécute écrit : le dossier de la base, que borne `secure_file_priv` sans serveur ; hors de la base derrière un serveur, que rien ne borne. */
  const outDir = (name: Scenario) => (mode === 'embedded' ? dbOf(name) : outside);
  const target = (name: Scenario) => join(outDir(name), OUT(name));
  const created = (name: Scenario) => readdirSync(outDir(name)).filter((file) => file === OUT(name));
  const run = (name: Scenario, sql: string): string => dolt(env, dbOf(name), 'sql', '-q', sql);
  const rows = (name: Scenario, sql: string): string => dolt(env, dbOf(name), 'sql', '-r', 'csv', '-q', sql).trim();
  const clear = (name: Scenario) => {
    for (const file of created(name)) rmSync(join(outDir(name), file));
  };

  const setup: Record<Scenario, (db: Scratch, out: string) => void> = {
    ba: () => undefined,
    ig: (db) => {
      db.sql("insert into dolt_ignore values ('%', true), ('dolt_%', true), ('zz''; drop table issues; --', true)");
      db.commit(2, 'dolt_ignore couvre tout');
    },
    qc: (db, out) => {
      db.sql(`insert into dolt_query_catalog (id, display_order, name, query, description) values ('hostile', 1, 'hostile', '${writes(out).replace(/'/g, "''")}', 'une requête enregistrée')`);
      db.commit(2, 'une requête enregistrée');
    },
    pr: (db, out) => {
      db.sql(`create procedure hostile() ${writes(out)}`);
      db.commit(2, 'une procédure');
    },
    tg: (db, out) => {
      db.sql(`create trigger hostile before insert on labels for each row set new.label = (${writes(out)})`);
      db.commit(2, 'un déclencheur');
    },
    ev: (db) => {
      db.sql('create table evlog (n int, at timestamp default current_timestamp)');
      db.sql('create event hostile on schedule every 1 second do insert into evlog (n) values (1)'); // part une fois, à sa création
      db.sql('delete from evlog');
      db.commit(2, 'un événement');
    },
    ts: (db, out) => {
      db.sql(`insert into dolt_tests values ('hostile', 'g', '${writes(out).replace(/'/g, "''")}', 'expected_single_value', '==', '0')`);
      db.commit(2, 'un test');
    },
    df: (db) => {
      db.sql(`alter table labels alter column label set default (${FAILS})`);
      db.commit(2, 'une valeur par défaut qui échoue');
    },
    ck: (db) => {
      // Évaluée à l'écriture, et sur les lignes que la contrainte vérifie en s'ajoutant : celles de la base ont un libellé qui n'est pas `POISON`, la partie qui échoue n'est pas évaluée.
      db.sql(`alter table labels add constraint hostile check (label <> 'POISON' or ${FAILS} is null)`);
      db.commit(2, 'une contrainte qui échoue');
    },
  };

  beforeAll(async () => {
    env = isolatedDoltEnv();
    root = realpathSync(scratchDir('bdesk-stored-sql-mechanisms-'));
    outside = join(root, 'outside');
    mkdirSync(outside, { recursive: true });
    folder = mode === 'embedded' ? join(root, 'dbs') : join(root, 'srv', '.beads', 'dolt');
    mkdirSync(folder, { recursive: true });
    for (const name of SCENARIOS) {
      writeFileSync(join(outside, 'secret.txt'), `${CANARY}\n`);
      setup[name](beadsLikeDatabase(env, dbOf(name)), target(name));
      await new Promise((resolve) => setImmediate(resolve)); // rendre la main entre deux bases (voir `stored-sql.integration.test.ts`)
    }
    if (mode === 'server') server = await startSqlServer(env, folder, { databaseDir: dbOf('ba') });
  }, 600_000);

  afterAll(async () => {
    await server?.stop();
  }, 60_000);

  const checked = (name: Scenario): DoltDatabase => withStoredSqlCheck(createDoltClient({ retries: 0 })).open(dbOf(name));
  const plain = (name: Scenario): DoltDatabase => createDoltClient({ retries: 0 }).open(dbOf(name));
  /** Toutes les lectures de l'app : le préfixe (le scan des Projets), le tableau, la fiche et l'historique (les métriques, la Chronologie). */
  const reads = (db: DoltDatabase) => ({
    préfixe: () => readIssuePrefix(db),
    tableau: () => readIssueBase(db),
    fiche: () => readIssueParts(db, 'a-1'),
    historique: () => readTicketHistories(db),
  });

  describe('les faits : la charge est vivante quand Dolt la lance lui-même', () => {
    it.each(['qc', 'pr', 'tg', 'ts'] as const)('%s : lancée comme Dolt la lance, elle crée le fichier', (name) => {
      clear(name);
      if (name === 'qc') dolt(env, dbOf(name), 'sql', '-x', 'hostile'); // une requête enregistrée se lance par son nom
      if (name === 'pr') run(name, 'call hostile()');
      if (name === 'tg') run(name, "start transaction; insert into labels values ('a-2', 'x'); rollback"); // le déclencheur part de l'écriture, qu'on annule
      if (name === 'ts') run(name, "select * from dolt_test_run('hostile')");

      expect(created(name), name).toEqual([OUT(name)]);
      clear(name);
    });

    it('ev : l’événement part une fois, à sa création, puis le planificateur ne le relance ni pendant une lecture de plusieurs secondes ni pendant que le serveur tourne', () => {
      rows('ev', 'select sleep(3)'); // un processus qui vit trois secondes (derrière un serveur : le serveur vit)

      expect(rows('ev', 'select count(*) as n from evlog')).toBe('n\n0');
      expect(rows('ev', 'select count(*) as n from information_schema.events')).toBe('n\n1'); // l'événement est bien là
    });

    it('df et ck : la valeur par défaut et la contrainte s’évaluent à l’écriture, et font échouer l’insertion', () => {
      expect(() => run('df', "start transaction; insert into labels (issue_id) values ('a-2')"), 'df').toThrow(/json|JSON/i);
      expect(() => run('ck', "start transaction; insert into labels (issue_id, label) values ('a-2', 'POISON')"), 'ck').toThrow(/json|JSON/i);
    });
  });

  describe('les lectures de l’app ne l’évaluent pas : la base se lit comme une autre', () => {
    it.each(READS_IDENTICALLY)('%s : toutes les lectures réussissent, rendent ce que le client sans vérification rend, et ne créent aucun fichier', async (name) => {
      clear(name);
      const withCheck = reads(checked(name));
      const without = reads(plain(name));

      for (const label of Object.keys(withCheck) as (keyof typeof withCheck)[]) {
        const a = await withCheck[label]().then(
          (value) => ({ value }),
          (error: unknown) => ({ error }),
        );
        const b = await without[label]().then(
          (value) => ({ value }),
          (error: unknown) => ({ error }),
        );

        expect((a as { error?: unknown }).error, `${name} / ${label}`).toBeUndefined();
        expect((b as { error?: unknown }).error, `${name} / ${label} sans vérification`).toBeUndefined();
        expect(JSON.stringify((a as { value?: unknown }).value), `${name} / ${label}`).toBe(JSON.stringify((b as { value?: unknown }).value));
        expect(JSON.stringify((a as { value?: unknown }).value)).not.toContain(CANARY);
      }
      expect(created(name), `${name} : fichiers créés par les lectures de l'app`).toEqual([]);
      if (mode === 'server') expect(readdirSync(outside).filter((file) => file.startsWith('out-')), 'hors de la base non plus').toEqual([]);
    });

    // bdesk-38k.74, round 3, B-FI : `df` et `ck` n'exécutent jamais rien à la lecture (voir « les faits », plus bas), mais la liste fermée du round 3 ne reconnaît ni leur défaut
    // entre parenthèses ni leur `check` : refusés, comme tout ce qui n'est pas sur la liste, sans qu'aucun fichier ne soit créé ni que le contenu du JSON invalide soit cité.
    it.each(['df', 'ck'] as const)('%s : refusée par la liste fermée (jamais parce qu’elle s’exécuterait), sans fichier ni contenu cité', async (name) => {
      clear(name);
      for (const [label, read] of Object.entries(reads(checked(name)))) {
        const value = await read().then(
          (v) => ({ value: v }),
          (error: unknown) => ({ error }),
        );

        expect((value as { value?: unknown }).value, `${name} / ${label}`).toBeUndefined();
        const error = (value as { error?: unknown }).error as Error | undefined;
        expect(error?.name, `${name} / ${label}`).toBe('StoredSqlError');
        expect(error?.message, `${name} / ${label}`).toContain('labels');
        expect(error?.message).not.toMatch(/json|invalid/i);
      }
      expect(created(name), `${name} : fichiers créés par les lectures de l'app`).toEqual([]);
    });

    it('ev : après les lectures, l’événement n’a rien écrit', async () => {
      for (const read of Object.values(reads(checked('ev')))) await read();
      await new Promise((resolve) => setTimeout(resolve, 2500)); // plus que l'intervalle de l'événement

      expect(rows('ev', 'select count(*) as n from evlog')).toBe('n\n0');
    });

    it('dolt_ignore, même quand ses motifs couvrent tout, ne change rien à ce que l’app lit : ig et ba rendent les mêmes tickets (les dates de création, elles, sont celles de chaque base)', async () => {
      const [a, b] = await Promise.all([readIssueBase(checked('ig')), readIssueBase(checked('ba'))]);

      expect(a.summaries.map(({ id, title, status }) => [id, title, status])).toEqual(b.summaries.map(({ id, title, status }) => [id, title, status]));
      expect(existsSync(join(outDir('ig'), OUT('ig')))).toBe(false);
    });
  });
});

describe.skipIf(!hasBinary('dolt'))('cf : les réglages locaux de Dolt ne voyagent pas avec la base (bdesk-38k.74)', { timeout: 120_000 }, () => {
  /**
   * Les variables de session persistées (`sqlserver.global.*` : `init_connect` s'exécute à chaque connexion, `dolt_show_system_tables` change ce que `information_schema` liste) sont lues dans
   * `.dolt/config.json`, et le contrôle des branches dans `.doltcfg/` : des fichiers du dossier de la base, non des données qu'elle versionne. Un collaborateur ne les pose donc pas par le remote.
   */
  it('une base dont la configuration locale porte des variables persistées et une règle de contrôle des branches, poussée puis clonée, donne un clone qui n’a ni l’un ni l’autre', () => {
    const env = isolatedDoltEnv();
    const root = realpathSync(scratchDir('bdesk-stored-sql-config-'));
    const [source, remote, clone] = ['source', 'remote', 'clone'].map((name) => join(root, name)) as [string, string, string];
    mkdirSync(remote, { recursive: true });
    beadsLikeDatabase(env, source);
    const variable = (dir: string, name: string): string => String((JSON.parse(dolt(env, dir, 'sql', '-r', 'json', '-q', `select @@${name} as v`)) as { rows: { v: unknown }[] }).rows[0]?.v);
    const rules = (dir: string): string => dolt(env, dir, 'sql', '-r', 'csv', '-q', 'select count(*) as n from dolt_branch_control').trim();

    dolt(env, source, 'config', '--local', '--add', 'sqlserver.global.init_connect', 'set @x = 1');
    dolt(env, source, 'config', '--local', '--add', 'sqlserver.global.dolt_show_system_tables', '1');
    dolt(env, source, 'sql', '-q', "insert into dolt_branch_control values ('%', 'main', 'rev', '%', 'read')");
    // Le fait : la source les porte.
    expect(variable(source, 'init_connect')).toBe('set @x = 1');
    expect(variable(source, 'dolt_show_system_tables')).toBe('1');
    expect(existsSync(join(source, '.doltcfg'))).toBe(true);
    expect(rules(source)).toBe('n\n2');

    dolt(env, source, 'remote', 'add', 'origin', `file://${remote}`);
    dolt(env, source, 'push', 'origin', 'main');
    dolt(env, root, 'clone', `file://${remote}`, clone);

    expect(variable(clone, 'init_connect')).toBe('');
    expect(variable(clone, 'dolt_show_system_tables')).toBe('0');
    expect(existsSync(join(clone, '.doltcfg'))).toBe(false);
    expect(rules(clone)).toBe('n\n1'); // la règle par défaut, seule
    expect(dolt(env, clone, 'sql', '-r', 'csv', '-q', 'select count(*) as n from issues').trim()).toBe('n\n2'); // les données, elles, ont voyagé
  });
});
