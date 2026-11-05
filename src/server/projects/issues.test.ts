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
/** Un lien dont la ligne dit quand il a été posé (`created_at`). */
const placed = (from: string, to: string, type: string, iso: string): DependencyRecord => ({ ...dep(from, to, type), createdAt: new Date(`${iso}Z`) });

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

describe('buildIssues : l’Abandon d’un ticket fermé', () => {
  /** Un ticket fermé, qui porte `links` (liens posés par `bd duplicate` / `bd supersede` : sur le ticket abandonné lui-même). */
  const abandoned = (links: DependencyRecord[], extra: Partial<IssueSummary> = {}) =>
    buildIssues([summary('p-1', 'closed', extra), summary('p-2'), summary('p-3')], links)[0];

  it('est un doublon quand un lien duplicates actif part du ticket fermé', () => {
    expect(abandoned([dep('p-1', 'p-2', 'duplicates')])?.abandon).toEqual({ cause: 'duplicate', of: 'p-2' });
  });

  it('est remplacé quand un lien supersedes actif part du ticket fermé', () => {
    expect(abandoned([dep('p-1', 'p-2', 'supersedes')])?.abandon).toEqual({ cause: 'superseded', of: 'p-2' });
  });

  it('n’existe pas pour une Livraison : un ticket fermé sans lien d’Abandon n’a pas de propriété abandon', () => {
    const [issue] = buildIssues([summary('p-1', 'closed')], []);

    expect(issue).not.toHaveProperty('abandon');
  });

  it('ne tient pas compte des autres liens : bloque, parent, lié à, découvert à partir de', () => {
    const links = ['blocks', 'parent-child', 'relates-to', 'related', 'discovered-from', 'waits-for'].map((type) => dep('p-1', 'p-2', type));

    expect(abandoned(links)).not.toHaveProperty('abandon');
  });

  it('ne vient que du ticket abandonné : celui qu’un autre ticket duplique ou remplace est la cible, pas un Abandon', () => {
    const [target] = buildIssues([summary('p-1', 'closed'), summary('p-2', 'closed')], [dep('p-2', 'p-1', 'duplicates'), dep('p-2', 'p-1', 'supersedes')]);

    expect(target).not.toHaveProperty('abandon');
  });

  it('exige que le ticket soit fermé : un ticket rouvert garde son lien mais n’est plus un Abandon', () => {
    for (const status of ['open', 'in_progress', 'hooked', 'blocked', 'deferred', 'pinned']) {
      const [issue] = buildIssues([summary('p-1', status), summary('p-2')], [dep('p-1', 'p-2', 'duplicates')]);
      expect(issue, status).not.toHaveProperty('abandon');
    }
  });

  it('ne fait jamais d’une Epic un Abandon : elle n’est pas une Livraison, et ne le devient pas', () => {
    expect(abandoned([dep('p-1', 'p-2', 'duplicates')], { type: 'epic' })).not.toHaveProperty('abandon');
  });

  it('reste un Abandon quand la cible n’est pas un ticket du Projet (référence externe, ticket supprimé) : la règle du domaine ne la vérifie pas', () => {
    expect(abandoned([dep('p-1', 'external:autre:p-9', 'supersedes')])?.abandon).toEqual({ cause: 'superseded', of: 'external:autre:p-9' });
    expect(abandoned([dep('p-1', 'p-disparu', 'duplicates')])?.abandon).toEqual({ cause: 'duplicate', of: 'p-disparu' });
  });

  // La règle est `abandonOf` (src/domain/abandon.ts) ; abandon-vs-flow.test.ts vérifie que les métriques disent la même chose.
  it('retient le premier lien posé quand le ticket en porte plusieurs, quel que soit l’ordre des lignes : remplacé puis doublon est un remplacé', () => {
    const superseded = placed('p-1', 'p-9', 'supersedes', '2026-10-05T09:01:00');
    const duplicate = placed('p-1', 'p-2', 'duplicates', '2026-10-05T09:02:00');

    expect(abandoned([superseded, duplicate])?.abandon).toEqual({ cause: 'superseded', of: 'p-9' });
    expect(abandoned([duplicate, superseded])?.abandon).toEqual({ cause: 'superseded', of: 'p-9' });
  });

  it('retient le premier lien posé quand le ticket en porte plusieurs, quel que soit l’ordre des lignes : doublon puis remplacé est un doublon', () => {
    const duplicate = placed('p-1', 'p-9', 'duplicates', '2026-10-05T09:01:00');
    const superseded = placed('p-1', 'p-2', 'supersedes', '2026-10-05T09:02:00');

    expect(abandoned([duplicate, superseded])?.abandon).toEqual({ cause: 'duplicate', of: 'p-9' });
    expect(abandoned([superseded, duplicate])?.abandon).toEqual({ cause: 'duplicate', of: 'p-9' });
  });

  it('départage les liens posés au même instant, ou dont la ligne ne dit pas quand, par la plus petite cible : le même choix quel que soit l’ordre des lignes', () => {
    const undated = [dep('p-1', 'p-9', 'supersedes'), dep('p-1', 'p-5', 'duplicates'), dep('p-1', 'p-2', 'duplicates'), dep('p-1', 'p-1.5', 'supersedes')];
    const sameInstant = undated.map((link) => placed(link.from, link.to, link.type, '2026-10-05T09:00:00'));

    for (const links of [undated, sameInstant]) {
      for (const ordered of [links, [...links].reverse(), [links[2], links[0], links[3], links[1]] as DependencyRecord[]]) {
        expect(abandoned(ordered)?.abandon, JSON.stringify(ordered.map((l) => l.to))).toEqual({ cause: 'superseded', of: 'p-1.5' });
      }
    }
  });

  it('lit le même Abandon dans la fiche que dans la liste, et nomme sa cible dans linked', () => {
    const summaries = [summary('p-1', 'closed'), summary('p-2', 'open', { title: 'Le ticket de référence' })];
    const links = [dep('p-1', 'p-2', 'duplicates')];
    const all = buildIssues(summaries, links);
    const issue = all[0];
    if (!issue) throw new Error('ticket attendu');

    const detail = buildIssueDetail(issue, { ...summary('p-1', 'closed'), description: '', design: '', acceptanceCriteria: '', notes: '', closeReason: '' }, links, [], [], new Map(all.map((i) => [i.id, i])));

    expect(detail.abandon).toEqual({ cause: 'duplicate', of: 'p-2' });
    expect(detail.linked['p-2']).toMatchObject({ id: 'p-2', title: 'Le ticket de référence' });
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

  describe('epic : l’Epic du ticket, nommée par la fiche (bdesk-38k.29)', () => {
    const summaries = [
      summary('e-1', 'open', { title: 'Epic racine', type: 'epic' }),
      summary('e-2', 'open', { title: 'Epic imbriquée', type: 'epic' }),
      summary('a', 'open', { title: 'Enfant direct' }),
      summary('a-1', 'open', { title: 'Petit-enfant' }),
      summary('a-1x', 'open', { title: 'Arrière-petit-enfant' }),
      summary('b', 'open', { title: 'Enfant direct de l’Epic imbriquée' }),
      summary('b-1', 'open', { title: 'Petit-enfant sous l’Epic imbriquée' }),
      summary('n', 'open', { title: 'Chantier hors Epic' }),
      summary('n-1', 'open', { title: 'Sous-chantier hors Epic' }),
      summary('l-1'),
      summary('l-2'),
    ];
    const child = (from: string, to: string) => dep(from, to, 'parent-child');
    const links = [
      child('e-2', 'e-1'),
      child('a', 'e-1'),
      child('a-1', 'a'),
      child('a-1x', 'a-1'),
      child('b', 'e-2'),
      child('b-1', 'b'),
      child('n-1', 'n'),
      child('l-1', 'l-2'),
      child('l-2', 'l-1'),
    ];
    /** La fiche d'un ticket, construite comme le fait le service : les tickets du Projet par identifiant (`known`) sont ceux de la liste. */
    const detailOf = (id: string, deps: DependencyRecord[] = links) => {
      const all = buildIssues(summaries, deps);
      const issue = all.find((i) => i.id === id);
      if (!issue) throw new Error('ticket attendu');
      const record: IssueRecord = { ...summary(id), description: '', design: '', acceptanceCriteria: '', notes: '', closeReason: '' };
      return buildIssueDetail(issue, record, deps, [], [], new Map(all.map((i) => [i.id, i])));
    };

    it('nomme l’Epic parent d’un Enfant direct : son identifiant et son titre', () => {
      expect(detailOf('a').epic).toEqual({ id: 'e-1', title: 'Epic racine' });
    });

    it('nomme l’Epic d’un petit-enfant et d’un arrière-petit-enfant : celle de l’Enfant dont ils descendent', () => {
      expect(detailOf('a-1').epic).toEqual({ id: 'e-1', title: 'Epic racine' });
      expect(detailOf('a-1x').epic).toEqual({ id: 'e-1', title: 'Epic racine' });
    });

    it('nomme l’Epic imbriquée la plus proche, non la racine qui la contient', () => {
      expect(detailOf('b').epic).toEqual({ id: 'e-2', title: 'Epic imbriquée' });
      expect(detailOf('b-1').epic).toEqual({ id: 'e-2', title: 'Epic imbriquée' });
    });

    it('nomme, pour une Epic imbriquée, l’Epic qui la contient ; une Epic sans Epic au-dessus n’en a pas', () => {
      expect(detailOf('e-2').epic).toEqual({ id: 'e-1', title: 'Epic racine' });
      expect(detailOf('e-1').epic).toBeNull();
    });

    it('est nulle hors de toute Epic : sans parent, sous un ticket qui n’en a pas, et quand les parents se bouclent', () => {
      expect(detailOf('n').epic).toBeNull();
      expect(detailOf('n-1').epic).toBeNull();
      expect(detailOf('l-1').epic).toBeNull();
    });

    it('est nulle quand la chaîne des parents sort du Projet : un parent qui n’est pas un de ses tickets n’en est pas un', () => {
      expect(detailOf('a-1', [child('a-1', 'a'), child('a', 'external:autre-projet:x-1')]).epic).toBeNull();
    });

    it('n’ajoute pas l’Epic à `linked` : la fiche ne nomme toujours que ce qu’elle touche, parent compris', () => {
      const detail = detailOf('a-1');

      expect(detail.epic).toEqual({ id: 'e-1', title: 'Epic racine' });
      expect(detail.linked).not.toHaveProperty('e-1');
      expect(detail.linked['a']).toMatchObject({ id: 'a', title: 'Enfant direct' });
    });
  });
});
