import { describe, expect, it } from 'vitest';
import { tablesRead } from '../testing/reads-at-head';
import { type DoltDatabase, DoltQueryError, type Row, sqlIdent, sqlString } from './client';
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
    ['SHOW', 'show tables'],
    ['DESCRIBE', 'describe issues'],
    ['DESC', 'desc issues'],
    ['EXPLAIN', 'explain select * from issues'],
    ['WITH … SELECT', 'with t as (select 1) select * from t'],
    ['WITH à plusieurs tables, colonnes nommées', 'with a (x) as (select 1), b as (select 2) select * from a, b'],
    ['WITH RECURSIVE … SELECT', 'with recursive l (n) as (select 1 union all select n + 1 from l where n < 3) select * from l'],
    ['point-virgule dans une chaîne', "select * from issues where title = 'a;b; delete from issues'"],
    ['apostrophe doublée dans une chaîne', "select * from issues where id = 'it''s -- /* # ; delete'"],
    ['mots interdits dans des noms plus longs', 'select created_at, updated_at, closed_at, close_reason, description from issues'],
    // « table » n'est refusé que comme mot : ni dans un identifiant entre guillemets inversés, ni dans une chaîne, ni dans un nom plus long.
    ['« table issues » dans une chaîne', "select * from issues as of 'HEAD' where title = 'table issues'"],
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
      ['sur plusieurs lignes', 'select * from (table\n issues\n) t'],
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
      ['multiplication', 'select 6 * 3'],
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
  describe('guillemets doubles (bdesk-38k.56, puis .63 : refusés partout)', () => {
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
      expect((error as Error).message).toContain('guillemets doubles');
    });

    it.each<[string, string]>([
      ['guillemets doubles sans antislash', 'select "a /* b */ ; c"'],
      ['guillemet doublé', 'select "a""b"'],
      ['alias entre guillemets doubles', 'select 1 as "x"'],
      ['identifiant entre guillemets doubles', 'select * from "issues"'],
    ])('refuse aussi : %s', (_label, sql) => {
      expect((refusal(sql) as Error).message).toContain('guillemets doubles');
    });

    it.each<[string, string]>([
      ['antislash dans une chaîne entre apostrophes', "select 'a\\\\b' as x"],
      ['guillemet double dans une chaîne entre apostrophes, avec antislash', `select 'a"\\\\"b'`],
      ['guillemet double dans une chaîne entre apostrophes', `select 'a"b'`],
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
      expect((error as Error).message).toContain('antislash entre accents graves');
    });

    it.each<[string, string]>([
      ['identifiant entre accents graves sans antislash', 'select 1 as `a b`'],
      ['accent grave doublé', 'select 1 as `a``b`'],
      ['point-virgule et guillemets dans un identifiant', "select 1 as `a;'\"b`"],
      ['antislash dans une chaîne entre apostrophes, accents graves autour', "select `x`, 'a\\\\b'"],
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
      expect((error as Error).message).toContain('antislash isolé');
    });

    it.each<[string, string]>([
      ['saut de ligne dans une chaîne', "select 'a\nb'"],
      ['deux antislash devant le saut de ligne : le second n’échappe rien', "select 'a\\\\\nb'"],
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

  // bdesk-38k.63 : liste blanche. Les écarts entre le découpeur d'instructions de `dolt sql -q`, l'analyseur de Dolt et le garde se sont trouvés un par un (B1 à
  // B4), chaque fois dans une forme que le lecteur n'écrit pas. Plutôt que de courir derrière elles, le garde n'admet plus que ce que `reader.ts` et
  // `history.ts` produisent par `sqlString` et `sqlIdent` : hors des chaînes et des identifiants, des mots, des nombres, l'espace, le saut de ligne et
  // `( ) , . * + - < = >` ; des chaînes entre apostrophes dont l'antislash n'est que doublé ; des identifiants entre accents graves sans antislash.
  describe('liste blanche (bdesk-38k.63)', () => {
    it.each<[string, string]>([
      ['point-virgule final', 'select 1;'],
      ['point-virgule au milieu', 'select 1 ; select 2'],
      ['arobase : variable utilisateur', 'select @x'],
      ['arobase : variable système', 'select @@version'],
      ['affectation de variable', 'select @x := 1'],
      ['deux-points', 'select a := 1 from t'],
      ['point d’exclamation', 'select !1'],
      ['différent de', 'select 1 != 2'],
      ['pour cent', 'select 6 % 4'],
      ['barre oblique : division', 'select 6 / 2'],
      ['barre verticale', 'select 1 | 2'],
      ['esperluette', 'select 1 & 1'],
      ['accent circonflexe', 'select 1 ^ 1'],
      ['tilde', 'select ~1'],
      ['point d’interrogation', 'select ?'],
      ['dollar', 'select $a'],
      ['crochets', 'select a[1] from t'],
      ['accolades', 'select {a} from t'],
      ['tabulation', 'select\t1'],
      ['retour chariot', 'select 1\r'],
      ['retour chariot au milieu', 'select\r1'],
      ['saut de page', 'select 1 \f'],
      ['tabulation verticale', 'select 1 \u000b'],
      ['espace insécable', 'select 1 '],
      ['caractère nul', 'select 1 \u0000'],
      ['suppression', 'select 1 \u007f'],
      ['caractère de contrôle', 'select 1 \u0001'],
      ['lettre accentuée', 'select é'],
      ['hors BMP', 'select 😀'],
      ['demi-paire isolée', 'select \ud83d'],
      ['séparateur de ligne Unicode', 'select 1  '],
      ['\\G du client mysql', 'select 1\\G'],
      ['\\G après une espace', 'select 1 \\G'],
      ['\\g', 'select 1\\g'],
      ['\\q', '\\q'],
      ['\\. (source)', '\\. /dev/null'],
    ])('refuse en dehors des chaînes : %s', (_label, sql) => {
      const error = refusal(sql);

      expect(error).toBeInstanceOf(ReadOnlyViolation);
      expect((error as Error).message).toMatch(/une seule instruction|caractère|antislash/);
    });

    it.each<[string, string]>([
      ['N', "select N'a'"],
      ['n', "select n'a'"],
      ['_utf8', "select _utf8'a'"],
      ['_utf8mb4', "select _utf8mb4'a'"],
      ['_binary', "select _binary'a'"],
      ['x : hexadécimal', "select x'41'"],
      ['X : hexadécimal', "select X'41'"],
      ['b : binaire', "select b'101'"],
      ['B : binaire', "select B'1'"],
      ['0x collé', "select 0x41'a'"],
      ['accent grave collé à un mot', 'select a`b`'],
      ['chaîne collée au mot qui suit', "select 'a'b"],
      ['identifiant collé au mot qui suit', 'select `a`b'],
    ])('refuse un mot collé à un guillemet (préfixe de chaîne) : %s', (_label, sql) => {
      const error = refusal(sql);

      expect(error).toBeInstanceOf(ReadOnlyViolation);
      expect((error as Error).message).toMatch(/collé/);
    });

    it.each<[string, string]>([
      ['0x', 'select 0x41'],
      ['nombre', 'select 1.5e-3'],
      ['introducteur séparé par une espace', "select _utf8 'a'"],
      ['colonne et alias', "select x 'alias'"],
      ['parenthèses, virgules, comparaisons', 'select a, b from t where a <= 1 and b >= 2 and a <> b'],
      ['opérateurs JSON', "select j->'$.a', j->>'$.b' from t"],
      ['guillemets collés à une ponctuation', "select (`a`), ('b'), `c`.`d`, 'e','f'"],
    ])('laisse passer ce que Dolt lit comme une instruction ordinaire : %s', (_label, sql) => {
      expect(() => assertReadOnly(sql)).not.toThrow();
    });

    // Les commandes du client (le découpeur d'instructions de `dolt sql -q` lit `delimiter` au début d'un morceau et change de séparateur ; `use` change de base) :
    // le garde exige un premier mot de lecture, et plus aucun point-virgule n'amène un morceau de plus.
    it.each<[string, string]>([
      ['delimiter ;;', 'delimiter ;;'],
      ['delimiter //', 'delimiter //'],
      ['DELIMITER //', 'DELIMITER //'],
      ['delimiter après un saut de ligne', '\ndelimiter //'],
      ['delimiter après une lecture', 'select 1\n;\ndelimiter //'],
      ['delimiter entre deux lectures', 'select 1;\ndelimiter //\nselect 2//'],
      ['source', 'source /dev/null'],
      ['use', 'use autre_base'],
      ['exit', 'exit'],
      ['quit', 'quit'],
      ['status', 'status'],
      ['help', 'help'],
      ['prompt', 'prompt x'],
      ['system', 'system ls'],
      ['tee', 'tee /dev/null'],
      ['delimiter entre parenthèses', '(delimiter //)'],
    ])('refuse la commande du client : %s', (_label, sql) => {
      expect(refusal(sql)).toBeInstanceOf(ReadOnlyViolation);
    });

    it.each<[string, string]>([
      ['delimiter en alias', 'select 1 as delimiter'],
      ['source en alias', 'select 1 as source'],
      ['delimiter dans une chaîne', "select 'delimiter //'"],
      ['use en identifiant', 'select 1 as `use`'],
      ['exit en identifiant', 'select 1 as `exit`'],
      ['charge dans une chaîne : point-virgule, delimiter, use, exit', "select 'a;delimiter //\nselect 7*11 as zq//;use x;exit;source y'"],
    ])('laisse passer, ce n’est qu’un mot ou une chaîne : %s', (_label, sql) => {
      expect(() => assertReadOnly(sql)).not.toThrow();
    });

    // Dans une chaîne, l'antislash n'est admis que doublé : c'est ce que `sqlString` écrit. Tout autre échappement (`\'`, `\n`, `\0`, `\Z`, `\G`, `\%`, `\_`)
    // est lu par l'analyseur, par le découpeur d'instructions et par nous d'une façon qui peut ne pas être la même.
    it.each<[string, string]>([
      ['apostrophe échappée', "select 'a\\'b'"],
      ['\\n', "select 'a\\nb'"],
      ['\\0', "select 'a\\0b'"],
      ['\\Z', "select 'a\\Zb'"],
      ['\\G', "select 'a\\Gb'"],
      ['\\%', "select 'a\\%b'"],
      ['\\_', "select 'a\\_b'"],
      ['\\"', "select 'a\\\"b'"],
      ['antislash de fin de requête', "select 'a\\"],
      ['trois antislash', "select 'a\\\\\\b'"],
      ['antislash puis accent grave', "select 'a\\`b'"],
      ['antislash puis retour chariot', "select 'a\\\rb'"],
    ])('refuse un antislash qui échappe autre chose qu’un antislash, dans une chaîne : %s', (_label, sql) => {
      const error = refusal(sql);

      expect(error).toBeInstanceOf(ReadOnlyViolation);
      expect((error as Error).message).toMatch(/antislash isolé|non terminé/);
    });

    it.each<[string, string]>([
      ['antislash doublé', "select 'a\\\\b'"],
      ['quatre antislash', "select 'a\\\\\\\\b'"],
      ['antislash doublé en fin de chaîne', "select 'a\\\\'"],
      ['antislash doublé puis saut de ligne', "select 'a\\\\\nb'"],
      ['apostrophe doublée', "select 'it''s'"],
      ['apostrophes doublées en fin de chaîne', "select 'a'''"],
      ['accent grave doublé', 'select 1 as `a``b`'],
      ['accents graves doublés en fin d’identifiant', 'select 1 as `a```'],
      ['identifiant fait d’un accent grave', 'select 1 as ````'],
      ['retour chariot, tabulation et saut de ligne dans une chaîne', "select 'a\r\n\tb'"],
      ['hors BMP et demi-paire dans une chaîne', "select '😀 \ud83d \ude00'"],
      ['caractères de contrôle dans une chaîne', "select '\u0001 \u001a \u007f \u0085   \f \u000b'"],
      ['marques de commentaire et point-virgule dans une chaîne', "select ';select 1; -- /* */ # \\\\ \"'"],
      ['marques de commentaire et point-virgule dans un identifiant', 'select 1 as `;select 1; -- /* */ # " \'`'],
      ['longue chaîne', `select '${'a'.repeat(100_000)}'`],
    ])('laisse passer ce que sqlString et sqlIdent écrivent : %s', (_label, sql) => {
      expect(() => assertReadOnly(sql)).not.toThrow();
    });

    // « Zéro refus à tort » : toute valeur, mise dans une requête par `sqlString` (littéral) ou `sqlIdent` (identifiant sans antislash), passe le garde.
    it('admet la requête bâtie avec sqlString ou sqlIdent sur 20 000 valeurs hostiles tirées au hasard', () => {
      const atoms = ['a', ' ', "'", "''", '`', '``', '"', '\\', '\\\\', '\\\n', '\n', '\r', '\r\n', '\t', ';', '-- ', '--', '#', '/*', '*/', '/*/', '*', '%', '_', '@', ':', 'é', '😀', '\ud83d', '\ude00', '\u0000', '\u0001', '\u001a', ' ', '\u0085', 'delimiter ', 'x', 'N', '0x41'];
      let seed = 63;
      const next = (n: number) => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return Math.floor((seed / 2 ** 32) * n);
      };
      const refused: string[] = [];
      for (let i = 0; i < 20_000; i++) {
        const value = Array.from({ length: next(10) }, () => atoms[next(atoms.length)]).join('');
        const sql = i % 4 === 0 ? `select 1 as ${sqlIdent(value.replaceAll('\\', '') || 'x')} from issues as of 'HEAD'` : `select id from issues as of 'HEAD' where id = ${sqlString(value)} or ${sqlString(value)} = ''`;
        if (refusal(sql)) refused.push(JSON.stringify(value));
      }

      expect(refused).toEqual([]);
    });
  });

  // bdesk-38k.63, reprise (B1 et B2 de la relecture). Deux contournements, antérieurs à la liste blanche, que ses caractères ne voyaient pas :
  // - Dolt lit un identifiant entre accents graves suivi d'une parenthèse comme l'appel d'une fonction : `` `load_file`(…) `` lit un fichier, alors que `load_file(…)` nu
  //   était refusé comme mot interdit ;
  // - `dolt_query_diff('…', '…')` exécute le SQL de ses chaînes : un `select … into outfile` y écrit un fichier, un `load_file` y en lit un.
  // Le garde n'admet donc que les appels de sa liste blanche de fonctions (celles de `reader.ts` et `history.ts`, plus `count` et `sleep` des tests), que le nom soit écrit
  // en mot nu ou entre accents graves, et compare aussi le contenu des identifiants entre accents graves aux mots interdits.
  describe('fonctions (bdesk-38k.63)', () => {
    it.each<[string, string]>([
      // B1 : l'identifiant entre accents graves est un appel
      ['load_file entre accents graves', "select `load_file`('/etc/hostname') as v"],
      ['LOAD_FILE en majuscules, avec une espace avant la parenthèse', "select `LOAD_FILE` ('/etc/hostname') as v"],
      ['Load_File en casse mêlée, des blancs partout', "select `Load_File`  (  '/etc/hostname'  ) as v"],
      ['load_file, saut de ligne avant la parenthèse', "select `load_file`\n('/etc/hostname') as v"],
      ['load_file dans une sous-requête', "select * from (select `load_file`('/etc/hostname') as v) t"],
      ['load_file dans un WITH', "with x as (select `load_file`('/etc/hostname') as v) select * from x"],
      ['load_file en alias de table qualifié', "select a.`load_file`('/etc/hostname') as v"],
      // B2 : une fonction de table qui exécute le SQL de ses chaînes
      ['dolt_query_diff, into outfile dans une chaîne', "select * from dolt_query_diff('select ''x'' into outfile ''/tmp/x''', 'select 1')"],
      ['dolt_query_diff, load_file dans une chaîne', "select * from dolt_query_diff('select load_file(''/etc/hostname'') as v', 'select 1 as v')"],
      ['dolt_query_diff entre accents graves', "select * from `dolt_query_diff`('select 1', 'select 1')"],
      ['dolt_query_diff en majuscules, avec une espace', "select * from DOLT_QUERY_DIFF ('select 1', 'select 1')"],
      ['dolt_query_diff dans une jointure', "select * from issues join dolt_query_diff('select 1', 'select 1') d on 1 = 1"],
      // d'autres fonctions que Dolt connaît : refusées, tant qu'elles ne sont pas dans la liste blanche
      ['dolt_diff : lit le working set', "select * from dolt_diff('HEAD', 'WORKING', 'issues')"],
      ['dolt_hashof_table', "select dolt_hashof_table('issues')"],
      ['dolt_hashof_db', 'select dolt_hashof_db()'],
      ['dolt_commit', "select dolt_commit('-am', 'x')"],
      ['get_lock', "select get_lock('a', 1)"],
      ['benchmark', "select benchmark(1000000, 1)"],
      ['uuid', 'select uuid()'],
      ['now', 'select now()'],
      ['concat', "select concat('a', 'b')"],
      ['coalesce', 'select coalesce(1, 2)'],
      ['max', 'select max(id) from issues as of \'HEAD\''],
      ['json_extract', "select json_extract('{}', '$.a')"],
      ['row_number', 'select row_number() over (order by id) from issues as of \'HEAD\''],
      ['une fonction qualifiée', 'select a.fn(1)'],
      ['un nombre suivi d’une parenthèse', 'select 1 (2)'],
      ['un identifiant suivi d’une parenthèse', 'select `a`(1)'],
      ['un identifiant qui porte un mot de structure', 'select `in`(1)'],
      ['un nom Unicode qui ne se réduit à aucune fonction admise', 'select `coúnt`(*)'],
      ['un identifiant à accent grave doublé', 'select `a``b`(1)'],
    ])('refuse l’appel : %s', (_label, sql) => {
      const error = refusal(sql);

      expect(error).toBeInstanceOf(ReadOnlyViolation);
      expect((error as Error).message).toMatch(/mot interdit|liste blanche/);
    });

    it.each<[string, string, string]>([
      ['load_file entre accents graves', 'select `load_file` from t', 'mot interdit « load_file »'],
      ['into', 'select `into` from t', 'mot interdit « into »'],
      ['UPDATE', 'select `UPDATE` from t', 'mot interdit « update »'],
      ['table', 'select 1 as `table`', 'mot interdit « table »'],
      ['delete, qualifié', 'select * from `delete`.issues', 'mot interdit « delete »'],
      ['dolt_query_diff', 'select `dolt_query_diff` from t', 'mot interdit « dolt_query_diff »'],
    ])('refuse un identifiant entre accents graves qui est un mot interdit : %s', (_label, sql, message) => {
      const error = refusal(sql);

      expect(error).toBeInstanceOf(ReadOnlyViolation);
      expect((error as Error).message).toContain(message);
    });

    it('le refus ne cite pas la fonction : ni son nom, ni la requête', () => {
      const message = (refusal("select * from canari_fn('select 1')") as Error).message;

      expect(message).toContain('lecture seule');
      expect(message).not.toMatch(/canari|select/i);
    });

    // Ce que le lecteur appelle (reader.ts, history.ts) et ce que les tests du vrai client appellent : admis, en mot nu comme entre accents graves, quelle que soit la casse.
    it.each<[string, string]>([
      ['hashof', "select hashof('HEAD') as head"],
      ['hashof en majuscules, avec une espace', "SELECT HASHOF ('HEAD') AS head"],
      ['database', 'select database() as name'],
      ['database entre accents graves', 'select `database`() as name'],
      ['count(*)', "select count(*) as c from issues as of 'HEAD'"],
      ['COUNT avec des espaces', "select COUNT ( * ) as c from issues as of 'HEAD'"],
      ['count entre accents graves, en majuscules', "select `COUNT`(*) as c from issues as of 'HEAD'"],
      ['sleep', 'select sleep(1.5) as zzz'],
      ['lag … over (partition by … order by …)', 'select lag(status) over (partition by id order by seq desc) as previous from t'],
      ['lag, saut de ligne avant la parenthèse', 'select lag\n(status) over (partition by id order by seq desc) as previous from t'],
      // Les quatre fonctions de table de la vérification du SQL stocké (bdesk-38k.74) : elles comparent des commits sans résoudre aucun nom de table, et n'exécutent ni ne lisent rien d'autre.
      ['dolt_log, le premier commit', "select commit_hash from dolt_log('HEAD') order by commit_order asc limit 1"],
      ['dolt_schema_diff', "select count(*) as c from dolt_schema_diff('abc', 'WORKING') s where s.to_table_name = 'dolt_nonlocal_tables'"],
      ['dolt_diff_summary', "select 1 from dolt_diff_summary('abc', 'HEAD') d where d.to_table_name = 'dolt_nonlocal_tables' and d.data_change = 0"],
      ['dolt_diff_stat', "select count(*) as c from dolt_diff_stat('abc', 'abc', 'dolt_nonlocal_tables')"],
      ['dolt_diff_summary, en majuscules et entre accents graves', "select * from `DOLT_DIFF_SUMMARY`('abc', 'HEAD')"],
      // `lower` : la comparaison de `to_table_name` sans tenir compte de la casse (bdesk-38k.74 round 3, R1).
      ['lower', "select count(*) as c from dolt_schema_diff('abc', 'WORKING') s where lower(s.to_table_name) = 'dolt_nonlocal_tables'"],
    ])('laisse passer l’appel de la liste blanche : %s', (_label, sql) => {
      expect(() => assertReadOnly(sql)).not.toThrow();
    });

    // bdesk-38k.74 round 3, R4 : la raison du refus énumérait cinq fonctions, codées en dur, alors que la liste blanche en porte neuf (quatre ont été ajoutées depuis).
    it('la raison du refus énumère toute la liste blanche actuelle, pas un texte figé (R4)', () => {
      const error = (() => {
        try {
          assertReadOnly('select inconnue() as x');
        } catch (err) {
          return err as Error;
        }
      })();
      for (const name of ['database', 'hashof', 'lag', 'count', 'sleep', 'lower', 'dolt_log', 'dolt_schema_diff', 'dolt_diff_summary', 'dolt_diff_stat']) {
        expect(error?.message, name).toContain(name);
      }
    });

    // La parenthèse après un mot de structure n'est pas un appel : `in (…)`, `as (…)`, `over (…)`, `and (…)`, `join (…)`… Aucune de ces requêtes n'appelle de fonction.
    it.each<[string, string]>([
      ['in', "select * from issues as of 'HEAD' where id in ('a', 'b')"],
      ['and et or', 'select * from t where a = 1 and (b = 2 or c = 3)'],
      ['not', 'select * from t where not (a = 1)'],
      ['exists', 'select * from t where exists (select 1)'],
      ['from (sous-requête)', 'select * from (select 1 as a) t'],
      ['join (sous-requête) on (…)', 'select * from t join (select 1 as a) u on (t.a = u.a)'],
      ['case, when, then, else', 'select case when (a = 1) then (2) else (3) end from t'],
      ['union (…)', 'select 1 union (select 2)'],
      ['between', 'select * from t where a between (1) and (2)'],
      ['over (…) après une fonction', 'select count(*) over (partition by a) from t'],
      ['any, some, all', 'select * from t where a > all (select 1) and b = any (select 2)'],
      ['order by (…)', 'select * from t order by (a)'],
      ['where, having', 'select a from t where (a = 1) group by a having (a > 1)'],
      ['or, xor', 'select * from t where a = 1 or (b = 2) xor (c = 3)'],
      ['some', 'select * from t where a = some (select 1)'],
      ['distinct', 'select distinct (a) from t'],
      ['using', 'select * from t join u using (a)'],
      ['intersect et except', 'select 1 intersect (select 1) except (select 2)'],
      ['case (…) when', 'select case (a) when 1 then 2 end from t'],
      ['partition (…)', 'select * from t partition (p0)'],
    ])('laisse passer la parenthèse d’un mot de structure : %s', (_label, sql) => {
      expect(() => assertReadOnly(sql)).not.toThrow();
    });

    // La liste de colonnes d'une requête commune suit un nom : ce n'est pas un appel (history.ts écrit `with recursive lineage (commit_hash, seq) as (…)`).
    it.each<[string, string]>([
      ['une liste', 'with a (x) as (select 1) select * from a'],
      ['deux colonnes', 'with a (x, y) as (select 1, 2) select * from a'],
      ['WITH RECURSIVE, comme history.ts', "with recursive lineage (commit_hash, seq) as (select hashof('HEAD'), 0 union all select a.parent_hash, lineage.seq + 1 from lineage join dolt_commit_ancestors a on a.commit_hash = lineage.commit_hash and a.parent_index = 0 where a.parent_hash is not null) select * from lineage"],
      ['plusieurs requêtes communes, chacune avec sa liste', 'with a (x) as (select 1), b (y, z) as (select 2, 3), c as (select 4) select * from a, b, c'],
      ['un nom entre accents graves', 'with `a` (x) as (select 1) select * from `a`'],
      ['un WITH imbriqué dans un FROM', 'select * from (with a (x) as (select 1) select x from a) t'],
      ['un WITH imbriqué dans le corps d’une requête commune', 'with a (x) as (with b (y) as (select 1) select y from b) select * from a'],
      ['une liste dont le nom est écrit en majuscules', 'WITH A (X) AS (SELECT 1) SELECT * FROM A'],
    ])('laisse passer la liste de colonnes d’une requête commune : %s', (_label, sql) => {
      expect(() => assertReadOnly(sql)).not.toThrow();
    });

    // Ce qui ressemble à une liste de colonnes sans en être une reste un appel, donc refusé : la liste ne peut contenir que des noms séparés par des virgules.
    it.each<[string, string]>([
      ['un appel qui se glisse dans la liste', "with a (x, load_file('/x')) as (select 1) select * from a"],
      ['une liste qui n’est pas une liste de noms', "with a (select 1) select * from a"],
      ['une liste dont le premier élément n’est pas un nom', 'with a (*) as (select 1) select * from a'],
      ['une liste dont un élément n’est pas un nom', 'with a (x, *) as (select 1) select * from a'],
      ['une liste dont un élément est une chaîne', "with a (x, 'y') as (select 1, 2) select * from a"],
      ['un nom suivi d’une parenthèse hors d’un WITH', 'select a (x) as (select 1)'],
      ['une fonction après la liste d’un WITH', "with a (x) as (select 1) select sleep (1), uuid() from a"],
      ['un nom de requête commune qui est aussi une fonction, appelée plus loin', 'with uuid (x) as (select 1) select uuid(1) from uuid'],
      ['un WITH qui ne suit pas la forme (WITH ROLLUP)', 'select a from t group by a with rollup (b)'],
      ['une liste sans AS', 'with a (x) (select 1) select * from a'],
      ['une liste ouverte, jamais fermée', 'with a (x as (select 1) select * from a'],
      ['une liste jamais fermée dans un WITH imbriqué (que seule la vérification des appels voit)', 'select * from (with a (x y as (select 1) select 1 from a) t'],
    ])('refuse ce qui ressemble à une liste de colonnes sans en être une : %s', (_label, sql) => {
      expect(refusal(sql)).toBeInstanceOf(ReadOnlyViolation);
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
      ['guillemets doubles', 'select "canari"'],
      ['antislash isolé dans une chaîne', "select 'canari\\n'"],
      ['caractère que le lecteur n’écrit jamais', 'select canari @canari'],
      ['mot collé à une apostrophe', "select x'canari'"],
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
      expect((refusal("select 1 into outfile '/tmp/x'") as Error).message).toContain('« into »');
    });
  });
});
