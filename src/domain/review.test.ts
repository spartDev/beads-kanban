import { describe, expect, it } from 'vitest';
import type { DeclaredStatuses } from '../shared/api';
import { analyzeProject, computeMetrics, type MetricsInput, type MetricsTicket } from './metrics';
import { computeReview, MIN_REVIEWED_DELIVERIES, reviewOf } from './review';
import { NO_DECLARED_STATUSES } from './statuses';

/**
 * Tours de relecture, Retours et mesures de relecture (bdesk-pz0.5, ADR 0007). Les historiques sont fictifs ; chaque scénario dit les dates qu'il
 * fabrique, en jours avant l'instant de la mesure, sur une période de 7 jours.
 */

const PARIS = 'Europe/Paris';
/** Vendredi 23 octobre 2026, 18:00Z (20:00 à Paris). */
const NOW = Date.parse('2026-10-23T18:00:00Z');
const DAY = 24 * 3_600_000;
const ago = (days: number) => NOW - days * DAY;

/** Un statut personnalisé de catégorie `wip`, qui compte comme en cours, et un autre de catégorie `active`, qui reste « En pause ». */
const DECLARED: DeclaredStatuses = {
  handoff: ['in_review', 'in_integration', 'awaiting_human'],
  others: [
    { name: 'fixing', category: 'wip' },
    { name: 'parked', category: 'active' },
  ],
};

const steps = (...statuses: string[]) => statuses.map((status) => ({ status }));

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

/** Une Livraison fermée il y a un jour, dont les statuts intermédiaires se suivent d'heure en heure à partir d'il y a 5 jours. */
const delivered = (id: string, middle: string[], extra: Partial<MetricsTicket> = {}) =>
  ticket(id, [['open', ago(6)], ...middle.map((status, i): [string, number] => [status, ago(5) + i * 3_600_000]), ['closed', ago(1)]], extra);

const project = (tickets: MetricsTicket[], declared: DeclaredStatuses = NO_DECLARED_STATUSES, id = 'p'): MetricsInput => ({
  id,
  name: `Projet ${id}`,
  analysis: analyzeProject(tickets, declared),
});

const options = { period: { range: '7d' }, now: new Date(NOW), timeZone: PARIS } as const;
const reviewIn = (projects: MetricsInput[]) => computeReview(projects, options);

describe('Tours de relecture et Retours d’un ticket', () => {
  it('aucun Tour : un ticket développé puis fermé, sans Statut de relais', () => {
    expect(reviewOf(steps('open', 'in_progress', 'closed'), NO_DECLARED_STATUSES)).toEqual({
      rounds: 0,
      sendBacks: { review: 0, integration: 0, validation: 0 },
    });
  });

  it('un Tour accepté : relu, intégré, validé, sans revenir au développement', () => {
    expect(reviewOf(steps('open', 'in_progress', 'in_review', 'in_integration', 'awaiting_human', 'closed'), NO_DECLARED_STATUSES)).toEqual({
      rounds: 1,
      sendBacks: { review: 0, integration: 0, validation: 0 },
    });
  });

  it.each([
    ['in_review', 'in_progress', 'review'],
    ['in_review', 'hooked', 'review'],
    ['in_integration', 'in_progress', 'integration'],
    ['in_integration', 'hooked', 'integration'],
    ['awaiting_human', 'in_progress', 'validation'],
    ['awaiting_human', 'hooked', 'validation'],
  ] as const)('un Retour de %s vers %s a pour origine %s', (from, to, origin) => {
    const { sendBacks } = reviewOf(steps('open', 'in_progress', from, to, 'closed'), NO_DECLARED_STATUSES);
    expect(sendBacks).toEqual({ review: 0, integration: 0, validation: 0, [origin]: 1 });
  });

  it('un Retour vers un statut que le Projet déclare `wip` : il compte comme en cours', () => {
    expect(reviewOf(steps('open', 'in_progress', 'in_review', 'fixing', 'in_review', 'closed'), DECLARED)).toEqual({
      rounds: 2,
      sendBacks: { review: 1, integration: 0, validation: 0 },
    });
    // Le même statut, que le Projet ne déclare pas, ou déclare d'une autre catégorie, reste « En pause » : ce n'est pas un Retour.
    expect(reviewOf(steps('open', 'in_review', 'fixing', 'closed'), NO_DECLARED_STATUSES).sendBacks.review).toBe(0);
    expect(reviewOf(steps('open', 'in_review', 'parked', 'closed'), DECLARED).sendBacks.review).toBe(0);
  });

  it('d’un Statut de relais à un autre : pas de Retour, mais un nouveau Tour s’il mène En relecture', () => {
    expect(reviewOf(steps('open', 'in_progress', 'in_integration', 'in_review', 'in_integration', 'awaiting_human', 'in_review', 'closed'), DECLARED)).toEqual({
      rounds: 2,
      sendBacks: { review: 0, integration: 0, validation: 0 },
    });
  });

  it('vers bloqué, ouvert, différé ou fermé : pas un Retour', () => {
    for (const to of ['blocked', 'open', 'deferred', 'closed']) {
      expect(reviewOf(steps('in_progress', 'in_review', to), DECLARED).sendBacks).toEqual({ review: 0, integration: 0, validation: 0 });
    }
    // Repartir au développement depuis bloqué n'est pas un Retour non plus, même après une relecture.
    expect(reviewOf(steps('in_review', 'blocked', 'in_progress'), DECLARED).sendBacks.review).toBe(0);
  });

  it('un ticket créé En relecture : sa première Transition est un Tour', () => {
    expect(reviewOf(steps('in_review', 'closed'), NO_DECLARED_STATUSES).rounds).toBe(1);
  });
});

describe('mesures de relecture de la période', () => {
  it('aucun Tour, aucune Livraison : tout est vide ou indéfini', () => {
    expect(reviewIn([project([ticket('o', [['open', ago(3)]])])])).toEqual({
      deliveries: 0,
      reviewed: 0,
      coverage: null,
      firstPassAcceptance: { accepted: 0, reviewed: 0, rate: null, significant: false, minReviewed: 10 },
      roundsPerDelivery: { one: 0, two: 0, three: 0, fourOrMore: 0 },
      failureRate: expect.objectContaining({
        reviewed: { deliveries: 0, failed: 0, rate: null },
        unreviewed: { deliveries: 0, failed: 0, rate: null },
      }),
      sendBacks: { review: 0, integration: 0, validation: 0 },
    });
  });

  it('une Livraison relue acceptée et une Livraison non relue : Couverture de relecture de moitié, Acceptation entière', () => {
    const review = reviewIn([
      project([delivered('relue', ['in_progress', 'in_review', 'in_integration']), delivered('non-relue', ['in_progress'])]),
    ]);
    expect(review).toMatchObject({
      deliveries: 2,
      reviewed: 1,
      coverage: 0.5,
      firstPassAcceptance: { accepted: 1, reviewed: 1, rate: 1, significant: false },
      roundsPerDelivery: { one: 1, two: 0, three: 0, fourOrMore: 0 },
    });
  });

  it('un Retour depuis chacun des trois statuts : la Livraison n’est pas acceptée au premier passage, et chaque Retour compte à son origine', () => {
    const review = reviewIn([
      project([
        delivered('r', ['in_progress', 'in_review', 'in_progress', 'in_review']),
        delivered('i', ['in_progress', 'in_review', 'in_integration', 'hooked', 'in_integration']),
        delivered('v', ['in_progress', 'in_review', 'awaiting_human', 'in_progress', 'awaiting_human']),
        delivered('ok', ['in_progress', 'in_review']),
      ]),
    ]);
    expect(review.firstPassAcceptance).toMatchObject({ accepted: 1, reviewed: 4, rate: 0.25 });
    expect(review.sendBacks).toEqual({ review: 1, integration: 1, validation: 1 });
    expect(review.roundsPerDelivery).toEqual({ one: 3, two: 1, three: 0, fourOrMore: 0 });
  });

  it('un Retour d’une Livraison non relue (depuis En intégration) compte par origine, sans toucher l’Acceptation', () => {
    const review = reviewIn([project([delivered('pr', ['in_progress', 'in_integration', 'in_progress', 'in_integration'])])]);
    expect(review).toMatchObject({ deliveries: 1, reviewed: 0, coverage: 0, firstPassAcceptance: { accepted: 0, reviewed: 0, rate: null } });
    expect(review.sendBacks).toEqual({ review: 0, integration: 1, validation: 0 });
  });

  it('des Tours après une Réouverture : la Livraison compte une fois, à sa dernière clôture, avec ses Tours et Retours d’avant la Réouverture', () => {
    const reopened = ticket('re', [
      ['open', ago(20)],
      ['in_progress', ago(19)],
      ['in_review', ago(18)],
      ['closed', ago(17)],
      ['in_progress', ago(4)],
      ['in_review', ago(3)],
      ['in_progress', ago(2.5)],
      ['in_review', ago(2)],
      ['closed', ago(1)],
    ]);
    const review = reviewIn([project([reopened])]);
    expect(review).toMatchObject({ deliveries: 1, reviewed: 1, firstPassAcceptance: { accepted: 0, reviewed: 1 } });
    expect(review.roundsPerDelivery).toEqual({ one: 0, two: 0, three: 1, fourOrMore: 0 });
    expect(review.sendBacks).toEqual({ review: 1, integration: 0, validation: 0 });
    // Une période qui ne voit que la première clôture n'a pas de Livraison : la Réouverture l'a annulée.
    const before = computeReview([project([reopened])], { ...options, period: { from: '2026-10-05', to: '2026-10-07' } });
    expect(before.deliveries).toBe(0);
  });

  it('Tours par Livraison : 1, 2, 3, et 4 ou plus', () => {
    const rounds = (id: string, n: number) => delivered(id, ['in_progress', ...Array.from({ length: n }, () => ['in_review', 'in_integration']).flat()]);
    const review = reviewIn([project([rounds('a', 1), rounds('b', 2), rounds('c', 3), rounds('d', 4), rounds('e', 6), rounds('f', 0)])]);
    expect(review.roundsPerDelivery).toEqual({ one: 1, two: 1, three: 1, fourOrMore: 2 });
    expect(review.reviewed).toBe(5);
    // D'En intégration à En relecture : ni Retour, ni échec du premier passage.
    expect(review.firstPassAcceptance.accepted).toBe(5);
  });

  it('un Tour sans clôture, ou dont la clôture tombe hors de la période, ne compte pas', () => {
    const review = reviewIn([
      project([
        ticket('en-relecture', [['open', ago(4)], ['in_progress', ago(3)], ['in_review', ago(2)]]),
        ticket('relance', [['open', ago(4)], ['in_review', ago(3)], ['in_progress', ago(2)]]),
        ticket('ancienne', [['open', ago(30)], ['in_review', ago(29)], ['in_progress', ago(28.5)], ['closed', ago(28)]]),
      ]),
    ]);
    expect(review).toMatchObject({ deliveries: 0, reviewed: 0, sendBacks: { review: 0, integration: 0, validation: 0 } });
  });

  it('un Abandon et un Renoncement relus ne sont pas des Livraisons : ils n’entrent dans aucune mesure, comme dans le Débit', () => {
    const relu = ['in_progress', 'in_review', 'in_progress', 'in_review'];
    const tickets = [
      delivered('doublon', relu, { dependencies: [{ type: 'duplicates', target: 'autre', addedAt: new Date(ago(2)) }] }),
      delivered('remplace', relu, { dependencies: [{ type: 'supersedes', target: 'autre', addedAt: new Date(ago(2)) }] }),
      delivered('renonce', relu, { labels: ['declined'] }),
      delivered('livre', ['in_progress']),
    ];
    const review = reviewIn([project(tickets)]);
    expect(review).toMatchObject({ deliveries: 1, reviewed: 0, sendBacks: { review: 0, integration: 0, validation: 0 } });
    expect(review.deliveries).toBe(computeMetrics([project(tickets)], options).tiles.throughput.total);
  });

  it.each([
    [MIN_REVIEWED_DELIVERIES - 1, false],
    [MIN_REVIEWED_DELIVERIES, true],
  ])('le seuil : %i Livraisons relues, Acceptation au premier passage significative : %s', (n, significant) => {
    const tickets = Array.from({ length: n }, (_, i) => delivered(`t${i}`, ['in_progress', 'in_review', ...(i === 0 ? ['in_progress', 'in_review'] : [])]));
    const { firstPassAcceptance } = reviewIn([project([...tickets, delivered('non-relue', ['in_progress'])])]);
    expect(firstPassAcceptance).toEqual({ accepted: n - 1, reviewed: n, rate: (n - 1) / n, significant, minReviewed: 10 });
  });

  it('Taux d’échec après relecture : celui des Livraisons relues à côté de celui des autres ; le Taux d’échec global ne change pas', () => {
    const bug = (id: string, origin: string) =>
      ticket(id, [['open', ago(0.5)]], { type: 'bug', dependencies: [{ type: 'discovered-from', target: origin, addedAt: new Date(ago(0.5)) }] });
    const tickets = [
      delivered('relue-ko', ['in_progress', 'in_review']),
      delivered('relue-ok', ['in_progress', 'in_review']),
      delivered('relue-ok2', ['in_progress', 'in_review', 'in_progress', 'in_review']),
      delivered('brute-ko', ['in_progress']),
      bug('b1', 'relue-ko'),
      bug('b2', 'brute-ko'),
    ];
    const projects = [project(tickets)];
    const review = reviewIn(projects);
    const tile = computeMetrics(projects, options).tiles.failureRate;
    expect(review.failureRate.reviewed).toEqual({ deliveries: 3, failed: 1, rate: 1 / 3 });
    expect(review.failureRate.unreviewed).toEqual({ deliveries: 1, failed: 1, rate: 1 });
    expect(review.failureRate.reviewed.deliveries + review.failureRate.unreviewed.deliveries).toBe(tile.deliveries);
    expect(review.failureRate.reviewed.failed + review.failureRate.unreviewed.failed).toBe(tile.failed);
    expect(tile).toMatchObject({ deliveries: 4, failed: 2, rate: 0.5 });
    // Significatif par la règle du Taux d'échec : ici deux bugs, trop peu.
    expect(review.failureRate).toMatchObject({ significant: tile.significant, reasons: tile.reasons, coverage: tile.coverage });
  });

  it('la Vue globale : un seul calcul sur l’union des Projets, chacun avec les statuts qu’il déclare', () => {
    const a = project([delivered('a1', ['in_progress', 'in_review', 'fixing', 'in_review'])], DECLARED, 'a');
    const b = project([delivered('b1', ['in_progress', 'in_review', 'fixing', 'in_review']), delivered('b2', ['in_progress'])], NO_DECLARED_STATUSES, 'b');
    const global = reviewIn([a, b]);
    // `fixing` est un statut de travail de « a », pas de « b » : seul le Retour de « a » compte.
    expect(global).toMatchObject({ deliveries: 3, reviewed: 2, firstPassAcceptance: { accepted: 1, reviewed: 2, rate: 0.5 } });
    expect(global.sendBacks.review).toBe(1);
    expect(global.roundsPerDelivery.two).toBe(2);
    expect(reviewIn([a]).sendBacks.review).toBe(1);
    expect(reviewIn([b]).sendBacks.review).toBe(0);
  });
});
