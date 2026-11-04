import { describe, expect, it } from 'vitest';
import type { MetricsBucket } from '../../shared/api';
import { balanceOf, describeBalance } from './balance';
import { metricsFixture, trendOf, weeklyMetricsFixture } from './testing';

/**
 * Arrivées vs Débit : l'API sert déjà les Arrivées et les Livraisons de chaque tranche (`buckets`) et de la période
 * (`tiles.arrivals`, `tiles.throughput`). Ici, ce que la page en tire : l'écart de chaque tranche et son cumul, et
 * l'écart de la période avec sa tendance.
 */

describe('balanceOf : l’écart Arrivées–Débit de la période', () => {
  it('est les Arrivées moins le Débit, avec ceux de la période précédente pour la tendance', () => {
    const { tiles } = metricsFixture();

    // Fixture : 20 Arrivées (contre 32) et 18 Livraisons (contre 28) : +2 contre +4.
    expect(balanceOf(tiles)).toEqual({ arrivals: 20, throughput: 18, net: 2, trend: { previous: 4, delta: -2, ratio: -0.5 } });
  });

  it('est négatif quand le Débit dépasse les Arrivées : la file se vide', () => {
    const { tiles } = metricsFixture();
    const drained = { ...tiles, arrivals: { total: 5, trend: trendOf(5, 8) }, throughput: { total: 12, trend: trendOf(12, 3) } };

    expect(balanceOf(drained)).toEqual({ arrivals: 5, throughput: 12, net: -7, trend: { previous: 5, delta: -12, ratio: -12 / 5 } });
  });

  it('n’a pas de variation relative quand l’écart précédent était nul', () => {
    const { tiles } = metricsFixture();
    const even = { ...tiles, arrivals: { total: 4, trend: trendOf(4, 6) }, throughput: { total: 1, trend: trendOf(1, 6) } };

    expect(balanceOf(even).trend).toEqual({ previous: 0, delta: 3, ratio: null });
  });
});

describe('describeBalance : les tranches de la période, avec leur écart et son cumul', () => {
  const rows = describeBalance(metricsFixture().buckets, { unit: 'day', running: true, asOfTime: '20:00' });

  it('garde une ligne par tranche, avec les Arrivées et les Livraisons telles que l’API les donne', () => {
    // Fixture : Livraisons 2 2 0 0 2 0 12, Arrivées 1 3 0 2 1 5 8.
    expect(rows.map((row) => [row.arrivals, row.deliveries])).toEqual([[1, 2], [3, 2], [0, 0], [2, 0], [1, 2], [5, 0], [8, 12]]);
    expect(rows.map((row) => row.from)).toEqual(['2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
  });

  it('donne l’écart de chaque tranche : Arrivées moins Livraisons', () => {
    expect(rows.map((row) => row.net)).toEqual([-1, 1, 0, 2, -1, 5, -4]);
  });

  it('cumule les Arrivées, les Livraisons et l’écart jusqu’à la fin de chaque tranche', () => {
    expect(rows.map((row) => row.cumulativeArrivals)).toEqual([1, 4, 4, 6, 7, 12, 20]);
    expect(rows.map((row) => row.cumulativeDeliveries)).toEqual([2, 4, 4, 4, 6, 6, 18]);
    expect(rows.map((row) => row.cumulativeNet)).toEqual([-1, 0, 0, 2, 1, 6, 2]);
    // Le dernier cumul est la période : les totaux des tuiles.
    expect([rows.at(-1)?.cumulativeArrivals, rows.at(-1)?.cumulativeDeliveries]).toEqual([20, 18]);
  });

  it('dit, comme l’histogramme du Débit, que la dernière tranche d’une période qui court n’est pas finie', () => {
    expect(rows.at(-1)).toMatchObject({ running: true, partial: true, note: 'Jour en cours, jusqu’à 20:00.', title: 'lun. 2 nov. 2026' });
    expect(rows[0]).toMatchObject({ running: false, partial: false, note: null });
  });

  it('signale les semaines tronquées aux bords de la période, sans corriger les comptes', () => {
    const weeks = describeBalance(weeklyMetricsFixture().buckets, { unit: 'week', running: true, asOfTime: '20:00' });

    expect(weeks.map((row) => [row.days, row.arrivals, row.deliveries])).toEqual([
      [5, 1, 0],
      [7, 0, 0],
      [7, 4, 3],
      [7, 10, 11],
      [1, 8, 12],
    ]);
    expect(weeks[0]?.note).toBe('Semaine incomplète : 5 jours sur 7 dans la période.');
    expect(weeks.at(-1)?.cumulativeArrivals).toBe(23);
  });

  it('ne rend rien sans tranche', () => {
    expect(describeBalance([] as MetricsBucket[], { unit: 'day', running: false, asOfTime: '00:00' })).toEqual([]);
  });
});
