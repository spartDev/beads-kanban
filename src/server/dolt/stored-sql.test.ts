import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { isAbortError } from '../abort';
import { fakeDolt, fakeDoltRoot } from '../testing/fake-dolt';
import { tableReads } from '../testing/reads-at-head';
import { createDoltClient, type DoltClient, type DoltDatabase, DoltQueryError, DoltTextError, type QueryOptions, type Row } from './client';
import { readTicketHistories } from './history';
import { assertReadOnly } from './read-only';
import { readHead, readIssueBase, readIssueParts, readIssuePrefix } from './reader';
import {
  createCheckedDoltClient,
  MAX_NAMED_OBJECTS,
  readsNoTable,
  revisionTablesSql,
  schemaCreateSql,
  STORED_SQL_NAMES,
  STORED_SQL_SYSTEM_TABLES,
  STORED_SQL_TABLES,
  StoredSqlError,
  storedSqlAssertion,
  storedSqlEvidence,
  storedSqlInSource,
  storedSqlPrelude,
  storedViewsAssertion,
  withStoredSqlCheck,
} from './stored-sql';

const HASH = 'k9d2m1q3v7a4b5c6e8f0g1h2i3j4k5l6';
/** Le commit de base d'une base d'essai (un hash de Dolt : trente-deux caractères en base 32) : celui que la vérification retient pour compter ce que `dolt_nonlocal_tables` porte. */
const BASE = 'b1c2d3e4f5g6h7i8j9k0l1m2n3o4p5q6';
/** Le commit d'ancre d'une époque, dans les essais de B-FI (un hash de Dolt : trente-deux caractères en base 32). */
const COMMIT_FOR_ERA = 'm1n2o3p4q5r6s7t8u9v0a1b2c3d4e5f6';

/** La raison d'une table dont la comparaison ne rend aucune ligne (bdesk-38k.74, round 4, m2), après le nom de la table (« « labels » (dans HEAD) : … »). */
const MISSING = "aucune définition de table lue par la comparaison : la table manque, ou la comparaison est incomplète";

/** Le `CREATE TABLE` sain d'une table, le texte que `dolt_schema_diff` rend (avec son point-virgule final). */
const CLEAN_TABLE = (name: string): string => `CREATE TABLE \`${name}\` (\`id\` varchar(255) NOT NULL, PRIMARY KEY (\`id\`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;`;
/**
 * Ce que `schemaCreateSql` rend (bdesk-38k.74, round 4, m2) : **une ligne par table attendue**, `expected` (le nom que la requête écrit elle-même), `tbl` et `stmt` (ce que `dolt_schema_diff` en dit : absents
 * quand il n'a aucune ligne pour elle). `overrides` remplace la ligne d'une table (la sienne est trouvée par `tbl`, minuscules) ; `missing` la rend absente de la comparaison.
 */
const schemaRows = (overrides: readonly Row[] = [], missing: readonly string[] = []): Row[] =>
  STORED_SQL_TABLES.flatMap((name): Row[] => {
    if (missing.includes(name)) return [{ expected: name }];
    const own = overrides.filter((row) => String(row.tbl).toLowerCase() === name);
    return own.length > 0 ? own.map((row) => ({ expected: name, ...row })) : [{ expected: name, tbl: name, stmt: CLEAN_TABLE(name) }];
  });

describe('les assertions qui précèdent chaque lecture', () => {
  it('passent le garde de lecture seule : le client les soumet comme toute lecture, avec ou sans HEAD retenu', () => {
    expect(() => assertReadOnly(storedViewsAssertion())).not.toThrow();
    expect(() => assertReadOnly(storedViewsAssertion(BASE))).not.toThrow();
    expect(() => assertReadOnly(storedSqlAssertion())).not.toThrow();
    expect(() => assertReadOnly(storedSqlAssertion(HASH))).not.toThrow();
    expect(storedSqlPrelude(HASH, BASE)).toEqual([storedViewsAssertion(BASE), storedSqlAssertion(HASH), schemaCreateSql(BASE, 'WORKING'), schemaCreateSql(BASE, 'HEAD')]);
    expect(storedSqlPrelude(HASH)).toEqual([storedViewsAssertion(undefined), storedSqlAssertion(HASH)]); // sans commit de base : pas encore de `CREATE TABLE` à lire non plus
  });

  it('nomment chaque table que l’app lit, et chaque table système qu’une vue pourrait masquer', () => {
    const views = storedViewsAssertion();

    for (const name of STORED_SQL_NAMES) expect(views).toContain(`'${name}'`);
    expect(STORED_SQL_NAMES).toEqual([...STORED_SQL_TABLES, ...STORED_SQL_SYSTEM_TABLES]);
  });

  it('sont chacune une seule instruction, sans point-virgule', () => {
    expect(storedViewsAssertion()).not.toContain(';');
    expect(storedSqlAssertion()).not.toContain(';');
  });

  it('la première ne lit que `information_schema.tables`, hors des tables de base : Dolt y liste toute vue, même celle qu’il ne sait pas analyser dans le working set (bdesk-38k.74) ; elle nomme les deux tables système que la seconde lit', () => {
    const first = storedViewsAssertion();
    const second = storedSqlAssertion();

    expect(first).toContain('from information_schema.tables');
    expect(first).toContain("(table_type is null or table_type <> 'BASE TABLE')"); // tout ce qui n'est pas une table de base, un type nul compris
    // `information_schema.views` n'est pas lu : il omet une vue dont le corps nomme une table que HEAD a et que le working set n'a plus, et `… as of 'HEAD'` l'exécute (B1 de la relecture de .74).
    expect(first).not.toContain('information_schema.views');
    // (`dual` : la table sans table des `select … from dual where …`, que le filet des lectures prend pour une table.)
    // `statistics` : les index fonctionnels du working set (bdesk-38k.74, round 3, B-FI), lus de même sans être analysés ni exécutés (mesuré).
    expect(tableReads(first).map(({ table }) => table).filter((table) => table !== 'dual')).toEqual(['tables', 'statistics']);
    // Chaque table que la seconde lit hors d'`information_schema` est nommée par la première (`dolt_status` et `dolt_schemas`, tables système que `create view` peut masquer).
    const masquable = tableReads(second)
      .map(({ table }) => table)
      .filter((table) => table !== 'columns' && table !== 'dual');
    expect(masquable.sort()).toEqual(['dolt_schemas', 'dolt_status']);
    for (const table of masquable) expect(first).toContain(`'${table}'`);
  });

  // B-NL (relecture finale de bdesk-38k.74). Une ligne de `dolt_nonlocal_tables` mène un nom de table vers une autre table, et la table elle-même se laisse mener ailleurs par une ligne
  // qui vise son nom : elle ne se lit donc pas par son nom. La première assertion en compte ce qu'elle porte par `dolt_schema_diff` et `dolt_diff_summary`, deux fonctions de table qui
  // comparent deux racines sans résoudre aucun nom, par rapport à un commit où elle n'est pas (le commit de base).
  it('la première, avec le commit de base, compte ce que `dolt_nonlocal_tables` porte dans le working set et dans HEAD, sans résoudre aucun nom de table', () => {
    const sql = storedViewsAssertion(BASE);

    expect(sql).not.toContain(';');
    for (const to of ['WORKING', 'HEAD']) {
      // `lower(...)` : bdesk-38k.74 round 3, R1 — `to_table_name` est en collation binaire, Dolt résout la table sans tenir compte de la casse.
      expect(sql).toContain(`from dolt_schema_diff('${BASE}', '${to}') s where lower(s.to_table_name) = 'dolt_nonlocal_tables'`);
      expect(sql).toContain(`from dolt_diff_summary('${BASE}', '${to}') d where lower(d.to_table_name) = 'dolt_nonlocal_tables' and d.data_change = 0`);
    }
    // La table, ajoutée par rapport au commit de base (`from_table_name` vide), est vide si `dolt_diff_summary` la montre sans changement de données : une table qu'il ne montre pas
    // (`dolt_ignore` cache les tables ajoutées ou supprimées de ce nom : mesuré) compte comme non vide.
    expect(sql).toContain("(s.from_table_name <> '' or not exists (select 1 from dolt_diff_summary(");
    // Jamais `from dolt_nonlocal_tables` : lue par son nom, elle se cacherait d'elle-même (mesuré), et ses lignes ne se liraient pas.
    expect(sql).not.toMatch(/from\s+dolt_nonlocal_tables/);
    expect(tableReads(sql).map(({ table }) => table).filter((table) => table !== 'dual').sort()).toEqual(['dolt_diff_summary', 'dolt_diff_summary', 'dolt_schema_diff', 'dolt_schema_diff', 'statistics', 'tables']);
  });

  it('sans commit de base, elle échoue toujours : on ne sait pas encore ce que la table porte, et le diagnostic le cherche', () => {
    expect(storedViewsAssertion()).toContain('where t.c + x.c + 1 > 0');
    expect(storedViewsAssertion(BASE)).toContain('where t.c + x.c + w.c + h.c > 0');
    expect(storedViewsAssertion(BASE)).not.toContain('t.c + x.c + 1 > 0');
  });

  it('met le commit de base en chaîne dont les apostrophes sont doublées : rien de ce qu’il porte ne devient du SQL', () => {
    expect(storedViewsAssertion("x' or 1 = 1 --")).toContain("dolt_schema_diff('x'' or 1 = 1 --', 'WORKING')");
    expect(storedViewsAssertion(BASE).split(`'${BASE}'`)).toHaveLength(1 + 4); // quatre fois : deux fonctions, deux racines
  });

  it('la seconde lit les vues de HEAD, les colonnes générées du working set et ce que le working set a changé', () => {
    const sql = storedSqlAssertion();

    expect(sql).toContain("from dolt_schemas as of 'HEAD' where type = 'view'");
    expect(sql).toContain('from information_schema.columns where table_schema = database()');
    expect(sql).toContain("generation_expression <> ''");
    expect(sql).toContain("from dolt_status where hashof('HEAD') <> ''");
  });

  it('ne compare aucun nom de table au `dolt_status` : il écrit `Issues` quand la table a été renommée ainsi, et `table_name in (\'issues\')` n’y verrait rien', () => {
    expect(storedSqlAssertion()).not.toMatch(/dolt_status where table_name/);
    expect(storedSqlAssertion(HASH)).not.toMatch(/dolt_status where table_name/);
  });

  it('retiennent le HEAD vérifié comme chaîne, dont les apostrophes sont doublées : rien de ce qu’il porte ne devient du SQL', () => {
    expect(storedSqlAssertion()).toContain("hashof('HEAD') <> ''");
    expect(storedSqlAssertion(HASH)).toContain(`hashof('HEAD') <> '${HASH}'`);
    expect(storedSqlAssertion("x' or 1 = 1 --")).toContain("<> 'x'' or 1 = 1 --'");
  });
});

describe('les instructions qui précèdent le dernier essai d’une lecture : `storedSqlEvidence` (bdesk-38k.74)', () => {
  it('passent le garde de lecture seule, comme les assertions : le client les soumet comme toute lecture', () => {
    const evidence = storedSqlEvidence(HASH);

    expect(evidence).toHaveLength(6);
    for (const sql of evidence) expect(() => assertReadOnly(sql)).not.toThrow();
  });

  it('placent les relevés d’`information_schema` avant la première assertion, celui de HEAD entre les deux, et portent le HEAD retenu dans la seconde', () => {
    const evidence = storedSqlEvidence(HASH);

    expect(evidence[3]).toBe(storedViewsAssertion());
    expect(evidence[5]).toBe(storedSqlAssertion(HASH));
    expect(storedSqlEvidence()[5]).toBe(storedSqlAssertion(''));
    expect(evidence[0]).toMatch(/^select table_name as view_name from information_schema\.tables where .*table_type <> 'BASE TABLE'/);
    expect(evidence[1]).toMatch(/^select table_name as tbl, column_name as col from information_schema\.columns where /);
    expect(evidence[2]).toMatch(/^select table_name as tbl, index_name as idx from information_schema\.statistics where /);
    expect(evidence[4]).toMatch(/^select name from dolt_schemas as of 'HEAD' where type = 'view'/);
  });

  it('ne lisent aucune table système avant l’assertion des vues : seules `information_schema.tables`, `.columns` et `.statistics` la précèdent', () => {
    const evidence = storedSqlEvidence(HASH);

    const before = evidence.slice(0, 3).flatMap((sql) => tableReads(sql).map(({ table }) => table));
    const after = tableReads(evidence[4] ?? '').map(({ table }) => table);

    expect(before.sort()).toEqual(['columns', 'statistics', 'tables']);
    expect(after).toEqual(['dolt_schemas']); // la table que la première assertion garde de toute vue de ce nom
    expect(evidence[3]).toContain("'dolt_schemas'");
  });

  it('relèvent exactement ce que les assertions comptent : chaque source de danger n’est écrite qu’une fois', () => {
    const evidence = storedSqlEvidence(HASH);
    const views = storedViewsAssertion();
    const second = storedSqlAssertion(HASH);

    // Les assertions comptent `select count(*) as c <ce qui suit>` ; les relevés rendent les lignes du même `from … where …`.
    expect(views).toContain(`${evidence[0]?.replace('select table_name as view_name ', '')})`);
    expect(second).toContain(`${evidence[1]?.replace('select table_name as tbl, column_name as col ', '')})`);
    expect(views).toContain(`${evidence[2]?.replace('select table_name as tbl, index_name as idx ', '')})`);
    expect(second).toContain(`${evidence[4]?.replace('select name ', '')})`);
  });
});

describe('readsNoTable', () => {
  it.each(["select hashof('HEAD') as head", 'select database() as name', '  SELECT 1', 'select 1 as a, 2 as b'])('%s : aucune table, donc aucun SQL stocké', (sql) => {
    expect(readsNoTable(sql)).toBe(true);
  });

  it.each([
    "select id from issues as of 'HEAD'",
    'show columns from dolt_history_dependencies',
    'with a as (select 1) select * from a',
    'select (select 1 from issues) as n',
    "select 'from' as word", // un `from` dans une chaîne : par prudence, vérifié
    'describe issues',
    'select * from (select 1) t',
  ])('%s : vérifié', (sql) => {
    expect(readsNoTable(sql)).toBe(false);
  });
});

describe('les tables que l’app lit', () => {
  /** Une base qui garde le SQL de chaque lecture et répond « rien » (sauf le nom de la base). */
  function recording(): DoltDatabase & { sqls: string[] } {
    const sqls: string[] = [];
    return {
      dir: '/projet',
      sqls,
      query: (sql) => {
        sqls.push(sql);
        return Promise.resolve(sql.startsWith('select database()') ? [{ name: 'projet' }] : []);
      },
    };
  }

  it('sont toutes dans la liste que la vérification surveille : une table lue de plus, sans que la liste le sache, laisserait une vue passer', async () => {
    const db = recording();

    await readIssueBase(db);
    await readIssueParts(db, 'a-1');
    await readIssuePrefix(db).catch(() => undefined);
    await readHead(db).catch(() => undefined);
    await readTicketHistories(db);

    // Toutes les tables, celles de l'historique de Dolt comprises (`tablesRead` n'en rend pas).
    const read = new Set(db.sqls.flatMap((sql) => tableReads(sql).map(({ table }) => table)));
    expect([...read].sort()).toEqual(['comments', 'config', 'dependencies', 'dolt_commit_ancestors', 'dolt_history_dependencies', 'dolt_history_issues', 'dolt_log', 'issues', 'labels']);
    expect([...read].filter((table) => !(STORED_SQL_NAMES as readonly string[]).includes(table))).toEqual([]);
  });
});

describe('storedSqlInSource', () => {
  const tables = (revision: string, ...entries: [string, 'BASE TABLE' | 'VIEW' | 'SYSTEM VIEW'][]): Row[] =>
    entries.map(([name, type]) => ({ Table_type: type, [`Tables_in_${revision}`]: name }));
  /** Ce que bd met dans toutes ses bases. */
  const bd = (revision: string): Row[] => tables(revision, ['dependencies', 'BASE TABLE'], ['ready_issues', 'VIEW'], ['blocked_issues', 'VIEW']);

  it('ne dit rien d’une source ordinaire : ni les valeurs par défaut de bd, ni les deux vues de bd', () => {
    const columns = [
      { Field: 'issue_id', Extra: '' },
      { Field: 'created_at', Extra: 'DEFAULT_GENERATED' },
      { Field: 'updated_at', Extra: 'DEFAULT_GENERATED on update CURRENT_TIMESTAMP' },
    ];

    expect(storedSqlInSource(columns, bd('p/abc'))).toEqual([]);
    expect(storedSqlInSource(columns)).toEqual([]);
  });

  it('dit une colonne générée, virtuelle ou stockée, et une vue, en nommant la source (l’époque par son commit)', () => {
    const problems = storedSqlInSource(
      [
        { Field: 'type', Extra: 'VIRTUAL GENERATED' },
        { Field: 'note', Extra: 'STORED GENERATED' },
      ],
      tables('p/abc', ['dolt_history_dependencies', 'VIEW'], ['Dependencies', 'VIEW'], ['blocked_issues', 'VIEW']),
      'époque du commit abc12345',
    );

    expect(problems).toHaveLength(4);
    expect(problems.join(' | ')).toContain("colonne générée « type » de l'historique des dépendances (époque du commit abc12345)");
    expect(problems.join(' | ')).toContain('colonne générée « note »');
    expect(problems.join(' | ')).toContain('« dolt_history_dependencies » est une vue');
    expect(problems.join(' | ')).toContain('« Dependencies » est une vue');
    expect(problems.join(' | ')).not.toContain('blocked_issues');
    expect(problems.join(' | ')).not.toContain('p/abc');
  });

  // Dolt lit `dolt_history_dependencieſ` (U+017F) comme `dolt_history_dependencies` ; JavaScript ne le fait pas (`'ſ'.toLowerCase()` reste `ſ`). Aucun nom n'est comparé à ceux que l'app lit :
  // toute vue est refusée, sauf les deux de bd, par égalité exacte.
  it.each([
    ['le s long (U+017F)', 'dolt_history_dependencieſ'],
    ['le i pointé (U+0130)', 'dolt_hİstory_dependencies'],
    ['des majuscules', 'DOLT_HISTORY_DEPENDENCIES'],
    ['un nom sans rapport', 'rapport_perso'],
    ['la table système qu’on lirait pour les vues', 'dolt_schemas'],
    ['le nom d’une vue de bd, en majuscules', 'READY_ISSUES'],
    ['le nom d’une vue de bd, avec un s long', 'ready_issueſ'],
    ['le nom d’une vue de bd, avec le signe Kelvin (U+212A) qu’un toLowerCase() ramène à `k`', 'blocKed_issues'],
    ['un nom de vue de bd suivi d’une espace', 'ready_issues '],
  ])('refuse la vue qui s’écrit avec %s : %s', (_label, name) => {
    const problems = storedSqlInSource([], tables('p/abc', [name, 'VIEW']));

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('est une vue');
  });

  it('ne refuse pas une table, quel que soit son nom, mais refuse tout ce qui n’est pas une table de base sous un nom qui n’est pas de bd', () => {
    expect(storedSqlInSource([], tables('p/abc', ['Dependencies', 'BASE TABLE'], ['dolt_hİstory_dependencies', 'BASE TABLE'], ['wisps', 'BASE TABLE']))).toEqual([]);
    expect(storedSqlInSource([], tables('p/abc', ['x', 'SYSTEM VIEW']))).toHaveLength(1);
  });

  it('liste les tables de la base de révision sans lire sa table `dolt_schemas`, qu’une vue de ce nom masquerait (et exécuterait)', () => {
    expect(revisionTablesSql('`projet/abc`')).toBe('show full tables from `projet/abc`');
    expect(() => assertReadOnly(revisionTablesSql('`projet/abc`'))).not.toThrow();
  });

  it('ne compare aucun nom de la base en JavaScript : ni minuscules, ni majuscules, ni comparaison locale, nulle part dans le module', () => {
    const source = readFileSync(new URL('./stored-sql.ts', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

    expect(source).not.toMatch(/toLowerCase|toUpperCase|toLocale|localeCompare|normalize\(|new RegExp\(|\.test\(name|\.match\(name/);
  });
});

/**
 * L'erreur que Dolt rend quand l'assertion trouve du SQL stocké, telle que le client la remonte (la requête est remplacée par […]). `completed` : les lignes des instructions
 * du groupe qui ont abouti avant elle, que le client garde (bdesk-38k.74) ; absentes, comme quand la sortie de dolt ne s'est pas lue.
 */
const ASSERTION_FAILED = (completed?: Row[][]) =>
  new DoltQueryError('error on line 1 for query […]: the subquery returned more than 1 row', '/projet', false, undefined, completed);

/**
 * Les deux groupes qui cherchent le commit de base d'une base, une fois par base (bdesk-38k.74) : le premier commit de la lignée (`dolt_log`), puis la sonde qui dit s'il porte
 * `dolt_nonlocal_tables` (`dolt_diff_stat` de ce commit contre lui-même : « table not found » s'il ne l'a pas). `fakeClient` y répond d'office, sans les compter parmi les `calls`.
 */
const isRootCommit = (sqls: readonly string[]) => sqls.length === 2 && sqls[0]?.startsWith("select commit_hash from dolt_log('HEAD')") === true && sqls[1] === 'select database() as name';
const isBaseProbe = (sqls: readonly string[]) => sqls.length === 1 && sqls[0]?.includes('from dolt_diff_stat(') === true;
/** Le troisième groupe de la recherche (bdesk-38k.74, round 4) : la liste des tables et vues de la révision du commit de base, qui doit être vide. */
const isBaseTables = (sqls: readonly string[]) => sqls.length === 1 && sqls[0]?.startsWith('show full tables from ') === true;
/** Le nom de la base d'essai, que `select database()` rend et que la révision du commit de base (`<base>/<commit>`) porte. */
const DATABASE = 'projet';
const TABLE_NOT_THERE = (): never => {
  throw new DoltQueryError('error on line 1 for query […]: table not found: dolt_nonlocal_tables', '/projet');
};
interface Learning {
  root?: () => Row[][];
  probe?: () => Row[][];
  /** Les lignes de `show full tables` de la révision du commit de base : vides pour un commit de base sans table (le cas de bd). */
  tables?: () => Row[][];
}

/** Un client Dolt factice, dont chaque groupe de lectures est jugé par `answer` : on y voit ce que la vérification envoie. */
function fakeClient(answer: (sqls: readonly string[], call: number, options: QueryOptions | undefined) => Row[][] | Promise<Row[][]>, learn: Learning = {}) {
  const calls: { dir: string; sqls: readonly string[] }[] = [];
  const learning: { dir: string; sqls: readonly string[] }[] = [];
  const respond = (dir: string, sqls: readonly string[], options: QueryOptions | undefined): Row[][] | Promise<Row[][]> => {
    if (isRootCommit(sqls)) {
      learning.push({ dir, sqls });
      return learn.root?.() ?? [[{ commit_hash: BASE }], [{ name: DATABASE }]];
    }
    if (isBaseProbe(sqls)) {
      learning.push({ dir, sqls });
      return learn.probe?.() ?? TABLE_NOT_THERE();
    }
    if (isBaseTables(sqls)) {
      learning.push({ dir, sqls });
      return learn.tables?.() ?? [[]];
    }
    return answer(sqls, calls.push({ dir, sqls }) - 1, options);
  };
  const client: DoltClient = {
    open: (dir) => ({
      dir,
      query: async (sql, options) => (await respond(dir, [sql], options))[0] ?? [],
      queryAll: async (sqls, options) => respond(dir, sqls, options),
    }),
  };
  return { client, calls, learning };
}

// Les groupes que la vérification envoie : une lecture, précédée des deux assertions (ou, au dernier essai, de ses relevés et des deux assertions : `storedSqlEvidence`) ; puis,
// si l'une échoue, les trois temps du diagnostic.
const SECOND_ASSERTION = 'select (select 1 union all select 1 from dual where a.c + b.c + d.c > 0) as stored_sql';
const isPlainRead = (sqls: readonly string[]) => sqls[1]?.startsWith(SECOND_ASSERTION) === true;
const isEvidence = (sqls: readonly string[]) => sqls[5]?.startsWith(SECOND_ASSERTION) === true;
const isRead = (sqls: readonly string[]) => isPlainRead(sqls) || isEvidence(sqls);
// Le premier temps du diagnostic relève les vues, les colonnes générées, puis les index fonctionnels. (Le groupe du dernier essai commence par les mêmes trois relevés : on ne les confond pas.)
const isViewsStep = (sqls: readonly string[]) =>
  sqls[0]?.startsWith('select table_name as view_name from information_schema.tables') === true &&
  sqls[1]?.startsWith('select table_name as tbl, column_name as col from information_schema.columns') === true &&
  sqls[2]?.startsWith('select table_name as tbl, index_name as idx from information_schema.statistics') === true &&
  !isEvidence(sqls);
const isStateStep = (sqls: readonly string[]) => sqls[1]?.startsWith("select name from dolt_schemas as of 'HEAD'") === true;
const isPinStep = (sqls: readonly string[]) => sqls[1]?.startsWith("select hashof('HEAD') as head") === true;
const isDiagnosis = (sqls: readonly string[]) => isViewsStep(sqls);
const pinOf = (sqls: readonly string[]) => /hashof\('HEAD'\) <> '([^']*)'/.exec(sqls.find((sql) => sql.startsWith(SECOND_ASSERTION)) ?? '')?.[1];

/**
 * Ce que le diagnostic trouve : `views`, `generated` et `functionalIndexes` au premier temps ; `headViews`, `dirty` (le working set diffère de HEAD), `head` (le hash de HEAD, lu
 * dans le même instantané) et `generatedNow` (les colonnes générées de cet instantané-là) au deuxième ; `head`, `columns` (par table lue) et `absent` (tables que HEAD n'a pas) au
 * troisième.
 */
interface Finding {
  views?: Row[];
  generated?: Row[];
  /** Les index fonctionnels (bdesk-38k.74, round 3, B-FI) que le premier temps relève. */
  functionalIndexes?: Row[];
  /** Les comptes de `dolt_nonlocal_tables` non vide (working set, HEAD) que le premier temps relève. */
  nonlocal?: { working?: unknown; head?: unknown };
  headViews?: Row[];
  generatedNow?: Row[];
  dirty?: boolean | number | string;
  head?: string | ((table: string) => string);
  columns?: Record<string, Row[]>;
  absent?: string[];
  /** Le `CREATE TABLE` de chaque table lue dans HEAD, que le troisième temps lit en dernier (bdesk-38k.74, round 4 : B-FI, HEAD seul) : les lignes de `schemaRows(…)`, saines par défaut. */
  headSchema?: Row[];
}
/** Les tables que le troisième temps lit : celles de `show full columns from <table> as of 'HEAD'`, dans l'ordre ; la dernière instruction est le `CREATE TABLE` de HEAD (`schemaCreateSql`). */
const probedTables = (sqls: readonly string[]) => sqls.slice(2, -1).map((sql) => /^show full columns from (\w+) as of 'HEAD'$/.exec(sql)?.[1] ?? '?');
function diagnosisOf(
  sqls: readonly string[],
  { views = [], generated = [], functionalIndexes = [], nonlocal = {}, headViews = [], generatedNow = [], dirty = false, head = HASH, columns = {}, absent = [], headSchema = schemaRows() }: Finding = {},
): Row[][] {
  if (isViewsStep(sqls)) return [views, generated, functionalIndexes, [{ working: nonlocal.working ?? 0, head: nonlocal.head ?? 0 }]];
  if (isStateStep(sqls)) {
    return [[{}], headViews, [{ n: dirty === true ? '2' : dirty === false ? '0' : dirty }], [{ head: typeof head === 'function' ? head('') : head }], generatedNow];
  }
  if (isPinStep(sqls)) {
    const tables = probedTables(sqls);
    const missing = tables.find((table) => absent.includes(table));
    if (missing) throw new DoltQueryError(`error on line 1 for query […]: table not found: ${missing}`, '/projet');
    return [[{}], [{ head: typeof head === 'function' ? head(tables[0] ?? '') : head }], ...tables.map((table) => columns[table] ?? [{ Field: 'id', Extra: '' }]), headSchema];
  }
  throw new Error(`lecture inattendue : ${sqls.join(' | ')}`);
}
/**
 * La réponse d'une lecture qui passe : un résultat vide par instruction de ce qui la précède (deux assertions, ou les six du dernier essai), puis le `CREATE TABLE` sain des cinq tables, dans le
 * working set puis dans HEAD (les deux relevés de `schemaProbe`, B-FI, bdesk-38k.74 round 3 : une ligne par table attendue depuis le round 4, m2 : une liste vide serait cinq tables sans définition,
 * refusées), puis `rows`.
 */
const ok = (sqls: readonly string[], rows: Row[] = [{ id: 'a-1' }]): Row[][] => [...Array.from({ length: isEvidence(sqls) ? 6 : 2 }, () => [{}]), schemaRows(), schemaRows(), rows];
/**
 * Comme `ok`, avec le `CREATE TABLE` de chaque table lue dans le working set puis dans HEAD, les deux relevés de `schemaProbe` (bdesk-38k.74, round 3, B-FI) : `working` et `head` remplacent la
 * ligne des tables qu'ils nomment (`{ tbl, stmt }`, comme les rend `schemaCreateSql`), les autres restent saines ; `workingMissing` et `headMissing` rendent des tables absentes de la comparaison
 * (round 4, m2).
 */
const okWithSchema = (
  sqls: readonly string[],
  schema: { working?: Row[]; head?: Row[]; workingMissing?: string[]; headMissing?: string[] },
  rows: Row[] = [{ id: 'a-1' }],
): Row[][] => [
  ...Array.from({ length: isEvidence(sqls) ? 6 : 2 }, () => [{}]),
  schemaRows(schema.working, schema.workingMissing),
  schemaRows(schema.head, schema.headMissing),
  rows,
];
const Q = "select id from issues as of 'HEAD'";

describe('withStoredSqlCheck', () => {
  it('fait précéder chaque lecture des deux assertions, dans le même groupe, et n’en rend pas les lignes', async () => {
    const { client, calls } = fakeClient((sqls) => (isRead(sqls) ? [[{}], [{}], schemaRows(), schemaRows(), ...sqls.slice(4).map((_sql, i) => (i === 0 ? [{ id: 'a-1' }] : [{ label: 'x' }]))] : []));
    const db = withStoredSqlCheck(client).open('/projet');

    expect(await db.query(Q)).toEqual([{ id: 'a-1' }]);
    expect(await db.queryAll?.([Q, 'select label from labels'])).toEqual([[{ id: 'a-1' }], [{ label: 'x' }]]);
    expect(calls.map((call) => call.sqls)).toEqual([[...storedSqlPrelude('', BASE), Q], [...storedSqlPrelude('', BASE), Q, 'select label from labels']]);
  });

  it('ne vérifie pas une lecture qui ne nomme aucune table : le sondage du HEAD ne paie rien', async () => {
    const { client, calls } = fakeClient(() => [[{ head: 'abc' }]]);
    const db = withStoredSqlCheck(client).open('/projet');

    expect(await db.query("select hashof('HEAD') as head")).toEqual([{ head: 'abc' }]);
    expect(calls.map((call) => call.sqls)).toEqual([["select hashof('HEAD') as head"]]);
  });

  it('transmet le signal et la voie de la lecture à celle qu’elle lance', async () => {
    const seen: (QueryOptions | undefined)[] = [];
    const { client } = fakeClient((sqls, _call, options) => {
      seen.push(options);
      return ok(sqls, []);
    });
    const signal = new AbortController().signal;

    await withStoredSqlCheck(client).open('/projet').query(Q, { lane: 'analysis', signal });

    expect(seen).toEqual([{ lane: 'analysis', signal }]);
  });

  it('refuse une base qui porte une vue : la lecture n’est jamais envoyée seule, l’erreur dit laquelle', async () => {
    const { client, calls } = fakeClient((sqls) => {
      if (isRead(sqls)) throw ASSERTION_FAILED();
      return diagnosisOf(sqls, { views: [{ view_name: 'issues' }] });
    });
    const db = withStoredSqlCheck(client).open('/projet');

    const error = await db.query(Q).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(StoredSqlError);
    expect(error).toBeInstanceOf(DoltQueryError);
    expect((error as StoredSqlError).message).toMatch(/SQL stocké/);
    expect((error as StoredSqlError).message).toContain('« issues » est une vue');
    expect(calls.map((call) => call.sqls.length)).toEqual([5, 4]); // les deux assertions et le CREATE TABLE des tables lues + la lecture (échouée), puis le premier temps du diagnostic (vues, colonnes générées, index fonctionnels, `dolt_nonlocal_tables`) : jamais la lecture seule
    expect(calls.some((call) => call.sqls.length === 1 && call.sqls[0] === Q)).toBe(false);
  });

  it.each([
    ['une colonne générée du working set', { generated: [{ tbl: 'issues', col: 'title' }] }, 'colonne générée « title » de « issues »'],
    ['une vue dans HEAD', { headViews: [{ name: 'dependencies' }] }, "« dependencies » est une vue, que l'app pourrait lire à la place d'une table (dans HEAD)"],
  ])('refuse aussi : %s', async (_label, finding, expected) => {
    const { client } = fakeClient((sqls) => {
      if (isRead(sqls)) throw ASSERTION_FAILED();
      return diagnosisOf(sqls, finding);
    });

    const error = await withStoredSqlCheck(client).open('/projet').query(Q).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(StoredSqlError);
    expect((error as Error).message).toContain(expected);
  });

  it('ne cite ni le contenu d’un nom de la base au-delà de 64 caractères, ni ses caractères de contrôle', async () => {
    const hostile = `a\u0000\n${'x'.repeat(200)}`;
    const { client } = fakeClient((sqls) => {
      if (isRead(sqls)) throw ASSERTION_FAILED();
      return diagnosisOf(sqls, { generated: [{ tbl: 'issues', col: hostile }] });
    });

    const error = await withStoredSqlCheck(client).open('/projet').query(Q).catch((err: unknown) => err);

    const message = (error as Error).message;
    expect(message.includes('\u0000') || message.includes('\n')).toBe(false);
    expect(message).toContain(`« a??${'x'.repeat(61)} »`);
  });

  // Un nom est coupé à 64 points de code, non à 64 unités UTF-16 : `slice(0, 64)` coupait une paire de substitution en deux (un caractère hors du plan de base, comme un émoji,
  // en vaut deux) et laissait une moitié seule dans la raison (bdesk-38k.74).
  describe('un nom tiré de la base est coupé par point de code, jamais au milieu d’une paire de substitution', () => {
    /** La raison du refus d'une colonne générée qui porte `name`. */
    async function reasonFor(name: string): Promise<string> {
      const { client } = fakeClient((sqls) => {
        if (isRead(sqls)) throw ASSERTION_FAILED();
        return diagnosisOf(sqls, { generated: [{ tbl: 'issues', col: name }] });
      });
      const error = await withStoredSqlCheck(client).open('/projet').query(Q).catch((err: unknown) => err);
      expect(error).toBeInstanceOf(StoredSqlError);
      return (error as Error).message;
    }
    /** Une moitié de paire de substitution, seule (`\p{Cs}` en mode unicode ne reconnaît que celles-là : une paire entière est un seul point de code). */
    const hasLoneSurrogate = (text: string) => /\p{Cs}/u.test(text);

    it('garde le 64e point de code quand il s’écrit sur deux unités (la dernière unité conservée ne laisse pas une moitié de paire)', async () => {
      const message = await reasonFor(`${'x'.repeat(63)}😀${'y'.repeat(10)}`);

      expect(hasLoneSurrogate(message)).toBe(false);
      expect(message).toContain(`« ${'x'.repeat(63)}😀 »`);
    });

    it('s’arrête avant le 65e point de code, qui est un caractère entier ou rien', async () => {
      const message = await reasonFor(`${'x'.repeat(64)}😀`);

      expect(hasLoneSurrogate(message)).toBe(false);
      expect(message).toContain(`« ${'x'.repeat(64)} »`);
      expect(message).not.toContain('😀');
    });

    it('compte des points de code, non des unités : soixante-quatre émojis passent, le soixante-cinquième non', async () => {
      const message = await reasonFor('😀'.repeat(70));

      expect(hasLoneSurrogate(message)).toBe(false);
      expect(message).toContain(`« ${'😀'.repeat(64)} »`);
      expect(message).not.toContain('😀'.repeat(65));
    });

    it('remplace toujours une moitié de paire qui était déjà seule dans le nom, comme tout caractère de contrôle (`\\p{C}`)', async () => {
      const message = await reasonFor('a\ud83dz');

      expect(hasLoneSurrogate(message)).toBe(false);
      expect(message).toContain('« a?z »');
    });

    it('remplace les séparateurs de ligne et de paragraphe d’Unicode (U+2028, U+2029) comme les caractères de contrôle : ils casseraient une ligne de journal ou de raison', async () => {
      const message = await reasonFor('a\u2028b\u2029c');

      expect(message).toContain('« a?b?c »');
      expect(message.includes('\u2028') || message.includes('\u2029')).toBe(false);
    });

    it('ne change pas un nom de 64 caractères ou moins', async () => {
      expect(await reasonFor('x'.repeat(64))).toContain(`« ${'x'.repeat(64)} »`);
      expect(await reasonFor('titre é 😀')).toContain('« titre é 😀 »');
    });
  });

  // Une base en porte autant qu'on veut (des centaines de colonnes générées, des centaines de vues dans une ancre d'époque) et la raison du refus part telle quelle dans la
  // réponse 503 : elle nomme les premiers objets, puis dit combien d'autres (bdesk-38k.74).
  describe('la raison d’un refus nomme cinq objets au plus, puis dit combien d’autres', () => {
    const generatedColumns = (count: number, name = (i: number) => `colonne_${i}`): Row[] => Array.from({ length: count }, (_, i) => ({ tbl: 'issues', col: name(i) }));
    async function reasonOf(generated: Row[]): Promise<string> {
      const { client } = fakeClient((sqls) => {
        if (isRead(sqls)) throw ASSERTION_FAILED();
        return diagnosisOf(sqls, { generated });
      });
      const error = await withStoredSqlCheck(client).open('/projet').query(Q).catch((err: unknown) => err);
      expect(error).toBeInstanceOf(StoredSqlError);
      return (error as Error).message;
    }

    it('en nomme cinq au plus', () => {
      expect(MAX_NAMED_OBJECTS).toBe(5);
    });

    it('nomme tous les objets quand il n’y en a pas plus, sans rien ajouter', async () => {
      const message = await reasonOf(generatedColumns(MAX_NAMED_OBJECTS));

      for (let i = 0; i < MAX_NAMED_OBJECTS; i++) expect(message).toContain(`colonne générée « colonne_${i} » de « issues »`);
      expect(message).not.toMatch(/\bautres?\b/);
    });

    it('dit « et 1 autre » dès qu’il y en a un de plus', async () => {
      const message = await reasonOf(generatedColumns(MAX_NAMED_OBJECTS + 1));

      expect(message).toContain(`colonne_${MAX_NAMED_OBJECTS - 1}`);
      expect(message).not.toContain(`colonne_${MAX_NAMED_OBJECTS} `);
      expect(message).toContain('et 1 autre.');
    });

    it('nomme les cinq premiers d’une base qui en porte des centaines, et compte les autres : le message ne grandit pas avec elle', async () => {
      const message = await reasonOf(generatedColumns(300));

      for (let i = 0; i < MAX_NAMED_OBJECTS; i++) expect(message).toContain(`« colonne_${i} »`);
      expect(message).not.toContain('colonne_5 ');
      expect(message).not.toContain('colonne_299');
      expect(message).toContain('et 295 autres');
      expect(message).toMatch(/SQL stocké dans la base/);
      expect(message).toMatch(/La base n'est pas lue\.$/);
      expect(message.length).toBeLessThan(600);
    });

    it('reste sous une longueur fixe quels que soient le nombre d’objets et la longueur de leurs noms', async () => {
      const short = await reasonOf(generatedColumns(6, () => 'x'.repeat(500)));
      const long = await reasonOf(generatedColumns(2000, () => '😀'.repeat(500)));

      // Cinq objets de deux noms de 64 points de code au plus (un nom de table et un nom de colonne), chacun sur deux unités UTF-16 au pire, et leur texte.
      expect(short.length).toBeLessThan(1500);
      expect(long.length).toBeLessThan(2500);
      expect(long).toContain('et 1995 autres');
    });

    it('borne aussi la raison d’une ancre d’époque qui porte des centaines de vues (history.ts les refuse toutes, sauf les deux de bd)', () => {
      const views = Array.from({ length: 300 }, (_, i) => ({ Table_type: 'VIEW', Tables_in_base: `vue_${i}` }));
      const problems = storedSqlInSource([], views, 'époque du commit abc12345');

      expect(problems).toHaveLength(300);
      const message = new StoredSqlError(problems, '/projet').message;
      expect(message).toContain('« vue_0 »');
      expect(message).toContain('« vue_4 »');
      expect(message).not.toContain('« vue_5 »');
      expect(message).toContain('et 295 autres');
      expect(message.length).toBeLessThan(900);
    });

    it('garde la liste entière sur l’erreur, pour qui la lit', () => {
      const objects = Array.from({ length: 12 }, (_, i) => `objet ${i}`);

      expect(new StoredSqlError(objects).objects).toEqual(objects);
    });
  });

  it('relit quand le diagnostic ne trouve rien et que le working set est propre : l’état a changé entre l’assertion et lui', async () => {
    let reads = 0;
    const { client, calls } = fakeClient((sqls) => {
      if (isRead(sqls)) {
        if (reads++ === 0) throw ASSERTION_FAILED();
        return ok(sqls);
      }
      return diagnosisOf(sqls);
    });

    expect(await withStoredSqlCheck(client).open('/projet').query(Q)).toEqual([{ id: 'a-1' }]);
    expect(calls.map((call) => call.sqls.length)).toEqual([5, 4, 5, 5]); // lecture (échec), diagnostic en deux temps (rien de sale : pas de troisième ; le deuxième lit aussi le hash de HEAD et les colonnes générées), lecture
  });

  it('retient le HEAD dont il a vérifié le schéma quand le working set est modifié sans commit, et le fait valoir à chaque lecture', async () => {
    const { client, calls } = fakeClient((sqls) => {
      if (isRead(sqls)) {
        if (pinOf(sqls) === HASH) return ok(sqls);
        throw ASSERTION_FAILED();
      }
      return diagnosisOf(sqls, { dirty: true });
    });
    const db = withStoredSqlCheck(client).open('/projet');

    expect(await db.query(Q)).toEqual([{ id: 'a-1' }]);
    expect(await db.query(Q)).toEqual([{ id: 'a-1' }]);

    const pinning = calls.find((call) => isPinStep(call.sqls));
    // Le schéma de HEAD, lu dans le même processus que le hash de HEAD (et après l'assertion des vues), de chacune des tables lues, par son nom : Dolt le résout, et `dolt_status`,
    // dont on ne compare rien, peut l'écrire `Issues`.
    expect(pinning?.sqls).toEqual([
      storedViewsAssertion(BASE),
      "select hashof('HEAD') as head",
      ...STORED_SQL_TABLES.map((table) => `show full columns from ${table} as of 'HEAD'`),
      schemaCreateSql(BASE, 'HEAD'), // le `CREATE TABLE` de HEAD, jugé avant que ce HEAD soit retenu (B-FI)
    ]);
    // De même le deuxième temps, qui lit `dolt_schemas` et `dolt_status` : l'assertion des vues le précède, qu'une vue arrivée depuis le premier temps arrête.
    expect(calls.find((call) => isStateStep(call.sqls))?.sqls[0]).toBe(storedViewsAssertion(BASE));
    expect(calls.filter((call) => isDiagnosis(call.sqls))).toHaveLength(1); // la deuxième lecture ne diagnostique plus
    expect(pinOf(calls.at(-1)?.sqls ?? [])).toBe(HASH);
  });

  it('refuse un HEAD dont une table lue a une colonne générée, même si le working set modifié l’a retirée', async () => {
    const { client } = fakeClient((sqls) => {
      if (isRead(sqls)) throw ASSERTION_FAILED();
      return diagnosisOf(sqls, { dirty: true, columns: { issues: [{ Field: 'title', Extra: 'VIRTUAL GENERATED' }] } });
    });

    const error = await withStoredSqlCheck(client).open('/projet').query(Q).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(StoredSqlError);
    expect((error as Error).message).toContain('colonne générée « title » de « issues » (dans HEAD)');
  });

  it.each([['0 en nombre', 0], ['« 0 » en chaîne (derrière un serveur)', '0']])('un working set propre se reconnaît à un compte nul : %s', async (_label, n) => {
    let reads = 0;
    const { client, calls } = fakeClient((sqls) => {
      if (isRead(sqls)) {
        if (reads++ === 0) throw ASSERTION_FAILED();
        return ok(sqls);
      }
      return diagnosisOf(sqls, { dirty: n });
    });

    await withStoredSqlCheck(client).open('/projet').query(Q);

    expect(calls.some((call) => isPinStep(call.sqls))).toBe(false);
  });

  it('sonde une à une les tables lues quand HEAD en manque une (« table not found »), puis refuse ce HEAD : la comparaison n\'a aucune ligne pour la table qui manque (m2), qui n\'est pas retenu', async () => {
    const { client, calls } = fakeClient((sqls) => {
      if (isRead(sqls)) throw ASSERTION_FAILED();
      return diagnosisOf(sqls, { dirty: true, absent: ['labels'], columns: { issues: [{ Field: 'id', Extra: '' }] }, headSchema: schemaRows([], ['labels']) });
    });
    const db = withStoredSqlCheck(client).open('/projet');

    const error = await db.query(Q).catch((err: unknown) => err);

    const probes = calls.filter((call) => isPinStep(call.sqls)).map((call) => probedTables(call.sqls));
    expect(probes).toEqual([[...STORED_SQL_TABLES], ...STORED_SQL_TABLES.map((table) => [table])]);
    expect(error).toBeInstanceOf(StoredSqlError);
    expect((error as StoredSqlError).objects).toEqual([`« labels » (dans HEAD) : ${MISSING}`]);
    expect(calls.filter((call) => isRead(call.sqls)).every((call) => pinOf(call.sqls) === '')).toBe(true); // HEAD n'est pas retenu
  });

  it('refuse la colonne générée d\'une table, même quand HEAD en manque une autre', async () => {
    const { client } = fakeClient((sqls) => {
      if (isRead(sqls)) throw ASSERTION_FAILED();
      return diagnosisOf(sqls, { dirty: true, absent: ['labels'], columns: { comments: [{ Field: 'text', Extra: 'VIRTUAL GENERATED' }] }, headSchema: schemaRows([], ['labels']) });
    });

    const error = await withStoredSqlCheck(client).open('/projet').query(Q).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(StoredSqlError);
    expect((error as Error).message).toContain('colonne générée « text » de « comments » (dans HEAD)');
  });

  it('ne retient rien quand les sondes d\'une table à la fois ne voient pas le même HEAD : HEAD a changé entre elles', async () => {
    let probe = 0;
    const { client, calls } = fakeClient((sqls) => {
      if (isRead(sqls)) throw ASSERTION_FAILED();
      return diagnosisOf(sqls, { dirty: true, absent: ['labels'], head: () => `${HASH}${probe++}` });
    });

    const error = await withStoredSqlCheck(client).open('/projet').query(Q).catch((err: unknown) => err);

    expect((error as Error).message).toMatch(/plus vite que la vérification/);
    expect(calls.filter((call) => isRead(call.sqls)).every((call) => pinOf(call.sqls) === '')).toBe(true);
  });

  it('retient aussi le HEAD quand le diagnostic trouve le working set redevenu propre : ce HEAD est sain (même instantané : ni vue, ni colonne générée, ni vue de HEAD)', async () => {
    let dirty = true;
    let failOnce = false;
    const { client, calls } = fakeClient((sqls) => {
      if (isRead(sqls)) {
        if (failOnce) {
          failOnce = false;
          throw ASSERTION_FAILED();
        }
        if (dirty && pinOf(sqls) !== HASH) throw ASSERTION_FAILED();
        return ok(sqls);
      }
      return diagnosisOf(sqls, { dirty });
    });
    const db = withStoredSqlCheck(client).open('/projet');

    await db.query(Q); // sale : HEAD retenu
    dirty = false; // un commit : propre
    failOnce = true; // une assertion que quelque chose d'autre fait échouer (un état qui a changé entre elle et le diagnostic)
    await db.query(Q);
    await db.query(Q);

    const pins = calls.filter((call) => isRead(call.sqls)).map((call) => (pinOf(call.sqls) === HASH ? 'retenu' : 'aucun'));
    // Propre, le HEAD que le diagnostic a lu avec lui est sain : il reste retenu, et la lecture qui part sale ensuite passe sans diagnostic (avant, il était oublié).
    expect(pins).toEqual(['aucun', 'retenu', 'retenu', 'retenu', 'retenu']);
    expect(calls.filter((call) => isPinStep(call.sqls))).toHaveLength(1); // la sonde des colonnes de HEAD n'a lieu que pour un working set sale
  });

  // Une base qui passe de sale à propre entre la lecture et le diagnostic (le cas de la course de la relecture de .74 : un écrivain renomme une table, puis la rétablit) : le diagnostic,
  // propre, oubliait le HEAD, et la lecture suivante, sale de nouveau, échouait de nouveau — jusqu'à « La base change plus vite… » alors que HEAD n'avait pas bougé (bdesk-38k.74).
  it('ne finit plus sur « La base change plus vite… » quand le working set est sale à chaque lecture et propre à chaque diagnostic, HEAD ne changeant pas', async () => {
    const { client, calls } = fakeClient((sqls) => {
      if (isRead(sqls)) return pinOf(sqls) === HASH ? ok(sqls) : (() => { throw ASSERTION_FAILED(); })(); // sale à chaque lecture : le HEAD vérifié est exigé
      return diagnosisOf(sqls, { dirty: false }); // propre à chaque diagnostic
    });

    expect(await withStoredSqlCheck(client).open('/projet').query(Q)).toEqual([{ id: 'a-1' }]);
    expect(calls.filter((call) => isDiagnosis(call.sqls))).toHaveLength(1);
    expect(calls.filter((call) => isRead(call.sqls)).map((call) => pinOf(call.sqls))).toEqual(['', HASH]);
  });

  it('refuse une colonne générée qui apparaît entre le premier temps et le deuxième, sans retenir de HEAD : le deuxième temps relit les colonnes générées dans son propre instantané', async () => {
    const { client, calls } = fakeClient((sqls) => {
      if (isRead(sqls)) throw ASSERTION_FAILED();
      return diagnosisOf(sqls, { generatedNow: [{ tbl: 'issues', col: 'title' }] });
    });

    const error = await withStoredSqlCheck(client).open('/projet').query(Q).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(StoredSqlError);
    expect((error as Error).message).toContain('colonne générée « title » de « issues »');
    expect(calls.filter((call) => isRead(call.sqls))).toHaveLength(1);
  });

  it('le deuxième temps du diagnostic lit, avec les vues de HEAD et ce que le working set a changé, le hash de HEAD et les colonnes générées : de quoi retenir un HEAD propre', async () => {
    const { client, calls } = fakeClient((sqls) => {
      if (isRead(sqls)) throw ASSERTION_FAILED();
      return diagnosisOf(sqls);
    });

    await withStoredSqlCheck(client).open('/projet').query(Q).catch(() => undefined);

    const state = calls.find((call) => isStateStep(call.sqls))?.sqls ?? [];
    expect(state).toHaveLength(5);
    expect(state[0]).toBe(storedViewsAssertion(BASE));
    expect(state[1]).toMatch(/^select name from dolt_schemas as of 'HEAD'/);
    expect(state[2]).toMatch(/^select count\(\*\) as n from dolt_status$/);
    expect(state[3]).toBe("select hashof('HEAD') as head");
    expect(state[4]).toMatch(/^select table_name as tbl, column_name as col from information_schema\.columns/);
  });

  it('relit, sans rien retenir, quand une vue est arrivée entre le premier temps du diagnostic et les suivants : la lecture suivante la verra', async () => {
    let reads = 0;
    const { client, calls } = fakeClient((sqls) => {
      if (isRead(sqls)) {
        if (reads++ < 2) throw ASSERTION_FAILED();
        return ok(sqls);
      }
      if (isStateStep(sqls)) throw ASSERTION_FAILED(); // l'assertion des vues, en tête du groupe, s'arrête : une vue masque ce que ce groupe lirait
      return diagnosisOf(sqls);
    });

    expect(await withStoredSqlCheck(client).open('/projet').query(Q)).toEqual([{ id: 'a-1' }]);
    expect(calls.filter((call) => isPinStep(call.sqls))).toHaveLength(0);
    expect(calls.filter((call) => isStateStep(call.sqls))).toHaveLength(2);
  });

  it('abandonne après trois essais quand HEAD change plus vite que la vérification, sans lire', async () => {
    const { client, calls } = fakeClient((sqls) => {
      if (isRead(sqls)) throw ASSERTION_FAILED();
      return diagnosisOf(sqls, { dirty: true });
    });

    const error = await withStoredSqlCheck(client).open('/projet').query(Q).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(DoltQueryError);
    expect(error).not.toBeInstanceOf(StoredSqlError);
    expect((error as Error).message).toBe("La base change plus vite que la vérification du SQL qu'elle porte (3 essais) : réessayez dans un instant.");
    expect(calls.filter((call) => isRead(call.sqls))).toHaveLength(3);
    expect(calls.some((call) => call.sqls[0] === Q)).toBe(false);
  });

  // Une vue qui va et vient (là quand la lecture part, partie quand le diagnostic passe, à chaque essai) faisait finir une lecture sur « La base change plus vite… » au lieu de
  // nommer la vue : le diagnostic, dans un autre processus, ne la voit plus, et le dernier essai n'en avait aucun. Il porte maintenant ses propres relevés, lus dans le même
  // processus et la même transaction que son assertion : ce qu'elle a vu (bdesk-38k.74).
  describe('le dernier essai nomme ce que son assertion a vu', () => {
    /** Le client d'une base où la vue va et vient : toutes les lectures échouent, `evidence` est ce que le groupe du dernier essai a rendu avant d'échouer, le diagnostic ne trouve rien. */
    const toggling = (evidence?: Row[][]) =>
      fakeClient((sqls) => {
        if (isEvidence(sqls)) throw ASSERTION_FAILED(evidence);
        if (isRead(sqls)) throw ASSERTION_FAILED();
        return diagnosisOf(sqls); // la vue n'est plus là quand le diagnostic passe
      });
    const readOnce = (client: DoltClient) => withStoredSqlCheck(client).open('/projet').query(Q).catch((err: unknown) => err);

    it('refuse la lecture en nommant la vue relevée par le groupe du dernier essai, que ni le premier ni le deuxième diagnostic n’ont vue', async () => {
      const { client, calls } = toggling([[{ view_name: 'issues' }], []]);

      const error = await readOnce(client);

      expect(error).toBeInstanceOf(StoredSqlError);
      expect((error as Error).message).toContain("« issues » est une vue, que l'app pourrait lire à la place d'une table");
      expect((error as Error).message).not.toMatch(/plus vite que la vérification/);
      expect(calls.some((call) => call.sqls[0] === Q)).toBe(false); // la lecture n'est jamais envoyée seule
    });

    it('ne paie les relevés qu’au dernier essai : les deux premiers n’ont que les deux assertions', async () => {
      const { client, calls } = toggling([[{ view_name: 'issues' }], []]);

      await readOnce(client);

      const reads = calls.filter((call) => isRead(call.sqls));
      expect(reads.map((call) => call.sqls.length)).toEqual([5, 5, 9]); // les deux assertions et les deux CREATE TABLE + la lecture, deux fois ; puis les huit instructions du dernier essai + la lecture
      expect(reads.map((call) => isEvidence(call.sqls))).toEqual([false, false, true]);
      expect(calls.filter((call) => isDiagnosis(call.sqls))).toHaveLength(2); // un diagnostic après chacun des deux premiers essais, aucun après le dernier
      // Les deux diagnostics ont trouvé le working set propre : HEAD, sain, est retenu, et le dernier essai le fait valoir comme toute lecture.
      expect(calls.at(-1)?.sqls).toEqual([...storedSqlEvidence(HASH, BASE), Q]);
    });

    it.each([
      ['une vue du working set', [[{ view_name: 'labels' }], []], '« labels » est une vue'],
      ['une colonne générée', [[], [{ tbl: 'issues', col: 'title' }]], 'colonne générée « title » de « issues »'],
      ['une vue de HEAD, relevée après l’assertion des vues', [[], [], [], [{}], [{ name: 'dependencies' }]], "« dependencies » est une vue, que l'app pourrait lire à la place d'une table (dans HEAD)"],
      ['une vue du working set et une colonne générée', [[{ view_name: 'labels' }], [{ tbl: 'config', col: 'value' }]], '« labels » est une vue'],
    ] as [string, Row[][], string][])('nomme %s', async (_label, evidence, expected) => {
      const error = await readOnce(toggling(evidence).client);

      expect(error).toBeInstanceOf(StoredSqlError);
      expect((error as Error).message).toContain(expected);
    });

    it('les nomme toutes, la vue, la colonne générée et la vue de HEAD, quand l’assertion a vu plusieurs sources de danger', async () => {
      const error = await readOnce(toggling([[{ view_name: 'labels' }], [{ tbl: 'config', col: 'value' }], [], [{}], [{ name: 'issues' }]]).client);

      const message = (error as Error).message;
      expect(message).toContain('« labels » est une vue');
      expect(message).toContain('colonne générée « value » de « config »');
      expect(message).toContain('« issues » est une vue, que l\'app pourrait lire à la place d\'une table (dans HEAD)');
    });

    it.each([
      ['la sortie de dolt n’a pas pu se lire (aucune ligne gardée)', undefined],
      ['aucun relevé ne dit rien : le working set est modifié et HEAD a changé entre deux essais', [[], [], [], [{}], []]],
      ['l’assertion des vues a échoué sans que les relevés d’avant disent laquelle', [[], []]],
    ] as [string, Row[][] | undefined][])('garde l’erreur « La base change plus vite… » quand %s', async (_label, evidence) => {
      const error = await readOnce(toggling(evidence).client);

      expect(error).toBeInstanceOf(DoltQueryError);
      expect(error).not.toBeInstanceOf(StoredSqlError);
      expect((error as Error).message).toMatch(/plus vite que la vérification du SQL qu'elle porte \(3 essais\)/);
    });

    it('lit quand l’assertion du dernier essai passe : la vue est partie, et les relevés ne sont pas des lignes de la lecture', async () => {
      let reads = 0;
      const { client, calls } = fakeClient((sqls) => {
        if (isRead(sqls)) {
          if (reads++ < 2) throw ASSERTION_FAILED();
          return [[], [], [], [{}], [], [{}], schemaRows(), schemaRows(), [{ id: 'a-7' }]]; // les huit instructions de tête (les six de `storedSqlEvidence`, puis les deux `CREATE TABLE`), puis la lecture
        }
        return diagnosisOf(sqls);
      });

      expect(await withStoredSqlCheck(client).open('/projet').query(Q)).toEqual([{ id: 'a-7' }]);
      expect(calls.filter((call) => isEvidence(call.sqls))).toHaveLength(1);
    });

    it('ne change rien aux autres erreurs du dernier essai : celle de Dolt passe telle quelle', async () => {
      const failure = new DoltQueryError('table not found: issues', '/projet');
      const { client } = fakeClient((sqls) => {
        if (isEvidence(sqls)) throw failure;
        if (isRead(sqls)) throw ASSERTION_FAILED();
        return diagnosisOf(sqls);
      });

      await expect(withStoredSqlCheck(client).open('/projet').query(Q)).rejects.toBe(failure);
    });

    it('un diagnostic qui nomme l’objet dès le premier échec refuse aussitôt, comme avant : aucun autre essai, donc aucun relevé', async () => {
      const { client, calls } = fakeClient((sqls) => {
        if (isRead(sqls)) throw ASSERTION_FAILED();
        return diagnosisOf(sqls, { views: [{ view_name: 'issues' }] });
      });

      const error = await readOnce(client);

      expect(error).toBeInstanceOf(StoredSqlError);
      expect(calls.filter((call) => isRead(call.sqls))).toHaveLength(1); // nommée dès le premier échec : aucun autre essai
    });
  });

  it('laisse passer telle quelle toute autre erreur : celle de la lecture, ou celle de Dolt', async () => {
    const failure = new DoltQueryError('table not found: issues', '/projet');
    const { client } = fakeClient(() => {
      throw failure;
    });

    await expect(withStoredSqlCheck(client).open('/projet').query(Q)).rejects.toBe(failure);
  });

  it('n’échoue pas pour une erreur qui dit autre chose que celle de l’assertion', async () => {
    const { client, calls } = fakeClient(() => {
      throw new DoltQueryError('Sortie de dolt illisible : JSON mal formé', '/projet');
    });

    await expect(withStoredSqlCheck(client).open('/projet').query(Q)).rejects.toThrow(/JSON mal formé/);
    expect(calls).toHaveLength(1); // aucun diagnostic
  });

  it('n’en fait qu’un, de diagnostic, pour les lectures qui échouent ensemble', async () => {
    let release: (rows: Row[][]) => void = () => undefined;
    const gate = new Promise<Row[][]>((resolve) => {
      release = resolve;
    });
    const { client, calls } = fakeClient((sqls) => {
      if (isRead(sqls)) throw ASSERTION_FAILED();
      return gate;
    });
    const db = withStoredSqlCheck(client).open('/projet');

    const reads = [db.query(Q), db.query('select label from labels'), db.query('select author from comments')];
    await new Promise((resolve) => setTimeout(resolve, 10));
    release([[{ view_name: 'issues' }], []]);

    const outcomes = await Promise.all(reads.map((read) => read.catch((err: unknown) => err)));
    expect(outcomes.every((outcome) => outcome instanceof StoredSqlError)).toBe(true);
    expect(calls.filter((call) => isDiagnosis(call.sqls))).toHaveLength(1);
  });

  it('libère aussitôt un demandeur abandonné pendant le diagnostic, sans faire échouer les autres', async () => {
    let release: (rows: Row[][]) => void = () => undefined;
    const gate = new Promise<Row[][]>((resolve) => {
      release = resolve;
    });
    let others = 0;
    const { client } = fakeClient((sqls) => {
      if (isRead(sqls)) {
        if (sqls[4] === 'select label from labels' && others++ > 0) return ok(sqls, [{ label: 'x' }]); // la seconde fois, l'état est sain
        throw ASSERTION_FAILED();
      }
      return isViewsStep(sqls) ? gate : diagnosisOf(sqls);
    });
    const db = withStoredSqlCheck(client).open('/projet');
    const controller = new AbortController();

    const gone = db.query(Q, { signal: controller.signal }).catch((err: unknown) => err);
    const stays = db.query('select label from labels').catch((err: unknown) => err);
    await new Promise((resolve) => setTimeout(resolve, 10));
    controller.abort();
    expect(isAbortError(await gone)).toBe(true);

    release([[], []]);
    expect(await stays).toEqual([{ label: 'x' }]);
  });

  it('tient chaque base à part : le HEAD retenu pour l’une ne vaut pas pour l’autre', async () => {
    const { client, calls } = fakeClient((sqls) => {
      if (isRead(sqls)) {
        if (pinOf(sqls) === HASH) return ok(sqls, []);
        throw ASSERTION_FAILED();
      }
      return diagnosisOf(sqls, { dirty: true });
    });
    const checked = withStoredSqlCheck(client);

    await checked.open('/a').query(Q);
    await checked.open('/b').query(Q);

    expect(calls.filter((call) => isDiagnosis(call.sqls)).map((call) => call.dir)).toEqual(['/a', '/b']);
  });

  // Le texte d'une erreur de Dolt part tel quel dans la raison d'un Projet illisible. Quand le SQL d'une base s'exécute dans une instruction (celle de la vérification, si une vue lui
  // a échappé : B1a de la relecture de .74 ; ou celle de la lecture), l'erreur de Dolt cite le contenu d'un fichier : `json_extract(load_file(f), '$')` rend « Invalid JSON text … "<contenu>" »,
  // `uuid_to_bin` « unable to parse '<contenu>' to UUID », `st_srid` le contenu en octets entre apostrophes (mesuré sur trente fonctions, avec Dolt 2.5.0). Le contenu peut porter lui-même guillemets,
  // apostrophes et sauts de ligne : une coupe qui apparie les guillemets en laisserait passer la suite (bdesk-38k.74).
  describe('le texte d’une erreur de Dolt ne porte jamais ce que la base lui fait lire', () => {
    const SECRET = 'SECRET-TOKEN-abc123';
    /** Ce que Dolt écrit quand une fonction échoue sur le contenu d'un fichier : entre apostrophes, avec ses propres guillemets, apostrophes et sauts de ligne. */
    const CITED = `${SECRET} "entre guillemets" et l'apostrophe, suite-du-secret\nligne2`;
    const failure = (cause: string, completed?: Row[][]) => new DoltQueryError(`error on line 3 for query […]: ${cause}`, '/projet', false, undefined, completed);
    const readError = async (answer: (sqls: readonly string[]) => Row[][], sql = Q) => {
      const { client } = fakeClient(answer);
      return (await withStoredSqlCheck(client).open('/projet').query(sql).catch((err: unknown) => err)) as Error;
    };
    const noSecret = (message: string) => {
      expect(message).not.toContain(SECRET);
      expect(message).not.toContain('suite-du-secret');
      expect(message).not.toContain('ligne2');
      expect(message).not.toContain('entre guillemets');
    };

    it('une instruction de la vérification qui échoue autrement que par son assertion : un message fixe, que le texte de Dolt ne fait pas varier', async () => {
      // `completed` : une instruction a abouti (la première assertion) avant celle qui échoue, la seconde — la vue cachée de B1a, qui s'exécute quand la seconde lit `dolt_schemas as of 'HEAD'`.
      const error = await readError((sqls) => {
        if (isRead(sqls)) throw failure(`unable to parse '${CITED}' to UUID: invalid UUID length: 58`, [[{}]]);
        return diagnosisOf(sqls);
      });

      expect(error).toBeInstanceOf(DoltQueryError);
      expect(error).not.toBeInstanceOf(StoredSqlError);
      expect(error.message).toMatch(/^La vérification du SQL stocké n'a pas pu s'achever : Dolt a refusé l'une de ses propres requêtes/);
      expect(error.message).toMatch(/message n'est pas repris/);
      noSecret(error.message);
    });

    // bdesk-38k.74, relecture finale, round 4 : R5 (nommer la base voisine responsable) est RETIRÉE. `culpritDatabase` lançait `` select count(*) from `<voisine>`.dolt_nonlocal_tables `` contre jusqu'à
    // vingt bases du même serveur, par le client brut, donc sans la vérification : une voisine qui définit une vue de ce nom en faisait exécuter le corps (`dolt_query_diff('select … into outfile …')`
    // écrit un fichier hors de toute base ; `stored-sql.neighbour.integration.test.ts`). Ne pas chercher à la sécuriser : elle n'améliorait qu'un message.
    describe('R5 retirée : la vérification ne lit que la base qu\'elle vérifie', () => {
      const FIXED =
        "La vérification du SQL stocké n'a pas pu s'achever : Dolt a refusé l'une de ses propres requêtes, dont le message n'est pas repris (il pourrait citer ce que la base lui fait lire). La base n'est pas lue.";
      /** Chaque instruction que la vérification envoie au client, quel que soit le groupe : celles de la lecture, du diagnostic et de la recherche du commit de base. */
      const sentBy = async (answer: (sqls: readonly string[]) => Row[][]) => {
        const { client, calls, learning } = fakeClient(answer);
        const error = (await withStoredSqlCheck(client)
          .open('/projet')
          .query(Q)
          .catch((err: unknown) => err)) as Error;
        return { error, sent: [...learning, ...calls].flatMap(({ sqls }) => sqls) };
      };

      it('une instruction de la vérification que Dolt refuse (la table de redirection d\'une voisine casse `dolt_schemas` pour tout le serveur) : le message fixe, sans nommer aucune base', async () => {
        const { error } = await sentBy((sqls) => {
          if (isRead(sqls)) throw failure(`expected a SchemaTable, but found *sqle.AlterableDoltTable`, [[{}]]);
          return diagnosisOf(sqls);
        });

        expect(error).toBeInstanceOf(DoltQueryError);
        expect(error).not.toBeInstanceOf(StoredSqlError);
        expect(error.message).toBe(FIXED);
      });

      it('aucune instruction n\'est envoyée contre une autre base : ni `information_schema.schemata`, ni `show databases`, ni un nom qualifié par une base (`` `x`.table ``)', async () => {
        const failures: [string, (sqls: readonly string[]) => Row[][]][] = [
          ['la lecture refusée', (sqls) => { if (isRead(sqls)) throw failure('expected a SchemaTable', [[{}]]); return diagnosisOf(sqls); }],
          ['le diagnostic refusé', (sqls) => { if (isRead(sqls)) throw ASSERTION_FAILED(); throw failure('expected a SchemaTable'); }],
          ['la lecture saine', (sqls) => (isRead(sqls) ? ok(sqls) : diagnosisOf(sqls))],
        ];
        for (const [label, answer] of failures) {
          const { sent } = await sentBy(answer);

          expect(sent.length, label).toBeGreaterThan(0);
          for (const sql of sent) {
            expect(sql, label).not.toMatch(/schemata|show\s+databases|information_schema\.schemata/i);
            expect(sql, label).not.toMatch(/`[^`]*`\s*\.\s*\w/); // un identifiant entre accents graves suivi d'un point : une table qualifiée par sa base
          }
        }
      });

      it('même quand une base voisine « répondrait oui » : le client n\'est jamais interrogé sur elle, la raison reste la même', async () => {
        const asked: string[] = [];
        const { error } = await sentBy((sqls) => {
          asked.push(...sqls);
          if (isRead(sqls)) throw failure('expected a SchemaTable', [[{}]]);
          if (sqls[0]?.startsWith('select count(*) as c from `')) return [[{ c: 1 }]]; // ce qu'aurait répondu une voisine
          return diagnosisOf(sqls);
        });

        expect(error.message).toBe(FIXED);
        expect(error.message).not.toMatch(/evil|semble la cause|voisin/i);
        expect(asked.some((sql) => sql.startsWith('select count(*) as c from `'))).toBe(false);
      });
    });

    it('de même au dernier essai, dont les relevés d’`information_schema` sont aussi des instructions de la vérification', async () => {
      let reads = 0;
      const error = await readError((sqls) => {
        if (isEvidence(sqls)) throw failure(`Invalid JSON text in argument 1 to function json_extract: "${CITED}"`, [[], []]); // les deux relevés ont abouti, la première assertion échoue
        if (isRead(sqls)) {
          reads++;
          throw ASSERTION_FAILED();
        }
        return diagnosisOf(sqls);
      });

      expect(reads).toBe(2);
      expect(error.message).toMatch(/n'a pas pu s'achever/);
      noSecret(error.message);
    });

    it('de même pour une instruction du diagnostic, quel que soit son temps', async () => {
      const first = await readError((sqls) => {
        if (isRead(sqls)) throw ASSERTION_FAILED();
        throw failure(`Incorrect datetime(6) value: '${CITED}'`);
      });
      const second = await readError((sqls) => {
        if (isRead(sqls)) throw ASSERTION_FAILED();
        if (isViewsStep(sqls)) return [[], []];
        throw failure(`Incorrect datetime(6) value: '${CITED}'`);
      });

      for (const error of [first, second]) {
        expect(error.message).toMatch(/n'a pas pu s'achever/);
        noSecret(error.message);
      }
    });

    // bdesk-38k.74, round 3, relecture finale : « ne jamais rendre le texte d'une erreur de Dolt ». Il était repris jusqu'à la première citation qui n'est pas un nom de la requête, et
    // `from_base64` rend le contenu sans aucune citation (« illegal base64 data at input byte 4407630 » : le nombre est un octet d'un fichier) : une coupe par citation est une liste noire.
    // Une liste blanche à la place : un message fixe par classe de cause, dont deux disent le nom — un nom que la requête écrit elle-même — de ce qui manque.
    const READ_FIXED = "Dolt a refusé une lecture de l'app : le texte de son erreur n'est pas repris (il pourrait citer ce que la base lui fait lire).";
    const failRead = (cause: string, sql = Q, completed: Row[][] | undefined = [[{}], [{}], [], []]) =>
      readError((sqls) => {
        if (isRead(sqls)) throw failure(cause, completed);
        return diagnosisOf(sqls);
      }, sql);

    it.each([
      ['une chaîne JSON invalide, entre guillemets', `Invalid JSON text in argument 1 to function json_extract: "${CITED}"`],
      ['un UUID illisible, entre apostrophes', `unable to parse '${CITED}' to UUID: invalid UUID length: 58`],
      ['une date illisible, entre apostrophes', `Incorrect datetime(6) value: '${CITED}'`],
      ['des octets entre apostrophes', `illegal non geometric '[83 69 67 82 69 84 45 84 79 75 69 78]' value found during parsing`],
      // L'oracle de B-FI : aucune citation à couper, le nombre est un octet d'un fichier (mesuré : 4407630 = 0x43414E = « CAN »).
      ['from_base64, sans aucune citation (l’oracle de B-FI)', 'illegal base64 data at input byte 4407630'],
      ['le contenu lui-même, sans aucune citation', `${CITED.replaceAll("'", '').replaceAll('"', '')}`],
    ])('une instruction de la lecture qui échoue : jamais le texte de Dolt, un message fixe — %s', async (_label, cause) => {
      const error = await failRead(cause);

      expect(error).toBeInstanceOf(DoltQueryError);
      expect(error.message).toBe(READ_FIXED);
      noSecret(error.message);
      expect(error.message).not.toMatch(/4407630|base64|\[83 69|illegal|Invalid|unable to parse/);
    });

    it('dit ce qui manque, par un nom que la requête écrit elle-même : la table, ou la colonne', async () => {
      const column = await failRead('column "title" could not be found in any table in scope', "select title from issues as of 'HEAD'");
      const table = await failRead('table not found: issues', "select title from issues as of 'HEAD'");
      const qualified = await failRead('table not found: dolt_history_issues', 'select id from dolt_history_issues');

      expect(column.message).toBe("Dolt ne trouve pas la colonne « title » que l'app lit.");
      expect(table.message).toBe("Dolt ne trouve pas la table « issues » que l'app lit.");
      expect(qualified.message).toBe("Dolt ne trouve pas la table « dolt_history_issues » que l'app lit.");
    });

    it('ne dit jamais un nom que la requête n’écrit pas : un contenu qui se fait passer pour un nom de table ou de colonne reste sous le message fixe', async () => {
      for (const cause of [
        `column "${SECRET}" could not be found in any table in scope`,
        'column "hunter2secret" could not be found in any table in scope', // ressemble à un nom, n'en est pas un des nôtres
        'column "a" could not be found in any table in scope', // « a » est un alias de la vérification : moins de trois caractères, jamais un nom admis
        `table not found: ${SECRET}`,
        'table not found: hunter2secret',
        'table not found: issues; et autre chose', // un nom suivi de texte
        'column "title" could not be found in any table in scope, suite-du-secret', // le motif exige la fin du texte
      ]) {
        const error = await failRead(cause, "select title from issues as of 'HEAD'");

        expect(error.message, cause).toBe(READ_FIXED);
      }
    });

    it('sans `completed` (la sortie de Dolt n’a pas pu se lire), on ne sait pas laquelle a échoué : le message fixe de la lecture, qui ne dit rien de plus', async () => {
      const error = await failRead(`Invalid JSON text in argument 1 to function json_extract: "${CITED}"`, Q, undefined);

      expect(error.message).toBe(READ_FIXED);
      noSecret(error.message);
    });

    it('ne touche pas aux erreurs que le client écrit lui-même (délai, taille, binaire, file pleine, code de sortie sans message) : leur texte n\'est pas celui de Dolt', async () => {
      for (const original of [
        new DoltQueryError('Délai dépassé (60000 ms) pour lire /projet', '/projet'),
        new DoltQueryError('Sortie de dolt trop volumineuse (plus de 512 Mo) pour lire /projet', '/projet'),
        new DoltQueryError('Trop de lectures Dolt en attente (plus de 1000) : réessayez dans un instant.', '/projet'),
        new DoltQueryError('dolt a échoué (code de sortie 3) sans message d\'erreur', '/projet'),
        new DoltQueryError('Impossible de lancer « dolt » : E2BIG.', '/projet'),
      ]) {
        const error = await readError(() => {
          throw original;
        });

        expect(error).toBe(original);
      }
    });

    // m4 (relecture finale, round 4). `guarded` ne remplaçait que le texte qui a la forme « error on line N for query » : une autre sortie d'erreur de Dolt (un verrou, une permission, un plantage,
    // `illegal base64 data at input byte N` quand rien n'a cité la requête) passait telle quelle, dans le message d'un Projet illisible. Le client marque maintenant ce qu'il a lu sur la sortie
    // d'erreur de Dolt (`DoltTextError`), et la vérification ne le rend jamais : un message fixe par classe de cause, à chaque sortie du client vérifié, quelle que soit l'instruction qui a échoué.
    describe('m4 : le texte de Dolt n\'est jamais rendu, même sans la forme « error on line N », un message fixe par classe', () => {
      const OTHER = "Dolt n'a pas pu lire la base : le texte de son erreur n'est pas repris (il pourrait citer ce que la base lui fait lire).";
      const LOCKED = 'La base est tenue par un autre processus dolt : réessayez dans un instant.';
      const PERMISSION = 'Dolt ne peut pas ouvrir les fichiers de la base : permission refusée.';
      const UNREADABLE = 'La sortie de dolt est illisible.';
      const textError = (text: string, locked = false) => new DoltTextError(text, 'stderr', '/projet', locked);

      // Une boîte noire : le vrai client sur un faux binaire `dolt` qui écrit `text` sur sa sortie d'erreur. `select hashof('HEAD')` ne nomme aucune table : il passe sans la vérification
      // (et sans recherche du commit de base), son erreur est celle du client, brute avant ce round.
      const client = (script: string, timeoutMs = 60_000) => {
        const fake = fakeDolt(script);
        return withStoredSqlCheck(createDoltClient({ binary: fake.binary, retries: 1, retryDelayMs: 1, timeoutMs, rootPath: fakeDoltRoot() }));
      };
      const head = async (db: DoltDatabase): Promise<DoltQueryError> => (await db.query("select hashof('HEAD') as head").catch((err: unknown) => err)) as DoltQueryError;

      it.each([
        ['from_base64, sans aucune citation (l\'oracle de B-FI)', 'illegal base64 data at input byte 4407630'],
        ['le contenu d\'un fichier, tel quel', `${SECRET} le contenu du fichier`],
        ['un plantage de Dolt', 'panic: runtime error: index out of range [3] with length 2'],
        ['une erreur de connexion, avec un nom de base', 'failed to connect to database "evil": dial tcp 127.0.0.1:3307: connect: connection refused'],
      ])('une erreur de Dolt qui n\'a pas la forme « error on line N » : %s', async (_label, text) => {
        const error = await head(client(`echo '${text}' >&2; exit 1`).open(tmpdir()));

        expect(error).toBeInstanceOf(DoltQueryError);
        expect(error.message).toBe(OTHER);
        expect(error.message).not.toContain(text.slice(0, 12));
      });

      it('le verrou : un message fixe, et le drapeau `locked` demeure', async () => {
        const error = await head(client(`echo 'database "beads" is locked by another dolt process; either clone the database to run a second server' >&2; exit 1`).open(tmpdir()));

        expect(error.message).toBe(LOCKED);
        expect(error.locked).toBe(true);
        expect(error.message).not.toMatch(/beads|clone/);
      });

      it('une permission refusée : un message fixe, sans le chemin ni le nom de fichier que Dolt cite', async () => {
        const error = await head(client(`echo 'fslock new /home/quelquun/projet/.dolt/noms/LOCK: open /home/quelquun/projet/.dolt/noms/LOCK: permission denied' >&2; exit 1`).open(tmpdir()));

        expect(error.message).toBe(PERMISSION);
        expect(error.message).not.toMatch(/quelquun|fslock/);
      });

      it('une sortie illisible : un message fixe, sans le fragment de la sortie que l\'analyse cite', async () => {
        const error = await head(client(`echo '${SECRET} pas du json'`).open(tmpdir()));

        expect(error).toBeInstanceOf(DoltQueryError);
        expect(error.message).toBe(UNREADABLE);
        expect(error.message).not.toContain(SECRET);
      });

      it('les erreurs que le client écrit lui-même passent telles quelles : un délai, un code de sortie sans message', async () => {
        const slow = await head(client('sleep 5', 150).open(tmpdir()));
        const silent = await head(client('exit 3').open(tmpdir()));

        expect(slow.message).toMatch(/^Délai dépassé \(150 ms\) pour lire /);
        expect(silent.message).toBe("dolt a échoué (code de sortie 3) sans message d'erreur");
      });

      it('la même sortie du client vérifié, par `queryAll` : la même raison, jamais le texte', async () => {
        const db = client(`echo 'illegal base64 data at input byte 4407630' >&2; exit 1`).open(tmpdir());

        const error = (await (db.queryAll?.(["select hashof('HEAD') as head", "select hashof('HEAD') as h2"]) ?? Promise.reject(new Error('queryAll manque'))).catch((err: unknown) => err)) as Error;

        expect(error.message).toBe(OTHER);
      });

      // Les autres chemins, par un client factice qui rend l'erreur marquée : chaque instruction de la vérification, et la lecture, finissent sous le même message fixe.
      it.each([
        ['une instruction de la lecture', (sqls: readonly string[]) => { if (isRead(sqls)) throw textError('illegal base64 data at input byte 4407630', false); return diagnosisOf(sqls); }],
        ['le dernier essai (ses relevés)', (sqls: readonly string[]) => { if (isEvidence(sqls)) throw textError(`${SECRET} au dernier essai`); if (isRead(sqls)) throw ASSERTION_FAILED(); return diagnosisOf(sqls); }],
        ['le premier temps du diagnostic', (sqls: readonly string[]) => { if (isRead(sqls)) throw ASSERTION_FAILED(); throw textError(`${SECRET} au diagnostic`); }],
        ['le deuxième temps du diagnostic', (sqls: readonly string[]) => { if (isRead(sqls)) throw ASSERTION_FAILED(); if (isViewsStep(sqls)) return [[], [], [], [{ working: 0, head: 0 }]]; throw textError(`${SECRET} au deuxième temps`); }],
      ])('%s : le texte marqué de Dolt n\'est pas rendu, un message fixe à la place', async (_label, answer) => {
        const error = await readError(answer);

        expect(error).toBeInstanceOf(DoltQueryError);
        expect(error.message).toBe(OTHER);
      });

      it.each([
        ['la recherche du commit de base : le premier commit', { root: () => { throw textError(`${SECRET} root`); } }],
        ['la recherche du commit de base : la sonde', { probe: () => { throw textError(`${SECRET} sonde`); } }],
        ['la recherche du commit de base : la liste de la révision', { tables: () => { throw textError(`${SECRET} liste`); } }],
      ])('%s : le texte marqué de Dolt n\'est pas rendu', async (_label, learn) => {
        const { client: fake } = fakeClient((sqls) => (isRead(sqls) ? ok(sqls) : diagnosisOf(sqls)), learn);

        const error = (await withStoredSqlCheck(fake).open('/projet').query(Q).catch((err: unknown) => err)) as Error;

        expect(error.message).toBe(OTHER);
      });

      it('l\'époque d\'un schéma (`storedSqlAt`) : de même', async () => {
        const { client: fake } = fakeClient((sqls) => {
          if (isRead(sqls)) throw textError(`${SECRET} époque`);
          return diagnosisOf(sqls);
        });

        const error = (await (withStoredSqlCheck(fake).open('/projet').storedSqlAt?.(COMMIT_FOR_ERA) ?? Promise.reject(new Error('storedSqlAt manque'))).catch((err: unknown) => err)) as Error;

        expect(error.message).toBe(OTHER);
      });

      it('les erreurs de la vérification elle-même ne sont pas du texte de Dolt : un `StoredSqlError` passe tel quel, avec ses objets', async () => {
        const { client: fake } = fakeClient((sqls) => (isRead(sqls) ? ok(sqls, [{ id: 'a-1' }]) : diagnosisOf(sqls)), { tables: () => [[{ 'Tables_in_projet/x': 'issues', Table_type: 'BASE TABLE' }]] });

        const error = (await withStoredSqlCheck(fake).open('/projet').query(Q).catch((err: unknown) => err)) as StoredSqlError;

        expect(error).toBeInstanceOf(StoredSqlError);
        expect(error.objects).toHaveLength(1);
      });
    });
  });

  // B-NL (relecture finale de bdesk-38k.74). Une ligne de `dolt_nonlocal_tables` mène un nom de table vers une autre table ; la table se cache d'elle-même si on la lit par son nom. La
  // vérification la compte par des fonctions de table qui comparent deux racines sans résoudre aucun nom, par rapport à un commit où elle n'est pas (le commit de base) : un par base,
  // cherché une fois, avant la première lecture. Sans lui, la première assertion échoue toujours.
  describe('dolt_nonlocal_tables : le commit de base et ce que la table porte', () => {
    const reading = (client: DoltClient, dir = '/projet') => withStoredSqlCheck(client).open(dir).query(Q).catch((err: unknown) => err);
    const healthy = (sqls: readonly string[]) => (isRead(sqls) ? ok(sqls) : diagnosisOf(sqls));

    it('cherche le commit de base de chaque base une fois, avant sa première lecture, par deux fonctions de table qui ne résolvent aucun nom de table, puis vérifie que sa révision est vide', async () => {
      const { client, calls, learning } = fakeClient(healthy);
      const checked = withStoredSqlCheck(client);

      await checked.open('/a').query(Q);
      await checked.open('/a').query(Q);
      await checked.open('/b').query(Q);

      expect(learning.map(({ dir, sqls }) => [dir, ...sqls])).toEqual([
        ['/a', "select commit_hash from dolt_log('HEAD') order by commit_order asc limit 1", 'select database() as name'],
        ['/a', `select count(*) as c from dolt_diff_stat('${BASE}', '${BASE}', 'dolt_nonlocal_tables')`],
        ['/a', `show full tables from \`${DATABASE}/${BASE}\``],
        ['/b', "select commit_hash from dolt_log('HEAD') order by commit_order asc limit 1", 'select database() as name'],
        ['/b', `select count(*) as c from dolt_diff_stat('${BASE}', '${BASE}', 'dolt_nonlocal_tables')`],
        ['/b', `show full tables from \`${DATABASE}/${BASE}\``],
      ]);
      for (const { sqls } of learning) for (const sql of sqls) expect(() => assertReadOnly(sql)).not.toThrow();
      // Chaque lecture porte la première assertion avec le commit de base.
      expect(calls.map((call) => call.sqls[0])).toEqual([storedViewsAssertion(BASE), storedViewsAssertion(BASE), storedViewsAssertion(BASE)]);
    });

    it('n’en cherche qu’un pour les lectures qui partent ensemble', async () => {
      let release: (rows: Row[][]) => void = () => undefined;
      const gate = new Promise<Row[][]>((resolve) => {
        release = resolve;
      });
      const { client, learning } = fakeClient(healthy, { root: () => gate as unknown as Row[][] });
      const db = withStoredSqlCheck(client).open('/projet');

      const reads = [db.query(Q), db.query('select label from labels'), db.query('select author from comments')];
      await new Promise((resolve) => setTimeout(resolve, 10));
      release([[{ commit_hash: BASE }]]);
      await Promise.all(reads);

      expect(learning.filter(({ sqls }) => isRootCommit(sqls))).toHaveLength(1);
    });

    it('refuse une base dont le premier commit a déjà `dolt_nonlocal_tables` : sans commit où elle manque, on ne peut pas dire qu’elle est vide', async () => {
      const { client, calls } = fakeClient(healthy, { probe: () => [[]] }); // la sonde réussit : la table y est

      const error = await reading(client);

      expect(error).toBeInstanceOf(StoredSqlError);
      expect((error as Error).message).toContain('« dolt_nonlocal_tables » existe déjà dans le premier commit');
      expect(calls).toEqual([]); // la lecture n'est jamais envoyée
    });

    // bdesk-38k.74, round 4. `dolt_schema_diff` et `dolt_diff_summary` ne rendent que ce qui diffère entre leurs deux racines : une table que le commit de base porte déjà et que HEAD n'a
    // pas changée n'y est pas, et son `CREATE TABLE` (un index fonctionnel) ne serait jamais jugé. Mesuré : `dolt commit --amend` sur le commit d'`init` y met les tables.
    describe('un premier commit qui a déjà des tables ou des vues', () => {
      const listing = (...rows: [string, string][]): (() => Row[][]) => () => [rows.map(([name, type]) => ({ [`Tables_in_${DATABASE}/${BASE}`]: name, Table_type: type }))];

      it('refuse la base en nommant la table, sans envoyer la lecture : son CREATE TABLE ne se jugerait jamais', async () => {
        const { client, calls } = fakeClient(healthy, { tables: listing(['issues', 'BASE TABLE'], ['labels', 'BASE TABLE']) });

        const error = await reading(client);

        expect(error).toBeInstanceOf(StoredSqlError);
        expect((error as StoredSqlError).objects).toEqual([
          '« issues » existe déjà dans le premier commit : sans commit où elle manque, on ne peut pas juger son CREATE TABLE',
          '« labels » existe déjà dans le premier commit : sans commit où elle manque, on ne peut pas juger son CREATE TABLE',
        ]);
        expect(calls).toEqual([]);
      });

      it('refuse de même une vue : la liste de la révision doit être vide, pas seulement sans table', async () => {
        const { client, calls } = fakeClient(healthy, { tables: listing(['ready_issues', 'VIEW']) });

        const error = await reading(client);

        expect(error).toBeInstanceOf(StoredSqlError);
        expect((error as StoredSqlError).objects).toHaveLength(1);
        expect(calls).toEqual([]);
      });

      it('ne retient pas ce commit : la lecture suivante cherche de nouveau, et le refus se répète', async () => {
        const { client, learning } = fakeClient(healthy, { tables: listing(['issues', 'BASE TABLE']) });
        const db = withStoredSqlCheck(client).open('/projet');

        await db.query(Q).catch(() => undefined);
        await db.query(Q).catch(() => undefined);

        expect(learning.filter(({ sqls }) => isRootCommit(sqls))).toHaveLength(2);
      });

      it('nomme la révision du commit de base par le nom de la base, cité comme identifiant : rien de ce que celle-ci porte ne devient du SQL', async () => {
        const { client, learning } = fakeClient(healthy, { root: () => [[{ commit_hash: BASE }], [{ name: 'a`b/c' }]] });

        await reading(client);

        const sql = learning.find(({ sqls }) => isBaseTables(sqls))?.sqls[0];
        expect(sql).toBe(`show full tables from \`a\`\`b/c/${BASE}\``);
        expect(() => assertReadOnly(sql ?? '')).not.toThrow();
      });

      it('ne reprend pas le texte de Dolt quand il refuse la liste : message fixe de la vérification', async () => {
        const { client } = fakeClient(healthy, { tables: () => { throw new DoltQueryError(`error on line 1 for query […]: unable to parse 'SECRET-TOKEN' to UUID`, '/projet'); } });

        const error = await reading(client);

        expect((error as Error).message).toMatch(/^La vérification du SQL stocké n'a pas pu s'achever/);
        expect((error as Error).message).not.toContain('SECRET-TOKEN');
      });
    });

    it('dit qu’une base sans commit ne peut pas se vérifier', async () => {
      const { client, calls } = fakeClient(healthy, { root: () => [[]] });

      const error = await reading(client);

      expect(error).toBeInstanceOf(DoltQueryError);
      expect((error as Error).message).toMatch(/Aucun commit dans \/projet/);
      expect(calls).toEqual([]);
    });

    it('ne reprend pas le texte de Dolt quand il refuse l’une des deux instructions de la recherche ; une erreur du client, elle, passe telle quelle', async () => {
      const refused = await reading(fakeClient(healthy, { root: () => { throw new DoltQueryError(`error on line 1 for query […]: unable to parse 'SECRET-TOKEN' to UUID`, '/projet'); } }).client);
      const probed = await reading(fakeClient(healthy, { probe: () => { throw new DoltQueryError("error on line 1 for query […]: Invalid JSON text \"SECRET-TOKEN\"", '/projet'); } }).client);
      const timeout = new DoltQueryError('Délai dépassé (60000 ms) pour lire /projet', '/projet');
      const slow = await reading(fakeClient(healthy, { root: () => { throw timeout; } }).client);

      for (const error of [refused, probed]) {
        expect((error as Error).message).toMatch(/^La vérification du SQL stocké n'a pas pu s'achever/);
        expect((error as Error).message).not.toContain('SECRET-TOKEN');
      }
      expect(slow).toBe(timeout);
    });

    // R3 (relecture finale, round 3) : une seule phrase, jamais « (dans HEAD) » répété à côté d'une autre pour la même table — que la table soit non vide dans le working set, dans
    // HEAD, ou les deux, c'est la même migration de bd en cours qu'elles décrivent toutes.
    it.each<[string, { working?: unknown; head?: unknown }]>([
      ['les lignes du working set', { working: 1 }],
      ['les lignes de HEAD', { head: 1 }],
      ['les deux, comptes en chaînes derrière un serveur', { working: '1', head: '2' }],
    ])('refuse en nommant la table, en une seule phrase qui dit la migration de bd, que le diagnostic relève dans : %s', async (_label, nonlocal) => {
      const { client, calls } = fakeClient((sqls) => {
        if (isRead(sqls)) throw ASSERTION_FAILED();
        return diagnosisOf(sqls, { nonlocal });
      });

      const error = await reading(client);

      expect(error).toBeInstanceOf(StoredSqlError);
      expect((error as Error).message).toContain("« dolt_nonlocal_tables » n'est pas vide : bd semble être en train de migrer cette base");
      expect((error as Error).message).toMatch(/réessayez dans un instant, ou lancez n'importe quelle commande bd/);
      expect((error as Error).message).not.toContain('(dans HEAD)'); // jamais répétée pour la même table
      expect((error as StoredSqlError).objects).toHaveLength(1); // une seule raison, quel que soit ce que le diagnostic a relevé
      expect(calls.filter((call) => isRead(call.sqls))).toHaveLength(1); // aucun autre essai : le diagnostic a nommé la table
    });

    it('ne dit rien d’un compte nul, en nombre comme en chaîne (derrière un serveur) : la lecture reprend', async () => {
      for (const zero of [0, '0']) {
        let failed = false;
        const { client, calls } = fakeClient((sqls) => {
          if (isRead(sqls) && !failed) {
            failed = true;
            throw ASSERTION_FAILED(); // l'assertion échoue une fois : le diagnostic relève les comptes, tous nuls
          }
          return isRead(sqls) ? ok(sqls) : diagnosisOf(sqls, { nonlocal: { working: zero, head: zero } });
        });

        expect(await withStoredSqlCheck(client).open('/projet').query(Q)).toEqual([{ id: 'a-1' }]);
        expect(calls.some((call) => isViewsStep(call.sqls)), String(zero)).toBe(true); // le diagnostic a bien relevé les comptes
        expect(calls.filter((call) => isRead(call.sqls))).toHaveLength(2);
      }
    });

    it('le relevé du diagnostic ne résout aucun nom, ne lit que `dolt_nonlocal_tables` par fonction de table, et passe le garde', async () => {
      const { client, calls } = fakeClient((sqls) => {
        if (isRead(sqls)) throw ASSERTION_FAILED();
        return diagnosisOf(sqls, { nonlocal: { working: 1 } });
      });

      await reading(client);

      const step = calls.find((call) => isViewsStep(call.sqls))?.sqls ?? [];
      expect(step).toHaveLength(4);
      expect(step[3]).toMatch(/^select w\.c as working, h\.c as head from \(select count\(\*\) as c from dolt_schema_diff\(/);
      expect(step[3]).not.toMatch(/from\s+dolt_nonlocal_tables/);
      for (const sql of step) expect(() => assertReadOnly(sql)).not.toThrow();
    });

    it('les deux derniers temps du diagnostic portent le commit de base dans leur assertion des vues : une table arrivée depuis le premier temps les arrête', async () => {
      // Une lecture qui échoue une fois lance le diagnostic, dont le working set est modifié : les trois temps.
      let failed = false;
      const { client, calls } = fakeClient((sqls) => {
        if (isRead(sqls) && !failed) {
          failed = true;
          throw ASSERTION_FAILED();
        }
        return isRead(sqls) ? ok(sqls) : diagnosisOf(sqls, { dirty: true });
      });
      await withStoredSqlCheck(client).open('/projet').query(Q);

      const state = calls.find((call) => isStateStep(call.sqls))?.sqls ?? [];
      const probe = calls.find((call) => isPinStep(call.sqls))?.sqls ?? [];
      expect(state[0]).toBe(storedViewsAssertion(BASE));
      expect(probe[0]).toBe(storedViewsAssertion(BASE));
    });

    // Le commit de base disparaît quand l'historique est réécrit (un rebase, une base re-clonée sous le même nom) : la première instruction de la lecture échoue, avant tout le reste.
    it('en cherche un autre quand le sien a disparu : la première instruction échoue, la lecture repart avec le nouveau', async () => {
      const BASE_2 = 'q6p5o4n3m2l1k0j9i8h7g6f5e4d3c2b1';
      let roots = 0;
      let failed = false;
      const { client, calls, learning } = fakeClient(
        (sqls) => {
          if (isRead(sqls) && !failed) {
            failed = true;
            throw new DoltQueryError('error on line 1 for query […]: commit not found: ' + BASE, '/projet', false, undefined, []);
          }
          return isRead(sqls) ? ok(sqls) : diagnosisOf(sqls);
        },
        { root: () => [[{ commit_hash: roots++ === 0 ? BASE : BASE_2 }], [{ name: DATABASE }]] },
      );

      expect(await withStoredSqlCheck(client).open('/projet').query(Q)).toEqual([{ id: 'a-1' }]);

      expect(calls.map((call) => call.sqls[0])).toEqual([storedViewsAssertion(BASE), storedViewsAssertion(BASE_2)]);
      expect(learning.filter(({ sqls }) => isRootCommit(sqls))).toHaveLength(2);
    });

    it('en cherche un autre, une fois, quand le relevé du diagnostic échoue parce que le sien a disparu', async () => {
      const BASE_2 = 'q6p5o4n3m2l1k0j9i8h7g6f5e4d3c2b1';
      let roots = 0;
      let reads = 0;
      const { client, learning } = fakeClient(
        (sqls) => {
          if (isRead(sqls)) {
            if (reads++ === 0) throw ASSERTION_FAILED();
            return ok(sqls);
          }
          if (isViewsStep(sqls) && sqls[3]?.includes(`'${BASE}'`)) throw new DoltQueryError('error on line 3 for query […]: commit not found', '/projet', false, undefined, [[], [], []]);
          return diagnosisOf(sqls);
        },
        { root: () => [[{ commit_hash: roots++ === 0 ? BASE : BASE_2 }], [{ name: DATABASE }]] },
      );

      expect(await withStoredSqlCheck(client).open('/projet').query(Q)).toEqual([{ id: 'a-1' }]);

      expect(learning.filter(({ sqls }) => isRootCommit(sqls))).toHaveLength(2);
    });

    it('ne cherche pas de commit de base pour une lecture qui ne nomme aucune table', async () => {
      const { client, learning } = fakeClient(() => [[{ head: 'abc' }]]);

      await withStoredSqlCheck(client).open('/projet').query("select hashof('HEAD') as head");

      expect(learning).toEqual([]);
    });
  });

  // L'époque d'un schéma est relue dans la base de révision de son ancre (`<base>/<commit>`), où Dolt résout les noms avec la `dolt_nonlocal_tables` de ce commit-là.
  describe('storedSqlAt : ce que la table porte dans le commit d’une époque', () => {
    const COMMIT = 'm1n2o3p4q5r6s7t8u9v0a1b2c3d4e5f6';

    it('rend aucune raison quand la table du commit est vide ou absente, et une raison qui nomme le commit sinon', async () => {
      for (const [count, expected] of [[0, []], ['0', []], [1, ["« dolt_nonlocal_tables » n'est pas vide (époque du commit m1n2o3p4)"]]] as const) {
        // Le relevé du commit (le compte, puis le `CREATE TABLE` des cinq tables de cette époque : `dependencies` doit y avoir sa ligne, m2).
        const { client, calls } = fakeClient((sqls) => (isRead(sqls) ? [...ok(sqls, [{ c: count }]), schemaRows()] : diagnosisOf(sqls)));

        const problems = await withStoredSqlCheck(client).open('/projet').storedSqlAt?.(COMMIT);

        expect(problems).toEqual(expected.map((text) => expect.stringContaining(text)));
        // La lecture passe par la vérification : les assertions d'abord, puis le relevé du commit, par les mêmes fonctions de table.
        expect(calls[0]?.sqls[0]).toBe(storedViewsAssertion(BASE));
        expect(calls[0]?.sqls[4]).toContain(`dolt_schema_diff('${BASE}', '${COMMIT}')`);
        expect(calls[0]?.sqls[4]).toContain(`dolt_diff_summary('${BASE}', '${COMMIT}')`);
        expect(() => assertReadOnly(calls[0]?.sqls[4] ?? '')).not.toThrow();
      }
    });

    it.each(['', 'HEAD', 'abc', `${COMMIT}0`, "m1n2o3p4q5r6s7t8u9v0a1b2c3d4e5f'", 'M1N2O3P4Q5R6S7T8U9V0A1B2C3D4E5F6', 'w1n2o3p4q5r6s7t8u9v0a1b2c3d4e5f6'])('refuse un commit qui n’a pas la forme d’un hash de Dolt : %j', async (commit) => {
      const { client, calls } = fakeClient((sqls) => (isRead(sqls) ? ok(sqls, [{ c: 0 }]) : diagnosisOf(sqls)));

      const error = await withStoredSqlCheck(client).open('/projet').storedSqlAt?.(commit).catch((err: unknown) => err);

      expect(error).toBeInstanceOf(DoltQueryError);
      expect(calls).toEqual([]);
    });
  });

  // bdesk-38k.74, round 3, B-FI (relecture finale). Un index fonctionnel est une colonne générée cachée : `information_schema.columns` et `show full columns` ne la listent pas, et
  // Dolt évalue son expression à chaque lecture. Deux étages : la première assertion compte `information_schema.statistics` (le working set : Dolt abandonne le groupe avant la
  // lecture) ; le `CREATE TABLE` de chaque table lue (working set, HEAD, et l'ancre d'une époque) est confronté à une grammaire fermée (`create-table.ts`), par une fonction de table
  // qui ne résout aucun nom.
  describe('B-FI : les index fonctionnels (information_schema.statistics) et le CREATE TABLE de chaque table lue (grammaire fermée)', () => {
    const CLEAN_ISSUES = 'CREATE TABLE `issues` (`id` varchar(255) NOT NULL, `title` varchar(500) NOT NULL, PRIMARY KEY (`id`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;';
    const CLEAN_DEPENDENCIES =
      "CREATE TABLE `dependencies` (\n  `issue_id` varchar(255) NOT NULL,\n  `depends_on_issue_id` varchar(255),\n  `depends_on_wisp_id` varchar(255),\n  `depends_on_external` varchar(255),\n" +
      "  `metadata` json DEFAULT (json_object()),\n  PRIMARY KEY (`issue_id`),\n  CONSTRAINT `fk_dep_issue` FOREIGN KEY (`issue_id`) REFERENCES `issues` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,\n" +
      "  CONSTRAINT `ck_dep_one_target` CHECK (((((NOT(`depends_on_issue_id` IS NULL)) + (NOT(`depends_on_wisp_id` IS NULL))) + (NOT(`depends_on_external` IS NULL))) = 1))\n) ENGINE=InnoDB;";
    /** Un index fonctionnel qui lirait un fichier : l'oracle de B-FI (un octet du fichier par la position de l'erreur « illegal base64 »). */
    const HOSTILE =
      "CREATE TABLE `issues` (`id` varchar(255) NOT NULL, PRIMARY KEY (`id`), KEY `fi` ((from_base64(concat(repeat('A', conv(hex(substr(load_file('/x'),1,3)),16,10)), '!'))))) ENGINE=InnoDB;";
    const GENERIC = 'colonne générée, index fonctionnel, ou autre construction non admise';
    const readWith = async (schema: { working?: Row[]; head?: Row[]; workingMissing?: string[]; headMissing?: string[] }) => {
      const { client, calls } = fakeClient((sqls) => (isRead(sqls) ? okWithSchema(sqls, schema, [{ id: 'SECRET' }]) : diagnosisOf(sqls)));
      const result = await withStoredSqlCheck(client).open('/projet').query(Q).catch((err: unknown) => err);
      return { result, calls };
    };

    it('la première assertion compte les index fonctionnels des tables lues dans le working set, sans les évaluer : `information_schema.statistics`, `expression` non vide', () => {
      const first = storedViewsAssertion();

      expect(first).toContain("from information_schema.statistics where table_schema = database() and table_name in ('issues', 'dependencies', 'labels', 'comments', 'config') and expression <> ''");
      expect(() => assertReadOnly(first)).not.toThrow();
    });

    it('le CREATE TABLE se lit par `dolt_schema_diff`, jamais par `show create table` : le garde de lecture seule refuse `create` et `table` écrits comme mots nus', () => {
      for (const to of ['WORKING', 'HEAD', COMMIT_FOR_ERA]) {
        const sql = schemaCreateSql(BASE, to);

        // `lower(d.to_table_name)` : la colonne est en collation binaire, et `Issues`, `ISSUES` ou `İssues` sont lues comme `issues` (mesuré, voir `schemaCreateSql`). Une jointure à gauche depuis les cinq
        // noms attendus (round 4, m2) : une ligne par table, `tbl` et `stmt` absents quand la comparaison n'a rien pour elle.
        expect(sql).toBe(
          `select n.expected as expected, d.to_table_name as tbl, d.to_create_statement as stmt from (select 'issues' as expected union all select 'dependencies' union all select 'labels' union all select 'comments' union all select 'config') n left join dolt_schema_diff('${BASE}', '${to}') d on lower(d.to_table_name) = n.expected`,
        );
        expect(sql).not.toMatch(/\bcreate\b|\btable\b/i); // `to_create_statement` et `to_table_name` sont chacun un seul mot
        expect(() => assertReadOnly(sql)).not.toThrow();
      }
      expect(() => assertReadOnly("show create table `p/abc`.dependencies")).toThrow(/mot interdit/); // la raison pour laquelle l'ancre d'une époque ne le lit pas ainsi
    });

    it('refuse une lecture dont le CREATE TABLE du working set porte un index fonctionnel, sans rendre aucune ligne ni citer ce que l’index lirait', async () => {
      const { result } = await readWith({ working: [{ tbl: 'issues', stmt: HOSTILE }, { tbl: 'dependencies', stmt: CLEAN_DEPENDENCIES }], head: [{ tbl: 'issues', stmt: CLEAN_ISSUES }] });

      expect(result).toBeInstanceOf(StoredSqlError);
      expect((result as StoredSqlError).objects).toEqual([`« issues » : ${GENERIC}`]);
      expect((result as Error).message).not.toMatch(/SECRET|load_file|base64|repeat|substr/);
    });

    it('refuse de même celui de HEAD, qu’il nomme « (dans HEAD) » : l’autre racine ne dispense pas de celle-ci', async () => {
      const { result } = await readWith({ working: [{ tbl: 'issues', stmt: CLEAN_ISSUES }], head: [{ tbl: 'issues', stmt: HOSTILE }] });

      expect((result as StoredSqlError).objects).toEqual([`« issues » (dans HEAD) : ${GENERIC}`]);
    });

    it('nomme les deux quand les deux racines en portent un, le working set d’abord', async () => {
      const { result } = await readWith({ working: [{ tbl: 'issues', stmt: HOSTILE }], head: [{ tbl: 'issues', stmt: HOSTILE }] });

      expect((result as StoredSqlError).objects).toEqual([`« issues » : ${GENERIC}`, `« issues » (dans HEAD) : ${GENERIC}`]);
    });

    it('rend les lignes de la lecture quand les CREATE TABLE sont ceux de bd : clés étrangères, check, défaut (json_object()), options de table, point-virgule final', async () => {
      const { result } = await readWith({
        working: [{ tbl: 'issues', stmt: CLEAN_ISSUES }, { tbl: 'dependencies', stmt: CLEAN_DEPENDENCIES }],
        head: [{ tbl: 'issues', stmt: CLEAN_ISSUES }, { tbl: 'dependencies', stmt: CLEAN_DEPENDENCIES }],
      });

      expect(result).toEqual([{ id: 'SECRET' }]);
    });

    it('refuse ce qui n’est pas une table (le texte d’une vue) comme une vue que l’app lirait à la place d’une table', async () => {
      const { result } = await readWith({ working: [{ tbl: 'labels', stmt: 'CREATE VIEW `labels` AS select 1' }] });

      expect((result as StoredSqlError).objects).toEqual(["« labels » est une vue, ou autre chose qu'une table, que l'app pourrait lire à la place d'une table"]);
    });

    it('ne rend jamais le texte du CREATE TABLE : une ligne sans texte (`stmt` absent) est aussi refusée, comme une table qui n’en a pas', async () => {
      const { result } = await readWith({ working: [{ tbl: 'config' }] });

      expect(result).toBeInstanceOf(StoredSqlError);
      expect((result as StoredSqlError).objects).toHaveLength(1);
    });

    // m2 (relecture finale, round 4). `schemaCreateProblems` acceptait toute table absente de `dolt_schema_diff` : la solidité ne reposait que sur le commit de base vide (`learnBase`) et sur son hash,
    // contenu-adressé. La comparaison rend maintenant une ligne par table attendue (jointure à gauche depuis les cinq noms que la requête écrit), et une table sans définition lue est refusée.
    describe('m2 : une ligne pour chacune des cinq tables, sinon le refus', () => {
      it('une table du working set que la comparaison ne rend pas est refusée, sans rendre aucune ligne de la lecture', async () => {
        const { result } = await readWith({ workingMissing: ['labels'] });

        expect(result).toBeInstanceOf(StoredSqlError);
        expect((result as StoredSqlError).objects).toEqual([`« labels » : ${MISSING}`]);
        expect((result as Error).message).not.toContain('SECRET');
      });

      it('de même dans HEAD, qu’elle nomme « (dans HEAD) »', async () => {
        const { result } = await readWith({ headMissing: ['config'] });

        expect((result as StoredSqlError).objects).toEqual([`« config » (dans HEAD) : ${MISSING}`]);
      });

      it('plusieurs tables manquantes : toutes sont dites, le working set d’abord, dans l’ordre des tables lues', async () => {
        const { result } = await readWith({ workingMissing: ['comments', 'issues'], headMissing: ['dependencies'] });

        expect((result as StoredSqlError).objects).toEqual([`« issues » : ${MISSING}`, `« comments » : ${MISSING}`, `« dependencies » (dans HEAD) : ${MISSING}`]);
      });

      it('une comparaison qui ne rend aucune ligne du tout (une sortie vide, tronquée) refuse les cinq tables, dans chaque racine : aucune table n’est admise faute de ligne', async () => {
        const { client } = fakeClient((sqls) => (isRead(sqls) ? [[{}], [{}], [], [], [{ id: 'SECRET' }]] : diagnosisOf(sqls)));

        const error = await withStoredSqlCheck(client).open('/projet').query(Q).catch((err: unknown) => err);

        expect(error).toBeInstanceOf(StoredSqlError);
        expect((error as StoredSqlError).objects).toEqual([
          ...STORED_SQL_TABLES.map((table) => `« ${table} » : ${MISSING}`),
          ...STORED_SQL_TABLES.map((table) => `« ${table} » (dans HEAD) : ${MISSING}`),
        ]);
      });

      it('une ligne dont le texte manque (NULL) est une table sans définition, même si la comparaison en a cité le nom', async () => {
        const { client } = fakeClient((sqls) => (isRead(sqls) ? okWithSchema(sqls, { working: [{ tbl: 'labels' }] }, [{ id: 'SECRET' }]) : diagnosisOf(sqls)));

        const error = await withStoredSqlCheck(client).open('/projet').query(Q).catch((err: unknown) => err);

        expect((error as StoredSqlError).objects).toEqual([`« labels » : ${MISSING}`]);
      });

      it('deux lignes pour un même nom (deux tables dont la casse diffère, fabriquées) : chacune est jugée, la saine ne masque pas l’autre', async () => {
        const { result } = await readWith({
          working: [
            { tbl: 'issues', stmt: CLEAN_ISSUES },
            { tbl: 'Issues', stmt: HOSTILE.replace('`issues`', '`Issues`') },
          ],
        });

        expect((result as StoredSqlError).objects).toEqual([`« Issues » : ${GENERIC}`]);
      });

      it('une ligne d’une table que l’app ne lit pas, rendue par erreur, ne remplace jamais celle d’une table lue : la table lue manque toujours', async () => {
        const { client } = fakeClient((sqls) => {
          if (!isRead(sqls)) return diagnosisOf(sqls);
          const results = ok(sqls);
          const working = schemaRows([], ['labels']).filter((row) => row.expected !== 'labels');
          results[results.length - 3] = [...working, { expected: 'wisps', tbl: 'wisps', stmt: CLEAN_TABLE('wisps') }];
          return results;
        });

        const error = await withStoredSqlCheck(client).open('/projet').query(Q).catch((err: unknown) => err);

        expect((error as StoredSqlError).objects).toEqual([`« labels » : ${MISSING}`]);
      });

      it('au dernier essai, une table de HEAD sans ligne est refusée de même : ce sont les relevés de ce groupe-là que l’on juge', async () => {
        let reads = 0;
        const { client } = fakeClient((sqls) => {
          if (isRead(sqls)) {
            if (reads++ < 2) throw ASSERTION_FAILED();
            return okWithSchema(sqls, { headMissing: ['comments'] }, [{ id: 'SECRET' }]);
          }
          return diagnosisOf(sqls);
        });

        const error = await withStoredSqlCheck(client).open('/projet').query(Q).catch((err: unknown) => err);

        expect((error as StoredSqlError).objects).toEqual([`« comments » (dans HEAD) : ${MISSING}`]);
      });
    });

    it('au dernier essai, le groupe a les six instructions de `storedSqlEvidence` puis les deux CREATE TABLE : ce sont eux que l’on juge, pas les relevés d’avant', async () => {
      let reads = 0;
      const { client, calls } = fakeClient((sqls) => {
        if (isRead(sqls)) {
          if (reads++ < 2) throw ASSERTION_FAILED();
          return okWithSchema(sqls, { head: [{ tbl: 'config', stmt: HOSTILE }] }, [{ id: 'SECRET' }]);
        }
        return diagnosisOf(sqls);
      });

      const error = await withStoredSqlCheck(client).open('/projet').query(Q).catch((err: unknown) => err);

      expect(error).toBeInstanceOf(StoredSqlError);
      expect((error as StoredSqlError).objects).toEqual([`« config » (dans HEAD) : ${GENERIC}`]);
      expect(calls.filter((call) => isRead(call.sqls)).map((call) => isEvidence(call.sqls))).toEqual([false, false, true]);
    });

    it('le diagnostic nomme un index fonctionnel relevé dans `information_schema.statistics`, par son nom et celui de sa table', async () => {
      const { client } = fakeClient((sqls) => {
        if (isRead(sqls)) throw ASSERTION_FAILED();
        return diagnosisOf(sqls, { functionalIndexes: [{ tbl: 'issues', idx: 'fi' }] });
      });

      const error = await withStoredSqlCheck(client).open('/projet').query(Q).catch((err: unknown) => err);

      expect(error).toBeInstanceOf(StoredSqlError);
      expect((error as StoredSqlError).objects).toEqual(['index fonctionnel « fi » de « issues »']);
    });

    it('le dernier essai le nomme aussi, par ses propres relevés : l’index n’est plus là quand le diagnostic passe, mais l’assertion l’a vu', async () => {
      const { client } = fakeClient((sqls) => {
        if (isEvidence(sqls)) throw ASSERTION_FAILED([[], [], [{ tbl: 'labels', idx: 'fx' }]]);
        if (isRead(sqls)) throw ASSERTION_FAILED();
        return diagnosisOf(sqls);
      });

      const error = await withStoredSqlCheck(client).open('/projet').query(Q).catch((err: unknown) => err);

      expect(error).toBeInstanceOf(StoredSqlError);
      expect((error as StoredSqlError).objects).toEqual(['index fonctionnel « fx » de « labels »']);
    });

    // Le working set modifié sans commit a retiré l'index (ou n'a jamais eu la table) : `information_schema.statistics` ne dit rien, la première assertion non plus, et la première lecture,
    // `as of 'HEAD'`, évaluerait l'index de HEAD. Le diagnostic, qui lit déjà les colonnes de HEAD avant de le retenir, lit donc aussi son `CREATE TABLE`.
    describe('HEAD seul, working set modifié : le diagnostic juge le CREATE TABLE de HEAD avant de retenir ce HEAD', () => {
      const dirtyHead = (finding: Finding) =>
        fakeClient((sqls) => {
          if (isRead(sqls)) throw ASSERTION_FAILED(); // l'assertion : un working set modifié, un HEAD que l'on n'a pas retenu
          return diagnosisOf(sqls, { dirty: true, ...finding });
        });
      const refused = async (finding: Finding) => {
        const { client, calls } = dirtyHead(finding);
        const db = withStoredSqlCheck(client).open('/projet');
        const first = await db.query(Q).catch((err: unknown) => err);
        const second = await db.query(Q).catch((err: unknown) => err);
        return { first, second, calls };
      };

      it('refuse un index fonctionnel de HEAD, nommé « (dans HEAD) », sans retenir ce HEAD : aucune lecture ne passe, et la suivante diagnostique de nouveau', async () => {
        const { first, second, calls } = await refused({ headSchema: schemaRows([{ tbl: 'issues', stmt: HOSTILE }]) });

        expect(first).toBeInstanceOf(StoredSqlError);
        expect((first as StoredSqlError).objects).toEqual([`« issues » (dans HEAD) : ${GENERIC}`]);
        expect((first as Error).message).not.toMatch(/load_file|base64|repeat|substr/);
        expect(second).toBeInstanceOf(StoredSqlError);
        expect(calls.filter((call) => isRead(call.sqls))).toHaveLength(2); // la lecture que l'assertion arrête, une fois par demande : aucune n'est suivie de rien
        expect(calls.filter((call) => isRead(call.sqls)).every((call) => pinOf(call.sqls) === '')).toBe(true); // HEAD n'est jamais retenu
        expect(calls.filter((call) => isPinStep(call.sqls))).toHaveLength(2);
      });

      it('le refuse de même quand HEAD manque une table et que les tables sont sondées une à une : le CREATE TABLE de la première sonde réussie fait foi', async () => {
        const { first, calls } = await refused({ absent: ['labels'], headSchema: schemaRows([{ tbl: 'issues', stmt: HOSTILE }]) });

        expect((first as StoredSqlError).objects).toEqual([`« issues » (dans HEAD) : ${GENERIC}`]);
        expect(calls.filter((call) => isPinStep(call.sqls)).length).toBeGreaterThan(1); // ensemble (échec « table not found »), puis une par une
      });

      it('nomme la table comme Dolt la nomme : `Issues`, que `select … from issues` lit, est refusée sous ce nom', async () => {
        const { first } = await refused({ headSchema: schemaRows([{ tbl: 'Issues', stmt: HOSTILE.replace('`issues`', '`Issues`') }]) });

        expect((first as StoredSqlError).objects).toEqual([`« Issues » (dans HEAD) : ${GENERIC}`]);
      });

      it('dit aussi la colonne générée de HEAD, d’abord : les deux refus ne s’excluent pas', async () => {
        const { first } = await refused({
          columns: { issues: [{ Field: 'title', Extra: 'VIRTUAL GENERATED' }] },
          headSchema: schemaRows([{ tbl: 'labels', stmt: HOSTILE.replace('`issues`', '`labels`') }]),
        });

        expect((first as StoredSqlError).objects).toEqual(['colonne générée « title » de « issues » (dans HEAD)', `« labels » (dans HEAD) : ${GENERIC}`]);
      });

      it('retient un HEAD dont le CREATE TABLE est celui de bd (clés étrangères, check, défaut json_object()) : la lecture passe, et la suivante ne diagnostique plus', async () => {
        const { client, calls } = fakeClient((sqls) => {
          if (isRead(sqls)) return pinOf(sqls) === HASH ? ok(sqls) : (() => { throw ASSERTION_FAILED(); })();
          return diagnosisOf(sqls, { dirty: true, headSchema: schemaRows([{ tbl: 'issues', stmt: CLEAN_ISSUES }, { tbl: 'dependencies', stmt: CLEAN_DEPENDENCIES }]) });
        });
        const db = withStoredSqlCheck(client).open('/projet');

        expect(await db.query(Q)).toEqual([{ id: 'a-1' }]);
        expect(await db.query(Q)).toEqual([{ id: 'a-1' }]);
        expect(calls.filter((call) => isPinStep(call.sqls))).toHaveLength(1);
      });
    });

    describe('l’ancre d’une époque : `storedSqlAt` lit aussi le CREATE TABLE de ce commit-là, avant que son nom soit lu', () => {
      const answer = (nonlocal: number, schema: Row[]) =>
        fakeClient((sqls) => (isRead(sqls) ? [[{}], [{}], schemaRows(), schemaRows(), [{ c: nonlocal }], schema] : diagnosisOf(sqls)));
      const at = (client: DoltClient) => withStoredSqlCheck(client).open('/projet').storedSqlAt?.(COMMIT_FOR_ERA);

      it('un index fonctionnel dans l’ancre est refusé, en nommant la table et l’époque par son commit', async () => {
        const { client } = answer(0, schemaRows([{ tbl: 'dependencies', stmt: HOSTILE.replace('`issues`', '`dependencies`') }]));

        expect(await at(client)).toEqual([`« dependencies » (époque du commit ${COMMIT_FOR_ERA.slice(0, 8)}) : ${GENERIC}`]);
      });

      it('le CREATE TABLE de l’ancre qui est celui de bd ne dit rien', async () => {
        expect(await at(answer(0, schemaRows([{ tbl: 'dependencies', stmt: CLEAN_DEPENDENCIES }])).client)).toEqual([]);
      });

      // m2 : à l'ancre d'une époque, l'app ne lit que l'historique des dépendances (`<base>/<commit>.dolt_history_dependencies`) : seule `dependencies` doit avoir une ligne dans la comparaison. Les autres
      // tables, que l'ancre d'une histoire ancienne peut ne pas avoir, sont jugées si la comparaison les rend, sans être exigées.
      it('m2 : une ancre sans `dependencies` dans la comparaison est refusée, en nommant l’époque', async () => {
        const problems = await at(answer(0, schemaRows([], ['dependencies'])).client);

        expect(problems).toEqual([`« dependencies » (époque du commit ${COMMIT_FOR_ERA.slice(0, 8)}) : ${MISSING}`]);
      });

      it('m2 : une ancre à qui il manque une autre table que `dependencies` (une histoire ancienne) n’en est pas refusée', async () => {
        expect(await at(answer(0, schemaRows([], ['labels', 'comments', 'config'])).client)).toEqual([]);
      });

      it('m2 : une comparaison qui ne rend aucune ligne du tout est refusée : `dependencies` manque', async () => {
        expect(await at(answer(0, []).client)).toEqual([`« dependencies » (époque du commit ${COMMIT_FOR_ERA.slice(0, 8)}) : ${MISSING}`]);
      });

      it('dit les deux quand l’ancre porte les deux, `dolt_nonlocal_tables` d’abord', async () => {
        const problems = await at(answer(2, schemaRows([{ tbl: 'dependencies', stmt: HOSTILE }])).client);

        expect(problems).toHaveLength(2);
        expect(problems?.[0]).toContain('« dolt_nonlocal_tables » n\'est pas vide');
        expect(problems?.[1]).toContain(`(époque du commit ${COMMIT_FOR_ERA.slice(0, 8)})`);
      });

      it('envoie, après les assertions, la comparaison de `dolt_nonlocal_tables` puis celle du CREATE TABLE, toutes deux contre ce commit', async () => {
        const { client, calls } = answer(0, []);

        await at(client);

        expect(calls[0]?.sqls.slice(4)).toEqual([expect.stringContaining(`dolt_schema_diff('${BASE}', '${COMMIT_FOR_ERA}')`), schemaCreateSql(BASE, COMMIT_FOR_ERA)]);
        for (const sql of calls[0]?.sqls ?? []) expect(() => assertReadOnly(sql)).not.toThrow();
      });
    });
  });

  it('est le client par défaut des Projets : `createCheckedDoltClient` rend un client qui ouvre une base', () => {
    expect(createCheckedDoltClient({ binary: 'dolt-introuvable' }).open('/projet').dir).toBe('/projet');
  });
});
