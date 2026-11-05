import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isAbortError } from '../abort';
import { tableReads } from '../testing/reads-at-head';
import { type DoltClient, type DoltDatabase, DoltQueryError, type QueryOptions, type Row } from './client';
import { readTicketHistories } from './history';
import { assertReadOnly } from './read-only';
import { readHead, readIssueBase, readIssueParts, readIssuePrefix } from './reader';
import {
  createCheckedDoltClient,
  readsNoTable,
  revisionTablesSql,
  STORED_SQL_NAMES,
  STORED_SQL_SYSTEM_TABLES,
  STORED_SQL_TABLES,
  StoredSqlError,
  storedSqlAssertion,
  storedSqlInSource,
  storedSqlPrelude,
  storedViewsAssertion,
  withStoredSqlCheck,
} from './stored-sql';

const HASH = 'k9d2m1q3v7a4b5c6e8f0g1h2i3j4k5l6';

describe('les assertions qui précèdent chaque lecture', () => {
  it('passent le garde de lecture seule : le client les soumet comme toute lecture, avec ou sans HEAD retenu', () => {
    expect(() => assertReadOnly(storedViewsAssertion())).not.toThrow();
    expect(() => assertReadOnly(storedSqlAssertion())).not.toThrow();
    expect(() => assertReadOnly(storedSqlAssertion(HASH))).not.toThrow();
    expect(storedSqlPrelude(HASH)).toEqual([storedViewsAssertion(), storedSqlAssertion(HASH)]);
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

  it('la première ne lit que `information_schema`, que nulle vue ne masque ; elle nomme les deux tables système que la seconde lit : une vue de ce nom l’arrête avant', () => {
    const first = storedViewsAssertion();
    const second = storedSqlAssertion();

    expect(first).toContain('from information_schema.views');
    // (`dual` : la table sans table des `select … from dual where …`, que le filet des lectures prend pour une table.)
    expect(tableReads(first).map(({ table }) => table).filter((table) => table !== 'dual')).toEqual(['views']);
    // Chaque table que la seconde lit hors d'`information_schema` est nommée par la première (`dolt_status` et `dolt_schemas`, tables système que `create view` peut masquer).
    const masquable = tableReads(second)
      .map(({ table }) => table)
      .filter((table) => table !== 'columns' && table !== 'dual');
    expect(masquable.sort()).toEqual(['dolt_schemas', 'dolt_status']);
    for (const table of masquable) expect(first).toContain(`'${table}'`);
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

/** L'erreur que Dolt rend quand l'assertion trouve du SQL stocké, telle que le client la remonte (la requête est remplacée par […]). */
const ASSERTION_FAILED = () => new DoltQueryError('error on line 1 for query […]: the subquery returned more than 1 row', '/projet');

/** Un client Dolt factice, dont chaque groupe de lectures est jugé par `answer` : on y voit ce que la vérification envoie. */
function fakeClient(answer: (sqls: readonly string[], call: number, options: QueryOptions | undefined) => Row[][] | Promise<Row[][]>) {
  const calls: { dir: string; sqls: readonly string[] }[] = [];
  const client: DoltClient = {
    open: (dir) => ({
      dir,
      query: async (sql, options) => (await answer([sql], calls.push({ dir, sqls: [sql] }) - 1, options))[0] ?? [],
      queryAll: async (sqls, options) => answer(sqls, calls.push({ dir, sqls }) - 1, options),
    }),
  };
  return { client, calls };
}

// Les groupes que la vérification envoie : une lecture, précédée des deux assertions ; puis, si l'une échoue, les trois temps du diagnostic.
const isRead = (sqls: readonly string[]) => sqls[1]?.startsWith('select (select 1 union all select 1 from dual where a.c + b.c + d.c > 0) as stored_sql') === true;
const isViewsStep = (sqls: readonly string[]) => sqls[0]?.startsWith('select table_name as view_name from information_schema.views') === true;
const isStateStep = (sqls: readonly string[]) => sqls[1]?.startsWith("select name from dolt_schemas as of 'HEAD'") === true;
const isPinStep = (sqls: readonly string[]) => sqls[1]?.startsWith("select hashof('HEAD') as head") === true;
const isDiagnosis = (sqls: readonly string[]) => isViewsStep(sqls);
const pinOf = (sqls: readonly string[]) => /hashof\('HEAD'\) <> '([^']*)'/.exec(sqls[1] ?? '')?.[1];

/** Ce que le diagnostic trouve : `views` et `generated` au premier temps, `headViews` et `dirty` (le working set diffère de HEAD) au deuxième, `head`, `columns` (par table lue) et `absent` (tables que HEAD n'a pas) au troisième. */
interface Finding {
  views?: Row[];
  generated?: Row[];
  headViews?: Row[];
  dirty?: boolean | number | string;
  head?: string | ((table: string) => string);
  columns?: Record<string, Row[]>;
  absent?: string[];
}
/** Les tables que le troisième temps lit : celles de `show full columns from <table> as of 'HEAD'`, dans l'ordre. */
const probedTables = (sqls: readonly string[]) => sqls.slice(2).map((sql) => /^show full columns from (\w+) as of 'HEAD'$/.exec(sql)?.[1] ?? '?');
function diagnosisOf(sqls: readonly string[], { views = [], generated = [], headViews = [], dirty = false, head = HASH, columns = {}, absent = [] }: Finding = {}): Row[][] {
  if (isViewsStep(sqls)) return [views, generated];
  if (isStateStep(sqls)) return [[{}], headViews, [{ n: dirty === true ? '2' : dirty === false ? '0' : dirty }]];
  if (isPinStep(sqls)) {
    const tables = probedTables(sqls);
    const missing = tables.find((table) => absent.includes(table));
    if (missing) throw new DoltQueryError(`error on line 1 for query […]: table not found: ${missing}`, '/projet');
    return [[{}], [{ head: typeof head === 'function' ? head(tables[0] ?? '') : head }], ...tables.map((table) => columns[table] ?? [{ Field: 'id', Extra: '' }])];
  }
  throw new Error(`lecture inattendue : ${sqls.join(' | ')}`);
}
const ok = (rows: Row[] = [{ id: 'a-1' }]): Row[][] => [[{}], [{}], rows];
const Q = "select id from issues as of 'HEAD'";

describe('withStoredSqlCheck', () => {
  it('fait précéder chaque lecture des deux assertions, dans le même groupe, et n’en rend pas les lignes', async () => {
    const { client, calls } = fakeClient((sqls) => (isRead(sqls) ? [[{}], [{}], ...sqls.slice(2).map((_sql, i) => (i === 0 ? [{ id: 'a-1' }] : [{ label: 'x' }]))] : []));
    const db = withStoredSqlCheck(client).open('/projet');

    expect(await db.query(Q)).toEqual([{ id: 'a-1' }]);
    expect(await db.queryAll?.([Q, 'select label from labels'])).toEqual([[{ id: 'a-1' }], [{ label: 'x' }]]);
    expect(calls.map((call) => call.sqls)).toEqual([[...storedSqlPrelude(''), Q], [...storedSqlPrelude(''), Q, 'select label from labels']]);
  });

  it('ne vérifie pas une lecture qui ne nomme aucune table : le sondage du HEAD ne paie rien', async () => {
    const { client, calls } = fakeClient(() => [[{ head: 'abc' }]]);
    const db = withStoredSqlCheck(client).open('/projet');

    expect(await db.query("select hashof('HEAD') as head")).toEqual([{ head: 'abc' }]);
    expect(calls.map((call) => call.sqls)).toEqual([["select hashof('HEAD') as head"]]);
  });

  it('transmet le signal et la voie de la lecture à celle qu’elle lance', async () => {
    const seen: (QueryOptions | undefined)[] = [];
    const { client } = fakeClient((_sqls, _call, options) => {
      seen.push(options);
      return ok([]);
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
    expect(calls.map((call) => call.sqls.length)).toEqual([3, 2]); // les assertions + la lecture (échouée), puis le premier temps du diagnostic : jamais la lecture seule
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

  it('relit quand le diagnostic ne trouve rien et que le working set est propre : l’état a changé entre l’assertion et lui', async () => {
    let reads = 0;
    const { client, calls } = fakeClient((sqls) => {
      if (isRead(sqls)) {
        if (reads++ === 0) throw ASSERTION_FAILED();
        return ok();
      }
      return diagnosisOf(sqls);
    });

    expect(await withStoredSqlCheck(client).open('/projet').query(Q)).toEqual([{ id: 'a-1' }]);
    expect(calls.map((call) => call.sqls.length)).toEqual([3, 2, 3, 3]); // lecture (échec), diagnostic en deux temps (rien de sale : pas de troisième), lecture
  });

  it('retient le HEAD dont il a vérifié le schéma quand le working set est modifié sans commit, et le fait valoir à chaque lecture', async () => {
    const { client, calls } = fakeClient((sqls) => {
      if (isRead(sqls)) {
        if (pinOf(sqls) === HASH) return ok();
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
      storedViewsAssertion(),
      "select hashof('HEAD') as head",
      ...STORED_SQL_TABLES.map((table) => `show full columns from ${table} as of 'HEAD'`),
    ]);
    // De même le deuxième temps, qui lit `dolt_schemas` et `dolt_status` : l'assertion des vues le précède, qu'une vue arrivée depuis le premier temps arrête.
    expect(calls.find((call) => isStateStep(call.sqls))?.sqls[0]).toBe(storedViewsAssertion());
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
        return ok();
      }
      return diagnosisOf(sqls, { dirty: n });
    });

    await withStoredSqlCheck(client).open('/projet').query(Q);

    expect(calls.some((call) => isPinStep(call.sqls))).toBe(false);
  });

  it('sonde une à une les tables lues quand HEAD en manque une (« table not found »), sans compter celle qu’il n\'a pas, et retient un HEAD qui est le même pour toutes', async () => {
    const { client, calls } = fakeClient((sqls) => {
      if (isRead(sqls)) return pinOf(sqls) === HASH ? ok() : (() => { throw ASSERTION_FAILED(); })();
      return diagnosisOf(sqls, { dirty: true, absent: ['labels'], columns: { issues: [{ Field: 'id', Extra: '' }] } });
    });
    const db = withStoredSqlCheck(client).open('/projet');

    expect(await db.query(Q)).toEqual([{ id: 'a-1' }]);

    const probes = calls.filter((call) => isPinStep(call.sqls)).map((call) => probedTables(call.sqls));
    expect(probes).toEqual([[...STORED_SQL_TABLES], ...STORED_SQL_TABLES.map((table) => [table])]);
  });

  it('refuse la colonne générée d\'une table, même quand HEAD en manque une autre', async () => {
    const { client } = fakeClient((sqls) => {
      if (isRead(sqls)) throw ASSERTION_FAILED();
      return diagnosisOf(sqls, { dirty: true, absent: ['labels'], columns: { comments: [{ Field: 'text', Extra: 'VIRTUAL GENERATED' }] } });
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

  it('oublie le HEAD retenu quand le diagnostic trouve le working set redevenu propre', async () => {
    let dirty = true;
    let failOnce = false;
    const { client, calls } = fakeClient((sqls) => {
      if (isRead(sqls)) {
        if (failOnce) {
          failOnce = false;
          throw ASSERTION_FAILED();
        }
        if (dirty && pinOf(sqls) !== HASH) throw ASSERTION_FAILED();
        return ok();
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
    expect(pins).toEqual(['aucun', 'retenu', 'retenu', 'aucun', 'aucun']);
  });

  it('relit, sans rien retenir, quand une vue est arrivée entre le premier temps du diagnostic et les suivants : la lecture suivante la verra', async () => {
    let reads = 0;
    const { client, calls } = fakeClient((sqls) => {
      if (isRead(sqls)) {
        if (reads++ < 2) throw ASSERTION_FAILED();
        return ok();
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
    expect((error as Error).message).toMatch(/plus vite que la vérification/);
    expect(calls.filter((call) => isRead(call.sqls))).toHaveLength(3);
    expect(calls.some((call) => call.sqls[0] === Q)).toBe(false);
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
        if (sqls[2] === 'select label from labels' && others++ > 0) return ok([{ label: 'x' }]); // la seconde fois, l'état est sain
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
        if (pinOf(sqls) === HASH) return ok([]);
        throw ASSERTION_FAILED();
      }
      return diagnosisOf(sqls, { dirty: true });
    });
    const checked = withStoredSqlCheck(client);

    await checked.open('/a').query(Q);
    await checked.open('/b').query(Q);

    expect(calls.filter((call) => isDiagnosis(call.sqls)).map((call) => call.dir)).toEqual(['/a', '/b']);
  });

  it('est le client par défaut des Projets : `createCheckedDoltClient` rend un client qui ouvre une base', () => {
    expect(createCheckedDoltClient({ binary: 'dolt-introuvable' }).open('/projet').dir).toBe('/projet');
  });
});
