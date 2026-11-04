import { describe, expect, it } from 'vitest';
import type { MetricsReport } from '../shared/api';
import type { PeriodSpec } from './calendar';
import {
  analyzeProject,
  computeMetrics,
  durationStats,
  MIN_FAILURE_BUGS,
  MIN_FAILURE_COVERAGE,
  type MetricsTicket,
  percentile,
} from './metrics';
import { CLOCKS, clockWentBack, randomHistories, seededRandom } from './testing/random-histories';

const PARIS = 'Europe/Paris';
/** Vendredi 23 octobre 2026, 20:00 à Paris. */
const NOW = new Date('2026-10-23T18:00:00Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const at = (iso: string) => new Date(`${iso}Z`);
/** Une durée interpolée (à 0,001 ms près) : `6.1 * DAY` n'est pas exactement le résultat de l'interpolation en flottant. */
const closeTo = (ms: number) => expect.closeTo(ms, 3);

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

/** Ticket créé puis fermé : une Livraison (sauf Epic ou Abandon), jamais démarré. */
const closed = (id: string, created: string, closedAt: string, extra: Partial<MetricsTicket> = {}) =>
  ticket(
    id,
    [
      ['open', created],
      ['closed', closedAt],
    ],
    extra,
  );

/** Ticket créé, démarré puis fermé. */
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

/** Période passée du 19 au 21 octobre : de 22:00Z le 18 à 22:00Z le 21, 72 heures, évaluée à sa fin. */
const PAST = { period: { from: '2026-10-19', to: '2026-10-21' } } as const;

interface Options {
  period?: PeriodSpec;
  now?: Date;
  timeZone?: string;
}

/** Les métriques d'un Projet, sur 7 jours par défaut. */
function metricsOf(tickets: MetricsTicket[], { period = { range: '7d' }, now = NOW, timeZone = PARIS }: Options = {}): MetricsReport {
  return computeMetrics([{ id: 'p', name: 'Projet P', analysis: analyzeProject(tickets) }], { period, now, timeZone });
}

describe('percentile (interpolation linéaire, méthode 7)', () => {
  // Méthode 7 : celle d'Excel PERCENTILE.INC et du numpy par défaut. Le rang est 1 + p·(n − 1) ; entre deux valeurs
  // voisines, on interpole. Les valeurs attendues viennent de `statistics.quantiles(…, method='inclusive')` de Python.
  it('interpole entre les deux valeurs voisines du rang 1 + p·(n − 1)', () => {
    const sample = [15, 20, 35, 40, 50];

    expect(percentile(sample, 0)).toBe(15);
    expect(percentile(sample, 5)).toBe(16); // rang 1,2 : 15 + 0,2 × (20 − 15)
    expect(percentile(sample, 30)).toBe(23); // rang 2,2 : 20 + 0,2 × (35 − 20)
    expect(percentile(sample, 40)).toBe(29); // rang 2,6 : 20 + 0,6 × (35 − 20)
    expect(percentile(sample, 50)).toBe(35);
    expect(percentile(sample, 100)).toBe(50);
  });

  it('rend exactement la valeur du rang quand le rang tombe juste, et ne dépasse jamais l’échantillon', () => {
    const sample = [3, 6, 7, 8, 8, 10, 13, 15, 16, 20];

    expect(percentile(sample, 25)).toBe(7.25);
    expect(percentile(sample, 50)).toBe(9); // entre 8 et 10
    expect(percentile(sample, 75)).toBe(14.5);
    expect(percentile(sample, 85)).toBe(15.65);
    expect(percentile(sample, 100)).toBe(20);
    expect(percentile([5, 5, 5], 85)).toBe(5); // deux valeurs égales : pas d'écart d'arrondi
  });

  it('prend la valeur du milieu pour la médiane d’un échantillon impair, la moyenne des deux valeurs centrales pour un pair', () => {
    expect(percentile([1, 2, 3], 50)).toBe(2);
    expect(percentile([1, 2, 3, 4], 50)).toBe(2.5);
    expect(percentile([10, 20], 50)).toBe(15);
    expect(percentile([3_600_000, 864_000_000], 50)).toBe(433_800_000); // 1 h et 10 j : 5 j 0 h 30
  });

  it.each([
    [1, 1],
    [2, 1.85],
    [7, 6.1],
    [13, 11.2],
    [20, 17.15], // 17,15 sans décalage dû aux flottants
    [40, 34.15],
    [100, 85.15],
    [101, 86], // le rang 1 + 0,85 × 100 = 86 tombe juste
  ])('P85 d’un échantillon de 1 à %i : %d', (n, expected) => {
    const sample = Array.from({ length: n }, (_, i) => i + 1);

    expect(percentile(sample, 85)).toBe(expected);
  });

  it('ne décroît jamais quand le pourcentage croît', () => {
    const sample = [2, 3, 3, 9, 30, 31, 100];
    const values = Array.from({ length: 101 }, (_, p) => percentile(sample, p) as number);

    expect(values.every((value, i) => i === 0 || value >= (values[i - 1] as number))).toBe(true);
    expect(values[0]).toBe(2);
    expect(values[100]).toBe(100);
  });

  it('calcule l’interpolation sans erreur d’arrondi : une seule division, d’entiers', () => {
    expect(percentile([0, 10], 7)).toBe(0.7); // 0 + 0,07 × 10 donnerait 0,7000000000000001
    expect(percentile([...Array<number>(12).fill(0), 3, 3], 85)).toBe(0.15); // rang 12,05 ; 0 + 0,05 × 3 donnerait 0,15000000000000002
    expect(percentile([291_678_008, 864_662_328], 96)).toBe(841_742_955.2); // des durées en ms : 841742955.1999999 en flottant naïf
  });

  it('borne le pourcentage à 0..100 : jamais de lecture hors de l’échantillon', () => {
    expect(percentile([4, 8, 15], -10)).toBe(4);
    expect(percentile([4, 8, 15], 150)).toBe(15);
  });

  it('est indéfini sans échantillon', () => {
    expect(percentile([], 50)).toBeNull();
  });

  it('rend l’unique valeur d’un échantillon d’un seul élément', () => {
    expect(percentile([42], 50)).toBe(42);
    expect(percentile([42], 85)).toBe(42);
  });
});

describe('durationStats', () => {
  it('trie l’échantillon, donne médiane, P85 et taille', () => {
    expect(durationStats([40, 10, 30, 20])).toEqual({ median: 25, p85: 35.5, n: 4 }); // rang 2,5 puis 3,55
  });

  it('vaut null, avec n = 0, sans aucune Livraison', () => {
    expect(durationStats([])).toEqual({ median: null, p85: null, n: 0 });
  });

  it('ne modifie pas l’échantillon reçu', () => {
    const sample = [3, 1, 2];

    durationStats(sample);

    expect(sample).toEqual([3, 1, 2]);
  });
});

describe('Débit, Arrivées et buckets', () => {
  it('compte les Livraisons et les Arrivées de la période par jour local', () => {
    const report = metricsOf([
      closed('t1', '2026-10-18T08:00', '2026-10-19T10:00'),
      closed('t2', '2026-10-19T08:00', '2026-10-19T15:00'),
      closed('t3', '2026-10-01T08:00', '2026-10-21T10:00'),
      opened('t4', '2026-10-21T09:00'),
    ]);

    expect(report.tiles.throughput.total).toBe(3);
    expect(report.tiles.arrivals.total).toBe(3); // t1, t2 et t4 : t3 est arrivé en début de mois
    expect(report.bucket).toBe('day');
    expect(report.buckets.map((b) => [b.from, b.deliveries, b.arrivals])).toEqual([
      ['2026-10-17', 0, 0],
      ['2026-10-18', 0, 1],
      ['2026-10-19', 2, 1],
      ['2026-10-20', 0, 0],
      ['2026-10-21', 1, 1],
      ['2026-10-22', 0, 0],
      ['2026-10-23', 0, 0],
    ]);
  });

  it('décrit la période, la précédente, le préréglage et l’instant d’évaluation', () => {
    const report = metricsOf([]);

    expect(report.range).toBe('7d');
    expect(report.period).toMatchObject({ from: '2026-10-17', to: '2026-10-23', days: 7, start: '2026-10-16T22:00:00.000Z', end: '2026-10-23T22:00:00.000Z' });
    expect(report.previousPeriod).toMatchObject({ from: '2026-10-10', to: '2026-10-16', days: 7 });
    expect(report.asOf).toBe(NOW.toISOString()); // la période court jusqu’à aujourd’hui : on mesure à l’instant présent
    expect(report.previousAsOf).toBe('2026-10-16T18:00:00.000Z'); // la précédente est comparée sur les mêmes 164 h écoulées
  });

  it('date une Livraison dans le jour du fuseau local : 00:30 à Paris est déjà le jour suivant', () => {
    const tickets = [closed('t', '2026-10-01T08:00', '2026-10-20T22:30')]; // 00:30 le 21 à Paris

    const paris = metricsOf(tickets);
    const utc = metricsOf(tickets, { timeZone: 'UTC' });

    expect(paris.buckets.find((b) => b.deliveries === 1)?.from).toBe('2026-10-21');
    expect(utc.buckets.find((b) => b.deliveries === 1)?.from).toBe('2026-10-20');
  });

  it('ne compte ni Epic ni Abandon dans le Débit, ni Epic dans les Arrivées', () => {
    const report = metricsOf([
      closed('livree', '2026-10-18T08:00', '2026-10-20T10:00'),
      closed('epic', '2026-10-18T08:00', '2026-10-20T10:00', { type: 'epic' }),
      closed('doublon', '2026-10-18T08:00', '2026-10-20T10:00', {
        dependencies: [{ type: 'duplicates', target: 'livree', addedAt: at('2026-10-20T10:00') }],
      }),
      opened('epic-ouverte', '2026-10-20T08:00', { type: 'epic' }),
    ]);

    expect(report.tiles.throughput.total).toBe(1);
    expect(report.tiles.arrivals.total).toBe(2); // « livree » et « doublon » ont bien été créés ; les Epics ne comptent pas
  });

  it('date une Livraison de sa dernière clôture : une Réouverture annule la précédente', () => {
    const reopened = ticket('r', [
      ['open', '2026-10-10T08:00'],
      ['closed', '2026-10-17T10:00'],
      ['open', '2026-10-19T10:00'],
      ['closed', '2026-10-22T10:00'],
    ]);
    const stillOpen = ticket('s', [
      ['open', '2026-10-10T08:00'],
      ['closed', '2026-10-17T10:00'],
      ['open', '2026-10-19T10:00'],
    ]);

    const report = metricsOf([reopened, stillOpen]);

    expect(report.tiles.throughput.total).toBe(1); // « r », une seule fois ; « s » n’est plus une Livraison
    expect(report.buckets.find((b) => b.deliveries === 1)?.from).toBe('2026-10-22');
  });

  it('inclut le premier instant de la période et exclut le premier instant qui suit', () => {
    const report = metricsOf([
      closed('debut', '2026-10-01T08:00', '2026-10-16T22:00'), // minuit à Paris, le 17 : premier instant de la période
      closed('avant', '2026-10-01T08:00', '2026-10-16T21:59'),
    ]);

    expect(report.tiles.throughput.total).toBe(1);
    expect(report.buckets[0]).toMatchObject({ from: '2026-10-17', deliveries: 1 });
  });

  it('exclut le premier instant qui suit la période : il appartient au jour suivant', () => {
    const report = metricsOf(
      [
        closed('dernier', '2026-10-01T08:00', '2026-10-21T21:59:59'), // 23:59:59 le 21 à Paris : dans la période
        closed('suivant', '2026-10-01T08:00', '2026-10-21T22:00:00'), // minuit le 22 : dans la période d'après
      ],
      PAST,
    );

    expect(report.tiles.throughput.total).toBe(1);
    expect(report.buckets.at(-1)).toMatchObject({ from: '2026-10-21', deliveries: 1 });
    expect(metricsOf([closed('suivant', '2026-10-01T08:00', '2026-10-21T22:00:00')], { period: { from: '2026-10-22', to: '2026-10-22' } }).tiles.throughput.total).toBe(1);
  });

  it('ignore un ticket sans historique : on ne sait pas le dater', () => {
    const report = metricsOf([ticket('sans-historique', [])]);

    expect(report.tiles.throughput.total).toBe(0);
    expect(report.tiles.arrivals.total).toBe(0);
  });

  it('regroupe par semaine, du lundi au dimanche, quand la période dépasse 31 jours', () => {
    const report = metricsOf(
      [
        closed('t1', '2026-07-01T08:00', '2026-10-19T08:00'), // lundi 19 octobre : dernière semaine, tronquée
        closed('t2', '2026-07-01T08:00', '2026-10-18T08:00'), // dimanche 18 octobre : semaine d’avant
        closed('t3', '2026-07-01T08:00', '2026-07-26T10:00'), // dimanche 26 juillet : premier bucket, d’un seul jour
      ],
      { period: { range: '90d' } },
    );

    expect(report.bucket).toBe('week');
    expect(report.buckets).toHaveLength(14);
    expect(report.buckets[0]).toMatchObject({ from: '2026-07-26', to: '2026-07-26', days: 1, deliveries: 1 });
    expect(report.buckets.at(-2)).toMatchObject({ from: '2026-10-12', to: '2026-10-18', days: 7, deliveries: 1 });
    expect(report.buckets.at(-1)).toMatchObject({ from: '2026-10-19', to: '2026-10-23', days: 5, deliveries: 1 });
    expect(report.buckets.reduce((total, b) => total + b.deliveries, 0)).toBe(report.tiles.throughput.total);
  });

  it('mesure une plage personnalisée passée à l’instant où elle finit, pas à maintenant', () => {
    const report = metricsOf([closed('t', '2026-09-01T08:00', '2026-09-20T10:00')], {
      period: { from: '2026-09-15', to: '2026-09-25' },
    });

    expect(report.range).toBe('custom');
    expect(report.tiles.throughput.total).toBe(1);
    expect(report.asOf).toBe('2026-09-25T22:00:00.000Z'); // minuit à Paris, le 26
  });
});

/** Une Livraison du 20 octobre à midi (UTC), dont le Lead Time dure `days` jours. */
const leadingDays = (id: string, days: number, extra: Partial<MetricsTicket> = {}) =>
  closed(id, new Date(at('2026-10-20T12:00').getTime() - days * DAY).toISOString().slice(0, 16), '2026-10-20T12:00', extra);

describe('Lead Time', () => {
  it('donne la médiane et le P85 des Livraisons de la période, par interpolation linéaire, avec la taille de l’échantillon', () => {
    const report = metricsOf([1, 2, 3, 4, 5, 6, 7].map((days) => leadingDays(`t${days}`, days)));

    expect(report.tiles.leadTime).toMatchObject({ median: 4 * DAY, p85: closeTo(6.1 * DAY), n: 7 }); // P85 : rang 6,1, un dixième de 6 j à 7 j
  });

  it('interpole la médiane entre les deux valeurs centrales quand le nombre de Livraisons est pair', () => {
    const report = metricsOf([leadingDays('court', 1 / 24), leadingDays('long', 10)]); // 1 h et 10 j

    expect(report.tiles.leadTime).toMatchObject({ median: 5 * DAY + HOUR / 2, n: 2 }); // 5 j 0 h 30, pas 1 h
  });

  it('vaut null, avec n = 0, quand aucune Livraison n’a eu lieu dans la période', () => {
    const report = metricsOf([opened('t', '2026-10-20T08:00'), closed('vieux', '2026-08-01T08:00', '2026-08-10T08:00')]);

    expect(report.tiles.leadTime).toMatchObject({ median: null, p85: null, n: 0 });
  });

  it('mesure de la création à la dernière clôture quand le ticket a été rouvert', () => {
    const reopened = ticket('r', [
      ['open', '2026-10-10T12:00'],
      ['closed', '2026-10-14T12:00'],
      ['open', '2026-10-18T12:00'],
      ['closed', '2026-10-20T12:00'],
    ]);

    expect(metricsOf([reopened]).tiles.leadTime).toMatchObject({ median: 10 * DAY, n: 1 });
  });

  it('ne mesure ni Abandon ni Epic', () => {
    const report = metricsOf([
      leadingDays('livree', 3),
      leadingDays('doublon', 30, { dependencies: [{ type: 'duplicates', target: 'livree', addedAt: at('2026-10-20T12:00') }] }),
      leadingDays('epic', 40, { type: 'epic' }),
    ]);

    expect(report.tiles.leadTime).toMatchObject({ median: 3 * DAY, n: 1 });
  });
});

describe('Cycle Time et nuage de points', () => {
  const sample = () => [
    worked('un-jour', '2026-10-15T08:00', '2026-10-19T12:00', '2026-10-20T12:00', { title: 'Un jour', type: 'bug', priority: 1 }),
    worked('trois-jours', '2026-10-15T08:00', '2026-10-17T12:00', '2026-10-20T12:00', { title: 'Trois jours', type: 'feature', priority: 3 }),
    closed('jamais-demarre', '2026-10-15T08:00', '2026-10-21T12:00'),
  ];

  it('ne mesure que les Livraisons démarrées : un ticket jamais démarré a un Lead Time mais pas de Cycle Time', () => {
    const report = metricsOf(sample());

    expect(report.tiles.leadTime.n).toBe(3);
    expect(report.tiles.cycleTime).toMatchObject({ median: 2 * DAY, p85: closeTo(2.7 * DAY), n: 2 }); // 1 j et 3 j : milieu, puis 85 % du chemin
  });

  it('cumule les statuts de travail, Blocages compris', () => {
    const report = metricsOf([
      ticket('t', [
        ['open', '2026-10-15T08:00'],
        ['in_progress', '2026-10-16T12:00'],
        ['blocked', '2026-10-17T12:00'],
        ['in_progress', '2026-10-18T12:00'],
        ['closed', '2026-10-19T12:00'],
      ]),
    ]);

    expect(report.tiles.cycleTime).toMatchObject({ median: 3 * DAY, n: 1 });
  });

  it('vaut null sans Livraison démarrée', () => {
    const report = metricsOf([closed('t', '2026-10-15T08:00', '2026-10-21T12:00')]);

    expect(report.tiles.cycleTime).toMatchObject({ median: null, p85: null, n: 0 });
  });

  it('place un point par Livraison démarrée de la période, par date de Livraison croissante puis par identifiant', () => {
    const report = metricsOf([
      ...sample(),
      worked('tard', '2026-10-15T08:00', '2026-10-21T12:00', '2026-10-22T12:00', { title: 'Tard' }),
      worked('hors-periode', '2026-08-01T08:00', '2026-08-02T08:00', '2026-08-03T08:00'),
      worked('en-cours', '2026-10-15T08:00', '2026-10-21T08:00', '2026-10-23T08:00', {
        dependencies: [{ type: 'supersedes', target: 'tard', addedAt: at('2026-10-23T08:00') }],
      }), // un Abandon n'est pas une Livraison
    ]);

    expect(report.cycleTimeScatter).toEqual([
      { id: 'trois-jours', title: 'Trois jours', type: 'feature', priority: 3, project: 'p', deliveredAt: '2026-10-20T12:00:00.000Z', cycleTime: 3 * DAY },
      { id: 'un-jour', title: 'Un jour', type: 'bug', priority: 1, project: 'p', deliveredAt: '2026-10-20T12:00:00.000Z', cycleTime: DAY },
      { id: 'tard', title: 'Tard', type: 'task', priority: 2, project: 'p', deliveredAt: '2026-10-22T12:00:00.000Z', cycleTime: DAY },
    ]);
  });
});

const discoveredFrom = (target: string, added: string) => ({ type: 'discovered-from', target, addedAt: at(added) });

/** Bug resté ouvert, créé à `created` et relié par discovered-from aux `origins`. */
const bug = (id: string, created: string, ...origins: string[]) =>
  opened(id, created, { type: 'bug', dependencies: origins.map((origin) => discoveredFrom(origin, created)) });

/** `total` bugs créés le 21 octobre, dont `linked` reliés à la Livraison « ref » du 20 (les autres ne sont reliés à rien). */
function bugsWithCoverage(total: number, linked: number): MetricsTicket[] {
  return [
    closed('ref', '2026-10-01T08:00', '2026-10-20T10:00'),
    ...Array.from({ length: total }, (_, i) => (i < linked ? bug(`b${i}`, '2026-10-21T08:00', 'ref') : bug(`b${i}`, '2026-10-21T08:00'))),
  ];
}

describe('Taux d’échec', () => {
  it('donne la part des Livraisons de la période qui ont au moins un Bug d’origine', () => {
    const report = metricsOf([
      closed('t1', '2026-10-01T08:00', '2026-10-18T10:00'),
      closed('t2', '2026-10-01T08:00', '2026-10-19T10:00'),
      closed('t3', '2026-10-01T08:00', '2026-10-20T10:00'),
      closed('t4', '2026-10-01T08:00', '2026-10-21T10:00'),
      bug('b1', '2026-10-22T08:00', 't1'),
      bug('b2', '2026-10-22T09:00', 't1'), // une Livraison avec deux Bugs d'origine ne compte qu'une fois
      bug('b3', '2026-10-22T10:00', 't2'),
    ]);

    expect(report.tiles.failureRate).toMatchObject({ deliveries: 4, failed: 2, rate: 0.5 });
  });

  it('range l’échec dans la période de sa Livraison, même si le bug n’a été trouvé que bien après', () => {
    const tickets = [closed('t', '2026-09-01T08:00', '2026-09-20T10:00'), bug('b', '2026-10-15T08:00', 't')];

    const septembre = metricsOf(tickets, { period: { from: '2026-09-15', to: '2026-09-25' } });
    const octobre = metricsOf(tickets, { period: { from: '2026-10-10', to: '2026-10-20' } });

    expect(septembre.tiles.failureRate).toMatchObject({ deliveries: 1, failed: 1, rate: 1 });
    expect(octobre.tiles.failureRate).toMatchObject({ deliveries: 0, failed: 0, rate: null });
  });

  it('ne compte pas comme échec un bug trouvé en cours de travail, créé avant la Livraison', () => {
    const report = metricsOf([closed('t', '2026-10-01T08:00', '2026-10-20T10:00'), bug('b', '2026-10-19T08:00', 't')]);

    expect(report.tiles.failureRate).toMatchObject({ deliveries: 1, failed: 0, rate: 0 });
  });

  it('vaut null sans Livraison dans la période', () => {
    expect(metricsOf([]).tiles.failureRate).toMatchObject({ deliveries: 0, failed: 0, rate: null });
  });

  describe('Couverture et état « non significatif »', () => {
    it('mesure la Couverture sur tous les bugs, de toutes les dates', () => {
      const report = metricsOf([...bugsWithCoverage(8, 6), closed('b-ancien', '2026-01-01T08:00', '2026-01-05T08:00', { type: 'bug' })]);

      expect(report.tiles.failureRate.coverage).toEqual({ bugs: 9, linked: 6, ratio: 6 / 9 });
    });

    it('est significatif à partir de 50 % de Couverture et de 5 bugs, bornes comprises', () => {
      expect(MIN_FAILURE_COVERAGE).toBe(0.5);
      expect(MIN_FAILURE_BUGS).toBe(5);

      const exactly = metricsOf(bugsWithCoverage(6, 3)).tiles.failureRate; // 50 % : pas « inférieure à 50 % »
      const five = metricsOf(bugsWithCoverage(5, 5)).tiles.failureRate; // 5 bugs : pas « moins de 5 »

      expect(exactly).toMatchObject({ significant: true, reasons: [], reason: null });
      expect(five).toMatchObject({ significant: true, reasons: [], reason: null });
      expect(exactly.thresholds).toEqual({ minCoverage: MIN_FAILURE_COVERAGE, minBugs: MIN_FAILURE_BUGS });
    });

    it('n’est pas significatif quand la Couverture est inférieure à 50 %', () => {
      const tile = metricsOf(bugsWithCoverage(6, 2)).tiles.failureRate;

      expect(tile.significant).toBe(false);
      expect(tile.reasons).toEqual(['low-coverage']);
      expect(tile.reason).toBe('Couverture insuffisante : 33 % des bugs ont une origine renseignée (minimum 50 %).');
    });

    it('n’est pas significatif quand il y a moins de 5 bugs, même tous reliés', () => {
      const tile = metricsOf(bugsWithCoverage(4, 4)).tiles.failureRate;

      expect(tile.significant).toBe(false);
      expect(tile.reasons).toEqual(['few-bugs']);
      expect(tile.reason).toBe('Trop peu de bugs pour conclure : 4 (minimum 5).');
    });

    it('cumule les deux motifs', () => {
      const tile = metricsOf(bugsWithCoverage(3, 1)).tiles.failureRate;

      expect(tile.significant).toBe(false);
      expect(tile.reasons).toEqual(['low-coverage', 'few-bugs']);
      expect(tile.reason).toBe(
        'Couverture insuffisante : 33 % des bugs ont une origine renseignée (minimum 50 %) ; trop peu de bugs pour conclure : 3 (minimum 5).',
      );
    });

    it('n’a pas de Couverture sans bug : seul le nombre de bugs est en cause', () => {
      const tile = metricsOf([closed('t', '2026-10-01T08:00', '2026-10-20T10:00')]).tiles.failureRate;

      expect(tile.coverage).toEqual({ bugs: 0, linked: 0, ratio: null });
      expect(tile.reasons).toEqual(['few-bugs']);
    });

    it('ne compte pas les bugs en Abandon : ils décrivent le défaut d’un autre bug', () => {
      const report = metricsOf([
        ...bugsWithCoverage(5, 5),
        closed('doublon', '2026-10-01T08:00', '2026-10-05T08:00', {
          type: 'bug',
          dependencies: [{ type: 'duplicates', target: 'b0', addedAt: at('2026-10-05T08:00') }],
        }),
      ]);

      expect(report.tiles.failureRate.coverage).toMatchObject({ bugs: 5, linked: 5 });
    });
  });
});

describe('Temps de rétablissement', () => {
  it('est le Lead Time des bugs P0 et P1 livrés pendant la période', () => {
    const report = metricsOf([
      leadingDays('p0', 2, { type: 'bug', priority: 0 }),
      leadingDays('p1', 4, { type: 'bug', priority: 1 }),
      leadingDays('p2', 9, { type: 'bug', priority: 2 }), // un bug non critique
      leadingDays('feature-p0', 8, { type: 'feature', priority: 0 }), // critique, mais pas un bug
      closed('hors-periode', '2026-07-01T08:00', '2026-07-03T08:00', { type: 'bug', priority: 0 }),
      opened('ouvert', '2026-10-01T08:00', { type: 'bug', priority: 0 }),
      leadingDays('doublon', 7, {
        type: 'bug',
        priority: 0,
        dependencies: [{ type: 'duplicates', target: 'p0', addedAt: at('2026-10-20T12:00') }],
      }),
    ]);

    expect(report.tiles.recoveryTime).toMatchObject({ median: 3 * DAY, p85: closeTo(3.7 * DAY), n: 2 }); // p0 (2 j) et p1 (4 j)
    expect(report.tiles.leadTime.n).toBe(4); // le Lead Time général mesure toutes les Livraisons de la période : p0, p1, p2 et la feature
  });

  it('vaut null, avec n = 0, sans bug critique livré', () => {
    const report = metricsOf([leadingDays('p2', 3, { type: 'bug', priority: 2 })]);

    expect(report.tiles.recoveryTime).toMatchObject({ median: null, p85: null, n: 0 });
  });

  it('interpole la médiane de deux bugs critiques : 1 h et 10 j donnent 5 j 0 h 30, pas 1 h', () => {
    // Le cas de la revue : avec deux Livraisons, la plus basse des deux ferait paraître le rétablissement dix fois trop rapide.
    const report = metricsOf([
      closed('rapide', '2026-10-20T06:00', '2026-10-20T07:00', { type: 'bug', priority: 0 }),
      closed('lent', '2026-10-10T07:00', '2026-10-20T07:00', { type: 'bug', priority: 0 }),
    ]);

    expect(report.tiles.recoveryTime).toMatchObject({ median: 5 * DAY + HOUR / 2, p85: closeTo(0.15 * HOUR + 0.85 * 10 * DAY), n: 2 });
  });
});

describe('WIP', () => {
  const tickets = () => [
    ticket('a', [
      ['open', '2026-10-15T08:00'],
      ['in_progress', '2026-10-19T22:00'], // 36 h dans la période, puis fermé
      ['closed', '2026-10-21T10:00'],
    ]),
    ticket('b', [
      ['open', '2026-10-01T08:00'],
      ['in_progress', '2026-10-10T08:00'], // la période entière : 72 h
    ]),
    ticket('c', [
      ['open', '2026-10-15T08:00'],
      ['in_progress', '2026-10-21T10:00'], // 6 h en cours puis 6 h bloqué : 12 h
      ['blocked', '2026-10-21T16:00'],
      ['closed', '2026-10-22T10:00'],
    ]),
    ticket('f', [
      ['open', '2026-10-21T20:00'],
      ['in_progress', '2026-10-21T20:00'], // 2 h
    ]),
    ticket('epic', [['open', '2026-10-01T08:00'], ['in_progress', '2026-10-01T08:00']], { type: 'epic' }),
    ticket('en-pause', [['open', '2026-10-01T08:00'], ['deferred', '2026-10-02T08:00']]),
  ];

  it('compte les tickets en statut de travail à la fin de la période, et leur moyenne pondérée par le temps', () => {
    const { wip } = metricsOf(tickets(), PAST).tiles;

    expect(wip.current).toBe(3); // b, c (bloqué : statut de travail) et f ; a est fermé, l'Epic et le ticket en pause ne comptent pas
    expect(wip.average).toBeCloseTo((36 + 72 + 12 + 2) / 72, 10);
  });

  it('mesure la période en cours jusqu’à maintenant, pas jusqu’à minuit', () => {
    const report = metricsOf([ticket('w', [['open', '2026-10-01T08:00'], ['in_progress', '2026-10-16T22:00']])]); // depuis le début des 7 jours

    expect(report.tiles.wip.current).toBe(1);
    expect(report.tiles.wip.average).toBe(1); // en cours pendant toute la période écoulée : exactement 1
  });

  it('pondère par le temps écoulé, pas par la durée de la période : un ticket en cours depuis 24 h pèse 24 h sur 164 h', () => {
    const report = metricsOf([
      ticket('w', [['open', '2026-10-01T08:00'], ['in_progress', '2026-10-16T22:00']]), // depuis le début des 7 jours
      ticket('v', [['open', '2026-10-01T08:00'], ['in_progress', '2026-10-22T18:00']]), // depuis 24 h
    ]);

    expect(report.tiles.wip.current).toBe(2);
    // Du 16 à 22:00Z à maintenant (le 23 à 18:00Z) : 164 h, dont 164 h pour w et 24 h pour v. Jusqu'à minuit, ce serait 196 h sur 168 h.
    expect(report.tiles.wip.average).toBeCloseTo((164 + 24) / 164, 10);
  });

  it('vaut 0 sans ticket en cours', () => {
    expect(metricsOf([closed('t', '2026-10-01T08:00', '2026-10-05T08:00')]).tiles.wip).toMatchObject({ current: 0, average: 0 });
  });
});

describe('âge des tickets en cours', () => {
  it('liste les tickets en cours à la fin de la période, du plus ancien au plus récent, avec leur âge depuis le premier passage en cours', () => {
    const report = metricsOf(
      [
        ticket(
          'ancien',
          [
            ['open', '2026-10-01T08:00'],
            ['in_progress', '2026-10-05T08:00'], // premier passage en cours
            ['open', '2026-10-06T08:00'], // arrêté...
            ['in_progress', '2026-10-20T08:00'], // ...repris : l'âge court depuis le premier passage
          ],
          { title: 'Le plus ancien', type: 'feature', priority: 1 },
        ),
        ticket('recent', [['open', '2026-10-21T08:00'], ['hooked', '2026-10-21T20:00']], { title: 'Récent' }),
        ticket('ferme', [['open', '2026-10-01T08:00'], ['in_progress', '2026-10-02T08:00'], ['closed', '2026-10-03T08:00']]),
        ticket('epic', [['open', '2026-10-01T08:00'], ['in_progress', '2026-10-02T08:00']], { type: 'epic' }),
        ticket('pas-demarre', [['open', '2026-10-01T08:00']]),
      ],
      PAST,
    );

    expect(report.inProgress).toEqual([
      {
        id: 'ancien',
        title: 'Le plus ancien',
        type: 'feature',
        priority: 1,
        project: 'p',
        status: 'in_progress',
        blocked: false,
        startedAt: '2026-10-05T08:00:00.000Z',
        age: (Date.parse('2026-10-21T22:00:00Z') - Date.parse('2026-10-05T08:00:00Z')),
      },
      {
        id: 'recent',
        title: 'Récent',
        type: 'task',
        priority: 2,
        project: 'p',
        status: 'hooked',
        blocked: false,
        startedAt: '2026-10-21T20:00:00.000Z',
        age: 2 * HOUR,
      },
    ]);
  });

  it('signale les tickets en Blocage : statut bloqué, ou dépendance non fermée', () => {
    const report = metricsOf([
      opened('bloqueur', '2026-10-01T08:00'),
      ticket('par-dependance', [['open', '2026-10-01T08:00'], ['in_progress', '2026-10-02T08:00']], {
        dependencies: [{ type: 'blocks', target: 'bloqueur', addedAt: at('2026-10-03T08:00') }],
      }),
      ticket('par-statut', [['open', '2026-10-01T08:00'], ['blocked', '2026-10-02T09:00']]),
      ticket('libre', [['open', '2026-10-01T08:00'], ['in_progress', '2026-10-02T10:00']]),
    ]);

    expect(report.inProgress.map((t) => [t.id, t.status, t.blocked])).toEqual([
      ['par-dependance', 'in_progress', true],
      ['par-statut', 'blocked', true],
      ['libre', 'in_progress', false],
    ]);
  });

  it('range à égalité d’âge par identifiant', () => {
    const report = metricsOf([
      ticket('b', [['open', '2026-10-01T08:00'], ['in_progress', '2026-10-02T08:00']]),
      ticket('a', [['open', '2026-10-01T08:00'], ['in_progress', '2026-10-02T08:00']]),
    ]);

    expect(report.inProgress.map((t) => t.id)).toEqual(['a', 'b']);
  });
});

describe('CFD', () => {
  const tickets = () => [
    closed('a', '2026-10-10T08:00', '2026-10-18T12:00'),
    ticket(
      'b',
      [
        ['open', '2026-10-17T23:00'], // 01:00 le 18 à Paris : n'existe pas encore à la fin du 17
        ['in_progress', '2026-10-19T10:00'],
      ],
      { dependencies: [{ type: 'blocks', target: 'c', addedAt: at('2026-10-20T10:00') }] },
    ),
    closed('c', '2026-10-15T08:00', '2026-10-21T10:00'),
    opened('d', '2026-10-20T12:00', { dependencies: [{ type: 'blocks', target: 'c', addedAt: at('2026-10-20T12:00') }] }),
    ticket('e', [['open', '2026-10-10T08:00'], ['deferred', '2026-10-18T08:00']]),
    ticket('f', [['open', '2026-10-15T08:00'], ['blocked', '2026-10-22T10:00']]),
    opened('epic', '2026-10-01T08:00', { type: 'epic' }),
  ];

  it('compte les tickets par colonne à la fin de chaque jour de la période', () => {
    const { cfd } = metricsOf(tickets());

    expect(cfd.map(({ date, backlog, ready, inProgress, blocked, done }) => [date, backlog, ready, inProgress, blocked, done])).toEqual([
      ['2026-10-17', 0, 4, 0, 0, 0], // a, c, e et f sont prêts
      ['2026-10-18', 0, 3, 0, 0, 1], // a est terminé, e est en pause, b est créé
      ['2026-10-19', 0, 2, 1, 0, 1], // b est en cours
      ['2026-10-20', 1, 2, 0, 1, 1], // b dépend de c, non fermé : Bloqué ; d est créé en Blocage : Backlog
      ['2026-10-21', 0, 2, 1, 0, 2], // c fermé : b repart, d est prêt
      ['2026-10-22', 0, 1, 1, 1, 2], // f passe au statut bloqué
      ['2026-10-23', 0, 1, 1, 1, 2],
    ]);
  });

  it('range les Abandons en Terminé, et laisse les Epics et le « En pause » hors des colonnes', () => {
    const { cfd } = metricsOf([
      closed('livre', '2026-10-01T08:00', '2026-10-18T10:00'),
      closed('doublon', '2026-10-01T08:00', '2026-10-18T10:00', {
        dependencies: [{ type: 'duplicates', target: 'livre', addedAt: at('2026-10-18T10:00') }],
      }),
      closed('epic', '2026-10-01T08:00', '2026-10-18T10:00', { type: 'epic' }),
      ticket('differe', [['open', '2026-10-01T08:00'], ['deferred', '2026-10-02T08:00']]),
      ticket('epingle', [['open', '2026-10-01T08:00'], ['pinned', '2026-10-02T08:00']]),
    ]);

    expect(cfd.at(-1)).toEqual({ date: '2026-10-23', backlog: 0, ready: 0, inProgress: 0, blocked: 0, done: 2 });
  });

  it('évalue le dernier jour à l’instant présent, pas à sa fin', () => {
    const { cfd } = metricsOf([closed('futur', '2026-10-01T08:00', '2026-10-23T20:00')]); // 22:00 à Paris : après NOW (20:00)

    expect(cfd.at(-1)).toMatchObject({ date: '2026-10-23', ready: 1, done: 0 });
  });

  it('évalue une période passée à la fin de son dernier jour', () => {
    const { cfd } = metricsOf([closed('t', '2026-10-01T08:00', '2026-10-21T20:00')], PAST); // 22:00 le 21 à Paris : avant la fin du jour

    expect(cfd.map((p) => [p.date, p.ready, p.done])).toEqual([
      ['2026-10-19', 1, 0],
      ['2026-10-20', 1, 0],
      ['2026-10-21', 0, 1],
    ]);
  });

  it('garde un point par jour même quand les buckets sont des semaines', () => {
    const { cfd, bucket } = metricsOf([], { period: { range: '90d' } });

    expect(bucket).toBe('week');
    expect(cfd).toHaveLength(90);
    expect(cfd[0]?.date).toBe('2026-07-26');
    expect(cfd.at(-1)?.date).toBe('2026-10-23');
  });

  it('compte, avant la période, ce qui est déjà terminé : le CFD est cumulé', () => {
    const { cfd } = metricsOf([closed('ancien', '2026-01-01T08:00', '2026-02-01T08:00')]);

    expect(cfd).toHaveLength(7);
    expect(cfd.every((p) => p.done === 1)).toBe(true);
  });
});

/** Une Livraison à `closedAt` (UTC) dont le Lead Time dure `days` jours. */
const deliveredAfter = (id: string, closedAt: string, days: number, extra: Partial<MetricsTicket> = {}) =>
  closed(id, new Date(at(closedAt).getTime() - days * DAY).toISOString().slice(0, 16), closedAt, extra);

describe('comparaison avec la période précédente', () => {
  // Période : du 17 au 23 octobre. Précédente, de même durée : du 10 au 16.
  const world = () => [
    deliveredAfter('p1', '2026-10-12T12:00', 2),
    deliveredAfter('p2', '2026-10-14T12:00', 4),
    deliveredAfter('c1', '2026-10-18T12:00', 3),
    deliveredAfter('c2', '2026-10-20T12:00', 6),
    deliveredAfter('c3', '2026-10-22T12:00', 9),
  ];

  it('compare le Débit et les Arrivées à ceux de la période précédente de même durée', () => {
    const { tiles } = metricsOf(world());

    expect(tiles.throughput).toEqual({ total: 3, trend: { previous: 2, delta: 1, ratio: 0.5 } });
    // Arrivées : p1 le 10 (12 - 2), p2 le 10, c1 le 15, c2 le 14, c3 le 13 : tous avant le 17, aucun dans la période courante
    expect(tiles.arrivals.total).toBe(0);
    expect(tiles.arrivals.trend.previous).toBe(5);
    expect(tiles.arrivals.trend).toMatchObject({ delta: -5, ratio: -1 });
  });

  it('compare médiane et P85 des durées, chacune à la sienne', () => {
    const { tiles } = metricsOf(world());

    // Période : 3, 6 et 9 j (médiane 6 j, P85 8,1 j). Précédente : 2 et 4 j (médiane 3 j, P85 3,7 j).
    expect(tiles.leadTime).toMatchObject({ median: 6 * DAY, p85: closeTo(8.1 * DAY), n: 3 });
    expect(tiles.leadTime.trend.median).toEqual({ previous: 3 * DAY, delta: 3 * DAY, ratio: 1 });
    expect(tiles.leadTime.trend.p85).toEqual({ previous: closeTo(3.7 * DAY), delta: closeTo(4.4 * DAY), ratio: expect.closeTo(4.4 / 3.7, 9) });
  });

  it('laisse la tendance indéfinie quand l’une des périodes n’a aucune Livraison', () => {
    const noPrevious = metricsOf([deliveredAfter('c', '2026-10-20T12:00', 3)]).tiles;
    const noCurrent = metricsOf([deliveredAfter('p', '2026-10-12T12:00', 3)]).tiles;

    expect(noPrevious.leadTime.trend.median).toEqual({ previous: null, delta: null, ratio: null });
    expect(noCurrent.leadTime.median).toBeNull();
    expect(noCurrent.leadTime.trend.median).toEqual({ previous: 3 * DAY, delta: null, ratio: null });
  });

  it('ne donne pas de rapport quand la période précédente vaut 0, mais donne la différence', () => {
    const { tiles } = metricsOf([deliveredAfter('c', '2026-10-20T12:00', 3)]);

    expect(tiles.throughput.trend).toEqual({ previous: 0, delta: 1, ratio: null });
  });

  it('compare le Taux d’échec en points de proportion, et le WIP moyen', () => {
    const { tiles } = metricsOf([
      deliveredAfter('p1', '2026-10-12T12:00', 2),
      deliveredAfter('p2', '2026-10-14T12:00', 2),
      deliveredAfter('c1', '2026-10-18T12:00', 2),
      deliveredAfter('c2', '2026-10-20T12:00', 2),
      bug('b', '2026-10-21T08:00', 'c1'), // c1 est en échec : 1 Livraison sur 2 ; aucune en échec avant
      // En cours pendant toute la période précédente, puis jusqu'au 20 : WIP moyen 1, puis un peu plus de la moitié.
      ticket('w', [['open', '2026-10-01T08:00'], ['in_progress', '2026-10-09T22:00'], ['open', '2026-10-20T10:00']]),
    ]);

    expect(tiles.failureRate).toMatchObject({ deliveries: 2, failed: 1, rate: 0.5 });
    expect(tiles.failureRate.trend).toEqual({ previous: 0, delta: 0.5, ratio: null });
    expect(tiles.wip.trend.previous).toBe(1);
    expect(tiles.wip.average).toBeLessThan(1);
    expect(tiles.wip.trend.delta).toBeCloseTo(tiles.wip.average - 1, 10);
  });

  it('compare une plage personnalisée à la plage de même durée qui la précède', () => {
    const report = metricsOf(
      [deliveredAfter('p', '2026-10-05T12:00', 2), deliveredAfter('c1', '2026-10-12T12:00', 2), deliveredAfter('c2', '2026-10-14T12:00', 2)],
      { period: { from: '2026-10-11', to: '2026-10-15' } },
    );

    expect(report.previousPeriod).toMatchObject({ from: '2026-10-06', to: '2026-10-10', days: 5 }); // le 5 est avant : p n'y est pas
    expect(report.tiles.throughput.trend).toEqual({ previous: 0, delta: 2, ratio: null });

    const wide = metricsOf(
      [deliveredAfter('p', '2026-10-08T12:00', 2), deliveredAfter('c1', '2026-10-12T12:00', 2), deliveredAfter('c2', '2026-10-14T12:00', 2)],
      { period: { from: '2026-10-11', to: '2026-10-15' } },
    );
    expect(wide.tiles.throughput.trend).toEqual({ previous: 1, delta: 1, ratio: 1 });
  });
});

/**
 * Un flux parfaitement stable, d'un ticket par heure : chacun est créé 2 h puis démarré 1 h avant sa Livraison, à une
 * milliseconde de l'heure pile. Tous les 4 tickets, un bug relie son origine à la Livraison, à l'instant même de celle-ci.
 * Les deux tickets que `now` surprend en route y sont aussi : Livraisons, Arrivées, WIP et échecs sont les mêmes d'une
 * heure à l'autre, et d'une semaine à l'autre. Aucune période n'en devrait tirer de tendance.
 */
function steadyFlow(now: Date, hours: number): MetricsTicket[] {
  const tickets: MetricsTicket[] = [];
  for (let i = -2; i < hours; i++) {
    const closedAt = now.getTime() - i * HOUR - 1;
    const steps: [string, number][] = [
      ['open', closedAt - 2 * HOUR],
      ['in_progress', closedAt - HOUR],
      ['closed', closedAt],
    ];
    tickets.push({
      id: `t${i}`,
      title: `Ticket ${i}`,
      type: 'task',
      priority: 2,
      dependencies: [],
      statusSnapshots: steps.filter(([, instant]) => instant <= now.getTime()).map(([status, instant]) => ({ status, at: new Date(instant) })),
    });
    if (i >= 0 && i % 4 === 0) {
      tickets.push({
        id: `bug${i}`,
        title: `Bug ${i}`,
        type: 'bug',
        priority: 2,
        statusSnapshots: [{ status: 'open', at: new Date(closedAt) }],
        dependencies: [{ type: 'discovered-from', target: `t${i}`, addedAt: new Date(closedAt) }],
      });
    }
  }
  return tickets;
}

describe('comparaison à durée écoulée égale', () => {
  // Mardi 27 octobre 2026, 08:00 à Paris : la dernière journée de la période n'en est qu'au tiers.
  const MORNING = new Date('2026-10-27T07:00:00Z');
  const steady = [{ id: 'p', name: 'Projet P', analysis: analyzeProject(steadyFlow(MORNING, 200 * 24)) }];
  const steadyReport = (period: PeriodSpec) => computeMetrics(steady, { period, now: MORNING, timeZone: PARIS });

  it('compte la période précédente sur la même durée écoulée : un flux stable à 1 Livraison par heure n’a pas de tendance (7 j, le matin)', () => {
    const report = steadyReport({ range: '7d' });

    // 153 h écoulées depuis le début de la période (6 j 9 h dont les 25 h du 25 octobre) : 153 Livraisons ici comme là.
    expect(report.tiles.throughput).toEqual({ total: 153, trend: { previous: 153, delta: 0, ratio: 0 } });
    expect(report.tiles.arrivals).toEqual({ total: 192, trend: { previous: 192, delta: 0, ratio: 0 } }); // 153 tickets et 39 bugs
    expect(report.previousPeriod).toMatchObject({ from: '2026-10-14', to: '2026-10-20', days: 7 }); // la période précédente reste de 7 jours...
    expect(report.previousAsOf).toBe('2026-10-20T07:00:00.000Z'); // ...mais elle est comparée jusqu'à 07:00Z, comme asOf l'est ici
  });

  it.each(['7d', '30d', '90d'] as const)('%s : ni le Débit, ni les Arrivées, ni le Taux d’échec, ni les durées, ni le WIP ne changent d’une période à l’autre', (range) => {
    const { tiles } = steadyReport({ range });

    expect(tiles.throughput.trend).toMatchObject({ previous: tiles.throughput.total, delta: 0, ratio: 0 });
    expect(tiles.arrivals.trend).toMatchObject({ previous: tiles.arrivals.total, delta: 0, ratio: 0 });
    expect(tiles.failureRate.rate).toBeCloseTo(0.25, 1); // 1 Livraison sur 4 en échec, à une ou deux près
    expect(tiles.failureRate.trend).toMatchObject({ previous: tiles.failureRate.rate, delta: 0, ratio: 0 });
    expect(tiles.leadTime.trend.median).toEqual({ previous: 2 * HOUR, delta: 0, ratio: 0 });
    expect(tiles.cycleTime.trend.median).toEqual({ previous: HOUR, delta: 0, ratio: 0 });
    expect(tiles.wip.average).toBe(1); // une carte en cours à chaque instant : la moyenne pondérée par le temps vaut 1 partout...
    expect(tiles.wip.trend).toEqual({ previous: 1, delta: 0, ratio: 0 }); // ...avant comme après ce changement
  });

  it('compare de même une plage personnalisée dont la fin est aujourd’hui', () => {
    const report = steadyReport({ from: '2026-10-14', to: '2026-10-27' });

    expect(report.tiles.throughput.trend).toMatchObject({ previous: report.tiles.throughput.total, delta: 0, ratio: 0 });
    expect(report.tiles.arrivals.trend).toMatchObject({ delta: 0, ratio: 0 });
  });

  it('compare une période terminée à la période précédente entière', () => {
    const report = steadyReport({ from: '2026-10-14', to: '2026-10-20' });

    expect(report.asOf).toBe(report.period.end);
    expect(report.previousAsOf).toBe(report.previousPeriod.end);
    expect(report.tiles.throughput).toEqual({ total: 168, trend: { previous: 168, delta: 0, ratio: 0 } });
  });

  it('ne compte pas, dans la précédente, les Livraisons que la période courante n’a pas encore eu le temps de faire', () => {
    // Aux mêmes 153 h écoulées, la période précédente s'arrête à 07:00Z le 20 octobre (09:00 à Paris).
    const report = metricsOf(
      [
        closed('juste-avant', '2026-10-01T08:00', '2026-10-20T06:59:59'),
        closed('pile', '2026-10-01T08:00', '2026-10-20T07:00:00'), // premier instant hors de la fenêtre comparée
        closed('tard', '2026-10-01T08:00', '2026-10-20T15:00:00'), // encore dans la précédente entière, hors de la fenêtre comparée
        opened('arrivee-tardive', '2026-10-20T15:00'),
        opened('arrivee-tot', '2026-10-20T06:00'),
      ],
      { now: new Date('2026-10-27T07:00:00Z') },
    );

    expect(report.tiles.throughput.trend.previous).toBe(1); // « juste-avant » seule
    expect(report.tiles.arrivals.trend.previous).toBe(1); // « arrivee-tot » seule : les trois autres ont été créés le 1er
  });

  it('ne compare pas le WIP moyen à des heures que la période courante n’a pas encore vécues', () => {
    // En cours le 20 octobre de 15:00Z à 21:00Z : dans la précédente entière, mais après la fenêtre comparée (jusqu'à 07:00Z).
    const report = metricsOf([ticket('tard', [['open', '2026-10-01T08:00'], ['in_progress', '2026-10-20T15:00'], ['open', '2026-10-20T21:00']])], {
      now: new Date('2026-10-27T07:00:00Z'),
    });

    expect(report.tiles.wip.average).toBe(0);
    expect(report.tiles.wip.trend).toEqual({ previous: 0, delta: 0, ratio: null });
  });
});

describe('période en cours : rien de daté après asOf', () => {
  // L'horloge d'un commit peut avancer sur celle du serveur : l'événement est alors daté après maintenant. La période en
  // cours n'est pas finie. Comme la précédente, qui n'est comptée que jusqu'à previousAsOf, elle ne l'est que jusqu'à
  // asOf, et non jusqu'à minuit : sinon cet événement ne trouverait son équivalent que dans le futur.
  // NOW est 20:00 à Paris : la période court jusqu'à 22:00Z, la précédente (comptée jusqu'à 18:00Z) jusqu'au 16 à 22:00Z.
  const SOON = '2026-10-23T20:00'; // 2 h après NOW, avant minuit : dans la période, mais pas encore arrivé
  const SOON_BEFORE = '2026-10-16T20:00'; // son équivalent une période plus tôt : après previousAsOf, avant la fin de la précédente
  const sum = (buckets: MetricsReport['buckets'], key: 'deliveries' | 'arrivals') => buckets.reduce((total, b) => total + b[key], 0);
  const none = { median: null, p85: null, n: 0 };

  it('ne compte pas dans le Débit une Livraison datée après maintenant, et la précédente ne compte pas son équivalent', () => {
    const report = metricsOf([
      worked('futur', '2026-10-21T08:00', '2026-10-22T08:00', SOON),
      worked('equivalent', '2026-10-09T08:00', '2026-10-15T08:00', SOON_BEFORE),
    ]);

    expect(report.tiles.throughput).toEqual({ total: 0, trend: { previous: 0, delta: 0, ratio: null } });
    expect(report.cycleTimeScatter).toEqual([]);
  });

  it('ne compte pas dans les Arrivées un ticket créé après maintenant, et la précédente ne compte pas son équivalent', () => {
    const report = metricsOf([opened('futur', SOON), opened('equivalent', SOON_BEFORE)]);

    expect(report.tiles.arrivals).toEqual({ total: 0, trend: { previous: 0, delta: 0, ratio: null } });
  });

  it('ne mesure ni Lead Time, ni Cycle Time, ni Temps de rétablissement pour une Livraison datée après maintenant', () => {
    const report = metricsOf([
      worked('critique', '2026-10-21T08:00', '2026-10-22T08:00', SOON, { type: 'bug', priority: 0 }),
      worked('equivalent', '2026-10-09T08:00', '2026-10-15T08:00', SOON_BEFORE, { type: 'bug', priority: 0 }),
    ]);

    for (const tile of [report.tiles.leadTime, report.tiles.cycleTime, report.tiles.recoveryTime]) {
      expect(tile).toMatchObject(none);
      expect(tile.trend.median).toEqual({ previous: null, delta: null, ratio: null });
      expect(tile.trend.p85).toEqual({ previous: null, delta: null, ratio: null });
    }
  });

  it('ne compte pas dans le Taux d’échec une Livraison datée après maintenant, ni l’échec qu’elle aura', () => {
    const report = metricsOf([
      deliveredAfter('livree', '2026-10-20T12:00', 1),
      deliveredAfter('futur', SOON, 1),
      bug('origine', '2026-10-23T21:00', 'futur'), // l'échec de la Livraison à venir, daté plus tard encore
    ]);

    expect(report.tiles.failureRate).toMatchObject({ deliveries: 1, failed: 0, rate: 0 });
  });

  it.each([
    // Aujourd'hui n'a encore rien vu : ni Livraison, ni Arrivée.
    ['par jour', { range: '7d' }, { deliveries: 0, arrivals: 0 }],
    // La dernière semaine (du 19 au 23, tronquée) a bien vu « livree » et deux tickets créés les 21 et 22, mais pas les deux événements à venir.
    ['par semaine, la dernière tronquée', { range: '90d' }, { deliveries: 1, arrivals: 2 }],
  ] as [string, PeriodSpec, { deliveries: number; arrivals: number }][])('ne range dans aucun bucket ce qui est daté après maintenant (%s)', (_, period, last) => {
    const report = metricsOf(
      [
        worked('livree', '2026-10-22T08:00', '2026-10-22T09:00', '2026-10-22T10:00'),
        worked('livre-plus-tard', '2026-10-21T08:00', '2026-10-22T08:00', SOON), // créé le 21, livré à SOON
        opened('cree-plus-tard', SOON),
      ],
      { period },
    );

    expect(report.buckets.at(-1)).toMatchObject({ to: '2026-10-23', ...last });
    expect(report.tiles.throughput.total).toBe(1); // « livree »
    expect(report.tiles.arrivals.total).toBe(2); // « livree » et « livre-plus-tard » : pas « cree-plus-tard »
    expect(sum(report.buckets, 'deliveries')).toBe(report.tiles.throughput.total);
    expect(sum(report.buckets, 'arrivals')).toBe(report.tiles.arrivals.total);
  });

  it('ne met dans aucun découpage ce qui est daté après maintenant', () => {
    const { slices } = metricsOf([
      worked('livre-plus-tard', '2026-10-21T08:00', '2026-10-22T08:00', SOON, { type: 'chore', priority: 4 }),
      opened('cree-plus-tard', SOON, { type: 'spike', priority: 3 }),
    ]);

    const chore = slices.type.find((s) => s.key === 'chore');
    expect(chore).toMatchObject({ throughput: 0, arrivals: 1, failedDeliveries: 0, failureRate: null, wip: 1 }); // créé le 21, encore en cours à asOf
    expect(chore?.leadTime).toEqual(none);
    expect(chore?.cycleTime).toEqual(none);
    expect(slices.type.map((s) => s.key)).not.toContain('spike'); // ni Livraison, ni Arrivée, ni WIP
    expect(slices.priority.map((s) => s.key)).toEqual(['4']);
    expect(slices.project[0]).toMatchObject({ throughput: 0, arrivals: 1, wip: 1 }); // « livre-plus-tard », créé le 21 : pas « cree-plus-tard »
  });

  it('garde en cours, à asOf, le ticket que l’horloge date fermé plus tard : WIP, âge et CFD le voient encore en cours', () => {
    const report = metricsOf([worked('futur', '2026-10-21T08:00', '2026-10-22T08:00', SOON)]);

    expect(report.tiles.wip.current).toBe(1);
    expect(report.inProgress).toMatchObject([{ id: 'futur', status: 'in_progress', age: NOW.getTime() - at('2026-10-22T08:00').getTime() }]);
    expect(report.cfd.at(-1)).toMatchObject({ date: '2026-10-23', inProgress: 1, done: 0 });
  });

  describe.each([
    ['vendredi 23 octobre, 20:00 à Paris', NOW, '2026-10-23T18:00:00.000Z', '2026-10-16T18:00:00.000Z'],
    ['mardi 27 octobre, 08:00 à Paris : les 25 h du 25 sont dans la période', new Date('2026-10-27T07:00:00Z'), '2026-10-27T07:00:00.000Z', '2026-10-20T07:00:00.000Z'],
    ['lundi 2 novembre, 10:00 à Paris : les 25 h du 25 sont dans la précédente', new Date('2026-11-02T09:00:00Z'), '2026-11-02T09:00:00.000Z', '2026-10-26T08:00:00.000Z'],
  ])('%s', (_, now, asOf, previousAsOf) => {
    // Un événement à une distance donnée de asOf, et son équivalent à la même distance de previousAsOf : compté des deux
    // côtés s'il précède, des deux côtés pas s'il suit. La borne est exclue, ici comme pour la précédente.
    const local = (instant: number) => new Date(instant).toISOString().slice(0, -1); // au format des aides ci-dessus : UTC, sans le Z
    const delivery = (id: string, instant: number) => worked(id, local(instant - 20 * DAY), local(instant - DAY), local(instant));

    it('mesure à asOf et compare jusqu’à previousAsOf', () => {
      const report = metricsOf([], { now });

      expect(report.asOf).toBe(asOf);
      expect(report.previousAsOf).toBe(previousAsOf);
    });

    it.each([
      { label: '1 h avant', offset: -HOUR },
      { label: '1 ms avant', offset: -1 },
      { label: 'pile à', offset: 0 },
      { label: '1 ms après', offset: 1 },
      { label: '1 h après', offset: HOUR },
      { label: '3 h après', offset: 3 * HOUR },
    ])('un événement $label asOf et son équivalent $label previousAsOf sont comptés de même : Débit, Lead Time et Arrivées', ({ offset }) => {
      const counted = offset < 0 ? 1 : 0;
      const [here, there] = [Date.parse(asOf) + offset, Date.parse(previousAsOf) + offset];

      const delivered = metricsOf([delivery('ici', here), delivery('la', there)], { now });
      expect(delivered.tiles.throughput).toMatchObject({ total: counted, trend: { previous: counted } });
      expect(delivered.tiles.leadTime.n).toBe(counted);
      expect(delivered.tiles.leadTime.trend.median.previous === null).toBe(counted === 0);

      const arrived = metricsOf([opened('ici', local(here)), opened('la', local(there))], { now });
      expect(arrived.tiles.arrivals).toMatchObject({ total: counted, trend: { previous: counted } });
    });
  });

  describe('rapport complet', () => {
    /** Les tickets que NOW connaît : de quoi remplir chaque section du rapport. */
    const known = (): MetricsTicket[] => [
      worked('p-feature', '2026-10-08T08:00', '2026-10-11T08:00', '2026-10-12T12:00', { type: 'feature', priority: 1 }), // précédente
      closed('p-critique', '2026-10-12T08:00', '2026-10-13T09:00', { type: 'bug', priority: 0 }), // précédente, rétablissement
      worked('c-tache', '2026-10-15T08:00', '2026-10-18T08:00', '2026-10-20T08:00'),
      worked('c-critique', '2026-10-19T08:00', '2026-10-19T09:00', '2026-10-21T09:00', { type: 'bug', priority: 0 }),
      worked('c-echec', '2026-10-17T08:00', '2026-10-18T08:00', '2026-10-21T12:00', { type: 'feature', priority: 3 }),
      bug('c-origine', '2026-10-22T08:00', 'c-echec'), // met c-echec en échec
      ticket('en-cours', [['open', '2026-10-15T08:00'], ['in_progress', '2026-10-22T08:00']]),
      ticket('bloque', [['open', '2026-10-15T08:00'], ['in_progress', '2026-10-22T10:00']], {
        dependencies: [{ type: 'blocks', target: 'bloqueur', addedAt: at('2026-10-22T10:00') }],
      }),
      opened('arrivee', '2026-10-23T09:00'),
    ];
    /** Les tickets que l'horloge d'un commit en avance fait évoluer après NOW, et chacun tel que NOW le voit (null : pas encore créé). */
    const later: [future: MetricsTicket, seenNow: MetricsTicket | null][] = [
      [
        worked('livre-plus-tard', '2026-10-21T08:00', '2026-10-22T08:00', SOON, { type: 'chore', priority: 4 }),
        ticket('livre-plus-tard', [['open', '2026-10-21T08:00'], ['in_progress', '2026-10-22T08:00']], { type: 'chore', priority: 4 }),
      ],
      [opened('cree-plus-tard', SOON, { type: 'spike', priority: 3 }), null],
      [ticket('demarre-plus-tard', [['open', '2026-10-20T08:00'], ['in_progress', SOON]]), opened('demarre-plus-tard', '2026-10-20T08:00')],
      [
        closed('critique-plus-tard', '2026-10-22T08:00', SOON, { type: 'bug', priority: 0 }),
        opened('critique-plus-tard', '2026-10-22T08:00', { type: 'bug', priority: 0 }),
      ],
      [closed('bloqueur', '2026-10-21T08:00', SOON), opened('bloqueur', '2026-10-21T08:00')], // « bloque » l'attend encore à asOf
    ];

    it('compte ce que NOW connaît : de quoi rendre l’égalité ci-dessous significative', () => {
      const report = metricsOf([...known(), ...later.flatMap(([, seenNow]) => (seenNow ? [seenNow] : []))]);

      expect(report.tiles.throughput).toMatchObject({ total: 3, trend: { previous: 2 } }); // c-tache, c-critique et c-echec ; p-feature et p-critique
      expect(report.tiles.recoveryTime.n).toBe(1);
      expect(report.tiles.failureRate).toMatchObject({ deliveries: 3, failed: 1 });
      expect(report.inProgress.map((t) => [t.id, t.blocked])).toEqual([['en-cours', false], ['livre-plus-tard', false], ['bloque', true]]);
    });

    it.each([
      ['7 derniers jours', { range: '7d' }],
      ['90 derniers jours, par semaine', { range: '90d' }],
      ['plage personnalisée qui finit aujourd’hui', { from: '2026-10-20', to: '2026-10-23' }],
      ['aujourd’hui seulement', { from: '2026-10-23', to: '2026-10-23' }],
    ] as [string, PeriodSpec][])('%s : le rapport est celui que donnerait NOW sans ces événements', (_, period) => {
      const withLater = [...known(), ...later.map(([future]) => future)];
      const seenNow = [...known(), ...later.flatMap(([, ticketNow]) => (ticketNow ? [ticketNow] : []))];

      expect(metricsOf(withLater, { period })).toEqual(metricsOf(seenNow, { period }));
    });
  });

  it('compte une plage passée jusqu’à sa fin, quelle que soit l’heure à laquelle on la lit', () => {
    const tickets = [
      worked('dedans', '2026-10-15T08:00', '2026-10-19T08:00', '2026-10-21T21:59:59'), // 23:59:59 le 21 à Paris : la dernière seconde
      worked('dehors', '2026-10-15T08:00', '2026-10-19T08:00', '2026-10-21T22:00:00'), // minuit : dans la plage d'après
      worked('apres', '2026-10-15T08:00', '2026-10-19T08:00', '2026-10-30T09:00'), // longtemps après
      opened('arrivee', '2026-10-21T21:59:59'),
      opened('arrivee-apres', '2026-10-21T22:00:00'),
    ];

    const lendemain = metricsOf(tickets, { ...PAST, now: at('2026-10-22T10:00') });
    const plusTard = metricsOf(tickets, { ...PAST, now: at('2026-11-30T10:00') });

    expect(lendemain.asOf).toBe(lendemain.period.end);
    expect(lendemain.previousAsOf).toBe(lendemain.previousPeriod.end);
    expect(lendemain.tiles.throughput.total).toBe(1);
    expect(lendemain.tiles.arrivals.total).toBe(1);
    expect(plusTard).toEqual(lendemain);
  });
});

function metricsOfProjects(projects: Record<string, MetricsTicket[]>, { period = { range: '7d' }, now = NOW, timeZone = PARIS }: Options = {}): MetricsReport {
  return computeMetrics(
    Object.entries(projects).map(([id, tickets]) => ({ id, name: `Nom de ${id}`, analysis: analyzeProject(tickets) })),
    { period, now, timeZone },
  );
}

describe('découpages', () => {
  const world = () => [
    deliveredAfter('bug-1', '2026-10-18T12:00', 1, { type: 'bug', priority: 0 }),
    deliveredAfter('bug-2', '2026-10-19T12:00', 2, { type: 'bug', priority: 1 }),
    deliveredAfter('bug-3', '2026-10-20T12:00', 3, { type: 'bug', priority: 1 }),
    deliveredAfter('feat-1', '2026-10-21T12:00', 10, { type: 'feature', priority: 2 }),
    deliveredAfter('feat-2', '2026-10-22T12:00', 20, { type: 'feature', priority: 2 }),
    deliveredAfter('task-1', '2026-10-22T12:00', 5, { type: 'task', priority: 3 }),
    deliveredAfter('vieux', '2026-08-01T12:00', 5, { type: 'chore', priority: 4 }), // aucune activité dans la période
    ticket('encours', [['open', '2026-10-20T08:00'], ['in_progress', '2026-10-21T08:00']], { type: 'task', priority: 2 }), // en cours : du WIP
    bug('b-origine', '2026-10-21T13:00', 'feat-1'), // créé après la Livraison de feat-1 (12:00) : la met en échec
  ];

  it('découpe par type : Débit, Arrivées, durées, échecs et WIP, par Débit décroissant', () => {
    const { slices } = metricsOf(world());

    expect(slices.type.map((s) => [s.key, s.label, s.throughput])).toEqual([
      ['bug', 'bug', 3],
      ['feature', 'feature', 2],
      ['task', 'task', 1],
    ]);
    const bugs = slices.type[0];
    expect(bugs).toMatchObject({ arrivals: 4, failedDeliveries: 0, failureRate: 0, wip: 0 }); // 3 créés le 17 pour les Livraisons, plus « b-origine »
    expect(bugs?.leadTime).toEqual({ median: 2 * DAY, p85: closeTo(2.7 * DAY), n: 3 });
    const features = slices.type[1];
    expect(features).toMatchObject({ failedDeliveries: 1, failureRate: 0.5 });
    expect(features?.leadTime).toEqual({ median: 15 * DAY, p85: 18.5 * DAY, n: 2 });
  });

  it('découpe par priorité, de P0 à P4, avec « P<n> » pour libellé', () => {
    const { slices } = metricsOf(world());

    expect(slices.priority.map((s) => [s.key, s.label, s.throughput])).toEqual([
      ['0', 'P0', 1],
      ['1', 'P1', 2],
      ['2', 'P2', 2],
      ['3', 'P3', 1],
    ]);
  });

  it('ne garde que les groupes qui ont une Livraison, une Arrivée ou du WIP', () => {
    const { slices } = metricsOf(world());

    expect(slices.type.map((s) => s.key)).not.toContain('chore'); // sa seule Livraison est d'août
    expect(slices.priority.map((s) => s.key)).not.toContain('4');
    expect(slices.type.find((s) => s.key === 'task')).toMatchObject({ throughput: 1, wip: 1 });
  });

  it('range à égalité de Débit par nom de type', () => {
    const { slices } = metricsOf([
      deliveredAfter('a', '2026-10-20T12:00', 1, { type: 'task' }),
      deliveredAfter('b', '2026-10-20T12:00', 1, { type: 'bug' }),
    ]);

    expect(slices.type.map((s) => s.key)).toEqual(['bug', 'task']);
  });

  it('compte un type sans Livraison mais avec des Arrivées ou du WIP', () => {
    const { slices } = metricsOf([
      opened('nouveau', '2026-10-21T08:00', { type: 'spike' }),
      ticket('encours', [['open', '2026-10-01T08:00'], ['in_progress', '2026-10-02T08:00']], { type: 'chore' }),
    ]);

    expect(slices.type.find((s) => s.key === 'spike')).toMatchObject({ throughput: 0, arrivals: 1, wip: 0, failureRate: null });
    expect(slices.type.find((s) => s.key === 'spike')?.leadTime).toEqual({ median: null, p85: null, n: 0 });
    expect(slices.type.find((s) => s.key === 'chore')).toMatchObject({ throughput: 0, arrivals: 0, wip: 1 });
  });

  it('garde la somme des découpages égale aux totaux', () => {
    const report = metricsOfProjects({ a: world(), b: [deliveredAfter('b-1', '2026-10-21T12:00', 4, { type: 'feature' })] });
    const sum = (slices: { throughput: number }[]) => slices.reduce((total, s) => total + s.throughput, 0);

    for (const slices of [report.slices.type, report.slices.priority, report.slices.project]) {
      expect(sum(slices)).toBe(report.tiles.throughput.total);
      expect(slices.reduce((total, s) => total + s.arrivals, 0)).toBe(report.tiles.arrivals.total);
      expect(slices.reduce((total, s) => total + s.wip, 0)).toBe(report.tiles.wip.current);
      expect(slices.reduce((total, s) => total + s.failedDeliveries, 0)).toBe(report.tiles.failureRate.failed);
    }
  });

  describe('Couverture et caractère significatif du Taux d’échec de chaque découpage', () => {
    it('joint à chaque Projet la Couverture de ses propres bugs, et dit si son Taux d’échec est significatif', () => {
      const report = metricsOfProjects({
        fiable: bugsWithCoverage(6, 6), // 6 bugs, tous reliés
        lacunaire: bugsWithCoverage(6, 1), // 6 bugs, un seul relié
        vide: [],
      });

      expect(report.slices.project.map((s) => [s.key, s.coverage, s.significant])).toEqual([
        ['fiable', { bugs: 6, linked: 6, ratio: 1 }, true],
        ['lacunaire', { bugs: 6, linked: 1, ratio: 1 / 6 }, false],
        ['vide', { bugs: 0, linked: 0, ratio: null }, false],
      ]);
    });

    it('joint à chaque type et à chaque priorité la Couverture de tous les bugs mesurés : un bug n’a ni le type ni la priorité de la Livraison qu’il met en échec', () => {
      const report = metricsOfProjects({ fiable: bugsWithCoverage(6, 6), lacunaire: bugsWithCoverage(6, 1) });
      const overall = { bugs: 12, linked: 7, ratio: 7 / 12 }; // 58 % : la Couverture des Projets additionnés, pas celle du pire d'entre eux

      expect(report.tiles.failureRate.coverage).toEqual(overall);
      expect(report.slices.type.length).toBeGreaterThan(0);
      expect(report.slices.priority.length).toBeGreaterThan(0);
      for (const slice of [...report.slices.type, ...report.slices.priority]) {
        expect(slice).toMatchObject({ coverage: overall, significant: true });
      }
    });

    it('marque non significatif le Taux d’échec de tous les découpages par type et par priorité quand la Couverture globale est faible', () => {
      const report = metricsOfProjects({ a: bugsWithCoverage(6, 1), b: bugsWithCoverage(6, 2) }); // 3 bugs reliés sur 12 : 25 %

      for (const slice of [...report.slices.type, ...report.slices.priority, ...report.slices.project]) {
        expect(slice.significant).toBe(false);
      }
      expect(report.tiles.failureRate.significant).toBe(false);
    });

    it.each([
      [6, 3, true], // 50 % exactement : pas « inférieure à 50 % »
      [5, 5, true], // 5 bugs exactement : pas « moins de 5 »
      [6, 2, false], // 33 %
      [4, 4, false], // 4 bugs, tous reliés
      [0, 0, false], // aucun bug
    ])('%i bugs dont %i reliés : significatif = %s, comme pour la tuile', (bugs, linked, significant) => {
      const report = metricsOf(bugsWithCoverage(bugs, linked));

      expect(report.tiles.failureRate.significant).toBe(significant);
      expect(report.slices.project[0]).toMatchObject({ significant, coverage: report.tiles.failureRate.coverage });
      expect(report.slices.type.find((s) => s.key === 'task')).toMatchObject({ significant, coverage: report.tiles.failureRate.coverage });
      expect(report.slices.priority.find((s) => s.key === '2')).toMatchObject({ significant, coverage: report.tiles.failureRate.coverage });
    });
  });

  it('découpe par Projet : tous les Projets mesurés, dans l’ordre donné, même sans activité', () => {
    const report = metricsOfProjects({
      zeta: [deliveredAfter('z-1', '2026-10-20T12:00', 2)],
      alpha: [],
      milieu: [deliveredAfter('m-1', '2026-10-20T12:00', 6), deliveredAfter('m-2', '2026-10-21T12:00', 8)],
    });

    expect(report.slices.project.map((s) => [s.key, s.label, s.throughput])).toEqual([
      ['zeta', 'Nom de zeta', 1],
      ['alpha', 'Nom de alpha', 0],
      ['milieu', 'Nom de milieu', 2],
    ]);
    expect(report.slices.project[2]?.leadTime).toEqual({ median: 7 * DAY, p85: closeTo(7.7 * DAY), n: 2 });
  });
});

describe('Vue globale : agrégation des Projets', () => {
  it('recalcule médiane et P85 sur l’union des Livraisons, jamais sur les médianes des Projets', () => {
    const a = [1, 2, 3].map((days) => leadingDays(`a-${days}`, days));
    const b = [20, 30, 40, 50, 60].map((days) => leadingDays(`b-${days}`, days));

    const global = metricsOfProjects({ a, b }).tiles.leadTime;

    expect(metricsOfProjects({ a }).tiles.leadTime.median).toBe(2 * DAY);
    expect(metricsOfProjects({ b }).tiles.leadTime.median).toBe(40 * DAY);
    // Union triée : 1 2 3 20 30 40 50 60 (n = 8) → médiane au milieu de 20 j et 30 j (25 j), P85 au rang 6,95 (49,5 j) ;
    // la moyenne des médianes des Projets ferait 21 j, la moyenne de leurs P85 (2,7 j et 54 j) 28,35 j.
    expect(global).toMatchObject({ median: 25 * DAY, p85: 49.5 * DAY, n: 8 });
  });

  it('donne le même résultat qu’un Projet qui contiendrait tous les tickets', () => {
    const a = [
      deliveredAfter('a-1', '2026-10-18T12:00', 3, { type: 'bug', priority: 0 }),
      worked('a-2', '2026-10-15T08:00', '2026-10-16T08:00', '2026-10-21T12:00'),
      opened('a-3', '2026-10-22T08:00'),
      ticket('a-4', [['open', '2026-10-01T08:00'], ['in_progress', '2026-10-05T08:00']]),
    ];
    const b = [
      deliveredAfter('b-1', '2026-10-19T12:00', 9, { type: 'feature' }),
      worked('b-2', '2026-10-10T08:00', '2026-10-12T08:00', '2026-10-22T12:00'),
      bug('b-3', '2026-10-22T09:00', 'b-1'),
      ticket('b-4', [['open', '2026-10-20T08:00'], ['blocked', '2026-10-21T08:00']]),
    ];

    const union = metricsOfProjects({ a, b });
    const merged = metricsOf([...a, ...b]);

    expect(union.tiles).toEqual(merged.tiles);
    expect(union.buckets).toEqual(merged.buckets);
    expect(union.cfd).toEqual(merged.cfd);
    expect(union.slices.type).toEqual(merged.slices.type);
    expect(union.slices.priority).toEqual(merged.slices.priority);
    expect(union.inProgress.map((t) => t.id)).toEqual(merged.inProgress.map((t) => t.id));
    expect(union.cycleTimeScatter.map((t) => t.id)).toEqual(merged.cycleTimeScatter.map((t) => t.id));
    expect(union.tiles.throughput.total).toBe(4);
  });

  it('additionne la Couverture des Projets : la Couverture globale n’est pas la moyenne de leurs ratios', () => {
    const a = [closed('a-ref', '2026-10-01T08:00', '2026-10-20T10:00'), bug('a-b1', '2026-10-21T08:00', 'a-ref'), bug('a-b2', '2026-10-21T08:00', 'a-ref')]; // 2 bugs, 2 reliés : 100 %
    const b = [
      closed('b-ref', '2026-10-01T08:00', '2026-10-20T10:00'),
      bug('b-b1', '2026-10-21T08:00', 'b-ref'),
      bug('b-b2', '2026-10-21T08:00', 'b-ref'),
      ...Array.from({ length: 6 }, (_, i) => bug(`b-seul-${i}`, '2026-10-21T08:00')), // 8 bugs, 2 reliés : 25 %
    ];

    const { failureRate } = metricsOfProjects({ a, b }).tiles;

    expect(failureRate.coverage).toEqual({ bugs: 10, linked: 4, ratio: 0.4 }); // la moyenne des ratios ferait 62,5 % : significatif à tort
    expect(failureRate).toMatchObject({ significant: false, reasons: ['low-coverage'], deliveries: 2, failed: 2, rate: 1 });
  });

  it('n’emprunte aucune dépendance à un autre Projet : un ticket n’y est pas bloqué par un ticket qui n’existe pas chez lui', () => {
    const a = [
      ticket('a-1', [['open', '2026-10-01T08:00'], ['in_progress', '2026-10-02T08:00']], {
        dependencies: [{ type: 'blocks', target: 'b-1', addedAt: at('2026-10-02T08:00') }],
      }),
    ];
    const b = [opened('b-1', '2026-10-01T08:00')];

    const report = metricsOfProjects({ a, b });

    expect(report.inProgress).toMatchObject([{ id: 'a-1', project: 'a', blocked: false }]);
  });

  it('nomme le Projet de chaque point du nuage et de chaque ticket en cours', () => {
    const report = metricsOfProjects({
      a: [worked('a-1', '2026-10-15T08:00', '2026-10-16T08:00', '2026-10-21T12:00')],
      b: [ticket('b-1', [['open', '2026-10-01T08:00'], ['in_progress', '2026-10-02T08:00']])],
    });

    expect(report.cycleTimeScatter.map((p) => [p.id, p.project])).toEqual([['a-1', 'a']]);
    expect(report.inProgress.map((t) => [t.id, t.project])).toEqual([['b-1', 'b']]);
  });

  it('mesure zéro Projet sans erreur', () => {
    const report = metricsOfProjects({});

    expect(report.tiles.throughput.total).toBe(0);
    expect(report.tiles.failureRate.coverage).toEqual({ bugs: 0, linked: 0, ratio: null });
    expect(report.slices).toEqual({ type: [], priority: [], project: [] });
    expect(report.cfd).toHaveLength(7);
  });
});

describe('horloge de commit qui recule', () => {
  // L'horloge d'un commit peut reculer : sa date précède alors celle du commit d'avant. Une Transition n'est jamais datée avant la
  // précédente du même ticket (voir `analyzeFlow`) : Débit, Lead Time, Cycle Time et CFD lisent les mêmes dates, et le Cycle Time
  // tient dans le Lead Time.
  it('mesure un Cycle Time qui ne dépasse pas le Lead Time : tuiles et nuage de points', () => {
    const report = metricsOf([worked('a', '2026-10-21T10:00', '2026-10-21T05:00', '2026-10-21T20:00')]); // démarré « 5 h avant » la création

    expect(report.tiles.leadTime).toMatchObject({ median: 10 * HOUR, n: 1 });
    expect(report.tiles.cycleTime).toMatchObject({ median: 10 * HOUR, n: 1 }); // 15 h sans cela
    expect(report.cycleTimeScatter.map((point) => point.cycleTime)).toEqual([10 * HOUR]);
  });

  it('ne mesure jamais un Lead Time négatif : une clôture datée avant la création tombe à la création', () => {
    const report = metricsOf([closed('a', '2026-10-21T10:00', '2026-10-20T10:00')]);

    expect(report.tiles.leadTime).toMatchObject({ median: 0, n: 1 });
    expect(report.buckets.find((bucket) => bucket.deliveries > 0)?.from).toBe('2026-10-21'); // livré le jour de sa création, pas la veille
  });

  it('compte la Livraison le jour où le CFD range le ticket en Terminé, même quand l’horloge de sa clôture a reculé', () => {
    // Créé le 19, démarré le 21 à 08:00Z, mais sa clôture est datée du 20 : elle a eu lieu après le démarrage, donc le 21 au plus tôt.
    const report = metricsOf([worked('a', '2026-10-19T08:00', '2026-10-21T08:00', '2026-10-20T09:00')]);

    const deliveries = report.buckets.map((bucket) => bucket.deliveries);
    const cumulative = deliveries.map((_, index) => deliveries.slice(0, index + 1).reduce((total, count) => total + count, 0));
    expect(report.buckets.find((bucket) => bucket.deliveries > 0)?.from).toBe('2026-10-21');
    expect(report.cfd.map((point) => point.done)).toEqual(cumulative);
    expect(report.tiles.leadTime).toMatchObject({ median: 2 * DAY, n: 1 });
  });

  it.each(CLOCKS)('tient, sur des historiques tirés au hasard dont l’horloge recule, les durées d’une Livraison dans l’ordre : Lead Time ≥ Cycle Time ≥ temps bloqué, et ses dates avec (%s)', (_, sharedClock) => {
    const random = seededRandom(20_261_108);
    let delivered = 0;
    let clockBack = 0;
    let started = 0;
    for (let round = 0; round < 300; round++) {
      const histories = randomHistories(random, { tickets: 5, clockBack: 25, sharedClock });
      const { tickets } = analyzeProject(histories.map((history) => ({ ...history, title: history.id, priority: 2 })));
      for (const tracked of tickets) {
        if (tracked.deliveredAt === null) continue;
        delivered++;
        const where = `${round}/${tracked.id}`;
        if (clockWentBack(histories.find((history) => history.id === tracked.id)?.statusSnapshots ?? [])) clockBack++;
        const [leadTime, cycleTime, blockedTime, dependencyWait] = [tracked.leadTime ?? NaN, tracked.cycleTime ?? 0, tracked.blockedTime ?? NaN, tracked.dependencyWait ?? NaN];
        // Le Lead Time est l'écart entre les deux dates du ticket, créé avant d'être livré.
        expect(tracked.deliveredAt - tracked.createdAt, `${where} : Lead Time`).toBe(leadTime);
        expect(leadTime, `${where} : Lead Time`).toBeGreaterThanOrEqual(0);
        expect(cycleTime, `${where} : Cycle Time ≤ Lead Time`).toBeLessThanOrEqual(leadTime);
        expect(blockedTime, `${where} : temps bloqué ≤ Cycle Time`).toBeLessThanOrEqual(cycleTime);
        expect(blockedTime, `${where} : temps bloqué`).toBeGreaterThanOrEqual(0);
        expect(dependencyWait + cycleTime, `${where} : Attente de dépendance + Cycle Time ≤ Lead Time`).toBeLessThanOrEqual(leadTime);
        expect(dependencyWait, `${where} : Attente de dépendance`).toBeGreaterThanOrEqual(0);
        // Un ticket démarré l'est entre sa création et sa Livraison ; il a un Cycle Time, et inversement.
        expect(tracked.cycleTime === null, `${where} : démarré ou non`).toBe(tracked.startedAt === null);
        if (tracked.startedAt !== null) {
          started++;
          expect(tracked.startedAt, `${where} : démarrage`).toBeGreaterThanOrEqual(tracked.createdAt);
          expect(tracked.startedAt, `${where} : démarrage`).toBeLessThanOrEqual(tracked.deliveredAt);
        }
      }
    }
    expect(clockBack).toBeGreaterThan(300);
    expect(started).toBeGreaterThan(500);
    expect(delivered).toBeGreaterThan(1000);
  });
});
