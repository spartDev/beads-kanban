import { describe, expect, it } from 'vitest';
import type { MetricsSlice } from '../../shared/api';
import { describeTypeMix } from './mix';
import { metricsFixture } from './testing';

/**
 * Répartition par type : la part de chaque type parmi les Arrivées, les Livraisons et le WIP de la période. L'API la sert
 * déjà (`slices.type`) ; la page en tire des parts et les couleurs fixes des types.
 */

const slice = (key: string, throughput: number, arrivals: number, wip: number): MetricsSlice => ({
  ...(metricsFixture().slices.type[0] as MetricsSlice),
  key,
  label: key,
  throughput,
  arrivals,
  wip,
});

describe('describeTypeMix', () => {
  const view = describeTypeMix([slice('task', 3, 4, 3), slice('bug', 10, 6, 5), slice('feature', 1, 2, 3)]);

  it('range les types dans l’ordre du code couleur des tickets, comme les autres légendes', () => {
    expect(view.types.map((entry) => [entry.type, entry.label])).toEqual([
      ['bug', 'Bug'],
      ['feature', 'Fonctionnalité'],
      ['task', 'Tâche'],
    ]);
    expect(view.types.map((entry) => entry.color)).toEqual(['var(--type-bug)', 'var(--type-feature)', 'var(--type-task)']);
  });

  it('fait trois lignes, les Arrivées, les Livraisons et le WIP, avec leur total', () => {
    expect(view.rows.map((row) => [row.key, row.label, row.total])).toEqual([
      ['arrivals', 'Arrivées', 12],
      ['deliveries', 'Livraisons', 14],
      ['wip', 'En cours', 11],
    ]);
  });

  it('donne à chaque ligne un segment par type, avec son compte et sa part', () => {
    const deliveries = view.rows.find((row) => row.key === 'deliveries');
    expect(deliveries?.segments.map((segment) => [segment.type, segment.count])).toEqual([
      ['bug', 10],
      ['feature', 1],
      ['task', 3],
    ]);
    expect(deliveries?.segments[0]?.share).toBeCloseTo(10 / 14, 12);
    expect(deliveries?.segments.reduce((sum, segment) => sum + segment.share, 0)).toBeCloseTo(1, 12);
  });

  it('garde les types sans compte dans une ligne, à zéro : toutes les lignes ont les mêmes segments', () => {
    const uneven = describeTypeMix([slice('bug', 4, 0, 0), slice('task', 0, 3, 1)]);

    expect(uneven.rows.map((row) => row.segments.map((segment) => segment.count))).toEqual([
      [0, 3], // Arrivées
      [4, 0], // Livraisons
      [0, 1], // En cours
    ]);
  });

  it('a une part nulle dans une ligne sans rien : pas de division par zéro', () => {
    const quiet = describeTypeMix([slice('bug', 2, 0, 0)]);
    const arrivals = quiet.rows.find((row) => row.key === 'arrivals');

    expect(arrivals).toMatchObject({ total: 0 });
    expect(arrivals?.segments.map((segment) => segment.share)).toEqual([0]);
  });

  it('colore un type personnalisé de beads de la couleur neutre, et le nomme tel quel', () => {
    const custom = describeTypeMix([slice('incident', 1, 1, 1)]);

    expect(custom.types[0]).toMatchObject({ type: 'incident', label: 'incident', color: 'var(--type-other)' });
  });

  it('est vide sans rien à répartir', () => {
    expect(describeTypeMix([]).empty).toBe(true);
    expect(describeTypeMix([slice('bug', 0, 0, 0)]).empty).toBe(true);
    expect(view.empty).toBe(false);
  });

  it('reprend les types de la fixture de la Vue globale', () => {
    const fixture = describeTypeMix(metricsFixture().slices.type);

    expect(fixture.rows.find((row) => row.key === 'deliveries')?.total).toBe(14);
  });
});
