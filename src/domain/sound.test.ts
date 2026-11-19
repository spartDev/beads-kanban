import { describe, expect, it } from 'vitest';
import type { PeriodSpec } from './calendar';
import { analyzeFailures } from './failures';
import { analyzeFlow, recordedTransitions } from './flow';
import { longTrendOf } from './longTrend';
import { analyzeProject, computeMetrics, MIN_FAILURE_BUGS, MIN_FAILURE_COVERAGE, type MetricsInput, type MetricsTicket } from './metrics';
import { randomHistories, seededRandom } from './testing/random-histories';

/**
 * Le Débit sain : les Livraisons saines d'une période, sans Bug d'origine et qu'aucune Réouverture n'a précédée (voir CONTEXT.md), à lire à côté du Débit.
 * Non significatif tant que la Couverture est faible, comme le Taux d'échec ; provisoire tant que la période court. Les historiques sont fictifs.
 */

const PARIS = 'Europe/Paris';
/** Vendredi 23 octobre 2026, 20:00 à Paris. */
const NOW = new Date('2026-10-23T18:00:00Z');
const at = (iso: string) => new Date(`${iso}Z`);

/** Période passée du 19 au 21 octobre à Paris : de 22:00Z le 18 à 22:00Z le 21, évaluée à sa fin. */
const PAST: PeriodSpec = { from: '2026-10-19', to: '2026-10-21' };

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

/** Ticket créé, démarré puis fermé une seule fois : une Livraison du premier coup. */
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

/** Bug resté ouvert, créé à `created` et relié par un lien « découvert à partir de » aux `origins`. */
const bug = (id: string, created: string, ...origins: string[]) =>
  ticket(id, [['open', created]], { type: 'bug', dependencies: origins.map((target) => ({ type: 'discovered-from', target, addedAt: at(created) })) });

const project = (id: string, tickets: MetricsTicket[]): MetricsInput => ({ id, name: `Nom de ${id}`, analysis: analyzeProject(tickets) });

const reportOf = (projects: MetricsInput[], period: PeriodSpec = PAST) => computeMetrics(projects, { period, now: NOW, timeZone: PARIS });

/** La tuile du Débit sain d'un Projet. */
const soundOf = (tickets: MetricsTicket[], period: PeriodSpec = PAST) => reportOf([project('p', tickets)], period).tiles.soundThroughput;

describe('Débit sain : les Livraisons saines', () => {
  it('compte une Livraison sans incident : livrée du premier coup, rien n’en est revenu', () => {
    const tile = soundOf([worked('t', '2026-10-15T08:00', '2026-10-18T08:00', '2026-10-20T10:00')]);

    expect(tile).toMatchObject({ total: 1, deliveries: 1 });
  });

  it('ne compte pas un Renoncement : fermé sans être une Livraison, il n’est ni dans le Débit ni dans le Débit sain', () => {
    const tile = soundOf([worked('t', '2026-10-15T08:00', '2026-10-18T08:00', '2026-10-20T10:00', { labels: ['declined'] })]);

    expect(tile).toMatchObject({ total: 0, deliveries: 0 });
  });

  it('ne compte pas une Livraison qui a un Bug d’origine, même trouvé bien après la période', () => {
    const tickets = [worked('t', '2026-10-15T08:00', '2026-10-18T08:00', '2026-10-20T10:00'), bug('b', '2026-10-23T08:00', 't')];

    expect(soundOf(tickets)).toMatchObject({ total: 0, deliveries: 1 });
    // La même Livraison que le Taux d'échec met en échec.
    expect(reportOf([project('p', tickets)]).tiles.failureRate).toMatchObject({ deliveries: 1, failed: 1 });
  });

  it('compte saine une Livraison dont le bug a été trouvé en cours de travail, avant sa clôture : ce n’est pas un Bug d’origine', () => {
    const tile = soundOf([worked('t', '2026-10-15T08:00', '2026-10-18T08:00', '2026-10-20T10:00'), bug('b', '2026-10-19T08:00', 't')]);

    expect(tile).toMatchObject({ total: 1, deliveries: 1 });
  });

  it('ne compte pas une Livraison qu’une Réouverture a précédée, même rouverte bien avant la période', () => {
    const reopened = ticket('r', [
      ['open', '2026-09-01T08:00'],
      ['in_progress', '2026-09-02T08:00'],
      ['closed', '2026-09-10T08:00'], // annulée par la Réouverture
      ['open', '2026-09-12T08:00'], // Réouverture
      ['in_progress', '2026-10-19T08:00'],
      ['closed', '2026-10-20T10:00'], // la Livraison, dans la période
    ]);

    expect(soundOf([reopened])).toMatchObject({ total: 0, deliveries: 1 });
  });

  it('ne compte pas une Livraison rouverte et refermée dans la période', () => {
    const reopened = ticket('r', [
      ['open', '2026-10-15T08:00'],
      ['closed', '2026-10-19T10:00'],
      ['in_progress', '2026-10-20T08:00'], // Réouverture vers en cours
      ['closed', '2026-10-21T10:00'],
    ]);

    expect(soundOf([reopened])).toMatchObject({ total: 0, deliveries: 1 });
  });

  it('compte saine une Livraison qu’une Prise rendue a précédée : la chaîne l’a arrêtée avant la Livraison', () => {
    const handedBack = ticket('h', [
      ['open', '2026-10-10T08:00'],
      ['in_progress', '2026-10-12T08:00'],
      ['open', '2026-10-14T08:00'], // Prise rendue
      ['in_progress', '2026-10-19T08:00'],
      ['closed', '2026-10-20T10:00'],
    ]);

    expect(soundOf([handedBack])).toMatchObject({ total: 1, deliveries: 1 });
  });

  it('ne compte ni Abandon ni Epic : le Débit sain est une part du Débit, qui ne les compte pas', () => {
    const tickets = [
      worked('t', '2026-10-15T08:00', '2026-10-18T08:00', '2026-10-20T10:00'),
      worked('doublon', '2026-10-15T08:00', '2026-10-18T08:00', '2026-10-20T11:00', {
        dependencies: [{ type: 'duplicates', target: 't', addedAt: at('2026-10-20T11:00') }],
      }),
      worked('epic', '2026-10-15T08:00', '2026-10-18T08:00', '2026-10-20T12:00', { type: 'epic' }),
    ];
    const report = reportOf([project('p', tickets)]);

    expect(report.tiles.throughput.total).toBe(1);
    expect(report.tiles.soundThroughput).toMatchObject({ total: 1, deliveries: 1 });
  });

  it('donne autant de Livraisons que le Débit, et le compare au Débit sain de la période précédente de même durée écoulée', () => {
    const tickets = [
      worked('c1', '2026-10-15T08:00', '2026-10-18T08:00', '2026-10-20T10:00'),
      worked('c2', '2026-10-15T08:00', '2026-10-18T08:00', '2026-10-21T10:00'),
      worked('c-echec', '2026-10-15T08:00', '2026-10-18T08:00', '2026-10-21T11:00'),
      bug('b', '2026-10-22T08:00', 'c-echec'),
      // Période précédente, du 10 au 16 octobre : trois Livraisons, dont une seule saine.
      worked('p-sain', '2026-10-08T08:00', '2026-10-09T08:00', '2026-10-13T10:00'),
      ticket('p-rouvert', [
        ['open', '2026-10-08T08:00'],
        ['closed', '2026-10-09T08:00'],
        ['open', '2026-10-10T08:00'], // Réouverture
        ['closed', '2026-10-14T10:00'],
      ]),
      worked('p-echec', '2026-10-08T08:00', '2026-10-09T08:00', '2026-10-15T10:00'),
      bug('p-b', '2026-10-16T08:00', 'p-echec'),
    ];
    const report = reportOf([project('p', tickets)], { range: '7d' });

    expect(report.tiles.throughput).toMatchObject({ total: 3, trend: { previous: 3, delta: 0 } });
    // La tendance compare des Livraisons saines entre elles : 2 contre 1, pas 2 contre les 3 Livraisons d'avant.
    expect(report.tiles.soundThroughput).toMatchObject({ total: 2, deliveries: 3, trend: { previous: 1, delta: 1, ratio: 1 } });
  });

  it('est provisoire tant que la période court, et ne l’est plus une fois finie', () => {
    const tickets = [worked('t', '2026-10-15T08:00', '2026-10-18T08:00', '2026-10-20T10:00')];

    expect(soundOf(tickets, { range: '7d' }).provisional).toBe(true);
    expect(soundOf(tickets, { from: '2026-10-19', to: '2026-10-23' }).provisional).toBe(true); // une plage qui finit aujourd'hui
    expect(soundOf(tickets, PAST).provisional).toBe(false);
  });
});

describe('Livraison saine : Livraison, sans Bug d’origine, sans Réouverture', () => {
  /**
   * La règle, recalculée à part : la Livraison et les Bugs d'origine tels que les donnent `analyzeFlow` et `analyzeFailures`, la Réouverture lue dans les
   * instantanés du ticket (un changement de fermé vers un autre statut).
   */
  function expectedSound(tickets: MetricsTicket[]): Map<string, boolean> {
    const flows = analyzeFlow(tickets);
    const { originBugs } = analyzeFailures(tickets, flows);
    return new Map(
      tickets.map((t) => {
        const delivered = flows.get(t.id)?.outcome.kind === 'delivered';
        const changes = recordedTransitions(t.statusSnapshots);
        const reopened = changes.some((change, index) => changes[index - 1]?.status === 'closed' && change.status !== 'closed');
        return [t.id, delivered && (originBugs.get(t.id)?.length ?? 0) === 0 && !reopened];
      }),
    );
  }

  /** Chaque ticket mesuré, saine ou non selon `analyzeProject` ; les Epics n'y sont pas. */
  const soundOfEach = (tickets: MetricsTicket[]) => new Map(analyzeProject(tickets).tickets.map((t) => [t.id, t.sound]));

  it('tient sur un lot varié : Abandon qui transmet ses liens, bug relié à une Epic, Prise rendue, bug trouvé en cours de travail', () => {
    const tickets: MetricsTicket[] = [
      worked('propre', '2026-10-01T08:00', '2026-10-02T08:00', '2026-10-05T08:00'),
      ticket('rouverte', [
        ['open', '2026-10-01T08:00'],
        ['closed', '2026-10-03T08:00'],
        ['in_progress', '2026-10-04T08:00'],
        ['closed', '2026-10-05T08:00'],
      ]),
      ticket('rendue', [
        ['open', '2026-10-01T08:00'],
        ['in_progress', '2026-10-02T08:00'],
        ['open', '2026-10-03T08:00'], // Prise rendue
        ['in_progress', '2026-10-04T08:00'],
        ['closed', '2026-10-05T08:00'],
      ]),
      worked('en-echec', '2026-10-01T08:00', '2026-10-02T08:00', '2026-10-05T08:00'),
      bug('b-direct', '2026-10-06T08:00', 'en-echec'),
      // « heritee » n'est reliée qu'au doublon, créé après sa clôture ; le survivant, créé avant, hérite du lien à la date du doublon.
      worked('heritee', '2026-10-01T08:00', '2026-10-02T08:00', '2026-10-05T08:00'),
      bug('survivant', '2026-10-04T08:00'),
      ticket('doublon', [['open', '2026-10-06T08:00'], ['closed', '2026-10-07T08:00']], {
        type: 'bug',
        dependencies: [
          { type: 'discovered-from', target: 'heritee', addedAt: at('2026-10-06T08:00') },
          { type: 'duplicates', target: 'survivant', addedAt: at('2026-10-07T08:00') },
        ],
      }),
      // Une Epic n'est l'origine d'aucun échec, et n'est jamais une Livraison.
      worked('epic', '2026-10-01T08:00', '2026-10-02T08:00', '2026-10-05T08:00', { type: 'epic' }),
      bug('sur-epic', '2026-10-06T08:00', 'epic'),
      worked('avant-bug', '2026-10-01T08:00', '2026-10-02T08:00', '2026-10-05T08:00'),
      bug('trouve-en-cours', '2026-10-03T08:00', 'avant-bug'), // créé avant la clôture : trouvé en cours de travail
      worked('abandon', '2026-10-01T08:00', '2026-10-02T08:00', '2026-10-05T08:00', {
        dependencies: [{ type: 'supersedes', target: 'propre', addedAt: at('2026-10-05T08:00') }],
      }),
      worked('bug-livre', '2026-10-01T08:00', '2026-10-02T08:00', '2026-10-05T08:00', { type: 'bug' }),
      ticket('ouvert', [['open', '2026-10-01T08:00']]),
    ];
    const sound = soundOfEach(tickets);

    expect([...sound].filter(([, isSound]) => isSound).map(([id]) => id)).toEqual(['propre', 'rendue', 'avant-bug', 'bug-livre']);
    expect(sound.has('epic')).toBe(false);
    const expected = expectedSound(tickets);
    for (const [id, isSound] of sound) expect([id, isSound]).toEqual([id, expected.get(id)]);
  });

  it.each([1, 2, 3, 4, 5, 6, 7, 8])('tient sur des historiques tirés au hasard (graine %i) : Réouvertures, bugs reliés, horloges qui reculent', (seed) => {
    const tickets: MetricsTicket[] = randomHistories(seededRandom(seed), { tickets: 16, clockBack: 20, sharedClock: true }).map((t) => ({
      ...t,
      title: `Titre de ${t.id}`,
      priority: 2,
    }));
    const sound = soundOfEach(tickets);
    const expected = expectedSound(tickets);

    for (const [id, isSound] of sound) expect([id, isSound]).toEqual([id, expected.get(id)]);
  });
});

describe('Débit sain : significatif par la règle du Taux d’échec', () => {
  /** `total` bugs créés le 21 octobre, dont `linked` reliés à la Livraison « ref » du 20 (les autres ne sont reliés à rien). */
  const bugsWithCoverage = (total: number, linked: number): MetricsTicket[] => [
    worked('ref', '2026-10-01T08:00', '2026-10-02T08:00', '2026-10-20T10:00'),
    ...Array.from({ length: total }, (_, i) => (i < linked ? bug(`b${i}`, '2026-10-21T08:00', 'ref') : bug(`b${i}`, '2026-10-21T08:00'))),
  ];

  it('n’est pas significatif quand la Couverture est faible', () => {
    const tile = soundOf(bugsWithCoverage(6, 2));

    expect(tile).toMatchObject({
      significant: false,
      reasons: ['low-coverage'],
      coverage: { bugs: 6, linked: 2, ratio: 2 / 6 },
      thresholds: { minCoverage: MIN_FAILURE_COVERAGE, minBugs: MIN_FAILURE_BUGS },
    });
  });

  it.each([
    ['Couverture faible', 6, 2],
    ['trop peu de bugs', 4, 4],
    ['les deux', 3, 1],
    ['50 % de Couverture et 6 bugs : significatif', 6, 3],
    ['aucun bug', 0, 0],
  ])('%s : mêmes Couverture, seuils et motifs que le Taux d’échec', (_, total, linked) => {
    const { tiles } = reportOf([project('p', bugsWithCoverage(total, linked))]);
    const { coverage, significant, reasons, thresholds } = tiles.failureRate;

    expect(tiles.soundThroughput).toMatchObject({ coverage, significant, reasons, thresholds });
  });

  it('compte quand même les Livraisons saines observées : la tuile les montre en retrait', () => {
    const tile = soundOf(bugsWithCoverage(6, 2)); // « ref » a deux Bugs d'origine

    expect(tile).toMatchObject({ total: 0, deliveries: 1, significant: false });
  });
});

describe('Débit sain : Vue globale', () => {
  it('compte les Livraisons saines de l’union des Projets, et additionne leur Couverture', () => {
    const report = reportOf([
      project('a', [worked('a-1', '2026-10-15T08:00', '2026-10-18T08:00', '2026-10-20T10:00'), bug('a-b', '2026-10-21T08:00', 'a-1')]),
      project('b', [worked('b-1', '2026-10-15T08:00', '2026-10-18T08:00', '2026-10-20T11:00'), bug('b-b', '2026-10-21T08:00')]),
    ]);

    expect(report.tiles.soundThroughput).toMatchObject({ total: 1, deliveries: 2, coverage: { bugs: 2, linked: 1, ratio: 0.5 } });
  });

  it('ne prend pas un lien vers le ticket d’un autre Projet pour un Bug d’origine', () => {
    // Le bug de b désigne a-1, que b ne connaît pas : il n'est l'origine de rien.
    const report = reportOf([
      project('a', [worked('a-1', '2026-10-15T08:00', '2026-10-18T08:00', '2026-10-20T10:00')]),
      project('b', [bug('b-b', '2026-10-21T08:00', 'a-1')]),
    ]);

    expect(report.tiles.soundThroughput).toMatchObject({ total: 1, deliveries: 1 });
  });
});

describe('Débit sain : Tendance longue', () => {
  const trendOf = (projects: MetricsInput[]) => longTrendOf(projects, { now: NOW, timeZone: PARIS });

  it('donne le Débit sain de chaque semaine, parmi les Livraisons de son Débit', () => {
    const { weeks } = trendOf([
      project('p', [
        worked('sain', '2026-10-05T08:00', '2026-10-06T08:00', '2026-10-13T10:00'),
        worked('echec', '2026-10-05T08:00', '2026-10-06T08:00', '2026-10-14T10:00'),
        bug('b', '2026-10-20T08:00', 'echec'), // trouvé la semaine suivante : la Livraison du 14 est malsaine après coup
        ticket('rouvert', [
          ['open', '2026-10-05T08:00'],
          ['closed', '2026-10-06T08:00'], // semaine du 5 octobre : une clôture, pas une Livraison
          ['open', '2026-10-07T08:00'],
          ['closed', '2026-10-15T10:00'],
        ]),
        ticket('rendu', [
          ['open', '2026-10-05T08:00'],
          ['in_progress', '2026-10-06T08:00'],
          ['open', '2026-10-07T08:00'], // Prise rendue
          ['closed', '2026-10-16T10:00'],
        ]),
        worked('cette-semaine', '2026-10-19T08:00', '2026-10-20T08:00', '2026-10-21T10:00'),
      ]),
    ]);

    expect(weeks.map((week) => [week.from, week.throughput, week.soundThroughput]).slice(-3)).toEqual([
      ['2026-10-05', 0, 0],
      ['2026-10-12', 4, 2], // « sain » et « rendu »
      ['2026-10-19', 1, 1],
    ]);
    expect(weeks.every((week) => week.soundThroughput <= week.throughput)).toBe(true);
  });

  it('dit si ce Débit sain est significatif, par la Couverture de tous les bugs, comme la tuile', () => {
    const projects = [project('p', [worked('t', '2026-10-05T08:00', '2026-10-06T08:00', '2026-10-13T10:00'), bug('b1', '2026-10-14T08:00', 't'), bug('b2', '2026-10-14T09:00')])];
    const { tiles } = computeMetrics(projects, { period: { range: '30d' }, now: NOW, timeZone: PARIS });
    const { coverage, significant, reasons, thresholds } = tiles.soundThroughput;

    expect(trendOf(projects).soundSignificance).toEqual({ coverage, significant, reasons, thresholds });
    expect(trendOf(projects).soundSignificance).toMatchObject({ significant: false, reasons: ['few-bugs'], coverage: { bugs: 2, linked: 1 } });
  });

  it('compte la semaine en cours jusqu’à maintenant, comme son Débit', () => {
    const { weeks } = trendOf([
      project('p', [
        worked('avant', '2026-10-19T08:00', '2026-10-20T08:00', '2026-10-23T17:59:59'),
        worked('apres', '2026-10-19T08:00', '2026-10-20T08:00', '2026-10-23T18:00:00'), // à NOW pile : pas encore arrivé
      ]),
    ]);

    expect(weeks.at(-1)).toMatchObject({ partial: true, throughput: 1, soundThroughput: 1 });
  });
});
