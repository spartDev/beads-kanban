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
