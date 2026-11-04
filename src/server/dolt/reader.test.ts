import { describe, expect, it } from 'vitest';
import { type DoltDatabase, DoltQueryError, type Row } from './client';
import {
  readComments,
  readDependencies,
  readHead,
  readIssue,
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
