import { describe, expect, it } from 'vitest';
import type { Issue } from '../shared/api';
import { COLUMNS } from './columns';
import {
  descendantIds,
  epicChildren,
  epicOf,
  epicProgress,
  epicTree,
  forecastEnd,
  groupByColumn,
  MIN_DELIVERIES,
  outcomeOf,
  RECENT_DAYS,
  recentWindow,
  type TreeNode,
  youngEpicAge,
} from './epics';

const DAY = 86_400_000;
const NOW = Date.parse('2026-11-04T12:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();
/** Il y a `days` jours, comptés en durée écoulée, avant NOW. */
const ago = (days: number) => iso(NOW - days * DAY);

function ticket(id: string, overrides: Partial<Issue> = {}): Issue {
  return {
    id,
    title: `Ticket ${id}`,
    type: 'task',
    status: 'open',
    priority: 2,
    assignee: null,
    parentId: null,
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
    closedAt: null,
    blockedBy: [],
    ...overrides,
  };
}

const epic = (id = 'e', overrides: Partial<Issue> = {}) => ticket(id, { type: 'epic', ...overrides });
/** Un Enfant fermé il y a `days` jours : une Livraison. */
const delivered = (id: string, days: number, overrides: Partial<Issue> = {}) =>
  ticket(id, { status: 'closed', closedAt: ago(days), parentId: 'e', ...overrides });
const child = (id: string, overrides: Partial<Issue> = {}) => ticket(id, { parentId: 'e', ...overrides });
const ids = (tickets: readonly { id: string }[]) => tickets.map((t) => t.id);

describe('descendantIds : les Enfants d’un ticket, directs ou indirects', () => {
  const tree = [
    ticket('racine'),
    ticket('a', { parentId: 'racine' }),
    ticket('a1', { parentId: 'a' }),
    ticket('a1x', { parentId: 'a1' }),
    ticket('b', { parentId: 'racine' }),
    ticket('autre'),
    ticket('autre-1', { parentId: 'autre' }),
  ];

  it('suit les liens parent-enfant jusqu’au bout, sans la racine ni les tickets d’une autre branche', () => {
    expect([...descendantIds('racine', tree)].sort()).toEqual(['a', 'a1', 'a1x', 'b']);
    expect([...descendantIds('a', tree)].sort()).toEqual(['a1', 'a1x']);
  });

  it('est vide pour un ticket sans Enfant ou inconnu', () => {
    expect(descendantIds('b', tree).size).toBe(0);
    expect(descendantIds('inconnu', tree).size).toBe(0);
  });

  it('s’arrête sur une boucle de parentés, sans compter la racine parmi ses Enfants', () => {
    const loop = [ticket('x', { parentId: 'z' }), ticket('y', { parentId: 'x' }), ticket('z', { parentId: 'y' })];

    expect([...descendantIds('x', loop)].sort()).toEqual(['y', 'z']);
  });
});

describe('epicOf : l’Epic d’un ticket', () => {
  const issues = [
    epic('E1'),
    epic('E2', { parentId: 'E1' }),
    ticket('direct', { parentId: 'E1' }),
    ticket('task', { parentId: 'E1' }),
    ticket('subtask', { parentId: 'task' }),
    ticket('in-nested', { parentId: 'E2' }),
    ticket('under-nested', { parentId: 'in-nested' }),
    ticket('lonely'),
    ticket('lost', { parentId: 'absent' }),
    ticket('plain-parent'),
    ticket('plain-child', { parentId: 'plain-parent' }),
  ];
  const byId = new Map(issues.map((issue) => [issue.id, issue]));
  const epicIdOf = (id: string) => epicOf(byId.get(id)!, byId)?.id ?? null;

  it('est le parent quand il est de type epic', () => {
    expect(epicIdOf('direct')).toBe('E1');
  });

  it('remonte à l’Epic d’un ticket parent : un Enfant d’Enfant garde l’Epic de son parent', () => {
    expect(epicIdOf('subtask')).toBe('E1');
  });

  it('prend l’Epic la plus proche quand des Epics s’imbriquent, à tous les niveaux sous elle', () => {
    expect(epicIdOf('in-nested')).toBe('E2');
    expect(epicIdOf('under-nested')).toBe('E2');
    expect(epicIdOf('E2')).toBe('E1');
  });

  it('est absente d’une Epic sans Epic au-dessus, d’un ticket sans parent, au parent inconnu, ou sans Epic parmi ses ancêtres', () => {
    expect(epicIdOf('E1')).toBeNull();
    expect(epicIdOf('lonely')).toBeNull();
    expect(epicIdOf('lost')).toBeNull();
    expect(epicIdOf('plain-child')).toBeNull();
  });

  it('termine malgré une boucle de parentés', () => {
    const loop = new Map([ticket('a', { parentId: 'b' }), ticket('b', { parentId: 'a' })].map((issue) => [issue.id, issue]));

    expect(epicOf(loop.get('a')!, loop)).toBeNull();
  });

  it('rend le ticket même de la liste, de quoi le nommer ou l’ouvrir', () => {
    expect(epicOf(byId.get('subtask')!, byId)).toBe(byId.get('E1'));
  });

  // Le panneau d’un ticket, la pastille des cartes et le décompte de la liste des Epics s’appuient sur elle ; le filtre Epic du tableau et la
  // page Epic, sur `descendantIds` : un ticket est un Enfant de l’Epic que la première lui donne.
  it('s’accorde avec les Enfants d’une Epic (`descendantIds`) : c’est la plus proche des Epics dont le ticket descend', () => {
    const epics = issues.filter((issue) => issue.type === 'epic');
    for (const subject of issues) {
      const holders = epics.filter((candidate) => descendantIds(candidate.id, issues).has(subject.id)).map((candidate) => candidate.id);
      const own = epicIdOf(subject.id);
      if (own === null) {
        expect(holders, `les Epics de ${subject.id}`).toEqual([]);
        continue;
      }
      expect(holders, `les Epics de ${subject.id}`).toContain(own);
      // Celles dont il descend aussi contiennent la sienne : elle est la plus proche.
      for (const other of holders.filter((id) => id !== own)) {
        expect(descendantIds(other, issues).has(own), `${own} dans ${other}`).toBe(true);
      }
    }
  });
});

describe('epicChildren : ce qu’une Epic regroupe', () => {
  const issues = [
    epic(),
    child('c1'),
    child('f1', { type: 'feature' }),
    ticket('c1a', { parentId: 'f1' }),
    child('sous-epic', { type: 'epic' }),
    ticket('d1', { parentId: 'sous-epic' }),
    ticket('hors-epic'),
    epic('autre'),
    ticket('x1', { parentId: 'autre' }),
  ];

  it('compte les Enfants directs et indirects : ceux d’un Enfant et ceux d’une Epic imbriquée', () => {
    expect(ids(epicChildren('e', issues).children)).toEqual(['c1', 'f1', 'c1a', 'd1']);
  });

  it('laisse à part les Epics imbriquées : elles regroupent des Enfants, elles ne sont pas une Livraison', () => {
    expect(ids(epicChildren('e', issues).epics)).toEqual(['sous-epic']);
  });

  it('ne prend rien d’une autre Epic ni d’un ticket sans parent', () => {
    const { children, epics } = epicChildren('e', issues);

    expect([...ids(children), ...ids(epics)]).not.toContain('x1');
    expect([...ids(children), ...ids(epics)]).not.toContain('hors-epic');
    expect(epicChildren('autre', issues).children.map((t) => t.id)).toEqual(['x1']);
  });

  it('garde l’ordre des tickets reçus', () => {
    expect(ids(epicChildren('e', [...issues].reverse()).children)).toEqual(['d1', 'c1a', 'f1', 'c1']);
  });

  it('ne compte pas l’Epic elle-même, même quand une boucle de parentés la ramène à ses Enfants', () => {
    const loop = [epic('e', { parentId: 'c1' }), child('c1')];

    expect(ids(epicChildren('e', loop).children)).toEqual(['c1']);
    expect(epicChildren('e', loop).epics).toEqual([]);
  });
});

describe('outcomeOf : livré, abandonné ou pas fermé', () => {
  it('dit livré un ticket fermé sans lien d’Abandon', () => {
    expect(outcomeOf(ticket('a', { status: 'closed' }))).toBe('delivered');
  });

  it('dit abandonné un ticket fermé qui porte un Abandon, doublon ou remplacé', () => {
    expect(outcomeOf(ticket('a', { status: 'closed', abandon: { cause: 'duplicate', of: 'b' } }))).toBe('abandoned');
    expect(outcomeOf(ticket('a', { status: 'closed', abandon: { cause: 'superseded', of: 'b' } }))).toBe('abandoned');
  });

  it.each(['open', 'in_progress', 'hooked', 'blocked', 'deferred', 'pinned', ''])('dit ouvert le statut « %s »', (status) => {
    expect(outcomeOf(ticket('a', { status }))).toBe('open');
  });

  it('ne tient pas compte d’un Abandon sur un ticket qui n’est plus fermé : une Réouverture annule la Livraison, et l’Abandon', () => {
    expect(outcomeOf(ticket('a', { status: 'open', abandon: { cause: 'duplicate', of: 'b' } }))).toBe('open');
  });
});

describe('epicProgress : les Livraisons parmi les Enfants, en nombre', () => {
  it('compte les Livraisons sur les Enfants à livrer : l’avancement est livrés / (livrés + restants)', () => {
    const progress = epicProgress([
      delivered('a', 2),
      delivered('b', 3),
      child('c', { status: 'in_progress' }),
      child('d'),
      child('e2', { status: 'deferred' }),
    ]);

    expect(progress).toEqual({ children: 5, delivered: 2, abandoned: 0, remaining: 3, total: 5, ratio: 0.4 });
  });

  it('ne compte pas un Abandon comme une Livraison, ni comme du travail à livrer : il est dit à part', () => {
    const progress = epicProgress([
      delivered('a', 2),
      delivered('b', 3, { abandon: { cause: 'duplicate', of: 'a' } }),
      delivered('c', 4, { abandon: { cause: 'superseded', of: 'd' } }),
      child('d'),
    ]);

    expect(progress).toEqual({ children: 4, delivered: 1, abandoned: 2, remaining: 1, total: 2, ratio: 0.5 });
  });

  it('atteint 100 % quand tout ce qui reste à livrer l’est, des Abandons ne l’en empêchent pas', () => {
    const progress = epicProgress([delivered('a', 2), delivered('b', 3, { abandon: { cause: 'duplicate', of: 'a' } })]);

    expect(progress).toMatchObject({ delivered: 1, remaining: 0, total: 1, ratio: 1 });
  });

  it('n’a pas de rapport sans Enfant à livrer, plutôt qu’un 0 % ou un 100 % de convention', () => {
    expect(epicProgress([])).toEqual({ children: 0, delivered: 0, abandoned: 0, remaining: 0, total: 0, ratio: null });
    expect(epicProgress([delivered('a', 2, { abandon: { cause: 'duplicate', of: 'b' } })])).toMatchObject({ abandoned: 1, total: 0, ratio: null });
  });

  it('compte une Livraison sans date de clôture : l’avancement ne dépend pas de la date', () => {
    expect(epicProgress([ticket('a', { status: 'closed', closedAt: null })])).toMatchObject({ delivered: 1, ratio: 1 });
  });
});

describe('groupByColumn : les Enfants rangés par la règle de colonne du kanban et du CFD', () => {
  const children = [
    child('backlog', { blockedBy: ['x'] }),
    child('ready'),
    child('prog', { status: 'in_progress' }),
    child('agent', { status: 'hooked' }),
    child('coince', { status: 'in_progress', blockedBy: ['x'] }),
    child('statut', { status: 'blocked' }),
    delivered('livre', 3),
    delivered('doublon', 5, { abandon: { cause: 'duplicate', of: 'livre' } }),
    child('diffère', { status: 'deferred' }),
    child('épinglé', { status: 'pinned' }),
    child('inconnu', { status: 'review' }),
  ];

  it('range chaque Enfant dans la colonne que `columnFor` lui donne, et dans « En pause » quand elle n’en donne aucune', () => {
    const groups = groupByColumn(children);

    expect(ids(groups.backlog)).toEqual(['backlog']);
    expect(ids(groups.ready)).toEqual(['ready']);
    expect(ids(groups.inProgress)).toEqual(['prog', 'agent']);
    expect(ids(groups.blocked)).toEqual(['coince', 'statut']);
    expect(ids(groups.done)).toEqual(['livre', 'doublon']);
    expect(ids(groups.paused)).toEqual(['diffère', 'épinglé', 'inconnu']);
  });

  it('a une entrée par colonne, vide ou non, plus « En pause » : aucun Enfant n’est perdu', () => {
    const groups = groupByColumn([]);

    expect(Object.keys(groups).sort()).toEqual([...COLUMNS, 'paused'].sort());
    const filled = groupByColumn(children);
    expect(Object.values(filled).flat()).toHaveLength(children.length);
  });

  it('range les Abandons dans Terminé, avec les Livraisons : ils sont fermés', () => {
    expect(ids(groupByColumn(children).done)).toContain('doublon');
  });
});

describe('epicTree : l’arborescence des Enfants, à tous les niveaux', () => {
  const issues = [
    epic(),
    child('c2', { createdAt: '2026-10-03T09:00:00.000Z' }),
    child('c1', { createdAt: '2026-10-02T09:00:00.000Z' }),
    ticket('c1.b', { parentId: 'c1', createdAt: '2026-10-05T09:00:00.000Z' }),
    ticket('c1.a', { parentId: 'c1', createdAt: '2026-10-04T09:00:00.000Z' }),
    ticket('c1.a.x', { parentId: 'c1.a' }),
    child('sous-epic', { type: 'epic', createdAt: '2026-10-06T09:00:00.000Z' }),
    ticket('d1', { parentId: 'sous-epic' }),
    ticket('ailleurs'),
  ];
  const shape = (nodes: TreeNode<Issue>[]): unknown[] => nodes.map((node) => (node.children.length ? [node.ticket.id, shape(node.children)] : node.ticket.id));

  it('range chaque ticket sous son parent, à tous les niveaux, Epics imbriquées comprises', () => {
    expect(shape(epicTree('e', issues))).toEqual([['c1', [['c1.a', ['c1.a.x']], 'c1.b']], 'c2', ['sous-epic', ['d1']]]);
  });

  it('range les frères par date de création, puis par identifiant : le même ordre quel que soit celui des tickets reçus', () => {
    expect(shape(epicTree('e', [...issues].reverse()))).toEqual(shape(epicTree('e', issues)));
  });

  it('range par date de création avant l’identifiant : le premier créé vient d’abord, même si son identifiant est plus grand', () => {
    const tickets = [
      epic(),
      child('e.1', { createdAt: '2026-10-05T09:00:00.000Z' }),
      child('e.2', { createdAt: '2026-10-02T09:00:00.000Z' }),
      child('e.3', { createdAt: '2026-10-03T09:00:00.000Z' }),
    ];

    expect(shape(epicTree('e', tickets))).toEqual(['e.2', 'e.3', 'e.1']);
  });

  it('range à égalité de date selon les nombres de l’identifiant : .9 avant .10', () => {
    const same = '2026-10-02T09:00:00.000Z';
    const tickets = [epic(), child('e.10', { createdAt: same }), child('e.9', { createdAt: same }), child('e.2', { createdAt: same })];

    expect(shape(epicTree('e', tickets))).toEqual(['e.2', 'e.9', 'e.10']);
  });

  it('est vide pour une Epic sans Enfant, et ne garde aucun ticket qui n’en descend pas', () => {
    expect(epicTree('c2', issues)).toEqual([]);
    expect(JSON.stringify(epicTree('e', issues))).not.toContain('ailleurs');
  });

  it('s’arrête sur une boucle de parentés : chaque ticket n’y figure qu’une fois', () => {
    const loop = [ticket('x', { parentId: 'z' }), ticket('y', { parentId: 'x' }), ticket('z', { parentId: 'y' })];

    expect(shape(epicTree('x', loop))).toEqual([['y', ['z']]]);
  });
});

describe('recentWindow : sur quelle durée le Débit récent est mesuré', () => {
  it('prend les 28 derniers jours d’une Epic plus ancienne', () => {
    const window = recentWindow(ago(90), NOW);

    expect(RECENT_DAYS).toBe(28);
    expect(window).toEqual({ since: NOW - 28 * DAY, days: 28 });
  });

  it('commence à la création d’une Epic plus récente : avant elle, rien n’a pu être livré', () => {
    expect(recentWindow(ago(16), NOW)).toEqual({ since: NOW - 16 * DAY, days: 16 });
  });

  it('ne descend pas sous 7 jours : quelques Livraisons du premier jour ne font pas un rythme', () => {
    expect(recentWindow(ago(1), NOW)).toEqual({ since: NOW - 7 * DAY, days: 7 });
    expect(recentWindow(iso(NOW + DAY), NOW)).toEqual({ since: NOW - 7 * DAY, days: 7 });
  });

  it('retombe sur 7 jours quand la création est illisible : pas de rythme inventé sur une durée inconnue', () => {
    expect(recentWindow('pas une date', NOW)).toEqual({ since: NOW - 7 * DAY, days: 7 });
  });
});

describe('youngEpicAge : une Epic plus jeune que la fenêtre minimale du Débit récent', () => {
  const HOUR = 3_600_000;

  it('rend son âge quand elle a moins de 7 jours : la fenêtre remonte alors avant sa création', () => {
    expect(youngEpicAge(iso(NOW - 13 * HOUR), NOW)).toBe(13 * HOUR);
    expect(youngEpicAge(ago(3), NOW)).toBe(3 * DAY);
    expect(youngEpicAge(ago(7 - 1 / 24), NOW)).toBe(7 * DAY - HOUR);
    expect(youngEpicAge(iso(NOW), NOW)).toBe(0);
  });

  it('rend null à 7 jours pile et au-delà : la fenêtre ne dépasse pas la vie de l’Epic', () => {
    expect(youngEpicAge(ago(7), NOW)).toBeNull();
    expect(youngEpicAge(ago(16), NOW)).toBeNull();
    expect(youngEpicAge(ago(90), NOW)).toBeNull();
  });

  it('rend null quand la création est illisible ou à venir : on ne dit pas un âge qu’on ne connaît pas', () => {
    expect(youngEpicAge('pas une date', NOW)).toBeNull();
    expect(youngEpicAge(iso(NOW + DAY), NOW)).toBeNull();
  });

  it('s’accorde avec recentWindow : l’âge n’est rendu que si la fenêtre commence avant la création', () => {
    for (const days of [0, 0.5, 3, 6.99, 7, 7.01, 16, 90]) {
      const created = ago(days);
      const { since } = recentWindow(created, NOW);

      // Une milliseconde de marge : la fenêtre d'une Epic de 16 jours commence à sa création, au bruit des flottants près.
      expect(youngEpicAge(created, NOW) !== null, `${days} j`).toBe(since < Date.parse(created) - 1);
    }
  });
});

describe('forecastEnd : la prévision de fin d’une Epic', () => {
  /** Une Epic ouverte depuis longtemps, `shipped` Livraisons ces derniers jours (une tous les `every` jours) et `left` Enfants ouverts. */
  function scenario({ shipped, left, every = 1, epicOverrides = {} }: { shipped: number; left: number; every?: number; epicOverrides?: Partial<Issue> }) {
    const done = Array.from({ length: shipped }, (_, i) => delivered(`l${i}`, (i + 1) * every - 0.5));
    const open = Array.from({ length: left }, (_, i) => child(`o${i}`));
    return { epic: epic('e', { createdAt: ago(100), ...epicOverrides }), children: [...done, ...open] };
  }
  const forecast = (s: ReturnType<typeof scenario>) => forecastEnd(s.epic, s.children, NOW);

  it('exige au moins 4 Livraisons récentes, et la masque en dessous en disant combien il y en a', () => {
    expect(MIN_DELIVERIES).toBe(4);
    expect(forecast(scenario({ shipped: 3, left: 5 }))).toEqual({ kind: 'hidden', reason: 'low-throughput', deliveries: 3, needed: 4, days: 28 });
    expect(forecast(scenario({ shipped: 0, left: 5 }))).toEqual({ kind: 'hidden', reason: 'low-throughput', deliveries: 0, needed: 4, days: 28 });
    expect(forecast(scenario({ shipped: 4, left: 5 })).kind).toBe('range');
  });

  it('ne compte que les Livraisons de la fenêtre : celles d’avant les 28 jours ne font pas un rythme récent', () => {
    const s = scenario({ shipped: 3, left: 5 });
    s.children.push(delivered('vieille-1', 40), delivered('vieille-2', 60), delivered('juste-avant', 28.5));

    expect(forecast(s)).toMatchObject({ kind: 'hidden', reason: 'low-throughput', deliveries: 3 });
  });

  it('compte une Livraison faite à la limite de la fenêtre', () => {
    const s = scenario({ shipped: 3, left: 5 });
    s.children.push(delivered('pile', 28));

    expect(forecast(s)).toMatchObject({ kind: 'range', deliveries: 4 });
  });

  it('ne compte ni un Abandon, ni une Livraison sans date, ni un Enfant qui n’est plus fermé', () => {
    const s = scenario({ shipped: 3, left: 5 });
    s.children.push(
      delivered('abandon', 2, { abandon: { cause: 'duplicate', of: 'l0' } }),
      ticket('sans-date', { parentId: 'e', status: 'closed', closedAt: null }),
      child('rouvert', { closedAt: ago(2) }),
    );

    expect(forecast(s)).toMatchObject({ kind: 'hidden', deliveries: 3 });
  });

  it('compte une Livraison datée de l’avenir (horloges qui divergent) comme une Livraison qui vient d’avoir lieu', () => {
    const s = scenario({ shipped: 3, left: 5 });
    s.children.push(delivered('futur', -1));

    expect(forecast(s)).toMatchObject({ kind: 'range', deliveries: 4 });
  });

  it('prévoit les Enfants restants au rythme observé : restants × durée / Livraisons', () => {
    // 8 Livraisons sur 28 jours, 6 restants : 6 × 28 / 8 = 21 jours.
    const result = forecast(scenario({ shipped: 8, left: 6, every: 3 }));

    expect(result).toMatchObject({ kind: 'range', deliveries: 8, remaining: 6, days: 28 });
    expect(result.kind === 'range' && result.central / DAY).toBeCloseTo(21, 9);
  });

  it('donne une fourchette autour de cette valeur : plus ou moins la racine du nombre de Livraisons', () => {
    const result = forecast(scenario({ shipped: 9, left: 6, every: 3 }));
    if (result.kind !== 'range') throw new Error('prévision attendue');

    // 9 ± 3 Livraisons : entre 6 et 12 sur 28 jours.
    expect(result.fastest / DAY).toBeCloseTo((6 * 28) / 12, 9);
    expect(result.slowest / DAY).toBeCloseTo((6 * 28) / 6, 9);
    expect(result.fastest).toBeLessThan(result.central);
    expect(result.central).toBeLessThan(result.slowest);
  });

  it('élargit la fourchette quand les Livraisons sont peu nombreuses', () => {
    const spread = (shipped: number) => {
      const result = forecast(scenario({ shipped, left: 10, every: 28 / shipped }));
      if (result.kind !== 'range') throw new Error('prévision attendue');
      return result.slowest / result.fastest;
    };

    expect(spread(4)).toBeGreaterThan(spread(16));
    expect(spread(16)).toBeGreaterThan(spread(64));
  });

  it('date la fin à partir de maintenant', () => {
    const result = forecast(scenario({ shipped: 8, left: 6, every: 3 }));
    if (result.kind !== 'range') throw new Error('prévision attendue');

    expect(result.from).toBe(NOW + result.fastest);
    expect(result.to).toBe(NOW + result.slowest);
  });

  it('mesure le rythme depuis la création d’une Epic de 16 jours : 16 Livraisons en 16 jours, c’est une par jour', () => {
    const s = scenario({ shipped: 16, left: 6, epicOverrides: { createdAt: ago(16) } });
    const result = forecast(s);

    expect(result).toMatchObject({ kind: 'range', deliveries: 16, days: 16, remaining: 6 });
    expect(result.kind === 'range' && result.central / DAY).toBeCloseTo(6, 9);
  });

  it('ne tient pas une Epic de 2 jours pour un rythme de 2 jours : sa fenêtre est d’au moins 7 jours', () => {
    const s = scenario({ shipped: 5, left: 10, every: 0.3, epicOverrides: { createdAt: ago(2) } });
    const result = forecast(s);

    expect(result).toMatchObject({ kind: 'range', deliveries: 5, days: 7 });
    expect(result.kind === 'range' && result.central / DAY).toBeCloseTo(14, 9);
  });

  it('dit sur quelle fenêtre les Livraisons manquantes ont été comptées : celle d’une Epic jeune, pas toujours 28 jours', () => {
    const young = scenario({ shipped: 3, left: 5, every: 0.3, epicOverrides: { createdAt: ago(10) } });

    expect(forecast(young)).toEqual({ kind: 'hidden', reason: 'low-throughput', deliveries: 3, needed: 4, days: 10 });
  });

  it('est masquée pour une Epic fermée : il n’y a plus de fin à prévoir', () => {
    const s = scenario({ shipped: 8, left: 6, epicOverrides: { status: 'closed', closedAt: ago(1) } });

    expect(forecast(s)).toMatchObject({ kind: 'hidden', reason: 'epic-closed' });
  });

  it('est masquée quand il ne reste rien à livrer : tout est livré ou abandonné', () => {
    expect(forecast(scenario({ shipped: 8, left: 0 }))).toMatchObject({ kind: 'hidden', reason: 'all-delivered' });
    const withAbandon = scenario({ shipped: 8, left: 0 });
    withAbandon.children.push(delivered('abandon', 5, { abandon: { cause: 'superseded', of: 'l0' } }));
    expect(forecast(withAbandon)).toMatchObject({ kind: 'hidden', reason: 'all-delivered' });
  });

  it('est masquée pour une Epic sans Enfant', () => {
    expect(forecast(scenario({ shipped: 0, left: 0 }))).toMatchObject({ kind: 'hidden', reason: 'no-children' });
    // Des Abandons seuls ne sont pas du travail : rien à livrer, rien à prévoir.
    const onlyAbandons = { epic: epic('e'), children: [delivered('a', 3, { abandon: { cause: 'duplicate', of: 'z' } })] };
    expect(forecast(onlyAbandons)).toMatchObject({ kind: 'hidden', reason: 'no-children' });
  });

  it('compte les Enfants en pause parmi les restants : ils sont à livrer tant qu’ils ne sont pas fermés', () => {
    const s = scenario({ shipped: 8, left: 2, every: 3 });
    s.children.push(child('reporté', { status: 'deferred' }));

    expect(forecast(s)).toMatchObject({ kind: 'range', remaining: 3 });
  });

  it('ne donne jamais une durée infinie ni négative, quel que soit le nombre de Livraisons', () => {
    for (const shipped of [4, 5, 9, 30, 300]) {
      const result = forecast(scenario({ shipped, left: 7, every: 28 / shipped }));
      if (result.kind !== 'range') throw new Error('prévision attendue');
      for (const value of [result.fastest, result.central, result.slowest]) {
        expect(Number.isFinite(value) && value > 0).toBe(true);
      }
      expect(result.fastest).toBeLessThan(result.slowest);
    }
  });
});
