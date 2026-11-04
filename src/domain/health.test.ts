import { describe, expect, it } from 'vitest';
import type { MetricsHealth } from '../shared/api';
import type { PeriodSpec } from './calendar';
import type { DependencyHistory } from './flow';
import { computeHealth, STAGNANT_READY_AFTER } from './health';
import { analyzeProject, type MetricsTicket } from './metrics';
import { CLOCKS, clockWentBack, randomHistories, seededRandom } from './testing/random-histories';

/**
 * La santé du flux : Efficacité du flux, Taux de Réouverture, Taux d'abandon, décomposition du Lead Time (avec l'Attente
 * de dépendance), âge des Prêts qui stagnent et carte d'activité. Les historiques sont fictifs et les attendus calculés à
 * la main : chaque scénario dit les durées qu'il fabrique.
 */

const PARIS = 'Europe/Paris';
/** Vendredi 23 octobre 2026, 20:00 à Paris (UTC+2 : l'heure d'hiver revient le dimanche 25). */
const NOW = new Date('2026-10-23T18:00:00Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const at = (iso: string) => new Date(`${iso}Z`);

/**
 * Période passée du 19 au 21 octobre : de 22:00Z le 18 à 22:00Z le 21, 72 heures, évaluée à sa fin (`asOf`).
 * La période précédente, de même durée : de 22:00Z le 15 à 22:00Z le 18.
 */
const PAST: PeriodSpec = { from: '2026-10-19', to: '2026-10-21' };
const PAST_END = at('2026-10-21T22:00:00').getTime();

function ticket(id: string, statuses: [string, string][], extra: Partial<MetricsTicket> = {}): MetricsTicket {
  return {
    id,
    title: `Titre de ${id}`,
    type: 'task',
    priority: 2,
    statusSnapshots: statuses.map(([status, iso]) => ({ status, at: at(iso) })),
    dependencies: [],
    ...extra,
  };
}

/** Créé puis fermé : une Livraison (sauf Epic ou Abandon), jamais démarrée. */
const closed = (id: string, created: string, closedAt: string, extra: Partial<MetricsTicket> = {}) =>
  ticket(
    id,
    [
      ['open', created],
      ['closed', closedAt],
    ],
    extra,
  );

/** Créé, démarré, fermé. */
const worked = (id: string, created: string, started: string, closedAt: string, extra: Partial<MetricsTicket> = {}) =>
  ticket(
    id,
    [
      ['open', created],
      ['in_progress', started],
      ['closed', closedAt],
    ],
    extra,
  );

const opened = (id: string, created: string, extra: Partial<MetricsTicket> = {}) => ticket(id, [['open', created]], extra);

/** Dépendance bloquante sur `target`, posée à `added` et retirée à `removed` (jamais, par défaut). */
const blocks = (target: string, added: string, removed?: string): DependencyHistory => ({
  type: 'blocks',
  target,
  addedAt: at(added),
  ...(removed ? { removedAt: at(removed) } : {}),
});

/** Lien posé par `bd duplicate` (doublon) ou `bd supersede` (remplacé) sur le ticket abandonné lui-même. */
const abandonLink = (type: 'duplicates' | 'supersedes', target: string, added: string): DependencyHistory => ({ type, target, addedAt: at(added) });

interface Options {
  period?: PeriodSpec;
  now?: Date;
  timeZone?: string;
}

/** La santé d'un Projet, sur la période passée par défaut. */
function healthOf(tickets: MetricsTicket[], { period = PAST, now = NOW, timeZone = PARIS }: Options = {}): MetricsHealth {
  return computeHealth([{ id: 'p', name: 'Projet P', analysis: analyzeProject(tickets) }], { period, now, timeZone });
}

/** La santé de plusieurs Projets, dans l'ordre donné. */
function healthOfProjects(projects: Record<string, MetricsTicket[]>, { period = PAST, now = NOW, timeZone = PARIS }: Options = {}): MetricsHealth {
  return computeHealth(
    Object.entries(projects).map(([id, tickets]) => ({ id, name: `Nom de ${id}`, analysis: analyzeProject(tickets) })),
    { period, now, timeZone },
  );
}

/** Une durée interpolée (à 0,001 ms près) : `2.7 * HOUR` n'est pas exactement le résultat de l'interpolation en flottant. */
const closeTo = (ms: number) => expect.closeTo(ms, 3);

describe('Efficacité du flux : la part du Cycle Time hors Blocage', () => {
  /**
   * `d` est livré à 12:00 le 19. `w`, créé à 08:00, est démarré à 10:00 et fermé le 20 à 10:00 : 24 h de Cycle Time. Il
   * dépend de `d` depuis 09:00 : de 10:00, son démarrage, à 12:00, la fermeture de `d`, il est en Blocage pendant son
   * travail, 2 h. L'efficacité de `w` est 22/24.
   */
  const blockedWork = () => [
    closed('d', '2026-10-19T08:00', '2026-10-19T12:00'),
    worked('w', '2026-10-19T08:00', '2026-10-19T10:00', '2026-10-20T10:00', { dependencies: [blocks('d', '2026-10-19T09:00')] }),
  ];

  it('rend la part du Cycle Time passée hors Blocage, dérivé des dépendances et non du statut', () => {
    const { efficiency } = healthOf(blockedWork());

    expect(efficiency).toMatchObject({ n: 1, cycleTime: 24 * HOUR, blockedTime: 2 * HOUR, blockedDeliveries: 1 });
    expect(efficiency.ratio).toBe((24 * HOUR - 2 * HOUR) / (24 * HOUR));
  });

  it('vaut 1 quand le travail n’a jamais été bloqué', () => {
    const { efficiency } = healthOf([worked('a', '2026-10-19T08:00', '2026-10-19T10:00', '2026-10-19T14:00')]);

    expect(efficiency).toMatchObject({ n: 1, cycleTime: 4 * HOUR, blockedTime: 0, ratio: 1, blockedDeliveries: 0 });
  });

  it('compte aussi le statut bloqué comme du Blocage : il est du travail, et il est bloqué', () => {
    // 10 h de Cycle Time dont 5 h au statut bloqué.
    const blockedStatus = ticket('a', [
      ['open', '2026-10-18T23:00'],
      ['in_progress', '2026-10-19T00:00'],
      ['blocked', '2026-10-19T02:30'],
      ['in_progress', '2026-10-19T07:30'],
      ['closed', '2026-10-19T10:00'],
    ]);

    const { efficiency } = healthOf([blockedStatus]);

    expect(efficiency).toMatchObject({ n: 1, cycleTime: 10 * HOUR, blockedTime: 5 * HOUR, ratio: 0.5, blockedDeliveries: 1 });
  });

  it('pèse chaque Livraison de son Cycle Time : un quotient de sommes, jamais la moyenne des efficacités', () => {
    // A : 10 h dont 5 h bloquées (50 %). B : 90 h sans Blocage (100 %). La moyenne des deux ferait 75 % ; le temps dit 95 %.
    const a = ticket('a', [
      ['open', '2026-10-18T23:00'],
      ['in_progress', '2026-10-19T00:00'],
      ['blocked', '2026-10-19T02:30'],
      ['in_progress', '2026-10-19T07:30'],
      ['closed', '2026-10-19T10:00'],
    ]);
    const b = worked('b', '2026-10-17T08:00', '2026-10-17T10:00', '2026-10-21T04:00');

    const { efficiency } = healthOf([a, b]);

    expect(efficiency).toMatchObject({ n: 2, cycleTime: 100 * HOUR, blockedTime: 5 * HOUR, ratio: 0.95, blockedDeliveries: 1 });
  });

  it('ne mesure que les Livraisons démarrées : ni un ticket jamais démarré, ni un Abandon, ni un ticket encore ouvert', () => {
    const neverStarted = closed('n', '2026-10-19T08:00', '2026-10-19T09:00');
    const abandoned = worked('x', '2026-10-19T08:00', '2026-10-19T09:00', '2026-10-19T13:00', {
      dependencies: [abandonLink('duplicates', 'n', '2026-10-19T13:00')],
    });
    const stillWorking = ticket('o', [
      ['open', '2026-10-19T08:00'],
      ['in_progress', '2026-10-19T09:00'],
    ]);
    const delivered = worked('a', '2026-10-19T08:00', '2026-10-19T10:00', '2026-10-19T12:00');

    const { efficiency } = healthOf([neverStarted, abandoned, stillWorking, delivered]);

    expect(efficiency).toMatchObject({ n: 1, cycleTime: 2 * HOUR, blockedTime: 0, ratio: 1 });
  });

  it('compte une Livraison rouverte une seule fois, avec tout son travail, avant et après la Réouverture', () => {
    const reopened = ticket('r', [
      ['open', '2026-10-19T06:00'],
      ['in_progress', '2026-10-19T07:00'],
      ['closed', '2026-10-19T09:00'],
      ['open', '2026-10-19T12:00'],
      ['in_progress', '2026-10-19T13:00'],
      ['closed', '2026-10-19T16:00'],
    ]);

    const { efficiency } = healthOf([reopened]);

    expect(efficiency).toMatchObject({ n: 1, cycleTime: 5 * HOUR, blockedTime: 0, ratio: 1 });
  });

  it('est indéfinie sans Livraison démarrée : pas de zéro qui ferait croire à un flux sans efficacité', () => {
    const { efficiency } = healthOf([closed('n', '2026-10-19T08:00', '2026-10-19T09:00')]);

    expect(efficiency).toEqual({
      n: 0,
      cycleTime: 0,
      blockedTime: 0,
      ratio: null,
      blockedDeliveries: 0,
      trend: { previous: null, delta: null, ratio: null },
    });
  });

  it('est indéfinie quand les Livraisons démarrées n’ont aucun Cycle Time cumulé (démarrées et fermées au même instant)', () => {
    const instant = ticket('i', [
      ['open', '2026-10-19T08:00'],
      ['in_progress', '2026-10-19T10:00'],
      ['closed', '2026-10-19T10:00'],
    ]);

    const { efficiency } = healthOf([instant]);

    expect(efficiency).toMatchObject({ n: 1, cycleTime: 0, blockedTime: 0, ratio: null });
  });

  it('compare à la période précédente de même durée, en points de proportion', () => {
    // Précédente : P est fermé le 16 après 4 h de Cycle Time dont 2 h bloquées (50 %). Courante : 22/24.
    const previous = ticket('p', [
      ['open', '2026-10-15T23:00'],
      ['in_progress', '2026-10-16T00:00'],
      ['blocked', '2026-10-16T02:00'],
      ['closed', '2026-10-16T04:00'],
    ]);

    const { efficiency } = healthOf([...blockedWork(), previous]);

    const current = (24 * HOUR - 2 * HOUR) / (24 * HOUR);
    expect(efficiency.ratio).toBe(current);
    expect(efficiency.trend).toEqual({ previous: 0.5, delta: current - 0.5, ratio: (current - 0.5) / 0.5 });
  });

  it('additionne les Projets de la Vue globale : un quotient de sommes sur l’union des Livraisons', () => {
    const a = ticket('a-1', [
      ['open', '2026-10-18T23:00'],
      ['in_progress', '2026-10-19T00:00'],
      ['blocked', '2026-10-19T02:30'],
      ['in_progress', '2026-10-19T07:30'],
      ['closed', '2026-10-19T10:00'],
    ]);
    const b = worked('b-1', '2026-10-17T08:00', '2026-10-17T10:00', '2026-10-21T04:00');

    const { efficiency } = healthOfProjects({ a: [a], b: [b] });

    expect(efficiency).toMatchObject({ n: 2, cycleTime: 100 * HOUR, blockedTime: 5 * HOUR, ratio: 0.95 });
  });
});

describe('Taux de Réouverture : la part des clôtures que suit une Réouverture', () => {
  /** Créé le 19, fermé à 12:00, rouvert le 20 à 08:00, refermé à 12:00 : deux clôtures dont la première est suivie d'une Réouverture. */
  const reopenedOnce = () =>
    ticket('r', [
      ['open', '2026-10-19T08:00'],
      ['in_progress', '2026-10-19T09:00'],
      ['closed', '2026-10-19T12:00'],
      ['open', '2026-10-20T08:00'],
      ['in_progress', '2026-10-20T09:00'],
      ['closed', '2026-10-20T12:00'],
    ]);

  it('compte deux clôtures pour un ticket fermé, rouvert puis refermé, dont une seule est suivie d’une Réouverture', () => {
    const { reopening } = healthOf([reopenedOnce()]);

    expect(reopening).toMatchObject({ closures: 2, reopened: 1, rate: 0.5 });
  });

  it('rattache la Réouverture à la clôture qu’elle suit, même si elle a lieu après la période', () => {
    // Fermé le 21 à 20:00Z, dans la période (qui finit à 22:00Z) ; rouvert le 22, après elle.
    const lateReopening = ticket('l', [
      ['open', '2026-10-19T08:00'],
      ['closed', '2026-10-21T20:00'],
      ['open', '2026-10-22T08:00'],
    ]);
    const stays = closed('s', '2026-10-19T08:00', '2026-10-20T08:00');

    const { reopening } = healthOf([lateReopening, stays]);

    expect(reopening).toMatchObject({ closures: 2, reopened: 1, rate: 0.5 });
  });

  it('ne compte pas la clôture d’avant la période, ni la Réouverture qui la suit pendant la période', () => {
    // Fermé le 17 (période précédente), rouvert le 20 (période courante) : la clôture appartient à la précédente.
    const closedBefore = ticket('b', [
      ['open', '2026-10-16T08:00'],
      ['closed', '2026-10-17T08:00'],
      ['open', '2026-10-20T08:00'],
    ]);

    const { reopening } = healthOf([closedBefore]);

    expect(reopening).toMatchObject({ closures: 0, reopened: 0, rate: null });
    expect(reopening.trend).toEqual({ previous: 1, delta: null, ratio: null });
  });

  it('vaut 0 quand aucune clôture n’est suivie d’une Réouverture, et compte les Abandons parmi les clôtures', () => {
    const delivered = closed('a', '2026-10-19T08:00', '2026-10-19T12:00');
    const duplicate = closed('d', '2026-10-19T08:00', '2026-10-20T12:00', { dependencies: [abandonLink('duplicates', 'a', '2026-10-20T12:00')] });

    const { reopening } = healthOf([delivered, duplicate]);

    expect(reopening).toMatchObject({ closures: 2, reopened: 0, rate: 0 });
  });

  it('ignore les Epics : elles ne sont mesurées nulle part', () => {
    const epic = ticket(
      'e',
      [
        ['open', '2026-10-19T08:00'],
        ['closed', '2026-10-19T12:00'],
        ['open', '2026-10-20T08:00'],
      ],
      { type: 'epic' },
    );

    const { reopening } = healthOf([epic]);

    expect(reopening).toMatchObject({ closures: 0, reopened: 0, rate: null });
  });

  it('ne compte pas une clôture datée de maintenant ou après (l’horloge d’un commit en avance) : elle n’est pas encore arrivée', () => {
    const now = at('2026-10-23T18:00:00');
    const early = closed('a', '2026-10-20T08:00', '2026-10-22T10:00');
    const ahead = closed('b', '2026-10-20T08:00', '2026-10-23T18:00');
    const aheadMore = closed('c', '2026-10-20T08:00', '2026-10-23T19:00');

    const { reopening } = healthOf([early, ahead, aheadMore], { period: { range: '7d' }, now });

    expect(reopening.closures).toBe(1);
  });

  it('est indéfini sans clôture', () => {
    expect(healthOf([opened('o', '2026-10-19T08:00')]).reopening).toEqual({
      closures: 0,
      reopened: 0,
      rate: null,
      trend: { previous: null, delta: null, ratio: null },
    });
  });

  it('compare le taux à celui de la période précédente, en points de proportion', () => {
    // Précédente : deux clôtures le 16, dont une suivie d'une Réouverture (50 %). Courante : une clôture, aucune Réouverture.
    const previous = ticket('p', [
      ['open', '2026-10-15T23:00'],
      ['closed', '2026-10-16T08:00'],
      ['open', '2026-10-16T10:00'],
      ['closed', '2026-10-16T12:00'],
    ]);
    const current = closed('c', '2026-10-19T08:00', '2026-10-19T12:00');

    const { reopening } = healthOf([previous, current]);

    expect(reopening).toMatchObject({ closures: 1, reopened: 0, rate: 0 });
    expect(reopening.trend).toEqual({ previous: 0.5, delta: -0.5, ratio: -1 });
  });
});

describe('période en cours : la précédente n’est comptée que jusqu’à previousAsOf, à durée écoulée égale', () => {
  // 7 jours jusqu'à vendredi 23 octobre 18:00Z : la période court du 16 à 22:00Z à maintenant ; la précédente du 9 à 22:00Z au
  // 16 à 22:00Z, mais comptée jusqu'au 16 à 18:00Z seulement (6 j 20 h écoulés de chaque côté).
  const running = { period: { range: '7d' } as const, now: NOW };

  it('Taux d’abandon : un Abandon daté après previousAsOf, dans la précédente entière, n’y est pas encore', () => {
    const before = closed('p1', '2026-10-15T08:00', '2026-10-16T10:00');
    const after = closed('p2', '2026-10-15T08:00', '2026-10-16T20:00', { dependencies: [abandonLink('duplicates', 'p1', '2026-10-16T20:00')] });
    const current = closed('c1', '2026-10-20T08:00', '2026-10-20T12:00');

    const { abandonment } = healthOf([before, after, current], running);

    expect(abandonment.trend).toEqual({ previous: 0, delta: 0, ratio: null });
  });

  it('Taux de Réouverture : une clôture suivie d’une Réouverture, datée après previousAsOf, n’est pas encore dans la précédente', () => {
    const before = closed('p1', '2026-10-15T08:00', '2026-10-16T10:00');
    const after = ticket('p2', [
      ['open', '2026-10-15T08:00'],
      ['closed', '2026-10-16T20:00'],
      ['open', '2026-10-17T08:00'],
    ]);
    const current = closed('c1', '2026-10-20T08:00', '2026-10-20T12:00');

    const { reopening } = healthOf([before, after, current], running);

    expect(reopening.trend).toEqual({ previous: 0, delta: 0, ratio: null });
  });

  it('Efficacité du flux : une Livraison datée après previousAsOf n’entre pas dans le ratio de la précédente', () => {
    const before = worked('p1', '2026-10-15T08:00', '2026-10-16T08:00', '2026-10-16T10:00');
    const after = ticket('p2', [
      ['open', '2026-10-15T08:00'],
      ['in_progress', '2026-10-16T16:00'],
      ['blocked', '2026-10-16T17:00'],
      ['closed', '2026-10-16T21:00'],
    ]);
    const current = worked('c1', '2026-10-20T08:00', '2026-10-20T09:00', '2026-10-20T12:00');

    const { efficiency } = healthOf([before, after, current], running);

    expect(efficiency.trend).toEqual({ previous: 1, delta: 0, ratio: 0 });
  });
});

describe('Taux d’abandon : la part des Abandons parmi les tickets fermés', () => {
  it('compte les Livraisons et les Abandons parmi les tickets fermés, avec la cause de chaque Abandon', () => {
    const delivered = worked('a', '2026-10-19T08:00', '2026-10-19T09:00', '2026-10-19T12:00');
    const duplicate = closed('d', '2026-10-19T08:00', '2026-10-19T13:00', { dependencies: [abandonLink('duplicates', 'a', '2026-10-19T13:00')] });
    const replaced = closed('s', '2026-10-19T08:00', '2026-10-20T13:00', { dependencies: [abandonLink('supersedes', 'a', '2026-10-20T13:00')] });
    const wontFix = closed('w', '2026-10-19T08:00', '2026-10-20T14:00');

    const { abandonment } = healthOf([delivered, duplicate, replaced, wontFix]);

    // « Won't fix » n'est pas un Abandon : c'est une Livraison.
    expect(abandonment).toMatchObject({ closed: 4, abandoned: 2, duplicates: 1, superseded: 1, rate: 0.5 });
  });

  it('ignore les Epics fermées et les tickets encore ouverts', () => {
    const epic = ticket('e', [['open', '2026-10-19T08:00'], ['closed', '2026-10-19T12:00']], { type: 'epic' });
    const delivered = closed('a', '2026-10-19T08:00', '2026-10-19T12:00');
    const stillOpen = opened('o', '2026-10-19T08:00');

    expect(healthOf([epic, delivered, stillOpen]).abandonment).toMatchObject({ closed: 1, abandoned: 0, rate: 0 });
  });

  it('ne tient pas pour un Abandon un lien retiré : le ticket est une Livraison', () => {
    const unlinked = closed('d', '2026-10-19T08:00', '2026-10-19T13:00', {
      dependencies: [{ type: 'duplicates', target: 'a', addedAt: at('2026-10-19T09:00'), removedAt: at('2026-10-19T10:00') }],
    });

    expect(healthOf([unlinked]).abandonment).toMatchObject({ closed: 1, abandoned: 0, rate: 0 });
  });

  it('date un Abandon de sa dernière clôture, et ne compte pas un ticket rouvert depuis', () => {
    // Fermé comme doublon le 17 (période précédente), rouvert, refermé le 20 : l'Abandon est du 20. Un autre, rouvert, reste ouvert.
    const closedTwice = ticket(
      'a',
      [
        ['open', '2026-10-16T08:00'],
        ['closed', '2026-10-17T08:00'],
        ['open', '2026-10-18T08:00'],
        ['closed', '2026-10-20T08:00'],
      ],
      { dependencies: [abandonLink('duplicates', 'z', '2026-10-17T08:00')] },
    );
    const reopened = ticket(
      'b',
      [
        ['open', '2026-10-16T08:00'],
        ['closed', '2026-10-19T08:00'],
        ['open', '2026-10-20T08:00'],
      ],
      { dependencies: [abandonLink('supersedes', 'z', '2026-10-19T08:00')] },
    );

    const { abandonment } = healthOf([closedTwice, reopened]);

    expect(abandonment).toMatchObject({ closed: 1, abandoned: 1, duplicates: 1, superseded: 0, rate: 1 });
    expect(abandonment.trend.previous).toBeNull(); // rien de fermé dans la précédente : pas de taux à comparer
  });

  it('est indéfini sans ticket fermé', () => {
    expect(healthOf([opened('o', '2026-10-19T08:00')]).abandonment).toEqual({
      closed: 0,
      abandoned: 0,
      duplicates: 0,
      superseded: 0,
      rate: null,
      trend: { previous: null, delta: null, ratio: null },
    });
  });

  it('compare le taux à celui de la période précédente, en points de proportion', () => {
    // Précédente : 1 doublon sur 4 fermés (25 %). Courante : 1 sur 2 (50 %).
    const previous = [
      closed('p1', '2026-10-15T23:00', '2026-10-16T08:00'),
      closed('p2', '2026-10-15T23:00', '2026-10-16T09:00'),
      closed('p3', '2026-10-15T23:00', '2026-10-16T10:00'),
      closed('p4', '2026-10-15T23:00', '2026-10-16T11:00', { dependencies: [abandonLink('duplicates', 'p1', '2026-10-16T11:00')] }),
    ];
    const current = [
      closed('c1', '2026-10-19T08:00', '2026-10-19T12:00'),
      closed('c2', '2026-10-19T08:00', '2026-10-19T13:00', { dependencies: [abandonLink('supersedes', 'c1', '2026-10-19T13:00')] }),
    ];

    const { abandonment } = healthOf([...previous, ...current]);

    expect(abandonment).toMatchObject({ closed: 2, abandoned: 1, rate: 0.5 });
    expect(abandonment.trend).toEqual({ previous: 0.25, delta: 0.25, ratio: 1 });
  });

  it('additionne les Projets de la Vue globale', () => {
    const a = [closed('a-1', '2026-10-19T08:00', '2026-10-19T12:00'), closed('a-2', '2026-10-19T08:00', '2026-10-19T13:00', { dependencies: [abandonLink('duplicates', 'a-1', '2026-10-19T13:00')] })];
    const b = [closed('b-1', '2026-10-19T08:00', '2026-10-19T12:00'), closed('b-2', '2026-10-19T08:00', '2026-10-19T13:00')];

    expect(healthOfProjects({ a, b }).abandonment).toMatchObject({ closed: 4, abandoned: 1, rate: 0.25 });
  });
});

describe('Décomposition du Lead Time, avec l’Attente de dépendance', () => {
  /**
   * `d` : créé à 08:00, livré à 12:00 (Lead Time 4 h, tout en Attente en Prêt). `w` : créé à 08:00, dépend de `d` depuis 09:00,
   * démarré à 10:00, fermé le 20 à 10:00. Lead Time 26 h = 1 h d'Attente en Prêt (08:00-09:00) + 1 h d'Attente de dépendance
   * (09:00-10:00, Backlog avant son démarrage) + 22 h de travail + 2 h de Blocage (10:00-12:00, `d` n'est pas fermé).
   */
  const scenario = () => [
    closed('d', '2026-10-19T08:00', '2026-10-19T12:00'),
    worked('w', '2026-10-19T08:00', '2026-10-19T10:00', '2026-10-20T10:00', { dependencies: [blocks('d', '2026-10-19T09:00')] }),
  ];

  it('répartit le Lead Time cumulé des Livraisons en cinq parts qui s’additionnent', () => {
    const { leadTimeBreakdown } = healthOf(scenario());

    expect(leadTimeBreakdown).toMatchObject({
      deliveries: 2,
      total: 30 * HOUR,
      dependencyWait: 1 * HOUR,
      readyWait: 5 * HOUR,
      work: 22 * HOUR,
      blocked: 2 * HOUR,
      otherWait: 0,
    });
  });

  it('dit combien de Livraisons ont attendu une dépendance, et combien de temps (médiane et P85 de celles-là seulement)', () => {
    const { leadTimeBreakdown } = healthOf(scenario());

    expect(leadTimeBreakdown.waited).toBe(1);
    expect(leadTimeBreakdown.waits).toEqual({ median: 1 * HOUR, p85: 1 * HOUR, n: 1 });
  });

  it('interpole la médiane et le P85 des attentes comme ceux des tuiles', () => {
    // Deux tickets qui attendent 1 h et 3 h (leur bloqueur est livré 1 h, 3 h après leur création), plus un qui n'attend pas.
    const blockerOne = closed('b1', '2026-10-19T00:00', '2026-10-19T01:00');
    const blockerTwo = closed('b2', '2026-10-19T00:00', '2026-10-19T03:00');
    const waitsOne = worked('t1', '2026-10-19T00:00', '2026-10-19T05:00', '2026-10-19T08:00', { dependencies: [blocks('b1', '2026-10-19T00:00')] });
    const waitsThree = worked('t2', '2026-10-19T00:00', '2026-10-19T05:00', '2026-10-19T08:00', { dependencies: [blocks('b2', '2026-10-19T00:00')] });
    const free = worked('t3', '2026-10-19T00:00', '2026-10-19T05:00', '2026-10-19T08:00');

    const { leadTimeBreakdown } = healthOf([blockerOne, blockerTwo, waitsOne, waitsThree, free]);

    expect(leadTimeBreakdown.waited).toBe(2);
    // Rang 1 + 0,85 × (2 − 1) = 1,85 : 1 h + 0,85 × 2 h = 2,7 h.
    expect(leadTimeBreakdown.waits).toEqual({ median: 2 * HOUR, p85: closeTo(2.7 * HOUR), n: 2 });
    expect(leadTimeBreakdown.dependencyWait).toBe(4 * HOUR);
  });

  it('sépare l’Attente en Prêt (avant la clôture, après la Réouverture) de l’autre attente : le temps passé fermé avant une Réouverture', () => {
    // Lead Time 12 h (06:00 → 18:00) : 4 h de travail (14:00 → 18:00), 4 h Prêt (06:00 → 08:00, 12:00 → 14:00), 4 h fermé (08:00 → 12:00).
    const reopened = ticket('r', [
      ['open', '2026-10-19T06:00'],
      ['closed', '2026-10-19T08:00'],
      ['open', '2026-10-19T12:00'],
      ['in_progress', '2026-10-19T14:00'],
      ['closed', '2026-10-19T18:00'],
    ]);

    const { leadTimeBreakdown } = healthOf([reopened]);

    expect(leadTimeBreakdown).toMatchObject({ deliveries: 1, total: 12 * HOUR, dependencyWait: 0, readyWait: 4 * HOUR, work: 4 * HOUR, blocked: 0, otherWait: 4 * HOUR, waited: 0 });
  });

  it('range dans l’autre attente tout ce qui n’est ni Backlog avant le démarrage, ni Prêt, ni travail : Backlog après un démarrage, différé, fermé', () => {
    // `e`, Lead Time 24 h (de 00:00 à 24:00), `b` fermé à 03:00 et `b2` à 12:00 : Prêt 00:00 → 02:00 (2 h) ; Backlog avant le premier démarrage 02:00 → 03:00
    // (1 h d'Attente de dépendance, `b` n'est pas fermé) ; Prêt 03:00 → 04:00 (1 h) ; en cours 04:00 → 08:00 (4 h) ; retour à ouvert à 08:00, mais bloqué par
    // `b2` jusqu'à 12:00 : Backlog après un démarrage (4 h d'autre attente) ; Prêt 12:00 → 13:00 (1 h) ; différé 13:00 → 17:00 (4 h d'autre attente) ;
    // Prêt 17:00 → 18:00 (1 h) ; en cours 18:00 → 24:00 (6 h).
    const blockerOne = closed('b', '2026-10-19T00:00', '2026-10-19T03:00');
    const blockerTwo = closed('b2', '2026-10-19T00:00', '2026-10-19T12:00');
    const everything = ticket(
      'e',
      [
        ['open', '2026-10-19T00:00'],
        ['in_progress', '2026-10-19T04:00'],
        ['open', '2026-10-19T08:00'],
        ['deferred', '2026-10-19T13:00'],
        ['open', '2026-10-19T17:00'],
        ['in_progress', '2026-10-19T18:00'],
        ['closed', '2026-10-20T00:00'],
      ],
      { dependencies: [blocks('b', '2026-10-19T02:00'), blocks('b2', '2026-10-19T08:00')] },
    );

    const { leadTimeBreakdown } = healthOf([blockerOne, blockerTwo, everything]);

    // Avec `b` (3 h, Prêt de bout en bout) et `b2` (12 h, idem) : 39 h de Lead Time, dont 20 h Prêt (3 + 12 + 5), et 8 h d'autre attente pour `e`.
    expect(leadTimeBreakdown).toMatchObject({
      deliveries: 3,
      total: 39 * HOUR,
      dependencyWait: 1 * HOUR,
      readyWait: 20 * HOUR,
      work: 10 * HOUR,
      blocked: 0,
      otherWait: 8 * HOUR,
    });
    expect(leadTimeBreakdown.dependencyWait + leadTimeBreakdown.readyWait + leadTimeBreakdown.work + leadTimeBreakdown.blocked + leadTimeBreakdown.otherWait).toBe(
      leadTimeBreakdown.total,
    );
  });

  it('n’a pas d’Attente en Prêt pour un ticket jamais Prêt : démarré à sa création', () => {
    const started = ticket('s', [
      ['in_progress', '2026-10-19T08:00'],
      ['closed', '2026-10-19T12:00'],
    ]);

    expect(healthOf([started]).leadTimeBreakdown).toMatchObject({ deliveries: 1, total: 4 * HOUR, readyWait: 0, work: 4 * HOUR, otherWait: 0 });
  });

  it('compte l’Attente de dépendance d’une Livraison jamais démarrée : elle a attendu, puis a été fermée', () => {
    // Créé à 08:00, bloqué de 08:00 à 11:00 par `d`, fermé sans avoir été démarré à 14:00 : 3 h d'Attente de dépendance.
    const never = closed('n', '2026-10-19T08:00', '2026-10-19T14:00', { dependencies: [blocks('d', '2026-10-19T08:00')] });
    const d = closed('d', '2026-10-19T07:00', '2026-10-19T11:00');

    const { leadTimeBreakdown } = healthOf([never, d]);

    expect(leadTimeBreakdown).toMatchObject({ deliveries: 2, total: 10 * HOUR, dependencyWait: 3 * HOUR, readyWait: 7 * HOUR, work: 0, blocked: 0, otherWait: 0, waited: 1 });
  });

  it('ne compte que les Livraisons de la période : ni un Abandon, ni un ticket encore ouvert', () => {
    const abandoned = closed('x', '2026-10-19T08:00', '2026-10-19T09:00', { dependencies: [abandonLink('duplicates', 'd', '2026-10-19T09:00')] });
    const delivered = closed('d', '2026-10-19T08:00', '2026-10-19T12:00');
    const open = opened('o', '2026-10-19T08:00');

    expect(healthOf([abandoned, delivered, open]).leadTimeBreakdown).toMatchObject({ deliveries: 1, total: 4 * HOUR, readyWait: 4 * HOUR, otherWait: 0 });
  });

  it('est à zéro sans Livraison, avec des statistiques indéfinies', () => {
    expect(healthOf([opened('o', '2026-10-19T08:00')]).leadTimeBreakdown).toEqual({
      deliveries: 0,
      total: 0,
      dependencyWait: 0,
      readyWait: 0,
      work: 0,
      blocked: 0,
      otherWait: 0,
      waited: 0,
      waits: { median: null, p85: null, n: 0 },
    });
  });

  it('garde les cinq parts positives et leur somme égale au Lead Time, même quand une horloge a reculé', () => {
    // Démarré à 09:00 d'après l'horloge d'un commit, une heure avant la création (10:00) : le démarrage tombe à la création, et le
    // Cycle Time (1 h) ne dépasse pas le Lead Time (1 h). Il aurait compté 2 h (09:00 → 11:00) sans cela.
    const backwards = ticket('b', [
      ['open', '2026-10-19T10:00'],
      ['in_progress', '2026-10-19T09:00'],
      ['closed', '2026-10-19T11:00'],
    ]);

    const { leadTimeBreakdown: parts } = healthOf([backwards]);

    expect(parts).toMatchObject({ total: 1 * HOUR, dependencyWait: 0, readyWait: 0, work: 1 * HOUR, blocked: 0, otherWait: 0 });
    for (const part of [parts.dependencyWait, parts.readyWait, parts.work, parts.blocked, parts.otherWait]) expect(part).toBeGreaterThanOrEqual(0);
    expect(parts.dependencyWait + parts.readyWait + parts.work + parts.blocked + parts.otherWait).toBe(parts.total);
  });

  it('garde l’Attente de dépendance dans le Lead Time quand l’horloge d’un commit a reculé : la clôture datée avant le démarrage tombe au démarrage', () => {
    // `t` attend `b` de 10:00 à 13:00, son démarrage : 3 h de Backlog bloqué avant ce premier démarrage. Sa clôture est datée de 11:00,
    // avant lui : l'horloge de son commit a reculé. Elle tombe à 13:00, et le Lead Time (3 h) est tout entier cette attente.
    const blocker = closed('b', '2026-10-19T09:00', '2026-10-19T14:00');
    const clockBack = ticket(
      't',
      [
        ['open', '2026-10-19T10:00'],
        ['in_progress', '2026-10-19T13:00'],
        ['closed', '2026-10-19T11:00'],
      ],
      { dependencies: [blocks('b', '2026-10-19T10:00', '2026-10-19T13:00')] },
    );

    const { leadTimeBreakdown: parts } = healthOf([blocker, clockBack]);

    // Avec `b` (5 h en Prêt, jamais bloqué) : 8 h de Lead Time cumulé.
    expect(parts).toMatchObject({ deliveries: 2, total: 8 * HOUR, dependencyWait: 3 * HOUR, readyWait: 5 * HOUR, work: 0, blocked: 0, otherWait: 0, waited: 1 });
    expect(parts.dependencyWait + parts.readyWait + parts.work + parts.blocked + parts.otherWait).toBe(parts.total);
  });

  it('date la Réouverture dont l’horloge a reculé au plus tôt de la clôture précédente : le temps fermé dure 0, et le Prêt remplit le Lead Time', () => {
    // Ouvert 08:00, fermé 10:00, rouvert à 07:00 d'après l'horloge d'un commit en arrière (10:00), fermé 20:00 : Prêt de 08:00 à 20:00.
    const clockBack = ticket('c', [
      ['open', '2026-10-19T08:00'],
      ['closed', '2026-10-19T10:00'],
      ['open', '2026-10-19T07:00'],
      ['closed', '2026-10-19T20:00'],
    ]);

    const { leadTimeBreakdown: parts } = healthOf([clockBack]);

    expect(parts).toMatchObject({ total: 12 * HOUR, readyWait: 12 * HOUR, otherWait: 0 });
    expect(parts.dependencyWait + parts.readyWait + parts.work + parts.blocked + parts.otherWait).toBe(parts.total);
  });

  it('date au plus tôt de la Transition précédente le démarrage dont l’horloge a reculé : le travail ne commence pas avant la création', () => {
    // Statuts : ouvert 08:00, en cours 07:00 (l'horloge a reculé : 08:00), ouvert 09:00, fermé 12:00. Lead Time 4 h : 1 h de travail (08:00 → 09:00)
    // puis 3 h Prêt. Sans cela, le travail aurait compté 2 h (07:00 → 09:00) et le Prêt 3 h : 5 h pour un ticket qui en a duré 4.
    const clockBack = ticket('c', [
      ['open', '2026-10-19T08:00'],
      ['in_progress', '2026-10-19T07:00'],
      ['open', '2026-10-19T09:00'],
      ['closed', '2026-10-19T12:00'],
    ]);

    const { leadTimeBreakdown: parts } = healthOf([clockBack]);

    expect(parts).toMatchObject({ deliveries: 1, total: 4 * HOUR, dependencyWait: 0, work: 1 * HOUR, blocked: 0, readyWait: 3 * HOUR, otherWait: 0 });
  });

  it('date au plus tôt de la Transition précédente la clôture d’un ticket rouvert dont l’horloge a reculé : le Prêt d’avant compte, jamais celui d’après', () => {
    // Ouvert 08:00, fermé 10:00, rouvert 14:00 (Prêt jusqu'à 18:00, où il est différé), puis fermé... à 12:00 : l'horloge du dernier commit a reculé. La clôture
    // tombe à 18:00, avec la Livraison et la fin du Lead Time (10 h) : 2 h Prêt avant la première clôture, 4 h fermé (l'autre attente), puis 4 h Prêt après la
    // Réouverture. Aucun Prêt ne vient après la Livraison, qui est la dernière Transition.
    const clockBack = ticket('c', [
      ['open', '2026-10-19T08:00'],
      ['closed', '2026-10-19T10:00'],
      ['open', '2026-10-19T14:00'],
      ['deferred', '2026-10-19T18:00'],
      ['closed', '2026-10-19T12:00'],
    ]);

    const { leadTimeBreakdown: parts } = healthOf([clockBack]);

    expect(parts).toMatchObject({ deliveries: 1, total: 10 * HOUR, dependencyWait: 0, readyWait: 6 * HOUR, work: 0, blocked: 0, otherWait: 4 * HOUR });
  });

  it('additionne les cinq parts en Lead Time cumulé, et aucune n’est négative, sur des historiques tirés au hasard (horloges qui reculent comprises)', () => {
    // Une graine fixe : le même jeu à chaque exécution. 300 tickets de 2 à 7 statuts, dont certains datés avant le précédent.
    let seed = 20_261_104;
    const random = () => (seed = (seed * 1_664_525 + 1_013_904_223) % 4_294_967_296) / 4_294_967_296;
    const statuses = ['open', 'in_progress', 'blocked', 'hooked', 'deferred', 'closed'];
    const projects = Array.from({ length: 300 }, (_, index) => {
      const steps = 2 + Math.floor(random() * 6);
      const history: [string, string][] = [['open', '2026-10-19T00:00']];
      for (let step = 1; step < steps; step++) {
        const minutes = Math.floor(random() * 3 * 24 * 60) - (random() < 0.15 ? 600 : 0); // 15 % reculent de plusieurs heures
        const when = new Date(at('2026-10-19T00:00').getTime() + minutes * 60_000);
        history.push([statuses[Math.floor(random() * statuses.length)] ?? 'open', when.toISOString().slice(0, 16)]);
      }
      history.push(['closed', new Date(at('2026-10-19T00:00').getTime() + Math.floor(random() * 3 * 24 * 60) * 60_000).toISOString().slice(0, 16)]);
      const blocker = index > 0 && random() < 0.4 ? [blocks(`t${Math.floor(random() * index)}`, '2026-10-19T01:00')] : [];
      return ticket(`t${index}`, history, { dependencies: blocker });
    });

    const { leadTimeBreakdown: parts } = healthOf(projects, { period: { from: '2026-10-19', to: '2026-10-23' }, now: at('2026-10-24T12:00:00') });

    expect(parts.deliveries).toBeGreaterThan(50);
    for (const part of [parts.dependencyWait, parts.readyWait, parts.work, parts.blocked, parts.otherWait]) expect(part).toBeGreaterThanOrEqual(0);
    expect(parts.dependencyWait + parts.readyWait + parts.work + parts.blocked + parts.otherWait).toBe(parts.total);
  });

  it.each(CLOCKS)('tient les parts dans le Lead Time sans que la décomposition ait à les corriger, horloges qui reculent comprises : elles ne se chevauchent pas (%s)', (_, sharedClock) => {
    // La décomposition borne chaque part par ce qui reste du Lead Time. Cette garde ne doit jamais servir : l'Attente de dépendance et le
    // Cycle Time (`analyzeFlow`) et l'Attente en Prêt (la chronologie du ticket) sont prises dans les périodes du ticket lui-même, dont les
    // Transitions ne reculent jamais, même quand l'horloge d'un commit a reculé : leur somme tient dans le Lead Time telle quelle, quelles
    // que soient les dates des dépendances. L'autre attente, le reste, n'est jamais négative.
    const random = seededRandom(20_261_109);
    let delivered = 0;
    let clockBack = 0;
    let ready = 0;
    for (let round = 0; round < 300; round++) {
      const histories = randomHistories(random, { tickets: 5, clockBack: 25, sharedClock });
      const { tickets } = analyzeProject(histories.map((history) => ({ ...history, title: history.id, priority: 2 })));
      for (const tracked of tickets) {
        if (tracked.deliveredAt === null) continue;
        delivered++;
        if (clockWentBack(histories.find((history) => history.id === tracked.id)?.statusSnapshots ?? [])) clockBack++;
        const { deliveredAt } = tracked;
        const { segments } = tracked.timeline;
        const readyWait = segments.reduce((total, segment, index) => {
          if (segment.column !== 'ready') return total;
          return total + Math.max(0, Math.min(segments[index + 1]?.from ?? deliveredAt, deliveredAt) - segment.from);
        }, 0);
        if (readyWait > 0) ready++;

        const parts = (tracked.dependencyWait ?? NaN) + (tracked.cycleTime ?? 0) + readyWait;
        expect(parts, `${round}/${tracked.id} : Attente de dépendance + Cycle Time + Attente en Prêt ≤ Lead Time`).toBeLessThanOrEqual(tracked.leadTime ?? NaN);
      }
    }
    expect(delivered).toBeGreaterThan(1000);
    expect(clockBack).toBeGreaterThan(300);
    expect(ready).toBeGreaterThan(500);
  });

  it('additionne les Projets de la Vue globale', () => {
    const { leadTimeBreakdown } = healthOfProjects({
      a: [closed('a-1', '2026-10-19T08:00', '2026-10-19T12:00')],
      b: [worked('b-1', '2026-10-19T08:00', '2026-10-19T10:00', '2026-10-19T14:00')],
    });

    expect(leadTimeBreakdown).toMatchObject({ deliveries: 2, total: 10 * HOUR, work: 4 * HOUR, readyWait: 6 * HOUR, otherWait: 0 });
  });
});

describe('Prêts qui stagnent : l’âge des Prêts', () => {
  it('est l’Âge calendaire depuis que le ticket est Prêt : ouvert, et sans dépendance bloquante en suspens', () => {
    const { readyAges } = healthOf([opened('a', '2026-10-20T08:00')]);

    expect(readyAges.tickets).toEqual([
      {
        id: 'a',
        title: 'Titre de a',
        type: 'task',
        priority: 2,
        project: 'p',
        since: '2026-10-20T08:00:00.000Z',
        age: PAST_END - at('2026-10-20T08:00:00').getTime(),
        stagnant: false,
      },
    ]);
  });

  it('compte un ticket devenu Prêt exactement à l’instant mesuré : l’état à un instant est celui du dernier changement à cet instant ou avant, comme au CFD et au WIP', () => {
    const { readyAges } = healthOf([opened('now', '2026-10-21T22:00')]); // 22:00Z : la fin de la période

    expect(readyAges.tickets.map((t) => [t.id, t.age, t.stagnant])).toEqual([['now', 0, false]]);
  });

  it('commence à la fin du Blocage : un ticket bloqué par un ticket ouvert est en Backlog, pas Prêt', () => {
    // `t` dépend de `b` depuis sa création ; `b` est livré le 20 à 12:00 : `t` est Prêt depuis lors, 34 h avant la fin de la période.
    const blocker = closed('b', '2026-10-19T08:00', '2026-10-20T12:00');
    const blocked = opened('t', '2026-10-19T09:00', { dependencies: [blocks('b', '2026-10-19T09:00')] });

    const { readyAges } = healthOf([blocker, blocked]);

    expect(readyAges.tickets.map((t) => [t.id, t.since, t.age])).toEqual([['t', '2026-10-20T12:00:00.000Z', 34 * HOUR]]);
  });

  it('n’en est pas un tant qu’il dépend d’un ticket non fermé', () => {
    const blocker = opened('b', '2026-10-19T08:00');
    const blocked = opened('t', '2026-10-19T09:00', { dependencies: [blocks('b', '2026-10-19T09:00')] });

    expect(healthOf([blocker, blocked]).readyAges.tickets.map((t) => t.id)).toEqual(['b']);
  });

  it('recommence au retour à ouvert, et à la Réouverture', () => {
    const back = ticket('back', [
      ['open', '2026-10-17T08:00'],
      ['in_progress', '2026-10-18T08:00'],
      ['open', '2026-10-20T08:00'],
    ]);
    const reopened = ticket('reopened', [
      ['open', '2026-10-17T08:00'],
      ['closed', '2026-10-18T08:00'],
      ['open', '2026-10-21T08:00'],
    ]);

    const { readyAges } = healthOf([back, reopened]);

    expect(readyAges.tickets.map((t) => [t.id, t.since])).toEqual([
      ['back', '2026-10-20T08:00:00.000Z'],
      ['reopened', '2026-10-21T08:00:00.000Z'],
    ]);
  });

  it('exclut ce qui n’est pas ouvert : en cours, fermé, différé, ainsi que les Epics', () => {
    const tickets = [
      ticket('progress', [['open', '2026-10-17T08:00'], ['in_progress', '2026-10-18T08:00']]),
      closed('done', '2026-10-17T08:00', '2026-10-18T08:00'),
      ticket('later', [['open', '2026-10-17T08:00'], ['deferred', '2026-10-18T08:00']]),
      ticket('epic', [['open', '2026-10-17T08:00']], { type: 'epic' }),
      opened('ready', '2026-10-17T08:00'),
    ];

    expect(healthOf(tickets).readyAges.tickets.map((t) => t.id)).toEqual(['ready']);
  });

  it('stagne au-delà de 14 jours, pas à 14 jours pile', () => {
    expect(STAGNANT_READY_AFTER).toBe(14 * DAY);
    const exactly = opened('exactly', '2026-10-07T22:00'); // 14 j avant la fin de la période
    const older = opened('older', '2026-10-07T21:59:59.999'); // 1 ms de plus
    const { readyAges } = healthOf([exactly, older]);

    expect(readyAges.stagnantAfter).toBe(14 * DAY);
    expect(readyAges.tickets.map((t) => [t.id, t.age, t.stagnant])).toEqual([
      ['older', 14 * DAY + 1, true],
      ['exactly', 14 * DAY, false],
    ]);
    expect(readyAges.stagnant).toBe(1);
  });

  it('range du plus ancien au plus récent, puis par Projet et par identifiant à âge égal', () => {
    const { readyAges } = healthOfProjects({
      b: [opened('b-2', '2026-10-20T08:00'), opened('b-1', '2026-10-20T08:00')],
      a: [opened('a-1', '2026-10-20T08:00'), opened('a-0', '2026-10-10T08:00')],
    });

    expect(readyAges.tickets.map((t) => `${t.project}/${t.id}`)).toEqual(['a/a-0', 'a/a-1', 'b/b-1', 'b/b-2']);
  });

  it('compte, à l’instant de la période précédente, les Prêts qui stagnaient : la tendance du nombre de Prêts qui stagnent', () => {
    // À la fin de la précédente (le 18 à 22:00Z) : X avait 15 j 10 h (stagne), Z 12 j 10 h, Y 8 j. À la fin de la courante : X et Z stagnent.
    const x = opened('x', '2026-10-03T12:00');
    const y = opened('y', '2026-10-10T12:00');
    const z = opened('z', '2026-10-06T12:00');

    const { readyAges } = healthOf([x, y, z]);

    expect(readyAges.stagnant).toBe(2);
    expect(readyAges.trend).toEqual({ previous: 1, delta: 1, ratio: 1 });
  });

  it('mesure la période en cours à maintenant, et ignore un ticket créé après (l’horloge d’un commit en avance)', () => {
    const now = at('2026-10-23T18:00:00');
    const { readyAges } = healthOf([opened('a', '2026-10-23T08:00'), opened('future', '2026-10-23T19:00')], { period: { range: '7d' }, now });

    expect(readyAges.tickets.map((t) => [t.id, t.age])).toEqual([['a', 10 * HOUR]]);
  });

  it('est vide, sans tendance, sans Prêt', () => {
    expect(healthOf([]).readyAges).toEqual({ stagnantAfter: 14 * DAY, tickets: [], stagnant: 0, trend: { previous: 0, delta: 0, ratio: null } });
  });
});

describe('Prêts qui stagnent : 14 jours calendaires dans le fuseau de l’utilisateur, pas 1 209 600 000 ms', () => {
  /** Le Prêt `a`, devenu Prêt à `since`, mesuré à `now` sur une période de 7 jours, dans le fuseau demandé (Paris par défaut). */
  const readyAt = (since: string, now: string, timeZone = PARIS) => healthOf([opened('a', since)], { period: { range: '7d' }, now: at(now), timeZone }).readyAges;
  const real = (since: string, now: string) => at(now).getTime() - at(since).getTime();

  it('ne fait pas stagner un Prêt de 14 jours calendaires pile qui a traversé le passage à l’heure d’hiver, mardi 12:00 à mardi 12:00', () => {
    // Prêt le mardi 20 octobre à 12:00 (10:00Z, heure d'été) ; mesuré le mardi 3 novembre à 12:00 (11:00Z, heure d'hiver).
    const { tickets, stagnant } = readyAt('2026-10-20T10:00:00', '2026-11-03T11:00:00');

    expect(real('2026-10-20T10:00:00', '2026-11-03T11:00:00')).toBe(14 * DAY + HOUR); // l'horloge réelle dépasse le seuil d'une heure
    expect(tickets).toEqual([expect.objectContaining({ id: 'a', since: '2026-10-20T10:00:00.000Z', age: 14 * DAY, stagnant: false })]);
    expect(stagnant).toBe(0);
  });

  it('le fait stagner dès la minute suivante : 14 jours calendaires et une minute', () => {
    const { tickets, stagnant } = readyAt('2026-10-20T10:00:00', '2026-11-03T11:01:00');

    expect(tickets).toEqual([expect.objectContaining({ age: 14 * DAY + 60_000, stagnant: true })]);
    expect(stagnant).toBe(1);
  });

  it('au passage à l’heure d’été, 13 j 23 h réelles font 14 jours calendaires : le Prêt ne stagne pas, et stagne une minute après', () => {
    // Prêt le mardi 17 mars à 12:00 (11:00Z, heure d'hiver) ; mesuré le mardi 31 mars à 12:00 (10:00Z, heure d'été), après le 29.
    expect(real('2026-03-17T11:00:00', '2026-03-31T10:00:00')).toBe(14 * DAY - HOUR);
    expect(readyAt('2026-03-17T11:00:00', '2026-03-31T10:00:00').tickets).toEqual([expect.objectContaining({ age: 14 * DAY, stagnant: false })]);
    // Une minute plus tard : 13 j 23 h 01 réelles, mais 14 jours calendaires et une minute.
    expect(readyAt('2026-03-17T11:00:00', '2026-03-31T10:01:00').tickets).toEqual([expect.objectContaining({ age: 14 * DAY + 60_000, stagnant: true })]);
  });

  it('compte les deux bouts à l’heure du mur le jour même du changement d’heure : dimanche 25 octobre 12:00 au dimanche 8 novembre 12:00', () => {
    // Le dimanche 25 octobre dure 25 h : 12:00 CET y est la 13e heure du jour. Le Prêt a 14 jours calendaires, ni plus ni moins.
    expect(readyAt('2026-10-25T11:00:00', '2026-11-08T11:00:00').tickets).toEqual([expect.objectContaining({ age: 14 * DAY, stagnant: false })]);
    expect(readyAt('2026-10-25T11:00:00', '2026-11-08T11:30:00').tickets).toEqual([expect.objectContaining({ age: 14 * DAY + 30 * 60_000, stagnant: true })]);
  });

  it('mesure l’Âge calendaire : la même durée que l’horloge hors changement d’heure, et en UTC', () => {
    // Du 8 au 12 octobre, Paris est à UTC+2 des deux côtés : calendaire et réel coïncident.
    expect(readyAt('2026-10-08T08:00:00', '2026-10-12T20:30:00').tickets[0]?.age).toBe(real('2026-10-08T08:00:00', '2026-10-12T20:30:00'));
    // En UTC, jamais de changement d'heure : le seuil est celui des millisecondes.
    const exactly = readyAt('2026-10-20T10:00:00', '2026-11-03T10:00:00', 'UTC');
    expect(exactly.tickets).toEqual([expect.objectContaining({ age: 14 * DAY, stagnant: false })]);
    expect(readyAt('2026-10-20T09:59:59.999', '2026-11-03T10:00:00', 'UTC').tickets).toEqual([expect.objectContaining({ age: 14 * DAY + 1, stagnant: true })]);
  });

  it('compte à l’instant de la période précédente avec la même règle : la tendance des Prêts qui stagnent', () => {
    // Prêt depuis le mardi 13 octobre à 11:00 (09:00Z, heure d'été). La précédente est mesurée le 27 octobre à 11:00 (10:00Z, heure d'hiver) : 14 jours
    // calendaires pile, donc il ne stagne pas encore (il le ferait si l'on comptait les 14 j 1 h réelles). Le 3 novembre, il a 21 jours : il stagne.
    const { stagnant, trend } = readyAt('2026-10-13T09:00:00', '2026-11-03T11:00:00');

    expect(stagnant).toBe(1);
    expect(trend).toEqual({ previous: 0, delta: 1, ratio: null });
  });

  it('range les Prêts par âge calendaire, du plus ancien au plus récent, et dit ces âges', () => {
    // Devenus Prêts le 20 octobre à 11:00 et à 13:00 (heure d'été), mesurés le 3 novembre à 12:00 (heure d'hiver) : 14 j 1 h et 13 j 23 h de mur,
    // alors que l'horloge compte 14 j 2 h et 14 j pile.
    const older = opened('older', '2026-10-20T09:00');
    const newer = opened('newer', '2026-10-20T11:00');

    const { tickets, stagnant } = healthOf([newer, older], { period: { range: '7d' }, now: at('2026-11-03T11:00:00'), timeZone: PARIS }).readyAges;

    expect(tickets.map((t) => [t.id, t.age, t.stagnant])).toEqual([
      ['older', 14 * DAY + HOUR, true],
      ['newer', 14 * DAY - HOUR, false],
    ]);
    expect(stagnant).toBe(1);
  });
});

describe('Carte d’activité : les Transitions par jour de la semaine et heure', () => {
  const week = { period: { range: '7d' } as const, now: NOW };
  const total = (cells: number[][]) => cells.flat().reduce((sum, count) => sum + count, 0);

  it('range les Transitions dans le fuseau demandé : 22:30Z le mercredi est jeudi 00:30 à Paris, mercredi 22:30 en UTC', () => {
    const moved = ticket('a', [['open', '2026-10-20T10:00'], ['in_progress', '2026-10-21T22:30']]);

    const paris = healthOf([moved], { ...week, timeZone: PARIS }).activity;
    const utc = healthOf([moved], { ...week, timeZone: 'UTC' }).activity;

    expect(paris.cells[3]?.[0]).toBe(1); // lundi = 0 : jeudi = 3
    expect(utc.cells[2]?.[22]).toBe(1); // mercredi = 2
    expect(paris.total).toBe(1);
    expect(utc.total).toBe(1);
  });

  it('a la forme de sept jours de vingt-quatre heures, du lundi au dimanche', () => {
    const { cells } = healthOf([], week).activity;

    expect(cells).toHaveLength(7);
    expect(cells.every((day) => day.length === 24 && day.every((count) => count === 0))).toBe(true);
  });

  it('ne compte pas la création d’un ticket : c’est une Arrivée, pas une Transition', () => {
    // Créé mardi 20 à 12:00Z, en cours le même jour à 14:00Z (16:00 à Paris).
    const moved = ticket('a', [['open', '2026-10-20T12:00'], ['in_progress', '2026-10-20T14:00']]);

    const { cells } = healthOf([moved, opened('n', '2026-10-20T09:00')], week).activity;

    expect(total(cells)).toBe(1);
    expect(cells[1]?.[16]).toBe(1); // mardi, 16 h
  });

  it('compte chaque changement de statut d’un ticket, y compris sa clôture et sa Réouverture', () => {
    const busy = ticket('a', [
      ['open', '2026-10-19T06:00'],
      ['in_progress', '2026-10-19T07:00'],
      ['closed', '2026-10-19T09:00'],
      ['open', '2026-10-20T07:00'],
    ]);

    expect(healthOf([busy], { ...week, timeZone: 'UTC' }).activity.total).toBe(3);
  });

  it('garde les Transitions de la période seulement : à son premier instant comprise, à maintenant exclue', () => {
    // La période de 7 jours va du samedi 17 à 00:00 Paris (16 à 22:00Z) à maintenant (le 23 à 18:00Z).
    const edges = ticket('a', [
      ['open', '2026-10-10T00:00'],
      ['in_progress', '2026-10-16T21:59:59.999'], // une milliseconde avant
      ['blocked', '2026-10-16T22:00'], // samedi 00:00 à Paris : comprise
      ['in_progress', '2026-10-23T17:59:59.999'], // vendredi 19:59 à Paris : comprise
      ['closed', '2026-10-23T18:00'], // maintenant : exclue
      ['open', '2026-10-23T19:00'], // dans le futur : exclue
    ]);

    const { cells, total: count } = healthOf([edges], week).activity;

    expect(count).toBe(2);
    expect(cells[5]?.[0]).toBe(1); // samedi, 00 h
    expect(cells[4]?.[19]).toBe(1); // vendredi, 19 h
  });

  it('numérote le lundi 0 et le dimanche 6', () => {
    const monday = ticket('m', [['open', '2026-10-18T00:00'], ['in_progress', '2026-10-19T10:00']]); // lundi 19, 10 h UTC
    const sunday = ticket('s', [['open', '2026-10-18T00:00'], ['in_progress', '2026-10-18T10:00']]); // dimanche 18, 10 h UTC

    const { cells } = healthOf([monday, sunday], { ...week, timeZone: 'UTC' }).activity;

    expect(cells[0]?.[10]).toBe(1);
    expect(cells[6]?.[10]).toBe(1);
  });

  it('lit l’heure du mur au changement d’heure : 02:30 revient deux fois le dimanche 25 octobre, aux deux décalages', () => {
    const now = at('2026-10-27T12:00:00');
    const changing = ticket('a', [
      ['open', '2026-10-24T10:00'],
      ['in_progress', '2026-10-25T00:30'], // 02:30 en heure d'été (UTC+2)
      ['blocked', '2026-10-25T01:30'], // 02:30 en heure d'hiver (UTC+1)
      ['in_progress', '2026-10-25T02:30'], // 03:30
    ]);

    const { cells } = healthOf([changing], { period: { from: '2026-10-24', to: '2026-10-26' }, now }).activity;

    expect(cells[6]?.[2]).toBe(2);
    expect(cells[6]?.[3]).toBe(1);
    expect(total(cells)).toBe(3);
  });

  it('ignore les Epics et additionne les Projets de la Vue globale', () => {
    const epic = ticket('e', [['open', '2026-10-20T08:00'], ['in_progress', '2026-10-20T09:00']], { type: 'epic' });
    const a = ticket('a-1', [['open', '2026-10-20T08:00'], ['in_progress', '2026-10-20T09:00']]);
    const b = ticket('b-1', [['open', '2026-10-20T08:00'], ['in_progress', '2026-10-20T09:30']]);

    const { cells, total: count } = healthOfProjects({ a: [epic, a], b: [b] }, { ...week, timeZone: 'UTC' }).activity;

    expect(count).toBe(2);
    expect(cells[1]?.[9]).toBe(2); // mardi, 9 h UTC
  });
});

describe('santé du flux, tous indicateurs', () => {
  it('rend une santé vide mais complète pour un Projet sans ticket', () => {
    const health = healthOf([]);

    expect(health.efficiency.ratio).toBeNull();
    expect(health.reopening.rate).toBeNull();
    expect(health.abandonment.rate).toBeNull();
    expect(health.leadTimeBreakdown.deliveries).toBe(0);
    expect(health.readyAges.tickets).toEqual([]);
    expect(health.activity.total).toBe(0);
  });

  it('refuse une période invalide comme le fait computeMetrics', () => {
    expect(() => healthOf([], { period: { from: '2026-10-21', to: '2026-10-19' } })).toThrow(/commence après sa fin/);
  });
});
