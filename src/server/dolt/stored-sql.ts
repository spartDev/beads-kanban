import { abortable } from '../abort';
import { createDoltClient, type DoltClient, type DoltClientOptions, type DoltDatabase, DoltQueryError, type Lane, type QueryOptions, queryAll, type Row, sqlString } from './client';

/**
 * Du SQL stocké dans une base, que Dolt exécute quand on la lit (bdesk-38k.69). Le garde de lecture seule (`read-only.ts`) ne voit que le texte de la requête ;
 * or Dolt exécute aussi ce que la base porte :
 *
 * - une **vue** : `select … from issues` lit `issues` comme une vue si la base en a une de ce nom, et sa définition est du SQL quelconque, `load_file('<base>/…')`
 *   ou `dolt_query_diff('select … into outfile …', …)` compris (qui lit ou écrit un fichier du dossier de la base, le `secure_file_priv` de `dolt sql`). C'est la vue du
 *   **working set** que Dolt exécute, même pour `… as of 'HEAD'` ; une vue qui n'est que dans le commit n'est pas résolue (« table not found ») ;
 * - une **colonne générée** (`generated always as (load_file(…)) virtual`) : son expression est évaluée à chaque lecture, de la table comme de son historique
 *   (`dolt_history_*` l'évalue avec le schéma courant, ligne après ligne) ; une colonne générée stockée l'est à l'écriture, non à la lecture, mais n'a rien à faire
 *   dans une base de tickets, et la refuser est plus simple que de mesurer chaque version de Dolt.
 *
 * Le contenu d'une base beads vient d'un remote partagé : un collaborateur peut commiter l'une ou l'autre. Mesuré sur dolt 2.5.0 (`proofs/bdesk-38k.69.md`) : ni un
 * déclencheur (il ne part que d'une écriture), ni un événement (le planificateur de `dolt sql` ne les lance pas à la lecture), ni une procédure (elle ne part que
 * d'un `call`, que le garde refuse) ne s'exécute à la lecture.
 *
 * Ce n'est pas « aucune vue » : bd crée lui-même `ready_issues` et `blocked_issues` dans toutes ses bases, que l'app ne lit jamais. Ce qui compte, ce sont les noms que
 * l'app lit (`reader.ts`, `history.ts`) : `STORED_SQL_NAMES`. Un test (`stored-sql.test.ts`) refait chaque lecture de l'app et vérifie que chaque table qu'elle nomme est
 * dans la liste.
 *
 * **Une règle pour les noms : jamais comparés en JavaScript.** Dolt lit un nom à sa façon, que JavaScript ne reproduit pas : `Issues` est `issues` ; une vue `issueſ`
 * (U+017F, le « s long ») est lue comme `issues` (Dolt replie la casse à l'unicode : `ſ` s'y comporte comme `s`), alors que `'ſ'.toLowerCase()` reste `ſ`. Toute comparaison
 * de nom se fait donc dans Dolt : sa collation (`information_schema`, `dolt_schemas.name`, insensibles à la casse : un balayage de 1 124 caractères dont Unicode fait des
 * lettres de ces noms n'a trouvé aucun nom que Dolt lise comme celui d'une table lue et que ces comparaisons laissent passer), ou sa résolution même (`show full columns from
 * <nom lu> as of 'HEAD'`, qui lit le nom comme la lecture le lira). Le seul nom comparé en JavaScript l'est à une liste fermée, par égalité exacte, et le refus est le cas par
 * défaut : une vue de la base de révision d'une ancre d'époque n'est admise que si c'est exactement `ready_issues` ou `blocked_issues`.
 */
export const STORED_SQL_TABLES = ['issues', 'dependencies', 'labels', 'comments', 'config'] as const;
/** Les tables système que l'app lit : une vue du même nom les masque (mesuré : `create view dolt_log …` est admis, et `select … from dolt_log` lit la vue). */
export const STORED_SQL_SYSTEM_TABLES = ['dolt_history_issues', 'dolt_history_dependencies', 'dolt_log', 'dolt_commit_ancestors'] as const;
export const STORED_SQL_NAMES = [...STORED_SQL_TABLES, ...STORED_SQL_SYSTEM_TABLES] as const;

const inList = (names: readonly string[]) => names.map(sqlString).join(', ');
const NAMES = inList(STORED_SQL_NAMES);
const TABLES = inList(STORED_SQL_TABLES);
/**
 * Les tables système que la vérification lit elle-même : une vue qui porte leur nom la ferait exécuter du SQL avant qu'elle n'ait rien dit (mesuré :
 * `create view dolt_status as select load_file(…)` est admis, et `select … from dolt_status` exécute la vue ; de même `dolt_schemas`, même `as of 'HEAD'` : c'est
 * le working set qui fournit les vues). `information_schema.views` ne s'y laisse pas prendre : c'est une autre base, qui liste les vues sans les exécuter.
 */
const OWN_TABLES = ['dolt_schemas', 'dolt_status'] as const;
const VIEW_NAMES = inList([...STORED_SQL_NAMES, ...OWN_TABLES]);

// Les sources de danger, chacune écrite une fois : les assertions les comptent, le diagnostic les relit une à une pour dire ce qu'il y a.
/** Les vues du working set qui portent un nom que l'app (ou la vérification) lit, par `information_schema` (voir `OWN_TABLES`). `table_name` se compare sans tenir compte de la casse (mesuré). */
const VIEWS_WHERE = `table_schema = database() and table_name in (${VIEW_NAMES})`;
/** Une vue qui porte le nom d'une table que l'app lit, dans le dernier commit : Dolt ne la résout pas aujourd'hui (« table not found »), mais ce n'est pas à nous de le parier. */
const HEAD_VIEWS = `from dolt_schemas as of 'HEAD' where type = 'view' and name in (${NAMES})`;
/** Une colonne générée, virtuelle ou stockée, d'une table que l'app lit : dans le schéma du working set (`information_schema` ne se lit pas `as of`). */
const GENERATED_COLUMNS = `from information_schema.columns where table_schema = database() and table_name in (${TABLES}) and generation_expression <> ''`;
/**
 * Le working set diffère de HEAD (n'importe quelle table, sans comparer de nom : `dolt_status` écrit `Issues` quand la table a été renommée ainsi, et `table_name in ('issues')`
 * n'y voit rien) : le schéma de HEAD, que les lectures `as of 'HEAD'` utilisent, n'est alors pas forcément celui du working set.
 */
const UNCOMMITTED = 'from dolt_status';

/**
 * Les deux instructions qui précèdent chaque lecture, dans le même processus et la même transaction : l'une ou l'autre échoue (« the subquery returned more than 1 row »)
 * s'il y a du SQL stocké, et `dolt sql` s'arrête alors à la première erreur, avant que la lecture ne parte. Une sous-requête scalaire qui rend plusieurs lignes est l'erreur
 * dont on dispose : `dolt sql` n'a ni `signal` ni `assert`. Aucun délai ne sépare donc la vérification de la lecture (un commit qui arrive entre les deux, ce que ferait une
 * vérification dans un processus à part) : la base est vérifiée dans l'état exact où elle est lue.
 *
 * Chaque balayage est compté dans une table dérivée du `from`, et la sous-requête scalaire, qui ne lit que ce compte, rend une seconde ligne s'il n'est pas nul : le même
 * balayage dans la sous-requête coûte le double (mesuré : `information_schema.columns` passe de 8 à 15 ms de CPU).
 *
 * 1. `storedViewsAssertion` : une vue du working set qui porte un nom lu, ou un nom que la deuxième instruction lit. Elle ne lit que `information_schema`, que rien ne masque ;
 *    c'est ce qui la fait passer en premier : les tables système de la deuxième pourraient être des vues.
 * 2. `storedSqlAssertion` : une vue de HEAD qui porte un nom lu ; une colonne générée dans le schéma du working set ; un working set modifié sans commit (une table
 *    quelconque) alors que HEAD n'est pas celui dont le schéma a été vérifié (`pinnedHead`) : le schéma de HEAD est celui que lisent les lectures `as of 'HEAD'`, et
 *    `information_schema` ne dit que celui du working set. Un working set propre (le cas de bd en auto-commit, le défaut) n'y passe jamais : il n'y a ni diagnostic ni
 *    état à retenir.
 *
 * Elles passent le garde de lecture seule (aucune fonction hors de la liste blanche, aucun caractère interdit) : le client les lui soumet comme toute lecture.
 */
export const storedViewsAssertion = (): string =>
  `select (select 1 union all select 1 from dual where t.c > 0) as stored_views from (select count(*) as c from information_schema.views where ${VIEWS_WHERE}) t`;

export function storedSqlAssertion(pinnedHead = ''): string {
  return (
    'select (select 1 union all select 1 from dual where a.c + b.c + d.c > 0) as stored_sql from ' +
    `(select count(*) as c ${HEAD_VIEWS}) a, (select count(*) as c ${GENERATED_COLUMNS}) b, ` +
    `(select count(*) as c ${UNCOMMITTED} where hashof('HEAD') <> ${sqlString(pinnedHead)}) d`
  );
}

/** Ce qui précède chaque lecture, dans l'ordre. */
export const storedSqlPrelude = (pinnedHead = ''): string[] => [storedViewsAssertion(), storedSqlAssertion(pinnedHead)];

/** L'erreur que Dolt rend quand l'assertion trouve du SQL stocké. */
const ASSERTION_FAILED = /subquery returned more than 1 row/i;

/** Ce que Dolt répond à `show full columns from <table> as of 'HEAD'` quand HEAD n'a pas la table. */
const TABLE_NOT_FOUND = /table not found/i;

/** Le résultat d'un groupe du diagnostic, ou rien si son assertion des vues l'a arrêté (une vue est arrivée depuis le premier temps) ; toute autre erreur passe. */
async function changed(read: () => Promise<Row[][]>): Promise<Row[][] | undefined> {
  try {
    return await read();
  } catch (err) {
    if (err instanceof DoltQueryError && ASSERTION_FAILED.test(err.message)) return undefined;
    throw err;
  }
}

/** Nombre de fois qu'une lecture est tentée quand HEAD change entre le diagnostic et elle : au-delà, la base change plus vite que la vérification. */
const MAX_ATTEMPTS = 3;

/** Du SQL stocké dans la base : elle n'est pas lue. Un Projet illisible, dont `reason` (ce message) dit pourquoi. */
export class StoredSqlError extends DoltQueryError {
  constructor(
    readonly objects: readonly string[],
    dir = '',
  ) {
    super(`SQL stocké dans la base, que Dolt exécuterait à la lecture : ${objects.join(' ; ')}. La base n'est pas lue.`, dir);
    this.name = 'StoredSqlError';
  }
}

/** Un nom tiré de la base, mis dans un message : les caractères de contrôle ne passent pas, et la longueur est bornée. */
const named = (name: string) => `« ${name.replace(/\p{C}/gu, '?').slice(0, 64)} »`;

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

const viewProblem = (name: string) => `${named(name)} est une vue, que l'app pourrait lire à la place d'une table`;
const columnProblem = (table: string, column: string) => `colonne générée ${named(column)} de ${named(table)}`;

/** `Extra` d'une colonne (`show columns`) : générée par une expression, virtuelle ou stockée (`DEFAULT_GENERATED` est un défaut ordinaire, que bd utilise). */
const isGenerated = (extra: unknown): boolean => /^(virtual|stored) generated/i.test(text(extra));

/**
 * Les seules vues qu'une base de révision (l'ancre d'une époque du schéma) peut porter : celles de bd, que l'app ne lit jamais. Relevé : sur les 1 633 commits des cinq copies
 * de bases réelles, ce sont les deux seules vues qu'un commit ait jamais portées (`proofs/bdesk-38k.69.md`).
 */
const BD_VIEWS: readonly string[] = ['ready_issues', 'blocked_issues'];

/** Le nom d'une ligne de `show full tables` : la valeur de la colonne qui n'est pas `Table_type` (son nom, `Tables_in_<base>`, change avec la base). */
const tableName = (row: Row): string => text(Object.entries(row).find(([column]) => column !== 'Table_type')?.[1]);

/**
 * Ce que porte une source d'historique que l'app lit, de ses colonnes (`show columns from <source>`) et, pour la base de révision d'une ancre d'époque, des tables et
 * vues de cette base (`revisionTablesSql`). `label` dit de quelle source il s'agit (« historique des dépendances », « époque du commit abc12345 »). L'ancre est un commit :
 * ni l'un ni l'autre ne peut changer entre ces lectures et celle de la source.
 *
 * Aucun nom n'y est comparé à ceux que l'app lit : Dolt lit `dolt_history_dependencieſ` comme `dolt_history_dependencies` (voir l'en-tête du fichier), et un nom qu'on ne sait
 * pas reconnaître est un nom qu'on ne sait pas refuser. Toute vue de la base de révision est refusée, sauf les deux de bd, admises par égalité exacte avec leur nom.
 */
export function storedSqlInSource(columns: readonly Row[], tables: readonly Row[] = [], label = 'historique des dépendances'): string[] {
  return [
    ...tables
      .filter((row) => text(row.Table_type) !== 'BASE TABLE' && !BD_VIEWS.includes(tableName(row)))
      .map((row) => `${viewProblem(tableName(row))} (${label})`),
    ...columns.filter((row) => isGenerated(row.Extra)).map((row) => `colonne générée ${named(text(row.Field))} de l'historique des dépendances (${label})`),
  ];
}

/**
 * Les tables et vues de la base de révision `revision` (déjà citée comme identifiant : `sqlIdent`) : `show full tables` les liste sans exécuter aucune vue. Lire
 * `<révision>.dolt_schemas` serait une erreur : une vue de ce nom, dans le commit d'ancre, masquerait la table système et s'exécuterait (mesuré).
 */
export const revisionTablesSql = (revision: string): string => `show full tables from ${revision}`;

/**
 * Une lecture qui ne nomme aucune table (`select hashof('HEAD')`, `select database()`) n'exécute aucun SQL stocké : le HEAD, que le sondage du direct lit toutes les
 * quelques secondes pour chaque Projet, n'a pas à porter l'assertion. Sans `from`, un `select` ne lit aucune table (`join` et les sous-requêtes en ont un) ; un mot
 * `from` dans une chaîne la fait seulement vérifier.
 */
export const readsNoTable = (sql: string): boolean => /^\s*select\b/i.test(sql) && !/\bfrom\b/i.test(sql);

/**
 * Le client qui vérifie chaque lecture (voir `storedViewsAssertion`). Les deux assertions sont les premières instructions du groupe de lectures, dont elles ne rendent pas les lignes.
 * Quand l'une échoue, un diagnostic dit quoi (`StoredSqlError`, la base n'est pas lue) ; quand il ne trouve rien, c'est que le working set est modifié sans commit,
 * et le diagnostic vérifie alors le schéma de HEAD (`show full columns … as of 'HEAD'`, dans le même processus que `hashof('HEAD')`) et retient ce HEAD : les lectures
 * suivantes le font valoir dans leur assertion, qui échoue de nouveau dès que HEAD change.
 */
export function withStoredSqlCheck(client: DoltClient): DoltClient {
  /** Par base : le HEAD dont le schéma a été vérifié, pour un working set modifié sans commit. */
  const pinned = new Map<string, string>();
  /** Les diagnostics en cours, un par base : les lectures qui échouent ensemble n'en font qu'un. */
  const diagnosing = new Map<string, Promise<void>>();

  /**
   * Les colonnes que HEAD donne aux tables lues, et le hash de HEAD lu dans le même processus. Chaque table est lue **par son nom**, que Dolt résout comme la lecture le
   * fera (`Issues` pour `issues`) : aucun nom n'est comparé ici. Une table que HEAD n'a pas (« table not found », ce qu'une lecture `as of 'HEAD'` dirait aussi) n'a pas de
   * colonne à lire : on les sonde alors une à une. `undefined` : une vue est arrivée (l'assertion des vues, en tête du groupe, s'est arrêtée), ou HEAD a changé entre deux sondes.
   */
  async function headColumns(db: DoltDatabase, options: QueryOptions): Promise<{ head: string; columns: { table: string; rows: Row[] }[] } | undefined> {
    const probe = async (tables: readonly string[]): Promise<Row[][] | undefined | 'absent'> => {
      try {
        return await changed(() =>
          queryAll(db, [storedViewsAssertion(), "select hashof('HEAD') as head", ...tables.map((table) => `show full columns from ${table} as of 'HEAD'`)], options),
        );
      } catch (err) {
        if (err instanceof DoltQueryError && TABLE_NOT_FOUND.test(err.message)) return 'absent';
        throw err;
      }
    };
    const answer = (tables: readonly string[], answers: Row[][]) => ({
      head: text(answers[1]?.[0]?.head),
      columns: tables.map((table, i) => ({ table, rows: answers[i + 2] ?? [] })),
    });
    const together = await probe(STORED_SQL_TABLES);
    if (together !== 'absent') return together && answer(STORED_SQL_TABLES, together);
    const each = await Promise.all(STORED_SQL_TABLES.map(async (table) => ({ table, answers: await probe([table]) })));
    if (each.some(({ answers }) => answers === undefined)) return undefined;
    const found = each.flatMap(({ table, answers }) => (answers === undefined || answers === 'absent' ? [] : [answer([table], answers)]));
    const heads = new Set(found.map(({ head }) => head));
    if (heads.size > 1) return undefined; // HEAD a changé entre deux sondes : le schéma lu n'est pas celui d'un seul HEAD
    return { head: found[0]?.head ?? '', columns: found.flatMap(({ columns }) => columns) };
  }

  /**
   * Dit ce que la base porte, ou, s'il n'y a rien, retient le HEAD dont le schéma est sain. Trois temps, chacun dans un processus : ce qu'`information_schema` dit (vues du
   * working set, colonnes générées) ; puis, ce qui lit des tables système (les vues de HEAD, le working set modifié ou non) ; puis, s'il l'est, le schéma de HEAD. Les deux
   * derniers commencent par l'assertion des vues, qui arrête le groupe si une vue masque ce qu'ils lisent : une vue arrivée depuis le premier temps.
   */
  async function diagnose(db: DoltDatabase, lane: Lane | undefined): Promise<void> {
    const options: QueryOptions = lane ? { lane } : {};
    const [views = [], generated = []] = await queryAll(
      db,
      [`select table_name as view_name from information_schema.views where ${VIEWS_WHERE}`, `select table_name as tbl, column_name as col ${GENERATED_COLUMNS}`],
      options,
    );
    const seen = [...new Set(views.map((row) => viewProblem(text(row.view_name))))];
    if (seen.length > 0 || generated.length > 0) {
      throw new StoredSqlError([...seen, ...generated.map((row) => columnProblem(text(row.tbl), text(row.col)))], db.dir);
    }

    const [, headViews = [], uncommitted = []] =
      (await changed(() => queryAll(db, [storedViewsAssertion(), `select name ${HEAD_VIEWS}`, `select count(*) as n ${UNCOMMITTED}`], options))) ?? [];
    if (headViews.length > 0) throw new StoredSqlError([...new Set(headViews.map((row) => `${viewProblem(text(row.name))} (dans HEAD)`))], db.dir);
    // Un compte que Dolt rend en nombre ou en chaîne (derrière un serveur) : tout ce qui n'est pas « 0 » est un working set modifié.
    if (String(uncommitted[0]?.n ?? '0') === '0') {
      pinned.delete(db.dir); // le working set est propre : plus rien à retenir, l'assertion passe sans
      return;
    }
    const atHead = await headColumns(db, options);
    if (!atHead) return; // une vue est arrivée, ou HEAD a changé : la lecture reprend, et son assertion le dira
    const problems = atHead.columns.flatMap(({ table, rows }) => rows.filter((row) => isGenerated(row.Extra)).map((row) => `${columnProblem(table, text(row.Field))} (dans HEAD)`));
    if (problems.length > 0) throw new StoredSqlError(problems, db.dir);
    if (!atHead.head) throw new DoltQueryError(`HEAD illisible dans ${db.dir}`, db.dir);
    pinned.set(db.dir, atHead.head);
  }

  function diagnoseOnce(db: DoltDatabase, options: QueryOptions | undefined): Promise<void> {
    let flight = diagnosing.get(db.dir);
    if (!flight) {
      // Sans le signal du demandeur : le diagnostic est partagé, et l'abandon de l'un ne doit pas faire échouer les autres. Un demandeur qui part est libéré aussitôt.
      flight = diagnose(db, options?.lane).finally(() => diagnosing.delete(db.dir));
      diagnosing.set(db.dir, flight);
    }
    return abortable(flight, options?.signal);
  }

  async function checked(db: DoltDatabase, sqls: readonly string[], options: QueryOptions | undefined): Promise<Row[][]> {
    if (sqls.every(readsNoTable)) return queryAll(db, sqls, options);
    for (let attempt = 1; ; attempt++) {
      try {
        const [, , ...results] = await queryAll(db, [...storedSqlPrelude(pinned.get(db.dir)), ...sqls], options);
        return results;
      } catch (err) {
        if (!(err instanceof DoltQueryError) || !ASSERTION_FAILED.test(err.message)) throw err;
        if (attempt >= MAX_ATTEMPTS) throw new DoltQueryError(`La base change plus vite que la vérification du SQL qu'elle porte (${MAX_ATTEMPTS} essais) : réessayez dans un instant.`, db.dir);
        await diagnoseOnce(db, options);
      }
    }
  }

  return {
    open(dir) {
      const db = client.open(dir);
      return {
        dir,
        query: async (sql, options) => (await checked(db, [sql], options))[0] ?? [],
        queryAll: (sqls, options) => checked(db, sqls, options),
      };
    },
  };
}

/** Le client Dolt des Projets de l'app : `createDoltClient`, qui vérifie chaque lecture (voir `withStoredSqlCheck`). */
export const createCheckedDoltClient = (options?: DoltClientOptions): DoltClient => withStoredSqlCheck(createDoltClient(options));
