import { describe, expect, it } from 'vitest';
import { readsOutsideHead, tableReads, tablesRead } from './reads-at-head';

/**
 * La règle sert de filet à tout le SQL que le service envoie à Dolt (`committed.integration.test.ts`, `reader.test.ts`,
 * `history.test.ts`) : un filet qui laisserait passer une lecture ne vaudrait rien, ou qui en fabriquerait à partir d'un texte non plus.
 */
describe('tableReads', () => {
  it('rend chaque table lue, dans l’ordre, et dit si la clause la suit', () => {
    expect(tableReads("select * from issues as of 'HEAD' i join dependencies d on d.issue_id = i.id")).toEqual([
      { table: 'issues', atHead: true },
      { table: 'dependencies', atHead: false },
    ]);
  });

  it.each([
    ["select * from issues AS OF 'HEAD' where id = 'x'", true],
    ["select * from issues\n     as   of   'HEAD'\n where id = 'x'", true],
    ["select * from issues where id = 'x'", false],
    ["select * from issues as of 'HEAD~1'", false],
    ["select * from issues as of 'WORKING'", false],
  ])('lit la clause telle qu’elle est écrite : %j', (sql, atHead) => {
    expect(tableReads(sql)).toEqual([{ table: 'issues', atHead }]);
  });

  it('ne prend pas le texte d’une chaîne pour une lecture, ni pour la clause', () => {
    expect(tableReads("select * from issues as of 'HEAD' where title = 'from labels' or note = 'a'' join comments'")).toEqual([
      { table: 'issues', atHead: true },
    ]);
    expect(tableReads("select * from issues where title = 'x\\' from comments'")).toEqual([{ table: 'issues', atHead: false }]);
  });

  it('ne compte ni une sous-requête, ni une table de requête commune, ni la qualification d’une table', () => {
    const sql = `with recursive lineage (commit_hash, seq) as (
        select hashof('HEAD'), 0 union all select a.parent_hash, lineage.seq + 1 from lineage join dolt_commit_ancestors a on a.commit_hash = lineage.commit_hash
      ), other as (select 1)
      select id from (select h.id from dolt_history_issues h join lineage ln on ln.commit_hash = h.commit_hash join other o on true) t`;

    expect(tableReads(sql).map(({ table }) => table)).toEqual(['dolt_commit_ancestors', 'dolt_history_issues']);
    expect(tableReads('select `commit_hash` from `projet/abc123`.dolt_history_dependencies')).toEqual([{ table: 'dolt_history_dependencies', atHead: false }]);
  });

  it('ne lit rien dans une requête sans table', () => {
    expect(tableReads("select hashof('HEAD') as head")).toEqual([]);
    expect(tableReads('select database() as name')).toEqual([]);
  });
});

describe('readsOutsideHead', () => {
  it('est vide quand chaque table de tickets porte la clause, historique de Dolt et préfixe mis à part', () => {
    expect(
      readsOutsideHead([
        "select id from issues as of 'HEAD' order by id",
        "select * from dependencies as of 'HEAD'",
        'select commit_hash from dolt_log',
        'select * from dolt_history_dependencies',
        "select `value` from config where `key` = 'issue_prefix'",
        "select hashof('HEAD') as head",
      ]),
    ).toEqual([]);
  });

  it('nomme chaque lecture du working set : la table et le début de la requête', () => {
    const outside = readsOutsideHead(["select id, issue_type\n    from issues order by id", "select * from labels as of 'HEAD' l join comments c on c.issue_id = l.issue_id"]);

    expect(outside).toHaveLength(2);
    expect(outside[0]).toContain('issues');
    expect(outside[0]).toContain('select id, issue_type from issues order by id');
    expect(outside[1]).toContain('comments');
  });

  it('refuse une table qu’on ajouterait sans la clause, sans qu’il faille la nommer ici', () => {
    expect(readsOutsideHead(['select * from events'])).toHaveLength(1);
  });
});

describe('tablesRead', () => {
  it('rend les tables lues hors de Dolt, préfixe compris, une fois chacune', () => {
    expect(
      tablesRead([
        "select * from issues as of 'HEAD'",
        'select id from issues',
        "select `value` from config where `key` = 'issue_prefix'",
        'select * from dolt_history_issues h join dolt_log l on l.commit_hash = h.commit_hash',
      ]),
    ).toEqual(new Set(['issues', 'config']));
  });
});

/**
 * Les formes de lecture que le filet laissait passer (bdesk-38k.47), chacune vérifiée avec Dolt 2.5.0 : une table lue sans la clause
 * y est lue dans le working set. Aucune requête du service n'en emploie, mais un filet qui promet que l'oubli est un échec ne peut pas
 * laisser passer celle qu'une requête future emploierait.
 */
const reads = (sql: string) => tableReads(sql).map(({ table, atHead }) => `${table}${atHead ? '@HEAD' : ''}`);

describe('les jointures et les tables lues par d’autres formes que « from t » et « join t »', () => {
  it('suit la virgule du from : « from a as of HEAD i, b d » lit b dans le working set', () => {
    const sql = "select count(*) from issues as of 'HEAD' i, dependencies d where d.issue_id = i.id";

    expect(reads(sql)).toEqual(['issues@HEAD', 'dependencies']);
    expect(readsOutsideHead([sql])).toHaveLength(1);
    expect(readsOutsideHead([sql])[0]).toContain('dependencies lue sans');
  });

  it('suit chaque virgule du from, après une jointure et son on comme après un alias', () => {
    const three = "select 1 from issues as of 'HEAD' a, dependencies as of 'HEAD' b, labels as of 'HEAD' c";

    expect(reads(three)).toEqual(['issues@HEAD', 'dependencies@HEAD', 'labels@HEAD']);
    expect(readsOutsideHead([three])).toEqual([]);
    expect(reads("select 1 from issues as of 'HEAD' i join labels as of 'HEAD' l on l.issue_id = i.id, comments c")).toEqual(['issues@HEAD', 'labels@HEAD', 'comments']);
    expect(reads("select 1 from issues as of 'HEAD', issues b")).toEqual(['issues@HEAD', 'issues']); // la même table, lue deux fois
  });

  it('suit la virgule d’une sous-requête du from comme celle d’une table', () => {
    expect(reads("select 1 from issues as of 'HEAD' i, (select * from comments) c, labels as of 'HEAD' l")).toEqual(['issues@HEAD', 'comments', 'labels@HEAD']);
  });

  it('ne prend pas pour une table ce qui suit une virgule hors du from', () => {
    expect(
      reads(
        `select a, b, count(x, y), case when a in (1, 2) then 1 else 0 end from issues as of 'HEAD' i
           join labels as of 'HEAD' l using (issue_id, label) where i.id in ('a', 'b') and coalesce(i.x, i.y) > 1
           group by a, b having count(*) > 1 order by a, b desc limit 1, 2`,
      ),
    ).toEqual(['issues@HEAD', 'labels@HEAD']);
    expect(reads("select a, b from issues as of 'HEAD' union all select c, d from issues as of 'HEAD' order by 1, 2")).toEqual(['issues@HEAD', 'issues@HEAD']);
  });

  it.each([
    ['une définition de window', "select a, sum(b) over w from issues as of 'HEAD' window w as (order by a), v as (order by b)"],
    ['for update of', "select 1 from issues as of 'HEAD' i for update of i, j"],
    ['union values', "select 1, 2 from issues as of 'HEAD' union values row(1, 2), row(3, 4)"],
    ['union all values', "select 1, 2 from issues as of 'HEAD' union all values row(1, 2), row(3, 4)"],
    ['intersect values', "select 1, 2 from issues as of 'HEAD' intersect values row(1, 2), row(3, 4)"],
    ['except values', "select 1, 2 from issues as of 'HEAD' except values row(1, 2), row(3, 4)"],
    ['limit', "select 1 from issues as of 'HEAD' limit 1, 2"],
  ])('ne lit pas comme des tables les virgules qui suivent %s', (_clause, sql) => {
    expect(reads(sql)).toEqual(['issues@HEAD']);
  });

  it('lit une virgule du from après une colonne qui porte le nom d’un mot du langage : « i.group » n’est pas le group by', () => {
    const sql = "select 1 from issues as of 'HEAD' i join labels as of 'HEAD' l on i.group = l.order and i.limit = l.for, comments c";

    expect(reads(sql)).toEqual(['issues@HEAD', 'labels@HEAD', 'comments']);
    expect(readsOutsideHead([sql])).toHaveLength(1);
  });

  it.each([
    ['straight_join', "select 1 from issues as of 'HEAD' i straight_join dependencies d on d.issue_id = i.id"],
    ['natural join', "select 1 from issues as of 'HEAD' i natural join dependencies"],
    ['left outer join', "select 1 from issues as of 'HEAD' i left outer join dependencies d on d.issue_id = i.id"],
    ['cross join', "select 1 from issues as of 'HEAD' i cross join dependencies d"],
    ['une table entre parenthèses', "select 1 from issues as of 'HEAD' i join (dependencies) on 1"],
    ['un groupe de jointures entre parenthèses', "select 1 from issues as of 'HEAD' i join (labels as of 'HEAD' l join dependencies d on 1) on 1"],
    ['lateral', "select 1 from issues as of 'HEAD' i join lateral (select * from dependencies) d on 1"],
  ])('trouve la table lue sans la clause après %s', (_form, sql) => {
    expect(readsOutsideHead([sql])).toHaveLength(1);
    expect(readsOutsideHead([sql])[0]).toContain('dependencies lue sans');
  });

  it('lit une table entre parenthèses, seule ou avec sa clause, et un groupe de jointures du from', () => {
    expect(reads("select 1 from (issues as of 'HEAD')")).toEqual(['issues@HEAD']);
    expect(reads('select 1 from (issues)')).toEqual(['issues']);
    expect(reads("select 1 from ((issues as of 'HEAD' i join labels as of 'HEAD' l on 1))")).toEqual(['issues@HEAD', 'labels@HEAD']);
    expect(reads("select 1 from issues as of 'HEAD' i join (labels as of 'HEAD') on 1")).toEqual(['issues@HEAD', 'labels@HEAD']);
    expect(readsOutsideHead(["select 1 from issues as of 'HEAD' i join (labels as of 'HEAD' l join comments as of 'HEAD' c on 1) on 1"])).toEqual([]);
  });

  it('ne prend pas une sous-requête entre parenthèses pour une table', () => {
    expect(reads("select 1 from (select id from issues as of 'HEAD') t join (select 2) u on 1")).toEqual(['issues@HEAD']);
    expect(reads('select 1 from (with x as (select 1) select * from x) t')).toEqual([]);
    expect(reads("select 1 from (values row(1, 2), row(3, 4)) t, issues as of 'HEAD'")).toEqual(['issues@HEAD']);
  });

  it('lit « table t » après le corps d’une requête commune (« with x as (…) table issues »), seule, en sous-requête ou avant un union (relecture de .47)', () => {
    // Dolt 2.5.0 exécute ces requêtes et lit le working set : le jeton qui précède `table` est alors la parenthèse fermante du corps.
    expect(reads('with x as (select 1) table issues')).toEqual(['issues']);
    expect(reads('with recursive x as (select 1), y as (select 2) table labels')).toEqual(['labels']);
    expect(reads('select * from (with x as (select 1) table issues) t')).toEqual(['issues']);
    expect(reads('select count(*) from (with x as (select 1) table issues) t')).toEqual(['issues']);
    expect(reads('with x as (select 1) table issues union table labels')).toEqual(['issues', 'labels']);
    expect(readsOutsideHead(['select count(*) from (with x as (select 1) table issues) t'])).toHaveLength(1);
    expect(reads('with issues as (select 1) table issues')).toEqual([]); // le nom est celui de la requête commune, à partir de son corps refermé
    expect(reads("with x as (select 1) select * from issues as of 'HEAD' window w as (), v as ()")).toEqual(['issues@HEAD']); // une parenthèse qui ne ferme pas une requête commune n'annonce aucun « table »
  });

  it('lit « table t » (Dolt l’exécute, et lit le working set), seule, dans une sous-requête ou après un union', () => {
    expect(reads('table issues')).toEqual(['issues']);
    expect(reads('select * from (table issues) t')).toEqual(['issues']);
    expect(reads("select * from issues as of 'HEAD' union all table labels")).toEqual(['issues@HEAD', 'labels']);
    expect(reads("select * from issues as of 'HEAD'; table labels")).toEqual(['issues@HEAD', 'labels']);
    expect(readsOutsideHead(['select * from (table issues) t'])).toHaveLength(1);
    expect(reads('show create table issues')).toEqual([]); // « create table » ne lit rien
  });

  it.each(['union', 'union all', 'union distinct', 'intersect', 'except'])('lit « table t » après %s', (operator) => {
    expect(reads(`select * from issues as of 'HEAD' ${operator} table labels`)).toEqual(['issues@HEAD', 'labels']);
  });

  it('ne prend pas pour une jointure le « with » d’un group by ou d’une option', () => {
    expect(reads("select a, count(*) from issues as of 'HEAD' group by a with rollup")).toEqual(['issues@HEAD']);
    expect(reads("select a from issues as of 'HEAD' group by a with rollup having (count(*) > 1) union all select 1 from rollup")).toEqual(['issues@HEAD', 'rollup']);
    expect(reads('select 1 from (select 2 as a) t where a = 2 with check option')).toEqual([]);
  });
});

describe('une requête commune au nom d’une table', () => {
  it('lit toujours la vraie table dans son propre corps : « with issues as (select * from issues) » lit le working set', () => {
    const sql = 'with issues as (select * from issues) select * from issues';

    expect(reads(sql)).toEqual(['issues']); // celle du corps ; le « from issues » qui suit est la requête commune
    expect(readsOutsideHead([sql])).toHaveLength(1);
    expect(readsOutsideHead(["with issues as (select * from issues as of 'HEAD') select * from issues"])).toEqual([]); // au HEAD : rien à signaler
  });

  it('en fait de même d’une requête commune qui suit d’autres, récursive ou non', () => {
    expect(readsOutsideHead(['with recursive x as (select 1), dependencies as (select * from dependencies) select * from dependencies'])).toHaveLength(1);
    expect(readsOutsideHead(['with x as (select 1), labels as (select * from labels) select * from x join labels on 1'])).toHaveLength(1);
  });

  it('ne cache la table que de ce qui suit la requête commune : ni ses aînées, ni sa propre définition', () => {
    // `a` est définie avant `issues` : son corps lit la vraie table.
    expect(readsOutsideHead(['with a as (select * from issues), issues as (select 1) select * from a'])).toHaveLength(1);
    // Une requête commune d'une sous-requête n'existe plus au-dehors.
    expect(reads('select * from (with issues as (select 1) select * from issues) t, issues')).toEqual(['issues']);
    // Celle d'une requête englobante se voit dans ses sous-requêtes.
    expect(reads("with lineage as (select 1) select * from issues as of 'HEAD' where id in (select * from lineage)")).toEqual(['issues@HEAD']);
  });

  it('une requête commune écrite entre guillemets inversés est une requête commune, et le nom entre guillemets inversés n’est pas la clause', () => {
    expect(reads('with `issues` as (select 1) select * from issues, `issues`')).toEqual([]);
    expect(reads('with `issues` as (select * from issues) select * from `issues`')).toEqual(['issues']);
    expect(reads('select 1 from issues as of `HEAD`')).toEqual(['issues']); // un identifiant, non une chaîne : Dolt la lit comme une colonne
  });

  it('un window ne définit pas de requête commune : « window w as (…), v as (…) » n’annonce pas « v »', () => {
    expect(reads("with x as (select 1) select 1 from issues as of 'HEAD' window w as (order by a), v as (order by b) union all select 1 from v")).toEqual([
      'issues@HEAD',
      'v',
    ]);
  });

  it('ne cache jamais une table qualifiée : « db.issues » n’est pas la requête commune « issues »', () => {
    expect(reads('with issues as (select 1) select * from issues, tdb.issues')).toEqual(['issues']);
  });

  it('un with recursive vaut pour chacune de ses requêtes communes, pas pour la première seule', () => {
    expect(reads('with recursive a as (select 1), b (n) as (select 1 union all select n + 1 from b) select * from a, b')).toEqual([]);
    // Sans « recursive », la requête commune ne se lit pas elle-même : `from b` est une vraie table.
    expect(reads('with a as (select 1), b (n) as (select 1 union all select n + 1 from b) select * from a, b')).toEqual(['b']);
  });

  it('les requêtes communes d’une instruction ne sont pas celles de la suivante', () => {
    expect(reads('with issues as (select 1) select * from issues; select * from issues')).toEqual(['issues']);
  });

  it('la jointure par virgule d’une requête commune n’en cache pas une vraie table', () => {
    expect(reads("with lineage as (select 1) select * from issues as of 'HEAD' i, lineage, labels")).toEqual(['issues@HEAD', 'labels']);
  });

  it('une requête commune récursive ne se lit elle-même que dans sa partie récursive : celle d’avant le union est une vraie table', () => {
    expect(reads('with recursive issues as (select id from issues union all select id from issues where id > 1) select * from issues')).toEqual(['issues']);
    expect(readsOutsideHead(['with recursive issues as (select id from issues union all select id from issues) select * from issues'])).toHaveLength(1);
    // La lignée de l'historique, elle, se lit elle-même après le union all : aucune lecture.
    expect(
      reads(`with recursive lineage (commit_hash, seq) as (select hashof('HEAD'), 0 union all select a.parent_hash, lineage.seq + 1 from lineage join dolt_commit_ancestors a on a.commit_hash = lineage.commit_hash)
             select * from lineage ln join dolt_log l on l.commit_hash = ln.commit_hash`),
    ).toEqual(['dolt_commit_ancestors', 'dolt_log']);
    // Seul le union ouvre la partie récursive : une sous-requête du having, avant lui, lit la vraie table.
    expect(reads('with recursive issues as (select id from labels group by id having id in (select id from issues) union all select id from issues) select * from issues')).toEqual(['labels', 'issues']);
    // Le corps d'une requête commune récursive qui parenthèse ses deux parties : le union est toujours celui du corps.
    expect(reads('with recursive r (n) as ((select 1) union all (select n + 1 from r)) select * from r')).toEqual([]);
  });
});

describe('les tables de Dolt que le filet laisse lire : celles de l’historique, et elles seules', () => {
  const histories = [
    'select commit_hash from dolt_log',
    'select * from DOLT_LOG',
    'select * from dolt_commit_ancestors',
    'select * from dolt_history_issues',
    'select * from dolt_history_dependencies',
    'select * from dolt_history_anything_bd_adds_later',
    'select * from `ma_base/c1`.dolt_history_dependencies',
    "select * from dolt_log('HEAD')",
  ];

  it('laisse lire dolt_log, dolt_commit_ancestors et les dolt_history_*', () => {
    expect(readsOutsideHead(histories)).toEqual([]);
    expect(tablesRead(histories)).toEqual(new Set());
  });

  it.each([
    ['dolt_status', 'select * from dolt_status'],
    ['dolt_diff_issues', "select * from dolt_diff_issues where to_commit = 'WORKING'"],
    ['dolt_diff', "select * from dolt_diff('HEAD', 'WORKING', 'issues')"],
    ['dolt_diff_summary', "select * from dolt_diff_summary('HEAD', 'WORKING')"],
    ['dolt_workspace_issues', 'select * from dolt_workspace_issues'],
    ['dolt_commit_diff_issues', "select * from dolt_commit_diff_issues where to_commit = 'WORKING' and from_commit = 'HEAD'"],
    ['dolt_conflicts', 'select * from dolt_conflicts'],
    ['dolt_branches', 'select * from dolt_branches'],
    ['dolt_commits', 'select * from dolt_commits'],
    ['dolt_history', 'select * from dolt_history'], // « dolt_history_ » est le préfixe : sans ce qui suit, ce n'est pas une table d'historique
    ['dolt_historyissues', 'select * from dolt_historyissues'],
  ])('refuse %s, qui lit ou peut lire le working set', (table, sql) => {
    const outside = readsOutsideHead([sql]);

    expect(outside).toHaveLength(1);
    expect(outside[0]).toContain(table);
    expect(outside[0]).toContain('historique'); // le message dit ce qui est permis, pas que la clause manque
    expect(tablesRead([sql])).toEqual(new Set([table]));
  });

  it('ne s’y laisse pas prendre par la clause : une table de Dolt hors de l’historique est refusée même au HEAD', () => {
    expect(readsOutsideHead(["select * from dolt_status as of 'HEAD'"])).toHaveLength(1);
  });

  it('refuse la table de Dolt lue après une jointure de l’historique, par virgule comme par join', () => {
    expect(readsOutsideHead(['select * from dolt_log l, dolt_status s'])).toHaveLength(1);
    expect(readsOutsideHead(['select * from dolt_history_issues h join dolt_diff_issues d on d.to_id = h.id'])).toHaveLength(1);
  });

  it('garde le message de la clause pour une table de tickets', () => {
    expect(readsOutsideHead(['select * from issues'])[0]).toContain("sans « as of 'HEAD' »");
  });
});

describe('ce que le filet lit comme Dolt : commentaires, chaînes, noms qualifiés', () => {
  it('ignore le texte d’un commentaire, de ligne ou de bloc, mais lit ce qui le suit', () => {
    expect(reads("select 1 from issues as of 'HEAD' -- from labels\n")).toEqual(['issues@HEAD']);
    expect(reads("select /* from comments */ 1 from issues as of 'HEAD' # join labels\n")).toEqual(['issues@HEAD']);
    expect(reads("select 1 from issues as of 'HEAD' /*+ from dependencies */")).toEqual(['issues@HEAD']);
    expect(reads("select 1 from issues as of 'HEAD' -- une virgule, plus bas\n , labels")).toEqual(['issues@HEAD', 'labels']);
    expect(reads("select 1 from issues as of /* clause */ 'HEAD'")).toEqual(['issues@HEAD']);
  });

  it('lit « -- » collé au caractère suivant comme Dolt : un commentaire (mesuré avec Dolt 2.5.0)', () => {
    expect(reads("select 1 from issues as of 'HEAD' --, labels\n where 1")).toEqual(['issues@HEAD']);
  });

  it('lit le contenu d’un commentaire exécutable /*! … */, que Dolt exécute', () => {
    expect(reads("select 1 from issues as of 'HEAD' /*! , labels */")).toEqual(['issues@HEAD', 'labels']);
    expect(reads("select 1 from issues as of 'HEAD' /*!50000 , labels */")).toEqual(['issues@HEAD', 'labels']);
    expect(reads('select 1 from /*!50000 issues */')).toEqual(['issues']); // la version n'est pas la table
    expect(readsOutsideHead(["select 1 from issues as of 'HEAD' /*! , labels */"])).toHaveLength(1);
  });

  it('lit le nom qualifié, entre guillemets inversés ou non : la table est la dernière partie', () => {
    expect(reads("select 1 from tdb.issues as of 'HEAD'")).toEqual(['issues@HEAD']);
    expect(reads('select 1 from `tdb`.`issues`')).toEqual(['issues']);
    expect(reads("select 1 from `a\\`.issues as of 'HEAD'")).toEqual(['issues@HEAD']); // l'antislash n'échappe rien dans un identifiant : il se ferme à la première apostrophe inversée
    expect(reads("select 1 from `a``b`.issues as of 'HEAD'")).toEqual(['issues@HEAD']); // une apostrophe inversée doublée est une apostrophe du nom, non la fin du nom
    expect(reads('select 1 from `tdb`.`dolt``x`')).toEqual(['dolt`x']);
    expect(reads('select 1 from `a/b`.`dolt_history_issues` h, tdb.labels l')).toEqual(['dolt_history_issues', 'labels']);
  });

  it('prend « as of "HEAD" » (guillemets doubles, que Dolt lit comme une chaîne) et « as of \'head\' » pour la clause', () => {
    expect(reads('select 1 from issues as of "HEAD"')).toEqual(['issues@HEAD']);
    expect(reads("select 1 from issues as of 'head', labels as of 'Head'")).toEqual(['issues@HEAD', 'labels@HEAD']);
    expect(reads("select 1 from issues as of 'HEAD~1'")).toEqual(['issues']);
    expect(reads('select 1 from issues as of "WORKING"')).toEqual(['issues']);
  });

  it.each([
    ['sans as', "select 1 from issues of 'HEAD'"],
    ['sans as, après un alias', "select 1 from issues i of 'HEAD'"],
    ['sans of', "select 1 from issues as 'HEAD'"],
    ['sans of, après un alias', "select 1 from issues as i 'HEAD'"],
    ['sans chaîne', 'select 1 from issues as of head'],
    ['sans rien après', 'select 1 from issues as of'],
  ])('ne prend pour la clause que « as of \'HEAD\' » entière : %s', (_form, sql) => {
    expect(reads(sql)).toEqual(['issues']);
  });

  it('ne lit pas la clause là où elle n’est pas : après l’alias, sur une autre table, dans une chaîne', () => {
    expect(reads("select 1 from issues i as of 'HEAD'")).toEqual(['issues']); // Dolt refuse cette syntaxe : la clause suit la table
    expect(reads("select 1 from issues join labels as of 'HEAD' on 1")).toEqual(['issues', 'labels@HEAD']);
    expect(reads("select 1 from issues as i where 'x' = 'as of ''HEAD'''")).toEqual(['issues']);
  });

  it('tient une requête qui ne finit pas, une parenthèse en trop et plusieurs instructions sans se tromper', () => {
    expect(reads("select 1 from issues as of 'HEAD' where title = 'ouverte")).toEqual(['issues@HEAD']);
    expect(reads("select 1 from issues as of 'HEAD') , labels")).toEqual(['issues@HEAD', 'labels']); // une parenthèse fermante en trop : on lit la suite comme le from, dans le doute
    expect(reads("select 1 from issues as of 'HEAD'; select 2 from labels; select 3 from comments as of 'HEAD'")).toEqual(['issues@HEAD', 'labels', 'comments@HEAD']);
    expect(reads("select 1 from issues as of 'HEAD'; select a, b from labels as of 'HEAD'")).toEqual(['issues@HEAD', 'labels@HEAD']); // la virgule de la deuxième n'est pas celle du from de la première
    expect(reads('select 1 from')).toEqual([]);
    expect(reads('')).toEqual([]);
  });
});
