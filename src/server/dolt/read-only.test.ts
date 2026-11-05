import { describe, expect, it } from 'vitest';
import { tablesRead } from '../testing/reads-at-head';
import { type DoltDatabase, DoltQueryError, type Row, sqlString } from './client';
import { readTicketHistories } from './history';
import { assertReadOnly, ReadOnlyViolation } from './read-only';
import { readComments, readDependencies, readHead, readIssue, readIssueBase, readIssueParts, readIssuePrefix, readIssueSummaries, readLabels } from './reader';

/** L'erreur que le garde lève pour cette requête, ou `undefined` s'il l'accepte. */
const refusal = (sql: string): unknown => {
  try {
    assertReadOnly(sql);
  } catch (err) {
    return err;
  }
  return undefined;
};

describe('assertReadOnly', () => {
  it.each<[string, string]>([
    ['insert', 'insert into issues values (1)'],
    ['update', 'update issues set status = "closed"'],
    ['delete', 'delete from issues'],
    ['drop', 'drop table issues'],
    ['call', "call dolt_commit('-am', 'x')"],
    ['create', 'create table t (id int)'],
    ['truncate', 'truncate table issues'],
    ['alter', 'alter table issues add column x int'],
    ['replace', 'replace into issues values (1)'],
    ['load data', "load data infile '/etc/passwd' into table issues"],
    ['set', 'set @@dolt_force_transaction_commit = 1'],
    ['use', 'use autre_base'],
    ['start transaction', 'start transaction'],
    ['commit', 'commit'],
    ['lock', 'lock tables issues write'],
    ['instruction vide', ''],
    ['un commentaire seul', '-- rien'],
    ['lecture puis écriture', 'select 1; delete from issues'],
    ['deux lectures', 'select 1; select 2'],
    ['écriture après une chaîne', "select 'a'; update issues set status = 'x'"],
    // Contournements relevés en revue.
    ['WITH … DELETE', 'with x as (select 1) delete from issues'],
    ['WITH … UPDATE', 'with x as (select 1) update issues set status = 1'],
    ['WITH … INSERT', 'with x as (select 1) insert into issues select * from x'],
    ['WITH récursif à plusieurs tables … DELETE', 'with recursive x (n) as (select 1), y as (select 2) delete from issues'],
    ['WITH sans instruction finale', 'with x as (select 1)'],
    ['WITH mal formé', 'with x (select 1) select 1'],
    ['apostrophe dans un commentaire --', "select 1 -- '\n; insert into issues values (2) -- '"],
    ['apostrophe dans un commentaire #', "select 1 # '\n; insert into issues values (2) # '"],
    ['apostrophes dans des commentaires /* */', "select 1 /* ' */; insert into issues values (2) /* ' */"],
    ['SELECT … INTO DUMPFILE', "select 'x' into dumpfile '/tmp/x'"],
    ['SELECT … INTO OUTFILE', "select 'x' into outfile '/tmp/x'"],
    ['SELECT … INTO variable', 'select 1 into @x'],
    ['SELECT … FOR UPDATE', 'select * from issues for update'],
    ['EXPLAIN ANALYZE … DELETE', 'explain analyze delete from issues'],
    ['SHOW CREATE', 'show create table issues'],
    ['LOAD_FILE', "select load_file('/etc/passwd')"],
    // Constructions que Dolt et le garde-fou pourraient lire différemment : dans le doute, on refuse.
    ['commentaire exécutable /*! */', "select 1 /*!50000 into outfile '/tmp/x' */"],
    ['commentaire exécutable contenant ;', 'select 1 /*! ; delete from issues */'],
    ['-- collé au caractère suivant', 'select 1 --x; delete from issues'],
    // Trouvé par fuzzing : le découpeur d'instructions de Dolt ignore les commentaires #, son analyseur les lit.
    ['point-virgule dans un commentaire #', 'select 1 #; delete from issues'],
    ['point-virgule après un commentaire # sur la même ligne', 'select 1 # fin ; delete from issues #'],
    ['apostrophe dans un commentaire # avec ; sur la même ligne', "select 1 # ' ; delete from issues"],
    ['guillemets dans un commentaire #', 'select 1 # "; delete from issues'],
    ['commentaire /* dans un commentaire #', 'select 1 # /*\n; delete from issues # */'],
    ['retour chariot dans un commentaire --', 'select 1 -- x\r; delete from issues'],
    ['retour chariot dans un commentaire #', 'select 1 # x\r; delete from issues'],
    ['chaîne non terminée', "select 'abc"],
    ['identifiant non terminé', 'select `abc'],
    ['commentaire non terminé', 'select 1 /* abc'],
    ['antislash hors chaîne', 'select 1 \\ delete from issues'],
    ['caractère nul', 'select 1\u0000'],
    ['caractère hors ASCII hors chaîne', 'select é from issues'],
    // bdesk-38k.56 : `table t` est une lecture (`select * from t`) que Dolt exécute sur le working set, où qu'elle se glisse. En tête
    // d'instruction elle était déjà refusée (ce n'est pas un SELECT) ; dans une sous-requête, après un UNION ou dans un WITH imbriqué, non.
    ['TABLE t en tête (déjà refusé)', 'table issues'],
    ['WITH … TABLE t en tête (déjà refusé)', 'with x as (select 1) table issues'],
    ['(TABLE t) UNION (TABLE u) en tête (déjà refusé)', '(table issues) union (table labels)'],
    ['(TABLE t) dans un FROM', 'select * from (table issues) t'],
    ['UNION TABLE t', 'select * from issues union table issues'],
    ['(WITH … TABLE t) dans un FROM', 'select * from (with x as (select 1) table issues) t'],
  ])('refuse une requête qui n’est pas en lecture seule : %s', (_label, sql) => {
    expect(() => assertReadOnly(sql)).toThrow('lecture seule');
  });

  it.each<[string, string]>([
    ['SELECT', 'select * from issues'],
    ['SELECT en majuscules', '  SELECT 1'],
    ['SELECT terminé par un point-virgule', 'select 1;'],
    ['SHOW', 'show tables'],
    ['DESCRIBE', 'describe issues'],
    ['DESC', 'desc issues'],
    ['EXPLAIN', 'explain select * from issues'],
    ['WITH … SELECT', 'with t as (select 1) select * from t'],
    ['WITH à plusieurs tables, colonnes nommées', 'with a (x) as (select 1), b as (select 2) select * from a, b'],
    ['WITH RECURSIVE … SELECT', 'with recursive l (n) as (select 1 union all select n + 1 from l where n < 3) select * from l'],
    ['point-virgule dans une chaîne', "select * from issues where title = 'a;b; delete from issues'"],
    ['apostrophe échappée dans une chaîne', "select * from issues where id = 'x\\' ; delete from issues; --'"],
    ['apostrophe doublée dans une chaîne', "select * from issues where id = 'it''s -- /* # ; delete'"],
    ['guillemets doubles', 'select "a /* b */ ; c"'],
    ['mots interdits en identifiants entre guillemets inversés', 'select `into`, `update` from `delete`'],
    ['mots interdits dans des noms plus longs', 'select created_at, updated_at, closed_at, close_reason, description from issues'],
    // « table » n'est refusé que comme mot : ni dans un identifiant entre guillemets inversés, ni dans une chaîne, ni dans un nom plus long.
    ['« table » en identifiant entre guillemets inversés', 'select 1 as `table`'],
    ['« table issues » dans une chaîne', "select * from issues as of 'HEAD' where title = 'table issues'"],
    ['« table » dans une chaîne à guillemets doubles', 'select "table issues"'],
    ['noms qui commencent par « table » ou le contiennent', 'select table_name, table_schema, my_table from information_schema.tables'],
  ])('laisse passer une lecture : %s', (_label, sql) => {
    expect(() => assertReadOnly(sql)).not.toThrow();
  });

  // Dolt lit `table t` comme `select * from t`, dans le working set (le dernier commit n'y est lu que par `as of 'HEAD'`, que cette forme
  // n'a pas), et l'accepte partout où une requête peut s'écrire : le garde refuse le mot, pas seulement l'instruction qui s'ouvre par lui.
  describe('TABLE t (bdesk-38k.56)', () => {
    it.each<[string, string]>([
      ['UNION ALL', 'select * from issues union all table issues'],
      ['UNION DISTINCT', 'select * from issues union distinct table issues'],
      ['INTERSECT', 'select * from issues intersect table issues'],
      ['EXCEPT', 'select * from issues except table issues'],
      ['UNION (TABLE t)', 'select * from issues union (table issues)'],
      ['après un JOIN', "select * from labels as of 'HEAD' l join (table issues) i on i.id = l.issue_id"],
      ['dans un IN', 'select * from issues where id in (select id from (table issues) z)'],
      ['dans une sous-requête scalaire', 'select (select count(*) from (table issues) z) as n'],
      ['avec ORDER BY et LIMIT', 'select * from (table issues order by id limit 1) t'],
      ['qualifié par la base', 'select * from (table `autre`.issues) t'],
      ['corps d’une requête commune', 'with x as (table issues) select * from x'],
      ['corps de la seconde requête commune', 'with a as (select 1), x as (table issues) select * from a, x'],
      ['WITH imbriqué, suivi d’une requête commune de plus', 'select * from (with x as (select 1), y as (select 2) table labels) t'],
      ['WITH RECURSIVE imbriqué', 'select * from (with recursive x as (select 1) table issues) t'],
      ['dans une requête commune qui suit un WITH', 'with x as (select * from (table issues) t) select * from x'],
      ['en majuscules', 'SELECT * FROM (TABLE issues) t'],
      ['en casse mêlée', 'select * from (TaBlE issues) t'],
      ['sur plusieurs lignes, avec des tabulations', 'select * from (table\n\tissues\n) t'],
      ['dans un EXPLAIN', 'explain select * from (table issues) t'],
      ['dans un SHOW (« show table status » : refusé par ricochet)', 'show table status'],
    ])('refuse « table » : %s', (_label, sql) => {
      const error = refusal(sql);

      expect(error).toBeInstanceOf(ReadOnlyViolation);
      expect((error as Error).message).toContain('« table »');
    });

    it('dit pourquoi, sans citer la requête : le mot interdit', () => {
      expect((refusal('select * from (table issues) t') as Error).message).toBe('Requête refusée : le lecteur Dolt est en lecture seule (mot interdit « table »)');
    });

    it('ne cite rien de la requête, ni extrait ni nom de table', () => {
      const message = (refusal('select canari from (table canari) t') as Error).message;

      expect(message).toContain('lecture seule');
      expect(message).not.toMatch(/canari|select|issues|read only/i);
    });
  });

  // Relecture finale de bdesk-38k.56 (B1, puis B4) : le lecteur n'écrit aucun commentaire (`reader.ts` et `history.ts` n'en contiennent pas, `sqlString` et
  // `sqlIdent` n'en produisent pas), et c'est là que le découpeur d'instructions de `dolt sql -q` et l'analyseur de Dolt lisent le plus différemment :
  // - Dolt exécute le contenu de `/*! … */`, de `/*M! … */` et de `/*dolt! … */` (B1) ;
  // - pour le découpeur, `/*/` est un commentaire complet ; pour l'analyseur, et pour l'ancien garde, il ne fait qu'en ouvrir un, qui court jusqu'au `*/`
  //   suivant. Un guillemet placé là ouvre une chaîne pour le découpeur seul : le `;` d'un commentaire `-- ` qui suit coupe l'instruction, et le morceau
  //   suivant s'exécute (B4).
  // Tout commentaire hors d'une chaîne ou d'un identifiant est donc refusé : `/* */` (exécutable ou non), `-- ` et `--<tabulation>`, `#`.
  describe('commentaires (bdesk-38k.56)', () => {
    /** Ce que le contenu d'un commentaire exécutable ferait lire ou écrire ; `%` est la marque d'ouverture, derrière `/*`. */
    const bodies: [string, string][] = [
      ['TABLE t dans un FROM', 'select * from (/*%table issues*/) t'],
      ['UNION TABLE t', "select * from issues as of 'HEAD' /*%union table issues*/"],
      ['INTO OUTFILE', "select title from issues as of 'HEAD' /*%into outfile '/tmp/x'*/"],
      ['LOAD_FILE', "select 1 as n /*%, load_file('/etc/passwd') as f*/"],
      ['avec une espace après la marque', 'select * from (/*% table issues */) t'],
    ];
    /** Les marques que Dolt 2.5.0 exécute (la casse du M compte, celle de dolt non), avec ou sans numéro de version. */
    const executed = ['!', '!50000', 'M!', 'M!50000', 'M!100000', 'dolt!', 'DOLT!', 'Dolt!', 'dOlT!', 'DOLT!50000'];

    describe.each(executed)('/*%s … */', (tag) => {
      it.each(bodies)('refuse : %s', (_label, template) => {
        const error = refusal(template.replace('%', tag));

        expect(error).toBeInstanceOf(ReadOnlyViolation);
        expect((error as Error).message).toContain('commentaire');
      });
    });

    const P = ';select 7*11 as zq;';
    it.each<[string, string]>([
      // B4 : `/*/` est complet pour le découpeur, le guillemet qui suit ouvre une chaîne pour lui seul
      ['B4 : /*/ puis une apostrophe', `select 1 as x /*/ ' */ -- '${P} -- '`],
      ['B4 : /*/ collé à l’apostrophe', `select 1 as x /*/' */ -- '${P} -- '`],
      ['B4 : /*/ puis un guillemet double', `select 1 as x /*/ " */ -- "${P} -- "`],
      ['B4 : /*/ puis un accent grave', `select 1 as x /*/ \` */ -- \`${P} -- \``],
      ['B4 : /*/ puis un saut de ligne et une apostrophe', `select 1 as x /*/\n' */ -- '${P} -- '`],
      ['B4 : dans un WITH', `with c as (select 1 as x /*/ ' */) select x from c -- '${P} -- '`],
      ['B4 : dans un SHOW', `show tables /*/ ' */ -- '${P} -- '`],
      ['B4 : /*/ puis /*/', `select 1 as x /*//*/ -- '${P} -- '`],
      // commentaires de bloc, que Dolt les lise comme tels ou les exécute
      ['bloc', 'select /* c */ 1'],
      ['bloc vide', 'select 1 /**/'],
      ['bloc /*/ ! */', 'select 1 /*/ ! */'],
      ['bloc /*/*/', 'select 1 /*/*/'],
      ['bloc /***/', 'select 1 /***/'],
      ['bloc qui en contient un autre', 'select 1 /* /* */'],
      ['indication d’optimiseur', 'select /*+ JOIN_ORDER(a, b) */ 1'],
      ['espace avant le point d’exclamation', 'select 1 /* ! */'],
      ['espace avant M!', 'select 1 /* M! */'],
      ['M sans point d’exclamation', 'select 1 /*M*/'],
      ['dolt sans point d’exclamation', 'select 1 /*dolt*/'],
      ['marque inconnue de Dolt', 'select 1 /*X!*/'],
      ['« table » entre le mot et le nom', 'select * from (table /* c */ issues) t'],
      ['« table » après un commentaire', 'select * from (/* c */table issues) t'],
      // commentaires de ligne
      ['-- et une espace', 'select 1 -- c'],
      ['-- et une tabulation', 'select 1 --\tc'],
      ['-- et un saut de ligne', 'select 1 --\n, 2'],
      ['-- en fin de requête', 'select 1 --'],
      ['-- collé', 'select 1 --c'],
      ['-- après le point-virgule', 'select 1; -- fin'],
      ['-- puis la suite de la requête', 'select 1 -- un commentaire\n, 2'],
      ['« table » entre le mot et le nom, commentaire de ligne', 'select * from (table -- c\n issues) t'],
      ['apostrophe dans un commentaire --', "select 1 -- l'apostrophe"],
      // commentaires #
      ['#', 'select 1 # c'],
      ['# en fin de requête', 'select 1 #'],
      ['# sans rien de dangereux dedans', 'select 1 # un commentaire\n, 2'],
    ])('refuse un commentaire : %s', (_label, sql) => {
      const error = refusal(sql);

      expect(error).toBeInstanceOf(ReadOnlyViolation);
      expect((error as Error).message).toContain("commentaire (le lecteur n'en écrit aucun)");
    });

    // Les marques de commentaire dans une chaîne ou un identifiant n'en sont pas : ce sont des caractères, que le découpeur et l'analyseur lisent de même.
    it.each<[string, string]>([
      ['-- dans une chaîne', "select '-- x'"],
      ['# dans une chaîne', "select '# x'"],
      ['/* */ dans une chaîne', "select '/* x */'"],
      ['/*/ et une apostrophe doublée dans une chaîne', "select '/*/ '' */ -- ' as x"],
      ['*/ puis /* dans une chaîne', "select '*/ /*'"],
      ['-- dans un identifiant entre accents graves', 'select 1 as `a--b`'],
      ['/* dans un identifiant entre accents graves', 'select 1 as `/*`'],
      ['/* */ dans une chaîne entre guillemets doubles', 'select "/* x */"'],
      ['division et multiplication', 'select 6 / 2 * 3'],
      ['deux moins séparés', 'select 1 - -1'],
      ['un moins collé à un nombre', 'select 1 -1'],
      ['mot suivi d’un moins', 'select id -1 from issues as of \'HEAD\''],
    ])('laisse passer : %s', (_label, sql) => {
      expect(() => assertReadOnly(sql)).not.toThrow();
    });
  });

  // Relecture de bdesk-38k.56. Avec `ANSI_QUOTES` persisté dans la base (`set @@persist.sql_mode`), `"…"` est pour Dolt un identifiant, où l'antislash
  // n'échappe plus rien : le garde, qui y lit un échappement, n'y voit qu'une chaîne, quand Dolt y lit un identifiant puis du SQL vivant. Le lecteur
  // n'écrit jamais de guillemets doubles (chaînes entre apostrophes, identifiants entre accents graves) : un antislash entre guillemets doubles est refusé.
  describe('antislash entre guillemets doubles (bdesk-38k.56)', () => {
    it.each<[string, string]>([
      ['le cas de la relecture : un identifiant « \\ », puis TABLE t', 'select 1 as "\\", t.* from (table issues) t -- "'],
      ['puis load_file', `select 1 as "\\", load_file('/etc/passwd') -- "`],
      ['puis into outfile', `select 1 as "\\" into outfile '/tmp/x' -- "`],
      ['antislash avant le guillemet fermant', 'select "a\\"'],
      ['guillemet échappé', 'select "a\\"b"'],
      ['antislash doublé', 'select "\\\\"'],
      ['antislash au milieu', 'select "a\\nb"'],
      ['dans un identifiant qualifié', 'select * from "ma\\base".issues'],
    ])('refuse : %s', (_label, sql) => {
      const error = refusal(sql);

      expect(error).toBeInstanceOf(ReadOnlyViolation);
      expect((error as Error).message).toContain('antislash entre guillemets doubles ou accents graves');
    });

    it.each<[string, string]>([
      ['guillemets doubles sans antislash', 'select "a /* b */ ; c"'],
      ['guillemet doublé', 'select "a""b"'],
      ['antislash dans une chaîne entre apostrophes', "select 'a\\\\b' as x"],
      ['apostrophe échappée dans une chaîne', "select 'it\\'s'"],
      ['guillemet double dans une chaîne entre apostrophes, avec antislash', `select 'a"\\\\"b'`],
    ])('laisse passer : %s', (_label, sql) => {
      expect(() => assertReadOnly(sql)).not.toThrow();
    });
  });

  // Relecture finale de bdesk-38k.56 (B3). Entre accents graves, l'analyseur de Dolt lit l'antislash comme un caractère ordinaire, et le découpeur
  // d'instructions de `dolt sql -q` (celui qui coupe aux `;`) comme un échappement : un accent grave qui suit un antislash n'ouvre ni ne ferme rien pour lui.
  // Les deux ne voient plus les mêmes identifiants, et le découpeur coupe à un `;` que le garde lit dans un identifiant ou dans un commentaire. Quand le
  // premier morceau reste valide (il finit dans un commentaire `-- `), les morceaux suivants s'exécutent : c'est l'écart que le garde dit refuser.
  // Le lecteur n'écrit jamais d'antislash entre accents graves.
  describe('antislash entre accents graves (bdesk-38k.56)', () => {
    it.each<[string, string]>([
      ['le cas de la relecture finale : coupure dans un identifiant', "select 1 as `a\\`, 'x', 2 as `;select * from (table issues) t; -- `"],
      ['le premier morceau finit dans un commentaire : le morceau suivant s’exécute', 'select 1 as `\\`-- `;select 7*11 as zq; -- `'],
      ['antislash seul', 'select 1 as `\\`'],
      ['antislash au milieu', 'select 1 as `a\\b`'],
      ['antislash doublé', 'select 1 as `a\\\\`'],
      ['antislash avant un accent grave doublé', 'select 1 as `a\\``b`'],
      ['antislash suivi d’un saut de ligne', 'select 1 as `a\\\n`'],
      ['dans un identifiant qualifié', 'select * from `ma\\base`.issues as of \'HEAD\''],
      ['dans la liste d’un WITH', 'with `x\\` as (select 1) select * from `x\\`'],
    ])('refuse : %s', (_label, sql) => {
      const error = refusal(sql);

      expect(error).toBeInstanceOf(ReadOnlyViolation);
      expect((error as Error).message).toContain('antislash entre guillemets doubles ou accents graves');
    });

    it.each<[string, string]>([
      ['identifiant entre accents graves sans antislash', 'select 1 as `a b`'],
      ['accent grave doublé', 'select 1 as `a``b`'],
      ['point-virgule et guillemets dans un identifiant', "select 1 as `a;'\"b`"],
      ['antislash dans une chaîne entre apostrophes, accents graves autour', "select `x`, 'a\\\\b'"],
      ['accent grave dans une chaîne, avec antislash', "select 'a\\`b'"],
      ['la base d’une époque antérieure (reader.ts)', 'select * from `ma_base/c1`.dolt_history_dependencies'],
    ])('laisse passer : %s', (_label, sql) => {
      expect(() => assertReadOnly(sql)).not.toThrow();
    });
  });

  // Relecture finale de bdesk-38k.56, recherche d'autres écarts. Le découpeur d'instructions de `dolt sql -q` compte les antislash qui se suivent sans remettre
  // le compte à zéro au saut de ligne : un antislash qui échappe un saut de ligne dans une chaîne compte encore pour l'antislash suivant. Pour lui, le
  // guillemet qui suit `\<saut de ligne>\` n'est plus échappé et ferme la chaîne ; pour l'analyseur, et pour le garde, il l'est. Même écart que pour les
  // accents graves : le découpeur coupe à un `;` que le garde lit dans une chaîne ou dans un commentaire.
  describe('antislash devant un saut de ligne, dans une chaîne (bdesk-38k.56)', () => {
    it.each<[string, string]>([
      ['le premier morceau finit dans un commentaire : le morceau suivant s’exécute', "select '\\\n\\\\' -- ';select 7*11 as zq; -- '"],
      ['le guillemet qui suit est échappé pour l’analyseur', "select 'a\\\n\\'b' -- ';select 7*11 as zq; -- '"],
      ['coupure dans une chaîne', "select 'a\\\n\\';select 7*11 as zq;'"],
      ['l’antislash seul devant le saut de ligne', "select 'a\\\nb'"],
      ['trois antislash devant le saut de ligne : le dernier échappe', "select 'a\\\\\\\nb'"],
      ['saut de ligne, antislash, saut de ligne', "select 'a\\\n\\\nb'"],
    ])('refuse : %s', (_label, sql) => {
      const error = refusal(sql);

      expect(error).toBeInstanceOf(ReadOnlyViolation);
      expect((error as Error).message).toContain('antislash devant un saut de ligne');
    });

    it.each<[string, string]>([
      ['saut de ligne dans une chaîne', "select 'a\nb'"],
      ['deux antislash devant le saut de ligne : le second n’échappe rien', "select 'a\\\\\nb'"],
      ['antislash devant un retour chariot', "select 'a\\\rb'"],
      ['antislash, lettre, saut de ligne', "select 'a\\n\nb'"],
      ['apostrophe échappée, puis un saut de ligne', "select 'it\\'s\nb'"],
    ])('laisse passer : %s', (_label, sql) => {
      expect(() => assertReadOnly(sql)).not.toThrow();
    });

    // Ce que `sqlString` écrit pour une valeur : les antislash sont doublés, donc jamais seuls devant un saut de ligne. Une valeur (l'identifiant d'un ticket
    // demandé par l'URL, par exemple) qui contient un antislash puis un saut de ligne reste une requête admise.
    it('admet ce que sqlString écrit pour une valeur qui contient des antislash et des sauts de ligne', () => {
      for (const value of ['a\\\nb', '\\\n', '\n\\', 'a\\\\\nb', "\\\n'\\\n", '\\\n\\\n\\']) {
        expect(() => assertReadOnly(`select * from issues as of 'HEAD' where id = ${sqlString(value)}`)).not.toThrow();
      }
    });
  });

  // Chaque requête que le lecteur envoie aujourd'hui doit passer le garde : un garde plus strict ne doit pas rendre un Projet illisible.
  // Elles viennent des vraies fonctions de lecture (`reader.ts`, `history.ts`), pas d'une liste copiée ici qui vieillirait seule.
  describe('requêtes du lecteur', () => {
    /** Une base factice dont chaque lecture est jugée par le vrai garde ; `refused` garde le SQL de celles qu'il refuse. */
    function guardedDb(answer: (sql: string) => Row[]) {
      const queries: string[] = [];
      const refused: string[] = [];
      const read = async (sql: string): Promise<Row[]> => {
        queries.push(sql);
        try {
          assertReadOnly(sql);
        } catch (err) {
          if (!(err instanceof ReadOnlyViolation)) throw err;
          refused.push(sql);
        }
        return answer(sql);
      };
      const db: DoltDatabase = { dir: '/projet', query: read, queryAll: (sqls) => Promise.all(sqls.map(read)) };
      return { db, queries, refused };
    }

    /** Des réponses qui mènent `readTicketHistories` à relire les dépendances d'une époque antérieure du schéma (la requête `ma_base/c1`). */
    const answer = (sql: string): Row[] => {
      if (sql.startsWith('select hashof(')) return [{ head: 'c1' }];
      if (sql.startsWith('select database()')) return [{ name: 'ma_base' }];
      if (sql.startsWith('select `value` from config')) return [{ value: 'p' }];
      if (sql.includes('select l.commit_hash')) return [{ commit_hash: 'c1', date: '2026-10-01 10:00:00.000' }];
      if (sql.startsWith('show columns from')) {
        const old = sql.includes('ma_base/c1');
        return [...['commit_hash', 'issue_id', 'type', 'created_at', ...(old ? ['depends_on_id'] : [])].map((Field) => ({ Field }))];
      }
      if (/^select .*from .*dolt_history_dependencies/s.test(sql)) {
        // Le schéma courant n'a plus la cible du commit c1 : sa lecture se reprend à l'époque d'avant.
        return sql.includes('ma_base/c1') ? [{ commit_hash: 'c1', issue_id: 'p-1', depends_on_id: 'p-2', type: 'blocks' }] : [{ commit_hash: 'c1', issue_id: 'p-1', type: 'blocks' }];
      }
      return [];
    };

    it('toutes passent : le préfixe, le HEAD, la liste, la fiche, les dépendances et l’historique', async () => {
      const { db, queries, refused } = guardedDb(answer);

      await readIssuePrefix(db);
      await readHead(db);
      await readIssueSummaries(db);
      await readIssue(db, "p-1' ; drop table issues -- ");
      await readDependencies(db);
      await readLabels(db, 'p-1');
      await readComments(db, 'p-1');
      await readIssueBase(db);
      await readIssueParts(db, 'p-1');
      await readTicketHistories(db);

      expect(refused).toEqual([]);
      // Le test a bien vu tout ce que le lecteur lit : ses tables de tickets, la lignée, les dépendances de chaque époque du schéma.
      expect(tablesRead(queries)).toEqual(new Set(['config', 'issues', 'dependencies', 'labels', 'comments']));
      expect(queries.some((sql) => sql.includes('dolt_commit_ancestors'))).toBe(true);
      expect(queries.some((sql) => sql.includes('dolt_history_issues'))).toBe(true);
      expect(queries.some((sql) => sql.includes('`ma_base/c1`.dolt_history_dependencies'))).toBe(true);
      expect(queries.some((sql) => sql.startsWith('show columns from'))).toBe(true);
    });

    it('le test voit un refus : un garde qui refuserait une requête du lecteur ferait échouer le test', async () => {
      const { db, refused } = guardedDb(answer);

      await db.query('select * from (table issues) t');

      expect(refused).toEqual(['select * from (table issues) t']);
    });
  });

  // Le refus part dans la réponse HTTP : typé, il devient un 503 avec sa raison ; ordinaire, un 500 qui citerait la requête.
  describe('erreur du refus', () => {
    /** Ce qui trahit la requête dans un message : le mot « canari » que chaque requête ci-dessous contient, ou du SQL ordinaire. */
    const QUERY_TRACE = /canari|select|issues|read only/i;

    it('est une ReadOnlyViolation, donc une DoltQueryError : le service en fait un 503, et non un 500', () => {
      const error = refusal('delete from issues');

      expect(error).toBeInstanceOf(ReadOnlyViolation);
      expect(error).toBeInstanceOf(DoltQueryError);
      expect((error as Error).name).toBe('ReadOnlyViolation');
    });

    it.each<[string, string]>([
      ['verbe qui n’est pas une lecture', 'canari_ecrit into canari'],
      ['écriture', "delete from canari where id = 'canari'"],
      ['plusieurs instructions', 'select canari; select canari'],
      ['mot interdit', "select canari into outfile '/tmp/canari'"],
      ['WITH qui ne finit pas par une lecture', 'with canari as (select 1) delete from canari'],
      ['WITH mal formé', 'with canari (select canari) select canari'],
      ['parenthèse non fermée', 'with canari as (select canari'],
      ['chaîne non terminée', "select 'canari"],
      ['identifiant non terminé', 'select `canari'],
      ['caractère hors ASCII', 'select canari é'],
      ['antislash hors chaîne', 'select canari \\ canari'],
      ['commentaire exécutable', 'select canari /*!50000 canari */'],
      ['commentaire exécutable MariaDB', 'select canari /*M!canari*/'],
      ['commentaire exécutable /*dolt! */', 'select canari /*dolt!canari*/'],
      ['commentaire /*/ (B4)', "select canari /*/ ' canari */ -- 'canari"],
      ['commentaire --', 'select canari -- canari'],
      ['commentaire de bloc', 'select canari /* canari */'],
      ['antislash entre guillemets doubles', 'select "canari\\" canari'],
      ['antislash entre accents graves', 'select 1 as `canari\\`'],
      ['-- collé au caractère suivant', 'select canari --canari'],
      ['commentaire # ambigu', "select canari # '; canari"],
      ['commentaire non terminé', 'select canari /* canari'],
      ['caractère de contrôle dans un commentaire', 'select canari -- canari\u0001'],
    ])('ne cite rien de la requête, ni extrait ni mot : %s', (_label, sql) => {
      const error = refusal(sql);

      expect(error).toBeInstanceOf(ReadOnlyViolation);
      expect((error as Error).message).toContain('lecture seule');
      expect((error as Error).message).not.toMatch(QUERY_TRACE);
    });

    it('dit pourquoi, sans citer la requête : l’instruction en trop, le mot interdit', () => {
      expect((refusal('select 1; select 2') as Error).message).toContain('une seule instruction');
      expect((refusal('select 1 into @x') as Error).message).toContain('« into »');
    });
  });
});
