import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThroughputPanel } from './ThroughputChart';
import { emptyMetricsFixture, metricsFixture, stubChartWidth, weeklyMetricsFixture } from './testing';

beforeEach(() => stubChartWidth(640));
afterEach(() => vi.restoreAllMocks());

const hitArea = (container: HTMLElement) => container.querySelector<SVGRectElement>('[data-chart-hit]')!;
const bars = (container: HTMLElement) => [...container.querySelectorAll<SVGRectElement>('[data-bar]')];

describe('ThroughputPanel : l’histogramme du Débit', () => {
  it('dessine une barre par jour qui a des Livraisons, dont la somme est celle de la tuile', () => {
    const { buckets } = metricsFixture();
    const { container } = render(<ThroughputPanel buckets={buckets} unit="day" running asOfTime="20:00" />);

    // 7 jours, dont 4 sans Livraison : 3 barres.
    expect(bars(container)).toHaveLength(buckets.filter((bucket) => bucket.deliveries > 0).length);
    expect(screen.getByRole('img', { name: 'Débit : 18 Livraisons sur 7 tranches.' })).toBeTruthy();
    expect(screen.getByText('18 Livraisons sur la période, comptées par jour.')).toBeTruthy();
  });

  it('hachure la tranche du jour en cours, et la nomme dans la légende', () => {
    const { buckets } = metricsFixture();
    const { container } = render(<ThroughputPanel buckets={buckets} unit="day" running asOfTime="20:00" />);

    const partial = bars(container).filter((bar) => bar.hasAttribute('data-partial'));
    expect(partial).toHaveLength(1);
    expect(partial[0]?.getAttribute('fill')).toMatch(/^url\(#/);
    expect(within(screen.getByRole('list', { name: 'Légende du Débit' })).getByText('Jour en cours')).toBeTruthy();
  });

  it('ne parle pas d’une tranche incomplète dans la légende quand elle n’a aucune Livraison à hachurer', () => {
    const { buckets } = metricsFixture();
    const quietToday = buckets.map((bucket, index) => (index === buckets.length - 1 ? { ...bucket, deliveries: 0 } : bucket));
    const { container } = render(<ThroughputPanel buckets={quietToday} unit="day" running asOfTime="20:00" />);

    expect(bars(container).some((bar) => bar.hasAttribute('data-partial'))).toBe(false);
    expect(within(screen.getByRole('list', { name: 'Légende du Débit' })).queryByText('Jour en cours')).toBeNull();
  });

  it('ne hachure rien quand la période est finie : toutes les tranches sont pleines', () => {
    const { buckets } = metricsFixture();
    const { container } = render(<ThroughputPanel buckets={buckets} unit="day" running={false} asOfTime="00:00" />);

    expect(bars(container).some((bar) => bar.hasAttribute('data-partial'))).toBe(false);
    expect(within(screen.getByRole('list', { name: 'Légende du Débit' })).queryByText('Jour en cours')).toBeNull();
  });

  it('hachure les semaines tronquées aux bords de la période, sans toucher aux semaines pleines', () => {
    const { buckets } = weeklyMetricsFixture();
    const { container } = render(<ThroughputPanel buckets={buckets} unit="week" running asOfTime="20:00" />);

    // Première semaine à 0 Livraison : pas de barre. Reste : 3 pleines/tronquées à 3, 11 (pleine), 12 (1 jour sur 7, en cours).
    const all = bars(container);
    expect(all).toHaveLength(3);
    expect(all.map((bar) => bar.hasAttribute('data-partial'))).toEqual([false, false, true]);
    expect(within(screen.getByRole('list', { name: 'Légende du Débit' })).getByText('Semaine incomplète ou en cours')).toBeTruthy();
  });

  it('détaille une tranche au survol, et dit quand elle est incomplète', () => {
    const { buckets } = weeklyMetricsFixture();
    const { container } = render(<ThroughputPanel buckets={buckets} unit="week" running asOfTime="20:00" />);

    // Largeur 640, marges 30 et 8 : 602 px pour 5 tranches ; la dernière commence à 482 px.
    fireEvent.pointerMove(hitArea(container), { clientX: 590, clientY: 80, pointerType: 'mouse' });

    const tooltip = container.querySelector<HTMLElement>('[data-chart-tooltip]')!;
    expect(tooltip.textContent).toContain('lun. 2 nov. 2026');
    expect(tooltip.textContent).toContain('12 Livraisons');
    expect(tooltip.textContent).toContain('Semaine en cours : 1 jour sur 7, jusqu’à 20:00.');

    fireEvent.pointerMove(hitArea(container), { clientX: 10, clientY: 80, pointerType: 'mouse' });
    const first = container.querySelector<HTMLElement>('[data-chart-tooltip]')!;
    expect(first.textContent).toContain('mer. 5 août – dim. 9 août 2026');
    expect(first.textContent).toContain('Aucune Livraison');
    expect(first.textContent).toContain('Semaine incomplète : 5 jours sur 7 dans la période.');
  });

  it('donne le rythme par jour d’une semaine, pour la comparer aux autres', () => {
    const { buckets } = weeklyMetricsFixture();
    const { container } = render(<ThroughputPanel buckets={buckets} unit="week" running asOfTime="20:00" />);

    // 11 Livraisons en 7 jours : 1,6 par jour.
    fireEvent.pointerMove(hitArea(container), { clientX: 400, clientY: 80, pointerType: 'mouse' });
    expect(container.querySelector('[data-chart-tooltip]')?.textContent).toContain('1,6 par jour sur 7 jours');
  });

  it('donne les mêmes valeurs en tableau, avec la remarque de chaque tranche', async () => {
    const user = userEvent.setup();
    const { buckets } = weeklyMetricsFixture();
    render(<ThroughputPanel buckets={buckets} unit="week" running asOfTime="20:00" />);

    await user.click(screen.getByText('Données du graphique'));
    const table = screen.getByRole('table', { name: 'Livraisons de chaque tranche de la période' });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(1 + buckets.length);

    const last = within(rows.at(-1)!).getAllByRole('cell').map((cell) => cell.textContent);
    expect(last).toEqual(['1', '12', '12', 'Semaine en cours : 1 jour sur 7, jusqu’à 20:00.']);
    expect(within(rows[1]!).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['5', '0', '0', 'Semaine incomplète : 5 jours sur 7 dans la période.']);
  });

  it('dit qu’il n’y a aucune Livraison plutôt que de dessiner un graphique vide', () => {
    const { container } = render(<ThroughputPanel buckets={emptyMetricsFixture().buckets} unit="day" running asOfTime="20:00" />);

    expect(screen.getByText('Aucune Livraison sur cette période.')).toBeTruthy();
    expect(container.querySelector('svg')).toBeNull();
  });
});
