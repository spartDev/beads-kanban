import { describe, expect, it } from 'vitest';
import { readsOutsideHead, tableReads } from '../testing/reads-at-head';
import { type DoltDatabase, DoltQueryError, type QueryOptions, type Row } from './client';
import {
  readComments,
  readDependencies,
  readHead,
  readIssue,
  readIssueBase,
  readIssueParts,
  readIssuePrefix,
  readIssueSummaries,
  readLabels,
  toDependency,
} from './reader';

/** Une base factice qui renvoie `rows` et garde les requêtes reçues. */
function fakeDb(rows: Row[] = []): DoltDatabase & { queries: string[] } {
  const queries: string[] = [];
  return {
    dir: '/projet/.beads/embeddeddolt/base',
    queries,
    async query(sql) {
      queries.push(sql);
      return rows;
    },
  };
}

describe('toDependency', () => {
  it('lit la cible dans depends_on_id (anciennes versions de bd)', () => {
    expect(toDependency({ issue_id: 'ac-2', depends_on_id: 'ac-1', type: 'blocks' })).toEqual({
      from: 'ac-2',
      to: 'ac-1',
      type: 'blocks',
    });
  });

  it('lit la cible dans depends_on_issue_id (versions récentes)', () => {
    expect(toDependency({ issue_id: 'sa-2', depends_on_issue_id: 'sa-1', type: 'parent-child' })).toEqual({
      from: 'sa-2',
      to: 'sa-1',
      type: 'parent-child',
    });
  });

  it('retombe sur la cible wisp ou externe quand le ticket cible est absent', () => {
    expect(toDependency({ issue_id: 'sa-2', depends_on_issue_id: '', depends_on_wisp_id: 'wisp-9', type: 'blocks' })?.to).toBe('wisp-9');
    expect(toDependency({ issue_id: 'sa-2', depends_on_external: 'external:autre:cap', type: 'blocks' })?.to).toBe('external:autre:cap');
  });

  it('préfère la cible ticket quand plusieurs colonnes sont renseignées', () => {
    expect(
      toDependency({ issue_id: 'a', depends_on_issue_id: 'b', depends_on_id: 'c', depends_on_wisp_id: 'd', type: 'blocks' })?.to,
    ).toBe('b');
  });

  it('date le lien du created_at de sa ligne, en UTC comme les autres dates Dolt', () => {
    expect(toDependency({ issue_id: 'a', depends_on_issue_id: 'b', type: 'duplicates', created_at: '2026-10-05 09:01:02' })).toEqual({
      from: 'a',
      to: 'b',
      type: 'duplicates',
      createdAt: new Date('2026-10-05T09:01:02Z'),
    });
  });

  it.each([
    ['sans created_at (les lignes de l’historique n’en lisent pas)', { issue_id: 'a', depends_on_issue_id: 'b', type: 'blocks' }],
    ['avec un created_at vide', { issue_id: 'a', depends_on_issue_id: 'b', type: 'blocks', created_at: '' }],
    ['avec un created_at illisible', { issue_id: 'a', depends_on_issue_id: 'b', type: 'blocks', created_at: 'hier soir' }],
    ['avec un created_at nul', { issue_id: 'a', depends_on_issue_id: 'b', type: 'blocks', created_at: null }],
  ])('laisse le lien sans date pour une ligne %s, sans la rejeter : un lien mal daté ne rend pas le Projet illisible', (_name, row) => {
    expect(toDependency(row)).toEqual({ from: 'a', to: 'b', type: 'blocks' });
  });

  it.each([
    ['sans aucune cible', { issue_id: 'a', type: 'blocks' }],
    ['sans ticket source', { depends_on_id: 'b', type: 'blocks' }],
    ['avec des cibles vides', { issue_id: 'a', depends_on_issue_id: '', depends_on_external: '', type: 'blocks' }],
  ])('ignore une ligne %s', (_name, row) => {
    expect(toDependency(row)).toBeNull();
  });
});

describe('lecture de l’état courant', () => {
  it('lit le préfixe dans la table config, ou null', async () => {
    expect(await readIssuePrefix(fakeDb([{ value: 'ac360' }]))).toBe('ac360');
    expect(await readIssuePrefix(fakeDb([]))).toBeNull();
  });

  it('convertit les tickets : dates en UTC, assignee vide ou absent = null, priorité numérique', async () => {
    const db = fakeDb([
      {
        id: 'xx-1',
        title: 'Un titre',
        issue_type: 'bug',
        status: 'closed',
        priority: 0,
        assignee: 'tom',
        created_at: '2026-10-19 16:46:38',
        updated_at: '2026-10-20 10:39:21',
        closed_at: '2026-10-20 10:39:21',
      },
      { id: 'xx-2', title: 'Sans assignee', issue_type: 'task', status: 'open', priority: 2, assignee: '', created_at: '2026-10-19 16:46:39', updated_at: '2026-10-19 16:46:39' },
    ]);

    const [closed, open] = await readIssueSummaries(db);

    expect(closed).toEqual({
      id: 'xx-1',
      title: 'Un titre',
      type: 'bug',
      status: 'closed',
      priority: 0,
      assignee: 'tom',
      createdAt: new Date('2026-10-19T16:46:38Z'),
      updatedAt: new Date('2026-10-20T10:39:21Z'),
      closedAt: new Date('2026-10-20T10:39:21Z'),
    });
    expect(open?.assignee).toBeNull();
    expect(open?.closedAt).toBeNull();
  });

  it('lit le ticket complet, champs texte vides compris, et renvoie null s’il n’existe pas', async () => {
    const db = fakeDb([
      { id: 'xx-1', title: 'T', description: 'd', acceptance_criteria: 'ac', issue_type: 'task', status: 'open', priority: 1, created_at: '2026-10-19 16:46:38', updated_at: '2026-10-19 16:46:38' },
    ]);

    const issue = await readIssue(db, 'xx-1');

    expect(issue).toMatchObject({ description: 'd', acceptanceCriteria: 'ac', design: '', notes: '', closeReason: '' });
    expect(await readIssue(fakeDb([]), 'xx-9')).toBeNull();
  });

  it('échappe l’identifiant du ticket dans la requête', async () => {
    const db = fakeDb([]);

    await readIssue(db, "x' or '1'='1");
    await readLabels(db, "x\\'; drop table issues; --");
    await readComments(db, "o'brien");

    expect(db.queries[0]).toContain("where id = 'x'' or ''1''=''1'");
    expect(db.queries[1]).toContain("where issue_id = 'x\\\\''; drop table issues; --'");
    expect(db.queries[2]).toContain("where issue_id = 'o''brien'");
  });

  it('normalise les dépendances courantes quel que soit le schéma', async () => {
    const db = fakeDb([
      { issue_id: 'a-2', depends_on_id: 'a-1', type: 'blocks' },
      { issue_id: 'a-3', depends_on_issue_id: 'a-1', type: 'parent-child' },
      { issue_id: 'a-4', type: 'blocks' },
    ]);

    expect(await readDependencies(db)).toEqual([
      { from: 'a-2', to: 'a-1', type: 'blocks' },
      { from: 'a-3', to: 'a-1', type: 'parent-child' },
    ]);
  });

  it('lit les étiquettes et les commentaires', async () => {
    expect(await readLabels(fakeDb([{ label: 'backend' }, { label: 'urgent' }]), 'xx-1')).toEqual(['backend', 'urgent']);
    expect(
      await readComments(fakeDb([{ author: 'tom', text: 'Salut\nle monde', created_at: '2026-10-20 12:12:28' }]), 'xx-1'),
    ).toEqual([{ author: 'tom', text: 'Salut\nle monde', createdAt: new Date('2026-10-20T12:12:28Z') }]);
  });
});

describe('l’état des tickets est celui du dernier commit (bdesk-38k.36)', () => {
  // Le working set contient en plus ce que bd n'a pas encore commité (auto-commit `batch` ou `off`), que l'historique d'où viennent
  // les métriques et la Chronologie ne voit pas : lu par le tableau, il le ferait dire autre chose qu'elles (ADR 0001). La règle est
  // celle de `readsOutsideHead`, que `history.test.ts` et `committed.integration.test.ts` appliquent à leur tour au reste du SQL.
  const TABLES = [['issues'], ['dependencies'], ['issues'], ['labels'], ['comments']];

  it('lit chaque table de tickets à l’état de HEAD, dans chacune des requêtes', async () => {
    const db = fakeDb();

    await readIssueSummaries(db);
    await readDependencies(db);
    await readIssue(db, 'xx-1');
    await readLabels(db, 'xx-1');
    await readComments(db, 'xx-1');

    expect(readsOutsideHead(db.queries)).toEqual([]);
    // Une table par requête : le filet a bien lu cinq requêtes, et rien n'est lu par ailleurs sans la clause.
    expect(db.queries.map((sql) => tableReads(sql).map(({ table }) => table))).toEqual(TABLES);
  });

  it('en fait de même des lectures groupées du tableau et de la fiche', async () => {
    const grouped = groupedDb();

    await readIssueBase(grouped.db);
    await readIssueParts(grouped.db, 'xx-1');

    const sqls = grouped.groups.flat();
    expect(readsOutsideHead(sqls)).toEqual([]);
    expect(sqls.map((sql) => tableReads(sql).map(({ table }) => table))).toEqual([['issues'], ['dependencies'], ['issues'], ['labels'], ['comments']]);
  });
});

/**
 * Derrière un `dolt sql-server`, `dolt sql -r json` rend les entiers en chaînes (`"priority":"0"`), là où la lecture directe des fichiers
 * les rend en nombres (bdesk-38k.44) : le lecteur lit les deux de même, et ne prend pas une priorité illisible pour la valeur par défaut.
 */
describe('la priorité arrive en chaîne derrière un dolt sql-server (bdesk-38k.44)', () => {
  /** La ligne d'un ticket ; sans `priority` quand elle est `undefined`, comme une colonne NULL, absente de la sortie JSON. */
  const ticket = (priority?: unknown): Row => ({
    id: 'xx-1',
    title: 'T',
    issue_type: 'task',
    status: 'open',
    ...(priority === undefined ? {} : { priority }),
    created_at: '2026-10-19 16:46:38',
    updated_at: '2026-10-19 16:46:38',
  });

  it.each([
    ['0', 0],
    ['1', 1],
    ['2', 2],
    ['3', 3],
    ['4', 4],
  ])('lit la priorité « %s » du tableau comme %i, celle que rend un nombre', async (raw, expected) => {
    const [fromString] = await readIssueSummaries(fakeDb([ticket(raw)]));
    const [fromNumber] = await readIssueSummaries(fakeDb([ticket(expected)]));

    expect(fromString?.priority).toBe(expected);
    expect(fromString).toEqual(fromNumber);
  });

  it('lit de même celle de la fiche, seule ou groupée, et celle des lectures groupées du tableau', async () => {
    const answer = (sql: string): Row[] => (sql.includes('from issues') ? [ticket('0')] : []);

    expect((await readIssue(fakeDb([ticket('0')]), 'xx-1'))?.priority).toBe(0);
    expect((await readIssueParts(groupedDb(answer).db, 'xx-1')).record?.priority).toBe(0);
    expect((await readIssueBase(groupedDb(answer).db)).summaries.map((s) => s.priority)).toEqual([0]);
  });

  it('garde 2 pour une priorité absente (NULL) : le défaut de bd, que la sortie JSON de Dolt ne donne pas', async () => {
    expect((await readIssueSummaries(fakeDb([ticket()])))[0]?.priority).toBe(2);
    expect((await readIssueSummaries(fakeDb([ticket(null)])))[0]?.priority).toBe(2);
  });

  // Une priorité qui n'est pas un entier vient d'une base qui n'a pas le format attendu : le Projet est illisible (503, avec la raison),
  // il n'est pas lu avec une priorité inventée, que rien à l'écran ne distinguerait d'un vrai P2.
  it.each(['haute', '', '2.5', ' 2', 'P2', '1e1', true, {}, 2.5])('refuse la priorité %j au lieu de la lire comme 2', async (priority) => {
    const refused = (read: Promise<unknown>) => expect(read).rejects.toThrow(/Entier Dolt invalide \(priority\)/);

    await refused(readIssueSummaries(fakeDb([ticket(priority)])));
    await refused(readIssue(fakeDb([ticket(priority)]), 'xx-1'));
    await refused(readIssueBase(groupedDb((sql) => (sql.includes('from issues') ? [ticket(priority)] : [])).db));
    await expect(readIssueSummaries(fakeDb([ticket(priority)]))).rejects.toBeInstanceOf(DoltQueryError);
  });
});

describe('readHead', () => {
  it('lit le hash du dernier commit : il change à chaque nouveau commit Dolt', async () => {
    const db = fakeDb([{ head: 'u050lk7o6a7uiav2gkh0gr3e6dl4vupt' }]);

    expect(await readHead(db)).toBe('u050lk7o6a7uiav2gkh0gr3e6dl4vupt');
    expect(db.queries).toEqual(["select hashof('HEAD') as head"]);
  });

  it('signale une base dont HEAD est illisible comme une erreur de lecture', async () => {
    await expect(readHead(fakeDb([]))).rejects.toBeInstanceOf(DoltQueryError);
  });
});

/**
 * Une base factice qui sait grouper (`queryAll`), comme le vrai client : elle répond à chaque requête par `answer`, et garde
 * les groupes reçus (une entrée par appel de `queryAll`), les requêtes seules et les options de chaque appel.
 */
function groupedDb(answer: (sql: string) => Row[] = () => []) {
  const groups: string[][] = [];
  const singles: string[] = [];
  const options: (QueryOptions | undefined)[] = [];
  const db: DoltDatabase = {
    dir: '/projet',
    async query(sql, queryOptions) {
      singles.push(sql);
      options.push(queryOptions);
      return answer(sql);
    },
    async queryAll(sqls, queryOptions) {
      groups.push([...sqls]);
      options.push(queryOptions);
      return sqls.map(answer);
    },
  };
  return { db, groups, singles, options };
}

describe('lectures légères (bdesk-38k.20)', () => {
  it('le HEAD passe par la voie légère et le préfixe par celle de la découverte : ni l’un ni l’autre ne fait la queue derrière les lectures lourdes, ni le HEAD derrière les lectures de préfixe d’un scan (bdesk-38k.28)', async () => {
    const { db, options } = groupedDb((sql) => (sql.includes('hashof') ? [{ head: 'h1' }] : [{ value: 'xx' }]));

    await readHead(db);
    await readIssuePrefix(db);

    expect(options).toEqual([{ lane: 'light' }, { lane: 'discovery' }]);
  });
});

describe('readIssueBase : ce que le kanban et toutes les fiches du Projet partagent', () => {
  const answer = (sql: string): Row[] =>
    sql.includes('from dependencies')
      ? [{ issue_id: 'xx-2', depends_on_issue_id: 'xx-1', type: 'blocks' }]
      : [{ id: 'xx-1', title: 'T', issue_type: 'task', status: 'open', priority: 1, created_at: '2026-10-19 16:46:38', updated_at: '2026-10-19 16:46:38' }];

  it('lit les résumés des tickets et les dépendances dans UN processus', async () => {
    const { db, groups, singles } = groupedDb(answer);

    const base = await readIssueBase(db);

    expect(groups).toHaveLength(1);
    expect(singles).toEqual([]);
    expect(base.summaries.map((s) => s.id)).toEqual(['xx-1']);
    expect(base.dependencies).toEqual([{ from: 'xx-2', to: 'xx-1', type: 'blocks' }]);
  });

  it('envoie les mêmes requêtes que readIssueSummaries et readDependencies', async () => {
    const grouped = groupedDb(answer);
    const single = fakeDb();

    await readIssueBase(grouped.db);
    await readIssueSummaries(single);
    await readDependencies(single);

    expect(grouped.groups[0]).toEqual(single.queries);
  });

  it('se replie sur une lecture par requête avec une base qui ne sait pas grouper', async () => {
    const db = fakeDb([]);

    expect(await readIssueBase(db)).toEqual({ summaries: [], dependencies: [] });
    expect(db.queries).toHaveLength(2);
  });
});

describe('readIssueParts : ce qui est propre à une fiche', () => {
  const answer = (sql: string): Row[] => {
    if (sql.includes('from labels')) return [{ label: 'backend' }, { label: 'urgent' }];
    if (sql.includes('from comments')) return [{ author: 'tom', text: 'Salut', created_at: '2026-10-20 12:12:28' }];
    return [{ id: 'xx-1', title: 'T', description: 'd', issue_type: 'task', status: 'open', priority: 1, created_at: '2026-10-19 16:46:38', updated_at: '2026-10-19 16:46:38' }];
  };

  it('lit le ticket, ses étiquettes et ses commentaires dans UN processus', async () => {
    const { db, groups, singles } = groupedDb(answer);

    const parts = await readIssueParts(db, 'xx-1');

    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(3);
    expect(singles).toEqual([]);
    expect(parts.record).toMatchObject({ id: 'xx-1', description: 'd', design: '' });
    expect(parts.labels).toEqual(['backend', 'urgent']);
    expect(parts.comments).toEqual([{ author: 'tom', text: 'Salut', createdAt: new Date('2026-10-20T12:12:28Z') }]);
  });

  it('rend un ticket null quand il n’existe pas, sans faire échouer les étiquettes et les commentaires', async () => {
    const { db } = groupedDb((sql) => (sql.includes('from issues') ? [] : []));

    expect(await readIssueParts(db, 'xx-9')).toEqual({ record: null, labels: [], comments: [] });
  });

  it('envoie les mêmes requêtes que readIssue, readLabels et readComments, identifiant échappé', async () => {
    const id = "x' or '1'='1";
    const grouped = groupedDb();
    const single = fakeDb();

    await readIssueParts(grouped.db, id);
    await readIssue(single, id);
    await readLabels(single, id);
    await readComments(single, id);

    expect(grouped.groups[0]).toEqual(single.queries);
    for (const sql of grouped.groups[0] ?? []) expect(sql).toContain("'x'' or ''1''=''1'");
  });

  it('se replie sur une lecture par requête avec une base qui ne sait pas grouper', async () => {
    const db = fakeDb([]);

    expect(await readIssueParts(db, 'xx-1')).toEqual({ record: null, labels: [], comments: [] });
    expect(db.queries).toHaveLength(3);
  });
});
