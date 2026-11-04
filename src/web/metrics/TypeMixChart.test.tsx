import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { TypeMixPanel } from './TypeMixChart';
import { emptyMetricsFixture, metricsFixture, plain } from './testing';

/**
 * Répartition par type. Fixture (`slices.type`) : bug 10 Livraisons / 7 Arrivées / 5 en cours, tâche 3 / 7 / 3, fonctionnalité 1 / 7 / 3.
 */

/** Une comparaison d'un nom accessible, espaces insécables (« 33 % ») comprises comme des espaces. */
const named = (expected: string) => (name: string) => plain(name) === expected;

const renderPanel = (slices = metricsFixture().slices.type) => render(<TypeMixPanel slices={slices} />);

describe('TypeMixPanel : la répartition par type', () => {
  it('dit ce qu’elle répartit', () => {
    renderPanel();

    expect(screen.getByRole('region', { name: 'Répartition par type' })).toBeTruthy();
    expect(screen.getByText('Part de chaque type de ticket parmi les Arrivées, les Livraisons et les tickets en cours.')).toBeTruthy();
  });

  it('fait trois barres, les Arrivées, les Livraisons et le WIP, chacune résumée pour les lecteurs d’écran', () => {
    renderPanel();

    expect(screen.getByRole('img', { name: named('Arrivées : 7 Bugs (33 %), 7 Fonctionnalités (33 %), 7 Tâches (33 %)') })).toBeTruthy();
    expect(screen.getByRole('img', { name: named('Livraisons : 10 Bugs (71 %), 1 Fonctionnalité (7,1 %), 3 Tâches (21 %)') })).toBeTruthy();
    expect(screen.getByRole('img', { name: named('En cours : 5 Bugs (45 %), 3 Fonctionnalités (27 %), 3 Tâches (27 %)') })).toBeTruthy();
  });

  it('dessine un segment par type et par barre, de la couleur fixe du type, large de sa part', () => {
    const { container } = renderPanel();

    const deliveries = [...container.querySelectorAll<HTMLElement>('[data-row="deliveries"] [data-type]')];
    expect(deliveries.map((segment) => segment.getAttribute('data-type'))).toEqual(['bug', 'feature', 'task']);
    expect(deliveries.map((segment) => Number.parseFloat(segment.style.width))).toEqual([
      expect.closeTo((10 / 14) * 100, 6),
      expect.closeTo((1 / 14) * 100, 6),
      expect.closeTo((3 / 14) * 100, 6),
    ]);
    expect(deliveries[0]?.style.background).toContain('var(--type-bug)');
  });

  it('écrit le total de chaque barre', () => {
    const { container } = renderPanel();

    const total = (key: string) => plain(container.querySelector(`[data-row="${key}"] [data-total]`)?.textContent);
    expect([total('arrivals'), total('deliveries'), total('wip')]).toEqual(['21', '14', '11']);
  });

  it('nomme les types dans la légende', () => {
    renderPanel();

    const legend = screen.getByRole('list', { name: 'Légende des types' });
    expect(within(legend).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Bug', 'Fonctionnalité', 'Tâche']);
  });

  it('range les mêmes comptes en tableau, avec la part de chacun et le total', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByText('Données du graphique'));
    const table = screen.getByRole('table', { name: 'Tickets par type : Arrivées, Livraisons et en cours' });
    const rows = within(table).getAllByRole('row');

    expect(within(rows[0]!).getAllByRole('columnheader').map((header) => header.textContent)).toEqual(['Type', 'Arrivées', 'Livraisons', 'En cours']);
    expect(rows.slice(1).map((row) => [within(row).getByRole('rowheader').textContent, ...within(row).getAllByRole('cell').map((cell) => plain(cell.textContent))])).toEqual([
      ['Bug', '7 (33 %)', '10 (71 %)', '5 (45 %)'],
      ['Fonctionnalité', '7 (33 %)', '1 (7,1 %)', '3 (27 %)'],
      ['Tâche', '7 (33 %)', '3 (21 %)', '3 (27 %)'],
      ['Total', '21', '14', '11'],
    ]);
  });

  it('ne cite dans le résumé d’une barre que les types qui y sont : pas de « 0 Tâche (0 %) »', () => {
    const base = metricsFixture().slices.type;
    // Les Livraisons sont des bugs seulement ; les tâches n'ont que des Arrivées et du WIP.
    renderPanel([
      { ...(base[0] as (typeof base)[number]), key: 'bug', label: 'bug', throughput: 4, arrivals: 0, wip: 0 },
      { ...(base[0] as (typeof base)[number]), key: 'task', label: 'task', throughput: 0, arrivals: 3, wip: 1 },
    ]);

    expect(screen.getByRole('img', { name: named('Livraisons : 4 Bugs (100 %)') })).toBeTruthy();
    expect(screen.getByRole('img', { name: named('Arrivées : 3 Tâches (100 %)') })).toBeTruthy();
    expect(screen.getByRole('img', { name: named('En cours : 1 Tâche (100 %)') })).toBeTruthy();
  });

  it('dit « aucun » d’une barre vide plutôt que de la dessiner à zéro', () => {
    const base = metricsFixture().slices.type;
    const { container } = renderPanel(base.map((slice) => ({ ...slice, wip: 0 })));

    expect(screen.getByRole('img', { name: 'En cours : aucun ticket' })).toBeTruthy();
    expect(container.querySelector('[data-row="wip"] [data-type]')).toBeNull();
  });

  it('dit qu’il n’y a rien à répartir', () => {
    const { container } = renderPanel(emptyMetricsFixture().slices.type);

    expect(screen.getByText('Aucune Arrivée, Livraison ni ticket en cours sur cette période.')).toBeTruthy();
    expect(container.querySelector('[data-type]')).toBeNull();
  });
});
