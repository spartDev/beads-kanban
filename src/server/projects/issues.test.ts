import { describe, expect, it } from 'vitest';
import type { DependencyRecord, IssueRecord, IssueSummary } from '../dolt/reader';
import { buildIssueDetail, buildIssues } from './issues';

function summary(id: string, status = 'open', extra: Partial<IssueSummary> = {}): IssueSummary {
  return {
    id,
    title: `Ticket ${id}`,
    type: 'task',
    status,
    priority: 2,
    assignee: null,
    createdAt: new Date('2026-10-19T16:46:38Z'),
    updatedAt: new Date('2026-10-20T10:39:21Z'),
    closedAt: status === 'closed' ? new Date('2026-10-20T10:39:21Z') : null,
    ...extra,
  };
}

const dep = (from: string, to: string, type = 'blocks'): DependencyRecord => ({ from, to, type });

describe('buildIssues', () => {
  it('expose les dates en ISO 8601 UTC et reprend les champs du ticket', () => {
    const [issue] = buildIssues([summary('p-1', 'closed', { assignee: 'tom', priority: 0, type: 'bug' })], []);

    expect(issue).toEqual({
      id: 'p-1',
      title: 'Ticket p-1',
      type: 'bug',
      status: 'closed',
      priority: 0,
      assignee: 'tom',
      parentId: null,
      createdAt: '2026-10-19T16:46:38.000Z',
      updatedAt: '2026-10-20T10:39:21.000Z',
      closedAt: '2026-10-20T10:39:21.000Z',
      blockedBy: [],
    });
  });

  it('liste en blockedBy les cibles blocks qui ne sont pas fermées', () => {
    const issues = buildIssues(
      [summary('p-1'), summary('p-2'), summary('p-3', 'in_progress'), summary('p-4', 'closed')],
      [dep('p-1', 'p-3'), dep('p-1', 'p-2'), dep('p-1', 'p-4')],
    );

    expect(issues[0]?.blockedBy).toEqual(['p-2', 'p-3']);
  });

  it('ne tient pas compte des dépendances qui ne bloquent pas', () => {
    const issues = buildIssues(
      [summary('p-1'), summary('p-2'), summary('p-3')],
      [dep('p-1', 'p-2', 'relates-to'), dep('p-1', 'p-3', 'discovered-from'), dep('p-1', 'p-2', 'parent-child')],
    );

    expect(issues[0]?.blockedBy).toEqual([]);
  });

  it('retient toujours le même parent, le plus petit identifiant, quel que soit l’ordre des liens parent-enfant', () => {
    const summaries = [summary('p-1'), summary('p-2'), summary('p-5'), summary('p-9')];
    const links = [dep('p-1', 'p-9', 'parent-child'), dep('p-1', 'p-5', 'parent-child'), dep('p-1', 'p-2', 'parent-child')];

    for (const ordered of [links, [...links].reverse(), [links[1], links[2], links[0]] as DependencyRecord[]]) {
      expect(buildIssues(summaries, ordered)[0]?.parentId).toBe('p-2');
    }
  });

  it('ne signale aucun blocage sur un ticket fermé', () => {
    const issues = buildIssues([summary('p-1', 'closed'), summary('p-2')], [dep('p-1', 'p-2')]);

    expect(issues[0]?.blockedBy).toEqual([]);
  });

  it('ignore une cible qui n’est pas un ticket du Projet (référence externe)', () => {
    const issues = buildIssues([summary('p-1')], [dep('p-1', 'external:autre:capacite'), dep('p-1', 'wisp-9')]);

    expect(issues[0]?.blockedBy).toEqual([]);
  });

  it('trouve le parent par le lien parent-child, quand le parent existe dans le Projet', () => {
    const issues = buildIssues(
      [summary('p-1', 'open', { type: 'epic' }), summary('p-1.1'), summary('p-2')],
      [dep('p-1.1', 'p-1', 'parent-child'), dep('p-2', 'p-inconnu', 'parent-child')],
    );

    expect(issues.map((i) => i.parentId)).toEqual([null, 'p-1', null]);
  });
});

describe('buildIssueDetail', () => {
  const record: IssueRecord = {
    ...summary('p-2', 'open', { assignee: 'tom' }),
    description: 'Une description',
    design: '',
    acceptanceCriteria: 'Un critère',
    notes: 'Des notes',
    closeReason: '',
  };
  const dependencies = [
    dep('p-2', 'p-1', 'parent-child'),
    dep('p-2', 'p-0'),
    dep('p-3', 'p-2'),
    dep('p-4', 'p-2', 'discovered-from'),
    dep('p-9', 'p-8'),
  ];

  it('complète le ticket avec ses textes, ses étiquettes, ses commentaires et ses dépendances dans les deux sens', () => {
    const [issue] = buildIssues([summary('p-2')], []);
    if (!issue) throw new Error('ticket attendu');

    const detail = buildIssueDetail(
      issue,
      record,
      dependencies,
      ['backend', 'urgent'],
      [{ author: 'tom', text: 'Un commentaire', createdAt: new Date('2026-10-20T12:12:28Z') }],
      new Map(),
    );

    expect(detail).toMatchObject({
      id: 'p-2',
      description: 'Une description',
      design: '',
      acceptanceCriteria: 'Un critère',
      notes: 'Des notes',
      closeReason: '',
      labels: ['backend', 'urgent'],
      comments: [{ author: 'tom', text: 'Un commentaire', createdAt: '2026-10-20T12:12:28.000Z' }],
    });
    expect(detail.dependencies).toEqual([
      { to: 'p-0', type: 'blocks' },
      { to: 'p-1', type: 'parent-child' },
    ]);
    expect(detail.dependents).toEqual([
      { from: 'p-3', type: 'blocks' },
      { from: 'p-4', type: 'discovered-from' },
    ]);
  });

  describe('linked : les tickets que la fiche nomme', () => {
    const summaries = [
      summary('p-0', 'closed', { title: 'Socle', type: 'feature', priority: 1 }),
      summary('p-1', 'open', { title: 'Epic des relations', type: 'epic', priority: 0 }),
      summary('p-2'),
      summary('p-3', 'in_progress', { title: 'Attend p-2' }),
      summary('p-4', 'open', { title: 'Bug découvert', type: 'bug', priority: 3 }),
      summary('p-8', 'open', { title: 'Sans rapport' }),
    ];
    const detailOf = (deps: DependencyRecord[]) => {
      const all = buildIssues(summaries, deps);
      const issue = all.find((i) => i.id === 'p-2');
      if (!issue) throw new Error('ticket attendu');
      return buildIssueDetail(issue, record, deps, [], [], new Map(all.map((i) => [i.id, i])));
    };

    it('donne, par identifiant, le titre, le type, le statut et la priorité du parent, des cibles et des sources des dépendances', () => {
      const detail = detailOf([
        dep('p-2', 'p-1', 'parent-child'),
        dep('p-2', 'p-0'),
        dep('p-3', 'p-2'),
        dep('p-4', 'p-2', 'discovered-from'),
        dep('p-8', 'p-1', 'parent-child'),
      ]);

      expect(detail.linked).toEqual({
        'p-0': { id: 'p-0', title: 'Socle', type: 'feature', status: 'closed', priority: 1 },
        'p-1': { id: 'p-1', title: 'Epic des relations', type: 'epic', status: 'open', priority: 0 },
        'p-3': { id: 'p-3', title: 'Attend p-2', type: 'task', status: 'in_progress', priority: 2 },
        'p-4': { id: 'p-4', title: 'Bug découvert', type: 'bug', status: 'open', priority: 3 },
      });
    });

    it('ne nomme pas le ticket lui-même ni un ticket qui n’est pas dans le Projet', () => {
      const detail = detailOf([dep('p-2', 'external:autre-projet:x-1'), dep('p-2', 'p-2', 'related')]);

      expect(detail.linked).toEqual({});
      expect(detail.dependencies).toHaveLength(2);
    });

    it('est vide pour un ticket sans relation', () => {
      expect(detailOf([]).linked).toEqual({});
    });
  });
});
