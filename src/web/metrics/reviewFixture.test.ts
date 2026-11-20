import { describe, expect, it } from 'vitest';
import { emptyMetricsFixture, metricsFixture } from './testing';

/**
 * Les fixtures de la page Métriques se tiennent (bdesk-pz0.5) : le Taux d'échec après relecture est significatif par la règle du Taux d'échec, sur la même
 * Couverture, comme le serveur le calcule (`computeReview`) ; ses Livraisons sont celles du Débit.
 */
describe('mesures de relecture des fixtures', () => {
  it.each([
    ['metricsFixture', metricsFixture()],
    ['emptyMetricsFixture', emptyMetricsFixture()],
  ])('%s : même signification que la tuile du Taux d’échec, mêmes Livraisons que le Débit', (_name, data) => {
    const { coverage, significant, reasons, thresholds } = data.tiles.failureRate;
    expect(data.review.failureRate).toMatchObject({ coverage, significant, reasons, thresholds });
    expect(data.review.deliveries).toBe(data.tiles.throughput.total);
    expect(data.review.failureRate.reviewed.deliveries + data.review.failureRate.unreviewed.deliveries).toBe(data.tiles.failureRate.deliveries);
  });
});
