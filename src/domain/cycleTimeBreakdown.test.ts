import { describe, expect, it } from 'vitest';
import type { DeclaredStatuses } from '../shared/api';
import { computeCycleTimeBreakdown, type CycleTimeParts, cycleTimePartsOf } from './cycleTimeBreakdown';
import type { DependencyHistory } from './flow';
import { computeHealth } from './health';
import { analyzeProject, computeMetrics, type MetricsInput, type MetricsOptions, type MetricsTicket } from './metrics';
import { isHandoffStatus, NO_DECLARED_STATUSES } from './statuses';
import { CLOCKS, randomHistories, randomLineage, seededRandom } from './testing/random-histories';

/**
 * Décomposition du Cycle Time et Attente humaine (bdesk-pz0.6, ADR 0007). Les historiques sont fictifs ; chaque scénario dit les heures qu'il fabrique,
 * à partir d'il y a 5 jours, sur une période de 7 jours mesurée le vendredi 23 octobre 2026 à 18:00Z.
 */

const PARIS = 'Europe/Paris';
/** Vendredi 23 octobre 2026, 18:00Z (20:00 à Paris). */
const NOW = Date.parse('2026-10-23T18:00:00Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Il y a 5 jours : l'heure 0 des scénarios. */
const T0 = NOW - 5 * DAY;
const h = (hours: number) => T0 + hours * HOUR;

/** Un statut personnalisé de catégorie `wip`, qui compte comme en cours. */
const DECLARED: DeclaredStatuses = { handoff: ['in_review', 'in_integration', 'awaiting_human'], others: [{ name: 'fixing', category: 'wip' }] };

const NONE: CycleTimeParts = { review: 0, integration: 0, humanWait: 0, blocked: 0, development: 0, correction: 0 };

function ticket(id: string, statuses: [string, number][], extra: Partial<MetricsTicket> = {}): MetricsTicket {
  return {
    id,
    title: `Titre de ${id}`,
    type: 'task',
    priority: 2,
    statusSnapshots: statuses.map(([status, at]) => ({ status, at: new Date(at) })),
    dependencies: [],
    ...extra,
  };
}

/** Un ticket créé à l'heure −1, puis ses statuts aux heures données. */
const story = (id: string, statuses: [string, number][], extra: Partial<MetricsTicket> = {}) => ticket(id, [['open', h(-1)], ...statuses.map(([s, hours]): [string, number] => [s, h(hours)])], extra);

/** Une dépendance bloquante vers `target`, posée et retirée aux heures données. */
const blocks = (target: string, from: number, to?: number): DependencyHistory => ({
  type: 'blocks',
  target,
  addedAt: new Date(h(from)),
  ...(to === undefined ? {} : { removedAt: new Date(h(to)) }),
});

const project = (tickets: MetricsTicket[], declared: DeclaredStatuses = NO_DECLARED_STATUSES, id = 'p'): MetricsInput => ({
  id,
  name: `Projet ${id}`,
  analysis: analyzeProject(tickets, declared),
});

/** Les parts du ticket `id`, avec son Cycle Time et son temps bloqué tels que les métriques les mesurent. */
function partsOf(tickets: MetricsTicket[], id: string, declared: DeclaredStatuses = NO_DECLARED_STATUSES) {
  const tracked = analyzeProject(tickets, declared).tickets.find((candidate) => candidate.id === id);
  if (tracked?.deliveredAt == null) throw new Error(`${id} n’est pas une Livraison`);
  const parts = cycleTimePartsOf(tracked.timeline, declared, tracked.deliveredAt);
  return { parts, cycleTime: tracked.cycleTime, blockedTime: tracked.blockedTime, sum: sumOf(parts) };
}

/** Le temps brut d'une suite de statuts datés dans les Statuts de relais, Blocage compris. */
const handoffTimeOf = (steps: readonly { status: string; at: number }[]) =>
  steps.reduce((total, step, index) => total + (isHandoffStatus(step.status) ? (steps[index + 1]?.at ?? step.at) - step.at : 0), 0);

const sumOf = (parts: CycleTimeParts) => parts.review + parts.integration + parts.humanWait + parts.blocked + parts.development + parts.correction;

const options: MetricsOptions = { period: { range: '7d' }, now: new Date(NOW), timeZone: PARIS };
const breakdownIn = (projects: MetricsInput[], overrides: Partial<MetricsOptions> = {}) => computeCycleTimeBreakdown(projects, { ...options, ...overrides });

describe('les six parts du Cycle Time d’une Livraison', () => {
  it('Relecture, Intégration, Attente humaine, Développement avant le premier Retour, Correction après', () => {
    const { parts, cycleTime, sum } = partsOf(
      [
        story('t', [
          ['in_progress', 1], // Développement : 2 h
          ['in_review', 3], // Relecture : 1 h
          ['in_progress', 4], // le premier Retour : Correction, 2 h
          ['in_review', 6], // Relecture : 1 h
          ['in_integration', 7], // Intégration : 2 h
          ['awaiting_human', 9], // Attente humaine : 3 h
          ['closed', 12],
        ]),
      ],
      't',
    );
    expect(parts).toEqual({ review: 2 * HOUR, integration: 2 * HOUR, humanWait: 3 * HOUR, blocked: 0, development: 2 * HOUR, correction: 2 * HOUR });
    expect(sum).toBe(cycleTime);
    expect(cycleTime).toBe(11 * HOUR);
  });

  it('sans Statut de relais ni Retour, tout le travail est du Développement, rattaché à un agent compris', () => {
    const { parts, cycleTime } = partsOf([story('t', [['in_progress', 1], ['open', 3], ['hooked', 5], ['closed', 9]])], 't');
    expect(parts).toEqual({ ...NONE, development: 6 * HOUR });
    expect(cycleTime).toBe(6 * HOUR);
  });

  it('un Retour avant le premier Tour (d’En intégration) coupe aussi le travail', () => {
    const { parts } = partsOf([story('t', [['in_progress', 1], ['in_integration', 2], ['in_progress', 4], ['in_review', 7], ['closed', 8]])], 't');
    expect(parts).toEqual({ ...NONE, development: HOUR, integration: 2 * HOUR, correction: 3 * HOUR, review: HOUR });
  });

  it('un Retour d’À valider coupe le travail comme les autres', () => {
    const { parts } = partsOf([story('t', [['in_progress', 1], ['awaiting_human', 2], ['in_progress', 5], ['closed', 6]])], 't');
    expect(parts).toEqual({ ...NONE, development: HOUR, humanWait: 3 * HOUR, correction: HOUR });
  });

  it('ce qui n’est pas un Retour ne coupe rien : d’En intégration à En relecture, d’un Statut de relais à ouvert, à bloqué ou à un statut non déclaré', () => {
    const { parts } = partsOf(
      [
        story('t', [
          ['in_progress', 1], // Développement : 1 h
          ['in_integration', 2], // 1 h
          ['in_review', 3], // 1 h
          ['open', 4], // ni Retour ni travail : 1 h hors du Cycle Time
          ['in_progress', 5], // Développement : 1 h
          ['in_review', 6], // 1 h
          ['blocked', 7], // Blocage : 1 h
          ['in_progress', 8], // Développement : 1 h
          ['awaiting_human', 9], // 1 h
          ['fixing', 10], // non déclaré ici : « En pause », hors du Cycle Time
          ['hooked', 11], // depuis un statut qui n'est pas de relais : Développement, 1 h
          ['closed', 12],
        ]),
      ],
      't',
    );
    expect(parts).toEqual({ review: 2 * HOUR, integration: HOUR, humanWait: HOUR, blocked: HOUR, development: 4 * HOUR, correction: 0 });
  });

  it('un Retour vers un statut que le Projet déclare de catégorie `wip` en est un : ce travail est de la Correction', () => {
    const tickets = [story('t', [['in_progress', 1], ['in_review', 2], ['fixing', 3], ['in_progress', 5], ['closed', 6]])];
    expect(partsOf(tickets, 't', DECLARED).parts).toEqual({ ...NONE, development: HOUR, review: HOUR, correction: 3 * HOUR });
    // Sans la déclaration, `fixing` n'est pas un statut de travail : ni Retour, ni Cycle Time ; le retour en cours qui suit n'en est pas un non plus.
    expect(partsOf(tickets, 't').parts).toEqual({ ...NONE, development: 2 * HOUR, review: HOUR });
  });

  it('la coupe est le premier Retour : les suivants n’y changent rien', () => {
    const { parts } = partsOf(
      [story('t', [['in_progress', 1], ['in_review', 2], ['in_progress', 3], ['in_review', 4], ['in_progress', 5], ['in_review', 7], ['closed', 8]])],
      't',
    );
    expect(parts).toEqual({ ...NONE, development: HOUR, review: 3 * HOUR, correction: 3 * HOUR });
  });

  it('une Réouverture : le travail d’après compte en Correction s’il y a eu un Retour avant, en Développement sinon ; le temps fermé n’en est pas', () => {
    const withSendBack = story('a', [['in_progress', 1], ['in_review', 2], ['in_progress', 3], ['in_review', 4], ['closed', 5], ['in_progress', 10], ['closed', 12]]);
    expect(partsOf([withSendBack], 'a').parts).toEqual({ ...NONE, development: HOUR, review: 2 * HOUR, correction: 3 * HOUR });
    const withoutSendBack = story('b', [['in_progress', 1], ['in_review', 2], ['closed', 5], ['in_progress', 10], ['closed', 12]]);
    expect(partsOf([withoutSendBack], 'b').parts).toEqual({ ...NONE, development: 3 * HOUR, review: 3 * HOUR });
    // Un Retour après la Réouverture coupe là.
    const afterReopening = story('c', [['in_progress', 1], ['closed', 2], ['in_review', 4], ['in_progress', 5], ['closed', 7]]);
    expect(partsOf([afterReopening], 'c').parts).toEqual({ ...NONE, development: HOUR, review: HOUR, correction: 2 * HOUR });
  });

  it('Blocage prioritaire : un temps à la fois de relais (ou de travail) et de Blocage compte en Blocage, une seule fois quand les Blocages se chevauchent', () => {
    // La cible reste ouverte jusqu'à l'heure 20 ; deux dépendances se chevauchent : de l'heure 2 à 4, et de 3 à 6.
    const target = story('cible', [['closed', 20]]);
    const tickets = [
      target,
      story(
        't',
        [
          ['in_progress', 1], // 1 → 2 Développement ; 2 → 3 Blocage
          ['in_review', 3], // 3 → 5 Blocage ; 5 → 6 Blocage (statut bloqué aussi, compté une fois)
          ['blocked', 5], //
          ['in_progress', 6], // pas un Retour (depuis bloqué) : 6 → 7 Développement
          ['in_review', 7], // 7 → 8 Relecture
          ['closed', 8],
        ],
        { dependencies: [blocks('cible', 2, 4), blocks('cible', 3, 6)] },
      ),
    ];
    const { parts, cycleTime, blockedTime, sum } = partsOf(tickets, 't');
    expect(parts).toEqual({ ...NONE, development: 2 * HOUR, blocked: 4 * HOUR, review: HOUR });
    expect(blockedTime).toBe(4 * HOUR);
    expect(sum).toBe(cycleTime);
  });

  it('le Blocage pris sur chaque Statut de relais et sur la Correction ne compte qu’en Blocage', () => {
    const target = story('cible', [['closed', 30]]);
    const tickets = [
      target,
      story(
        't',
        [
          ['in_progress', 1], // 1 → 2 Développement
          ['in_review', 2], // 2 → 4 : 1 h de Relecture, 1 h de Blocage (2 → 3)
          ['in_progress', 4], // Retour : 4 → 6, 1 h de Correction, 1 h de Blocage (5 → 6)
          ['in_integration', 6], // 6 → 8 : 1 h d'Intégration, 1 h de Blocage (7 → 8)
          ['awaiting_human', 8], // 8 → 11 : 2 h d'Attente humaine, 1 h de Blocage (10 → 11)
          ['closed', 11],
        ],
        { dependencies: [blocks('cible', 2, 3), blocks('cible', 5, 6), blocks('cible', 7, 8), blocks('cible', 10, 11)] },
      ),
    ];
    const { parts, cycleTime, sum } = partsOf(tickets, 't');
    expect(parts).toEqual({ development: HOUR, review: HOUR, correction: HOUR, integration: HOUR, humanWait: 2 * HOUR, blocked: 4 * HOUR });
    expect(sum).toBe(cycleTime);
  });

  it('un Blocage hors du travail (en Backlog, ou après la clôture) n’entre pas dans le Cycle Time', () => {
    const target = story('cible', [['closed', 30]]);
    const tickets = [target, story('t', [['in_progress', 3], ['in_review', 4], ['closed', 5]], { dependencies: [blocks('cible', 0, 3), blocks('cible', 5)] })];
    expect(partsOf(tickets, 't').parts).toEqual({ ...NONE, development: HOUR, review: HOUR });
  });

  it('un ticket encore ouvert : ses parts s’arrêtent à `end`, finies, et s’additionnent à son temps de travail jusque-là', () => {
    const target = story('cible', [['closed', 40]]);
    const open = story('t', [['in_progress', 0], ['in_review', 2], ['in_progress', 3], ['awaiting_human', 5]], { dependencies: [blocks('cible', 6)] });
    const tracked = analyzeProject([target, open], NO_DECLARED_STATUSES).tickets.find((candidate) => candidate.id === 't');
    if (!tracked) throw new Error('t introuvable');
    // À l'heure 8 : 2 h de Développement, 1 h de Relecture, 2 h de Correction, 1 h À valider, puis 2 h À valider en Blocage (la dépendance court encore).
    const parts = cycleTimePartsOf(tracked.timeline, NO_DECLARED_STATUSES, h(8));
    expect(parts).toEqual({ development: 2 * HOUR, review: HOUR, correction: 2 * HOUR, humanWait: HOUR, blocked: 2 * HOUR, integration: 0 });
    expect(sumOf(parts)).toBe(8 * HOUR);
    // Avant la Relecture : le Retour qui vient ensuite ne coupe encore rien.
    expect(cycleTimePartsOf(tracked.timeline, NO_DECLARED_STATUSES, h(1))).toEqual({ ...NONE, development: HOUR });
  });

  it('une Livraison jamais démarrée n’a aucune part', () => {
    expect(partsOf([story('t', [['closed', 3]])], 't').parts).toEqual(NONE);
  });
});

describe('Décomposition du Cycle Time de la période', () => {
  const chain = (id: string, close: number, extra: Partial<MetricsTicket> = {}) =>
    ticket(id, [['open', T0], ['in_progress', T0 + HOUR], ['in_review', T0 + 2 * HOUR], ['in_progress', T0 + 3 * HOUR], ['awaiting_human', T0 + 4 * HOUR], ['closed', close]], extra);

  it('additionne les parts des Livraisons de la période ; la somme est le Cycle Time cumulé, ses parts travail et Blocage dans la Décomposition du Lead Time', () => {
    const projects = [project([chain('a', h(6)), chain('b', h(10)), story('c', [['in_progress', 0], ['closed', 2]])])];
    const breakdown = breakdownIn(projects);
    expect(breakdown).toMatchObject({
      deliveries: 3,
      review: 2 * HOUR,
      development: 4 * HOUR, // 1 h par chaîne, 2 h pour « c »
      correction: 2 * HOUR,
      humanWait: 2 * HOUR + 6 * HOUR,
      integration: 0,
      blocked: 0,
      total: 16 * HOUR,
    });
    const { leadTimeBreakdown } = computeHealth(projects, options);
    expect(breakdown.total).toBe(leadTimeBreakdown.work + leadTimeBreakdown.blocked);
    expect(breakdown.deliveries).toBe(leadTimeBreakdown.deliveries);
  });

  it('la période est celle du Débit : jours du fuseau de la requête, début compris, fin à maintenant exclue', () => {
    // 7 jours à Paris, mesurés le 23 octobre à 18:00Z : du samedi 17 octobre à minuit (16 octobre 22:00Z) jusqu'à maintenant.
    const closedAt = (id: string, at: number) =>
      ticket(id, [['open', Date.parse('2026-10-14T00:00:00Z')], ['in_progress', Date.parse('2026-10-15T00:00:00Z')], ['awaiting_human', Date.parse('2026-10-16T00:00:00Z')], ['closed', at]]);
    const cases = [
      [closedAt('debut', Date.parse('2026-10-16T22:00:00Z')), 1],
      [closedAt('veille', Date.parse('2026-10-16T21:59:59.999Z')), 0],
      [closedAt('maintenant', NOW), 0],
      [closedAt('avant', NOW - 1), 1],
    ] as const;
    for (const [delivery, expected] of cases) {
      const projects = [project([delivery])];
      expect(computeMetrics(projects, options).tiles.throughput.total).toBe(expected);
      expect(breakdownIn(projects)).toMatchObject({ deliveries: expected, development: expected * DAY, humanWaits: { waited: expected } });
    }
    // Le fuseau : à 23:00Z le 16 octobre, il est déjà le 17 à Paris, pas encore en UTC, où la période commence le 17 à 00:00Z.
    const late = [project([closedAt('tard', Date.parse('2026-10-16T23:00:00Z'))])];
    expect(breakdownIn(late).deliveries).toBe(1);
    expect(breakdownIn(late, { timeZone: 'UTC' }).deliveries).toBe(0);
    expect(computeMetrics(late, { ...options, timeZone: 'UTC' }).tiles.throughput.total).toBe(0);

    // Une période finie, du 19 au 21 octobre à Paris : sa fin est le 22 à minuit (21 octobre 22:00Z), exclue.
    const past = { period: { from: '2026-10-19', to: '2026-10-21' } } as const;
    expect(breakdownIn([project([closedAt('fin', Date.parse('2026-10-21T22:00:00Z'))])], past).deliveries).toBe(0);
    expect(breakdownIn([project([closedAt('avant-fin', Date.parse('2026-10-21T21:59:59.999Z'))])], past).deliveries).toBe(1);
  });

  it('un Abandon et un Renoncement n’entrent pas ; une Livraison rouverte compte une fois, à sa dernière clôture, avec tout son Cycle Time', () => {
    const tickets = [
      chain('doublon', h(6), { dependencies: [{ type: 'duplicates', target: 'autre', addedAt: new Date(h(5)) }] }),
      chain('remplace', h(6), { dependencies: [{ type: 'supersedes', target: 'autre', addedAt: new Date(h(5)) }] }),
      chain('renonce', h(6), { labels: ['declined'] }),
      story('rouverte', [['in_progress', 0], ['in_review', 1], ['in_progress', 2], ['closed', 3], ['in_progress', 5], ['closed', 6]]),
      // Fermée avant la période, rouverte et toujours ouverte : rien.
      ticket('ouverte', [['open', NOW - 20 * DAY], ['in_progress', NOW - 19 * DAY], ['closed', NOW - 18 * DAY], ['in_progress', h(1)]]),
    ];
    const breakdown = breakdownIn([project(tickets)]);
    expect(breakdown).toMatchObject({ deliveries: 1, development: HOUR, review: HOUR, correction: 2 * HOUR, humanWait: 0, total: 4 * HOUR });
    expect(breakdown.deliveries).toBe(computeMetrics([project(tickets)], options).tiles.throughput.total);
  });

  it('la Vue globale : un seul calcul sur l’union des Projets, chacun avec les statuts qu’il déclare', () => {
    const fixing = (id: string) => story(id, [['in_progress', 0], ['in_review', 1], ['fixing', 2], ['closed', 4]]);
    const a = project([fixing('a1')], DECLARED, 'a');
    const b = project([fixing('b1')], NO_DECLARED_STATUSES, 'b');
    // « a » : `fixing` est de la Correction, après un Retour ; « b » : `fixing` n'est pas un statut de travail.
    expect(breakdownIn([a])).toMatchObject({ development: HOUR, review: HOUR, correction: 2 * HOUR, total: 4 * HOUR });
    expect(breakdownIn([b])).toMatchObject({ development: HOUR, review: HOUR, correction: 0, total: 2 * HOUR });
    expect(breakdownIn([a, b])).toMatchObject({ deliveries: 2, development: 2 * HOUR, review: 2 * HOUR, correction: 2 * HOUR, total: 6 * HOUR });
  });

  it('sans Livraison : tout est nul, la part de l’Attente humaine indéfinie', () => {
    expect(breakdownIn([project([])])).toEqual({
      deliveries: 0,
      total: 0,
      ...NONE,
      humanWaits: { waited: 0, stats: { median: null, p85: null, n: 0 }, reliable: false, minDeliveries: 4, share: null },
    });
    // Des Livraisons jamais démarrées : un Cycle Time cumulé nul, la part reste indéfinie.
    expect(breakdownIn([project([story('t', [['closed', 2]])])])).toMatchObject({ deliveries: 1, total: 0, humanWaits: { share: null } });
  });
});

describe('Attente humaine par Livraison', () => {
  /** Une Livraison démarrée à l'heure 0, À valider `wait` heures à partir de l'heure 1, fermée à la fin de l'attente. */
  const waiting = (id: string, wait: number, extra: Partial<MetricsTicket> = {}) =>
    story(id, [['in_progress', 0], ...(wait > 0 ? ([['awaiting_human', 1]] as [string, number][]) : []), ['closed', 1 + wait]], extra);

  it('médiane et P85 des Livraisons qui ont attendu, seulement ; sa part du Cycle Time cumulé', () => {
    const projects = [project([waiting('a', 1), waiting('b', 2), waiting('c', 4), waiting('d', 10), waiting('e', 0)])];
    const { humanWaits, humanWait, total } = breakdownIn(projects);
    // Échantillon trié : 1, 2, 4, 10 h. Médiane : (2 + 4) / 2 ; P85 : rang 1 + 0,85 × 3 = 3,55, entre 4 et 10 h.
    expect(humanWaits).toEqual({
      waited: 4,
      stats: { median: 3 * HOUR, p85: 4 * HOUR + 0.55 * 6 * HOUR, n: 4 },
      reliable: true,
      minDeliveries: 4,
      share: (17 * HOUR) / (22 * HOUR),
    });
    expect(humanWait).toBe(17 * HOUR);
    expect(total).toBe(22 * HOUR);
  });

  it.each([
    [3, false],
    [4, true],
  ])('le seuil de la Tendance longue : %i Livraisons qui ont attendu, centiles fiables : %s', (n, reliable) => {
    const tickets = Array.from({ length: n }, (_, i) => waiting(`t${i}`, 1));
    expect(breakdownIn([project([...tickets, waiting('sans', 0)])]).humanWaits).toMatchObject({ waited: n, reliable, minDeliveries: 4 });
  });

  it('l’Attente humaine d’une Livraison est son temps À valider hors Blocage, tous passages confondus', () => {
    const target = story('cible', [['closed', 40]]);
    const tickets = [
      target,
      // À valider de 1 à 5 (dont 2 h bloquées), puis de 7 à 8.
      story('t', [['in_progress', 0], ['awaiting_human', 1], ['in_progress', 5], ['awaiting_human', 7], ['closed', 8]], { dependencies: [blocks('cible', 2, 4)] }),
    ];
    const breakdown = breakdownIn([project(tickets)]);
    expect(breakdown).toMatchObject({ humanWait: 3 * HOUR, blocked: 2 * HOUR, development: HOUR, correction: 2 * HOUR, total: 8 * HOUR });
    expect(breakdown.humanWaits).toMatchObject({ waited: 1, stats: { median: 3 * HOUR, p85: 3 * HOUR, n: 1 }, share: 3 / 8 });
  });

  it('une Livraison passée À valider, mais tout ce temps en Blocage, n’a pas attendu l’utilisateur', () => {
    const tickets = [story('cible', [['closed', 40]]), story('t', [['in_progress', 0], ['awaiting_human', 1], ['closed', 3]], { dependencies: [blocks('cible', 0)] })];
    expect(breakdownIn([project(tickets)])).toMatchObject({ humanWait: 0, blocked: 3 * HOUR, humanWaits: { waited: 0, share: 0 } });
  });
});

describe('propriétés, sur des historiques tirés au hasard', () => {
  /** Les statuts de base, les trois Statuts de relais et `fixing`, déclaré de catégorie `wip` : Retours, Tours et Réouvertures en nombre. */
  const STATUSES = ['open', 'in_progress', 'blocked', 'deferred', 'hooked', 'closed', 'in_review', 'in_integration', 'awaiting_human', 'fixing', 'in_progress', 'in_review'];
  /** Des périodes qui couvrent les tirages, du 1er octobre 2026 (leur début) à bien après. */
  const PERIODS = [{ range: '7d' }, { range: '30d' }, { range: '90d' }, { from: '2026-10-01', to: '2026-10-20' }, { from: '2026-10-08', to: '2026-11-30' }] as const;

  it.each(CLOCKS)('les six parts s’additionnent au Cycle Time de chaque Livraison, et leur somme sur la période à travail + Blocage de la Décomposition du Lead Time (%s)', (_, sharedClock) => {
    const random = seededRandom(20_261_116);
    const counts = { delivered: 0, handoffBlocked: 0, reopened: 0, review: 0, correction: 0, humanWait: 0, periods: 0 };
    for (let round = 0; round < 200; round++) {
      const histories = randomHistories(random, { tickets: 6, clockBack: 15, sharedClock, statuses: STATUSES });
      const input = project(histories.map((history) => ({ ...history, title: history.id, priority: 2 })), DECLARED);
      for (const tracked of input.analysis.tickets) {
        if (tracked.deliveredAt === null) continue;
        counts.delivered++;
        const parts = cycleTimePartsOf(tracked.timeline, DECLARED, tracked.deliveredAt);
        expect(sumOf(parts), `${round}/${tracked.id} : six parts = Cycle Time`).toBe(tracked.cycleTime ?? 0);
        expect(parts.blocked, `${round}/${tracked.id} : Blocage = temps bloqué`).toBe(tracked.blockedTime ?? 0);
        for (const value of Object.values(parts)) expect(value).toBeGreaterThanOrEqual(0);
        if (parts.correction > 0) counts.correction++;
        if (parts.review > 0) counts.review++;
        if (parts.humanWait > 0) counts.humanWait++;
        // Un relais pendant un Blocage : le temps brut dans les Statuts de relais dépasse leurs trois parts, qui l'ont cédé au Blocage.
        if (handoffTimeOf(tracked.timeline.steps) > parts.review + parts.integration + parts.humanWait) counts.handoffBlocked++;
        if (tracked.timeline.steps.slice(0, -1).some((step) => step.status === 'closed')) counts.reopened++;
      }
      for (const period of PERIODS) {
        const at = { period, now: new Date(Date.UTC(2026, 11, 1)), timeZone: round % 2 === 0 ? PARIS : 'America/New_York' };
        const breakdown = computeCycleTimeBreakdown([input], at);
        const { leadTimeBreakdown, efficiency } = computeHealth([input], at);
        if (breakdown.deliveries > 0) counts.periods++;
        expect(breakdown.deliveries).toBe(leadTimeBreakdown.deliveries);
        expect(breakdown.total).toBe(sumOf(breakdown));
        expect(breakdown.total, `${round} : Cycle Time cumulé = travail + Blocage`).toBe(leadTimeBreakdown.work + leadTimeBreakdown.blocked);
        expect(breakdown.blocked).toBe(leadTimeBreakdown.blocked);
        expect(breakdown.total).toBe(efficiency.cycleTime);
      }
    }
    expect(counts.delivered).toBeGreaterThan(400);
    expect(counts.correction).toBeGreaterThan(50);
    expect(counts.review).toBeGreaterThan(100);
    expect(counts.humanWait).toBeGreaterThan(100);
    expect(counts.handoffBlocked).toBeGreaterThan(20);
    expect(counts.reopened).toBeGreaterThan(50);
    expect(counts.periods).toBeGreaterThan(300);
  });

  it('sans Statut de relais ni Retour, tout le travail est en Développement : la décomposition redonne les parts travail et Blocage du Lead Time', () => {
    for (const seed of [7, 21, 1337]) {
      const { histories } = randomLineage(seededRandom(seed), { tickets: 40, clockBack: 10, sharedClock: true });
      const input = project(histories.map((history) => ({ ...history, title: history.id, priority: 2 })));
      for (const period of PERIODS) {
        const at = { period, now: new Date(Date.UTC(2026, 11, 1)), timeZone: PARIS };
        const breakdown = computeCycleTimeBreakdown([input], at);
        const { leadTimeBreakdown } = computeHealth([input], at);
        expect(breakdown).toMatchObject({ review: 0, integration: 0, humanWait: 0, correction: 0, development: leadTimeBreakdown.work, blocked: leadTimeBreakdown.blocked });
        expect(breakdown.humanWaits).toMatchObject({ waited: 0, share: breakdown.total === 0 ? null : 0 });
      }
      expect(computeCycleTimeBreakdown([input], { period: { range: '90d' }, now: new Date(Date.UTC(2026, 11, 1)), timeZone: PARIS }).development).toBeGreaterThan(0);
    }
  });
});
