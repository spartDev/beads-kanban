import { describe, expect, it } from 'vitest';
import type { MetricsCoverage, MetricsSlice, MetricsTiles } from '../../shared/api';
import type { SeriesContext } from './series';
import { describeSlices, explainInsignificance } from './slices';

/**
 * Le tableau des découpages. Le contrat dit une chose qu'il serait facile de défaire à l'affichage : la Couverture
 * d'un découpage par type ou par priorité est celle de tous les Projets mesurés, car le bug qui met une Livraison
 * en échec n'a ni son type ni sa priorité. Le `significant` d'une ligne « Bug » n'est donc pas propre aux bugs :
 * on ne l'écrit pas ligne à ligne comme s'il l'était. Par Projet, la Couverture est bien celle du Projet.
 */

const NBSP = '\u00a0';

const ctx: SeriesContext = {
  projectName: (id) => id,
  projectHue: () => 120,
};

const coverage = (bugs: number, linked: number): MetricsCoverage => ({ bugs, linked, ratio: bugs === 0 ? null : linked / bugs });

const stats = (median: number | null, p85: number | null, n: number) => ({ median, p85, n });

const slice = (key: string, label: string, overrides: Partial<MetricsSlice> = {}): MetricsSlice => ({
  key,
  label,
  throughput: 10,
  arrivals: 12,
  leadTime: stats(3_600_000, 7_200_000, 10),
  cycleTime: stats(1_800_000, 3_600_000, 8),
  failedDeliveries: 1,
  failureRate: 0.1,
  coverage: coverage(36, 13),
  significant: false,
  wip: 2,
  ...overrides,
});

const THRESHOLDS = { minCoverage: 0.5, minBugs: 5 };

const tiles = (overrides: Partial<MetricsTiles['failureRate']> = {}): Pick<MetricsTiles, 'throughput' | 'leadTime' | 'cycleTime' | 'failureRate' | 'wip'> => ({
  throughput: { total: 64, trend: { previous: 9, delta: 55, ratio: 6.1 } },
  leadTime: { ...stats(296_930_437, 995_720_583, 64), trend: { median: { previous: null, delta: null, ratio: null }, p85: { previous: null, delta: null, ratio: null } } },
  cycleTime: { ...stats(87_690_325, 408_549_341, 52), trend: { median: { previous: null, delta: null, ratio: null }, p85: { previous: null, delta: null, ratio: null } } },
  failureRate: {
    deliveries: 64,
    failed: 1,
    rate: 0.015625,
    coverage: coverage(67, 13),
    significant: false,
    reasons: ['low-coverage'],
    reason: 'Couverture insuffisante : 19 % des bugs ont une origine renseignée (minimum 50 %).',
    thresholds: THRESHOLDS,
    trend: { previous: null, delta: null, ratio: null },
    ...overrides,
  },
  wip: { current: 11, average: 9.9, trend: { previous: null, delta: null, ratio: null } },
});

describe('describeSlices : par type', () => {
  const slices = [
    slice('bug', 'bug', { throughput: 26, failedDeliveries: 1, failureRate: 1 / 26 }),
    slice('feature', 'feature', { throughput: 9, failedDeliveries: 0, failureRate: 0 }),
    slice('chore', 'chore', { throughput: 0, failedDeliveries: 0, failureRate: null, leadTime: stats(null, null, 0), cycleTime: stats(null, null, 0) }),
  ];

  it('garde l’ordre de l’API et nomme les types en français', () => {
    const view = describeSlices({ slices, dimension: 'type', tiles: tiles(), ctx });
    expect(view.rows.map((row) => [row.key, row.label])).toEqual([
      ['bug', 'Bug'],
      ['feature', 'Fonctionnalité'],
      ['chore', 'Maintenance'],
    ]);
    expect(view.rows[0]).toMatchObject({ throughput: 26, wip: 2, series: { key: 'bug', color: 'var(--type-bug)' }, href: null });
  });

  it('ne dit pas « non significatif » ligne à ligne : la Couverture n’est pas celle du type, elle est celle de tous les Projets', () => {
    const view = describeSlices({ slices, dimension: 'type', tiles: tiles(), ctx });
    expect(view.failureColumn).toBe(false);
    expect(view.coverageNote).toContain(`Couverture insuffisante : 19${NBSP}% des bugs ont une origine renseignée (minimum 50${NBSP}%).`);
    expect(view.coverageNote).toContain('tous les Projets mesurés');
    expect(view.coverageNote).toContain('ni le type ni la priorité');
  });

  it('affiche le Taux d’échec de chaque type quand la Couverture, celle de tous les Projets, suffit', () => {
    const significant = slices.map((row) => ({ ...row, significant: true, coverage: coverage(40, 30) }));
    const view = describeSlices({ slices: significant, dimension: 'type', tiles: tiles({ significant: true, reasons: [], reason: null, coverage: coverage(40, 30) }), ctx });
    expect(view.failureColumn).toBe(true);
    expect(view.rows[0]?.failure).toEqual({ kind: 'rate', rate: 1 / 26, failed: 1, deliveries: 26 });
    expect(view.rows[1]?.failure).toEqual({ kind: 'rate', rate: 0, failed: 0, deliveries: 9 });
    expect(view.rows[2]?.failure).toEqual({ kind: 'empty' });
    expect(view.coverageNote).toContain(`75${NBSP}%`);
    expect(view.coverageNote).toContain('tous les Projets mesurés');
  });
});

describe('describeSlices : par priorité', () => {
  it('nomme les priorités avec leur code et leur libellé', () => {
    const view = describeSlices({
      slices: [slice('1', 'P1'), slice('3', 'P3')],
      dimension: 'priority',
      tiles: tiles(),
      ctx,
    });
    expect(view.rows.map((row) => row.label)).toEqual(['P1 · Haute', 'P3 · Basse']);
    expect(view.rows[0]?.series).toMatchObject({ key: '1', color: 'var(--prio-1)' });
    expect(view.failureColumn).toBe(false);
  });
});

describe('describeSlices : par Projet', () => {
  const slices = [
    slice('mpm', 'My-Prompt-Manager', { significant: true, coverage: coverage(36, 30), throughput: 56, failedDeliveries: 7, failureRate: 7 / 56 }),
    slice('sais', 'sanofi-ai-standards', { significant: false, coverage: coverage(28, 0), throughput: 5, failedDeliveries: 0, failureRate: 0 }),
    slice('vide', 'projet-vide', { significant: false, coverage: coverage(0, 0), throughput: 0, failedDeliveries: 0, failureRate: null }),
  ];

  it('juge chaque Projet sur sa propre Couverture', () => {
    const view = describeSlices({ slices, dimension: 'project', tiles: tiles(), ctx });
    expect(view.failureColumn).toBe(true);
    expect(view.rows[0]?.failure).toEqual({ kind: 'rate', rate: 0.125, failed: 7, deliveries: 56 });
    expect(view.rows[1]?.failure).toEqual({ kind: 'insignificant', reason: `Couverture 0${NBSP}% (minimum 50${NBSP}%)` });
    // Sans Livraison, il n'y a pas de taux à juger : « — » avant « non significatif ».
    expect(view.rows[2]?.failure).toEqual({ kind: 'empty' });
  });

  it('explique « n. s. » une fois, sous le tableau', () => {
    const view = describeSlices({ slices, dimension: 'project', tiles: tiles(), ctx });
    expect(view.coverageNote).toContain('n. s.');
    expect(view.coverageNote).toContain(`50${NBSP}%`);
    expect(view.coverageNote).toContain('5 bugs');
  });

  it('n’explique pas « n. s. » quand aucune ligne n’est marquée n. s. : il n’y a rien à expliquer', () => {
    const view = describeSlices({
      slices: [slices[0]!, slice('b', 'projet-b', { significant: true, coverage: coverage(40, 30), throughput: 10, failedDeliveries: 1, failureRate: 0.1 }), slices[2]!],
      dimension: 'project',
      // L'ensemble a lui aussi un taux significatif : aucune cellule du tableau ne dit « n. s. ».
      tiles: tiles({ significant: true, reasons: [], reason: null, coverage: coverage(100, 80) }),
      ctx,
    });
    expect(view.failureColumn).toBe(true);
    expect([...view.rows, view.overall].map((row) => row.failure.kind)).toEqual(['rate', 'rate', 'empty', 'rate']);
    expect(view.coverageNote).toBeNull();
  });

  it('explique « n. s. » dès qu’une ligne en est marquée, même si c’est seulement la ligne Ensemble', () => {
    // Le Projet a un taux ; l'ensemble, lui, n'a pas assez de Couverture (celle de tuiles() : 19 %).
    const view = describeSlices({ slices: [slices[0]!], dimension: 'project', tiles: tiles(), ctx });
    expect(view.rows.map((row) => row.failure.kind)).toEqual(['rate']);
    expect(view.overall.failure.kind).toBe('insignificant');
    expect(view.coverageNote).toContain('n. s.');
  });

  it('dit « n. s. » sans parler d’un Projet : la légende sert aussi à la ligne Ensemble', () => {
    const view = describeSlices({ slices: [slices[0]!], dimension: 'project', tiles: tiles(), ctx });
    expect(view.coverageNote).toBe(
      `n. s. : Taux d’échec non significatif, faute de Couverture ou de bugs (moins de 50${NBSP}% des bugs avec une origine, ou moins de 5 bugs).`,
    );
  });

  it('retire la colonne quand aucun Projet n’a de taux significatif, et le dit', () => {
    const view = describeSlices({ slices: slices.slice(1), dimension: 'project', tiles: tiles(), ctx });
    expect(view.failureColumn).toBe(false);
    expect(view.coverageNote).toContain('aucun Projet');
  });

  it('dit « aucun Projet n’a assez de Couverture » quand aucun Projet n’atteint le minimum', () => {
    const view = describeSlices({
      slices: [slices[1]!, slice('b', 'projet-b', { significant: false, coverage: coverage(40, 4), throughput: 10 })],
      dimension: 'project',
      tiles: tiles(),
      ctx,
    });
    expect(view.failureColumn).toBe(false);
    expect(view.coverageNote).toContain('aucun Projet n’a assez de Couverture');
  });

  it('ne dit pas que la Couverture manque partout quand un Projet en a assez mais n’a rien livré : c’est le taux qui n’existe pas', () => {
    const view = describeSlices({
      slices: [
        // A : Couverture suffisante (20 bugs sur 20), mais aucune Livraison : pas de taux à montrer.
        slice('a', 'projet-a', { significant: true, coverage: coverage(20, 20), throughput: 0, failedDeliveries: 0, failureRate: null, leadTime: stats(null, null, 0), cycleTime: stats(null, null, 0) }),
        // B : des Livraisons, mais 10 % de Couverture.
        slice('b', 'projet-b', { significant: false, coverage: coverage(40, 4), throughput: 10 }),
      ],
      dimension: 'project',
      tiles: tiles(),
      ctx,
    });

    expect(view.failureColumn).toBe(false);
    expect(view.coverageNote).not.toContain('aucun Projet n’a assez de Couverture');
    expect(view.coverageNote).toContain('aucun Projet n’a à la fois assez de Couverture');
    expect(view.coverageNote).toContain(`50${NBSP}%`);
    expect(view.coverageNote).toContain('et des Livraisons sur la période');
  });

  it('lie chaque Projet à sa page Métriques', () => {
    const view = describeSlices({ slices, dimension: 'project', tiles: tiles(), ctx, projectHref: (id) => `/p/${id}/metrics?range=7d` });
    expect(view.rows.map((row) => row.href)).toEqual(['/p/mpm/metrics?range=7d', '/p/sais/metrics?range=7d', '/p/vide/metrics?range=7d']);
    expect(view.rows[0]?.series).toMatchObject({ key: 'mpm', label: 'My-Prompt-Manager', color: 'oklch(var(--series-l) var(--series-c) 120)' });
  });
});

describe('describeSlices : la ligne « Ensemble »', () => {
  it('reprend les tuiles, pour comparer chaque ligne à l’ensemble et recouper les totaux', () => {
    const view = describeSlices({ slices: [slice('bug', 'bug')], dimension: 'type', tiles: tiles(), ctx });
    expect(view.overall).toMatchObject({
      key: 'all',
      label: 'Ensemble',
      throughput: 64,
      leadTime: { median: 296_930_437, p85: 995_720_583, n: 64 },
      cycleTime: { median: 87_690_325, n: 52 },
      wip: 11,
      series: null,
      href: null,
    });
    expect(view.overall.failure).toEqual({
      kind: 'insignificant',
      reason: 'Couverture insuffisante : 19 % des bugs ont une origine renseignée (minimum 50 %).',
    });
  });

  it('montre le taux de la tuile quand il est significatif', () => {
    const view = describeSlices({
      slices: [slice('bug', 'bug')],
      dimension: 'type',
      tiles: tiles({ significant: true, reasons: [], reason: null, rate: 0.2, failed: 13, deliveries: 64 }),
      ctx,
    });
    expect(view.overall.failure).toEqual({ kind: 'rate', rate: 0.2, failed: 13, deliveries: 64 });
  });
});

describe('explainInsignificance : pourquoi un taux ne dit rien, avec les chiffres de l’API', () => {
  it('dit la Couverture sous le minimum', () => {
    expect(explainInsignificance(coverage(28, 0), THRESHOLDS)).toBe(`Couverture 0${NBSP}% (minimum 50${NBSP}%)`);
    expect(explainInsignificance(coverage(36, 13), THRESHOLDS)).toBe(`Couverture 36${NBSP}% (minimum 50${NBSP}%)`);
  });

  it('dit le nombre de bugs sous le minimum', () => {
    expect(explainInsignificance(coverage(3, 3), THRESHOLDS)).toBe('3 bugs (minimum 5)');
    expect(explainInsignificance(coverage(1, 1), THRESHOLDS)).toBe('1 bug (minimum 5)');
  });

  it('dit les deux quand les deux manquent', () => {
    expect(explainInsignificance(coverage(2, 0), THRESHOLDS)).toBe(`Couverture 0${NBSP}% (minimum 50${NBSP}%) ; 2 bugs (minimum 5)`);
  });

  it('dit « aucun bug » sans bug : il n’y a rien à couvrir', () => {
    expect(explainInsignificance(coverage(0, 0), THRESHOLDS)).toBe('0 bug (minimum 5)');
  });
});
